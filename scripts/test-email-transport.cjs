// Mocked tests for lib/emailTransport.cjs — no network, no real provider.
// Verifies: Postmark-only send, From-domain rewrite, attachment base64
// normalization, auth-failure fail-fast (noRetry) + health state flip,
// pending-approval (ErrorCode 412) fail-fast, and Resend fallback path.
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

process.env.POSTMARK_SERVER_TOKEN = 'pm-test-token';
delete process.env.RESEND_API_KEY;
// This suite drives provider selection through credentials, so it must opt out
// of the EMAIL_PROVIDER override and of any ambient SMTP credentials. Without
// this, a deployment that has pinned a provider makes the suite exercise that
// provider instead of the one under test — and SMTP would send REAL mail.
delete process.env.EMAIL_PROVIDER;
const AMBIENT_SMTP = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
// Every provider here is mocked and nothing leaves the process, so this suite
// asserts on reserved fixture recipients (a@example.com). Real senders block
// those because they can only bounce; unit assertions need them allowed.
process.env.EMAIL_ALLOW_RESERVED_RECIPIENTS = '1';
process.env.EMAIL_FROM = 'CompanySync <noreply@getcompanysync.com>'; // unverified domain on purpose
process.env.POSTMARK_VERIFIED_DOMAINS = 'companysync.io';

// Mocked SMTP transport — nodemailer must never open a real connection here.
let smtpSent = [];
let smtpNext = null;
const fakeNodemailer = {
  createTransport(config) {
    smtpSent.push({ config });
    return {
      async sendMail(message) {
        if (smtpNext instanceof Error) throw smtpNext;
        smtpSent[smtpSent.length - 1].message = message;
        const accepted = smtpNext?.accepted ?? (Array.isArray(message.to) ? message.to : [message.to]);
        return { accepted, rejected: smtpNext?.rejected ?? [], messageId: smtpNext?.messageId ?? '<smtp-1@test>' };
      },
      async verify() { return true; },
    };
  },
};
const originalLoad = Module._load;
Module._load = function loadWithSmtpMock(request, parent, isMain) {
  if (request === 'nodemailer') return fakeNodemailer;
  // Health persistence is intentionally out of scope for this provider unit
  // suite. A fake pool keeps the test hermetic and prevents an unavailable
  // local database from holding the process open after mocked sends.
  if (request === '../db/prod-db.cjs') return { getPool: () => ({ query: async () => ({ rows: [], rowCount: 0 }) }) };
  return originalLoad.call(this, request, parent, isMain);
};

let calls = [];
let nextResponse = null;
let nextResponses = [];
global.fetch = async (url, opts) => {
  calls.push({ url, opts, body: JSON.parse(opts.body) });
  const r = nextResponses.length ? nextResponses.shift() : nextResponse;
  return { ok: r.ok, status: r.status, json: async () => r.json };
};

const transport = require('../lib/emailTransport.cjs');
const health = require('../lib/emailProviderHealth.cjs');

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log(`✅ ${name}`);
  else { failed++; console.error(`❌ ${name}`, extra ?? ''); }
}

