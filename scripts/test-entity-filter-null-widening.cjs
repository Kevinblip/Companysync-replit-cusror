#!/usr/bin/env node
/**
 * Entity-filter "null" widening regression test (end-to-end, live server)
 * ─────────────────────────────────────────────────────────────────────────
 * A contact field saved as the literal text "null" (String(null) written
 * straight into the column) used to be indistinguishable, on the wire, from a
 * real SQL null: the SDK sends `?customer_email=null`, and the server did a
 * blanket JSON.parse on every query-string value. `JSON.parse('null')` is
 * `null`, and the filter builders turn a null value into
 * `(col IS NULL OR col = '')` — so one lead whose email was the string "null"
 * pulled back EVERY estimate in the company that had a blank email (227 rows
 * on a single lead profile).
 *
 * This asserts:
 *   1. `customer_email=null` matches only rows whose value is literally "null"
 *      — it must NOT return blank-email rows.
 *   2. A normal scalar filter still matches exactly.
 *   3. Operator objects ({"$contains":...}) still parse and work.
 *
 * Prerequisites:
 *   - The app server must be running on PORT (default 5000) — `npm run dev`
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *
 * Usage:  node scripts/test-entity-filter-null-widening.cjs
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const OWNER_EMAIL = 'smoke-enw-owner@example.com';
const OWNER_UID = 'smoke_enw_owner_user';
const OWNER_SID = 'smoke_enw_owner_session';

const EST_BLANK = 'smoke_enw_est_blank';
const EST_LITERAL_NULL = 'smoke_enw_est_literal_null';
const EST_REAL = 'smoke_enw_est_real';
const REAL_EMAIL = 'smoke-enw-real@example.com';

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
          let data = null;
          try { data = JSON.parse(b); } catch { data = b; }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

// Mirrors local-auth signSessionId
function forgeSessionCookie(sid) {
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

async function waitForServer(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetchJson(`${BASE_URL}/api/local/entity/Company?_limit=1`);
      if (r.status) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function seedUser() {
  await pool.query(
    `INSERT INTO users (id, email, first_name, created_at, updated_at)
     VALUES ($1, $2, 'SmokeENW', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_UID, OWNER_EMAIL]
  );
}

async function seedSession() {
  const sess = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email: OWNER_EMAIL } } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
    [OWNER_SID, JSON.stringify(sess), new Date(Date.now() + 3600000)]
  );
  return forgeSessionCookie(OWNER_SID);
}

async function seedEstimates(companyId) {
  const rows = [
    [EST_BLANK, 'Blank Email Person', ''],
    [EST_LITERAL_NULL, 'Literal Null Person', 'null'],
    [EST_REAL, 'Real Email Person', REAL_EMAIL],
  ];
  for (const [id, name, email] of rows) {
    await pool.query(
      `INSERT INTO estimates (id, company_id, customer_name, customer_email, estimate_number, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'draft', NOW())
       ON CONFLICT (id) DO UPDATE SET customer_name = $3, customer_email = $4, company_id = $2`,
      [id, companyId, name, email, `SMOKE-ENW-${id.slice(-6)}`]
    );
  }
}

async function cleanup() {
  await pool.query(`DELETE FROM estimates WHERE id IN ($1,$2,$3)`, [EST_BLANK, EST_LITERAL_NULL, EST_REAL]).catch(() => {});
  await pool.query(`DELETE FROM companies WHERE LOWER(created_by) = $1`, [OWNER_EMAIL]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE id = $1 OR LOWER(email) = $2`, [OWNER_UID, OWNER_EMAIL]).catch(() => {});
  await pool.query(`DELETE FROM sessions WHERE sid = $1`, [OWNER_SID]).catch(() => {});
}

const idsOf = (payload) => (Array.isArray(payload) ? payload.map((r) => r.id).sort() : []);

(async () => {
  if (!process.env.SESSION_SECRET || !process.env.DATABASE_URL) {
    console.error('[enw] SESSION_SECRET and DATABASE_URL must be set. Aborting.');
    process.exit(1);
  }

  console.log('\n[test-entity-filter-null-widening] starting...\n');

  if (!(await waitForServer())) {
    console.error(`[enw] Server at ${BASE_URL} did not respond within 60s. Is 'Start application' running?`);
    await pool.end();
    process.exit(1);
  }

  let companyId = null;
  try {
    await cleanup();
    await seedUser();
    const cookie = await seedSession();

    const co = await fetchJson(`${BASE_URL}/api/local/entity/Company`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: { company_name: 'Smoke ENW Roofing', email: OWNER_EMAIL },
    });
    companyId = co.data?.id;
    ok('Test company created', !!companyId, co.status);
    if (!companyId) throw new Error('No company id — cannot continue');

    // The tenant guard scopes every list read to the caller's own companies,
    // so the forged user has to actually belong to the fixture company.
    await pool.query(`UPDATE users SET company_id = $1 WHERE id = $2`, [companyId, OWNER_UID]);

    await seedEstimates(companyId);

    const get = (qs) =>
      fetchJson(`${BASE_URL}/api/local/entity/Estimate?company_id=${encodeURIComponent(companyId)}&${qs}`, {
        headers: { Cookie: cookie },
      });

    // Sanity: all three fixtures are visible without an email filter.
    const all = await get('_limit=100');
    ok('All 3 fixture estimates are readable', idsOf(all.data).length === 3, idsOf(all.data));

    // 1. The bug: "null" must not widen into "blank or null".
    const nullish = await get(`customer_email=${encodeURIComponent('null')}`);
    const nullIds = idsOf(nullish.data);
    ok('customer_email=null returns ONLY the literal-"null" row',
      nullIds.length === 1 && nullIds[0] === EST_LITERAL_NULL, nullIds);
    ok('customer_email=null does NOT return the blank-email row',
      !nullIds.includes(EST_BLANK), nullIds);

    // 2. A normal scalar filter still matches exactly.
    const real = await get(`customer_email=${encodeURIComponent(REAL_EMAIL)}`);
    ok('A real email filter matches exactly one row',
      idsOf(real.data).length === 1 && idsOf(real.data)[0] === EST_REAL, idsOf(real.data));

    // 3. Operator objects must still parse.
    const contains = await get(`customer_name=${encodeURIComponent(JSON.stringify({ $contains: 'Blank Email' }))}`);
    ok('$contains operator still works',
      idsOf(contains.data).length === 1 && idsOf(contains.data)[0] === EST_BLANK, idsOf(contains.data));

    const inOp = await get(`id=${encodeURIComponent(JSON.stringify({ $in: [EST_BLANK, EST_REAL] }))}`);
    ok('$in operator still works', idsOf(inOp.data).length === 2, idsOf(inOp.data));
  } catch (err) {
    console.error('[enw] Unexpected error:', err.message);
    failed++;
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n[test-entity-filter-null-widening] ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
