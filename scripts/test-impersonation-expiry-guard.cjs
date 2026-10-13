#!/usr/bin/env node
/**
 * Impersonation Expiry-Guard & Double-Start Smoke Test
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies two security properties:
 *
 *  A) Double-start protection
 *     /api/impersonation/start must return 409 when the calling admin
 *     already has an active (non-expired) session.
 *
 *  B) Expiry-guard write-block
 *     A write request carrying a session whose impersonation_expires_at is
 *     in the past must be rejected with 401 — even if the impersonation
 *     session was otherwise valid when it was created.
 *
 * How it works
 * ────────────
 * The test mints minimal DB rows directly via pg so it can control
 * timestamps precisely without waiting 30 minutes:
 *   • sessions table  — signed connect.sid cookie (HMAC-SHA256 via SESSION_SECRET)
 *   • impersonation_logs table — active row with a controlled expires_at
 *
 * After each scenario the inserted rows are cleaned up.
 *
 * Usage: node scripts/test-impersonation-expiry-guard.cjs
 * Requires: DATABASE_URL and SESSION_SECRET env vars (loaded from .env by dotenv)
 *           and a running dev server (npm run dev) reachable at BASE_URL.
 */

'use strict';

const http  = require('http');
const https = require('https');
const crypto = require('crypto');

// Load .env so DATABASE_URL / SESSION_SECRET are available when running locally
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const { createPool } = require('./lib/db-pool.cjs');

