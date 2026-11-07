'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-agent-email-'));
process.env.SALES_AGENT_DATA_DIR = dataDir;
process.env.SALES_AGENT_DRY_RUN = '1';
delete process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
delete process.env.SALES_AGENT_EMAIL_FROM;
delete process.env.SALES_AGENT_REPLY_TO;
delete process.env.EMAIL_PROVIDER;
delete process.env.RESEND_API_KEY;
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
process.env.POSTMARK_SERVER_TOKEN = 'pm-test-token';
process.env.EMAIL_ALLOW_RESERVED_RECIPIENTS = '1';
process.env.POSTMARK_VERIFIED_DOMAINS = 'companysync.io,getcompanysync.com';

const smtpSent = [];
const fakeNodemailer = {
  createTransport() {
    return {
      async sendMail(message) {
        smtpSent.push(message);
        const accepted = Array.isArray(message.to) ? message.to : [message.to];
        return { accepted, rejected: [], messageId: '<smtp-cole@test>' };
      },
      async verify() { return true; },
    };
  },
};
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === 'nodemailer') return fakeNodemailer;
  if (request === '../db/prod-db.cjs' || request.endsWith('/db/prod-db.cjs')) {
    return { getPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const calls = [];
global.fetch = async (url, opts) => {
  let body = null;
  if (opts && opts.body && typeof opts.body === 'string' && opts.body.trim().startsWith('{')) {
    body = JSON.parse(opts.body);
  }
  calls.push({ url: String(url), body });
  return { ok: true, status: 200, json: async () => ({ MessageID: 'pm-1', MessageId: 'ses-1', id: 're-1' }) };
};

const outbound = require('../lib/salesAgent/outbound.cjs');
const store = require('../lib/salesAgent/salesStore.cjs');
const sequences = require('../lib/salesAgent/sequences.cjs');
const summary = require('../lib/salesAgent/summary.cjs');
const http = require('../lib/salesAgent/http.cjs');

const COLE_FROM = 'Cole from CompanySync <cole.ai@getcompanysync.com>';
const COLE_REPLY = 'cole.ai@getcompanysync.com';

function req({ method = 'POST', url, body, headers = {}, ip = '203.0.113.40' }) {
  return {
    method,
    url,
    headers: { host: 'localhost:5000', ...headers },
    socket: { remoteAddress: ip },
    destroy() {},
    on(event, fn) {
      if (event === 'data' && body != null) queueMicrotask(() => fn(Buffer.from(JSON.stringify(body))));
      if (event === 'end') queueMicrotask(() => fn());
    },
  };
}

function res() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = payload; },
  };
}

async function call(method, url, body, headers) {
  const response = res();
  const handled = await http.handleSalesRequest(req({ method, url, body, headers }), response);
  assert.strictEqual(handled, true);
  return { status: response.statusCode, json: response.body ? JSON.parse(response.body) : null };
}

function basic(secret) {
  return { authorization: `Basic ${Buffer.from(`postmark:${secret}`).toString('base64')}` };
}