(async () => {
  // 1. Postmark-only happy path + From rewrite + attachment Buffer→base64
  calls = [];
  nextResponse = { ok: true, status: 200, json: { MessageID: 'pm-1' } };
  const res1 = await transport.sendPlatformEmail({
    to: 'a@example.com',
    from: 'Contract Signing <noreply@mycrewcam.com>',
    subject: 'Hi',
    html: '<p>hi</p>',
    attachments: [{ filename: 'f.pdf', content: Buffer.from('hello'), content_type: 'application/pdf' }],
  });
  check('postmark send succeeds without RESEND_API_KEY', res1.success && res1.provider === 'postmark' && res1.id === 'pm-1');
  check('postmark endpoint used', calls[0].url.includes('api.postmarkapp.com/email'));
  check('unverified From rewritten to verified domain', calls[0].body.From === 'Contract Signing <noreply@companysync.io>', calls[0].body.From);
  check('attachment Buffer converted to base64', calls[0].body.Attachments[0].Content === Buffer.from('hello').toString('base64'));
  check('attachment mapped to Postmark shape', calls[0].body.Attachments[0].Name === 'f.pdf' && calls[0].body.Attachments[0].ContentType === 'application/pdf');
  check('MessageStream outbound', calls[0].body.MessageStream === 'outbound');
  const st1 = await health.getEmailProviderStatus();
  check('health state ok after success', st1.state === 'ok' && st1.provider === 'postmark', st1);

  // 1a. Subscriber mail ignores SMTP selection and preserves the mandated
  // platform sender so Postmark can accept or reject domain verification
  // explicitly rather than silently rewriting the From address.
  process.env.EMAIL_PROVIDER = 'smtp';
  calls = [];
  nextResponse = { ok: true, status: 200, json: { MessageID: 'pm-subscriber-1' } };
  const subscriberResult = await transport.sendPlatformSubscriberEmail({
    to: 'healthyedge365@gmail.com',
    from: 'CompanySync <hello@getcompanysync.com>',
    replyTo: 'io.companysync@gmail.com',
    subject: 'Subscriber welcome',
    html: '<p>Welcome</p>',
  });
  check('subscriber mail uses Postmark despite SMTP override', subscriberResult.provider === 'postmark' && calls[0].url.includes('api.postmarkapp.com/email'));
  check('subscriber mail preserves the required From address', calls[0].body.From === 'CompanySync <hello@getcompanysync.com>', calls[0].body.From);
  check('subscriber mail sets the required Reply-To address', calls[0].body.ReplyTo === 'io.companysync@gmail.com', calls[0].body.ReplyTo);
  delete process.env.EMAIL_PROVIDER;

  // 1b. Invalid recipients are rejected before any provider request.
  calls = [];
  nextResponse = { ok: false, status: 422, json: { Message: 'provider should not be called' } };
  let invalidRecipientError = null;
  try {
    await transport.sendPlatformEmail({ to: 'system', subject: 'x', html: 'x' });
  } catch (error) {
    invalidRecipientError = error;
  }
  check('invalid recipient throws a non-retryable validation error', invalidRecipientError?.code === 'INVALID_EMAIL_RECIPIENT' && invalidRecipientError?.noRetry === true, invalidRecipientError);
  check('invalid recipient never reaches Postmark', calls.length === 0, calls.length);

  // 2. Auth failure (401) — fail fast, single attempt, health flips
  calls = [];
  nextResponse = { ok: false, status: 401, json: { Message: 'bad token' } };
  let err2 = null;
  try { await transport.sendPlatformEmail({ to: 'a@example.com', subject: 'x', html: 'x' }); } catch (e) { err2 = e; }
  check('401 throws with noRetry', err2 && err2.noRetry === true);
  check('401 does not retry', calls.length === 1, calls.length);
  const st2 = await health.getEmailProviderStatus();
  check('health state auth_failed after 401', st2.state === 'auth_failed', st2);

  // 3. Pending approval (ErrorCode 412) — fail fast, no retries
  calls = [];
  nextResponse = { ok: false, status: 422, json: { ErrorCode: 412, Message: 'pending approval' } };
  let err3 = null;
  try { await transport.sendPlatformEmail({ to: 'b@gmail.com', subject: 'x', html: 'x' }); } catch (e) { err3 = e; }
  check('412 throws with noRetry', err3 && err3.noRetry === true);
  check('412 does not retry', calls.length === 1, calls.length);

  // 4. Verified-domain From passes through untouched
  calls = [];
  nextResponse = { ok: true, status: 200, json: { MessageID: 'pm-2' } };
  await transport.sendPlatformEmail({ to: 'a@example.com', from: 'Acme <billing@companysync.io>', subject: 'x', html: 'x' });
  check('verified From kept as-is', calls[0].body.From === 'Acme <billing@companysync.io>', calls[0].body.From);

  // 5. SES attachment sends use Raw MIME rather than silently dropping files.
  delete process.env.POSTMARK_SERVER_TOKEN;
  process.env.AWS_ACCESS_KEY_ID = 'aws-test-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'aws-test-secret';
  calls = [];
  nextResponse = { ok: true, status: 200, json: { MessageId: 'ses-1' } };
  const res5 = await transport.sendPlatformEmail({
    to: 'a@example.com',
    from: 'CompanySync <noreply@companysync.io>',
    subject: 'PDF',
    html: '<p>attached</p>',
    attachments: [{ filename: 'estimate.pdf', content: Buffer.from('pdf-bytes'), content_type: 'application/pdf' }],
  });
  const sesRaw = Buffer.from(calls[0].body.Content.Raw.Data, 'base64').toString('utf8');
  check('SES attachment send succeeds', res5.provider === 'ses' && res5.id === 'ses-1');
  check('SES raw MIME includes attachment filename and type', sesRaw.includes('filename="estimate.pdf"') && sesRaw.includes('Content-Type: application/pdf'));
  check('SES raw MIME includes attachment bytes', sesRaw.includes(Buffer.from('pdf-bytes').toString('base64')));

  // 6. Resend fallback when no Postmark or SES credentials
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  process.env.RESEND_API_KEY = 're-test-key';
  calls = [];
  nextResponse = { ok: true, status: 200, json: { id: 're-1' } };
  const res6 = await transport.sendPlatformEmail({
    to: 'a@example.com', subject: 'x', html: '<p>x</p>',
    attachments: [{ filename: 'f.txt', content: Buffer.from('abc') }],
  });
  check('resend fallback used without Postmark token', res6.provider === 'resend' && res6.id === 're-1');
  check('resend endpoint used', calls[0].url.includes('api.resend.com/emails'));
  check('resend attachment Buffer converted to base64', calls[0].body.attachments[0].content === Buffer.from('abc').toString('base64'));

  // 7. Provider-scoped health: state was flipped under postmark; provider label follows active provider
  const st7 = await health.getEmailProviderStatus();
  check('health provider label follows active provider', st7.provider === 'resend', st7);

  // 8. Transient Resend failures retry through the one shared implementation.
  calls = [];
  nextResponses = [
    { ok: false, status: 500, json: { message: 'temporary failure' } },
    { ok: true, status: 200, json: { id: 're-2' } },
  ];
  const res8 = await transport.sendPlatformEmail({ to: 'a@example.com', subject: 'retry', html: 'x' }, 2);
  check('resend retries transient failures', res8.id === 're-2' && calls.length === 2, calls.length);

  // 9. Resend auth failures are reported and never retried.
  calls = [];
  nextResponses = [];
  nextResponse = { ok: false, status: 401, json: { message: 'invalid api key' } };
  let err9 = null;
  try { await transport.sendPlatformEmail({ to: 'a@example.com', subject: 'auth', html: 'x' }); } catch (e) { err9 = e; }
  check('resend auth failure throws with noRetry', err9 && err9.noRetry === true);
  check('resend auth failure does not retry', calls.length === 1, calls.length);

  // 10. SMTP path — the fallback used when API providers are unavailable.
  delete process.env.RESEND_API_KEY;
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'relay@example.com';
  process.env.SMTP_PASS = 'secret';
  process.env.EMAIL_PROVIDER = 'smtp';

  smtpSent = []; smtpNext = null;
  const res10 = await transport.sendPlatformEmail({
    to: 'a@example.com',
    from: 'Acme Roofing <billing@acme.com>',
    subject: 'x',
    html: '<p>x</p>',
    attachments: [{ filename: 'f.txt', content: Buffer.from('abc') }],
  });
  const sent10 = smtpSent[smtpSent.length - 1].message;
  check('smtp send succeeds', res10.success && res10.provider === 'smtp');
  check('smtp sends as the authenticated user', sent10.from === 'Acme Roofing <relay@example.com>', sent10.from);
  check('smtp preserves the intended sender as Reply-To', sent10.replyTo === 'billing@acme.com', sent10.replyTo);
  check('smtp attachment decoded to a Buffer', Buffer.isBuffer(sent10.attachments[0].content) && sent10.attachments[0].content.toString() === 'abc');

  // An unattended sender must not become a Reply-To that nobody reads.
  smtpNext = null;
  await transport.sendPlatformEmail({ to: 'a@example.com', from: 'YICN <noreply@companysync.io>', subject: 'x', html: 'x' });
  const sent10b = smtpSent[smtpSent.length - 1].message;
  check('smtp does not promote a noreply sender to Reply-To', sent10b.replyTo === undefined, sent10b.replyTo);

  // Envelope accepted but zero recipients taken is a failure, not a success.
  smtpNext = { accepted: [], rejected: ['a@example.com'] };
  let err10 = null;
  try { await transport.sendPlatformEmail({ to: 'a@example.com', subject: 'x', html: 'x' }); } catch (e) { err10 = e; }
  check('smtp reports zero accepted recipients as a failure', err10 && err10.noRetry === true, err10 && err10.message);

  // Path/URL attachments (inspection report PDFs) must survive — coercing them
  // through the base64 branch silently attaches an empty file.
  smtpNext = null;
  await transport.sendPlatformEmail({
    to: 'a@example.com', subject: 'x', html: 'x',
    attachments: [{ filename: 'report.pdf', path: 'https://example.com/report.pdf' }],
  });
  const sent10c = smtpSent[smtpSent.length - 1].message;
  check('smtp preserves path-based attachments', sent10c.attachments[0].path === 'https://example.com/report.pdf', sent10c.attachments[0]);
  check('smtp path attachment carries no empty body', sent10c.attachments[0].content === undefined, sent10c.attachments[0]);

  // SMTP signals bad credentials with 535, which is not an HTTP 401/403 — the
  // health marker must still flip or the admin banner stays green while every
  // send fails.
  const authErr = Object.assign(new Error('535 5.7.8 Username and Password not accepted'), { responseCode: 535, code: 'EAUTH' });
  smtpNext = authErr;
  let err10d = null;
  try { await transport.sendPlatformEmail({ to: 'a@example.com', subject: 'x', html: 'x' }); } catch (e) { err10d = e; }
  check('smtp auth failure throws with noRetry', err10d && err10d.noRetry === true, err10d && err10d.message);
  const st10 = await health.getEmailProviderStatus();
  check('smtp auth failure flips health state', st10.state === 'auth_failed' && st10.provider === 'smtp', st10);

  // Subscriber mail must never fall back to Gmail SMTP, even when it is the
  // only configured provider.
  let subscriberSmtpError = null;
  const smtpCountBeforeSubscriberAttempt = smtpSent.length;
  try {
    await transport.sendPlatformSubscriberEmail({
      to: 'a@example.com',
      from: 'CompanySync <hello@getcompanysync.com>',
      replyTo: 'io.companysync@gmail.com',
      subject: 'must not use Gmail SMTP',
      html: '<p>blocked</p>',
    });
  } catch (error) {
    subscriberSmtpError = error;
  }
  check('subscriber mail fails closed when Gmail SMTP is the only provider', subscriberSmtpError?.code === 'SUBSCRIBER_EMAIL_PROVIDER_UNAVAILABLE', subscriberSmtpError);
  check('subscriber mail does not open an SMTP connection', smtpSent.length === smtpCountBeforeSubscriberAttempt, smtpSent.length);

  smtpNext = null;
  delete process.env.EMAIL_PROVIDER;

  // 10b. An override naming an unconfigured provider must not disable email.
  process.env.EMAIL_PROVIDER = 'ses';
  check('unconfigured override falls back to a usable provider', transport.activeProvider() === 'smtp', transport.activeProvider());
  process.env.EMAIL_PROVIDER = 'nonsense';
  check('unknown override falls back to a usable provider', transport.activeProvider() === 'smtp', transport.activeProvider());
  delete process.env.EMAIL_PROVIDER;

  // 11. No production sender may bypass the shared transport.
  const root = path.resolve(__dirname, '..');
  const directSenderFiles = [
    'vite-functions-plugin.js',
    'vite-db-plugin.js',
    'vite-notification-helper.js',
    'vite-signing-plugin.js',
    'vite-integrations-plugin.js',
    'vite-stripe-plugin.js',
    'db/prod-integrations.cjs',
    'db/prod-db.cjs',
    'db/local-auth.cjs',
    'prod-server.cjs',
  ];
  const bypasses = directSenderFiles.filter(file =>
    fs.readFileSync(path.join(root, file), 'utf8').includes('api.resend.com/emails')
  );
  check('all production Resend senders route through the shared transport', bypasses.length === 0, bypasses);

  console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} TEST(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('Test harness error:', e); process.exit(1); });
