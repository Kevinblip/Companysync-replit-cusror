#!/usr/bin/env node
/**
 * Trial Daily-Limit Smoke Test (end-to-end, live server)
 * ────────────────────────────────────────────────────────
 * Proves the daily refresh limits for trial companies work correctly:
 *
 *   AI    : 15 calls/day  (all AI_USAGE_FEATURES combined)
 *   SMS   : 20 sends/day
 *   Email : 30 sends/day
 *
 * Each runs three assertion groups:
 *   A. Under limit  → allowed: true
 *   B. At limit     → allowed: false with a clear error message
 *   C. Yesterday's usage doesn't bleed into today's count
 *
 * Also verifies:
 *   D. A non-trial (active) company is NEVER blocked by trial gates
 *   E. TRIAL_DAILY_LIMITS values are reflected in getTrialDailyUsage
 *
 * Prerequisites:
 *   - App server running on PORT (default 5000) — `npm run dev`
 *   - DATABASE_URL must match the running server
 *
 * Usage:  node scripts/test-trial-daily-limits.cjs
 *
 * Fixture IDs use stable "smoke_tdl_" prefix; script cleans up after itself.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const COMPANY_TRIAL_ID  = 'smoke_tdl_trial_co';
const COMPANY_ACTIVE_ID = 'smoke_tdl_active_co';

// ── Counters ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function ok(name, cond, got) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else       { console.log(`  ✗ ${name}${got !== undefined ? ` (got: ${JSON.stringify(got)})` : ''}`); failed++; }
}

// ── HTTP helper ──────────────────────────────────────────────────────────────
function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port:     u.port || 80,
        path:     u.pathname + u.search,
        method:   opts.method || 'GET',
        headers:  { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      },
      (res) => {
        let b = '';
        res.on('data', c => (b += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
          catch { resolve({ status: res.statusCode, body: b }); }
        });
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

async function invokeFunction(name, params = {}) {
  const r = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    body: { functionName: name, params },
  });
  // The endpoint wraps handler return values in { data: ... }
  return r.body?.data ?? r.body;
}

// ── DB helpers ───────────────────────────────────────────────────────────────
async function createFixtures() {
  await pool.query(`
    INSERT INTO companies (id, company_name, email, subscription_status, subscription_plan, created_at, updated_at)
    VALUES
      ($1, 'Smoke Trial Co',  'smoke-tdl-trial@example.com',  'trial',  'trial',  NOW(), NOW()),
      ($2, 'Smoke Active Co', 'smoke-tdl-active@example.com', 'active', 'business', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE
      SET subscription_status = EXCLUDED.subscription_status,
          subscription_plan   = EXCLUDED.subscription_plan,
          updated_at          = NOW()
  `, [COMPANY_TRIAL_ID, COMPANY_ACTIVE_ID]);
}

async function insertUsageEvents(companyId, feature, count, dateStr) {
  for (let i = 0; i < count; i++) {
    const id = `smoke_tdl_${feature}_${dateStr}_${i}_${crypto.randomBytes(4).toString('hex')}`;
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [id, companyId, JSON.stringify({ company_id: companyId, feature, units: 1, usage_date: dateStr, usage_month: dateStr.slice(0, 7), logged_at: new Date().toISOString() })]
    );
  }
}

async function cleanup() {
  await pool.query(`DELETE FROM generic_entities WHERE entity_type = 'SubscriptionUsage' AND company_id = ANY($1)`, [[COMPANY_TRIAL_ID, COMPANY_ACTIVE_ID]]);
  await pool.query(`DELETE FROM companies WHERE id = ANY($1)`, [[COMPANY_TRIAL_ID, COMPANY_ACTIVE_ID]]);
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  try {
    console.log('\n── Trial Daily Limits Smoke Test ──────────────────────────────\n');

    // ── Verify server is reachable ──────────────────────────────────────────
    try {
      await fetchJson(`${BASE_URL}/api/health`);
    } catch {
      console.error(`✗ Server not reachable at ${BASE_URL}. Start with: npm run dev`);
      process.exit(1);
    }

    // Pre-clean in case a previous run didn't finish cleanup
    await cleanup();
    await createFixtures();
    console.log('Fixtures created. Running tests...\n');

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 1: AI daily limits
    // ════════════════════════════════════════════════════════════════════════
    console.log('[ AI limits — 15/day for trial ]');

    // A. 14 events today → still under limit
    await insertUsageEvents(COMPANY_TRIAL_ID, 'lexi', 14, today);
    let r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('A1: getTrialDailyUsage returns success', r.success === true, r);
    ok('A2: AI used = 14', r.ai?.used === 14, r.ai?.used);
    ok('A3: AI limit = 15', r.ai?.limit === 15, r.ai?.limit);
    ok('A4: AI allowed = true (under limit)', r.ai?.allowed === true, r.ai?.allowed);

    // B. 1 more event today → exactly at limit → blocked
    await insertUsageEvents(COMPANY_TRIAL_ID, 'lexi', 1, today);
    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('B1: AI used = 15 (at limit)', r.ai?.used === 15, r.ai?.used);
    ok('B2: AI allowed = false (at limit)', r.ai?.allowed === false, r.ai?.allowed);

    // C. Yesterday's usage doesn't count toward today
    await insertUsageEvents(COMPANY_TRIAL_ID, 'ai_estimator', 100, yesterday);
    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('C1: Yesterday AI events (100) do not affect today check', r.ai?.used === 15, r.ai?.used);
    ok('C2: Today still blocked (not reset by yesterday events)', r.ai?.allowed === false, r.ai?.allowed);

    // Reset AI events for today
    await pool.query(`DELETE FROM generic_entities WHERE entity_type='SubscriptionUsage' AND company_id=$1 AND data->>'usage_date'=$2`, [COMPANY_TRIAL_ID, today]);

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 2: SMS daily limits
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[ SMS limits — 20/day for trial ]');

    // A. 19 events → under limit
    await insertUsageEvents(COMPANY_TRIAL_ID, 'sms', 19, today);
    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('A1: SMS used = 19', r.sms?.used === 19, r.sms?.used);
    ok('A2: SMS limit = 20', r.sms?.limit === 20, r.sms?.limit);
    ok('A3: SMS allowed = true (under limit)', r.sms?.allowed === true, r.sms?.allowed);

    // B. 1 more → at limit → blocked
    await insertUsageEvents(COMPANY_TRIAL_ID, 'sms', 1, today);
    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('B1: SMS used = 20 (at limit)', r.sms?.used === 20, r.sms?.used);
    ok('B2: SMS allowed = false (at limit)', r.sms?.allowed === false, r.sms?.allowed);

    // C. Yesterday's SMS doesn't bleed in
    await insertUsageEvents(COMPANY_TRIAL_ID, 'sms', 50, yesterday);
    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('C1: Yesterday SMS (50) does not affect today count', r.sms?.used === 20, r.sms?.used);

    // Reset SMS events for today
    await pool.query(`DELETE FROM generic_entities WHERE entity_type='SubscriptionUsage' AND company_id=$1 AND data->>'feature'='sms' AND data->>'usage_date'=$2`, [COMPANY_TRIAL_ID, today]);

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 3: Email daily limits
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[ Email limits — 30/day for trial ]');

    // A. 29 → under limit
    await insertUsageEvents(COMPANY_TRIAL_ID, 'email', 29, today);
    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('A1: Email used = 29', r.email?.used === 29, r.email?.used);
    ok('A2: Email limit = 30', r.email?.limit === 30, r.email?.limit);
    ok('A3: Email allowed = true (under limit)', r.email?.allowed === true, r.email?.allowed);

    // B. 1 more → blocked
    await insertUsageEvents(COMPANY_TRIAL_ID, 'email', 1, today);
    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('B1: Email used = 30 (at limit)', r.email?.used === 30, r.email?.used);
    ok('B2: Email allowed = false (at limit)', r.email?.allowed === false, r.email?.allowed);

    // C. Yesterday's email doesn't bleed in
    await insertUsageEvents(COMPANY_TRIAL_ID, 'email', 50, yesterday);
    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('C1: Yesterday email (50) does not affect today count', r.email?.used === 30, r.email?.used);

    // Reset email events for today
    await pool.query(`DELETE FROM generic_entities WHERE entity_type='SubscriptionUsage' AND company_id=$1 AND data->>'feature'='email' AND data->>'usage_date'=$2`, [COMPANY_TRIAL_ID, today]);

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 4: Non-trial company is never blocked
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[ Non-trial (active/business) company — never blocked ]');

    // Load up the active company way past trial limits
    await insertUsageEvents(COMPANY_ACTIVE_ID, 'lexi',  100, today);
    await insertUsageEvents(COMPANY_ACTIVE_ID, 'sms',   100, today);
    await insertUsageEvents(COMPANY_ACTIVE_ID, 'email', 100, today);

    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_ACTIVE_ID });
    // Non-trial: checkTrialDailyUsage returns allowed=true regardless, but
    // getTrialDailyUsage still calls checkAIUsage which uses monthly for non-trial.
    // We just need the daily SMS/email gates to be open.
    ok('D1: Non-trial SMS allowed even at 100 uses today', r.sms?.allowed === true, r.sms?.allowed);
    ok('D2: Non-trial email allowed even at 100 uses today', r.email?.allowed === true, r.email?.allowed);

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 5: Multi-feature AI — all AI_USAGE_FEATURES sum together
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[ AI multi-feature summing — lexi + ai_estimator + crew_cam combine ]');

    // Insert 5 lexi + 5 ai_estimator + 4 crew_cam = 14 total → still under 15
    await insertUsageEvents(COMPANY_TRIAL_ID, 'lexi',         5, today);
    await insertUsageEvents(COMPANY_TRIAL_ID, 'ai_estimator', 5, today);
    await insertUsageEvents(COMPANY_TRIAL_ID, 'crew_cam',     4, today);
    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('E1: 5+5+4=14 AI units across features → used=14', r.ai?.used === 14, r.ai?.used);
    ok('E2: allowed = true at 14 (under 15)', r.ai?.allowed === true, r.ai?.allowed);

    // 1 more → exactly 15 → blocked
    await insertUsageEvents(COMPANY_TRIAL_ID, 'lexi', 1, today);
    r = await invokeFunction('getTrialDailyUsage', { companyId: COMPANY_TRIAL_ID });
    ok('E3: +1 more → used=15, allowed=false', r.ai?.used === 15 && r.ai?.allowed === false, r.ai);

    // ════════════════════════════════════════════════════════════════════════
    // Results
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n── Summary ────────────────────────────────────────────────────');
    console.log(`   Passed: ${passed}   Failed: ${failed}`);
    if (failed > 0) {
      console.log('\n✗ Some tests failed — see details above.');
      process.exit(1);
    } else {
      console.log('\n✓ All tests passed.');
    }

  } catch (err) {
    console.error('\n✗ Unexpected error:', err.message);
    process.exit(1);
  } finally {
    try {
      await cleanup();
      console.log('Fixtures cleaned up.');
    } catch (e) {
      console.warn('Cleanup error (non-fatal):', e.message);
    }
    await pool.end();
  }
})();
