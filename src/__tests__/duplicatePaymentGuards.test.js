/**
 * Unit tests for duplicate-payment protection guards.
 *
 * These tests import the SAME utility functions used by the production
 * page components, so any regression in the production code will be
 * caught here.
 *
 * Guard functions under test:
 *   - findOpenEstimatesForCustomer  (src/utils/duplicateCheck.js)
 *   - findUnpaidInvoicesForCustomer (src/utils/duplicateCheck.js)
 *   - isPaymentCreateBlocked        (src/utils/paymentGuards.js)  ← used by Payments.jsx create-submit
 *   - isPaymentEditBlocked          (src/utils/paymentGuards.js)  ← used by Payments.jsx edit-submit
 *   - isRecordPaymentBlocked        (src/utils/paymentGuards.js)  ← used by invoice-details.jsx "Record Payment"
 *
 * Component-level disabled wiring:
 *   Estimates.jsx:      disabled={!editingEstimate && openEsts.length > 0 && !dupEstConfirmed}
 *   Invoices.jsx:       disabled={unpaid.length > 0 && !dupInvConfirmed}
 *   Payments.jsx:       disabled={createPaymentMutation.isPending || isPaymentCreateBlocked(inv, amount)}
 *                       disabled={updatePaymentMutation.isPending || isPaymentEditBlocked(inv, amount, ...)}
 *   invoice-details.jsx disabled={isRecordPaymentBlocked(total, amountPaid)}
 */

import { describe, it, expect } from 'vitest';
import {
  findOpenEstimatesForCustomer,
  findUnpaidInvoicesForCustomer,
  findInvoicesByClaimNumber,
} from '../utils/duplicateCheck.js';
import {
  isPaymentCreateBlocked,
  isPaymentEditBlocked,
  isRecordPaymentBlocked,
  findDuplicatePayment,
} from '../utils/paymentGuards.js';

// ---------------------------------------------------------------------------
// Status fixtures
// ---------------------------------------------------------------------------

const OPEN_ESTIMATE_STATUSES = ['draft', 'sent', 'viewed', 'pending'];
const CLOSED_ESTIMATE_STATUSES = ['approved', 'rejected', 'completed', 'expired'];

const UNPAID_INVOICE_STATUSES = ['draft', 'sent', 'amount_due', 'partially_paid', 'overdue'];
const PAID_INVOICE_STATUSES = ['paid', 'cancelled', 'void'];

// ---------------------------------------------------------------------------
// 1. findOpenEstimatesForCustomer
// ---------------------------------------------------------------------------

