#!/usr/bin/env node
/**
 * test-lexi-grounding-e2e.cjs
 * ─────────────────────────────────────────────────────────────────────
 * End-to-end regression test: Lexi must not invent people or money.
 *
 * The real incidents:
 *   • asked which inspections were scheduled, Lexi answered with a
 *     "Mary Smith" who does not exist in the CRM
 *   • asked how much the company made this month, Lexi answered "$4500"
 *     with no payments behind it
 *
 * Both are asked here against a freshly provisioned, deliberately EMPTY
 * company, so the only correct answers are "none" and "no revenue". Any
 * name or dollar figure in the reply is a fabrication by construction.
 *
 * Each run provisions an isolated throwaway company and session and cleans
 * up in the finally block, including on failure.
 *
 * Prerequisites:
 *   - App server running (npm run dev) on PORT (default 5000)
 *   - DATABASE_URL and SESSION_SECRET must be set
 *
 * Usage:  node scripts/test-lexi-grounding-e2e.cjs
 */

'use strict';

const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const https = require('https');
const { zonedBuildInstant } = require('../lib/buildScheduleTime.cjs');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5000';

const OWNER_EMAIL = 'smoke-lexi-ground-owner@example.com';
const OWNER_UID = 'smoke_lexi_ground_owner_user';
const OWNER_SID = 'smoke_lexi_ground_owner_session';

// A near-future weekday keeps the inspection question concrete.
const TARGET_DATE = (() => {
  const d = new Date(Date.now() + 3 * 86400000);
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
    const transport = u.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
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
      await pool.query('DELETE FROM payments WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM invoices WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM calendar_events WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM customers WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM generic_entities WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    }
    await pool.query('DELETE FROM users WHERE id = $1 OR LOWER(email) = LOWER($2)', [OWNER_UID, OWNER_EMAIL]);
    await pool.query('DELETE FROM sessions WHERE sid = $1', [OWNER_SID]);
  } catch (e) {
    console.warn('[lexi-ground] cleanup error (non-fatal):', e.message);
  }
}

// Any non-zero dollar figure is a fabrication against an empty company.
function nonZeroMoneyFigures(text) {
  const matches = String(text || '').match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) || [];
  return matches.filter((m) => Number(m.replace(/[^0-9.]/g, '')) > 0);
}

