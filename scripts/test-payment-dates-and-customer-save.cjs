const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

async function run() {
  const { parsePaymentDate, paymentDateInput, paymentIsInPeriod } = await import('../src/utils/paymentDates.js');
  const { cacheSavedCustomer, shouldRefreshCustomerDraft } = await import('../src/utils/customerSaveState.js');
  const { QueryClient } = require('@tanstack/react-query');
  const now = new Date(2026, 9, 9);
  const payments = [
    { amount: 5000, payment_date: '2026-10-01T00:00:00.000Z' },
    { amount: 16000, payment_date: '2026-10-08T00:00:00.000Z' },
  ];
  assert.equal(payments.filter(p => paymentIsInPeriod(p.payment_date, 'this_month', now)).length, 2);
  assert.equal(payments.filter(p => paymentIsInPeriod(p.payment_date, 'this_month', now)).reduce((s, p) => s + p.amount, 0), 21000);
  assert.equal(parsePaymentDate(payments[0].payment_date).getDate(), 1);
  assert.equal(paymentDateInput(payments[0].payment_date), '2026-10-01');
  assert.equal(paymentDateInput('2026-10-08'), '2026-10-08');
  assert(paymentIsInPeriod('2026-10-31T00:00:00.000Z', 'this_month', now));
  assert(!paymentIsInPeriod('2026-09-30T00:00:00.000Z', 'this_month', now));
  assert(!paymentIsInPeriod('2026-11-01T00:00:00.000Z', 'this_month', now));
  assert(paymentIsInPeriod('2026-12-31T00:00:00.000Z', 'this_year', now));
  assert(paymentIsInPeriod('2025-12-31T00:00:00.000Z', 'last_year', now));
  assert(paymentIsInPeriod('2026-09-30T00:00:00.000Z', 'last_month', now));
  assert(!paymentIsInPeriod(null, 'this_month', now));
  assert(!paymentIsInPeriod('invalid', 'this_month', now));
  assert(paymentIsInPeriod(null, 'all_time', now));
  assert.equal(paymentDateInput(null), '');

  assert.equal(shouldRefreshCustomerDraft({ id: 'one', dirty: true }, 'one'), false);
  assert.equal(shouldRefreshCustomerDraft({ id: 'one', dirty: true }, 'two'), true);
  assert.equal(shouldRefreshCustomerDraft({ id: 'one', dirty: false }, 'one'), true);
  const client = new QueryClient();
  const original = { id: 'one', name: 'Test First', company_id: 'company-a' };
  const unrelated = { id: 'two', name: 'Test First', company_id: 'company-b' };
  client.setQueryData(['customers', 'company-a'], [original]);
  client.setQueryData(['customers', 'company-b'], [unrelated]);
  client.setQueryData(['customer', 'one', ''], original);
  client.setQueryData(['customer', 'two', ''], unrelated);
  cacheSavedCustomer(client, { ...original, name: 'Test First Last' });
  assert.equal(client.getQueryData(['customers', 'company-a'])[0].name, 'Test First Last');
  assert.equal(client.getQueryData(['customer', 'one', '']).name, 'Test First Last');
  assert.equal(client.getQueryData(['customers', 'company-b'])[0].name, 'Test First');
  assert.equal(client.getQueryData(['customer', 'two', '']).name, 'Test First');
  client.clear();
  console.log(`PASS ${process.env.TZ}: both payments total $21,000; calendar bounds; full-name cache; dirty drafts`);
}

if (process.argv.includes('--child')) {
  run().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  for (const TZ of ['America/New_York', 'America/Los_Angeles', 'UTC', 'Asia/Kolkata']) {
    const result = spawnSync(process.execPath, [__filename, '--child'], {
      env: { ...process.env, TZ }, encoding: 'utf8',
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    assert.equal(result.status, 0, `Failed in ${TZ}`);
  }
}
