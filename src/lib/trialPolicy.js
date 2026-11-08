/**
 * New-company trial rules.
 *
 * A brand-new company trial is 14 days and does not require a card.
 * Any stored trial end — including a 30-day promise, a 21-day card bonus,
 * or an already-expired date — is returned unchanged. This module never
 * takes the shorter of the stored end and a new 14-day end.
 *
 * Card-bonus policy that is intentionally NOT decided here: checkout still
 * offers the pre-existing 21-day Stripe trial only when the company has no
 * stored end and the caller passes extend_trial=7. Adding 7 days on top of
 * a stored end, or removing that offer for future signups, needs an explicit
 * Kevin and Rad decision. This module does neither.
 */

export const NEW_COMPANY_TRIAL_DAYS = 14;
export const NEW_COMPANY_TRIAL_MS = NEW_COMPANY_TRIAL_DAYS * 24 * 60 * 60 * 1000;
export const NEW_COMPANY_TRIAL_REQUIRES_CARD = false;
export const EXISTING_CARD_BONUS_TRIAL_DAYS = 21;

const PROTECTED_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'past_due',
  'cancelled',
  'canceled',
  'expired',
  'suspended',
  'unpaid',
]);

const KNOWN_PAID_PLANS = new Set([
  'basic',
  'business',
  'enterprise',
  'professional',
  'starter',
  'freelance',
]);

