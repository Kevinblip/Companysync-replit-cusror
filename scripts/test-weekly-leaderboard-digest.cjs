#!/usr/bin/env node
/**
 * test:weekly-leaderboard-digest
 *
 * Verifies sendWeeklyLeaderboardDigest:
 *  - manual force_company_id run sends a digest for a fixture company only
 *  - top-3 ranking + biggest mover computed from last week's staff_score_events
 *  - opted-out staff (leaderboard_digest_email=false) are skipped, decoupled
 *    from the commission notification flags (commission opt-outs don't skip
 *    the leaderboard, and vice versa)
 *  - re-running is idempotent (per-company WeeklyLeaderboardDigest stamp)
 *
 *  Timezone window gate tests (via scope_company_id + simulated_now):
 *  - Mon 8:05am ET   → gate PASSES  (fires for America/New_York company)
 *  - Mon 8:16am ET   → gate BLOCKED (minute ≥ 15)
 *  - Sun 8:05am ET   → gate BLOCKED (wrong day)
 *  - Sun 23:05 UTC   → gate PASSES for Asia/Tokyo (Mon 8:05am JST) but BLOCKED for ET
 *                      (the critical UTC+ case: local Monday while UTC is still Sunday)
 *
 * Safety: force_company_id / scope_company_id are used so only fixture
 * companies are processed — real companies are never touched.
 * Email goes to Resend's official test address delivered@resend.dev.
 */
const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const pool = createPool({ connectionString: process.env.DATABASE_URL });

// Fixture company IDs
const CO      = 'loc_test_lbdigest';        // main digest / idempotency tests
const CO_ET   = 'loc_test_lbdigest_et';     // gate tests — America/New_York
const CO_JST  = 'loc_test_lbdigest_jst';   // gate tests — Asia/Tokyo

// Fixed simulated times for gate tests
// Aug 2 2026 = Sunday,  Aug 3 2026 = Monday
// EDT = UTC−4 in August
const MON_805_EDT  = '2026-08-03T12:05:00.000Z'; // Mon 8:05am ET  → PASS
const MON_816_EDT  = '2026-08-03T12:16:00.000Z'; // Mon 8:16am ET  → BLOCKED (min≥15)
const SUN_805_EDT  = '2026-08-02T12:05:00.000Z'; // Sun 8:05am ET  → BLOCKED (not Monday)
const SUN_2305_UTC = '2026-08-02T23:05:00.000Z'; // Sun 23:05 UTC = Mon 8:05am JST → PASS for JST

