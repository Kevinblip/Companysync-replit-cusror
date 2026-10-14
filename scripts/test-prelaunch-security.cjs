'use strict';

// Unit coverage for the pre-launch security fixes. No database, no Stripe,
// no SMS, and no secret values are printed.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  decideInvokeAccess,
  authorizeFunctionInvoke,
  PUBLIC_FUNCTIONS,
  ADMIN_FUNCTIONS,
} = require('../lib/functionInvokeAuth.cjs');
const { classifyInboundSms, setOptOut, optOutStatus } = require('../lib/smsOptOut.cjs');
const { resolveStripeApiKey, resolveStripeWebhookSecret, mapAppSubscriptionStatus } = require('../lib/stripeEnv.cjs');
const { hashResetToken, resetTokenExpiresAt, RESET_TOKEN_TTL_MS } = require('../lib/passwordResetToken.cjs');
const { assertStartupSecrets } = require('../lib/startupSecrets.cjs');
const { toE164 } = require('../lib/phoneE164.cjs');
const { signUnsubscribe, verifyUnsubscribe, stampUnsubscribeLink } = require('../lib/emailUnsubscribe.cjs');
const { getClientIp } = require('../lib/rateLimit.cjs');
const { geminiLiveModel } = require('../lib/geminiLiveModel.cjs');

const silent = { error() {}, warn() {} };
let failed = 0;

function ok(name, cond) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

function fakeOptOutPool() {
  const rows = new Map();
  return {
    async query(sql, params = []) {
      if (String(sql).includes('CREATE TABLE')) return { rows: [] };
      if (String(sql).includes('INSERT INTO sms_opt_outs')) {
        rows.set(`${params[0]}|${params[1]}`, { company_id: params[1], opted_out: params[2] });
        return { rows: [] };
      }
      if (String(sql).includes('FROM sms_opt_outs')) {
        const [phone, company] = params;
        const found = [];
        for (const key of [`${phone}|${company}`, `${phone}|`]) {
          if (rows.has(key)) found.push(rows.get(key));
        }
        return { rows: found };
      }
      throw new Error('unexpected sql');
    },
  };
}

