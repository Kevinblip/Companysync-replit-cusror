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

    const repProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ id: staffProfileId });
    const repProfile = repProfiles[0];
    if (!repProfile) return Response.json({ error: 'Rep not found' }, { status: 404 });
    if (repProfile.company_id !== companyId) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const accountId = repProfile.data?.stripe_express_account_id;
    if (!accountId) {
      return Response.json({ connected: false, payouts_enabled: false });
    }

    const account = await stripe.accounts.retrieve(accountId);
    const payoutsEnabled = account.payouts_enabled === true;
    const detailsSubmitted = account.details_submitted === true;
    const newStatus = payoutsEnabled ? 'active' : (detailsSubmitted ? 'review' : 'pending');

    // Sync status back to StaffProfile if changed
    if (repProfile.data?.stripe_payout_status !== newStatus) {
      await base44.asServiceRole.entities.StaffProfile.update(staffProfileId, {
        data: {
          ...(repProfile.data || {}),
          stripe_payout_status: newStatus,
        },
      });
    }

    return Response.json({
      connected: true,
      payouts_enabled: payoutsEnabled,
      details_submitted: detailsSubmitted,
      account_id: accountId,
      status: newStatus,
      requirements: account.requirements,
    });

  } catch (error) {
    console.error('❌ checkRepPayoutAccount error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
