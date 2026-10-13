import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    let sessionId;
    let body: any = {};
    
    const contentType = req.headers.get('content-type') || '';
    console.log('📦 Content-Type:', contentType, 'Method:', req.method);
    
    const rawText = await req.text();
    console.log('📦 Raw body:', rawText?.substring(0, 500));
    
    try {
      body = JSON.parse(rawText);
      sessionId = body.sessionId || body.session_id || body.data?.sessionId || body.data?.session_id;
      console.log('📦 Parsed body keys:', Object.keys(body), 'sessionId:', sessionId);
    } catch {
      console.error('📦 Could not parse body as JSON:', rawText?.substring(0, 200));
      return Response.json({ 
        success: false, 
        error: 'Invalid request format. Expected JSON with sessionId.' 
      }, { status: 400 });
    }

    if (!sessionId) {
      return Response.json({ 
        success: false, 
        error: 'sessionId required' 
      }, { status: 400 });
    }

    console.log('📧 Starting sendContractSigningLink for session:', sessionId);

    // Create Base44 client from request with service role access
    const base44 = createClientFromRequest(req);
    
    // Verify user is authenticated
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ 
        success: false, 
        error: 'Unauthorized' 
      }, { status: 401 });
    }

    // Get signing session using service role
    const sessions = await base44.asServiceRole.entities.ContractSigningSession.filter({ id: sessionId });
    const session = sessions[0];
    
    if (!session) {
      console.error('❌ Session not found');
      return Response.json({ 
        success: false, 
        error: 'Session not found' 
      }, { status: 404 });
    }

    console.log('✅ Session found:', session.contract_name);

    // Generate unique signing token
    const signingToken = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    console.log('🔑 Generated signing token:', signingToken);

    // Update session using service role
    await base44.asServiceRole.entities.ContractSigningSession.update(sessionId, {
      signing_token: signingToken,
      expires_at: expiresAt.toISOString(),
      status: 'sent_to_customer',
      sent_to_customer_at: new Date().toISOString()
    });

    console.log('✅ Session updated');

    const replitAppUrl = body.base_url || Deno.env.get('REPLIT_SIGNING_URL') || 'https://getcompanysync.com';
    const signingLink = `${replitAppUrl}/sign-contract-customer?token=${signingToken}`;

    console.log('🔗 Signing link:', signingLink);

    // Get company info
    let company = null;
    if (session.company_id) {
      try {
        const companies = await base44.asServiceRole.entities.Company.filter({ id: session.company_id });
        company = companies[0];
      } catch (err) {
        console.log('⚠️ Could not load company:', err.message);
      }
    }

    // NOTE: Email/SMS sending is handled by the Replit proxy server.
    // This function only creates the session and returns the signing link + session details.
    // The proxy will use Resend to send the email with the correct Replit domain link.

    console.log('✅✅✅ Session created successfully, returning data for proxy to send email');

    return Response.json({
      success: true,
      signing_link: signingLink,
      signing_token: signingToken,
      expires_at: expiresAt.toISOString(),
      delivery_method: session.delivery_method || 'email',
      customer_email: session.customer_email || '',
      customer_phone: session.customer_phone || '',
      customer_name: session.customer_name || '',
      contract_name: session.contract_name || '',
      template_name: session.template_name || '',
      rep_name: session.rep_name || '',
      company_name: company?.company_name || '',
      company_phone: company?.phone || '',
      company_email: company?.email || '',
      company_logo_url: company?.logo_url || '',
      message: session.delivery_method === 'sms' 
        ? `SMS sent to ${session.customer_phone}` 
        : `Email sent to ${session.customer_email}`
    });

  } catch (error) {
    console.error('💥 ERROR:', error);
    return Response.json({
      success: false,
      error: error.message || 'Unknown error'
    }, { status: 500 });
  }
});