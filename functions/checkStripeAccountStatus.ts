import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || 
                            Deno.env.get('STRIPE_API_KEY') || 
                            Deno.env.get('Stripe_API_KEY') || 
                            Deno.env.get('Stripe_Secret_Key');
    if (!stripeSecretKey) {
      return Response.json({ error: 'Stripe not configured' }, { status: 500 });
    }

    const stripe = new Stripe(stripeSecretKey);

    // Get company
    const companies = await base44.entities.Company.filter({ created_by: user.email });
    const company = companies[0];

    if (!company || !company.stripe_account_id) {
      return Response.json({ 
        connected: false,
        onboarding_complete: false 
      });
    }

    // Retrieve account from Stripe
    const account = await stripe.accounts.retrieve(company.stripe_account_id);

    const onboardingComplete = account.charges_enabled && account.payouts_enabled;

    // Update company status
    await base44.entities.Company.update(company.id, {
      stripe_onboarding_status: onboardingComplete ? 'complete' : 'pending',
      stripe_charges_enabled: account.charges_enabled,
      stripe_payouts_enabled: account.payouts_enabled
    });

    return Response.json({
      connected: true,
      onboarding_complete: onboardingComplete,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      account_id: account.id,
      details_submitted: account.details_submitted,
      requirements: account.requirements
    });

  } catch (error) {
    console.error('❌ Error checking Stripe status:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});