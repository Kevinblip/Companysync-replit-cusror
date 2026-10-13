/**
 * scripts/test-lexi-grounding.cjs
 *
 * Lexi anti-hallucination grounding.
 *
 * Covers the three failures reported from production:
 *   - a fabricated person ("Mary Smith") in an inspection answer
 *   - a fabricated dollar figure ("$4500") for a revenue question
 *   - a write reported as done when the record never changed
 *
 * Run: node scripts/test-lexi-grounding.cjs
 */

'use strict';

const assert = require('assert');
const {
  groundingRulesBlock,
  annotateToolResult,
  statusOf,
  rowCountOf,
  createGroundingLedger,
  auditLexiResponse,
  findUngroundedPlaceholderName,
  valueMatches,
  diffRequestedVsStored,
  buildWriteVerificationResult,
} = require('../lib/lexiGrounding.cjs');
const { buildLexiSystemPrompt } = require('../lib/lexiSystemPrompt.cjs');
const {
  isVoiceGroundingSensitive,
  auditVoiceTurn,
} = require('../lib/lexiVoiceGrounding.cjs');
const fs = require('fs');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('\n1. Grounding rules reach the system prompt');

check('the full rule block is embedded in Lexi\'s system prompt', () => {
  const prompt = buildLexiSystemPrompt({
    companyName: 'YICN',
    effectiveName: 'Owner',
    effectiveEmail: 'owner@example.com',
    isAdmin: true,
    customerList: '(No customers yet)',
    currentDateString: 'Sunday, September 6, 2026',
    currentTime: '9:00 AM',
    userTimeZone: 'America/New_York',
    tzOffset: '-04:00',
    todayISO: '2026-09-06',
  });
  assert.match(prompt, /GROUNDING RULES/);
  assert.match(prompt, /Mary Smith/);
  assert.match(prompt, /Nothing is scheduled for that date/);
  assert.match(prompt, /BEFORE value and the AFTER value/);
});

check('the compact block used by voice carries the same hard rules', () => {
  const compact = groundingRulesBlock({ compact: true });
  assert.match(compact, /must come from a tool result in THIS turn/);
  assert.match(compact, /Mary Smith/);
  assert.match(compact, /BEFORE and AFTER/);
});

console.log('\n2. Tool results carry an explicit grounding envelope');

check('an empty read is labelled empty, not silently blank', () => {
  const out = annotateToolResult('get_photosync_jobs', { count: 0, jobs: [] });
  assert.strictEqual(out._source.status, 'empty');
  assert.strictEqual(out._source.row_count, 0);
  assert.match(out._source.instruction, /ZERO matching records/);
});

check('a failed read is labelled failed', () => {
  const out = annotateToolResult('get_financial_summary', { error: 'timeout' });
  assert.strictEqual(out._source.status, 'failed');
  assert.match(out._source.instruction, /do not substitute a similar tool/);
});

check('an access denial is distinguished from a failure', () => {
  const out = annotateToolResult('get_financial_summary', { success: false, code: 'LEXI_ACCESS_DENIED', error: 'nope' });
  assert.strictEqual(out._source.status, 'denied');
});

check('a populated read keeps its original fields and gains a row count', () => {
  const out = annotateToolResult('get_calendar_events', { count: 2, events: [{ title: 'A' }, { title: 'B' }] });
  assert.strictEqual(out._source.status, 'ok');
  assert.strictEqual(out._source.row_count, 2);
  assert.strictEqual(out.count, 2);
  assert.strictEqual(out.events.length, 2);
});

check('row count is inferred from a list when count is absent', () => {
  assert.strictEqual(rowCountOf({ jobs: [1, 2, 3] }), 3);
  assert.strictEqual(rowCountOf({ success: true, id: 'x' }), null);
  assert.strictEqual(statusOf({ success: true, id: 'x' }), 'ok');
});

console.log('\n3. Fabricated people are blocked before the user sees them');

