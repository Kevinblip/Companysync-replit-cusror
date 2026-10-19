import { format, isValid } from "date-fns";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse any stored date value (ISO string, date-only "YYYY-MM-DD", Date,
 * epoch ms) into a valid Date, or return null. Date-only strings are parsed
 * as LOCAL midnight (new Date("2026-10-15") would be UTC and show the day before).
 */
export function toSafeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  let d;
  if (value instanceof Date) d = new Date(value.getTime());
  else if (typeof value === "number") d = new Date(value);
  else if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (DATE_ONLY.test(s)) {
      const [y, m, day] = s.split("-").map(Number);
      d = new Date(y, m - 1, day);
    } else {
      d = new Date(s);
    }
  } else if (value && typeof value === "object" && (value.dateTime || value.date)) {
    // Google Calendar style { dateTime } / { date } (all-day)
    return toSafeDate(value.dateTime || value.date);
  } else {
    return null;
  }
  return isValid(d) ? d : null;
}

/** date-fns format() that never throws "Invalid time value". */
export function safeFormat(value, fmt, fallback = "No time set") {
  const d = toSafeDate(value);
  if (!d) return fallback;
  try {
    return format(d, fmt);
  } catch {
    return fallback;
  }
}

/** toISOString() that never throws; returns null for invalid input. */
export function safeISO(value) {
  const d = toSafeDate(value);
  return d ? d.toISOString() : null;
}
