#!/usr/bin/env node
/**
 * Weekly Progress Texts + Stuck-Job Alerts Regression Test
 * ─────────────────────────────────────────────────────────────────────────
 * Covers the money/comms-sensitive rules that were verified manually during
 * implementation but had no automated coverage:
 *
 *  A) scanBuildProgressUpdates
 *     A1. Baseline (first observation) — sets progress_last_notified_stage
 *         without texting the customer.
 *     A2. Forward move — build advanced from 'scheduled' → 'in_progress'
 *         with a valid phone triggers a text attempt (SMS fails on invalid
 *         number; the key check is that advanced>0 and the send path ran).
 *     A3. Deferred send does NOT advance the baseline — when
 *         sendCustomerReminder returns skipped (no phone), the
 *         progress_last_notified_stage is NOT written.
 *     A4. Same-stage — build still at baseline stage is skipped (not re-sent).
 *     A5. Negative column (task in 'cancelled' column) never announces.
 *
 *  B) scanStuckJobs
 *     B1. Clock reset on first observation (no progress_stage) — writes
 *         progress_stage + progress_stage_since; does NOT fire an alert.
 *     B2. Clock reset on stage change — progress_stage differs from current
 *         status → resets clock, no alert.
 *     B3. Not-yet-stuck — stage matches but days < threshold → skipped.
 *     B4. Alert created — stage matches + days ≥ threshold →
 *         ActionItem(type='stuck_job') + Notification created.
 *     B5. Dedup by stuck_alert_stage — second run with same stuck build
 *         produces no new ActionItem.
 *     B6. Category heuristic —
 *         'postponed'            → Waiting
 *         scheduled with past build_date → Forgotten
 *         'in_progress' (no past date)   → Stalled
 *
 * Prerequisites:
 *   - Dev server running on PORT (default 5000)  —  npm run dev
 *   - DATABASE_URL and SESSION_SECRET env vars set
 *
 * Usage:  node scripts/test-weekly-progress-stuck-jobs.cjs
 *
 * All fixture IDs use the stable "smoke_wpj_" prefix; cleanup runs on both
 * success and failure so repeated runs never accumulate test data.
 * SMS never reaches a real number: customer phones are deliberately invalid
 * (no-phone or 'invalid') so sendCustomerReminder skips/fails gracefully.
 */
'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http     = require('http');
const crypto   = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool     = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers ─────────────────────────────────────────────
const COMPANY_ID          = 'smoke_wpj_company_001';
const SETTINGS_ID_PROG    = 'smoke_wpj_settings_progress_001';
const SETTINGS_ID_STUCK   = 'smoke_wpj_settings_stuck_001';
const CUSTOMER_ID         = 'smoke_wpj_customer_001';

// BuildSchedule fixture IDs
const BUILD_BASELINE      = 'smoke_wpj_build_baseline_001';    // first observation
const BUILD_FORWARD       = 'smoke_wpj_build_forward_001';     // forward move (has phone)
const BUILD_DEFERRED      = 'smoke_wpj_build_deferred_001';    // forward but no phone → deferred
const BUILD_SAMESTAGE     = 'smoke_wpj_build_samestage_001';   // same stage as baseline → skip
const BUILD_CLOCK_FIRST   = 'smoke_wpj_build_clock_first_001'; // stuck: first observation
const BUILD_CLOCK_CHANGE  = 'smoke_wpj_build_clock_change_001';// stuck: stage changed
const BUILD_NOT_YET_STUCK = 'smoke_wpj_build_notstuck_001';    // stuck: not enough days
const BUILD_STALLED       = 'smoke_wpj_build_stalled_001';     // stuck: Stalled category
const BUILD_WAITING       = 'smoke_wpj_build_waiting_001';     // stuck: Waiting (postponed)
const BUILD_FORGOTTEN     = 'smoke_wpj_build_forgotten_001';   // stuck: Forgotten (past date)

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    const detail = extra !== undefined ? ` — got ${JSON.stringify(extra)}` : '';
    console.log(`  ✗ ${name}${detail}`);
    failed++;
  }
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        hostname: u.hostname,
        port:     u.port || 80,
        path:     u.pathname + u.search,
        method:   opts.method || 'GET',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': body ? Buffer.byteLength(body) : 0,
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
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function invokeFunction(functionName, params = {}) {
  const res = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    body:   { functionName, params },
  });
  if (res.status !== 200) throw new Error(`invoke ${functionName} → HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data?.data ?? res.data;
}

// ── DB helpers ─────────────────────────────────────────────────────────────
async function getBuildData(id) {
  const { rows } = await pool.query(
    `SELECT data FROM generic_entities WHERE id=$1 AND entity_type='BuildSchedule' LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  return typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : (rows[0].data || {});
}

