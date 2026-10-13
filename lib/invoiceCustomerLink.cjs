'use strict';

function normalizeId(value) {
  return value == null ? '' : String(value).trim();
}

function asDataObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  }
  return {};
}

function invoiceCustomerId(invoice) {
  const directId = normalizeId(invoice?.customer_id);
  if (directId) return directId;
  return normalizeId(asDataObject(invoice?.data).customer_id);
}

async function validateInvoiceCustomerReference(pool, entityType, invoice, routeLabel = '') {
  const customerId = invoiceCustomerId(invoice);
  if (entityType !== 'invoices' || !invoice || !customerId) {
    return { blocked: false };
  }

  const companyId = normalizeId(invoice.company_id) ||
    normalizeId(asDataObject(invoice.data).company_id);
  if (!companyId) {
    return {
      blocked: true,
      reason: 'An invoice customer must belong to the invoice company.',
    };
  }

  const customer = await pool.query(
    'SELECT id FROM customers WHERE id = $1 AND company_id = $2 LIMIT 1',
    [customerId, companyId],
  );
  if (customer.rows.length === 0) {
    console.warn(`[invoiceCustomerLink] blocked customer reference at ${routeLabel || 'invoice write'}`);
    return {
      blocked: true,
      reason: 'The selected customer does not belong to this company.',
    };
  }
  return { blocked: false };
}

function guardInvoiceCustomerUpdate(entityType, existing, body) {
  if (entityType !== 'invoices' || !existing) {
    return { blocked: false };
  }
  const incomingData = asDataObject(body?.data);
  const hasDirectId = Object.prototype.hasOwnProperty.call(body || {}, 'customer_id');
  const hasNestedId = Object.prototype.hasOwnProperty.call(incomingData, 'customer_id');
  if (!hasDirectId && !hasNestedId) return { blocked: false };

  const existingId = invoiceCustomerId(existing);
  const requestedIds = [
    ...(hasDirectId ? [normalizeId(body.customer_id)] : []),
    ...(hasNestedId ? [normalizeId(incomingData.customer_id)] : []),
  ];
  if (requestedIds.every((requestedId) => requestedId === existingId)) {
    return { blocked: false };
  }
  return {
    blocked: true,
    reason: 'Invoice customer changes must use the confirmed customer-link action.',
  };
}

async function linkUnassignedInvoice({ pool, ctx, invoiceId, customerId, companyId, confirmed }) {
  const id = normalizeId(invoiceId);
  const customer = normalizeId(customerId);
  const company = normalizeId(companyId);
  if (!ctx?.authenticated) return { status: 401, body: { error: 'Unauthorized' } };
  if (ctx.isImpersonating) {
    return { status: 403, body: { error: 'Invoice customers cannot be changed during an impersonation session.' } };
  }
  if (!id || !customer || !company) {
    return { status: 400, body: { error: 'Invoice, customer, and company are required.' } };
  }
  if (confirmed !== true) {
    return { status: 400, body: { error: 'Explicit confirmation is required to link this invoice.' } };
  }

  const companyResult = await pool.query(
    'SELECT id, created_by FROM companies WHERE id = $1 LIMIT 1',
    [company],
  );
  const companyRow = companyResult.rows[0];
  if (!companyRow) return { status: 404, body: { error: 'Company not found.' } };

  const email = String(ctx.email || '').trim().toLowerCase();
  const isOwner = Boolean(companyRow.created_by) &&
    String(companyRow.created_by).trim().toLowerCase() === email;
  const isPlatformAdmin = ctx.platformRole === 'super_admin';
  const isCompanyAdmin = ctx.administratorCompanyIds instanceof Set &&
    ctx.administratorCompanyIds.has(company);
  if (!isOwner && !isPlatformAdmin && !isCompanyAdmin) {
    return { status: 403, body: { error: 'Only a company administrator can link an invoice to a customer.' } };
  }

  const [invoiceResult, customerResult] = await Promise.all([
    pool.query('SELECT id, company_id, customer_id FROM invoices WHERE id = $1 AND company_id = $2 LIMIT 1', [id, company]),
    pool.query('SELECT id, company_id FROM customers WHERE id = $1 AND company_id = $2 LIMIT 1', [customer, company]),
  ]);
  if (!invoiceResult.rows[0]) return { status: 404, body: { error: 'Invoice not found in this company.' } };
  if (!customerResult.rows[0]) return { status: 404, body: { error: 'Customer not found in this company.' } };
  if (normalizeId(invoiceResult.rows[0].customer_id)) {
    return { status: 409, body: { error: 'This invoice is already linked to a customer.' } };
  }

  // The relationship and tenant checks are repeated in the UPDATE itself so a
  // concurrent edit cannot attach a different or cross-company customer.
  const updated = await pool.query(
    `UPDATE invoices
       SET customer_id = $1,
           data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('customer_id', $1),
           updated_at = NOW()
     WHERE id = $2
       AND company_id = $3
       AND NULLIF(BTRIM(customer_id), '') IS NULL
       AND EXISTS (
         SELECT 1 FROM customers c
         WHERE c.id = $1 AND c.company_id = invoices.company_id
       )
     RETURNING id, company_id, customer_id`,
    [customer, id, company],
  );
  if (!updated.rows[0]) {
    return { status: 409, body: { error: 'The invoice changed before it could be linked. Refresh and try again.' } };
  }
  return { status: 200, body: { success: true, invoice: updated.rows[0] } };
}

module.exports = {
  validateInvoiceCustomerReference,
  guardInvoiceCustomerUpdate,
  linkUnassignedInvoice,
};
