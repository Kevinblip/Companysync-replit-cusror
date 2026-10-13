'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  accessDenied,
  buildLexiAccessPolicy,
  canUseCrmDataType,
  ownRecordCondition,
  isRestrictedRepTool,
  isPermittedRepTool,
} = require('../lib/lexiAccessPolicy.cjs');

const rep = buildLexiAccessPolicy({
  company: { created_by: 'owner@example.com' },
  userProfile: { user_email: 'bria@example.com', is_administrator: false, is_super_admin: false },
  effectiveEmail: 'Bria@Example.com',
});
assert.equal(rep.isAdmin, false, 'a normal rep must not inherit admin access');
assert.equal(rep.email, 'bria@example.com');
assert.equal(canUseCrmDataType(rep, 'customers'), true, 'reps may retrieve assigned customers');
assert.equal(canUseCrmDataType(rep, 'tasks'), true, 'reps may retrieve assigned tasks');
assert.equal(canUseCrmDataType(rep, 'invoices'), false, 'reps must not browse company invoices');
assert.equal(canUseCrmDataType(rep, 'payments'), false, 'reps must not browse company payments');
assert.match(ownRecordCondition('customers'), /assigned_to/);
assert.match(ownRecordCondition('tasks'), /assignees/);
assert.match(ownRecordCondition('calendar_events'), /attendees/);
assert.equal(accessDenied().code, 'LEXI_ACCESS_DENIED');
assert.equal(isRestrictedRepTool('lookup_customer_by_phone'), true, 'customer snapshots must be denied to reps unless ownership can be verified');
assert.equal(isRestrictedRepTool('get_customer_build_schedule'), true);
assert.equal(isRestrictedRepTool('get_build_schedule'), true, 'legacy restricted list must explicitly identify build reads');
assert.equal(isRestrictedRepTool('get_customer_open_tasks'), true);
assert.equal(isRestrictedRepTool('get_photosync_jobs'), true);
assert.equal(isPermittedRepTool('get_crm_data'), true, 'reps may use the explicitly scoped CRM reader');
assert.equal(isPermittedRepTool('get_calendar_events'), true, 'reps may use the explicitly scoped calendar reader');
assert.equal(isPermittedRepTool('read_emails'), false, 'reps must not read the shared company mailbox');
assert.equal(isPermittedRepTool('record_payment'), false, 'reps must not write payments for arbitrary customers');
assert.equal(isPermittedRepTool('add_note'), false, 'reps must not write notes onto arbitrary records');
assert.equal(isPermittedRepTool('get_build_schedule'), true, 'scoped build reads are permitted for reps');
assert.equal(isPermittedRepTool('create_build_schedule'), true, 'build creation assigns a rep to their own build');

const owner = buildLexiAccessPolicy({
  company: { created_by: 'owner@example.com' },
  userProfile: { user_email: 'owner@example.com', is_administrator: false },
  effectiveEmail: 'owner@example.com',
});
assert.equal(owner.isAdmin, true, 'the company creator must retain company-wide access');
assert.equal(canUseCrmDataType(owner, 'payments'), true);

const unknownUser = buildLexiAccessPolicy({
  company: { created_by: 'owner@example.com' },
  // Simulates a profile lookup miss even if an administrator happens to be the first staff row.
  userProfile: null,
  effectiveEmail: 'case.varied.rep@example.com',
});
assert.equal(unknownUser.isAdmin, false, 'an unmatched identity must fail closed rather than inherit another staff member’s role');

for (const file of ['vite-functions-plugin.js', 'db/prod-integrations.cjs', 'prod-server.cjs']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.doesNotMatch(source, /is_administrator\s*\|\|[^\n]*\|\|\s*true/, `${file} must not grant admin access by fallback`);
  assert.match(source, /lexiAccessDenied/, `${file} must return protected-data denials`);
  assert.match(source, /manage_entity[\s\S]{0,500}?!isAdmin/, `${file} must deny unrestricted entity management to reps`);
  assert.match(source, /isRestrictedRepTool/, `${file} must deny unscoped customer and inspection snapshot tools to reps`);
  assert.match(source, /!isPermittedRepTool/, `${file} must default-deny unscoped Lexi tools for reps`);
}
const chatSource = fs.readFileSync(path.join(__dirname, '..', 'functions/lexiChat.ts'), 'utf8');
assert.match(chatSource, /const effectiveUserEmail = user\.email/, 'text Lexi must use authenticated identity, not body identity');
assert.doesNotMatch(chatSource, /const effectiveUserEmail = userIdentity \|\| userEmail/, 'body identity must not authorize text Lexi');
for (const file of ['functions/lexiChat.ts', 'functions/lexiBridgeAPI.ts']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(source, /getUTCFullYear\(\).*getUTCMonth\(\).*getUTCDate\(\)/s, `${file} must reject rollover build dates`);
  assert.match(source, /Intl\.DateTimeFormat\('en-US', \{ timeZone: timezone/, `${file} must convert the target build date using IANA timezone data`);
  assert.match(source, /CalendarEvent\.delete\(calendarEventId\)/, `${file} must compensate a created event on failure`);
  assert.match(source, /BuildSchedule\.delete\(build\.id\)/, `${file} must compensate a created build on failure`);
  assert.match(source, /Promise\.allSettled/, `${file} must report best-effort cleanup honestly`);
  assert.match(source, /CUSTOMER_AMBIGUOUS/, `${file} must require clarification for non-unique customer matches`);
  assert.match(source, /Saved build records could not be verified/, `${file} must verify linked build records before reporting success`);
}
const buildPageSource = fs.readFileSync(path.join(__dirname, '..', 'src/pages/BuildSchedule.jsx'), 'utf8');
assert.match(buildPageSource, /assigned_to_users/, 'Build Schedule UI must recognize durable email assignments');
assert.match(buildPageSource, /created_by: user\?\.email/, 'Build Schedule UI must include Lexi-created builds for their creator');
const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'src/pages/Dashboard.jsx'), 'utf8');
assert.match(dashboardSource, /assignedEmails\.includes\(myEmail\)/, 'dashboard must restrict reps by email assignments');
assert.doesNotMatch(dashboardSource, /assigned\.length === 0\) return true/, 'unassigned builds must not leak to reps');
const calendarSource = fs.readFileSync(path.join(__dirname, '..', 'src/pages/Calendar.jsx'), 'utf8');
assert.match(calendarSource, /if \(b\.calendar_event_id\) return/, 'linked build events must not render synthetic duplicates');

