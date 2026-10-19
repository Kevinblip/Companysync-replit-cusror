/**
 * scripts/test-staging-bootstrap-admin.cjs
 *
 * The staging admin bootstrap writes one local user and one staff admin,
 * and it stays quiet unless STAGING and all three bootstrap env vars are set.
 *
 * Run: node scripts/test-staging-bootstrap-admin.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bootstrap = require('../lib/stagingBootstrapAdmin.cjs');

const HASH = '$2a$10$0123456789012345678901abcdefghijklmnopqrstuvwxyz01234';
const EMAIL = 'yicnteam@gmail.com';
const COMPANY = 'yicn_roofing_001';

let passed = 0;
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

function env(overrides = {}) {
  return {
    STAGING: '1',
    STAGING_BOOTSTRAP_ADMIN_EMAIL: EMAIL,
    STAGING_BOOTSTRAP_ADMIN_HASH: HASH,
    STAGING_BOOTSTRAP_COMPANY_ID: COMPANY,
    STAGING_BOOTSTRAP_ADMIN_NAME: 'Kevin',
    ...overrides,
  };
}

function memoryPool() {
  const users = [];
  const staff = [];
  const queries = [];
  let usersHaveCompanyId = true;
  const pool = {
    queries,
    users,
    staff,
    setCompanyColumn(present) { usersHaveCompanyId = present; },
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, params });
      if (compact.includes('information_schema.columns')) {
        return { rows: usersHaveCompanyId ? [{ '?column?': 1 }] : [], rowCount: usersHaveCompanyId ? 1 : 0 };
      }
      if (compact.startsWith('SELECT id FROM users')) {
        const found = users.filter((row) => row.email.toLowerCase() === String(params[0]).toLowerCase());
        return { rows: found.slice(0, 1), rowCount: found.length ? 1 : 0 };
      }
      if (compact.startsWith('UPDATE users')) {
        const email = String(params[params.length - 1]).toLowerCase();
        const row = users.find((item) => item.email.toLowerCase() === email);
        if (row) {
          row.password_hash = params[0];
          row.is_local_auth = true;
          if (compact.includes('company_id')) row.company_id = params[1];
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      if (compact.startsWith('INSERT INTO users')) {
        const hasCompany = compact.includes('company_id');
        users.push({
          id: params[0],
          email: params[1],
          first_name: params[2],
          last_name: params[3],
          password_hash: params[4],
          is_local_auth: true,
          must_change_password: false,
          company_id: hasCompany ? params[5] : null,
        });
        return { rows: [], rowCount: 1 };
      }
      if (compact.startsWith('SELECT id FROM staff_profiles')) {
        const found = staff.filter((row) => row.company_id === params[0] && String(row.user_email || '').toLowerCase() === String(params[1]).toLowerCase());
        return { rows: found.slice(0, 1), rowCount: found.length ? 1 : 0 };
      }
      if (compact.startsWith('UPDATE staff_profiles')) {
        const row = staff.find((item) => item.id === params[3] && item.company_id === params[4]);
        if (row) {
          row.email = params[0];
          row.user_email = params[1];
          row.full_name = params[2];
          row.name = params[2];
          row.is_active = true;
          row.is_administrator = true;
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      if (compact.startsWith('INSERT INTO staff_profiles')) {
        staff.push({
          id: params[0],
          company_id: params[1],
          name: params[2],
          full_name: params[2],
          email: params[3],
          user_email: params[3],
          role: 'admin',
          is_administrator: true,
          is_super_admin: false,
          is_active: true,
        });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected sql: ${compact}`);
    },
  };
  return pool;
}

function captureLog() {
  const lines = [];
  return {
    lines,
    log(...args) { lines.push(args.map(String).join(' ')); },
    warn(...args) { lines.push(args.map(String).join(' ')); },
  };
}

check('a missing staging flag does nothing', async () => {
  const pool = memoryPool();
  const log = captureLog();
  const result = await bootstrap.ensureStagingBootstrapAdmin(pool, env({ STAGING: '' }), log);
  assert.strictEqual(result.ran, false);
  assert.strictEqual(pool.queries.length, 0);
  assert.strictEqual(log.lines.length, 0);
});

check('STAGING=false does nothing', async () => {
  const pool = memoryPool();
  const result = await bootstrap.ensureStagingBootstrapAdmin(pool, env({ STAGING: 'false' }), captureLog());
  assert.strictEqual(result.ran, false);
  assert.strictEqual(pool.queries.length, 0);
});

check('a missing hash, email, or company does nothing', async () => {
  for (const key of ['STAGING_BOOTSTRAP_ADMIN_EMAIL', 'STAGING_BOOTSTRAP_ADMIN_HASH', 'STAGING_BOOTSTRAP_COMPANY_ID']) {
    const pool = memoryPool();
    const result = await bootstrap.ensureStagingBootstrapAdmin(pool, env({ [key]: '  ' }), captureLog());
    assert.strictEqual(result.ran, false, key);
    assert.strictEqual(pool.queries.length, 0, key);
  }
});

check('a non-bcrypt hash is skipped and never logged', async () => {
  const pool = memoryPool();
  const log = captureLog();
  const secret = 'plaintext-password';
  const result = await bootstrap.ensureStagingBootstrapAdmin(pool, env({ STAGING_BOOTSTRAP_ADMIN_HASH: secret }), log);
  assert.strictEqual(result.ran, false);
  assert.strictEqual(pool.queries.length, 0);
  assert.ok(log.lines.some((line) => line.includes('not a bcrypt hash')));
  assert.ok(!log.lines.join('\n').includes(secret));
});

check('the first run inserts a local user and one admin staff row', async () => {
  const pool = memoryPool();
  const log = captureLog();
  const result = await bootstrap.ensureStagingBootstrapAdmin(pool, env({ STAGING_BOOTSTRAP_ADMIN_NAME: 'Kevin Stone' }), log);
  assert.strictEqual(result.ran, true);
  assert.strictEqual(pool.users.length, 1);
  assert.strictEqual(pool.users[0].email, EMAIL);
  assert.strictEqual(pool.users[0].password_hash, HASH);
  assert.strictEqual(pool.users[0].is_local_auth, true);
  assert.strictEqual(pool.users[0].must_change_password, false);
  assert.strictEqual(pool.users[0].company_id, COMPANY);
  assert.strictEqual(pool.users[0].first_name, 'Kevin');
  assert.strictEqual(pool.users[0].last_name, 'Stone');
  assert.strictEqual(pool.staff.length, 1);
  assert.strictEqual(pool.staff[0].company_id, COMPANY);
  assert.strictEqual(pool.staff[0].user_email, EMAIL);
  assert.strictEqual(pool.staff[0].email, EMAIL);
  assert.strictEqual(pool.staff[0].full_name, 'Kevin Stone');
  assert.strictEqual(pool.staff[0].is_active, true);
  assert.strictEqual(pool.staff[0].is_administrator, true);
  assert.strictEqual(pool.staff[0].is_super_admin, false);
  assert.deepStrictEqual(log.lines, [`[staging-bootstrap] admin ensured for ${EMAIL}`]);
  assert.ok(!log.lines.join('\n').includes(HASH));
});

check('a second run updates the same rows', async () => {
  const pool = memoryPool();
  await bootstrap.ensureStagingBootstrapAdmin(pool, env(), captureLog());
  const userId = pool.users[0].id;
  const staffId = pool.staff[0].id;
  pool.users[0].password_hash = 'old';
  pool.users[0].is_local_auth = false;
  pool.staff[0].is_administrator = false;
  pool.staff[0].is_active = false;
  const nextHash = '$2b$12$0123456789012345678901abcdefghijklmnopqrstuvwxyz01234';
  const log = captureLog();
  const result = await bootstrap.ensureStagingBootstrapAdmin(pool, env({ STAGING_BOOTSTRAP_ADMIN_HASH: nextHash }), log);
  assert.strictEqual(result.ran, true);
  assert.strictEqual(pool.users.length, 1);
  assert.strictEqual(pool.staff.length, 1);
  assert.strictEqual(pool.users[0].id, userId);
  assert.strictEqual(pool.staff[0].id, staffId);
  assert.strictEqual(pool.users[0].password_hash, nextHash);
  assert.strictEqual(pool.users[0].is_local_auth, true);
  assert.strictEqual(pool.users[0].company_id, COMPANY);
  assert.strictEqual(pool.staff[0].is_administrator, true);
  assert.strictEqual(pool.staff[0].is_active, true);
  assert.strictEqual(pool.staff[0].user_email, EMAIL);
  assert.ok(!log.lines.join('\n').includes(nextHash));
});

check('an existing mixed-case user is updated instead of inserted', async () => {
  const pool = memoryPool();
  pool.users.push({
    id: 'google_1',
    email: 'YicnTeam@gmail.com',
    first_name: 'Kevin',
    last_name: '',
    password_hash: null,
    is_local_auth: false,
    company_id: null,
  });
  await bootstrap.ensureStagingBootstrapAdmin(pool, env(), captureLog());
  assert.strictEqual(pool.users.length, 1);
  assert.strictEqual(pool.users[0].id, 'google_1');
  assert.strictEqual(pool.users[0].password_hash, HASH);
  assert.strictEqual(pool.users[0].is_local_auth, true);
  assert.strictEqual(pool.users[0].company_id, COMPANY);
});

check('company_id is left off the user write when the column is absent', async () => {
  const pool = memoryPool();
  pool.setCompanyColumn(false);
  await bootstrap.ensureStagingBootstrapAdmin(pool, env(), captureLog());
  const userWrite = pool.queries.find((query) => query.sql.startsWith('INSERT INTO users') || query.sql.startsWith('UPDATE users'));
  assert.ok(userWrite);
  assert.ok(!userWrite.sql.includes('company_id'));
  assert.strictEqual(pool.users[0].company_id, null);
  assert.strictEqual(pool.staff[0].company_id, COMPANY);
});

check('a database error is logged without the hash and does not throw', async () => {
  const log = captureLog();
  const pool = {
    async query() { throw new Error(`duplicate ${HASH}`); },
  };
  const result = await bootstrap.ensureStagingBootstrapAdmin(pool, env(), log);
  assert.strictEqual(result.ran, false);
  assert.ok(log.lines[0].includes('[staging-bootstrap] failed:'));
  assert.ok(log.lines[0].includes('[redacted]'));
  assert.ok(!log.lines.join('\n').includes(HASH));
});

check('the default name is Kevin', async () => {
  const pool = memoryPool();
  const settings = env();
  delete settings.STAGING_BOOTSTRAP_ADMIN_NAME;
  await bootstrap.ensureStagingBootstrapAdmin(pool, settings, captureLog());
  assert.strictEqual(pool.users[0].first_name, 'Kevin');
  assert.strictEqual(pool.users[0].last_name, '');
  assert.strictEqual(pool.staff[0].full_name, 'Kevin');
});

check('prod-server runs the bootstrap after database init and before the staging rewrite skip', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'prod-server.cjs'), 'utf8');
  const initAt = src.indexOf("console.log('[Production] Local database ready')");
  const callAt = src.indexOf('ensureStagingBootstrapAdmin');
  const skipAt = src.indexOf("console.log('[staging] startup rewrites skipped')");
  assert.ok(initAt > 0 && callAt > initAt && skipAt > callAt);
  assert.ok(src.includes("require('./lib/stagingBootstrapAdmin.cjs')"));
});

(async () => {
  console.log('\nStaging admin bootstrap\n');
  for (const { name, fn } of checks) {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}\n    ${err.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${checks.length} checks passed.`);
  if (process.exitCode) console.error('FAILED\n'); else console.log('OK\n');
})();
