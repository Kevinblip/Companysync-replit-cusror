#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const plugin = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const page = fs.readFileSync('src/pages/MyAssignments.jsx', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const handlerStart = plugin.indexOf('async getCustomerCompletionCandidates');
assert.notEqual(handlerStart, -1, 'completion candidate handler must exist');
const handlerEnd = plugin.indexOf('\n  },', handlerStart);
assert.notEqual(handlerEnd, -1, 'completion candidate handler must be closed');
const handler = plugin.slice(handlerStart, handlerEnd);

assert.match(handler, /getUserFromRequest\(req\)/, 'candidate lookup must require an authenticated session');
assert.match(handler, /caller\.is_super_admin/, 'candidate lookup must distinguish super-admin access');
assert.match(handler, /staff_profiles/, 'candidate lookup must resolve the current assignee');
assert.match(handler, /i\.customer_id IS NOT NULL/, 'candidate lookup must require linked customer invoices');
assert.match(handler, /payments p/, 'candidate lookup must calculate payment totals from payment rows');
assert.match(handler, /COALESCE\(p\.status, 'received'\) NOT IN/, 'candidate lookup must exclude failed/refunded/pending payments');
assert.match(handler, /COUNT\(it\.id\)/, 'candidate lookup must evaluate every invoice, not just one');
assert.match(handler, /BOOL_AND/, 'candidate lookup must require all invoices to be settled');
assert.match(handler, /p\.customer_id = cf\.id/, 'candidate lookup must exclude customers with active projects');
assert.match(handler, /t\.customer_id = cf\.id/, 'candidate lookup must exclude customers with open tasks');
assert.match(handler, /NOT IN \('completed', 'kept_active'\)/, 'candidate lookup must honor prior prompt decisions');
assert.match(handler, /LOWER\(TRIM\(COALESCE\(c\.assigned_to/, 'candidate lookup must stay scoped to the current assignee');
assert.doesNotMatch(handler, /i\.amount_paid/, 'candidate lookup must not trust the invoice cached amount_paid field');

assert.match(page, /getCustomerCompletionCandidates/, 'My Assignments must load completion candidates');
assert.match(page, /customer-completion-review/, 'My Assignments must render the review prompt');
assert.match(page, /customer-completion-checking/, 'My Assignments must show a completion check loading state');
assert.match(page, /customer-completion-error/, 'My Assignments must show a non-blocking completion check error');
assert.match(page, /completion-accept-/, 'My Assignments must offer Mark Completed');
assert.match(page, /completion-keep-active-/, 'My Assignments must offer Keep Active');
assert.match(page, /completion_prompt/, 'the decision must be persisted on the customer record');
assert.match(page, /status: "completed"/, 'accepting the prompt must update the customer status');
assert.match(page, /status: decision/, 'the keep-active decision must be recorded');

assert.equal(
  packageJson.scripts['test:paid-customer-completion'],
  'node scripts/test-paid-customer-completion.cjs',
  'the completion regression test must be runnable from npm',
);

console.log('PASS: paid customer completion candidates are guarded and confirmable');