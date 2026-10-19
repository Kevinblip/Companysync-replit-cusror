'use strict';

const EXCLUDED_PAYMENT_STATUSES = new Set(['failed', 'refunded', 'ach_pending', 'void', 'cancelled']);

function value(row, key) {
  return row?.[key] ?? row?.data?.[key] ?? null;
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function paymentCandidates(payment, invoices) {
  const explicitInvoiceId = value(payment, 'invoice_id');
  if (explicitInvoiceId) {
    return invoices.filter(invoice => String(invoice.id) === String(explicitInvoiceId));
  }

  const invoiceNumber = normalized(value(payment, 'invoice_number'));
  const customerId = value(payment, 'customer_id');
  const customerName = normalized(value(payment, 'customer_name'));
  // An identity by itself is not invoice ownership. Legacy allocation always
  // requires the invoice label; customer evidence only disambiguates reused
  // labels within the tenant.
  if (!invoiceNumber) return [];

  return invoices.filter(invoice => {
    if (invoiceNumber && normalized(value(invoice, 'invoice_number')) !== invoiceNumber) return false;
    if (customerId && String(value(invoice, 'customer_id') || '') !== String(customerId)) return false;
    if (!customerId && customerName && normalized(value(invoice, 'customer_name')) !== customerName) return false;
    return true;
  });
}

function allocatePaymentsToInvoices(payments, invoices, { targetInvoiceId = null } = {}) {
  const totals = new Map(invoices.map(invoice => [String(invoice.id), 0]));
  for (const payment of payments) {
    if (!paymentCountsTowardInvoice(payment)) continue;
    const candidates = paymentCandidates(payment, invoices);
    if (candidates.length > 1) {
      if (targetInvoiceId && !candidates.some(invoice => String(invoice.id) === String(targetInvoiceId))) {
        continue;
      }
      const error = new Error(`Payment ${payment.id || 'unknown'} has ambiguous invoice ownership`);
      error.code = 'AMBIGUOUS_PAYMENT_OWNERSHIP';
      throw error;
    }
    if (candidates.length === 1) {
      const invoiceId = String(candidates[0].id);
      totals.set(invoiceId, (totals.get(invoiceId) || 0) + Number(value(payment, 'amount') || 0));
    }
  }
  return totals;
}

function nextInvoiceStatus(invoice, totalPaid) {
  const current = normalized(value(invoice, 'status'));
  const invoiceAmount = Number(
    value(invoice, 'total_amount')
    || value(invoice, 'amount')
    || 0
  );
  if (totalPaid <= 0) {
    return ['draft', 'sent', 'viewed', 'overdue', 'cancelled'].includes(current) ? current : 'sent';
  }
  if (invoiceAmount > 0 && totalPaid >= invoiceAmount) return 'paid';
  return 'partially_paid';
}

async function recalculateInvoicePaymentsInTransaction(client, {
  companyId,
  invoiceId,
  invoiceNumber,
  lockInvoice = true,
}) {
  if (!companyId) throw new Error('companyId required');
  if (!invoiceId && !invoiceNumber) throw new Error('invoice_id or invoice_number required');

  const selected = await client.query(
    `SELECT * FROM invoices
     WHERE company_id = $1
       AND (($2::text IS NOT NULL AND id = $2)
         OR ($2::text IS NULL AND invoice_number = $3))
     ORDER BY id
     ${lockInvoice ? 'FOR UPDATE' : ''}`,
    [companyId, invoiceId || null, invoiceNumber || null]
  );
  if (!selected.rowCount) throw new Error('Invoice not found');
  if (!invoiceId && selected.rowCount !== 1) {
    const error = new Error('Invoice number is ambiguous for this company');
    error.code = 'AMBIGUOUS_INVOICE_OWNERSHIP';
    throw error;
  }
  const invoice = selected.rows[0];

  // Legacy payments can contain only an invoice number or customer identity.
  // Resolve them against the complete tenant invoice set; never silently omit
  // a payment merely because the modern invoice_id column is empty.
  const invoices = (await client.query(
    `SELECT * FROM invoices WHERE company_id = $1 ORDER BY id ${lockInvoice ? 'FOR UPDATE' : ''}`,
    [companyId]
  )).rows;
  const payments = (await client.query(
    `SELECT * FROM payments WHERE company_id = $1 ORDER BY id ${lockInvoice ? 'FOR UPDATE' : ''}`,
    [companyId]
  )).rows;
  const totals = allocatePaymentsToInvoices(payments, invoices, { targetInvoiceId: invoice.id });
  const totalPaid = Math.round((totals.get(String(invoice.id)) || 0) * 100) / 100;
  const status = nextInvoiceStatus(invoice, totalPaid);

  await client.query(
    `UPDATE invoices
     SET amount_paid = $1, status = $2, updated_at = NOW()
     WHERE id = $3 AND company_id = $4`,
    [totalPaid, status, invoice.id, companyId]
  );
  return {
    success: true,
    amount_paid: totalPaid,
    previous_status: value(invoice, 'status'),
    status,
  };
}

function paymentCountsTowardInvoice(payment) {
  return !EXCLUDED_PAYMENT_STATUSES.has(normalized(value(payment, 'status')));
}

module.exports = {
  allocatePaymentsToInvoices,
  nextInvoiceStatus,
  paymentCandidates,
  paymentCountsTowardInvoice,
  recalculateInvoicePaymentsInTransaction,
};