const viteSource = fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
assert.match(viteSource, /get_calendar_events[\s\S]{0,1200}ownRecordCondition\('calendar_events'/, 'Vite calendar reads must be scoped for reps');
for (const file of ['vite-functions-plugin.js', 'db/prod-integrations.cjs']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(source, /LOWER\(user_email\) = LOWER\(\$2\).*LOWER\(email\) = LOWER\(\$2\)/, `${file} must resolve staff identities case-insensitively`);
  assert.doesNotMatch(source, /staff_profiles WHERE company_id = \$1 LIMIT 1/, `${file} must not inherit the first company profile after an identity miss`);
}
assert.match(viteSource, /if \(isAdmin\) try \{[\s\S]{0,2500}recentActivityContext/, 'organization activity prompt context must be admin-only');
const nativeSource = fs.readFileSync(path.join(__dirname, '..', 'vite-lexi-native-plugin.js'), 'utf8');
assert.match(nativeSource, /buildLexiAccessPolicy/, 'dev native Lexi must apply the shared policy');
assert.match(nativeSource, /!nativePolicy\.isAdmin && !\['get_build_schedule', 'create_build_schedule'\]\.includes\(name\)/, 'dev native must allow only scoped build tools for reps');
assert.match(nativeSource, /buildDayRange\(args\.build_date, companyTimezone\)/, 'native build events must use target-date IANA conversion');
assert.match(nativeSource, /create_build_schedule, never manage_entity or create_calendar_event/, 'native voice must route build scheduling to the build tool instead of a meeting');

const sharedPromptSource = fs.readFileSync(path.join(__dirname, '..', 'lib/lexiSystemPrompt.cjs'), 'utf8');
assert.match(sharedPromptSource, /takes priority over every generic calendar or "schedule anything" rule/, 'shared dev/prod prompt must give build routing precedence over generic scheduling');
assert.match(sharedPromptSource, /never claim it was scheduled unless the tool returns success with a build_id/, 'shared dev/prod prompt must require durable build success before confirmation');
assert.match(chatSource, /Calendars: call create_calendar_event for meetings, appointments, calls, personal reminders, and other non-build events/, 'text Lexi calendar routing must explicitly exclude builds');
assert.doesNotMatch(chatSource, /Calendars: call create_calendar_event the moment you hear "schedule"/, 'text Lexi must not route every schedule request to a calendar meeting');

const buildSources = [
  'functions/lexiChat.ts',
  'functions/lexiBridgeAPI.ts',
  'vite-lexi-native-plugin.js',
  'vite-functions-plugin.js',
  'db/prod-integrations.cjs',
  'prod-server.cjs',
  'lib/lexiSystemPrompt.cjs',
];
for (const file of buildSources) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(source, /get_build_schedule/, `${file} must expose or dispatch the build reader`);
  assert.match(source, /create_build_schedule/, `${file} must expose or dispatch the build creator`);
}
for (const file of ['vite-functions-plugin.js', 'db/prod-integrations.cjs', 'prod-server.cjs']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(source, /entity_type='BuildSchedule' AND company_id=\$1/, `${file} build queries must be tenant-scoped`);
  assert.match(source, /assigned_to_users/, `${file} must store/scope build assignment data`);
  assert.match(source, /LIMIT \$\{limit\}/, `${file} build reads must be bounded`);
}
for (const file of ['vite-functions-plugin.js', 'prod-server.cjs', 'db/prod-integrations.cjs']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(source, /CUSTOMER_AMBIGUOUS/, `${file} must require clarification for ambiguous build customer names`);
  assert.match(source, /Saved build records could not be verified/, `${file} must verify created builds before reporting success`);
  assert.match(source, /assigned_to_users/, `${file} must keep build creation customer lookups scoped for reps`);
}
for (const file of ['vite-functions-plugin.js', 'prod-server.cjs']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(source, /build update could not be verified/, `${file} must not claim generic build updates completed without evidence`);
}
for (const file of ['functions/lexiChat.ts', 'functions/lexiBridgeAPI.ts', 'vite-functions-plugin.js', 'prod-server.cjs']) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(source, /calendar link could not be verified/i, `${file} must create and verify a calendar link when updating a legacy build`);
}
{
  const source = fs.readFileSync(path.join(__dirname, '..', 'db/prod-integrations.cjs'), 'utf8');
  assert.match(source, /entity_name === 'BuildSchedule' && !merged\.calendar_event_id/, 'production Lexi must repair a missing calendar link on a legacy build update');
  assert.match(source, /Saved build records could not be verified/, 'production Lexi must verify the repaired build/calendar link');
}

console.log('Lexi rep access policy checks passed.');