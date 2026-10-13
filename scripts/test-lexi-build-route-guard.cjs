#!/usr/bin/env node
/**
 * A build must never be created as a plain calendar event.
 *
 * Real incident: Lexi was asked to schedule a Duckworth build. It called
 * create_calendar_event with event_type "meeting" and title "Duckworth Build
 * Job". The event appeared on the calendar, the Build Schedule stayed empty,
 * and Lexi reported success. The system prompt already forbade this, so the
 * enforcement has to live in the tool handlers.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  calendarBuildRouteGuard,
  manageEntityBuildRouteGuard,
  detectCalendarBuildIntent,
  BUILD_ROUTE_CODE,
} = require('../lib/lexiBuildIntent.cjs');

const blocked = [
  { title: 'Duckworth Build Job', event_type: 'meeting' },      // the real incident
  { title: 'Duckworth build', event_type: 'meeting' },
  { title: 'Smith siding install', event_type: 'appointment' },
  { title: 'Jones roof installation', event_type: 'other' },
  { title: 'Tear-off at 12 Oak', event_type: 'meeting' },
  { title: 'Re-roof Miller', event_type: 'meeting' },
  { title: 'Roof replacement for Bailey', event_type: 'meeting' },
  { title: 'Replace the roof at 5688 Gemini Ct', event_type: 'meeting' },
  { title: 'Siding job — Walton', event_type: 'appointment' },
  { title: 'Gutter crew at Redmon', event_type: 'meeting' },
  { title: 'Crew day', description: 'Gutter install for Ed Bailey', event_type: 'meeting' },
  { title: 'Anything at all', event_type: 'build' },
];
for (const args of blocked) {
  const result = calendarBuildRouteGuard(args);
  assert.ok(result, `must refuse a build routed to the calendar: ${JSON.stringify(args)}`);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.code, BUILD_ROUTE_CODE);
  assert.match(result.error, /create_build_schedule/, 'refusal must name the correct tool');
  assert.match(result.error, /No event was created/, 'refusal must state nothing was written');
}

const allowed = [
  { title: 'Meeting with Ali', event_type: 'meeting' },
  { title: 'Call LeTrice about the estimate', event_type: 'call' },
  { title: 'Roof inspection at 5688 Gemini Ct', event_type: 'inspection' },
  { title: 'Remind me to order shingles', event_type: 'reminder' },
  { title: 'Adjuster appointment', event_type: 'appointment' },
  { title: 'Building permit pickup', event_type: 'meeting' },
  { title: 'Builders association lunch', event_type: 'meeting' },
];
for (const args of allowed) {
  assert.strictEqual(calendarBuildRouteGuard(args), null, `must allow a normal event: ${JSON.stringify(args)}`);
}

// The override must not be a flag the model can simply assert on its first
// call — that is the very instruction-following this guard backstops.
const walkthrough = { title: 'Pre-build walkthrough with Duckworth', start_time: '2026-09-08T12:00:00Z', event_type: 'meeting' };
const refusal = calendarBuildRouteGuard(walkthrough);
assert.ok(refusal, 'a build-sounding meeting is refused on the first attempt');
assert.ok(refusal.retry_token, 'an overridable refusal must issue a retry token');
assert.ok(calendarBuildRouteGuard({ ...walkthrough, not_a_build: true }), 'a bare not_a_build flag must NOT release the guard');
assert.ok(calendarBuildRouteGuard({ ...walkthrough, not_a_build_token: 'x'.repeat(32) }), 'a forged token must not release the guard');
assert.strictEqual(
  calendarBuildRouteGuard({ ...walkthrough, not_a_build_token: refusal.retry_token }),
  null,
  'the server-issued token releases a genuine meeting',
);
// A token is bound to the whole event it was issued for — otherwise a retry
// could keep the innocent title and move the build into the description.
assert.ok(
  calendarBuildRouteGuard({ title: 'Duckworth Build Job', start_time: '2026-09-08T12:00:00Z', event_type: 'meeting', not_a_build_token: refusal.retry_token }),
  'a token issued for one event must not release a different title',
);
assert.ok(
  calendarBuildRouteGuard({ ...walkthrough, description: 'Full roof tear-off and install for Duckworth', not_a_build_token: refusal.retry_token }),
  'a token must not release a retry that smuggles the build into the description',
);
assert.ok(
  calendarBuildRouteGuard({ ...walkthrough, start_time: '2026-09-09T12:00:00Z', not_a_build_token: refusal.retry_token }),
  'a token must not release a retry moved to another time',
);
assert.strictEqual(detectCalendarBuildIntent(walkthrough).overridable, true);

// event_type 'build' is unambiguous: no token is offered and none releases it.
const hardRefusal = calendarBuildRouteGuard({ title: 'x', start_time: '2026-09-08T12:00:00Z', event_type: 'build' });
assert.ok(hardRefusal && !hardRefusal.retry_token, 'an explicit build event_type gets no override token');
assert.ok(
  calendarBuildRouteGuard({ title: 'x', start_time: '2026-09-08T12:00:00Z', event_type: 'build', not_a_build_token: 'y'.repeat(32) }),
  'an explicit build event_type cannot be overridden',
);
assert.strictEqual(detectCalendarBuildIntent({ title: 'x', event_type: 'build' }).overridable, false);

// The generic CRUD tool must not become the back door around the guard.
for (const name of ['CalendarEvent', 'calendar_event', 'calendar_events', 'EVENT']) {
  assert.ok(
    manageEntityBuildRouteGuard(name, 'create', { title: 'Duckworth Build Job', event_type: 'meeting' }),
    `manage_entity create must be guarded for ${name}`,
  );
}
assert.strictEqual(manageEntityBuildRouteGuard('CalendarEvent', 'create', { title: 'Meeting with Ali' }), null, 'normal events still pass manage_entity');
assert.strictEqual(manageEntityBuildRouteGuard('Customer', 'create', { title: 'Duckworth Build Job' }), null, 'non-calendar entities are unaffected');
assert.strictEqual(manageEntityBuildRouteGuard('CalendarEvent', 'list', { title: 'Duckworth Build Job' }), null, 'reads are unaffected');

// Every Lexi runtime that exposes these tools must call the guards —
// these handlers have drifted apart before.
const handlers = [
  'functions/lexiChat.ts',
  'functions/lexiBridgeAPI.ts',
  'vite-functions-plugin.js',
  'vite-lexi-native-plugin.js',
  'prod-server.cjs',
  'db/prod-integrations.cjs',
];
for (const file of handlers) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(source, /create_calendar_event/, `${file} should still expose the calendar tool`);
  assert.match(source, /calendarBuildRouteGuard\(/, `${file} must run the build-route guard before creating an event`);
  assert.match(source, /manageEntityBuildRouteGuard\(/, `${file} must guard the generic CRUD path too`);
}

// The two copies of the detector must stay in lockstep.
const cjs = fs.readFileSync(path.join(__dirname, '..', 'lib/lexiBuildIntent.cjs'), 'utf8');
const ts = fs.readFileSync(path.join(__dirname, '..', 'functions/utils/buildIntent.ts'), 'utf8');
const pattern = /BUILD_WORD_RE = (\/.*\/i);/;
assert.strictEqual(cjs.match(pattern)[1], ts.match(pattern)[1], 'lib/lexiBuildIntent.cjs and functions/utils/buildIntent.ts must share one pattern');

console.log('Lexi build-route guard checks passed.');
