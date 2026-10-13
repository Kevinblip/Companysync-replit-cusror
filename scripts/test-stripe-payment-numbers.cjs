'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PAYMENT_NUMBER_LOCK_NAMESPACE,
  allocatePaymentNumber,
  backfillMissingPaymentNumbers,
} = require('../lib/paymentNumbers.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function getPaymentNumber(payment) {
  return String(payment.payment_number || payment.data?.payment_number || '').trim();
}

function createFakePool(payments) {
  const locks = [];
  const client = {
    async query(sql, values = []) {
      const query = sql.replace(/\s+/g, ' ').trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(query)) return { rows: [], rowCount: 0 };
      if (query.includes('pg_advisory_xact_lock')) {
        locks.push(values);
        return { rows: [], rowCount: 1 };
      }
      if (query.includes('COUNT(*)::int AS total')) {
        const companyRows = payments.filter((p) => p.company_id === values[0]);
        return {
          rows: [{
            total: companyRows.length,
            already_numbered: companyRows.filter((p) => getPaymentNumber(p)).length,
          }],
          rowCount: 1,
        };
      }
      if (query.includes('payment_year')) {
        const rows = payments
          .filter((p) => p.company_id === values[0] && !getPaymentNumber(p))
          .map((p) => ({
            id: p.id,
            payment_year: new Date(p.created_at || p.payment_date).getUTCFullYear(),
          }))
          .sort((a, b) => {
            const left = payments.find((p) => p.id === a.id);
            const right = payments.find((p) => p.id === b.id);
            return String(left.created_at || left.payment_date).localeCompare(String(right.created_at || right.payment_date))
              || a.id.localeCompare(b.id);
          });
        return { rows, rowCount: rows.length };
      }
      if (query.includes('MAX(') && query.includes('payment_value')) {
        const companyId = values[0];
        const pattern = new RegExp(values[1]);
        const max = payments
          .filter((p) => p.company_id === companyId)
          .map(getPaymentNumber)
          .filter((value) => pattern.test(value))
          .map((value) => Number(value.match(/-(\d+)$/)?.[1] || 0))
          .reduce((value, next) => Math.max(value, next), 0);
        return { rows: [{ max_number: max }], rowCount: 1 };
      }
      if (query.startsWith('UPDATE payments') && query.includes('SET payment_number')) {
        const [paymentNumber, paymentId, companyId] = values;
        const payment = payments.find((p) => p.id === paymentId && p.company_id === companyId);
        if (!payment || getPaymentNumber(payment)) return { rows: [], rowCount: 0 };
        payment.payment_number = paymentNumber;
        return { rows: [{ id: payment.id }], rowCount: 1 };
      }
      throw new Error(`Unexpected mock SQL: ${query}`);
    },
    release() {},
  };
  return {
    locks,
    async connect() { return client; },
  };
}

async function run() {
  const payments = [
    {
      id: 'existing-2025',
      company_id: 'company-a',
      payment_number: 'PAY-2025-0008',
      amount: 125,
      reference_number: 'pi_existing',
      status: 'completed',
      created_at: '2025-02-01T12:00:00Z',
    },
    {
      id: 'legacy-json-number',
      company_id: 'company-a',
      payment_number: null,
      data: { payment_number: 'PAY-2025-0010', note: 'keep this data' },
      amount: 99,
      reference_number: 'pi_legacy',
      status: 'completed',
      created_at: '2025-02-02T12:00:00Z',
    },
    {
      id: 'missing-2025',
      company_id: 'company-a',
      payment_number: '',
      data: {},
      amount: 75,
      reference_number: 'pi_missing_2025',
      status: 'completed',
      created_at: '2025-02-03T12:00:00Z',
    },
    {
      id: 'existing-2026',
      company_id: 'company-a',
      payment_number: 'PAY-2026-0042',
      amount: 200,
      reference_number: 'pi_existing_2026',
      status: 'completed',
      created_at: '2026-01-01T12:00:00Z',
    },
    {
      id: 'missing-2026',
      company_id: 'company-a',
      payment_number: null,
      data: {},
      amount: 50,
      reference_number: 'pi_missing_2026',
      status: 'ach_pending',
      created_at: '2026-03-01T12:00:00Z',
    },
    {
      id: 'other-company',
      company_id: 'company-b',
      payment_number: null,
      data: {},
      amount: 10,
      reference_number: 'pi_other_company',
      status: 'completed',
      created_at: '2026-01-01T12:00:00Z',
    },
  ];
  const pool = createFakePool(payments);
  const client = await pool.connect();

  assert.equal(await allocatePaymentNumber(client, 'company-a', 2025), 'PAY-2025-0011');
  assert.deepEqual(pool.locks[0], ['company-a', PAYMENT_NUMBER_LOCK_NAMESPACE]);

  const summary = await backfillMissingPaymentNumbers(pool, 'company-a');
  assert.deepEqual(summary, {
    total_payments: 5,
    already_had_number: 3,
    successfully_assigned: 2,
    errors: 0,
    error_details: [],
  });
  assert.equal(payments.find((p) => p.id === 'missing-2025').payment_number, 'PAY-2025-0011');
  assert.equal(payments.find((p) => p.id === 'missing-2026').payment_number, 'PAY-2026-0043');
  assert.equal(payments.find((p) => p.id === 'legacy-json-number').payment_number, null);
  assert.deepEqual(payments.find((p) => p.id === 'legacy-json-number').data, {
    payment_number: 'PAY-2025-0010',
    note: 'keep this data',
  });
  assert.equal(payments.find((p) => p.id === 'missing-2025').amount, 75);
  assert.equal(payments.find((p) => p.id === 'missing-2025').reference_number, 'pi_missing_2025');
  assert.equal(payments.find((p) => p.id === 'missing-2025').status, 'completed');
  assert.equal(payments.find((p) => p.id === 'other-company').payment_number, null);

  const secondRun = await backfillMissingPaymentNumbers(pool, 'company-a');
  assert.equal(secondRun.successfully_assigned, 0, 'backfill is idempotent');
  assert.equal(secondRun.already_had_number, 5);

  const devStripe = read('vite-stripe-plugin.js');
  const prodServer = read('prod-server.cjs');
  const functionPlugin = read('vite-functions-plugin.js');
  const devSchema = read('db/schema.js');
  const prodSchema = read('db/prod-db.cjs');
  const utilities = read('src/pages/Utilities.jsx');

  assert.equal((devStripe.match(/allocatePaymentNumber\(/g) || []).length, 2, 'dev card and ACH inserts allocate numbers');
  assert.equal((prodServer.match(/allocatePaymentNumber\(/g) || []).length, 3, 'prod card, ACH, and recovery inserts allocate numbers');
  assert.ok(devStripe.includes('invoice_number, payment_number, customer_name'));
  assert.ok(prodServer.includes('invoice_number, payment_number, customer_name'));
  assert.ok(devSchema.includes('ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_number TEXT'));
  assert.ok(prodSchema.includes('ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_number TEXT'));
  assert.ok(functionPlugin.includes('functionHandlers.backfillPaymentNumbers'));
  assert.ok(utilities.includes("base44.functions.invoke('backfillPaymentNumbers', {"));
  assert.ok(utilities.includes('company_id: myCompany?.id'));

  console.log('Stripe payment-number allocation and backfill checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});