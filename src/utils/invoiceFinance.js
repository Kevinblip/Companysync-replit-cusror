// Single source of truth for invoice money math + status display.
// Used by Dashboard, Accounts Receivable, and the Invoices list so the
// "what's owed" number and paid/unpaid badges stay consistent everywhere.

// The real total owed on an invoice, correcting for a discount that may not
// have been persisted into total_amount. Some invoices were saved with
// total_amount = the PRE-discount subtotal (the discount was only applied in
// the invoice-detail view), which made the list and reports overstate the
// balance — e.g. a $6,240 invoice with a $300 discount that was paid $5,940
// still showed $300 "owed". We recompute from the line items exactly like the
// invoice-detail screen does: subtotal(items) - discount + adjustment.
// This only kicks in when the invoice actually HAS a discount AND has line
// items to sum from; otherwise total_amount is returned unchanged (it is
// correct for the ~99% of invoices without a discount, and for imported legacy
// invoices that have no items but a real total).
export function getInvoiceTrueTotal(inv) {
  if (!inv) return 0;
  const stored = Number(inv.total_amount ?? inv.amount) || 0;
  const dtype = inv.discount_type;
  const dval = Number(inv.discount_value) || 0;
  if (!dtype || dtype === 'none' || dval <= 0) return stored;
  const items = inv.items || inv.line_items || inv.data?.items || [];
  if (!Array.isArray(items) || items.length === 0) return stored;
  const subtotal = items.reduce((s, it) => s + (Number(it.rcv || it.amount) || 0), 0);
  if (subtotal <= 0) return stored;
  const discount = dtype === 'percentage' ? subtotal * (dval / 100) : dval;
  const adjustment = Number(inv.adjustment_amount) || 0;
  return subtotal - discount + adjustment;
}

// Round a dollar figure to whole cents so sub-cent floating-point residue
// (line items like 6240.0032) never leaves a phantom fraction-of-a-cent owed.
function toCents(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// The invoice detail screen's total, including a discount that was applied
// only in the view. Amount Due and the Request Payment box both start here.
// The deductible is not part of this number.
export function detailInvoiceTotal(inv) {
  if (!inv) return 0;
  const items = inv.items || inv.line_items || [];
  const subtotal = items.reduce((sum, item) => sum + Number(item.rcv || item.amount || 0), 0) || 0;
  const discountAmount = inv.discount_type === 'percentage'
    ? subtotal * (Number(inv.discount_value || 0) / 100)
    : inv.discount_type === 'fixed'
      ? Number(inv.discount_value || 0)
      : 0;
  const computedTotal = subtotal - discountAmount + Number(inv.adjustment_amount || 0);
  if (inv.discount_type && inv.discount_type !== 'none' && Number(inv.discount_value) > 0) {
    return computedTotal;
  }
  return Number(inv.total_amount || inv.amount || 0);
}

// Invoice total − payments. The deductible is display-only and is not subtracted.
// Negative means a credit. Pass the detail-screen total so the request box
// matches Amount Due.
export function invoiceCollectibleBalance(inv, totalOverride) {
  const total = totalOverride == null ? getInvoiceTrueTotal(inv) : Number(totalOverride) || 0;
  const paid = Number(inv?.amount_paid) || 0;
  const raw = toCents(total - paid);
  return {
    rcv: total,
    paid,
    raw,
    due: raw > 0 ? raw : 0,
    overpaid: raw < 0 ? Math.abs(raw) : 0,
  };
}

// Carrier figure on the insurance breakdown.
// `total` is the invoice total, which already includes any adjustment or discount.
// Subtract the deductible only when neither of those is present. A waived
// deductible is recorded as an adjustment or a discount, and subtracting it
// again is the Wanda case: RCV $28,972.67, adjustment -$1,976, deductible
// $1,976 was showing Insurance Pays $25,020.67 instead of $26,996.67.
export function insurancePaysAmount({
  total = 0,
  depreciation = 0,
  deductible = 0,
  adjustment = 0,
  discount = 0,
} = {}) {
  const acv = toCents((Number(total) || 0) - (Number(depreciation) || 0));
  const deductibleShown = Math.max(0, Number(deductible) || 0);
  const alreadyReduced = Math.abs(Number(adjustment) || 0) > 0.004 || Math.abs(Number(discount) || 0) > 0.004;
  const deductibleApplied = alreadyReduced ? 0 : deductibleShown;
  return {
    acv,
    deductibleShown,
    deductibleApplied,
    alreadyReduced,
    pays: toCents(acv - deductibleApplied),
  };
}

function signedBalance(inv) {
  return invoiceCollectibleBalance(inv).raw;
}

// Remaining balance owed on an invoice (never negative).
// Imported legacy invoices have total_amount = 0, so their balance is 0
// even if a partial payment was recorded — i.e. they are already settled.
// A deductible does not change this balance.
export function getInvoiceBalance(inv) {
  return Math.max(0, signedBalance(inv));
}

// True when nothing is owed. Balance is the source of truth — a stored
// status of "paid" is NOT trusted on its own (an invoice can be flagged paid
// yet still carry a balance). Cancelled invoices are always settled. An empty
// $0 shell (no total, no payment) is not considered settled.
export function isInvoiceSettled(inv) {
  if (!inv) return false;
  if (inv.status === 'cancelled') return true;
  const total = getInvoiceTrueTotal(inv);
  const paid = Number(inv.amount_paid) || 0;
  return signedBalance(inv) <= 0 && (total > 0 || paid > 0);
}

// The status to SHOW the user, corrected for the real balance:
//  - fully settled (incl. $0-total imports with a payment) -> "paid"
//  - flagged paid but money still owed                      -> "partially_paid"
//  - otherwise the stored status (defaulting to "draft")
export function getInvoiceDisplayStatus(inv) {
  if (!inv) return 'draft';
  if (inv.status === 'cancelled') return 'cancelled';
  const paid = Number(inv.amount_paid) || 0;
  const balance = signedBalance(inv);
  if (balance <= 0 && paid > 0) return 'paid';
  if (inv.status === 'paid' && balance > 0) return 'partially_paid';
  return inv.status || 'draft';
}

// Effective due date: explicit due_date, else 30 days after the invoice was
// created. Most invoices in the field have no due_date set, so without this
// fallback nothing ever counts as "past due" and collections totals look far
// smaller than what is actually owed.
export function getEffectiveDueDate(inv) {
  if (inv?.due_date) return new Date(inv.due_date);
  const created = inv?.created_at || inv?.created_date;
  if (created) {
    const d = new Date(created);
    d.setDate(d.getDate() + 30);
    return d;
  }
  return null;
}

// Whole days an invoice is past its effective due date (0 if not yet due).
export function getDaysOverdue(inv) {
  const due = getEffectiveDueDate(inv);
  if (!due) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today - due) / 86400000));
}

// An invoice is "to collect" when it still has a real balance owed, it has
// been sent (not a draft), it is not cancelled, and it is past its effective
// due date. Balance — not the stored status — decides whether money is owed,
// so a mis-flagged "paid" invoice that still carries a balance is included.
export function isInvoiceOverdue(inv) {
  if (!inv) return false;
  if (inv.status === 'cancelled' || inv.status === 'draft') return false;
  if (getInvoiceBalance(inv) <= 0) return false;
  return getDaysOverdue(inv) > 0;
}
