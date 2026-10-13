#!/usr/bin/env node
/**
 * Email Delivery Smoke Test (end-to-end, live server)
 * ─────────────────────────────────────────────────────────────
 * Exercises the same dev-server function RPC used by the app:
 *
 *   forged session → POST /api/functions/invoke
 *     → sendUnifiedEmail → sendEmailWithResend → emailTransport → provider
 *
 * It sends one real email to the explicitly supplied test recipient, then
 * verifies the persisted provider receipt. It also uses isolated fixtures to
 * prove unauthenticated/cross-tenant quick-email requests create no delivery
 * record and that workflow failures/skips are recorded without sending mail.
 * The provider response must contain a non-empty message id (exposed by the
 * handler as `data.id`), and the server's provider health endpoint must report
 * that same provider in an `ok` state after the send.
 *
 * The test asserts against whichever provider the SERVER resolves rather than a
 * hardcoded one. Sending can legitimately be moved between providers (see the
 * EMAIL_PROVIDER override), and a delivery check matters most precisely then.
 *
 * Prerequisites:
 *   - Dev server running (`npm run dev`) on PORT (default 5000)
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *   - Some email provider configured (the server must not report 'none')
 *
 * Usage:
 *   TEST_EMAIL_RECIPIENT=you@example.com node scripts/test-email-delivery.cjs
 *   node scripts/test-email-delivery.cjs you@example.com
 *
 * The test uses an active, isolated company fixture so it does not consume a
 * trial company's daily email allowance. Its database rows are removed in a
 * finally block, including when the provider request fails.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || process.env.TEST_BASE_URL ||
  `http://localhost:${process.env.PORT || 5000}`;
const RECIPIENT = process.env.TEST_EMAIL_RECIPIENT || process.argv[2];
const SESSION_SECRET = process.env.SESSION_SECRET;

const COMPANY_ID = 'smoke_email_delivery_company';
const OTHER_COMPANY_ID = 'smoke_email_delivery_other_company';
const SESSION_ID = 'smoke_email_delivery_session';
const USER_EMAIL = 'smoke-email-delivery@example.com';
const FORGED_RECIPIENT = 'unauthorized-email-test@example.invalid';
const WORKFLOW_FAILED_ID = 'smoke_email_delivery_workflow_failed';
const WORKFLOW_SKIPPED_ID = 'smoke_email_delivery_workflow_skipped';
let pool = null;

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

function signSessionId(sid) {
  const signature = crypto.createHmac('sha256', SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `s:${sid}.${signature}`;
}

function forgedCookie() {
  return `connect.sid=${encodeURIComponent(signSessionId(SESSION_ID))}`;
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const request = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
        ...(options.headers || {}),
      },
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        let data = raw;
        try { data = JSON.parse(raw); } catch { /* preserve non-JSON response */ }
        resolve({ status: response.statusCode, data });
      });
    });
    request.setTimeout(120000, () => request.destroy(new Error('Request timed out')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function cleanup() {
  if (!pool) return;
  await pool.query('DELETE FROM communications WHERE company_id IN ($1, $2)', [COMPANY_ID, OTHER_COMPANY_ID]).catch(() => {});
  await pool.query('DELETE FROM generic_entities WHERE company_id IN ($1, $2)', [COMPANY_ID, OTHER_COMPANY_ID]).catch(() => {});
  await pool.query('DELETE FROM sessions WHERE sid = $1', [SESSION_ID]).catch(() => {});
  await pool.query('DELETE FROM companies WHERE id IN ($1, $2)', [COMPANY_ID, OTHER_COMPANY_ID]).catch(() => {});
}

async function setup() {
  await cleanup();
  await pool.query(
    `INSERT INTO companies
       (id, company_name, created_by, subscription_plan, subscription_status, created_at, updated_at)
     VALUES ($1, 'Smoke Email Delivery Co', $2, 'business', 'active', NOW(), NOW())`,
    [COMPANY_ID, USER_EMAIL],
  );
  await pool.query(
    `INSERT INTO companies
       (id, company_name, created_by, subscription_plan, subscription_status, created_at, updated_at)
     VALUES ($1, 'Other Smoke Email Delivery Co', 'other-company-owner@example.com', 'business', 'active', NOW(), NOW())`,
    [OTHER_COMPANY_ID],
  );

  const expires = new Date(Date.now() + 60 * 60 * 1000);
  const session = {
    cookie: {
      originalMaxAge: 3600000,
      expires: expires.toISOString(),
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
    },
    passport: {
      user: {
        claims: {
          sub: USER_EMAIL,
          email: USER_EMAIL,
          full_name: 'Smoke Email Delivery',
        },
        expires_at: Math.floor(expires.getTime() / 1000),
      },
    },
    company_id: COMPANY_ID,
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
    [SESSION_ID, JSON.stringify(session), expires],
  );
}

async function invokeUnifiedEmail() {
  return fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    headers: { Cookie: forgedCookie() },
    body: {
      functionName: 'sendUnifiedEmail',
      params: {
        to: RECIPIENT,
        subject: `[CompanySync smoke test] Email delivery ${Date.now()}`,
        html: [
          '<p>This is an automated CompanySync email delivery test.</p>',
          '<p>A real provider message id is required for this test to pass.</p>',
        ].join(''),
        companyId: COMPANY_ID,
        skipNotification: true,
      },
    },
  });
}