export function parseCompanyData(company) {
  if (!company) return {};
  const raw = company.data;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

function firstTimestamp(values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

export function readStoredTrialEnd(company) {
  if (!company) return null;
  const data = parseCompanyData(company);
  return firstTimestamp([
    company.trial_ends_at,
    company.trial_end_date,
    data.trial_ends_at,
    data.trial_end_date,
  ]);
}

export function readSubscriptionStatus(company) {
  if (!company) return '';
  const data = parseCompanyData(company);
  return String(company.subscription_status || data.subscription_status || '').trim().toLowerCase();
}

export function readStripeSubscriptionId(company) {
  if (!company) return '';
  const data = parseCompanyData(company);
  return String(company.stripe_subscription_id || data.stripe_subscription_id || '').trim();
}

export function readPlan(company) {
  if (!company) return '';
  const data = parseCompanyData(company);
  return String(company.subscription_plan || data.subscription_plan || '').trim().toLowerCase();
}

export function addDays(now, days) {
  const start = now instanceof Date ? now : new Date(now);
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

export function newCompanyTrialRecord(now = new Date()) {
  const start = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  const end = addDays(start, NEW_COMPANY_TRIAL_DAYS);
  const iso = end.toISOString();
  return {
    trialDays: NEW_COMPANY_TRIAL_DAYS,
    requiresCard: NEW_COMPANY_TRIAL_REQUIRES_CARD,
    startedAt: start.toISOString(),
    trial_ends_at: iso,
    trial_end_date: iso,
    subscription_status: 'trial',
  };
}

/**
 * A trial clock may be written only for a row that has never had a status,
 * a stored end, or a Stripe subscription. Any existing status, including
 * "trial", is left alone so a retry cannot restart the clock.
 */
export function canInitializeTrial(company) {
  if (!company || typeof company !== 'object') return false;
  if (readStoredTrialEnd(company)) return false;
  if (readSubscriptionStatus(company)) return false;
  if (readStripeSubscriptionId(company)) return false;
  if (KNOWN_PAID_PLANS.has(readPlan(company))) return false;
  return true;
}

export function planSubscriptionCheckoutTrial(company, metadata = {}, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const stored = readStoredTrialEnd(company);
  const status = readSubscriptionStatus(company);

  if (PROTECTED_SUBSCRIPTION_STATUSES.has(status)) {
    return {
      action: 'no_trial_on_existing_subscription',
      trial_period_days: null,
      trial_end: null,
      storedTrialEnd: stored,
    };
  }

  if (stored) {
    const storedMs = new Date(stored).getTime();
    if (storedMs > nowDate.getTime()) {
      return {
        action: 'preserve_stored_end',
        trial_period_days: null,
        trial_end: Math.floor(storedMs / 1000),
        storedTrialEnd: stored,
      };
    }
    return {
      action: 'preserve_expired_end',
      trial_period_days: null,
      trial_end: null,
      storedTrialEnd: stored,
    };
  }

  if (KNOWN_PAID_PLANS.has(readPlan(company))) {
    return {
      action: 'no_trial_on_existing_subscription',
      trial_period_days: null,
      trial_end: null,
      storedTrialEnd: null,
    };
  }

  const extend = String(metadata?.extend_trial ?? '') === '7';
  const days = extend ? EXISTING_CARD_BONUS_TRIAL_DAYS : NEW_COMPANY_TRIAL_DAYS;
  return {
    action: extend ? 'existing_card_bonus_offer' : 'new_trial',
    trial_period_days: days,
    trial_end: null,
    proposedTrialEnd: addDays(nowDate, days).toISOString(),
    storedTrialEnd: null,
  };
}

export function applyCheckoutTrial(sessionConfig, trialPlan) {
  const next = sessionConfig;
  next.subscription_data = next.subscription_data || {};
  next.subscription_data.metadata = next.subscription_data.metadata || {};
  delete next.subscription_data.trial_period_days;
  delete next.subscription_data.trial_end;
  if (trialPlan.trial_end) {
    next.subscription_data.trial_end = trialPlan.trial_end;
  } else if (trialPlan.trial_period_days) {
    next.subscription_data.trial_period_days = trialPlan.trial_period_days;
  }
  next.subscription_data.metadata.bonus_days_applied = trialPlan.action === 'existing_card_bonus_offer' ? '7' : '0';
  return next;
}

export function planCheckoutSessionCompleted({ company, session, now = new Date() }) {
  const stored = company ? readStoredTrialEnd(company) : null;
  const purchaseType = session?.metadata?.purchase_type;

  if (purchaseType === 'credits') {
    return { action: 'credits_unchanged', update: null, notify: false, trialEnd: stored };
  }

  const amount = Number(session?.amount_total || 0);
  if (amount > 0 || session?.mode === 'payment') {
    return { action: 'paid_checkout_preserve', update: null, notify: false, trialEnd: stored };
  }

  if (!canInitializeTrial(company)) {
    return { action: 'preserve_existing', update: null, notify: false, trialEnd: stored };
  }

  const trial = newCompanyTrialRecord(now);
  return {
    action: 'initialize_new_trial',
    update: {
      subscription_status: trial.subscription_status,
      trial_ends_at: trial.trial_ends_at,
      trial_end_date: trial.trial_end_date,
    },
    notify: true,
    trialEnd: trial.trial_ends_at,
    trialDays: trial.trialDays,
    requiresCard: trial.requiresCard,
  };
}

export function reduceTrialClaim(company, session, now = new Date()) {
  const decision = planCheckoutSessionCompleted({ company, session, now });
  if (!decision.update) {
    return { claimed: false, notify: false, company, decision };
  }
  return {
    claimed: true,
    notify: true,
    company: { ...company, ...decision.update },
    decision,
  };
}

/**
 * Atomic claim for a Postgres companies row. Matches canInitializeTrial:
 * no stored end in either field, no status, no Stripe subscription.
 * A second delivery updates zero rows and must not send mail.
 */
export const NEW_TRIAL_CLAIM_SQL = `UPDATE companies
  SET subscription_status = 'trial',
      trial_end_date = $2::timestamptz,
      data = jsonb_set(
        jsonb_set(
          jsonb_set(COALESCE(data, '{}'::jsonb), '{trial_ends_at}', to_jsonb($3::text), true),
          '{trial_end_date}', to_jsonb($3::text), true
        ),
        '{subscription_status}', '"trial"'::jsonb, true
      ),
      updated_at = NOW()
  WHERE id = $1
    AND trial_end_date IS NULL
    AND COALESCE(data->>'trial_ends_at', '') = ''
    AND COALESCE(data->>'trial_end_date', '') = ''
    AND COALESCE(subscription_status, '') = ''
    AND COALESCE(data->>'subscription_status', '') = ''
    AND COALESCE(stripe_subscription_id, '') = ''
    AND COALESCE(data->>'stripe_subscription_id', '') = ''
    AND COALESCE(subscription_plan, '') NOT IN ('basic', 'business', 'enterprise', 'professional', 'starter', 'freelance')
    AND COALESCE(data->>'subscription_plan', '') NOT IN ('basic', 'business', 'enterprise', 'professional', 'starter', 'freelance')
  RETURNING id, trial_end_date`;

export function evaluateVoiceTrialAccess(company, now = new Date()) {
  if (!company) return { allowed: true, plan: null, status: null };
  const data = parseCompanyData(company);
  const plan = String(company.subscription_plan || data.subscription_plan || 'trial').toLowerCase();
  const status = String(company.subscription_status || data.subscription_status || 'active').toLowerCase();
  const storedEnd = readStoredTrialEnd(company);
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const trialExpired = data.trial_expired === true || (storedEnd != null && new Date(storedEnd).getTime() < nowMs);
  const stripeSub = readStripeSubscriptionId(company);

  if (status === 'cancelled' || status === 'suspended') {
    return {
      allowed: false,
      reason: `Subscription ${status}. Please contact support to reactivate.`,
      plan,
      status,
    };
  }

  if (stripeSub) {
    return { allowed: true, plan, status };
  }

  if (trialExpired && (plan === 'trial' || status === 'trial')) {
    return {
      allowed: false,
      reason: 'Trial expired. Please upgrade to continue using voice features.',
      plan,
      status,
    };
  }

  return { allowed: true, plan, status };
}

export const APPROVED_PLAN_PRICES = Object.freeze({
  basic: 99,
  business: 199,
  enterprise: 399,
});

export const APPROVED_PLAN_PRICE_IDS = Object.freeze({
  basic: 'price_1T4QXjAKHCJVDE3AFy2GSbsc',
  business: 'price_1T4QXkAKHCJVDE3A38GIMRYi',
  enterprise: 'price_1T4QXkAKHCJVDE3ADvXtp806',
});
