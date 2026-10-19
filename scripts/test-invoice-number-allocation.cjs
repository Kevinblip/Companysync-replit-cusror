'use strict';

const assert = require('assert');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  allocateInvoiceNumber,
  chooseInvoiceNumber,
  nextInvoiceNumberFromNumbers,
  pickInvoiceRow,
  resolvePaymentInvoiceLink,
  withInvoiceWriteTransaction,
} = require('../lib/invoiceNumbers.cjs');

const year = 2026;

assert.strictEqual(
  nextInvoiceNumberFromNumbers(['INV-2026-2026260354243', 'INV-2026-0042', 'INV-2025-9999'], year),
  'INV-2026-0043',
);
assert.strictEqual(
  nextInvoiceNumberFromNumbers(['INV-2026-2026260354243', 'INV-2026-2026260354244'], year),
  'INV-2026-0001',
);
assert.strictEqual(nextInvoiceNumberFromNumbers(['INV-0087'], year), 'INV-2026-0088');

const taken = ['INV-2026-0385'];
const replaced = chooseInvoiceNumber({ numbers: taken, requested: 'INV-2026-0385', year });
assert.strictEqual(replaced.invoiceNumber, 'INV-2026-0386');
assert.strictEqual(replaced.replaced, true);

const kept = chooseInvoiceNumber({ numbers: taken, requested: 'INV-2026-0100', year });
assert.strictEqual(kept.invoiceNumber, 'INV-2026-0100');
assert.strictEqual(kept.replaced, false);

const synced = chooseInvoiceNumber({
  numbers: taken,
  requested: 'INV-2026-0385',
  year,
  keepWhenTaken: 'INV-2026-0100',
});
assert.strictEqual(synced.invoiceNumber, 'INV-2026-0100');
assert.strictEqual(synced.keptExisting, true);

const chad = {
  id: 'inv_1781649945868_w1midi5ea',
  invoice_number: 'INV-2026-0385',
  customer_id: 'cust_chad',
  customer_name: 'Chad Sohl',
};
const beverly = {
  id: 'inv_1782911040494_xaui6rds8',
  invoice_number: 'INV-2026-0385',
  customer_id: 'cust_beverly',
  customer_name: 'Beverly Owens-Jackson',
};
const collision = [chad, beverly];

assert.strictEqual(pickInvoiceRow(collision, { customerId: 'cust_chad' }).invoice.id, chad.id);
assert.strictEqual(pickInvoiceRow(collision, { customerName: 'Beverly Owens-Jackson' }).invoice.id, beverly.id);
assert.strictEqual(pickInvoiceRow(collision, {}).ambiguous, true);

function fakeClient(rows) {
  return {
    async query(sql, params) {
      const text = String(sql);
      if (text.includes('lower(btrim')) {
        const number = String(params[1] || '').trim().toLowerCase();
        const found = rows.filter(row => String(row.invoice_number || '').trim().toLowerCase() === number);
        return { rows: found, rowCount: found.length };
      }
      const found = rows.filter(row => row.id === params[1]);
      return { rows: found, rowCount: found.length };
    },
  };
}

