import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { sendEmail } from './_sendEmail.ts';

Deno.serve(async (req) => {
  console.error("DEBUG: Function sendUnifiedEmail started");
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const { 
      to, subject, html, message, templateName, templateData, 
      companyId, contactName, skipNotification, skipLogging, attachments 
    } = body;

    // 1. Context & Auth
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}
    if (!user?.email) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    const activeCompanyId = companyId || user?.company_id;
    if (!activeCompanyId) {
      return Response.json({ error: 'Unauthorized: Missing company context' }, { status: 401 });
    }
    const staff = await base44.asServiceRole.entities.StaffProfile.filter({
      company_id: activeCompanyId,
      user_email: user.email,
    });
    const companiesForOwner = await base44.asServiceRole.entities.Company.filter({
      id: activeCompanyId,
      created_by: user.email,
    });
    if (!staff.some((row: any) => row.is_active !== false) && companiesForOwner.length === 0) {
      return Response.json({ error: 'You do not have access to send email for this company' }, { status: 403 });
    }

    // 2. Content Resolution
    let finalSubject = subject;
    let finalHtml = html;

    if (templateName) {
      const templates = await base44.asServiceRole.entities.EmailTemplate.filter({
        company_id: activeCompanyId,
        template_name: templateName,
        is_active: { $ne: false } 
      });
      const template = templates[0];
      if (template) {
        finalSubject = replaceMergeFields(template.subject || subject, templateData);
        finalHtml = replaceMergeFields(template.body || html || message, templateData);
      }
    }

    if (!finalHtml) {
      finalHtml = message 
        ? `<div style="font-family: sans-serif; white-space: pre-wrap;">${message}</div>` 
        : null;
    }

    if (!to || !finalSubject || !finalHtml) {
      return Response.json({ error: 'Missing required fields: to, subject, or content' }, { status: 400 });
    }

    // 3. Branding
    let companyName = 'PhotoSync CRM';
    if (activeCompanyId) {
      const companies = await base44.asServiceRole.entities.Company.filter({ id: activeCompanyId });
      if (companies?.[0]?.company_name) companyName = companies[0].company_name;
    }

    // 4. Send via Postmark
    const safeCompanyName = (companyName || 'CompanySync').replace(/[<>"]/g, '').trim();
    const fromEmail = `${safeCompanyName || 'CompanySync'} <noreply@companysync.io>`;
    console.log(`[sendUnifiedEmail] From: ${fromEmail} | To: ${to}`);

    const recipients = Array.isArray(to) ? to : [to];
    if (recipients.length > 25 || recipients.some((address) => typeof address !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()))) {
      return Response.json({ error: 'Use 1–25 valid recipient email addresses' }, { status: 400 });
    }
    const emailResult = await sendEmail({
      from: fromEmail,
      to: recipients,
      subject: finalSubject,
      html: finalHtml,
      attachments: Array.isArray(attachments) ? attachments : undefined
    });

    // 5. Logs & Notifications
    if (!skipLogging) {
      try {
        await base44.asServiceRole.entities.Communication.create({
          company_id: activeCompanyId,
          contact_name: contactName || to.split('@')[0],
          contact_email: to,
          communication_type: 'email',
          direction: 'outbound',
          subject: finalSubject,
          message: message || '(HTML Content)', 
          status: 'sent',
          created_by: user?.email || 'system'
        });
      } catch (e) { console.error('Log failed:', e); }
    }

    if (!skipNotification && user) {
      try {
        await base44.asServiceRole.entities.Notification.create({
          company_id: activeCompanyId,
          user_email: user.email,
          title: '📧 Email Sent',
          message: `To: ${to}`,
          type: 'general',
          is_read: false
        });
      } catch (e) { console.error('Notification failed:', e); }
    }

    return Response.json({ success: true, id: emailResult.id });

  } catch (error) {
    console.error('UnifiedEmail Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function replaceMergeFields(text, data) {
  if (!text || !data) return text;
  return text.replace(/{(\w+)}/g, (_, key) => data[key] || '');
}