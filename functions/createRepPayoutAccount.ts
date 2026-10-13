import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { staffProfileId, companyId } = body || {};

    if (!staffProfileId || !companyId) {
      return Response.json({ error: 'staffProfileId and companyId are required' }, { status: 400 });
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') ||
                     Deno.env.get('STRIPE_API_KEY') ||
                     Deno.env.get('Stripe_API_KEY') ||
                     Deno.env.get('Stripe_Secret_Key');
    if (!stripeKey) return Response.json({ error: 'Stripe not configured' }, { status: 500 });

    const stripe = new Stripe(stripeKey);

    // Verify caller is admin of this company
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    if (!company) return Response.json({ error: 'Company not found' }, { status: 404 });

    const callerProfiles = await base44.entities.StaffProfile.filter({ company_id: companyId, user_email: user.email });
    const callerProfile = callerProfiles[0];
    const isOwner = company.created_by === user.email;
    const isAdmin = isOwner || callerProfile?.is_administrator === true || callerProfile?.role === 'admin';
    if (!isAdmin) return Response.json({ error: 'Admin access required' }, { status: 403 });

    // Load the rep's staff profile
    const repProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ id: staffProfileId });
    const repProfile = repProfiles[0];
    if (!repProfile) return Response.json({ error: 'Rep not found' }, { status: 404 });
    if (repProfile.company_id !== companyId) return Response.json({ error: 'Rep belongs to a different company' }, { status: 403 });

    const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
    const repEmail = repProfile.email || repProfile.user_email || '';

    // If rep already has an Express account, return a refresh link
    const existingAccountId = repProfile.data?.stripe_express_account_id;
    if (existingAccountId) {
      const accountLink = await stripe.accountLinks.create({
        account: existingAccountId,
        refresh_url: `${appUrl}/settings?rep_payout_refresh=true`,
        return_url: `${appUrl}/settings?rep_payout_connected=true`,
        type: 'account_onboarding',
      });
      return Response.json({
        success: true,
        account_id: existingAccountId,
        onboarding_url: accountLink.url,
        existing: true,
      });
    }

    // Create Stripe Express account for the rep
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: repEmail || undefined,
      capabilities: {
        transfers: { requested: true },
      },
      settings: {
        payouts: {
          schedule: { interval: 'manual' },
        },
      },
      metadata: {
        staff_profile_id: staffProfileId,
        company_id: companyId,
        rep_name: repProfile.full_name || repProfile.name || '',
      },
    });

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${appUrl}/settings?rep_payout_refresh=true`,
      return_url: `${appUrl}/settings?rep_payout_connected=true`,
      type: 'account_onboarding',
    });

    // Save to StaffProfile data
    await base44.asServiceRole.entities.StaffProfile.update(staffProfileId, {
      data: {
        ...(repProfile.data || {}),
        stripe_express_account_id: account.id,
        stripe_payout_status: 'pending',
      },
    });

    return Response.json({
      success: true,
      account_id: account.id,
      onboarding_url: accountLink.url,
      existing: false,
    });

  } catch (error) {
    console.error('❌ createRepPayoutAccount error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
