#!/usr/bin/env node
/**
 * Google Calendar Disconnect Alert Smoke Test
 * ─────────────────────────────────────────────────────────────────────────
 * Google revokes calendar refresh tokens without warning (most often because
 * the OAuth consent screen is still in "Testing" mode, which expires them
 * every 7 days). The sync code always detected this and cleared the stored
 * credentials — but nothing told the user, so sync died silently and stayed
 * dead. This test locks in the alerting that makes it visible:
 *
 *  A) A rejected Google token clears the credentials AND raises the reconnect
 *     flag  (pre-existing behaviour — must not regress).
 *  B) Exactly ONE alert is sent per disconnect. The sync cron re-enters this
 *     path every 15 minutes, so a second run must NOT notify again.
 *  C) checkUserGoogleCalendarConnection surfaces needs_reconnect plus the
 *     count of CRM events that never reached Google.
 *  D) Reconnecting clears both the reconnect flag and the alert state, so a
 *     FUTURE disconnect is free to alert again.
 *  E) Events created while the connection was down still have no
 *     google_event_id, i.e. they remain queued for the push phase to backfill.
 *
 * The test drives the real HTTP handler with a deliberately invalid access
 * token, so Google itself returns the 401 that triggers the disconnect path.
 *
 * Prerequisites:
 *   - Dev server running on PORT (default 5000)  —  npm run dev
 *   - DATABASE_URL and SESSION_SECRET env vars set
 *   - Outbound network access to googleapis.com
 *
 * Usage:  node scripts/test-gcal-disconnect-alert.cjs
 *
 * All fixtures use the stable "smoke_gcal_" prefix; cleanup runs on both
 * success and failure so repeated runs never accumulate test data.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http     = require('http');
const crypto   = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool     = createPool({ connectionString: process.env.DATABASE_URL });

const USER_EMAIL  = 'smoke-gcal-user@example.com';
const USER_SID    = 'smoke_gcal_user_session';
const COMPANY_ID  = 'smoke_gcal_company';
const EVENT_IDS   = ['smoke_gcal_event_1', 'smoke_gcal_event_2'];

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`); failed++; }
}

function forgeSessionCookie(sid) {
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(sid)
    .digest('base64').replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = opts.body ? JSON.stringify(opts.body) : null;
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(opts.headers || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

const invoke = (functionName, params) => fetchJson(`${BASE_URL}/api/functions/invoke`, {
  method: 'POST',
  headers: { Cookie: forgeSessionCookie(USER_SID) },
  body: { functionName, params: params || {} },
});

/** Put the fixture user back into a "connected with a token Google will reject" state. */
async function armConnection({ keepAlertState }) {
  await pool.query(
    `UPDATE users SET
       google_calendar_connected = true,
       google_access_token = 'smoke-gcal-invalid-access-token',
       google_refresh_token = 'smoke-gcal-invalid-refresh-token',
       -- Future expiry so the sync skips the refresh branch (which needs
       -- GOOGLE_CLIENT_ID/SECRET) and goes straight to Google's 401.
       google_token_expires_at = NOW() + INTERVAL '1 hour',
       google_sync_enabled = true,
       google_calendar_reconnect_needed = false
       ${keepAlertState ? '' : ', google_disconnect_alerted_at = NULL'}
     WHERE email = $1`,
    [USER_EMAIL]
  );
}

// Bell notifications live in generic_entities under entity_type 'Notification'.
const ALERT_SQL = `entity_type = 'Notification'
   AND data->>'user_email' = $1 AND data->>'type' = 'calendar_disconnected'`;

const countAlerts = async () => (await pool.query(
  `SELECT COUNT(*)::int AS n FROM generic_entities WHERE ${ALERT_SQL}`, [USER_EMAIL]
)).rows[0].n;

const clearAlerts = () => pool.query(
  `DELETE FROM generic_entities WHERE ${ALERT_SQL}`, [USER_EMAIL]).catch(() => {});

async function cleanup() {
  await clearAlerts();
  await pool.query('DELETE FROM calendar_events WHERE id = ANY($1)', [EVENT_IDS]).catch(() => {});
  await pool.query('DELETE FROM sessions WHERE sid = $1', [USER_SID]).catch(() => {});
  await pool.query('DELETE FROM staff_profiles WHERE user_email = $1', [USER_EMAIL]).catch(() => {});
  await pool.query('DELETE FROM users WHERE email = $1', [USER_EMAIL]).catch(() => {});
  await pool.query('DELETE FROM companies WHERE id = $1', [COMPANY_ID]).catch(() => {});
}

