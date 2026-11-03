/**
 * Local unit checks for plan display prices + Meta CAPI helpers.
 * No network, no Stripe, no DB.
 */
const assert = require('assert');
const path = require('path');

const planPricing = require(path.join(__dirname, '../lib/planPricing.cjs'));
const metaCapi = require(path.join(__dirname, '../lib/metaCapi.cjs'));

let passed = 0;
function ok(name, cond, detail) {
  if (!cond) {
    console.error('FAIL', name, detail || '');
    process.exitCode = 1;
    return;
  }
  console.log('ok', name);
  passed += 1;
}

// planPricing
ok('basic display 99', planPricing.planMonthlyUsd('basic') === 99);
ok('business display 199', planPricing.planMonthlyUsd('business') === 199);
ok('enterprise display 399', planPricing.planMonthlyUsd('enterprise') === 399);
ok('professional alias 199', planPricing.planMonthlyUsd('professional') === 199);
ok('starter alias 99', planPricing.planMonthlyUsd('starter') === 99);
ok('unknown falls back to basic', planPricing.planMonthlyUsd('nope') === 99);
ok('stripe basic id unchanged', planPricing.planStripePriceId('basic') === 'price_1T5NV8CAqGydUaCs2iO0R9yl');
ok('stripe business id unchanged', planPricing.planStripePriceId('business') === 'price_1T5NV8CAqGydUaCsJ8SDQSnx');
ok('stripe enterprise id unchanged', planPricing.planStripePriceId('enterprise') === 'price_1T5NV8CAqGydUaCs1kPhAuWo');

// hashing
const hash = metaCapi.sha256('kevin@example.com');
ok('sha256 lowercases', hash === metaCapi.sha256('  KEVIN@EXAMPLE.COM  '));
ok('sha256 length 64', hash && hash.length === 64);

// CAPI no-op without token
delete process.env.META_CAPI_TOKEN;
(async () => {
  const trial = await metaCapi.sendTrialSignupEvents({
    companyId: 'co_test',
    plan: 'business',
    email: 'a@b.co',
    attribution: { fbp: 'fb.1.x', ip: '1.2.3.4', ua: 'test' },
  });
  ok('trial event id shape', trial.eventId === 'trial_signup_co_test');
  ok('trial skipped without token', trial.results.every((r) => r.skipped));

  const paid = await metaCapi.sendSubscribePurchaseEvents({
    companyId: 'co_test',
    plan: 'enterprise',
    email: 'a@b.co',
    attribution: {},
    value: 399,
    invoiceId: 'in_123',
  });
  ok('subscribe event id shape', paid.eventId === 'subinv_in_123');
  ok('subscribe skipped without token', paid.results.every((r) => r.skipped));

  // extractAttributionFromReq
  const attr = metaCapi.extractAttributionFromReq(
    {
      headers: {
        cookie: '_fbp=fb.1.test; _fbc=fb.1.click',
        'user-agent': 'UA',
        'x-forwarded-for': '9.9.9.9, 8.8.8.8',
      },
    },
    { utm_source: 'meta', fbclid: 'abc' }
  );
  ok('attr fbp', attr.fbp === 'fb.1.test');
  ok('attr fbc', attr.fbc === 'fb.1.click');
  ok('attr utm', attr.utm_source === 'meta');
  ok('attr fbclid', attr.fbclid === 'abc');
  ok('attr ip present', Boolean(attr.ip));
  ok('attr ua', attr.ua === 'UA');

  console.log(`\n${passed} checks passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
