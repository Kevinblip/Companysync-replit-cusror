import { describe, expect, it } from 'vitest';
import recalculator from '../../lib/invoicePaymentRecalculator.cjs';
import reversal from '../../lib/standaloneFeeReversal.cjs';

const { allocatePaymentsToInvoices } = recalculator;
const { createFinancialOperations, dateOnly, feeNameFromNotes, isStandaloneFee, rateNoteFromNotes } = reversal;

describe('authoritative invoice payment ownership', () => {
  const invoices = [
    { id: 'invoice-a', company_id: 'company-a', invoice_number: 'INV-7', customer_id: 'customer-a' },
    { id: 'invoice-b', company_id: 'company-a', invoice_number: 'INV-7', customer_id: 'customer-b' },
    { id: 'invoice-c', company_id: 'company-a', invoice_number: 'INV-8', customer_id: 'customer-c' },
  ];

  it('preserves modern and invoice-number legacy payments without auto-crediting customer-only cash', () => {
    const totals = allocatePaymentsToInvoices([
      { id: 'modern', invoice_id: 'invoice-a', amount: 100, status: 'completed' },
      { id: 'number-and-customer', invoice_number: 'INV-7', customer_id: 'customer-a', amount: 25 },
      { id: 'customer-only', customer_id: 'customer-c', amount: 30 },
      { id: 'failed', invoice_id: 'invoice-a', amount: 999, status: 'failed' },
    ], invoices);
    expect(totals.get('invoice-a')).toBe(125);
    expect(totals.get('invoice-b')).toBe(0);
    expect(totals.get('invoice-c')).toBe(0);
  });

  it('blocks ambiguity relevant to the target but ignores unrelated ambiguity', () => {
    const ambiguous = [{ id: 'ambiguous', invoice_number: 'INV-7', amount: 50 }];
    expect(() => allocatePaymentsToInvoices(ambiguous, invoices, { targetInvoiceId: 'invoice-a' }))
      .toThrow('ambiguous invoice ownership');
    expect(() => allocatePaymentsToInvoices(ambiguous, invoices, { targetInvoiceId: 'invoice-c' }))
      .not.toThrow();
  });
});

describe('standalone fee legacy fingerprint', () => {
  it('normalizes PostgreSQL timestamp Date objects to accounting dates', () => {
    expect(dateOnly(new Date('2026-09-08T12:34:56.000Z'))).toBe('2026-09-08');
    expect(dateOnly('2026-09-08T12:34:56.000Z')).toBe('2026-09-08');
  });

  it.each([
    ['Assignment fee (9% of $14,224.50) — deducted from payment, no cash received.', 'Assignment fee'],
    ['Assignment fee (9% of invoice total $14,224.50) — deducted from payment, no cash received.', 'Assignment fee'],
    ['Assignment fee ($1,280.21 entry; approximately 9% of invoice total $14,224.50) — deducted from payment, no cash received.', 'Assignment fee'],
    ['Permit fee — deducted from payment, no cash received.', 'Permit fee'],
  ])('extracts legacy fee name from %s', (notes, expected) => {
    expect(feeNameFromNotes(notes)).toBe(expected);
  });

  it('retains legacy calculator rate text for exact expense fingerprinting', () => {
    expect(rateNoteFromNotes(
      'Assignment fee ($1,280.21 entry; approximately 9% of invoice total $14,224.50) — deducted from payment, no cash received.'
    )).toBe('($1,280.21 entry; approximately 9% of invoice total $14,224.50)');
  });

  it('does not claim commission split offsets as standalone fees', () => {
    expect(isStandaloneFee({
      notes: 'Fee withheld by Rep — deducted from payment, no cash received.',
    })).toBe(false);
  });
});

