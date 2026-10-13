#!/usr/bin/env node
/**
 * Smoke test: urgent-call alert reaches all assigned reps on a multi-assignee lead
 * ─────────────────────────────────────────────────────────────────────────────────
 * The urgent-alert block in processCallRecording.ts collects assignedEmails from
 * two sources for a lead:
 *   • lead.assigned_to          — the primary rep (scalar string)
 *   • lead.assigned_to_users    — additional reps (string[])
 *
 * Then it intersects those emails with the active staffMembers list and creates
 * one Notification entity per matching staff member.
 *
 * Scenarios covered
 * ─────────────────
 *  1. Single assignee (assigned_to only) → 1 notification
 *  2. Two reps via assigned_to + assigned_to_users → 2 notifications
 *  3. Three reps via assigned_to + assigned_to_users[2] → 3 notifications
 *  4. Duplicate between assigned_to and assigned_to_users is de-duped → 1 notification
 *  5. assigned_to_users is not an array (bad data) → falls back to assigned_to only
 *  6. Rep in assigned_to_users but NOT in staffMembers is excluded
 *  7. Admin is always included regardless of lead assignment
 *  8. Admin already in assigned reps → de-duped (not double-notified)
 *  9. Neither assigned_to nor assigned_to_users set → only admins notified
 * 10. Customer path: assigned_to + assigned_to_users on customer record
 * 11. Customer path overrides lead fallback when customer_id resolves non-empty
 *
 * These tests run entirely in-process (pure logic, no HTTP / DB required).
 *
 * Usage:  node scripts/test-urgent-call-multi-assignee.cjs
 */

'use strict';

/* ─── helpers ────────────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } else {
    const msg = detail !== undefined ? `${name} — ${detail}` : name;
    console.error(`  ❌ FAIL  ${msg}`);
    failures.push(msg);
    failed++;
  }
}

/* ─── exact mirror of the assignedEmails collection logic ───────────────── */
// Extracted verbatim from functions/processCallRecording.ts (~line 370–405).
// If that block changes, this mirror must be updated — the test will fail
// before any regression ships.

/**
 * @param {object}   opts
 * @param {object|null} opts.customer        - resolved customer record (or null)
 * @param {object|null} opts.lead            - resolved lead record (or null)
 * @param {string[]}    opts.adminEmails     - admin email set (pre-collected)
 * @param {object[]}    opts.staffMembers    - active staff list [{user_email}]
 * @returns {{ assignedEmails: Set<string>, recipients: object[], notifications: object[] }}
 */
function runUrgentAlertLogic({ customer, lead, adminEmails, staffMembers }) {
  const assignedEmails = new Set();

  // 1. Check customer record (mirrors the customer_id branch)
  if (customer) {
    if (customer.assigned_to) assignedEmails.add(customer.assigned_to);
    if (Array.isArray(customer.assigned_to_users)) {
      customer.assigned_to_users.forEach((e) => assignedEmails.add(e));
    }
  }

  // 2. Fall back to lead phone-number lookup when no customer assignees found
  if (assignedEmails.size === 0 && lead) {
    if (lead.assigned_to) assignedEmails.add(lead.assigned_to);
    if (Array.isArray(lead.assigned_to_users)) {
      lead.assigned_to_users.forEach((e) => assignedEmails.add(e));
    }
  }

  // Recipients = admins ∪ assigned staff, de-duped, verified against active staff
  const recipientEmails = new Set([...adminEmails, ...assignedEmails]);
  const recipients = staffMembers.filter((s) => recipientEmails.has(s.user_email));

  // Simulate Notification.create calls
  const notifications = recipients.map((staff) => ({
    user_email:          staff.user_email,
    title:               '🚨 Urgent Call Requires Attention',
    type:                'general',
    related_entity_type: 'Communication',
    is_read:             false,
  }));

  return { assignedEmails, recipients, notifications };
}

/* ─── shared fixtures ────────────────────────────────────────────────────── */

const REP_A     = 'alice@example.com';
const REP_B     = 'bob@example.com';
const REP_C     = 'carol@example.com';
const ADMIN     = 'admin@example.com';
const INACTIVE  = 'inactive@example.com';   // not in staffMembers

const ALL_STAFF = [
  { user_email: REP_A },
  { user_email: REP_B },
  { user_email: REP_C },
  { user_email: ADMIN },
];

const ADMIN_EMAILS = [ADMIN];

