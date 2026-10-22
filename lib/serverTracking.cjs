'use strict';

// Forwards a conversion to the server GTM data client when SGTM_DATA_URL is set.
// No Pixel ID or access token lives here. Failures never block signup or billing.
async function sendServerEvent({ event_name, event_id, user = {}, value, currency = 'USD', extra = {} } = {}) {
  const url = String(process.env.SGTM_DATA_URL || '').trim();
  if (!url || !event_name || !event_id) return { sent: false, reason: 'not_configured' };
  const body = {
    event_name,
    event_id,
    value,
    currency,
    user_data: {
      email_address: user.email || undefined,
      phone_number: user.phone || undefined,
    },
    ip_override: user.ip || undefined,
    user_agent: user.ua || undefined,
    _fbp: user.fbp || undefined,
    _fbc: user.fbc || undefined,
    page_location: 'https://getcompanysync.com/',
    ...extra,
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) console.warn(`[serverTracking] ${event_name} ${event_id} status ${response.status}`);
    return { sent: response.ok, status: response.status };
  } catch (error) {
    console.warn('[serverTracking] send failed:', error.message);
    return { sent: false, reason: error.message };
  }
}

module.exports = { sendServerEvent };