function basicFixture({ paymentPresent = true, authorized = true, failRecalc = false } = {}) {
  const calls = [];
  const invoice = {
    id: 'invoice-1', company_id: 'company-1', invoice_number: 'INV-1',
    customer_id: 'customer-1', total_amount: 1000, amount_paid: 600, status: 'partially_paid',
  };
  const feePayment = {
    id: 'fee-payment', company_id: 'company-1', invoice_id: 'invoice-1',
    invoice_number: 'INV-1', customer_id: 'customer-1', amount: 100,
    payment_date: new Date('2026-09-08T12:00:00.000Z'),
    notes: 'Assignment fee (10% of $1,000.00) — deducted from payment, no cash received.',
    data: { withheld_expense_id: 'fee-expense' },
  };
  const realPayment = {
    id: 'real-payment', company_id: 'company-1', invoice_number: 'INV-1',
    customer_id: 'customer-1', amount: 500, status: 'completed',
  };
  const client = {
    release() { calls.push('release'); },
    async query(sql) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      calls.push(compact);
      if (compact.startsWith('SELECT * FROM payments WHERE id =')) {
        return { rowCount: paymentPresent ? 1 : 0, rows: paymentPresent ? [feePayment] : [] };
      }
      if (compact.includes('FROM generic_entities') && compact.includes('withheld_offset_payment_id')) return { rowCount: 0, rows: [] };
      if (compact.includes('FROM generic_entities') && compact.includes('(id = $2 OR')) {
        return { rowCount: 1, rows: [{ id: 'fee-expense', company_id: 'company-1', data: { withheld_offset_payment_id: 'fee-payment' } }] };
      }
      if (compact.startsWith('SELECT * FROM invoices') && compact.includes('(($2::text')) return { rowCount: 1, rows: [invoice] };
      if (compact.startsWith('SELECT * FROM invoices WHERE company_id')) {
        if (failRecalc) throw new Error('recalculation failed');
        return { rowCount: 1, rows: [invoice] };
      }
      if (compact.startsWith('SELECT * FROM payments WHERE company_id')) return { rowCount: 1, rows: [realPayment] };
      return { rowCount: 1, rows: [] };
    },
  };
  const pool = {
    async query() { return { rowCount: authorized ? 1 : 0, rows: authorized ? [{}] : [] }; },
    async connect() { calls.push('connect'); return client; },
  };
  return {
    calls,
    operations: createFinancialOperations({
      getPool: () => pool,
      getUserFromRequest: async () => ({ email: 'member@example.test', company_id: 'company-1' }),
    }),
  };
}

function serializedLegacyFixture({ failRecalc = false } = {}) {
  const invoice = {
    id: 'invoice-1', company_id: 'company-1', invoice_number: 'INV-1',
    customer_id: 'customer-1', total_amount: 1000, amount_paid: 700, status: 'partially_paid',
  };
  const fee = id => ({
    id, company_id: 'company-1', invoice_id: 'invoice-1', invoice_number: 'INV-1',
    customer_id: 'customer-1', amount: 100, payment_date: new Date('2026-09-08T12:00:00Z'),
    notes: 'Permit fee — deducted from payment, no cash received.',
  });
  const initial = {
    payments: [fee('fee-1'), fee('fee-2'), {
      id: 'cash', company_id: 'company-1', invoice_number: 'INV-1',
      customer_id: 'customer-1', amount: 500, status: 'completed',
    }],
    expenses: [{
      id: 'expense-1', company_id: 'company-1',
      data: {
        vendor_name: 'Permit fee', amount: '100', expense_date: '2026-09-08',
        reference_number: 'INV-1', invoice_id: 'invoice-1', customer_id: 'customer-1',
      },
    }],
    invoice: { ...invoice },
  };
  let persisted = structuredClone(initial);
  let lockTail = Promise.resolve();

  const pool = {
    async query() { return { rowCount: 1, rows: [{}] }; },
    async connect() {
      let local;
      let releaseLock;
      let hasLock = false;
      return {
        release() {},
        async query(sql, params = []) {
          const compact = sql.replace(/\s+/g, ' ').trim();
          if (compact === 'BEGIN') { local = structuredClone(persisted); return { rowCount: 0, rows: [] }; }
          if (compact.includes('pg_advisory_xact_lock')) {
            if (hasLock) return { rowCount: 1, rows: [] };
            const previous = lockTail;
            let unlock;
            lockTail = new Promise(resolve => { unlock = resolve; });
            await previous;
            releaseLock = unlock;
            hasLock = true;
            // READ COMMITTED sees committed rows after waiting for the lock.
            local = structuredClone(persisted);
            return { rowCount: 1, rows: [] };
          }
          if (compact.startsWith('SELECT * FROM payments WHERE id =')) {
            const row = local.payments.find(payment => payment.id === params[0]);
            return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
          }
          if (compact.includes('FROM generic_entities') && compact.includes("data->>'withheld_offset_payment_id' = $2")) {
            const rows = local.expenses.filter(expense => expense.data.withheld_offset_payment_id === params[1]);
            return { rowCount: rows.length, rows };
          }
          if (compact.includes('FROM generic_entities') && compact.includes("LOWER(BTRIM")) {
            return { rowCount: local.expenses.length, rows: local.expenses };
          }
          if (compact.startsWith('DELETE FROM generic_entities')) {
            local.expenses = local.expenses.filter(expense => expense.id !== params[0]);
            return { rowCount: 1, rows: [] };
          }
          if (compact.startsWith('DELETE FROM payments')) {
            local.payments = local.payments.filter(payment => payment.id !== params[0]);
            return { rowCount: 1, rows: [] };
          }
          if (compact.startsWith('SELECT * FROM invoices') && compact.includes('(($2::text')) {
            return { rowCount: 1, rows: [local.invoice] };
          }
          if (compact.startsWith('SELECT * FROM invoices WHERE company_id')) {
            if (failRecalc) throw new Error('recalculation failed');
            return { rowCount: 1, rows: [local.invoice] };
          }
          if (compact.startsWith('SELECT * FROM payments WHERE company_id')) {
            return { rowCount: local.payments.length, rows: local.payments };
          }
          if (compact.startsWith('UPDATE invoices')) {
            local.invoice.amount_paid = params[0];
            local.invoice.status = params[1];
            return { rowCount: 1, rows: [] };
          }
          if (compact === 'COMMIT') {
            persisted = structuredClone(local);
            releaseLock?.();
            return { rowCount: 0, rows: [] };
          }
          if (compact === 'ROLLBACK') {
            releaseLock?.();
            return { rowCount: 0, rows: [] };
          }
          return { rowCount: 1, rows: [] };
        },
      };
    },
  };
  const operations = createFinancialOperations({
    getPool: () => pool,
    getUserFromRequest: async () => ({ email: 'member@example.test', company_id: 'company-1' }),
  });
  return { initial, operations, state: () => persisted };
}

