#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

if (!process.env.COLLECTIONS_TEST_CHILD) {
  for (const TZ of ['America/New_York', 'America/Los_Angeles', 'UTC', 'Asia/Kolkata']) {
    execFileSync(process.execPath, [__filename], {
      env: { ...process.env, TZ, COLLECTIONS_TEST_CHILD: '1' }, stdio: 'inherit',
    });
  }
} else (async () => {
  const { buildCollectionsAnalytics, companyCalendarToday } = await import('../src/utils/collectionsForecast.js');
  const now = new Date('2026-10-10T16:00:00Z');
  const payment = (id, amount, payment_date, extra = {}) => ({ id, amount, payment_date, status: 'received', ...extra });
  const historical = [
    payment('july', 100, '2026-07-01'),
    payment('august', 200, '2026-08-01'),
    payment('september', 300, '2026-09-01T00:00:00.000Z'),
    payment('october', 90, '2026-10-05'),
  ];
  let result = buildCollectionsAnalytics({ payments: historical, now });
  assert.equal(result.totalCollections, 690);
  assert.equal(result.thisMonthCollections, 90);
  assert.equal(result.lastMonthCollections, 300);
  assert.equal(result.thisYearCollections, 690);
  assert.equal(result.averagePayment, 172.5);
  assert.equal(result.growthPercent, 50);
  assert.deepEqual(result.forecast.sourceMonths.map(m => m.key), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(result.forecast.predictions.map(p => p.month), ['Nov 2026', 'Dec 2026', 'Jan 2027']);
  assert.deepEqual(result.forecast.predictions.map(p => p.baseline), [200, 200, 200]);
  assert.deepEqual(result.forecast.range, [100, 300]);
  assert.match(result.history.at(-1).month, /MTD/);
  assert.equal(result.history.find(m => m.key === '2026-06').revenue, null);

  const invoices = [
    { id: 'i1', invoice_number: 'INV1', customer_id: 'c1', total_amount: 1000, amount_paid: 700, status: 'partially_paid', due_date: '2026-11-01' },
    { id: 'paid-no-evidence', total_amount: 10000, amount_paid: 10000, status: 'paid', due_date: '2026-11-01' },
    { id: 'draft', total_amount: 99999, status: 'draft', due_date: '2026-11-01' },
    { id: 'cancelled', total_amount: 99999, status: 'cancelled', due_date: '2026-11-01' },
    { id: 'overdue', total_amount: 80, status: 'sent', due_date: '2026-10-01' },
    { id: 'current', total_amount: 150, status: 'sent', due_date: '2026-10-25' },
    { id: 'undated', total_amount: 160, status: 'sent' },
    { id: 'later', total_amount: 200, status: 'sent', due_date: '2027-02-01' },
  ];
  result = buildCollectionsAnalytics({ now, invoices, payments: [
    ...historical,
    payment('credit', 600, '2026-10-06', { invoice_id: 'i1' }),
    payment('fee', 100, '2026-10-06', { invoice_id: 'i1', data: { data: { is_withheld_offset: 'true' } } }),
    payment('pending', 100000, '2026-10-06', { status: 'ach_pending' }),
    payment('failed', 100000, '2026-10-06', { status: 'failed' }),
    payment('future', 100000, '2026-10-11'),
  ] });
  assert.equal(result.totalCollections, 1290, 'paid invoices, offsets, pending and future entries are not cash');
  assert.equal(result.forecast.dueMonths['2026-11'].amount, 300, 'actual payments AND withheld credits reduce the invoice balance');
  assert.equal(result.forecast.dueMonths['2026-11'].count, 1);
  assert.equal(result.forecast.predictions[0].baseline, 200, 'due balances must not be added to the history baseline');
  assert.deepEqual(result.forecast.buckets, { overdue: 80, thisMonth: 150, undated: 160, later: 200 });
  assert.equal(result.forecast.reviewCount, 1);
  assert(result.warnings.some(w => w.includes('future-dated')));

  result = buildCollectionsAnalytics({ now, payments: [
    payment('completed', 0.1, '2026-09-01', { status: 'completed' }),
    payment('paid', 0.2, '2026-09-01', { status: 'paid' }),
    payment('partial', 10, '2026-09-01', { status: 'partial' }),
    payment('legacy', 5, '2026-09-01', { status: null }),
    payment('refunded', 999, '2026-09-01', { status: 'refunded' }),
    payment('offset', 999, '2026-09-01', { is_withheld_offset: true }),
    payment('undated', 20, ''),
    payment('fallback', 30, '', { created_date: '2026-09-01T00:00:00.000Z' }),
    payment('invalid-amount', 'junk', '2026-09-01'),
    payment('invalid-date', 50, '2026-02-30'),
  ] });
  assert.equal(result.lastMonthCollections, 15.3, 'entry timestamp fallback is converted to the company timezone');
  assert.equal(result.history.find(month => month.key === '2026-08').revenue, 30);
  assert.equal(result.totalCollections, 115.3);
  assert.equal(result.forecast.sufficientHistory, false);
  assert.equal(result.forecast.predictions[0].baseline, null);
  assert(result.warnings.some(w => w.includes('no valid date')));
  assert(result.warnings.some(w => w.includes('entry date')));
  assert(result.warnings.some(w => w.includes('invalid amounts')));
  result = buildCollectionsAnalytics({ now, payments: [] });
  assert.equal(result.growthPercent, null);
  assert.equal(result.averagePayment, 0);
  assert.equal(result.forecast.sufficientHistory, false);

  result = buildCollectionsAnalytics({ now, invoices: [
    { id: 'a', invoice_number: 'DUP', customer_id: 'a', status: 'sent', total_amount: 100, due_date: '2026-11-01' },
    { id: 'b', invoice_number: 'DUP', customer_id: 'b', status: 'sent', total_amount: 100, due_date: '2026-11-01' },
  ], payments: [payment('ambiguous', 50, '2026-10-05', { invoice_number: 'DUP' })] });
  assert.equal(result.totalCollections, 50, 'ambiguous allocation never erases real cash');
  assert.equal(result.forecast.dueMonths['2026-11'].amount, 0, 'do not invent balances while an old payment link is ambiguous');
  assert.equal(result.forecast.reviewCount, 2);
  result = buildCollectionsAnalytics({ now, invoices: [
    { id: 'unique', invoice_number: 'UNIQUE', customer_id: 'c', status: 'sent', total_amount: 100, due_date: '2026-11-01' },
  ], payments: [payment('legacy-linked', 50, '2026-10-05', { invoice_number: 'UNIQUE', customer_id: 'c' })] });
  assert.equal(result.forecast.dueMonths['2026-11'].amount, 50);

  // Reporting follows the company calendar, not the browser's month near midnight UTC.
  const rollover = new Date('2026-10-01T02:00:00Z');
  const eastern = companyCalendarToday(rollover, 'America/New_York');
  assert.equal(eastern.getMonth(), 8);
  assert.equal(eastern.getDate(), 30);
  result = buildCollectionsAnalytics({ now: rollover, timeZone: 'America/New_York', payments: historical });
  assert.equal(result.forecast.predictions[0].month, 'Oct 2026');
  assert.equal(result.forecast.sufficientHistory, false, 'September is not yet completed in the company timezone');
  result = buildCollectionsAnalytics({ now: new Date('2026-12-31T17:00:00Z'), payments: historical });
  assert.deepEqual(result.forecast.predictions.map(p => p.month), ['Jan 2027', 'Feb 2027', 'Mar 2027']);
  result = buildCollectionsAnalytics({ now, payments: [payment('early', 1, '2026-01-01'), payment('sept-only', 99, '2026-09-01')] });
  assert.equal(result.forecast.predictions[0].baseline, 33, 'zero-cash completed months inside recorded history stay in the average');
  result = buildCollectionsAnalytics({ now, payments: historical, goals: [{ goal_type: 'monthly', year: '2026', month: '10', target_amount: 1000 }] });
  assert.equal(result.history.at(-1).goal, 1000);
  assert.equal(result.history.at(-2).goal, null, 'no invented $50k goal');
  assert.equal(historical.length, 4, 'reporting is read-only');
  console.log(`PASS ${process.env.TZ}: real cash, completed-month baseline, timezone boundaries, due balances, legacy evidence and warnings`);
})().catch(error => { console.error(error); process.exitCode = 1; });
