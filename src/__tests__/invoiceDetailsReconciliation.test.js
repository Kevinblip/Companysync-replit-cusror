import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import recalculator from '../../lib/invoicePaymentRecalculator.cjs';
import { reverseStandaloneDeduction } from '../utils/standaloneDeduction.js';

const source = readFileSync('src/pages/invoice-details.jsx', 'utf8');
const helperText = source.split('const _recalcInvoiceBalance = ')[1].split('\n\n  // Fire-and-forget:')[0].trim().replace(/;$/, '');
const effectText = source.split('// Reconcile once when this invoice')[1].split('useEffect(() => {')[1].split('}, [invoice?.id, paymentsReady, queryClient]);')[0];
const undoText = source.split('const undoStandaloneDeductionMutation = useMutation({')[1].split('\n    onSuccess:')[0].trim().replace(/^mutationFn:\s*/, '').replace(/,$/, '');
const recordPaymentText = source.split('const recordPaymentMutation = useMutation({')[1].split('// Force-mark paid')[0];
const compile = (text, context) => new Function(...Object.keys(context), `return (${text})`)(...Object.values(context));

describe('Invoice Details authoritative reconciliation', () => {
  it('preserves number-only cash credit through initial load, undo, refresh and reopen', async () => {
    const stored = { id: 'invoice', company_id: 'company', invoice_number: 'INV-1', customer_id: 'customer', total_amount: 1000, amount_paid: 600, status: 'partially_paid' };
    const fee = { id: 'fee', company_id: 'company', invoice_id: stored.id, amount: 100, withheld_expense_id: 'expense' };
    const cash = { id: 'cash', company_id: 'company', invoice_number: 'INV-1', customer_id: 'customer', amount: 500, status: 'received' };
    let payments = [fee, cash];
    const refreshBalance = () => {
      stored.amount_paid = recalculator.allocatePaymentsToInvoices(payments, [stored]).get(stored.id);
      return { success: true, amount_paid: stored.amount_paid, status: stored.status };
    };
    const invoke = vi.fn(async (name) => {
      if (name === 'undoStandaloneFeeDeduction') payments = payments.filter(p => p.id !== fee.id);
      return { data: refreshBalance() };
    });
    const base44 = {
      functions: { invoke },
      entities: {
        Invoice: { update: vi.fn(), filter: vi.fn() },
        Payment: { filter: vi.fn(async () => payments.filter(p => p.invoice_id === stored.id)), delete: vi.fn() },
      },
    };
    const queryClient = { invalidateQueries: vi.fn() };
    const toast = { error: vi.fn() };
    function mount() {
      const context = { invoice: { ...stored }, base44, _triggerJobLearning: vi.fn(), myCompany: { id: 'company' }, reverseStandaloneDeduction };
      const recalc = compile(helperText, context);
      const effect = compile(`() => {${effectText}}`, { ...context, _recalcInvoiceBalance: recalc, paymentsReady: true, queryClient, toast });
      return { recalc, effect, undo: compile(undoText, context) };
    }

    mount().effect();
    await vi.waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalled());
    expect(stored.amount_paid).toBe(600);
    await mount().undo(fee);
    expect(stored.amount_paid).toBe(500);
    await mount().recalc(stored.id); // refresh / explicit balance sync
    queryClient.invalidateQueries.mockClear();
    mount().effect(); // navigate away and reopen with no directly linked payments
    await vi.waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalled());
    expect(payments).toEqual([cash]);
    expect(stored.amount_paid).toBe(500);
    expect(stored.total_amount - stored.amount_paid).toBe(500);
    expect(base44.entities.Invoice.update).not.toHaveBeenCalled();
    expect(base44.entities.Payment.filter).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does not use partial payment-list or balance changes as a repair trigger', () => {
    expect(source).toContain('}, [invoice?.id, paymentsReady, queryClient]);');
    expect(effectText).not.toContain('payments.reduce');
    expect(effectText).not.toContain('Invoice.update');
    expect(helperText).not.toContain('Payment.filter');
  });

  it('returns the locked pre-recalculation status alongside the authoritative paid result', async () => {
    const invoice = {
      id: 'invoice',
      company_id: 'company',
      invoice_number: 'INV-1',
      total_amount: 100,
      amount_paid: 80,
      status: 'partially_paid',
    };
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.includes('SELECT * FROM invoices') && sql.includes('AND ((')) return { rows: [invoice], rowCount: 1 };
        if (sql.includes('SELECT * FROM invoices')) return { rows: [invoice], rowCount: 1 };
        if (sql.includes('SELECT * FROM payments')) {
          return { rows: [{ id: 'payment', company_id: 'company', invoice_id: 'invoice', amount: 100, status: 'received' }], rowCount: 1 };
        }
        if (sql.includes('UPDATE invoices')) return { rows: [], rowCount: 1 };
        throw new Error(`Unexpected query: ${sql}`);
      }),
    };

    await expect(recalculator.recalculateInvoicePaymentsInTransaction(client, {
      companyId: 'company',
      invoiceId: 'invoice',
    })).resolves.toEqual({
      success: true,
      amount_paid: 100,
      previous_status: 'partially_paid',
      status: 'paid',
    });
  });

  it('shows the review prompt from the server transition, not stale client totals', () => {
    expect(recordPaymentText).toContain('const balance = await _recalcInvoiceBalance(invoice.id)');
    expect(recordPaymentText).toContain("balance?.status === 'paid'");
    expect(recordPaymentText).toContain('balance.previous_status');
    expect(recordPaymentText).not.toContain('amtPaying >=');
    expect(recordPaymentText).not.toContain('prevPaid + amount');
  });

  it('surfaces a resolved recalculation failure rather than claiming it succeeded', async () => {
    const recalc = compile(helperText, {
      base44: { functions: { invoke: vi.fn(async () => ({ data: { success: false, error: 'Ambiguous ownership' } })) } },
      invoice: { id: 'invoice' }, _triggerJobLearning: vi.fn(),
    });
    await expect(recalc('invoice')).rejects.toThrow('Ambiguous ownership');
  });
});