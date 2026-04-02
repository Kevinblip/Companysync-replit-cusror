import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

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
    try {
      user = await base44.auth.me();
    } catch (e) {
      console.log('UnifiedEmail: No user session (service call)');
    }

    const activeCompanyId = companyId || user?.company_id;
    if (!activeCompanyId) {
      return Response.json({ error: 'Unauthorized: Missing company context' }, { status: 401 });
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
    let companyName = 'CrewCam CRM';
    if (activeCompanyId) {
      const companies = await base44.asServiceRole.entities.Company.filter({ id: activeCompanyId });
      if (companies?.[0]?.company_name) companyName = companies[0].company_name;
    }

    // 4. Send via Resend
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) return Response.json({ error: 'RESEND_API_KEY not set' }, { status: 500 });

    const resend = new Resend(resendApiKey);
    
    // Robust Domain Resolution
    let rawDomain = Deno.env.get('RESEND_DOMAIN');
    let domain = 'mycrewcam.com';
    
    if (rawDomain && typeof rawDomain === 'string') {
        // Remove quotes, protocols, slashes, whitespace
        const clean = rawDomain.replace(/["']/g, '').replace(/https?:\/\//, '').replace(/\/$/, '').trim();
        if (clean.length > 0 && clean.includes('.')) {
            domain = clean;
        }
    }

    // Robust Name Resolution
    let safeCompanyName = (companyName || 'CrewCam').replace(/[<>"]/g, '').trim();
    if (!safeCompanyName) safeCompanyName = 'CrewCam';
    
    // Construct standard format: "Name" <email@domain.com>
    const fromEmail = `"${safeCompanyName}" <noreply@${domain}>`;
    
    console.error(`DEBUG_EMAIL_V2: From: ${fromEmail} | To: ${to}`);

    const payload = {
      from: fromEmail,
      to,
      subject: finalSubject,
      html: finalHtml,
      attachments: Array.isArray(attachments) ? attachments : undefined
    };

    const emailResult = await resend.emails.send(payload);

    if (emailResult.error) {
      console.error('Resend API Error:', emailResult.error);
      return Response.json({ error: `Resend Error: ${emailResult.error.message}` }, { status: 500 });
    }

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

    return Response.json({ success: true, id: emailResult.data?.id });

  } catch (error) {
    console.error('UnifiedEmail Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function replaceMergeFields(text, data) {
  if (!text || !data) return text;
  return text.replace(/{(\w+)}/g, (_, key) => data[key] || '');
}