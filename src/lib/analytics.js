import { planMonthlyUsd } from '@/config/planPricing';

const PUBLIC_PATHS = [
  /^\/$/,
  /^\/features?$/i,
  /^\/PublicPricing$/i,
  /^\/OnboardingWizard$/i,
  /^\/signup$/i,
  /^\/login$/i,
  /^\/QuickSetup$/i,
  /^\/SubscriptionSuccess$/i,
  /^\/FeatureComparison$/i,
  /^\/privacy$/i,
  /^\/terms$/i,
  /^\/roofers/i,
];

const ATTR_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid',
];
const ATTR_COOKIE = 'cs_attr';
const ATTR_DAYS = 90;
const PIXEL_ID = '2301170120401803';

export function isTrackablePath(pathname = window.location.pathname) {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

export function newEventId(prefix = 'ev') {
  const r = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${r}`;
}

function readCookie(name) {
  try {
    const parts = document.cookie.split('; ');
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
    }
  } catch { /* ignore */ }
  return null;
}

function writeCookie(name, value, days) {
  try {
    const maxAge = Math.floor(days * 86400);
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  } catch { /* ignore */ }
}

export function captureAttribution() {
  try {
    const p = new URLSearchParams(window.location.search);
    const hit = {};
    ATTR_KEYS.forEach((k) => {
      const v = p.get(k);
      if (v) hit[k] = String(v).slice(0, 200);
    });
    if (!Object.keys(hit).length) return getAttribution();
    hit.landing_page = window.location.pathname;
    hit.ts = Date.now();
    if (!localStorage.getItem('cs_first_touch')) {
      localStorage.setItem('cs_first_touch', JSON.stringify(hit));
    }
    localStorage.setItem('cs_last_touch', JSON.stringify(hit));
    writeCookie(ATTR_COOKIE, JSON.stringify(hit), ATTR_DAYS);
    return hit;
  } catch {
    return {};
  }
}

export function getAttribution() {
  try {
    const fromLs = JSON.parse(localStorage.getItem('cs_last_touch') || 'null');
    if (fromLs && Date.now() - (fromLs.ts || 0) <= ATTR_DAYS * 864e5) {
      const { ts, ...rest } = fromLs;
      return rest;
    }
  } catch { /* ignore */ }
  try {
    const raw = readCookie(ATTR_COOKIE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Date.now() - (parsed.ts || 0) <= ATTR_DAYS * 864e5) {
        const { ts, ...rest } = parsed;
        return rest;
      }
    }
  } catch { /* ignore */ }
  return {};
}

export function getMetaCookies() {
  return {
    fbp: readCookie('_fbp') || null,
    fbc: readCookie('_fbc') || buildFbcFromFbclid(),
  };
}

function buildFbcFromFbclid() {
  try {
    const attr = getAttribution();
    if (!attr.fbclid) return null;
    return `fb.1.${Date.now()}.${attr.fbclid}`;
  } catch {
    return null;
  }
}

export function ensureMetaPixel() {
  if (typeof window === 'undefined') return;
  if (window.fbq) return;
  /* eslint-disable */
  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', PIXEL_ID);
}

function pushDataLayer(payload) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ ecommerce: null, user_data: null });
  window.dataLayer.push(payload);
}

/**
 * Fire a browser analytics event (dataLayer + Meta Pixel when mapped).
 * Returns a Promise that resolves with event_id after a short wait so redirects can wait.
 */
export function track(event, params = {}, { eventId, timeoutMs, metaEvent, metaParams } = {}) {
  ensureMetaPixel();
  captureAttribution();
  const event_id = eventId || newEventId(event);
  const attr = getAttribution();
  const metaCookies = getMetaCookies();

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve(event_id);
      }
    };

    pushDataLayer({
      event,
      event_id,
      ...attr,
      ...params,
      fbp: metaCookies.fbp,
      fbc: metaCookies.fbc,
      eventCallback: finish,
      eventTimeout: timeoutMs || 1000,
    });

    if (typeof window.fbq === 'function' && metaEvent) {
      try {
        window.fbq('track', metaEvent, metaParams || {}, { eventID: event_id });
      } catch { /* ignore */ }
    }

    setTimeout(finish, (timeoutMs || 1000) + 200);
  });
}

export function trackPageView(pathname) {
  return track('spa_page_view', {
    page_path: pathname,
    page_location: window.location.origin + pathname,
    page_title: document.title,
  }, { metaEvent: 'PageView' });
}

export function trackViewContent({ contentName = 'pricing', plan } = {}) {
  const value = plan ? planMonthlyUsd(plan) : undefined;
  return track('view_content', {
    content_name: contentName,
    content_category: 'marketing',
    ...(plan ? { plan, value, currency: 'USD' } : {}),
  }, {
    metaEvent: 'ViewContent',
    metaParams: {
      content_name: contentName,
      content_category: 'marketing',
      ...(value != null ? { value, currency: 'USD' } : {}),
    },
  });
}

export function trackSignupSuccess({ plan, email, eventId, method = 'email' }) {
  const value = planMonthlyUsd(plan);
  const base = {
    method,
    plan,
    value,
    currency: 'USD',
    user_data: email ? { email: String(email).trim().toLowerCase() } : undefined,
  };
  // CompleteRegistration
  const regId = eventId || newEventId('trial_signup');
  return track('sign_up', base, {
    eventId: regId,
    timeoutMs: 800,
    metaEvent: 'CompleteRegistration',
    metaParams: { content_name: plan, value, currency: 'USD', status: true },
  }).then(() => track('start_trial', base, {
    eventId: `${regId}_st`,
    timeoutMs: 600,
    metaEvent: 'StartTrial',
    metaParams: { value, currency: 'USD', predicted_ltv: value },
  })).then(() => regId);
}

export function getSignupAttributionPayload() {
  captureAttribution();
  const attr = getAttribution();
  const meta = getMetaCookies();
  return {
    ...attr,
    fbp: meta.fbp,
    fbc: meta.fbc,
  };
}

export { planMonthlyUsd, PIXEL_ID };
