'use strict';

// Production always talks to Twilio. Tests may point at a localhost mock by
// setting TWILIO_API_BASE. Any other host is ignored so credentials cannot be
// redirected off-box.

function twilioApiBase() {
  const raw = String(process.env.TWILIO_API_BASE || '').trim();
  if (!raw) return 'https://api.twilio.com';
  try {
    const url = new URL(raw);
    const local = (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    if (local) return raw.replace(/\/$/, '');
  } catch (_) {}
  return 'https://api.twilio.com';
}

function twilioApiUrl(pathAndQuery) {
  const path = String(pathAndQuery || '').startsWith('/') ? String(pathAndQuery) : `/${pathAndQuery}`;
  return `${twilioApiBase()}${path}`;
}

module.exports = { twilioApiBase, twilioApiUrl };
