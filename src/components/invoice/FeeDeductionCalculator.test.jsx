import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FeeDeductionCalculator from './FeeDeductionCalculator';
import { calculateFeeDeduction, deductionTypesForInvoice, hasRemainingBalanceForDeduction } from '@/utils/paymentDeductionTypes';

// Test the fee form's behavior independently of Radix's portal/pointer machinery.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange, disabled }) =>
    <select aria-label="Deduction Type" value={value} disabled={disabled} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => <option value="">Select type…</option>,
  SelectValue: () => null,
  SelectContent: ({ children }) => <>{children}</>,
  SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
}));

afterEach(cleanup);
const base = { mode: 'percentage', value: '9', baseKind: 'remaining_balance', invoiceTotal: 14224.50, remainingBalance: 4181.12 };
const change = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function setup(extra = {}) {
  const onRecord = vi.fn();
  const props = { types: [{ name: 'Assignment fee', percent: 9 }, { name: 'Other fee', percent: null }],
    invoiceTotal: base.invoiceTotal, remainingBalance: base.remainingBalance, onRecord, ...extra };
  render(<FeeDeductionCalculator {...props} />);
  return onRecord;
}

describe('fee calculation and audit trail', () => {
  it('allows the remaining balance to be recorded as the exact withheld fee', () => {
    expect(hasRemainingBalanceForDeduction(1171.05)).toBe(true);
    expect(calculateFeeDeduction({
      mode: 'amount',
      value: '1171.05',
      baseKind: 'remaining_balance',
      invoiceTotal: 11729.64,
      remainingBalance: 1171.05,
    })).toMatchObject({ amount: 1171.05, error: null });
  });

  it('keeps a usable insurer-fee option when enabled companies have no saved types', () => {
    expect(deductionTypesForInvoice([])).toEqual([{ name: 'Sedgwick / insurer fee', percent: null }]);
    expect(deductionTypesForInvoice([{ name: 'Assignment fee', percent: 9 }])).toEqual([{ name: 'Assignment fee', percent: 9 }]);
  });

  it('uses the selected base and preserves its name and snapshot in the audit note', () => {
    expect(calculateFeeDeduction(base)).toMatchObject({
      amount: 376.30, rateNote: ' (9% of remaining balance $4181.12)', error: null,
    });
    expect(calculateFeeDeduction({ ...base, baseKind: 'invoice_total' })).toMatchObject({
      amount: 1280.21, rateNote: ' (9% of invoice total $14224.50)',
    });
  });
  it('records an overridden dollar amount with its actual effective rate, not the default', () => {
    expect(calculateFeeDeduction({ ...base, mode: 'amount', value: 200, remainingBalance: 4000 })).toMatchObject({
      amount: 200, percent: 5, rateNote: ' (dollar entry; approximately 5% of remaining balance $4000.00)',
    });
  });
  it('rejects blank, negative, nonfinite, out-of-range and rounded-zero entries', () => {
    for (const value of ['', -1, Infinity, NaN, 101, 0]) expect(calculateFeeDeduction({ ...base, value }).error).toBeTruthy();
    for (const value of ['', -1, Infinity, 0, 0.001]) expect(calculateFeeDeduction({ ...base, mode: 'amount', value }).error).toBeTruthy();
    expect(calculateFeeDeduction({ ...base, baseKind: 'custom', customBase: '' }).error).toBeTruthy();
    expect(calculateFeeDeduction({ ...base, value: 0.001, remainingBalance: 1 }).error).toBeTruthy();
  });
  it('blocks an over-balance fee but permits exact settlement', () => {
    expect(calculateFeeDeduction({ ...base, baseKind: 'invoice_total', remainingBalance: 100 }).error).toMatch(/exceed/);
    expect(calculateFeeDeduction({ ...base, value: 100 })).toMatchObject({ amount: 4181.12, error: null });
  });
});

