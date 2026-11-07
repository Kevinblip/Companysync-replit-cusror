#!/usr/bin/env node
// Lexi finance tools. Fixture rows only. No database and no outbound send.
'use strict';

const lexi = require('../lib/lexiPhone.cjs');
const finance = require('../lib/lexiFinance.cjs');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const PIN = '4271';
const OWNER = { companyId: 'co_lexi', userEmail: 'kevin@example.com', name: 'Kevin', phone: '+15555550123' };
const NOW = new Date('2026-10-21T15:00:00Z');

function config() {
  return {
    ...lexi.configFromEnv({ LEXI_PHONE_ALLOWLIST: '+15555550123' }),
    pin: PIN,
    companyId: OWNER.companyId,
    userEmail: OWNER.userEmail,
    userName: 'Kevin',
  };
}

function invoice(row) {
  return {
    company_id: 'co_lexi',
    status: 'sent',
    total_amount: 0,
    amount_paid: 0,
    data: {},
    ...row,
  };
}

const FIXTURE = {
  invoices: [
    invoice({ id: 'inv_10', customer_id: 'cus_a', customer_name: 'Ada Lane', customer_email: 'ada@example.com', invoice_number: '1042', total_amount: 100, due_date: '2026-10-11', data: { stripe_payment_link: 'https://pay.example/1042' } }),
    invoice({ id: 'inv_45', customer_id: 'cus_b', customer_name: 'Ben Ortiz', customer_email: 'ben@example.com', invoice_number: '1043', total_amount: 200, due_date: '2026-09-06' }),
    invoice({ id: 'inv_70', customer_id: 'cus_c', customer_name: 'Cara Nguyen', invoice_number: '1044', total_amount: 50, due_date: '2026-08-12' }),
    invoice({ id: 'inv_120', customer_id: 'cus_d', customer_name: 'Drew Patel', invoice_number: '1045', total_amount: 25, due_date: '2026-06-23' }),
    invoice({ id: 'inv_future', customer_id: 'cus_e', customer_name: 'Eve Cho', invoice_number: '1046', total_amount: 80, due_date: '2026-10-26' }),
    invoice({ id: 'inv_partial', customer_id: 'cus_f', customer_name: 'Smith Roofing', customer_email: 'smith@example.com', invoice_number: '1047', total_amount: 1000, amount_paid: 0, due_date: '2026-11-01', status: 'sent' }),
    invoice({ id: 'inv_cancelled', customer_name: 'Gone Co', invoice_number: '1048', total_amount: 900, due_date: '2026-01-01', status: 'cancelled' }),
    invoice({ id: 'inv_other', company_id: 'co_other', customer_name: 'Other Tenant', invoice_number: '9999', total_amount: 99999, due_date: '2026-01-01', status: 'sent' }),
  ],
  payments: [
    { id: 'pay_today', company_id: 'co_lexi', customer_name: 'Ada Lane', invoice_id: 'inv_10', invoice_number: '1042', amount: 40, status: 'completed', payment_date: '2026-10-21T14:00:00Z' },
    { id: 'pay_week', company_id: 'co_lexi', customer_name: 'Ben Ortiz', invoice_id: 'inv_45', amount: 15, status: 'completed', payment_date: '2026-10-19T16:00:00Z' },
    { id: 'pay_month', company_id: 'co_lexi', customer_name: 'Eve Cho', invoice_id: 'inv_future', amount: 10, status: 'received', payment_date: '2026-10-02T15:00:00Z' },
    { id: 'pay_last', company_id: 'co_lexi', customer_name: 'Drew Patel', invoice_id: 'inv_120', amount: 8, status: 'completed', payment_date: '2026-09-15T15:00:00Z' },
    { id: 'pay_partial', company_id: 'co_lexi', customer_name: 'Smith Roofing', invoice_id: 'inv_partial', invoice_number: '1047', amount: 400, status: 'completed', payment_date: '2026-10-20T15:00:00Z' },
    { id: 'pay_failed', company_id: 'co_lexi', customer_name: 'Smith Roofing', invoice_id: 'inv_partial', amount: 600, status: 'failed', payment_date: '2026-10-21T14:00:00Z' },
    { id: 'pay_night', company_id: 'co_lexi', customer_name: 'Ada Lane', amount: 5, status: 'completed', payment_date: '2026-10-21T02:00:00Z' },
    { id: 'pay_other', company_id: 'co_other', customer_name: 'Other Tenant', invoice_id: 'inv_other', amount: 99999, status: 'completed', payment_date: '2026-10-21T14:00:00Z' },
  ],
  estimates: [
    { id: 'est_1', company_id: 'co_lexi', customer_name: 'Smith Roofing', estimate_number: 'E-12', title: 'Roof', status: 'viewed', total_amount: 2400 },
    { id: 'est_other', company_id: 'co_other', customer_name: 'Smith Roofing', estimate_number: 'E-99', title: 'Other', status: 'paid', total_amount: 1 },
  ],
  customers: [
    { id: 'cus_a', name: 'Ada Lane', phone: '+15555550111', email: 'ada@example.com' },
    { id: 'cus_b', name: 'Ben Ortiz', phone: '+15555550112', email: 'ben@example.com' },
    { id: 'cus_c', name: 'Cara Nguyen', phone: '+15555550113', email: 'cara@example.com' },
    { id: 'cus_d', name: 'Drew Patel', phone: '+15555550114', email: 'drew@example.com' },
    { id: 'cus_e', name: 'Eve Cho', phone: '+15555550115', email: 'eve@example.com' },
    { id: 'cus_f', name: 'Smith Roofing', phone: '+15555550116', email: 'smith@example.com' },
  ],
  companies: [{ id: 'co_lexi', company_name: 'YICN' }],
};

