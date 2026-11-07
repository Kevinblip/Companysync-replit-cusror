/**
 * Deciding which customer a payment belongs to.
 *
 * Background — why this file exists:
 * `invoice_number` is a human-entered/generated string and has never been unique.
 * Production has carried multiple invoices sharing one number (e.g. two unrelated
 * customers both on "INV-2026-0385"). The customer profile used to claim payments
 * by matching that number, and an auto-reconcile step then rewrote the payment's
 * customer_id to whoever's profile had just been opened. Two customers sharing a
 * number would take turns stealing each other's payments on every page view.
 *
 * `invoice_id` IS unique, and it points at the invoice whose balance the payment
 * actually moved, so it is the authority here.
 *
 * Guiding rule: only ever EXCLUDE a payment when we can positively confirm its
 * invoice belongs to somebody else. Never exclude because a lookup failed — a
 * hidden payment is worse than a stray one, because nobody goes looking for it.
 */

/** Case/whitespace-insensitive name comparison. Empty values never match. */
export function sameName(a, b) {
  if (!a || !b) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Preserve payer identity separately from the customer whose invoice receives credit. */
export function getPaymentPayerDetails(payment) {
  if (!payment) return { name: '', email: '' };
  return {
    name: String(payment.payer_name || payment.paid_by_name || '').trim(),
    // customer_email identifies the invoice recipient, not who actually paid.
    // Never display it as payer evidence when payer_email was not recorded.
    email: String(payment.payer_email || payment.paid_by_email || '').trim(),
  };
}

/** A differing payer email is a review signal, not proof the payment is misfiled. */
export function paymentPayerDiffersFromCustomer(payment, customer) {
  const payerEmail = getPaymentPayerDetails(payment).email.toLowerCase();
  const customerEmail = String(customer?.email || '').trim().toLowerCase();
  return !!payerEmail && !!customerEmail && payerEmail !== customerEmail;
}

/**
 * Invoice ids referenced by these payments that aren't already known to be this
 * customer's — the set worth looking up before trusting a number match.
 */
export function findUnknownInvoiceIds(payments, myInvoiceIds) {
  const mine = myInvoiceIds instanceof Set ? myInvoiceIds : new Set(myInvoiceIds || []);
  const unknown = new Set();
  for (const p of payments || []) {
    if (p && p.invoice_id && !mine.has(p.invoice_id)) unknown.add(p.invoice_id);
  }
  return [...unknown];
}

/**
 * Given invoices we looked up, which ids demonstrably belong to a different
 * customer. Invoices we couldn't resolve are deliberately NOT included.
 */
export function findForeignInvoiceIds(lookedUpInvoices, { customerId, customerName, customerIds } = {}) {
  const accepted = new Set(
    [customerId, ...(customerIds || [])]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const foreign = new Set();
  for (const inv of lookedUpInvoices || []) {
    if (!inv || !inv.id) continue;

    const invCustomerId = inv.customer_id || null;
    const invCustomerName = inv.customer_name && String(inv.customer_name).trim()
      ? inv.customer_name
      : null;

    // The invoice carries no owner at all. That is unknown, not proof it belongs
    // to somebody else — leave the payment visible.
    if (!invCustomerId && !invCustomerName) continue;

    // An explicit customer_id is the invoice's own answer about who owns it, and
    // a name match must not override it (duplicate customer names are real in
    // this data — several people share a name across two customer records).
    // customerIds includes aliases such as base44_id for the same record.
    if (invCustomerId && accepted.size > 0) {
      if (!accepted.has(String(invCustomerId))) foreign.add(inv.id);
      continue;
    }

    // Fall back to the name only when there is no id to go on.
    if (invCustomerName && !sameName(invCustomerName, customerName)) foreign.add(inv.id);
  }
  return foreign;
}

/** Drop payments confirmed to sit on another customer's invoice. */
export function rejectForeignPayments(payments, foreignInvoiceIds) {
  const foreign = foreignInvoiceIds instanceof Set
    ? foreignInvoiceIds
    : new Set(foreignInvoiceIds || []);
  if (foreign.size === 0) return [...(payments || [])];
  return (payments || []).filter(p => !(p && p.invoice_id && foreign.has(p.invoice_id)));
}

/**
 * Does this payment belong to this invoice?
 *
 * `invoice_id` is definitive: when a payment carries one, an invoice that isn't
 * that id is not a match, no matter how the numbers line up. The number is only
 * a fallback for legacy payments that were never linked to an id — and because
 * numbers are not unique, that fallback can still be wrong. Never let it
 * override an id that says otherwise; that is how one rep's payment starts
 * paying another rep's commission.
 */
function rowData(row) {
  const raw = row?.data;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  }
  return {};
}

function trimmedIds(...values) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

export function paymentInvoiceIds(payment) {
  const data = rowData(payment);
  return trimmedIds(payment?.invoice_id, data.invoice_id);
}

export function invoiceIdentityIds(invoice) {
  const data = rowData(invoice);
  return trimmedIds(invoice?.id, invoice?.base44_id, data.id, data.base44_id);
}

/**
 * Payments History on an invoice.
 *
 * An invoice id match wins, including the invoice's base44 id and an id that
 * lives only in payments.data. A blank customer_id does not hide that payment.
 * With no invoice id at all, the invoice number counts only when the customer
 * id matches or, if the payment has no customer id, the customer name matches.
 * A number shared with a different customer stays off this invoice.
 */
export function paymentListedOnInvoice(payment, invoice, customer = null) {
  if (!payment || !invoice?.id) return false;
  const invoiceIds = new Set(invoiceIdentityIds(invoice));
  const linkedIds = paymentInvoiceIds(payment);
  if (linkedIds.length > 0) return linkedIds.some((id) => invoiceIds.has(id));

  const data = rowData(payment);
  const paymentNumber = String(payment.invoice_number || data.invoice_number || '').trim();
  const invoiceNumber = String(invoice.invoice_number || '').trim();
  if (!paymentNumber || !invoiceNumber || paymentNumber.toLowerCase() !== invoiceNumber.toLowerCase()) {
    return false;
  }

  const paymentCustomerId = String(payment.customer_id || data.customer_id || '').trim();
  const acceptedCustomerIds = new Set(trimmedIds(
    invoice.customer_id,
    rowData(invoice).customer_id,
    customer?.id,
    customer?.base44_id,
  ));
  if (paymentCustomerId) return acceptedCustomerIds.has(paymentCustomerId);

  return sameName(
    payment.customer_name || data.customer_name,
    invoice.customer_name || customer?.name,
  );
}

export function matchesInvoice(payment, invoice) {
  if (!payment || !invoice) return false;
  if (paymentInvoiceIds(payment).length > 0) return paymentListedOnInvoice(payment, invoice);
  return !!payment.invoice_number && payment.invoice_number === invoice.invoice_number;
}

/**
 * Build a matcher that additionally refuses the invoice_number fallback whenever
 * that number is shared by more than one invoice in `allInvoices`.
 *
 * Use this anywhere money is being totalled or commission attributed. A legacy
 * payment with no invoice_id and a duplicated number would otherwise be counted
 * once for each invoice that happens to carry the number — paying two reps for
 * the same dollar. Leaving it unallocated is the honest outcome; someone can
 * link it to a real invoice and it starts counting again.
 */
export function makeInvoiceMatcher(allInvoices) {
  const counts = new Map();
  for (const inv of allInvoices || []) {
    const num = (inv?.invoice_number || '').trim();
    if (!num) continue;
    counts.set(num, (counts.get(num) || 0) + 1);
  }
  return function matcher(payment, invoice) {
    if (!payment || !invoice) return false;
    if (payment.invoice_id) return payment.invoice_id === invoice.id;
    const num = (payment.invoice_number || '').trim();
    if (!num) return false;
    if ((counts.get(num) || 0) > 1) return false; // ambiguous — leave unallocated
    return num === (invoice.invoice_number || '').trim();
  };
}

/**
 * Choose which invoice a payment is actually being recorded against, from the
 * candidates that share the invoice number the user picked.
 *
 * With one candidate this is trivial. With several — which happens, because
 * numbers are not unique — guessing is how a payment lands on a stranger's
 * invoice, so we narrow by customer and refuse to guess if that isn't decisive.
 *
 * Returns { invoice, ambiguous }. `ambiguous: true` means the caller must stop
 * and make a human choose rather than silently picking the first row.
 */
export function pickInvoiceForPayment(candidates, { customerName, customerId } = {}) {
  const list = (candidates || []).filter(Boolean);
  if (list.length === 0) return { invoice: null, ambiguous: false, candidateCount: 0 };
  if (list.length === 1) return { invoice: list[0], ambiguous: false, candidateCount: 1 };

  const byId = customerId ? list.filter(inv => inv.customer_id && inv.customer_id === customerId) : [];
  if (byId.length === 1) return { invoice: byId[0], ambiguous: false, candidateCount: 1 };

  const pool = byId.length > 1 ? byId : list;
  const byName = pool.filter(inv => sameName(inv.customer_name, customerName));
  if (byName.length === 1) return { invoice: byName[0], ambiguous: false, candidateCount: 1 };

  return { invoice: null, ambiguous: true, candidateCount: (byName.length || pool.length) };
}

/**
 * Which payments should have their customer_id repaired to point at this customer.
 *
 * Claim a payment only when:
 *  - it is applied to one of THIS customer's invoices (invoice_id is authoritative,
 *    and this is what repairs rows an earlier build mis-stamped); or
 *  - it is a genuine orphan (no customer_id at all) whose recorded name matches.
 *
 * A payment already owned by another customer is never taken on a name or
 * invoice-number match.
 */
export function selectPaymentsToRelink(payments, { customerId, customerName, myInvoiceIds }) {
  const mine = myInvoiceIds instanceof Set ? myInvoiceIds : new Set(myInvoiceIds || []);
  return (payments || []).filter(p => {
    if (!p) return false;
    if (p.customer_id === customerId) return false;
    if (p.invoice_id && mine.has(p.invoice_id)) {
      // Already attributed to a customer record with this same name. Duplicate
      // customer rows for one person exist in this data, and re-stamping between
      // them on every page view is pointless write churn that never settles.
      if (p.customer_id && sameName(p.customer_name, customerName)) return false;
      return true;
    }
    if (p.customer_id) return false;
    return sameName(p.customer_name, customerName);
  });
}
