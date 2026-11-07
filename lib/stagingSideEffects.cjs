'use strict';

// One switch for a Railway staging process pointed at the live production
// database. Replit does not set this. When STAGING_READ_ONLY_SIDE_EFFECTS=1,
// startup must not migrate, seed, reencrypt, register Stripe webhooks, or
// start schedulers, and outbound SMS, calls, and email are logged instead
// of sent.

const FLAG = 'STAGING_READ_ONLY_SIDE_EFFECTS';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let loggedDisabled = false;
const skippedSchedulers = [];
let originalFetch = null;
let originalCreateTransport = null;

function sideEffectsDisabled(env = process.env) {
  return String(env && env[FLAG] != null ? env[FLAG] : '') === '1';
}

function logDisabled(log = console) {
  if (!sideEffectsDisabled()) return false;
  if (loggedDisabled) return false;
  loggedDisabled = true;
  log.log('[staging] side effects disabled');
  return true;
}

function noteSkippedScheduler(name) {
  skippedSchedulers.push(name);
  console.log(`[staging] scheduler not started: ${name}`);
}

function inertTimer() {
  const timer = {
    unref() { return timer; },
    ref() { return timer; },
    hasRef() { return false; },
  };
  return timer;
}

function armInterval(name, fn, ms) {
  if (sideEffectsDisabled()) {
    noteSkippedScheduler(name);
    return inertTimer();
  }
  return setInterval(fn, ms);
}

function armTimeout(name, fn, ms) {
  if (sideEffectsDisabled()) {
    noteSkippedScheduler(name);
    return inertTimer();
  }
  return setTimeout(fn, ms);
}

function summarize(value) {
  if (value == null) return '';
  const text = Array.isArray(value) ? value.join(',') : String(value);
  return text.replace(/\s+/g, ' ').slice(0, 180);
}

function logSuppressed(kind, detail) {
  let extra = '';
  if (detail && typeof detail === 'object') {
    extra = ' ' + Object.entries(detail)
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => `${key}=${summarize(value)}`)
      .join(' ');
  } else if (detail) {
    extra = ' ' + summarize(detail);
  }
  console.log(`[staging] suppressed ${kind}${extra}`);
}

function suppressedEmailResult(opts = {}) {
  logSuppressed('email', { to: opts.to, subject: opts.subject });
  return { success: true, suppressed: true, provider: 'staging', id: 'staging-suppressed' };
}

const BLOCKED_FUNCTION_NAMES = new Set([
  'ghlAutoSyncCron',
  'syncGHLContacts',
  'pushToGHL',
  'disconnectGHL',
  'completeGHLCallback',
  'testSyncOneGHL',
  'syncJobNimbusData',
  'bulkSyncQuickBooks',
  'syncQuickBooksInvoice',
  'syncQuickBooksPayment',
  'syncUserGoogleCalendar',
  'bulkSyncAllCalendars',
  'sendMorningDigest',
]);

function blockedFunction(functionName) {
  if (!sideEffectsDisabled() || !BLOCKED_FUNCTION_NAMES.has(functionName)) return null;
  return blockedAction(functionName);
}

function blockedAction(action, extra) {
  if (!sideEffectsDisabled()) return null;
  logSuppressed(action, extra || {});
  return {
    success: true,
    suppressed: true,
    staging: true,
    results: [],
    sent: 0,
    synced: 0,
    created: 0,
    updated: 0,
    message: 'staging side effects disabled',
  };
}

function redactUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.origin + parsed.pathname;
  } catch (_) {
    return String(url || '').split('?')[0];
  }
}

