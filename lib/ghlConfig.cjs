function ghlOauthConfigured(env = process.env) {
  const source = env || {};
  return !!(String(source.GHL_CLIENT_ID || '').trim() && String(source.GHL_CLIENT_SECRET || '').trim());
}

module.exports = { ghlOauthConfigured };
