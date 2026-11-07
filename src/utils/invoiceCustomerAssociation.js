export function getCompanyCustomerById(customers, customerId, companyId) {
  if (!customerId) return null;
  return (customers || []).find((customer) =>
    String(customer.id) === String(customerId) &&
    (!companyId || String(customer.company_id) === String(companyId))
  ) || null;
}

export function selectInvoiceCustomer(customer) {
  if (!customer?.id) {
    return { customer_id: '', customer_name: '', customer_email: '' };
  }
  return {
    customer_id: customer.id,
    customer_name: customer.name || '',
    customer_email: customer.email || '',
  };
}

export function changeInvoiceCustomerName(form, customerName) {
  const next = { ...form, customer_name: customerName };
  if (form?.customer_id) {
    next.customer_id = '';
    next.customer_email = '';
    next.amount = '';
    next.items = [];
  }
  return next;
}

export function getInvoicesForCustomerId(invoices, customerId) {
  if (!customerId) return [];
  return (invoices || []).filter((invoice) =>
    String(invoice.customer_id || '') === String(customerId)
  );
}

export function isInvoiceUnlinked(invoice) {
  return !String(invoice?.customer_id || '').trim();
}

export {
  classifyInvoiceCustomerLink,
  customerIdentityIds,
  getInvoicesForCustomerProfile,
  invoiceLinkProblem,
  invoiceMatchesCustomer,
  invoiceNeedsCustomerLink,
  normalizePersonName,
  resolveUniqueCustomer,
} from '../../lib/invoiceCustomerMatch.cjs';