function financePool(extraInvoices = [], extraPayments = []) {
  const calls = [];
  const pool = {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const companyId = params && params[0];
      if (/FROM invoices/i.test(sql)) {
        return { rows: FIXTURE.invoices.concat(extraInvoices).filter((row) => !companyId || row.company_id === companyId) };
      }
      if (/FROM payments/i.test(sql)) {
        return { rows: FIXTURE.payments.concat(extraPayments).filter((row) => !companyId || row.company_id === companyId) };
      }
      if (/FROM estimates/i.test(sql)) {
        return { rows: FIXTURE.estimates.filter((row) => !companyId || row.company_id === companyId) };
      }
      if (/FROM customers/i.test(sql)) {
        return { rows: companyId === 'co_lexi' ? FIXTURE.customers : [] };
      }
      if (/FROM companies/i.test(sql)) {
        return { rows: FIXTURE.companies.filter((row) => row.id === companyId) };
      }
      if (/FROM communications/i.test(sql)) return { rows: [] };
      if (/INSERT|UPDATE|DELETE/i.test(sql)) throw new Error(`unexpected write: ${sql}`);
      return { rows: [] };
    },
  };
  return pool;
}

function unlocked() {
  const state = lexi.sessionFromThread(lexi.emptyThread('+15555550123'));
  state.pinVerified = true;
  return state;
}

async function tool(name, args, state, extra = {}) {
  return lexi.executePhoneTool(
    { name, args },
    {
      state,
      config: config(),
      pool: extra.pool || financePool(),
      owner: OWNER,
      sendCustomerMessage: extra.sendCustomerMessage,
    }
  );
}