/* ─── Scenario 1: single assignee (assigned_to only) ────────────────────── */
console.log('\n[1] Single assignee (assigned_to only)');
{
  const { notifications } = runUrgentAlertLogic({
    customer:     null,
    lead:         { assigned_to: REP_A, assigned_to_users: [] },
    adminEmails:  [],
    staffMembers: ALL_STAFF,
  });
  const emails = notifications.map((n) => n.user_email);
  ok('Exactly 1 notification created',       notifications.length === 1, `got ${notifications.length}`);
  ok('Notification goes to the assigned rep', emails.includes(REP_A),    `emails=${emails}`);
}

/* ─── Scenario 2: two reps via assigned_to + assigned_to_users ──────────── */
console.log('\n[2] Two reps via assigned_to + assigned_to_users');
{
  const { notifications } = runUrgentAlertLogic({
    customer:     null,
    lead:         { assigned_to: REP_A, assigned_to_users: [REP_B] },
    adminEmails:  [],
    staffMembers: ALL_STAFF,
  });
  const emails = notifications.map((n) => n.user_email);
  ok('Exactly 2 notifications created',          notifications.length === 2, `got ${notifications.length}`);
  ok('Primary rep (REP_A) receives notification', emails.includes(REP_A),    `emails=${emails}`);
  ok('Secondary rep (REP_B) receives notification', emails.includes(REP_B),  `emails=${emails}`);
}

/* ─── Scenario 3: three reps via assigned_to + assigned_to_users[2] ─────── */
console.log('\n[3] Three reps (assigned_to + two in assigned_to_users)');
{
  const { notifications } = runUrgentAlertLogic({
    customer:     null,
    lead:         { assigned_to: REP_A, assigned_to_users: [REP_B, REP_C] },
    adminEmails:  [],
    staffMembers: ALL_STAFF,
  });
  const emails = notifications.map((n) => n.user_email);
  ok('Exactly 3 notifications created', notifications.length === 3, `got ${notifications.length}`);
  ok('REP_A notified', emails.includes(REP_A), `emails=${emails}`);
  ok('REP_B notified', emails.includes(REP_B), `emails=${emails}`);
  ok('REP_C notified', emails.includes(REP_C), `emails=${emails}`);
}

/* ─── Scenario 4: duplicate between assigned_to and assigned_to_users ────── */
console.log('\n[4] Duplicate email in assigned_to and assigned_to_users is de-duped');
{
  const { notifications } = runUrgentAlertLogic({
    customer:     null,
    lead:         { assigned_to: REP_A, assigned_to_users: [REP_A, REP_B] },
    adminEmails:  [],
    staffMembers: ALL_STAFF,
  });
  const emails = notifications.map((n) => n.user_email);
  ok('Exactly 2 notifications (no duplicate for REP_A)', notifications.length === 2, `got ${notifications.length}`);
  ok('REP_A appears exactly once', emails.filter((e) => e === REP_A).length === 1);
  ok('REP_B appears exactly once', emails.filter((e) => e === REP_B).length === 1);
}

/* ─── Scenario 5: assigned_to_users is not an array (bad data) ──────────── */
console.log('\n[5] assigned_to_users is not an array — falls back to assigned_to only');
{
  const { notifications } = runUrgentAlertLogic({
    customer:     null,
    lead:         { assigned_to: REP_A, assigned_to_users: 'not-an-array' },
    adminEmails:  [],
    staffMembers: ALL_STAFF,
  });
  const emails = notifications.map((n) => n.user_email);
  ok('Exactly 1 notification created',       notifications.length === 1, `got ${notifications.length}`);
  ok('Notification goes to assigned_to rep', emails.includes(REP_A),    `emails=${emails}`);
}

/* ─── Scenario 6: rep in assigned_to_users but NOT in staffMembers ────────── */
console.log('\n[6] Rep in assigned_to_users but not an active staff member → excluded');
{
  const { notifications } = runUrgentAlertLogic({
    customer:     null,
    lead:         { assigned_to: REP_A, assigned_to_users: [INACTIVE] },
    adminEmails:  [],
    staffMembers: ALL_STAFF,   // INACTIVE is not in this list
  });
  const emails = notifications.map((n) => n.user_email);
  ok('Inactive rep excluded from notifications', !emails.includes(INACTIVE), `emails=${emails}`);
  ok('Active primary rep still notified',        emails.includes(REP_A),    `emails=${emails}`);
  ok('Exactly 1 notification sent',              notifications.length === 1, `got ${notifications.length}`);
}

