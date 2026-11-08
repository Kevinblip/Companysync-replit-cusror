import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@16.6.0';
/* TRIAL_POLICY_START */
const NEW_COMPANY_TRIAL_MS = 14 * 24 * 60 * 60 * 1000;
const PROTECTED_SUBSCRIPTION_STATUSES = new Set(['active', 'past_due', 'cancelled', 'canceled', 'expired', 'suspended', 'unpaid']);
const KNOWN_PAID_PLANS = new Set(['basic', 'business', 'enterprise', 'professional', 'starter', 'freelance']);

function snippetParseData(company) {
  if (!company || !company.data) return {};
  if (typeof company.data === 'string') {
    try { const parsed = JSON.parse(company.data); return parsed && typeof parsed === 'object' ? parsed : {}; }
    catch { return {}; }
  }
  return typeof company.data === 'object' ? company.data : {};
}
function snippetFirstTimestamp(values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}
function snippetReadStoredTrialEnd(company) {
  if (!company) return null;
  const data = snippetParseData(company);
  return snippetFirstTimestamp([company.trial_ends_at, company.trial_end_date, data.trial_ends_at, data.trial_end_date]);
}
function snippetReadStatus(company) {
  if (!company) return '';
  const data = snippetParseData(company);
  return String(company.subscription_status || data.subscription_status || '').trim().toLowerCase();
}
function snippetReadPlan(company) {
  if (!company) return '';
  const data = snippetParseData(company);
  return String(company.subscription_plan || data.subscription_plan || '').trim().toLowerCase();
}
function snippetReadStripeId(company) {
  if (!company) return '';
  const data = snippetParseData(company);
  return String(company.stripe_subscription_id || data.stripe_subscription_id || '').trim();
}
function newCompanyTrialRecord(now = new Date()) {
  const start = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  const iso = new Date(start.getTime() + NEW_COMPANY_TRIAL_MS).toISOString();
  return { trialDays: 14, requiresCard: false, startedAt: start.toISOString(), trial_ends_at: iso, trial_end_date: iso, subscription_status: 'trial' };
}
function planSubscriptionCheckoutTrial(company, metadata = {}, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const stored = snippetReadStoredTrialEnd(company);
  const status = snippetReadStatus(company);
  if (PROTECTED_SUBSCRIPTION_STATUSES.has(status)) {
    return { action: 'no_trial_on_existing_subscription', trial_period_days: null, trial_end: null, storedTrialEnd: stored };
  }
  if (stored) {
    const storedMs = new Date(stored).getTime();
    if (storedMs > nowDate.getTime()) {
      return { action: 'preserve_stored_end', trial_period_days: null, trial_end: Math.floor(storedMs / 1000), storedTrialEnd: stored };
    }
    return { action: 'preserve_expired_end', trial_period_days: null, trial_end: null, storedTrialEnd: stored };
  }
  if (KNOWN_PAID_PLANS.has(snippetReadPlan(company)) || snippetReadStripeId(company)) {
    return { action: 'no_trial_on_existing_subscription', trial_period_days: null, trial_end: null, storedTrialEnd: null };
  }
  const extend = String(metadata?.extend_trial ?? '') === '7';
  const days = extend ? 21 : 14;
  return {
    action: extend ? 'existing_card_bonus_offer' : 'new_trial',
    trial_period_days: days,
    trial_end: null,
    proposedTrialEnd: new Date(nowDate.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
    storedTrialEnd: null,
  };
}
function applyCheckoutTrial(sessionConfig, trialPlan) {
  const next = sessionConfig;
  next.subscription_data = next.subscription_data || {};
  next.subscription_data.metadata = next.subscription_data.metadata || {};
  delete next.subscription_data.trial_period_days;
  delete next.subscription_data.trial_end;
  if (trialPlan.trial_end) next.subscription_data.trial_end = trialPlan.trial_end;
  else if (trialPlan.trial_period_days) next.subscription_data.trial_period_days = trialPlan.trial_period_days;
  next.subscription_data.metadata.bonus_days_applied = trialPlan.action === 'existing_card_bonus_offer' ? '7' : '0';
  return next;
}
/* TRIAL_POLICY_END */

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