'use strict';

const crypto = require('crypto');

let _missingSecretWarned = false;
function getSecret() {
  const s = process.env.ESTIMATE_LINK_SECRET || process.env.SESSION_SECRET || '';
  if (!s && !_missingSecretWarned) {
    _missingSecretWarned = true;
    console.error('[estimateToken] WARNING: neither ESTIMATE_LINK_SECRET nor SESSION_SECRET is set — public estimate URLs cannot be signed');
  }
  return s;
}

function signEstimateToken(id) {
  const secret = getSecret();
  if (!secret || !id) return '';
  return crypto.createHmac('sha256', secret).update(String(id)).digest('base64url');
}

function verifyEstimateToken(id, token) {
  if (!token || !id) return false;
  const expected = signEstimateToken(id);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

function isTokenRequired() {
  return process.env.ESTIMATE_REQUIRE_TOKEN === '1';
}

function checkEstimateAccess(id, token, ctx) {
  const required = isTokenRequired();
  if (!token) {
    if (required) {
      console.warn(`[estimateToken] BLOCK missing token id=${id} ctx=${ctx || ''}`);
      return { ok: false, mode: 'enforced', reason: 'missing_token' };
    }
    console.warn(`[estimateToken] MONITOR missing token id=${id} ctx=${ctx || ''}`);
    return { ok: true, mode: 'monitor', reason: 'missing_token' };
  }
  if (!verifyEstimateToken(id, token)) {
    console.warn(`[estimateToken] BLOCK invalid token id=${id} ctx=${ctx || ''}`);
    return { ok: false, mode: 'enforced', reason: 'invalid_token' };
  }
  return { ok: true, mode: 'enforced', reason: 'valid' };
}

function appendToken(url, id) {
  const tok = signEstimateToken(id);
  if (!tok) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${tok}`;
}

module.exports = {
  signEstimateToken,
  verifyEstimateToken,
  isTokenRequired,
  checkEstimateAccess,
  appendToken,
};
