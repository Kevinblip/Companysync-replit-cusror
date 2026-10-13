/**
 * Shared money helpers for estimate line items.
 *
 * Two rules live here, both learned the hard way:
 *
 *  1. A saved line item's RCV is the authority. On a carrier document (Xactimate,
 *     Symbility, Liberty Mutual) the RC column legitimately differs from
 *     quantity x rate — the carrier rounds unit prices, and some carriers fold
 *     material tax or O&P into each line. Recomputing quantity x rate when an
 *     estimate is reopened silently changes it, so the saved total and the total
 *     on screen disagree, and the next save writes the recomputed figure over the
 *     real one.
 *
 *  2. Summary-level tax is only a separate line when it is not already inside the
 *     line RC values. Adding it in both places bills the homeowner twice.
 */

/** Number(v) but null for anything that isn't a real, finite number. */
export function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Quantity, tolerating the field aliases used across import/export adapters. */
export function lineQuantity(item) {
  return toFiniteNumber(item?.quantity) ?? toFiniteNumber(item?.qty) ?? 0;
}

/** Unit rate, tolerating the field aliases used across import/export adapters. */
export function lineRate(item) {
  return toFiniteNumber(item?.rate)
    ?? toFiniteNumber(item?.price)
    ?? toFiniteNumber(item?.unit_price)
    ?? 0;
}

/**
 * Read a line item's stored RCV, falling back to quantity x rate only when the
 * item never had one.
 *
 * A stored 0 is a REAL value -- carrier documents contain intentional $0 lines
 * (ITEL supply lines, carrier-furnished material) that sit next to a non-zero
 * quantity and rate. The truthy `rcv || amount || qty * rate` idiom this
 * replaces silently re-priced those lines, so the same estimate was worth one
 * number on screen and another in the export sent to the adjuster.
 */
export function resolveStoredRcv(item) {
  const stored = toFiniteNumber(item?.rcv)
    ?? toFiniteNumber(item?.amount)
    ?? toFiniteNumber(item?.total);
  if (stored !== null) return stored;
  return lineQuantity(item) * lineRate(item);
}

/**
 * Read a saved line item's ACV without letting an omitted ACV become a
 * fabricated $0 value.
 *
 * Some PDF extraction responses include `acv: 0` when the ACV cell was not
 * read, even though the row has no depreciation. A real $0 ACV is still
 * preserved when the row is fully depreciated or has an explicit depreciation
 * amount equal to its RCV.
 */
export function resolveStoredAcv(item) {
  const rcv = resolveStoredRcv(item);
  const storedAcv = toFiniteNumber(item?.acv);
  const depreciationPercent = toFiniteNumber(item?.depreciation_percent) ?? 0;
  const depreciationAmount = toFiniteNumber(item?.depreciation)
    ?? toFiniteNumber(item?.depreciation_amount);

  const zeroLooksMissing = storedAcv === 0
    && rcv > 0
    && depreciationPercent < 100
    && (depreciationAmount === null || depreciationAmount < rcv);
  if (storedAcv !== null && !zeroLooksMissing) return storedAcv;

  if (depreciationAmount !== null) {
    return Math.max(0, Math.round((rcv - depreciationAmount) * 100) / 100);
  }

  return Math.max(0, Math.round(rcv * (1 - depreciationPercent / 100) * 100) / 100);
}

/**
 * Normalize a line item as it is loaded from storage into the editor.
 * Preserves the saved money; only derives a value that was never stored.
 * Editing quantity or rate recalculates the line separately (LineItemEditor's
 * handleCellChange) — this is the load path only.
 */
export function normalizeSavedLineItem(item) {
  const quantity = toFiniteNumber(item?.quantity) ?? 0;
  const rate = toFiniteNumber(item?.rate) ?? 0;
  const depreciationPercent = toFiniteNumber(item?.depreciation_percent) ?? 0;

  const rcv = resolveStoredRcv(item);
  const acv = resolveStoredAcv({ ...item, rcv, depreciation_percent: depreciationPercent });

  return {
    ...item,
    quantity,
    rate,
    rcv,
    acv,
    amount: rcv,
    depreciation_percent: depreciationPercent,
  };
}

/** Sum of the RCV column, rounded to cents. */
export function sumRcv(items) {
  if (!Array.isArray(items)) return 0;
  const total = items.reduce((acc, item) => acc + (toFiniteNumber(item?.rcv) ?? 0), 0);
  return Math.round(total * 100) / 100;
}

/** Sum line-item ACV values using the same missing-zero rules as the editor. */
export function sumAcv(items) {
  if (!Array.isArray(items)) return 0;
  const total = items.reduce((acc, item) => acc + resolveStoredAcv(item), 0);
  return Math.round(total * 100) / 100;
}

/** Net ACV after carrier-level paid-when-incurred/non-recoverable adjustments. */
export function sumNetAcv(items, adjustment = 0) {
  return Math.max(0, Math.round((sumAcv(items) - (toFiniteNumber(adjustment) ?? 0)) * 100) / 100);
}

/**
 * True when the summary tax figure is already spread across the line RC values.
 *
 * Only lines with a real per-unit breakdown can be measured: a rollup line (O&P,
 * lump sum, a carrier supply line) has no quantity x rate to compare against, so
 * including it would make the gap meaningless. If the gap between what the lines
 * charge and what quantity x rate comes to already accounts for the summary tax,
 * the tax is in the lines and must not be added again.
 */
export function taxIsBakedIntoLines(items, summaryTax) {
  const tax = toFiniteNumber(summaryTax) ?? 0;
  if (tax <= 0 || !Array.isArray(items) || items.length === 0) return false;

  let rcvSum = 0;
  let baseSum = 0;
  let measurable = 0;

  for (const item of items) {
    const qty = lineQuantity(item);
    const rate = lineRate(item);
    const rcv = resolveStoredRcv(item);
    if (qty > 0 && rate > 0 && rcv > 0) {
      rcvSum += rcv;
      baseSum += qty * rate;
      measurable += 1;
    }
  }

  if (measurable === 0) return false;

  const spread = rcvSum - baseSum;
  if (spread <= 0) return false;

  // The only difference we tolerate is per-line cent rounding: each line's RC
  // value is printed to the cent, so N lines can drift at most about N cents
  // from the summary figure. Anything wider is not the same money and we leave
  // the tax line in place.
  //
  // The bias here is deliberate. Suppressing the tax line is the new behaviour,
  // so it has to clear a high bar; adding it is what the app has always done and
  // a wrongly-added line is visible in the total. A loose percentage window
  // would let an unrelated gap -- a carrier price adjustment, allocated O&P --
  // masquerade as tax and silently drop real money from the estimate.
  const tolerance = Math.max(0.05, measurable * 0.01);
  return Math.abs(spread - tax) <= tolerance;
}
