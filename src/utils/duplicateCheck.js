const OPEN_ESTIMATE_STATUSES = ['draft', 'sent', 'viewed', 'pending'];
const UNPAID_INVOICE_STATUSES = ['draft', 'sent', 'amount_due', 'partially_paid', 'overdue'];

/**
 * Normalize a name for fuzzy comparison.
 * Handles "LAST, FIRST", "First Last", ALL-CAPS, mixed case, etc.
 * Strips commas, lowercases, and sorts name parts so
 * "Betty Davis" == "DAVIS, BETTY" == "davis betty".
 */
export function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * Returns customers whose normalized name matches the given name.
 * Pass excludeId to skip the record being edited (avoids self-match).
 */
export function findSimilarCustomers(customers, name, excludeId = null) {
  if (!name || name.trim().length < 2) return [];
  const norm = normalizeName(name);
  return customers.filter(c => {
    if (excludeId && c.id === excludeId) return false;
    return normalizeName(c.name) === norm;
  });
}

export function findOpenEstimatesForCustomer(estimates, customerId, customerName) {
  if (!customerId && !customerName) return [];
  const normInput = normalizeName(customerName);
  return estimates.filter(e => {
    if (!OPEN_ESTIMATE_STATUSES.includes(e.status)) return false;
    if (customerId && e.customer_id === customerId) return true;
    if (customerName) {
      return normalizeName(e.customer_name) === normInput;
    }
    return false;
  });
}

/**
 * Returns invoices that already use the given claim_number (case/space-insensitive).
 * Used to warn before creating a second invoice against the same insurance claim —
 * a common duplicate source when multiple staff work one claim.
 * Pass excludeId to skip the invoice being edited.
 */
export function findInvoicesByClaimNumber(invoices, claimNumber, excludeId = null) {
  if (!claimNumber || !String(claimNumber).trim()) return [];
  const normClaim = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  const norm = normClaim(claimNumber);
  if (!norm) return [];
  return (invoices || []).filter(inv => {
    if (excludeId && inv.id === excludeId) return false;
    if (!inv.claim_number) return false;
    return normClaim(inv.claim_number) === norm;
  });
}

export function findUnpaidInvoicesForCustomer(invoices, customerName, customerId) {
  if (!customerName && !customerId) return [];
  const normInput = normalizeName(customerName);
  return invoices.filter(inv => {
    if (!UNPAID_INVOICE_STATUSES.includes(inv.status)) return false;
    if (customerId) {
      if (String(inv.customer_id || '') === String(customerId)) return true;
      // Keep old unlinked invoices visible as possible duplicate warnings, but
      // never pull in another customer's linked invoice just because the names match.
      return !inv.customer_id && !!customerName && normalizeName(inv.customer_name) === normInput;
    }
    if (customerName) {
      return normalizeName(inv.customer_name) === normInput;
    }
    return false;
  });
}
