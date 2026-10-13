'use strict';

// Execute the financial branches from BOTH chat runtimes, not just source-pattern
// assertions: an undeclared context variable passes syntax/build checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createGroundingLedger, auditLexiResponse } = require('../lib/lexiGrounding.cjs');
const { requiredReadTool } = require('../lib/lexiReadIntent.cjs');
const { buildLexiToolFallback } = require('../lib/lexiToolFallback.cjs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function financialBranch(file, instant, period, expected) {
  const source = fs.readFileSync(file, 'utf8');
  const section = source.split("else if (fname === 'get_financial_summary')")[1].split("else if (fname === 'get_staff_sales_summary')")[0];
  const body = section.slice(section.indexOf('const period ='), section.lastIndexOf('}'));
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return new Date(instant).getTime(); }
  }
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params });
    return sql.includes('FROM payments')
      ? { rows: [{ count: '2', total: '1234.50' }] }
      : { rows: [{ status: 'paid', count: '1', total: '8000' }] };
  } };
  const run = new AsyncFunction('args', 'pool', 'actualCompanyId', 'userTimeZone', 'actionsExecuted', 'Date',
    `let toolResult; ${body}; return toolResult;`);
  const result = await run({ period }, pool, 'isolated-test-tenant', 'America/New_York', [], Clock);
  assert.equal(result.success, true);
  assert.equal(result.cash_received, 1234.5);
  assert.equal(result.invoices_issued, 8000);
  assert.equal(result.payment_count, 2);
  assert.deepEqual(result.period_range, expected);
  assert.equal(queries.length, 2);
  for (const q of queries) assert.deepEqual(q.params, ['isolated-test-tenant', expected.start, expected.end_exclusive]);
  const ledger = createGroundingLedger({ userMessage: 'how much income came in last month?' });
  ledger.record('get_financial_summary', { period }, result);
  assert.equal(auditLexiResponse(buildLexiToolFallback('get_financial_summary', result), ledger).blocked, false);
  console.log(`PASS ${file}: ${period} execution and grounded cash result`);
}

async function main() {
  for (const file of ['vite-functions-plugin.js', 'db/prod-integrations.cjs']) {
    await financialBranch(file, '2026-10-03T21:26:00Z', 'last_month', { start: '2026-09-01', end_exclusive: '2026-10-01' });
    await financialBranch(file, '2026-01-03T21:26:00Z', 'last_month', { start: '2025-12-01', end_exclusive: '2026-01-01' });
    // UTC is already October, but the company is still in September.
    await financialBranch(file, '2026-10-01T01:00:00Z', 'last_month', { start: '2026-08-01', end_exclusive: '2026-09-01' });
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /turn === 0 \? requiredReadTool/);
    assert.match(source, /allowedFunctionNames: \[requiredRead\]/);
  }
  assert.equal(requiredReadTool('how much income came in last month?', true), 'get_financial_summary');
  assert.equal(requiredReadTool('what do i have on my calendar for this monday?', true), 'get_calendar_events');
  assert.equal(requiredReadTool('How much money did we make this month?', true), 'get_financial_summary');
  assert.equal(requiredReadTool('how much income came in last month?', false), null);
  assert.equal(requiredReadTool('cancel my calendar event on Monday', true), null);
  assert.equal(requiredReadTool('send an income report to the customer', true), null);
  const ledger = createGroundingLedger({ userMessage: 'what do i have on my calendar for this monday?' });
  const result = { count: 3, events: [
    { title: 'Roof review', start: '10/5/2026, 10:00:00 AM', end: '10/5/2026, 11:00:00 AM' },
    { title: 'Site visit', start: '10/5/2026, 1:30:00 PM', end: '10/5/2026, 2:00:00 PM' },
    { title: 'Team meeting', start: '10/5/2026, 3:15:00 PM', end: '10/5/2026, 4:00:00 PM' },
  ] };
  ledger.record('get_calendar_events', {}, result);
  assert.equal(auditLexiResponse('Monday: Roof review at 10 AM, Site visit at 1:30 PM, Team meeting at 3:15 PM.', ledger).blocked, false);
  assert.equal(auditLexiResponse('Roof review starts at 8 AM.', ledger).blocked, true);
  assert.equal(auditLexiResponse(buildLexiToolFallback('get_calendar_events', result), ledger).blocked, false);
  console.log('PASS three calendar results with seconds; invented times still blocked');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });