'use strict';

const crypto = require('crypto');
const staging = require('../stagingSideEffects.cjs');

const DEFAULT_COLE_NUMBER = '+18886703112';
const TRANSACTIONAL_SMS = new Set([
  'booking_confirmation',
  'reminder_24h',
  'reminder_1h',
  'sms_reply',
  'help',
  'stop',
]);
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const HELP_WORDS = new Set(['help', 'info']);
const MISSED_STATUSES = new Set(['no-answer', 'busy', 'failed', 'canceled', 'cancelled']);

const POLITE_CALL = 'Thanks for calling CompanySync. This test line can only take calls from the numbers we are checking right now. Please try getcompanysync.com.';
const APOLOGY = "Sorry, Cole can't join this call right now. Please try again in a few minutes, or visit getcompanysync.com.";
const STOP_REPLY = 'CompanySync: you are unsubscribed and will not get more texts. Reply HELP for help.';
const HELP_REPLY = 'CompanySync help: Cole confirms booked demos and sends reminders. Reply STOP to opt out. Call 888-670-3112 or visit getcompanysync.com.';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function last10(value) {
  const raw = digits(value);
  return raw.length > 10 ? raw.slice(-10) : raw;
}

function coleNumber(env = process.env) {
  const configured = String(env.SALES_AGENT_PHONE_NUMBER || '').trim();
  return configured || DEFAULT_COLE_NUMBER;
}

function smsFromNumber(env = process.env) {
  const configured = String(env.SALES_AGENT_SMS_FROM || '').trim();
  return configured || coleNumber(env);
}

function isColeNumber(value, env = process.env) {
  const called = last10(value);
  if (!called) return false;
  return called === last10(coleNumber(env)) || called === last10(smsFromNumber(env));
}

function allowlistNumbers(env = process.env) {
  return String(env.SALES_AGENT_PHONE_ALLOWLIST || '')
    .split(',')
    .map((item) => last10(item))
    .filter(Boolean);
}

function allowlistActive(env = process.env) {
  return allowlistNumbers(env).length > 0;
}

function phoneAllowed(value, env = process.env) {
  const list = allowlistNumbers(env);
  if (!list.length) return true;
  return list.includes(last10(value));
}

function transactionalSmsKind(kind) {
  return TRANSACTIONAL_SMS.has(String(kind || ''));
}

function smsMaySend(to, env = process.env) {
  const listed = phoneAllowed(to, env);
  if (allowlistActive(env) && !listed) return { allow: false, reason: 'allowlist' };
  if (staging.sideEffectsDisabled(env) && !(allowlistActive(env) && listed)) {
    return { allow: false, reason: 'staging' };
  }
  if (staging.sideEffectsDisabled(env) && allowlistActive(env) && listed) {
    return { allow: true, bypassGuard: true };
  }
  return { allow: true, bypassGuard: false };
}

function keywordKind(body) {
  const token = String(body || '').trim().toLowerCase().split(/\s+/)[0] || '';
  if (STOP_WORDS.has(token)) return 'stop';
  if (HELP_WORDS.has(token)) return 'help';
  return '';
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[ch]));
}

function twilioSignature(token, url, params) {
  const keys = Object.keys(params || {}).sort();
  let data = String(url || '');
  for (const key of keys) data += key + params[key];
  return crypto.createHmac('sha1', String(token || '')).update(Buffer.from(data, 'utf8')).digest('base64');
}

