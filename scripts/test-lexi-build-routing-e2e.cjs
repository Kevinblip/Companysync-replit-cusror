#!/usr/bin/env node
/**
 * test-lexi-build-routing-e2e.cjs
 * ─────────────────────────────────────────────────────────────────────
 * End-to-end regression test: asking Lexi to schedule a BUILD must
 * produce a Build Schedule record — not a lone calendar event.
 *
 * The real incident: asked to schedule a build for Duckworth, Lexi called
 * create_calendar_event with event_type "meeting" and title "Duckworth
 * Build Job". Production ended up with a calendar_events row and NO
 * BuildSchedule row, while Lexi told the user it was scheduled. Crews work
 * off the Build Schedule, so the job was invisible to them.
 *
 * A prompt rule already forbade this and the model ignored it, so the
 * enforcement lives in the tool handlers. This test proves the invariant
 * through the real HTTP endpoint rather than by inspecting source.
 *
 * Invariant asserted:
 *   after asking Lexi to schedule a build,
 *     • a BuildSchedule row exists for the customer
 *     • it carries a calendar_event_id
 *     • that calendar event really exists
 *     • no build-like calendar event exists that is unlinked from a build
 *
 * Each run provisions a fully-isolated throwaway company and session, and
 * cleans up in the finally block, including on failure.
 *
 * Prerequisites:
 *   - App server running (npm run dev) on PORT (default 5000)
 *   - DATABASE_URL and SESSION_SECRET must be set
 *
 * Usage:  node scripts/test-lexi-build-routing-e2e.cjs
 */

'use strict';

const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';

const OWNER_EMAIL = 'smoke-lexi-build-owner@example.com';
const OWNER_UID = 'smoke_lexi_build_owner_user';
const OWNER_SID = 'smoke_lexi_build_owner_session';

// A human-looking surname: a hex-ish marker gets mistaken for a customer_id
// by the model and the build tool then looks up an ID that never existed.
const MARKER = 'Smokeworth' + crypto.randomBytes(3).toString('hex').replace(/[0-9]/g, 'x');
// A fixed future date keeps the assertion deterministic regardless of run day.
const BUILD_DATE = (() => {
  const d = new Date(Date.now() + 12 * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
})();

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${extra !== undefined ? ` (got: ${JSON.stringify(extra)})` : ''}`); failed++; }
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let d; try { d = JSON.parse(b); } catch { d = b; }
        resolve({ status: res.statusCode, data: d });
      });
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

async function seedSession(pool, uid, email, sid) {
  await pool.query(
    `INSERT INTO users (id, email, first_name, created_at, updated_at)
     VALUES ($1, $2, 'SmokeUser', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [uid, email]
  );
  const sess = { cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' }, passport: { user: { claims: { email } } } };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
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
      params: { message, companyId, userEmail: OWNER_EMAIL, userName: 'Smoke Test', conversationHistory: [] },
    },
  });
  if (resp.status !== 200) throw new Error(`lexiChat HTTP ${resp.status}: ${JSON.stringify(resp.data)}`);
  return resp.data?.data ?? resp.data;
}

