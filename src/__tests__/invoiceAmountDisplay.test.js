import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  describeRelinkAll,
  describeRelinkMove,
  invoicePaymentSummary,
} from '../utils/invoiceAmountDisplay.js';

describe('invoice detail overpayment display', () => {
  it('shows Chad’s overpayment as a positive paid amount and a credit', () => {
    const summary = invoicePaymentSummary(35694.07, 39510.89);
    expect(summary.paidText).toBe('$39,510.89');
    expect(summary.paidText.startsWith('-$')).toBe(false);
    expect(summary.overpaidLabel).toBe('Credit / Overpaid $3,816.82');
    expect(summary.due).toBe(0);
  });

  it('keeps a normal balance as amount due', () => {
    const summary = invoicePaymentSummary(1000, 250);
    expect(summary.paidText).toBe('$250.00');
    expect(summary.dueText).toBe('$750.00');
    expect(summary.overpaidLabel).toBe('');
  });
});

describe('re-link dialog', () => {
  it('names both customers when the invoice numbers match', () => {
    expect(describeRelinkMove({
      fromNumber: 'INV-2026-0385',
      fromCustomer: 'Beverly Owens-Jackson',
      toNumber: 'INV-2026-0385',
      toCustomer: 'Chad Sohl',
    })).toBe('This payment will be moved from INV-2026-0385 (Beverly Owens-Jackson) to INV-2026-0385 (Chad Sohl).');
  });

  it('names every source invoice when re-linking several payments', () => {
    expect(describeRelinkAll(
      [
        { invoiceNumber: 'INV-2026-0385', customerName: 'Beverly Owens-Jackson' },
        { invoiceNumber: 'INV-2026-0385', customerName: 'Beverly Owens-Jackson' },
      ],
      'INV-2026-0385',
      'Chad Sohl',
    )).toBe('All payments will be moved from INV-2026-0385 (Beverly Owens-Jackson) to INV-2026-0385 (Chad Sohl).');
  });
});

describe('invoice detail page wiring', () => {
  const page = fs.readFileSync('src/pages/invoice-details.jsx', 'utf8');

  it('keeps the request amount on the same balance as Amount Due', () => {
    expect(page.includes('invoiceCollectibleBalance(invoice, detailInvoiceTotal(invoice))')).toBe(true);
    expect(page.includes('invoicePaymentSummary(total, amountPaid)')).toBe(true);
    expect(page.includes('requestAmountEdited.current = true')).toBe(true);
    expect(page.includes('data-testid="invoice-amount-due"')).toBe(true);
    expect(page.includes('deductible_waived_or_collected')).toBe(false);
    expect(page.includes('insurancePaysAmount')).toBe(true);
    expect(page.includes('data-testid="input-adjustment-label"')).toBe(true);
  });

  it('does not prefix Amount Paid with a minus', () => {
    expect(page.includes('-${amountPaid.toFixed(2)}')).toBe(false);
    expect(page.includes('invoicePaymentSummary')).toBe(true);
    expect(page.includes('Credit / Overpaid')).toBe(true);
  });

  it('builds the re-link sentence with both customer names', () => {
    expect(page.includes('describeRelinkMove')).toBe(true);
    expect(page.includes('describeRelinkAll')).toBe(true);
  });
});
