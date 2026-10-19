'use strict';

// Estimate → invoice money.
//
// An estimate Adjustment is a single dollar field (estimates.adjustment_amount),
// plus an optional label stored beside it. It is not a line item, so converting
// an estimate used to drop it: the invoice total stayed at the pre-adjustment
// line sum (Anita and Greg Curry, AB Squared LTD — estimate RCV $22,205 with a
// +$1,755 wrap, invoice INV-2026-0443 still $20,450).
//
// This module turns that field into one invoice line and builds the confirmed
// "update the linked invoice" payload. The payload changes lines and the total
// only. It never includes amount_paid and never includes a send/email/text/
// receipt flag.

const ADJUSTMENT_CODE = 'ESTIMATE_ADJUSTMENT';

const NOTIFICATION_KEYS = new Set([
  'email_customer',
  'send_email',
  'send_sms',
  'send_text',
  'sms',
  'receipt',
  'send_receipt',
  'notify_customer',
  'notify',
]);

function roundCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_err) {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function parseItems(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
  if (typeof value === 'string') {
    try {
      return parseItems(JSON.parse(value));
    } catch (_err) {
      return [];
    }
  }
  return [];
}

function firstNonEmptyItems(candidates) {
  const parsed = candidates.map(parseItems);
  const filled = parsed.find((items) => items.length > 0);
  return filled || parsed.find((items) => Array.isArray(items)) || [];
}

function resolveStoredRcv(item) {
  if (!item || typeof item !== 'object') return 0;
  for (const key of ['rcv', 'amount', 'total', 'subtotal']) {
    const n = finiteOrNull(item[key]);
    if (n !== null) return roundCents(n);
  }
  const qty = Number(item.quantity ?? item.qty) || 0;
  const rate = Number(item.rate ?? item.price ?? item.unit_price) || 0;
  return roundCents(qty * rate);
}

function isAdjustmentLine(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.code === ADJUSTMENT_CODE || item.source === 'estimate_adjustment') return true;
  const description = String(item.description || '').trim();
  return /^adjustment$/i.test(description) || /^adjustment\s*:/i.test(description);
}

function readEstimateItems(estimate) {
  const data = asObject(estimate && estimate.data);
  return firstNonEmptyItems([
    estimate && estimate.items,
    data.items,
    estimate && estimate.line_items,
    data.line_items,
    estimate && estimate.sections,
    data.sections,
  ]);
}

function readAdjustment(estimate) {
  const data = asObject(estimate && estimate.data);
  let amount = 0;
  if (estimate && Object.prototype.hasOwnProperty.call(estimate, 'adjustment_amount')
      && estimate.adjustment_amount !== null && estimate.adjustment_amount !== '') {
    amount = roundCents(Number(estimate.adjustment_amount) || 0);
  } else {
    amount = roundCents(Number(data.adjustment_amount) || 0);
  }
  const label = String(
    (estimate && estimate.adjustment_label) || data.adjustment_label || data.adjustment_note || ''
  ).trim();
  return { amount, label };
}

function readDiscount(estimate) {
  const data = asObject(estimate && estimate.data);
  const type = estimate && estimate.discount_type ? estimate.discount_type : (data.discount_type || 'none');
  const value = finiteOrNull(estimate && estimate.discount_value);
  const dataValue = finiteOrNull(data.discount_value);
  return {
    type: type || 'none',
    value: value !== null ? value : (dataValue || 0),
  };
}

function readSavedTotal(estimate) {
  const data = asObject(estimate && estimate.data);
  const column = finiteOrNull(estimate && estimate.total_amount);
  if (column !== null && column > 0) return roundCents(column);
  for (const value of [estimate && estimate.amount, data.amount, data.total_amount]) {
    const n = finiteOrNull(value);
    if (n !== null && n > 0) return roundCents(n);
  }
  return 0;
}

function adjustmentLineItem(adjustment) {
  const description = adjustment.label ? `Adjustment: ${adjustment.label}` : 'Adjustment';
  return {
    description,
    quantity: 1,
    rate: adjustment.amount,
    amount: adjustment.amount,
    rcv: adjustment.amount,
    unit: '',
    code: ADJUSTMENT_CODE,
    source: 'estimate_adjustment',
  };
}

function mapEstimateItem(item) {
  const amount = resolveStoredRcv(item);
  const quantityRaw = finiteOrNull(item.quantity ?? item.qty);
  const quantity = quantityRaw === null ? 1 : quantityRaw;
  const rateRaw = finiteOrNull(item.rate ?? item.price ?? item.unit_price);
  const rate = rateRaw === null
    ? (quantity ? roundCents(amount / quantity) : amount)
    : roundCents(rateRaw);
  return {
    description: item.description || item.name || '',
    quantity,
    rate,
    amount,
    unit: item.unit || '',
    code: item.code || '',
  };
}

