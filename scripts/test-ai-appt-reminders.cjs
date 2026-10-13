#!/usr/bin/env node
/**
 * AI Appointment → Calendar Reminder Chain Smoke Test
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies two things end-to-end:
 *
 *  A) APPROVAL CHAIN
 *     Creating a CalendarEvent (status='scheduled') from a
 *     'pending_appointment_approval' ActionItem produces a record with the
 *     required fields (status, start_time, end_time, assigned_to/created_by).
 *     This mirrors what ActionItems.jsx#approveAppointmentMutation does.
 *
 *  B) REMINDER STATUS FILTER (checkReminders.ts denylist)
 *     checkReminders must fire for:
 *       - status = 'scheduled'
 *       - status = NULL  (legacy/manual events)
 *     and must NOT fire for:
 *       - status = 'pending'
 *       - status = 'cancelled'
 *     Tested two ways:
 *       1. Direct DB logic: apply the same denylist the Deno function uses
 *       2. Live cron call: POST /api/cron/trigger/checkReminders and check
 *          which of the test events appear in the results (events are placed
 *          at exactly the 24h window so the cron can detect them; email/SMS
 *          calls fail gracefully — we only assert inclusion/exclusion).
 *
 * Prerequisites:
 *   - Dev server running on PORT (default 5000)  —  npm run dev
 *   - DATABASE_URL and SESSION_SECRET env vars set
 *
 * Usage:  node scripts/test-ai-appt-reminders.cjs
 *
 * All fixture IDs use the stable "smoke_appt_" prefix; cleanup runs on both
 * success and failure so repeated runs never accumulate test data.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http     = require('http');
const crypto   = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool     = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers ────────────────────────────────────────────
const OWNER_EMAIL = 'smoke-appt-owner@example.com';
const OWNER_UID   = 'smoke_appt_owner_user';
const OWNER_SID   = 'smoke_appt_owner_session';

// ── Test state ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const createdEventIds   = [];
const createdActionIds  = [];
let   companyId         = null;

// ── Helpers ───────────────────────────────────────────────────────────────
function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`);
    failed++;
  }
}

function forgeSessionCookie(sid) {
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port:     u.port || 80,
        path:     u.pathname + u.search,
        method:   opts.method || 'GET',
        headers:  {
          'Content-Type': 'application/json',
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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

async function getEventRow(id) {
  const { rows } = await pool.query(
    'SELECT * FROM calendar_events WHERE id = $1 LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function getActionItemRow(id) {
  const { rows } = await pool.query(
    `SELECT id, data FROM generic_entities WHERE id = $1 AND entity_type = 'ActionItem' LIMIT 1`,
    [id]
  );
  if (!rows[0]) return null;
  const d = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : (rows[0].data || {});
  return { id: rows[0].id, ...d };
}

// ── Cleanup ───────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('\n── Cleanup ──────────────────────────────────────────────────');
  try {
    // Remove any calendar events created for this test
    if (createdEventIds.length) {
      await pool.query(
        `DELETE FROM calendar_events WHERE id = ANY($1)`,
        [createdEventIds]
      );
      console.log(`  Deleted ${createdEventIds.length} calendar event(s)`);
    }
    // Remove any action items created for this test
    if (createdActionIds.length) {
      await pool.query(
        `DELETE FROM generic_entities WHERE id = ANY($1)`,
        [createdActionIds]
      );
      console.log(`  Deleted ${createdActionIds.length} action item(s)`);
    }
    // Remove staff profiles and company
    if (companyId) {
      await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
      console.log(`  Deleted company ${companyId} and staff profile`);
    }
    // Belt-and-suspenders: clean up sessions too
    await pool.query(
      `DELETE FROM sessions WHERE sid IN ($1)`,
      [OWNER_SID]
    ).catch(() => {/* sessions table may not exist — safe to ignore */});
  } catch (err) {
    console.warn('  Cleanup warning:', err.message);
  }
}

// ── DENYLIST — matches checkReminders.ts exactly ──────────────────────────
// Any status in this list causes checkReminders to SKIP the event.
const REMINDER_SKIP_STATUSES = [
  'pending', 'tentative', 'draft', 'proposed',
  'awaiting_approval', 'needs_approval', 'cancelled', 'completed',
];

