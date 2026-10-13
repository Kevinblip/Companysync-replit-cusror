// Dev round-trip test for the backup/restore engine.
// Exercises collectCompanyBackupData -> restoreBackupIntoCompany against the
// live dev Postgres using a throwaway test company, then verifies the security
// invariants. Cleans up after itself.
import crypto from 'crypto';
import { createRequire } from 'node:module';
import { collectCompanyBackupData, restoreBackupIntoCompany, getFunctionsPool } from '../vite-functions-plugin.js';
import { getPool } from '../db/schema.js';

// The restore path opens transactions that write generic_entities. Adopt every
// pool this process will use before any query, so those sessions carry the
// script timeouts and are rolled back if the script is interrupted. These
// imports are hoisted above the helper, so each pool is adopted by hand rather
// than by the helper's constructor interception.
const { adoptPool } = createRequire(import.meta.url)('./lib/db-pool.cjs');
const pool = adoptPool(getPool());
adoptPool(getFunctionsPool());
const CO = 'test_backup_restore_co_' + Date.now();
let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓', msg); } else { console.error('  ✗ FAIL:', msg); failures++; }
}

async function cleanup() {
  for (const t of ['customers', 'leads', 'staff_profiles']) {
    await pool.query(`DELETE FROM ${t} WHERE company_id = $1`, [CO]).catch(() => {});
  }
  await pool.query(`DELETE FROM generic_entities WHERE company_id = $1`, [CO]).catch(() => {});
  await pool.query(`DELETE FROM companies WHERE id = $1`, [CO]).catch(() => {});
}

