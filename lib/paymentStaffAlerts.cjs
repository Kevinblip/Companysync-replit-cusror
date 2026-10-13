'use strict';

const { createHash } = require('node:crypto');
const { activeProvider, sendPlatformEmail } = require('./emailTransport.cjs');
const { getNotificationQuietHours } = require('./notificationQuietHours.cjs');

const isCashPayment = payment => !(
  payment.is_withheld_offset === true ||
  payment.data?.is_withheld_offset === true ||
  /no cash received/i.test(payment.notes || '') ||
  ['failed', 'refunded', 'ach_pending', 'void', 'cancelled'].includes(String(payment.status || '').toLowerCase())
);

function alertId(companyId, paymentId, email) {
  const hash = createHash('sha256')
    .update(JSON.stringify([String(companyId), String(paymentId), email.trim().toLowerCase()]))
    .digest('hex').slice(0, 40);
  return `payment_alert_${hash}`;
}

// Call this from entity-create, not from a page alone: manual payments are
// entered on several screens. The deterministic insert is the single claim
// shared by the entity hook and the legacy browser dispatcher.
async function notifyPaymentStaff(pool, {
  companyId, paymentId, sendSms, sendEmail = sendPlatformEmail, emailProvider = activeProvider,
  now = new Date(),
} = {}) {
  if (!companyId || !paymentId) throw new Error('Payment alert requires company and payment IDs');
  const { rows: payments } = await pool.query(
    'SELECT * FROM payments WHERE id = $1 AND company_id = $2 LIMIT 1',
    [paymentId, companyId],
  );
  const payment = payments[0];
  if (!payment || !isCashPayment(payment)) return { success: true, skipped: true, successCount: 0 };
  const quiet = await getNotificationQuietHours(pool, companyId, now);
  const { rows: admins } = await pool.query(
    `SELECT COALESCE(NULLIF(user_email, ''), NULLIF(email, '')) AS email,
            COALESCE(NULLIF(cell_phone, ''), NULLIF(phone, '')) AS phone
       FROM staff_profiles
      WHERE company_id = $1 AND is_active = true AND is_administrator = true`,
    [companyId],
  );
  const recipients = new Map();
  for (const admin of admins) {
    if (admin.email) recipients.set(admin.email.trim().toLowerCase(), admin);
  }
  if (payment.invoice_id) {
    const { rows: reps } = await pool.query(
      `SELECT COALESCE(NULLIF(sp.user_email, ''), NULLIF(sp.email, '')) AS email,
              COALESCE(NULLIF(sp.cell_phone, ''), NULLIF(sp.phone, '')) AS phone
         FROM invoices i JOIN staff_profiles sp
           ON sp.company_id = i.company_id AND sp.is_active = true
          AND LOWER(COALESCE(NULLIF(sp.user_email, ''), NULLIF(sp.email, ''))) = LOWER(i.sale_agent)
        WHERE i.id = $1 AND i.company_id = $2 LIMIT 1`,
      [payment.invoice_id, companyId],
    );
    for (const rep of reps) {
      if (rep.email && !recipients.has(rep.email.trim().toLowerCase())) {
        recipients.set(rep.email.trim().toLowerCase(), rep);
      }
    }
  }
  if (!recipients.size) {
    const id = `payment_alert_unrouted_${createHash('sha256')
      .update(JSON.stringify([companyId, paymentId])).digest('hex').slice(0, 40)}`;
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'PaymentAlertAudit', $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (id, entity_type) DO NOTHING`,
      [id, companyId, JSON.stringify({
        payment_id: paymentId, invoice_id: payment.invoice_id || null,
        reason: 'no_active_admin_or_assigned_rep',
      })],
    );
    return { success: true, successCount: 0, reason: 'No active admin or assigned rep' };
  }

  const amount = Number(payment.amount || 0).toFixed(2);
  const title = `Payment Received: $${amount}`;
  const message = `$${amount} from ${payment.customer_name || 'a customer'}${payment.invoice_number ? `, Invoice ${payment.invoice_number}` : ''}`;
  let created = 0;
  for (const [email, recipient] of recipients) {
    const id = alertId(companyId, paymentId, email);
    const smsAvailable = !!recipient.phone && typeof sendSms === 'function';
    const state = {
      company_id: companyId, user_email: recipient.email, title, message,
      type: 'payment_received', link_url: '/payments', is_read: false,
      related_entity_type: 'Payment', related_entity_id: paymentId,
      invoice_id: payment.invoice_id || null,
      bell_status: quiet.active ? 'deferred' : 'created',
      email_status: emailProvider() === 'none' ? 'not_configured' : quiet.active ? 'suppressed_quiet_hours' : 'pending',
      sms_status: !smsAvailable ? 'not_configured' : quiet.active ? 'suppressed_quiet_hours' : 'pending',
      ...quiet.active ? { deferred_until: quiet.deferredUntil, deferred_reason: 'company_notification_quiet_hours' } : {},
    };
    const insert = await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'Notification', $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (id, entity_type) DO NOTHING`,
      [id, companyId, JSON.stringify(state)],
    );
    if (!insert.rowCount) continue;
    created++;
    if (quiet.active) continue; // The bell is deferred; external sends are suppressed, not queued.

    const updateChannel = (channel, status, detail) => pool.query(
      `UPDATE generic_entities SET data = data || $2::jsonb, updated_date = NOW()
        WHERE id = $1 AND entity_type = 'Notification' AND company_id = $3`,
      [id, JSON.stringify({
        [`${channel}_status`]: status,
        [`${channel}_status_at`]: new Date().toISOString(),
        ...(detail ? { [`${channel}_detail`]: String(detail).slice(0, 200) } : {}),
      }), companyId],
    );
    if (state.email_status === 'pending') {
      try {
        const result = await sendEmail({
          from: 'CompanySync <noreply@companysync.io>', to: [recipient.email],
          subject: title,
          html: `<div style="font-family:sans-serif"><h2>Payment received</h2><p>A payment of $${amount} was recorded. Sign in to view the payment details.</p></div>`,
          context: { companyId, source: 'payment_staff_alert' },
        });
        await updateChannel('email', result?.success === false ? 'failed' : 'submitted');
      } catch (error) {
        await updateChannel('email', 'failed', error.message);
      }
    }
    if (state.sms_status === 'pending') {
      try {
        const result = await sendSms({ to: recipient.phone, message: `${title}: ${message}`, companyId });
        await updateChannel('sms', result?.success === false
          ? result.skipped && /quiet.hour/i.test(result.reason || '') ? 'suppressed_quiet_hours' : 'failed'
          : 'submitted', result?.success === false ? (result.reason || result.error) : null);
      } catch (error) {
        await updateChannel('sms', 'failed', error.message);
      }
    }
  }
  return { success: true, successCount: created, alreadyClaimed: recipients.size - created };
}

module.exports = { notifyPaymentStaff, alertId, isCashPayment };