function invokeFunction(functionName, params = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${BASE_URL}/api/functions/invoke`);
    const body = JSON.stringify({ functionName, params });
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
          catch { resolve({ status: res.statusCode, body: b }); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

async function hasStamp(companyId) {
  const r = await pool.query(
    `SELECT id FROM generic_entities WHERE entity_type='WeeklyLeaderboardDigest' AND company_id=$1`,
    [companyId]
  );
  return r.rows.length > 0;
}

async function clearStamps(companyId) {
  await pool.query(
    `DELETE FROM generic_entities WHERE entity_type='WeeklyLeaderboardDigest' AND company_id=$1`,
    [companyId]
  );
}

async function cleanup() {
  for (const id of [CO, CO_ET, CO_JST]) {
    await pool.query(`DELETE FROM staff_score_events WHERE company_id = $1`, [id]);
    await pool.query(`DELETE FROM staff_profiles WHERE company_id = $1`, [id]);
    await pool.query(`DELETE FROM generic_entities WHERE company_id = $1`, [id]);
    await pool.query(`DELETE FROM companies WHERE id = $1`, [id]);
  }
}

(async () => {
  try {
    await cleanup();

    // ── Main fixture company (ET, has staff + score events) ──────────────────
    await pool.query(
      `INSERT INTO companies (id, name, company_name, timezone, data, created_at, updated_at)
       VALUES ($1, 'LB Digest Test Co', 'LB Digest Test Co', 'America/New_York', '{"timezone":"America/New_York"}'::jsonb, NOW(), NOW())`,
      [CO]
    );

    // Staff: A (recipient, top scorer + biggest mover), B (opted out), C (no phone)
    const mkStaff = (id, email, name, extra = {}) => pool.query(
      `INSERT INTO staff_profiles (id, company_id, user_email, email, full_name, is_active,
         cell_phone, twilio_number, commission_notify_email, commission_notify_weekly_digest, leaderboard_digest_email, created_at, updated_at)
       VALUES ($1, $2, $3, $3, $4, true, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [id, CO, email, name, extra.cell || null, extra.twilio || null,
       extra.notifyEmail !== false, extra.weekly !== false, extra.leaderboard !== false]
    );
    // Email-only fixture (no cell/twilio) so the delivery count is deterministic
    await mkStaff('stf_lbd_a', 'delivered@resend.dev', 'Alice Test', {});
    // Bob keeps commission emails ON but opts out of the leaderboard digest only
    await mkStaff('stf_lbd_b', 'bob@example.com', 'Bob OptedOut', { leaderboard: false });
    // Carl has commission notifications OFF but keeps the leaderboard digest —
    // proves the leaderboard toggle is decoupled from commission opt-outs
    await mkStaff('stf_lbd_c', 'delivered+carl@resend.dev', 'Carl NoPhone', { notifyEmail: false, weekly: false });

    // Week boundaries (UTC Mondays) matching the handler's math
    const now = new Date();
    const dow = now.getUTCDay();
    const thisMonday = new Date(now);
    thisMonday.setUTCDate(thisMonday.getUTCDate() - (dow === 0 ? 6 : dow - 1));
    thisMonday.setUTCHours(0, 0, 0, 0);
    const lastMonday = new Date(thisMonday.getTime() - 7 * 86400000);
    const priorMonday = new Date(thisMonday.getTime() - 14 * 86400000);
    const weekKey = lastMonday.toISOString().slice(0, 10);
    const midLast = new Date(lastMonday.getTime() + 2 * 86400000).toISOString();
    const midPrior = new Date(priorMonday.getTime() + 2 * 86400000).toISOString();

    let seq = 0;
    const ev = (email, name, points, when) => pool.query(
      `INSERT INTO staff_score_events (id, company_id, staff_email, staff_name, event_type, points, created_at)
       VALUES ($1, $2, $3, $4, 'test_event', $5, $6)`,
      [`sse_lbd_${++seq}`, CO, email, name, points, when]
    );
    // Last week: Alice 50, Bob 30, Carl 10. Prior week: Alice 10 (+40 mover), Carl 40 (-30)
    await ev('delivered@resend.dev', 'Alice Test', 50, midLast);
    await ev('bob@example.com', 'Bob OptedOut', 30, midLast);
    await ev('delivered+carl@resend.dev', 'Carl NoPhone', 10, midLast);
    await ev('delivered@resend.dev', 'Alice Test', 10, midPrior);
    await ev('delivered+carl@resend.dev', 'Carl NoPhone', 40, midPrior);

    // Run 1
    const r1 = await invokeFunction('sendWeeklyLeaderboardDigest', { force_company_id: CO });
    const b1 = r1.body?.data || r1.body || {};
    check('first run succeeds', r1.status === 200 && b1.success === true, JSON.stringify(b1));
    check('first run sent 1 company digest', b1.sent === 1, `sent=${b1.sent}`);

    // Stamp record + contents
    const stamp = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type='WeeklyLeaderboardDigest' AND company_id=$1`, [CO]);
    check('exactly one stamp record', stamp.rows.length === 1);
    const d = stamp.rows[0] ? (typeof stamp.rows[0].data === 'string' ? JSON.parse(stamp.rows[0].data) : stamp.rows[0].data) : {};
    check('week_key matches last Monday', d.week_key === weekKey, `${d.week_key} vs ${weekKey}`);
    check('top #1 is Alice with 50 pts', d.top?.[0]?.email === 'delivered@resend.dev' && d.top?.[0]?.points === 50, JSON.stringify(d.top));
    check('top has 3 entries', Array.isArray(d.top) && d.top.length === 3);
    check('biggest mover is Alice +40', d.biggest_mover?.name === 'Alice Test' && d.biggest_mover?.gain === 40, JSON.stringify(d.biggest_mover));
    // Alice: email = 1; Carl (commission-opted-out, leaderboard on): email = 1;
    // Bob (leaderboard-opted-out, commission on): skipped entirely.
    check('deliveries = 2 (Alice + Carl emails; leaderboard-opted-out Bob skipped)', d.deliveries === 2, `deliveries=${d.deliveries}`);

    // Run 2: idempotent
    const r2 = await invokeFunction('sendWeeklyLeaderboardDigest', { force_company_id: CO });
    const b2 = r2.body?.data || r2.body || {};
    check('second run sends nothing (idempotent)', b2.success === true && b2.sent === 0, JSON.stringify(b2));
    const stamp2 = await pool.query(
      `SELECT id FROM generic_entities WHERE entity_type='WeeklyLeaderboardDigest' AND company_id=$1`, [CO]);
    check('still exactly one stamp record', stamp2.rows.length === 1);

    // ── Timezone window gate tests ───────────────────────────────────────────
    console.log('\n── Timezone window gate tests ──');

    // Minimal gate fixture companies (no staff needed — gate fires before score queries)
    await pool.query(
      `INSERT INTO companies (id, name, company_name, timezone, data, created_at, updated_at)
       VALUES ($1,'Gate Test ET','Gate Test ET','America/New_York','{"timezone":"America/New_York"}'::jsonb,NOW(),NOW())`,
      [CO_ET]
    );
    await pool.query(
      `INSERT INTO companies (id, name, company_name, timezone, data, created_at, updated_at)
       VALUES ($1,'Gate Test JST','Gate Test JST','Asia/Tokyo','{"timezone":"Asia/Tokyo"}'::jsonb,NOW(),NOW())`,
      [CO_JST]
    );

    // Gate test 1: Monday 8:05am EDT → PASS (stamp created even with no events)
    await clearStamps(CO_ET);
    const gPass = await invokeFunction('sendWeeklyLeaderboardDigest',
      { scope_company_id: CO_ET, simulated_now: MON_805_EDT });
    check('gate PASSES on Mon 8:05am ET (request succeeds)', gPass.status === 200 && gPass.body?.data?.success === true,
      JSON.stringify(gPass.body?.data));
    check('gate PASSES on Mon 8:05am ET (stamp created)', await hasStamp(CO_ET),
      'expected stamp row in WeeklyLeaderboardDigest');

    // Gate test 2: Monday 8:16am EDT → BLOCKED (minute ≥ 15)
    await clearStamps(CO_ET);
    const gMin = await invokeFunction('sendWeeklyLeaderboardDigest',
      { scope_company_id: CO_ET, simulated_now: MON_816_EDT });
    check('gate BLOCKED on Mon 8:16am ET (request succeeds)', gMin.status === 200 && gMin.body?.data?.success === true,
      JSON.stringify(gMin.body?.data));
    check('gate BLOCKED on Mon 8:16am ET (no stamp)', !(await hasStamp(CO_ET)),
      'expected no stamp row for out-of-window time');

    // Gate test 3: Sunday 8:05am EDT → BLOCKED (wrong day)
    await clearStamps(CO_ET);
    const gDay = await invokeFunction('sendWeeklyLeaderboardDigest',
      { scope_company_id: CO_ET, simulated_now: SUN_805_EDT });
    check('gate BLOCKED on Sun 8:05am ET (request succeeds)', gDay.status === 200 && gDay.body?.data?.success === true,
      JSON.stringify(gDay.body?.data));
    check('gate BLOCKED on Sun 8:05am ET (no stamp)', !(await hasStamp(CO_ET)),
      'expected no stamp row for wrong day');

    // Gate test 4: Sun 23:05 UTC = Mon 8:05am JST → PASS for Tokyo, BLOCKED for ET
    // This is the critical regression guard: UTC is Sunday but local Monday for UTC+ companies.
    await clearStamps(CO_ET);
    await clearStamps(CO_JST);
    const gJST = await invokeFunction('sendWeeklyLeaderboardDigest',
      { scope_company_id: CO_JST, simulated_now: SUN_2305_UTC });
    check('gate PASSES for Asia/Tokyo at Sun 23:05 UTC (Mon 8:05am JST) — request succeeds',
      gJST.status === 200 && gJST.body?.data?.success === true, JSON.stringify(gJST.body?.data));
    check('gate PASSES for Asia/Tokyo at Sun 23:05 UTC — stamp created',
      await hasStamp(CO_JST), 'expected stamp for JST company');

    const gETatJST = await invokeFunction('sendWeeklyLeaderboardDigest',
      { scope_company_id: CO_ET, simulated_now: SUN_2305_UTC });
    check('gate BLOCKED for America/New_York at Sun 23:05 UTC (still Sun 19:05 EDT) — request succeeds',
      gETatJST.status === 200 && gETatJST.body?.data?.success === true, JSON.stringify(gETatJST.body?.data));
    check('gate BLOCKED for America/New_York at Sun 23:05 UTC — no stamp',
      !(await hasStamp(CO_ET)), 'ET company must not fire when UTC is Sunday night');

  } catch (e) {
    check('test threw', false, e.message);
  } finally {
    try { await cleanup(); } catch (e) { console.warn('cleanup failed:', e.message); }
    await pool.end();
  }
  console.log(failures === 0 ? '\nAll checks passed ✅' : `\n${failures} check(s) failed ❌`);
  process.exit(failures === 0 ? 0 : 1);
})();
