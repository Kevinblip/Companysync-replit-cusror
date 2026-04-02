import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';

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

    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    const companyName = company?.company_name || 'CRM';

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      await base44.asServiceRole.integrations.Core.SendEmail({ to, subject, body: html });
      return Response.json({ success: true, method: 'core' });
    }

    const resend = new Resend(resendApiKey);
    const fromEmail = `${companyName} <noreply@mycrewcam.com>`;

    const result = await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      html,
    });

    if (result.error) {
      throw new Error(`Resend error: ${JSON.stringify(result.error)}`);
    }

    console.log(`✅ Branded email sent from "${companyName}" to ${to}`);
    return Response.json({ success: true, method: 'resend', id: result.data?.id });

  } catch (error) {
    console.error('❌ sendEmailWithBranding error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
