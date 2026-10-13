// ─────────────────────────────────────────────────────────────────────────────
// Shared inspector-notification helper for the appointment-approval workflow.
//
// Used by BOTH:
//   • the approveAppointmentNotify function handler (vite-functions-plugin.js,
//     served in dev AND prod via prod-integrations getFunctionHandlers), and
//   • lib/smsAssistant.cjs when a customer texts back "confirmed".
//
// Sends the assigned inspector:
//   1. a bell Notification (generic_entities, user_email-targeted), and
//   2. an SMS to their personal cell phone via the company's Twilio settings
//      (direct REST — deliberately NOT functionHandlers.sendSMS, which logs to
//      the customer-facing communications table and would pollute CRM threads).
//
// Every path is best-effort and returns a status object; it never throws.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

/**
 * Look up a staff member's display name and cell phone by email.
 * staff_profiles is a dedicated table; email may live in `user_email` or `email`.
 */
async function lookupStaff(pool, companyId, email) {
  if (!pool || !companyId || !email) return null;
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(user_email,''), email) AS email,
              COALESCE(NULLIF(full_name,''), NULLIF(name,''), email, user_email) AS name,
              COALESCE(NULLIF(cell_phone,''), NULLIF(phone,'')) AS cell
         FROM staff_profiles
        WHERE company_id = $1 AND (LOWER(user_email) = LOWER($2) OR LOWER(email) = LOWER($2))
        LIMIT 1`,
      [companyId, email]
    );
    return rows[0] || null;
  } catch (e) {
    console.warn('[appointmentNotify] staff lookup failed:', e.message);
    return null;
  }
}

/** Send one SMS to a staff cell via the company's Twilio credentials. */
async function sendStaffCellSms(pool, companyId, toPhone, body) {
  try {
    const digits = String(toPhone || '').replace(/[^0-9]/g, '');
    const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (normalized.length !== 10) return { sent: false, reason: 'invalid_phone' };
    const toE164 = `+1${normalized}`;

    const { rows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
      [companyId]
    );
    const tw = rows[0]?.data || {};
    const sid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
    const token = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
    const from = tw.main_phone_number || process.env.TWILIO_PHONE_NUMBER;
    if (!sid || !token || !from) return { sent: false, reason: 'twilio_not_configured' };

    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: toE164, From: from, Body: body }).toString(),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.warn(`[appointmentNotify] Twilio ${resp.status}: ${errText.substring(0, 200)}`);
      return { sent: false, reason: `twilio_${resp.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.warn('[appointmentNotify] staff cell SMS failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

/**
 * Notify the assigned inspector about an appointment.
 *
 * kind: 'assigned'           → right after a human approves the appointment
 *       'customer_confirmed' → when the customer texts back a confirmation
 *
 * Returns { bell: bool, sms: { sent, reason? }, inspectorName } — never throws.
 */
async function notifyInspector({ pool, companyId, inspectorEmail, kind, customerName, customerPhone, address, startTimeLabel }) {
  const out = { bell: false, sms: { sent: false, reason: 'skipped' }, inspectorName: null };
  if (!pool || !companyId || !inspectorEmail) return out;

  const staff = await lookupStaff(pool, companyId, inspectorEmail);
  out.inspectorName = staff?.name || null;

  const who = customerName || 'Customer';
  const when = startTimeLabel || 'time TBD';
  const where = address ? ` at ${address}` : '';
  const phonePart = customerPhone ? ` Phone: ${customerPhone}.` : '';

  const isConfirm = kind === 'customer_confirmed';
  const title = isConfirm
    ? `✅ ${who} confirmed their inspection`
    : `📋 New inspection assigned: ${who}`;
  const message = isConfirm
    ? `${who} just confirmed the appointment on ${when}${where}.${phonePart}`
    : `${who}, ${when}${where}.${phonePart} Check your calendar for details.`;

  // 1) Bell notification (targeted at the inspector's account)
  try {
    const nId = `notif_insp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [nId, companyId, JSON.stringify({
        id: nId,
        type: isConfirm ? 'appointment_confirmed' : 'appointment_assigned',
        title,
        message,
        is_read: false,
        priority: 'high',
        user_email: staff?.email || inspectorEmail,
        link_url: '/Calendar',
        created_date: new Date().toISOString(),
      })]
    );
    out.bell = true;
  } catch (e) {
    console.warn('[appointmentNotify] bell notification failed:', e.message);
  }

  // 2) SMS to the inspector's personal cell (best-effort)
  if (staff?.cell) {
    out.sms = await sendStaffCellSms(pool, companyId, staff.cell, `${title}\n${message}`);
  } else {
    out.sms = { sent: false, reason: 'no_cell_on_file' };
  }

  return out;
}

module.exports = { notifyInspector, lookupStaff, sendStaffCellSms };
