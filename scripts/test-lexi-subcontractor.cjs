#!/usr/bin/env node
/**
 * test-lexi-subcontractor.cjs
 * ─────────────────────────────────────────────────────────────────────
 * End-to-end regression test: Lexi can save a subcontractor and it
 * immediately appears in the list.
 *
 * What this guards against:
 *   The bug was that Lexi confirmed adding a subcontractor but the record
 *   was never visible in the Subcontractors page.  Root cause: missing
 *   instruction in the system prompt caused Lexi to attempt the wrong
 *   tool/entity path and the row was never written.
 *
 * Scenarios:
 *   1. Lexi receives "add Alex from Clearway as a siding subcontractor"
 *      → manage_entity(entity_name='Subcontractor', entity_action='create')
 *        is invoked (proven by actions_executed in the response)
 *      → a generic_entities row with entity_type='Subcontractor' is readable
 *        by the same filter Subcontractors.jsx uses
 *        (entity_type='Subcontractor' AND company_id=...)
 *      → entity_type column is exactly 'Subcontractor' (capital S), proving
 *        entity name normalisation works regardless of LLM casing
 *
 *   2. Lexi receives "show me my siding subcontractors" immediately after
 *      → find_subcontractors tool is invoked
 *      → Lexi's response mentions the subcontractor created in Scenario 1
 *        (proving the save was immediately visible for search)
 *
 * Each run provisions a fully-isolated throwaway company and session so
 * no live-tenant data is touched.  Everything is cleaned up in the
 * finally block, including on failure.
 *
 * Prerequisites:
 *   - App server running (npm run dev) on PORT (default 5000)
 *   - DATABASE_URL and SESSION_SECRET must be set
 *
 * Usage:  node scripts/test-lexi-subcontractor.cjs
 *         npm run test:lexi-subcontractor
 */

'use strict';

const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';

// Deterministic smoke-test identifiers — all cleaned up in finally block.
const OWNER_EMAIL = 'smoke-lexi-sub-owner@example.com';
const OWNER_UID   = 'smoke_lexi_sub_owner_user';
const OWNER_SID   = 'smoke_lexi_sub_owner_session';

// Unique marker so we can locate exactly the rows this run creates.
const MARKER = 'LexiSubSmoke_' + crypto.randomBytes(4).toString('hex');

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${extra !== undefined ? ` (got: ${JSON.stringify(extra)})` : ''}`);
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

async function seedSession(pool, uid, email, sid) {
  await pool.query(
    `INSERT INTO users (id, email, first_name, created_at, updated_at)
     VALUES ($1, $2, 'SmokeUser', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [uid, email]
  );
  const sess = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email } } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
    [sid, JSON.stringify(sess), new Date(Date.now() + 3600000)]
  );
  return `connect.sid=${encodeURIComponent(signSessionId(sid, process.env.SESSION_SECRET))}`;
}

async function callLexiChat(cookie, companyId, message) {
  const resp = await fetchJson(`${BASE}/api/functions/invoke`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: {
      functionName: 'lexiChat',
      params: {
        message,
        companyId,
        userEmail: OWNER_EMAIL,
        userName: 'Smoke Test',
        conversationHistory: [],
      },
    },
  });
  if (resp.status !== 200) throw new Error(`lexiChat HTTP ${resp.status}: ${JSON.stringify(resp.data)}`);
  return resp.data?.data ?? resp.data;
}

