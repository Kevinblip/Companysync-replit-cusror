#!/usr/bin/env node
/**
 * Double-Booking Conflict Gate Smoke Test
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies that the calendar booking conflict check in vite-db-plugin.js
 * (and its mirror in db/prod-db.cjs) correctly:
 *
 *  A) Blocks an overlapping CalendarEvent for the same assignee → HTTP 409
 *     with conflict:true in the response body.
 *
 *  B) Allows a non-overlapping event for the same assignee (different time)
 *     → HTTP 200 or 201.
 *
 *  C) Allows an overlapping time window for a DIFFERENT assignee → HTTP 200
 *     or 201.
 *
 * Prerequisites:
 *   - Dev server running on PORT (default 5000)  —  npm run dev
 *   - DATABASE_URL and SESSION_SECRET env vars set
 *
 * Usage:  node scripts/test-double-booking-guard.cjs
 *
 * All fixture IDs use the stable "smoke_dbl_" prefix; cleanup runs on both
 * success and failure so repeated runs never accumulate test data.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http     = require('http');
const crypto   = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool     = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers ────────────────────────────────────────────
const OWNER_EMAIL  = 'smoke-dbl-owner@example.com';
const OWNER_SID    = 'smoke_dbl_owner_session';
const ASSIGNEE_A   = 'rep-alpha@smoke-dbl.example.com';
const ASSIGNEE_B   = 'rep-beta@smoke-dbl.example.com';

// ── Test state ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const createdEventIds = [];
let   companyId       = null;

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

async function createEvent(cookie, body) {
  return fetchJson(`${BASE_URL}/api/local/entity/CalendarEvent`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body,
  });
}

async function updateEvent(cookie, eventId, body) {
  return fetchJson(`${BASE_URL}/api/local/entity/CalendarEvent/${eventId}`, {
    method:  'PUT',
    headers: { Cookie: cookie },
    body,
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('\n── Cleanup ──────────────────────────────────────────────────');
  try {
    if (createdEventIds.length) {
      await pool.query(
        `DELETE FROM calendar_events WHERE id = ANY($1)`,
        [createdEventIds]
      );
      console.log(`  Deleted ${createdEventIds.length} calendar event(s)`);
    }
    if (companyId) {
      await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [companyId]);
      await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
      console.log(`  Deleted company ${companyId} and staff profiles`);
    }
    await pool.query(
      `DELETE FROM sessions WHERE sid = $1`,
      [OWNER_SID]
    ).catch(() => {/* sessions may not exist — safe to ignore */});
  } catch (err) {
    console.warn('  Cleanup warning:', err.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Double-Booking Conflict Gate Smoke Test ===\n');
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

  // ── 1. Provision test company + session ──────────────────────────────
  console.log('\nGroup 1: Provision test fixtures');

  const cookie = forgeSessionCookie(OWNER_SID);

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

  const coRes = await fetchJson(`${BASE_URL}/api/local/entity/Company`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body:    { company_name: 'Smoke DblBook Test Co', created_by: OWNER_EMAIL },
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

  // Create admin staff profile so tenant guard is satisfied
  const spRes = await fetchJson(`${BASE_URL}/api/local/entity/StaffProfile`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body: {
      company_id:       companyId,
      user_email:       OWNER_EMAIL,
      full_name:        'DblBook Test Owner',
      is_administrator: true,
      role:             'admin',
    },
  });
  ok('Staff profile created', spRes.status === 200 || spRes.status === 201, `HTTP ${spRes.status}`);

  // ── 2. Create the anchor event ────────────────────────────────────────
  console.log('\nGroup 2: Create anchor CalendarEvent (the first booking)');

  // Use a time window far in the future to avoid any accidental overlap with
  // real company events that might exist in the database.
  const base      = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
  const anchorStart = new Date(base.getTime()).toISOString();
  const anchorEnd   = new Date(base.getTime() + 2 * 60 * 60 * 1000).toISOString(); // +2 h

  const anchorRes = await createEvent(cookie, {
    company_id:  companyId,
    title:       'Anchor Inspection – Smoke Test',
    start_time:  anchorStart,
    end_time:    anchorEnd,
    event_type:  'appointment',
    status:      'scheduled',
    assigned_to: ASSIGNEE_A,
  });
  ok('Anchor event created (HTTP 200/201)', anchorRes.status === 200 || anchorRes.status === 201, `HTTP ${anchorRes.status}`);
  const anchorId = anchorRes.data?.id;
  ok('Anchor event ID returned', !!anchorId, anchorRes.data);
  if (anchorId) createdEventIds.push(anchorId);

  if (!anchorId) {
    console.log('\n⚠  Cannot continue without anchor event — aborting conflict tests.\n');
    return;
  }

  // ── 3. Overlapping event — same assignee → must 409 ──────────────────
  console.log('\nGroup 3: Overlapping event for same assignee → expect 409 conflict');

  // Overlap: starts 30 min into the anchor window, ends 30 min after
  const overlapStart = new Date(base.getTime() + 30 * 60 * 1000).toISOString();  // +30 min
  const overlapEnd   = new Date(base.getTime() + 2.5 * 60 * 60 * 1000).toISOString(); // +2.5 h

  const conflictRes = await createEvent(cookie, {
    company_id:  companyId,
    title:       'Conflicting Inspection – Smoke Test',
    start_time:  overlapStart,
    end_time:    overlapEnd,
    event_type:  'appointment',
    status:      'scheduled',
    assigned_to: ASSIGNEE_A,
  });
  ok('Overlapping same-assignee → HTTP 409', conflictRes.status === 409, `HTTP ${conflictRes.status}`);
  ok('Response body has conflict:true', conflictRes.data?.conflict === true, conflictRes.data);
  ok('Response body has an error message', typeof conflictRes.data?.error === 'string' && conflictRes.data.error.length > 0, conflictRes.data?.error);

  // Track if the server accidentally created it (shouldn't happen, but clean up if so)
  if (conflictRes.data?.id) createdEventIds.push(conflictRes.data.id);

  // ── 4. Exactly-touching boundary (end == start of next) → no conflict ─
  console.log('\nGroup 4: Back-to-back event (starts exactly when anchor ends) → expect success');

  const backToBackStart = anchorEnd; // starts exactly when anchor ends — not an overlap
  const backToBackEnd   = new Date(base.getTime() + 3 * 60 * 60 * 1000).toISOString(); // +3 h

  const backToBackRes = await createEvent(cookie, {
    company_id:  companyId,
    title:       'Back-to-Back Inspection – Smoke Test',
    start_time:  backToBackStart,
    end_time:    backToBackEnd,
    event_type:  'appointment',
    status:      'scheduled',
    assigned_to: ASSIGNEE_A,
  });
  // SQL: start_time < $4 AND end_time > $3  ⟹ touching (start == prev_end) should pass
  ok('Back-to-back same-assignee → HTTP 200/201', backToBackRes.status === 200 || backToBackRes.status === 201, `HTTP ${backToBackRes.status}`);
  if (backToBackRes.data?.id) createdEventIds.push(backToBackRes.data.id);

  // ── 5. Non-overlapping time (before anchor) → must succeed ────────────
  console.log('\nGroup 5: Non-overlapping event (different time, same assignee) → expect success');

  const beforeStart = new Date(base.getTime() - 3 * 60 * 60 * 1000).toISOString(); // 3 h before anchor
  const beforeEnd   = new Date(base.getTime() - 1 * 60 * 60 * 1000).toISOString(); // 1 h before anchor

  const noConflictTimeRes = await createEvent(cookie, {
    company_id:  companyId,
    title:       'Early Inspection – Smoke Test',
    start_time:  beforeStart,
    end_time:    beforeEnd,
    event_type:  'appointment',
    status:      'scheduled',
    assigned_to: ASSIGNEE_A,
  });
  ok('Non-overlapping time same-assignee → HTTP 200/201', noConflictTimeRes.status === 200 || noConflictTimeRes.status === 201, `HTTP ${noConflictTimeRes.status}`);
  if (noConflictTimeRes.data?.id) createdEventIds.push(noConflictTimeRes.data.id);

  // ── 6. Overlapping time, different assignee → must succeed ─────────────
  console.log('\nGroup 6: Overlapping time for DIFFERENT assignee → expect success');

  const diffAssigneeRes = await createEvent(cookie, {
    company_id:  companyId,
    title:       'Parallel Inspection – Smoke Test',
    start_time:  overlapStart,
    end_time:    overlapEnd,
    event_type:  'appointment',
    status:      'scheduled',
    assigned_to: ASSIGNEE_B,   // ← different rep
  });
  ok('Overlapping time different-assignee → HTTP 200/201', diffAssigneeRes.status === 200 || diffAssigneeRes.status === 201, `HTTP ${diffAssigneeRes.status}`);
  if (diffAssigneeRes.data?.id) createdEventIds.push(diffAssigneeRes.data.id);

  // ── 7. Cancelled event does NOT trigger a conflict ─────────────────────
  console.log('\nGroup 7: Overlapping cancelled event → conflict gate skips it');

  // First, create a cancelled event in the anchor window with assignee_a
  // (server skips conflict check for cancelled events, so this should succeed)
  const cancelledRes = await createEvent(cookie, {
    company_id:  companyId,
    title:       'Cancelled Inspection – Smoke Test',
    start_time:  overlapStart,
    end_time:    overlapEnd,
    event_type:  'appointment',
    status:      'cancelled',   // gate ignores this
    assigned_to: ASSIGNEE_A,
  });
  ok('Cancelled event ignored by gate → HTTP 200/201', cancelledRes.status === 200 || cancelledRes.status === 201, `HTTP ${cancelledRes.status}`);
  const cancelledId = cancelledRes.data?.id;
  if (cancelledId) createdEventIds.push(cancelledId);

  // ── 8. Re-activating a cancelled event must re-run the conflict gate ────
  console.log('\nGroup 8: Re-activate cancelled overlapping event → expect 409 conflict');

  const reactivateRes = await updateEvent(cookie, cancelledId, {
    status: 'scheduled',
  });
  ok('Re-activated overlapping event → HTTP 409', reactivateRes.status === 409, `HTTP ${reactivateRes.status}`);
  ok('Re-activation response body has conflict:true', reactivateRes.data?.conflict === true, reactivateRes.data);
  ok('Re-activation response body has an error message', typeof reactivateRes.data?.error === 'string' && reactivateRes.data.error.length > 0, reactivateRes.data?.error);

  // Updating the anchor itself must still work: excludeId should remove only
  // the event being updated, not disable conflict checking altogether.
  const anchorUpdateRes = await updateEvent(cookie, anchorId, {
    status: 'scheduled',
  });
  ok('Updating the anchor without changing its slot → HTTP 200', anchorUpdateRes.status === 200, `HTTP ${anchorUpdateRes.status}`);

  // ── 9. Verify DB state ────────────────────────────────────────────────
  console.log('\nGroup 9: Verify DB state');

  // Query ALL calendar_events belonging to this company so we can do explicit
  // counts and verify no rejected row leaked through.
  const { rows: dbRows } = await pool.query(
    `SELECT id, title, status, assigned_to, start_time, end_time
       FROM calendar_events
      WHERE company_id = $1
      ORDER BY start_time`,
    [companyId]
  );

  // Expected successful events (tracked in createdEventIds):
  //   1. Anchor (ASSIGNEE_A, anchorStart–anchorEnd, scheduled)
  //   2. Back-to-back (ASSIGNEE_A, anchorEnd–+3h, scheduled)
  //   3. Before-anchor (ASSIGNEE_A, base-3h–base-1h, scheduled)
  //   4. Different-assignee overlap (ASSIGNEE_B, overlapStart–overlapEnd, scheduled)
  //   5. Cancelled overlap (ASSIGNEE_A, overlapStart–overlapEnd, cancelled)
  // The conflicting event (ASSIGNEE_A, overlapStart–overlapEnd, scheduled)
  // must NOT exist, and the cancelled event must remain cancelled after the
  // rejected re-activation.

  ok(
    `Exactly ${createdEventIds.length} events in DB for this company`,
    dbRows.length === createdEventIds.length,
    `found ${dbRows.length}, expected ${createdEventIds.length}`
  );

  ok(
    'Anchor event exists in DB',
    dbRows.some(r => r.id === anchorId),
    dbRows.map(r => r.id)
  );

  // The conflicting event must not have been persisted — search by title+assignee
  const conflictTitle = 'Conflicting Inspection – Smoke Test';
  const leakedConflict = dbRows.find(
    r => r.title === conflictTitle && r.assigned_to === ASSIGNEE_A
  );
  ok(
    'Rejected conflicting event NOT persisted in DB',
    !leakedConflict,
    leakedConflict ? `leaked row id=${leakedConflict.id}` : undefined
  );

  const cancelledEvent = dbRows.find(r => r.id === cancelledId);
  ok(
    'Rejected re-activation leaves event cancelled',
    cancelledEvent?.status === 'cancelled',
    cancelledEvent?.status
  );

  // Every tracked ID must be present
  const dbIdSet = new Set(dbRows.map(r => r.id));
  ok(
    'All successfully-created events are in DB',
    createdEventIds.every(id => dbIdSet.has(id)),
    createdEventIds.filter(id => !dbIdSet.has(id))
  );
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
