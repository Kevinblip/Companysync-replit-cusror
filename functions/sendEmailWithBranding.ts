import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { sendEmail } from './_sendEmail.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { to, subject, html, companyId } = await req.json();

    if (!to || !subject || !html || !companyId) {
      return Response.json({ error: 'Missing required fields: to, subject, html, companyId' }, { status: 400 });
    }
    const staff = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId, user_email: user.email });
    const owned = await base44.asServiceRole.entities.Company.filter({ id: companyId, created_by: user.email });
    if (!staff.some((row: any) => row.is_active !== false) && owned.length === 0) {
      return Response.json({ error: 'You do not have access to send email for this company' }, { status: 403 });
    }
    const recipients = Array.isArray(to) ? to : [to];
    if (recipients.length > 25 || recipients.some((address) => typeof address !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()))) {
      return Response.json({ error: 'Use 1–25 valid recipient email addresses' }, { status: 400 });
    }

    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    const companyName = company?.company_name || 'CRM';

    const fromEmail = `${companyName} <noreply@companysync.io>`;
    try {
        const result = await sendEmail({ from: fromEmail, to: recipients, subject, html });
      console.log(`✅ Branded email sent from "${companyName}" to ${to}`);
      return Response.json({ success: true, method: 'postmark', id: result.id });
    } catch (emailErr: any) {
      // There is deliberately NO Core.SendEmail fallback here.
      //
      // Core.SendEmail is a completely ungoverned sender: it skips the pause
      // gate, recipient controls, rate limits, content caps and attribution.
      // Falling back to it meant that every reason the guarded transport
      // refused a message — including the safety controls this whole task
      // exists to enforce, and the edge-sender kill switch itself — was
      // converted into "send it anyway by another route". A refusal is a
      // decision, and an outage is not a licence to bypass the controls.
      const code = String(emailErr?.code || emailErr?.message || '');
      const refused = /EMAIL_DELIVERY_PAUSED|RATE_LIMIT|TOO_MANY_RECIPIENTS|CONTENT_TOO_LARGE|RESERVED|EDGE_SENDER_DISABLED|not allowed|blocked/i.test(code);
      console.warn(`❌ Branded email not sent (${refused ? 'refused by safety controls' : 'provider unavailable'}):`, code);
      return Response.json(
        { error: refused ? 'EMAIL_BLOCKED' : 'EMAIL_NOT_CONFIGURED', message: emailErr.message },
        { status: refused ? 429 : 503 },
      );
    }

  } catch (error) {
    console.error('❌ sendEmailWithBranding error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
