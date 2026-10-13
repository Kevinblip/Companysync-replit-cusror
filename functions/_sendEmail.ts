// ─────────────────────────────────────────────────────────────────────────────
// Shared Deno email helper — used by all edge functions.
//
// Provider priority (mirrors lib/emailTransport.cjs):
//   1. Postmark  — POSTMARK_SERVER_TOKEN
//   2. AWS SES   — AWS_ACCESS_KEY_ID (alias AWS_API_KEY) + AWS_SECRET_ACCESS_KEY
//                  (alias AWS_SECRET_KEY) + AWS_REGION (default us-east-1)
//
// Drop-in replacement for: import { Resend } from 'npm:resend@4.0.0'
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailAttachment {
  filename?: string;
  name?: string;
  Name?: string;
  content?: string;
  Content?: string;
  contentType?: string;
  ContentType?: string;
  content_type?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  from?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  provider: string;
}

const DEFAULT_FROM = Deno.env.get('EMAIL_FROM') || 'CompanySync <noreply@companysync.io>';
const RESERVED_RECIPIENT_DOMAINS = new Set(['example.com', 'example.net', 'example.org', 'localhost']);

function validateRecipients(to: string | string[], subject: string): string[] {
  const recipients = (Array.isArray(to) ? to : [to]).map((address) => String(address || '').trim());
  if (!subject?.trim() || recipients.length === 0 || recipients.length > 25) {
    throw new Error('[Email] Missing subject or invalid recipient count');
  }
  for (const address of recipients) {
    const domain = address.split('@')[1]?.toLowerCase() || '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error(`[Email] Invalid recipient: ${address}`);
    if (RESERVED_RECIPIENT_DOMAINS.has(domain) || /\.(test|example|invalid|localhost|local)$/.test(domain)) {
      throw new Error('[Email] Reserved test recipients are not deliverable');
    }
  }
  return [...new Set(recipients.map((address) => address.toLowerCase()))];
}

// Postmark rejects From addresses on unverified domains — rewrite to verified domain.
function normalizeFrom(from: string | undefined): string {
  const raw = from || DEFAULT_FROM;
  const verifiedDomains = (Deno.env.get('POSTMARK_VERIFIED_DOMAINS') || 'companysync.io')
    .split(',').map((d: string) => d.trim().toLowerCase()).filter(Boolean);
  const m = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  const displayName = m ? (m[1] || '').trim() : '';
  const addr = (m ? m[2] : raw).trim();
  const domain = addr.split('@')[1]?.toLowerCase();
  if (domain && verifiedDomains.includes(domain)) return raw;
  const rewritten = `${displayName || 'CompanySync'} <noreply@${verifiedDomains[0]}>`;
  console.warn(`[Email] From domain '${domain}' not verified — rewriting to ${rewritten}`);
  return rewritten;
}

function toTextFallback(html: string | undefined): string {
  return html ? html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim() : '';
}

// ── Postmark ──────────────────────────────────────────────────────────────────

