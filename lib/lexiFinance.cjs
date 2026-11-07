'use strict';

// Read-only money answers for Lexi. Balances come from the same allocator the
// invoice recalculator writes with, so a partial payment reduces what is owed.
// Nothing here inserts, updates, voids, refunds, or charges.

const {
  allocatePaymentsToInvoices,
  nextInvoiceStatus,
  paymentCountsTowardInvoice,
} = require('./invoicePaymentRecalculator.cjs');

const TIME_ZONE = 'America/New_York';
const LIST_CAP = 10;
const REMINDER_CAP = 20;
const OPEN_SKIP = new Set(['cancelled', 'void', 'draft', 'paid']);

function roundMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function formatMoney(amount) {
  const n = roundMoney(amount);
  const sign = n < 0 ? '-' : '';
  const [dollars, cents] = Math.abs(n).toFixed(2).split('.');
  return `${sign}$${Number(dollars).toLocaleString('en-US')}.${cents}`;
}

function displayStatus(status) {
  const raw = String(status || '').toLowerCase();
  if (raw === 'partially_paid' || raw === 'partial') return 'partial';
  return raw || 'unknown';
}

function parseData(row) {
  if (!row) return {};
  if (row.data && typeof row.data === 'object') return row.data;
  if (typeof row.data === 'string') {
    try { return JSON.parse(row.data) || {}; } catch (e) { return {}; }
  }
  return {};
}

function paymentLink(invoice) {
  const data = parseData(invoice);
  return String(
    data.stripe_payment_link
    || data.payment_link
    || data.payment_url
    || data.checkout_url
    || ''
  ).trim();
}

function timeZoneOffsetMs(timeZone, date) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(formatted.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return asUtc - date.getTime();
}

