#!/usr/bin/env node
/**
 * Outlook Calendar disconnect alert smoke test.
 *
 * Drives the real sync handler with an invalid access token so Microsoft Graph
 * returns the 401 that triggers credential clearing, alert-once claiming, and
 * the persistent reconnect state. Fixtures use example.com and are always
 * removed, including bell notifications.
 */
'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });
const USER_EMAIL = 'smoke-mscal-user@example.com';
const USER_SID = 'smoke_mscal_user_session';
const COMPANY_ID = 'smoke_mscal_company';
const EVENT_IDS = ['smoke_mscal_event_1', 'smoke_mscal_event_2'];
let passed = 0;
let failed = 0;

function ok(name, condition, actual) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${actual === undefined ? '' : ` (got ${JSON.stringify(actual)})`}`);
    failed++;
  }
}

function forgeSessionCookie(sid) {
  const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid).digest('base64').replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body ? JSON.stringify(options.body) : null;
    const request = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.headers || {}),
      },
    }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: response.statusCode, json, raw: data });
      });
    });
    request.on('error', reject);
    request.setTimeout(120000, () => request.destroy(new Error('timeout')));
    if (body) request.write(body);
    request.end();
  });
}

const invoke = (functionName, params = {}) => fetchJson(`${BASE_URL}/api/functions/invoke`, {
  method: 'POST',
  headers: { Cookie: forgeSessionCookie(USER_SID) },
  body: { functionName, params },
});

const alertWhere = `entity_type = 'Notification'
  AND company_id = $2
  AND data->>'user_email' = $1
  AND data->>'type' = 'microsoft_calendar_disconnected'`;

async function countAlerts() {
  return (await pool.query(
    `SELECT COUNT(*)::int AS n FROM generic_entities WHERE ${alertWhere}`,
    [USER_EMAIL, COMPANY_ID]
  )).rows[0].n;
}

async function clearAlerts() {
  await pool.query(`DELETE FROM generic_entities WHERE ${alertWhere}`, [USER_EMAIL, COMPANY_ID]).catch(() => {});
}

async function cleanup() {
  await clearAlerts();
  await pool.query('DELETE FROM calendar_events WHERE id = ANY($1)', [EVENT_IDS]).catch(() => {});
  await pool.query('DELETE FROM sessions WHERE sid = $1', [USER_SID]).catch(() => {});
  await pool.query('DELETE FROM staff_profiles WHERE user_email = $1', [USER_EMAIL]).catch(() => {});
  await pool.query('DELETE FROM users WHERE email = $1', [USER_EMAIL]).catch(() => {});
  await pool.query('DELETE FROM companies WHERE id = $1', [COMPANY_ID]).catch(() => {});
}

async function armConnection({ keepAlertState }) {
  await pool.query(
    `UPDATE users SET microsoft_calendar_connected = true,
       microsoft_access_token = 'smoke-mscal-invalid-access-token',
       microsoft_refresh_token = 'smoke-mscal-invalid-refresh-token',
       microsoft_token_expires_at = NOW() + INTERVAL '1 hour',
       microsoft_sync_enabled = true
       ${keepAlertState ? '' : ', microsoft_disconnect_alerted_at = NULL'}
     WHERE email = $1`,
    [USER_EMAIL]
  );
}

async function setup() {
  await cleanup();
  await pool.query(
    `INSERT INTO companies (id, company_name, created_by, created_at, updated_at)
     VALUES ($1, 'Smoke Outlook Co', $2, NOW(), NOW())`,
    [COMPANY_ID, USER_EMAIL]
  );
  await pool.query(
    `INSERT INTO users (id, email, first_name, company_id, is_local_auth, created_at, updated_at)
     VALUES ($1, $2, 'Smoke', $3, true, NOW(), NOW())`,
    [crypto.randomUUID(), USER_EMAIL, COMPANY_ID]
  );
  await pool.query(
    `INSERT INTO staff_profiles (id, company_id, user_email, email, is_active, is_administrator, created_at, updated_at)
     VALUES ($1, $2, $3, $3, true, true, NOW(), NOW())`,
    [crypto.randomUUID(), COMPANY_ID, USER_EMAIL]
  );
  const expire = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)`,
    [USER_SID, JSON.stringify({
      cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/', expires: expire.toISOString() },
      passport: { user: { claims: { email: USER_EMAIL } } },
    }), expire]
  );
  for (let i = 0; i < EVENT_IDS.length; i++) {
    const start = new Date(Date.now() + (i + 1) * 86400000);
    const end = new Date(start.getTime() + 3600000);
    await pool.query(
      `INSERT INTO calendar_events
         (id, company_id, title, assigned_to, start_time, end_time, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [EVENT_IDS[i], COMPANY_ID, `Smoke Outlook Appointment ${i + 1}`, USER_EMAIL, start, end]
    );
  }
}

async function disconnectAndRead(label) {
  const response = await invoke('syncMicrosoftCalendar');
  const data = response.json?.data ?? response.json;
  ok(`${label} sync reports reconnect required`, data?.needsReconnect === true, data);
  return data;
}

async function main() {
  console.log('\nOutlook Calendar Disconnect Alert — smoke test');
  console.log('─'.repeat(74));
  if (!process.env.SESSION_SECRET || !process.env.DATABASE_URL) {
    console.error('SESSION_SECRET and DATABASE_URL must be set.');
    process.exit(1);
  }

  try {
    // Shared development databases can occasionally have a queued schema lock.
    // Fail clearly instead of leaving CI or a developer shell hanging forever.
    await pool.query(`SET statement_timeout = '30s'`);
    await setup();

    console.log('\nA) First detected disconnect');
    await armConnection({ keepAlertState: false });
    await disconnectAndRead('first');
    const first = (await pool.query(
      `SELECT microsoft_calendar_connected, microsoft_access_token,
              microsoft_refresh_token, microsoft_disconnect_alerted_at
       FROM users WHERE email = $1`,
      [USER_EMAIL]
    )).rows[0];
    ok('credentials cleared',
      first.microsoft_calendar_connected === false
      && first.microsoft_access_token === null
      && first.microsoft_refresh_token === null,
      first);
    ok('alert claim recorded', first.microsoft_disconnect_alerted_at !== null);
    ok('exactly one bell alert created', (await countAlerts()) === 1, await countAlerts());

    console.log('\nB) Repeat detection stays idempotent');
    await armConnection({ keepAlertState: true });
    await disconnectAndRead('repeat');
    ok('no duplicate bell alert created', (await countAlerts()) === 1, await countAlerts());

    console.log('\nC) Status endpoint drives the persistent banner');
    const statusResponse = await invoke('checkMicrosoftCalendarConnection');
    const status = statusResponse.json?.data ?? statusResponse.json;
    ok('reports disconnected', status?.connected === false, status);
    ok('reports reconnect needed', status?.needs_reconnect === true, status);
    ok('reports two unsynced appointments', status?.unsynced_events === 2, status?.unsynced_events);

    console.log('\nD) Reconnect re-arms a future alert');
    await pool.query(
      `UPDATE users SET microsoft_calendar_connected = true,
       microsoft_access_token = 'reconnected', microsoft_refresh_token = 'reconnected',
       microsoft_token_expires_at = NOW() + INTERVAL '1 hour',
       microsoft_sync_enabled = true, microsoft_disconnect_alerted_at = NULL,
       updated_at = NOW() WHERE email = $1`,
      [USER_EMAIL]
    );
    const reconnectedResponse = await invoke('checkMicrosoftCalendarConnection');
    const reconnected = reconnectedResponse.json?.data ?? reconnectedResponse.json;
    ok('reconnect clears banner state', reconnected?.connected === true && !reconnected?.needs_reconnect, reconnected);

    await clearAlerts();
    await armConnection({ keepAlertState: true });
    await disconnectAndRead('post-reconnect');
    ok('a new disconnect alerts after reconnect', (await countAlerts()) === 1, await countAlerts());
  } catch (error) {
    console.error('\nTest run error:', error);
    failed++;
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log('\n' + '─'.repeat(74));
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();