async function main() {
  console.log('\nPeriods');
  const today = finance.periodBounds({ period: 'today' }, NOW);
  const week = finance.periodBounds({ period: 'this week' }, NOW);
  const month = finance.periodBounds({ period: 'this month' }, NOW);
  const last = finance.periodBounds({ period: 'last month' }, NOW);
  check('today is the New York calendar day', today.startYmd === '2026-10-21' && today.endYmd === '2026-10-21');
  check('this week starts Monday', week.startYmd === '2026-10-19' && week.endYmd === '2026-10-21');
  check('this month starts on the first', month.startYmd === '2026-10-01' && month.endYmd === '2026-10-21');
  check('last month is the full previous month', last.startYmd === '2026-09-01' && last.endYmd === '2026-09-30');
  check('aging buckets stay on the named edges', finance.agingBucket(1) === '0-30' && finance.agingBucket(30) === '0-30' && finance.agingBucket(31) === '31-60' && finance.agingBucket(90) === '61-90' && finance.agingBucket(91) === '90+');

  console.log('\nPayments');
  const pool = financePool();
  const state = unlocked();
  const payments = await finance.summarizePayments(pool, OWNER, { period: 'this month' }, NOW);
  check('this month counts received payments and skips failed and other tenants', payments.count === 5 && payments.total === 470, JSON.stringify({ count: payments.count, total: payments.total }));
  const todayPay = await finance.summarizePayments(pool, OWNER, { period: 'today' }, NOW);
  check('today uses New York and skips a failed payment', todayPay.count === 1 && todayPay.total === 40, JSON.stringify(todayPay));
  const lastPay = await finance.summarizePayments(pool, OWNER, { period: 'last month' }, NOW);
  check('last month is separate', lastPay.count === 1 && lastPay.total === 8);
  const ada = await finance.summarizePayments(pool, OWNER, { period: 'this month', customer: 'Ada' }, NOW);
  check('customer filter limits the total', ada.count === 2 && ada.total === 45);
  check('text rows stay at ten or fewer', payments.rows.length <= 10);
  check('the spoken total has dollars and cents', payments.total_spoken === '$470.00');

  console.log('\nReceivables');
  const owed = await finance.summarizeReceivables(pool, OWNER, NOW);
  check('partial payment reduces the balance', owed.outstanding === 982, String(owed.outstanding));
  check('open invoices skip cancelled and other tenants', owed.open_count === 6, String(owed.open_count));
  check('overdue total excludes the future invoice', owed.overdue_total === 312, String(owed.overdue_total));
  check('aging buckets', owed.aging['0-30'] === '$60.00' && owed.aging['31-60'] === '$185.00' && owed.aging['61-90'] === '$50.00' && owed.aging['90+'] === '$17.00', JSON.stringify(owed.aging));

  const smith = await finance.lookupInvoice(pool, OWNER, { invoice_number: '1047' }, NOW);
  check('invoice lookup shows partial and the remaining balance', smith.matches[0].status === 'partial' && smith.matches[0].balance === 600 && smith.matches[0].amount_paid === 400, JSON.stringify(smith.matches && smith.matches[0]));
  const adaInv = await finance.lookupInvoice(pool, OWNER, { customer: 'Ada Lane' }, NOW);
  check('customer balance subtracts the payment', adaInv.matches[0].balance === 60 && adaInv.matches[0].days_overdue === 10 && adaInv.matches[0].bucket === '0-30');
  const missing = await finance.lookupInvoice(pool, OWNER, { invoice_number: '9999' }, NOW);
  check('another tenant invoice is invisible', missing.matches.length === 0);

  const estimate = await finance.lookupEstimate(pool, OWNER, { customer: 'Smith' });
  check('estimate status stays on this company', estimate.matches.length === 1 && estimate.matches[0].status === 'viewed' && estimate.matches[0].estimate_number === 'E-12');

  console.log('\nReminders');
  const draftState = unlocked();
  const drafted = await finance.draftPaymentReminder(pool, OWNER, { invoice_number: '1042', channel: 'sms' }, draftState, NOW);
  check('a reminder is a draft', drafted.drafted === true && drafted.sent === false);
  check('the draft names the amount, invoice, and saved payment link', /\$60\.00/.test(drafted.read_back) && /1042/.test(drafted.read_back) && /https:\/\/pay\.example\/1042/.test(drafted.read_back));
  draftState.latestUserText = 'please send that';
  const held = await lexi.executePhoneTool({ name: 'confirm_send', args: {} }, { state: draftState, config: config(), pool, owner: OWNER, sendCustomerMessage: async () => { throw new Error('should not send'); } });
  check('a vague yes does not send the reminder', held.code === 'CONFIRMATION_REQUIRED' && draftState.pendingDraft);

  const overdue = [];
  const overdueCustomers = [];
  for (let i = 0; i < 21; i += 1) {
    overdue.push(invoice({
      id: `inv_od_${i}`,
      customer_id: `cus_od_${i}`,
      customer_name: `Overdue ${i}`,
      invoice_number: `OD-${i}`,
      total_amount: 1000 - i,
      due_date: '2026-09-01',
    }));
    overdueCustomers.push({ id: `cus_od_${i}`, name: `Overdue ${i}`, phone: `+15555551${String(i).padStart(3, '0')}`, email: `od${i}@example.com` });
  }
  const batchPool = {
    query: async (sql, params) => {
      const companyId = params && params[0];
      if (/FROM invoices/i.test(sql)) return { rows: overdue.filter((row) => row.company_id === companyId) };
      if (/FROM payments/i.test(sql)) return { rows: [] };
      if (/FROM estimates/i.test(sql)) return { rows: [] };
      if (/FROM customers/i.test(sql)) return { rows: overdueCustomers };
      if (/FROM companies/i.test(sql)) return { rows: [{ company_name: 'YICN' }] };
      if (/INSERT|UPDATE|DELETE/i.test(sql)) throw new Error(`unexpected write: ${sql}`);
      return { rows: [] };
    },
  };
  const batchState = unlocked();
  const prepared = await tool('prepare_overdue_reminders', { channel: 'sms' }, batchState, { pool: batchPool });
  check('the batch lists each reminder and stops at 20', prepared.drafted === true && prepared.sent === false && prepared.count === 20 && prepared.left_out === 1, JSON.stringify({ count: prepared.count, left: prepared.left_out }));
  check('each listed reminder has a recipient', prepared.items.every((item) => item.contact_name && item.invoice_number && item.amount && item.to));
  batchState.latestUserText = 'yes send the reminders';
  let batchSends = 0;
  const notYet = await tool('confirm_send', {}, batchState, { pool: batchPool, sendCustomerMessage: async () => { batchSends += 1; return { success: true }; } });
  check('the batch waits for yes, send it', notYet.code === 'CONFIRMATION_REQUIRED' && batchSends === 0);
  batchState.latestUserText = 'yes, send it';
  const sentBatch = await tool('confirm_send', {}, batchState, {
    pool: batchPool,
    sendCustomerMessage: async () => { batchSends += 1; return { success: true }; },
  });
  check('one yes sends the capped batch', sentBatch.sent === true && sentBatch.count === 20 && batchSends === 20);

  const stagingState = unlocked();
  await tool('prepare_overdue_reminders', { channel: 'sms' }, stagingState, { pool: batchPool });
  stagingState.latestUserText = 'yes, send it';
  const stagingSends = [];
  const blocked = await tool('confirm_send', {}, stagingState, {
    pool: batchPool,
    sendCustomerMessage: async (draft) => {
      stagingSends.push(draft.to);
      return { success: false, suppressed: true, error: 'Staging has outbound messages turned off, so this was not sent.' };
    },
  });
  check('staging logs the batch and does not clear it', blocked.sent === false && /not sent/i.test(blocked.error) && stagingState.pendingReminderBatch.items.length === 20 && stagingSends.length === 20);

  console.log('\nGates');
  const locked = lexi.sessionFromThread(lexi.emptyThread('+15555550123'));
  const pinPool = financePool();
  const denied = await tool('summarize_receivables', {}, locked, { pool: pinPool });
  check('money answers need the PIN', denied.code === 'PIN_REQUIRED' && pinPool.calls.length === 0);
  const write = await tool('refund_payment', { invoice_number: '1047', amount: 10 }, unlocked(), { pool: pinPool });
  check('a refund is refused', write.code === 'FINANCE_READ_ONLY');
  const created = await tool('create_invoice', { customer: 'Ada', total: 10 }, unlocked(), { pool: pinPool });
  check('creating an invoice is refused', created.code === 'FINANCE_READ_ONLY');
  const voided = await tool('void_invoice', { invoice_number: '1042' }, unlocked(), { pool: pinPool });
  check('voiding an invoice is refused', voided.code === 'FINANCE_READ_ONLY');
  const removed = await tool('delete_payment', { id: 'pay_today' }, unlocked(), { pool: pinPool });
  check('deleting a payment is still refused', removed.code === 'DELETE_FORBIDDEN', removed.error);
  check('refused writes did not query the books', pinPool.calls.length === 0);

  const prompt = lexi.buildPhoneSystemPrompt({ basePrompt: '', ownerName: 'Kevin', pinVerified: true, companyResolved: true });
  check('a personal follow-up stays a reminder', /remind me Friday to follow up/.test(prompt) && /create_reminder/.test(prompt));
  check('voice money answers stay short', /speak only the spoken total/.test(prompt));
  const textPrompt = lexi.buildPhoneSystemPrompt({ basePrompt: '', ownerName: 'Kevin', pinVerified: true, companyResolved: true, channel: 'sms' });
  check('text may list ten rows', /up to 10 rows/.test(textPrompt));
  check('the prompt forbids charges and voids', /Do not create, edit, void, or delete/.test(prompt) && /Do not refund or charge/.test(prompt));

  const ambiguous = financePool(
    [invoice({ id: 'inv_dup', customer_name: 'Ada Lane', invoice_number: '1042', total_amount: 20, due_date: '2026-10-01' })],
    [{ id: 'pay_amb', company_id: 'co_lexi', customer_name: 'Ada Lane', invoice_number: '1042', amount: 5, status: 'completed', payment_date: '2026-10-21T14:00:00Z' }]
  );
  const unsure = await finance.summarizeReceivables(ambiguous, OWNER, NOW);
  check('an ambiguous payment is not guessed', unsure.code === 'AMBIGUOUS_PAYMENT_OWNERSHIP');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
