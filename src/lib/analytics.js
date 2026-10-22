// dataLayer helper for GTM. Pixel and GA4 IDs stay in the container.
// Conversion hits include an event_id so Meta can dedupe browser and server events.

const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
const ATTR_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SIGNUP_SEEN_KEY = 'cs_signup_events';
const seenSignups = new Set();

function clip(value, max = 200) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : '';
}

export function newEventId(prefix = 'ev') {
  const random = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export function captureAttribution() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const hit = {};
  ATTR_KEYS.forEach((key) => {
    const value = clip(params.get(key) || '');
    if (value) hit[key] = value;
  });
  if (!Object.keys(hit).length) return;
  hit.landing_page = window.location.pathname.slice(0, 300);
  hit.ts = Date.now();
  try {
    if (!localStorage.getItem('cs_first_touch')) {
      localStorage.setItem('cs_first_touch', JSON.stringify(hit));
    }
    localStorage.setItem('cs_last_touch', JSON.stringify(hit));
  } catch {
    // Storage can be blocked. Signup still proceeds.
  }
}

export function getAttribution() {
  if (typeof window === 'undefined') return {};
  try {
    const last = JSON.parse(localStorage.getItem('cs_last_touch') || 'null');
    if (!last || Date.now() - Number(last.ts || 0) > ATTR_TTL_MS) return {};
    const { ts, ...rest } = last;
    return rest;
  } catch {
    return {};
  }
}

export function getMetaCookies() {
  if (typeof document === 'undefined') return { fbp: null, fbc: null };
  const cookies = Object.fromEntries(document.cookie.split('; ').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    if (index === -1) return [part, ''];
    return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
  return { fbp: cookies._fbp || null, fbc: cookies._fbc || null };
}

export function getSignupAttribution() {
  const cookies = getMetaCookies();
  return {
    ...getAttribution(),
    ...(cookies.fbp ? { fbp: cookies.fbp } : {}),
    ...(cookies.fbc ? { fbc: cookies.fbc } : {}),
  };
}

export function track(event, params = {}, { eventId, timeoutMs } = {}) {
  if (typeof window === 'undefined') return Promise.resolve(null);
  window.dataLayer = window.dataLayer || [];
  const event_id = eventId || newEventId(event);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(event_id);
      }
    };
    const wait = timeoutMs || 1000;
    // Drop leftover ecommerce / user_data so the next hit can't inherit them.
    window.dataLayer.push({ ecommerce: null, user_data: null });
    window.dataLayer.push({
      event,
      event_id,
      ...getAttribution(),
      ...params,
      eventCallback: finish,
      eventTimeout: wait,
    });
    setTimeout(finish, wait + 200);
  });
}

export async function trackSignUpOnce({ eventId, method, plan, email }) {
  if (!eventId || typeof window === 'undefined') return null;
  if (seenSignups.has(eventId)) return eventId;
  seenSignups.add(eventId);
  try {
    const seen = JSON.parse(sessionStorage.getItem(SIGNUP_SEEN_KEY) || '[]');
    if (Array.isArray(seen) && seen.includes(eventId)) return eventId;
    const next = Array.isArray(seen) ? seen : [];
    next.push(eventId);
    sessionStorage.setItem(SIGNUP_SEEN_KEY, JSON.stringify(next.slice(-20)));
  } catch {
    // If storage is blocked, the deterministic event_id still dedupes in Meta.
  }
  return track('sign_up', {
    method: method || 'email',
    plan: plan || undefined,
    value: 0,
    currency: 'USD',
    ...(email ? { user_data: { email: String(email).trim().toLowerCase() } } : {}),
  }, { eventId, timeoutMs: 800 });
}

export function trackBeginCheckout({ sessionId, plan, value }) {
  return track('begin_checkout', {
    plan: plan || undefined,
    ...(typeof value === 'number' ? { value } : {}),
    currency: 'USD',
  }, { eventId: sessionId ? `checkout_${sessionId}` : undefined, timeoutMs: 800 });
}

export function trackPurchase({ eventId, value, currency = 'USD', plan }) {
  return track('purchase', {
    plan: plan || undefined,
    ...(typeof value === 'number' ? { value } : {}),
    currency,
    // GTM maps this purchase to Meta Subscribe. One hit, not two.
    meta_event: 'Subscribe',
  }, { eventId, timeoutMs: 800 });
}
