#!/usr/bin/env node
/**
 * Price List Favorites Survival Smoke Test (end-to-end, live server)
 * ─────────────────────────────────────────────────────────────────────
 * Confirms that items starred (is_favorite=true) in a price list are
 * preserved when the same price list is re-imported in override mode,
 * and that codes removed from the new file don't re-appear as ghost rows.
 *
 * Test flow:
 *   1. Seed: company + user + signed session + 5 PriceListItem rows
 *        – ALPHA, BRAVO, CHARLIE starred; DELTA, ECHO not starred
 *   2. Override-import a new list containing: ALPHA, BRAVO, DELTA, FOXTROT
 *        – CHARLIE is intentionally absent (tests ghost-row prevention)
 *        – ECHO    is intentionally absent (unstarred; should just be gone)
 *        – FOXTROT is new                  (should not be starred)
 *   3. Read back all PriceListItem rows for the company/source
 *   4. Assert:
 *        ALPHA  → exists, is_favorite = true   (starred + in new file)
 *        BRAVO  → exists, is_favorite = true   (starred + in new file)
 *        DELTA  → exists, is_favorite = false  (unstarred + in new file)
 *        FOXTROT→ exists, is_favorite = false  (new item)
 *        CHARLIE→ does NOT exist               (starred but absent → no ghost)
 *        ECHO   → does NOT exist               (unstarred + absent)
 *   5. Run a second import in MERGE mode (GOLF added, ALPHA present but skipped)
 *        – ALPHA must remain starred (merge respects pre-existing rows)
 *        – GOLF  must appear and not be starred
 *   6. Cleanup
 *
 * Prerequisites:
 *   - App server running on PORT (default 5000): `npm run dev`
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *
 * Usage:  node scripts/test-pricelist-favorites.cjs
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture IDs ────────────────────────────────────────────────────────
const USER_EMAIL  = 'smoke-pricelist-fav@example.com';
const USER_UID    = 'smoke_pricelist_fav_user';
const SESSION_ID  = 'smoke_pricelist_fav_session';
const COMPANY_ID  = 'smoke-pricelist-fav-co';
const SOURCE      = 'Symbility';     // matches real usage

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`);
    failed++;
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
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

// ── Session forging (matches local-auth signSessionId) ────────────────────────
function makeCookie(sid) {
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function getPriceListItems() {
  const { rows } = await pool.query(
    `SELECT data->>'code' AS code,
            (data->>'is_favorite')::boolean AS is_favorite
     FROM generic_entities
     WHERE entity_type = 'PriceListItem'
       AND company_id  = $1
       AND (data->>'source') = $2`,
    [COMPANY_ID, SOURCE]
  );
  // Return a map code → { is_favorite }
  const map = {};
  for (const r of rows) map[r.code] = { is_favorite: r.is_favorite === true };
  return map;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
async function cleanup() {
  await pool.query(
    `DELETE FROM generic_entities WHERE entity_type = 'PriceListItem' AND company_id = $1`,
    [COMPANY_ID]
  );
  await pool.query('DELETE FROM companies   WHERE id  = $1', [COMPANY_ID]);
  await pool.query('DELETE FROM sessions    WHERE sid = $1', [SESSION_ID]);
  await pool.query('DELETE FROM users       WHERE id  = $1', [USER_UID]);
}

// ── Invoke bulkImportPriceList via server ─────────────────────────────────────
async function callBulkImport(cookie, items, merge = false) {
  const res = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: {
      functionName: 'bulkImportPriceList',
      params: { items, source: SOURCE, company_id: COMPANY_ID, merge },
    },
  });
  return res;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  if (!process.env.SESSION_SECRET) {
    console.error('[pricelist-favorites] SESSION_SECRET not set — cannot forge session. Aborting.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('[pricelist-favorites] DATABASE_URL not set. Aborting.');
    process.exit(1);
  }

  console.log('\n[pricelist-favorites] Waiting for server…');
  if (!(await waitForServer())) {
    console.error(`[pricelist-favorites] Server at ${BASE_URL} did not respond within 60 s.`);
    await pool.end();
    process.exit(1);
  }

  try {
    await cleanup(); // wipe any leftover from a previous run

    // ── Seed user, company, session ───────────────────────────────────────────
    await pool.query(
      `INSERT INTO users (id, email, first_name, created_at, updated_at)
       VALUES ($1, $2, 'PriceListFavSmoke', NOW(), NOW())`,
      [USER_UID, USER_EMAIL]
    );

    await pool.query(
      `INSERT INTO companies (id, company_name, created_by, email, subscription_status, created_at, updated_at)
       VALUES ($1, 'PriceList Fav Test Co', $2, $2, 'active', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [COMPANY_ID, USER_EMAIL]
    );

    // Forge a signed session for the company owner
    const sess = {
      cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
      passport: { user: { claims: { email: USER_EMAIL } } },
    };
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
      [SESSION_ID, JSON.stringify(sess), new Date(Date.now() + 3600000)]
    );
    const Cookie = makeCookie(SESSION_ID);

    // ── Seed initial price list rows directly in DB ───────────────────────────
    // ALPHA, BRAVO, CHARLIE → starred
    // DELTA, ECHO           → not starred
    const now = new Date().toISOString();
    const seedItems = [
      { code: 'ALPHA',   description: 'Alpha item',   unit_price: 10, is_favorite: true  },
      { code: 'BRAVO',   description: 'Bravo item',   unit_price: 20, is_favorite: true  },
      { code: 'CHARLIE', description: 'Charlie item', unit_price: 30, is_favorite: true  },
      { code: 'DELTA',   description: 'Delta item',   unit_price: 40, is_favorite: false },
      { code: 'ECHO',    description: 'Echo item',    unit_price: 50, is_favorite: false },
    ];
    for (const item of seedItems) {
      const id = crypto.randomUUID();
      const data = JSON.stringify({ ...item, source: SOURCE, company_id: COMPANY_ID });
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'PriceListItem', $2, $3::jsonb, $4, $4)`,
        [id, COMPANY_ID, data, now]
      );
    }
    console.log('\n[pricelist-favorites] Seeded 5 items (3 starred, 2 not)');

    // Verify seed
    const seeded = await getPriceListItems();
    ok('Seed: ALPHA is starred',   seeded['ALPHA']?.is_favorite   === true);
    ok('Seed: BRAVO is starred',   seeded['BRAVO']?.is_favorite   === true);
    ok('Seed: CHARLIE is starred', seeded['CHARLIE']?.is_favorite === true);
    ok('Seed: DELTA not starred',  seeded['DELTA']?.is_favorite   === false);
    ok('Seed: ECHO not starred',   seeded['ECHO']?.is_favorite    === false);

    // ── Step 1: Override import (ALPHA, BRAVO, DELTA, FOXTROT — no CHARLIE/ECHO)
    console.log('\n[pricelist-favorites] Step 1: Override import (4 items, CHARLIE/ECHO absent)');
    const newItems = [
      { code: 'ALPHA',   description: 'Alpha item v2',   unit_price: 11, source: SOURCE },
      { code: 'BRAVO',   description: 'Bravo item v2',   unit_price: 21, source: SOURCE },
      { code: 'DELTA',   description: 'Delta item v2',   unit_price: 41, source: SOURCE },
      { code: 'FOXTROT', description: 'Foxtrot item',    unit_price: 60, source: SOURCE },
    ];
    const importRes = await callBulkImport(Cookie, newItems, false);
    ok(`POST /api/functions/invoke → 200 (got ${importRes.status})`, importRes.status === 200, importRes.data);
    ok('bulkImportPriceList success=true', importRes.data?.data?.success === true, importRes.data);
    ok('Imported 4 items', importRes.data?.data?.imported === 4, importRes.data?.data?.imported);

    // ── Step 2: Verify DB state after override ────────────────────────────────
    console.log('\n[pricelist-favorites] Step 2: Verify DB after override');
    const after = await getPriceListItems();

    ok('ALPHA exists after re-import',           'ALPHA'   in after,            Object.keys(after));
    ok('BRAVO exists after re-import',           'BRAVO'   in after,            Object.keys(after));
    ok('DELTA exists after re-import',           'DELTA'   in after,            Object.keys(after));
    ok('FOXTROT exists after re-import',         'FOXTROT' in after,            Object.keys(after));

    ok('ALPHA is still starred',                 after['ALPHA']?.is_favorite   === true,  after['ALPHA']);
    ok('BRAVO is still starred',                 after['BRAVO']?.is_favorite   === true,  after['BRAVO']);
    ok('DELTA is NOT starred (was never fav)',   after['DELTA']?.is_favorite   === false, after['DELTA']);
    ok('FOXTROT is NOT starred (new item)',      after['FOXTROT']?.is_favorite === false, after['FOXTROT']);

    ok('CHARLIE absent — no ghost row (was starred but removed from file)',
       !('CHARLIE' in after), Object.keys(after));
    ok('ECHO absent — no ghost row (unstarred, removed from file)',
       !('ECHO' in after),    Object.keys(after));

    // Only the 4 new items should exist
    ok('Exactly 4 items in DB after override', Object.keys(after).length === 4, Object.keys(after).length);

    // ── Step 3: Merge import (GOLF added; ALPHA already present so skipped) ───
    console.log('\n[pricelist-favorites] Step 3: Merge import (GOLF new, ALPHA already present)');
    const mergeItems = [
      { code: 'ALPHA', description: 'Alpha item v3 (should be skipped)', unit_price: 99, source: SOURCE },
      { code: 'GOLF',  description: 'Golf item (new)',                    unit_price: 70, source: SOURCE },
    ];
    const mergeRes = await callBulkImport(Cookie, mergeItems, true);
    ok(`Merge POST → 200 (got ${mergeRes.status})`, mergeRes.status === 200, mergeRes.data);
    ok('Merge success=true', mergeRes.data?.data?.success === true, mergeRes.data);
    // Only GOLF should be inserted; ALPHA already exists so it's skipped
    ok('Merge inserted only 1 new item (GOLF)', mergeRes.data?.data?.imported === 1, mergeRes.data?.data?.imported);

    const afterMerge = await getPriceListItems();
    ok('GOLF exists after merge',           'GOLF' in afterMerge,                        Object.keys(afterMerge));
    ok('GOLF is NOT starred',               afterMerge['GOLF']?.is_favorite === false,   afterMerge['GOLF']);
    ok('ALPHA still starred after merge',   afterMerge['ALPHA']?.is_favorite === true,   afterMerge['ALPHA']);
    ok('5 items total after merge (4+GOLF)', Object.keys(afterMerge).length === 5,       Object.keys(afterMerge).length);

  } catch (e) {
    console.error('[pricelist-favorites] UNEXPECTED ERROR:', e);
    failed++;
  } finally {
    try { await cleanup(); } catch (e) { console.error('[pricelist-favorites] cleanup error:', e.message); }
    await pool.end();
  }

  console.log(`\n[pricelist-favorites] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