describe('findOpenEstimatesForCustomer', () => {
  const baseEstimate = { id: '1', customer_name: 'John Smith', customer_id: 'c1' };

  it('returns empty array when no customerId and no customerName are provided', () => {
    const estimates = [{ ...baseEstimate, status: 'draft' }];
    expect(findOpenEstimatesForCustomer(estimates, null, null)).toHaveLength(0);
    expect(findOpenEstimatesForCustomer(estimates, '', '')).toHaveLength(0);
  });

  it.each(OPEN_ESTIMATE_STATUSES)('includes estimate with status "%s" (open)', (status) => {
    const estimates = [{ ...baseEstimate, status }];
    expect(findOpenEstimatesForCustomer(estimates, 'c1', null)).toHaveLength(1);
  });

  it.each(CLOSED_ESTIMATE_STATUSES)('excludes estimate with status "%s" (closed)', (status) => {
    const estimates = [{ ...baseEstimate, status }];
    expect(findOpenEstimatesForCustomer(estimates, 'c1', null)).toHaveLength(0);
  });

  it('matches by customerId even when names differ', () => {
    const estimates = [{ id: '1', customer_id: 'c1', customer_name: 'Different Name', status: 'sent' }];
    expect(findOpenEstimatesForCustomer(estimates, 'c1', null)).toHaveLength(1);
  });

  it('matches by customer name (case-insensitive)', () => {
    const estimates = [{ id: '1', customer_id: 'cX', customer_name: 'JOHN SMITH', status: 'draft' }];
    expect(findOpenEstimatesForCustomer(estimates, null, 'john smith')).toHaveLength(1);
  });

  it('matches name in "LAST, FIRST" format vs "First Last"', () => {
    const estimates = [{ id: '1', customer_id: 'cX', customer_name: 'SMITH, JOHN', status: 'draft' }];
    expect(findOpenEstimatesForCustomer(estimates, null, 'John Smith')).toHaveLength(1);
  });

  it('does not match a different customer by name', () => {
    const estimates = [{ id: '1', customer_id: 'cX', customer_name: 'Jane Doe', status: 'sent' }];
    expect(findOpenEstimatesForCustomer(estimates, null, 'John Smith')).toHaveLength(0);
  });

  it('returns multiple open estimates for the same customer', () => {
    const estimates = [
      { id: '1', customer_id: 'c1', customer_name: 'John Smith', status: 'draft' },
      { id: '2', customer_id: 'c1', customer_name: 'John Smith', status: 'sent' },
      { id: '3', customer_id: 'c1', customer_name: 'John Smith', status: 'approved' },
    ];
    expect(findOpenEstimatesForCustomer(estimates, 'c1', null)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Estimates create-button disabled logic
//    The component expression is:
//      !editingEstimate && openEsts.length > 0 && !dupEstConfirmed
//    openEsts is produced by findOpenEstimatesForCustomer (tested above).
//    These tests validate the full composed logic.
// ---------------------------------------------------------------------------

describe('Estimates — create button disabled logic', () => {
  const openEst = { id: '1', customer_name: 'Alice', status: 'draft' };
  const allEstimates = [openEst];

  function estimateCreateDisabled({ editingEstimate, estimates, customerName, dupEstConfirmed }) {
    const openEsts = editingEstimate
      ? []
      : findOpenEstimatesForCustomer(estimates, null, customerName);
    return !editingEstimate && openEsts.length > 0 && !dupEstConfirmed;
  }

  it('is DISABLED when open estimates exist and checkbox is unchecked', () => {
    expect(estimateCreateDisabled({
      editingEstimate: null,
      estimates: allEstimates,
      customerName: 'Alice',
      dupEstConfirmed: false,
    })).toBe(true);
  });

  it('is ENABLED once the "I understand" checkbox is checked', () => {
    expect(estimateCreateDisabled({
      editingEstimate: null,
      estimates: allEstimates,
      customerName: 'Alice',
      dupEstConfirmed: true,
    })).toBe(false);
  });

  it('is ENABLED when no open estimates exist for the customer', () => {
    const closedEstimates = [{ id: '1', customer_name: 'Alice', status: 'approved' }];
    expect(estimateCreateDisabled({
      editingEstimate: null,
      estimates: closedEstimates,
      customerName: 'Alice',
      dupEstConfirmed: false,
    })).toBe(false);
  });

  it('is ENABLED when editing an existing estimate (guard bypassed entirely)', () => {
    expect(estimateCreateDisabled({
      editingEstimate: openEst,
      estimates: allEstimates,
      customerName: 'Alice',
      dupEstConfirmed: false,
    })).toBe(false);
  });

  it('guard triggers only for the specific customer with open estimates', () => {
    expect(estimateCreateDisabled({
      editingEstimate: null,
      estimates: allEstimates,
      customerName: 'Bob',
      dupEstConfirmed: false,
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. findUnpaidInvoicesForCustomer
// ---------------------------------------------------------------------------

describe('findUnpaidInvoicesForCustomer', () => {
  const baseInvoice = { id: 'i1', customer_name: 'Bob Jones', customer_id: 'c2' };

  it('returns empty array when no customerName and no customerId are provided', () => {
    const invoices = [{ ...baseInvoice, status: 'sent' }];
    expect(findUnpaidInvoicesForCustomer(invoices, null, null)).toHaveLength(0);
    expect(findUnpaidInvoicesForCustomer(invoices, '', undefined)).toHaveLength(0);
  });

  it.each(UNPAID_INVOICE_STATUSES)('includes invoice with status "%s" (unpaid)', (status) => {
    const invoices = [{ ...baseInvoice, status }];
    expect(findUnpaidInvoicesForCustomer(invoices, 'Bob Jones', null)).toHaveLength(1);
  });

  it.each(PAID_INVOICE_STATUSES)('excludes invoice with status "%s" (paid/closed)', (status) => {
    const invoices = [{ ...baseInvoice, status }];
    expect(findUnpaidInvoicesForCustomer(invoices, 'Bob Jones', null)).toHaveLength(0);
  });

  it('matches by customerId even when name differs', () => {
    const invoices = [{ id: 'i1', customer_id: 'c2', customer_name: 'Other Name', status: 'sent' }];
    expect(findUnpaidInvoicesForCustomer(invoices, null, 'c2')).toHaveLength(1);
  });

  it('does not treat another linked customer with the same name as this customer', () => {
    const invoices = [
      { id: 'i-same-name-other-id', customer_id: 'c-other', customer_name: 'Bob Jones', status: 'sent' },
      { id: 'i-unlinked-same-name', customer_id: null, customer_name: 'BOB JONES', status: 'draft' },
      { id: 'i-selected', customer_id: 'c2', customer_name: 'Different snapshot', status: 'overdue' },
    ];
    expect(findUnpaidInvoicesForCustomer(invoices, 'Bob Jones', 'c2').map((invoice) => invoice.id))
      .toEqual(['i-unlinked-same-name', 'i-selected']);
  });

  it('matches by customer name case-insensitively', () => {
    const invoices = [{ id: 'i1', customer_id: 'cX', customer_name: 'BOB JONES', status: 'overdue' }];
    expect(findUnpaidInvoicesForCustomer(invoices, 'bob jones', null)).toHaveLength(1);
  });

  it('does not match a different customer', () => {
    const invoices = [{ id: 'i1', customer_id: 'cX', customer_name: 'Carol White', status: 'sent' }];
    expect(findUnpaidInvoicesForCustomer(invoices, 'Bob Jones', null)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Invoices create-button disabled logic
//    The component expression is:
//      unpaid.length > 0 && !dupInvConfirmed
//    unpaid is produced by findUnpaidInvoicesForCustomer (tested above).
// ---------------------------------------------------------------------------

describe('Invoices — create button disabled logic', () => {
  const unpaidInvoice = { id: 'i1', customer_name: 'Carol White', customer_id: 'c3', status: 'sent' };
  const allInvoices = [unpaidInvoice];

  function invoiceCreateDisabled({ invoices, customerName, customerId, dupInvConfirmed }) {
    const unpaid = findUnpaidInvoicesForCustomer(invoices, customerName, customerId);
    return unpaid.length > 0 && !dupInvConfirmed;
  }

  it('is DISABLED when unpaid invoices exist and checkbox is unchecked', () => {
    expect(invoiceCreateDisabled({
      invoices: allInvoices,
      customerName: 'Carol White',
      customerId: 'c3',
      dupInvConfirmed: false,
    })).toBe(true);
  });

  it('is ENABLED once the "I understand" checkbox is checked', () => {
    expect(invoiceCreateDisabled({
      invoices: allInvoices,
      customerName: 'Carol White',
      customerId: 'c3',
      dupInvConfirmed: true,
    })).toBe(false);
  });

  it('is ENABLED when no unpaid invoices exist for the customer', () => {
    const paidInvoices = [{ id: 'i1', customer_name: 'Carol White', customer_id: 'c3', status: 'paid' }];
    expect(invoiceCreateDisabled({
      invoices: paidInvoices,
      customerName: 'Carol White',
      customerId: 'c3',
      dupInvConfirmed: false,
    })).toBe(false);
  });

  it('guard triggers only for the customer that has unpaid invoices', () => {
    expect(invoiceCreateDisabled({
      invoices: allInvoices,
      customerName: 'Dave Brown',
      customerId: 'c99',
      dupInvConfirmed: false,
    })).toBe(false);
  });

  it('catches partially_paid invoices as unpaid', () => {
    const invoices = [{ id: 'i2', customer_name: 'Carol White', customer_id: 'c3', status: 'partially_paid' }];
    expect(invoiceCreateDisabled({
      invoices,
      customerName: 'Carol White',
      customerId: 'c3',
      dupInvConfirmed: false,
    })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. isPaymentCreateBlocked (Payments.jsx create-submit guard)
// ---------------------------------------------------------------------------

describe('isPaymentCreateBlocked — already-paid invoice', () => {
  it('blocks when invoice status is "paid"', () => {
    const inv = { invoice_number: 'INV-001', status: 'paid', total_amount: 500, amount_paid: 500 };
    expect(isPaymentCreateBlocked(inv, '100')).toBe(true);
  });

  it('blocks when amount_paid >= total_amount regardless of status field', () => {
    const inv = { invoice_number: 'INV-001', status: 'sent', total_amount: 500, amount_paid: 500 };
    expect(isPaymentCreateBlocked(inv, '50')).toBe(true);
  });

  it('blocks when amount_paid exceeds total_amount', () => {
    const inv = { invoice_number: 'INV-001', status: 'sent', total_amount: 500, amount_paid: 600 };
    expect(isPaymentCreateBlocked(inv, '10')).toBe(true);
  });

  it('allows when invoice has a remaining balance and payment is within balance', () => {
    const inv = { invoice_number: 'INV-001', status: 'sent', total_amount: 500, amount_paid: 200 };
    expect(isPaymentCreateBlocked(inv, '300')).toBe(false);
  });

  it('allows when no invoice is linked (null)', () => {
    expect(isPaymentCreateBlocked(null, '100')).toBe(false);
  });

  it('blocks when total_amount is 0 — any positive entry exceeds the $0 balance', () => {
    // balance = max(0, 0-0) = 0; entering 100 > 0+0.005 triggers overpay guard
    const inv = { invoice_number: 'INV-001', status: 'draft', total_amount: 0, amount_paid: 0 };
    expect(isPaymentCreateBlocked(inv, '100')).toBe(true);
  });
});

describe('isPaymentCreateBlocked — overpayment', () => {
  const inv = { invoice_number: 'INV-002', status: 'sent', total_amount: 1000, amount_paid: 400 };

  it('blocks when entered amount exceeds balance by more than 0.5 cents', () => {
    expect(isPaymentCreateBlocked(inv, '600.01')).toBe(true);
  });

  it('allows when entered amount exactly equals the balance', () => {
    expect(isPaymentCreateBlocked(inv, '600')).toBe(false);
  });

  it('allows when entered amount is within the rounding tolerance (≤ 0.005 over)', () => {
    expect(isPaymentCreateBlocked(inv, '600.005')).toBe(false);
  });

  it('allows when entered amount is less than the balance', () => {
    expect(isPaymentCreateBlocked(inv, '300')).toBe(false);
  });

  it('allows when entered amount string is empty or non-numeric', () => {
    expect(isPaymentCreateBlocked(inv, '')).toBe(false);
    expect(isPaymentCreateBlocked(inv, 'abc')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. isPaymentEditBlocked (Payments.jsx edit-submit guard)
// ---------------------------------------------------------------------------

describe('isPaymentEditBlocked — projected balance for same invoice', () => {
  it('blocks when projected paid amount covers total (fully paid without this payment slot)', () => {
    // Editing a payment currently on INV-999, switching to INV-003 which is fully paid.
    // projectedAmtPaid = rawAmtPaid (500) because sameInvoice=false → balance=0
    const inv = { invoice_number: 'INV-003', status: 'sent', total_amount: 500, amount_paid: 500 };
    expect(isPaymentEditBlocked(inv, '100', 'INV-999', '0')).toBe(true);
  });

  it('allows editing same invoice — own amount subtracted from paid before comparison', () => {
    // Invoice: total=500, amount_paid=300. Original payment was 300 on this invoice.
    // projectedAmtPaid = max(0, 300-300) = 0 → balance=500; entering 300 ≤ 500+0.005 → OK
    const inv = { invoice_number: 'INV-003', status: 'sent', total_amount: 500, amount_paid: 300 };
    expect(isPaymentEditBlocked(inv, '300', 'INV-003', '300')).toBe(false);
  });

  it('blocks when new amount overpays even after subtracting the original amount', () => {
    // Invoice: total=500, amount_paid=300. Original was 300. Trying to change to 501.
    // balance = max(0, 500 - max(0, 300-300)) = 500; 501 > 500+0.005 → blocked
    const inv = { invoice_number: 'INV-003', status: 'sent', total_amount: 500, amount_paid: 300 };
    expect(isPaymentEditBlocked(inv, '501', 'INV-003', '300')).toBe(true);
  });

  it('allows switching to a different invoice that still has remaining balance', () => {
    // Invoice: total=1000, amount_paid=200. Different from original invoice.
    // projectedAmtPaid = 200, balance=800; entering 300 ≤ 800+0.005 → OK
    const inv = { invoice_number: 'INV-004', status: 'sent', total_amount: 1000, amount_paid: 200 };
    expect(isPaymentEditBlocked(inv, '300', 'INV-003', '300')).toBe(false);
  });

  it('allows when no invoice is linked', () => {
    expect(isPaymentEditBlocked(null, '100', null, '100')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. isRecordPaymentBlocked (invoice-details.jsx "Record Payment" button)
// ---------------------------------------------------------------------------

describe('isRecordPaymentBlocked — Record Payment button disabled logic', () => {
  it('blocks when invoice is fully paid (amountDue = 0)', () => {
    expect(isRecordPaymentBlocked(500, 500)).toBe(true);
  });

  it('blocks when more has been paid than owed (amountDue < 0)', () => {
    expect(isRecordPaymentBlocked(500, 600)).toBe(true);
  });

  it('allows when invoice has a positive balance owed', () => {
    expect(isRecordPaymentBlocked(500, 200)).toBe(false);
  });

  it('allows when invoice is only partially paid', () => {
    expect(isRecordPaymentBlocked(1000, 999.99)).toBe(false);
  });

  it('allows when no payments have been made yet', () => {
    expect(isRecordPaymentBlocked(750, 0)).toBe(false);
  });

  it('boundary: blocks at exactly amountDue = 0 (total equals paid)', () => {
    expect(isRecordPaymentBlocked(123.45, 123.45)).toBe(true);
  });

  it('boundary: allows at amountDue = 0.01 (one cent still owed)', () => {
    expect(isRecordPaymentBlocked(123.45, 123.44)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findDuplicatePayment (src/utils/paymentGuards.js) — used by Payments.jsx create
// ---------------------------------------------------------------------------

describe('findDuplicatePayment', () => {
  const existing = [
    { id: 'p1', invoice_number: 'INV-1', customer_name: 'John Smith', customer_id: 'c1', amount: 500, payment_date: '2026-06-10' },
    { id: 'p2', invoice_number: 'INV-2', customer_name: 'Jane Doe', customer_id: 'c2', amount: 250, payment_date: '2026-06-10' },
  ];

  it('returns empty when amount is zero or missing', () => {
    expect(findDuplicatePayment(existing, { invoice_number: 'INV-1', amount: 0 })).toHaveLength(0);
    expect(findDuplicatePayment(existing, { invoice_number: 'INV-1' })).toHaveLength(0);
  });

  it('flags same invoice + same amount within the window', () => {
    const dupes = findDuplicatePayment(existing, { invoice_number: 'INV-1', amount: 500, payment_date: '2026-06-11' });
    expect(dupes).toHaveLength(1);
    expect(dupes[0].id).toBe('p1');
  });

  it('flags same customer + same amount even with no invoice link', () => {
    const dupes = findDuplicatePayment(existing, { customer_name: 'JOHN SMITH', amount: 500, payment_date: '2026-06-10', invoice_number: 'none' });
    expect(dupes).toHaveLength(1);
    expect(dupes[0].id).toBe('p1');
  });

  it('matches customer name across "LAST, FIRST" formatting', () => {
    const dupes = findDuplicatePayment(existing, { customer_name: 'SMITH, JOHN', amount: 500, payment_date: '2026-06-10' });
    expect(dupes).toHaveLength(1);
  });

  it('does NOT flag when amount differs', () => {
    expect(findDuplicatePayment(existing, { invoice_number: 'INV-1', amount: 499.99, payment_date: '2026-06-10' })).toHaveLength(0);
  });

  it('does NOT flag when neither invoice nor customer match', () => {
    expect(findDuplicatePayment(existing, { invoice_number: 'INV-9', customer_name: 'Nobody', amount: 500, payment_date: '2026-06-10' })).toHaveLength(0);
  });

  it('does NOT flag outside the date window (default 3 days)', () => {
    expect(findDuplicatePayment(existing, { invoice_number: 'INV-1', amount: 500, payment_date: '2026-06-20' })).toHaveLength(0);
  });

  it('respects a custom windowDays', () => {
    const dupes = findDuplicatePayment(existing, { invoice_number: 'INV-1', amount: 500, payment_date: '2026-06-20' }, { windowDays: 30 });
    expect(dupes).toHaveLength(1);
  });

  it('ignores dates when candidate has no payment_date', () => {
    const dupes = findDuplicatePayment(existing, { invoice_number: 'INV-1', amount: 500 });
    expect(dupes).toHaveLength(1);
  });

  it('excludes the record being edited by id', () => {
    const dupes = findDuplicatePayment(existing, { id: 'p1', invoice_number: 'INV-1', amount: 500, payment_date: '2026-06-10' });
    expect(dupes).toHaveLength(0);
  });

  it('handles empty / null payment lists safely', () => {
    expect(findDuplicatePayment([], { invoice_number: 'INV-1', amount: 500 })).toHaveLength(0);
    expect(findDuplicatePayment(null, { invoice_number: 'INV-1', amount: 500 })).toHaveLength(0);
  });

  it('ignores existing payments that are failed/refunded/void/cancelled', () => {
    const dead = [
      { id: 'd1', invoice_number: 'INV-1', amount: 500, payment_date: '2026-06-10', status: 'failed' },
      { id: 'd2', invoice_number: 'INV-1', amount: 500, payment_date: '2026-06-10', status: 'Refunded' },
      { id: 'd3', invoice_number: 'INV-1', amount: 500, payment_date: '2026-06-10', status: 'void' },
    ];
    expect(findDuplicatePayment(dead, { invoice_number: 'INV-1', amount: 500, payment_date: '2026-06-10' })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findInvoicesByClaimNumber (src/utils/duplicateCheck.js) — used by Invoices.jsx
// ---------------------------------------------------------------------------

describe('findInvoicesByClaimNumber', () => {
  const invoices = [
    { id: 'i1', invoice_number: 'INV-1', claim_number: 'CLM-100', customer_name: 'John Smith' },
    { id: 'i2', invoice_number: 'INV-2', claim_number: 'clm 100', customer_name: 'John Smith' },
    { id: 'i3', invoice_number: 'INV-3', claim_number: 'CLM-200', customer_name: 'Jane Doe' },
    { id: 'i4', invoice_number: 'INV-4', customer_name: 'No Claim' },
  ];

  it('returns empty for blank claim numbers', () => {
    expect(findInvoicesByClaimNumber(invoices, '')).toHaveLength(0);
    expect(findInvoicesByClaimNumber(invoices, '   ')).toHaveLength(0);
    expect(findInvoicesByClaimNumber(invoices, null)).toHaveLength(0);
  });

  it('matches claim numbers ignoring case and whitespace', () => {
    const matches = findInvoicesByClaimNumber(invoices, 'clm-100');
    expect(matches.map(i => i.id).sort()).toEqual(['i1', 'i2']);
  });

  it('does not match a different claim number', () => {
    expect(findInvoicesByClaimNumber(invoices, 'CLM-999')).toHaveLength(0);
  });

  it('skips invoices with no claim_number', () => {
    expect(findInvoicesByClaimNumber(invoices, 'CLM-200')).toHaveLength(1);
  });

  it('excludes the invoice being edited via excludeId', () => {
    const matches = findInvoicesByClaimNumber(invoices, 'CLM-100', 'i1');
    expect(matches.map(i => i.id)).toEqual(['i2']);
  });

  it('handles empty / null invoice lists safely', () => {
    expect(findInvoicesByClaimNumber([], 'CLM-100')).toHaveLength(0);
    expect(findInvoicesByClaimNumber(null, 'CLM-100')).toHaveLength(0);
  });
});
