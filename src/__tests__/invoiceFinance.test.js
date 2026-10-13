import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  getInvoiceTrueTotal,
  getInvoiceBalance,
  isInvoiceSettled,
  getInvoiceDisplayStatus,
  getEffectiveDueDate,
  getDaysOverdue,
  isInvoiceOverdue,
} from '../utils/invoiceFinance.js';

// Pin "today" so effective-due-date / days-overdue assertions are deterministic.
const TODAY = new Date('2026-06-28T12:00:00Z');

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});

afterAll(() => {
  vi.useRealTimers();
});

const daysAgo = (n) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

describe('getInvoiceBalance', () => {
  it('is total minus paid, never negative', () => {
    expect(getInvoiceBalance({ total_amount: 1000, amount_paid: 300 })).toBe(700);
    expect(getInvoiceBalance({ total_amount: 1000, amount_paid: 1000 })).toBe(0);
    // overpaid / legacy $0-total import with a recorded payment -> clamped to 0
    expect(getInvoiceBalance({ total_amount: 0, amount_paid: 15000 })).toBe(0);
  });

  it('handles string amounts and missing fields', () => {
    expect(getInvoiceBalance({ total_amount: '500.50', amount_paid: '0.50' })).toBe(500);
    expect(getInvoiceBalance({})).toBe(0);
    expect(getInvoiceBalance(null)).toBe(0);
  });
});

describe('isInvoiceSettled', () => {
  it('treats fully-paid and cancelled as settled', () => {
    expect(isInvoiceSettled({ status: 'sent', total_amount: 1000, amount_paid: 1000 })).toBe(true);
    expect(isInvoiceSettled({ status: 'cancelled', total_amount: 1000, amount_paid: 0 })).toBe(true);
  });

  it('treats a pre-2026 $0-total import with a payment as settled', () => {
    expect(isInvoiceSettled({ status: 'partially_paid', total_amount: 0, amount_paid: 15000 })).toBe(true);
  });

  it('does NOT trust a "paid" flag when a balance remains', () => {
    expect(isInvoiceSettled({ status: 'paid', total_amount: 1000, amount_paid: 400 })).toBe(false);
  });

  it('does NOT treat an empty $0 shell as settled', () => {
    expect(isInvoiceSettled({ status: 'draft', total_amount: 0, amount_paid: 0 })).toBe(false);
  });
});

describe('getInvoiceDisplayStatus', () => {
  it('shows fully-settled invoices as paid (incl. $0-total imports)', () => {
    expect(getInvoiceDisplayStatus({ status: 'partially_paid', total_amount: 0, amount_paid: 15000 })).toBe('paid');
    expect(getInvoiceDisplayStatus({ status: 'sent', total_amount: 1000, amount_paid: 1000 })).toBe('paid');
  });

  it('shows a paid-flagged invoice that still owes as partially_paid', () => {
    expect(getInvoiceDisplayStatus({ status: 'paid', total_amount: 1000, amount_paid: 400 })).toBe('partially_paid');
  });

  it('keeps cancelled and empty drafts as-is', () => {
    expect(getInvoiceDisplayStatus({ status: 'cancelled', total_amount: 1000, amount_paid: 0 })).toBe('cancelled');
    expect(getInvoiceDisplayStatus({ status: 'draft', total_amount: 0, amount_paid: 0 })).toBe('draft');
    expect(getInvoiceDisplayStatus({ status: 'sent', total_amount: 1000, amount_paid: 0 })).toBe('sent');
  });
});

describe('getEffectiveDueDate / getDaysOverdue', () => {
  it('uses explicit due_date when present', () => {
    const due = getEffectiveDueDate({ due_date: '2026-06-01' });
    expect(due.getUTCFullYear()).toBe(2026);
    expect(due.getUTCMonth()).toBe(5);
  });

  it('falls back to created_at + 30 days when no due_date', () => {
    const inv = { created_at: '2026-05-01T00:00:00Z' };
    const due = getEffectiveDueDate(inv);
    expect(due.getUTCMonth()).toBe(4); // May
    expect(due.getUTCDate()).toBe(31); // May 1 + 30 days
  });

  it('falls back to created_date when created_at is absent', () => {
    expect(getEffectiveDueDate({ created_date: '2026-05-01T00:00:00Z' })).not.toBeNull();
  });

  it('returns null when there is no date at all', () => {
    expect(getEffectiveDueDate({})).toBeNull();
    expect(getDaysOverdue({})).toBe(0);
  });

  it('counts days past the effective due date and never goes negative', () => {
    // created 60 days ago -> effective due 30 days ago -> ~30 days overdue
    expect(getDaysOverdue({ created_at: daysAgo(60) })).toBeGreaterThanOrEqual(29);
    // created 5 days ago -> not yet effectively due
    expect(getDaysOverdue({ created_at: daysAgo(5) })).toBe(0);
  });
});

