'use strict';

const { readJson } = require('./paths.cjs');

const ALLOWED_MONTHLY = Object.freeze([99, 199, 399]);

function loadPricing() {
  const file = readJson('config/salesPricing.json');
  const plans = (file.plans || []).map((plan) => ({
    id: String(plan.id),
    name: String(plan.name),
    monthly: Number(plan.monthly),
  }));
  if (plans.length !== 3) throw new Error('sales pricing must list Basic, Business, and Enterprise');
  const amounts = plans.map((plan) => plan.monthly).sort((a, b) => a - b);
  if (amounts.join(',') !== ALLOWED_MONTHLY.join(',')) {
    throw new Error('sales pricing drifted from $99/$199/$399');
  }
  return {
    currency: 'USD',
    interval: 'month',
    trialDays: 14,
    trialRequiresCard: false,
    cancelAnytime: true,
    plans,
  };
}

function dollarAmounts(text) {
  const found = [];
  const re = /\$\s*([0-9]{1,6}(?:\.[0-9]{1,2})?)/g;
  let match;
  const source = String(text || '');
  while ((match = re.exec(source))) found.push(Number(match[1]));
  return found;
}

function foreignDollarAmounts(text) {
  return dollarAmounts(text).filter((amount) => !ALLOWED_MONTHLY.includes(amount));
}

function assertCatalogPrices(text, label = 'sales copy') {
  const foreign = foreignDollarAmounts(text);
  if (foreign.length) {
    throw new Error(`${label} quotes a price outside $99/$199/$399`);
  }
  return true;
}

function priceSpeech() {
  const pricing = loadPricing();
  const bits = pricing.plans.map((plan) => `${plan.name} $${plan.monthly} a month`);
  return `${bits.join(', ')}. 14-day free trial, no credit card, cancel anytime.`;
}

function postalAddress() {
  return process.env.SALES_AGENT_POSTAL_ADDRESS
    || 'CompanySync, postal address on file (set SALES_AGENT_POSTAL_ADDRESS)';
}

module.exports = {
  ALLOWED_MONTHLY,
  loadPricing,
  dollarAmounts,
  foreignDollarAmounts,
  assertCatalogPrices,
  priceSpeech,
  postalAddress,
};
