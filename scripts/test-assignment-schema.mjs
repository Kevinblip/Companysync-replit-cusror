// Uses TEMP clones of the real schema and rolls back. No live records or
// messaging providers are touched.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { getPool } from '../db/schema.js';
const require = createRequire(import.meta.url);
const { listAssignmentsForCaller, readAssignment, assignmentEmails, deliverAssignmentAlert } = require('../lib/assignmentAlerts.cjs');
const source = (await fs.readFile('src/utils/assignmentView.js', 'utf8')).replace(/^import .*;\r?$/gm, '');
const { taskOwnershipPatch, hasNoAssignment } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const pool = getPool();
const client = await pool.connect();
const companyId = 'assignment-schema-fixture';
const roster = [
  { email: 'person-a@example.test', name: 'Person A' },
  { email: 'person-b@example.test', name: 'Person B' },
];
let sent = 0;
try {
  await client.query('BEGIN');
  for (const table of ['companies', 'staff_profiles', 'tasks', 'leads', 'customers', 'projects', 'generic_entities']) {
    await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING INDEXES) ON COMMIT DROP`);
  }
  await client.query('INSERT INTO companies (id, created_by) VALUES ($1, $2)', [companyId, 'owner@example.test']);
  for (const person of roster) {
    await client.query(
      'INSERT INTO staff_profiles (id, company_id, user_email, full_name, is_active, is_administrator) VALUES ($1,$2,$3,$4,true,false)',
      [person.email, companyId, person.email, person.name],
    );
  }
  const legacy = {
    assigned_to_email: roster[0].email, assigned_to_users: [roster[0].email],
    team_members: [roster[0].email], assigned_to: roster[0].email, assigned_to_name: roster[0].name,
  };
  await client.query(
    `INSERT INTO tasks (id, company_id, name, assigned_to, assignees, data, status)
     VALUES ('fixture-task',$1,'Reminder-created task',$2,$3::jsonb,$4::jsonb,'pending')`,
    [companyId, roster[0].email, JSON.stringify([roster[0]]), JSON.stringify(legacy)],
  );
  for (const table of ['leads', 'customers', 'projects']) {
    await client.query(`INSERT INTO ${table} (id, company_id) VALUES ($1,$2)`, [`fixture-${table}`, companyId]);
  }
  for (const entityType of ['Task', 'Lead', 'Customer', 'Project']) {
    const list = await listAssignmentsForCaller(client, { companyId, entityType, email: 'owner@example.test' });
    assert.equal(list.records.length, 1, `${entityType} query works against real schema`);
    assert(list.records[0].created_date instanceof Date, `${entityType} exposes normalized API timestamp`);
    assert(list.records[0].updated_date instanceof Date, `${entityType} exposes normalized update timestamp`);
  }
  async function writeOwners(assignees) {
    const patch = taskOwnershipPatch(assignees);
    await client.query(
      `UPDATE tasks SET assigned_to=$2, assigned_to_name=$3, assignees=$4::jsonb,
       data=data || $5::jsonb, updated_at=NOW() WHERE id=$1`,
      ['fixture-task', patch.assigned_to, patch.assigned_to_name, JSON.stringify(patch.assignees), JSON.stringify(patch.data)],
    );
  }
  await writeOwners([roster[1]]);
  let task = await readAssignment(client, 'Task', 'fixture-task', companyId);
  const staff = (await client.query('SELECT * FROM staff_profiles')).rows;
  assert.deepEqual(assignmentEmails(task, staff), [roster[1].email], 'former owner removed from every representation');
  const former = await listAssignmentsForCaller(client, { companyId, entityType: 'Task', email: roster[0].email });
  assert.equal(former.records.length, 0, 'former owner personal list no longer contains task');
  const next = await listAssignmentsForCaller(client, { companyId, entityType: 'Task', email: roster[1].email });
  assert.equal(next.records.length, 1);
  await deliverAssignmentAlert(client, {
    companyId, entityType: 'Task', entityId: task.id, action: 'assignment_changed',
    quietHours: async () => ({ active: false }), sendEmail: async () => { sent++; return { success: true }; },
  });
  assert.equal(sent, 1, 'only new owner receives notice');
  const notifications = (await client.query("SELECT data FROM generic_entities WHERE entity_type='Notification'")).rows;
  assert.equal(notifications[0].data.user_email, roster[1].email);
  await writeOwners([]);
  task = await readAssignment(client, 'Task', 'fixture-task', companyId);
  assert.deepEqual(assignmentEmails(task, staff), [], 'clearing removes every former owner');
  assert.equal(hasNoAssignment(task), true, 'cleared task appears unassigned');
  const cleared = await listAssignmentsForCaller(client, { companyId, entityType: 'Task', email: roster[1].email });
  assert.equal(cleared.records.length, 0);
  console.log('PASS: real-schema TEMP fixtures — all four readers, timestamp aliases, legacy-owner reassignment/clearing, personal views and intended handoff recipient');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
