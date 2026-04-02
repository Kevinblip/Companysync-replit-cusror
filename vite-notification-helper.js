import { Pool } from 'pg';

async function sendTwilioSms(toPhone, fromPhone, body, accountSid, authToken) {
  if (!accountSid || !authToken || !fromPhone || !toPhone) return false;
  try {
    const authStr = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const params = new URLSearchParams({ To: toPhone, From: fromPhone, Body: body });
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const result = await resp.json();
    if (result.sid) {
      console.log(`[Notif] SMS sent to ${toPhone}: ${result.sid}`);
      return true;
    }
    console.warn(`[Notif] SMS to ${toPhone} failed:`, result.message || result.code);
    return false;
  } catch (e) {
    console.warn(`[Notif] SMS error to ${toPhone}:`, e.message);
    return false;
  }
}

function getEmailHtml(title, message, linkUrl) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);border-radius:12px 12px 0 0;padding:24px;text-align:center">
        <h1 style="color:white;margin:0;font-size:20px">CompanySync</h1>
      </div>
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px">
        <h2 style="color:#1f2937;margin:0 0 12px 0;font-size:18px">${title}</h2>
        <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 16px 0">${message}</p>
        ${linkUrl ? `<a href="https://getcompanysync.com${linkUrl}" style="display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:500">View in CompanySync</a>` : ''}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0" />
        <p style="color:#9ca3af;font-size:12px;margin:0">Automated notification from CompanySync &mdash; <a href="https://getcompanysync.com/Settings" style="color:#6b7280">Manage notifications</a></p>
      </div>
    </div>`;
}

export async function notifyAdminsWithSms(companyId, { title, message, type, linkUrl, smsBody }) {
  if (!companyId) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: companyRows } = await pool.query(
      `SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]
    );
    const localCompanyId = companyRows[0]?.id || companyId;

    const { rows: staff } = await pool.query(
      `SELECT user_email, cell_phone, is_administrator, full_name
       FROM staff_profiles WHERE company_id = $1 AND user_email IS NOT NULL AND is_active = true`,
      [localCompanyId]
    );
    const adminStaff = staff.filter(s => s.is_administrator === true);
    const targets = adminStaff.length > 0 ? adminStaff : staff;
    if (targets.length === 0) return;

    // Load Twilio credentials for this company
    const { rows: tsRows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
      [localCompanyId]
    );
    const ts = tsRows[0]?.data || {};
    const twilioSid = ts.account_sid || process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = ts.auth_token || process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = ts.phone_number || ts.main_phone_number || process.env.TWILIO_PHONE_NUMBER;

    const emailHtml = getEmailHtml(title, message, linkUrl);
    const smsTxt = smsBody || `YICN Roofing Alert: ${title}\n${message}`;

    for (const member of targets) {
      if (!member.user_email) continue;

      const notifId = `local_notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'Notification', $2, $3, NOW(), NOW())`,
        [notifId, localCompanyId, JSON.stringify({
          user_email: member.user_email,
          title, message, type: type || 'info',
          link_url: linkUrl || null, is_read: false
        })]
      );
      console.log(`[Notif] Bell created for ${member.user_email}: ${title}`);

      if (process.env.RESEND_API_KEY) {
        try {
          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'CompanySync <noreply@companysync.io>', to: [member.user_email], subject: title, html: emailHtml })
          });
          if (resp.ok) console.log(`[Notif] Email sent to ${member.user_email}`);
          else console.warn(`[Notif] Email failed for ${member.user_email}:`, await resp.text().catch(() => resp.status));
        } catch (emailErr) { console.warn(`[Notif] Email error:`, emailErr.message); }
      }

      if (member.cell_phone && twilioSid && twilioFrom) {
        await sendTwilioSms(member.cell_phone, twilioFrom, smsTxt, twilioSid, twilioToken);
      }
    }
  } catch (err) {
    console.warn('[Notif] notifyAdminsWithSms error:', err.message);
  } finally {
    await pool.end();
  }
}

