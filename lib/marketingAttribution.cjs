'use strict';

const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'landing_page', 'fbp', 'fbc'];

function clip(value, max = 200) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : '';
}

function sanitizeAttribution(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const key of ATTR_KEYS) {
    const max = key === 'landing_page' || key === 'fbc' || key === 'fbp' ? 300 : 200;
    const value = clip(input[key], max);
    if (!value) continue;
    if (key === 'landing_page') {
      const path = value.split('?')[0].split('#')[0];
      if (!path.startsWith('/')) continue;
      out[key] = path.slice(0, 300);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function readCookie(req, name) {
  const raw = String(req?.headers?.cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try { return decodeURIComponent(value); } catch { return value; }
  }
  return '';
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function attributionFromRequest(req, clientAttribution) {
  const attr = sanitizeAttribution(clientAttribution);
  const fbp = clip(readCookie(req, '_fbp'), 300);
  const fbc = clip(readCookie(req, '_fbc'), 300);
  if (fbp) attr.fbp = fbp;
  if (fbc) attr.fbc = fbc;
  else if (attr.fbclid && !attr.fbc) {
    attr.fbc = `fb.1.${Date.now()}.${attr.fbclid}`.slice(0, 300);
  }
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const remote = String(req?.socket?.remoteAddress || '').trim();
  const ip = clip(forwarded || remote, 80);
  if (ip && !isLoopback(ip)) attr.ip = ip;
  const ua = clip(req?.headers?.['user-agent'] || '', 300);
  if (ua && !/^node($|\/)/i.test(ua)) attr.ua = ua;
  if (!Object.keys(attr).length) return null;
  attr.captured_at = new Date().toISOString();
  return attr;
}

async function saveMarketingAttribution(pool, companyId, attribution) {
  if (!pool || !companyId || !attribution || !Object.keys(attribution).length) return false;
  try {
    await pool.query(
      `UPDATE companies
         SET data = jsonb_set(
           COALESCE(CASE WHEN jsonb_typeof(data) = 'object' THEN data ELSE '{}'::jsonb END, '{}'::jsonb),
           '{marketing_attribution}',
           COALESCE(
             CASE WHEN jsonb_typeof(data->'marketing_attribution') = 'object'
                  THEN data->'marketing_attribution' ELSE '{}'::jsonb END,
             '{}'::jsonb
           ) || $2::jsonb,
           true
         )
       WHERE id = $1`,
      [companyId, JSON.stringify(attribution)]
    );
    return true;
  } catch (error) {
    console.warn('[attribution] save failed:', error.message);
    return false;
  }
}

module.exports = {
  sanitizeAttribution,
  attributionFromRequest,
  saveMarketingAttribution,
};
