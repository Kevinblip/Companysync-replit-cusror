const assert = require('node:assert/strict');
const fs = require('node:fs');
const { assertInvoiceCustomerSmsRecipient } = require('../lib/invoicePaymentSmsRecipient.cjs');
const { beginInvoiceEmailAttempt, finishInvoiceEmailAttempt } = require('../lib/invoiceEmailDeliveryAudit.cjs');

(async () => {
  const { requireMessageSubmission } = await import('../src/utils/paymentRequestDelivery.js');
  assert.equal(requireMessageSubmission({ data: { success: true, sid: 'SM123', status: 'queued' } }, 'sms').sid, 'SM123');
  assert.equal(requireMessageSubmission({ data: { success: true, id: 'PM123', provider: 'postmark' } }, 'email').id, 'PM123');
  assert.throws(() => requireMessageSubmission({ data: { success: false, skipped: true, reason: 'company_notification_quiet_hours' } }, 'sms'), /quiet_hours/);
  assert.throws(() => requireMessageSubmission({ error: 'Twilio unavailable', data: {} }, 'sms'), /Twilio unavailable/);
  assert.throws(() => requireMessageSubmission({ data: { success: true } }, 'email'), /Submission is uncertain/);
  assert.throws(() => requireMessageSubmission({ data: { success: true, sid: 'SM123', status: 'failed' } }, 'sms'), /did not accept/);
  assert.throws(() => requireMessageSubmission({ data: { success: false, error: 'Email paused' } }, 'email'), /Email paused/);

  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [{ data: { customer_phone: '(216) 555-0100' }, linked_phone: '+12165550101', linked_phone_2: null }] };
    },
  };
  await assertInvoiceCustomerSmsRecipient(pool, 'company-1', 'invoice-1', '+12165550100');
  await assertInvoiceCustomerSmsRecipient(pool, 'company-1', 'invoice-1', '2165550101');
  assert.deepEqual(queries[0].params, ['invoice-1', 'company-1']);
  assert.match(queries[0].sql, /i\.company_id = \$2/);
  assert.match(queries[0].sql, /c\.base44_id = i\.customer_id/);
  await assert.rejects(() => assertInvoiceCustomerSmsRecipient(pool, 'company-1', 'invoice-1', '+12165550999'), /does not match/);
  await assert.rejects(() => assertInvoiceCustomerSmsRecipient({ query: async () => ({ rows: [] }) }, 'company-1', 'other-invoice', '+12165550100'), /Invoice not found/);

  const auditWrites = [];
  const auditPool = { query: async (sql, values) => {
    auditWrites.push({ sql, values });
    return { rows: [], rowCount: 1 };
  } };
  const acceptedId = await beginInvoiceEmailAttempt(auditPool, {
    companyId: 'company-1', invoiceId: 'invoice-1', to: 'recipient@example.com',
    contactName: 'Customer', subject: 'Payment request', html: '<p>Pay</p>',
  });
  assert(acceptedId);
  const pendingData = JSON.parse(auditWrites[0].values[7]);
  assert.equal(pendingData.delivery_status, 'pending');
  assert.equal(pendingData.delivery_correlation_id, acceptedId);
  const outcome = await finishInvoiceEmailAttempt(auditPool, acceptedId, {
    result: { success: true, id: 'PM123', provider: 'postmark' },
  });
  assert.equal(outcome.trackingDegraded, false);
  const acceptedUpdate = auditWrites.find(write => write.sql.includes('UPDATE communications'));
  assert.equal(JSON.parse(acceptedUpdate.values[2]).provider_message_id, 'PM123');
  const failedId = await beginInvoiceEmailAttempt(auditPool, {
    companyId: 'company-1', invoiceId: 'invoice-1', to: 'recipient@example.com',
  });
  await finishInvoiceEmailAttempt(auditPool, failedId, { error: new Error('Postmark rejected it') });
  const failedUpdate = auditWrites.filter(write => write.sql.includes('UPDATE communications')).at(-1);
  assert.equal(JSON.parse(failedUpdate.values[3]).delivery_status, 'failed');

  const page = fs.readFileSync('src/pages/invoice-details.jsx', 'utf8');
  const plugin = fs.readFileSync('vite-functions-plugin.js', 'utf8');
  const prod = fs.readFileSync('db/prod-integrations.cjs', 'utf8');
  const smsDialog = fs.readFileSync('src/components/communication/SMSDialog.jsx', 'utf8');
  assert.match(page, /requireMessageSubmission\(response, 'sms'\)/);
  assert.match(page, /paymentInvoiceId: invoice\.id/);
  assert.match(page, /customer\?\.base44_id\) === String\(invoice\.customer_id\)/);
  assert.match(page, /Link the correct customer to this invoice or add their phone number/);
  assert.match(plugin, /assertInvoiceCustomerSmsRecipient\(getPool\(\), params\.companyId, params\.paymentInvoiceId, normalizedTo\)/);
  assert.match(plugin, /authorizeDocumentEmail\(\s*req, \{ invoiceId: params\.paymentInvoiceId \}, 'invoices', 'invoiceId'/);
  assert.match(plugin, /params = \{ \.\.\.params, companyId: authorized\.companyId, senderEmail: authorized\.caller\.email \}/);
  assert.match(plugin, /const staffQuietHours = params\.paymentInvoiceId \|\| authenticatedManualSend\s*\?\s*null/);
  assert.match(plugin, /invoiceEmailDeliveryAudit\.cjs/);
  assert.match(prod, /invoiceEmailDeliveryAudit\.cjs/);
  assert.match(page, /paymentEmailDelivery\[request\.communication_id\]/);
  assert.match(smsDialog, /result\?\.reason === 'company_notification_quiet_hours'/);
  assert.match(smsDialog, /result\.deferred_until/);
  console.log('Payment request submission and customer SMS guard passed');
})().catch(error => { console.error(error); process.exitCode = 1; });