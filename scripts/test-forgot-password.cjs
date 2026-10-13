#!/usr/bin/env node
/**
 * Regression tests for the local forgot-password handler.
 *
 * These tests keep the database and email provider in memory. They verify that
 * a successful send completes normally and that a provider failure/timeout
 * returns a finite error response instead of leaving the browser on "Sending".
 */

'use strict';

process.env.EMAIL_PROVIDER = 'postmark';
process.env.POSTMARK_SERVER_TOKEN = 'test-token';
process.env.EMAIL_PROVIDER_REQUEST_TIMEOUT_MS = '50';
process.env.EMAIL_ALLOW_RESERVED_RECIPIENTS = '1';

const auth = require('../db/local-auth.cjs');
const transport = require('../lib/emailTransport.cjs');
const emailHealth = require('../lib/emailProviderHealth.cjs');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(body = '') {
      this.body = body;
      this.finished = true;
    },
  };
}

function makePool() {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql.includes('SELECT id, email FROM users')) {
        return { rows: [{ id: 'user-1', email: 'reset@example.com' }] };
      }
      if (sql.includes('SELECT sp.*, ge.data')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function parseResponse(res) {
  return JSON.parse(res.body);
}

async function run() {
  let retriesUsed = null;
  let subscriberOptions = null;
  const originalSubscriberSend = transport.sendPlatformSubscriberEmail;
  const originalFetch = global.fetch;
  const originalEnsureHydrated = emailHealth.ensureHydrated;

  try {
    transport.sendPlatformSubscriberEmail = async (options, retries) => {
      subscriberOptions = options;
      retriesUsed = retries;
      return { success: true, provider: 'test', id: 'message-1' };
    };

    const successResponse = makeResponse();
    await auth.handleForgotPassword(
      {
        method: 'POST',
        headers: {},
        body: { email: 'reset@example.com' },
      },
      successResponse,
      makePool(),
    );
    const successBody = parseResponse(successResponse);
    check('successful email returns HTTP 200', successResponse.statusCode === 200);
    check('successful email returns generic success message', successBody.success === true);
    check('interactive reset uses one provider attempt', retriesUsed === 1, retriesUsed);
    check('password reset uses the required platform From', subscriberOptions?.from === 'CompanySync <hello@getcompanysync.com>', subscriberOptions?.from);
    check('password reset uses the required Reply-To', subscriberOptions?.replyTo === 'io.companysync@gmail.com', subscriberOptions?.replyTo);

    transport.sendPlatformSubscriberEmail = async () => {
      const error = new Error('provider request timed out');
      error.code = 'EMAIL_PROVIDER_TIMEOUT';
      throw error;
    };

    const timeoutResponse = makeResponse();
    await auth.handleForgotPassword(
      {
        method: 'POST',
        headers: {},
        body: { email: 'timeout@example.com' },
      },
      timeoutResponse,
      makePool(),
    );
    const timeoutBody = parseResponse(timeoutResponse);
    check('provider timeout returns HTTP 503', timeoutResponse.statusCode === 503);
    check('provider timeout returns a retryable error', /could not send/i.test(timeoutBody.error || ''));
    check('provider timeout never reports success', timeoutBody.success !== true);
    check('provider timeout completes the response', timeoutResponse.finished === true);

    // Exercise the real transport timeout mapping as well as the handler's
    // error mapping without opening a network connection.
    emailHealth.ensureHydrated = async () => {};
    global.fetch = async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    const startedAt = Date.now();
    let transportTimeout = null;
    try {
      await transport.sendPlatformEmail(
        { to: 'transport-timeout@example.com', subject: 'Reset', html: '<p>Reset</p>' },
        1,
      );
    } catch (error) {
      transportTimeout = error;
    }
    check('provider request deadline raises a typed timeout', transportTimeout?.code === 'EMAIL_PROVIDER_TIMEOUT');
    check('provider request deadline is finite', Date.now() - startedAt < 1000);
  } finally {
    transport.sendPlatformSubscriberEmail = originalSubscriberSend;
    global.fetch = originalFetch;
    emailHealth.ensureHydrated = originalEnsureHydrated;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});