async function main() {
  await cleanup();

  // Seed a company + a customer + a lead + a staff row + a generic Task.
  const custId = 'cust_' + crypto.randomUUID();
  const leadId = 'lead_' + crypto.randomUUID();
  const staffId = 'staff_' + crypto.randomUUID();
  const taskId = 'task_' + crypto.randomUUID();
  await pool.query(`INSERT INTO companies (id, company_name, subscription_plan, max_users) VALUES ($1,$2,$3,$4)`,
    [CO, 'Original Co Name', 'trial', 5]);
  await pool.query(`INSERT INTO customers (id, company_id, name, email) VALUES ($1,$2,$3,$4)`,
    [custId, CO, 'Alice Customer', 'alice@example.com']);
  await pool.query(`INSERT INTO leads (id, company_id, name, status) VALUES ($1,$2,$3,$4)`,
    [leadId, CO, 'Bob Lead', 'new']);
  await pool.query(`INSERT INTO staff_profiles (id, company_id, name, email, is_administrator, is_super_admin) VALUES ($1,$2,$3,$4,$5,$6)`,
    [staffId, CO, 'Carol Admin', 'carol@example.com', true, false]);
  await pool.query(`INSERT INTO generic_entities (id, entity_type, company_id, data) VALUES ($1,'Task',$2,$3)`,
    [taskId, CO, JSON.stringify({ title: 'Fix roof', status: 'open' })]);

  // 1) Collect
  console.log('\n[1] collectCompanyBackupData');
  const snap = await collectCompanyBackupData(pool, CO);
  assert(snap.backupData.Customer?.length === 1, 'captured 1 customer (dedicated table)');
  assert(snap.backupData.Lead?.length === 1, 'captured 1 lead (dedicated table)');
  assert(snap.backupData.StaffProfile?.length === 1, 'captured 1 staff profile');
  assert(snap.backupData.Task?.length === 1, 'captured 1 generic Task');
  assert(snap.backupData.Company?.length === 1, 'captured Company row');
  assert(snap.backupData.Task[0].title === 'Fix roof', 'generic data flattened to top level');

  // 2) Mutate live DB, then restore (merge) — should reset to snapshot values,
  // preserving ids.
  console.log('\n[2] restore (merge) reverts changes & preserves ids');
  await pool.query(`UPDATE customers SET name = $1 WHERE id = $2`, ['Alice CHANGED', custId]);
  await pool.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
  const r1 = await restoreBackupIntoCompany(pool, { companyId: CO, backupData: snap.backupData, deleteExisting: false });
  assert(r1.success, 'restore returned success');
  const cust = (await pool.query(`SELECT name FROM customers WHERE id = $1`, [custId])).rows[0];
  assert(cust && cust.name === 'Alice Customer', 'customer name restored to original (upsert by id)');
  const lead = (await pool.query(`SELECT id FROM leads WHERE id = $1`, [leadId])).rows[0];
  assert(!!lead, 'deleted lead re-created with SAME id');
  const custCount = (await pool.query(`SELECT COUNT(*)::int c FROM customers WHERE company_id = $1`, [CO])).rows[0].c;
  assert(custCount === 1, 'no duplicate customer rows created (upsert, not insert-new)');

  // 3) Security: staff is_super_admin is forced false even if backup says true.
  console.log('\n[3] staff is_super_admin sanitized to false');
  const evilSnap = JSON.parse(JSON.stringify(snap.backupData));
  evilSnap.StaffProfile[0].is_super_admin = true;
  evilSnap.StaffProfile[0].is_administrator = true;
  await restoreBackupIntoCompany(pool, { companyId: CO, backupData: evilSnap, deleteExisting: false });
  const staff = (await pool.query(`SELECT is_super_admin, is_administrator FROM staff_profiles WHERE id = $1`, [staffId])).rows[0];
  assert(staff.is_super_admin === false, 'is_super_admin forced to false (no global escalation)');
  assert(staff.is_administrator === true, 'is_administrator preserved (no company lockout)');

  // 4) Security: Company billing columns cannot be changed via restore.
  console.log('\n[4] Company billing columns protected, safe columns updated');
  const evilCo = JSON.parse(JSON.stringify(snap.backupData));
  evilCo.Company[0].subscription_plan = 'enterprise';
  evilCo.Company[0].max_users = 99999;
  evilCo.Company[0].company_name = 'Renamed Co';
  await restoreBackupIntoCompany(pool, { companyId: CO, backupData: evilCo, deleteExisting: false });
  const co = (await pool.query(`SELECT company_name, subscription_plan, max_users FROM companies WHERE id = $1`, [CO])).rows[0];
  assert(co.subscription_plan === 'trial', 'subscription_plan NOT escalated (stayed trial)');
  assert(co.max_users === 5, 'max_users NOT escalated (stayed 5)');
  assert(co.company_name === 'Renamed Co', 'whitelisted company_name WAS updated');

  // 5) Security: company_id is forced — a backup row for another tenant lands
  // in THIS company, not the forged one.
  console.log('\n[5] company_id forced on every row');
  const forged = { Customer: [{ id: 'forged_' + crypto.randomUUID(), company_id: 'someone_else_co', name: 'Forged' }] };
  await restoreBackupIntoCompany(pool, { companyId: CO, backupData: forged, deleteExisting: false });
  const forgedRow = (await pool.query(`SELECT company_id FROM customers WHERE name = 'Forged'`)).rows[0];
  assert(forgedRow && forgedRow.company_id === CO, 'forged company_id overridden to target company');

  // 6) dryRun makes no writes.
  console.log('\n[6] dryRun counts without writing');
  const before = (await pool.query(`SELECT COUNT(*)::int c FROM customers WHERE company_id = $1`, [CO])).rows[0].c;
  const dry = await restoreBackupIntoCompany(pool, { companyId: CO, backupData: { Customer: [{ id: 'dry_x', name: 'DryOnly' }] }, dryRun: true });
  assert(dry.dry_run === true && dry.total_restored === 1, 'dryRun reports planned count (1)');
  const after = (await pool.query(`SELECT COUNT(*)::int c FROM customers WHERE company_id = $1`, [CO])).rows[0].c;
  assert(before === after, 'dryRun wrote nothing');

  // 7) Security: a conflicting id belonging to ANOTHER company must not be
  // hijacked/reassigned into the caller's company.
  console.log('\n[7] cross-tenant id hijack blocked');
  const OTHER = 'test_backup_other_co_' + Date.now();
  const victimId = 'victim_' + crypto.randomUUID();
  await pool.query(`INSERT INTO companies (id, company_name) VALUES ($1,$2)`, [OTHER, 'Victim Co']);
  await pool.query(`INSERT INTO customers (id, company_id, name) VALUES ($1,$2,$3)`, [victimId, OTHER, 'Victim Customer']);
  const hijack = { Customer: [{ id: victimId, name: 'STOLEN' }] };
  await restoreBackupIntoCompany(pool, { companyId: CO, backupData: hijack, deleteExisting: false });
  const victim = (await pool.query(`SELECT company_id, name FROM customers WHERE id = $1`, [victimId])).rows[0];
  assert(victim && victim.company_id === OTHER, "victim row NOT reassigned to caller's company");
  assert(victim && victim.name === 'Victim Customer', 'victim row NOT overwritten');
  await pool.query(`DELETE FROM customers WHERE company_id = $1`, [OTHER]).catch(() => {});
  await pool.query(`DELETE FROM companies WHERE id = $1`, [OTHER]).catch(() => {});

  // 8) A stale base44_id in the backup must not abort the whole restore.
  console.log('\n[8] stale base44_id does not abort restore');
  const b44 = { Customer: [{ id: 'b44_' + crypto.randomUUID(), name: 'HasB44', base44_id: 'dup_' + crypto.randomUUID() }] };
  const r8 = await restoreBackupIntoCompany(pool, { companyId: CO, backupData: b44, deleteExisting: false });
  assert(r8.success, 'restore succeeded despite base44_id present');
  const b44row = (await pool.query(`SELECT name FROM customers WHERE company_id = $1 AND name = 'HasB44'`, [CO])).rows[0];
  assert(!!b44row, 'row inserted (base44_id stripped, no constraint abort)');

  console.log(`\n${failures === 0 ? '✅ ALL PASSED' : '❌ ' + failures + ' FAILURE(S)'}`);
}

main()
  .catch(e => { console.error('TEST ERROR:', e); failures++; })
  .finally(async () => { await cleanup(); await pool.end(); process.exit(failures === 0 ? 0 : 1); });
