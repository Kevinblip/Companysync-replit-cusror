'use strict';

// Shared Twilio webhook signature verification for CJS server code
// (dev vite-twilio-ws-plugin.js and prod prod-server.cjs).
//
// Mirrors functions/_twilioSignature.ts (the Deno equivalent already proven
// in functions/recordingWebhook.ts) so both stacks share the same rollout
// strategy:
//   - Default (TWILIO_REQUIRE_SIGNATURE unset): ENFORCE — invalid signatures
//     are rejected (403).
//   - TWILIO_REQUIRE_SIGNATURE=0|false|off: monitor only. Failures are logged
//     and the request is allowed through.
//   - settings.allow_recording_webhook_without_signature=true: per-company
//     opt-in bypass (matches the recordingWebhook.ts convention).

const twilio = require('twilio');

function resolvePublicHost(reqHeaders) {
  const envUrl = process.env.VITE_REPLIT_APP_URL || '';
  if (envUrl) {
    try { return new URL(envUrl).host; } catch (_) {}
  }
  return reqHeaders?.host || null;
}

async function lookupTwilioSettings(pool, { accountSid, companyId }) {
  try {
    if (accountSid) {
      const r = await pool.query(
        `SELECT company_id, data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND data->>'account_sid' = $1 LIMIT 1`,
        [accountSid]
      );
      if (r.rows.length > 0) {
        const data = typeof r.rows[0].data === 'string' ? JSON.parse(r.rows[0].data) : r.rows[0].data;
        return { ...data, company_id: data.company_id || r.rows[0].company_id };
      }
    }
    if (companyId) {
      const r = await pool.query(
        `SELECT company_id, data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
        [companyId]
      );
      if (r.rows.length > 0) {
        const data = typeof r.rows[0].data === 'string' ? JSON.parse(r.rows[0].data) : r.rows[0].data;
        return { ...data, company_id: data.company_id || r.rows[0].company_id };
      }
    }
  } catch (e) {
    console.error('[TwilioVerify] settings lookup failed:', e.message);
  }
  return null;
}

/**
 * Verify a Twilio webhook signature against the resolved company's auth_token.
 *
 * @param {import('http').IncomingMessage} req
 * @param {string} rawBody - the raw application/x-www-form-urlencoded body (already read)
 * @param {import('pg').Pool} pool
 * @param {{ companyId?: string|null }} [opts]
 */
async function verifyTwilioWebhook(req, rawBody, pool, opts) {
  opts = opts || {};
  const sig = req.headers['x-twilio-signature'] || '';
  const params = {};
  try {
    for (const [k, v] of new URLSearchParams(rawBody || '')) params[k] = v;
  } catch (_) {}

  const accountSid = params.AccountSid || null;
  const companyId = opts.companyId || null;

  const settings = await lookupTwilioSettings(pool, { accountSid, companyId });

  // Collect all tokens to try: the company's DB token first, then the
  // platform env token as fallback. The env fallback covers two real cases:
  //   1. The auth token was rotated in Twilio but the DB record hasn't been
  //      updated yet (e.g. after re-provisioning a new account).
  //   2. The company has NO TwilioSettings row at all — e.g. call recordings
  //      started with platform credentials. Twilio signs those callbacks with
  //      the platform auth token, so validating against it is the only way
  //      the legit callback can pass in enforce mode. This is strictly
  //      additive: an invalid signature still fails against every token.
  const cleanToken = settings?.auth_token
    ? String(settings.auth_token).trim().replace(/["']/g, '')
    : '';
  const envToken = (process.env.TWILIO_AUTH_TOKEN || '').trim().replace(/["']/g, '');
  const tokensToTry = [];
  if (cleanToken) tokensToTry.push([cleanToken, 'company']);
  if (envToken && envToken !== cleanToken) tokensToTry.push([envToken, 'platform']);

  if (tokensToTry.length === 0) {
    return { valid: false, hasSignature: !!sig, settings, matchedToken: null, reason: settings ? 'no_token' : 'no_settings', params };
  }
  if (!sig) return { valid: false, hasSignature: false, settings, matchedToken: null, reason: 'no_signature', params };

  // Track WHICH token validated: callers use this to decide which tenant the
  // webhook is trusted for. A 'company' match only proves the sender knows
  // that company's auth token (a hostile BYO tenant knows their own), while a
  // 'platform' match proves Twilio itself signed the callback URL we generated.
  let valid = false;
  let matchedToken = null;
  for (const [token, label] of tokensToTry) {
    if (valid) break;
    // Attempt A: exact req.url as seen by this process (works when Twilio reaches us directly)
    try {
      const directUrl = `https://${req.headers.host || ''}${req.url}`;
      valid = twilio.validateRequest(token, sig, directUrl, params);
    } catch (_) {}

    // Attempt B: canonical public host (handles reverse-proxy URL rewrites)
    if (!valid) {
      try {
        const publicHost = resolvePublicHost(req.headers);
        if (publicHost) {
          const canonicalUrl = `https://${publicHost}${req.url}`;
          valid = twilio.validateRequest(token, sig, canonicalUrl, params);
        }
      } catch (_) {}
    }

    // Attempt C: Replit dev domain — in the workspace the TwiML URL is built
    // with REPLIT_DEV_DOMAIN (see getAppUrl()) but Replit's reverse proxy may
    // rewrite the Host header before the webhook arrives, so neither Attempt A
    // (req.headers.host) nor Attempt B (VITE_REPLIT_APP_URL) match.
    // This is strictly additive: an invalid signature still fails all attempts.
    if (!valid) {
      try {
        const devDomain = process.env.REPLIT_DEV_DOMAIN;
        if (devDomain) {
          const devUrl = `https://${devDomain}${req.url}`;
          valid = twilio.validateRequest(token, sig, devUrl, params);
        }
      } catch (_) {}
    }

    if (valid) matchedToken = label;
  }

  return { valid, hasSignature: true, settings, matchedToken, reason: valid ? 'ok' : 'invalid_signature', params };
}

/**
 * Decide whether a verification result should block the webhook.
 * See file header for the rollout strategy.
 */
function shouldRejectTwilio(result, endpoint) {
  if (result.valid) return false;

  // Signature checks are on unless TWILIO_REQUIRE_SIGNATURE is explicitly 0/false/off.
  const flag = String(process.env.TWILIO_REQUIRE_SIGNATURE ?? '1').toLowerCase();
  const enforceMode = flag !== '0' && flag !== 'false' && flag !== 'off';
  const perCompanyBypass = result.settings?.allow_recording_webhook_without_signature === true;

  if (!enforceMode) {
    console.warn(`[TwilioVerify:${endpoint}] MONITOR — signature not validated (reason=${result.reason}). Remove TWILIO_REQUIRE_SIGNATURE=0 to enforce.`);
    return false;
  }

  if (perCompanyBypass) {
    console.warn(`[TwilioVerify:${endpoint}] Bypassed (per-company opt-in). reason=${result.reason}`);
    return false;
  }

  console.error(`[TwilioVerify:${endpoint}] REJECTED — invalid signature. reason=${result.reason}`);
  return true;
}

module.exports = { verifyTwilioWebhook, shouldRejectTwilio };
