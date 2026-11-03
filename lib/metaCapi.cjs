/**
 * Meta Conversions API (direct Graph API).
 * No-ops quietly when META_CAPI_TOKEN is missing. Never throws to callers.
 */
const crypto = require('crypto');
const { planMonthlyUsd } = require('./planPricing.cjs');

const DEFAULT_PIXEL_ID = '1594662235155513';
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

function sha256(value) {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  const digits = String(phone).replace(/\D/g, '');
  return digits || undefined;
}

function parseCookie(header, name) {
  if (!header) return null;
  const parts = String(header).split(/;\s*/);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) {
      try { return decodeURIComponent(part.slice(eq + 1)); } catch { return part.slice(eq + 1); }
    }
  }
  return null;
}

function extractAttributionFromReq(req, bodyAttribution) {
  const cookieHeader = req?.headers?.cookie || '';
  const ua = req?.headers?.['user-agent'] || null;
  let ip = null;
  try {
    const { getClientIp } = require('./rateLimit.cjs');
    ip = getClientIp(req);
  } catch {
    ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
      || req?.socket?.remoteAddress
      || null;
  }
  const fromBody = bodyAttribution && typeof bodyAttribution === 'object' ? bodyAttribution : {};
  return {
    fbp: fromBody.fbp || parseCookie(cookieHeader, '_fbp') || null,
    fbc: fromBody.fbc || parseCookie(cookieHeader, '_fbc') || null,
    utm_source: fromBody.utm_source || null,
    utm_medium: fromBody.utm_medium || null,
    utm_campaign: fromBody.utm_campaign || null,
    utm_content: fromBody.utm_content || null,
    utm_term: fromBody.utm_term || null,
    fbclid: fromBody.fbclid || null,
    gclid: fromBody.gclid || null,
    landing_page: fromBody.landing_page || null,
    ip,
    ua,
  };
}

async function sendMetaCapiEvent({
  eventName,
  eventId,
  eventSourceUrl,
  email,
  phone,
  externalId,
  value,
  currency = 'USD',
  fbp,
  fbc,
  clientIp,
  clientUserAgent,
  customData = {},
  actionSource = 'website',
}) {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return { skipped: true, reason: 'missing_META_CAPI_TOKEN' };

  const pixelId = process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID;
  const user_data = {
    em: email ? [sha256(email)] : undefined,
    ph: phone ? [sha256(normalizePhone(phone))] : undefined,
    external_id: externalId ? [sha256(String(externalId))] : undefined,
    fbp: fbp || undefined,
    fbc: fbc || undefined,
    client_ip_address: clientIp || undefined,
    client_user_agent: clientUserAgent || undefined,
  };
  // Drop undefined keys
  Object.keys(user_data).forEach((k) => {
    if (user_data[k] === undefined) delete user_data[k];
  });

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: actionSource,
    event_source_url: eventSourceUrl || 'https://getcompanysync.com/',
    user_data,
    custom_data: {
      currency,
      ...(value != null ? { value: Number(value) } : {}),
      ...customData,
    },
  };

  const body = { data: [event] };
  const testCode = process.env.META_TEST_EVENT_CODE;
  if (testCode) body.test_event_code = testCode;

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.warn('[MetaCAPI] send failed:', resp.status, text.slice(0, 300));
      return { ok: false, status: resp.status };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[MetaCAPI] send error:', e.message);
    return { ok: false, error: e.message };
  }
}

async function sendTrialSignupEvents({
  companyId,
  plan,
  email,
  phone,
  attribution,
}) {
  const value = planMonthlyUsd(plan);
  const eventId = `trial_signup_${companyId}`;
  const common = {
    email,
    phone,
    externalId: companyId,
    value,
    currency: 'USD',
    fbp: attribution?.fbp,
    fbc: attribution?.fbc,
    clientIp: attribution?.ip,
    clientUserAgent: attribution?.ua,
    eventSourceUrl: 'https://getcompanysync.com/signup',
    customData: { plan: String(plan || 'basic').toLowerCase() },
  };
  const results = await Promise.all([
    sendMetaCapiEvent({ ...common, eventName: 'CompleteRegistration', eventId }),
    sendMetaCapiEvent({ ...common, eventName: 'StartTrial', eventId: `${eventId}_st` }),
  ]);
  return { eventId, results };
}

async function sendSubscribePurchaseEvents({
  companyId,
  plan,
  email,
  phone,
  attribution,
  value,
  currency = 'USD',
  invoiceId,
}) {
  const eventId = `subinv_${invoiceId}`;
  const amount = value != null ? Number(value) : planMonthlyUsd(plan);
  const common = {
    email,
    phone,
    externalId: companyId,
    value: amount,
    currency: (currency || 'USD').toUpperCase(),
    fbp: attribution?.fbp,
    fbc: attribution?.fbc,
    clientIp: attribution?.ip,
    clientUserAgent: attribution?.ua,
    eventSourceUrl: 'https://getcompanysync.com/SubscriptionSuccess',
    customData: { plan: String(plan || 'basic').toLowerCase() },
  };
  const results = await Promise.all([
    sendMetaCapiEvent({ ...common, eventName: 'Subscribe', eventId }),
    sendMetaCapiEvent({ ...common, eventName: 'Purchase', eventId: `${eventId}_purchase` }),
  ]);
  return { eventId, results };
}

module.exports = {
  sha256,
  planMonthlyUsd,
  extractAttributionFromReq,
  sendMetaCapiEvent,
  sendTrialSignupEvents,
  sendSubscribePurchaseEvents,
  DEFAULT_PIXEL_ID,
};
