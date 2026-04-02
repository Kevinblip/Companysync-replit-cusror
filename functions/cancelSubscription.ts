import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import Stripe from 'npm:stripe@17.5.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { companyId, stripeSubscriptionId } = await req.json();

    if (!companyId || !stripeSubscriptionId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Cancel the subscription at period end (customer keeps access until billing period ends)
    const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true
    });

    // Update company status
    await base44.asServiceRole.entities.Company.update(companyId, {
      subscription_status: 'cancelled'
    });

    return Response.json({ 
      success: true,
      cancel_at: subscription.cancel_at,
      message: 'Subscription will be cancelled at the end of the billing period'
    });

  } catch (error) {
    console.error('Cancel subscription error:', error);
    return Response.json({ 
      error: error.message || 'Failed to cancel subscription' 
    }, { status: 500 });
  }
});