async function sendViaPostmark(opts: SendEmailOptions, retries = 3): Promise<SendEmailResult> {
  const token = Deno.env.get('POSTMARK_SERVER_TOKEN')!;
  const toArr = validateRecipients(opts.to, opts.subject);

  const body: Record<string, unknown> = {
    From: normalizeFrom(opts.from),
    To: toArr.join(','),
    Subject: opts.subject,
    TextBody: opts.text || toTextFallback(opts.html),
    MessageStream: 'outbound',
  };
  if (opts.html) body.HtmlBody = opts.html;
  if (opts.attachments?.length) {
    body.Attachments = opts.attachments.map((a) => ({
      Name: a.Name || a.filename || a.name || 'attachment',
      Content: a.Content || a.content || '',
      ContentType: a.ContentType || a.contentType || a.content_type || 'application/octet-stream',
    }));
  }

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': token,
        },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.ok && data.MessageID) {
        console.log(`[Email] Sent via Postmark → ${toArr.join(', ')} | id=${data.MessageID}`);
        return { success: true, id: data.MessageID, provider: 'postmark' };
      }

      const msg: string = data.Message || `Postmark HTTP ${resp.status}`;

      // ErrorCode 412 = pending approval; auth failures — don't retry
      if (resp.status === 401 || resp.status === 403 || data.ErrorCode === 412) {
        throw Object.assign(new Error(msg), { noRetry: true });
      }
      if (resp.status === 429 && attempt < retries) {
        await new Promise((r) => setTimeout(r, attempt * 1500));
        continue;
      }
      lastErr = new Error(msg);
      if (attempt < retries) await new Promise((r) => setTimeout(r, attempt * 800));
    } catch (e: unknown) {
      if ((e as { noRetry?: boolean }).noRetry) throw e;
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) await new Promise((r) => setTimeout(r, attempt * 800));
    }
  }
  console.error(`[Email] Postmark failed → ${toArr.join(', ')}:`, lastErr?.message);
  throw lastErr;
}

// ── AWS SES v2 (pure-Deno Signature V4) ──────────────────────────────────────

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function sha256hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSESSigningKey(secret: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
  const kDate    = await hmacSha256(new TextEncoder().encode(`AWS4${secret}`), dateStamp);
  const kRegion  = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, 'ses');
  return hmacSha256(kService, 'aws4_request');
}

async function bufToHex(buf: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendViaSES(opts: SendEmailOptions, retries = 3): Promise<SendEmailResult> {
  const accessKey = Deno.env.get('AWS_ACCESS_KEY_ID') || Deno.env.get('AWS_API_KEY');
  const secretKey = Deno.env.get('AWS_SECRET_ACCESS_KEY') || Deno.env.get('AWS_SECRET_KEY');
  const region    = Deno.env.get('AWS_REGION') || 'us-east-1';
  if (!accessKey || !secretKey) throw new Error('[Email] AWS SES credentials not configured');

  const toArr = validateRecipients(opts.to, opts.subject);
  const fromAddr = opts.from || DEFAULT_FROM;
  const host = `email.${region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';

  const sesBody: Record<string, unknown> = {
    FromEmailAddress: fromAddr,
    Destination: { ToAddresses: toArr },
    Content: {
      Simple: {
        Subject: { Data: opts.subject, Charset: 'UTF-8' },
        Body: {
          ...(opts.html ? { Html: { Data: opts.html, Charset: 'UTF-8' } } : {}),
          Text: { Data: opts.text || toTextFallback(opts.html) || opts.subject, Charset: 'UTF-8' },
        },
      },
    },
  };

  if (opts.attachments?.length) {
    console.warn('[Email] SES fallback: attachments not supported in Simple mode, sending without attachments');
  }

  const bodyStr = JSON.stringify(sesBody);
  const now = new Date();
  const amzDate   = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const payloadHash    = await sha256hex(bodyStr);
      const canonHeaders   = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
      const signedHeaders  = 'content-type;host;x-amz-date';
      const canonRequest   = ['POST', path, '', canonHeaders, signedHeaders, payloadHash].join('\n');
      const credScope      = `${dateStamp}/${region}/ses/aws4_request`;
      const strToSign      = ['AWS4-HMAC-SHA256', amzDate, credScope, await sha256hex(canonRequest)].join('\n');
      const signingKey     = await getSESSigningKey(secretKey, dateStamp, region);
      const signature      = await bufToHex(await hmacSha256(signingKey, strToSign));
      const authHeader     = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const resp = await fetch(`https://${host}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Amz-Date': amzDate, 'Authorization': authHeader },
        body: bodyStr,
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.ok && data.MessageId) {
        console.log(`[Email] Sent via SES → ${toArr.join(', ')} | id=${data.MessageId}`);
        return { success: true, id: data.MessageId, provider: 'ses' };
      }

      const msg: string = data.message || data.Message || data.__type || `SES HTTP ${resp.status}`;
      if (resp.status === 401 || resp.status === 403) {
        throw Object.assign(new Error(msg), { noRetry: true });
      }
      if (resp.status === 429 && attempt < retries) {
        await new Promise((r) => setTimeout(r, attempt * 1500));
        continue;
      }
      lastErr = new Error(msg);
      if (attempt < retries) await new Promise((r) => setTimeout(r, attempt * 800));
    } catch (e: unknown) {
      if ((e as { noRetry?: boolean }).noRetry) throw e;
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) await new Promise((r) => setTimeout(r, attempt * 800));
    }
  }
  console.error(`[Email] SES failed → ${toArr.join(', ')}:`, lastErr?.message);
  throw lastErr;
}

