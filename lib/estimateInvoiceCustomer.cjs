'use strict';

/**
 * Which customer an invoice created from an estimate belongs to.
 *
 * convertEstimateToInvoice used to copy estimate.customer_id only when it was
 * the customer's primary id. An estimate written against a lead, typed by
 * name, or holding the customer's base44_id produced an invoice with a blank
 * customer_id. The invoice showed "Link customer" and never reached the
 * customer's profile (INV-2026-0446, Greg Curry).
 *
 * Resolution order, all inside the estimate's company:
 *   1. estimate.customer_id matches a customer's id or base44_id
 *   2. exactly one customer has the estimate's (or its lead's) email
 *   3. exactly one customer has the estimate's (or its lead's) exact name
 *      (case and spacing ignored); when several do, email narrows it
 * Anything ambiguous stays unlinked. A different person is never guessed.
 */

function norm(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function ids(customer) {
  return [customer?.id, customer?.base44_id].map((v) => String(v || '').trim()).filter(Boolean);
}

function sameCompany(customer, companyId) {
  return !companyId || !customer?.company_id || String(customer.company_id) === String(companyId);
}

function resolveEstimateInvoiceCustomer({ estimate, lead = null, customers = [] } = {}) {
  const companyId = estimate?.company_id;
  const pool = (customers || []).filter((c) => c && sameCompany(c, companyId));

  const storedId = String(estimate?.customer_id || '').trim();
  if (storedId) {
    const byId = pool.filter((c) => ids(c).includes(storedId));
    if (byId.length === 1) return { customer: byId[0], via: 'customer_id', reason: null };
    if (byId.length > 1) return { customer: null, via: null, reason: 'ambiguous-id' };
  }

  const emails = [...new Set([estimate?.customer_email, lead?.email].map(normEmail).filter(Boolean))];
  const names = [...new Set([estimate?.customer_name, lead?.name].map(norm).filter(Boolean))];

  for (const email of emails) {
    const byEmail = pool.filter((c) => normEmail(c.email) === email);
    if (byEmail.length === 1) return { customer: byEmail[0], via: 'email', reason: null };
  }

  for (const name of names) {
    const byName = pool.filter((c) => norm(c.name) === name);
    if (byName.length === 1) return { customer: byName[0], via: 'name', reason: null };
    if (byName.length > 1 && emails.length) {
      const narrowed = byName.filter((c) => emails.includes(normEmail(c.email)));
      if (narrowed.length === 1) return { customer: narrowed[0], via: 'name+email', reason: null };
    }
    if (byName.length > 1) return { customer: null, via: null, reason: 'ambiguous-name' };
  }

  return { customer: null, via: null, reason: 'no-match' };
}

/**
 * Candidate customers for one estimate, in one query. The caller runs the
 * pure resolver above on the rows. $1 company_id, $2 customer_id,
 * $3 emails (text[]), $4 normalized names (text[]).
 */
const ESTIMATE_CUSTOMER_CANDIDATES_SQL = `
SELECT id, base44_id, company_id, name, email
  FROM customers
 WHERE company_id = $1
   AND (
     ($2::text <> '' AND (id = $2 OR base44_id = $2))
     OR (cardinality($3::text[]) > 0 AND LOWER(BTRIM(COALESCE(email, ''))) = ANY($3::text[]))
     OR (cardinality($4::text[]) > 0
         AND LOWER(BTRIM(regexp_replace(COALESCE(name, ''), '[[:space:]]+', ' ', 'g'))) = ANY($4::text[]))
   )
 LIMIT 50
`.trim();

function candidateQueryParams({ estimate, lead = null } = {}) {
  return [
    String(estimate?.company_id || ''),
    String(estimate?.customer_id || '').trim(),
    [...new Set([estimate?.customer_email, lead?.email].map(normEmail).filter(Boolean))],
    [...new Set([estimate?.customer_name, lead?.name].map(norm).filter(Boolean))],
  ];
}

/**
 * Read-only: invoices with a blank customer_id that were created from an
 * estimate, with the estimate's own customer/lead link. Used by
 * scripts/list-unlinked-estimate-invoices.cjs. Never updates a row.
 */
const UNLINKED_ESTIMATE_INVOICES_SQL = `
SELECT i.id,
       i.company_id,
       i.invoice_number,
       i.customer_name,
       i.customer_email,
       i.data->>'estimate_id' AS estimate_id,
       e.estimate_number,
       e.customer_id AS estimate_customer_id,
       e.customer_name AS estimate_customer_name,
       e.customer_email AS estimate_customer_email,
       COALESCE(NULLIF(e.lead_id, ''), e.data->>'lead_id') AS estimate_lead_id
  FROM invoices i
  JOIN estimates e
    ON e.id = i.data->>'estimate_id'
   AND e.company_id = i.company_id
 WHERE NULLIF(BTRIM(COALESCE(i.customer_id, '')), '') IS NULL
 ORDER BY i.company_id, i.invoice_number NULLS LAST, i.id
`.trim();

module.exports = {
  ESTIMATE_CUSTOMER_CANDIDATES_SQL,
  UNLINKED_ESTIMATE_INVOICES_SQL,
  candidateQueryParams,
  resolveEstimateInvoiceCustomer,
};