(async () => {
  console.log('\n[prelaunch] invoke auth gate');
  ok('anonymous repair is rejected', decideInvokeAccess({ functionName: 'markOldInvoicesPaid' }).status === 401);
  ok('cron cannot run admin repair', decideInvokeAccess({ functionName: 'fixInvoiceStatuses', viaCron: true }).status === 403);
  ok('public estimate stays public', decideInvokeAccess({ functionName: 'getPublicEstimate' }).access === 'public');
  ok('session can call a normal handler', decideInvokeAccess({ functionName: 'sendSMS', authenticated: true }).ok === true);
  ok('admin of another company is rejected', decideInvokeAccess({
    functionName: 'grantStaffAdminAccess',
    authenticated: true,
    administratorCompanyIds: ['co-a'],
    companyId: 'co-b',
  }).status === 403);
  const inferred = decideInvokeAccess({
    functionName: 'syncEstimateAdjustmentToInvoice',
    authenticated: true,
    administratorCompanyIds: ['co-a'],
  });
  ok('single-company admin infers company_id', inferred.ok === true && inferred.companyId === 'co-a');
  ok('super-admin without a company is rejected', decideInvokeAccess({
    functionName: 'createCallAssistantRole',
    authenticated: true,
    isSuperAdmin: true,
  }).status === 400);
  ok('super-admin with a company is allowed', decideInvokeAccess({
    functionName: 'deleteUserAccount',
    authenticated: true,
    isSuperAdmin: true,
    companyId: 'other',
  }).access === 'admin');
  ok('impersonation cannot run repair', decideInvokeAccess({
    functionName: 'markOldInvoicesPaid',
    authenticated: true,
    isImpersonating: true,
    administratorCompanyIds: ['co-a'],
    companyId: 'co-a',
  }).status === 403);
  ok('named admin handlers are gated', ['markOldInvoicesPaid', 'fixInvoiceStatuses', 'syncEstimateAdjustmentToInvoice', 'createCallAssistantRole', 'grantStaffAdminAccess'].every((name) => ADMIN_FUNCTIONS.has(name)));
  ok('portal handlers stay allowlisted', PUBLIC_FUNCTIONS.has('getPublicEstimate') && PUBLIC_FUNCTIONS.has('generateInvoicePDF'));

  const params = {};
  const allowed = await authorizeFunctionInvoke({
    req: { headers: {}, socket: { remoteAddress: '203.0.113.21' } },
    functionName: 'fixPaymentCompanyIds',
    params,
    pool: {},
    resolveContext: async () => ({
      authenticated: true,
      viaServiceToken: false,
      isSuperAdmin: false,
      isImpersonating: false,
      administratorCompanyIds: new Set(['co-1']),
    }),
  });
  ok('authorize injects the caller company', allowed.ok === true && params.company_id === 'co-1');

  const anonReq = { headers: {}, socket: { remoteAddress: '203.0.113.77' } };
  const denied = await authorizeFunctionInvoke({
    req: anonReq,
    functionName: 'runDataRepairs',
    params: {},
    pool: {},
    resolveContext: async () => ({ authenticated: false }),
  });
  ok('authorize rejects an anonymous repair', denied.status === 401);

  let limited = null;
  for (let i = 0; i < 61; i++) {
    limited = await authorizeFunctionInvoke({
      req: { headers: { 'x-forwarded-for': '203.0.113.90' }, socket: { remoteAddress: '10.0.0.1' } },
      functionName: 'getPublicTrainingVideo',
      params: {},
      pool: {},
      resolveContext: async () => ({ authenticated: false }),
    });
  }
  ok('public invoke is rate limited', limited.status === 429);

  console.log('\n[prelaunch] SMS opt-out');
  for (const word of ['STOP', 'stopall', 'UNSUBSCRIBE!', 'cancel', 'END', 'quit']) {
    ok(`${word} is a stop`, classifyInboundSms(word) === 'stop');
  }
  ok('START resumes', classifyInboundSms('START please') === 'start');
  ok('UNSTOP resumes', classifyInboundSms('unstop') === 'start');
  ok('a normal text is not an opt-out', classifyInboundSms('Can you come Tuesday?') === null);
  const pool = fakeOptOutPool();
  await setOptOut(pool, '2165551212', 'co-9', true);
  ok('opted-out number is blocked', await optOutStatus(pool, '+12165551212', 'co-9') === 'out');
  ok('another company is not blocked by a company opt-out', await optOutStatus(pool, '+12165551212', 'co-other') === null);
  await setOptOut(pool, '+12165551212', 'co-9', false);
  ok('START clears the opt-out', await optOutStatus(pool, '2165551212', 'co-9') === 'in');

  console.log('\n[prelaunch] Stripe keys and status');
  ok('sk_ is taken from STRIPE_API_KEY', resolveStripeApiKey({ STRIPE_API_KEY: 'sk_test_example', STRIPE_SECRET_KEY: 'whsec_example' }) === 'sk_test_example');
  ok('old STRIPE_SECRET_KEY is accepted when it is an sk_ key', resolveStripeApiKey({ STRIPE_SECRET_KEY: 'sk_live_example' }) === 'sk_live_example');
  ok('a webhook secret is never used as the API key', resolveStripeApiKey({ STRIPE_SECRET_KEY: 'whsec_only' }) === null);
  ok('webhook secret prefers STRIPE_WEBHOOK_SECRET', resolveStripeWebhookSecret({ STRIPE_WEBHOOK_SECRET: 'whsec_real', STRIPE_SECRET_KEY: 'whsec_old' }) === 'whsec_real');
  ok('old name is accepted for the webhook secret', resolveStripeWebhookSecret({ STRIPE_SECRET_KEY: 'whsec_from_old', STRIPE_API_KEY: 'sk_test_example' }) === 'whsec_from_old');
  ok('active maps to active', mapAppSubscriptionStatus('active') === 'active');
  ok('trialing maps to trial', mapAppSubscriptionStatus('trialing') === 'trial');
  ok('past_due stays past_due', mapAppSubscriptionStatus('past_due') === 'past_due');
  ok('deleted maps to cancelled', mapAppSubscriptionStatus('canceled', { deleted: true }) === 'cancelled');

  console.log('\n[prelaunch] reset tokens, phones, unsubscribe, startup');
  const raw = 'reset-token-value';
  const hashed = hashResetToken(raw);
  ok('reset token is hashed', hashed !== raw && hashed === hashResetToken(raw) && hashed.length === 64);
  ok('reset token expires in 30 minutes', resetTokenExpiresAt(0).getTime() === RESET_TOKEN_TTL_MS);
  ok('10-digit admin phone becomes E.164', toE164('(216) 555-1212') === '+12165551212');
  ok('existing E.164 is preserved', toE164('+442079460958') === '+442079460958');
  const secretEnv = { SESSION_SECRET: 'unit-test-secret-not-a-real-key-0001' };
  const token = signUnsubscribe('Person@Example.com', secretEnv);
  ok('unsubscribe token matches the address', verifyUnsubscribe('person@example.com', token, secretEnv) === true);
  ok('unsubscribe token rejects another address', verifyUnsubscribe('other@example.com', token, secretEnv) === false);
  const stamped = stampUnsubscribeLink('<p><a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a></p>', 'https://app.example', 'person@example.com', secretEnv);
  ok('unsubscribe link is stamped', stamped.includes('/api/email/unsubscribe?e=') && !stamped.includes('{{UNSUBSCRIBE_URL}}'));
  const fatal = assertStartupSecrets({
    env: { NODE_ENV: 'production', SESSION_SECRET: 'PASTE_FROM_REPLIT', ENCRYPTION_KEY: 'PASTE_FROM_REPLIT' }, // pragma: allowlist secret
    exit: false,
    log: silent,
  });
  ok('production placeholder secrets are fatal', fatal.fatal === true && fatal.ok === false);
  const dev = assertStartupSecrets({
    env: { NODE_ENV: 'development', SESSION_SECRET: '', ENCRYPTION_KEY: '' },
    exit: false,
    log: silent,
  });
  ok('development missing secrets warn and continue', dev.fatal === false && dev.ok === false);
  const previousTrust = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';
  const ip = getClientIp({
    headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.8' },
    socket: { remoteAddress: '10.0.0.8' },
  });
  if (previousTrust === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = previousTrust;
  ok('rate limit uses the proxy hop, not a spoofed left address', ip === '198.51.100.8');

  console.log('\n[prelaunch] source guards');
  const root = path.resolve(__dirname, '..');
  const replit = fs.readFileSync(path.join(root, '.replit'), 'utf8');
  ok('.replit has no ENCRYPTION_KEY assignment', !/^\s*ENCRYPTION_KEY\s*=/m.test(replit));
  ok('.replit has no LEXI_NATIVE_BRIDGE_SECRET assignment', !/^\s*LEXI_NATIVE_BRIDGE_SECRET\s*=/m.test(replit));
  const prodDb = fs.readFileSync(path.join(root, 'db/prod-db.cjs'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'db/schema.js'), 'utf8');
  ok('boot seed has no embedded password hash', !/\$2[aby]\$\d{2}\$/.test(prodDb + schema));
  ok('boot seed calls ensureSuperAdmin', prodDb.includes('ensureSuperAdmin') && schema.includes('ensureSuperAdmin'));
  ok('staff language is not wiped on boot', !schema.includes("preferred_language = NULL"));
  const bridge = fs.readFileSync(path.join(root, 'functions/lexiBridgeAPI.ts'), 'utf8');
  ok('Lexi bridge checks company membership', bridge.includes('This bridge can only read data for your company'));
  for (const file of ['src/components/ai/GeminiLiveClient.jsx', 'railway/server.js', 'vite-twilio-ws-plugin.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    ok(`${file} has no Gemini 2.5 native-audio model`, !source.includes('gemini-2.5-flash-native-audio'));
  }
  ok('live model defaults to Gemini 3.8', geminiLiveModel(null, {}) === 'models/gemini-3.8-live');
  ok('a saved 2.5 engine falls through to 3.8', geminiLiveModel('models/gemini-2.5-flash-native-audio-latest', {}) === 'models/gemini-3.8-live');

  console.log(`\n[prelaunch] ${failed === 0 ? 'passed' : failed + ' failed'}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
