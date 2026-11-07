'use strict';

/**
 * Pure invoice-to-customer matching.
 *
 * The customer profile used to load invoices with
 * Invoice.filter({ customer_id: customer.id }). An invoice whose customer_id
 * was blank, or stored the customer's other id, never appeared — and the
 * Payments tab, which follows those invoices, hid the payments too.
 *
 * A non-empty customer_id that points at a different person is never pulled
 * in by name. Duplicate names are real in this data.
 */

function normalizePersonName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function customerIdentityIds(customer) {
  return [customer?.id, customer?.base44_id]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function invoiceCustomerId(invoice) {
  return String(invoice?.customer_id || '').trim();
}

function sameCompany(invoice, customer) {
  if (!invoice?.company_id || !customer?.company_id) return true;
  return String(invoice.company_id) === String(customer.company_id);
}

function invoiceEstimateId(invoice) {
  return String(invoice?.estimate_id || invoice?.data?.estimate_id || '').trim();
}

/**
 * options.estimateIds: ids of the estimates shown on this customer's profile.
 * An invoice with a blank customer_id that was created from one of them
 * belongs here too, even when its stored name was typed differently.
 */
function invoiceMatchesCustomer(invoice, customer, options = {}) {
  if (!invoice || !customer?.id) return false;
  if (!sameCompany(invoice, customer)) return false;
  const ids = new Set(customerIdentityIds(customer));
  const storedId = invoiceCustomerId(invoice);
  if (storedId && ids.has(storedId)) return true;
  if (storedId) return false;
  const estimateId = invoiceEstimateId(invoice);
  if (estimateId && options.estimateIds && new Set([...options.estimateIds].map(String)).has(estimateId)) {
    return true;
  }
  const invoiceName = normalizePersonName(invoice.customer_name);
  const customerName = normalizePersonName(customer.name);
  return Boolean(invoiceName) && invoiceName === customerName;
}

function getInvoicesForCustomerProfile(invoices, customer, options = {}) {
  if (!customer?.id) return [];
  const seen = new Set();
  const matches = [];
  for (const invoice of invoices || []) {
    if (!invoice || seen.has(invoice.id)) continue;
    if (!invoiceMatchesCustomer(invoice, customer, options)) continue;
    seen.add(invoice.id);
    matches.push(invoice);
  }
  return matches;
}

function findCustomerByIdentity(customers, customerId, companyId) {
  const id = String(customerId || '').trim();
  if (!id) return null;
  return (customers || []).find((customer) => {
    if (companyId && customer?.company_id && String(customer.company_id) !== String(companyId)) return false;
    return customerIdentityIds(customer).includes(id);
  }) || null;
}

/**
 * missing: no customer_id.
 * mismatched: customer_id does not resolve to a customer in this company,
 * or it resolves to a customer whose name is not the invoice name.
 * null: the invoice is linked to the named customer (id or base44_id).
 */
function invoiceLinkProblem(invoice, customers) {
  const storedId = invoiceCustomerId(invoice);
  if (!storedId) return 'missing';
  if (!Array.isArray(customers) || customers.length === 0) return null;
  const match = findCustomerByIdentity(customers, storedId, invoice?.company_id);
  if (!match) return 'mismatched';
  const invoiceName = normalizePersonName(invoice?.customer_name);
  const customerName = normalizePersonName(match.name);
  if (invoiceName && customerName && invoiceName !== customerName) return 'mismatched';
  return null;
}

function invoiceNeedsCustomerLink(invoice, customers) {
  return invoiceLinkProblem(invoice, customers) !== null;
}

function exactNameCandidates(invoice, customers) {
  const invoiceName = normalizePersonName(invoice?.customer_name);
  if (!invoiceName) return [];
  return (customers || []).filter((customer) => {
    if (invoice?.company_id && customer?.company_id && String(customer.company_id) !== String(invoice.company_id)) {
      return false;
    }
    return normalizePersonName(customer?.name) === invoiceName;
  });
}

function classifyInvoiceCustomerLink(invoice, customers) {
  const problem = invoiceLinkProblem(invoice, customers);
  if (!problem) return null;
  const candidates = exactNameCandidates(invoice, customers);
  const proposal = candidates.length === 1
    ? {
      customer_id: candidates[0].id,
      customer_name: candidates[0].name || '',
      customer_email: candidates[0].email || '',
    }
    : null;
  return {
    invoice_id: invoice?.id || null,
    invoice_number: invoice?.invoice_number || '',
    customer_id: invoiceCustomerId(invoice),
    customer_name: String(invoice?.customer_name || '').trim(),
    problem,
    proposal_status: candidates.length === 1 ? 'exact-name' : candidates.length === 0 ? 'none' : 'ambiguous',
    candidate_count: candidates.length,
    proposal,
  };
}

function resolveUniqueCustomer(customers, { customerId, customerName, companyId } = {}) {
  const list = (customers || []).filter((customer) =>
    !companyId || !customer?.company_id || String(customer.company_id) === String(companyId)
  );
  const storedId = String(customerId || '').trim();
  if (storedId) {
    const byId = list.filter((customer) => customerIdentityIds(customer).includes(storedId));
    if (byId.length === 1) return { customer: byId[0], reason: null };
    if (byId.length > 1) return { customer: null, reason: 'ambiguous' };
  }
  const name = normalizePersonName(customerName);
  if (!name) return { customer: null, reason: 'missing' };
  const byName = list.filter((customer) => normalizePersonName(customer.name) === name);
  if (byName.length === 1) return { customer: byName[0], reason: null };
  if (byName.length > 1) return { customer: null, reason: 'ambiguous' };
  return { customer: null, reason: 'missing' };
}

const INVOICE_CUSTOMER_MISMATCH_SQL = `
WITH company_customers AS (
  SELECT id,
         company_id,
         name,
         email,
         base44_id,
         LOWER(BTRIM(regexp_replace(COALESCE(name, ''), '[[:space:]]+', ' ', 'g'))) AS norm_name
    FROM customers
),
invoice_rows AS (
  SELECT i.id,
         i.company_id,
         i.invoice_number,
         NULLIF(BTRIM(i.customer_id), '') AS customer_id,
         NULLIF(BTRIM(i.customer_name), '') AS customer_name,
         LOWER(BTRIM(regexp_replace(COALESCE(i.customer_name, ''), '[[:space:]]+', ' ', 'g'))) AS norm_name
    FROM invoices i
),
linked AS (
  SELECT r.id,
         r.company_id,
         r.invoice_number,
         r.customer_id,
         r.customer_name,
         r.norm_name,
         c.id AS matched_customer_id,
         c.name AS matched_customer_name
    FROM invoice_rows r
    LEFT JOIN company_customers c
      ON c.company_id = r.company_id
     AND r.customer_id IS NOT NULL
     AND (c.id = r.customer_id OR (c.base44_id IS NOT NULL AND c.base44_id = r.customer_id))
),
problems AS (
  SELECT *
    FROM linked
   WHERE customer_id IS NULL
      OR matched_customer_id IS NULL
      OR (
        norm_name <> ''
        AND LOWER(BTRIM(regexp_replace(COALESCE(matched_customer_name, ''), '[[:space:]]+', ' ', 'g')))
            IS DISTINCT FROM norm_name
      )
)
SELECT p.id,
       p.company_id,
       p.invoice_number,
       p.customer_id,
       p.customer_name,
       CASE WHEN p.customer_id IS NULL THEN 'missing' ELSE 'mismatched' END AS problem,
       prop.proposal_count,
       prop.proposal_customer_id,
       prop.proposal_customer_name,
       prop.proposal_customer_email
  FROM problems p
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS proposal_count,
           CASE WHEN COUNT(*) = 1 THEN MIN(c.id) END AS proposal_customer_id,
           CASE WHEN COUNT(*) = 1 THEN MIN(c.name) END AS proposal_customer_name,
           CASE WHEN COUNT(*) = 1 THEN MIN(c.email) END AS proposal_customer_email
      FROM company_customers c
     WHERE c.company_id = p.company_id
       AND p.norm_name <> ''
       AND c.norm_name = p.norm_name
  ) prop ON TRUE
 ORDER BY p.company_id, p.invoice_number NULLS LAST, p.id;
`.trim();

module.exports = {
  INVOICE_CUSTOMER_MISMATCH_SQL,
  classifyInvoiceCustomerLink,
  customerIdentityIds,
  exactNameCandidates,
  findCustomerByIdentity,
  getInvoicesForCustomerProfile,
  invoiceCustomerId,
  invoiceEstimateId,
  invoiceLinkProblem,
  invoiceMatchesCustomer,
  invoiceNeedsCustomerLink,
  normalizePersonName,
  resolveUniqueCustomer,
};
