import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  console.log('📧 Email Request (sendEmailFromCRM)');
  
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { to, subject, message, contactName, companyId, calledFromService } = body;

    if (!to || !message) {
      return Response.json({ error: 'Missing required fields: to, message' }, { status: 400 });
    }

    // Auth Check
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (e) {
      // Ignore auth error if called as service
    }

    if (!user && (!calledFromService || !companyId)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const effectiveCompanyId = companyId || user?.company_id;
    if (!effectiveCompanyId) {
      return Response.json({ error: 'Missing company ID' }, { status: 400 });
    }

    // Delegate to sendUnifiedEmail
    // Note: Wrapping in try/catch to handle function invocation errors gracefully
    let response;
    try {
      response = await base44.functions.invoke('sendUnifiedEmail', {
        to,
        subject,
        html: message, // Pass message as HTML/content
        companyId: effectiveCompanyId,
        contactName,
        messageType: 'email',
        skipLogging: false,
        skipNotification: false
      });
    } catch (invokeError) {
      console.error('❌ Failed to invoke sendUnifiedEmail:', invokeError);
      throw new Error(`Unified Email Service Error: ${invokeError.message}`);
    }

    const result = response.data;

    if (result?.error) {
      console.error('❌ sendUnifiedEmail returned error:', result.error);
      throw new Error(result.error);
    }

    return Response.json({
      success: true,
      message: 'Email sent successfully',
      resend_id: result?.id
    });

  } catch (error) {
    console.error('❌ sendEmailFromCRM Error:', error.message);
    // Return 200 with error field so frontend client doesn't throw generic 500
    // This allows the UI to display the specific error message
    return Response.json({ 
      success: false,
      error: error.message || 'Failed to send email'
    }, { status: 200 }); 
  }
});