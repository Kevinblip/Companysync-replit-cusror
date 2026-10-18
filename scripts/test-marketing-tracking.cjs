'use strict';

const assert = require('node:assert/strict');
const { attributionFromRequest, sanitizeAttribution } = require('../lib/marketingAttribution.cjs');
const { qualifiesAsFirstSubscriptionCharge, recordFirstPaidSubscription } = require('../lib/firstPaidSubscription.cjs');

function invoiceEvent(overrides = {}) {
  return {
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: 'in_123',
        subscription: 'sub_123',
        amount_paid: 14900,
        currency: 'usd',
        billing_reason: 'subscription_cycle',
        customer: 'cus_123',
        customer_email: 'owner@roofing.test',
        metadata: { company_id: 'co_1' },
        lines: { data: [{ price: { nickname: 'Business' } }] },
        ...overrides,
      },
    },
  };
}

function fakePool(state) {
  return {
    async query(sql, params) {
      state.queries.push({ sql, params });
      if (sql.includes('INSERT INTO generic_entities')) {
        if (state.inserted.has(params[0])) return { rows: [] };
        state.inserted.add(params[0]);
        return { rows: [{ id: params[0] }] };
      }
      if (sql.includes('marketing_attribution')) {
        return { rows: [{ email: 'owner@roofing.test', a: { fbp: 'fb.1.2.3', fbc: 'fb.1.9.abc' } }] };
      }
      if (sql.includes('stripe_customer_id')) {
        return { rows: [{ id: 'co_from_customer' }] };
      }
      return { rows: [] };
    },
  };
}

async function main() {
  const cleaned = sanitizeAttribution({
    utm_source: ' facebook ',
    utm_medium: 'cpc',
    fbclid: 'IwAR123',
    landing_page: '/signup?email=secret@example.com',
    password: 'nope',
    extra: 'nope',
  });
  assert.equal(cleaned.utm_source, 'facebook');
  assert.equal(cleaned.landing_page, '/signup');
  assert.equal(cleaned.password, undefined);

  const fromLanding = sanitizeAttribution({ landing_page: '/signup', fbclid: 'CLICK' });
  const req = {
    headers: {
      cookie: '_fbp=fb.1.10.20; _fbc=fb.1.10.CLICK',
      'user-agent': 'Mozilla/5.0',
      'x-forwarded-for': '203.0.113.8, 10.0.0.1',
    },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const stored = attributionFromRequest(req, fromLanding);
  assert.equal(stored.fbp, 'fb.1.10.20');
  assert.equal(stored.fbc, 'fb.1.10.CLICK');
  assert.equal(stored.ip, '203.0.113.8');
  assert.equal(stored.utm_source, undefined);
  assert.equal(stored.landing_page, '/signup');

  const synthesized = attributionFromRequest(
    { headers: { 'user-agent': 'node' }, socket: { remoteAddress: '127.0.0.1' } },
    { fbclid: 'CLICK2', utm_campaign: 'spring' }
  );
  assert.ok(synthesized.fbc.startsWith('fb.1.'));
  assert.ok(synthesized.fbc.endsWith('.CLICK2'));
  assert.equal(synthesized.ip, undefined);
  assert.equal(synthesized.ua, undefined);
  assert.equal(synthesized.utm_campaign, 'spring');

  assert.equal(qualifiesAsFirstSubscriptionCharge(invoiceEvent()), true);
  assert.equal(qualifiesAsFirstSubscriptionCharge(invoiceEvent({ amount_paid: 0 })), false);
  assert.equal(qualifiesAsFirstSubscriptionCharge(invoiceEvent({ billing_reason: 'manual' })), false);
  assert.equal(qualifiesAsFirstSubscriptionCharge(invoiceEvent({ subscription: null })), false);
  assert.equal(qualifiesAsFirstSubscriptionCharge({ ...invoiceEvent(), account: 'acct_connect' }), false);
  assert.equal(qualifiesAsFirstSubscriptionCharge({ type: 'checkout.session.completed', data: { object: {} } }), false);

  const state = { queries: [], inserted: new Set() };
  const sent = [];
  const first = await recordFirstPaidSubscription(fakePool(state), invoiceEvent(), {
    sendServerEvent: async (payload) => { sent.push(payload); return { sent: true }; },
  });
  assert.equal(first.recorded, true);
  assert.equal(first.eventId, 'subinv_in_123');
  assert.equal(first.value, 149);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event_name, 'purchase');
  assert.equal(sent[0].event_id, 'subinv_in_123');
  assert.equal(sent[0].extra.meta_event, 'Subscribe');
  assert.equal(sent[0].user.fbp, 'fb.1.2.3');

  const second = await recordFirstPaidSubscription(fakePool(state), invoiceEvent(), {
    sendServerEvent: async () => { throw new Error('should not send twice'); },
  });
  assert.equal(second.recorded, false);
  assert.equal(second.reason, 'already_recorded');

  const noCompany = await recordFirstPaidSubscription(fakePool({ queries: [], inserted: new Set() }), invoiceEvent({
    metadata: {},
    customer: null,
  }), { sendServerEvent: async () => ({ sent: true }) });
  assert.equal(noCompany.reason, 'no_company');

  const connect = await recordFirstPaidSubscription(fakePool({ queries: [], inserted: new Set() }), {
    ...invoiceEvent(),
    account: 'acct_homeowner',
  });
  assert.equal(connect.reason, 'not_applicable');

  console.log('PASS marketing attribution and first paid subscription');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
