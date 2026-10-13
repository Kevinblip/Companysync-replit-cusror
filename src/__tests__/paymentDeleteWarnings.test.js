/**
 * Unit tests for the paid-invoice delete warnings.
 *
 * These tests import the SAME utility functions used by Payments.jsx, so any
 * regression in the production delete flows (single-payment / table-row via
 * `getPaidInvoiceDeleteWarning`, and bulk via `getBulkPaidInvoiceDeleteWarnings`)
 * will be caught here.
 *
 * Covered behavior:
 *   - Aggregating multiple selected payments against one invoice (bulk)
 *   - The "Sent" vs "Partially Paid" status threshold
 *   - Non-paid invoices produce no warning
 *
 * Component wiring being protected:
 *   Payments.jsx initiateDeletePayment:
 *     const warning = getPaidInvoiceDeleteWarning(linkedInvoice, payment.amount);
 *     if (warning) { ...show dialog... }
 *   Payments.jsx handleBulkDelete:
 *     const affectedInvoices = getBulkPaidInvoiceDeleteWarnings(selectedPayments, payments, invoices);
 *     if (affectedInvoices.length > 0) { ...show dialog... }
 */

import { describe, it, expect } from 'vitest';
import {
  getPaidInvoiceDeleteWarning,
  getBulkPaidInvoiceDeleteWarnings,
  computeInvoiceRecalcState,
} from '../utils/paymentGuards.js';

// ---------------------------------------------------------------------------
// 0. computeInvoiceRecalcState — mirrors what recalculateInvoicePayments writes
//    to the DB after a payment is deleted.  This tests the actual post-delete
//    invoice state (amount_paid + status), not just the warning prediction.
// ---------------------------------------------------------------------------

describe('computeInvoiceRecalcState — post-delete invoice state', () => {
  it('paid invoice with one payment deleted becomes partially_paid', () => {
    // Invoice total $500, two received payments ($300 + $200 = $500 → paid).
    // After deleting the $200 payment, only [$300] remains → partially_paid.
    const remaining = [{ amount: 300, status: 'received' }];
    expect(computeInvoiceRecalcState(remaining, 500, 'paid')).toEqual({
      amount_paid: 300,
      status: 'partially_paid',
    });
  });

  it('paid invoice with only payment deleted becomes sent', () => {
    // Invoice total $500, one received payment ($500 → paid).
    // After deleting it, no payments remain → sent.
    expect(computeInvoiceRecalcState([], 500, 'paid')).toEqual({
      amount_paid: 0,
      status: 'sent',
    });
  });

  it('pending/non-received payments do NOT count toward amount_paid', () => {
    // Only the received payment counts; pending one is excluded.
    const remaining = [
      { amount: 200, status: 'received' },
      { amount: 300, status: 'pending' },
    ];
    expect(computeInvoiceRecalcState(remaining, 500, 'paid')).toEqual({
      amount_paid: 200,   // pending excluded
      status: 'partially_paid',
    });
  });

  it('remaining received payments that sum to the full total keep status paid', () => {
    const remaining = [
      { amount: 300, status: 'received' },
      { amount: 200, status: 'received' },
    ];
    expect(computeInvoiceRecalcState(remaining, 500, 'paid')).toEqual({
      amount_paid: 500,
      status: 'paid',
    });
  });

  it('draft invoice stays draft when all payments removed', () => {
    expect(computeInvoiceRecalcState([], 500, 'draft')).toEqual({
      amount_paid: 0,
      status: 'draft',
    });
  });

  it('cancelled/void invoice keeps its status when all payments removed', () => {
    expect(computeInvoiceRecalcState([], 500, 'cancelled')).toEqual({
      amount_paid: 0,
      status: 'cancelled',
    });
    expect(computeInvoiceRecalcState([], 500, 'void')).toEqual({
      amount_paid: 0,
      status: 'void',
    });
  });

  it('warning prediction matches post-delete recalculated state', () => {
    // The warning dialog predicts what WILL happen; this test confirms the
    // recalculation produces the same outcome so the user is never misled.
    const invoice = { invoice_number: 'INV-1', status: 'paid', amount: 1000, amount_paid: 1000 };
    const deletedPayment = { amount: 400, status: 'received' };

    const warning = getPaidInvoiceDeleteWarning(invoice, deletedPayment.amount);
    // Simulate remaining after deletion
    const remaining = [{ amount: 600, status: 'received' }];
    const recalc = computeInvoiceRecalcState(remaining, invoice.amount, invoice.status);

    expect(recalc.amount_paid).toBe(1000 - warning.outstandingBalance);
    expect(recalc.status).toBe(warning.newStatus === 'Sent' ? 'sent' : 'partially_paid');
  });

  it('handles string amounts and null/empty payment list', () => {
    expect(computeInvoiceRecalcState(null, '800', 'paid')).toEqual({ amount_paid: 0, status: 'sent' });
    const remaining = [{ amount: '400', status: 'received' }];
    expect(computeInvoiceRecalcState(remaining, '800', 'paid')).toEqual({ amount_paid: 400, status: 'partially_paid' });
  });
});

