#!/usr/bin/env node
/**
 * Open Punch List Reminder Regression Test
 * ─────────────────────────────────────────────────────────────────────────
 * A punch list is raised after the crew has left, so nothing else in the app
 * chases it. scanPunchListReminders keeps ONE open ActionItem per build while
 * any punch item is still open, re-arms it every 3 days, escalates to an
 * admin/owner once it has stayed open past the threshold, and closes itself
 * when the last punch item is checked off.
 *
 *  1. No punch items on a build          → no reminder is ever created.
 *  2. All punch items already completed  → no reminder is created.
 *  3. One build with open punch items    → exactly ONE reminder (not one per
 *                                          item), due 3 days out.
 *  4. Second pass before the due date    → no duplicate, no re-arm.
 *  5. Due date reached                   → re-armed: nag #2, due 3 days out.
 *  6. Open past the escalation threshold → escalated to the admin/owner,
 *                                          priority urgent, assignee unchanged.
 *  7. Generic escalation ladder          → skips this type entirely (a 2h/6h
 *                                          hours-based ladder would fire hourly
 *                                          on a 3-day cadence).
 *  8. Last punch item completed          → reminder auto-closes.
 *  9. A punch item reopened              → a fresh reminder re-arms immediately.
 * 10. Reminder dismissed by a human      → not recreated within the interval.
 * 11. Two open reminders on one build    → the duplicate is closed.
 * 12. Reminder whose build is gone       → closed, never orphaned.
 * 13. syncPunchListNag without a session → refused (ownership comes from the
 *                                          build row, not the caller).
 *
 * Prerequisites:
 *   - Dev server running on PORT (default 5000)  —  npm run dev
 *   - DATABASE_URL env var set
 *
 * Usage:  node scripts/test-punch-list-nag.cjs
 *
 * All fixture IDs use the stable "smoke_pln_" prefix; cleanup runs on both
 * success and failure so repeated runs never accumulate test data. No real
 * email or SMS can leave: every fixture address uses an undeliverable domain,
 * and escalation email is disabled outside production anyway.
 */
'use strict';

const { Pool } = require('pg');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers ─────────────────────────────────────────────
const COMPANY_ID = 'smoke_pln_company_001';
const OWNER_EMAIL = 'pln-owner@invalid';       // no dot in domain → never mailable
const CREW_EMAIL = 'pln-crew@invalid';
const CREW_NAME = 'Punch Crew';
const STAFF_ID = 'smoke_pln_staff_001';
const ADMIN_ID = 'smoke_pln_admin_001';
const ADMIN_EMAIL = 'pln-admin@invalid';

