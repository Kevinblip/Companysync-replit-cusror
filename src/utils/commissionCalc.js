/**
 * Commission Tracker math.
 *
 * Commission is a percentage of money collected (payment rows), not of profit
 * and not of the contract until that money is received. Each rep uses their
 * own commission_rate. Splits on the invoice replace a single sale agent.
 */

const NON_COUNTABLE_STATUSES = new Set([
  'failed',
  'refunded',
  'void',
  'voided',
  'cancelled',
  'canceled',
  'declined',
  'reversed',
]);

export function roundCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Local calendar day as YYYY-MM-DD. UTC date strings shift a day in US timezones. */
export function localCalendarDate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function emailsMatch(a, b) {
  if (a == null || b == null) return false;
  const left = String(a).trim().toLowerCase();
  const right = String(b).trim().toLowerCase();
  return left.length > 0 && left === right;
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
  }
  return [];
}

/**
 * Date-only values and midnight-UTC timestamps are calendar dates.
 * `new Date('2026-10-01')` is UTC midnight, which falls on the previous
 * local evening in US timezones and drops the 1st out of "this month".
 */
export function parseCommissionDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    if (
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0
    ) {
      return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0);
    }
    return value;
  }
  const s = String(value).trim();
  const calendar = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]00:00:00(?:\.\d+)?Z?)?$/);
  if (calendar) {
    return new Date(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3]), 0, 0, 0, 0);
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function inDateRange(value, start, end) {
  const d = parseCommissionDate(value);
  if (!d) return false;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

export function paymentAmount(payment) {
  if (!payment) return 0;
  const column = Number(payment.amount);
  const fromData = Number(payment.data?.amount);
  if (Number.isFinite(column) && column !== 0) return column;
  if (Number.isFinite(fromData) && fromData !== 0) return fromData;
  return Number.isFinite(column) ? column : 0;
}

export function invoiceMoney(invoice) {
  if (!invoice) return 0;
  const candidates = [
    invoice.amount,
    invoice.total_amount,
    invoice.data?.amount,
    invoice.data?.total_amount,
    invoice.data?.total,
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

export function resolveCommissionRate(staff) {
  if (!staff) return 0;
  const column = Number(staff.commission_rate);
  if (Number.isFinite(column) && column > 0) return column;
  const fromData = Number(staff.data?.commission_rate ?? staff.data?.commission_percentage);
  if (Number.isFinite(fromData) && fromData > 0) return fromData;
  const top = Number(staff.commission_percentage);
  if (Number.isFinite(top) && top > 0 && staff.commission_rate == null) return top;
  return 0;
}

export function resolveCommissionSplits(invoice) {
  if (!invoice) return [];
  const column = asArray(invoice.commission_splits);
  if (column.length > 0) return column;
  return asArray(invoice.data?.commission_splits);
}

export function isCountablePayment(payment) {
  if (!payment) return false;
  const status = String(payment.status || '').trim().toLowerCase();
  if (NON_COUNTABLE_STATUSES.has(status)) return false;
  const amount = paymentAmount(payment);
  return Number.isFinite(amount) && amount !== 0;
}

export function sameCompany(row, companyId) {
  if (!companyId) return true;
  if (!row) return false;
  if (row.company_id == null || row.company_id === '') return false;
  return String(row.company_id) === String(companyId);
}

function paymentLinksInvoice(payment, invoice) {
  if (!payment || !invoice) return false;
  if (payment.invoice_id && invoice.id && String(payment.invoice_id) === String(invoice.id)) return true;
  const paymentNumber = String(payment.invoice_number || '').trim();
  const invoiceNumber = String(invoice.invoice_number || '').trim();
  return paymentNumber.length > 0 && paymentNumber !== 'none' && paymentNumber === invoiceNumber;
}

export function findInvoiceForPayment(payment, invoices) {
  if (!payment || !Array.isArray(invoices)) return null;
  if (payment.invoice_id) {
    const byId = invoices.find((inv) => inv && String(inv.id) === String(payment.invoice_id));
    if (byId) return byId;
  }
  const number = String(payment.invoice_number || '').trim();
  if (number && number !== 'none') {
    const byNumber = invoices.find((inv) => String(inv?.invoice_number || '').trim() === number);
    if (byNumber) return byNumber;
  }
  return null;
}

export function findCustomerForInvoice(invoice, payment, customers) {
  if (!Array.isArray(customers) || customers.length === 0) return null;
  const customerId = invoice?.customer_id || payment?.customer_id;
  if (customerId) {
    const byId = customers.find((c) => c && String(c.id) === String(customerId));
    if (byId) return byId;
  }
  const name = invoice?.customer_name || payment?.customer_name;
  if (!name) return null;
  return customers.find((c) => c && c.name === name) || null;
}

/**
 * Who is credited for an invoice.
 * Splits, when present, are the only recipients.
 * Otherwise the sale agent.
 * Otherwise one primary customer assignee — never every assigned user.
 */
function uniqueRecipients(recipients) {
  const seen = new Set();
  const unique = [];
  for (const recipient of recipients) {
    const key = recipient.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(recipient);
  }
  return unique;
}

export function commissionRecipients(invoice, customer) {
  const splits = resolveCommissionSplits(invoice);
  if (splits.length > 0) {
    return uniqueRecipients(splits
      .filter((split) => split && split.user_email)
      .map((split) => ({
        email: String(split.user_email).trim(),
        splitPercentage: Number(split.split_percentage),
        role: split.role || 'Sales',
        name: split.user_name || '',
      }))
      .filter((split) => Number.isFinite(split.splitPercentage) && split.splitPercentage > 0));
  }
  if (invoice?.sale_agent) {
    return [{ email: String(invoice.sale_agent).trim(), splitPercentage: 100, role: 'Sales', name: invoice.sale_agent_name || '' }];
  }
  if (customer?.assigned_to) {
    return [{ email: String(customer.assigned_to).trim(), splitPercentage: 100, role: 'Sales', name: '' }];
  }
  const assigned = asArray(customer?.assigned_to_users).map((email) => String(email).trim()).filter(Boolean);
  if (assigned.length === 1) {
    return [{ email: assigned[0], splitPercentage: 100, role: 'Sales', name: '' }];
  }
  return [];
}

function recipientsForPayment(payment, invoice, customer) {
  if (invoice) return commissionRecipients(invoice, customer);
  if (customer?.assigned_to) {
    return [{ email: String(customer.assigned_to).trim(), splitPercentage: 100, role: 'Sales', name: '' }];
  }
  const assigned = asArray(customer?.assigned_to_users).map((email) => String(email).trim()).filter(Boolean);
  if (assigned.length === 1) {
    return [{ email: assigned[0], splitPercentage: 100, role: 'Sales', name: '' }];
  }
  return [];
}

export function deductionAmount(deduction) {
  return roundCents(deduction?.amount);
}

export function deductionEmail(deduction) {
  return deduction?.sales_rep_email || deduction?.staff_email || '';
}

function isManualCommissionEntry(record) {
  const notes = `${record?.notes || ''} ${record?.description || ''}`;
  return /manual/i.test(notes);
}

export function existingPayout(commissionPayments, { companyId, email, periodKey } = {}) {
  if (!periodKey || !email) return null;
  return (commissionPayments || []).find((record) => {
    if (companyId && record?.company_id && String(record.company_id) !== String(companyId)) return false;
    const recordEmail = record?.sales_rep_email || record?.staff_email;
    if (!emailsMatch(recordEmail, email)) return false;
    if (record?.pay_period !== periodKey) return false;
    return String(record?.status || 'paid').toLowerCase() === 'paid';
  }) || null;
}

export function payPeriodKey(periodType, now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  switch (periodType) {
    case 'today':
      return `${y}-${m}-${d}`;
    case 'this_week': {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      const sy = start.getFullYear();
      const sm = String(start.getMonth() + 1).padStart(2, '0');
      const sd = String(start.getDate()).padStart(2, '0');
      return `week-${sy}-${sm}-${sd}`;
    }
    case 'this_month':
    case 'current_month':
      return `${y}-${m}`;
    case 'last_month': {
      const last = new Date(y, now.getMonth() - 1, 1);
      return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`;
    }
    case 'current_quarter': {
      const q = Math.floor(now.getMonth() / 3) + 1;
      return `${y}-Q${q}`;
    }
    case 'this_year':
    case 'ytd':
      return String(y);
    case 'last_year':
      return String(y - 1);
    case 'last_3_months':
      return `rolling-3m-${y}-${m}-${d}`;
    case 'last_6_months':
      return `rolling-6m-${y}-${m}-${d}`;
    case 'last_12_months':
      return `rolling-12m-${y}-${m}-${d}`;
    case 'all_time':
      return 'all_time';
    default:
      return `${y}-${m}`;
  }
}

/**
 * Remaining balance to record when an invoice is marked paid.
 * Uses linked countable payments, not a second copy of amount_paid, so a
 * retry does not create another payment. A $0 invoice records nothing.
 */
export function unpaidBalance(invoice, payments) {
  const total = roundCents(invoiceMoney(invoice));
  if (total <= 0) return 0;
  const linked = (payments || []).filter((payment) => {
    if (!isCountablePayment(payment) || !paymentLinksInvoice(payment, invoice)) return false;
    if (payment.company_id && invoice?.company_id && String(payment.company_id) !== String(invoice.company_id)) return false;
    return true;
  });
  const collected = linked.reduce((sum, payment) => sum + paymentAmount(payment), 0);
  return roundCents(Math.max(0, total - collected));
}

export function buildCommissionLines({
  companyId,
  staffProfiles = [],
  invoices = [],
  payments = [],
  customers = [],
  start = null,
  end = null,
} = {}) {
  const staffByEmail = new Map();
  for (const staff of staffProfiles) {
    if (companyId && !sameCompany(staff, companyId)) continue;
    const rate = resolveCommissionRate(staff);
    if (!(rate > 0) || !staff?.user_email) continue;
    staffByEmail.set(String(staff.user_email).trim().toLowerCase(), { staff, rate });
  }

  const lines = [];
  for (const payment of payments) {
    if (!isCountablePayment(payment)) continue;
    if (companyId && !sameCompany(payment, companyId)) continue;
    if (!inDateRange(payment.payment_date, start, end)) continue;

    const invoice = findInvoiceForPayment(payment, invoices);
    if (invoice && companyId && !sameCompany(invoice, companyId)) continue;
    const customer = findCustomerForInvoice(invoice, payment, customers);
    if (!invoice && customer && companyId && !sameCompany(customer, companyId)) continue;

    const recipients = recipientsForPayment(payment, invoice, customer);
    const amount = paymentAmount(payment);
    for (const recipient of recipients) {
      const match = staffByEmail.get(recipient.email.toLowerCase());
      if (!match) continue;
      const splitPercentage = recipient.splitPercentage;
      const creditedSales = roundCents(amount * (splitPercentage / 100));
      const commission = roundCents(creditedSales * (match.rate / 100));
      lines.push({
        payment,
        invoice,
        staff: match.staff,
        staff_name: match.staff.full_name || match.staff.name || recipient.name || recipient.email,
        staff_email: match.staff.user_email,
        customer_name: payment.customer_name || invoice?.customer_name || customer?.name || '',
        invoice_number: invoice?.invoice_number || payment.invoice_number || '',
        sale_date: payment.payment_date,
        sale_amount: roundCents(amount),
        credited_sales: creditedSales,
        commission_rate: match.rate,
        split_percentage: splitPercentage,
        split_with: recipients
          .filter((other) => !emailsMatch(other.email, recipient.email))
          .map((other) => other.name || other.email)
          .join(', ') || 'None',
        role: recipient.role,
        gross_commission: commission,
        commission,
      });
    }
  }
  return lines;
}

export function calculateRepCommissions({
  companyId,
  staffProfiles = [],
  invoices = [],
  payments = [],
  customers = [],
  deductions = [],
  commissionPayments = [],
  start = null,
  end = null,
  periodKey = null,
} = {}) {
  const lines = buildCommissionLines({
    companyId,
    staffProfiles,
    invoices,
    payments,
    customers,
    start,
    end,
  });

  const byEmail = new Map();
  const ensure = (staff) => {
    const email = staff.user_email;
    const key = String(email).trim().toLowerCase();
    if (!byEmail.has(key)) {
      const rate = resolveCommissionRate(staff);
      byEmail.set(key, {
        name: staff.full_name || staff.name || email,
        email,
        totalSales: 0,
        commissionRate: rate,
        grossCommission: 0,
        splitCommissions: [],
        deductions: [],
        ladderAssistDeductions: [],
        totalLadderAssist: 0,
        totalDeductions: 0,
        netCommission: 0,
        paymentCount: 0,
        payments: [],
        invoices: [],
        invoiceCount: 0,
        isPaid: false,
        paymentDetails: null,
        commission_rate: rate,
        totalCommission: 0,
        deductionCount: 0,
        avatar_url: staff.avatar_url,
        commission_tier: staff.commission_tier,
      });
    }
    return byEmail.get(key);
  };

  for (const staff of staffProfiles) {
    if (companyId && !sameCompany(staff, companyId)) continue;
    if (!(resolveCommissionRate(staff) > 0) || !staff?.user_email) continue;
    ensure(staff);
  }

  for (const line of lines) {
    const row = ensure(line.staff);
    row.totalSales = roundCents(row.totalSales + line.credited_sales);
    row.grossCommission = roundCents(row.grossCommission + line.gross_commission);
    row.totalCommission = row.grossCommission;
    if (!row.payments.some((payment) => payment.id && payment.id === line.payment.id)) {
      row.paymentCount += 1;
      row.payments.push(line.payment);
    }
    if (line.invoice && !row.invoices.some((inv) => inv.id === line.invoice.id)) {
      row.invoices.push(line.invoice);
    }
    if (line.split_percentage !== 100) {
      row.splitCommissions.push({
        invoice: line.invoice_number,
        customer: line.customer_name,
        payment: line.sale_amount,
        splitPercentage: line.split_percentage,
        role: line.role,
        commission: line.gross_commission,
      });
    }
  }

  for (const row of byEmail.values()) {
    const repDeductions = (deductions || []).filter((deduction) => {
      if (companyId && deduction?.company_id && !sameCompany(deduction, companyId)) return false;
      if (!emailsMatch(deductionEmail(deduction), row.email)) return false;
      if (!deduction?.deduction_date) return false;
      return inDateRange(deduction.deduction_date, start, end);
    });
    row.deductions = repDeductions;
    row.deductionCount = repDeductions.length;
    row.ladderAssistDeductions = repDeductions.filter((deduction) => deduction.deduction_type === 'ladder_assist');
    row.totalLadderAssist = roundCents(row.ladderAssistDeductions.reduce((sum, deduction) => sum + Number(deduction.amount || 0), 0));
    row.totalDeductions = roundCents(repDeductions.reduce((sum, deduction) => sum + Number(deduction.amount || 0), 0));
    row.invoiceCount = row.invoices.length || row.paymentCount;

    const manualEntries = (commissionPayments || []).filter((record) => {
      if (!isManualCommissionEntry(record)) return false;
      if (companyId && record?.company_id && !sameCompany(record, companyId)) return false;
      if (!emailsMatch(record?.sales_rep_email || record?.staff_email, row.email)) return false;
      if (String(record?.status || '').toLowerCase() !== 'paid') return false;
      return inDateRange(record?.payment_date, start, end);
    });
    const useManualOnly = row.grossCommission === 0 && manualEntries.length > 0;
    if (useManualOnly) {
      row.grossCommission = roundCents(manualEntries.reduce((sum, record) => sum + Number(record.gross_commission || 0), 0));
      row.totalCommission = row.grossCommission;
      const manualDeductions = roundCents(manualEntries.reduce((sum, record) => sum + Number(record.total_deductions || 0), 0));
      row.totalDeductions = roundCents(row.totalDeductions + manualDeductions);
    }
    row.netCommission = roundCents(row.grossCommission - row.totalDeductions);
    const payout = existingPayout(commissionPayments, { companyId, email: row.email, periodKey });
    row.isPaid = Boolean(payout);
    row.paymentDetails = payout || null;
  }

  return [...byEmail.values()].sort((a, b) => b.netCommission - a.netCommission);
}
