#!/usr/bin/env node
/**
 * Impersonation Write-Block Smoke Test (end-to-end, live server)
 * ─────────────────────────────────────────────────────────────────
 * Proves that entity API mutations are blocked (HTTP 403) during an
 * active impersonation session and permitted again after the session ends.
 *
 * Test flow:
 *   1. Seed: super-admin user + signed session + target company + test Lead
 *   2. POST /api/impersonation/start  → 200 + session updated
 *   3. PUT  /api/local/entity/Lead/:id while impersonating → 403
 *   4. POST /api/local/entity/Lead    while impersonating → 403
 *   5. DELETE /api/local/entity/Lead/:id while impersonating → 403
 *   6. GET  /api/local/entity/Lead/:id while impersonating → 200 (reads OK)
 *   7. Verify record was NOT modified in DB
 *   8. POST /api/impersonation/stop   → 200
 *   9. PUT  /api/local/entity/Lead/:id after stop → 200 (writes restored)
 *  10. Verify record WAS modified in DB
 *
 * Prerequisites:
 *   - The app server must be running on PORT (default 5000) — `npm run dev`
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *
 * Usage:  node scripts/test-impersonation-write-block.cjs
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture IDs (prefix prevents collisions with real data) ──────────
const ADMIN_EMAIL   = 'smoke-impersonate-admin@example.com';
const ADMIN_UID     = 'smoke_impersonate_admin_user';
const ADMIN_SID     = 'smoke_impersonate_admin_session';
const TARGET_CO_ID  = 'smoke-impersonate-target-co';
const LEAD_ID       = 'smoke-impersonate-lead-001';

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`); failed++; }
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let d;
          try { d = JSON.parse(b); } catch { d = b; }
          resolve({ status: res.statusCode, data: d });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetchJson(`${BASE_URL}/api/auth/user`);
      if (r.status === 200 || r.status === 401) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function getLeadRow(id) {
  const { rows } = await pool.query('SELECT * FROM leads WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
}

async function getSessionRow(sid) {
  const { rows } = await pool.query('SELECT sess FROM sessions WHERE sid = $1', [sid]);
  return rows[0] ? (typeof rows[0].sess === 'string' ? JSON.parse(rows[0].sess) : rows[0].sess) : null;
}

async function cleanup() {
  await pool.query('DELETE FROM leads WHERE id = $1', [LEAD_ID]);
  await pool.query('DELETE FROM companies WHERE id = $1', [TARGET_CO_ID]);
  await pool.query('DELETE FROM impersonation_logs WHERE admin_email = $1', [ADMIN_EMAIL]);
  await pool.query('DELETE FROM sessions WHERE sid = $1', [ADMIN_SID]);
  await pool.query('DELETE FROM users WHERE id = $1', [ADMIN_UID]);
}

function makeCookie(sid) {
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

(async () => {
  if (!process.env.SESSION_SECRET) {
    console.error('[impersonation-write-block] SESSION_SECRET is not set — cannot forge a session. Aborting.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('[impersonation-write-block] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  console.log('\n[impersonation-write-block] Waiting for server…');
  if (!(await waitForServer())) {
    console.error(`[impersonation-write-block] Server at ${BASE_URL} did not respond within 60s. Is 'Start application' running?`);
    await pool.end();
    process.exit(1);
  }

  try {
    await cleanup(); // clean any leftover from a previous run

    // ── Seed ──────────────────────────────────────────────────────────────────
    // Super-admin user (platform_role = 'super_admin' makes isSuperAdmin=true)
    await pool.query(
      `INSERT INTO users (id, email, first_name, platform_role, created_at, updated_at)
       VALUES ($1, $2, 'SmokeAdmin', 'super_admin', NOW(), NOW())`,
      [ADMIN_UID, ADMIN_EMAIL]
    );

    // Forge a signed session for the super-admin
    const sess = {
      cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
      passport: { user: { claims: { email: ADMIN_EMAIL } } },
    };
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
      [ADMIN_SID, JSON.stringify(sess), new Date(Date.now() + 3600000)]
    );
    const Cookie = makeCookie(ADMIN_SID);

    // Target company (minimal — just needs to exist for impersonation start)
    await pool.query(
      `INSERT INTO companies (id, company_name, created_by, email, subscription_status, created_at, updated_at)
       VALUES ($1, 'Smoke Target Co', $2, $2, 'trial', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [TARGET_CO_ID, ADMIN_EMAIL]
    );

    // Test Lead in the target company (note=sentinel we can check for modification)
    await pool.query(
      `INSERT INTO leads (id, company_id, name, status, notes, created_at, updated_at)
       VALUES ($1, $2, 'WriteBlock TestLead', 'new', 'ORIGINAL_SENTINEL', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [LEAD_ID, TARGET_CO_ID]
    );

    // ── Step 1: Start impersonation ───────────────────────────────────────────
    console.log('\n[impersonation-write-block] Step 1: Start impersonation session');
    const startRes = await fetchJson(`${BASE_URL}/api/impersonation/start`, {
      method: 'POST',
      headers: { Cookie },
      body: { target_company_id: TARGET_CO_ID, target_company_name: 'Smoke Target Co', reason: 'Smoke test write-block' },
    });
    ok(`POST /api/impersonation/start → 200 (got ${startRes.status})`, startRes.status === 200);
    ok('Response has log_id', !!(startRes.data && startRes.data.log_id));
    ok('Response has expires_at', !!(startRes.data && startRes.data.expires_at));

    // Verify session was updated in DB
    const sessionAfterStart = await getSessionRow(ADMIN_SID);
    ok('Session has impersonating_company_id', sessionAfterStart?.impersonating_company_id === TARGET_CO_ID, sessionAfterStart?.impersonating_company_id);
    ok('Session has impersonation_expires_at', !!sessionAfterStart?.impersonation_expires_at);

    // ── Step 2: Write attempts must be blocked ────────────────────────────────
    console.log('\n[impersonation-write-block] Step 2: Entity write attempts must return 403');
    const putRes = await fetchJson(`${BASE_URL}/api/local/entity/Lead/${LEAD_ID}`, {
      method: 'PUT',
      headers: { Cookie },
      body: { notes: 'HACKED_BY_IMPERSONATION', status: 'won' },
    });
    ok(`PUT entity while impersonating → 403 (got ${putRes.status})`, putRes.status === 403, putRes.data);

    const postRes = await fetchJson(`${BASE_URL}/api/local/entity/Lead`, {
      method: 'POST',
      headers: { Cookie },
      body: { company_id: TARGET_CO_ID, name: 'New Lead via Impersonation' },
    });
    ok(`POST entity while impersonating → 403 (got ${postRes.status})`, postRes.status === 403, postRes.data);

    const delRes = await fetchJson(`${BASE_URL}/api/local/entity/Lead/${LEAD_ID}`, {
      method: 'DELETE',
      headers: { Cookie },
    });
    ok(`DELETE entity while impersonating → 403 (got ${delRes.status})`, delRes.status === 403, delRes.data);

    // ── Step 2b: Specialized /api/local/* mutation routes also blocked ────────
    // Proves the CENTRALIZED guard (not just per-entity guards) is working —
    // /api/local/auto-categorize is a POST that updates payment records and
    // lives entirely outside the entity match blocks.
    console.log('\n[impersonation-write-block] Step 2b: Specialized route writes must return 403');
    const autoCatRes = await fetchJson(`${BASE_URL}/api/local/auto-categorize`, {
      method: 'POST',
      headers: { Cookie },
      body: { company_id: TARGET_CO_ID },
    });
    ok(`POST /api/local/auto-categorize while impersonating → 403 (got ${autoCatRes.status})`,
      autoCatRes.status === 403, autoCatRes.data);

    // ── Step 3: Reads must still work ─────────────────────────────────────────
    console.log('\n[impersonation-write-block] Step 3: Reads must succeed during impersonation');
    const getRes = await fetchJson(`${BASE_URL}/api/local/entity/Lead/${LEAD_ID}`, {
      method: 'GET',
      headers: { Cookie },
    });
    ok(`GET entity while impersonating → 200 (got ${getRes.status})`, getRes.status === 200, getRes.data);

    // ── Step 4: Verify DB record is unmodified ────────────────────────────────
    console.log('\n[impersonation-write-block] Step 4: Verify record NOT modified in DB');
    const rowDuring = await getLeadRow(LEAD_ID);
    ok('Lead still exists in DB', !!rowDuring);
    ok('notes unchanged (PUT was blocked)', rowDuring?.notes === 'ORIGINAL_SENTINEL', rowDuring?.notes);
    ok('status unchanged (PUT was blocked)', rowDuring?.status === 'new', rowDuring?.status);

    // ── Step 5: Stop impersonation ────────────────────────────────────────────
    console.log('\n[impersonation-write-block] Step 5: Stop impersonation session');
    const stopRes = await fetchJson(`${BASE_URL}/api/impersonation/stop`, {
      method: 'POST',
      headers: { Cookie },
    });
    ok(`POST /api/impersonation/stop → 200 (got ${stopRes.status})`, stopRes.status === 200);

    // Verify session was cleaned up in DB
    const sessionAfterStop = await getSessionRow(ADMIN_SID);
    ok('Session no longer has impersonating_company_id', !sessionAfterStop?.impersonating_company_id, sessionAfterStop?.impersonating_company_id);
    ok('Session no longer has impersonation_expires_at', !sessionAfterStop?.impersonation_expires_at);

    // ── Step 6: Writes succeed again after stop ───────────────────────────────
    console.log('\n[impersonation-write-block] Step 6: Write succeeds after impersonation stops');
    const putAfterRes = await fetchJson(`${BASE_URL}/api/local/entity/Lead/${LEAD_ID}`, {
      method: 'PUT',
      headers: { Cookie },
      body: { notes: 'MODIFIED_AFTER_STOP' },
    });
    ok(`PUT entity after stop → 200 (got ${putAfterRes.status})`, putAfterRes.status === 200, putAfterRes.data);

    // Verify the modification actually landed in DB
    const rowAfter = await getLeadRow(LEAD_ID);
    ok('notes updated in DB after stop', rowAfter?.notes === 'MODIFIED_AFTER_STOP', rowAfter?.notes);

  } catch (e) {
    console.error('[impersonation-write-block] UNEXPECTED ERROR:', e);
    failed++;
  } finally {
    try { await cleanup(); } catch (e) { console.error('[impersonation-write-block] cleanup error:', e.message); }
    await pool.end();
  }

  console.log(`\n[impersonation-write-block] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
