import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 Testing QuickBooks connection...');

    // Get QuickBooks credentials
    const clientId = Deno.env.get('QUICKBOOKS_CLIENT_ID');
    const clientSecret = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');
    const refreshToken = Deno.env.get('QUICKBOOKS_REFRESH_TOKEN');
    const realmId = Deno.env.get('QUICKBOOKS_REALM_ID');

    console.log('✅ Client ID:', clientId ? 'Set' : 'Missing');
    console.log('✅ Client Secret:', clientSecret ? 'Set' : 'Missing');
    console.log('✅ Refresh Token:', refreshToken ? 'Set' : 'Missing');
    console.log('✅ Realm ID:', realmId ? 'Set' : 'Missing');

    if (!clientId || !clientSecret || !refreshToken || !realmId) {
      return Response.json({ 
        error: 'QuickBooks credentials not configured',
        missing: {
          clientId: !clientId,
          clientSecret: !clientSecret,
          refreshToken: !refreshToken,
          realmId: !realmId
        }
      }, { status: 400 });
    }

    console.log('🔄 Refreshing access token...');

    // Refresh access token
    const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`)
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });

    console.log('Token response status:', tokenResponse.status);

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Token refresh failed:', errorText);
      return Response.json({ 
        error: 'Failed to refresh token', 
        status: tokenResponse.status,
        details: errorText 
      }, { status: 500 });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    console.log('✅ Access token obtained');
    console.log('🔍 Testing API call to QuickBooks...');

    // Test QuickBooks API
    const apiBase = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}`;
    
    const companyInfoResponse = await fetch(`${apiBase}/companyinfo/${realmId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    console.log('Company info response status:', companyInfoResponse.status);

    if (!companyInfoResponse.ok) {
      const errorText = await companyInfoResponse.text();
      console.error('❌ API call failed:', errorText);
      return Response.json({ 
        error: 'QuickBooks API call failed',
        status: companyInfoResponse.status,
        details: errorText 
      }, { status: 500 });
    }

    const companyInfo = await companyInfoResponse.json();

    console.log('✅ SUCCESS! Connected to:', companyInfo.CompanyInfo.CompanyName);

    return Response.json({
      success: true,
      company_name: companyInfo.CompanyInfo.CompanyName,
      realm_id: realmId,
      message: '✅ QuickBooks Sandbox connection successful!'
    });

  } catch (error) {
    console.error('❌ Test error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});