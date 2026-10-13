#!/usr/bin/env node
/**
 * E2E test for Task #672 — action-started free trials must actually expire
 * at the voice-access gate.
 *
 * Exercises the REAL localCheckVoiceAccess exported from
 * vite-twilio-ws-plugin.js against the dev database. The prod-server.cjs copy
 * is kept in lockstep by convention (same logic, verified by review).
 *
 * Cases:
 *  1. Action-started trial, expired, date only in data->>'trial_ends_at'
 *     (legacy rows before the trial_end_date column write) -> BLOCKED
 *  2. Action-started trial, expired, date in trial_end_date column
 *     (new writes + backfilled rows) -> BLOCKED
 *  3. Action-started trial, still active (future end date)  -> ALLOWED
 *  4. subscription_status='expired' (cron already flipped it) -> BLOCKED
 *  5. Paid company (status='active', no trial dates)          -> ALLOWED
 *  6. Expired trial BUT live stripe_subscription_id (converted to paid,
 *     webhook gap left status='trial')                        -> ALLOWED
 *
 * All rows use subscription_plan='basic' — the pre-fix gate keyed on
 * plan==='trial' and would have allowed every one of these expired trials.
 */

const { createPool } = require('./lib/db-pool.cjs');

const IDS = {
  jsonbExpired: 'test672_jsonb_expired',
  colExpired: 'test672_col_expired',
  activeTrial: 'test672_active_trial',
  statusExpired: 'test672_status_expired',
  paid: 'test672_paid',
  convertedStripe: 'test672_converted_stripe',
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set — run inside the Replit workspace.');
    process.exit(1);
  }

  const { localCheckVoiceAccess } = await import('../vite-twilio-ws-plugin.js');
  const pool = createPool({ connectionString: process.env.DATABASE_URL });

  const cleanup = () =>
    pool.query(`DELETE FROM companies WHERE id = ANY($1)`, [Object.values(IDS)]);

  let failures = 0;
  const check = (label, cond) => {
    if (cond) {
      console.log(`  ✓ ${label}`);
    } else {
      console.error(`  ✗ FAIL: ${label}`);
      failures++;
    }
  };

  try {
    await cleanup();

    await pool.query(
      `INSERT INTO companies (id, name, subscription_plan, subscription_status, trial_end_date, stripe_subscription_id, data) VALUES
       ($1, 'T672 JSONB expired', 'basic', 'trial', NULL, NULL, '{"trial_ends_at":"2026-06-01"}'::jsonb),
       ($2, 'T672 col expired',   'basic', 'trial', NOW() - INTERVAL '3 days', NULL, '{}'::jsonb),
       ($3, 'T672 active trial',  'basic', 'trial', NOW() + INTERVAL '10 days', NULL, '{"trial_ends_at":"2099-01-01"}'::jsonb),
       ($4, 'T672 status expired','basic', 'expired', NULL, NULL, '{}'::jsonb),
       ($5, 'T672 paid',          'business', 'active', NULL, NULL, '{}'::jsonb),
       ($6, 'T672 converted',     'business', 'trial', NOW() - INTERVAL '3 days', 'sub_test672live', '{"trial_ends_at":"2026-06-01"}'::jsonb)`,
      [IDS.jsonbExpired, IDS.colExpired, IDS.activeTrial, IDS.statusExpired, IDS.paid, IDS.convertedStripe]
    );

    console.log('[test] expired trial with date only in data JSONB (legacy action trial)');
    let r = await localCheckVoiceAccess(IDS.jsonbExpired);
    check('blocked', r.allowed === false);
    check('reason mentions trial', /trial/i.test(r.reason || ''));

    console.log('[test] expired trial with trial_end_date column set (new/backfilled)');
    r = await localCheckVoiceAccess(IDS.colExpired);
    check('blocked', r.allowed === false);

    console.log('[test] trial still active (future end date)');
    r = await localCheckVoiceAccess(IDS.activeTrial);
    check('allowed', r.allowed === true);

    console.log("[test] subscription_status='expired' (cron flipped it)");
    r = await localCheckVoiceAccess(IDS.statusExpired);
    check('blocked', r.allowed === false);

    console.log('[test] paid active company');
    r = await localCheckVoiceAccess(IDS.paid);
    check('allowed', r.allowed === true);

    console.log('[test] expired trial dates BUT live stripe_subscription_id (converted subscriber)');
    r = await localCheckVoiceAccess(IDS.convertedStripe);
    check('allowed (never lock out a paying customer)', r.allowed === true);
  } finally {
    await cleanup();
    await pool.end();
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll voice-access trial-expiry assertions passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