describe('atomic standalone fee reversal SQL operation', () => {
  it('locks, deletes the exact pair, preserves number-only cash, and recalculates before commit', async () => {
    const { calls, operations } = basicFixture();
    await expect(operations.undoStandaloneFeeDeduction(
      { paymentId: 'fee-payment', companyId: 'company-1' }, null, { headers: {} }
    )).resolves.toMatchObject({ success: true, expense_id: 'fee-expense', amount_paid: 500 });
    expect(calls.findIndex(sql => sql.includes('payments WHERE id = $1') && sql.includes('FOR UPDATE')))
      .toBeLessThan(calls.findIndex(sql => sql.startsWith('DELETE FROM generic_entities')));
    expect(calls.findIndex(sql => sql.startsWith('DELETE FROM payments')))
      .toBeLessThan(calls.findIndex(sql => sql.startsWith('UPDATE invoices')));
    expect(calls.findIndex(sql => sql.startsWith('UPDATE invoices'))).toBeLessThan(calls.indexOf('COMMIT'));
  });

  it('rolls back pair deletion when recalculation fails', async () => {
    const fixture = serializedLegacyFixture({ failRecalc: true });
    const before = structuredClone(fixture.state());
    await expect(fixture.operations.undoStandaloneFeeDeduction(
      { paymentId: 'fee-1', companyId: 'company-1' }, null, { headers: {} }
    )).resolves.toEqual({ success: false, error: 'recalculation failed' });
    expect(fixture.state()).toEqual(before);
    expect(fixture.state().payments.find(payment => payment.id === 'cash')?.amount).toBe(500);
  });

  it('serializes concurrent competing legacy claims so only one pair is removed', async () => {
    const fixture = serializedLegacyFixture();
    const results = await Promise.all([
      fixture.operations.undoStandaloneFeeDeduction(
        { paymentId: 'fee-1', companyId: 'company-1' }, null, { headers: {} }
      ),
      fixture.operations.undoStandaloneFeeDeduction(
        { paymentId: 'fee-2', companyId: 'company-1' }, null, { headers: {} }
      ),
    ]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(results.filter(result => !result.success)).toHaveLength(1);
    expect(fixture.state().expenses).toHaveLength(0);
    expect(fixture.state().payments.filter(payment => payment.id.startsWith('fee-'))).toHaveLength(1);
    expect(fixture.state().payments.find(payment => payment.id === 'cash')?.amount).toBe(500);
  });

  it('is retry-safe after deletion and authenticates before opening a transaction', async () => {
    const absent = basicFixture({ paymentPresent: false });
    await expect(absent.operations.undoStandaloneFeeDeduction(
      { paymentId: 'fee-payment', companyId: 'company-1' }, null, { headers: {} }
    )).resolves.toEqual({ success: true, already_deleted: true });
    expect(absent.calls.some(sql => sql.startsWith('DELETE '))).toBe(false);

    const denied = basicFixture({ authorized: false });
    await expect(denied.operations.undoStandaloneFeeDeduction(
      { paymentId: 'fee-payment', companyId: 'company-1' }, null, { headers: {} }
    )).resolves.toEqual({ success: false, error: 'Not authorized for this company' });
    expect(denied.calls).toEqual([]);
  });
});