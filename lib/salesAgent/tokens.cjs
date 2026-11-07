'use strict';

const crypto = require('crypto');

let ephemeralSecret = null;

function tokenSecret(env = process.env) {
  if (env.SALES_AGENT_TOKEN_SECRET) return env.SALES_AGENT_TOKEN_SECRET;
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (!ephemeralSecret) ephemeralSecret = crypto.randomBytes(32).toString('hex');
  return ephemeralSecret;
}

function signPayload(payload, env = process.env) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret(env)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyPayload(token, env = process.env) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', tokenSecret(env)).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function sessionToken({ ip, env = process.env, ttlMs = 10 * 60 * 1000 }) {
  return signPayload({ kind: 'session', ip: ip || '', exp: Date.now() + ttlMs, nonce: crypto.randomBytes(8).toString('hex') }, env);
}

function rescheduleToken({ bookingId, leadId, env = process.env, ttlMs = 30 * 24 * 60 * 60 * 1000 }) {
  return signPayload({ kind: 'reschedule', bookingId, leadId, exp: Date.now() + ttlMs }, env);
}

module.exports = {
  tokenSecret,
  signPayload,
  verifyPayload,
  sessionToken,
  rescheduleToken,
};
