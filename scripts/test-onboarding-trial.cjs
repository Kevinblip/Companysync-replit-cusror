#!/usr/bin/env node
/**
 * Onboarding Trial Smoke Test (end-to-end, live server)
 * ─────────────────────────────────────────────────────
 * Proves the REAL sign-up flow still works after the subscription lockdown
 * (tenant-guard strips + guarded startCompanyTrial), by driving the same
 * HTTP calls QuickSetup.jsx makes:
 *
 *   1. POST /api/local/entity/Company            (forged subscription fields in body)
 *        -> created, subscription_status forced to 'pending', forged fields stripped,
 *           created_by stamped from the session
 *   2. POST /api/local/entity/StaffProfile        (owner profile for the new company)
 *        -> allowed (created_by claim), so the no-company guard doesn't break onboarding
 *   3. POST /api/functions/invoke startCompanyTrial
 *        -> subscription_status becomes 'trial' with a ~14-day end date and
 *           server-side plan limits
 *   4. NEGATIVE: PUT /api/local/entity/Company/:id trying to self-activate
 *      ('active' status, extended trial, raised limits, incl. nested data.*)
 *        -> silently stripped; status stays 'trial', trial end unchanged
 *   5. NEGATIVE: second startCompanyTrial while already on trial
 *        -> never re-extends trial_ends_at (no perpetual trial)
 *
 * Prerequisites:
 *   - The app server must be running on PORT (default 5000)  — `npm run dev`
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *
 * Usage:  node scripts/test-onboarding-trial.cjs
 *
 * All fixture IDs use a stable "smoke_trial_" prefix and the script cleans up
 * after itself (even on failure), so repeated runs never accumulate test data.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const OWNER_EMAIL = 'smoke-trial-owner@example.com';
const OWNER_UID = 'smoke_trial_owner_user';
const SID = 'smoke_trial_owner_session';
const MARKETING_EMAIL = `smoke-marketing-owner-${process.pid}@example.com`;
const PUBLIC_EMAIL = 'smoke-public-owner@example.com';
const CONFIRM_EMAIL = 'smoke-confirmed-owner@example.com';

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else { console.log(`  \u2717 ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`); failed++; }
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => { let d; try { d = JSON.parse(b); } catch { d = b; } resolve({ status: res.statusCode, data: d }); });
      }
    );
    req.on('error', reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

// Effective field value: real column first, then the data JSONB blob (some
// deployments only have these fields inside data — mirror the handler's reads).
function effective(row, field) {
  if (row[field] !== undefined && row[field] !== null && row[field] !== '') return row[field];
  if (row.data && typeof row.data === 'object') return row.data[field] ?? null;
  return null;
}

function toDateOnly(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v).split('T')[0];
}

function daysFromTodayUTC(dateOnly) {
  if (!dateOnly) return null;
  const today = new Date().toISOString().split('T')[0];
  return Math.round((new Date(dateOnly + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
}

// extraCompanyId: belt-and-suspenders — if created_by stamping ever regresses
// (the very failure step 1 detects), the LOWER(created_by) match below wouldn't
// find the orphaned company row, so we also delete by the captured id.
async function cleanup(extraCompanyId) {
  const { rows } = await pool.query('SELECT id FROM companies WHERE LOWER(created_by) = $1', [OWNER_EMAIL]);
  for (const r of rows) await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [r.id]);
  if (extraCompanyId) await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [extraCompanyId]);
  await pool.query('DELETE FROM staff_profiles WHERE LOWER(COALESCE(user_email, email)) = $1', [OWNER_EMAIL]);
  await pool.query('DELETE FROM companies WHERE LOWER(created_by) = $1', [OWNER_EMAIL]);
  if (extraCompanyId) await pool.query('DELETE FROM companies WHERE id = $1', [extraCompanyId]);
  await pool.query('DELETE FROM users WHERE id = $1 OR LOWER(email) = $2', [OWNER_UID, OWNER_EMAIL]);
  await pool.query('DELETE FROM sessions WHERE sid = $1', [SID]);
  const { rows: marketingCompanies } = await pool.query(
    'SELECT id FROM companies WHERE LOWER(created_by) = $1',
    [MARKETING_EMAIL]
  );
  for (const row of marketingCompanies) await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [row.id]);
  await pool.query('DELETE FROM staff_profiles WHERE LOWER(COALESCE(user_email, email)) = $1', [MARKETING_EMAIL]);
  await pool.query('DELETE FROM companies WHERE LOWER(created_by) = $1', [MARKETING_EMAIL]);
  const { rows: publicCompanies } = await pool.query(
    'SELECT id FROM companies WHERE LOWER(created_by) = $1',
    [PUBLIC_EMAIL]
  );
  for (const row of publicCompanies) await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [row.id]);
  await pool.query('DELETE FROM staff_profiles WHERE LOWER(COALESCE(user_email, email)) = $1', [PUBLIC_EMAIL]);
  await pool.query('DELETE FROM companies WHERE LOWER(created_by) = $1', [PUBLIC_EMAIL]);
  const { rows: confirmedCompanies } = await pool.query(
    'SELECT id FROM companies WHERE LOWER(created_by) = $1',
    [CONFIRM_EMAIL]
  );
  for (const row of confirmedCompanies) await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [row.id]);
  await pool.query('DELETE FROM staff_profiles WHERE LOWER(COALESCE(user_email, email)) = $1', [CONFIRM_EMAIL]);
  await pool.query('DELETE FROM users WHERE LOWER(email) = $1', [CONFIRM_EMAIL]);
  await pool.query('DELETE FROM companies WHERE LOWER(created_by) = $1', [CONFIRM_EMAIL]);
  await pool.query('DELETE FROM pending_signups WHERE LOWER(email) = $1', [CONFIRM_EMAIL]);
}

// Wait for the dev server to accept requests (workflow may start before `npm run dev` is up).
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

async function getCompanyRow(id) {
  const { rows } = await pool.query('SELECT * FROM companies WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
}

(async () => {
  if (!process.env.SESSION_SECRET) {
    console.error('[onboarding-trial] SESSION_SECRET is not set — cannot forge a session. Aborting.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('[onboarding-trial] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  if (!(await waitForServer())) {
    console.error(`[onboarding-trial] Server at ${BASE_URL} did not respond within 60s. Is 'Start application' running?`);
    await pool.end();
    process.exit(1);
  }

  let companyId = null;
  try {
    await cleanup();

    // ── Seed: brand-new user with NO company membership + signed session ────
    await pool.query(
      `INSERT INTO users (id, email, first_name, created_at, updated_at) VALUES ($1, $2, 'SmokeTrial', NOW(), NOW())`,
      [OWNER_UID, OWNER_EMAIL]
    );
    const sess = { cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' }, passport: { user: { claims: { email: OWNER_EMAIL } } } };
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
      [SID, JSON.stringify(sess), new Date(Date.now() + 3600000)]
    );
    const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(SID).digest('base64').replace(/=+$/, '');
    const Cookie = `connect.sid=${encodeURIComponent(`s:${SID}.${sig}`)}`;

    // ── Step 1: Company create with FORGED subscription fields ──────────────
    console.log('[onboarding-trial] Step 1: Company create (forged subscription fields must be stripped)');
    const co = await fetchJson(`${BASE_URL}/api/local/entity/Company`, {
      method: 'POST',
      headers: { Cookie },
      body: {
        company_name: 'Smoke Trial Roofing',
        email: OWNER_EMAIL,
        setup_completed: false,
        // Forged — every one of these must be stripped / overridden:
        subscription_status: 'active',
        subscription_plan: 'enterprise',
        trial_ends_at: '2099-12-31',
        trial_end_date: '2099-12-31',
        max_users: 9999,
        max_customers: 9999999,
        data: { subscription_status: 'active', trial_ends_at: '2099-12-31', max_customers: 9999999 },
      },
    });
    ok(`Company create returns 201 (got ${co.status})`, co.status === 201 || co.status === 200);
    companyId = co.data && co.data.id;
    ok('Company create returned an id', !!companyId);

    let row = await getCompanyRow(companyId);
    ok('company row exists in DB', !!row);
    ok(`subscription_status forced to 'pending'`, effective(row, 'subscription_status') === 'pending', effective(row, 'subscription_status'));
    ok('forged trial_ends_at stripped', toDateOnly(effective(row, 'trial_ends_at')) !== '2099-12-31', toDateOnly(effective(row, 'trial_ends_at')));
    ok('forged max_users stripped', Number(effective(row, 'max_users') || 0) !== 9999, effective(row, 'max_users'));
    ok('forged max_customers stripped', Number(effective(row, 'max_customers') || 0) !== 9999999, effective(row, 'max_customers'));
    ok(`created_by stamped from session`, String(row.created_by || '').toLowerCase() === OWNER_EMAIL, row.created_by);

    // ── Step 2: Owner StaffProfile create (created_by claim path) ───────────
    console.log('[onboarding-trial] Step 2: owner StaffProfile create');
    const sp = await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
      method: 'POST',
      headers: { Cookie },
      body: {
        company_id: companyId,
        user_email: OWNER_EMAIL,
        full_name: 'Smoke Trial Owner',
        position: 'Owner',
        is_administrator: true,
        is_active: true,
      },
    });
    ok(`owner StaffProfile create returns 201 (got ${sp.status})`, sp.status === 201 || sp.status === 200);

    // ── Step 3: startCompanyTrial flips 'pending' -> 14-day 'trial' ─────────
    console.log('[onboarding-trial] Step 3: startCompanyTrial');
    const trial = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      headers: { Cookie },
      body: { functionName: 'startCompanyTrial', params: { companyId, plan: 'basic' } },
    });
    ok(`invoke returns 200 (got ${trial.status})`, trial.status === 200);
    ok('startCompanyTrial did not return an error', !(trial.data && trial.data.data && trial.data.data.error), trial.data && trial.data.data && trial.data.data.error);

    row = await getCompanyRow(companyId);
    ok(`subscription_status is 'trial'`, effective(row, 'subscription_status') === 'trial', effective(row, 'subscription_status'));
    ok(`subscription_plan is 'basic'`, effective(row, 'subscription_plan') === 'basic', effective(row, 'subscription_plan'));
    const trialEnd = toDateOnly(effective(row, 'trial_ends_at'));
    const days = daysFromTodayUTC(trialEnd);
    ok(`trial_ends_at ~14 days out (got ${trialEnd}, ${days}d)`, days !== null && days >= 13 && days <= 15);
    const trialEndCol = toDateOnly(effective(row, 'trial_end_date'));
    ok(`trial_end_date matches trial_ends_at`, trialEndCol === trialEnd, trialEndCol);
    ok('max_users set to plan limit (5)', Number(effective(row, 'max_users')) === 5, effective(row, 'max_users'));
    ok('max_customers set to plan limit (100)', Number(effective(row, 'max_customers')) === 100, effective(row, 'max_customers'));

    // ── Step 4 (negative): entity-API PUT cannot self-activate ──────────────
    console.log('[onboarding-trial] Step 4: PUT self-activation attempt must be stripped');
    const put = await fetchJson(`${BASE_URL}/api/local/entity/Company/${companyId}`, {
      method: 'PUT',
      headers: { Cookie },
      body: {
        subscription_status: 'active',
        subscription_plan: 'enterprise',
        trial_ends_at: '2099-12-31',
        trial_end_date: '2099-12-31',
        max_users: 9999,
        max_customers: 9999999,
        data: { subscription_status: 'active', trial_ends_at: '2099-12-31' },
        // An innocuous field so the update body isn't empty after stripping:
        phone: '555-0100',
      },
    });
    ok(`PUT request itself succeeds (got ${put.status}) — fields are stripped, not rejected`, put.status === 200);

    row = await getCompanyRow(companyId);
    ok(`status still 'trial' after PUT 'active'`, effective(row, 'subscription_status') === 'trial', effective(row, 'subscription_status'));
    ok('trial_ends_at unchanged after PUT', toDateOnly(effective(row, 'trial_ends_at')) === trialEnd, toDateOnly(effective(row, 'trial_ends_at')));
    ok(`plan still 'basic' after PUT 'enterprise'`, effective(row, 'subscription_plan') === 'basic', effective(row, 'subscription_plan'));
    ok('max_users still 5 after PUT 9999', Number(effective(row, 'max_users')) === 5, effective(row, 'max_users'));
    ok('innocuous field DID apply (phone)', effective(row, 'phone') === '555-0100', effective(row, 'phone'));

    // ── Step 5 (negative): re-running startCompanyTrial never extends ───────
    console.log('[onboarding-trial] Step 5: second startCompanyTrial must not re-extend the trial');
    const trial2 = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      headers: { Cookie },
      body: { functionName: 'startCompanyTrial', params: { companyId, plan: 'business' } },
    });
    ok(`second invoke returns 200 (got ${trial2.status})`, trial2.status === 200);
    row = await getCompanyRow(companyId);
    ok('trial_ends_at NOT re-extended by second call', toDateOnly(effective(row, 'trial_ends_at')) === trialEnd, toDateOnly(effective(row, 'trial_ends_at')));
    ok(`status still 'trial'`, effective(row, 'subscription_status') === 'trial', effective(row, 'subscription_status'));

    // ── Step 6: marketing signup shares the guarded trial transition ────────
    // @example.com proves the no-real-alert exclusion while exercising the
    // browser-facing marketing handler end-to-end.
    console.log('[onboarding-trial] Step 6: marketing signup starts one trial and rejects retry');
    const marketing = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      body: {
        functionName: 'autoSignupFromMarketing',
        params: {
          userData: { email: MARKETING_EMAIL, full_name: 'Marketing Smoke Owner' },
          companyData: { name: 'Marketing Smoke Trial Co', plan_type: 'business', industry: 'roofing' },
        },
      },
    });
    const marketingResult = marketing.data?.data;
    ok(`marketing invoke returns 200 (got ${marketing.status})`, marketing.status === 200);
    ok('marketing signup succeeds', marketingResult?.success === true, marketingResult);
    const marketingRow = await getCompanyRow(marketingResult?.company_id);
    ok('marketing signup creates a trial company', effective(marketingRow || {}, 'subscription_status') === 'trial', effective(marketingRow || {}, 'subscription_status'));
    ok('marketing signup applies selected plan', effective(marketingRow || {}, 'subscription_plan') === 'business', effective(marketingRow || {}, 'subscription_plan'));

    const marketingRetry = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      body: {
        functionName: 'autoSignupFromMarketing',
        params: {
          userData: { email: MARKETING_EMAIL, full_name: 'Marketing Smoke Owner' },
          companyData: { name: 'Marketing Smoke Trial Co', plan_type: 'business' },
        },
      },
    });
    const marketingRetryResult = marketingRetry.data?.data ?? marketingRetry.data;
    ok('marketing retry is rejected instead of creating another company', marketingRetryResult?.success === false, marketingRetryResult);
    const { rows: marketingCompanies } = await pool.query(
      'SELECT id FROM companies WHERE LOWER(created_by) = $1',
      [MARKETING_EMAIL]
    );
    ok('marketing retry leaves exactly one company', marketingCompanies.length === 1, marketingCompanies.length);

    // ── Step 7: public onboarding takes the same transition ─────────────────
    console.log('[onboarding-trial] Step 7: public onboarding starts one trial');
    const publicSignup = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      body: {
        functionName: 'publicSignupInvite',
        params: {
          email: PUBLIC_EMAIL,
          full_name: 'Public Smoke Owner',
          selected_plan: 'enterprise',
          onboarding_data: { company_name: 'Public Smoke Trial Co', industry: 'roofing' },
        },
      },
    });
    const publicResult = publicSignup.data?.data;
    ok(`public signup invoke returns 200 (got ${publicSignup.status})`, publicSignup.status === 200);
    ok('public signup succeeds', publicResult?.success === true, publicResult);
    const publicRow = await getCompanyRow(publicResult?.company_id);
    ok('public signup creates a trial company', effective(publicRow || {}, 'subscription_status') === 'trial', effective(publicRow || {}, 'subscription_status'));
    ok('public signup applies selected plan', effective(publicRow || {}, 'subscription_plan') === 'enterprise', effective(publicRow || {}, 'subscription_plan'));

    // ── Step 8: legacy confirmed-email signup uses the shared transition ────
    console.log('[onboarding-trial] Step 8: confirmed-email signup starts one trial');
    const confirmationToken = `smoke-confirm-${Date.now()}`;
    await pool.query(
      `INSERT INTO pending_signups (id, email, company_name, verification_token, token_expires_at, is_confirmed, created_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', false, NOW())`,
      [`smoke_confirm_${Date.now()}`, CONFIRM_EMAIL, 'Confirmed Smoke Trial Co', confirmationToken]
    );
    const confirmed = await fetchJson(`${BASE_URL}/api/confirm-email?token=${encodeURIComponent(confirmationToken)}`);
    ok(`confirmed-email route returns 200 (got ${confirmed.status})`, confirmed.status === 200);
    const { rows: confirmedRows } = await pool.query(
      'SELECT * FROM companies WHERE LOWER(created_by) = $1',
      [CONFIRM_EMAIL]
    );
    ok('confirmed-email signup creates exactly one trial company', confirmedRows.length === 1 && effective(confirmedRows[0], 'subscription_status') === 'trial', confirmedRows.map(row => effective(row, 'subscription_status')));
  } catch (e) {
    console.error('[onboarding-trial] UNEXPECTED ERROR:', e);
    failed++;
  } finally {
    try { await cleanup(companyId); } catch (e) { console.error('[onboarding-trial] cleanup error:', e.message); }
    await pool.end();
  }

  console.log(`\n[onboarding-trial] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