function resolveInvoiceTotal({ itemsTotal, discountAmount, adjustment, saved }) {
  const withoutAdjustment = roundCents(itemsTotal - discountAmount);
  const withAdjustment = roundCents(withoutAdjustment + adjustment);
  if (!(saved > 0)) return withAdjustment > 0 ? withAdjustment : 0;
  if (Math.abs(saved - withAdjustment) < 0.02) return roundCents(saved);
  // The stored total is the line sum from before the adjustment was typed in.
  if (adjustment !== 0 && Math.abs(saved - withoutAdjustment) < 0.02) return withAdjustment;
  return roundCents(saved);
}

function summaryLine(estimate, amount) {
  const data = asObject(estimate && estimate.data);
  const title = data.estimate_title || data.title || estimate.estimate_title || estimate.title || '';
  const number = estimate.estimate_number || data.estimate_number || '';
  const description = title || `Roofing Services — Est. ${number}`.trim();
  return {
    description,
    quantity: 1,
    rate: amount,
    amount,
    unit: 'EA',
    code: '',
  };
}

/**
 * Line items and total for a brand-new invoice created from an estimate.
 * A non-zero adjustment is one real line, included in the total once.
 */
function invoiceDraftFromEstimate(estimate) {
  const adjustment = readAdjustment(estimate);
  const discount = readDiscount(estimate);
  const source = readEstimateItems(estimate);
  const kept = adjustment.amount !== 0 ? source.filter((item) => !isAdjustmentLine(item)) : source;
  const mapped = kept.map(mapEstimateItem);
  const itemsTotal = roundCents(mapped.reduce((sum, item) => sum + item.amount, 0));

  let discountAmount = 0;
  if (discount.type === 'percentage' && discount.value > 0) {
    discountAmount = roundCents(itemsTotal * (discount.value / 100));
  } else if (discount.type === 'fixed' && discount.value > 0) {
    discountAmount = roundCents(discount.value);
  }

  if (discountAmount > 0) {
    const label = discount.type === 'percentage' ? `Discount (${discount.value}%)` : 'Discount';
    mapped.push({
      description: label,
      quantity: 1,
      rate: roundCents(-discountAmount),
      amount: roundCents(-discountAmount),
      unit: '',
      code: '',
    });
  }
  if (adjustment.amount !== 0) mapped.push(adjustmentLineItem(adjustment));

  const saved = readSavedTotal(estimate);
  const total = resolveInvoiceTotal({
    itemsTotal,
    discountAmount,
    adjustment: adjustment.amount,
    saved,
  });

  const priced = mapped.filter((item) => !isAdjustmentLine(item) && !/^discount\b/i.test(String(item.description || '')));
  const allZero = priced.length > 0 && priced.every((item) => Number(item.amount) === 0);
  let items = mapped;
  if ((mapped.length === 0 || allZero) && total > 0) {
    items = [summaryLine(estimate, total)];
  }

  return {
    items,
    total,
    adjustmentAmount: adjustment.amount,
    adjustmentLabel: adjustment.label,
  };
}

function lineSignature(item) {
  return [
    String(item.code || '').trim().toLowerCase(),
    String(item.description || '').trim().toLowerCase(),
    String(item.unit || '').trim().toLowerCase(),
  ].join('|');
}

function moneySnapshot(item) {
  return {
    description: String(item.description || ''),
    quantity: roundCents(item.quantity || 0),
    rate: roundCents(item.rate || 0),
    amount: roundCents(resolveStoredRcv(item)),
  };
}

function sameMoney(before, after) {
  return Math.abs(before.quantity - after.quantity) < 0.001
    && Math.abs(before.rate - after.rate) < 0.001
    && Math.abs(before.amount - after.amount) < 0.001
    && before.description === after.description;
}

function diffPlainLines(currentItems, nextItems) {
  const pool = currentItems.map((item, index) => ({ item, index, used: false }));
  const added = [];
  const changed = [];
  nextItems.forEach((next) => {
    const signature = lineSignature(next);
    const match = pool.find((entry) => !entry.used && lineSignature(entry.item) === signature);
    if (!match) {
      added.push(moneySnapshot(next));
      return;
    }
    match.used = true;
    const before = moneySnapshot(match.item);
    const after = moneySnapshot(next);
    if (!sameMoney(before, after)) changed.push({ description: after.description, before, after });
  });
  const removed = pool.filter((entry) => !entry.used).map((entry) => moneySnapshot(entry.item));
  return { added, removed, changed };
}

function diffAdjustmentLines(currentItems, nextItems) {
  const current = currentItems.filter(isAdjustmentLine);
  const next = nextItems.filter(isAdjustmentLine);
  const added = [];
  const removed = [];
  const changed = [];
  const pairs = Math.min(current.length, next.length);
  for (let i = 0; i < pairs; i += 1) {
    const before = moneySnapshot(current[i]);
    const after = moneySnapshot(next[i]);
    if (!sameMoney(before, after)) changed.push({ description: after.description || 'Adjustment', before, after });
  }
  for (let i = pairs; i < next.length; i += 1) added.push(moneySnapshot(next[i]));
  for (let i = pairs; i < current.length; i += 1) removed.push(moneySnapshot(current[i]));
  return { added, removed, changed };
}

