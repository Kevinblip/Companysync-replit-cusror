/**
 * Helpers for reading the envelope returned by `base44.functions.invoke(...)`.
 *
 * `invokeLocalFunction` in src/api/base44Client.js ALWAYS returns an envelope:
 *
 *   success -> { data: <whatever the handler returned> }
 *   failure -> { error: '<message>', data: {} }
 *
 * The handler's own return value is therefore nested one level down under
 * `data`. Reading a payload field straight off the envelope
 * (`result.success`, `result.imported`, `stats.avgCallDuration`, ...) silently
 * yields `undefined` — which shows up either as a blank/NaN value, as an action
 * that reports failure after it actually succeeded, or as a hard crash the
 * first time something calls `.toFixed()`/`.forEach()` on it.
 *
 * Always go through these helpers instead of touching the envelope directly.
 */

/** The handler's payload, or `{}` when the call failed or returned nothing. */
export function fnData(envelope) {
  if (!envelope || typeof envelope !== 'object') return {};
  const payload = envelope.data;
  if (payload === undefined || payload === null) return {};
  return payload;
}

/** The transport/handler error message, or `null` when the call succeeded. */
export function fnError(envelope) {
  if (!envelope || typeof envelope !== 'object') return null;
  if (envelope.error) return envelope.error;
  // Some handlers report a soft failure inside their own payload.
  const payload = envelope.data;
  if (payload && typeof payload === 'object' && payload.error) return payload.error;
  return null;
}

/** True when the call completed and the handler did not report an error. */
export function fnOk(envelope) {
  return fnError(envelope) === null;
}

/**
 * Coerce a value that should be numeric into a finite number.
 * Guards render paths like `value.toFixed(1)` against a missing or malformed
 * field, so a partial payload degrades to `0` instead of white-screening.
 */
export function fnNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