// ── Unified sender ────────────────────────────────────────────────────────────

/**
 * Send an email via the configured provider (Postmark → SES).
 * Throws if no provider is configured.
 */
export async function sendEmail(opts: SendEmailOptions, retries = 3): Promise<SendEmailResult> {
  // This edge sender is DISABLED by default and fails closed.
  //
  // It talks to Postmark/SES directly, so it bypasses every outbound safety
  // control the Node transport enforces: the bounce/complaint delivery pause,
  // the per-actor / per-company / platform rate limits, and send attribution.
  // An ungoverned second delivery path defeats the purpose of those controls —
  // abusive traffic through here still generates the bounces and complaints
  // that get the whole platform's delivery paused.
  //
  // Nothing loads these functions/*.ts files at runtime today (there is no Deno
  // or edge runtime configured, and no build step compiles them), so this is
  // inert for current traffic. The guard exists so that reviving or deploying
  // them cannot silently reintroduce an unmetered relay: whoever does that must
  // first route delivery through the guarded transport in lib/emailTransport.cjs
  // and only then set this flag.
  if (String(Deno.env.get('EMAIL_EDGE_SENDER_ENABLED') || '').trim() !== '1') {
    const error = new Error(
      '[Email] The edge email sender is disabled. Outbound mail must go through the guarded transport '
      + '(lib/emailTransport.cjs) so it is rate limited, attributed, and subject to the delivery-pause circuit breaker.',
    );
    (error as { code?: string }).code = 'EMAIL_EDGE_SENDER_DISABLED';
    (error as { noRetry?: boolean }).noRetry = true;
    throw error;
  }
  if (String(opts.subject || '').length > 200 || String(opts.html || opts.text || '').length > 250000) {
    throw new Error('[Email] Email content is too large');
  }
  const configured = String(Deno.env.get('EMAIL_PROVIDER') || '').trim().toLowerCase();
  const postmarkToken = Deno.env.get('POSTMARK_SERVER_TOKEN');
  const awsKey    = Deno.env.get('AWS_ACCESS_KEY_ID') || Deno.env.get('AWS_API_KEY');
  const awsSecret = Deno.env.get('AWS_SECRET_ACCESS_KEY') || Deno.env.get('AWS_SECRET_KEY');
  if (configured === 'postmark') {
    if (!postmarkToken) throw new Error('[Email] EMAIL_PROVIDER=postmark but no Postmark token is configured');
    return sendViaPostmark(opts, retries);
  }
  if (configured === 'ses') {
    if (!awsKey || !awsSecret) throw new Error('[Email] EMAIL_PROVIDER=ses but AWS SES credentials are not configured');
    return sendViaSES(opts, retries);
  }
  if (configured) {
    throw new Error(`[Email] EMAIL_PROVIDER=${configured} is not available to edge functions`);
  }
  if (postmarkToken) return sendViaPostmark(opts, retries);
  if (awsKey && awsSecret) return sendViaSES(opts, retries);

  throw new Error('[Email] No email provider configured — set POSTMARK_SERVER_TOKEN or AWS SES credentials');
}
