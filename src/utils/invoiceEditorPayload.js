// Builds the update payload the invoice detail editor sends to the API.
//
// Lives in its own module (rather than inline in the page) so the merge rules
// below can be covered by a regression test — see
// scripts/test-invoice-data-merge.cjs.
//
// The `invoices.data` JSONB column is shared storage. Besides the editor's own
// fields it carries keys written by completely different parts of the app —
// `estimate_id` (used to find the invoice for an estimate), change-order
// bookkeeping, job links, etc. So the editor must MERGE into whatever is
// already there; a payload that sends `data: { deposit_type, deposit_value }`
// expresses "replace everything", and any write path that honours that intent
// silently destroys the other keys.

/**
 * @param {object} form       the editor's form state (editForm)
 * @param {object} invoice    the invoice being edited (for its existing `data`)
 * @returns {object} payload for Invoice.update()
 */
export function buildInvoiceUpdatePayload(form, invoice) {
  const data = form || {};
  const items = Array.isArray(data.items) ? data.items : [];

  const subtotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  let discount = 0;
  if (data.discount_type === 'percentage') {
    discount = subtotal * (Number(data.discount_value || 0) / 100);
  } else if (data.discount_type === 'fixed') {
    discount = Number(data.discount_value || 0);
  }

  const afterDiscount = subtotal - discount;
  const calculatedAmount = afterDiscount + Number(data.adjustment_amount || 0);

  const { deposit_type, deposit_value, ...restData } = data;

  const existingData =
    invoice && invoice.data && typeof invoice.data === 'object' && !Array.isArray(invoice.data)
      ? invoice.data
      : {};

  // Start from everything already stored, so unrelated keys survive the save.
  const mergedData = { ...existingData };

  // Refresh any stored key the editor also has a current value for. Fields that
  // are not invoice columns (discount_*, adjustment_amount, supplement_amount,
  // depreciation_held, ...) are folded into `data` by the entity layer anyway;
  // writing the same value here keeps the explicit object and the folded fields
  // in agreement, so neither dev nor prod merge order can resurrect a stale copy.
  for (const [key, value] of Object.entries(restData)) {
    if (Object.prototype.hasOwnProperty.call(mergedData, key)) mergedData[key] = value;
  }

  mergedData.deposit_type = deposit_type || 'none';
  mergedData.deposit_value = deposit_value || 0;

  return {
    ...restData,
    amount: calculatedAmount,
    total_amount: calculatedAmount,
    data: mergedData,
  };
}
