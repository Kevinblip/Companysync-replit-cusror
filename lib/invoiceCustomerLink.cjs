'use strict';

const { normalizePersonName } = require('./invoiceCustomerMatch.cjs');

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

const MISSING_CUSTOMER_ERROR = 'This invoice needs a customer. Choose the customer before creating it.';

async function resolveInvoiceCustomerForCreate(queryable, companyId, data) {
  const company = normalizeId(companyId);
  const requestedId = normalizeId(data?.customer_id);
  const requestedName = String(data?.customer_name || '').trim();
  if (!company) return { ok: false, error: 'Company is required before an invoice can be created.' };

  if (requestedId) {
    const byId = await queryable.query(
      `SELECT id, name, email, base44_id
         FROM customers
        WHERE company_id = $1
          AND (id = $2 OR base44_id = $2)
        LIMIT 2`,
      [company, requestedId],
    );
    if (byId.rowCount === 1) return { ok: true, customer: byId.rows[0] };
    if (byId.rowCount > 1) {
      return { ok: false, error: 'More than one customer matches that id. Choose the customer again before creating this invoice.' };
    }
  }

  if (!requestedName) return { ok: false, error: MISSING_CUSTOMER_ERROR };
  const byName = await queryable.query(
    `SELECT id, name, email
       FROM customers
      WHERE company_id = $1
        AND LOWER(BTRIM(name)) = LOWER(BTRIM($2))
      LIMIT 2`,
    [company, requestedName],
  );
  if (byName.rowCount === 1) return { ok: true, customer: byName.rows[0] };
  if (byName.rowCount > 1) {
    return {
      ok: false,
      error: `More than one customer is named "${requestedName}". Choose the customer by id before creating this invoice.`,
    };
  }
  return {
    ok: false,
    error: `No customer named "${requestedName}" belongs to this company. Choose the customer before creating this invoice.`,
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
    pool.query(
      'SELECT id, company_id, customer_id, customer_name FROM invoices WHERE id = $1 AND company_id = $2 LIMIT 1',
      [id, company],
    ),
    pool.query(
      'SELECT id, company_id, name, email, base44_id FROM customers WHERE id = $1 AND company_id = $2 LIMIT 1',
      [customer, company],
    ),
  ]);
  const invoiceRow = invoiceResult.rows[0];
  const customerRow = customerResult.rows[0];
  if (!invoiceRow) return { status: 404, body: { error: 'Invoice not found in this company.' } };
  if (!customerRow) return { status: 404, body: { error: 'Customer not found in this company.' } };

  const currentId = normalizeId(invoiceRow.customer_id);
  if (currentId && currentId !== normalizeId(customerRow.id) && currentId !== normalizeId(customerRow.base44_id)) {
    const currentCustomer = await pool.query(
      `SELECT id, name, base44_id
         FROM customers
        WHERE company_id = $1
          AND (id = $2 OR base44_id = $2)
        LIMIT 1`,
      [company, currentId],
    );
    const current = currentCustomer.rows[0];
    const invoiceName = normalizePersonName(invoiceRow.customer_name);
    const currentName = normalizePersonName(current?.name);
    if (current && current.id !== customerRow.id && invoiceName && currentName && invoiceName === currentName) {
      return {
        status: 409,
        body: { error: 'This invoice is already linked to the customer named on it. It was not moved.' },
      };
    }
  }

  const customerName = customerRow.name || '';
  const customerEmail = customerRow.email || null;
  // The relationship and tenant checks are repeated in the UPDATE itself so a
  // concurrent edit cannot attach a different or cross-company customer.
  // A blank id, this same customer (including their base44 id), a dangling id,
  // or an id whose customer name does not match the invoice can be replaced.
  // An id that already points at the person named on the invoice cannot.
  const updated = await pool.query(
    `UPDATE invoices
       SET customer_id = $1,
           customer_name = $2,
           customer_email = $3,
           data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
             'customer_id', $1::text,
             'customer_name', $2::text,
             'customer_email', COALESCE($3::text, '')
           ),
           updated_at = NOW()
     WHERE id = $4
       AND company_id = $5
       AND EXISTS (
         SELECT 1 FROM customers c
         WHERE c.id = $1 AND c.company_id = invoices.company_id
       )
       AND (
         NULLIF(BTRIM(customer_id), '') IS NULL
         OR customer_id = $1
         OR customer_id = (
           SELECT base44_id FROM customers
            WHERE id = $1 AND company_id = invoices.company_id
         )
         OR NOT EXISTS (
           SELECT 1 FROM customers cur
            WHERE cur.company_id = invoices.company_id
              AND (cur.id = invoices.customer_id OR cur.base44_id = invoices.customer_id)
         )
         OR EXISTS (
           SELECT 1 FROM customers cur
            WHERE cur.company_id = invoices.company_id
              AND (cur.id = invoices.customer_id OR cur.base44_id = invoices.customer_id)
              AND LOWER(BTRIM(COALESCE(cur.name, '')))
                  IS DISTINCT FROM LOWER(BTRIM(COALESCE(invoices.customer_name, '')))
         )
       )
     RETURNING id, company_id, customer_id, customer_name, customer_email`,
    [customer, customerName, customerEmail, id, company],
  );
  if (!updated.rows[0]) {
    return { status: 409, body: { error: 'The invoice changed before it could be linked. Refresh and try again.' } };
  }
  return { status: 200, body: { success: true, invoice: updated.rows[0] } };
}

module.exports = {
  MISSING_CUSTOMER_ERROR,
  validateInvoiceCustomerReference,
  guardInvoiceCustomerUpdate,
  linkUnassignedInvoice,
  resolveInvoiceCustomerForCreate,
};