function zonedYmd(date, timeZone = TIME_ZONE) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(formatted.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function ymdToUtcMidnight(ymd) {
  const [year, month, day] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

function zonedStart(ymd, timeZone = TIME_ZONE) {
  const midnight = ymdToUtcMidnight(ymd);
  return new Date(midnight.getTime() - timeZoneOffsetMs(timeZone, midnight));
}

function addDays(ymd, days) {
  const [year, month, day] = String(ymd).split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function weekdayIndex(ymd) {
  const [year, month, day] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function boundsFromYmd(startYmd, endYmd, label, timeZone = TIME_ZONE) {
  const start = zonedStart(startYmd, timeZone);
  const end = new Date(zonedStart(addDays(endYmd, 1), timeZone).getTime() - 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label,
    timeZone,
    startYmd,
    endYmd,
  };
}

function periodBounds(args = {}, now = new Date(), timeZone = TIME_ZONE) {
  const period = String(args.period || args.range || '').trim().toLowerCase();
  const today = zonedYmd(now, timeZone);
  if (args.start_date || args.end_date || period === 'custom') {
    const startYmd = String(args.start_date || args.end_date || '').slice(0, 10);
    const endYmd = String(args.end_date || args.start_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return null;
    return boundsFromYmd(startYmd <= endYmd ? startYmd : endYmd, startYmd <= endYmd ? endYmd : startYmd, 'custom', timeZone);
  }
  if (period === 'today' || period === 'this day') return boundsFromYmd(today, today, 'today', timeZone);
  if (period === 'yesterday') return boundsFromYmd(addDays(today, -1), addDays(today, -1), 'yesterday', timeZone);
  if (period === 'tomorrow') return boundsFromYmd(addDays(today, 1), addDays(today, 1), 'tomorrow', timeZone);
  if (period === 'this week' || period === 'week') {
    const sinceMonday = (weekdayIndex(today) + 6) % 7;
    return boundsFromYmd(addDays(today, -sinceMonday), today, 'this week', timeZone);
  }
  if (period === 'this month' || period === 'month') {
    return boundsFromYmd(`${today.slice(0, 8)}01`, today, 'this month', timeZone);
  }
  if (period === 'last month') {
    const firstThis = `${today.slice(0, 8)}01`;
    const lastPrev = addDays(firstThis, -1);
    return boundsFromYmd(`${lastPrev.slice(0, 8)}01`, lastPrev, 'last month', timeZone);
  }
  return null;
}

function fullWeekBounds(now = new Date(), timeZone = TIME_ZONE) {
  const today = zonedYmd(now, timeZone);
  const sinceMonday = (weekdayIndex(today) + 6) % 7;
  const start = addDays(today, -sinceMonday);
  return boundsFromYmd(start, addDays(start, 6), 'this week', timeZone);
}

function dueYmd(value) {
  if (!value) return '';
  const text = String(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return zonedYmd(parsed);
}

function daysBetween(earlierYmd, laterYmd) {
  const a = ymdToUtcMidnight(earlierYmd).getTime();
  const b = ymdToUtcMidnight(laterYmd).getTime();
  return Math.round((b - a) / 86400000);
}

function agingBucket(days) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

function customerName(row) {
  return String(row?.customer_name || row?.name || '').trim();
}

function nameMatches(candidate, query) {
  const want = String(query || '').trim().toLowerCase();
  if (!want) return true;
  return String(candidate || '').toLowerCase().includes(want);
}

async function readRows(pool, label, sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows || [];
  } catch (err) {
    console.warn(`[LexiFinance] ${label} skipped:`, err.message);
    return [];
  }
}

async function loadBooks(pool, companyId) {
  const invoices = await readRows(
    pool,
    'invoices',
    `SELECT id, company_id, customer_id, customer_name, customer_email, invoice_number,
            status, total_amount, amount_paid, due_date, data
     FROM invoices WHERE company_id = $1`,
    [companyId]
  );
  const payments = await readRows(
    pool,
    'payments',
    `SELECT id, company_id, invoice_id, customer_id, customer_name, invoice_number,
            amount, payment_method, payment_date, status, created_at
     FROM payments WHERE company_id = $1`,
    [companyId]
  );
  const estimates = await readRows(
    pool,
    'estimates',
    `SELECT id, company_id, customer_id, customer_name, estimate_number, title, status, total_amount, updated_at
     FROM estimates WHERE company_id = $1`,
    [companyId]
  );
  const customers = await readRows(
    pool,
    'customers',
    `SELECT id, name, phone, email FROM customers WHERE company_id = $1`,
    [companyId]
  );
  const companies = await readRows(
    pool,
    'company',
    `SELECT company_name, name FROM companies WHERE id = $1 LIMIT 1`,
    [companyId]
  );
  return {
    invoices,
    payments,
    estimates,
    customers,
    companyName: companies[0]?.company_name || companies[0]?.name || '',
  };
}

function allocatedBooks(invoices, payments) {
  const totals = allocatePaymentsToInvoices(payments, invoices);
  return totals;
}

function describeInvoice(invoice, paid, todayYmd) {
  const total = roundMoney(invoice.total_amount ?? invoice.amount ?? 0);
  const amountPaid = roundMoney(paid || 0);
  const balance = roundMoney(Math.max(0, total - amountPaid));
  const status = nextInvoiceStatus(invoice, amountPaid);
  const due = dueYmd(invoice.due_date);
  const daysOverdue = due ? Math.max(0, daysBetween(due, todayYmd)) : 0;
  const overdue = balance > 0.004 && !!due && daysOverdue > 0 && !OPEN_SKIP.has(String(status).toLowerCase());
  return {
    id: invoice.id,
    company_id: invoice.company_id,
    customer_id: invoice.customer_id || '',
    customer_name: customerName(invoice),
    customer_email: invoice.customer_email || '',
    invoice_number: String(invoice.invoice_number || '').trim(),
    status: displayStatus(status),
    raw_status: status,
    total,
    amount_paid: amountPaid,
    balance,
    due_date: due,
    days_overdue: overdue ? daysOverdue : 0,
    overdue,
    bucket: overdue ? agingBucket(daysOverdue) : '',
    payment_link: paymentLink(invoice),
    customer_phone: String(parseData(invoice).customer_phone || parseData(invoice).phone || '').trim(),
  };
}

function isOpenInvoice(row) {
  return row.balance > 0.004 && !OPEN_SKIP.has(String(row.raw_status || row.status).toLowerCase());
}

function booksOrError(invoices, payments, todayYmd) {
  let totals;
  try {
    totals = allocatedBooks(invoices, payments);
  } catch (err) {
    if (err.code === 'AMBIGUOUS_PAYMENT_OWNERSHIP') {
      return {
        error: {
          success: false,
          code: 'AMBIGUOUS_PAYMENT_OWNERSHIP',
          error: 'A payment matches more than one invoice, so the balance was not guessed. Say that.',
        },
      };
    }
    throw err;
  }
  const rows = invoices.map((invoice) => describeInvoice(invoice, totals.get(String(invoice.id)) || 0, todayYmd));
  return { rows };
}

function paymentWhen(payment) {
  const raw = payment.payment_date || payment.created_at;
  const when = new Date(raw);
  return Number.isNaN(when.getTime()) ? null : when;
}

function contactFor(invoice, customers) {
  const byId = invoice.customer_id
    ? customers.find((row) => String(row.id) === String(invoice.customer_id))
    : null;
  const byName = customers.find((row) => nameMatches(row.name, invoice.customer_name) && String(row.name || '').toLowerCase() === invoice.customer_name.toLowerCase());
  const person = byId || byName || {};
  return {
    phone: String(person.phone || invoice.customer_phone || '').trim(),
    email: String(invoice.customer_email || person.email || '').trim(),
    name: invoice.customer_name || person.name || 'there',
  };
}

function reminderText({ firstName, companyName, invoiceNumber, amount, paymentLink: link }) {
  const who = companyName || 'us';
  const pay = link ? ` Pay here: ${link}` : '';
  return `Hi ${firstName}, this is ${who}. Invoice ${invoiceNumber} has a balance of ${formatMoney(amount)}.${pay} Please reply if you have a question. Thank you.`;
}

function firstNameOf(name) {
  const first = String(name || '').trim().split(/\s+/)[0];
  return first || 'there';
}

function requireCompany(owner) {
  if (!owner?.companyId) {
    return {
      success: false,
      code: 'COMPANY_UNRESOLVED',
      error: `No company is linked to ${owner?.userEmail || 'this caller'}, so no balances were read. Say that sentence.`,
    };
  }
  return null;
}

async function summarizePayments(pool, owner, args = {}, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const bounds = periodBounds(args, now);
  if (!bounds) {
    return { success: false, error: 'Use today, this week, this month, last month, or a start and end date.' };
  }
  const books = await loadBooks(pool, owner.companyId);
  const customer = String(args.customer || args.customer_name || args.name || '').trim();
  const matched = books.payments.filter((payment) => {
    if (String(payment.company_id || owner.companyId) !== String(owner.companyId)) return false;
    if (!paymentCountsTowardInvoice(payment)) return false;
    if (customer && !nameMatches(payment.customer_name, customer)) return false;
    const when = paymentWhen(payment);
    if (!when) return false;
    return when.getTime() >= Date.parse(bounds.start) && when.getTime() <= Date.parse(bounds.end);
  });
  matched.sort((a, b) => (paymentWhen(b)?.getTime() || 0) - (paymentWhen(a)?.getTime() || 0));
  const total = roundMoney(matched.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  const rows = matched.slice(0, LIST_CAP).map((payment) => ({
    customer_name: customerName(payment),
    amount: formatMoney(payment.amount),
    when: payment.payment_date || payment.created_at || '',
    method: payment.payment_method || '',
    invoice_number: payment.invoice_number || '',
  }));
  const who = customer ? ` from ${customer}` : '';
  const spoken = `${matched.length} payment${matched.length === 1 ? '' : 's'}${who} ${bounds.label}, totaling ${formatMoney(total)}.`;
  return {
    success: true,
    period: bounds.label,
    start: bounds.startYmd,
    end: bounds.endYmd,
    count: matched.length,
    total,
    total_spoken: formatMoney(total),
    customer: customer || '',
    rows,
    spoken,
    message: `On a call, say only this: ${spoken} In a text, you may list up to ${LIST_CAP} payments. Do not add payments that are not in rows.`,
  };
}

function emptyAging() {
  return { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
}

async function summarizeReceivables(pool, owner, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const books = await loadBooks(pool, owner.companyId);
  const built = booksOrError(books.invoices.filter((row) => String(row.company_id || owner.companyId) === String(owner.companyId)), books.payments, zonedYmd(now));
  if (built.error) return built.error;
  const open = built.rows.filter(isOpenInvoice);
  const overdue = open.filter((row) => row.overdue);
  const aging = emptyAging();
  for (const row of overdue) aging[row.bucket] = roundMoney(aging[row.bucket] + row.balance);
  const byCustomer = new Map();
  for (const row of open) {
    const key = row.customer_name || 'Unknown';
    const current = byCustomer.get(key) || { customer_name: key, balance: 0, invoices: 0 };
    current.balance = roundMoney(current.balance + row.balance);
    current.invoices += 1;
    byCustomer.set(key, current);
  }
  const top = [...byCustomer.values()].sort((a, b) => b.balance - a.balance).slice(0, LIST_CAP);
  const outstanding = roundMoney(open.reduce((sum, row) => sum + row.balance, 0));
  const overdueTotal = roundMoney(overdue.reduce((sum, row) => sum + row.balance, 0));
  const spoken = `${formatMoney(outstanding)} outstanding on ${open.length} open invoice${open.length === 1 ? '' : 's'}. ${formatMoney(overdueTotal)} is overdue.`;
  return {
    success: true,
    open_count: open.length,
    outstanding,
    outstanding_spoken: formatMoney(outstanding),
    overdue_count: overdue.length,
    overdue_total: overdueTotal,
    aging: {
      '0-30': formatMoney(aging['0-30']),
      '31-60': formatMoney(aging['31-60']),
      '61-90': formatMoney(aging['61-90']),
      '90+': formatMoney(aging['90+']),
    },
    top_customers: top.map((row) => ({ ...row, balance: formatMoney(row.balance) })),
    overdue_invoices: overdue
      .sort((a, b) => b.days_overdue - a.days_overdue || b.balance - a.balance)
      .slice(0, LIST_CAP)
      .map((row) => ({
        customer_name: row.customer_name,
        invoice_number: row.invoice_number,
        balance: formatMoney(row.balance),
        days_overdue: row.days_overdue,
        bucket: row.bucket,
      })),
    spoken,
    message: `On a call, say only this: ${spoken} In a text, you may list the aging buckets and up to ${LIST_CAP} customers or invoices.`,
  };
}

function invoiceReadBack(row) {
  const due = row.due_date ? ` Due ${row.due_date}.` : '';
  const late = row.overdue ? ` ${row.days_overdue} days overdue, bucket ${row.bucket}.` : '';
  const link = row.payment_link ? ` Payment link on file.` : '';
  return `${row.customer_name || 'Unknown'} invoice ${row.invoice_number || row.id} is ${row.status}. Total ${formatMoney(row.total)}, paid ${formatMoney(row.amount_paid)}, balance ${formatMoney(row.balance)}.${due}${late}${link}`;
}

// Same invoice-email filter as getInvoiceDeliverySummary. Lexi has no HTTP
// caller here, so this reads that row directly instead of the request handler.
async function latestDelivery(pool, companyId, invoiceId) {
  if (!invoiceId) return '';
  const rows = await readRows(
    pool,
    'delivery',
    `SELECT status, data->>'delivery_status' AS delivery_status, created_at
       FROM communications
      WHERE company_id = $1
        AND data->>'related_entity_type' = 'Invoice'
        AND data->>'related_entity_id' = $2
        AND data->>'source' = 'invoice_payment_request'
      ORDER BY created_at DESC LIMIT 1`,
    [companyId, invoiceId]
  );
  const row = rows[0];
  if (!row) return '';
  return String(row.delivery_status || row.status || '').trim();
}

async function lookupInvoice(pool, owner, args = {}, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const invoiceNumber = String(args.invoice_number || args.number || '').trim();
  const invoiceId = String(args.invoice_id || args.id || '').trim();
  const customer = String(args.customer || args.customer_name || args.name || '').trim();
  if (!invoiceNumber && !invoiceId && !customer) {
    return { success: false, error: 'Give an invoice number or a customer name.' };
  }
  const books = await loadBooks(pool, owner.companyId);
  const built = booksOrError(
    books.invoices.filter((row) => String(row.company_id || owner.companyId) === String(owner.companyId)),
    books.payments,
    zonedYmd(now)
  );
  if (built.error) return built.error;
  let matches = built.rows;
  if (invoiceId) matches = matches.filter((row) => String(row.id) === invoiceId);
  if (invoiceNumber) matches = matches.filter((row) => row.invoice_number.toLowerCase() === invoiceNumber.toLowerCase());
  if (customer) matches = matches.filter((row) => nameMatches(row.customer_name, customer));
  if (!matches.length) return { success: true, matches: [], message: 'No matching invoice. Say that.' };
  const listed = matches.slice(0, LIST_CAP);
  if (listed.length === 1) {
    const delivery = await latestDelivery(pool, owner.companyId, listed[0].id);
    if (delivery) listed[0].last_delivery = delivery;
  }
  const readBack = listed.map(invoiceReadBack).join(' ');
  const which = matches.length > 1 ? 'Several invoices. Ask which one. ' : '';
  const spoken = matches.length === 1
    ? `${listed[0].customer_name || 'That customer'} owes ${formatMoney(listed[0].balance)} on invoice ${listed[0].invoice_number || listed[0].id}. It is ${listed[0].status}.`
    : `${matches.length} invoices. The first is ${formatMoney(listed[0].balance)} for ${listed[0].customer_name}.`;
  return {
    success: true,
    matches: listed,
    spoken,
    read_back: readBack,
    message: `${which}On a call, say: ${spoken} In a text, you may list up to ${LIST_CAP}. ${readBack}`,
  };
}

async function lookupEstimate(pool, owner, args = {}) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const number = String(args.estimate_number || args.number || '').trim();
  const title = String(args.title || '').trim();
  const customer = String(args.customer || args.customer_name || args.name || '').trim();
  if (!number && !title && !customer) return { success: false, error: 'Give an estimate number, title, or customer name.' };
  const books = await loadBooks(pool, owner.companyId);
  let matches = books.estimates.filter((row) => String(row.company_id || owner.companyId) === String(owner.companyId));
  if (number) matches = matches.filter((row) => String(row.estimate_number || '').toLowerCase() === number.toLowerCase());
  if (title) matches = matches.filter((row) => nameMatches(row.title, title));
  if (customer) matches = matches.filter((row) => nameMatches(row.customer_name, customer));
  if (!matches.length) return { success: true, matches: [], message: 'No matching estimate. Say that.' };
  const listed = matches.slice(0, LIST_CAP).map((row) => ({
    id: row.id,
    customer_name: customerName(row),
    estimate_number: row.estimate_number || '',
    title: row.title || '',
    status: displayStatus(row.status),
    total: formatMoney(row.total_amount),
  }));
  const first = listed[0];
  const spoken = listed.length === 1
    ? `${first.customer_name || 'That estimate'} ${first.estimate_number || first.title || ''} is ${first.status}, ${first.total}.`
    : `${matches.length} estimates. The first is ${first.status} for ${first.customer_name}.`;
  const readBack = listed.map((row) => `${row.customer_name} estimate ${row.estimate_number || row.title || row.id} is ${row.status}, ${row.total}.`).join(' ');
  return {
    success: true,
    matches: listed,
    spoken,
    read_back: readBack,
    message: `${matches.length > 1 ? 'Several estimates. Ask which one. ' : ''}On a call, say: ${spoken} ${readBack}`,
  };
}

function destination(contact, channel) {
  if (channel === 'email') return contact.email;
  if (channel === 'sms') return contact.phone;
  return '';
}

function buildReminder(invoice, contact, channel, companyName) {
  const to = destination(contact, channel);
  const message = reminderText({
    firstName: firstNameOf(contact.name),
    companyName,
    invoiceNumber: invoice.invoice_number || invoice.id,
    amount: invoice.balance,
    paymentLink: invoice.payment_link,
  });
  return {
    channel,
    to,
    subject: channel === 'email' ? `Invoice ${invoice.invoice_number || invoice.id} — ${formatMoney(invoice.balance)} outstanding` : '',
    message,
    contact_name: contact.name,
    invoice_number: invoice.invoice_number || '',
    amount: formatMoney(invoice.balance),
  };
}

async function openMatches(pool, owner, args, now) {
  const books = await loadBooks(pool, owner.companyId);
  const built = booksOrError(
    books.invoices.filter((row) => String(row.company_id || owner.companyId) === String(owner.companyId)),
    books.payments,
    zonedYmd(now)
  );
  if (built.error) return built;
  const invoiceNumber = String(args.invoice_number || args.number || '').trim();
  const customer = String(args.customer || args.customer_name || args.name || '').trim();
  let matches = built.rows.filter(isOpenInvoice);
  if (invoiceNumber) matches = matches.filter((row) => row.invoice_number.toLowerCase() === invoiceNumber.toLowerCase());
  if (customer) matches = matches.filter((row) => nameMatches(row.customer_name, customer));
  return { books, matches };
}

async function draftPaymentReminder(pool, owner, args, state, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const found = await openMatches(pool, owner, args, now);
  if (found.error) return found.error;
  if (!String(args.invoice_number || args.number || args.customer || args.customer_name || args.name || '').trim()) {
    return { success: false, error: 'Say which invoice or customer the reminder is for.' };
  }
  if (!found.matches.length) return { success: false, error: 'No open balance for that invoice or customer. Nothing was drafted.' };
  if (found.matches.length > 1) {
    const listed = found.matches.slice(0, LIST_CAP).map((row) => `${row.customer_name} invoice ${row.invoice_number} ${formatMoney(row.balance)}`).join('; ');
    return { success: false, code: 'WHICH_INVOICE', error: `Several open invoices. Ask which one. ${listed}` };
  }
  const invoice = found.matches[0];
  const contact = contactFor(invoice, found.books.customers);
  const requested = String(args.channel || '').toLowerCase();
  const channel = requested === 'email' || requested === 'sms'
    ? requested
    : (contact.phone ? 'sms' : 'email');
  if (channel !== 'sms' && channel !== 'email') return { success: false, error: 'Channel must be sms or email.' };
  const draft = buildReminder(invoice, contact, channel, found.books.companyName);
  if (!draft.to) {
    return { success: false, error: `No ${channel === 'email' ? 'email' : 'phone'} is on file for ${contact.name}. Nothing was drafted.` };
  }
  state.pendingReminderBatch = null;
  state.pendingDraft = {
    channel: draft.channel,
    to: draft.to,
    subject: draft.subject,
    message: draft.message,
    contact_name: draft.contact_name,
    drafted_at: new Date().toISOString(),
  };
  const who = draft.contact_name || draft.to;
  const readBack = channel === 'email'
    ? `Email to ${who} at ${draft.to}. Subject: ${draft.subject}. ${draft.message}`
    : `Text to ${who} at ${draft.to}: ${draft.message}`;
  return {
    success: true,
    drafted: true,
    sent: false,
    read_back: readBack,
    message: `Draft only. Read the full text and the recipient back. Do not say it was sent. He must say "yes, send it". ${readBack}`,
  };
}

async function prepareOverdueReminders(pool, owner, args, state, now = new Date()) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const books = await loadBooks(pool, owner.companyId);
  const built = booksOrError(
    books.invoices.filter((row) => String(row.company_id || owner.companyId) === String(owner.companyId)),
    books.payments,
    zonedYmd(now)
  );
  if (built.error) return built.error;
  const overdue = built.rows.filter((row) => row.overdue && isOpenInvoice(row))
    .sort((a, b) => b.balance - a.balance);
  const requested = String(args.channel || 'sms').toLowerCase();
  const channel = requested === 'email' ? 'email' : 'sms';
  const skipped = [];
  const ready = [];
  for (const invoice of overdue) {
    const contact = contactFor(invoice, books.customers);
    const draft = buildReminder(invoice, contact, channel, books.companyName);
    if (!draft.to) {
      skipped.push(`${invoice.customer_name || 'Unknown'} invoice ${invoice.invoice_number} has no ${channel === 'email' ? 'email' : 'phone'}`);
      continue;
    }
    ready.push(draft);
  }
  const capped = ready.slice(0, REMINDER_CAP);
  const leftOut = ready.length - capped.length;
  if (!capped.length) {
    state.pendingReminderBatch = null;
    return { success: false, error: skipped[0] || 'No overdue invoices to remind. Nothing was drafted.' };
  }
  state.pendingDraft = null;
  state.pendingReminderBatch = {
    channel,
    items: capped,
    prepared_at: new Date().toISOString(),
  };
  const lines = capped.map((item) => `${item.contact_name}, invoice ${item.invoice_number}, ${item.amount}, ${item.channel} to ${item.to}`);
  const spoken = `${capped.length} overdue reminder${capped.length === 1 ? '' : 's'} are ready. ${lines.join('. ')}. Nothing was sent. One "yes, send it" sends this batch.`;
  return {
    success: true,
    drafted: true,
    sent: false,
    count: capped.length,
    capped: leftOut > 0,
    left_out: leftOut,
    skipped,
    items: capped.map((item) => ({
      contact_name: item.contact_name,
      invoice_number: item.invoice_number,
      amount: item.amount,
      channel: item.channel,
      to: item.to,
      message: item.message,
    })),
    spoken,
    message: `${spoken}${leftOut > 0 ? ` ${leftOut} more were left out because the batch stops at ${REMINDER_CAP}.` : ''}${skipped.length ? ` Skipped: ${skipped.join('; ')}.` : ''} On a call, say each name, invoice number, and amount. In a text, you may include each full message.`,
  };
}

module.exports = {
  LIST_CAP,
  REMINDER_CAP,
  TIME_ZONE,
  formatMoney,
  displayStatus,
  zonedYmd,
  addDays,
  periodBounds,
  fullWeekBounds,
  agingBucket,
  paymentLink,
  summarizePayments,
  summarizeReceivables,
  lookupInvoice,
  lookupEstimate,
  draftPaymentReminder,
  prepareOverdueReminders,
};
