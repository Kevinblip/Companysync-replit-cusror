'use strict';

// Drives the Vite app and asserts dataLayer hits for the ad funnel.
// Purchase is recorded on the Stripe webhook (no browser is present when the
// first invoice is paid); this checks that the same dataLayer shape fires.

const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');

const BASE = process.env.DATALAYER_BASE_URL || 'http://127.0.0.1:5000';

function events(dataLayer) {
  return (dataLayer || []).filter((entry) => entry && entry.event && entry.event !== 'gtm.js');
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const recorded = [];
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    // GTM calls eventCallback immediately when no tags are published, and the
    // signup page then does a full navigation. Record hits in Node so the
    // assertion still sees them after that navigation.
    await page.exposeFunction('__csRecord', (entry) => { recorded.push(entry); });
    await page.evaluateOnNewDocument(() => {
      const raw = [];
      const nativePush = Array.prototype.push;
      const record = (entry) => {
        let clone;
        try {
          clone = JSON.parse(JSON.stringify(entry, (key, value) => (typeof value === 'function' ? undefined : value)));
        } catch {
          return;
        }
        if (window.__csRecord) window.__csRecord(clone);
      };
      window.dataLayer = new Proxy(raw, {
        get(target, prop, receiver) {
          if (prop === 'push') {
            return (...args) => {
              args.forEach(record);
              const impl = target.__pushImpl || nativePush;
              return Reflect.apply(impl, target, args);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, prop, value) {
          if (prop === 'push' && typeof value === 'function') {
            target.__pushImpl = nativePush;
            return true;
          }
          target[prop] = value;
          return true;
        },
      });

      const original = window.fetch.bind(window);
      window.fetch = async (url, options = {}) => {
        if (String(url).includes('/api/signup')) {
          window.__signupBody = options.body || '';
          record({ event: '__signup_body', body: options.body || '' });
          return new Response(JSON.stringify({
            success: true,
            redirect: '/QuickSetup?plan=basic&new_signup=true',
            tracking: { event_id: 'trial_signup_co_test', is_new_trial: true },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return original(url, options);
      };
    });

    await page.goto(`${BASE}/login?utm_source=meta&utm_medium=cpc&utm_campaign=spring&fbclid=CLICK123`, {
      waitUntil: 'domcontentloaded',
    });

    const html = await page.content();
    const installed = {
      hasGtm: html.includes('GTM-M9MP4R78') && html.includes('googletagmanager.com/gtm.js'),
      hasNoscript: html.includes('googletagmanager.com/ns.html?id=GTM-M9MP4R78'),
    };
    assert.equal(installed.hasGtm, true, 'GTM head snippet missing');
    assert.equal(installed.hasNoscript, true, 'GTM noscript iframe missing');

    await page.waitForFunction(() => (window.dataLayer || []).some((entry) => entry.event === 'page_view' && entry.page_path === '/login'));
    const loginView = await page.evaluate(() => window.dataLayer.find((entry) => entry.event === 'page_view' && entry.page_path === '/login'));
    assert.ok(loginView.event_id, 'page_view missing event_id');
    assert.equal(loginView.page_location, `${new URL(BASE).origin}/login`);
    assert.equal(loginView.utm_source, 'meta');
    assert.equal(loginView.utm_campaign, 'spring');
    assert.equal(loginView.fbclid, 'CLICK123');
    assert.ok(!String(loginView.page_location).includes('fbclid'), 'page_location must not include the query string');

    await page.evaluate(() => { window.__csAlive = 1; });
    await page.click('[data-testid="link-signup"]');
    await page.waitForFunction(() => location.pathname === '/signup');
    const stillSpa = await page.evaluate(() => window.__csAlive);
    assert.equal(stillSpa, 1, 'signup navigation reloaded the document');
    await page.waitForFunction(() => (window.dataLayer || []).some((entry) => entry.event === 'page_view' && entry.page_path === '/signup'));
    await page.waitForSelector('[data-testid="input-signup-email"]');

    await page.type('[data-testid="input-signup-email"]', 'owner@roofing.test');
    await page.type('[data-testid="input-signup-company"]', 'Roof Test Co');
    await page.type('[data-testid="input-signup-password"]', 'correct-horse');
    await page.type('[data-testid="input-signup-confirm-password"]', 'correct-horse');
    await page.click('[data-testid="button-signup-submit"]');
    const deadline = Date.now() + 20000;
    while (!recorded.some((entry) => entry.event === 'sign_up') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const signUp = recorded.find((entry) => entry.event === 'sign_up');
    assert.ok(signUp, 'sign_up was not recorded before the post-signup navigation');
    assert.equal(signUp.event_id, 'trial_signup_co_test');
    assert.equal(signUp.method, 'email');
    assert.equal(signUp.plan, 'basic');
    assert.equal(signUp.value, 0);
    assert.equal(signUp.user_data.email, 'owner@roofing.test');
    assert.equal(signUp.utm_source, 'meta');

    const posted = JSON.parse(recorded.find((entry) => entry.event === '__signup_body')?.body || '{}');
    assert.equal(posted.attribution.utm_source, 'meta');
    assert.equal(posted.attribution.fbclid, 'CLICK123');
    assert.equal(posted.attribution.landing_page, '/login');

    const navDeadline = Date.now() + 10000;
    while (!page.url().includes('QuickSetup') && Date.now() < navDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await page.waitForSelector('body');

    const checkout = await page.evaluate(async () => {
      const mod = await import('/src/lib/analytics.js');
      await mod.trackBeginCheckout({ sessionId: 'cs_test_123', plan: 'Business', value: 149 });
      await mod.trackPurchase({ eventId: 'subinv_in_test', value: 149, currency: 'USD', plan: 'Business' });
      return (window.dataLayer || []).filter((entry) => entry.event === 'begin_checkout' || entry.event === 'purchase');
    });
    const begin = checkout.find((entry) => entry.event === 'begin_checkout');
    const purchase = checkout.find((entry) => entry.event === 'purchase');
    assert.equal(begin.event_id, 'checkout_cs_test_123');
    assert.equal(begin.value, 149);
    assert.equal(begin.currency, 'USD');
    assert.equal(purchase.event_id, 'subinv_in_test');
    assert.equal(purchase.meta_event, 'Subscribe');
    assert.equal(purchase.value, 149);

    const names = recorded.map((entry) => entry.event).filter((event) => event && event !== '__signup_body');
    console.log('PASS dataLayer events:', [...new Set(names.concat(['begin_checkout', 'purchase']))].join(', '));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