(async () => {
  assert.strictEqual(outbound.salesAgentEmailFrom(), COLE_FROM);
  assert.strictEqual(outbound.salesAgentReplyTo(), COLE_REPLY);
  assert.ok(fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8').includes('POSTMARK_VERIFIED_DOMAINS=companysync.io,getcompanysync.com'));
  assert.ok(fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8').includes('cole.ai@getcompanysync.com'));

  calls.length = 0;
  const postmark = await outbound.deliverEmail({
    to: 'sam.lee@gmail.com',
    subject: 'Demo tomorrow',
    text: 'See you then.',
    html: '<p>See you then.</p>',
  });
  assert.strictEqual(postmark.provider, 'postmark');
  assert.strictEqual(calls[0].body.From, COLE_FROM);
  assert.strictEqual(calls[0].body.ReplyTo, COLE_REPLY);

  process.env.POSTMARK_VERIFIED_DOMAINS = 'companysync.io';
  calls.length = 0;
  await outbound.deliverEmail({
    to: 'sam.lee@gmail.com',
    subject: 'Still Cole',
    text: 'Reply here.',
    html: '<p>Reply here.</p>',
  });
  assert.strictEqual(calls[0].body.From, 'Cole from CompanySync <noreply@companysync.io>');
  assert.strictEqual(calls[0].body.ReplyTo, COLE_REPLY, 'reply-to stays with Cole when From is rewritten');

  delete process.env.POSTMARK_VERIFIED_DOMAINS;
  calls.length = 0;
  await outbound.deliverEmail({
    to: 'sam.lee@gmail.com',
    subject: 'Default domains',
    text: 'Default.',
    html: '<p>Default.</p>',
  });
  assert.strictEqual(calls[0].body.From, COLE_FROM, 'default verified domains include getcompanysync.com');
  calls.length = 0;
  await outbound.deliverEmail({
    to: 'sam.lee@gmail.com',
    from: 'Other Co <hello@other.example>',
    replyTo: 'hello@other.example',
    subject: 'Unverified',
    text: 'Fallback.',
    html: '<p>Fallback.</p>',
  });
  assert.strictEqual(calls[0].body.From, 'Other Co <noreply@companysync.io>');
  assert.ok(!String(calls[0].body.From).includes('getcompanysync.com'));

  process.env.SALES_AGENT_EMAIL_FROM = 'Cole <cole@example.test>';
  process.env.SALES_AGENT_REPLY_TO = 'cole@example.test';
  process.env.POSTMARK_VERIFIED_DOMAINS = 'companysync.io,getcompanysync.com,example.test';
  calls.length = 0;
  await outbound.deliverEmail({
    to: 'sam.lee@gmail.com',
    subject: 'Override',
    text: 'Override.',
    html: '<p>Override.</p>',
  });
  assert.strictEqual(calls[0].body.From, 'Cole <cole@example.test>');
  assert.strictEqual(calls[0].body.ReplyTo, 'cole@example.test');
  delete process.env.SALES_AGENT_EMAIL_FROM;
  delete process.env.SALES_AGENT_REPLY_TO;
  process.env.POSTMARK_VERIFIED_DOMAINS = 'companysync.io,getcompanysync.com';

  process.env.EMAIL_PROVIDER = 'ses';
  process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
  process.env.AWS_SECRET_ACCESS_KEY = 'secret';
  process.env.AWS_REGION = 'us-east-1';
  calls.length = 0;
  const ses = await outbound.deliverEmail({
    to: 'sam.lee@gmail.com',
    subject: 'SES',
    text: 'SES body',
    html: '<p>SES body</p>',
    attachments: [{ filename: 'note.txt', content: Buffer.from('hi'), content_type: 'text/plain' }],
  });
  assert.strictEqual(ses.provider, 'ses');
  assert.strictEqual(calls[0].body.FromEmailAddress, COLE_FROM);
  assert.deepStrictEqual(calls[0].body.ReplyToAddresses, [COLE_REPLY]);
  const raw = Buffer.from(calls[0].body.Content.Raw.Data, 'base64').toString('utf8');
  assert.ok(raw.includes(`From: ${COLE_FROM}`), raw.slice(0, 240));
  assert.ok(raw.includes(`Reply-To: ${COLE_REPLY}`), raw.slice(0, 240));
  delete process.env.EMAIL_PROVIDER;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;

  process.env.EMAIL_PROVIDER = 'resend';
  process.env.RESEND_API_KEY = 're_test';
  calls.length = 0;
  const resend = await outbound.deliverEmail({
    to: 'sam.lee@gmail.com',
    subject: 'Resend',
    text: 'Resend body',
    html: '<p>Resend body</p>',
  });
  assert.strictEqual(resend.provider, 'resend');
  assert.strictEqual(calls[0].body.from, COLE_FROM);
  assert.strictEqual(calls[0].body.reply_to, COLE_REPLY);
  delete process.env.EMAIL_PROVIDER;
  delete process.env.RESEND_API_KEY;

  process.env.EMAIL_PROVIDER = 'smtp';
  process.env.SMTP_HOST = 'smtp.test';
  process.env.SMTP_USER = 'relay@companysync.io';
  process.env.SMTP_PASS = 'smtp-secret';
  smtpSent.length = 0;
  const smtp = await outbound.deliverEmail({
    to: 'sam.lee@gmail.com',
    subject: 'SMTP',
    text: 'SMTP body',
    html: '<p>SMTP body</p>',
  });
  assert.strictEqual(smtp.provider, 'smtp');
  assert.ok(String(smtpSent[0].from).includes('relay@companysync.io'));
  assert.strictEqual(smtpSent[0].replyTo, COLE_REPLY);
  delete process.env.EMAIL_PROVIDER;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  const beforeStaging = calls.length;
  process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
  const suppressed = await outbound.deliverEmail({
    to: 'sam.lee@gmail.com',
    subject: 'Staging',
    text: 'Do not send.',
    html: '<p>Do not send.</p>',
  });
  assert.strictEqual(suppressed.suppressed, true);
  assert.strictEqual(suppressed.provider, 'staging');
  assert.strictEqual(calls.length, beforeStaging, 'staging must not call the email transport');
  const logged = await outbound.sendPrepared({
    lead: { id: 'lead_log', optedOut: false },
    kind: 'day0_recap',
    channel: 'email',
    to: 'sam.lee@gmail.com',
    subject: 'Logged',
    text: 'Logged body',
    html: '<p>Logged body</p>',
  });
  assert.strictEqual(logged.from, COLE_FROM);
  assert.strictEqual(logged.replyTo, COLE_REPLY);
  assert.strictEqual(logged.suppressed, true);

  delete process.env.SALES_AGENT_INBOUND_SECRET;
  const missingSecret = await call('POST', '/api/sales-agent/inbound-email', { From: 'sam.lee@gmail.com', TextBody: 'hello' });
  assert.strictEqual(missingSecret.status, 503);

  const secret = 'inbound-test-secret';
  process.env.SALES_AGENT_INBOUND_SECRET = secret;
  const denied = await call('POST', '/api/sales-agent/inbound-email', { From: 'sam.lee@gmail.com', TextBody: 'hello' }, { authorization: 'Bearer wrong' });
  assert.strictEqual(denied.status, 401);

  await store.update((state) => {
    state.leads.push({
      id: 'lead_sam',
      firstName: 'Sam',
      lastName: 'Lee',
      email: 'sam.lee@gmail.com',
      stage: 'Demo Held',
      optedOut: false,
    });
  });
  await sequences.enqueueNonBuyer('lead_sam');
  assert.ok(store.readState().steps.some((step) => step.leadId === 'lead_sam' && step.status === 'pending'));

  const fetchesBeforeInbound = calls.length;
  const inbound = await call('POST', '/api/sales-agent/inbound-email', {
    From: 'Sam Lee <sam.lee@gmail.com>',
    FromFull: { Email: 'sam.lee@gmail.com', Name: 'Sam Lee' },
    To: COLE_REPLY,
    Subject: 'Re: Demo tomorrow',
    StrippedTextReply: 'Can we talk Thursday?',
    MessageID: 'pm-in-1',
  }, basic(secret));
  assert.strictEqual(inbound.status, 200, JSON.stringify(inbound.json));
  assert.strictEqual(inbound.json.matched, true);
  assert.strictEqual(inbound.json.paused, true);
  assert.strictEqual(inbound.json.suppressedSends, true);
  assert.strictEqual(calls.length, fetchesBeforeInbound, 'inbound must not send mail on staging');

  const after = store.readState();
  const sam = after.leads.find((lead) => lead.id === 'lead_sam');
  assert.strictEqual(sam.needsKevinReview, true);
  assert.strictEqual(sam.followUpPausedReason, 'reply');
  assert.notStrictEqual(sam.optedOut, true);
  assert.ok(after.steps.filter((step) => step.leadId === 'lead_sam').every((step) => step.status === 'cancelled' && step.cancelReason === 'reply'));
  const reply = after.messages.find((message) => message.kind === 'inbound_reply' && message.providerId === 'pm-in-1');
  assert.ok(reply);
  assert.strictEqual(reply.from, 'sam.lee@gmail.com');
  assert.strictEqual(reply.to, COLE_REPLY);
  assert.ok(after.notifications.some((note) => note.kind === 'inbound_reply' && note.for === 'Kevin' && /Sam/.test(note.title)));

  const duplicate = await call('POST', '/api/sales-agent/inbound-email', {
    From: 'sam.lee@gmail.com',
    TextBody: 'Can we talk Thursday?',
    MessageID: 'pm-in-1',
  }, { authorization: `Bearer ${secret}` });
  assert.strictEqual(duplicate.status, 200);
  assert.strictEqual(duplicate.json.duplicate, true);
  assert.strictEqual(store.readState().messages.filter((message) => message.providerId === 'pm-in-1').length, 1);

  const unmatched = await call('POST', '/api/sales-agent/inbound-email', {
    From: 'stranger@gmail.com',
    Subject: 'Who is this',
    TextBody: 'I found this address.',
    MessageID: 'pm-in-2',
  }, { 'x-sales-agent-inbound-secret': secret });
  assert.strictEqual(unmatched.json.matched, false);
  assert.ok(store.readState().notifications.some((note) => note.kind === 'inbound_reply_unmatched' && note.for === 'Kevin'));

  const daily = summary.buildDailySummary(new Date());
  assert.match(daily.text, /Replies for Kevin/);
  assert.match(daily.text, /Sam/);
  assert.match(daily.text, /stranger@gmail.com/);

  const overviewResponse = res();
  const overviewHandled = await http.handleSalesRequest(
    req({ method: 'GET', url: '/api/sales-agent/admin/overview' }),
    overviewResponse,
    { authorize: async () => ({ ok: true, email: 'kevin@example.com' }) },
  );
  assert.strictEqual(overviewHandled, true);
  const overview = JSON.parse(overviewResponse.body);
  assert.ok(overview.flaggedForKevin.some((lead) => lead.email === 'sam.lee@gmail.com'));

  console.log('sales agent email identity and inbound tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