// ---------------------------------------------------------------------------
// 1. getPaidInvoiceDeleteWarning — single / table-row delete flow
// ---------------------------------------------------------------------------

describe('getPaidInvoiceDeleteWarning — single payment delete', () => {
  it('returns null when no invoice is linked', () => {
    expect(getPaidInvoiceDeleteWarning(null, 100)).toBeNull();
    expect(getPaidInvoiceDeleteWarning(undefined, 100)).toBeNull();
  });

  it('returns null when the invoice is not "paid" (no warning needed)', () => {
    const statuses = ['draft', 'sent', 'amount_due', 'partially_paid', 'overdue', 'cancelled', 'void'];
    for (const status of statuses) {
      const inv = { invoice_number: 'INV-1', status, amount: 500, amount_paid: 500 };
      expect(getPaidInvoiceDeleteWarning(inv, 200)).toBeNull();
    }
  });

  it('warns and computes balance/status when removing a payment leaves a paid invoice partially paid', () => {
    // total 500, paid 500, remove 200 -> newPaid 300, outstanding 200, still partially paid
    const inv = { invoice_number: 'INV-1', status: 'paid', amount: 500, amount_paid: 500 };
    expect(getPaidInvoiceDeleteWarning(inv, 200)).toEqual({
      invoice_number: 'INV-1',
      outstandingBalance: 200,
      newStatus: 'Partially Paid',
    });
  });

  it('falls back to "Sent" when removing the payment drops paid amount to zero', () => {
    // total 500, paid 500, remove the only 500 payment -> newPaid 0 -> Sent
    const inv = { invoice_number: 'INV-2', status: 'paid', amount: 500, amount_paid: 500 };
    expect(getPaidInvoiceDeleteWarning(inv, 500)).toEqual({
      invoice_number: 'INV-2',
      outstandingBalance: 500,
      newStatus: 'Sent',
    });
  });

  it('clamps a negative projected paid amount to zero (over-removal) and reports "Sent"', () => {
    // removing more than was paid should not produce negative balances
    const inv = { invoice_number: 'INV-3', status: 'paid', amount: 500, amount_paid: 500 };
    expect(getPaidInvoiceDeleteWarning(inv, 800)).toEqual({
      invoice_number: 'INV-3',
      outstandingBalance: 500,
      newStatus: 'Sent',
    });
  });

  it('treats missing amount/amount_paid fields as 0', () => {
    const inv = { invoice_number: 'INV-4', status: 'paid' };
    expect(getPaidInvoiceDeleteWarning(inv, undefined)).toEqual({
      invoice_number: 'INV-4',
      outstandingBalance: 0,
      newStatus: 'Sent',
    });
  });

  it('handles string amounts coming from form/state', () => {
    const inv = { invoice_number: 'INV-5', status: 'paid', amount: '1000', amount_paid: '1000' };
    expect(getPaidInvoiceDeleteWarning(inv, '250')).toEqual({
      invoice_number: 'INV-5',
      outstandingBalance: 250,
      newStatus: 'Partially Paid',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Status threshold boundary: Sent vs Partially Paid
//    newAmountPaid <= 0  -> "Sent";  newAmountPaid > 0 -> "Partially Paid"
// ---------------------------------------------------------------------------

describe('Sent vs Partially Paid status threshold', () => {
  const inv = { invoice_number: 'INV-T', status: 'paid', amount: 1000, amount_paid: 1000 };

  it('newAmountPaid just above zero -> Partially Paid', () => {
    // remove 999.99 of 1000 paid -> newPaid 0.01 -> Partially Paid
    expect(getPaidInvoiceDeleteWarning(inv, 999.99).newStatus).toBe('Partially Paid');
  });

  it('newAmountPaid exactly zero -> Sent', () => {
    expect(getPaidInvoiceDeleteWarning(inv, 1000).newStatus).toBe('Sent');
  });
});

// ---------------------------------------------------------------------------
// 3. getBulkPaidInvoiceDeleteWarnings — bulk delete flow
// ---------------------------------------------------------------------------

describe('getBulkPaidInvoiceDeleteWarnings — bulk delete aggregation', () => {
  it('returns empty array when no selected payments are linked to paid invoices', () => {
    const invoices = [{ invoice_number: 'INV-1', status: 'sent', amount: 500, amount_paid: 200 }];
    const payments = [{ id: 'p1', invoice_number: 'INV-1', amount: 200 }];
    expect(getBulkPaidInvoiceDeleteWarnings(['p1'], payments, invoices)).toEqual([]);
  });

  it('aggregates multiple selected payments against ONE paid invoice', () => {
    const invoices = [{ invoice_number: 'INV-9', status: 'paid', amount: 1000, amount_paid: 1000 }];
    const payments = [
      { id: 'p1', invoice_number: 'INV-9', amount: 300 },
      { id: 'p2', invoice_number: 'INV-9', amount: 200 },
    ];
    const result = getBulkPaidInvoiceDeleteWarnings(['p1', 'p2'], payments, invoices);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      invoice_number: 'INV-9',
      invoiceTotal: 1000,
      currentAmountPaid: 1000,
      deletedAmount: 500, // 300 + 200 aggregated
      paymentCount: 2,
      outstandingBalance: 500, // newPaid = 1000 - 500 = 500
      newStatus: 'Partially Paid',
    });
  });

  it('aggregated removal that zeroes out the paid amount reports "Sent"', () => {
    const invoices = [{ invoice_number: 'INV-9', status: 'paid', amount: 1000, amount_paid: 1000 }];
    const payments = [
      { id: 'p1', invoice_number: 'INV-9', amount: 600 },
      { id: 'p2', invoice_number: 'INV-9', amount: 400 },
    ];
    const result = getBulkPaidInvoiceDeleteWarnings(['p1', 'p2'], payments, invoices);
    expect(result).toHaveLength(1);
    expect(result[0].outstandingBalance).toBe(1000);
    expect(result[0].newStatus).toBe('Sent');
  });

  it('groups payments across MULTIPLE paid invoices separately', () => {
    const invoices = [
      { invoice_number: 'INV-A', status: 'paid', amount: 500, amount_paid: 500 },
      { invoice_number: 'INV-B', status: 'paid', amount: 800, amount_paid: 800 },
    ];
    const payments = [
      { id: 'p1', invoice_number: 'INV-A', amount: 100 },
      { id: 'p2', invoice_number: 'INV-B', amount: 800 },
      { id: 'p3', invoice_number: 'INV-A', amount: 50 },
    ];
    const result = getBulkPaidInvoiceDeleteWarnings(['p1', 'p2', 'p3'], payments, invoices);
    expect(result).toHaveLength(2);

    const a = result.find(r => r.invoice_number === 'INV-A');
    const b = result.find(r => r.invoice_number === 'INV-B');

    expect(a).toMatchObject({ deletedAmount: 150, paymentCount: 2, outstandingBalance: 150, newStatus: 'Partially Paid' });
    expect(b).toMatchObject({ deletedAmount: 800, paymentCount: 1, outstandingBalance: 800, newStatus: 'Sent' });
  });

  it('excludes payments linked to non-paid invoices from the warnings', () => {
    const invoices = [
      { invoice_number: 'INV-PAID', status: 'paid', amount: 500, amount_paid: 500 },
      { invoice_number: 'INV-SENT', status: 'sent', amount: 500, amount_paid: 100 },
    ];
    const payments = [
      { id: 'p1', invoice_number: 'INV-PAID', amount: 200 },
      { id: 'p2', invoice_number: 'INV-SENT', amount: 100 },
    ];
    const result = getBulkPaidInvoiceDeleteWarnings(['p1', 'p2'], payments, invoices);
    expect(result).toHaveLength(1);
    expect(result[0].invoice_number).toBe('INV-PAID');
  });

  it('ignores selected ids with no matching payment record', () => {
    const invoices = [{ invoice_number: 'INV-PAID', status: 'paid', amount: 500, amount_paid: 500 }];
    const payments = [{ id: 'p1', invoice_number: 'INV-PAID', amount: 200 }];
    const result = getBulkPaidInvoiceDeleteWarnings(['p1', 'missing-id'], payments, invoices);
    expect(result).toHaveLength(1);
    expect(result[0].deletedAmount).toBe(200);
  });

  it('ignores payments whose invoice cannot be found', () => {
    const invoices = [{ invoice_number: 'INV-PAID', status: 'paid', amount: 500, amount_paid: 500 }];
    const payments = [{ id: 'p1', invoice_number: 'INV-UNKNOWN', amount: 200 }];
    expect(getBulkPaidInvoiceDeleteWarnings(['p1'], payments, invoices)).toEqual([]);
  });
});
