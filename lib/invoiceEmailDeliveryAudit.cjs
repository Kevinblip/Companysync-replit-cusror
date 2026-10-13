'use strict';

const { randomUUID } = require('node:crypto');
const { finalizeSendRecord, associateProviderMessage } = require('./emailDeliveryWebhook.cjs');

// Write the attempt before calling the provider. This correlation id travels
// with the email and survives a callback arriving before the provider-id write.
async function beginInvoiceEmailAttempt(pool, {
  companyId, invoiceId, to, contactName, subject, html, actorEmail, purpose = 'invoice',
}) {
  if (!companyId || !to) throw new Error('Invoice email must have a company and recipient');
  const id = randomUUID();
  await pool.query(
    `INSERT INTO communications
      (id, company_id, type, communication_type, direction, contact_name,
       contact_email, subject, body, message, status, created_by, data,
       created_at, updated_at)
     VALUES ($1, $2, 'email', 'email', 'outbound', $3, $4, $5, $6, $6, 'pending', $7, $8, NOW(), NOW())`,
    [
      id, companyId, contactName || null, to, subject || null, html || null,
      actorEmail || 'system',
      JSON.stringify({
        source: 'invoice_payment_request',
        message_purpose: purpose,
        related_entity_type: 'Invoice',
        related_entity_id: invoiceId || null,
        delivery_correlation_id: id,
        delivery_status: 'pending',
        delivery_status_at: new Date().toISOString(),
      }),
    ],
  );
  return id;
}

async function finishInvoiceEmailAttempt(pool, communicationId, { result, error } = {}) {
  if (error) {
    await finalizeSendRecord({
      communicationId, status: 'failed',
      always: { delivery_detail: String(error.message || error).slice(0, 500) },
      optimistic: { delivery_status: 'failed', delivery_status_at: new Date().toISOString() },
    }, { pool });
    return { trackingDegraded: false };
  }

  if (result?.success !== true || !result.id) throw new Error('Email provider did not confirm acceptance');
  const association = await associateProviderMessage({
    communicationId, provider: result.provider, messageId: result.id,
  }, { pool });
  // An association can be queued for repair when the post-send update fails.
  // If even that write fails, the pre-send correlation remains in the record.
  return { trackingDegraded: !association.ok };
}

module.exports = { beginInvoiceEmailAttempt, finishInvoiceEmailAttempt };