export async function notifyAdmins(companyId, { title, message, type, linkUrl }) {
  if (!companyId) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Resolve Base44 ID to local company ID if needed
    const { rows: companyRows } = await pool.query(
      `SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`,
      [companyId]
    );
    const localCompanyId = companyRows[0]?.id || companyId;

    const { rows: staff } = await pool.query(
      `SELECT user_email, cell_phone as phone, is_administrator
       FROM staff_profiles WHERE company_id = $1 AND user_email IS NOT NULL AND is_active = true`,
      [localCompanyId]
    );

    const adminStaff = staff.filter(s => s.is_administrator === true);
    const targets = adminStaff.length > 0 ? adminStaff : staff;

    if (targets.length === 0) {
      console.log(`[Notif] No staff found for ${companyId} (local: ${localCompanyId}) — skipping notifications`);
      return;
    }

    const emailHtml = getEmailHtml(title, message, linkUrl);

    for (const member of targets) {
      if (!member.user_email) continue;

      const notifId = `local_notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'Notification', $2, $3, NOW(), NOW())`,
        [notifId, companyId, JSON.stringify({
          user_email: member.user_email,
          title,
          message,
          type: type || 'info',
          link_url: linkUrl || null,
          is_read: false
        })]
      );
      console.log(`[Notif] Bell created for ${member.user_email}: ${title}`);

      if (process.env.RESEND_API_KEY) {
        try {
          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'CompanySync <noreply@companysync.io>',
              to: [member.user_email],
              subject: title,
              html: emailHtml
            })
          });
          if (resp.ok) {
            console.log(`[Notif] Email sent to ${member.user_email}`);
          } else {
            const err = await resp.text().catch(() => resp.status);
            console.warn(`[Notif] Email failed for ${member.user_email}:`, err);
          }
        } catch (emailErr) {
          console.warn(`[Notif] Email error for ${member.user_email}:`, emailErr.message);
        }
      }
    }
  } catch (err) {
    console.warn('[Notif] notifyAdmins error:', err.message);
  } finally {
    await pool.end();
  }
}

export function getEntityNotificationConfig(entityType, action, entityData) {
  switch (entityType) {
    case 'Communication': {
      if (action !== 'create') return null;
      if (entityData?.direction !== 'inbound') return null;
      const commType = (entityData?.communication_type || entityData?.type || 'sms').toUpperCase();
      const from = entityData?.contact_phone || entityData?.from || 'Unknown';
      const bodySnip = (entityData?.message_body || entityData?.body || '').substring(0, 120);
      return {
        title: `📱 New Inbound ${commType} from ${from}`,
        message: bodySnip ? `"${bodySnip}"` : 'New inbound message received.',
        type: 'inbound_communication',
        linkUrl: '/SarahWorkspace'
      };
    }
    case 'Lead': {
      if (action !== 'create') return null;
      return {
        title: `🎯 New Lead: ${entityData?.name || 'Unknown'}`,
        message: `New lead created${entityData?.source ? ` from ${entityData.source}` : ''}${entityData?.phone ? ` — ${entityData.phone}` : ''}`,
        type: 'lead_created',
        linkUrl: `/LeadProfile?id=${entityData?.id || ''}`
      };
    }
    case 'Customer': {
      if (action !== 'create') return null;
      return {
        title: `👤 New Customer: ${entityData?.name || 'Unknown'}`,
        message: `New customer added to your CRM${entityData?.phone ? ` — ${entityData.phone}` : ''}`,
        type: 'customer_created',
        linkUrl: `/CustomerProfile?id=${entityData?.id || ''}`
      };
    }
    case 'Invoice': {
      if (action !== 'create') return null;
      return {
        title: `🧾 New Invoice ${entityData?.invoice_number || ''}`,
        message: `Invoice for ${entityData?.customer_name || 'Unknown'} — $${Number(entityData?.amount || 0).toFixed(2)}`,
        type: 'invoice_created',
        linkUrl: `/invoice-details?id=${entityData?.id || ''}`
      };
    }
    case 'Payment': {
      if (action !== 'create') return null;
      return {
        title: `💰 Payment Received`,
        message: `$${Number(entityData?.amount || 0).toFixed(2)} from ${entityData?.customer_name || 'Unknown'}`,
        type: 'payment_received',
        linkUrl: '/Payments'
      };
    }
    case 'Estimate': {
      if (action !== 'create') return null;
      return {
        title: `📄 New Estimate ${entityData?.estimate_number || ''}`,
        message: `For ${entityData?.customer_name || 'Unknown'} — $${Number(entityData?.amount || 0).toFixed(2)}`,
        type: 'estimate_created',
        linkUrl: `/ViewEstimate?id=${entityData?.id || ''}`
      };
    }
    default:
      return null;
  }
}
