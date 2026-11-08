import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@16.6.0';
import { applyCheckoutTrial, planSubscriptionCheckoutTrial } from '../src/lib/trialPolicy.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { priceId, mode = 'payment', successPath = '/SubscriptionSuccess', cancelPath = '/SubscriptionCancel', companyId, planName, metadata = {} } = body || {};

    console.log('🎯 Checkout request:', { priceId, mode, companyId, planName, userEmail: user.email });

    if (!priceId) return Response.json({ error: 'priceId is required' }, { status: 400 });

    const apiKey = Deno.env.get('STRIPE_SECRET_KEY') || 
                   Deno.env.get('STRIPE_API_KEY') || 
                   Deno.env.get('Stripe_API_KEY') || 
                   Deno.env.get('Stripe_Secret_Key');
    if (!apiKey) {
      console.error('❌ Missing Stripe API key');
      return Response.json({ error: 'Stripe not configured' }, { status: 500 });
    }

    const stripe = new Stripe(apiKey, { apiVersion: '2024-06-20' });

    // Get or create Stripe customer
    let customerId = null;
    let checkoutCompany = null;
    if (companyId) {
      const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
      checkoutCompany = companies[0] || null;
      if (checkoutCompany?.stripe_customer_id) {
        customerId = checkoutCompany.stripe_customer_id;
      }
    }

    // Determine host
    const host = Deno.env.get('APP_URL') || (new URL(req.url)).origin;

    console.log('🔨 Creating Stripe session with:', { mode, host, customerId, priceId });

    const sessionConfig = {
      mode: mode === 'subscription' ? 'subscription' : 'payment',
      line_items: [ { price: priceId, quantity: 1 } ],
      success_url: `${host}${successPath}`,
      cancel_url: `${host}${cancelPath}`,
      customer_email: user.email,
      metadata: { 
        user_email: user.email, 
        company_id: companyId || '',
        plan_name: planName || '',
        ...metadata 
      }
    };

    if (customerId) {
      sessionConfig.customer = customerId;
    }

    if (mode === 'subscription') {
      const trialPlan = planSubscriptionCheckoutTrial(checkoutCompany, metadata);
      sessionConfig.subscription_data = {
        metadata: {
          company_id: companyId || '',
          plan_name: planName || '',
        }
      };
      applyCheckoutTrial(sessionConfig, trialPlan);
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log('✅ Session created:', session.id);

    return Response.json({ success: true, id: session.id, url: session.url });
  } catch (error) {
    console.error('💥 Checkout error:', error.message, error.stack);
    return Response.json({ 
      success: false, 
      error: error.message,
      details: error.type || 'unknown'
    }, { status: 500 });
  }
});