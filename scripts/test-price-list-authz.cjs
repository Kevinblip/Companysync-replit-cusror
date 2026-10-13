#!/usr/bin/env node
/**
 * Price-list cross-tenant authz regression test (end-to-end, live server)
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies that `bulkImportPriceList` enforces session-based authorization
 * and never trusts a client-supplied company_id, preventing cross-tenant
 * data overwrites.
 *
 * Scenarios:
 *   1. No session → Authentication required (HTTP 500)
 *   2. Valid session + caller's own company_id → success (HTTP 200)
 *   3. Valid session + a DIFFERENT company's id → Access denied (HTTP 500)
 *
 * Prerequisites:
 *   - The app server must be running on PORT (default 5000) — `npm run dev`
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *
 * Usage:  node scripts/test-price-list-authz.cjs
 *
 * Fixture IDs use a stable "smoke_pla_" prefix; the script cleans up after
 * itself (even on failure) so repeated runs never accumulate test data.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

// ── Fixture identifiers ────────────────────────────────────────────────────
const OWNER_A_EMAIL = 'smoke-pla-owner-a@example.com';
const OWNER_A_UID   = 'smoke_pla_owner_a_user';
const OWNER_A_SID   = 'smoke_pla_owner_a_session';

const OWNER_B_EMAIL = 'smoke-pla-owner-b@example.com';
const OWNER_B_UID   = 'smoke_pla_owner_b_user';
const OWNER_B_SID   = 'smoke_pla_owner_b_session';

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.log(`  \u2717 ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`);
    failed++;
  }
}

// ── HTTP helper ────────────────────────────────────────────────────────────
function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
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
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

// ── Session forging (mirrors local-auth signSessionId) ────────────────────
function forgeSessionCookie(sid) {
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

// ── Server readiness probe ─────────────────────────────────────────────────
async function waitForServer(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetchJson(`${BASE_URL}/api/local/entity/Company?limit=1`);
      if (r.status) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// ── Seed helpers ───────────────────────────────────────────────────────────
async function seedUser(uid, email) {
  await pool.query(
    `INSERT INTO users (id, email, first_name, created_at, updated_at)
     VALUES ($1, $2, 'SmokePLA', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [uid, email]
  );
}

async function seedSession(email, sid) {
  const sess = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email } } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
    [sid, JSON.stringify(sess), new Date(Date.now() + 3600000)]
  );
  return forgeSessionCookie(sid);
}

// ── Cleanup ────────────────────────────────────────────────────────────────
async function cleanup(companyAId, companyBId) {
  // Remove test PriceListItems from both companies
  for (const cid of [companyAId, companyBId]) {
    if (cid) {
      await pool.query(
        `DELETE FROM generic_entities
         WHERE entity_type = 'PriceListItem' AND company_id = $1 AND data->>'source' = 'smoke_pla_test'`,
        [cid]
      ).catch(() => {});
    }
  }
  // Remove test companies
  for (const email of [OWNER_A_EMAIL, OWNER_B_EMAIL]) {
    const { rows } = await pool.query(
      `SELECT id FROM companies WHERE LOWER(created_by) = $1`,
      [email]
    ).catch(() => ({ rows: [] }));
    for (const r of rows) {
      await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [r.id]).catch(() => {});
    }
    await pool.query(`DELETE FROM companies WHERE LOWER(created_by) = $1`, [email]).catch(() => {});
  }
  // Remove test users and sessions
  await pool.query(
    `DELETE FROM users WHERE id IN ($1, $2) OR LOWER(email) IN ($3, $4)`,
    [OWNER_A_UID, OWNER_B_UID, OWNER_A_EMAIL, OWNER_B_EMAIL]
  ).catch(() => {});
  await pool.query(
    `DELETE FROM sessions WHERE sid IN ($1, $2)`,
    [OWNER_A_SID, OWNER_B_SID]
  ).catch(() => {});
}

// ── Invoke bulkImportPriceList via the functions endpoint ──────────────────
function invokeBulkImport(companyId, cookieHeader) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookieHeader) headers['Cookie'] = cookieHeader;
  return fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    headers,
    body: {
      functionName: 'bulkImportPriceList',
      params: {
        company_id: companyId,
        source: 'smoke_pla_test',
        merge: false,
        items: [
          { code: 'PLT-001', description: 'Smoke test shingle', unit: 'SQ', unit_price: 95, source: 'smoke_pla_test' },
        ],
      },
    },
  });
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  if (!process.env.SESSION_SECRET) {
    console.error('[pla] SESSION_SECRET is not set — cannot forge a session. Aborting.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('[pla] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  console.log('\n[test-price-list-authz] starting...\n');

  if (!(await waitForServer())) {
    console.error(
      `[pla] Server at ${BASE_URL} did not respond within 60s. Is 'Start application' running?`
    );
    await pool.end();
    process.exit(1);
  }

  let companyAId = null;
  let companyBId = null;

  try {
    // Seed users and sessions
    await seedUser(OWNER_A_UID, OWNER_A_EMAIL);
    await seedUser(OWNER_B_UID, OWNER_B_EMAIL);
    const cookieA = await seedSession(OWNER_A_EMAIL, OWNER_A_SID);
    const cookieB = await seedSession(OWNER_B_EMAIL, OWNER_B_SID);

    // Create company A (owned by owner A)
    const coA = await fetchJson(`${BASE_URL}/api/local/entity/Company`, {
      method: 'POST',
      headers: { Cookie: cookieA },
      body: {
        company_name: 'Smoke PLA Roofing A',
        email: OWNER_A_EMAIL,
      },
    });
    ok(`Company A created (got ${coA.status})`, coA.status === 201 || coA.status === 200);
    companyAId = coA.data?.id;
    ok('Company A has an id', !!companyAId);
    if (!companyAId) throw new Error('No company A id — cannot continue');

    // Create company B (owned by owner B)
    const coB = await fetchJson(`${BASE_URL}/api/local/entity/Company`, {
      method: 'POST',
      headers: { Cookie: cookieB },
      body: {
        company_name: 'Smoke PLA Roofing B',
        email: OWNER_B_EMAIL,
      },
    });
    ok(`Company B created (got ${coB.status})`, coB.status === 201 || coB.status === 200);
    companyBId = coB.data?.id;
    ok('Company B has an id', !!companyBId);
    if (!companyBId) throw new Error('No company B id — cannot continue');

    // ─────────────────────────────────────────────────────────────────────
    // Scenario 1: No session → Authentication required
    // ─────────────────────────────────────────────────────────────────────
    console.log('[pla] Scenario 1: no session → must be rejected');
    const s1 = await invokeBulkImport(companyAId, null);
    ok(
      `no session → error contains "Authentication required" (got status ${s1.status})`,
      s1.status !== 200 && typeof s1.data?.error === 'string' && s1.data.error.toLowerCase().includes('authentication'),
      s1.data
    );

    // ─────────────────────────────────────────────────────────────────────
    // Scenario 2: Valid session + caller's own company_id → success
    // ─────────────────────────────────────────────────────────────────────
    console.log('[pla] Scenario 2: valid session + own company_id → must succeed');
    const s2 = await invokeBulkImport(companyAId, cookieA);
    ok(
      `own-company import → HTTP 200 (got ${s2.status})`,
      s2.status === 200,
      s2.data
    );
    ok(
      'own-company import → no error field',
      s2.status === 200 && !s2.data?.error,
      s2.data?.error
    );

    // Confirm data was actually written to the correct company
    const { rows: ownItems } = await pool.query(
      `SELECT id FROM generic_entities
       WHERE entity_type = 'PriceListItem' AND company_id = $1 AND data->>'source' = 'smoke_pla_test'`,
      [companyAId]
    );
    ok('own-company import → item written to company A in DB', ownItems.length > 0, ownItems.length);

    // ─────────────────────────────────────────────────────────────────────
    // Scenario 3: Valid session + a DIFFERENT company's id → Access denied
    // ─────────────────────────────────────────────────────────────────────
    console.log('[pla] Scenario 3: valid session for company A + company B id → must be rejected');
    const s3 = await invokeBulkImport(companyBId, cookieA);
    ok(
      `cross-company import → not HTTP 200 (got ${s3.status})`,
      s3.status !== 200,
      s3.data
    );
    ok(
      `cross-company import → error contains "Access denied" (got: ${JSON.stringify(s3.data?.error)})`,
      typeof s3.data?.error === 'string' && s3.data.error.toLowerCase().includes('access denied'),
      s3.data
    );

    // Confirm no data was written to company B
    const { rows: crossItems } = await pool.query(
      `SELECT id FROM generic_entities
       WHERE entity_type = 'PriceListItem' AND company_id = $1 AND data->>'source' = 'smoke_pla_test'`,
      [companyBId]
    );
    ok('cross-company import → no items written to company B in DB', crossItems.length === 0, crossItems.length);

  } catch (e) {
    console.error('[pla] FATAL:', e.message);
    failed++;
  } finally {
    try { await cleanup(companyAId, companyBId); } catch (e) { console.warn('[pla] cleanup error:', e.message); }
    await pool.end();
  }

  console.log(`\n[test-price-list-authz] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