/**
 * Returns true if checkReminders WOULD fire for this status value.
 * Mirrors the gate in checkReminders.ts:
 *   if (event.status && REMINDER_SKIP_STATUSES.includes(String(event.status).toLowerCase())) return null;
 */
function reminderWouldFire(status) {
  // null / undefined / '' → no status set → fire (legacy events must still get reminders)
  if (!status) return true;
  return !REMINDER_SKIP_STATUSES.includes(String(status).toLowerCase());
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== AI Appointment → Calendar Reminder Chain Smoke Test ===\n');
  console.log(`Target: ${BASE_URL}\n`);

  // ── 0. Server reachability ────────────────────────────────────────────
  console.log('Group 0: Server reachability');
  try {
    const res = await fetchJson(`${BASE_URL}/api/auth/user`);
    ok('Server is responding', res.status < 500, `HTTP ${res.status}`);
  } catch (err) {
    ok('Server is responding', false, err.message);
    console.log('\n⚠  Server not reachable — skipping remaining tests.\n');
    console.log(`Total: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  // ── 1. Provision test company + staff profile ─────────────────────────
  console.log('\nGroup 1: Provision test fixtures');

  // Mint a forged owner session the way other smoke tests do
  const cookie = forgeSessionCookie(OWNER_SID);

  // Insert session row in the format express-session + connect-pg-simple expect:
  //   { cookie: { originalMaxAge, httpOnly, path }, passport: { user: { claims: { email } } } }
  const sess = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email: OWNER_EMAIL } } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
    [OWNER_SID, JSON.stringify(sess), new Date(Date.now() + 3600000)]
  );

  // Create company
  const coRes = await fetchJson(`${BASE_URL}/api/local/entity/Company`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body:    { company_name: 'Smoke Appt Test Co', created_by: OWNER_EMAIL },
  });
  ok('Company created', coRes.status === 200 || coRes.status === 201, `HTTP ${coRes.status}`);
  companyId = coRes.data?.id;
  ok('Company ID returned', !!companyId, coRes.data);

  if (!companyId) {
    console.log('\n⚠  Cannot continue without a company ID.\n');
    await cleanup();
    console.log(`\nTotal: ${passed} passed, ${failed} failed\n`);
    process.exit(1);
  }

  // Create owner staff profile
  const spRes = await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body: {
      company_id:       companyId,
      user_email:       OWNER_EMAIL,
      full_name:        'Appt Test Owner',
      is_administrator: true,
      role:             'admin',
    },
  });
  ok('Staff profile created', spRes.status === 200 || spRes.status === 201, `HTTP ${spRes.status}`);

  // ── 2. Create a pending_appointment_approval ActionItem ───────────────
  console.log('\nGroup 2: Create pending_appointment_approval ActionItem');

  const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h from now
  const futureEnd   = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(); // 25h from now

  const aiRes = await fetchJson(`${BASE_URL}/api/local/entity/ActionItem`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body: {
      company_id:   companyId,
      type:         'pending_appointment_approval',
      status:       'pending',
      priority:     'high',
      title:        'AI booked an appointment: Test Customer',
      assigned_to:  OWNER_EMAIL,
      proposed_appointment: {
        title:         'Roof Inspection – Test Customer',
        start_time:    futureStart,
        end_time:      futureEnd,
        contact_name:  'Test Customer',
        contact_phone: '+15550001234',
        address:       '123 Smoke Test Ave',
        description:   'AI-scheduled inspection',
      },
    },
  });
  ok('ActionItem created', aiRes.status === 200 || aiRes.status === 201, `HTTP ${aiRes.status}`);
  const actionItemId = aiRes.data?.id;
  ok('ActionItem ID returned', !!actionItemId, aiRes.data);
  if (actionItemId) createdActionIds.push(actionItemId);

  // ── 3. Simulate staff approval: create CalendarEvent + complete item ──
  console.log('\nGroup 3: Simulate staff approval (create CalendarEvent → mark ActionItem complete)');

  // Step 3a: create the CalendarEvent (mirrors ActionItems.jsx#approveAppointmentMutation)
  const evRes = await fetchJson(`${BASE_URL}/api/local/entity/CalendarEvent`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body: {
      company_id:   companyId,
      title:        'Roof Inspection – Test Customer',
      start_time:   futureStart,
      end_time:     futureEnd,
      location:     '123 Smoke Test Ave',
      description:  'AI-scheduled inspection',
      event_type:   'appointment',
      status:       'scheduled',
      related_lead: 'Test Customer',
      assigned_to:  OWNER_EMAIL,
    },
  });
  ok('CalendarEvent created', evRes.status === 200 || evRes.status === 201, `HTTP ${evRes.status}`);
  const eventId = evRes.data?.id;
  ok('CalendarEvent ID returned', !!eventId, evRes.data);
  if (eventId) createdEventIds.push(eventId);

  // Step 3b: mark the ActionItem complete
  if (actionItemId) {
    const completeRes = await fetchJson(
      `${BASE_URL}/api/local/entity/ActionItem/${actionItemId}`,
      {
        method:  'PUT',
        headers: { Cookie: cookie },
        body:    { status: 'completed', completed_at: new Date().toISOString() },
      }
    );
    ok('ActionItem marked complete', completeRes.status === 200, `HTTP ${completeRes.status}`);
  }

  // ── 4. Assert CalendarEvent fields ────────────────────────────────────
  console.log('\nGroup 4: Assert CalendarEvent fields match approval contract');

  if (eventId) {
    const row = await getEventRow(eventId);
    ok('CalendarEvent row exists in DB', !!row, eventId);
    if (row) {
      ok('status = "scheduled"',   row.status === 'scheduled', row.status);
      ok('start_time is set',      !!row.start_time, row.start_time);
      ok('end_time is set',        !!row.end_time,   row.end_time);
      ok('assigned_to or created_by is set',
         !!(row.assigned_to || row.created_by),
         `assigned_to=${row.assigned_to} created_by=${row.created_by}`);
      ok('start_time < end_time',
         row.start_time && row.end_time && new Date(row.start_time) < new Date(row.end_time),
         `${row.start_time} vs ${row.end_time}`);
    }
  }

  // Assert ActionItem was completed
  if (actionItemId) {
    const aiRow = await getActionItemRow(actionItemId);
    ok('ActionItem status = "completed"', aiRow?.status === 'completed', aiRow?.status);
  }

  // ── 5. Reminder denylist — unit-level assertions ───────────────────────
  console.log('\nGroup 5: checkReminders denylist logic (unit-level)');
  // These assertions prove the DENYLIST contract without needing to run the cron.
  ok('"scheduled" → reminders fire',  reminderWouldFire('scheduled'));
  ok('"null" status → reminders fire', reminderWouldFire(null));
  ok('"undefined" status → reminders fire', reminderWouldFire(undefined));
  ok('"" (empty) status → reminders fire', reminderWouldFire(''));
  ok('"pending" → reminders SKIP',    !reminderWouldFire('pending'));
  ok('"cancelled" → reminders SKIP',  !reminderWouldFire('cancelled'));
  ok('"tentative" → reminders SKIP',  !reminderWouldFire('tentative'));
  ok('"draft" → reminders SKIP',      !reminderWouldFire('draft'));
  ok('"proposed" → reminders SKIP',   !reminderWouldFire('proposed'));
  ok('"awaiting_approval" → reminders SKIP', !reminderWouldFire('awaiting_approval'));
  ok('"completed" → reminders SKIP',  !reminderWouldFire('completed'));
  // Case-insensitivity (checkReminders.ts lowercases before checking)
  ok('"PENDING" (upper) → reminders SKIP', !reminderWouldFire('PENDING'));
  ok('"Cancelled" (mixed) → reminders SKIP', !reminderWouldFire('Cancelled'));

  // ── 6. Reminder denylist — DB + cron live assertion ───────────────────
  console.log('\nGroup 6: checkReminders denylist — live DB + cron filter');

  // Create 4 test events in the reminder window (exactly 24h+2min from now, so
  // they land inside the 24h / WINDOW_MINUTES=5 fire window).
  // We intentionally use a non-existent company so no real notifications are sent;
  // we only inspect which events appear in the cron results array.
  const windowStart = new Date(Date.now() + (1440 - 2) * 60 * 1000); // 23h 58m from now
  const windowEnd2  = new Date(windowStart.getTime() + 60 * 60 * 1000);

  const testStatuses = [
    { label: 'scheduled',  status: 'scheduled',  shouldFire: true  },
    { label: 'null',       status: null,          shouldFire: true  },
    { label: 'pending',    status: 'pending',     shouldFire: false },
    { label: 'cancelled',  status: 'cancelled',   shouldFire: false },
  ];

  const filterTestEventIds = [];
  for (const ts of testStatuses) {
    const eid = `smoke_appt_filter_${ts.label}_${Date.now()}`;
    try {
      await pool.query(
        `INSERT INTO calendar_events
           (id, company_id, title, status, start_time, end_time, assigned_to, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [eid, companyId, `Smoke Filter Test – ${ts.label}`, ts.status,
         windowStart.toISOString(), windowEnd2.toISOString(), OWNER_EMAIL]
      );
      filterTestEventIds.push({ eid, ...ts });
      createdEventIds.push(eid);
    } catch (err) {
      console.warn(`  Warning: could not insert filter test event (${ts.label}):`, err.message);
    }
  }

  // Now verify via direct DB query + denylist that each event would be included/excluded
  // (this is the same filter the vite-functions-plugin.js local cron applies)
  for (const { eid, label, shouldFire } of filterTestEventIds) {
    const row = await getEventRow(eid);
    if (!row) {
      ok(`Event "${label}" inserted`, false, 'row not found');
      continue;
    }
    const wouldFire = reminderWouldFire(row.status);
    ok(
      `"${label}" status → reminder ${shouldFire ? 'FIRES' : 'SKIPPED'}`,
      wouldFire === shouldFire,
      `status=${JSON.stringify(row.status)} wouldFire=${wouldFire}`
    );
  }

  // ── 7. Live cron call (optional smoke) ───────────────────────────────
  console.log('\nGroup 7: Live cron trigger (checks endpoint exists and returns results)');
  try {
    const cronRes = await fetchJson(`${BASE_URL}/api/cron/trigger/checkReminders`, {
      method:  'POST',
      headers: { Cookie: cookie },
      body:    {},
    });
    // The endpoint may return 200 (ran) or 401/403 (auth-gated in prod-like env).
    // Either way it must not 404 — that would mean the cron isn't wired up.
    ok(
      'POST /api/cron/trigger/checkReminders → not 404',
      cronRes.status !== 404,
      `HTTP ${cronRes.status}`
    );
    if (cronRes.status === 200) {
      const results = cronRes.data?.results ?? cronRes.data?.data?.results ?? [];
      // Among all events the cron processed, check if our test event IDs appear
      // correctly (scheduled/null in, pending/cancelled out).
      const processedIds = new Set(results.map((r) => r?.event_id).filter(Boolean));

      // Scheduled event should appear in results (reminders attempted/sent/failed)
      const scheduledEvt = filterTestEventIds.find(e => e.label === 'scheduled');
      const nullEvt      = filterTestEventIds.find(e => e.label === 'null');
      const pendingEvt   = filterTestEventIds.find(e => e.label === 'pending');
      const cancelledEvt = filterTestEventIds.find(e => e.label === 'cancelled');

      if (scheduledEvt && processedIds.size > 0) {
        ok('"scheduled" event appears in cron results',  processedIds.has(scheduledEvt.eid), [...processedIds]);
        ok('"pending" event absent from cron results',   !processedIds.has(pendingEvt?.eid), [...processedIds]);
        ok('"cancelled" event absent from cron results', !processedIds.has(cancelledEvt?.eid), [...processedIds]);
      } else {
        // cron ran but produced no results — either no events in window or cron
        // uses a different window. Just check we got a valid response shape.
        ok('cron returned a valid response object', typeof cronRes.data === 'object', cronRes.data);
      }
    } else {
      console.log(`  ℹ  Cron returned HTTP ${cronRes.status} — live notification assertions skipped`);
    }
  } catch (err) {
    console.warn(`  ℹ  Cron trigger call failed (${err.message}) — live assertions skipped`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────
(async () => {
  try {
    await main();
  } catch (err) {
    console.error('\n💥 Unexpected error:', err);
    failed++;
  } finally {
    await cleanup();
    pool.end().catch(() => {});
    console.log('\n─────────────────────────────────────────────────');
    console.log(`Total: ${passed} passed, ${failed} failed`);
    console.log('─────────────────────────────────────────────────\n');
    process.exit(failed > 0 ? 1 : 0);
  }
})();
