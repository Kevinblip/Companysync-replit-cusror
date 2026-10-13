'use strict';
// Isolated fixtures only: no database connections or paid-provider calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const { canBulkDelete, deleteBatch } = require('../lib/bulkDeletion.cjs');

const owner = { authenticated: true, email: 'owner@example.test', isSuperAdmin: false };
function fixture(records = [
  { id: 'a', company_id: 'own-company' }, { id: 'b', company_id: 'own-company' },
]) {
  const queries = [], deleted = [];
  const pool = {
    async query(sql, params = []) {
      queries.push(sql);
      if (sql.includes('FROM companies WHERE')) {
        return { rows: params[0] === 'own-company' && params[1] === owner.email ? [{ id: params[0] }] : [] };
      }
      if (sql.includes('FOR UPDATE')) {
        return { rows: records.filter(record => params[0].includes(record.id)) };
      }
      if (sql.startsWith('DELETE')) {
        deleted.push(...params[0]);
        return { rows: params[0].map(id => ({ id })) };
      }
      return { rows: [] };
    },
    async connect() { return { query: this.query.bind(this), release() {} }; },
  };
  return {
    pool, queries, deleted,
    options: {
      pool, ctx: owner, entityType: 'customers', table: 'customers', ids: records.map(record => record.id),
    },
  };
}

test('owner is permitted only for their own company, with normalized session email', async () => {
  const { pool } = fixture();
  assert.equal(await canBulkDelete(pool, { ...owner, email: ' OWNER@EXAMPLE.TEST ' }, 'own-company'), true);
  assert.equal(await canBulkDelete(pool, owner, 'other-company'), false);
});
test('ordinary administrators and staff, including tenant super-admin flags, are denied', async () => {
  for (const extra of [{ isAdministrator: true }, { role: 'admin' }, { isSuperAdmin: true, platformRole: 'user' }, {}]) {
    const f = fixture();
    const result = await deleteBatch({ ...f.options, ctx: { ...owner, email: 'staff@example.test', ...extra } });
    assert.equal(result.status, 403);
    assert.deepEqual(f.deleted, []);
  }
});
test('unauthenticated, impersonated, expired, and service-token callers are denied', async () => {
  for (const [ctx, status] of [
    [{ authenticated: false }, 401],
    [{ ...owner, isSuperAdmin: true, isImpersonating: true }, 403],
    [{ ...owner, impersonationExpired: true }, 401],
    [{ ...owner, isSuperAdmin: true, viaServiceToken: true }, 403],
  ]) {
    const f = fixture();
    assert.equal((await deleteBatch({ ...f.options, ctx })).status, status);
    assert.deepEqual(f.deleted, []);
  }
});
test('Super Admin can delete records across companies', async () => {
  const f = fixture([{ id: 'a', company_id: 'own-company' }, { id: 'b', company_id: 'other-company' }]);
  const result = await deleteBatch({ ...f.options, ctx: { ...owner, isSuperAdmin: true, platformRole: 'super_admin' } });
  assert.equal(result.status, 200);
  assert.equal(result.deleted_count, 2);
  assert.ok(f.queries.includes('COMMIT'));
});
test('legacy platform-master Super Admin is recognized', async () => {
  const { pool } = fixture();
  assert.equal(await canBulkDelete(pool, {
    ...owner, isSuperAdmin: true, allowedCompanyIds: new Set(['companysync_master_001']),
  }, 'other-company'), true);
});
test('mixed-company owner selection is rejected before any deletion', async () => {
  const f = fixture([{ id: 'a', company_id: 'own-company' }, { id: 'b', company_id: 'other-company' }]);
  assert.equal((await deleteBatch(f.options)).status, 403);
  assert.deepEqual(f.deleted, []);
  assert.ok(f.queries.includes('ROLLBACK'));
});
test('JSONB company metadata cannot override the SQL owner column', async () => {
  const f = fixture([{ id: 'a', company_id: 'other-company', data: { company_id: 'own-company' } }]);
  assert.equal((await deleteBatch(f.options)).status, 403);
  assert.deepEqual(f.deleted, []);
});
test('owner batch deduplicates IDs and commits', async () => {
  const f = fixture();
  const result = await deleteBatch({ ...f.options, ids: ['b', 'a', 'a'] });
  assert.deepEqual(result.deleted_ids, ['a', 'b']);
  assert.deepEqual(f.deleted, ['a', 'b']);
  assert.ok(f.queries.includes('COMMIT'));
});
test('bulk endpoint cannot bypass the specialized company deletion workflow', async () => {
  for (const ctx of [owner, { ...owner, isSuperAdmin: true, platformRole: 'super_admin' }]) {
    const f = fixture();
    assert.equal((await deleteBatch({ ...f.options, ctx, entityType: 'companies', table: 'companies' })).status, 403);
    assert.deepEqual(f.deleted, []);
  }
});
test('validation-only authorizes all IDs without deleting or committing', async () => {
  const f = fixture();
  const result = await deleteBatch({ ...f.options, validateOnly: true });
  assert.equal(result.allowed, true);
  assert.deepEqual(f.deleted, []);
  assert.ok(f.queries.includes('ROLLBACK'));
  assert.ok(!f.queries.includes('COMMIT'));
});
test('missing records reject the entire batch', async () => {
  const f = fixture();
  assert.equal((await deleteBatch({ ...f.options, ids: ['a', 'missing'] })).status, 404);
  assert.deepEqual(f.deleted, []);
});
test('invalid IDs are rejected without opening a transaction', async () => {
  for (const ids of [[], null, [''], [42], new Array(10001).fill('a')]) {
    const f = fixture();
    assert.equal((await deleteBatch({ ...f.options, ids })).status, 400);
    assert.deepEqual(f.queries, []);
  }
});
test('entity-specific guards remain enforced for bulk deletion', async () => {
  const f = fixture();
  assert.equal((await deleteBatch({ ...f.options, authorizeRecord: () => 'Protected settings' })).status, 403);
  assert.deepEqual(f.deleted, []);
});
test('delete errors roll back the transaction', async () => {
  const f = fixture();
  const query = f.pool.query.bind(f.pool);
  f.pool.query = async (sql, params) => {
    if (sql.startsWith('DELETE')) throw new Error('fixture failure');
    return query(sql, params);
  };
  await assert.rejects(deleteBatch(f.options), /fixture failure/);
  assert.ok(f.queries.includes('ROLLBACK'));
  assert.ok(!f.queries.includes('COMMIT'));
});
test('generic entity rows are locked with both ID and entity type', async () => {
  const f = fixture();
  assert.equal((await deleteBatch({ ...f.options, entityType: 'Document', table: 'generic_entities' })).status, 200);
  assert.ok(f.queries.some(sql => sql.includes('entity_type = $2 ORDER BY id FOR UPDATE')));
});
