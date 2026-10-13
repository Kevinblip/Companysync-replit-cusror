import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { reverseStandaloneDeduction } from '../utils/standaloneDeduction.js';
import { makeInvoiceMatcher, pickInvoiceForPayment } from '../utils/paymentOwnership.js';

const pages = [
  ['InvoiceDetails', readFileSync('src/pages/invoice-details.jsx', 'utf8'), 'undoStandaloneDeductionMutation', 'object'],
  ['Payments', readFileSync('src/pages/Payments.jsx', 'utf8'), 'deletePaymentMutation', 'object'],
  ['CustomerProfile', readFileSync('src/pages/CustomerProfile.jsx', 'utf8'), 'deletePaymentMutation', 'id'],
  ['Dashboard', readFileSync('src/pages/Dashboard.jsx', 'utf8'), 'deletePaymentMutation', 'id'],
];

function pageMutation(source, name, context) {
  const block = source.split(`const ${name} = useMutation({`)[1].split('\n    onSuccess:')[0];
  const fn = block.trim().replace(/^mutationFn:\s*/, '').replace(/,$/, '');
  return new Function(...Object.keys(context), `return (${fn});`)(...Object.values(context));
}

const notes = 'Assignment fee (9% of $14224.50) — deducted from payment, no cash received. Offset by matching expense.';

function setup({ linked = false, outcomes = [true] } = {}) {
  const payment = {
    id: 'payment-fee',
    company_id: 'company',
    invoice_id: 'invoice',
    invoice_number: 'INV-1',
    customer_id: 'customer',
    customer_name: 'Legacy Customer',
    payment_date: '2026-09-08T00:00:00.000Z',
    amount: 100,
    notes,
    ...(linked ? { is_withheld_offset: true, withheld_expense_id: 'expense-fee' } : {}),
  };
  const persistedPayments = [
    { ...payment },
    { id: 'payment-real', company_id: 'company', invoice_id: 'invoice', amount: 500 },
  ];
  const expenses = [{
    id: 'expense-fee',
    company_id: 'company',
    invoice_id: 'invoice',
    reference_number: 'INV-1',
    customer_id: 'customer',
    expense_date: '2026-09-08',
    category: 'other',
    vendor_name: 'Assignment fee',
    amount: 100,
    ...(linked ? { is_withheld_offset: true, withheld_offset_payment_id: 'payment-fee' } : {}),
  }];
  const invoice = {
    id: 'invoice',
    company_id: 'company',
    invoice_number: 'INV-1',
    customer_id: 'customer',
    amount: 14224.50,
    amount_paid: 600,
    status: 'partially_paid',
  };
  const entities = {
    Payment: {
      filter: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    Expense: {
      filter: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    Invoice: {
      update: vi.fn(),
    },
  };
  let call = 0;
  const invoke = vi.fn(async (name, payload) => {
    if (name !== 'undoStandaloneFeeDeduction') {
      throw new Error(`Unexpected client function: ${name}`);
    }
    const success = outcomes[Math.min(call++, outcomes.length - 1)];
    if (!success) return { data: { success: false, error: 'Atomic reversal rejected' } };
    const paymentIndex = persistedPayments.findIndex(row => row.id === payload.paymentId);
    if (paymentIndex >= 0) persistedPayments.splice(paymentIndex, 1);
    const expenseIndex = expenses.findIndex(row => row.id === 'expense-fee');
    if (expenseIndex >= 0) expenses.splice(expenseIndex, 1);
    invoice.amount_paid = persistedPayments
      .filter(row => row.invoice_id === invoice.id)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return {
      data: {
        success: true,
        paymentDeleted: paymentIndex >= 0,
        expenseDeleted: expenseIndex >= 0,
        invoiceId: invoice.id,
      },
    };
  });
  const base44 = { entities, functions: { invoke } };
  return {
    payment,
    payments: [{ ...payment }],
    persistedPayments,
    expenses,
    invoice,
    invoices: [invoice],
    entities,
    invoke,
    base44,
    myCompany: { id: 'company' },
  };
}

function mutationFor(page, state) {
  const [name, source, mutationName, inputKind] = page;
  const common = {
    myCompany: state.myCompany,
    base44: state.base44,
    reverseStandaloneDeduction,
  };
  const context = name === 'InvoiceDetails'
    ? { ...common, invoice: state.invoice }
    : name === 'Payments'
      ? { ...common, invoices: state.invoices, pickInvoiceForPayment }
      : { ...common, payments: state.payments, invoices: state.invoices, makeInvoiceMatcher };
  return {
    run: pageMutation(source, mutationName, context),
    input: inputKind === 'id' ? state.payment.id : state.payment,
  };
}

function expectNoClientFinancialWrites(state) {
  expect(state.entities.Payment.delete).not.toHaveBeenCalled();
  expect(state.entities.Payment.update).not.toHaveBeenCalled();
  expect(state.entities.Expense.delete).not.toHaveBeenCalled();
  expect(state.entities.Expense.update).not.toHaveBeenCalled();
  expect(state.entities.Invoice.update).not.toHaveBeenCalled();
}

describe('atomic standalone deduction page adapters', () => {
  it.each(pages.flatMap(([name, source, mutationName, inputKind]) => [
    [name, false, source, mutationName, inputKind],
    [name, true, source, mutationName, inputKind],
  ]))(
    '%s sends linked=%s standalone reversal through one atomic backend call',
    async (name, linked, source, mutationName, inputKind) => {
      const state = setup({ linked });
      const { run, input } = mutationFor([name, source, mutationName, inputKind], state);

      await run(input);

      expect(state.invoke).toHaveBeenCalledOnce();
      expect(state.invoke).toHaveBeenCalledWith('undoStandaloneFeeDeduction', {
        paymentId: 'payment-fee',
        companyId: 'company',
      });
      expect(state.persistedPayments.map(row => row.id)).toEqual(['payment-real']);
      expect(state.expenses).toHaveLength(0);
      expect(state.invoice.amount_paid).toBe(500);
      expectNoClientFinancialWrites(state);
    }
  );

  it.each(pages)(
    '%s rejects a resolved backend failure without client-side financial writes',
    async (name, source, mutationName, inputKind) => {
      const state = setup({ outcomes: [false] });
      const { run, input } = mutationFor([name, source, mutationName, inputKind], state);

      await expect(run(input)).rejects.toThrow('Atomic reversal rejected');

      expect(state.invoke).toHaveBeenCalledOnce();
      expect(state.persistedPayments).toHaveLength(2);
      expect(state.expenses).toHaveLength(1);
      expect(state.invoice.amount_paid).toBe(600);
      expectNoClientFinancialWrites(state);
    }
  );

  it('a UI retry makes one atomic call per attempt and never runs local cleanup', async () => {
    const state = setup({ outcomes: [false, true] });
    const { run, input } = mutationFor(pages[1], state);

    await expect(run(input)).rejects.toThrow('Atomic reversal rejected');
    await run(input);

    expect(state.invoke).toHaveBeenCalledTimes(2);
    expect(state.persistedPayments.map(row => row.id)).toEqual(['payment-real']);
    expect(state.expenses).toHaveLength(0);
    expect(state.invoice.amount_paid).toBe(500);
    expectNoClientFinancialWrites(state);
  });
});