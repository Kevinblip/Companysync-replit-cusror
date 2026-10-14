'use strict';

// The browser map used to receive GOOGLE_MAPS_API_KEY. PR #23 switched that
// response to GOOGLE_MAPS_BROWSER_KEY only. A host that still has the original
// key, and no separate browser key, then tells the estimator the API key is
// not configured even though Solar, Geocoding, Static Maps, and Street View
// keep using GOOGLE_MAPS_API_KEY successfully.
//
// Prefer the referrer-restricted browser key. Fall back to the original key
// so existing secrets keep the map working.

const BROWSER_ENV = 'GOOGLE_MAPS_BROWSER_KEY';
const SERVER_ENV = 'GOOGLE_MAPS_API_KEY';

function nonempty(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function missingBrowserKeyError() {
  return `Google Maps browser key is not configured. Set ${BROWSER_ENV} in Secrets. ${SERVER_ENV} is also accepted until a separate browser key is added.`;
}

function resolveGoogleMapsBrowserKey(env = process.env) {
  const browserKey = nonempty(env[BROWSER_ENV]);
  if (browserKey) {
    return { apiKey: browserKey, source: BROWSER_ENV, fallback: false };
  }
  const serverKey = nonempty(env[SERVER_ENV]);
  if (serverKey) {
    return { apiKey: serverKey, source: SERVER_ENV, fallback: true };
  }
  return { apiKey: '', source: null, fallback: false, error: missingBrowserKeyError() };
}

module.exports = {
  BROWSER_ENV,
  SERVER_ENV,
  missingBrowserKeyError,
  resolveGoogleMapsBrowserKey,
};
