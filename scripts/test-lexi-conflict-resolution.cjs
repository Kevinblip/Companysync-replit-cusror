#!/usr/bin/env node
// Source-contract regression for Lexi's conflict/confirmation safety boundary.
// Live calendar overlap coverage remains in test-double-booking-guard.cjs.
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const files = {
  native: fs.readFileSync(path.join(root, 'vite-lexi-native-plugin.js'), 'utf8'),
  text: fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8'),
  prod: fs.readFileSync(path.join(root, 'prod-server.cjs'), 'utf8'),
  prompt: fs.readFileSync(path.join(root, 'lib/lexiSystemPrompt.cjs'), 'utf8'),
};
let failed = 0;
function check(label, value) {
  console.log(`${value ? 'PASS' : 'FAIL'} - ${label}`);
  if (!value) failed++;
}

for (const [name, source] of Object.entries({ native: files.native, text: files.text, prod: files.prod })) {
  check(`${name}: returns structured calendar conflicts`, source.includes("code: 'CALENDAR_CONFLICT'"));
  check(`${name}: stores a tenant-scoped pending confirmation`, source.includes("'LexiPendingSchedule'"));
  check(`${name}: expires/consumes confirmation tokens`, source.includes("SCHEDULE_CONFIRMATION_INVALID") && source.includes("status: 'used'"));
  check(`${name}: re-checks before the calendar write`, source.includes('lexiCheckCalendarConflict') || source.includes('start_time < $4 AND end_time > $3'));
  check(`${name}: validates a requested staff assignee`, source.includes("code: 'INVALID_ASSIGNEE'"));
  check(`${name}: confirmation is restricted to an offered slot`, source.includes('selectedOfferedSlot') && source.includes('saved.alternatives'));
}
check('shared prompt: tells Lexi to ask before rescheduling', files.prompt.includes('CALENDAR CONFLICTS'));
check('shared tool schema: accepts confirmation tokens', files.prompt.includes('confirmation_token'));
check('production: sends reschedule SMS only after insert', files.prod.indexOf('await pool.query(') < files.prod.indexOf('reschedule_sms_message') || files.prod.includes('only attempt it after'));
check('production: exposes confirmation and reschedule arguments', ['assigned_to', 'confirmation_token', 'customer_id', 'lead_id', 'reschedule_sms_message'].every((field) => files.prod.includes(field)));
check('production: returns real alternative slots', files.prod.includes('const alternatives = [];') && files.prod.includes('alternatives.push'));

console.log(`\n${failed ? `${failed} TEST(S) FAILED` : 'ALL TESTS PASSED'}`);
process.exit(failed ? 1 : 0);