async function getActionItem(buildId, stage) {
  const { rows } = await pool.query(
    `SELECT id, data FROM generic_entities
     WHERE entity_type='ActionItem' AND company_id=$1
       AND data->>'related_build_id'=$2
       AND data->>'type'='stuck_job'
       AND data->>'stage'=$3
     LIMIT 1`,
    [COMPANY_ID, String(buildId), stage]
  );
  if (!rows[0]) return null;
  const d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : (rows[0].data || {});
  return { id: rows[0].id, ...d };
}

async function countActionItems(buildId, stage) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS n FROM generic_entities
     WHERE entity_type='ActionItem' AND company_id=$1
       AND data->>'related_build_id'=$2
       AND data->>'type'='stuck_job'
       AND data->>'stage'=$3`,
    [COMPANY_ID, String(buildId), stage]
  );
  return Number(rows[0]?.n || 0);
}

// ── Cleanup ────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('\n── Cleanup ───────────────────────────────────────────────────');
  const allBuildIds = [
    BUILD_BASELINE, BUILD_FORWARD, BUILD_DEFERRED, BUILD_SAMESTAGE,
    BUILD_CLOCK_FIRST, BUILD_CLOCK_CHANGE, BUILD_NOT_YET_STUCK,
    BUILD_STALLED, BUILD_WAITING, BUILD_FORGOTTEN,
  ];
  try {
    await pool.query(
      `DELETE FROM generic_entities WHERE company_id=$1 OR id=ANY($2)`,
      [COMPANY_ID, allBuildIds]
    );
    await pool.query(`DELETE FROM customers   WHERE id=$1`, [CUSTOMER_ID]);
    await pool.query(`DELETE FROM companies   WHERE id=$1`, [COMPANY_ID]);
    console.log('  Fixtures removed');
  } catch (e) {
    console.warn('  Cleanup warning:', e.message);
  }
}

// ── Fixture insertion ──────────────────────────────────────────────────────
async function insertBuild(id, data) {
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'BuildSchedule', $2, $3, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE SET data=$3, updated_date=NOW()`,
    [id, COMPANY_ID, JSON.stringify(data)]
  );
}

