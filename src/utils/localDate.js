// Local-timezone date helpers.
//
// WHY: `new Date().toISOString().split('T')[0]` returns the date in UTC.
// For a user in US Eastern time, anything recorded between 8 PM and midnight
// gets stamped with TOMORROW's date. And displaying a date-only string via
// `new Date('2026-07-22')` parses it as midnight UTC, which renders as
// "Jul 21" in Eastern — one day off.
//
// Use localToday() when stamping "today" on a record, and formatDateOnly()
// when displaying a date-only (YYYY-MM-DD) string.

/** Today's date as YYYY-MM-DD in the user's local timezone. */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Parse a date-only string (YYYY-MM-DD, or an ISO timestamp) into a Date
 * anchored to LOCAL midnight, so it never shifts a day when displayed.
 */
export function parseDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (m) {
    // If it's a bare date (no time part), anchor to local midnight.
    if (String(value).length <= 10) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    // Full timestamp — let JS parse it normally (it carries real time info).
    const d = new Date(value);
    return isNaN(d) ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : d;
  }
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

/**
 * Display a date-only string like "Jul 22, 2026" without the one-day UTC shift.
 * Options may override the default {month:'short', day:'numeric', year:'numeric'}.
 */
export function formatDateOnly(value, options) {
  const d = parseDateOnly(value);
  if (!d) return '';
  return d.toLocaleDateString('en-US', options || { month: 'short', day: 'numeric', year: 'numeric' });
}
