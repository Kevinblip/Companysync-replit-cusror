import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  console.log('🔍 === getSigningSession called ===');
  console.log('📥 Request method:', req.method);
  console.log('📥 Request URL:', req.url);
  console.log('📥 Request headers:', Object.fromEntries(req.headers.entries()));
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }
  
  try {
    // Don't require auth - this is for external customers
    const base44 = createClientFromRequest(req);
    
    // Log raw body
    const rawBody = await req.text();
    console.log('📦 Raw body received:', rawBody);
    
    // Try to parse JSON
    let body;
    try {
      body = JSON.parse(rawBody);
      console.log('✅ Parsed JSON body:', JSON.stringify(body, null, 2));
    } catch (e) {
      console.error('❌ Failed to parse JSON:', e.message);
      return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }
    
    // Extract token from all possible locations
    const token = body.token || body?.body?.token || body?.data?.token;
    console.log('🎫 Extracted token:', token);
    
    if (!token) {
      console.error('❌ No token found in body:', JSON.stringify(body, null, 2));
      return Response.json({ success: false, error: 'Token required' }, { status: 400 });
    }

    console.log('🔎 Querying session with token:', token);
    const sessions = await base44.asServiceRole.entities.ContractSigningSession.filter({ signing_token: token });
    console.log('📊 Found sessions:', sessions.length);
    
    if (!sessions || sessions.length === 0) {
      console.error('❌ No session found for token:', token);
      return Response.json({ success: false, error: 'Invalid signing link' }, { status: 404 });
    }

    const session = sessions[0];
    console.log('✅ Found session ID:', session.id);
    
    console.log('🔎 Querying template with ID:', session.template_id);
    const templates = await base44.asServiceRole.entities.ContractTemplate.filter({ id: session.template_id });
    console.log('📊 Found templates:', templates.length);
    
    if (!templates || templates.length === 0) {
      console.error('❌ No template found for ID:', session.template_id);
      return Response.json({ success: false, error: 'Template not found' }, { status: 404 });
    }
    
    const template = templates[0];
    console.log('✅ Found template ID:', template.id);
    console.log('✅ Returning success response');

    return new Response(JSON.stringify({
      success: true,
      session,
      template
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error('❌ Stack:', error.stack);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
});