(async () => {
  const byCustomer = await resolvePaymentInvoiceLink(fakeClient(collision), {
    companyId: 'yicn',
    invoiceNumber: 'INV-2026-0385',
    customerName: 'Chad Sohl',
  });
  assert.strictEqual(byCustomer.invoice_id, chad.id);
  assert.strictEqual(byCustomer.invoice_number, 'INV-2026-0385');

  await assert.rejects(
    () => resolvePaymentInvoiceLink(fakeClient(collision), {
      companyId: 'yicn',
      invoiceNumber: 'INV-2026-0385',
    }),
    (error) => error.code === 'AMBIGUOUS_INVOICE_NUMBER',
  );

  const byId = await resolvePaymentInvoiceLink(fakeClient(collision), {
    companyId: 'yicn',
    invoiceId: beverly.id,
    invoiceNumber: 'INV-2026-0385',
  });
  assert.strictEqual(byId.invoice_id, beverly.id);

  const unmatched = await resolvePaymentInvoiceLink(fakeClient(collision), {
    companyId: 'yicn',
    invoiceNumber: 'BI-5551212',
  });
  assert.strictEqual(unmatched.linked, false);
  assert.strictEqual(unmatched.invoice_id, null);
  assert.strictEqual(unmatched.invoice_number, null);
  assert.strictEqual(unmatched.unmatched_number, 'BI-5551212');

  function createFakePool({ honorLock }) {
    const committed = [];
    let lockOwner = null;
    const waiters = [];
    let nextClient = 0;

    function releaseLock(owner) {
      if (lockOwner !== owner) return;
      lockOwner = null;
      const next = waiters.shift();
      if (next) next();
    }

    return {
      committed,
      async connect() {
        const owner = ++nextClient;
        const staged = [];
        let locked = false;
        return {
          async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (text === 'BEGIN') return { rows: [], rowCount: 0 };
            if (text === 'COMMIT' || text === 'ROLLBACK') {
              if (text === 'COMMIT') committed.push(...staged.splice(0));
              else staged.splice(0);
              if (locked) {
                locked = false;
                releaseLock(owner);
              }
              return { rows: [], rowCount: 0 };
            }
            if (text.includes('pg_advisory_xact_lock')) {
              if (honorLock) {
                while (lockOwner && lockOwner !== owner) {
                  await new Promise(resolve => waiters.push(resolve));
                }
                lockOwner = owner;
                locked = true;
              }
              return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('SELECT COALESCE')) {
              const companyId = params[0];
              const exceptId = params[1];
              const rows = committed
                .filter(row => row.company_id === companyId && row.id !== exceptId)
                .map(row => ({ invoice_number: row.invoice_number }));
              return { rows, rowCount: rows.length };
            }
            if (text.startsWith('INSERT INTO invoices')) {
              staged.push({ id: params[0], company_id: params[1], invoice_number: params[2] });
              return { rows: [{ id: params[0] }], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL: ${text}`);
          },
          release() {},
        };
      },
    };
  }

  async function allocateAndInsert(pool, companyId, id) {
    return withInvoiceWriteTransaction(pool, async (client) => {
      const assigned = await allocateInvoiceNumber(client, companyId, { year });
      await client.query(
        'INSERT INTO invoices (id, company_id, invoice_number) VALUES ($1,$2,$3)',
        [id, companyId, assigned.invoiceNumber],
      );
      return assigned.invoiceNumber;
    });
  }

  const locked = createFakePool({ honorLock: true });
  const lockedNumbers = await Promise.all([
    allocateAndInsert(locked, 'yicn', 'first'),
    allocateAndInsert(locked, 'yicn', 'second'),
  ]);
  assert.deepStrictEqual(lockedNumbers.slice().sort(), ['INV-2026-0001', 'INV-2026-0002']);

  const unlocked = createFakePool({ honorLock: false });
  const unlockedNumbers = await Promise.all([
    allocateAndInsert(unlocked, 'yicn', 'first'),
    allocateAndInsert(unlocked, 'yicn', 'second'),
  ]);
  assert.deepStrictEqual(unlockedNumbers, ['INV-2026-0001', 'INV-2026-0001']);

  const limitOne = 'LOWER(invoice_number) = LOWER($2) LIMIT 1';
  for (const file of ['prod-server.cjs', 'vite-functions-plugin.js', 'db/prod-integrations.cjs']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.strictEqual(source.includes(limitOne), false, `${file} still links a payment with LIMIT 1`);
    assert.strictEqual(source.includes('resolvePaymentInvoiceLink'), true, `${file} must resolve payments by invoice id`);
  }

  for (const file of ['db/schema.js', 'db/prod-db.cjs']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.strictEqual(
      /CREATE UNIQUE INDEX[^;]*invoice_number/i.test(source),
      false,
      `${file} must not create the unique invoice-number index at startup`,
    );
  }

  const migration = fs.readFileSync('db/migrations/20261017_invoice_number_unique.sql', 'utf8');
  assert.match(migration, /CREATE UNIQUE INDEX CONCURRENTLY/i);
  assert.match(migration, /DO NOT APPLY/i);
  assert.match(migration, /uq_invoices_company_invoice_number/);

  const printed = spawnSync(process.execPath, ['scripts/check-duplicate-invoice-numbers.cjs'], { encoding: 'utf8' });
  assert.strictEqual(printed.status, 0);
  assert.match(printed.stdout, /No database connection was opened/);
  assert.match(printed.stdout, /GROUP BY company_id/);

  const secretUrl = 'postgres://user:s3cret-token@getcompanysync.com/db';
  const refused = spawnSync(process.execPath, ['scripts/check-duplicate-invoice-numbers.cjs', '--execute'], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: secretUrl },
  });
  assert.strictEqual(refused.status, 2);
  const refusedOutput = `${refused.stdout}${refused.stderr}`;
  assert.strictEqual(refusedOutput.includes(secretUrl), false);
  assert.strictEqual(refusedOutput.includes('s3cret-token'), false);
  assert.match(refusedOutput, /Refusing to connect/);

  console.log('invoice number allocation and payment-link contracts passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
