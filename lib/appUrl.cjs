'use strict';

// Public origin for Stripe return URLs and other links we hand to a browser.
// APP_URL is the host-agnostic setting (set it on Railway). When it is absent,
// use the request's forwarded host, then REPLIT_DOMAINS so a current Replit
// deploy keeps working, then localhost for local dev.

function header(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function cleanBase(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(trimmed)) return '';
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function originFromRequest(req) {
  if (!req) return '';
  const host = (header(req, 'x-forwarded-host') || header(req, 'host')).split(',')[0].trim();
  if (!/^[A-Za-z0-9.\-:]+$/.test(host)) return '';
  const forwarded = header(req, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
  const proto = forwarded === 'http' || forwarded === 'https'
    ? forwarded
    : (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

function resolveAppUrl(req) {
  const fromEnv = cleanBase(process.env.APP_URL);
  if (fromEnv) return fromEnv;
  const fromRequest = originFromRequest(req);
  if (fromRequest) return fromRequest;
  const domains = String(process.env.REPLIT_DOMAINS || '').split(',')[0].trim();
  if (domains && /^[A-Za-z0-9.\-:]+$/.test(domains)) return `https://${domains}`;
  return 'http://localhost:5000';
}

module.exports = { resolveAppUrl, cleanBase };
