import { format } from 'date-fns';
import { parsePaymentDate } from './paymentDates.js';
import { getInvoiceTrueTotal } from './invoiceFinance.js';

const RECEIVED_STATUSES = new Set(['received', 'paid', 'completed', 'partial']);
const isTrue = value => ['true', 't', '1'].includes(String(value).toLowerCase());
const cents = value => value === '' || value == null || !Number.isFinite(Number(value))
  ? null : Math.round(Number(value) * 100);
const monthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const normalize = value => String(value || '').trim().toLowerCase();

export function companyCalendarToday(now = new Date(), timeZone = 'America/New_York') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = type => Number(parts.find(p => p.type === type).value);
  return new Date(part('year'), part('month') - 1, part('day'));
}

function ledgerDate(value) {
  const date = parsePaymentDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  // Reject rollover dates such as February 30 rather than assigning another month.
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match && (date.getFullYear() !== Number(match[1]) ||
    date.getMonth() + 1 !== Number(match[2]) || date.getDate() !== Number(match[3]))) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function entryDate(value, timeZone) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return ledgerDate(value);
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : companyCalendarToday(timestamp, timeZone);
}

export function isRecordedPayment(payment) {
  return RECEIVED_STATUSES.has(normalize(payment.status || 'received'));
}

export function isWithheldOffset(payment) {
  return [payment.is_withheld_offset, payment.data?.is_withheld_offset,
    payment.data?.data?.is_withheld_offset].some(isTrue);
}

function invoiceAllocation(payments, invoices) {
  const byId = new Map(invoices.map(invoice => [invoice.id, invoice]));
  const byNumber = new Map();
  invoices.forEach(invoice => {
    const number = normalize(invoice.invoice_number);
    if (number) byNumber.set(number, [...(byNumber.get(number) || []), invoice]);
  });
  const credits = new Map();
  const reviewIds = new Set();
  const linked = [];
  let unallocated = 0;
  payments.forEach(({ payment, amountCents }) => {
    let invoice;
    if (payment.invoice_id) {
      invoice = byId.get(payment.invoice_id);
    } else {
      const candidates = byNumber.get(normalize(payment.invoice_number)) || [];
      // Do not use a shared address/name or a duplicated invoice number to guess ownership.
      const candidate = candidates.length === 1 ? candidates[0] : null;
      const customerMatches = candidate && (payment.customer_id && candidate.customer_id
        ? payment.customer_id === candidate.customer_id
        : normalize(payment.customer_name) && normalize(payment.customer_name) === normalize(candidate.customer_name));
      if (customerMatches) invoice = candidate;
      else candidates.forEach(item => reviewIds.add(item.id));
    }
    if (invoice && (!payment.company_id || !invoice.company_id || payment.company_id === invoice.company_id)) {
      credits.set(invoice.id, (credits.get(invoice.id) || 0) + amountCents);
      linked.push({ payment, invoice, amountCents });
    } else unallocated++;
  });
  return { credits, reviewIds, linked, unallocated };
}

