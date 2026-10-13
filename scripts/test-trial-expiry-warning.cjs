#!/usr/bin/env node
/**
 * test:trial-expiry-warning
 *
 * Verifies the platform-admin churn heads-up in processTrialLifecycle:
 *  - a trial with ≤3 days remaining gets data.trial_expiry_warned_at stamped
 *  - a trial with >3 days remaining does NOT
 *  - re-running the cron does not re-warn (idempotent)
 *
 * Safety: the cron processes EVERY subscription_status='trial' company, so this
 * test temporarily moves all pre-existing matching rows to a hold status,
 * runs the cron against @example.com fixtures only, then restores them.
 * (@example.com owners take the send-skip path — no real email/SMS goes out.)
 */
const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const FIX_A = 'loc_test_expwarn_a'; // 2 days remaining → should warn
const FIX_B = 'loc_test_expwarn_b'; // 7 days remaining → should NOT warn
const HOLD = '__expwarn_test_hold__';

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

const dateOnly = (daysFromToday) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
};

let held = [];
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

async function main() {
  // 1) Hold aside every pre-existing company the cron would pick up
  const { rows } = await pool.query(
    `SELECT id, subscription_status, data->>'subscription_status' AS jst
     FROM companies
     WHERE COALESCE(subscription_status, data->>'subscription_status') = 'trial'
       AND (is_deleted IS NULL OR is_deleted = false)
       AND id NOT IN ($1, $2)`, [FIX_A, FIX_B]
  );
  held = rows;
  for (const r of held) {
    await pool.query(`UPDATE companies SET subscription_status = $2 WHERE id = $1`, [r.id, HOLD]);
  }
  console.log(`Held ${held.length} pre-existing trial companies aside`);

  // 2) Fixtures
  const mk = async (id, name, ends) => {
    await pool.query(`DELETE FROM companies WHERE id = $1`, [id]);
    await pool.query(`DELETE FROM generic_entities WHERE id = $1`, [`trial-nurture-${id}`]);
    await pool.query(
      `INSERT INTO companies (id, company_name, email, created_by, subscription_status, subscription_plan, trial_end_date, data, created_at, updated_at)
       VALUES ($1, $2, $3, $3, 'trial', 'trial', $4::timestamp, $5::jsonb, NOW(), NOW())`,
      [id, name, `${id}@example.com`, ends, JSON.stringify({ subscription_status: 'trial', trial_ends_at: ends })]
    );
    // Pre-mark all nurture touches as sent so the cron doesn't attempt drip emails
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'TrialNurtureLog', $2, $3, NOW(), NOW())`,
      [`trial-nurture-${id}`, id, JSON.stringify({ sent: { day1:true,day2:true,day3:true,day4:true,day5:true,day6:true,day7:true,day8:true,day9:true,day10:true,day11:true,day12:true,day13:true,day14:true } })]
    );
  };
  await mk(FIX_A, 'ExpWarn Test A (2d left)', dateOnly(2));
  await mk(FIX_B, 'ExpWarn Test B (7d left)', dateOnly(7));

  // 3) Run the cron
  const r1 = await invokeFunction('processTrialLifecycle');
  check('cron run 1 succeeded', r1.status === 200, JSON.stringify(r1.body).slice(0, 200));

  const flag = async (id) =>
    (await pool.query(`SELECT data->>'trial_expiry_warned_at' AS w FROM companies WHERE id = $1`, [id])).rows[0]?.w || null;

  const warnA1 = await flag(FIX_A);
  const warnB1 = await flag(FIX_B);
  check('company at 2 days remaining got trial_expiry_warned_at stamped', !!warnA1, String(warnA1));
  check('company at 7 days remaining NOT stamped', !warnB1, String(warnB1));

  // 4) Idempotency — run again, stamp must not change / no re-warn
  const r2 = await invokeFunction('processTrialLifecycle');
  check('cron run 2 succeeded', r2.status === 200);
  const warnA2 = await flag(FIX_A);
  check('re-run does not re-warn (stamp unchanged)', warnA2 === warnA1, `${warnA1} vs ${warnA2}`);

  // 5) Status untouched (warning must not expire the trial)
  const st = (await pool.query(`SELECT subscription_status FROM companies WHERE id = $1`, [FIX_A])).rows[0]?.subscription_status;
  check('warned company still in trial status', st === 'trial', String(st));
}

async function cleanup() {
  for (const r of held) {
    await pool.query(`UPDATE companies SET subscription_status = $2 WHERE id = $1`, [r.id, r.subscription_status]).catch(() => {});
  }
  await pool.query(`DELETE FROM generic_entities WHERE company_id IN ($1,$2)`, [FIX_A, FIX_B]).catch(() => {});
  await pool.query(`DELETE FROM companies WHERE id IN ($1,$2)`, [FIX_A, FIX_B]).catch(() => {});
  await pool.end();
}

main()
  .catch((e) => { console.error('❌ Test crashed:', e); failures++; })
  .finally(async () => {
    await cleanup();
    console.log(failures === 0 ? '\n🎉 ALL TESTS PASSED' : `\n💥 ${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  });
