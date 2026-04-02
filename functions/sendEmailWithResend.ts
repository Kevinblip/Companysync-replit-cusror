import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { to, subject, body, fromName, attachments } = await req.json();

    if (!to || !subject || !body) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Delegate to Unified Email System
    const response = await base44.functions.invoke('sendUnifiedEmail', {
        to,
        subject,
        html: body, // Map 'body' to 'html'
        companyId: user.company_id,
        // fromName is handled by company branding in unified system, but we could pass it if we extended unified email to support overrides.
        // For now, unified system enforces company name for consistency.
        skipLogging: false
    });

    const result = response.data;

    if (result.error) {
        throw new Error(result.error);
    }

    return Response.json({ 
      success: true, 
      messageId: result.id,
      message: 'Email sent successfully' 
    });

  } catch (error) {
    console.error('❌ Error sending email:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});