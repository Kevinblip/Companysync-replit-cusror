import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { previewStandaloneDeduction, reverseStandaloneDeduction } from '../utils/standaloneDeduction.js';
import { feeFromPercent, calculateFeeDeduction } from '../utils/paymentDeductionTypes.js';

const source = readFileSync('src/pages/invoice-details.jsx', 'utf8');

// Execute the actual page mutations with isolated entities: no real financial
// records, provider calls, notifications, or database writes.
function pageMutation(name, context) {
  const block = source.split(`const ${name} = useMutation({`)[1].split('\n    onSuccess:')[0];
  const fn = block.trim().replace(/^mutationFn:\s*/, '').replace(/,$/, '');
  return new Function(...Object.keys(context), `return (${fn});`)(...Object.values(context));
}

function setup() {
  const payments = [];
  const expenses = [];
  const entity = (rows, prefix) => ({
    filter: vi.fn(async (where) => rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value))),
    create: vi.fn(async (data) => {
      const row = { ...data, id: `${prefix}-${rows.length + 1}` };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async (id, data) => Object.assign(rows.find(row => row.id === id), data)),
    delete: vi.fn(async (id) => rows.splice(rows.findIndex(row => row.id === id), 1)),
  });
  const context = {
    previewStandaloneDeduction, feeFromPercent, calculateFeeDeduction, reverseStandaloneDeduction,
    deductionTypeOptions: [{ name: 'Assignment fee' }, { name: 'Fee' }],
    total: 14224.50,
    amountDue: 4181.12,
    myCompany: { id: 'company' },
    invoice: { id: 'invoice', invoice_number: 'INV-1', customer_id: 'customer' },
    customer: { id: 'customer' },
    localToday: () => '2026-09-08',
    base44: {
      entities: { Payment: entity(payments, 'payment'), Expense: entity(expenses, 'expense') },
      functions: {
        invoke: vi.fn(async (name, payload) => {
          if (name !== 'undoStandaloneFeeDeduction') throw new Error(`Unexpected function: ${name}`);
          const paymentIndex = payments.findIndex(row => row.id === payload.paymentId);
          const expenseId = payments[paymentIndex]?.withheld_expense_id;
          if (paymentIndex >= 0) payments.splice(paymentIndex, 1);
          const expenseIndex = expenses.findIndex(row => row.id === expenseId);
          if (expenseIndex >= 0) expenses.splice(expenseIndex, 1);
          return { data: { success: true, paymentDeleted: true, expenseDeleted: true } };
        }),
      },
    },
    _recalcInvoiceBalance: vi.fn(),
  };
  const recordMutation = pageMutation('recordStandaloneDeductionMutation', context);
  return { context, payments, expenses, record: ({ deductionType, amount }) => recordMutation({
    deductionType, value: amount, mode: 'amount', baseKind: 'remaining_balance',
    invoiceTotal: context.total, remainingBalance: context.amountDue,
  }), undo: pageMutation('undoStandaloneDeductionMutation', context) };
}

describe('standalone deduction amount safety', () => {
  it.each(['', ' ', null, undefined, '0', '-1', 'Infinity', 'NaN', '12abc', '1.001', '4181.13'])('rejects %s without any writes', async (amount) => {
    const { context, record } = setup();
    expect(previewStandaloneDeduction(amount, 4181.12).error).toBeTruthy();
    await expect(record({ deductionType: 'Assignment fee', amount })).rejects.toThrow();
    expect(context.base44.entities.Payment.create).not.toHaveBeenCalled();
    expect(context.base44.entities.Expense.create).not.toHaveBeenCalled();
  });

  it('previews the real partial fee without writing off collectable money', () => {
    expect(previewStandaloneDeduction('1280.21', 4181.12)).toEqual({ error: '', amount: 1280.21, remainingBalance: 2900.91 });
    expect(previewStandaloneDeduction('4181.12', 4181.12).remainingBalance).toBe(0);
    expect(previewStandaloneDeduction('.01', 0.03).remainingBalance).toBe(0.02);
  });

  it('creates a linked partial pair and undoes both through one atomic server call', async () => {
    const { record, undo, context, payments, expenses } = setup();
    await record({ deductionType: 'Assignment fee', amount: '1280.21' });
    expect(payments).toHaveLength(1);
    expect(expenses).toHaveLength(1);
    expect(payments[0].amount).toBe(1280.21);
    expect(expenses[0].amount).toBe(1280.21);
    expect(payments[0].withheld_expense_id).toBe(expenses[0].id);
    expect(expenses[0].withheld_offset_payment_id).toBe(payments[0].id);
    await undo(payments[0]);
    expect(payments).toHaveLength(0);
    expect(expenses).toHaveLength(0);
    expect(context.base44.functions.invoke).toHaveBeenCalledOnce();
    expect(context.base44.functions.invoke).toHaveBeenCalledWith('undoStandaloneFeeDeduction', {
      paymentId: 'payment-1',
      companyId: 'company',
    });
    expect(context.base44.entities.Payment.delete).not.toHaveBeenCalled();
    expect(context.base44.entities.Expense.delete).not.toHaveBeenCalled();
  });

  it('rolls back the offset if expense creation fails', async () => {
    const { record, context, payments } = setup();
    context.base44.entities.Expense.create.mockRejectedValue(new Error('Expense unavailable'));
    await expect(record({ deductionType: 'Fee', amount: '1' })).rejects.toThrow('Expense unavailable');
    expect(payments).toHaveLength(0);
  });

  it('rejects a resolved atomic undo failure without client-side deletion', async () => {
    const { record, undo, context, payments } = setup();
    await record({ deductionType: 'Fee', amount: '1' });
    context.base44.functions.invoke.mockResolvedValueOnce({
      data: { success: false, error: 'Transaction rolled back' },
    });

    await expect(undo(payments[0])).rejects.toThrow('Transaction rolled back');

    expect(payments).toHaveLength(1);
    expect(context.base44.entities.Payment.delete).not.toHaveBeenCalled();
    expect(context.base44.entities.Expense.delete).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: 'ordinary', company_id: 'company', notes: 'Cash payment' }],
    [{ id: 'commission', company_id: 'company', is_withheld_offset: true, notes: 'Fee withheld by Rep — deducted from claim payment, no cash received.' }],
  ])('leaves non-standalone payment lifecycle unhandled', async (payment) => {
    const invoke = vi.fn();
    await expect(reverseStandaloneDeduction({
      payment,
      companyId: 'company',
      invoke,
    })).resolves.toEqual({ handled: false });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('wires the preview, invalid guard, explicit input, and truthful action into the panel', () => {
    const calculator = readFileSync('src/components/invoice/FeeDeductionCalculator.jsx', 'utf8');
    expect(calculator).toContain('value={value}');
    expect(source).not.toContain('parseFloat(standaloneDeductionAmount) : amountDue');
    expect(calculator).toContain('!!validationError}');
    expect(calculator).toContain('Balance after deduction:');
    expect(calculator).toContain(": 'Record Deduction'}");
    const standaloneBlock = source.split('const recordStandaloneDeductionMutation = useMutation({')[1].split('const undoStandaloneDeductionMutation')[0];
    expect(standaloneBlock).not.toContain("description: 'Invoice balance closed");
  });
});