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
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

module.exports = { checkRateLimit, getClientIp };
