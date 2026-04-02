import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

Deno.serve(async (req) => {
  try {
    console.log('🔵 Starting Stripe connection...');
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      console.error('❌ No user found');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ User authenticated:', user.email);

    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') || 
                            Deno.env.get('STRIPE_API_KEY') || 
                            Deno.env.get('Stripe_API_KEY') || 
                            Deno.env.get('Stripe_Secret_Key');
    if (!stripeSecretKey) {
      console.error('❌ STRIPE_SECRET_KEY not set');
      return Response.json({ error: 'Stripe not configured. Please contact support.' }, { status: 500 });
    }

    console.log('✅ Stripe key found');

    let stripe;
    try {
      stripe = new Stripe(stripeSecretKey);
      console.log('✅ Stripe SDK initialized');
    } catch (err) {
      console.error('❌ Failed to initialize Stripe:', err.message);
      return Response.json({ error: 'Failed to initialize Stripe SDK' }, { status: 500 });
    }

    // Get company
    console.log('🔍 Looking for company...');
    let companies, company;
    try {
      companies = await base44.entities.Company.filter({ created_by: user.email });
      company = companies[0];
    } catch (err) {
      console.error('❌ Failed to fetch company:', err.message);
      return Response.json({ error: 'Failed to fetch company data' }, { status: 500 });
    }

    if (!company) {
      console.error('❌ No company found for user:', user.email);
      return Response.json({ error: 'Company not found. Please set up your company profile first.' }, { status: 404 });
    }

    console.log('✅ Company found:', company.id);

    // Check if already connected
    if (company.stripe_account_id) {
      console.log('⚠️ Already connected:', company.stripe_account_id);
      // If already connected, return the onboarding link to continue setup
      const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
      const accountLink = await stripe.accountLinks.create({
        account: company.stripe_account_id,
        refresh_url: `${appUrl}/settings?stripe_refresh=true`,
        return_url: `${appUrl}/settings?stripe_connected=true`,
        type: 'account_onboarding',
      });
      
      return Response.json({
        success: true,
        account_id: company.stripe_account_id,
        onboarding_url: accountLink.url
      });
    }

    // Create connected account
    console.log('🔵 Creating Stripe account...');
    let account;
    try {
      account = await stripe.accounts.create({
        type: 'standard',
        email: user.email,
        business_type: 'company',
        metadata: {
          company_id: company.id,
          user_email: user.email
        }
      });
      console.log('✅ Created Stripe connected account:', account.id);
    } catch (err) {
      console.error('❌ Stripe account creation failed:', err.message);
      return Response.json({ 
        error: `Stripe account creation failed: ${err.message}`,
        stripe_error: err.type || 'unknown'
      }, { status: 500 });
    }

    // Create account link for onboarding
    const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
    let accountLink;
    try {
      accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${appUrl}/settings?stripe_refresh=true`,
        return_url: `${appUrl}/settings?stripe_connected=true`,
        type: 'account_onboarding',
      });
      console.log('✅ Created account link');
    } catch (err) {
      console.error('❌ Account link creation failed:', err.message);
      return Response.json({ 
        error: `Failed to create onboarding link: ${err.message}` 
      }, { status: 500 });
    }

    // Save account ID to company
    try {
      await base44.entities.Company.update(company.id, {
        stripe_account_id: account.id,
        stripe_onboarding_status: 'pending'
      });
      console.log('✅ Saved to company');
    } catch (err) {
      console.error('❌ Failed to save account ID:', err.message);
      // Continue anyway - account is created
    }

    return Response.json({
      success: true,
      account_id: account.id,
      onboarding_url: accountLink.url
    });

  } catch (error) {
    console.error('❌ Error creating connected account:', error);
    console.error('❌ Error stack:', error.stack);
    return Response.json({ 
      error: error.message || 'Unknown error occurred',
      details: error.toString()
    }, { status: 500 });
  }
});