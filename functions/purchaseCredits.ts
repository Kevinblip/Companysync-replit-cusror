import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import Stripe from 'npm:stripe@17.5.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { type, credits, amount } = await req.json();

    if (!type || !credits || !amount) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get company to ensure user belongs to it
    const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
    if (!staffProfiles || staffProfiles.length === 0) {
        // Fallback for owner
        const ownedCompanies = await base44.entities.Company.filter({ created_by: user.email });
        if (!ownedCompanies || ownedCompanies.length === 0) {
             return Response.json({ error: 'Company not found' }, { status: 404 });
        }
    }
    
    // We need the company ID. 
    // Best practice: Use the first company found for now or pass company_id from frontend. 
    // Assuming single company context for simplicity or derived from user.
    // Let's re-fetch with a robust method if possible, or trust the frontend if we validated there.
    // Actually, `checkSubscriptionLimit` uses `company_id`.
    // Let's get company_id from staff profile or ownership.
    let companyId;
    if (staffProfiles.length > 0) {
        companyId = staffProfiles[0].company_id;
    } else {
        const owned = await base44.entities.Company.filter({ created_by: user.email });
        if (owned.length > 0) companyId = owned[0].id;
    }

    if (!companyId) {
        return Response.json({ error: 'Company ID not found' }, { status: 404 });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${credits} AI Credits`,
              description: `Add ${credits} credits for ${type.replace('_', ' ').toUpperCase()}`,
            },
            unit_amount: amount * 100, // Amount in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${Deno.env.get('APP_URL')}/AIEstimator?success=true`,
      cancel_url: `${Deno.env.get('APP_URL')}/AIEstimator?canceled=true`,
      metadata: {
        company_id: companyId,
        purchase_type: 'credits',
        credit_type: type, // e.g. 'ai_estimator'
        credits: credits,
        user_email: user.email
      },
      customer_email: user.email,
    });

    return Response.json({ success: true, url: session.url });

  } catch (error) {
    console.error('Purchase error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});