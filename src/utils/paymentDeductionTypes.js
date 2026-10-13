/**
 * Payment deduction types — third-party fees withheld from a payment before it
 * reaches you (assignment fees, TPA fees, processing fees).
 *
 * Types were originally stored as plain strings. They can now optionally carry a
 * default percentage so the fee amount fills itself in instead of being worked
 * out on a calculator. Both shapes coexist in saved company records, so every
 * read goes through normalizeDeductionTypes().
 */

/**
 * Accepts the raw `payment_deduction_types` array in either the legacy string
 * form or the current object form and always returns
 * `[{ name, percent }]` with an invalid or absent percent as null.
 */
export function normalizeDeductionTypes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const name = typeof entry === 'string'
        ? entry.trim()
        : String(entry?.name ?? '').trim();
      const rawPercent = typeof entry === 'string' ? null : entry?.percent;
      return { name, percent: sanitizePercent(rawPercent) };
    })
    .filter((entry) => entry.name);
}

/**
 * A positive invoice balance is enough to show the withheld-fee entry point.
 * The company setting controls whether the panel can open, but must not make
 * the action disappear so staff can tell why it is unavailable.
 */
export function hasRemainingBalanceForDeduction(remainingBalance) {
  return Number.isFinite(Number(remainingBalance)) && Number(remainingBalance) > 0.005;
}

/**
 * Older companies may have enabled deductions before saving any type names.
 * Keep the existing workflow usable with a clearly named insurer-fee option.
 */
export function deductionTypesForInvoice(raw) {
  const types = normalizeDeductionTypes(raw);
  return types.length > 0 ? types : [{ name: 'Sedgwick / insurer fee', percent: null }];
}

/** A percentage is only usable if it is a real number in (0, 100]. */
export function sanitizePercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  return pct;
}

/** Dropdown label — "Assignment fee (9%)" when a rate is configured. */
export function deductionTypeLabel(type) {
  if (!type?.name) return '';
  return type.percent ? `${type.name} (${type.percent}%)` : type.name;
}

/**
 * Fee in dollars for a percentage against a base amount, rounded to cents.
 * Returns null when either side is missing so callers can fall back to manual
 * entry rather than filling the box with 0.
 */
export function feeFromPercent(percent, baseAmount) {
  const pct = sanitizePercent(percent);
  const base = Number(baseAmount);
  if (pct === null || !Number.isFinite(base) || base <= 0) return null;
  // Work in whole cents. Evaluating `pct / 100 * base` directly lands a hair
  // under a half-cent boundary often enough to round a real fee DOWN by a cent:
  // 15% of $4.10 comes out as 0.6149999999999999, so the fee is booked at $0.61
  // instead of $0.62. Converting the base to integer cents first keeps the
  // multiplication exact for whole and common fractional rates.
  const baseCents = Math.round(base * 100);
  return Math.round((pct * baseCents) / 100) / 100;
}

/** One calculation shared by the live preview and the recording boundary. */
export function calculateFeeDeduction({ mode, value, baseKind, customBase, invoiceTotal, remainingBalance }) {
  const baseLabel = {
    invoice_total: 'invoice total',
    remaining_balance: 'remaining balance',
    custom: 'custom gross amount',
  }[baseKind];
  const base = Number(baseKind === 'invoice_total' ? invoiceTotal
    : baseKind === 'remaining_balance' ? remainingBalance : customBase);
  if (!baseLabel || !Number.isFinite(base) || base <= 0) {
    return { error: 'Enter a positive percentage base.' };
  }
  const baseCents = Math.round(base * 100);
  if (!Number.isSafeInteger(baseCents) || baseCents <= 0) return { error: 'Invalid percentage base.' };
  const percent = mode === 'percentage' ? sanitizePercent(value) : null;
  if (mode !== 'percentage' && mode !== 'amount') return { error: 'Select an entry method.' };
  if (mode === 'percentage' && percent === null) return { error: 'Enter a percentage greater than 0 and at most 100.' };
  const amount = mode === 'percentage' ? feeFromPercent(percent, baseCents / 100)
    : Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
    return { error: 'Enter a fee of at least $0.01.' };
  }
  const effectivePercent = percent ?? Number((Math.round(amount * 100) / baseCents * 100).toFixed(6));
  const rateNote = ` (${mode === 'amount' ? 'dollar entry; approximately ' : ''}${effectivePercent}% of ${baseLabel} $${(baseCents / 100).toFixed(2)})`;
  return {
    amount, percent: effectivePercent, base: baseCents / 100, baseLabel, rateNote,
    error: !Number.isFinite(Number(remainingBalance)) || Math.round(amount * 100) > Math.round(Number(remainingBalance) * 100)
      ? 'The fee cannot exceed the remaining invoice balance.' : null,
  };
}
