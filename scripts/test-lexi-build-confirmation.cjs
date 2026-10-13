#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildScheduleConfirmationGuard,
  isBuildSchedulingMutation,
  isExplicitConfirmationMessage,
} = require('../lib/lexiBuildConfirmation.cjs');

const details = {
  companyId: 'company-1',
  userEmail: 'owner@example.com',
  action: 'update',
  recordId: 'build-1',
  customerId: 'customer-1',
  customerName: 'Bernadette Bass',
  buildDate: '2026-09-22',
  jobTypes: ['Roof'],
};

const first = buildScheduleConfirmationGuard(details);
assert(first, 'first scheduling attempt must be blocked');
assert.strictEqual(first.code, 'BUILD_CONFIRMATION_REQUIRED');
assert.strictEqual(first.requires_confirmation, true);
assert.match(first.message, /Bernadette Bass/);
assert.match(first.message, /2026-09-22/);

assert.strictEqual(
  buildScheduleConfirmationGuard(details, first.confirmation_token),
  null,
  'the exact confirmed details should be accepted'
);

assert(
  buildScheduleConfirmationGuard({ ...details, customerName: 'Pear' }, first.confirmation_token),
  'a token for Bernadette must not authorize a misheard customer'
);
assert(
  buildScheduleConfirmationGuard({ ...details, buildDate: '2026-09-23' }, first.confirmation_token),
  'a token must not authorize a different date'
);
assert.strictEqual(isBuildSchedulingMutation({ build_date: '2026-09-22' }), true);
assert.strictEqual(isBuildSchedulingMutation({ notes: 'Bring permit' }), false);
assert.strictEqual(isExplicitConfirmationMessage('yes, schedule it'), true);
assert.strictEqual(isExplicitConfirmationMessage('yes, but use a different date'), true);
assert.strictEqual(isExplicitConfirmationMessage('no'), false);

for (const file of ['vite-lexi-native-plugin.js', 'prod-server.cjs', 'functions/lexiChat.ts', 'functions/lexiBridgeAPI.ts']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(source, /buildScheduleConfirmationGuard/, `${file} must enforce build confirmation`);
  assert.match(source, /isBuildSchedulingMutation/, `${file} must guard build date changes`);
  assert.match(source, /created_by_name/, `${file} must persist scheduler identity`);
}

const chatSource = fs.readFileSync(path.join(__dirname, '..', 'functions/lexiChat.ts'), 'utf8');
assert.match(chatSource, /Stop this request at the confirmation boundary/, 'text Lexi must stop after proposing a build');
assert.match(chatSource, /normalizedEntity === 'BuildSchedule' && isBuildSchedulingMutation\(data\)/, 'generic BuildSchedule create must be guarded');

const nativeSource = fs.readFileSync(path.join(__dirname, '..', 'vite-lexi-native-plugin.js'), 'utf8');
assert.match(nativeSource, /pendingToken/, 'native voice must track pending build confirmation');
assert.match(nativeSource, /confirmationState\.pendingToken/, 'native voice must reject same-turn token replay');

const prodSource = fs.readFileSync(path.join(__dirname, '..', 'prod-server.cjs'), 'utf8');
assert.match(prodSource, /const buildConfirmationState = \{ pendingToken: null, userReply: '' \}/, 'production voice must track pending build confirmation');
assert.match(prodSource, /entityType === 'BuildSchedule' && isBuildSchedulingMutation\(a\.entity_data\)/, 'production generic BuildSchedule create must be guarded');

console.log('Lexi build confirmation checks passed.');