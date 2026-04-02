import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  console.log('🔌 [START] Testing Symbility SOAP Connection...');
  
  try {
    // Step 1: Auth
    console.log('👤 Step 1: Authenticating user...');
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      console.error('❌ No user authenticated');
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    console.log('✅ User authenticated:', user.email);

    // Step 2: Parse request body
    console.log('📦 Step 2: Parsing request body...');
    let body;
    try {
      body = await req.json();
      console.log('✅ Body parsed successfully');
    } catch (parseError) {
      console.error('❌ Failed to parse request body:', parseError);
      return Response.json({ 
        success: false, 
        error: 'Invalid request format: ' + parseError.message 
      });
    }

    const { orgId, username, password, apiKey, soapUrl } = body;

    console.log('📋 Connection details:', {
      orgId: orgId || 'MISSING',
      soapUrl: soapUrl || 'MISSING',
      hasUsername: !!username,
      hasPassword: !!password,
      hasApiKey: !!apiKey,
      credentialsMatch: username === password
    });

    // Step 3: Validate required fields
    console.log('✔️ Step 3: Validating fields...');
    if (!orgId || !username || !password || !apiKey || !soapUrl) {
      console.error('❌ Missing required fields');
      return Response.json({
        success: false,
        error: 'Missing required fields. Please fill in Organization ID, Username, Password, and API Key.'
      });
    }

    if (username !== password) {
      console.error('❌ Username and password do not match');
      return Response.json({
        success: false,
        error: 'Username and Password must be IDENTICAL for Symbility authentication (lock and key model).'
      });
    }

    // Step 4: Create SOAP request
    console.log('📝 Step 4: Creating SOAP envelope...');
    const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sym="http://symbility.com/">
  <soapenv:Header/>
  <soapenv:Body>
    <sym:getVersion>
      <orgId>${orgId}</orgId>
      <apiKey>${apiKey}</apiKey>
    </sym:getVersion>
  </soapenv:Body>
</soapenv:Envelope>`;

    console.log('✅ SOAP envelope created');

    // Step 5: Send SOAP request
    console.log('📤 Step 5: Sending SOAP request to:', soapUrl);
    let response;
    try {
      response = await fetch(soapUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'getVersion'
        },
        body: soapEnvelope
      });
      console.log('✅ SOAP request sent, status:', response.status);
    } catch (fetchError) {
      console.error('❌ Fetch failed:', fetchError);
      return Response.json({
        success: false,
        error: 'Failed to connect to Symbility: ' + fetchError.message
      });
    }

    // Step 6: Read response
    console.log('📥 Step 6: Reading SOAP response...');
    const responseText = await response.text();
    console.log('📄 Response length:', responseText.length);
    console.log('📄 Response preview:', responseText.substring(0, 300));

    if (!response.ok) {
      console.error('❌ SOAP request failed with status:', response.status);
      return Response.json({
        success: false,
        error: `SOAP request failed with status ${response.status}. Check credentials and Organization ID.`,
        details: responseText.substring(0, 500)
      });
    }

    // Step 7: Check for SOAP fault
    console.log('🔍 Step 7: Checking for SOAP faults...');
    if (responseText.includes('soap:Fault') || responseText.includes('faultstring')) {
      const faultMatch = responseText.match(/<faultstring>(.*?)<\/faultstring>/);
      const faultMessage = faultMatch ? faultMatch[1] : 'Unknown SOAP error';
      
      console.error('❌ SOAP Fault:', faultMessage);
      
      return Response.json({
        success: false,
        error: `Symbility returned an error: ${faultMessage}`,
        details: responseText.substring(0, 500)
      });
    }

    // Step 8: Extract version
    console.log('🔍 Step 8: Extracting version...');
    const versionMatch = responseText.match(/<return>(.*?)<\/return>/) || 
                        responseText.match(/<version>(.*?)<\/version>/);
    const version = versionMatch ? versionMatch[1] : 'Unknown';

    console.log('✅ [SUCCESS] Connection successful! Symbility version:', version);

    return Response.json({
      success: true,
      message: `Successfully connected to Symbility!\n\nAPI Version: ${version}\nOrganization: ${orgId}\n\nYou can now import price lists.`,
      version: version
    });

  } catch (error) {
    console.error('❌ [FATAL ERROR] Symbility test error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return Response.json({
      success: false,
      error: 'Function error: ' + error.message,
      errorName: error.name,
      stack: error.stack
    }, { status: 500 });
  }
});