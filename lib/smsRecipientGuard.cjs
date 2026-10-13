const DISPOSABLE_OR_TEST_DOMAINS = new Set([
  'yopmail.com',
  'mailinator.com',
  'guerrillamail.com',
  'example.com',
  'test.com',
]);

const JUNK_NAME_PATTERNS = [
  /^test/i,
  /^tesr/i,
  /^jhon\s*2$/i,
  /^john\s*2$/i,
  /^dummy/i,
  /^asdf/i,
  /^n\/?a$/i,
];

function normalizeSmsPhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  if (!digits || /^0+$/.test(digits) || /^(\d)\1+$/.test(digits) || digits.startsWith('000')) {
    return '';
  }

  let normalized;
  if (raw.startsWith('+')) {
    normalized = `+${digits}`;
  } else if (digits.length === 10) {
    normalized = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    normalized = `+${digits}`;
  } else if (digits.length >= 10 && digits.length <= 15) {
    normalized = `+${digits}`;
  } else {
    return '';
  }

  if (!/^\+[1-9]\d{9,14}$/.test(normalized)) return '';
  if (normalized.startsWith('+1') && !/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(normalized)) return '';
  return normalized;
}

function isAllowlisted(phone) {
  const entries = String(process.env.SMS_TEST_ALLOWLIST || '')
    .split(',')
    .map((entry) => normalizeSmsPhone(entry))
    .filter(Boolean);
  return entries.includes(phone);
}

function isDisposableOrTestEmail(email) {
  const domain = String(email || '').trim().toLowerCase().split('@').pop() || '';
  return [...DISPOSABLE_OR_TEST_DOMAINS].some((blocked) =>
    domain === blocked || domain.endsWith(`.${blocked}`) || domain.includes('tempmail')
  );
}

function assertSmsRecipientAllowed({ name, email, phone, leadStatus, isTest, isJunk, isDemo } = {}) {
  const normalizedPhone = normalizeSmsPhone(phone);
  if (!normalizedPhone) {
    return { ok: false, reason: 'SMS skipped: phone is missing or invalid', normalizedPhone: '' };
  }

  const allowlisted = isAllowlisted(normalizedPhone);
  if (!allowlisted && isDisposableOrTestEmail(email)) {
    return { ok: false, reason: 'SMS skipped: disposable or test email domain', normalizedPhone };
  }

  if (!allowlisted && JUNK_NAME_PATTERNS.some((pattern) => pattern.test(String(name || '').trim()))) {
    return { ok: false, reason: 'SMS skipped: test or junk contact name', normalizedPhone };
  }

  const explicitJunkFlag = [isTest, isJunk, isDemo].some((value) =>
    value === true || String(value || '').trim().toLowerCase() === 'true'
  );
  if (!allowlisted && (explicitJunkFlag || /^(test|junk|demo)$/i.test(String(leadStatus || '').trim()))) {
    return { ok: false, reason: 'SMS skipped: test, junk, or demo lead status', normalizedPhone };
  }

  return { ok: true, normalizedPhone };
}

module.exports = { assertSmsRecipientAllowed, normalizeSmsPhone };