#!/usr/bin/env node
/**
 * Lexi scheduling confirmation race test
 * ─────────────────────────────────────────────────────────────────────────
 * Drives the REAL Lexi calendar tool handler (handleLocalToolCall exported by
 * vite-lexi-native-plugin.js) against the REAL database and proves that the
 * confirmation flow cannot double-book a staff member:
 *
 *   A) A conflicting request is held: no event is written, a confirmation
 *      token and real alternative slots are returned.
 *   B) Confirming one offered alternative books exactly one event, and the
 *      reschedule text is attempted only after that booking succeeded.
 *   C) Re-sending the same confirmation is rejected, writes no second event,
 *      and never reaches the reschedule text.
 *   D) The same token confirmed twice simultaneously produces one booking.
 *   E) Two different people confirming the same slot at the same instant
 *      produce exactly one booking (advisory lock + in-transaction re-check).
 *   F) All three call sites (native voice, browser chat, production) send the
 *      reschedule text only after a successful confirmed insert.
 *
 * No LLM and no dev server are required — the handler is imported directly.
 * The reschedule text targets a lead deliberately created without a phone
 * number, so the SMS attempt is observable without contacting Twilio.
 *
 * Prerequisites: DATABASE_URL
 * Usage: node scripts/test-lexi-double-booking-confirmation.cjs
 *
 * All fixtures use the stable "smoke_lexiconf_" prefix and are removed on both
 * success and failure, so repeated runs never accumulate test data.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { createPool } = require('./lib/db-pool.cjs');

const ROOT = path.resolve(__dirname, '..');
const pool = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers ────────────────────────────────────────────
const PREFIX = 'smoke_lexiconf_';
const COMPANY_ID = `${PREFIX}company`;
const OWNER_EMAIL = 'smoke-lexiconf-owner@example.com';
const SECOND_ADMIN_EMAIL = 'smoke-lexiconf-admin2@example.com';
const ASSIGNEE_EMAIL = 'smoke-lexiconf-rep@example.com';
const LEAD_ID = `${PREFIX}lead`;
const COMPANY_TZ = 'America/New_York';
const SMS_TEXT = 'Your appointment was moved — does the new time work?';

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`);
    failed++;
  }
}

// The handler normalizes a bare wall-clock time using the company timezone,
// which is exactly what the model sends back when it echoes an offered slot.
function tzOffsetMs(tz, at = new Date()) {
  const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const local = new Date(at.toLocaleString('en-US', { timeZone: tz })).getTime();
  return local - utc;
}

function asWallClock(utcIso) {
  const shifted = new Date(new Date(utcIso).getTime() + tzOffsetMs(COMPANY_TZ, new Date(utcIso)));
  return shifted.toISOString().slice(0, 19);
}

async function eventsInSlot(startIso, endIso) {
  const { rows } = await pool.query(
    `SELECT id, title, assigned_to, start_time, end_time FROM calendar_events
      WHERE company_id = $1 AND assigned_to = $2 AND start_time < $4 AND end_time > $3`,
    [COMPANY_ID, ASSIGNEE_EMAIL, startIso, endIso]
  );
  return rows;
}

async function seedFixtures() {
  await cleanup(true);
  await pool.query(
    `INSERT INTO companies (id, company_name, created_by, timezone, subscription_status, data, created_at, updated_at)
     VALUES ($1, 'Smoke Lexi Confirmation Co', $2, $3, 'active', $4::jsonb, NOW(), NOW())`,
    [COMPANY_ID, OWNER_EMAIL, COMPANY_TZ, JSON.stringify({ timezone: COMPANY_TZ })]
  );
  const staff = [
    [`${PREFIX}staff_owner`, OWNER_EMAIL, 'Confirmation Owner', true],
    [`${PREFIX}staff_admin2`, SECOND_ADMIN_EMAIL, 'Confirmation Admin Two', true],
    [`${PREFIX}staff_rep`, ASSIGNEE_EMAIL, 'Confirmation Rep', false],
  ];
  for (const [id, email, name, isAdmin] of staff) {
    await pool.query(
      `INSERT INTO staff_profiles (id, company_id, user_email, email, full_name, role, is_administrator, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $3, $4, $5, $6, true, NOW(), NOW())`,
      [id, COMPANY_ID, email, name, isAdmin ? 'admin' : 'sales_rep', isAdmin]
    );
  }
  // Deliberately no phone: the reschedule text must be *attempted* and report
  // a missing number rather than reaching a real SMS provider.
  await pool.query(
    `INSERT INTO leads (id, company_id, name, status, created_by, created_at, updated_at)
     VALUES ($1, $2, 'Confirmation Race Lead', 'new', $3, NOW(), NOW())`,
    [LEAD_ID, COMPANY_ID, OWNER_EMAIL]
  );
}

async function cleanup(quiet = false) {
  try {
    await pool.query(`DELETE FROM calendar_events WHERE company_id = $1`, [COMPANY_ID]);
    await pool.query(`DELETE FROM generic_entities WHERE company_id = $1 AND entity_type = 'LexiPendingSchedule'`, [COMPANY_ID]);
    await pool.query(`DELETE FROM leads WHERE company_id = $1`, [COMPANY_ID]);
    await pool.query(`DELETE FROM staff_profiles WHERE company_id = $1`, [COMPANY_ID]);
    await pool.query(`DELETE FROM companies WHERE id = $1`, [COMPANY_ID]);
  } catch (err) {
    if (!quiet) console.warn('  Cleanup warning:', err.message);
  }
}

async function main() {
  console.log('\n=== Lexi Scheduling Confirmation Race Test ===\n');

  const nativeModule = await import(
    `${pathToFileURL(path.join(ROOT, 'vite-lexi-native-plugin.js')).href}?confirm-race=${Date.now()}`
  );
  ok('Native Lexi calendar handler is importable', typeof nativeModule.handleLocalToolCall === 'function');
  if (typeof nativeModule.handleLocalToolCall !== 'function') return;

  const callTool = (args, userEmail) =>
    nativeModule.handleLocalToolCall('create_calendar_event', args, COMPANY_ID, userEmail, COMPANY_TZ);

  await seedFixtures();

  // Anchor booking the rep already has. 15:00Z keeps every generated
  // alternative inside the handler's 07:00–18:00 slot window.
  const day = new Date(Date.now() + 6 * 86400000);
  day.setUTCHours(15, 0, 0, 0);
  const anchorStart = day.toISOString();
  const anchorEnd = new Date(day.getTime() + 3600000).toISOString();
  await pool.query(
    `INSERT INTO calendar_events (id, company_id, title, event_type, start_time, end_time, assigned_to, created_by, status, created_at)
     VALUES ($1, $2, 'Anchor Roof Inspection', 'appointment', $3, $4, $5, $6, 'scheduled', NOW())`,
    [`${PREFIX}anchor`, COMPANY_ID, anchorStart, anchorEnd, ASSIGNEE_EMAIL, OWNER_EMAIL]
  );

  // The requested slot overlaps the anchor by 30 minutes.
  const requestedStart = asWallClock(new Date(day.getTime() + 30 * 60000).toISOString());
  const requestedEnd = asWallClock(new Date(day.getTime() + 90 * 60000).toISOString());

  // ── A. The conflict is held, not booked ─────────────────────────────────
  console.log('\nGroup A: A conflicting request is held with alternatives');
  const conflict = await callTool({
    title: 'Confirmation Race Meeting',
    start_time: requestedStart,
    end_time: requestedEnd,
    event_type: 'meeting',
    assigned_to: ASSIGNEE_EMAIL,
  }, OWNER_EMAIL);

  ok('Conflicting request is refused with CALENDAR_CONFLICT', conflict?.code === 'CALENDAR_CONFLICT', conflict);
  ok('A confirmation token is issued', typeof conflict?.confirmation_token === 'string' && conflict.confirmation_token.length > 0);
  ok('Real alternative slots are offered', Array.isArray(conflict?.alternatives) && conflict.alternatives.length > 0, conflict?.alternatives?.length);

  const heldRows = await pool.query(
    `SELECT id FROM calendar_events WHERE company_id = $1 AND title = 'Confirmation Race Meeting'`,
    [COMPANY_ID]
  );
  ok('The refused request wrote no calendar event', heldRows.rowCount === 0, heldRows.rowCount);

  if (!conflict?.confirmation_token || !conflict?.alternatives?.length) {
    console.log('\n⚠  Cannot continue without a confirmation token and alternatives.\n');
    return;
  }

  // ── B. Confirming one offered alternative books exactly one event ───────
  console.log('\nGroup B: Confirming an offered alternative books exactly one event');
  const chosen = conflict.alternatives[0];
  const confirmArgs = {
    title: 'Confirmation Race Meeting',
    start_time: asWallClock(chosen.start),
    end_time: asWallClock(chosen.end),
    event_type: 'meeting',
    assigned_to: ASSIGNEE_EMAIL,
    confirmation_token: conflict.confirmation_token,
    lead_id: LEAD_ID,
    reschedule_sms_message: SMS_TEXT,
  };
  const booked = await callTool(confirmArgs, OWNER_EMAIL);
  ok('Confirmation succeeds', booked?.success === true, booked);
  ok('Confirmation returns the created event id', typeof booked?.event_id === 'string' && booked.event_id.length > 0, booked?.event_id);

  const bookedRows = await eventsInSlot(chosen.start, chosen.end);
  ok('Exactly one event exists in the confirmed slot', bookedRows.length === 1, bookedRows.map(r => r.id));
  ok('The booked event is the confirmed one', bookedRows[0]?.id === booked?.event_id, bookedRows[0]?.id);

  // The reschedule text runs only after the insert committed. The lead has no
  // phone, so a genuine attempt reports the missing number instead of texting.
  ok('The reschedule text was attempted after the booking succeeded',
    booked?.sms && booked.sms.sent === false && /phone number/i.test(String(booked.sms.error || '')), booked?.sms);

  // ── C. Replaying the same confirmation is rejected ──────────────────────
  console.log('\nGroup C: Replaying the same confirmation is rejected');
  const replay = await callTool(confirmArgs, OWNER_EMAIL);
  ok('Replayed confirmation is refused', replay?.success === false, replay);
  ok('Replay is refused as an invalid confirmation', replay?.code === 'SCHEDULE_CONFIRMATION_INVALID', replay?.code);
  ok('Replay never reaches the reschedule text', !replay?.sms, replay?.sms);

  const afterReplay = await eventsInSlot(chosen.start, chosen.end);
  ok('Still exactly one event in the slot after the replay', afterReplay.length === 1, afterReplay.map(r => r.id));

  // ── D. The same token confirmed twice at the same instant ──────────────
  console.log('\nGroup D: One token confirmed twice simultaneously → one booking');
  const secondConflict = await callTool({
    title: 'Same Token Race Meeting',
    start_time: requestedStart,
    end_time: requestedEnd,
    event_type: 'meeting',
    assigned_to: ASSIGNEE_EMAIL,
  }, OWNER_EMAIL);
  ok('A fresh conflict issues a new token', secondConflict?.code === 'CALENDAR_CONFLICT' && !!secondConflict?.confirmation_token, secondConflict?.code);

  const sameTokenSlot = (secondConflict?.alternatives || [])[0];
  if (sameTokenSlot) {
    const sameTokenArgs = {
      title: 'Same Token Race Meeting',
      start_time: asWallClock(sameTokenSlot.start),
      end_time: asWallClock(sameTokenSlot.end),
      event_type: 'meeting',
      assigned_to: ASSIGNEE_EMAIL,
      confirmation_token: secondConflict.confirmation_token,
    };
    const sameTokenResults = await Promise.all([
      callTool({ ...sameTokenArgs }, OWNER_EMAIL),
      callTool({ ...sameTokenArgs }, OWNER_EMAIL),
    ]);
    const sameTokenWins = sameTokenResults.filter(r => r?.success === true);
    ok('Exactly one of the two simultaneous replays is accepted', sameTokenWins.length === 1, sameTokenResults.map(r => r?.code || r?.success));
    const sameTokenRows = await eventsInSlot(sameTokenSlot.start, sameTokenSlot.end);
    ok('Exactly one event exists for the replayed token slot', sameTokenRows.length === 1, sameTokenRows.map(r => r.id));
  } else {
    ok('A fresh conflict offers an alternative for the same-token race', false, secondConflict?.alternatives);
  }

  // ── E. Two different people confirming the same slot at once ───────────
  console.log('\nGroup E: Two people confirm the same slot at once → one booking');
  const [conflictA, conflictB] = await Promise.all([
    callTool({
      title: 'Race Meeting Owner',
      start_time: requestedStart,
      end_time: requestedEnd,
      event_type: 'meeting',
      assigned_to: ASSIGNEE_EMAIL,
    }, OWNER_EMAIL),
    callTool({
      title: 'Race Meeting Admin Two',
      start_time: requestedStart,
      end_time: requestedEnd,
      event_type: 'meeting',
      assigned_to: ASSIGNEE_EMAIL,
    }, SECOND_ADMIN_EMAIL),
  ]);
  ok('Both people are held on the conflict',
    conflictA?.code === 'CALENDAR_CONFLICT' && conflictB?.code === 'CALENDAR_CONFLICT',
    [conflictA?.code, conflictB?.code]);

  const slotsA = (conflictA?.alternatives || []).map(s => `${s.start}|${s.end}`);
  const shared = (conflictB?.alternatives || []).find(s => slotsA.includes(`${s.start}|${s.end}`));
  ok('Both people were offered the same free slot', !!shared, { a: conflictA?.alternatives?.length, b: conflictB?.alternatives?.length });

  if (shared) {
    const raceResults = await Promise.all([
      callTool({
        title: 'Race Meeting Owner',
        start_time: asWallClock(shared.start),
        end_time: asWallClock(shared.end),
        event_type: 'meeting',
        assigned_to: ASSIGNEE_EMAIL,
        confirmation_token: conflictA.confirmation_token,
        lead_id: LEAD_ID,
        reschedule_sms_message: SMS_TEXT,
      }, OWNER_EMAIL),
      callTool({
        title: 'Race Meeting Admin Two',
        start_time: asWallClock(shared.start),
        end_time: asWallClock(shared.end),
        event_type: 'meeting',
        assigned_to: ASSIGNEE_EMAIL,
        confirmation_token: conflictB.confirmation_token,
        lead_id: LEAD_ID,
        reschedule_sms_message: SMS_TEXT,
      }, SECOND_ADMIN_EMAIL),
    ]);
    const winners = raceResults.filter(r => r?.success === true);
    const losers = raceResults.filter(r => r?.success !== true);
    ok('Exactly one simultaneous confirmation is accepted', winners.length === 1, raceResults.map(r => r?.code || r?.success));
    ok('The rejected confirmation reports a conflict or an invalid confirmation',
      losers.length === 1 && ['CALENDAR_CONFLICT', 'SCHEDULE_CONFIRMATION_INVALID'].includes(losers[0]?.code), losers.map(r => r?.code));
    ok('The rejected confirmation never reaches the reschedule text', losers.every(r => !r?.sms), losers.map(r => r?.sms));
    ok('The accepted confirmation attempted the reschedule text', winners.every(r => !!r?.sms), winners.map(r => r?.sms));

    const raceRows = await eventsInSlot(shared.start, shared.end);
    ok('Exactly one event exists in the contested slot', raceRows.length === 1, raceRows.map(r => ({ id: r.id, title: r.title })));
    ok('The stored event belongs to the accepted confirmation', raceRows[0]?.id === winners[0]?.event_id, raceRows[0]?.id);
  }

  // ── F. Every call site texts only after a successful confirmed insert ───
  console.log('\nGroup F: All three call sites text only after a successful booking');
  for (const [label, file] of Object.entries({
    'native voice': 'vite-lexi-native-plugin.js',
    'browser chat': 'vite-functions-plugin.js',
    'production': 'prod-server.cjs',
  })) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const confirmAt = source.indexOf('confirmScheduleAndCreate(');
    const guardAt = source.indexOf('if (!confirmed.ok)');
    const smsAt = source.indexOf('reschedule_sms_message', guardAt > -1 ? guardAt : 0);
    ok(`${label}: uses the shared transactional confirmation`, confirmAt > -1, confirmAt);
    ok(`${label}: returns before texting when the confirmation fails`, guardAt > confirmAt, { confirmAt, guardAt });
    ok(`${label}: the reschedule text follows the successful insert`, smsAt > guardAt, { guardAt, smsAt });
  }
}

(async () => {
  try {
    await main();
  } catch (err) {
    console.error('\n💥 Unexpected error:', err);
    failed++;
  } finally {
    await cleanup();
    await pool.end().catch(() => {});
    console.log('\n─────────────────────────────────────────────────');
    console.log(`Total: ${passed} passed, ${failed} failed`);
    console.log('─────────────────────────────────────────────────\n');
    process.exit(failed > 0 ? 1 : 0);
  }
})();
