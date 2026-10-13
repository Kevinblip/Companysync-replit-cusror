#!/usr/bin/env node
'use strict';

// Regression coverage for the shared dev/prod signing-link delivery boundary.
// It uses the real signed-cookie tenant guard and a mock database/transport, so
// it cannot send mail while still proving the authorization and relay controls.
const crypto = require('crypto');
const { Readable } = require('stream');
const emailTransport = require('../lib/emailTransport.cjs');
const { handleSigningLinkDelivery, MAX_BODY_BYTES } = require('../lib/signingLinkDelivery.cjs');

process.env.SESSION_SECRET ||= 'signing-link-delivery-test-secret';
process.env.REPLIT_DEPLOYMENT = '1';
process.env.VITE_REPLIT_APP_URL = 'https://canonical.test';
const originalSend = emailTransport.sendPlatformEmail;
const calls = [];
emailTransport.sendPlatformEmail = async (payload) => {
  calls.push(payload);
  return { id: 'mock-delivery-id' };
};

let passed = 0;
let failed = 0;
function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

function signedCookie(sid) {
  const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid).digest('base64').replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}

function request(body, cookie) {
  const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  req.method = 'POST';
  req.headers = { host: 'app.test', ...(cookie ? { cookie } : {}) };
  return req;
}

function response() {
  return {
    status: 0, headers: {}, text: '',
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body = '') { this.text += body; },
  };
}

