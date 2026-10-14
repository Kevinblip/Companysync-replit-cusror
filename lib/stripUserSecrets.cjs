// Fields that must never leave the server on a user or auth payload.
// must_change_password and has_*_token flags are status, not credentials.

function isSecretUserField(key) {
  const raw = String(key);
  if (raw === 'must_change_password' || raw === 'mustChangePassword') return false;
  const normalized = raw
    .replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase())
    .replace(/^_/, '')
    .toLowerCase();
  if (normalized === 'must_change_password') return false;
  if (/^has_.+_token$/.test(normalized)) return false;
  if (/(?:^|_)password(?:$|_)/.test(normalized)) return true;
  if (/(?:^|_)passwd(?:$|_)/.test(normalized)) return true;
  if (/(?:^|_)secret(?:$|_)/.test(normalized)) return true;
  if (/(?:^|_)api_key(?:$|_)/.test(normalized)) return true;
  if (/(?:^|_)(?:access_token|refresh_token|id_token)(?:$|_)/.test(normalized)) return true;
  if (/_token(?:_enc)?$/.test(normalized)) return true;
  if (/_token_/.test(normalized)) return true;
  return false;
}

// A users-table row (or the same shape nested in a function result).
// QuickBooks and other integration configs also store access_token, so those
// objects are left alone unless they carry a user credential column.
function looksLikeUserRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    'password' in value ||
    'password_hash' in value ||
    'passwordHash' in value ||
    'gmail_access_token' in value ||
    'gmail_refresh_token' in value ||
    'google_access_token' in value ||
    'google_refresh_token' in value ||
    'microsoft_access_token' in value ||
    'microsoft_refresh_token' in value ||
    'is_local_auth' in value
  );
}

function stripUserSecrets(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return user;
  const out = {};
  for (const [key, value] of Object.entries(user)) {
    if (isSecretUserField(key)) continue;
    out[key] = value;
  }
  return out;
}

function redactUserSecrets(value, depth = 0) {
  if (depth > 8 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactUserSecrets(item, depth + 1));
  const strip = looksLikeUserRecord(value);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (strip && isSecretUserField(key)) continue;
    out[key] = redactUserSecrets(child, depth + 1);
  }
  return out;
}

module.exports = {
  isSecretUserField,
  looksLikeUserRecord,
  stripUserSecrets,
  redactUserSecrets,
};
