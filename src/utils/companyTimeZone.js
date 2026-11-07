export const DEFAULT_COMPANY_TIME_ZONE = 'America/New_York';

function toInstant(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string' || !value.trim()) return null;

  const text = value.trim();
  // calendar_events.start_time is a TIMESTAMP column containing UTC wall time.
  // Treat API strings without an explicit offset as UTC, not browser-local time.
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)
    && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseCalendarInstant(value) {
  return toInstant(value);
}

function timeZoneParts(date, timeZone) {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(values.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

export function dateKeyInTimeZone(value, timeZone = DEFAULT_COMPANY_TIME_ZONE) {
  const date = toInstant(value);
  if (!date) return '';
  try {
    const parts = timeZoneParts(date, timeZone);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function formatInTimeZone(value, options, timeZone = DEFAULT_COMPANY_TIME_ZONE) {
  const date = toInstant(value);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date);
  } catch {
    return '';
  }
}

export function timeZoneName(timeZone = DEFAULT_COMPANY_TIME_ZONE, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' })
      .formatToParts(date)
      .find(part => part.type === 'timeZoneName')?.value || timeZone;
  } catch {
    return timeZone;
  }
}

/** Format an absolute timestamp for a datetime-local input in the chosen zone. */
export function toDateTimeLocalInTimeZone(value, timeZone = DEFAULT_COMPANY_TIME_ZONE) {
  const date = toInstant(value);
  if (!date) return '';
  try {
    const parts = timeZoneParts(date, timeZone);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/**
 * Convert a datetime-local wall time in the given IANA zone to UTC.
 * Returns null for invalid values and nonexistent local times during a DST jump.
 */
export function dateTimeLocalInTimeZoneToUtc(value, timeZone = DEFAULT_COMPANY_TIME_ZONE) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0'] = match;
  const target = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
  };
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  const validation = new Date(targetAsUtc);
  if (
    validation.getUTCFullYear() !== target.year
    || validation.getUTCMonth() + 1 !== target.month
    || validation.getUTCDate() !== target.day
    || target.hour > 23
    || target.minute > 59
    || target.second > 59
  ) return null;

  try {
    let candidate = new Date(targetAsUtc);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const observed = timeZoneParts(candidate, timeZone);
      const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
      const correction = targetAsUtc - observedAsUtc;
      if (correction === 0) return candidate.toISOString();
      candidate = new Date(candidate.getTime() + correction);
    }
  } catch {
    return null;
  }
  return null;
}

/** Make a browser-local calendar date object from a YYYY-MM-DD calendar day. */
export function calendarDateFromKey(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day, 12);
  return Number.isNaN(date.getTime()) ? null : date;
}