function classifyOutbound(url, method) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (_) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const verb = String(method || 'GET').toUpperCase();
  const path = parsed.pathname || '';
  if (!MUTATING.has(verb)) return null;

  if (host === 'api.twilio.com' || host.endsWith('.twilio.com')) {
    if (/\/Messages\.json$/i.test(path)) return 'sms';
    if (/\/Calls(\.json|\/)/i.test(path)) return 'call';
    return 'twilio';
  }
  if (host === 'api.postmarkapp.com' || host === 'api.resend.com') return 'email';
  if (host.startsWith('email.') && host.endsWith('.amazonaws.com')) return 'email';
  if (host === 'gmail.googleapis.com' && /\/messages\/send$|\/drafts\/send$|\/messages$/i.test(path)) return 'email';
  if (host === 'api.stripe.com' && /\/webhook_endpoints(?:\/|$)/.test(path)) return 'stripe-webhook';
  if (host.endsWith('leadconnectorhq.com') || host.endsWith('gohighlevel.com') || host === 'marketplace.gohighlevel.com') return 'ghl';
  if (host.endsWith('jobnimbus.com')) return 'jobnimbus';
  return null;
}

function fakeOutboundResponse(kind) {
  const payload = (kind === 'sms' || kind === 'call' || kind === 'twilio')
    ? { sid: 'staging-suppressed', status: 'queued', suppressed: true }
    : kind === 'ghl'
      ? { contact: { id: 'staging-suppressed' }, suppressed: true, success: true }
      : { id: 'staging-suppressed', MessageID: 'staging-suppressed', suppressed: true, success: true };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function installOutboundGuards(env = process.env) {
  if (!sideEffectsDisabled(env)) return false;
  if (globalThis.__stagingOutboundGuardsInstalled) return true;
  globalThis.__stagingOutboundGuardsInstalled = true;
  logDisabled();

  originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.__stagingOriginalFetch = globalThis.fetch;
  globalThis.fetch = async function stagingFetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init && init.method) || (input && typeof input !== 'string' && input.method) || 'GET';
    const kind = classifyOutbound(url, method);
    if (kind) {
      logSuppressed(kind, { method: String(method || 'GET').toUpperCase(), url: redactUrl(url) });
      return fakeOutboundResponse(kind);
    }
    return originalFetch(input, init);
  };

  try {
    const nodemailer = require('nodemailer');
    if (!nodemailer.createTransport.__stagingWrapped) {
      originalCreateTransport = nodemailer.createTransport.bind(nodemailer);
      const wrapped = function stagingCreateTransport(...args) {
        const transport = originalCreateTransport(...args);
        transport.sendMail = function stagingSendMail(mail, callback) {
          logSuppressed('email', { to: mail && mail.to, subject: mail && mail.subject, via: 'smtp' });
          const info = {
            messageId: 'staging-suppressed',
            accepted: [],
            rejected: [],
            suppressed: true,
            response: 'staging suppressed',
          };
          if (typeof callback === 'function') {
            callback(null, info);
            return undefined;
          }
          return Promise.resolve(info);
        };
        return transport;
      };
      wrapped.__stagingWrapped = true;
      wrapped.__original = originalCreateTransport;
      nodemailer.createTransport = wrapped;
    }
  } catch (err) {
    console.warn('[staging] could not wrap nodemailer:', err.message);
  }
  return true;
}

function restoreOutboundGuards() {
  if (globalThis.__stagingOriginalFetch) {
    globalThis.fetch = globalThis.__stagingOriginalFetch;
  }
  try {
    const nodemailer = require('nodemailer');
    if (typeof nodemailer.createTransport.__original === 'function') {
      nodemailer.createTransport = nodemailer.createTransport.__original;
    }
  } catch (_) {}
  delete globalThis.__stagingOutboundGuardsInstalled;
  delete globalThis.__stagingOriginalFetch;
  loggedDisabled = false;
  skippedSchedulers.length = 0;
  originalFetch = null;
  originalCreateTransport = null;
}

module.exports = {
  FLAG,
  sideEffectsDisabled,
  logDisabled,
  noteSkippedScheduler,
  armInterval,
  armTimeout,
  logSuppressed,
  suppressedEmailResult,
  BLOCKED_FUNCTION_NAMES,
  blockedFunction,
  blockedAction,
  classifyOutbound,
  installOutboundGuards,
  restoreOutboundGuards,
  skippedSchedulers,
};