describe('live fee form', () => {
  it('prefills a default, recalculates on base changes, and submits the displayed calculation', () => {
    const record = setup();
    change('Deduction Type', 'Assignment fee');
    expect(screen.getByLabelText('Fee percentage (%)')).toHaveValue(9);
    expect(screen.getByTestId('text-deduction-rate-math')).toHaveTextContent('$376.30 fee');
    change('Percentage Base', 'invoice_total');
    expect(screen.getByTestId('text-deduction-rate-math')).toHaveTextContent('9% of invoice total $14224.50 = $1280.21 fee');
    fireEvent.click(screen.getByTestId('button-record-standalone-deduction'));
    expect(record).toHaveBeenCalledOnce();
    expect(calculateFeeDeduction(record.mock.calls[0][0]).amount).toBe(1280.21);
  });
  it('supports percentages for types without defaults and live dollar-to-percent conversion', () => {
    setup({ invoiceTotal: 10000, remainingBalance: 4000 });
    change('Deduction Type', 'Other fee');
    expect(screen.getByTestId('button-record-standalone-deduction')).toBeDisabled();
    change('Amount withheld ($)', '200');
    expect(screen.getByTestId('text-deduction-rate-math')).toHaveTextContent('Approximately 5% of remaining balance $4000.00 = $200.00 fee');
    change('Enter fee as', 'percentage');
    expect(screen.getByLabelText('Fee percentage (%)')).toHaveValue(5);
    change('Fee percentage (%)', '9');
    expect(screen.getByTestId('text-deduction-rate-math')).toHaveTextContent('$360.00 fee');
    change('Enter fee as', 'amount');
    expect(screen.getByLabelText('Amount withheld ($)')).toHaveValue(360);
    change('Amount withheld ($)', '100');
    expect(screen.getByTestId('text-deduction-rate-math')).toHaveTextContent('Approximately 2.5%');
  });
  it('allows an explicit custom gross base without silently falling back when cleared', () => {
    setup();
    change('Deduction Type', 'Assignment fee');
    change('Percentage Base', 'custom');
    expect(screen.getByTestId('button-record-standalone-deduction')).toBeDisabled();
    change('Custom gross amount ($)', '1000');
    expect(screen.getByTestId('text-deduction-rate-math')).toHaveTextContent('9% of custom gross amount $1000.00 = $90.00 fee');
    change('Custom gross amount ($)', '');
    expect(screen.getByTestId('button-record-standalone-deduction')).toBeDisabled();
  });
  it('does not replace an invalid or blank input with the whole balance', () => {
    const record = setup();
    change('Deduction Type', 'Assignment fee');
    change('Fee percentage (%)', '');
    fireEvent.click(screen.getByTestId('button-record-standalone-deduction'));
    expect(record).not.toHaveBeenCalled();
    change('Fee percentage (%)', '100');
    change('Percentage Base', 'invoice_total');
    expect(screen.getByRole('alert')).toHaveTextContent('cannot exceed');
    expect(screen.getByTestId('button-record-standalone-deduction')).toBeDisabled();
  });
  it('prevents repeated submissions while recording', () => {
    setup({ pending: true });
    expect(screen.getByTestId('button-record-standalone-deduction')).toBeDisabled();
    expect(screen.getByLabelText('Deduction Type')).toBeDisabled();
  });
  it('shows an explicit blank warning and previews partial versus full settlement', () => {
    const record = setup();
    change('Deduction Type', 'Other fee');
    const button = screen.getByTestId('button-record-standalone-deduction');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the amount actually withheld');
    fireEvent.click(button);
    expect(record).not.toHaveBeenCalled();
    change('Amount withheld ($)', '1280.21');
    expect(button).toHaveTextContent(/^Record Deduction$/);
    expect(screen.getByTestId('text-deduction-balance-preview')).toHaveTextContent('$2900.91');
    change('Amount withheld ($)', '4181.12');
    expect(button).toHaveTextContent('Record Deduction + Close Balance');
    expect(screen.getByTestId('text-deduction-balance-preview')).toHaveTextContent('$0.00');
    change('Amount withheld ($)', '');
    expect(button).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('A blank amount will not be recorded');
  });
});