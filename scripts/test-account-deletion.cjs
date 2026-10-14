'use strict';

const assert = require('assert');
const {
  planAccountDeletion,
  executeAccountDeletion,
  PROTECTED_COMPANY_IDS,
} = require('../lib/accountDeletion.cjs');

function mockPool(script) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, params });
      if (compact === 'BEGIN' || compact === 'COMMIT' || compact === 'ROLLBACK') return { rows: [], rowCount: 0 };
      return script(compact, params);
    },
    release() {},
  };
  return { queries, connect: async () => client };
}

async function main() {
  assert.strictEqual(planAccountDeletion({}).status, 401);
  assert.strictEqual(planAccountDeletion({ sessionEmail: 'a@b.com', confirmation: 'other@b.com' }).status, 400);
  assert.strictEqual(planAccountDeletion({ sessionEmail: 'a@b.com', confirmation: 'a@b.com', isImpersonating: true }).status, 403);
  const ok = planAccountDeletion({ sessionEmail: ' Owner@Company.test ', confirmation: 'owner@company.test' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.email, 'owner@company.test');

  const sole = mockPool((sql) => {
    if (sql.startsWith('SELECT id, email')) return { rows: [{ id: 'u1', email: 'owner@company.test', company_id: 'co-1' }], rowCount: 1 };
    if (sql.includes('FROM staff_profiles') && sql.startsWith('SELECT id')) return { rows: [{ id: 's1', company_id: 'co-1' }], rowCount: 1 };
    if (sql.includes('FROM companies') && sql.startsWith('SELECT id')) return { rows: [{ id: 'co-1' }], rowCount: 1 };
    if (sql.startsWith('DELETE FROM staff_profiles')) return { rows: [], rowCount: 1 };
    if (sql.includes('COUNT(*)')) return { rows: [{ n: 0 }], rowCount: 1 };
    if (sql.startsWith('UPDATE companies')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('DELETE FROM')) return { rows: [], rowCount: 1 };
    throw new Error('unexpected sql ' + sql);
  });
  const soleResult = await executeAccountDeletion(sole, {
    sessionEmail: 'owner@company.test',
    confirmation: 'owner@company.test',
  });
  assert.strictEqual(soleResult.status, 200);
  assert.strictEqual(soleResult.body.closed_own_tenant, true);
  const emails = sole.queries.flatMap((query) => query.params);
  assert.ok(emails.every((value) => value === 'owner@company.test' || value === 'co-1'));
  assert.ok(sole.queries.some((query) => query.sql.startsWith('DELETE FROM users') && query.params[0] === 'owner@company.test'));

  const shared = mockPool((sql) => {
    if (sql.startsWith('SELECT id, email')) return { rows: [{ id: 'u2', email: 'rep@company.test' }], rowCount: 1 };
    if (sql.includes('FROM staff_profiles') && sql.startsWith('SELECT id')) return { rows: [{ id: 's2', company_id: 'co-9' }], rowCount: 1 };
    if (sql.includes('FROM companies') && sql.startsWith('SELECT id')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('DELETE FROM')) return { rows: [], rowCount: 1 };
    throw new Error('unexpected sql ' + sql);
  });
  const sharedResult = await executeAccountDeletion(shared, {
    sessionEmail: 'rep@company.test',
    confirmation: 'rep@company.test',
  });
  assert.strictEqual(sharedResult.body.closed_own_tenant, false);
  assert.ok(!shared.queries.some((query) => query.sql.startsWith('UPDATE companies')));
  assert.ok(!shared.queries.some((query) => query.params.includes('someone-else@company.test')));

  const master = mockPool((sql) => {
    if (sql.startsWith('SELECT id, email')) return { rows: [{ id: 'u3', email: 'admin@company.test' }], rowCount: 1 };
    if (sql.includes('FROM staff_profiles') && sql.startsWith('SELECT id')) return { rows: [{ id: 's3', company_id: 'companysync_master_001' }], rowCount: 1 };
    if (sql.includes('FROM companies') && sql.startsWith('SELECT id')) return { rows: [{ id: 'companysync_master_001' }], rowCount: 1 };
    if (sql.startsWith('DELETE FROM')) return { rows: [], rowCount: 1 };
    if (sql.includes('COUNT(*)')) return { rows: [{ n: 0 }], rowCount: 1 };
    throw new Error('unexpected sql ' + sql);
  });
  const masterResult = await executeAccountDeletion(master, {
    sessionEmail: 'admin@company.test',
    confirmation: 'admin@company.test',
  });
  assert.strictEqual(masterResult.body.closed_own_tenant, false);
  assert.ok(!master.queries.some((query) => query.sql.startsWith('UPDATE companies')));
  assert.ok(PROTECTED_COMPANY_IDS.has('companysync_master_001'));

  const mismatch = mockPool(() => { throw new Error('should not query'); });
  const mismatchResult = await executeAccountDeletion(mismatch, {
    sessionEmail: 'owner@company.test',
    confirmation: 'victim@other.test',
  });
  assert.strictEqual(mismatchResult.status, 400);
  assert.strictEqual(mismatch.queries.length, 0);

  console.log('account deletion checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