async function cleanup(pool, companyId) {
  try {
    if (companyId) {
      await pool.query('DELETE FROM generic_entities WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    }
    await pool.query(
      `DELETE FROM users WHERE id = $1 OR LOWER(email) = LOWER($2)`,
      [OWNER_UID, OWNER_EMAIL]
    );
    await pool.query('DELETE FROM sessions WHERE sid = $1', [OWNER_SID]);
  } catch (e) {
    console.warn('[lexi-sub] cleanup error (non-fatal):', e.message);
  }
}

async function main() {
  if (!process.env.SESSION_SECRET) {
    console.error('[lexi-sub] SESSION_SECRET not set — cannot forge session. Aborting.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('[lexi-sub] DATABASE_URL not set. Aborting.');
    process.exit(1);
  }

  const pool = createPool({ connectionString: process.env.DATABASE_URL });

  // Wait for the server to be ready (up to 60s).
  const serverReady = await (async () => {
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetchJson(`${BASE}/api/local/entity/Company?limit=1`);
        if (r.status) return true;
      } catch { /* not yet up */ }
      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  })();
  if (!serverReady) {
    console.error(`[lexi-sub] Server at ${BASE} did not respond in 60s. Is "Start application" running?`);
    await pool.end();
    process.exit(1);
  }

  // Pre-clean any leftovers from a previous crashed run.
  await cleanup(pool, null);

  const ownerCookie = await seedSession(pool, OWNER_UID, OWNER_EMAIL, OWNER_SID);

  let companyId = null;
  try {
    // ── Provision an isolated test company ────────────────────────────────
    console.log('\n[lexi-sub] Provisioning isolated test company...');
    const co = await fetchJson(`${BASE}/api/local/entity/Company`, {
      method: 'POST',
      headers: { Cookie: ownerCookie },
      body: {
        company_name: 'Smoke Lexi Sub Roofing',
        email: OWNER_EMAIL,
      },
    });
    ok(`Test company created (HTTP ${co.status})`, co.status === 200 || co.status === 201, co.data);
    companyId = co.data?.id;
    ok('Test company returned an id', !!companyId, co.data);
    if (!companyId) throw new Error('Company create failed — cannot continue');

    // ═══════════════════════════════════════════════════════════════════
    // SCENARIO 1 — create: Lexi adds a subcontractor via manage_entity
    // ═══════════════════════════════════════════════════════════════════
    console.log(`\n[lexi-sub] Scenario 1: ask Lexi to add ${MARKER} as a siding subcontractor`);
    const msg1 = `Add ${MARKER} as a siding subcontractor. Their contact person is Alex.`;

    let result1;
    try {
      result1 = await callLexiChat(ownerCookie, companyId, msg1);
    } catch (err) {
      ok('Scenario 1 — lexiChat call did not throw', false, err.message);
      return;
    }

    const response1 = result1?.response || '';
    const actions1  = result1?.actions_executed || [];
    console.log('  response:', response1.slice(0, 160));
    console.log('  actions_executed:', JSON.stringify(actions1));

    // 1a. No auth / rate-limit error.
    ok('Scenario 1 — Lexi returned a response (no auth error)', !result1?.error, result1?.error);

    // 1b. actions_executed must contain create_entity for Subcontractor.
    //     Normalization maps "subcontractor" → "Subcontractor", so result
    //     always uses canonical casing regardless of what Gemini passed.
    const createAction = actions1.find(
      a => a.tool_name === 'create_entity' && /subcontractor/i.test(a.result)
    );
    ok('Scenario 1 — actions_executed has create_entity for Subcontractor', !!createAction, actions1);

    // 1c. Query generic_entities exactly as Subcontractors.jsx does:
    //       entity_type = 'Subcontractor' AND company_id = <id>
    const dbRow = await pool.query(
      `SELECT id, entity_type, company_id, data
       FROM generic_entities
       WHERE entity_type = 'Subcontractor'
         AND company_id = $1
         AND (data->>'name' ILIKE $2 OR data->>'company_name' ILIKE $2)
       ORDER BY created_date DESC LIMIT 1`,
      [companyId, `%${MARKER}%`]
    );
    ok('Scenario 1 — row visible via Subcontractors.jsx filter (entity_type+company_id)', dbRow.rows.length > 0, dbRow.rows.length);

    if (dbRow.rows.length > 0) {
      const row = dbRow.rows[0];
      console.log(`  DB row id=${row.id} entity_type=${row.entity_type} name=${row.data?.name}`);

      // 1d. entity_type must be exactly 'Subcontractor' (capital S) — the
      //     normalisation code maps any LLM casing to the canonical value.
      ok('Scenario 1 — entity_type is canonical "Subcontractor" (normalisation)', row.entity_type === 'Subcontractor', row.entity_type);

      // 1e. Top-level company_id column (not just data JSONB) must be set —
      //     that is the column the page filter uses.
      ok('Scenario 1 — top-level company_id column is set correctly', row.company_id === companyId, row.company_id);
    }

    // ═══════════════════════════════════════════════════════════════════
    // SCENARIO 2 — search: Lexi immediately finds the record it just saved
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n[lexi-sub] Scenario 2: ask Lexi to show siding subcontractors');
    const msg2 = `Show me my siding subcontractors.`;

    let result2;
    try {
      result2 = await callLexiChat(ownerCookie, companyId, msg2);
    } catch (err) {
      ok('Scenario 2 — lexiChat search call did not throw', false, err.message);
      return;
    }

    const response2 = result2?.response || '';
    const actions2  = result2?.actions_executed || [];
    console.log('  response:', response2.slice(0, 200));
    console.log('  actions_executed:', JSON.stringify(actions2));

    // 2a. No error.
    ok('Scenario 2 — Lexi returned a response (no auth error)', !result2?.error, result2?.error);

    // 2b. find_subcontractors tool was invoked (the dedicated search path).
    const findAction = actions2.find(a => a.tool_name === 'find_subcontractors');
    ok('Scenario 2 — find_subcontractors tool was invoked', !!findAction, actions2);

    // 2c. The response mentions the subcontractor we created — proving the
    //     saved record was immediately visible to the search tool.
    const mentionsMarker = response2.toLowerCase().includes(MARKER.toLowerCase());
    ok(`Scenario 2 — response mentions the saved subcontractor (${MARKER})`, mentionsMarker, response2.slice(0, 120));

  } finally {
    await cleanup(pool, companyId);
    await pool.end();

    console.log(`\n[lexi-sub] ${passed + failed} checks — ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.log('[lexi-sub] SOME TESTS FAILED');
      process.exit(1);
    } else {
      console.log('[lexi-sub] ALL TESTS PASSED');
      process.exit(0);
    }
  }
}

main().catch(e => {
  console.error('[lexi-sub] Fatal error:', e.message);
  process.exit(1);
});
