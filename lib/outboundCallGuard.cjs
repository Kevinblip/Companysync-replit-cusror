'use strict';

const tenantGuard = require('./tenantGuard.cjs');

// Keep this intentionally small: it limits burst abuse from a compromised
// signed-in account while the monthly voice cap remains the billing guard.
const OUTBOUND_CALL_WINDOW_MS = 60 * 1000;
const OUTBOUND_CALL_MAX = 5;
const outboundCallBuckets = new Map();

function normalizeOutboundDestination(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || !/^\+?[0-9().\s-]+$/.test(raw)) return null;

  const digits = raw.replace(/\D/g, '');
  let e164;
  if (raw.startsWith('+')) {
    e164 = `+${digits}`;
  } else if (digits.length === 10) {
    e164 = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    e164 = `+${digits}`;
  } else {
    // Unprefixed international numbers are ambiguous. Require an explicit
    // country code rather than guessing which country should be billed.
    return null;
  }

  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

function consumeOutboundCallRateLimit(companyId) {
  const now = Date.now();
  const key = String(companyId);
  const fresh = (outboundCallBuckets.get(key) || [])
    .filter((timestamp) => now - timestamp < OUTBOUND_CALL_WINDOW_MS);

  if (fresh.length >= OUTBOUND_CALL_MAX) {
    outboundCallBuckets.set(key, fresh);
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((OUTBOUND_CALL_WINDOW_MS - (now - fresh[0])) / 1000)),
      limit: OUTBOUND_CALL_MAX,
    };
  }

  fresh.push(now);
  outboundCallBuckets.set(key, fresh);
  return {
    allowed: true,
    remaining: Math.max(0, OUTBOUND_CALL_MAX - fresh.length),
    limit: OUTBOUND_CALL_MAX,
  };
}

// The map is process-local, matching the existing server rate-limit strategy.
// Remove expired buckets so company IDs cannot accumulate memory indefinitely.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [companyId, timestamps] of outboundCallBuckets.entries()) {
    const fresh = timestamps.filter((timestamp) => now - timestamp < OUTBOUND_CALL_WINDOW_MS);
    if (fresh.length === 0) outboundCallBuckets.delete(companyId);
    else outboundCallBuckets.set(companyId, fresh);
  }
}, OUTBOUND_CALL_WINDOW_MS);
cleanupTimer.unref?.();

async function authorizeOutboundCall({ req, pool, companyId }) {
  const requestedCompanyId = String(companyId == null ? '' : companyId).trim();
  if (!requestedCompanyId) {
    return { allowed: false, statusCode: 400, error: 'companyId is required' };
  }

  const email = await tenantGuard.resolveSessionEmail(req, pool);
  if (!email) {
    return { allowed: false, statusCode: 401, error: 'Not authenticated' };
  }

  const staffMembership = await pool.query(
    `SELECT 1
       FROM staff_profiles
      WHERE company_id = $1
        AND (LOWER(user_email) = $2 OR LOWER(email) = $2)
        AND is_active = true
      LIMIT 1`,
    [requestedCompanyId, email]
  );
  if (staffMembership.rows.length > 0) {
    return { allowed: true, companyId: requestedCompanyId, email };
  }

  // Owners created before staff_profiles was introduced may only be present
  // on the company/user row, so accept those established ownership paths too.
  const ownerMembership = await pool.query(
    `SELECT 1
       FROM companies
      WHERE id = $1
        AND LOWER(created_by) = $2
      LIMIT 1`,
    [requestedCompanyId, email]
  );
  if (ownerMembership.rows.length > 0) {
    return { allowed: true, companyId: requestedCompanyId, email };
  }

  const userMembership = await pool.query(
    `SELECT 1
       FROM users
      WHERE company_id = $1
        AND LOWER(email) = $2
      LIMIT 1`,
    [requestedCompanyId, email]
  );
  if (userMembership.rows.length > 0) {
    return { allowed: true, companyId: requestedCompanyId, email };
  }

  return { allowed: false, statusCode: 403, error: 'Not authorized for this company' };
}

module.exports = {
  authorizeOutboundCall,
  consumeOutboundCallRateLimit,
  normalizeOutboundDestination,
  OUTBOUND_CALL_MAX,
  OUTBOUND_CALL_WINDOW_MS,
};