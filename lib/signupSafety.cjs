'use strict';

// Signup abuse controls shared by the local auth endpoint and the two public
// onboarding orchestrators. Keep this list focused on disposable/reserved
// domains; normal Gmail/Yahoo/Outlook addresses are valid customer emails.

const BLOCKED_EXACT_DOMAINS = new Set([
  '10minutemail.com',
  'burnermail.io',
  'discard.email',
  'dispostable.com',
  'emailfake.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'guerrillamail.com',
  'inboxkitten.com',
  'maildrop.cc',
  'mailnesia.com',
  'mailinator.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempmail.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);

const BLOCKED_RESERVED_DOMAINS = new Set([
  'example.com',
  'example.net',
  'example.org',
  'invalid',
  'localhost',
  'test',
]);

const TEST_SIGNUP_DOMAIN = /(^|[.-])(?:t\d+)?(?:probe|race)(?:[.-]|$)/i;

function normalizeSignupEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getSignupEmailDomain(email) {
  const normalized = normalizeSignupEmail(email);
  const at = normalized.lastIndexOf('@');
  return at > 0 ? normalized.slice(at + 1) : '';
}

function isBlockedSignupDomain(domain) {
  const normalized = String(domain || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!normalized) return false;
  if (BLOCKED_EXACT_DOMAINS.has(normalized)) return true;
  if (TEST_SIGNUP_DOMAIN.test(normalized)) return true;
  const production = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
  if (production && (
    BLOCKED_RESERVED_DOMAINS.has(normalized)
    || normalized.endsWith('.invalid')
    || normalized.endsWith('.test')
  )) return true;
  return false;
}

function isSyntheticSignupEmail(value) {
  const domain = getSignupEmailDomain(value);
  return BLOCKED_RESERVED_DOMAINS.has(domain)
    || domain.endsWith('.invalid')
    || domain.endsWith('.test')
    || TEST_SIGNUP_DOMAIN.test(domain);
}

function validateSignupEmail(value) {
  const email = normalizeSignupEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { allowed: false, email, domain: '', reason: 'Please enter a valid email address' };
  }
  const domain = getSignupEmailDomain(email);
  if (isBlockedSignupDomain(domain)) {
    return {
      allowed: false,
      email,
      domain,
      reason: 'Please use a permanent email address to start a free trial.',
    };
  }
  return { allowed: true, email, domain };
}

function checkSignupAbuse({ email, ip, checkRateLimit }) {
  const domain = getSignupEmailDomain(email);
  const domainCheck = checkRateLimit(`signup:domain:${domain}`, {
    max: 3,
    windowMs: 60 * 60 * 1000,
  });
  if (!domainCheck.allowed) {
    return {
      allowed: false,
      statusCode: 429,
      retryAfterMs: domainCheck.retryAfterMs,
      reason: 'Too many signup attempts from this email domain. Please try again later.',
    };
  }

  // Keep the caller's IP limiter separate so all signup entry points can
  // share the same domain bucket without changing their existing limits.
  return { allowed: true, domain, ip };
}

module.exports = {
  normalizeSignupEmail,
  getSignupEmailDomain,
  isBlockedSignupDomain,
  isSyntheticSignupEmail,
  validateSignupEmail,
  checkSignupAbuse,
};