function nextStatusFor(invoice, nextTotal, amountPaid) {
  const status = String((invoice && invoice.status) || '');
  if (status === 'cancelled') return null;
  if (!(amountPaid > 0)) return null;
  if (nextTotal > 0 && amountPaid + 0.009 >= nextTotal) return status === 'paid' ? null : 'paid';
  if (amountPaid + 0.009 < nextTotal) return status === 'partially_paid' ? null : 'partially_paid';
  return null;
}

function previewEstimateInvoiceUpdate(invoice, estimate) {
  const currentItems = coerceLineItems(invoice);
  const draft = invoiceDraftFromEstimate(estimate);
  const currentPlain = currentItems.filter((item) => !isAdjustmentLine(item));
  const nextPlain = draft.items.filter((item) => !isAdjustmentLine(item));
  const plain = diffPlainLines(currentPlain, nextPlain);
  const adjustment = diffAdjustmentLines(currentItems, draft.items);
  const amountPaid = roundCents(invoice && (invoice.amount_paid ?? asObject(invoice.data).amount_paid));
  const previousTotal = roundCents(
    finiteOrNull(invoice && (invoice.total_amount ?? invoice.amount)) ?? 0
  );
  const nextStatus = nextStatusFor(invoice, draft.total, amountPaid);
  return {
    added: plain.added.concat(adjustment.added),
    removed: plain.removed.concat(adjustment.removed),
    changed: plain.changed.concat(adjustment.changed),
    previousTotal,
    nextTotal: draft.total,
    amountPaid,
    amountDue: roundCents(draft.total - amountPaid),
    nextItems: draft.items,
    nextStatus,
    adjustmentAmount: draft.adjustmentAmount,
    adjustmentLabel: draft.adjustmentLabel,
    notifiesCustomer: false,
    touchesPayments: false,
  };
}

function buildLinkedInvoiceUpdate(invoice, estimate) {
  const preview = previewEstimateInvoiceUpdate(invoice, estimate);
  const existing = asObject(invoice && invoice.data);
  const nextData = {
    ...existing,
    amount: preview.nextTotal,
    items: preview.nextItems,
    estimate_id: existing.estimate_id || (invoice && invoice.estimate_id) || (estimate && estimate.id) || null,
    estimate_number: existing.estimate_number || (estimate && estimate.estimate_number) || '',
    adjustment_amount: 0,
    adjustment_label: preview.adjustmentLabel || '',
  };
  // A discount that is already a negative line must not also stay on the
  // invoice as discount_type, or the invoice screen subtracts it twice.
  const carriesDiscountLine = preview.nextItems.some((item) => /^discount\b/i.test(String(item.description || '')));
  if (carriesDiscountLine) {
    nextData.discount_type = 'none';
    nextData.discount_value = 0;
  }
  const payload = {
    items: preview.nextItems,
    total_amount: preview.nextTotal,
    amount: preview.nextTotal,
    adjustment_amount: 0,
    adjustment_label: preview.adjustmentLabel || '',
    data: nextData,
  };
  if (carriesDiscountLine) {
    payload.discount_type = 'none';
    payload.discount_value = 0;
  }
  if (preview.nextStatus) payload.status = preview.nextStatus;
  return { preview, payload: assertSafeInvoiceUpdate(payload) };
}

function assertSafeInvoiceUpdate(payload) {
  const keys = Object.keys(payload || {});
  if (keys.indexOf('amount_paid') !== -1) {
    throw new Error('Invoice update must not change amount paid');
  }
  keys.forEach((key) => {
    if (NOTIFICATION_KEYS.has(key)) {
      throw new Error('Invoice update must not notify the customer');
    }
  });
  return payload;
}

function invoiceLineAmount(item) {
  const amount = finiteOrNull(item && item.amount);
  if (amount !== null) return roundCents(amount);
  return resolveStoredRcv(item);
}

function presentInvoiceLine(item) {
  return {
    ...item,
    description: item.description || item.name || '',
    quantity: finiteOrNull(item.quantity ?? item.qty) ?? 1,
    rate: finiteOrNull(item.rate ?? item.price ?? item.unit_price) ?? 0,
    amount: invoiceLineAmount(item),
  };
}

function coerceLineItems(source) {
  if (Array.isArray(source) || typeof source === 'string') {
    return parseItems(source).map(presentInvoiceLine);
  }
  if (source && typeof source === 'object') {
    const data = asObject(source.data);
    return firstNonEmptyItems([
      source.items,
      source.line_items,
      data.items,
      data.line_items,
    ]).map(presentInvoiceLine);
  }
  return [];
}

function blankInvoiceLine() {
  return { description: '', quantity: 1, rate: 0, amount: 0 };
}

function formatMoney(value) {
  const amount = roundCents(value);
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

module.exports = {
  ADJUSTMENT_CODE,
  invoiceDraftFromEstimate,
  previewEstimateInvoiceUpdate,
  buildLinkedInvoiceUpdate,
  assertSafeInvoiceUpdate,
  coerceLineItems,
  blankInvoiceLine,
  formatMoney,
  isAdjustmentLine,
};
