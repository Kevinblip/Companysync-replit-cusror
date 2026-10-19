/**
 * Invoice-detail money labels.
 *
 * Amount paid is money already received, so it is always shown as a positive
 * dollar amount. A negative remainder is not an amount due; it is a credit.
 */

export function formatUsd(amount) {
  const value = Math.abs(Number(amount) || 0);
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function invoicePaymentSummary(total, amountPaid) {
  const paid = Number(amountPaid) || 0;
  const dueRaw = Math.round(((Number(total) || 0) - paid) * 100) / 100;
  const overpaid = dueRaw < 0 ? Math.abs(dueRaw) : 0;
  const due = dueRaw > 0 ? dueRaw : 0;
  return {
    paid: Math.abs(paid),
    due,
    overpaid,
    paidText: formatUsd(paid),
    dueText: formatUsd(due),
    overpaidText: formatUsd(overpaid),
    overpaidLabel: overpaid > 0 ? `Credit / Overpaid ${formatUsd(overpaid)}` : '',
  };
}

export function invoicePartyLabel(invoiceNumber, customerName) {
  const number = String(invoiceNumber || '').trim() || 'another invoice';
  const customer = String(customerName || '').trim();
  return customer ? `${number} (${customer})` : number;
}

export function describeRelinkMove({ fromNumber, fromCustomer, toNumber, toCustomer } = {}) {
  return `This payment will be moved from ${invoicePartyLabel(fromNumber, fromCustomer)} to ${invoicePartyLabel(toNumber, toCustomer)}.`;
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export function describeRelinkAll(sources, toNumber, toCustomer) {
  const labels = [];
  const seen = new Set();
  for (const source of sources || []) {
    const label = invoicePartyLabel(source?.invoiceNumber, source?.customerName);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  const destination = invoicePartyLabel(toNumber, toCustomer);
  if (labels.length === 0) return `All payments will be moved to ${destination}.`;
  return `All payments will be moved from ${joinLabels(labels)} to ${destination}.`;
}