describe('getInvoiceTrueTotal (discount correction)', () => {
  // The real-world bug: an invoice saved with total_amount = the PRE-discount
  // subtotal, so the list/reports overstated the balance even though the
  // customer had paid in full.
  const donna = {
    total_amount: 6240,           // stored as the pre-discount subtotal (wrong)
    discount_type: 'fixed',
    discount_value: 300,
    items: Array.from({ length: 11 }, () => ({ amount: 6240 / 11 })), // sums to 6240
    amount_paid: 5940,
    status: 'partially_paid',
  };

  it('recomputes the discounted total from line items', () => {
    expect(getInvoiceTrueTotal(donna)).toBeCloseTo(5940, 2);
  });

  it('shows a fully-paid discounted invoice as $0 owed and paid', () => {
    expect(getInvoiceBalance(donna)).toBe(0);
    expect(isInvoiceSettled(donna)).toBe(true);
    expect(getInvoiceDisplayStatus(donna)).toBe('paid');
  });

  it('applies a percentage discount', () => {
    const inv = { total_amount: 1000, discount_type: 'percentage', discount_value: 10, items: [{ amount: 1000 }] };
    expect(getInvoiceTrueTotal(inv)).toBe(900);
  });

  it('adds an adjustment on top of the discounted subtotal', () => {
    const inv = { total_amount: 1000, discount_type: 'fixed', discount_value: 100, adjustment_amount: 50, items: [{ amount: 1000 }] };
    expect(getInvoiceTrueTotal(inv)).toBe(950);
  });

  it('does NOT double-subtract when total_amount already reflects the discount', () => {
    // Edit-path invoices already store the discounted total; recomputing from
    // the raw item subtotal must yield the same number, not subtract twice.
    const inv = { total_amount: 5940, discount_type: 'fixed', discount_value: 300, items: [{ amount: 6240 }] };
    expect(getInvoiceTrueTotal(inv)).toBe(5940);
  });

  it('falls back to total_amount when there is no discount', () => {
    expect(getInvoiceTrueTotal({ total_amount: 1000, items: [{ amount: 800 }] })).toBe(1000);
    expect(getInvoiceTrueTotal({ total_amount: 1000, discount_type: 'none', discount_value: 0 })).toBe(1000);
  });

  it('falls back to total_amount when a discount is set but there are no items', () => {
    // Imported legacy invoices: discount metadata but no line items to sum.
    expect(getInvoiceTrueTotal({ total_amount: 1000, discount_type: 'fixed', discount_value: 300, items: [] })).toBe(1000);
  });

  it('reads items from the data JSONB blob as a fallback', () => {
    const inv = { total_amount: 6240, discount_type: 'fixed', discount_value: 300, data: { items: [{ amount: 6240 }] } };
    expect(getInvoiceTrueTotal(inv)).toBe(5940);
  });

  it('handles null safely', () => {
    expect(getInvoiceTrueTotal(null)).toBe(0);
  });
});

describe('isInvoiceOverdue', () => {
  it('flags a sent, unpaid, old invoice with no due_date (the core bug)', () => {
    expect(isInvoiceOverdue({ status: 'sent', total_amount: 1000, amount_paid: 0, created_at: daysAgo(90) })).toBe(true);
  });

  it('excludes drafts, cancelled, and fully-settled invoices', () => {
    expect(isInvoiceOverdue({ status: 'draft', total_amount: 1000, amount_paid: 0, created_at: daysAgo(90) })).toBe(false);
    expect(isInvoiceOverdue({ status: 'cancelled', total_amount: 1000, amount_paid: 0, created_at: daysAgo(90) })).toBe(false);
    expect(isInvoiceOverdue({ status: 'sent', total_amount: 1000, amount_paid: 1000, created_at: daysAgo(90) })).toBe(false);
    // pre-2026 $0-total import -> nothing owed -> not overdue
    expect(isInvoiceOverdue({ status: 'partially_paid', total_amount: 0, amount_paid: 15000, created_at: daysAgo(400) })).toBe(false);
  });

  it('does not flag a recently-created unpaid invoice (not yet due)', () => {
    expect(isInvoiceOverdue({ status: 'sent', total_amount: 1000, amount_paid: 0, created_at: daysAgo(5) })).toBe(false);
  });

  it('still flags a mis-flagged "paid" invoice that carries a balance', () => {
    expect(isInvoiceOverdue({ status: 'paid', total_amount: 1000, amount_paid: 400, created_at: daysAgo(90) })).toBe(true);
  });
});