check('"Mary Smith" is blocked when no tool returned her', () => {
  const ledger = createGroundingLedger({ userMessage: 'what inspections do we have friday?' });
  ledger.record('get_photosync_jobs', {}, { count: 0, jobs: [] });
  const audit = auditLexiResponse('You have an inspection with Mary Smith at 10am.', ledger);
  assert.strictEqual(audit.blocked, true);
  assert.strictEqual(audit.reason, 'ungrounded_placeholder_name');
  assert.match(audit.response, /isn't in your CRM/);
  assert.ok(!/Mary Smith/.test(audit.response));
});

check('a real customer with that name passes through', () => {
  const ledger = createGroundingLedger({ userMessage: 'what inspections do we have friday?' });
  ledger.record('get_photosync_jobs', {}, {
    count: 1,
    jobs: [{ id: 'psj_9', client_name: 'Mary Smith', address: '12 Oak St' }],
  });
  const audit = auditLexiResponse('Job psj_9: Mary Smith at 12 Oak St.', ledger);
  assert.strictEqual(audit.blocked, false);
});

check('a name already in the injected customer list counts as grounded', () => {
  const ledger = createGroundingLedger({ userMessage: 'who is john doe', promptContext: 'John Doe (john@x.com), Ed Bailey (ed@x.com)' });
  const audit = auditLexiResponse('John Doe is one of your customers.', ledger);
  assert.strictEqual(audit.blocked, false);
});

check('the detector is case-insensitive', () => {
  const ledger = createGroundingLedger({ userMessage: 'anything friday?' });
  assert.strictEqual(findUngroundedPlaceholderName('Scheduled: MARY SMITH', ledger), 'mary smith');
});

check('saying she cannot find the person is never blocked', () => {
  const ledger = createGroundingLedger({ userMessage: 'anything friday?' });
  const audit = auditLexiResponse("I don't see a John Doe in your CRM.", ledger);
  assert.strictEqual(audit.blocked, false);
});

check('echoing a name the user typed is not a fabrication', () => {
  const ledger = createGroundingLedger({ userMessage: 'add a note to Mary Smith about the gutters' });
  assert.strictEqual(findUngroundedPlaceholderName('Which Mary Smith did you mean?', ledger), null);
});

console.log('\n4. Money answers must be backed by a real money read');

check('"$4,500" is blocked when no money tool succeeded', () => {
  const ledger = createGroundingLedger({ userMessage: 'how much did we make this month?' });
  ledger.record('get_financial_summary', {}, { error: 'query failed' });
  const audit = auditLexiResponse('You brought in about $4,500 this month.', ledger);
  assert.strictEqual(audit.blocked, true);
  assert.strictEqual(audit.reason, 'ungrounded_money_figure');
  assert.match(audit.response, /number of payments/);
});

check('a figure from a successful financial summary passes', () => {
  const ledger = createGroundingLedger({ userMessage: 'how much did we make this month?' });
  ledger.record('get_financial_summary', {}, {
    success: true,
    period_range: { start: '2026-09-01', end: '2026-09-06' },
    total_collected: 4500,
    payment_count: 3,
  });
  const audit = auditLexiResponse('You collected $4,500.00 from 3 payments between 2026-09-01 and 2026-09-06.', ledger);
  assert.strictEqual(audit.blocked, false);
});

check('get_crm_data on payments also grounds a money answer', () => {
  const ledger = createGroundingLedger({ userMessage: 'how much have we collected?' });
  ledger.record('get_crm_data', { data_type: 'payments' }, { count: 2, payments: [{ amount: 100 }, { amount: 50 }] });
  assert.strictEqual(ledger.moneyGrounded, true);
  assert.strictEqual(auditLexiResponse('$150 across 2 payments.', ledger).blocked, false);
});

check('a lead lookup does NOT ground a money answer', () => {
  const ledger = createGroundingLedger({ userMessage: 'how much did we make this month?' });
  ledger.record('get_crm_data', { data_type: 'leads' }, { count: 5, leads: [] });
  assert.strictEqual(ledger.moneyGrounded, false);
  assert.strictEqual(auditLexiResponse('Roughly $12,000.', ledger).blocked, true);
});

check('a zero-revenue result cannot be dressed up as $4,500', () => {
  const ledger = createGroundingLedger({ userMessage: 'how much did we make this month?' });
  ledger.record('get_financial_summary', {}, {
    success: true,
    period_range: { start: '2026-09-01', end: '2026-09-06' },
    total_collected: 0,
    payment_count: 0,
  });
  const audit = auditLexiResponse('You brought in about $4,500 this month.', ledger);
  assert.strictEqual(audit.blocked, true, 'an empty money read must not license a figure');
  assert.strictEqual(audit.reason, 'ungrounded_money_figure');
});

check('reporting $0.00 from a zero result is allowed', () => {
  const ledger = createGroundingLedger({ userMessage: 'how much did we make this month?' });
  ledger.record('get_financial_summary', {}, { success: true, total_collected: 0, payment_count: 0 });
  assert.strictEqual(auditLexiResponse('You have collected $0.00 so far this month.', ledger).blocked, false);
});

check('a denied money lookup cannot be followed by an invented figure', () => {
  const ledger = createGroundingLedger({ userMessage: 'how much did the company make this month?' });
  ledger.record('get_financial_summary', {}, { success: false, code: 'LEXI_ACCESS_DENIED', error: 'admins only' });
  const audit = auditLexiResponse('Company-wide you made about $18,000.', ledger);
  assert.strictEqual(audit.blocked, true);
  assert.match(audit.response, /access-restricted/);
});

check('a figure larger than the payments returned is blocked', () => {
  const ledger = createGroundingLedger({ userMessage: 'how much have we collected?' });
  ledger.record('get_crm_data', { data_type: 'payments' }, { count: 2, payments: [{ amount: 100 }, { amount: 50 }] });
  assert.strictEqual(auditLexiResponse('$4,500 collected.', ledger).blocked, true);
  assert.strictEqual(auditLexiResponse('$100 from one of them.', ledger).blocked, false);
});

check('a figure quoted from an attached PDF is grounded by the PDF text', () => {
  const ledger = createGroundingLedger({
    userMessage: 'How much does this invoice say we are owed?\n\n--- ATTACHED PDF CONTENT (invoice.pdf) ---\nBalance due: $7,325.40\n--- END OF PDF ---',
  });
  assert.strictEqual(auditLexiResponse('The attached invoice shows $7,325.40 due.', ledger).blocked, false);
});

check('a figure NOT in the attached PDF is still blocked', () => {
  const ledger = createGroundingLedger({
    userMessage: 'How much does this invoice say we are owed?\n\n--- ATTACHED PDF CONTENT (invoice.pdf) ---\nBalance due: $7,325.40\n--- END OF PDF ---',
  });
  assert.strictEqual(auditLexiResponse('You are owed about $19,000 overall.', ledger).blocked, true);
});

check('an attached image turn is exempt, since only the model can read it', () => {
  const ledger = createGroundingLedger({ userMessage: '[Attached file: check.jpg | file_url: https://x/y.jpg]\n\nHow much is this check for?' });
  assert.strictEqual(auditLexiResponse('The check is for $1,240.00.', ledger).blocked, false);
});

check('a figure the user themselves supplied is grounded', () => {
  const ledger = createGroundingLedger({ userMessage: 'if we collected $2,500 how much revenue is that after the 10% fee?' });
  assert.strictEqual(auditLexiResponse('That leaves $2,500 gross before the fee.', ledger).blocked, false);
});

check('an access denial explanation is never rewritten', () => {
  const ledger = createGroundingLedger({ userMessage: 'how much did the team make this month?' });
  ledger.record('get_financial_summary', {}, { success: false, code: 'LEXI_ACCESS_DENIED', error: 'admins only' });
  const audit = auditLexiResponse('I can show your own sales, but company-wide totals over $0 are admin-only.', ledger);
  assert.strictEqual(audit.blocked, false);
});

check('a non-money question with a dollar figure is left alone', () => {
  const ledger = createGroundingLedger({ userMessage: 'draft a note about the deposit' });
  const audit = auditLexiResponse('Noted: customer will drop off $500 Friday.', ledger);
  assert.strictEqual(audit.blocked, false);
});

check('an honest refusal with no figure is left alone', () => {
  const ledger = createGroundingLedger({ userMessage: 'how much did we make this month?' });
  ledger.record('get_financial_summary', {}, { error: 'timeout' });
  const audit = auditLexiResponse("I couldn't pull the revenue numbers just now.", ledger);
  assert.strictEqual(audit.blocked, false);
});

console.log('\n5. Writes are verified by re-read, with BEFORE and AFTER');

check('a confirmed reschedule reports before and after', () => {
  const result = buildWriteVerificationResult({
    label: 'CalendarEvent #42',
    requested: { start_time: '2026-09-10T14:00:00-04:00', status: 'scheduled' },
    before: { start_time: '2026-09-08T14:00:00-04:00', status: 'scheduled', title: 'Roof walk' },
    after: { start_time: '2026-09-10T14:00:00-04:00', status: 'scheduled', title: 'Roof walk' },
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.before.start_time, '2026-09-08T14:00:00-04:00');
  assert.strictEqual(result.after.start_time, '2026-09-10T14:00:00-04:00');
  assert.strictEqual(result.before.title, undefined, 'only the requested fields are reported');
});

check('a write that did not take effect is reported as a failure', () => {
  const result = buildWriteVerificationResult({
    label: 'CalendarEvent #42',
    requested: { start_time: '2026-09-10T14:00:00-04:00' },
    before: { start_time: '2026-09-08T14:00:00-04:00' },
    after: { start_time: '2026-09-08T14:00:00-04:00' },
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.verified, false);
  assert.strictEqual(result.mismatches.length, 1);
  assert.match(result.report_instruction, /do not say it was moved/);
});

check('a vanished record fails verification instead of reporting success', () => {
  const result = buildWriteVerificationResult({
    label: 'Lead #7',
    requested: { status: 'won' },
    before: { status: 'new' },
    after: null,
  });
  assert.strictEqual(result.success, false);
  assert.match(result.mismatches[0].stored, /not found on re-read/);
});

check('representation differences do not fake a mismatch', () => {
  assert.strictEqual(valueMatches('2026-09-10', new Date('2026-09-10T16:00:00Z')), true);
  assert.strictEqual(valueMatches('500', 500), true);
  assert.strictEqual(valueMatches('Scheduled', 'scheduled'), true);
  assert.strictEqual(valueMatches(['Roof Install'], ['Roof Install']), true);
  assert.strictEqual(valueMatches('2026-09-10', '2026-09-11'), false);
});

check('the diff only inspects fields the write asked for', () => {
  const diff = diffRequestedVsStored(
    { status: 'confirmed' },
    { status: 'confirmed', notes: 'changed by someone else' },
    { status: 'scheduled', notes: 'original' },
  );
  assert.strictEqual(diff.verified, true);
  assert.deepStrictEqual(Object.keys(diff.after), ['status']);
});

console.log('\n6. Native voice answers use verified same-turn values');

check('a wrong spoken financial total is replaced by the exact tool value', () => {
  const audit = auditVoiceTurn({
    userMessage: 'How much cash did we receive last month?',
    assistantText: 'You received sixty four thousand nine hundred fifty dollars.',
    toolCalls: [{
      name: 'get_financial_summary',
      args: { period: 'last_month' },
      result: {
        success: true,
        period: 'last_month',
        period_range: { start: '2026-08-01', end_exclusive: '2026-09-01' },
        cash_received: 42620,
        invoices_issued: 64950,
        payment_count: 7,
      },
    }],
  });
  assert.strictEqual(audit.replaced, true);
  assert.match(audit.response, /\$42,620\.00/);
  assert.match(audit.response, /2026-08-01 through 2026-08-31/);
  assert.doesNotMatch(audit.response, /\$64,950\.00.*cash received/);
});

check('a failed voice financial lookup refuses instead of stating a number', () => {
  const audit = auditVoiceTurn({
    userMessage: 'What is our revenue this month?',
    assistantText: 'You made twenty six thousand dollars.',
    toolCalls: [{ name: 'get_financial_summary', args: { period: 'this_month' }, result: { success: false, error: 'timeout' } }],
  });
  assert.strictEqual(audit.blocked, true);
  assert.match(audit.response, /won't give you a number/i);
  assert.doesNotMatch(audit.response, /26|twenty six/i);
});

check('a verified zero-result period says exactly zero', () => {
  const audit = auditVoiceTurn({
    userMessage: 'How much did we collect this week?',
    assistantText: 'Nothing yet.',
    toolCalls: [{
      name: 'get_financial_summary',
      args: { period: 'this_week' },
      result: { success: true, period: 'this_week', period_range: { start: '2026-09-07', end_exclusive: '2026-09-08' }, cash_received: 0, invoices_issued: 0, payment_count: 0 },
    }],
  });
  assert.match(audit.response, /cash received was \$0\.00/);
});

check('an invented schedule time is blocked even after a schedule tool succeeds', () => {
  const audit = auditVoiceTurn({
    userMessage: 'What time does the Ed Bailey roof install start?',
    assistantText: 'It starts at 8 AM.',
    toolCalls: [{
      name: 'get_build_schedule',
      args: { customer_name: 'Ed Bailey' },
      result: { success: true, builds: [{ customer_name: 'Ed Bailey', start_time: '2026-09-07T07:00:00-04:00' }] },
    }],
  });
  assert.strictEqual(audit.blocked, true);
  assert.strictEqual(audit.reason, 'ungrounded_schedule_claim');
});

check('voice-sensitive detection covers both money and schedules', () => {
  assert.strictEqual(isVoiceGroundingSensitive('How much did we make in August?'), true);
  assert.strictEqual(isVoiceGroundingSensitive('What time does the roof install start?'), true);
  assert.strictEqual(isVoiceGroundingSensitive('Draft a friendly note'), false);
});

check('development and production native bridges both enforce the shared audit and last_month period', () => {
  const dev = fs.readFileSync(require.resolve('../vite-lexi-native-plugin.js'), 'utf8');
  const prod = fs.readFileSync(require.resolve('../prod-server.cjs'), 'utf8');
  for (const source of [dev, prod]) {
    assert.match(source, /auditVoiceTurn\(voiceTurn\)/);
    assert.match(source, /isVoiceGroundingSensitive\(voiceTurn\.userMessage\)/);
    assert.match(source, /period === 'last_month'/);
    assert.match(source, /type: 'speak_text'/);
  }
});

console.log(`\n${passed} checks passed.`);
if (process.exitCode) {
  console.error('FAILED');
} else {
  console.log('PASSED');
}
