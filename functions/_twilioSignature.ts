import twilio from 'npm:twilio';

export type TwilioVerifyResult = {
  signatureValid: boolean;
  hasSignature: boolean;
  settings: any | null;
  reason: 'ok' | 'no_settings' | 'no_token' | 'no_signature' | 'invalid_signature';
};

/**
 * Verify a Twilio webhook signature against the company's auth_token.
 *
 * Caller MUST have already parsed `params` from the request body (formData /
 * urlencoded text) — this function does NOT consume the body.
 *
 * Lookup strategy:
 *   1. If params.AccountSid is present, find TwilioSettings by account_sid.
 *   2. Otherwise (or if not found), fall back to opts.companyId.
 *
 * URL strategy (handles reverse-proxy rewrites):
 *   1. Try req.url verbatim.
 *   2. Fall back to PUBLIC_HOST / REPLIT_WS_URL + path.
 */
export async function verifyTwilioSignature(
  req: Request,
  params: Record<string, string>,
  base44: any,
  opts?: { companyId?: string | null }
): Promise<TwilioVerifyResult> {
  const sig = req.headers.get('x-twilio-signature') || '';
  const accountSid = params.AccountSid || null;
  const companyId = opts?.companyId || null;

  let settings: any = null;
  try {
    if (accountSid) {
      const list = await base44.asServiceRole.entities.TwilioSettings.filter({ account_sid: accountSid });
      settings = list?.[0] || null;
    }
    if (!settings && companyId) {
      const list = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
      settings = list?.[0] || null;
    }
  } catch (e: any) {
    console.error('[TwilioVerify] settings lookup failed:', e?.message);
  }

  if (!settings) return { signatureValid: false, hasSignature: !!sig, settings: null, reason: 'no_settings' };
  if (!settings.auth_token) return { signatureValid: false, hasSignature: !!sig, settings, reason: 'no_token' };
  if (!sig) return { signatureValid: false, hasSignature: false, settings, reason: 'no_signature' };

  const cleanToken = String(settings.auth_token).trim().replace(/["']/g, '');

  let valid = false;
  try { valid = (twilio as any).validateRequest(cleanToken, sig, req.url, params); } catch (_) {}

  if (!valid) {
    try {
      const publicHost = Deno.env.get('PUBLIC_HOST') ||
        Deno.env.get('REPLIT_WS_URL')?.replace('wss://', 'https://').replace('ws://', 'http://') ||
        '';
      if (publicHost) {
        const u = new URL(req.url);
        const canonicalUrl = `${publicHost}${u.pathname}${u.search}`;
        valid = (twilio as any).validateRequest(cleanToken, sig, canonicalUrl, params);
      }
    } catch (_) {}
  }

  return {
    signatureValid: valid,
    hasSignature: true,
    settings,
    reason: valid ? 'ok' : 'invalid_signature',
  };
}

/**
 * Decide whether a verification result should block the webhook.
 *
 * Rollout strategy:
 *   - Default (TWILIO_REQUIRE_SIGNATURE unset): MONITOR mode — failures are
 *     logged but the request is allowed through. This lets you safely deploy
 *     verification, watch the logs to confirm legit Twilio traffic is being
 *     validated, and flip to enforcement when ready.
 *   - TWILIO_REQUIRE_SIGNATURE=1: ENFORCE mode — failures are rejected.
 *   - settings.allow_recording_webhook_without_signature=true: per-company
 *     opt-in to permanently bypass enforcement (matches recordingWebhook).
 */
export function shouldRejectTwilio(result: TwilioVerifyResult, endpoint: string): boolean {
  if (result.signatureValid) return false;

  const enforceMode = Deno.env.get('TWILIO_REQUIRE_SIGNATURE') === '1';
  const perCompanyBypass = result.settings?.allow_recording_webhook_without_signature === true;

  if (!enforceMode) {
    console.warn(`[TwilioVerify:${endpoint}] ⚠ MONITOR — signature not validated (reason=${result.reason}). ` +
      `Set TWILIO_REQUIRE_SIGNATURE=1 to enforce.`);
    return false;
  }

  if (perCompanyBypass) {
    console.warn(`[TwilioVerify:${endpoint}] ⚠ Bypassed (per-company opt-in). reason=${result.reason}`);
    return false;
  }

  console.error(`[TwilioVerify:${endpoint}] 🛑 REJECTED — invalid signature. reason=${result.reason}`);
  return true;
}