async function cleanup(pool, companyId) {
  try {
    if (companyId) {
      await pool.query('DELETE FROM calendar_events WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM customers WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM generic_entities WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    }
    await pool.query('DELETE FROM users WHERE id = $1 OR LOWER(email) = LOWER($2)', [OWNER_UID, OWNER_EMAIL]);
    await pool.query('DELETE FROM sessions WHERE sid = $1', [OWNER_SID]);
  } catch (e) {
    console.warn('[lexi-build] cleanup error (non-fatal):', e.message);
  }
}

async function main() {
  if (!process.env.SESSION_SECRET) { console.error('[lexi-build] SESSION_SECRET not set. Aborting.'); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error('[lexi-build] DATABASE_URL not set. Aborting.'); process.exit(1); }

  const pool = createPool({ connectionString: process.env.DATABASE_URL });

  const serverReady = await (async () => {
    for (let i = 0; i < 30; i++) {
      try { const r = await fetchJson(`${BASE}/api/local/entity/Company?limit=1`); if (r.status) return true; }
      catch { /* not yet up */ }
      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  })();
  if (!serverReady) {
    console.error(`[lexi-build] Server at ${BASE} did not respond in 60s. Is "Start application" running?`);
    await pool.end();
    process.exit(1);
  }

  await cleanup(pool, null);
  const ownerCookie = await seedSession(pool, OWNER_UID, OWNER_EMAIL, OWNER_SID);

  let companyId = null;
  try {
    console.log('\n[lexi-build] Provisioning isolated test company...');
    const co = await fetchJson(`${BASE}/api/local/entity/Company`, {
      method: 'POST', headers: { Cookie: ownerCookie },
      body: { company_name: 'Smoke Lexi Build Roofing', email: OWNER_EMAIL },
    });
    companyId = co.data?.id;
    ok('Test company created', !!companyId, co.data);
    if (!companyId) throw new Error('Company create failed — cannot continue');

    const cust = await fetchJson(`${BASE}/api/local/entity/Customer`, {
      method: 'POST', headers: { Cookie: ownerCookie },
      body: { name: MARKER, company_id: companyId, address: '5688 Gemini Ct', phone: '5551234567', email: 'smoke-build-customer@example.com' },
    });
    ok('Test customer created', !!cust.data?.id, cust.data);
    // The build tool resolves customers out of the customers table scoped to
    // the company — prove the fixture actually landed there, so a lookup miss
    // later means a routing bug and not a broken fixture.
    const custRow = await pool.query('SELECT id, name FROM customers WHERE company_id = $1 AND name = $2', [companyId, MARKER]);
    ok('fixture customer is visible to the build tool', custRow.rowCount === 1, custRow.rows);

    // ── The exact request that failed in production ──────────────────────
    console.log(`\n[lexi-build] Asking Lexi to schedule a roofing build for ${MARKER} on ${BUILD_DATE}`);
    const result = await callLexiChat(ownerCookie, companyId, `Schedule a roofing build for the customer named ${MARKER} on ${BUILD_DATE}.`);
    const response = result?.response || '';
    console.log('  response:', response.slice(0, 200));
    console.log('  actions_executed:', JSON.stringify(result?.actions_executed || []));

    ok('Lexi returned a response (no auth error)', !result?.error, result?.error);

    const builds = await pool.query(
      `SELECT id, data FROM generic_entities WHERE entity_type = 'BuildSchedule' AND company_id = $1`,
      [companyId]
    );
    const events = await pool.query(
      `SELECT id, title, event_type FROM calendar_events WHERE company_id = $1`,
      [companyId]
    );
    console.log(`  build rows: ${builds.rowCount}, calendar rows: ${events.rowCount}`);

    // The core invariant — a build request must produce a build record.
    ok('a BuildSchedule row was created', builds.rowCount > 0, {
      builds: builds.rows.map(r => r.data?.customer_name),
      events: events.rows.map(r => r.title),
    });

    const build = builds.rows[0]?.data || {};
    ok('the build names the requested customer', String(build.customer_name || '').includes(MARKER), build.customer_name);
    ok('the build carries a linked calendar_event_id', !!build.calendar_event_id, build.calendar_event_id);

    if (build.calendar_event_id) {
      const linked = await pool.query('SELECT id, title FROM calendar_events WHERE id = $1 AND company_id = $2', [build.calendar_event_id, companyId]);
      ok('the linked calendar event really exists', linked.rowCount === 1, linked.rows);
    } else {
      ok('the linked calendar event really exists', false, 'no calendar_event_id on the build');
    }

    // No calendar event may claim a build while no build row points at it —
    // that is precisely the state the user found on their calendar.
    const linkedIds = new Set(builds.rows.map(r => r.data?.calendar_event_id).filter(Boolean));
    const orphans = events.rows.filter(e => !linkedIds.has(e.id));
    ok('no unlinked build-like calendar event was left behind', orphans.length === 0, orphans.map(o => o.title));

  } catch (err) {
    ok('test run completed without throwing', false, err.message);
  } finally {
    await cleanup(pool, companyId);
    await pool.end();
  }

  console.log(`\n[lexi-build] ${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('[lexi-build] SOME TESTS FAILED'); process.exit(1); }
  console.log('[lexi-build] ALL TESTS PASSED');
}

main().catch((e) => { console.error('[lexi-build] fatal:', e); process.exit(1); });