const BUILD_OPEN = 'smoke_pln_build_open_001';       // has open punch items
const BUILD_NO_PUNCH = 'smoke_pln_build_nopunch_001';   // scope, but no punch items
const BUILD_DONE = 'smoke_pln_build_done_001';      // punch items all completed
const GHOST_BUILD_ID = 'smoke_pln_build_ghost_001';     // referenced by a nag, never exists

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    const detail = extra !== undefined ? ` — got ${JSON.stringify(extra)}` : '';
    console.log(`  ✗ ${name}${detail}`);
    failed++;
  }
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body ? Buffer.byteLength(body) : 0,
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
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function invokeFunction(functionName, params = {}, headers = {}) {
  const res = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    body: { functionName, params },
    headers,
  });
  if (res.status !== 200) throw new Error(`invoke ${functionName} → HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  return res.data?.data ?? res.data;
}

// The sweep writes and notifies across every company, so it only answers to the
// internal cron token (the same one the schedulers send).
const cronToken = () => crypto
  .createHmac('sha256', process.env.SESSION_SECRET || '')
  .update('internal-cron-2026')
  .digest('hex');

// Scoped to a single fixture build so the sweep never touches real dev tenants.
const scanBuild = (buildId) =>
  invokeFunction('scanPunchListReminders', { buildId }, { 'x-cron-token': cronToken() });

// ── DB helpers ─────────────────────────────────────────────────────────────
function parse(value) {
  if (!value) return {};
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function openNags(buildId) {
  const { rows } = await pool.query(
    `SELECT id, data FROM generic_entities
      WHERE entity_type='ActionItem'
        AND data->>'type'='open_punch_list'
        AND data->>'related_build_id'=$1
        AND data->>'status' IN ('pending','snoozed')
      ORDER BY created_date ASC`,
    [String(buildId)]
  );
  return rows.map((r) => ({ id: r.id, ...parse(r.data) }));
}

async function allNags(buildId) {
  const { rows } = await pool.query(
    `SELECT id, data FROM generic_entities
      WHERE entity_type='ActionItem'
        AND data->>'type'='open_punch_list'
        AND data->>'related_build_id'=$1
      ORDER BY created_date ASC`,
    [String(buildId)]
  );
  return rows.map((r) => ({ id: r.id, ...parse(r.data) }));
}

async function patchNag(id, patch) {
  const { rows } = await pool.query(
    `SELECT data FROM generic_entities WHERE id=$1 AND entity_type='ActionItem' LIMIT 1`,
    [id]
  );
  const data = { ...parse(rows[0]?.data), ...patch };
  await pool.query(
    `UPDATE generic_entities SET data=$1::jsonb, updated_date=NOW()
      WHERE id=$2 AND entity_type='ActionItem'`,
    [JSON.stringify(data), id]
  );
  return data;
}

async function setPunchCompletion(buildId, completedByLabel) {
  const { rows } = await pool.query(
    `SELECT data FROM generic_entities WHERE id=$1 AND entity_type='BuildSchedule' LIMIT 1`,
    [buildId]
  );
  const data = parse(rows[0]?.data);
  data.scope_of_work = (data.scope_of_work || []).map((item) =>
    item.category === 'punch'
      ? { ...item, completed: completedByLabel[item.label] ?? item.completed }
      : item
  );
  await pool.query(
    `UPDATE generic_entities SET data=$1::jsonb, updated_date=NOW()
      WHERE id=$2 AND entity_type='BuildSchedule'`,
    [JSON.stringify(data), buildId]
  );
}

function daysFromNowIso(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

function daysBetween(isoA, isoB) {
  return (new Date(isoA).getTime() - new Date(isoB).getTime()) / (24 * 60 * 60 * 1000);
}

// ── Cleanup ────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('\n── Cleanup ───────────────────────────────────────────────────');
  try {
    await pool.query(
      `DELETE FROM generic_entities
        WHERE company_id=$1
           OR id = ANY($2)
           OR (entity_type='ActionItem' AND data->>'related_build_id' = ANY($2))`,
      [COMPANY_ID, [BUILD_OPEN, BUILD_NO_PUNCH, BUILD_DONE, GHOST_BUILD_ID]]
    );
    await pool.query(`DELETE FROM staff_profiles WHERE company_id=$1`, [COMPANY_ID]);
    await pool.query(`DELETE FROM companies WHERE id=$1`, [COMPANY_ID]);
    console.log('  Fixtures removed');
  } catch (e) {
    console.warn('  Cleanup warning:', e.message);
  }
}

// ── Fixture insertion ──────────────────────────────────────────────────────
// Punch items carry their own created_at (makeScopeItem does the same), which
// is what the escalation clock is measured from.
function punchItem(label, completed, ageDays = 0) {
  return {
    id: `sow_${label.replace(/\s+/g, '_').toLowerCase()}`,
    label,
    category: 'punch',
    completed: !!completed,
    created_at: daysFromNowIso(-ageDays),
  };
}

function scopeItem(label, completed) {
  return { id: `sow_${label.replace(/\s+/g, '_').toLowerCase()}`, label, category: 'roofing', completed: !!completed };
}

async function insertBuild(id, data) {
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'BuildSchedule', $2, $3::jsonb, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE SET data=$3::jsonb, updated_date=NOW()`,
    [id, COMPANY_ID, JSON.stringify({ company_id: COMPANY_ID, ...data })]
  );
}

