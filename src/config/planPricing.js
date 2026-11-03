/**
 * Canonical CompanySync subscription plan display prices (USD / month).
 * Used for UI copy and Meta conversion event values.
 * Stripe Price IDs are unchanged — actual charge amounts live in Stripe.
 */
export const PLAN_MONTHLY_USD = Object.freeze({
  trial: 0,
  basic: 99,
  starter: 99,
  freelance: 99,
  business: 199,
  professional: 199,
  enterprise: 399,
  legacy: 199,
  unlimited: 399,
  lifetime: 399,
});

export const PLAN_STRIPE_PRICE_IDS = Object.freeze({
  basic: 'price_1T5NV8CAqGydUaCs2iO0R9yl',
  freelance: 'price_1T5NV8CAqGydUaCs2iO0R9yl',
  trial: 'price_1T5NV8CAqGydUaCs2iO0R9yl',
  business: 'price_1T5NV8CAqGydUaCsJ8SDQSnx',
  professional: 'price_1T5NV8CAqGydUaCsJ8SDQSnx',
  enterprise: 'price_1T5NV8CAqGydUaCs1kPhAuWo',
});

export function planMonthlyUsd(plan) {
  const key = String(plan || 'basic').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PLAN_MONTHLY_USD, key)) {
    return PLAN_MONTHLY_USD[key];
  }
  return PLAN_MONTHLY_USD.basic;
}

export function planStripePriceId(plan) {
  const key = String(plan || 'basic').toLowerCase();
  return PLAN_STRIPE_PRICE_IDS[key] || PLAN_STRIPE_PRICE_IDS.basic;
}

export default PLAN_MONTHLY_USD;
