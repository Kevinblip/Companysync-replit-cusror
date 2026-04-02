import Stripe from 'npm:stripe@17.5.0';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || 
                            Deno.env.get('STRIPE_API_KEY') || 
                            Deno.env.get('Stripe_API_KEY') || 
                            Deno.env.get('Stripe_Secret_Key');
    const webhookSecret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET') || Deno.env.get('STRIPE_WEBHOOK_SECRET');
    
    if (!stripeSecretKey || !webhookSecret) {
      return Response.json({ error: 'Stripe not configured' }, { status: 500 });
    }

    const stripe = new Stripe(stripeSecretKey);
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return Response.json({ error: 'No signature' }, { status: 400 });
    }

    // Verify webhook signature
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    console.log('🔔 Stripe Connect webhook:', event.type);

    const base44 = createClientFromRequest(req);

    // Handle account updates
    if (event.type === 'account.updated') {
      const account = event.data.object;
      
      // Find company by stripe account ID
      const companies = await base44.asServiceRole.entities.Company.filter({ 
        stripe_account_id: account.id 
      });

      if (companies.length > 0) {
        const company = companies[0];
        
        await base44.asServiceRole.entities.Company.update(company.id, {
          stripe_onboarding_status: account.charges_enabled && account.payouts_enabled ? 'complete' : 'pending',
          stripe_charges_enabled: account.charges_enabled,
          stripe_payouts_enabled: account.payouts_enabled,
          stripe_details_submitted: account.details_submitted
        });

        console.log('✅ Updated company Stripe status:', company.company_name);
      }
    }

    return Response.json({ received: true });

  } catch (error) {
    console.error('❌ Stripe webhook error:', error);
    return Response.json({ error: error.message }, { status: 400 });
  }
});