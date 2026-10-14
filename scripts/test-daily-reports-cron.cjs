#!/usr/bin/env node
/**
 * Daily-report scheduler live smoke test
 * ───────────────────────────────────────
 * Regression guard for the complete sendScheduledDailyReports invoke path.
 *
 * A pure unit test can prove that 7:05 AM Pacific is inside the window, but it
 * cannot prove that the live handler uses the injected clock, scopes its query,
 * and actually reaches generateMorningReport. This test:
 *
 *   1. Seeds one disposable America/Los_Angeles company.
 *   2. Confirms unauthenticated normal and clock-override calls are rejected.
 *   3. Calls the real HTTP function-invoke endpoint through a signed super-admin
 *      session with 2026-08-06 14:05 UTC,
 *      which is 7:05 AM PDT.
 *   4. Confirms the response includes the fixture's `company:morning` entry.
 *   5. Removes all fixture records in every exit path.
 *
 * Prerequisites:
 *   - The app server must be running on PORT (default 5000) — `npm run dev`
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *
 * Usage: node scripts/test-daily-reports-cron.cjs
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const COMPANY_ID = 'smoke_daily_reports_cron_la_001';
const COMPANY_NAME = 'Smoke Daily Reports Cron LA';
const OWNER_ID = 'smoke_daily_reports_cron_owner_001';
const OWNER_EMAIL = 'smoke-daily-reports-cron@example.com';
const SESSION_ID = 'smoke_daily_reports_cron_session_001';
// August 6, 2026 at 14:05 UTC = 7:05 AM PDT.
const SIMULATED_NOW = '2026-08-06T14:05:00.000Z';
const EXPECTED_REPORT_DATE = '2026-08-06';

let passed = 0;
let failed = 0;

function ok(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail !== undefined ? ` (got ${JSON.stringify(detail)})` : ''}`);
    failed++;
  }
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname + target.search,
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', chunk => (responseBody += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(responseBody) });
          } catch {
            resolve({ status: res.statusCode, body: responseBody });
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('request timed out')));
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const response = await fetchJson(`${BASE_URL}/health`);
      if (response.status >= 200 && response.status < 500) return true;
    } catch {
      // The dev server may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

async function cleanup() {
  await pool.query(
    `DELETE FROM generic_entities WHERE company_id = $1`,
    [COMPANY_ID],
  ).catch(() => {});
  await pool.query(
    `DELETE FROM companies WHERE id = $1`,
    [COMPANY_ID],
  ).catch(() => {});
  await pool.query(
    `DELETE FROM sessions WHERE sid = $1`,
    [SESSION_ID],
  ).catch(() => {});
  await pool.query(
    `DELETE FROM users WHERE id = $1 OR LOWER(email) = LOWER($2)`,
    [OWNER_ID, OWNER_EMAIL],
  ).catch(() => {});
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('[daily-reports-cron] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }
  if (!process.env.SESSION_SECRET) {
    console.error('[daily-reports-cron] SESSION_SECRET is not set. Aborting.');
    await pool.end();
    process.exit(1);
  }

  if (!(await waitForServer())) {
    console.error(`[daily-reports-cron] Server at ${BASE_URL} did not respond within 60s.`);
    await pool.end();
    process.exit(1);
  }

  try {
    await cleanup();
    await pool.query(
      `INSERT INTO companies
        (id, company_name, timezone, subscription_status, created_at, updated_at)
       VALUES ($1, $2, 'America/Los_Angeles', 'active', NOW(), NOW())`,
      [COMPANY_ID, COMPANY_NAME],
    );

    const invokeBody = {
      functionName: 'sendScheduledDailyReports',
      params: {
        simulated_now: SIMULATED_NOW,
        scope_company_ids: [COMPANY_ID],
      },
    };

    const unauthorizedNormal = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      body: {
        functionName: 'sendScheduledDailyReports',
        params: {},
      },
    });
    const unauthorizedNormalResult = unauthorizedNormal.body?.data ?? unauthorizedNormal.body ?? {};
    const rejectedByInvokeAuth = unauthorizedNormal.status === 401
      && /authentication required/i.test(unauthorizedNormal.body?.error || '');
    ok('unauthenticated normal scheduler invocations are rejected',
      rejectedByInvokeAuth
        || (unauthorizedNormal.status === 200
          && unauthorizedNormalResult.success === false
          && /only run from the server/i.test(unauthorizedNormalResult.error || '')),
      unauthorizedNormalResult.error || unauthorizedNormal.body?.error || unauthorizedNormalResult,
    );
    const afterUnauthorized = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM generic_entities
        WHERE entity_type = 'DailyReport' AND company_id = $1`,
      [COMPANY_ID],
    );
    ok('rejected normal invocation creates no fixture report',
      afterUnauthorized.rows[0]?.count === 0,
      afterUnauthorized.rows[0],
    );

    const unauthorized = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      body: {
        functionName: 'sendScheduledDailyReports',
        params: { simulated_now: SIMULATED_NOW },
      },
    });
    const unauthorizedResult = unauthorized.body?.data ?? unauthorized.body ?? {};
    const rejectedOverrideByInvokeAuth = unauthorized.status === 401
      && /authentication required/i.test(unauthorized.body?.error || '');
    ok('unauthenticated scheduler overrides are rejected',
      rejectedOverrideByInvokeAuth
        || (unauthorized.status === 200
          && unauthorizedResult.success === false
          && /super-admin authentication/i.test(unauthorizedResult.error || '')),
      unauthorizedResult.error || unauthorized.body?.error || unauthorizedResult,
    );

    await pool.query(
      `INSERT INTO users
        (id, email, first_name, platform_role, created_at, updated_at)
       VALUES ($1, $2, 'SmokeDailyReports', 'super_admin', NOW(), NOW())`,
      [OWNER_ID, OWNER_EMAIL],
    );
    const session = {
      cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
      passport: { user: { claims: { email: OWNER_EMAIL } } },
    };
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire)
       VALUES ($1, $2::jsonb, $3)`,
      [SESSION_ID, JSON.stringify(session), new Date(Date.now() + 3600000)],
    );
    const signature = crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(SESSION_ID)
      .digest('base64')
      .replace(/=+$/, '');
    const cookie = `connect.sid=${encodeURIComponent(`s:${SESSION_ID}.${signature}`)}`;

    const unscoped = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: {
        functionName: 'sendScheduledDailyReports',
        params: { simulated_now: SIMULATED_NOW },
      },
    });
    const unscopedResult = unscoped.body?.data ?? unscoped.body ?? {};
    ok('authenticated simulated clocks still require an explicit company scope',
      unscoped.status === 200
        && unscopedResult.success === false
        && /requires at least one scope_company_ids/i.test(unscopedResult.error || ''),
      unscopedResult,
    );

    const response = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: invokeBody,
    });
    const result = response.body?.data ?? response.body ?? {};
    const expectedTrigger = `${COMPANY_NAME}:morning`;

    ok(`invoke returns 200 (got ${response.status})`, response.status === 200);
    ok('response has success:true', result.success === true, result);
    ok('only the scoped LA company is triggered in the morning window',
      Array.isArray(result.triggered)
        && result.triggered.length === 1
        && result.triggered[0] === expectedTrigger,
      result.triggered);

    const report = await pool.query(
      `SELECT data->>'report_date' AS report_date
       FROM generic_entities
       WHERE entity_type = 'DailyReport'
         AND company_id = $1
         AND data->>'report_type' = 'morning_briefing'`,
      [COMPANY_ID],
    );
    ok('triggered company produces a morning briefing for its local date',
      report.rows.some(row => row.report_date === EXPECTED_REPORT_DATE),
      report.rows,
    );
  } catch (error) {
    ok('test completes without an unexpected error', false, error.message);
  } finally {
    try {
      await cleanup();
    } catch (error) {
      console.error('[daily-reports-cron] cleanup error:', error.message);
    }
    await pool.end();
  }

  console.log(`\n[daily-reports-cron] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();