/** Read-only cash reporting: invoice totals never substitute for received cash. */
export function buildCollectionsAnalytics({ payments = [], invoices = [], goals = [], now = new Date(), timeZone } = {}) {
  const today = companyCalendarToday(now, timeZone);
  const currentKey = monthKey(today);
  const warnings = [];
  const cash = [];
  const credits = [];
  let missingDates = 0;
  let fallbackDates = 0;
  let invalidAmounts = 0;
  let futurePayments = 0;
  payments.forEach(payment => {
    if (!isRecordedPayment(payment)) return;
    const amountCents = cents(payment.amount);
    if (amountCents === null) { invalidAmounts++; return; }
    const date = payment.payment_date ? ledgerDate(payment.payment_date)
      : entryDate(payment.created_date || payment.created_at, timeZone);
    if (date && date > today) { futurePayments++; return; }
    credits.push({ payment, amountCents, date });
    if (isWithheldOffset(payment) || amountCents === 0) return; // Credits are not cash receipts.
    if (!date) missingDates++;
    else if (!payment.payment_date) fallbackDates++;
    cash.push({ payment, amountCents, date });
  });
  const cashWithDates = cash.filter(row => row.date);
  const earliest = cashWithDates.reduce((min, row) => !min || row.date < min ? row.date : min, null);
  const monthlyCents = new Map();
  cashWithDates.forEach(row => {
    const key = monthKey(row.date);
    monthlyCents.set(key, (monthlyCents.get(key) || 0) + row.amountCents);
  });
  const history = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - 11 + index, 1);
    const key = monthKey(date);
    const available = earliest && key >= monthKey(earliest);
    const goal = goals.find(g => g.goal_type === 'monthly' &&
      Number(g.year) === date.getFullYear() && Number(g.month) === date.getMonth() + 1);
    return {
      key, month: `${format(date, 'MMM yyyy')}${key === currentKey ? ' (MTD)' : ''}`,
      revenue: available ? (monthlyCents.get(key) || 0) / 100 : null,
      goal: goal ? Number(goal.target_amount) : null,
      complete: key !== currentKey,
    };
  });
  const sourceMonths = history.filter(month => month.complete).slice(-3);
  const sufficientHistory = sourceMonths.length === 3 && sourceMonths.every(month => month.revenue !== null);
  const baselineCents = sufficientHistory
    ? Math.round(sourceMonths.reduce((sum, month) => sum + Math.round(month.revenue * 100), 0) / 3)
    : null;
  const predictions = Array.from({ length: 3 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() + 1 + index, 1);
    return { key: monthKey(date), month: format(date, 'MMM yyyy'), baseline: baselineCents === null ? null : baselineCents / 100 };
  });
  const allocation = invoiceAllocation(credits, invoices);
  const dueMonths = Object.fromEntries(predictions.map(pred => [pred.key, { amount: 0, count: 0 }]));
  const dueCents = Object.fromEntries(predictions.map(pred => [pred.key, 0]));
  const buckets = { overdue: 0, thisMonth: 0, undated: 0, later: 0 };
  let reviewCount = 0;
  invoices.forEach(invoice => {
    if (['draft', 'cancelled', 'canceled', 'void'].includes(normalize(invoice.status || 'draft'))) return;
    const total = cents(getInvoiceTrueTotal(invoice)) || 0;
    if (total <= 0) return;
    const credited = allocation.credits.get(invoice.id) || 0;
    const storedCredit = cents(invoice.amount_paid) || 0;
    // Missing legacy payments and ambiguous links need review, not a fabricated due balance.
    if (allocation.reviewIds.has(invoice.id)) { reviewCount++; return; }
    if (storedCredit > credited + 1 || (normalize(invoice.status) === 'paid' && credited < total - 1)) {
      reviewCount++;
      return;
    }
    const balance = Math.max(0, total - credited);
    if (!balance) return;
    const due = ledgerDate(invoice.due_date);
    if (!due) buckets.undated += balance;
    else if (due < today) buckets.overdue += balance;
    else if (monthKey(due) === currentKey) buckets.thisMonth += balance;
    else if (dueMonths[monthKey(due)]) {
      dueCents[monthKey(due)] += balance;
      dueMonths[monthKey(due)].count++;
    } else buckets.later += balance;
  });
  Object.entries(dueCents).forEach(([key, value]) => { dueMonths[key].amount = value / 100; });
  if (missingDates) warnings.push(`${missingDates} received payment(s) have no valid date. They are included in all-time collections, but excluded from monthly totals and the baseline.`);
  if (fallbackDates) warnings.push(`${fallbackDates} received payment(s) have no payment date; their entry date is used. Correct those dates if the money arrived earlier.`);
  if (invalidAmounts) warnings.push(`${invalidAmounts} payment(s) have invalid amounts and are excluded. Review them before relying on these totals.`);
  if (futurePayments) warnings.push(`${futurePayments} future-dated payment(s) are excluded from collected cash until their recorded date.`);
  if (reviewCount) warnings.push(`${reviewCount} invoice(s) have missing or ambiguous payment evidence and are excluded from dated invoice balances. Review their payment links.`);
  const sumCents = cash.reduce((sum, row) => sum + row.amountCents, 0);
  const positiveCash = cash.filter(row => row.amountCents > 0);
  const previousKey = monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const earlierKey = monthKey(new Date(today.getFullYear(), today.getMonth() - 2, 1));
  const lastMonthCents = monthlyCents.get(previousKey) || 0;
  const earlierCents = monthlyCents.get(earlierKey) || 0;
  return {
    today, history, cash, linkedPayments: allocation.linked.filter(row => !isWithheldOffset(row.payment)),
    warnings, totalCollections: sumCents / 100,
    averagePayment: positiveCash.length ? Math.round(positiveCash.reduce((sum, row) => sum + row.amountCents, 0) / positiveCash.length) / 100 : 0,
    thisMonthCollections: (monthlyCents.get(currentKey) || 0) / 100,
    thisYearCollections: cashWithDates.filter(row => row.date.getFullYear() === today.getFullYear())
      .reduce((sum, row) => sum + row.amountCents, 0) / 100,
    lastMonthCollections: lastMonthCents / 100,
    growthPercent: earlierCents > 0 ? (lastMonthCents - earlierCents) / earlierCents * 100 : null,
    forecast: {
      sufficientHistory, sourceMonths, predictions,
      range: sufficientHistory ? [Math.min(...sourceMonths.map(month => month.revenue)),
        Math.max(...sourceMonths.map(month => month.revenue))] : null,
      dueMonths, buckets: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value / 100])),
      reviewCount,
    },
  };
}