const BASE_URL    = process.env.BASE_URL     || 'http://localhost:5000';
const DB_URL      = process.env.DATABASE_URL;
const SID_SECRET  = process.env.SESSION_SECRET;
const TIMEOUT_MS  = 8000;

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else       { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

function skip(name, reason) {
  console.log(`  ⊘ ${name} [SKIPPED: ${reason}]`);
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url     = new URL(path, BASE_URL);
    const lib     = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : undefined;
    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...extraHeaders,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Session minting ─────────────────────────────────────────────────────────
// Matches the HMAC-SHA256 signing used by express-session + connect-session-pg.

function signSid(sid, secret) {
  const hmac = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return `s:${sid}.${hmac}`;
}

async function mintSession(pool, sessData, expiresInMs = 60 * 60 * 1000) {
  const sid       = crypto.randomUUID();
  const expireAt  = new Date(Date.now() + expiresInMs);
  const sessJson  = JSON.stringify(sessData);
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)`,
    [sid, sessJson, expireAt]
  );
  return { sid, cookie: `connect.sid=${encodeURIComponent(signSid(sid, SID_SECRET))}` };
}

async function cleanupSession(pool, sid) {
  await pool.query('DELETE FROM sessions WHERE sid = $1', [sid]).catch(() => {});
}

async function cleanupImpersonationLog(pool, logId) {
  await pool.query('DELETE FROM impersonation_logs WHERE id = $1', [logId]).catch(() => {});
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Impersonation Expiry-Guard & Double-Start Test ===\n');
  console.log(`Target: ${BASE_URL}\n`);

  // ── Group 1: Server reachability ────────────────────────────────────────
  console.log('Group 1: Server reachability');
  try {
    const res = await request('GET', '/api/auth/user');
    ok('Server is responding', res.status < 500, `HTTP ${res.status}`);
  } catch (err) {
    ok('Server is responding', false, err.message);
    console.log('\n⚠  Server not reachable — skipping remaining tests.\n');
    console.log(`Total: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // ── Group 2: Unauthenticated baseline ───────────────────────────────────
  console.log('\nGroup 2: Unauthenticated baseline');
  {
    const res = await request('POST', '/api/impersonation/start', {
      target_company_id: 'fake-co', reason: 'test'
    });
    ok('POST /api/impersonation/start without auth returns 401 or 403',
       res.status === 401 || res.status === 403,
       `got HTTP ${res.status}`);
  }

  // ── Groups 3 & 4 need DB access ─────────────────────────────────────────
  if (!DB_URL || !SID_SECRET) {
    skip('Group 3 — Expiry-guard write-block', 'DATABASE_URL or SESSION_SECRET not set');
    skip('Group 4 — Double-start protection (409)', 'DATABASE_URL or SESSION_SECRET not set');
    console.log('\n⚠  Set DATABASE_URL and SESSION_SECRET to run DB-level tests.\n');
    console.log(`Total: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  }

  const pool = createPool({ connectionString: DB_URL, max: 3 });

  // ── Group 3: Expiry-guard write-block ───────────────────────────────────
  // Mint a session whose impersonation_expires_at is 2 minutes IN THE PAST.
  // The server's resolveRequestContext must detect this and return 401 for
  // any subsequent entity write.
  console.log('\nGroup 3: Expiry-guard write-block');

  const FAKE_COMPANY_ID = 'test-tenant-expiry-guard-001';
  const FAKE_LOG_ID     = crypto.randomUUID();
  const expiredAt       = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago

  let expiredSid = null;
  try {
    // Build a minimal sess that looks like a logged-in super-admin with
    // an already-expired impersonation session.
    // express-session requires a `cookie` key or createSession() throws on
    // "Cannot read properties of undefined (reading 'expires')".
    const sessData = {
      cookie: { originalMaxAge: null, expires: null, httpOnly: true, path: '/' },
      passport: {
        user: {
          email: 'test-superadmin@test.internal',
          claims: { email: 'test-superadmin@test.internal' },
        }
      },
      impersonating_company_id: FAKE_COMPANY_ID,
      impersonation_expires_at: expiredAt,
      impersonation_log_id:     FAKE_LOG_ID,
    };

    // Insert a matching impersonation_logs row so the cleanup UPDATE fires.
    await pool.query(
      `INSERT INTO impersonation_logs (id, admin_email, target_company_id, target_company_name, reason, is_active, expires_at)
       VALUES ($1, $2, $3, 'Test Tenant', 'Expiry guard smoke test', true, $4)
       ON CONFLICT DO NOTHING`,
      [FAKE_LOG_ID, 'test-superadmin@test.internal', FAKE_COMPANY_ID, new Date(Date.now() - 2 * 60 * 1000)]
    );

    const minted = await mintSession(pool, sessData);
    expiredSid = minted.sid;

    // Attempt a write (POST new entity) using the expired-impersonation cookie.
    const writeRes = await request(
      'POST',
      '/api/local/entity/Lead',
      { name: 'Expiry Test Lead', company_id: FAKE_COMPANY_ID },
      { Cookie: minted.cookie }
    );

    ok(
      'Write with expired impersonation session returns 401',
      writeRes.status === 401,
      `got HTTP ${writeRes.status} — body: ${JSON.stringify(writeRes.body).slice(0, 120)}`
    );

    const msg = (typeof writeRes.body === 'object' ? writeRes.body.error : writeRes.body) || '';
    ok(
      'Response mentions expiry',
      typeof msg === 'string' && msg.toLowerCase().includes('expir'),
      `message was: "${msg}"`
    );

    // Verify the server auto-closed the log row (fire-and-forget UPDATE in tenantGuard).
    // Give it up to 2 s for the setImmediate to commit.
    await new Promise(r => setTimeout(r, 500));
    const logRow = await pool.query(
      'SELECT is_active FROM impersonation_logs WHERE id = $1', [FAKE_LOG_ID]
    );
    ok(
      'Expired log row was auto-closed (is_active = false)',
      logRow.rows.length > 0 && logRow.rows[0].is_active === false,
      `is_active = ${logRow.rows[0]?.is_active}`
    );

    // Verify the session was stripped of impersonation keys.
    await new Promise(r => setTimeout(r, 500));
    const sessRow = await pool.query('SELECT sess FROM sessions WHERE sid = $1', [expiredSid]);
    const strippedSess = sessRow.rows[0]?.sess || {};
    ok(
      'Expired session had impersonation keys stripped',
      !strippedSess.impersonating_company_id && !strippedSess.impersonation_expires_at,
      `keys present: ${Object.keys(strippedSess).filter(k => k.startsWith('impersonat')).join(', ') || 'none'}`
    );

  } catch (err) {
    ok('Group 3 setup succeeded', false, err.message);
    console.error(err);
  } finally {
    if (expiredSid) await cleanupSession(pool, expiredSid);
    await cleanupImpersonationLog(pool, FAKE_LOG_ID);
  }

  // ── Group 4: Double-start protection ────────────────────────────────────
  // Mint a valid (future-expiring) impersonation session + log row.
  // Then call /api/impersonation/start again from the same admin — must get 409.
  console.log('\nGroup 4: Double-start protection');

  const DS_LOG_ID     = crypto.randomUUID();
  const DS_COMPANY_ID = 'test-tenant-double-start-001';
  const activeExpiry  = new Date(Date.now() + 25 * 60 * 1000); // 25 min from now

  let dsSid = null;
  try {
    // Insert an active impersonation_logs row for this admin.
    await pool.query(
      `INSERT INTO impersonation_logs (id, admin_email, target_company_id, target_company_name, reason, is_active, expires_at)
       VALUES ($1, $2, $3, 'Double-Start Tenant', 'Double-start smoke test', true, $4)
       ON CONFLICT DO NOTHING`,
      [DS_LOG_ID, 'test-superadmin@test.internal', DS_COMPANY_ID, activeExpiry]
    );

    // Mint a valid session for the same super-admin.
    const sessData = {
      cookie: { originalMaxAge: null, expires: null, httpOnly: true, path: '/' },
      passport: {
        user: {
          email: 'test-superadmin@test.internal',
          claims: { email: 'test-superadmin@test.internal' },
        }
      },
      impersonating_company_id: DS_COMPANY_ID,
      impersonation_expires_at: activeExpiry.toISOString(),
      impersonation_log_id:     DS_LOG_ID,
    };
    const minted = await mintSession(pool, sessData);
    dsSid = minted.sid;

    // Also need to make sure the user exists in the users table with super_admin role.
    // The resolveRequestContext checks platform_role=super_admin.
    await pool.query(
      `INSERT INTO users (id, email, platform_role) VALUES ($1, $2, 'super_admin')
       ON CONFLICT (email) DO UPDATE SET platform_role = 'super_admin'`,
      [crypto.randomUUID(), 'test-superadmin@test.internal']
    );

    // Attempt a second /start for a DIFFERENT target company.
    const startRes = await request(
      'POST',
      '/api/impersonation/start',
      { target_company_id: 'another-company-999', target_company_name: 'Another Co', reason: 'Second start attempt' },
      { Cookie: minted.cookie }
    );

    ok(
      'Second /start with active session returns 409 Conflict',
      startRes.status === 409,
      `got HTTP ${startRes.status} — body: ${JSON.stringify(startRes.body).slice(0, 160)}`
    );

    const errMsg = (typeof startRes.body === 'object' ? startRes.body.error : startRes.body) || '';
    ok(
      '409 response mentions the active company name',
      typeof errMsg === 'string' && (errMsg.includes('Double-Start Tenant') || errMsg.includes('active session')),
      `message was: "${errMsg}"`
    );

  } catch (err) {
    ok('Group 4 setup succeeded', false, err.message);
    console.error(err);
  } finally {
    if (dsSid) await cleanupSession(pool, dsSid);
    await cleanupImpersonationLog(pool, DS_LOG_ID);
    // Clean up test user if we inserted it
    await pool.query(`DELETE FROM users WHERE email = 'test-superadmin@test.internal'`).catch(() => {});
  }

  // ── Group 5: Parallel double-start race ─────────────────────────────────
  // Fire two simultaneous /start requests from the same admin session.
  // Exactly one must succeed (200) and one must be rejected (409).
  // Only one active log row must exist in the DB afterwards.
  // This catches the SELECT-then-INSERT race that a serialized test cannot.
  console.log('\nGroup 5: Parallel double-start race');

  const RACE_LOG_PREFIX = 'test-race-';
  const RACE_COMPANY_A  = 'test-tenant-race-001';
  const RACE_COMPANY_B  = 'test-tenant-race-002';

  let raceSid = null;
  try {
    // Ensure the user exists as super_admin (may already exist from Group 4)
    await pool.query(
      `INSERT INTO users (id, email, platform_role) VALUES ($1, $2, 'super_admin')
       ON CONFLICT (email) DO UPDATE SET platform_role = 'super_admin'`,
      [crypto.randomUUID(), 'test-superadmin@test.internal']
    );

    // Mint a fresh session with NO impersonation data (clean start state)
    const raceSessData = {
      cookie: { originalMaxAge: null, expires: null, httpOnly: true, path: '/' },
      passport: {
        user: {
          email: 'test-superadmin@test.internal',
          claims: { email: 'test-superadmin@test.internal' },
        }
      },
    };
    const raceMinted = await mintSession(pool, raceSessData);
    raceSid = raceMinted.sid;

    // Fire both requests at the same time
    const [r1, r2] = await Promise.all([
      request('POST', '/api/impersonation/start',
        { target_company_id: RACE_COMPANY_A, target_company_name: 'Race Tenant A', reason: 'Race test 1' },
        { Cookie: raceMinted.cookie }
      ),
      request('POST', '/api/impersonation/start',
        { target_company_id: RACE_COMPANY_B, target_company_name: 'Race Tenant B', reason: 'Race test 2' },
        { Cookie: raceMinted.cookie }
      ),
    ]);

    const statuses = [r1.status, r2.status].sort();
    ok(
      'Exactly one parallel /start succeeds (200) and one is rejected (409)',
      statuses[0] === 200 && statuses[1] === 409,
      `got HTTP ${r1.status} and ${r2.status}`
    );

    // Count active rows for this admin — must be exactly 1
    const activeRows = await pool.query(
      `SELECT id, target_company_id FROM impersonation_logs
       WHERE admin_email = $1 AND is_active = true AND expires_at > NOW()`,
      ['test-superadmin@test.internal']
    );
    ok(
      'Exactly one active impersonation log row exists after race',
      activeRows.rows.length === 1,
      `found ${activeRows.rows.length} active rows: ${activeRows.rows.map(r => r.target_company_id).join(', ')}`
    );

    // Clean up all race log rows
    await pool.query(
      `UPDATE impersonation_logs SET is_active = false, ended_at = NOW()
       WHERE admin_email = $1 AND (target_company_id = $2 OR target_company_id = $3)`,
      ['test-superadmin@test.internal', RACE_COMPANY_A, RACE_COMPANY_B]
    );

  } catch (err) {
    ok('Group 5 setup succeeded', false, err.message);
    console.error(err);
  } finally {
    if (raceSid) await cleanupSession(pool, raceSid);
    await pool.query(
      `DELETE FROM impersonation_logs
       WHERE admin_email = 'test-superadmin@test.internal'
         AND (target_company_id = $1 OR target_company_id = $2)`,
      [RACE_COMPANY_A, RACE_COMPANY_B]
    ).catch(() => {});
    await pool.query(`DELETE FROM users WHERE email = 'test-superadmin@test.internal'`).catch(() => {});
  }

  await pool.end();

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\nTotal: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\n[FATAL]', err.message);
  process.exit(1);
});
