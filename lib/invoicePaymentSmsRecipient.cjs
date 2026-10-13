'use strict';

// A customer payment text must not inherit staff notification quiet hours just
// because its destination also happens to be on a staff profile. Only a
// company-owned invoice's customer number qualifies for that exemption.
async function assertInvoiceCustomerSmsRecipient(pool, companyId, invoiceId, phone) {
  if (!companyId || !invoiceId) throw new Error('Invoice and company are required for a payment text.');
  const { rows } = await pool.query(
    `SELECT i.data, c.phone AS linked_phone, c.phone_2 AS linked_phone_2
       FROM invoices i
       LEFT JOIN customers c ON (c.id = i.customer_id OR c.base44_id = i.customer_id)
                            AND c.company_id = i.company_id
      WHERE i.id = $1 AND i.company_id = $2 LIMIT 1`,
    [invoiceId, companyId],
  );
  if (!rows.length) throw new Error('Invoice not found for this company.');
  const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : (rows[0].data || {});
  const digits = value => String(value || '').replace(/\D/g, '');
  const comparable = value => {
    const normalized = digits(value);
    return normalized.length === 11 && normalized.startsWith('1') ? normalized.slice(1) : normalized;
  };
  const recipient = comparable(phone);
  if (!recipient || ![data.customer_phone, rows[0].linked_phone, rows[0].linked_phone_2]
    .some(candidate => comparable(candidate) === recipient)) {
    throw new Error('Text recipient does not match the invoice customer. Link the customer or update the invoice phone number before retrying.');
  }
}

module.exports = { assertInvoiceCustomerSmsRecipient };