const PREFERENCE_KEYS = [
  'enable_sms',
  'enable_calling',
  'enable_recording',
  'enable_transcription',
  'enable_ai_summary',
  'enable_sms_auto_summary',
];

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 10 ? `1${digits}` : digits;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [
      key,
      key === 'phone_number' ? normalizePhone(value[key]) : stableValue(value[key]),
    ])
  );
}

function sameAvailableNumbers(previous = [], next = []) {
  return JSON.stringify(stableValue(previous)) === JSON.stringify(stableValue(next));
}

export function prepareTwilioSettingsSave(existing, next) {
  const identityUnchanged = !!existing &&
    String(existing.account_sid || '').trim().toUpperCase() === String(next.account_sid || '').trim().toUpperCase() &&
    String(existing.auth_token || '').trim() === String(next.auth_token || '').trim() &&
    normalizePhone(existing.main_phone_number) === normalizePhone(next.main_phone_number) &&
    sameAvailableNumbers(existing.available_numbers || [], next.available_numbers || []) &&
    String(existing.api_key_sid || '').trim() === String(next.api_key_sid || '').trim() &&
    String(existing.api_key_secret || '').trim() === String(next.api_key_secret || '').trim() &&
    String(existing.twiml_app_sid || '').trim() === String(next.twiml_app_sid || '').trim();

  if (!identityUnchanged) return { mode: 'connection', data: next };

  return {
    mode: 'preferences',
    data: Object.fromEntries(PREFERENCE_KEYS.map(key => [key, next[key]])),
  };
}