async function setup() {
  await cleanup();

  await pool.query(
    `INSERT INTO companies (id, company_name, created_by, created_at, updated_at)
     VALUES ($1, 'Smoke GCal Co', $2, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_ID, USER_EMAIL]
  );

  await pool.query(
    `INSERT INTO users (id, email, first_name, company_id, is_local_auth, created_at, updated_at)
     VALUES ($1, $2, 'Smoke', $3, true, NOW(), NOW())`,
    [crypto.randomUUID(), USER_EMAIL, COMPANY_ID]
  );

  const expire = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
    [USER_SID, JSON.stringify({
      // `expires` matters: connect-pg-simple reads it when it rehydrates the
      // row, and a fixture without it makes express-session throw on touch.
      cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/', expires: expire.toISOString() },
      passport: { user: { claims: { email: USER_EMAIL } } },
    }), expire]
  );

  // Two appointments booked while the calendar was (about to be) dead. They
  // carry no google_event_id, which is exactly the backfill queue.
  for (let i = 0; i < EVENT_IDS.length; i++) {
    const start = new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO calendar_events (id, company_id, title, assigned_to, start_time, end_time, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [EVENT_IDS[i], COMPANY_ID, `Smoke GCal Appointment ${i + 1}`, USER_EMAIL, start, end]
    );
  }
}

async function main() {
  console.log('\nGoogle Calendar Disconnect Alert — smoke test');
  console.log('─'.repeat(74));

  if (!process.env.SESSION_SECRET || !process.env.DATABASE_URL) {
    console.error('SESSION_SECRET and DATABASE_URL must be set.');
    process.exit(1);
  }

  try {
    await setup();

    // ── A. First disconnect: credentials cleared, flag raised, ONE alert ──
    console.log('\nA) First detected disconnect');
    await armConnection({ keepAlertState: false });
    const first = await invoke('syncUserGoogleCalendar', {});
    const firstData = first.json?.data ?? first.json;
    if (!firstData) console.log('    [debug] HTTP', first.status, first.raw.slice(0, 300));
    ok('sync reports the connection needs reconnecting',
      firstData?.needsReconnect === true || firstData?.disconnected === true, firstData);

    const afterFirst = (await pool.query(
      `SELECT google_calendar_connected, google_access_token, google_refresh_token,
              google_calendar_reconnect_needed, google_disconnect_alerted_at
       FROM users WHERE email = $1`, [USER_EMAIL])).rows[0];
    ok('credentials cleared (pre-existing behaviour preserved)',
      afterFirst.google_calendar_connected === false &&
      afterFirst.google_access_token === null &&
      afterFirst.google_refresh_token === null, afterFirst);
    ok('reconnect flag raised', afterFirst.google_calendar_reconnect_needed === true);
    ok('alert timestamp recorded', afterFirst.google_disconnect_alerted_at !== null);
    ok('exactly one in-app alert created', (await countAlerts()) === 1, await countAlerts());

    // ── B. Idempotency: the 15-minute cron must not re-alert ──────────────
    console.log('\nB) Repeat disconnect on the next cron tick');
    await armConnection({ keepAlertState: true });
    const second = await invoke('syncUserGoogleCalendar', {});
    const secondData = second.json?.data ?? second.json;
    ok('sync still reports needs-reconnect', secondData?.needsReconnect === true, secondData);
    const afterSecond = (await pool.query(
      'SELECT google_calendar_connected, google_calendar_reconnect_needed FROM users WHERE email = $1',
      [USER_EMAIL])).rows[0];
    ok('credentials cleared again', afterSecond.google_calendar_connected === false);
    ok('reconnect flag still raised', afterSecond.google_calendar_reconnect_needed === true);
    ok('NO second alert sent', (await countAlerts()) === 1, await countAlerts());

    // ── C. Status endpoint surfaces the banner state ──────────────────────
    console.log('\nC) Connection status reported to the UI');
    const status = await invoke('checkUserGoogleCalendarConnection', {});
    const s = status.json?.data ?? status.json;
    ok('reports disconnected', s?.connected === false, s);
    ok('reports needs_reconnect so the banner renders', s?.needs_reconnect === true, s);
    ok('reports the 2 appointments that never reached Google', s?.unsynced_events === 2, s?.unsynced_events);

    // ── E. Backfill queue intact ──────────────────────────────────────────
    console.log('\nE) Events created while down are still queued for push');
    const queued = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM calendar_events WHERE id = ANY($1) AND google_event_id IS NULL`,
      [EVENT_IDS])).rows[0].n;
    ok('both appointments still have no google_event_id (push phase will create them)', queued === 2, queued);

    // ── D. Reconnect clears banner + re-arms alerting ─────────────────────
    console.log('\nD) Reconnect clears the alert state');
    // Mirrors exactly what the OAuth callbacks write on a successful reconnect.
    await pool.query(
      `UPDATE users SET google_calendar_connected = true, google_access_token = 'reconnected',
       google_refresh_token = 'reconnected', google_token_expires_at = NOW() + INTERVAL '1 hour',
       google_sync_enabled = true, google_calendar_reconnect_needed = false,
       google_disconnect_alerted_at = NULL, last_google_sync = NOW(), updated_at = NOW()
       WHERE email = $1`, [USER_EMAIL]);
    const reStatus = await invoke('checkUserGoogleCalendarConnection', {});
    const rs = reStatus.json?.data ?? reStatus.json;
    ok('status reports connected', rs?.connected === true, rs);
    ok('banner state gone', !rs?.needs_reconnect, rs);

    const rearmed = (await pool.query(
      'SELECT google_disconnect_alerted_at FROM users WHERE email = $1', [USER_EMAIL])).rows[0];
    ok('alert state re-armed for the next disconnect', rearmed.google_disconnect_alerted_at === null);

    // A fresh disconnect after reconnecting must alert again.
    await clearAlerts();
    await armConnection({ keepAlertState: true }); // keeps the NULL set above
    const third = await invoke('syncUserGoogleCalendar', {});
    const thirdData = third.json?.data ?? third.json;
    ok('post-reconnect disconnect detected', thirdData?.needsReconnect === true, thirdData);
    ok('a NEW alert is sent after a reconnect cycle', (await countAlerts()) === 1, await countAlerts());
  } catch (err) {
    console.error('\nTest run error:', err);
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