function makePool({ authorizedEmail = 'admin@company.test', recentCount = 0, communicationsRole = false, deliveryMethod = 'email', status = 'draft', impersonating = false, templateId = null } = {}) {
  const session = {
    id: 17, base44_session_id: 'draft-17', company_id: 'company-a',
    customer_name: 'Actual Customer', customer_email: 'actual.customer@recipient.test',
    customer_phone: '+15555550123', delivery_method: deliveryMethod,
    template_name: 'Actual Contract', contract_name: 'Roof replacement',
    rep_name: 'Actual Rep', signing_token: 'before', status, template_id: templateId,
  };
  const state = { updates: 0, session };
  return {
    state,
    async connect() { return this; },
    release() {},
    async query(sql, params = []) {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM sessions WHERE sid')) {
        const email = params[0] === 'foreign' ? 'other@company.test' : authorizedEmail;
        return { rows: [{ sess: {
          passport: { user: { claims: { email } } },
          ...(impersonating ? {
            impersonating_company_id: 'company-a',
            impersonation_expires_at: new Date(Date.now() + 60_000).toISOString(),
          } : {}),
        } }] };
      }
      if (sql.includes('FROM users WHERE LOWER(email)')) return { rows: [] };
      if (sql.includes('FROM staff_profiles') && sql.includes('is_super_admin')) {
        const email = params[0];
        return { rows: email === authorizedEmail
          ? [{ company_id: 'company-a', is_super_admin: false, is_administrator: !communicationsRole }]
          : [{ company_id: 'company-b', is_super_admin: false, is_administrator: true }] };
      }
      if (sql.includes('SELECT 1 FROM companies')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT role_id FROM staff_profiles')) return { rows: communicationsRole ? [{ role_id: 'role-send-email' }] : [], rowCount: communicationsRole ? 1 : 0 };
      if (sql.includes("entity_type='StaffRole'")) return { rows: [{ data: { permissions: { communication_hub: { send_email: true } } } }], rowCount: 1 };
      if (sql.includes("entity_type='ContractTemplate'")) {
        return params[0] === 'foreign-template'
          ? { rows: [], rowCount: 0 }
          : { rows: [{ data: { html_content: '{"blocks":[{"type":"paragraph","text":"Frozen terms"}]}' } }], rowCount: 1 };
      }
      if (sql.includes('FROM signing_sessions')) return { rows: [state.session], rowCount: 1 };
      if (sql.includes('COUNT(*)::int AS count')) return { rows: [{ count: recentCount }] };
      if (sql.includes('UPDATE signing_sessions')) {
        if (sql.includes('SET html_content')) {
          state.session = { ...state.session, html_content: params[0] };
          return { rows: [state.session], rowCount: 1 };
        }
        state.updates++;
        state.session = { ...state.session, signing_token: params[0], expires_at: params[1] };
        return { rows: [state.session], rowCount: 1 };
      }
      if (sql.includes('SELECT company_name FROM companies')) return { rows: [{ company_name: 'Company A' }] };
      if (sql.includes('INSERT INTO communications')) return { rows: [], rowCount: 1 };
      if (/UPDATE communications\s+SET status/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql.slice(0, 100)}`);
    },
  };
}

async function invoke(pool, body, sid) {
  const res = response();
  await handleSigningLinkDelivery(request(body, sid ? signedCookie(sid) : null), res, {
    pool, getBaseUrl: () => 'https://app.test',
  });
  return { res, data: JSON.parse(res.text || '{}') };
}

(async () => {
  console.log('\n=== signing-link delivery authorization ===\n');
  try {
    let pool = makePool();
    let result = await invoke(pool, { sessionId: 'draft-17' });
    check('anonymous caller is refused', result.res.status === 401, result.res.text);
    check('anonymous caller cannot rotate a token', pool.state.updates === 0);

    pool = makePool({ impersonating: true });
    result = await invoke(pool, { sessionId: 'draft-17' }, 'owner');
    check('impersonating staff cannot send signing links', result.res.status === 403, result.res.text);
    check('impersonation denial does not rotate a signing token', pool.state.updates === 0);
    check('impersonation denial does not invoke a mail provider', calls.length === 0);

    pool = makePool();
    result = await invoke(pool, {
      sessionId: 'draft-17',
      sessionData: { company_id: 'company-b', customer_email: 'attacker@evil.test', delivery_method: 'sms' },
    }, 'owner');
    check('authorized company admin may send', result.res.status === 200 && result.data.email_sent === true, result.res.text);
    check('stored recipient is the only recipient used', calls.at(-1)?.to?.[0] === 'actual.customer@recipient.test');
    check('caller data cannot replace stored company or recipient', pool.state.session.company_id === 'company-a' && calls.at(-1)?.to?.[0] !== 'attacker@evil.test');
    check('authorized resend rotates the stored signing token', pool.state.updates === 1 && pool.state.session.signing_token !== 'before');
    check('signing URL uses the canonical origin, not request host', result.data.signing_link?.startsWith('https://canonical.test/'));

    pool = makePool({ templateId: 'template-a' });
    result = await invoke(pool, { sessionId: 'draft-17' }, 'owner');
    check('delivery freezes the company template snapshot', result.res.status === 200 && Boolean(pool.state.session.html_content), result.res.text);

    const callsBeforeForeignTemplate = calls.length;
    pool = makePool({ templateId: 'foreign-template' });
    result = await invoke(pool, { sessionId: 'draft-17' }, 'owner');
    check('foreign template references are rejected before sending', result.res.status === 409 && pool.state.updates === 0, result.res.text);
    check('foreign template rejection does not invoke a mail provider', calls.length === callsBeforeForeignTemplate);

    pool = makePool({ communicationsRole: true });
    result = await invoke(pool, { sessionId: 'draft-17' }, 'owner');
    check('staff with communication email permission may send', result.res.status === 200 && result.data.email_sent === true, result.res.text);

    const originalFetch = global.fetch;
    process.env.TWILIO_ACCOUNT_SID = 'test-account';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_PHONE_NUMBER = '+15555550199';
    const smsCalls = [];
    global.fetch = async (url, options) => {
      smsCalls.push({ url, options });
      return { ok: true, json: async () => ({ sid: 'mock-sms-id' }) };
    };
    pool = makePool({ deliveryMethod: 'sms' });
    result = await invoke(pool, { sessionId: 'draft-17', sessionData: { customer_phone: '+19999999999' } }, 'owner');
    check('stored SMS sessions still deliver by SMS', result.res.status === 200 && result.data.sms_sent === true && smsCalls.length === 1, result.res.text);
    check('stored SMS recipient cannot be replaced by payload', smsCalls[0]?.options?.body?.includes('To=%2B15555550123'));
    global.fetch = originalFetch;

    const callsBeforeTerminalAttempt = calls.length;
    pool = makePool({ status: 'completed' });
    result = await invoke(pool, { sessionId: 'draft-17' }, 'owner');
    check('completed contracts cannot be reopened by resend', result.res.status === 409, result.res.text);
    check('completed contracts retain their original signing token', pool.state.session.signing_token === 'before' && pool.state.updates === 0);
    check('completed contracts never invoke a mail provider', calls.length === callsBeforeTerminalAttempt);

    pool = makePool({ status: 'sent_to_customer' });
    result = await invoke(pool, { sessionId: 'draft-17' }, 'owner');
    check('legacy sent-to-customer sessions can be resent', result.res.status === 200 && pool.state.updates === 1, result.res.text);

    pool = makePool({ status: null });
    result = await invoke(pool, { sessionId: 'draft-17' }, 'owner');
    check('sessions with no status fail closed', result.res.status === 409 && pool.state.updates === 0, result.res.text);

    pool = makePool();
    result = await invoke(pool, { sessionId: 'draft-17' }, 'foreign');
    check('foreign-company staff is refused', result.res.status === 403, result.res.text);
    check('foreign-company staff cannot rotate a token', pool.state.updates === 0);

    pool = makePool({ recentCount: 10 });
    result = await invoke(pool, { sessionId: 'draft-17' }, 'owner');
    check('per-sender hourly rate limit is enforced', result.res.status === 429, result.res.text);
    check('rate-limited caller cannot rotate a token', pool.state.updates === 0);

    pool = makePool();
    result = await invoke(pool, 'x'.repeat(MAX_BODY_BYTES + 1), 'owner');
    check('oversized payload is rejected', result.res.status === 413, result.res.text);
  } catch (error) {
    failed++;
    console.error('Fatal:', error);
  } finally {
    emailTransport.sendPlatformEmail = originalSend;
  }
  console.log(`\n[signing-link-delivery] ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();