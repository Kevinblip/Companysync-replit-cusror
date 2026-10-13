#!/usr/bin/env node
/**
 * Timezone Cron Smoke Test
 * ────────────────────────
 * Regression guard for scanBuildProgressUpdates timezone handling (Task #696).
 *
 * The weekly progress-text cron fires on Thursdays 10:00–10:14 company-local
 * time. This test proves the cron reads timezone from companies.timezone (the
 * dedicated column) — NOT from a stale generic_entities row — by:
 *
 *   1. Creating a Pacific-time company (America/Los_Angeles, timezone='America/Los_Angeles')
 *      AND an Eastern-time company (America/New_York), both with
 *      weekly_progress_updates_enabled=true in AssistantSettings.
 *
 *   2. Calling scanBuildProgressUpdates with nowOverride set to a Thursday
 *      10:05 AM PDT moment (17:05 UTC).  At that UTC moment:
 *        • PT company local time  → Thu 10:05 → IN window  ✓
 *        • ET company local time  → Thu 13:05 → OUT of window ✓
 *
 *   3. Asserting window_skipped === 1 (the ET company was skipped) and that
 *      the PT company was NOT skipped (window_skipped + companies_enabled === 2
 *      means exactly one passed the gate).
 *
 *   REGRESSION CATCH: if someone changes the timezone lookup to read from
 *   generic_entities Company rows (the old broken pattern), those rows have
 *   no timezone so both companies fall back to America/New_York → both skip
 *   → window_skipped === 2. The test catches this.
 *
 * Prerequisites:
 *   - The app server must be running on PORT (default 5000)  — `npm run dev`
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *
 * Usage:  node scripts/test-timezone-cron.cjs
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http  = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture IDs (prefix prevents collision with real data) ────────────
const PT_COMPANY_ID  = 'smoke_tz_cron_pt_001';
const ET_COMPANY_ID  = 'smoke_tz_cron_et_001';
const PT_AS_ID       = 'smoke_tz_cron_pt_as_001';
const ET_AS_ID       = 'smoke_tz_cron_et_as_001';
const OWNER_EMAIL    = 'smoke-tz-cron@example.com';
const OWNER_UID      = 'smoke_tz_cron_owner_user';
const SID            = 'smoke_tz_cron_session';

// ── Thursday 2025-08-07 10:05 AM PDT (UTC-7 in summer) = 17:05 UTC ──────────
// At this moment:
//   America/Los_Angeles (PDT, UTC-7) → 10:05 Thu → IN  window (10 === 10, min < 15)
//   America/New_York    (EDT, UTC-4) → 13:05 Thu → OUT of window (13 ≠ 10)
const NOW_OVERRIDE_UTC = '2025-08-07T17:05:00.000Z';

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else       { console.log(`  ✗ ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`); failed++; }
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

async function cleanup() {
  // Remove AssistantSettings fixtures
  await pool.query(
    `DELETE FROM generic_entities WHERE id IN ($1, $2)`,
    [PT_AS_ID, ET_AS_ID]
  ).catch(() => {});
  // Remove company rows
  await pool.query(
    `DELETE FROM companies WHERE id IN ($1, $2)`,
    [PT_COMPANY_ID, ET_COMPANY_ID]
  ).catch(() => {});
  // Remove session + user used for the HTTP call
  await pool.query(`DELETE FROM sessions WHERE sid = $1`, [SID]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE id = $1 OR LOWER(email) = $2`, [OWNER_UID, OWNER_EMAIL]).catch(() => {});
}

// ── Seed helpers ──────────────────────────────────────────────────────────────
async function seedCompany(id, name, timezone) {
  await pool.query(
    `INSERT INTO companies (id, company_name, timezone, subscription_status, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET company_name = $2, timezone = $3`,
    [id, name, timezone]
  );
}

async function seedAssistantSettings(asId, companyId) {
  const data = {
    weekly_progress_updates_enabled: true,
    // No real BuildSchedule rows exist for these companies, so no texts are
    // sent — but the cron must still pass (or skip) the window gate before
    // checking for builds.
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'AssistantSettings', $2, $3, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE SET data = $3, updated_date = NOW()`,
    [asId, companyId, JSON.stringify(data)]
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  if (!process.env.SESSION_SECRET) {
    console.error('[tz-cron] SESSION_SECRET is not set — cannot forge a session. Aborting.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('[tz-cron] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  if (!(await waitForServer())) {
    console.error(`[tz-cron] Server at ${BASE_URL} did not respond within 60s.`);
    await pool.end();
    process.exit(1);
  }

  try {
    // Always clean up first so re-runs are idempotent.
    await cleanup();

    // ── Seed ──────────────────────────────────────────────────────────────────
    console.log('[tz-cron] Seeding fixture companies and AssistantSettings...');
    await seedCompany(PT_COMPANY_ID, 'Smoke TZ Cron PT Roofing', 'America/Los_Angeles');
    await seedCompany(ET_COMPANY_ID, 'Smoke TZ Cron ET Roofing', 'America/New_York');
    await seedAssistantSettings(PT_AS_ID, PT_COMPANY_ID);
    await seedAssistantSettings(ET_AS_ID, ET_COMPANY_ID);

    // ── Forge a session for the HTTP call ────────────────────────────────────
    await pool.query(
      `INSERT INTO users (id, email, first_name, created_at, updated_at) VALUES ($1, $2, 'SmokeTz', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [OWNER_UID, OWNER_EMAIL]
    );
    const sess = {
      cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
      passport: { user: { claims: { email: OWNER_EMAIL } } },
    };
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
      [SID, JSON.stringify(sess), new Date(Date.now() + 3600000)]
    );
    const sig = crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(SID)
      .digest('base64')
      .replace(/=+$/, '');
    const Cookie = `connect.sid=${encodeURIComponent(`s:${SID}.${sig}`)}`;

    // ── Sanity: verify the handler accepts nowOverride ────────────────────────
    // Quick self-check: the UTC moment must parse to the expected local times.
    const refDate = new Date(NOW_OVERRIDE_UTC);
    const ptLocal = refDate.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    });
    const etLocal = refDate.toLocaleString('en-US', {
      timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    });
    console.log(`[tz-cron] nowOverride local times — PT: "${ptLocal}"  ET: "${etLocal}"`);

    const ptHourM = ptLocal.match(/(\d{1,2}):(\d{2})$/);
    const etHourM = etLocal.match(/(\d{1,2}):(\d{2})$/);
    ok('nowOverride is Thursday 10:05 PT', ptLocal.startsWith('Thu') && ptHourM && parseInt(ptHourM[1]) === 10 && parseInt(ptHourM[2]) < 15, ptLocal);
    ok('nowOverride is Thursday 13:05 ET (out-of-window)', etLocal.startsWith('Thu') && etHourM && parseInt(etHourM[1]) === 13, etLocal);

    // ── Main test: call scanBuildProgressUpdates with nowOverride ────────────
    console.log('[tz-cron] Calling scanBuildProgressUpdates with nowOverride...');
    const res = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      headers: { Cookie },
      body: {
        functionName: 'scanBuildProgressUpdates',
        params: {
          nowOverride: NOW_OVERRIDE_UTC,
          // force=false so the window gate IS evaluated (not bypassed).
          force: false,
          // Scope to ONLY our two test companies so real tenants (which may also
          // have weekly_progress_updates_enabled) don't skew the window_skipped count.
          scopeToCompanies: [PT_COMPANY_ID, ET_COMPANY_ID],
        },
      },
    });

    ok(`invoke returns 200 (got ${res.status})`, res.status === 200);
    const d = res.data?.data ?? res.data ?? {};
    ok('response has success:true', d.success === true, d);

    // The ET company must be window-skipped; the PT company must pass through.
    // window_skipped is a counter added in Task #696.
    ok('window_skipped === 1 (ET company blocked, PT company passed)', d.window_skipped === 1, d.window_skipped);

    // Regression catch: if BOTH companies fall back to ET (broken lookup),
    // window_skipped would be 2.  This assertion fails fast in that scenario.
    ok('window_skipped is NOT 2 (PT company NOT misidentified as ET)', d.window_skipped !== 2, d.window_skipped);

  } catch (e) {
    console.error('[tz-cron] UNEXPECTED ERROR:', e);
    failed++;
  } finally {
    try { await cleanup(); } catch (e) { console.error('[tz-cron] cleanup error:', e.message); }
    await pool.end();
  }

  console.log(`\n[tz-cron] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
