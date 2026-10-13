import { parseDateOnly } from './localDate.js';

// payment_date is a calendar date, even when PostgreSQL serializes its
// midnight value as a timestamp. Never convert that date through UTC.
export function parsePaymentDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) {
    return parseDateOnly(value.slice(0, 10));
  }
  return parseDateOnly(value);
}

export function paymentDateInput(value) {
  const date = parsePaymentDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getPaymentPeriodDateRange(period, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayEnd = new Date(year, month, now.getDate(), 23, 59, 59, 999);
  const monthEnd = (y, m) => new Date(y, m + 1, 0, 23, 59, 59, 999);
  switch (period) {
    case 'this_month': return { start: new Date(year, month, 1), end: monthEnd(year, month) };
    case 'last_month': return { start: new Date(year, month - 1, 1), end: monthEnd(year, month - 1) };
    case 'this_year': return { start: new Date(year, 0, 1), end: monthEnd(year, 11) };
    case 'last_year': return { start: new Date(year - 1, 0, 1), end: monthEnd(year - 1, 11) };
    case 'last_3_months': return { start: new Date(year, month - 2, 1), end: todayEnd };
    case 'last_6_months': return { start: new Date(year, month - 5, 1), end: todayEnd };
    case 'last_12_months': return { start: new Date(year, month - 11, 1), end: todayEnd };
    default: return { start: null, end: null };
  }
}

export function paymentIsInPeriod(value, period, now = new Date()) {
  const { start, end } = getPaymentPeriodDateRange(period, now);
  if (!start || !end) return true;
  const date = parsePaymentDate(value);
  return !!date && date >= start && date <= end;
}
