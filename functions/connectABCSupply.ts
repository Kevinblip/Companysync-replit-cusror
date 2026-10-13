import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Step 1: Initiate OAuth flow - redirects user to ABC Supply authorization page
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify user is authenticated
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clientId = Deno.env.get('ABC_SUPPLY_CLIENT_ID');
    const redirectUri = `${Deno.env.get('APP_URL')}/api/functions/abcSupplyCallback`;
    
    if (!clientId) {
      return Response.json({ 
        error: 'ABC Supply integration not configured. Please contact support.' 
      }, { status: 500 });
    }

    // Build OAuth authorization URL
    const authUrl = new URL('https://partners.abcsupply.com/api/oauth/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'order:write');
    authUrl.searchParams.set('state', user.email); // Track which user is connecting

    // Redirect user to ABC Supply OAuth page
    return Response.redirect(authUrl.toString(), 302);

  } catch (error) {
    console.error('❌ ABC Supply OAuth initiation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});