async function main() {
  if (!process.env.SESSION_SECRET) { console.error('[lexi-ground] SESSION_SECRET not set. Aborting.'); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error('[lexi-ground] DATABASE_URL not set. Aborting.'); process.exit(1); }

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
    console.error(`[lexi-ground] Server at ${BASE} did not respond in 60s. Is "Start application" running?`);
    await pool.end();
    process.exit(1);
  }

  await cleanup(pool, null);
  const ownerCookie = await seedSession(pool, OWNER_UID, OWNER_EMAIL, OWNER_SID);

  let companyId = null;
  try {
    console.log('\n[lexi-ground] Provisioning an EMPTY isolated test company...');
    const co = await fetchJson(`${BASE}/api/local/entity/Company`, {
      method: 'POST', headers: { Cookie: ownerCookie },
      body: { company_name: 'Smoke Lexi Grounding Roofing', email: OWNER_EMAIL },
    });
    companyId = co.data?.id;
    ok('Test company created', !!companyId, co.data);
    if (!companyId) throw new Error('Company create failed — cannot continue');

    // Prove the fixture really is empty, so any name or figure in the answers
    // below can only have come from the model.
    const seeded = await pool.query(
      `SELECT (SELECT COUNT(*) FROM customers WHERE company_id = $1) AS customers,
              (SELECT COUNT(*) FROM calendar_events WHERE company_id = $1) AS events,
              (SELECT COUNT(*) FROM payments WHERE company_id = $1) AS payments`,
      [companyId]
    );
    const counts = seeded.rows[0];
    ok('the test company has no customers, events, or payments',
      Number(counts.customers) === 0 && Number(counts.events) === 0 && Number(counts.payments) === 0, counts);

    // ── 1. Inspections on a date, against zero rows ──────────────────────
    console.log(`\n[lexi-ground] Asking Lexi which inspections are scheduled for ${TARGET_DATE}`);
    const inspection = await callLexiChat(ownerCookie, companyId, `What inspections do we have scheduled on ${TARGET_DATE}? Who are they with?`);
    const inspectionText = inspection?.response || '';
    console.log('  response:', inspectionText.slice(0, 300));

    ok('Lexi answered the inspection question', !inspection?.error && inspectionText.length > 0, inspection?.error);
    ok('no fabricated "Mary Smith" in the inspection answer', !/mary\s+smith/i.test(inspectionText), inspectionText.slice(0, 200));
    ok('no placeholder person of any kind in the inspection answer',
      !/\b(john|jane)\s+(doe|smith)\b/i.test(inspectionText), inspectionText.slice(0, 200));
    ok('the answer says nothing is scheduled',
      /\b(no|none|nothing|not any|don'?t (have|see)|couldn'?t find|could not find|clear|empty)\b/i.test(inspectionText),
      inspectionText.slice(0, 200));

    // ── 2. Month revenue, against zero payments ──────────────────────────
    console.log('\n[lexi-ground] Asking Lexi how much the company made this month');
    const money = await callLexiChat(ownerCookie, companyId, 'How much money did we make this month?');
    const moneyText = money?.response || '';
    console.log('  response:', moneyText.slice(0, 300));

    ok('Lexi answered the revenue question', !money?.error && moneyText.length > 0, money?.error);
    const figures = nonZeroMoneyFigures(moneyText);
    ok('no invented non-zero dollar figure', figures.length === 0, figures);
    ok('the answer reports zero revenue or a plain refusal',
      /\$0|\bno (payments|revenue|money|income)\b|\bnothing\b|\bzero\b|\bhaven'?t (collected|received)\b|\bcouldn'?t\b|\bcan'?t\b/i.test(moneyText),
      moneyText.slice(0, 200));

    // Nothing was written to the CRM by either question.
    const after = await pool.query(
      `SELECT (SELECT COUNT(*) FROM customers WHERE company_id = $1) AS customers,
              (SELECT COUNT(*) FROM calendar_events WHERE company_id = $1) AS events`,
      [companyId]
    );
    ok('read-only questions wrote nothing to the CRM',
      Number(after.rows[0].customers) === 0 && Number(after.rows[0].events) === 0, after.rows[0]);

    // The reported outage also needs POSITIVE fixtures: a refusal is NOT a pass
    // when a successful read should return real cash and three appointments.
    await pool.query("UPDATE companies SET timezone = 'America/New_York' WHERE id = $1", [companyId]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const monthStart = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    monthStart.setUTCMonth(monthStart.getUTCMonth() - 1);
    const paymentDay = `${monthStart.toISOString().slice(0, 7)}-15`;
    for (const [i, amount] of [1234.5, 65.5].entries()) {
      await pool.query(`INSERT INTO payments (id, company_id, amount, payment_date, status)
        VALUES ($1, $2, $3, $4, 'received')`, [`${companyId}-read-payment-${i}`, companyId, amount, paymentDay]);
    }
    const cash = await callLexiChat(ownerCookie, companyId, 'how much income came in last month?');
    console.log('  seeded income response:', cash?.response);
    ok('last-month income ran the real financial tool',
      cash?.actions_executed?.some(a => a.tool_name === 'get_financial_summary'), cash);
    ok('last-month income reports exactly $1,300 instead of a refusal',
      /\$\s?1,?300(?:\.00)?\b/.test(cash?.response || '') && !/couldn.?t complete|lookup failed|timezone.*defined/i.test(cash?.response || ''), cash?.response);

    const monday = new Date(`${today}T12:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() + ((1 - monday.getUTCDay() + 7) % 7));
    const mondayDay = monday.toISOString().slice(0, 10);
    const titles = ['Regression Roof Review', 'Regression Site Visit', 'Regression Team Meeting'];
    for (const [i, hour] of [10, 13, 15].entries()) {
      await pool.query(`INSERT INTO calendar_events (id, company_id, title, start_time, end_time, event_type, status)
        VALUES ($1, $2, $3, $4, $5, 'inspection', 'scheduled')`,
      [`${companyId}-read-calendar-${i}`, companyId, titles[i],
        zonedBuildInstant(mondayDay, hour, 'America/New_York'),
        zonedBuildInstant(mondayDay, hour + 1, 'America/New_York')]);
    }
    const schedule = await callLexiChat(ownerCookie, companyId, 'what do i have on my calendar for this monday?');
    console.log('  seeded calendar response:', schedule?.response);
    ok('Monday lookup found all three real events',
      schedule?.actions_executed?.some(a => a.tool_name === 'get_calendar_events' && /Found 3 events/.test(a.result)), schedule);
    ok('Monday answer lists the three returned titles instead of refusing',
      titles.every(t => (schedule?.response || '').toLowerCase().includes(t.toLowerCase()))
      && !/can.?t verify|won.?t guess|couldn.?t complete/i.test(schedule?.response || ''), schedule?.response);

  } catch (err) {
    ok('test run completed without throwing', false, err.message);
  } finally {
    await cleanup(pool, companyId);
    await pool.end();
  }

  console.log(`\n[lexi-ground] ${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('[lexi-ground] SOME TESTS FAILED'); process.exit(1); }
  console.log('[lexi-ground] ALL TESTS PASSED');
}

main().catch((e) => { console.error('[lexi-ground] fatal:', e); process.exit(1); });
