'use strict';

// Stripe key names got swapped in some environments: STRIPE_SECRET_KEY holds
// a whsec_ signing secret and STRIPE_API_KEY holds the sk_ key. Pick by
// prefix so either name still works, and never use a webhook secret as an API key.

function firstWithPrefix(values, prefix) {
  for (const value of values) {
    if (typeof value === 'string' && value.startsWith(prefix)) return value;
  }
  return null;
}

function resolveStripeApiKey(env = process.env) {
  return firstWithPrefix([env.STRIPE_API_KEY, env.STRIPE_SECRET_KEY], 'sk_');
}

function resolveStripeWebhookSecret(env = process.env) {
  return firstWithPrefix([
    env.STRIPE_WEBHOOK_SECRET,
    env.STRIPE_SECRET_KEY,
    env.STRIPE_API_KEY,
  ], 'whsec_');
}

// App-facing companies.subscription_status. Stripe's own status string stays
// on stripe_subscription_status for the MRR card.
function mapAppSubscriptionStatus(stripeStatus, { deleted = false } = {}) {
  if (deleted) return 'cancelled';
  const status = String(stripeStatus || '').toLowerCase();
  if (status === 'active') return 'active';
  if (status === 'trialing') return 'trial';
  if (status === 'past_due' || status === 'unpaid') return 'past_due';
  if (status === 'canceled' || status === 'cancelled') return 'cancelled';
  if (status === 'incomplete_expired') return 'expired';
  if (status === 'incomplete') return 'trial';
  return 'trial';
}

module.exports = {
  resolveStripeApiKey,
  resolveStripeWebhookSecret,
  mapAppSubscriptionStatus,
};