async function invoke(functionName, params, cookie = forgedCookie()) {
  return fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    ...(cookie ? { headers: { Cookie: cookie } } : {}),
    body: { functionName, params },
  });
}

async function communicationRows(companyId, source) {
  const result = await pool.query(
    `SELECT status, contact_email, subject, data
       FROM communications
      WHERE company_id = $1
        AND data->>'source' = $2
      ORDER BY created_at ASC`,
    [companyId, source],
  );
  return result.rows.map(row => ({
    ...row,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
  }));
}

async function insertWorkflow(id, actions) {
  await pool.query(
    `INSERT INTO generic_entities
       (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'Workflow', $2, $3::jsonb, NOW(), NOW())`,
    [id, COMPANY_ID, JSON.stringify({ workflow_name: id, trigger_type: 'test', actions })],
  );
}

async function getProviderStatus() {
  return fetchJson(`${BASE_URL}/api/local/email-provider-status`);
}

async function waitForHealthyProvider(expectedProvider, maxMs = 5000) {
  const deadline = Date.now() + maxMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await getProviderStatus();
    if (latest.status === 200 && latest.data?.provider === expectedProvider &&
        latest.data?.state === 'ok') {
      return latest;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return latest;
}

async function main() {
  console.log('\n── Email Delivery Smoke Test ──────────────────────────────────\n');

  if (!RECIPIENT) {
    console.error('TEST_EMAIL_RECIPIENT is required (or pass the recipient as the first argument).');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL || !SESSION_SECRET) {
    console.error('DATABASE_URL and SESSION_SECRET are required to create a forged session.');
    process.exitCode = 1;
    return;
  }

  pool = createPool({ connectionString: process.env.DATABASE_URL });
  console.log(`Server: ${BASE_URL}`);
  console.log(`Recipient: ${RECIPIENT}`);

  try {
    await setup();

    console.log('\n[ Authorization boundaries ]');
    const unauthenticated = await invoke('sendUnifiedEmail', {
      to: FORGED_RECIPIENT,
      subject: 'Unauthorized email test',
      html: '<p>This must not be sent.</p>',
      companyId: COMPANY_ID,
    }, null);
    check('unauthenticated quick email is rejected',
      unauthenticated.status >= 400 && /Authentication required/.test(String(unauthenticated.data?.error || '')),
      unauthenticated);
    check('unauthenticated quick email creates no communication',
      (await communicationRows(COMPANY_ID, 'quick_email')).length === 0,
      await communicationRows(COMPANY_ID, 'quick_email'));

    const crossTenant = await invoke('sendUnifiedEmail', {
      to: FORGED_RECIPIENT,
      subject: 'Cross-tenant email test',
      html: '<p>This must not be sent.</p>',
      companyId: OTHER_COMPANY_ID,
    });
    check('signed user cannot send email for another company',
      crossTenant.status >= 400 && /do not have access/.test(String(crossTenant.data?.error || '')),
      crossTenant);
    check('cross-tenant request creates no communication',
      (await communicationRows(OTHER_COMPANY_ID, 'quick_email')).length === 0,
      await communicationRows(OTHER_COMPANY_ID, 'quick_email'));

    const before = await getProviderStatus();
    check('provider status endpoint is reachable before the send', before.status === 200, before);
    // The active provider is whatever the server resolves (credentials plus the
    // EMAIL_PROVIDER override) — asserting a specific one here would make this
    // smoke test fail every time sending is legitimately moved to another
    // provider, which is exactly when a delivery check matters most.
    const activeProvider = before.data?.provider;
    check('server reports a usable active provider before the send',
      !!activeProvider && activeProvider !== 'none', before.data);
    if (!activeProvider || activeProvider === 'none') {
      failed++;
      console.error('  ✗ Refusing to send because no email provider is configured');
      process.exitCode = 1;
      return;
    }
    console.log(`Active provider: ${activeProvider}`);

    console.log('\n[ Live function invocation ]');
    const response = await invokeUnifiedEmail();
    const result = response.data?.data;
    check('function invocation returns HTTP 200', response.status === 200, response);
    check('function envelope has no error', !response.data?.error, response.data);
    check('handler reports a successful send', result?.success === true, result);
    check('handler sends through the server\'s active provider',
      result?.provider === activeProvider, result);
    check('provider returned a non-empty message id',
      typeof result?.id === 'string' && result.id.trim().length > 0, result?.id);

    const quickEmailRows = await communicationRows(COMPANY_ID, 'quick_email');
    const quickEmailRow = quickEmailRows[quickEmailRows.length - 1];
    check('accepted quick email has one persisted communication',
      quickEmailRows.length === 1, quickEmailRows);
    check('accepted quick email records the sending provider and message id',
      quickEmailRow?.status === 'accepted' &&
        quickEmailRow?.data?.provider === activeProvider &&
        quickEmailRow?.data?.provider_message_id === result?.id,
      quickEmailRow);

    console.log('\n[ Workflow delivery outcomes ]');
    await insertWorkflow(WORKFLOW_FAILED_ID, [{
      action_type: 'send_email',
      recipient: '{{customer_email}}',
      email_subject: 'Workflow failure fixture',
      email_body: 'This uses an invalid resolved address and must fail before delivery.',
    }]);
    const workflowFailure = await invoke('testWorkflow', {
      workflowId: WORKFLOW_FAILED_ID,
      testEmail: 'not-an-email-address',
      testerName: 'Workflow Fixture',
    });
    const failedWorkflowRows = await communicationRows(COMPANY_ID, 'workflow');
    const failedWorkflowRow = failedWorkflowRows.find(row =>
      row.subject === '[TEST] Workflow failure fixture' && row.status === 'failed');
    check('workflow invalid-recipient action reports failure',
      workflowFailure.status === 200 &&
        workflowFailure.data?.data?.stepResults?.[0]?.success === false,
      workflowFailure);
    check('workflow email failure records failed outcome and error',
      failedWorkflowRow?.data?.error && /valid email|recipient/i.test(failedWorkflowRow.data.error),
      failedWorkflowRow);

    await insertWorkflow(WORKFLOW_SKIPPED_ID, [{
      action_type: 'send_email',
      recipient: '{{unresolved_staff_email}}',
      email_subject: 'Workflow skip fixture',
      email_body: 'This unresolved staff token must not fall back to a customer.',
    }]);
    const workflowSkip = await invoke('testWorkflow', {
      workflowId: WORKFLOW_SKIPPED_ID,
      testEmail: RECIPIENT,
      testerName: 'Workflow Fixture',
    });
    const skippedWorkflowRows = await communicationRows(COMPANY_ID, 'workflow');
    const skippedWorkflowRow = skippedWorkflowRows.find(row =>
      row.subject === '[TEST] Workflow skip fixture' && row.status === 'skipped');
    check('workflow unresolved staff recipient reports a skip',
      workflowSkip.status === 200 &&
        workflowSkip.data?.data?.stepResults?.[0]?.success === false,
      workflowSkip);
    check('workflow recipient-resolution skip records skipped outcome and reason',
      /did not resolve to an email/i.test(skippedWorkflowRow?.data?.error || ''),
      skippedWorkflowRow);

    console.log('\n[ Provider health after the send ]');
    const after = await waitForHealthyProvider(activeProvider);
    check('provider status endpoint returns HTTP 200 after the send', after?.status === 200, after);
    check('health provider matches the sending provider after the send',
      after?.data?.provider === activeProvider, after?.data);
    check('health state is ok after the send',
      after?.data?.state === 'ok', after?.data);
  } catch (error) {
    failed++;
    console.error('\n✗ Unexpected failure:', error.message);
  } finally {
    await cleanup();
    await pool.end().catch(() => {});
  }

  console.log(`\n── Summary: ${passed} passed, ${failed} failed ─────────────────────`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(error => {
  console.error('\n✗ Fatal test error:', error);
  process.exitCode = 1;
});