#!/usr/bin/env node
/**
 * Email Provider Health Regression Test
 * -------------------------------------
 * Uses mocked Resend responses and an in-memory database. No email is sent and
 * no production health marker is changed.
 *
 * Verifies:
 * - Resend 401/403 responses persist auth_failed and stop after one attempt
 * - GET /api/local/email-provider-status reports auth_failed, then ok on recovery
 * - successful sends persist ok
 * - transient 429/5xx responses do not flip or rewrite the health marker
 */
'use strict';

const http = require('http');
const fs = require('fs');
const Module = require('module');
const { Readable } = require('stream');

delete process.env.POSTMARK_SERVER_TOKEN;
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_API_KEY;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SECRET_KEY;
// This suite mocks Resend, so it must opt out of the EMAIL_PROVIDER override and
// of ambient SMTP credentials (SMTP outranks Resend in the fallback order).
// Otherwise the mocked assertions run against a different provider — and a real
// SMTP relay would send actual mail from a test run.
delete process.env.EMAIL_PROVIDER;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
// Providers are mocked here too, so reserved fixture recipients must be
// allowed through the shared recipient filter for the assertions to run.
process.env.EMAIL_ALLOW_RESERVED_RECIPIENTS = '1';
process.env.RESEND_API_KEY = 're_test_email_health';

let persistedData = null;
let databaseWrites = 0;
let providerHealthWrites = 0;
let durableRateWrites = 0;
let deliveryAttempts = [];
let communicationAudits = [];
const durableRateRows = new Map();
const fakePool = {
  async query(sql, params = []) {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(String(sql).trim())) {
      return { rows: [], rowCount: 0 };
    }
    if (/SELECT id, data FROM generic_entities/i.test(sql) && /EmailRateLimit/.test(sql)) {
      const ids = params[0] || [];
      const rows = ids.flatMap((id) => durableRateRows.has(id) ? [{ id, data: durableRateRows.get(id) }] : []);
      return { rows, rowCount: rows.length };
    }
    if (/UPDATE generic_entities SET data/i.test(sql) && /EmailRateLimit/.test(sql)) {
      durableRateRows.set(params[0], JSON.parse(params[1]));
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO communications/i.test(sql)) {
      communicationAudits.push({
        id: params[0], companyId: params[1], contactName: params[2], contactEmail: params[3],
        subject: params[4], status: 'pending', actorEmail: params[6],
      });
      return { rows: [], rowCount: 1 };
    }
    // finalizeSendRecord: [id, status, alwaysFields, acceptanceFields]. The
    // acceptance half is skipped once a real outcome is already recorded.
    if (/UPDATE communications\s+SET status/i.test(sql)) {
      const audit = communicationAudits.find((item) => item.id === params[0]);
      if (audit) {
        const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : (value || {}));
        const settled = ['delivered', 'complained', 'bounced', 'failed']
          .includes(String(audit.data?.delivery_status || '').toLowerCase());
        audit.data = { ...audit.data, ...parse(params[2]) };
        if (!settled) {
          audit.status = params[1];
          audit.data = { ...audit.data, ...parse(params[3]) };
        }
      }
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT 1 FROM companies c/i.test(sql)) {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }
    if (/SELECT company_name, name FROM companies/i.test(sql)) {
      return { rows: [{ company_name: 'Session Company' }], rowCount: 1 };
    }
    if (/SELECT company_name, name FROM companies c/i.test(sql)) {
      return { rows: [{ company_name: 'Session Company' }], rowCount: 1 };
    }
    if (/SELECT timezone, settings FROM companies/i.test(sql)) {
      return {
        rows: [{ timezone: 'America/New_York', settings: { notification_quiet_hours: { enabled: false } } }],
        rowCount: 1,
      };
    }
    if (/INSERT INTO generic_entities/i.test(sql) && /EmailRateLimit/.test(sql)) {
      durableRateWrites++;
      if (!durableRateRows.has(params[0])) durableRateRows.set(params[0], JSON.parse(params[2]));
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO generic_entities/i.test(sql)) {
      const data = typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2];
      if (/EmailDeliveryEvent/.test(sql)) deliveryAttempts.push(data);
      else if (/EmailProviderStatus/.test(sql)) {
        persistedData = data;
        providerHealthWrites++;
      }
      databaseWrites++;
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT data FROM generic_entities/i.test(sql)) {
      return { rows: persistedData ? [{ data: persistedData }] : [], rowCount: persistedData ? 1 : 0 };
    }
    throw new Error(`Unexpected health-test SQL: ${sql}`);
  },
};

const originalLoad = Module._load;
Module._load = function mockProdDb(request, parent, isMain) {
  if (
    (request === '../db/prod-db.cjs' || request === './prod-db.cjs')
    && /(?:emailProviderHealth|emailSafety|prod-integrations)\.cjs$/.test(parent?.filename || '')
  ) {
    return { getPool: () => fakePool };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let fetchCalls = 0;
let lastFetch = null;
let nextResponse = { ok: true, status: 200, body: { id: 'initial' } };
global.fetch = async (url, options = {}) => {
  fetchCalls++;
  lastFetch = { url: String(url), options };
  const response = nextResponse;
  return {
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  };
};

const health = require('../lib/emailProviderHealth.cjs');
const transport = require('../lib/emailTransport.cjs');

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail === undefined ? '' : ` (got: ${JSON.stringify(detail)})`}`);
  }
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function waitForPersistedState(state) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (persistedData?.state === state) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for persisted state ${state}`);
}

