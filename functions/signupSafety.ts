const blockedExactDomains = new Set([
  '10minutemail.com', 'burnermail.io', 'discard.email', 'dispostable.com',
  'emailfake.com', 'emailondeck.com', 'fakeinbox.com', 'getnada.com',
  'guerrillamail.com', 'inboxkitten.com', 'maildrop.cc', 'mailnesia.com',
  'mailinator.com', 'mintemail.com', 'moakt.com', 'mohmal.com',
  'mytemp.email', 'sharklasers.com', 'temp-mail.io', 'temp-mail.org',
  'tempmail.com', 'throwawaymail.com', 'trashmail.com', 'yopmail.com',
]);

const blockedReservedDomains = new Set([
  'example.com', 'example.net', 'example.org', 'invalid', 'localhost', 'test',
]);

export function validateSignupEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { allowed: false, email, domain: '', reason: 'Please enter a valid email address' };
  }
  const domain = email.slice(email.lastIndexOf('@') + 1).replace(/\.+$/, '');
  const generatedTestDomain = /(^|[.-])(?:t\d+)?(?:probe|race)(?:[.-]|$)/i.test(domain);
  const production = Deno.env.get('REPLIT_DEPLOYMENT') === '1'
    || Deno.env.get('NODE_ENV') === 'production';
  const blocked = blockedExactDomains.has(domain)
    || generatedTestDomain
    || (production && (
      blockedReservedDomains.has(domain)
      || domain.endsWith('.invalid')
      || domain.endsWith('.test')
    ));
  return blocked
    ? { allowed: false, email, domain, reason: 'Please use a permanent email address to start a free trial.' }
    : { allowed: true, email, domain };
}

export function isSyntheticSignupEmail(value: unknown) {
  const result = validateSignupEmail(value);
  return blockedReservedDomains.has(result.domain)
    || result.domain.endsWith('.invalid')
    || result.domain.endsWith('.test')
    || /(^|[.-])(?:t\d+)?(?:probe|race)(?:[.-]|$)/i.test(result.domain);
}