async function seed() {
  await cleanup();
  console.log('\n── Seeding fixtures ──────────────────────────────────────────');
  await pool.query(
    `INSERT INTO companies (id, company_name, name, created_by, created_at, updated_at)
     VALUES ($1, 'Punch List Smoke Co', 'Punch List Smoke Co', $2, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET created_by=$2`,
    [COMPANY_ID, OWNER_EMAIL]
  );
  await pool.query(
    `INSERT INTO staff_profiles (id, company_id, user_email, email, full_name, name, is_active, is_administrator, created_at, updated_at)
     VALUES ($1, $2, $3, $3, $4, $4, true, false, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [STAFF_ID, COMPANY_ID, CREW_EMAIL, CREW_NAME]
  );
  await pool.query(
    `INSERT INTO staff_profiles (id, company_id, user_email, email, full_name, name, is_active, is_administrator, created_at, updated_at)
     VALUES ($1, $2, $3, $3, 'Punch Admin', 'Punch Admin', true, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ADMIN_ID, COMPANY_ID, ADMIN_EMAIL]
  );

  // The crew is assigned by DISPLAY NAME (how BuildSchedule stores it) — the
  // reminder has to resolve that back to an inbox through the staff directory.
  await insertBuild(BUILD_OPEN, {
    customer_name: 'Punch Open Customer',
    address: '1 Punch Way',
    status: 'completed',
    assigned_to: [CREW_NAME],
    scope_of_work: [
      scopeItem('Tear off', true),
      punchItem('Replace bent gutter', false),
      punchItem('Touch up paint', false),
      punchItem('Haul away debris', true),
    ],
  });
  await insertBuild(BUILD_NO_PUNCH, {
    customer_name: 'No Punch Customer',
    address: '2 Punch Way',
    assigned_to: [CREW_NAME],
    scope_of_work: [scopeItem('Tear off', true), scopeItem('Install shingles', false)],
  });
  await insertBuild(BUILD_DONE, {
    customer_name: 'Punch Done Customer',
    address: '3 Punch Way',
    assigned_to: [CREW_NAME],
    scope_of_work: [punchItem('Fix flashing', true), punchItem('Clean gutters', true)],
  });
  console.log('  Company, staff directory and 3 builds seeded');
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Open Punch List Reminder Regression Test');
  console.log('═══════════════════════════════════════════════════════════════');

  await seed();

  // ── 1/2. Builds with nothing to chase ────────────────────────────────────
  console.log('\n── Nothing to chase ──────────────────────────────────────────');
  await scanBuild(BUILD_NO_PUNCH);
  await scanBuild(BUILD_DONE);
  ok('no reminder for a build with zero punch items', (await allNags(BUILD_NO_PUNCH)).length === 0);
  ok('no reminder for a build whose punch items are all done', (await allNags(BUILD_DONE)).length === 0);

  // ── 3. One nag per job ───────────────────────────────────────────────────
  console.log('\n── First reminder ────────────────────────────────────────────');
  const firstRun = await scanBuild(BUILD_OPEN);
  ok('scan reports one reminder created', firstRun.created === 1, firstRun);
  let nags = await openNags(BUILD_OPEN);
  ok('exactly ONE open reminder for a job with 2 open punch items', nags.length === 1, nags.length);
  const nagId = nags[0]?.id;
  ok('counts both open items on one reminder', nags[0]?.punch_remaining === 2 && nags[0]?.punch_total === 3,
    { remaining: nags[0]?.punch_remaining, total: nags[0]?.punch_total });
  ok('assigned to the crew resolved from the build assignment',
    nags[0]?.assigned_to === CREW_EMAIL, nags[0]?.assigned_to);
  ok('due 3 days out', Math.abs(daysBetween(nags[0]?.due_at, new Date().toISOString()) - 3) < 0.05,
    nags[0]?.due_at);
  ok('starts un-escalated at normal priority',
    nags[0]?.punch_escalated === false && nags[0]?.priority === 'medium', nags[0]?.priority);
  const { rows: bellRows } = await pool.query(
    `SELECT data->>'user_email' AS user_email FROM generic_entities
      WHERE entity_type='Notification' AND company_id=$1 AND data->>'type'='open_punch_list'`,
    [COMPANY_ID]
  );
  ok('the assigned crew is notified in-app', bellRows.some((r) => r.user_email === CREW_EMAIL),
    bellRows.map((r) => r.user_email));

  // ── 4. Idempotent before the due date ────────────────────────────────────
  console.log('\n── Re-arm cadence ────────────────────────────────────────────');
  const secondRun = await scanBuild(BUILD_OPEN);
  nags = await openNags(BUILD_OPEN);
  ok('a second pass creates no duplicate', nags.length === 1 && secondRun.created === 0, secondRun);
  ok('does not re-arm before the due date', nags[0]?.punch_nag_count === 1 && secondRun.rearmed === 0,
    { count: nags[0]?.punch_nag_count, rearmed: secondRun.rearmed });

  // ── 5. Re-arms once due ──────────────────────────────────────────────────
  await patchNag(nagId, { due_at: new Date(Date.now() - 60 * 1000).toISOString() });
  const thirdRun = await scanBuild(BUILD_OPEN);
  nags = await openNags(BUILD_OPEN);
  ok('re-arms when the 3-day due date passes', thirdRun.rearmed === 1 && nags[0]?.punch_nag_count === 2,
    { rearmed: thirdRun.rearmed, count: nags[0]?.punch_nag_count });
  ok('still exactly one reminder after re-arming', nags.length === 1, nags.length);
  ok('next reminder is another 3 days out',
    Math.abs(daysBetween(nags[0]?.due_at, new Date().toISOString()) - 3) < 0.05, nags[0]?.due_at);
  ok('stays un-escalated inside the threshold', nags[0]?.punch_escalated !== true, nags[0]?.punch_escalated);

  // ── 6. Escalation to an admin/owner ──────────────────────────────────────
  // Natural clock: on the real cadence a reminder opened 8 days ago was last
  // re-armed on day 6 and is not due again until day 9. Escalation is measured
  // from the day the punch list was raised, so it must fire on THIS pass —
  // waiting for the next due date would escalate on day 9, not day 7.
  console.log('\n── Escalation ────────────────────────────────────────────────');
  const preEscalation = await patchNag(nagId, {
    punch_opened_at: daysFromNowIso(-8),
    due_at: daysFromNowIso(1),
  });
  const escRun = await scanBuild(BUILD_OPEN);
  nags = await openNags(BUILD_OPEN);
  ok('escalates on the 7-day clock, not the 3-day nag cadence',
    escRun.escalated === 1 && nags[0]?.punch_escalated === true, escRun);
  ok('an escalation between nags does not advance the 3-day cadence',
    nags[0]?.punch_nag_count === preEscalation.punch_nag_count && nags[0]?.due_at === preEscalation.due_at,
    { count: nags[0]?.punch_nag_count, due: nags[0]?.due_at });
  ok('escalation targets an admin/owner',
    (nags[0]?.punch_escalated_to || []).includes(ADMIN_EMAIL) ||
    (nags[0]?.punch_escalated_to || []).includes(OWNER_EMAIL), nags[0]?.punch_escalated_to);
  ok('escalated reminder is urgent', nags[0]?.priority === 'urgent', nags[0]?.priority);
  ok('the crew still owns the work', nags[0]?.assigned_to === CREW_EMAIL, nags[0]?.assigned_to);
  const escAgain = await scanBuild(BUILD_OPEN);
  ok('escalation is not repeated on the next pass', escAgain.escalated === 0, escAgain);

  // ── 6b. A human snooze outranks both clocks ──────────────────────────────
  console.log('\n── Snooze ────────────────────────────────────────────────────');
  const snoozedUntil = daysFromNowIso(5);
  await patchNag(nagId, {
    status: 'snoozed',
    snoozed_until: snoozedUntil,
    due_at: new Date(Date.now() - 60 * 1000).toISOString(),
  });
  const snoozeRun = await scanBuild(BUILD_OPEN);
  const snoozedNag = (await openNags(BUILD_OPEN))[0];
  ok('a 5-day snooze is not overridden by the 3-day cadence',
    snoozeRun.rearmed === 0 && snoozedNag?.status === 'snoozed' && snoozedNag?.snoozed_until === snoozedUntil,
    { rearmed: snoozeRun.rearmed, status: snoozedNag?.status, until: snoozedNag?.snoozed_until });
  await patchNag(nagId, {
    status: 'snoozed',
    snoozed_until: daysFromNowIso(-1),
    due_at: new Date(Date.now() - 60 * 1000).toISOString(),
  });
  const unsnoozeRun = await scanBuild(BUILD_OPEN);
  const unsnoozedNag = (await openNags(BUILD_OPEN))[0];
  ok('an expired snooze lets the reminder return',
    unsnoozeRun.rearmed === 1 && unsnoozedNag?.status === 'pending', unsnoozeRun);

  // ── 7. Generic hours-based ladder must not touch this type ───────────────
  console.log('\n── Escalation ladder isolation ───────────────────────────────');
  await patchNag(nagId, {
    due_at: daysFromNowIso(-1),
    escalation_level: 0,
    last_reminder_at: null,
  });
  await invokeFunction('processActionItemEscalation', {});
  const { rows: ladderRows } = await pool.query(
    `SELECT data FROM generic_entities WHERE id=$1 AND entity_type='ActionItem'`, [nagId]
  );
  const afterLadder = parse(ladderRows[0]?.data);
  ok('hours-based ladder leaves the punch reminder alone',
    Number(afterLadder.escalation_level || 0) === 0 && !afterLadder.last_reminder_at,
    { level: afterLadder.escalation_level, last: afterLadder.last_reminder_at });

  // ── 8. Auto-close when the list is finished ──────────────────────────────
  console.log('\n── Closing out ───────────────────────────────────────────────');
  await setPunchCompletion(BUILD_OPEN, { 'Replace bent gutter': true, 'Touch up paint': true });
  const closeRun = await scanBuild(BUILD_OPEN);
  ok('closing the last punch item closes the reminder',
    closeRun.closed === 1 && (await openNags(BUILD_OPEN)).length === 0, closeRun);
  const closedNag = (await allNags(BUILD_OPEN)).find((n) => n.id === nagId);
  ok('closed reminder is marked auto-closed',
    closedNag?.status === 'completed' && closedNag?.punch_auto_closed === true,
    { status: closedNag?.status, auto: closedNag?.punch_auto_closed });

  // ── 9. Reopening re-arms ─────────────────────────────────────────────────
  await setPunchCompletion(BUILD_OPEN, { 'Touch up paint': false });
  const reopenRun = await scanBuild(BUILD_OPEN);
  nags = await openNags(BUILD_OPEN);
  ok('reopening a punch item re-arms a reminder', reopenRun.created === 1 && nags.length === 1, reopenRun);
  const reopenedNagId = nags[0]?.id;
  ok('re-armed reminder counts only the reopened item', nags[0]?.punch_remaining === 1, nags[0]?.punch_remaining);

  // ── 10. A human dismissal is respected for one interval ──────────────────
  console.log('\n── Human dismissal ───────────────────────────────────────────');
  await patchNag(reopenedNagId, { status: 'dismissed', punch_auto_closed: false });
  const dismissedRun = await scanBuild(BUILD_OPEN);
  ok('a dismissed reminder is not instantly recreated',
    (await openNags(BUILD_OPEN)).length === 0 && dismissedRun.created === 0, dismissedRun);

  // ── 10b. Dismissing cannot postpone escalation ───────────────────────────
  // The dismissed reminder had been open 8 days. Once its 3-day suppression
  // expires, the replacement must inherit that age — otherwise a job could
  // dodge escalation forever by being dismissed every few days.
  await patchNag(reopenedNagId, { punch_opened_at: daysFromNowIso(-8) });
  await pool.query(
    `UPDATE generic_entities SET updated_date = NOW() - INTERVAL '4 days'
      WHERE id=$1 AND entity_type='ActionItem'`,
    [reopenedNagId]
  );
  const afterSuppressionRun = await scanBuild(BUILD_OPEN);
  const revived = (await openNags(BUILD_OPEN))[0];
  ok('the reminder returns once the dismissal suppression expires',
    afterSuppressionRun.created === 1 && !!revived, afterSuppressionRun);
  ok('the replacement inherits the original age instead of restarting the clock',
    Math.abs(daysBetween(new Date().toISOString(), revived?.punch_opened_at) - 8) < 0.05,
    revived?.punch_opened_at);
  ok('an already-overdue punch list is escalated on the spot',
    afterSuppressionRun.escalated === 1 && revived?.punch_escalated === true
      && revived?.priority === 'urgent', afterSuppressionRun);
  ok('escalating at creation still starts the 3-day cadence at reminder #1',
    revived?.punch_nag_count === 1
      && Math.abs(daysBetween(revived?.due_at, new Date().toISOString()) - 3) < 0.05,
    { count: revived?.punch_nag_count, due: revived?.due_at });

  // A punch item raised 9 days ago on a job that never had a reminder is just
  // as overdue — the clock comes from the item, not from the reminder.
  await insertBuild(BUILD_DONE, {
    customer_name: 'Punch Done Customer',
    address: '3 Punch Way',
    assigned_to: [CREW_NAME],
    scope_of_work: [punchItem('Fix flashing', true), punchItem('Clean gutters', false, 9)],
  });
  const staleItemRun = await scanBuild(BUILD_DONE);
  const staleItemNag = (await openNags(BUILD_DONE))[0];
  ok('an old punch item escalates on its own timestamp, with no prior reminder',
    staleItemRun.created === 1 && staleItemRun.escalated === 1
      && staleItemNag?.punch_escalated === true
      && Math.abs(daysBetween(new Date().toISOString(), staleItemNag?.punch_opened_at) - 9) < 0.05,
    { run: staleItemRun, opened: staleItemNag?.punch_opened_at });

  // ── 11. Duplicate guard ──────────────────────────────────────────────────
  console.log('\n── Duplicate + orphan guards ─────────────────────────────────');
  await pool.query(
    `DELETE FROM generic_entities WHERE entity_type='ActionItem' AND data->>'related_build_id'=$1`,
    [BUILD_OPEN]
  );
  const dupA = 'smoke_pln_nag_dup_a';
  const dupB = 'smoke_pln_nag_dup_b';
  for (const id of [dupA, dupB]) {
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'ActionItem', $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (id, entity_type) DO UPDATE SET data=$3::jsonb`,
      [id, COMPANY_ID, JSON.stringify({
        company_id: COMPANY_ID,
        type: 'open_punch_list',
        status: 'pending',
        title: 'Punch list open: Punch Open Customer',
        related_build_id: BUILD_OPEN,
        punch_opened_at: new Date().toISOString(),
        punch_nag_count: 1,
        due_at: daysFromNowIso(3),
      })]
    );
  }
  await scanBuild(BUILD_OPEN);
  ok('a duplicate reminder on the same job is closed', (await openNags(BUILD_OPEN)).length === 1,
    (await openNags(BUILD_OPEN)).length);

  // ── 12. Orphaned reminder (build deleted) ────────────────────────────────
  const ghostNagId = 'smoke_pln_nag_ghost';
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'ActionItem', $2, $3::jsonb, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE SET data=$3::jsonb`,
    [ghostNagId, COMPANY_ID, JSON.stringify({
      company_id: COMPANY_ID,
      type: 'open_punch_list',
      status: 'pending',
      title: 'Punch list open: Deleted Job',
      related_build_id: GHOST_BUILD_ID,
      punch_opened_at: new Date().toISOString(),
      due_at: daysFromNowIso(3),
    })]
  );
  await scanBuild(GHOST_BUILD_ID);
  ok('a reminder whose build is gone is closed', (await openNags(GHOST_BUILD_ID)).length === 0);

  // ── 13. syncPunchListNag ownership ───────────────────────────────────────
  console.log('\n── Ownership ─────────────────────────────────────────────────');
  const unauth = await invokeFunction('syncPunchListNag', { buildId: BUILD_OPEN });
  ok('syncPunchListNag refuses a caller with no session',
    unauth?.success === false && /not authorized/i.test(unauth?.error || ''), unauth);
  const missing = await invokeFunction('syncPunchListNag', { buildId: 'smoke_pln_not_a_build' });
  ok('syncPunchListNag reports an unknown build', missing?.success === false, missing);
  const unauthSweep = await invokeFunction('scanPunchListReminders', {});
  ok('the cross-tenant sweep refuses a caller without the internal cron token',
    unauthSweep?.success === false && /not authorized/i.test(unauthSweep?.error || ''), unauthSweep);

  // ── Results ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');
}

main()
  .then(async () => {
    await cleanup();
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error('\n✗ Test run failed:', err.message);
    console.error(err.stack);
    await cleanup();
    await pool.end();
    process.exit(1);
  });