async function expectAuthFailure(status, message) {
  nextResponse = { ok: false, status, body: { message } };
  fetchCalls = 0;
  let error = null;
  try {
    await transport.sendPlatformEmail(
      { to: 'health-test@example.com', subject: `Auth ${status}`, html: '<p>test</p>' },
      3,
    );
  } catch (caught) {
    error = caught;
  }
  await waitForPersistedState('auth_failed');
  check(`${status} throws a no-retry error`, error?.noRetry === true, error?.message);
  check(`${status} aborts retries after one attempt`, fetchCalls === 1, fetchCalls);
  check(`${status} writes the auth_failed marker row`, persistedData?.state === 'auth_failed', persistedData);
  check(`${status} marker identifies Resend`, persistedData?.provider === 'resend', persistedData);
}

(async () => {
  console.log('\n── Email Provider Health Regression Test ─────────────────────\n');

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/local/email-provider-status') {
      const status = await health.getEmailProviderStatusPublic();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...status }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const statusUrl = `http://127.0.0.1:${server.address().port}/api/local/email-provider-status`;

  try {
    await expectAuthFailure(401, 'API key is invalid');
    let status = await requestJson(statusUrl);
    check('status endpoint returns HTTP 200 after auth failure', status.status === 200, status.status);
    check('status endpoint returns auth_failed after 401', status.body?.state === 'auth_failed', status.body);

    nextResponse = { ok: true, status: 200, body: { id: 'recovered-1' } };
    fetchCalls = 0;
    const recovered = await transport.sendPlatformEmail({
      to: 'health-test@example.com',
      subject: 'Recovery',
      html: '<p>test</p>',
    });
    await waitForPersistedState('ok');
    check('successful send reports success', recovered.success === true && recovered.provider === 'resend', recovered);
    check('successful send uses one attempt', fetchCalls === 1, fetchCalls);
    check('successful send writes the ok marker row', persistedData?.state === 'ok', persistedData);
    status = await requestJson(statusUrl);
    check('status endpoint returns ok after recovery', status.body?.state === 'ok', status.body);

    await expectAuthFailure(403, 'restricted API key');
    status = await requestJson(statusUrl);
    check('status endpoint returns auth_failed after 403', status.body?.state === 'auth_failed', status.body);

    nextResponse = { ok: true, status: 200, body: { id: 'recovered-2' } };
    await transport.sendPlatformEmail({
      to: 'health-test@example.com',
      subject: 'Recovery 2',
      html: '<p>test</p>',
    });
    await waitForPersistedState('ok');

    const writesBeforeTransientFailures = providerHealthWrites;
    for (const transientStatus of [429, 500, 503]) {
      nextResponse = {
        ok: false,
        status: transientStatus,
        body: { message: `temporary HTTP ${transientStatus}` },
      };
      fetchCalls = 0;
      try {
        await transport.sendPlatformEmail(
          { to: 'health-test@example.com', subject: `Transient ${transientStatus}`, html: '<p>test</p>' },
          1,
        );
      } catch {
        // Expected: the send itself fails, but provider health remains ok.
      }
      check(`transient ${transientStatus} was attempted`, fetchCalls === 1, fetchCalls);
      status = await requestJson(statusUrl);
      check(`transient ${transientStatus} does not flip status`, status.body?.state === 'ok', status.body);
    }
    check(
      'transient failures do not rewrite the persisted marker',
      providerHealthWrites === writesBeforeTransientFailures,
      { before: writesBeforeTransientFailures, after: providerHealthWrites },
    );

    const beforeSignals = await health.getEmailProviderStatus();
    const firstBounce = health.reportDeliveryEvent({ event: 'bounce', provider: 'resend', messageId: 'bounce-1' });
    const secondBounce = health.reportDeliveryEvent({ event: 'bounce', provider: 'resend', messageId: 'bounce-2' });
    const thirdBounce = health.reportDeliveryEvent({ event: 'bounce', provider: 'resend', messageId: 'bounce-3' });
    check('delivery signals are accepted for monitoring', firstBounce.accepted && secondBounce.accepted && thirdBounce.accepted, { firstBounce, secondBounce, thirdBounce });
    check('three rapid bounce signals pause delivery', thirdBounce.paused === true, thirdBounce);
    let safetyPause = null;
    try {
      await transport.sendPlatformEmail({ to: 'health-test@example.com', subject: 'Must not send', html: '<p>test</p>' });
    } catch (error) {
      safetyPause = error;
    }
    check('delivery safety pause blocks provider sends', safetyPause?.code === 'EMAIL_DELIVERY_PAUSED', safetyPause?.message);
    check('delivery safety pause is visible in provider status', (await health.getEmailProviderStatus()).state === 'delivery_paused', await health.getEmailProviderStatus());

    // A send that was already in flight when the breaker tripped reports success
    // moments later. That must not reopen delivery after a reputation emergency.
    health.reportResult({ ok: true });
    check(
      'a send already in flight cannot clear a delivery pause',
      (await health.getEmailProviderStatus()).state === 'delivery_paused',
      await health.getEmailProviderStatus(),
    );
    let stillPaused = null;
    try {
      await transport.sendPlatformEmail({ to: 'health-test@example.com', subject: 'Still blocked', html: '<p>test</p>' });
    } catch (error) {
      stillPaused = error;
    }
    check('delivery stays blocked after a successful send is reported', stillPaused?.code === 'EMAIL_DELIVERY_PAUSED', stillPaused?.message);

    // Provider webhooks are at-least-once. A single real bounce retried three
    // times must not look like three bounces and pause all platform mail.
    health.resumeDelivery('test reset');
    const retried1 = health.reportDeliveryEvent({ event: 'bounce', provider: 'postmark', messageId: 'retry-me', recipient: 'dupe@example.net' });
    const retried2 = health.reportDeliveryEvent({ event: 'bounce', provider: 'postmark', messageId: 'retry-me', recipient: 'dupe@example.net' });
    const retried3 = health.reportDeliveryEvent({ event: 'bounce', provider: 'postmark', messageId: 'retry-me', recipient: 'dupe@example.net' });
    check('a retried bounce webhook is only counted once', retried1.accepted === true && retried2.duplicate === true && retried3.duplicate === true, { retried1, retried2, retried3 });
    check('a retried bounce webhook does not pause delivery', (await health.getEmailProviderStatus()).state !== 'delivery_paused', await health.getEmailProviderStatus());
    const distinctBounce = health.reportDeliveryEvent({ event: 'bounce', provider: 'postmark', messageId: 'a-different-bounce', recipient: 'other@example.net' });
    check('a genuinely different bounce is still counted', distinctBounce.accepted === true, distinctBounce);
    health.resumeDelivery('test reset');

    console.log('\n[ Launch Checklist active-provider probes ]');
    process.env.POSTMARK_SERVER_TOKEN = 'pm_test_probe';
    process.env.AWS_ACCESS_KEY_ID = 'aws_test_probe';
    process.env.AWS_SECRET_ACCESS_KEY = 'aws_test_secret';
    process.env.RESEND_API_KEY = 're_test_probe';
    nextResponse = { ok: true, status: 200, body: {} };
    let probe = await transport.probePlatformEmailProvider();
    check('Postmark wins when all provider credentials exist', probe.ok && probe.provider === 'postmark', probe);
    check('Postmark probe uses the read-only server endpoint', lastFetch?.url === 'https://api.postmarkapp.com/server', lastFetch);

    delete process.env.POSTMARK_SERVER_TOKEN;
    nextResponse = {
      ok: false,
      status: 400,
      body: { __type: 'BadRequestException', message: 'Destination is required' },
    };
    probe = await transport.probePlatformEmailProvider();
    check('SES wins over Resend when AWS credentials exist', probe.ok && probe.provider === 'ses', probe);
    check('SES probe uses a non-delivery request on the real send endpoint', lastFetch?.url.endsWith('/v2/email/outbound-emails') && lastFetch?.options?.method === 'POST' && lastFetch?.options?.body === '{}', lastFetch);
    check('SES probe signs the request with the selected AWS key', lastFetch?.options?.headers?.Authorization?.includes('Credential=aws_test_probe/'), lastFetch);

    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    nextResponse = { ok: true, status: 200, body: {} };
    probe = await transport.probePlatformEmailProvider();
    check('Resend is probed when it is the only configured provider', probe.ok && probe.provider === 'resend', probe);
    check('Resend probe uses the read-only domains endpoint', lastFetch?.url === 'https://api.resend.com/domains', lastFetch);

    process.env.POSTMARK_SERVER_TOKEN = 'pm_test_probe';
    nextResponse = { ok: false, status: 401, body: { Message: 'bad server token' } };
    probe = await transport.probePlatformEmailProvider();
    check('active-provider auth rejection fails the launch probe', probe.ok === false && probe.provider === 'postmark' && /401/.test(probe.error), probe);

    const { probeEmailProvider: probeDenoEmailProvider } = await import('../functions/emailProviderProbe.js');
    let denoLastFetch = null;
    const denoFetch = async (url, options = {}) => {
      denoLastFetch = { url: String(url), options };
      if (String(url).endsWith('/v2/email/outbound-emails')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ __type: 'BadRequestException', message: 'Destination is required' }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const denoEnv = {
      POSTMARK_SERVER_TOKEN: 'pm_deno_probe',
      AWS_ACCESS_KEY_ID: 'aws_deno_probe',
      AWS_SECRET_ACCESS_KEY: 'aws_deno_secret',
      RESEND_API_KEY: 're_deno_probe',
    };
    const envGet = (key) => denoEnv[key];
    let denoProbe = await probeDenoEmailProvider({ envGet, fetchImpl: denoFetch });
    check('Deno probe behavior gives Postmark first priority', denoProbe.ok && denoProbe.provider === 'postmark', denoProbe);
    check('Deno Postmark behavior uses a non-send endpoint', denoLastFetch?.url === 'https://api.postmarkapp.com/server', denoLastFetch);

    delete denoEnv.POSTMARK_SERVER_TOKEN;
    denoProbe = await probeDenoEmailProvider({ envGet, fetchImpl: denoFetch });
    check('Deno probe behavior gives SES priority over Resend', denoProbe.ok && denoProbe.provider === 'ses', denoProbe);
    check('Deno SES behavior signs a non-delivery send validation', denoLastFetch?.url.endsWith('/v2/email/outbound-emails') && denoLastFetch?.options?.method === 'POST' && denoLastFetch?.options?.body === '{}' && denoLastFetch?.options?.headers?.Authorization?.includes('Credential=aws_deno_probe/'), denoLastFetch);

    const esbuild = require('esbuild');
    const denoSenderSource = fs.readFileSync(require.resolve('../functions/_sendEmail.ts'), 'utf8');
    const transformedSender = await esbuild.transform(denoSenderSource, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
    });
    const originalDeno = globalThis.Deno;
    globalThis.Deno = { env: { get: envGet } };
    const denoSender = await import(`data:text/javascript;base64,${Buffer.from(transformedSender.code).toString('base64')}`);
    let denoSendFetch = null;
    global.fetch = async (url, options = {}) => {
      denoSendFetch = { url: String(url), options };
      if (String(url).includes('postmark')) {
        return { ok: true, status: 200, json: async () => ({ MessageID: 'pm-deno-send' }) };
      }
      return { ok: true, status: 200, json: async () => ({ MessageId: 'ses-deno-send' }) };
    };

    denoEnv.POSTMARK_SERVER_TOKEN = 'pm_deno_probe';
    denoEnv.AWS_ACCESS_KEY_ID = 'aws_deno_probe';
    denoEnv.AWS_SECRET_ACCESS_KEY = 'aws_deno_secret';

    // The edge sender bypasses the delivery pause, rate limits and attribution,
    // so it must refuse to send unless someone has deliberately routed it
    // through the guarded transport and switched it on.
    denoSendFetch = null;
    let edgeDisabledError = null;
    try {
      await denoSender.sendEmail({ to: 'qa-postmark@companysync.io', subject: 'Edge disabled', html: '<p>test</p>' }, 1);
    } catch (caught) {
      edgeDisabledError = caught;
    }
    check('the ungoverned edge sender is disabled by default', edgeDisabledError?.code === 'EMAIL_EDGE_SENDER_DISABLED', edgeDisabledError?.message);
    check('a disabled edge sender never contacts an email provider', denoSendFetch === null, denoSendFetch);

    denoEnv.EMAIL_EDGE_SENDER_ENABLED = '1';
    let denoSend = await denoSender.sendEmail({ to: 'qa-postmark@companysync.io', subject: 'Postmark test', html: '<p>test</p>' }, 1);
    check('a passing Deno Postmark probe has a working sender path', denoSend.provider === 'postmark' && denoSend.success, denoSend);
    check('Deno Postmark sender uses its delivery endpoint', denoSendFetch?.url === 'https://api.postmarkapp.com/email', denoSendFetch);

    delete denoEnv.POSTMARK_SERVER_TOKEN;
    denoSend = await denoSender.sendEmail({ to: 'qa-ses@companysync.io', subject: 'SES test', html: '<p>test</p>' }, 1);
    check('a passing Deno SES probe has a working sender path', denoSend.provider === 'ses' && denoSend.success, denoSend);
    check('Deno SES sender uses its delivery endpoint', denoSendFetch?.url.endsWith('/v2/email/outbound-emails'), denoSendFetch);

    delete denoEnv.AWS_ACCESS_KEY_ID;
    delete denoEnv.AWS_SECRET_ACCESS_KEY;
    denoProbe = await probeDenoEmailProvider({ envGet, fetchImpl: denoFetch });
    check('Deno probe rejects a Resend-only configuration its sender cannot use', denoProbe.ok === false && denoProbe.provider === 'none', denoProbe);
    let noDenoProviderError = null;
    try {
      await denoSender.sendEmail({ to: 'test@example.com', subject: 'No provider', html: '<p>test</p>' }, 1);
    } catch (caught) {
      noDenoProviderError = caught;
    }
    check('Deno sender also rejects the same Resend-only configuration', /No email provider configured/.test(noDenoProviderError?.message), noDenoProviderError?.message);
    globalThis.Deno = originalDeno;

    delete process.env.POSTMARK_SERVER_TOKEN;
    process.env.AWS_ACCESS_KEY_ID = 'aws_prod_route';
    process.env.AWS_SECRET_ACCESS_KEY = 'aws_prod_secret';
    process.env.RESEND_API_KEY = 're_prod_fallback';
    let productionSendFetch = null;
    global.fetch = async (url, options = {}) => {
      productionSendFetch = { url: String(url), options };
      if (String(url).endsWith('/v2/email/outbound-emails')) {
        return { ok: true, status: 200, json: async () => ({ MessageId: 'ses-prod-route' }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: 'unexpected-resend-route' }) };
    };
    const prodIntegrations = require('../db/prod-integrations.cjs');
    prodIntegrations.__setTestPluginAuthHelpers({
      getUserFromRequest: async () => ({ email: 'health-test@example.com', company_id: 'default-company' }),
    });
    const productionReq = Readable.from([JSON.stringify({
      to: 'test@example.com',
      subject: 'Production route test',
      html: '<p>test</p>',
      companyId: 'attacker-company',
      from: 'Attacker <caller-supplied@example.net>',
      cc: ['copy@example.com'],
      replyTo: 'reply@example.com',
    })]);
    productionReq.headers = { 'x-company-id': 'companysync_master_001' };
    let productionStatus = 0;
    let productionBody = '';
    const productionRes = {
      writeHead(status) { productionStatus = status; },
      end(body) { productionBody = body; },
    };
    await prodIntegrations.handleSendEmail(productionReq, productionRes);
    const productionResult = JSON.parse(productionBody);
    check('production staff compose route accepts an authenticated active-company staff sender',
      productionStatus === 200 && productionResult.success === true,
      { productionStatus, productionResult });
    check('production staff compose uses the authorized active company instead of the session default',
      communicationAudits.some((audit) => audit.companyId === 'companysync_master_001')
        && !communicationAudits.some((audit) => audit.companyId === 'default-company'),
      communicationAudits);
    check('production staff compose uses the guarded provider transport', productionSendFetch?.url.endsWith('/v2/email/outbound-emails'), productionSendFetch);
    check('production staff compose ignores caller-provided sender identity',
      !String(productionSendFetch?.options?.body || '').includes('caller-supplied@example.net')
        && String(productionSendFetch?.options?.body || '').includes('Session Company'),
      productionSendFetch?.options?.body);
    const sentPayload = JSON.parse(productionSendFetch?.options?.body || '{}');
    check('production staff compose forwards CC and reply-to to the provider',
      sentPayload?.Destination?.CcAddresses?.includes('copy@example.com')
        && sentPayload?.ReplyToAddresses?.includes('reply@example.com'),
      sentPayload);
    check('production staff compose creates durable actor and company rate records',
      durableRateWrites >= 2, durableRateWrites);
    check('production staff compose delivery audit records session-derived company and actor',
      deliveryAttempts.some((attempt) => attempt?.source === 'staff_compose'
        && attempt?.actor_email === 'health-test@example.com'),
      deliveryAttempts);
    check('production staff compose writes and finalizes its communication history audit',
      communicationAudits.some((audit) => audit.status === 'sent'
        && audit.companyId === 'companysync_master_001'
        && audit.actorEmail === 'health-test@example.com'),
      communicationAudits);
    const tenantGuard = require('../lib/tenantGuard.cjs');
    const resolveRequestContext = tenantGuard.resolveRequestContext;
    tenantGuard.resolveRequestContext = async () => ({ isImpersonating: true });
    const providerBeforeImpersonatedCompose = productionSendFetch;
    const impersonatedReq = Readable.from([JSON.stringify({
      to: 'blocked@example.com', subject: 'Must not send', html: '<p>blocked</p>',
    })]);
    impersonatedReq.headers = { 'x-company-id': 'companysync_master_001' };
    let impersonatedStatus = 0;
    let impersonatedBody = '';
    await prodIntegrations.handleSendEmail(impersonatedReq, {
      writeHead(status) { impersonatedStatus = status; },
      end(body) { impersonatedBody = body; },
    });
    tenantGuard.resolveRequestContext = resolveRequestContext;
    check('production staff compose rejects read-only impersonation before provider contact',
      impersonatedStatus === 403
        && /blocked during an impersonation session/.test(impersonatedBody)
        && productionSendFetch === providerBeforeImpersonatedCompose,
      { impersonatedStatus, impersonatedBody, productionSendFetch });

    const emailSafety = require('../lib/emailSafety.cjs');
    const expiredAt = new Date(Date.now() - (16 * 60 * 1000)).toISOString();
    durableRateRows.set('email-rate:actor:expired-window@example.com', { window_started_at: expiredAt, count: 25 });
    durableRateRows.set('email-rate:company:expired-window-company', { window_started_at: expiredAt, count: 60 });
    await emailSafety.assertCanSend(
      { companyId: 'expired-window-company', actorEmail: 'expired-window@example.com' }, 1,
    );
    check('durable email limits reset after the persisted 15-minute bucket expires',
      durableRateRows.get('email-rate:actor:expired-window@example.com')?.count === 1
        && durableRateRows.get('email-rate:company:expired-window-company')?.count === 1,
      [...durableRateRows.entries()].filter(([id]) => id.includes('expired-window')));
    const durableRowsBeforeTenantlessSend = durableRateRows.size;
    await emailSafety.assertCanSend({}, 1);
    check('tenantless system email uses only the platform limit, not a shared durable company bucket',
      durableRateRows.size === durableRowsBeforeTenantlessSend,
      [...durableRateRows.keys()]);

    productionSendFetch = null;
    prodIntegrations.__setTestPluginAuthHelpers({ getUserFromRequest: async () => null });
    const unauthenticatedReq = Readable.from([JSON.stringify({
      to: 'test@example.com', subject: 'Must not send', html: '<p>test</p>',
      companyId: 'attacker-company', from: 'Attacker <caller-supplied@example.net>',
    })]);
    unauthenticatedReq.headers = {};
    let unauthenticatedStatus = 0;
    let unauthenticatedBody = '';
    await prodIntegrations.handleSendEmail(unauthenticatedReq, {
      writeHead(status) { unauthenticatedStatus = status; },
      end(body) { unauthenticatedBody = body; },
    });
    check('production staff compose rejects an unauthenticated relay attempt before provider access',
      unauthenticatedStatus === 401 && /Authentication required/i.test(JSON.parse(unauthenticatedBody).error || ''),
      { unauthenticatedStatus, unauthenticatedBody, productionSendFetch });
    check('unauthenticated staff compose cannot contact an email provider', productionSendFetch === null, productionSendFetch);

    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.POSTMARK_SERVER_TOKEN;
    process.env.RESEND_API_KEY = 're_test_email_health';

    const viteLaunchRunner = fs.readFileSync(require.resolve('../vite-functions-plugin.js'), 'utf8');
    check(
      'live Launch Checklist delegates to the tested active-provider probe',
      /case 'send-email':\s*result = await platformEmailCheck\(\)/.test(viteLaunchRunner) &&
        viteLaunchRunner.includes('probePlatformEmailProvider()'),
    );
    check(
      'production loads the same Launch Checklist handler registry',
      fs.readFileSync(require.resolve('../db/prod-integrations.cjs'), 'utf8')
        .includes('const mod = await import(pluginPath)'),
    );

    const routeFiles = [
      fs.readFileSync(require.resolve('../vite-db-plugin.js'), 'utf8'),
      fs.readFileSync(require.resolve('../db/prod-db.cjs'), 'utf8'),
    ];
    check(
      'dev and production expose the email-provider status route',
      routeFiles.every((source) =>
        source.includes("'/api/local/email-provider-status'") &&
        source.includes('getEmailProviderStatusPublic')),
    );
    const staffComposeRouteFiles = [
      fs.readFileSync(require.resolve('../vite-integrations-plugin.js'), 'utf8'),
      fs.readFileSync(require.resolve('../db/prod-integrations.cjs'), 'utf8'),
    ];
    check(
      'development and production derive staff-compose scope and sender server-side',
      staffComposeRouteFiles[0].includes("req.headers?.['x-company-id'] || caller.companyId")
        && staffComposeRouteFiles[1].includes("req.headers?.['x-company-id'] || caller.company_id")
        && staffComposeRouteFiles.every((source) =>
          source.includes("source: 'staff_compose'") &&
          source.includes('INSERT INTO communications') &&
          source.includes('You do not have access to send email for this company')),
      staffComposeRouteFiles.map((source) => source.includes("source: 'staff_compose'")),
    );
    const entityApiFiles = [
      fs.readFileSync(require.resolve('../vite-db-plugin.js'), 'utf8'),
      fs.readFileSync(require.resolve('../db/prod-db.cjs'), 'utf8'),
    ];
    check(
      'development and production hide email rate and delivery audit entities from public CRUD',
      entityApiFiles.every((source) =>
        source.includes("'EmailRateLimit'")
          && source.includes("'EmailDeliveryEvent'")
          && source.includes("'EmailProviderStatus'")
          && source.includes('isInternalEntityType(entityType)')),
    );
    const composeScopeFiles = [
      fs.readFileSync(require.resolve('../vite-integrations-plugin.js'), 'utf8'),
      fs.readFileSync(require.resolve('../db/prod-integrations.cjs'), 'utf8'),
    ];
    const composeClient = fs.readFileSync(require.resolve('../src/api/base44Client.js'), 'utf8');
    check(
      'staff compose requests the selected company but both servers authorize that scope',
      composeClient.includes("'x-company-id': activeCompanyId")
        && composeScopeFiles.every((source) => source.includes("req.headers?.['x-company-id'] || caller."))
        && composeScopeFiles.every((source) => source.includes('You do not have access to send email for this company')),
    );

    // ── Provider bounce/complaint ingress ────────────────────────────────
    // Without this route the circuit breaker is inert in production: bounces
    // and complaints arrive asynchronously from the provider, not as send
    // failures, so nothing would ever trip the pause.
    const webhook = require('../lib/emailDeliveryWebhook.cjs');

    const postmarkBounce = webhook.parseProviderEvents({ RecordType: 'Bounce', MessageID: 'pm-1', Email: 'bounced@example.net' });
    check('a Postmark bounce is understood', postmarkBounce.length === 1 && postmarkBounce[0].event === 'bounce' && postmarkBounce[0].messageId === 'pm-1', postmarkBounce);
    const postmarkComplaint = webhook.parseProviderEvents({ RecordType: 'SpamComplaint', MessageID: 'pm-2', Email: 'angry@example.net' });
    check('a Postmark spam complaint is understood', postmarkComplaint.length === 1 && postmarkComplaint[0].event === 'complaint', postmarkComplaint);
    const resendBounce = webhook.parseProviderEvents({ type: 'email.bounced', data: { email_id: 're-1', to: ['bounced@example.net'] } });
    check('a Resend bounce is understood', resendBounce.length === 1 && resendBounce[0].provider === 'resend' && resendBounce[0].recipient === 'bounced@example.net', resendBounce);
    const sesComplaint = webhook.parseProviderEvents({
      Type: 'Notification',
      Message: JSON.stringify({ notificationType: 'Complaint', mail: { messageId: 'ses-1' }, complaint: { complainedRecipients: [{ emailAddress: 'angry@example.net' }] } }),
    });
    check('an SES complaint wrapped in SNS is understood', sesComplaint.length === 1 && sesComplaint[0].event === 'complaint' && sesComplaint[0].messageId === 'ses-1', sesComplaint);
    // Delivery confirmations are now parsed (the communication timeline needs
    // them), but they must never be treated as a reputation signal — the
    // breaker only ever counts bounces and complaints.
    const delivered = webhook.parseProviderEvents({ RecordType: 'Delivery', MessageID: 'pm-3' });
    check('a delivered event is understood', delivered.length === 1 && delivered[0].event === 'delivered', delivered);
    check(
      'a delivered event is not mistaken for a failure',
      health.reportDeliveryEvent({ event: 'delivered', provider: 'postmark', messageId: 'pm-3' }).accepted === false,
    );
    check('an unrecognized payload never invents an event', webhook.parseProviderEvents({ something: 'else' }).length === 0);

    const callWebhook = async ({ secret, token, header, body }) => {
      const previousSecret = process.env.EMAIL_PROVIDER_WEBHOOK_SECRET;
      if (secret === null) delete process.env.EMAIL_PROVIDER_WEBHOOK_SECRET;
      else process.env.EMAIL_PROVIDER_WEBHOOK_SECRET = secret;
      const reported = [];
      const req = Object.assign(new (require('events').EventEmitter)(), {
        url: token ? `/api/email/delivery-webhook?token=${encodeURIComponent(token)}` : '/api/email/delivery-webhook',
        method: 'POST',
        headers: header ? { 'x-email-webhook-secret': header } : {},
        body: JSON.stringify(body || {}),
      });
      let status = null;
      const res = { writeHead: (code) => { status = code; }, end: () => {} };
      // In-memory stand-in for the delivery-event ledger and communications
      // table: this suite is about authentication and the circuit breaker, and
      // must not touch (or depend on) a real database.
      const ledger = [];
      const pool = {
        async query(sql, params = []) {
          if (/INSERT INTO email_delivery_events/i.test(sql)) {
            if (ledger.includes(params[0])) return { rowCount: 0, rows: [] };
            ledger.push(params[0]);
            return { rowCount: 1, rows: [{ id: params[0] }] };
          }
          return { rowCount: 0, rows: [] };
        },
      };
      const handled = await webhook.handleEmailDeliveryWebhook(req, res, {
        pool,
        emailHealth: { reportDeliveryEvent: (event) => { reported.push(event); return { accepted: true, paused: false }; } },
      });
      if (previousSecret === undefined) delete process.env.EMAIL_PROVIDER_WEBHOOK_SECRET;
      else process.env.EMAIL_PROVIDER_WEBHOOK_SECRET = previousSecret;
      return { handled, status, reported };
    };

    const unconfigured = await callWebhook({ secret: null, header: 'anything', body: { RecordType: 'Bounce' } });
    check('an unconfigured delivery webhook fails closed', unconfigured.status === 503 && unconfigured.reported.length === 0, unconfigured);
    const forged = await callWebhook({ secret: 'correct-webhook-secret', header: 'wrong-secret', body: { RecordType: 'SpamComplaint' } });
    check('a forged complaint cannot pause delivery', forged.status === 401 && forged.reported.length === 0, forged);
    const missingAuth = await callWebhook({ secret: 'correct-webhook-secret', body: { RecordType: 'Bounce' } });
    check('an unauthenticated delivery webhook is rejected', missingAuth.status === 401 && missingAuth.reported.length === 0, missingAuth);
    const authorized = await callWebhook({ secret: 'correct-webhook-secret', header: 'correct-webhook-secret', body: { RecordType: 'Bounce', MessageID: 'pm-9', Email: 'bounced@example.net' } });
    check('an authenticated bounce reaches the circuit breaker', authorized.reported.length === 1 && authorized.reported[0].event === 'bounce', authorized);
    const viaQueryToken = await callWebhook({ secret: 'correct-webhook-secret', token: 'correct-webhook-secret', body: { RecordType: 'SpamComplaint', MessageID: 'pm-10' } });
    check('providers that can only configure a URL can authenticate by token', viaQueryToken.reported.length === 1 && viaQueryToken.reported[0].event === 'complaint', viaQueryToken);

    const webhookRouteFiles = [
      fs.readFileSync(require.resolve('../vite-functions-plugin.js'), 'utf8'),
      fs.readFileSync(require.resolve('../prod-server.cjs'), 'utf8'),
    ];
    check(
      'dev and production both expose the delivery webhook',
      webhookRouteFiles.every((source) => source.includes('handleEmailDeliveryWebhook')),
    );

    // The prod-server sendEmail wrapper is used by many workflows. Without a
    // context it charges every send to the default platform bucket, so the
    // per-company limit would not apply to any of them.
    const prodServerSource = webhookRouteFiles[1];
    const prodWrapper = prodServerSource.slice(
      prodServerSource.indexOf('async function sendEmail({'),
      prodServerSource.indexOf('let stripeClient = null;'),
    );
    check(
      'the prod-server send wrapper attributes sends to their company',
      prodWrapper.includes('context:') && prodWrapper.includes('companyId: context?.companyId || companyId'),
      prodWrapper.slice(-400),
    );

    // ── Unauthenticated relay via the generic function dispatcher ─────────
    // Email handlers accept internal calls with no HTTP request, so an alias
    // that forgets to forward `req` used to look exactly like trusted internal
    // traffic and sent anything to anyone. Run in a child process: importing
    // the whole plugin registry into this suite would fight its module hook.
    // Recipients are reserved test addresses, so even a regression cannot
    // deliver real mail.
    const relayProbe = require('child_process').spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { functionHandlers } = await import('./vite-functions-plugin.js');
      const base = { to: 'qa-relay-probe@companysync.io', subject: 'relay probe', html: '<p>probe</p>', companyId: 'a-company-the-caller-does-not-own' };
      const attempt = async (fn, params) => {
        try { await fn(params); return 'SENT'; } catch (e) { return e.message; }
      };
      console.log(JSON.stringify({
        fromCrmExternal: await attempt(functionHandlers.sendEmailFromCRM, { ...base, __externalCall: true }),
        withResendExternal: await attempt(functionHandlers.sendEmailWithResend, { ...base, __externalCall: true }),
        taskEmailExternal: await attempt(functionHandlers.sendTaskEmail, { ...base, __externalCall: true }),
        brandingExternal: await attempt(functionHandlers.sendEmailWithBranding, { ...base, __externalCall: true }),
        internalStillWorks: await attempt(functionHandlers.sendEmailWithResend, { ...base }),
      }));
      process.exit(0);
    `], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8', timeout: 120000 });
    let relay = null;
    try {
      relay = JSON.parse(relayProbe.stdout.split('\n').filter((line) => line.trim().startsWith('{')).pop());
    } catch { /* leave null so the checks below fail loudly */ }
    check('an unauthenticated sendEmailFromCRM cannot relay mail', relay?.fromCrmExternal === 'Authentication required', relay);
    check('an unauthenticated sendEmailWithResend cannot relay mail', relay?.withResendExternal === 'Authentication required', relay);
    check('an unauthenticated sendTaskEmail cannot relay mail', relay?.taskEmailExternal === 'Authentication required', relay);
    check('an unauthenticated sendEmailWithBranding cannot relay mail', relay?.brandingExternal === 'Authentication required', relay);
    // Internal senders must still get through the guard (they are stopped later,
    // by the reserved-test-recipient rule, which proves they passed authorization).
    check('internal server-side senders are not broken by the guard', typeof relay?.internalStillWorks === 'string' && relay.internalStillWorks !== 'Authentication required', relay);

    check(
      'both dispatchers mark externally invoked calls',
      webhookRouteFiles[0].includes('__externalCall: true') &&
        fs.readFileSync(require.resolve('../db/prod-integrations.cjs'), 'utf8').includes('__externalCall: true'),
    );

    // ── Generated estimate/invoice mail must be tenant-attributed ─────────
    // The primary customer-facing flows. The raw-HTML branch carried the
    // resolved context but the generated branch dropped it, so those sends used
    // the default platform rate bucket with no actor identity — a company could
    // evade its per-company cap through the path it actually uses. Runs in a
    // child process because it captures the real transport options.
    const contextProbe = require('child_process').spawnSync(
      process.execPath,
      [require.resolve('../scripts/probe-document-email-context.mjs')],
      { cwd: require('path').join(__dirname, '..'), encoding: 'utf8', timeout: 180000 },
    );
    let docContext = null;
    try {
      const line = (contextProbe.stdout || '').split('\n').find((l) => l.startsWith('PROBE_RESULT '));
      docContext = JSON.parse(line.slice('PROBE_RESULT '.length));
    } catch { /* leave null so the checks fail loudly */ }
    check('the document-attribution probe ran', docContext?.ok === true, docContext || (contextProbe.stderr || '').slice(-500));
    for (const kind of ['estimate', 'invoice']) {
      const actual = docContext?.[kind]?.context;
      check(
        `a generated ${kind} email is attributed to the owning company`,
        !!actual && actual.companyId === docContext?.expected?.companyId,
        docContext?.[kind],
      );
      check(
        `a generated ${kind} email records who sent it`,
        actual?.actorEmail === docContext?.expected?.actorEmail,
        docContext?.[kind],
      );
      check(
        `a generated ${kind} email ignores a caller-supplied company id`,
        !!actual && actual.companyId !== docContext?.expected?.rejectedCompanyId,
        docContext?.[kind],
      );
    }

    for (const kind of ['estimate', 'invoice']) {
      const snake = docContext?.[`${kind}Snake`];
      check(
        `a snake_case ${kind}_id still resolves the owning company`,
        snake?.context?.companyId === docContext?.expected?.companyId,
        snake,
      );
    }

    // Production authorizes at its own route, so the dev results above prove
    // nothing about it. The attack: authorize against a company you really
    // belong to while naming another tenant's document in a spelling the guard
    // does not read. If the guard and the sender resolve the id differently,
    // authorization passes for one company and the send uses the other's
    // document, branding and recipient.
    for (const kind of ['Estimate', 'Invoice']) {
      const foreign = docContext?.[`prodForeign${kind}`];
      check(
        `production refuses a snake_case ${kind.toLowerCase()} id owned by another company`,
        foreign?.status >= 400 && /do not have access/i.test(foreign?.body?.error || ''),
        foreign,
      );
      check(
        `production sends nothing for a cross-tenant ${kind.toLowerCase()} attempt`,
        foreign?.sends === 0,
        foreign,
      );
    }
    check(
      "production still sends the caller's own snake_case document",
      docContext?.prodOwnEstimate?.sends === 1 && docContext?.prodOwnEstimate?.status === 200,
      docContext?.prodOwnEstimate,
    );

    // A signed-in staff compose request may deliver, but cannot select another
    // company's quota or sender identity from its request payload.
    check(
      'the production staff-compose route ignores a caller-supplied company',
      docContext?.prodGenericSend?.status === 200
        && docContext?.prodGenericSend?.context?.companyId === docContext?.expected?.companyId,
      docContext?.prodGenericSend,
    );
    check(
      'the production staff-compose route ignores a caller-supplied sender',
      /Probe Roofing Co/.test(docContext?.prodGenericSend?.from || '')
        && !/Attacker/.test(docContext?.prodGenericSend?.from || ''),
      docContext?.prodGenericSend,
    );

    // ── No ungoverned fallback when a send is refused ─────────────────────
    // Falling back to the platform's generic Core.SendEmail turned every
    // refusal — including the edge-sender kill switch and the safety controls
    // themselves — into "send it anyway by another route".
    const brandingEdge = fs.readFileSync(require.resolve('../functions/sendEmailWithBranding.ts'), 'utf8');
    // Strip comments: the file explains the removed fallback by name, and that
    // prose must not read as a live call site.
    const brandingCode = brandingEdge.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    check(
      'a refused branded email is not re-sent through an ungoverned sender',
      !brandingCode.includes('Core.SendEmail'),
      brandingCode.slice(-900),
    );
    check(
      'a disabled edge sender is reported as blocked, not retried elsewhere',
      brandingEdge.includes('EDGE_SENDER_DISABLED'),
      brandingEdge.slice(-900),
    );

    // ── Content caps apply to company SMTP too ───────────────────────────
    const safety = require('../lib/emailSafety.cjs');
    const tooLarge = (fn) => {
      try { fn(); return null; } catch (e) { return e.code; }
    };
    check(
      'an oversized subject is refused',
      tooLarge(() => safety.assertContentWithinLimits({ subject: 'x'.repeat(safety.MAX_SUBJECT_LENGTH + 1), html: 'hi' })) === 'EMAIL_CONTENT_TOO_LARGE',
    );
    check(
      'an oversized body is refused',
      tooLarge(() => safety.assertContentWithinLimits({ subject: 'ok', html: 'x'.repeat(safety.MAX_BODY_LENGTH + 1) })) === 'EMAIL_CONTENT_TOO_LARGE',
    );
    check(
      'a normal message passes the content cap',
      tooLarge(() => safety.assertContentWithinLimits({ subject: 'ok', html: '<p>hi</p>' })) === null,
    );
    check(
      'the company SMTP path enforces the shared content cap',
      /assertContentWithinLimits\(\{ subject, html, text: emailBody \}\)/.test(
        fs.readFileSync(require.resolve('../db/prod-integrations.cjs'), 'utf8'),
      ),
    );

    // ── Signup/login/password mail must use the guarded transport ─────────
    const localAuthSource = fs.readFileSync(require.resolve('../db/local-auth.cjs'), 'utf8');
    const localAuthSender = localAuthSource.slice(
      localAuthSource.indexOf('async function sendEmail('),
      localAuthSource.indexOf('async function createSession('),
    );
    check(
      'auth email does not bypass the guards with a direct SMTP send',
      !localAuthSender.includes('createTransport') && !localAuthSender.includes('sendMail'),
      localAuthSender,
    );
    check(
      'auth email goes through the guarded transport with attribution',
      localAuthSender.includes('sendPlatformSubscriberEmail') &&
        localAuthSender.includes("source: 'subscriber-auth'") &&
        localAuthSender.includes("PLATFORM_EMAIL_FROM") &&
        localAuthSender.includes("PLATFORM_EMAIL_REPLY_TO"),
      localAuthSender,
    );

    // ── Document ownership must fail closed ──────────────────────────────
    const ownerGuards = [
      webhookRouteFiles[0].slice(webhookRouteFiles[0].indexOf('async function authorizeDocumentEmail(')),
      fs.readFileSync(require.resolve('../db/prod-integrations.cjs'), 'utf8').slice(
        fs.readFileSync(require.resolve('../db/prod-integrations.cjs'), 'utf8').indexOf('async function authorizeDocumentEmailProd('),
      ),
    ].map((source) => source.slice(0, source.indexOf('\n}\n') + 3));
    check(
      'a failed ownership lookup refuses to send instead of trusting the caller',
      ownerGuards.every((source) =>
        source.includes('Could not verify who owns this document') &&
        source.includes('does not exist, so the email was not sent')),
      ownerGuards,
    );
  } finally {
    Module._load = originalLoad;
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n── Summary: ${passed} passed, ${failed} failed ─────────────────────`);
  process.exitCode = failed === 0 ? 0 : 1;
})().catch((error) => {
  console.error('\n✗ Unexpected test error:', error);
  process.exitCode = 1;
});