import { createRequire } from 'module';
const require = createRequire(import.meta.url);

async function getStripeClient() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken || !hostname) {
    throw new Error('Run this script inside Replit environment');
  }

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', 'stripe');
  url.searchParams.set('environment', 'development');

  const response = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json', 'X-Replit-Token': xReplitToken }
  });

  const data = await response.json();
  const settings = data.items?.[0]?.settings;
  if (!settings?.secret) throw new Error('Stripe connection not found');

  const Stripe = require('stripe');
  return new Stripe(settings.secret, { apiVersion: '2025-08-27.basil' });
}

async function seedProducts() {
  console.log('Connecting to Stripe...');
  const stripe = await getStripeClient();

  const existing = await stripe.products.list({ limit: 100 });
  const existingNames = existing.data.map(p => p.name);

  const plans = [
    {
      name: 'Basic Plan',
      description: 'Essential CRM tools for small roofing teams',
      amount: 5900,
      metadata: {
        plan_key: 'basic',
        max_users: '5',
        max_customers: '100',
        max_leads: '250',
        ai_interactions: '1000',
        sms_limit: '200',
        call_minutes: '50'
      }
    },
    {
      name: 'Business Plan',
      description: 'Advanced features with unlimited communication for growing teams',
      amount: 14900,
      metadata: {
        plan_key: 'business',
        max_users: '10',
        max_customers: '1000',
        max_leads: '-1',
        ai_interactions: '-1',
        sms_limit: '-1',
        call_minutes: '-1'
      }
    },
    {
      name: 'Enterprise Plan',
      description: 'Full-featured platform with white-label, accounting, and dedicated support',
      amount: 29900,
      metadata: {
        plan_key: 'enterprise',
        max_users: '25',
        max_customers: '-1',
        max_leads: '-1',
        ai_interactions: '-1',
        sms_limit: '-1',
        call_minutes: '-1'
      }
    }
  ];

  const createdPrices = {};

  for (const plan of plans) {
    if (existingNames.includes(plan.name)) {
      console.log(`⏭️  ${plan.name} already exists, skipping`);
      const existing_product = existing.data.find(p => p.name === plan.name);
      const prices = await stripe.prices.list({ product: existing_product.id, active: true });
      if (prices.data.length > 0) {
        createdPrices[plan.metadata.plan_key] = prices.data[0].id;
      }
      continue;
    }

    console.log(`Creating ${plan.name}...`);
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: plan.metadata
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.amount,
      currency: 'usd',
      recurring: { interval: 'month' }
    });

    createdPrices[plan.metadata.plan_key] = price.id;
    console.log(`✅ ${plan.name}: product=${product.id}, price=${price.id}`);
  }

  console.log('\n📋 Price IDs for frontend:');
  console.log(JSON.stringify(createdPrices, null, 2));
  console.log('\nUpdate these in src/pages/Pricing.jsx and src/pages/PublicPricing.jsx');
}

seedProducts().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
