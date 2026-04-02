import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { to, subject, html, companyName } = body;
    
    if (!to || !subject || !html) {
      return Response.json({ 
        error: 'Missing required fields: to, subject, html'
      }, { status: 400 });
    }

    // Delegate to the Unified Email System
    // We pass the user's company_id context if available
    const response = await base44.functions.invoke('sendUnifiedEmail', {
        to,
        subject,
        html,
        companyId: user.company_id, // Ensure strict scoping
        contactName: to.split('@')[0], // Fallback name
        skipNotification: false, // Enable in-app notification for visibility
        skipLogging: false
    });

    const result = response.data;

    if (result.error) {
         return Response.json({ error: result.error }, { status: 500 });
    }

    return Response.json({ 
      success: true, 
      message: 'Email sent successfully',
      id: result.id
    });

  } catch (error) {
    console.error('Email error:', error.message);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});