function signaturesMatch(expected, actual) {
  const left = Buffer.from(String(expected || ''));
  const right = Buffer.from(String(actual || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signatureUrls(req) {
  const pathAndQuery = (typeof req.originalUrl === 'string' && req.originalUrl.startsWith('/'))
    ? req.originalUrl
    : (req.url || '/');
  const hosts = [];
  const push = (host) => {
    const clean = String(host || '').split(',')[0].trim();
    if (clean && !hosts.includes(clean)) hosts.push(clean);
  };
  push(req.headers && (req.headers['x-forwarded-host'] || req.headers.host));
  if (process.env.RAILWAY_PUBLIC_DOMAIN) push(process.env.RAILWAY_PUBLIC_DOMAIN);
  for (const key of ['SALES_AGENT_PUBLIC_URL', 'APP_URL', 'VITE_REPLIT_APP_URL']) {
    const raw = process.env[key];
    if (!raw) continue;
    try { push(new URL(raw).host); } catch (_) { /* ignore bad public URL */ }
  }
  if (process.env.REPLIT_DEV_DOMAIN) push(process.env.REPLIT_DEV_DOMAIN);
  const urls = [];
  for (const host of hosts) {
    urls.push(`https://${host}${pathAndQuery}`);
    urls.push(`http://${host}${pathAndQuery}`);
  }
  return urls;
}

function signatureValid({ token, signature, params, urls }) {
  if (!token || !signature) return false;
  for (const url of urls || []) {
    if (signaturesMatch(twilioSignature(token, url, params), signature)) return true;
  }
  return false;
}

function signatureRequired(env = process.env) {
  const flag = String(env.TWILIO_REQUIRE_SIGNATURE ?? '1').toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
}

function publicHost(req) {
  const configured = process.env.SALES_AGENT_PUBLIC_URL || process.env.APP_URL || '';
  if (configured) {
    try { return new URL(configured).host; } catch (_) { /* fall through */ }
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return process.env.RAILWAY_PUBLIC_DOMAIN;
  const forwarded = req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host);
  return String(forwarded || 'localhost').split(',')[0].trim();
}

function publicBase(req) {
  const host = publicHost(req);
  const protoHeader = req && req.headers && req.headers['x-forwarded-proto'];
  const proto = String(protoHeader || '').split(',')[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  const https = proto === 'https' || (!local && proto !== 'http');
  return `${https ? 'https' : 'http'}://${host}`;
}

function localHost(host) {
  return /^(localhost|127\.0\.0\.1)(:|$)/.test(String(host || ''));
}

function streamHost(req) {
  // The media stream has to land on the process that answered the webhook.
  // APP_URL is often the public product site, which does not upgrade
  // /ws/sales-phone. Prefer the host Twilio just called.
  const headerHost = req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host);
  const fromRequest = String(headerHost || '').split(',')[0].trim();
  if (fromRequest) return fromRequest;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return String(process.env.RAILWAY_PUBLIC_DOMAIN).trim();
  const configured = String(process.env.SALES_AGENT_PUBLIC_URL || '').trim();
  if (configured) {
    try { return new URL(configured).host; } catch (_) { /* ignore bad public URL */ }
  }
  return fromRequest || 'localhost';
}

function streamUrl(req) {
  const host = streamHost(req);
  const protoHeader = req && req.headers && req.headers['x-forwarded-proto'];
  const proto = String(protoHeader || '').split(',')[0].trim();
  const scheme = localHost(host) && proto !== 'https' ? 'ws' : 'wss';
  return `${scheme}://${host}/ws/sales-phone`;
}

function webhookBase(req) {
  const host = streamHost(req);
  const protoHeader = req && req.headers && req.headers['x-forwarded-proto'];
  const proto = String(protoHeader || '').split(',')[0].trim();
  const https = !localHost(host) || proto === 'https';
  return `${https ? 'https' : 'http'}://${host}`;
}

function connectTwiml({ stream, from, to, callSid, statusUrl, actionUrl, sayNotice = true }) {
  const status = statusUrl
    ? ` statusCallback="${xmlEscape(statusUrl)}" statusCallbackMethod="POST"`
    : '';
  const action = actionUrl
    ? ` action="${xmlEscape(actionUrl)}" method="POST"`
    : '';
  const notice = sayNotice
    ? '  <Say voice="Polly.Matthew">This call is recorded and transcribed so we can follow up accurately.</Say>\n'
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
${notice}  <Connect${action}>
    <Stream url="${xmlEscape(stream)}"${status}>
      <Parameter name="from" value="${xmlEscape(from || '')}" />
      <Parameter name="to" value="${xmlEscape(to || '')}" />
      <Parameter name="callSid" value="${xmlEscape(callSid || '')}" />
    </Stream>
  </Connect>
</Response>`;
}

function politeTwiml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${xmlEscape(POLITE_CALL)}</Say>
  <Hangup/>
</Response>`;
}

function apologyTwiml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${xmlEscape(APOLOGY)}</Say>
  <Hangup/>
</Response>`;
}

function hangupTwiml() {
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
}

function rejectTwiml() {
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';
}

function messageTwiml(text) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(text || '')}</Message></Response>`;
}

function emptyTwiml() {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
}

module.exports = {
  DEFAULT_COLE_NUMBER,
  TRANSACTIONAL_SMS,
  MISSED_STATUSES,
  POLITE_CALL,
  APOLOGY,
  STOP_REPLY,
  HELP_REPLY,
  digits,
  last10,
  coleNumber,
  smsFromNumber,
  isColeNumber,
  allowlistNumbers,
  allowlistActive,
  phoneAllowed,
  transactionalSmsKind,
  smsMaySend,
  keywordKind,
  xmlEscape,
  twilioSignature,
  signaturesMatch,
  signatureUrls,
  signatureValid,
  signatureRequired,
  publicHost,
  publicBase,
  streamHost,
  streamUrl,
  webhookBase,
  connectTwiml,
  politeTwiml,
  apologyTwiml,
  hangupTwiml,
  rejectTwiml,
  messageTwiml,
  emptyTwiml,
};
