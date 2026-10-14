'use strict';

// Lightweight in-memory sliding-window rate limiter for auth endpoints
// (single-process Node server, no external store needed).

const buckets = new Map();

function checkRateLimit(key, { max, windowMs }) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= max;
  return { allowed, remaining: Math.max(0, max - bucket.count), retryAfterMs: Math.max(0, bucket.resetAt - now) };
}

// Periodic cleanup so the map doesn't grow unbounded under sustained traffic.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, 5 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

function getClientIp(req) {
  const socketIp = req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
  // TRUST_PROXY=0 uses the socket address. Otherwise the rightmost
  // X-Forwarded-For hop is the one a reverse proxy appended. Earlier hops are
  // client-supplied and must not pick the rate-limit bucket.
  const trust = String(process.env.TRUST_PROXY ?? '1').toLowerCase();
  if (trust === '0' || trust === 'false' || trust === 'off') return socketIp;
  const xff = req.headers?.['x-forwarded-for'];
  if (!xff) return socketIp;
  const parts = String(xff).split(',').map((part) => part.trim()).filter(Boolean);
  const hops = Math.max(1, parseInt(trust, 10) || 1);
  return parts[Math.max(0, parts.length - hops)] || socketIp;
}

module.exports = { checkRateLimit, getClientIp };