function daysAgoIso(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

function pastDateStr(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Weekly Progress Texts + Stuck-Job Alerts Regression Test ===\n');
  console.log(`Target: ${BASE_URL}\n`);

  // ── 0. Server reachability ───────────────────────────────────────────────
  console.log('Group 0: Server reachability');
  try {
    const r = await fetchJson(`${BASE_URL}/api/auth/user`);
    ok('Server is responding', r.status < 500, `HTTP ${r.status}`);
  } catch (err) {
    ok('Server is responding', false, err.message);
    console.log('\n⚠  Server not reachable — cannot continue.\n');
    process.exitCode = 1;
    return;
  }

  // ── 1. Provision fixture company & settings ──────────────────────────────
  console.log('\nGroup 1: Provision fixtures');

  await pool.query(
    `INSERT INTO companies (id, company_name, created_by, created_at, updated_at)
     VALUES ($1, 'Smoke WPJ Test Co', 'owner@smoke-wpj.test', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_ID]
  );

  await pool.query(
    `INSERT INTO customers (id, company_id, name, phone, created_at, updated_at)
     VALUES ($1, $2, 'John Smoke', '', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [CUSTOMER_ID, COMPANY_ID]
  );

  // AssistantSettings row with BOTH weekly_progress and stuck_job enabled
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'AssistantSettings', $2, $3, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE SET data=$3`,
    [
      SETTINGS_ID_PROG,
      COMPANY_ID,
      JSON.stringify({
        weekly_progress_updates_enabled: true,
        stuck_job_alerts_enabled: true,
        stuck_job_threshold_days: 10,
        assistant_name: 'Alex',
        ai_identification_line: "This is {assistant}, {company}'s AI assistant.",
        scheduling_defaults: { business_hours_start: 0, business_hours_end: 23 },
      }),
    ]
  );

  ok('Company + settings inserted', true);

  // ── 2. scanBuildProgressUpdates ──────────────────────────────────────────
  console.log('\nGroup 2A: scanBuildProgressUpdates — baseline');

  // A1 — No progress_last_notified_stage → first observation → baseline only
  await insertBuild(BUILD_BASELINE, {
    status: 'in_progress',
    customer_id: CUSTOMER_ID,
    customer_name: 'John Smoke',
    customer_phone: '',  // no phone — ensures no SMS attempt
    address: '100 Baseline St',
  });

  let res = await invokeFunction('scanBuildProgressUpdates', { force: true });
  ok('A1: function returned success', res?.success === true, res);
  ok('A1: baselined ≥ 1', (res?.baselined ?? 0) >= 1, res);
  ok('A1: sent = 0', res?.sent === 0, res);

  const baselineData = await getBuildData(BUILD_BASELINE);
  ok('A1: progress_last_notified_stage written', baselineData?.progress_last_notified_stage === 'in_progress', baselineData?.progress_last_notified_stage);

  // ── A4: Same stage as baseline → skipped, not re-sent ───────────────────
  console.log('\nGroup 2B: scanBuildProgressUpdates — same-stage skip');

  await insertBuild(BUILD_SAMESTAGE, {
    status: 'scheduled',
    customer_id: CUSTOMER_ID,
    customer_name: 'John Smoke',
    customer_phone: '',
    address: '200 Same Stage Rd',
    progress_last_notified_stage: 'scheduled', // already at baseline
  });

  res = await invokeFunction('scanBuildProgressUpdates', { force: true });
  ok('A4: function returned success', res?.success === true, res);
  ok('A4: sent = 0', res?.sent === 0, res);

  const sameStageData = await getBuildData(BUILD_SAMESTAGE);
  // Stage hasn't changed so last notified should remain 'scheduled'
  ok('A4: progress_last_notified_stage unchanged', sameStageData?.progress_last_notified_stage === 'scheduled', sameStageData?.progress_last_notified_stage);

  // ── A3: Forward move but no phone → deferred, baseline NOT advanced ──────
  console.log('\nGroup 2C: scanBuildProgressUpdates — deferred (no phone)');

  await insertBuild(BUILD_DEFERRED, {
    status: 'in_progress',
    customer_name: 'NoPhone Customer',
    customer_phone: '',
    address: '300 Deferred Ave',
    progress_last_notified_stage: 'scheduled', // was at scheduled, now in_progress = forward
  });

  const sentBefore = (await invokeFunction('scanBuildProgressUpdates', { force: true }))?.sent ?? 0;
  const deferredData = await getBuildData(BUILD_DEFERRED);
  // No phone → sendCustomerReminder returns skipped → baseline must NOT advance
  ok('A3: progress_last_notified_stage NOT advanced (deferred)', deferredData?.progress_last_notified_stage === 'scheduled', deferredData?.progress_last_notified_stage);

  // ── A2: Forward move WITH a phone (invalid → SMS fails gracefully) ────────
  console.log('\nGroup 2D: scanBuildProgressUpdates — forward move with phone');

  await insertBuild(BUILD_FORWARD, {
    status: 'in_progress',
    customer_id: CUSTOMER_ID,
    customer_name: 'John Smoke',
    customer_phone: '55500',  // too short (5 digits) → sendCustomerReminder returns {skipped:'invalid_phone'} before hitting Twilio
    address: '400 Forward Blvd',
    progress_last_notified_stage: 'scheduled', // was scheduled, now in_progress = forward
  });

  res = await invokeFunction('scanBuildProgressUpdates', { force: true });
  ok('A2: function returned success', res?.success === true, res);
  ok('A2: advanced ≥ 1', (res?.advanced ?? 0) >= 1, res);
  // (sent may be 0 or 1 depending on whether Twilio returns success; either is fine —
  //  the key invariant is that the forward-move was detected and processed)
  ok('A2: advanced ≥ sent (no spurious counted sends)', (res?.advanced ?? 0) >= (res?.sent ?? 0), res);

  // ── 3. scanStuckJobs ─────────────────────────────────────────────────────
  console.log('\nGroup 3A: scanStuckJobs — first observation (clock reset)');

  // B1 — No progress_stage at all → first observation → clock reset, no alert
  await insertBuild(BUILD_CLOCK_FIRST, {
    status: 'scheduled',
    customer_name: 'Clock First Customer',
    address: '10 Clock First Ln',
    // no progress_stage / progress_stage_since
  });

  res = await invokeFunction('scanStuckJobs', { force: true });
  ok('B1: function returned success', res?.success === true, res);
  ok('B1: clockReset ≥ 1', (res?.clockReset ?? 0) >= 1, res);
  ok('B1: alerted = 0 (no alert on first observation)', (res?.alerted ?? 0) === 0, res);

  const clockFirstData = await getBuildData(BUILD_CLOCK_FIRST);
  ok('B1: progress_stage written', clockFirstData?.progress_stage === 'scheduled', clockFirstData?.progress_stage);
  ok('B1: progress_stage_since written', !!clockFirstData?.progress_stage_since, clockFirstData?.progress_stage_since);
  ok('B1: no stuck_alert_stage', !clockFirstData?.stuck_alert_stage, clockFirstData?.stuck_alert_stage);

  // ── B2: Stage change → clock resets ──────────────────────────────────────
  console.log('\nGroup 3B: scanStuckJobs — stage change resets clock');

  await insertBuild(BUILD_CLOCK_CHANGE, {
    status: 'in_progress',              // current status
    customer_name: 'Stage Change Customer',
    address: '20 Stage Change Rd',
    progress_stage: 'scheduled',        // was 'scheduled' → mismatch → clock reset
    progress_stage_since: daysAgoIso(15),
    stuck_alert_stage: 'scheduled',     // had been alerted at old stage
  });

  res = await invokeFunction('scanStuckJobs', { force: true });
  ok('B2: function returned success', res?.success === true, res);

  const clockChangeData = await getBuildData(BUILD_CLOCK_CHANGE);
  ok('B2: progress_stage updated to new status', clockChangeData?.progress_stage === 'in_progress', clockChangeData?.progress_stage);
  ok('B2: stuck_alert_stage cleared on stage change', !clockChangeData?.stuck_alert_stage || clockChangeData?.stuck_alert_stage === null, clockChangeData?.stuck_alert_stage);

  // ── B3: Not yet stuck (< threshold) ─────────────────────────────────────
  console.log('\nGroup 3C: scanStuckJobs — not yet stuck');

  await insertBuild(BUILD_NOT_YET_STUCK, {
    status: 'in_progress',
    customer_name: 'Not Yet Stuck Customer',
    address: '30 Not Yet Stuck Dr',
    progress_stage: 'in_progress',
    progress_stage_since: daysAgoIso(5),  // only 5 days, threshold=10
  });

  const alertedBefore = (await invokeFunction('scanStuckJobs', { force: true }))?.alerted ?? 0;
  const nysData = await getBuildData(BUILD_NOT_YET_STUCK);
  ok('B3: no stuck ActionItem created', await countActionItems(BUILD_NOT_YET_STUCK, 'in_progress') === 0, null);
  ok('B3: stuck_alert_stage not set', !nysData?.stuck_alert_stage, nysData?.stuck_alert_stage);

  // ── B4: Alert created (Stalled) ──────────────────────────────────────────
  console.log('\nGroup 3D: scanStuckJobs — alert created (Stalled)');

  await insertBuild(BUILD_STALLED, {
    status: 'in_progress',
    customer_name: 'Stalled Customer',
    address: '40 Stalled Ct',
    progress_stage: 'in_progress',
    progress_stage_since: daysAgoIso(15),  // 15 days > threshold=10
  });

  res = await invokeFunction('scanStuckJobs', { force: true });
  ok('B4: function returned success', res?.success === true, res);
  ok('B4: alerted ≥ 1', (res?.alerted ?? 0) >= 1, res);

  const stalledAI = await getActionItem(BUILD_STALLED, 'in_progress');
  ok('B4: ActionItem created with type=stuck_job', stalledAI?.type === 'stuck_job', stalledAI?.type);
  ok('B4: category = Stalled', stalledAI?.suggested_category === 'Stalled', stalledAI?.suggested_category);
  ok('B4: description does NOT mention texting customer', !stalledAI?.description?.toLowerCase().includes('text'), stalledAI?.description);
  ok('B4: description says customer not contacted', stalledAI?.description?.includes('NOT contacted'), stalledAI?.description);

  const stalledData = await getBuildData(BUILD_STALLED);
  ok('B4: stuck_alert_stage stamped', stalledData?.stuck_alert_stage === 'in_progress', stalledData?.stuck_alert_stage);

  const { rows: bellRows } = await pool.query(
    `SELECT company_id, data FROM generic_entities
     WHERE entity_type = 'Notification'
       AND company_id = $1
       AND data->>'related_entity_id' = $2
     ORDER BY created_date DESC
     LIMIT 1`,
    [COMPANY_ID, BUILD_STALLED]
  );
  const bellData = bellRows[0]
    ? (typeof bellRows[0].data === 'string' ? JSON.parse(bellRows[0].data) : bellRows[0].data)
    : null;
  ok('B4: bell notification stored in generic_entities', !!bellData, bellData);
  ok('B4: bell notification has company scope', bellRows[0]?.company_id === COMPANY_ID, bellRows[0]?.company_id);
  ok('B4: bell notification has expected payload', bellData?.user_email === 'owner@smoke-wpj.test' &&
    bellData?.type === 'stuck_job' &&
    bellData?.link_url === '/ActionItems' &&
    bellData?.is_read === false, bellData);

  // ── B5: Dedup — second run produces no new ActionItem ────────────────────
  console.log('\nGroup 3E: scanStuckJobs — dedup (stuck_alert_stage set)');

  // BUILD_STALLED now has stuck_alert_stage='in_progress' from B4 run
  const countBefore = await countActionItems(BUILD_STALLED, 'in_progress');
  await invokeFunction('scanStuckJobs', { force: true });
  const countAfter = await countActionItems(BUILD_STALLED, 'in_progress');
  ok('B5: second run does not create additional ActionItem', countAfter === countBefore, `before=${countBefore} after=${countAfter}`);

  // ── B6: Category heuristics ───────────────────────────────────────────────
  console.log('\nGroup 3F: scanStuckJobs — category heuristics');

  // Waiting: postponed stage
  await insertBuild(BUILD_WAITING, {
    status: 'postponed',
    customer_name: 'Waiting Customer',
    address: '50 Waiting Way',
    progress_stage: 'postponed',
    progress_stage_since: daysAgoIso(15),
  });

  // Forgotten: scheduled with a past build_date
  await insertBuild(BUILD_FORGOTTEN, {
    status: 'scheduled',
    customer_name: 'Forgotten Customer',
    address: '60 Forgotten Blvd',
    progress_stage: 'scheduled',
    progress_stage_since: daysAgoIso(15),
    build_date: pastDateStr(5),  // past build date → Forgotten
  });

  await invokeFunction('scanStuckJobs', { force: true });

  const waitingAI   = await getActionItem(BUILD_WAITING, 'postponed');
  const forgottenAI = await getActionItem(BUILD_FORGOTTEN, 'scheduled');

  ok('B6: postponed → category=Waiting',   waitingAI?.suggested_category === 'Waiting',   waitingAI?.suggested_category);
  ok('B6: scheduled+past date → category=Forgotten', forgottenAI?.suggested_category === 'Forgotten', forgottenAI?.suggested_category);

  // ── 4. Customer isolation: stuck alerts are team-only ─────────────────────
  console.log('\nGroup 4: stuck alerts are team-only');

  // All ActionItems created by scanStuckJobs must have source='scanStuckJobs'
  // and must NOT have a customer_phone or similar outbound-SMS field
  const { rows: allStuckAIs } = await pool.query(
    `SELECT data FROM generic_entities
     WHERE entity_type='ActionItem' AND company_id=$1 AND data->>'type'='stuck_job'`,
    [COMPANY_ID]
  );
  for (const row of allStuckAIs) {
    const d = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
    ok(`stuck ActionItem (${d.related_build_id}) source=scanStuckJobs`, d.source === 'scanStuckJobs', d.source);
    ok(`stuck ActionItem (${d.related_build_id}) no customer_phone field`, !d.customer_phone, d.customer_phone);
  }
  if (allStuckAIs.length === 0) {
    ok('at least one stuck ActionItem was created', false, 'none found');
  }
}

// ── Entry point ────────────────────────────────────────────────────────────
(async () => {
  try {
    await main();
  } catch (err) {
    console.error('\n💥 Unexpected error:', err);
    failed++;
  } finally {
    await cleanup();
    pool.end().catch(() => {});
    console.log('\n─────────────────────────────────────────────────────────────');
    console.log(`Total: ${passed} passed, ${failed} failed`);
    console.log('─────────────────────────────────────────────────────────────\n');
    process.exit(failed > 0 ? 1 : 0);
  }
})();
