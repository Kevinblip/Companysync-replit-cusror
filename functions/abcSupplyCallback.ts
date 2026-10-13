import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Step 2: Handle OAuth callback from ABC Supply
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state'); // user email
    const error = url.searchParams.get('error');

    if (error) {
      console.error('❌ ABC Supply OAuth error:', error);
      return Response.redirect(`${Deno.env.get('APP_URL')}/IntegrationManager?error=abc_auth_failed`, 302);
    }

    if (!code || !state) {
      return Response.json({ error: 'Missing authorization code or state' }, { status: 400 });
    }

    const clientId = Deno.env.get('ABC_SUPPLY_CLIENT_ID');
    const clientSecret = Deno.env.get('ABC_SUPPLY_CLIENT_SECRET');
    const redirectUri = `${Deno.env.get('APP_URL')}/api/functions/abcSupplyCallback`;

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://partners.abcsupply.com/api/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('❌ Token exchange failed:', errorData);
      return Response.redirect(`${Deno.env.get('APP_URL')}/IntegrationManager?error=token_exchange_failed`, 302);
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    // Find user's company
    const companies = await base44.asServiceRole.entities.Company.filter({ created_by: state });
    if (!companies || companies.length === 0) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }
    const company = companies[0];

    // Store or update integration settings
    const existingSettings = await base44.asServiceRole.entities.IntegrationSetting.filter({
      company_id: company.id,
      integration_name: 'ABC Supply'
    });

    const integrationConfig = {
      company_id: company.id,
      integration_name: 'ABC Supply',
      is_enabled: true,
      config: {
        access_token: access_token,
        refresh_token: refresh_token,
        expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
        connected_by: state,
        connected_at: new Date().toISOString()
      }
    };

    if (existingSettings.length > 0) {
      await base44.asServiceRole.entities.IntegrationSetting.update(existingSettings[0].id, integrationConfig);
    } else {
      await base44.asServiceRole.entities.IntegrationSetting.create(integrationConfig);
    }

    console.log('✅ ABC Supply connected successfully for company:', company.company_name);

    // Redirect back to Integration Manager with success message
    return Response.redirect(`${Deno.env.get('APP_URL')}/IntegrationManager?success=abc_connected`, 302);

  } catch (error) {
    console.error('❌ ABC Supply callback error:', error);
    return Response.redirect(`${Deno.env.get('APP_URL')}/IntegrationManager?error=callback_failed`, 302);
  }
});