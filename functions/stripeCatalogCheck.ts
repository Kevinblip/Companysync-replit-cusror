import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import Stripe from 'npm:stripe@16.6.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const apiKey = Deno.env.get('STRIPE_SECRET_KEY') || Deno.env.get('Stripe_API_KEY');
    if (!apiKey) return Response.json({ error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 });

    const stripe = new Stripe(apiKey, { apiVersion: '2024-06-20' });

    try {
      const products = await stripe.products.list({ limit: 5 });
      return Response.json({ success: true, count: products.data.length });
    } catch (e) {
      return Response.json({
        success: false,
        error: e.message,
        hint: 'Stripe has IP allowlist enabled. Add this app’s server IP to Stripe or use a restricted key.'
      }, { status: 200 });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});