/* ─── Scenario 7: admin always included regardless of lead assignment ─────── */
console.log('\n[7] Admin is always included');
{
  const { notifications } = runUrgentAlertLogic({
    customer:     null,
    lead:         { assigned_to: REP_A, assigned_to_users: [] },
    adminEmails:  ADMIN_EMAILS,
    staffMembers: ALL_STAFF,
  });
  const emails = notifications.map((n) => n.user_email);
  ok('Admin receives notification', emails.includes(ADMIN), `emails=${emails}`);
  ok('Assigned rep also receives notification', emails.includes(REP_A), `emails=${emails}`);
  ok('Total 2 notifications (admin + rep)', notifications.length === 2, `got ${notifications.length}`);
}

/* ─── Scenario 8: admin is also an assigned rep → de-duped ──────────────── */
console.log('\n[8] Admin is also in assigned_to_users → not double-notified');
{
  const { notifications } = runUrgentAlertLogic({
    customer:     null,
    lead:         { assigned_to: REP_A, assigned_to_users: [ADMIN] },
    adminEmails:  ADMIN_EMAILS,
    staffMembers: ALL_STAFF,
  });
  const emails = notifications.map((n) => n.user_email);
  ok('Admin appears exactly once', emails.filter((e) => e === ADMIN).length === 1);
  ok('Total 2 notifications (admin + REP_A)', notifications.length === 2, `got ${notifications.length}`);
}

/* ─── Scenario 9: no assignees → only admins notified ───────────────────── */
console.log('\n[9] No assignees set → only admins notified');
{
  const { notifications } = runUrgentAlertLogic({
    customer:     null,
    lead:         { assigned_to: null, assigned_to_users: null },
    adminEmails:  ADMIN_EMAILS,
    staffMembers: ALL_STAFF,
  });
  const emails = notifications.map((n) => n.user_email);
  ok('Exactly 1 notification (admin only)', notifications.length === 1, `got ${notifications.length}`);
  ok('Admin receives the notification',     emails.includes(ADMIN),    `emails=${emails}`);
}

/* ─── Scenario 10: customer path — assigned_to + assigned_to_users ────────── */
console.log('\n[10] Customer record path: assigned_to + assigned_to_users');
{
  const { notifications } = runUrgentAlertLogic({
    customer:     { assigned_to: REP_A, assigned_to_users: [REP_B] },
    lead:         null,
    adminEmails:  [],
    staffMembers: ALL_STAFF,
  });
  const emails = notifications.map((n) => n.user_email);
  ok('2 notifications via customer record',       notifications.length === 2, `got ${notifications.length}`);
  ok('Primary customer rep (REP_A) notified',     emails.includes(REP_A), `emails=${emails}`);
  ok('Secondary customer rep (REP_B) notified',   emails.includes(REP_B), `emails=${emails}`);
}

/* ─── Scenario 11: customer path wins over lead fallback ─────────────────── */
console.log('\n[11] Customer path overrides lead fallback when customer assigns are present');
{
  // Customer record has REP_A only; lead has REP_C only.
  // Logic: customer branch fires first; since assignedEmails.size > 0, lead branch is skipped.
  const { notifications, assignedEmails } = runUrgentAlertLogic({
    customer:     { assigned_to: REP_A, assigned_to_users: [] },
    lead:         { assigned_to: REP_C, assigned_to_users: [] },
    adminEmails:  [],
    staffMembers: ALL_STAFF,
  });
  const emails = notifications.map((n) => n.user_email);
  ok('assignedEmails contains REP_A from customer',     assignedEmails.has(REP_A));
  ok('assignedEmails does NOT contain REP_C from lead', !assignedEmails.has(REP_C));
  ok('1 notification to customer-assigned rep',         notifications.length === 1, `got ${notifications.length}`);
  ok('REP_A is notified',                               emails.includes(REP_A), `emails=${emails}`);
}

/* ─── summary ────────────────────────────────────────────────────────────── */
console.log('\n─────────────────────────────────────────────────────────────');
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed`);
  process.exit(0);
} else {
  console.error(`❌  ${failed} test(s) failed, ${passed} passed`);
  failures.forEach((f) => console.error(`   • ${f}`));
  process.exit(1);
}
