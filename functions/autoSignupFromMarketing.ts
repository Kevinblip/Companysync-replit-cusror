import { createClient } from 'npm:@base44/sdk@0.8.6';
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
        const { userData, companyData } = await req.json();

        if (!userData?.email || !companyData?.name) {
            return Response.json({ error: 'Email and company name are required' }, { status: 400 });
        }

        console.log('🔄 Auto-signup from marketing site for:', userData.email);

        // Create service role client
        const appId = Deno.env.get('BASE44_APP_ID');
        const serviceKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
        
        if (!appId || !serviceKey) {
            throw new Error('BASE44_APP_ID or BASE44_SERVICE_ROLE_KEY not configured');
        }

        const base44 = createClient(appId, serviceKey);

        // Check for existing account first
        const existingCompanies = await base44.asServiceRole.entities.Company.filter({ email: userData.email });
        const existingStaff = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: userData.email });

        if (existingCompanies.length > 0 || existingStaff.length > 0) {
             return Response.json({ 
                error: 'An account with this email already exists. Please log in instead.',
                redirect: '/login'
            }, { status: 400 });
        }

        // New company only. Existing emails already returned above.
        const trial = newCompanyTrialRecord();

        // Create company with trial settings
        const company = await base44.asServiceRole.entities.Company.create({
            company_name: companyData.name,
            email: userData.email,
            phone: userData.phone || companyData.phone || '',
            address: companyData.address || '',
            city: companyData.city || '',
            state: companyData.state || '',
            zip: companyData.zip || '',
            industry: companyData.industry || 'roofing',
            subscription_plan: companyData.plan_type || 'professional',
            subscription_status: trial.subscription_status,
            trial_ends_at: trial.trial_ends_at,
            trial_end_date: trial.trial_end_date,
            max_users: companyData.team_size ? parseInt(companyData.team_size) : 10,
            max_customers: 1000,
            setup_completed: false
        });

        console.log('✅ Company created:', company.id);

        // Invite user as admin
        const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
        await base44.asServiceRole.users.inviteUser(userData.email, 'admin', {
            redirectUrl: `${appUrl}/quick-setup`
        });

        console.log('✅ User invited:', userData.email);

        return Response.json({ 
            success: true,
            message: 'Account created! Check your email to complete setup.',
            company_id: company.id
        });

    } catch (error) {
        console.error('❌ Auto-signup error:', error);
        
        if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
            return Response.json({ 
                error: 'An account with this email already exists.',
                redirect: '/dashboard'
            }, { status: 400 });
        }
        
        return Response.json({ 
            error: error.message || 'Signup failed. Please try again.' 
        }, { status: 500 });
    }
});