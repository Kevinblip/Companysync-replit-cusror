import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { customer_id } = await req.json();

    if (!customer_id) {
      return Response.json({ error: 'customer_id required' }, { status: 400 });
    }

    // Generate a secure random token
    const token = crypto.randomUUID() + '-' + Date.now();
    
    // Update customer with the portal token
    await base44.asServiceRole.entities.Customer.update(customer_id, {
      portal_token: token,
      portal_token_created: new Date().toISOString()
    });

    const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
    const portalUrl = `${appUrl}/customer-portal-public?token=${token}`;

    return Response.json({
      success: true,
      portal_url: portalUrl
    });
  } catch (error) {
    console.error('Error generating portal link:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});