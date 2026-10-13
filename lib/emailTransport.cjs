// ─────────────────────────────────────────────────────────────────────────────
// Shared platform email transport — used by BOTH dev vite plugins (via
// nodeRequire) and prod CJS (prod-server.cjs, db/*.cjs).
//
// Provider priority (auto-detected, lowest ordinal wins):
//   1. Postmark  — POSTMARK_SERVER_TOKEN set
//   2. AWS SES   — AWS_ACCESS_KEY_ID (alias AWS_API_KEY) + AWS_SECRET_ACCESS_KEY
//                  (alias AWS_SECRET_KEY) + AWS_REGION (default us-east-1)
//   3. SMTP      — SMTP_HOST + SMTP_USER + SMTP_PASS (nodemailer)
//   4. Resend    — RESEND_API_KEY set (deprecated fallback, logs a warning)
//
// EMAIL_PROVIDER overrides the auto-detected choice ('postmark' | 'ses' | 'smtp'
// | 'resend'). This lever exists because a provider can go bad WITHOUT failing:
// a suspended Postmark account still answers HTTP 200 with a real MessageID
// while silently discarding every message, so auto-detection alone will happily
// keep routing mail into a black hole. The override lets an operator move all
// sending off a dead provider without a code change. An override naming a
// provider whose credentials are absent FAILS CLOSED: falling back to the dead
// auto-detected provider would claim to send while losing every message.
//
// Every result is reported into lib/emailProviderHealth.cjs so auth failures
// flip the admin banner instead of failing silently.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const emailHealth = require('./emailProviderHealth.cjs');
const emailSafety = require('./emailSafety.cjs');

// Custom header carrying our own pre-send correlation id. Providers echo it
// back (Postmark metadata, SES/Resend tags, SMTP headers) so a delivery
// callback can still find its record when the provider message id never made it
// into the database.
const CORRELATION_HEADER = 'X-Delivery-Correlation';

const PROVIDER_REQUEST_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.EMAIL_PROVIDER_REQUEST_TIMEOUT_MS || 10000),
);

function hasPostmark() { return !!process.env.POSTMARK_SERVER_TOKEN; }
function hasSES() {
  const awsKey = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_API_KEY;
  const awsSecret = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY;
  return !!(awsKey && awsSecret);
}
function hasSMTP() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
function hasResend() { return !!process.env.RESEND_API_KEY; }

const PROVIDER_AVAILABILITY = {
  postmark: hasPostmark,
  ses: hasSES,
  smtp: hasSMTP,
  resend: hasResend,
};

function activeProvider() {
  const override = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  // Emergency block for a provider that accepts API requests but never puts
  // messages into its outbound stream. A stale Deployment secret may still
  // pin EMAIL_PROVIDER=postmark ahead of .replit production environment vars.
  // Never silently fall back to that provider when SMTP is unavailable.
  if (process.env.EMAIL_POSTMARK_DISABLED === '1' &&
      (override === 'postmark' || (!override && hasPostmark()))) {
    if (hasSMTP()) return 'smtp';
    console.error('[Email] Postmark sending is disabled and SMTP is unavailable; refusing email');
    return 'none';
  }
  if (override) {
    const isAvailable = PROVIDER_AVAILABILITY[override];
    if (isAvailable && isAvailable()) return override;
    console.error(
      `[Email] EMAIL_PROVIDER='${override}' unavailable — ${
        isAvailable ? 'its credentials are not configured' : 'unknown provider'
      }; refusing to route mail through a different provider`,
    );
    return 'none';
  }
  if (hasPostmark()) return 'postmark';
  if (hasSES()) return 'ses';
  if (hasSMTP()) return 'smtp';
  if (hasResend()) return 'resend';
  return 'none';
}

function defaultFrom() {
  return process.env.EMAIL_FROM || 'CompanySync <noreply@companysync.io>';
}

function isValidEmailAddress(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// Domains reserved by RFC 2606 / RFC 6761 for documentation and testing. They
// have no MX records, so mail to them can only ever bounce. Test fixtures use
// them heavily, and every such send costs real sender reputation — a bounce
// rate is exactly what gets a sending account throttled or cut off.
const RESERVED_TEST_DOMAINS = new Set([
  'example.com', 'example.net', 'example.org', 'localhost',
]);
const RESERVED_TEST_TLDS = ['.test', '.example', '.invalid', '.localhost', '.local'];

function isReservedTestRecipient(address) {
  const domain = String(address).trim().toLowerCase().split('@').pop() || '';
  if (RESERVED_TEST_DOMAINS.has(domain)) return true;
  return RESERVED_TEST_TLDS.some((tld) => domain === tld.slice(1) || domain.endsWith(tld));
}

const MAX_RECIPIENTS_PER_SEND = 25;

function normalizeRecipients(to, subject) {
  const rawRecipients = Array.isArray(to) ? to : [to];
  if (rawRecipients.length === 0 || !subject) throw new Error('[Email] Missing to/subject');

  const invalidRecipientIndex = rawRecipients.findIndex((address) => !isValidEmailAddress(address));
  if (invalidRecipientIndex >= 0) {
    const invalidRecipient = rawRecipients[invalidRecipientIndex];
    const printable = typeof invalidRecipient === 'string' ? invalidRecipient.trim() : String(invalidRecipient);
    const error = new Error(`[Email] Invalid recipient email address: '${printable}'`);
    error.code = 'INVALID_EMAIL_RECIPIENT';
    error.noRetry = true;
    throw error;
  }

  const trimmed = rawRecipients.map((address) => address.trim());

  // Unit tests that mock the provider assert on fixture recipients and never
  // touch the network, so they opt out explicitly. Nothing at runtime sets it.
  if (process.env.EMAIL_ALLOW_RESERVED_RECIPIENTS === '1') return trimmed;

  // Drop reserved addresses but still deliver to any real ones alongside them,
  // so a genuine recipient is never dropped just for sharing a send with a
  // fixture address.
  const reserved = trimmed.filter(isReservedTestRecipient);
  const deliverable = trimmed.filter((address) => !isReservedTestRecipient(address));

  if (reserved.length > 0) {
    console.warn(`[Email] Blocked ${reserved.length} reserved test recipient(s): ${reserved.join(', ')}`);
  }

  if (deliverable.length === 0) {
    const error = new Error(`[Email] All recipients are reserved test addresses (not deliverable): ${reserved.join(', ')}`);
    error.code = 'RESERVED_TEST_RECIPIENT';
    error.noRetry = true;
    throw error;
  }

  return deliverable;
}

// Normalize attachment to a base64 string regardless of input type
function toBase64Content(c) {
  if (c == null) return c;
  if (typeof c === 'string') return c;
  if (Buffer.isBuffer(c)) return c.toString('base64');
  if (c instanceof Uint8Array || ArrayBuffer.isView(c)) return Buffer.from(c.buffer, c.byteOffset, c.byteLength).toString('base64');
  if (c instanceof ArrayBuffer) return Buffer.from(c).toString('base64');
  return c;
}

function toTextFallback(html) {
  return html ? html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim() : undefined;
}

function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeader(value) {
  const clean = sanitizeHeader(value);
  return /^[\x20-\x7E]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`[Email] Provider request timed out after ${timeoutMs}ms`);
      timeoutError.code = 'EMAIL_PROVIDER_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function wrapBase64(value) {
  return String(value || '').replace(/\s+/g, '').match(/.{1,76}/g)?.join('\r\n') || '';
}

function buildSesRawMessage({ to, from, subject, html, text, cc, replyTo, attachments }) {
  const toArr = Array.isArray(to) ? to : [to];
  const ccArr = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
  const mixedBoundary = `mixed_${crypto.randomBytes(12).toString('hex')}`;
  const altBoundary = `alt_${crypto.randomBytes(12).toString('hex')}`;
  const hasHtml = Boolean(html);
  const plainText = text || toTextFallback(html) || subject;
  const lines = [
    `From: ${sanitizeHeader(from)}`,
    `To: ${toArr.map(sanitizeHeader).join(', ')}`,
    ...(ccArr.length ? [`Cc: ${ccArr.map(sanitizeHeader).join(', ')}`] : []),
    ...(replyTo ? [`Reply-To: ${(Array.isArray(replyTo) ? replyTo : [replyTo]).map(sanitizeHeader).join(', ')}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
  ];

  if (hasHtml) {
    lines.push(
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(Buffer.from(plainText, 'utf8').toString('base64')),
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(Buffer.from(html, 'utf8').toString('base64')),
      `--${altBoundary}--`,
      ''
    );
  } else {
    lines.push(
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(Buffer.from(plainText, 'utf8').toString('base64')),
      ''
    );
  }

  for (const attachment of attachments) {
    const filename = sanitizeHeader(attachment.Name || attachment.filename || attachment.name || 'attachment')
      .replace(/["\\]/g, '_');
    const contentType = sanitizeHeader(
      attachment.ContentType || attachment.content_type || attachment.contentType || 'application/octet-stream'
    );
    const content = attachment.Content ?? attachment.content;
    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${contentType}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      wrapBase64(toBase64Content(content)),
      ''
    );
  }

  lines.push(`--${mixedBoundary}--`, '');
  return lines.join('\r\n');
}

// ── Postmark ──────────────────────────────────────────────────────────────────

// Postmark rejects From addresses on unverified domains. Rewrite to the first
// verified domain (POSTMARK_VERIFIED_DOMAINS, default companysync.io).
function normalizePostmarkFrom(from, { preserveRequestedDomain = false } = {}) {
  const domains = (process.env.POSTMARK_VERIFIED_DOMAINS || 'companysync.io')
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
  const raw = from || defaultFrom();
  const m = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  const displayName = m ? (m[1] || '').trim() : '';
  const addr = (m ? m[2] : raw).trim();
  const domain = addr.split('@')[1]?.toLowerCase();
  if (preserveRequestedDomain) return raw;
  if (domain && domains.includes(domain)) return raw;
  const rewritten = `${displayName || 'CompanySync'} <noreply@${domains[0]}>`;
  console.warn(`[Email] From domain '${domain}' not verified in Postmark — rewriting sender to ${rewritten}`);
  return rewritten;
}

async function sendViaPostmark({ to, from, subject, html, text, cc, replyTo, attachments, preserveRequestedDomain, correlationId } = {}, retries = 3) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const toArr = normalizeRecipients(to, subject);

  const body = {
    From: normalizePostmarkFrom(from, { preserveRequestedDomain }),
    To: toArr.join(','),
    Subject: subject,
    ...(html ? { HtmlBody: html } : {}),
    ...(text || html ? { TextBody: text || toTextFallback(html) } : {}),
    ...(cc ? { Cc: (Array.isArray(cc) ? cc : [cc]).join(',') } : {}),
    ...(replyTo ? { ReplyTo: Array.isArray(replyTo) ? replyTo.join(',') : replyTo } : {}),
    ...(attachments?.length ? {
      Attachments: attachments.map(a => ({
        Name: a.Name || a.filename || a.name || 'attachment',
        Content: toBase64Content(a.Content || a.content),
        ContentType: a.ContentType || a.content_type || a.contentType || 'application/octet-stream',
      })),
    } : {}),
    // Echoed back on every delivery/bounce/complaint webhook. It is the only
    // correlation that survives a database outage between provider acceptance
    // and writing the message id down, because it was persisted BEFORE the send.
    ...(correlationId ? {
      Metadata: { correlation: correlationId },
      Headers: [{ Name: CORRELATION_HEADER, Value: correlationId }],
    } : {}),
    MessageStream: 'outbound',
  };

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetchWithTimeout('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': token },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.ok && data.MessageID) {
        emailHealth.reportResult({ ok: true });
        console.log(`[Email] Sent via Postmark → ${toArr.join(', ')} | id=${data.MessageID}`);
        return { success: true, id: data.MessageID, provider: 'postmark' };
      }

      const msg = data.Message || `Postmark HTTP ${resp.status}`;
      if (emailHealth.isAuthFailure(resp.status, msg)) {
        emailHealth.reportResult({ ok: false, status: resp.status, message: msg });
        const e = new Error(msg); e.noRetry = true; throw e;
      }
      if (data.ErrorCode === 412) { // pending approval
        emailHealth.reportResult({ ok: false, status: 403, message: msg });
        const e = new Error(msg); e.noRetry = true; throw e;
      }
      if (resp.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, attempt * 1500)); continue;
      }
      lastErr = new Error(msg);
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 800));
    } catch (e) {
      if (e.noRetry) throw e;
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 800));
    }
  }
  console.error(`[Email] Postmark failed → ${toArr.join(', ')}:`, lastErr?.message);
  throw lastErr;
}

// ── AWS SES v2 (pure-Node Signature V4) ──────────────────────────────────────

function hmac(key, data, enc) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest(enc);
}
function sha256hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}
function getSESSigningKey(secret, dateStamp, region) {
  const kDate    = hmac(`AWS4${secret}`, dateStamp);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, 'ses');
  return hmac(kService, 'aws4_request');
}

async function sendViaSES({ to, from, subject, html, text, cc, replyTo, attachments, correlationId } = {}, retries = 3) {
  const accessKey = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_API_KEY;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY;
  const region    = process.env.AWS_REGION || 'us-east-1';
  if (!accessKey || !secretKey) throw new Error('[Email] AWS SES credentials not configured');

  const toArr = normalizeRecipients(to, subject);

  const fromAddr = from || defaultFrom();
  const endpoint = `https://email.${region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';
  const host = `email.${region}.amazonaws.com`;

  const destination = {
    ToAddresses: toArr,
    ...(cc ? { CcAddresses: Array.isArray(cc) ? cc : [cc] } : {}),
  };
  const sesBody = {
    FromEmailAddress: fromAddr,
    Destination: destination,
    ReplyToAddresses: replyTo ? (Array.isArray(replyTo) ? replyTo : [replyTo]) : undefined,
    Content: attachments?.length
      ? {
          Raw: {
            Data: Buffer.from(buildSesRawMessage({
              to: toArr, from: fromAddr, subject, html, text, cc, replyTo, attachments,
            }), 'utf8').toString('base64'),
          },
        }
      : {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
              Text: { Data: text || toTextFallback(html) || subject, Charset: 'UTF-8' },
            },
          },
        },
  };
  // SES echoes message tags on every event notification, which is how a
  // callback can still find its record when the post-send write never landed.
  // Tag values are restricted to [A-Za-z0-9_-], which the ids here satisfy.
  if (correlationId) sesBody.EmailTags = [{ Name: 'correlation', Value: correlationId }];
  // Remove undefined keys
  if (!sesBody.ReplyToAddresses) delete sesBody.ReplyToAddresses;

  const bodyStr = JSON.stringify(sesBody);
  const now = new Date();
  const amzDate   = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Build canonical request for SigV4
      const payloadHash = sha256hex(bodyStr);
      const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'content-type;host;x-amz-date';
      const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

      const credScope = `${dateStamp}/${region}/ses/aws4_request`;
      const strToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256hex(canonicalRequest)].join('\n');
      const signingKey = getSESSigningKey(secretKey, dateStamp, region);
      const signature  = hmac(signingKey, strToSign, 'hex');

      const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const resp = await fetchWithTimeout(`${endpoint}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Amz-Date': amzDate,
          'Authorization': authHeader,
        },
        body: bodyStr,
      });
      const data = await resp.json().catch(() => ({}));

      if (resp.ok && data.MessageId) {
        emailHealth.reportResult({ ok: true });
        console.log(`[Email] Sent via SES → ${toArr.join(', ')} | id=${data.MessageId}`);
        return { success: true, id: data.MessageId, provider: 'ses' };
      }

      const msg = data.message || data.Message || data.__type || `SES HTTP ${resp.status}`;
      if (emailHealth.isAuthFailure(resp.status, msg)) {
        emailHealth.reportResult({ ok: false, status: resp.status, message: msg });
        const e = new Error(msg); e.noRetry = true; throw e;
      }
      if (resp.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, attempt * 1500)); continue;
      }
      lastErr = new Error(msg);
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 800));
    } catch (e) {
      if (e.noRetry) throw e;
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 800));
    }
  }
  console.error(`[Email] SES failed → ${toArr.join(', ')}:`, lastErr?.message);
  throw lastErr;
}

// ── Resend (deprecated — last-resort fallback only) ───────────────────────────

async function sendViaResendBasic({ to, from, subject, html, text, cc, replyTo, attachments, correlationId } = {}, retries = 3) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('[Email] RESEND_API_KEY not configured');
  console.warn('[Email] ⚠️  Sending via Resend (deprecated) — configure Postmark or AWS SES instead');
  const toArr = normalizeRecipients(to, subject);

  const payload = {
    from: from || defaultFrom(),
    to: toArr,
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : html ? { text: toTextFallback(html) } : {}),
    ...(cc ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(attachments?.length ? { attachments: attachments.map(a => ({ ...a, ...(a.content != null ? { content: toBase64Content(a.content) } : {}) })) } : {}),
    // Resend echoes TAGS back on delivered/bounced webhooks; an outbound custom
    // header is not returned, so the tag is what actually makes the callback
    // matchable. The header is sent too, for tracing at the receiving end.
    ...(correlationId ? {
      tags: [{ name: 'correlation', value: correlationId }],
      headers: { [CORRELATION_HEADER]: correlationId },
    } : {}),
  };

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.id) {
        emailHealth.reportResult({ ok: true });
        console.log(`[Email] Sent via Resend → ${toArr.join(', ')} | id=${data.id}`);
        return { success: true, id: data.id, provider: 'resend' };
      }
      const msg = data.message || data.error || `Resend HTTP ${resp.status}`;
      if (emailHealth.isAuthFailure(resp.status, msg)) {
        emailHealth.reportResult({ ok: false, status: resp.status, message: msg });
        const e = new Error(msg); e.noRetry = true; throw e;
      }
      if (resp.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, attempt * 1500)); continue;
      }
      lastErr = new Error(msg);
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 800));
    } catch (e) {
      if (e.noRetry) throw e;
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 800));
    }
  }
  console.error(`[Email] Resend failed → ${toArr.join(', ')}:`, lastErr?.message);
  throw lastErr;
}

// ── SMTP (nodemailer) ─────────────────────────────────────────────────────────

let smtpTransporter = null;
function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT || 587);
  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 upgrades via STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: PROVIDER_REQUEST_TIMEOUT_MS,
    greetingTimeout: PROVIDER_REQUEST_TIMEOUT_MS,
    socketTimeout: PROVIDER_REQUEST_TIMEOUT_MS,
  });
  return smtpTransporter;
}

// Relays authenticate as one mailbox and reject (or silently rewrite) a From
// that isn't that mailbox — Gmail always rewrites. Send as the authenticated
// user and preserve the intended sender as Reply-To so replies still reach the
// company instead of the shared relay account.
function normalizeSmtpFrom(from) {
  const authUser = process.env.SMTP_USER;
  const raw = from || defaultFrom();
  const m = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  const displayName = (m ? (m[1] || '').trim() : '') || 'CompanySync';
  const addr = (m ? m[2] : raw).trim();
  if (addr.toLowerCase() === String(authUser).toLowerCase()) {
    return { from: raw, impliedReplyTo: null };
  }
  // Never promote an unattended address to Reply-To — replies would vanish.
  // Callers pass company senders like 'noreply@<domain>', which nobody reads.
  const localPart = addr.split('@')[0].toLowerCase();
  const unattended = /^(no-?reply|do-?not-?reply|bounce|mailer-daemon|postmaster)$/.test(localPart);
  return {
    from: `${sanitizeHeader(displayName)} <${authUser}>`,
    impliedReplyTo: !unattended && isValidEmailAddress(addr) ? addr : null,
  };
}

async function sendViaSMTP({ to, from, subject, html, text, cc, replyTo, attachments, correlationId } = {}, retries = 3) {
  const toArr = normalizeRecipients(to, subject);
  const { from: smtpFrom, impliedReplyTo } = normalizeSmtpFrom(from);
  const effectiveReplyTo = replyTo
    ? (Array.isArray(replyTo) ? replyTo.join(',') : replyTo)
    : impliedReplyTo;

  const message = {
    from: smtpFrom,
    to: toArr,
    subject,
    ...(html ? { html } : {}),
    ...(text || html ? { text: text || toTextFallback(html) } : {}),
    ...(cc ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
    ...(effectiveReplyTo ? { replyTo: effectiveReplyTo } : {}),
    ...(correlationId ? { headers: { [CORRELATION_HEADER]: correlationId } } : {}),
    ...(attachments?.length ? {
      attachments: attachments.map(a => {
        const filename = a.Name || a.filename || a.name || 'attachment';
        const contentType = a.ContentType || a.content_type || a.contentType || undefined;
        // Callers may supply inline bytes OR a path/URL to fetch (inspection
        // report PDFs use the latter). Coercing a path-based attachment through
        // the base64 branch silently produces an empty file, so keep them apart.
        const inline = a.Content || a.content;
        if (!inline && (a.path || a.href)) {
          return { filename, ...(a.path ? { path: a.path } : { href: a.href }), ...(contentType ? { contentType } : {}) };
        }
        return {
          filename,
          content: Buffer.from(toBase64Content(inline) || '', 'base64'),
          contentType: contentType || 'application/octet-stream',
        };
      }),
    } : {}),
  };

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await getSmtpTransporter().sendMail(message);
      // A relay can accept the envelope while refusing individual recipients.
      // Treat "nothing was accepted" as a failure so it can't report success.
      const accepted = info.accepted || [];
      const rejected = info.rejected || [];
      if (!accepted.length) {
        const e = new Error(`SMTP accepted no recipients (rejected: ${rejected.join(', ') || 'unknown'})`);
        e.noRetry = true;
        throw e;
      }
      emailHealth.reportResult({ ok: true });
      if (rejected.length) {
        console.warn(`[Email] SMTP rejected ${rejected.length} recipient(s): ${rejected.join(', ')}`);
      }
      console.log(`[Email] Sent via SMTP → ${accepted.join(', ')} | id=${info.messageId}`);
      return { success: true, id: info.messageId, provider: 'smtp' };
    } catch (e) {
      if (e.noRetry) throw e;
      // 5xx SMTP replies are permanent (bad auth, blocked sender) — retrying
      // burns the daily quota without changing the answer.
      const permanent = e.responseCode >= 500 && e.responseCode < 600;
      // SMTP signals bad credentials with 535/534/530 (nodemailer: code 'EAUTH'),
      // none of which look like the HTTP 401/403 the shared helper knows about.
      // Without this the admin banner stays green while every send fails.
      const smtpAuthFailure = e.code === 'EAUTH' || [530, 534, 535].includes(e.responseCode);
      if (smtpAuthFailure || emailHealth.isAuthFailure(e.responseCode || 0, e.message)) {
        emailHealth.reportResult({ ok: false, status: e.responseCode || 535, message: e.message });
        e.noRetry = true;
        throw e;
      }
      lastErr = e;
      if (permanent) break;
      if (attempt < retries) await new Promise(r => setTimeout(r, attempt * 800));
    }
  }
  console.error(`[Email] SMTP failed → ${toArr.join(', ')}:`, lastErr?.message);
  throw lastErr;
}

// ── Non-delivery provider credential probes ───────────────────────────────────
// Used by the Launch Checklist. Postmark/Resend use read-only endpoints. SES
// signs an intentionally invalid SendEmail request, which exercises the same
// ses:SendEmail permission as delivery but cannot create a message.
async function providerProbeResult(provider, response, fallbackMessage) {
  const body = await response.json().catch(() => ({}));
  const message = body.message || body.Message || body.error || body.__type || fallbackMessage;
  const sesValidationFailure = provider === 'ses' && response.status === 400 &&
    /BadRequest|Validation|MissingRequiredParameter|required|must not be null/i.test(
      `${body.__type || body.code || body.Code || ''} ${message}`,
    );
  if (response.ok || sesValidationFailure) return { ok: true, provider };
  return {
    ok: false,
    provider,
    error: `${provider === 'ses' ? 'AWS SES' : provider[0].toUpperCase() + provider.slice(1)} API error (HTTP ${response.status}): ${message}`,
  };
}

async function fetchProviderProbe(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probePlatformEmailProvider() {
  const provider = activeProvider();
  try {
    if (provider === 'postmark') {
      const response = await fetchProviderProbe('https://api.postmarkapp.com/server', {
        headers: { Accept: 'application/json', 'X-Postmark-Server-Token': process.env.POSTMARK_SERVER_TOKEN },
      });
      return providerProbeResult('postmark', response, 'Postmark rejected the server token');
    }

    if (provider === 'ses') {
      const accessKey = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_API_KEY;
      const secretKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY;
      const region = process.env.AWS_REGION || 'us-east-1';
      const host = `email.${region}.amazonaws.com`;
      const path = '/v2/email/outbound-emails';
      const body = '{}';
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
      const dateStamp = amzDate.slice(0, 8);
      const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'content-type;host;x-amz-date';
      const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, sha256hex(body)].join('\n');
      const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
      const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256hex(canonicalRequest)].join('\n');
      const signature = hmac(getSESSigningKey(secretKey, dateStamp, region), stringToSign, 'hex');
      const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
      const response = await fetchProviderProbe(`https://${host}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Amz-Date': amzDate, Authorization: authorization },
        body,
      });
      return providerProbeResult('ses', response, 'SES rejected the AWS credentials');
    }

    if (provider === 'smtp') {
      // verify() opens a real authenticated session without queueing a message.
      await getSmtpTransporter().verify();
      return { ok: true, provider: 'smtp' };
    }

    if (provider === 'resend') {
      const response = await fetchProviderProbe('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
      return providerProbeResult('resend', response, 'Resend rejected the API key');
    }
    return { ok: false, provider: 'none', error: 'No platform email provider is configured' };
  } catch (error) {
    const label = provider === 'ses' ? 'AWS SES' : provider === 'none' ? 'email provider' : provider[0].toUpperCase() + provider.slice(1);
    return { ok: false, provider, error: `Could not reach ${label}: ${error.message}` };
  }
}

// ── Live sender configuration verification ───────────────────────────────────
//
// A credential probe only proves the token authenticates. It does NOT prove that
// the account it authenticates against is the one holding the messages, nor that
// the address we actually send from is verified there. Both gaps are how a send
// gets accepted, disappears, and then cannot be traced: the message details live
// in a different server/account than the credential used to look them up.
//
// This returns the account identity behind the LIVE sending credential, whether
// that same credential can read message/delivery history, and whether the
// effective From address is verified in that same account.

function sesSignedHeaders({ method, host, path, body, accessKey, secretKey, region }) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, sha256hex(body)].join('\n');
  const credentialScope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256hex(canonicalRequest)].join('\n');
  const signature = hmac(getSESSigningKey(secretKey, dateStamp, region), stringToSign, 'hex');
  return {
    'Content-Type': 'application/json',
    'X-Amz-Date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function addressOf(from) {
  const raw = String(from || '').trim();
  const match = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  return (match ? match[2] : raw).trim().toLowerCase();
}

function domainOf(from) {
  return addressOf(from).split('@')[1] || '';
}

async function verifyPostmarkSenderConfiguration(requestedFrom) {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const headers = { Accept: 'application/json', 'X-Postmark-Server-Token': token };
  const warnings = [];

  const serverResponse = await fetchProviderProbe('https://api.postmarkapp.com/server', { headers });
  const server = await serverResponse.json().catch(() => ({}));
  if (!serverResponse.ok) {
    return {
      ok: false,
      provider: 'postmark',
      error: `Postmark rejected the sending token (HTTP ${serverResponse.status}): ${server.Message || 'unknown error'}`,
    };
  }
  const account = { id: server.ID ?? null, name: server.Name || null };

  // The Messages API is scoped to the SAME server this token belongs to. If it
  // answers, a delivery lookup for anything we send is guaranteed to be looking
  // in the right place — which is exactly what failed during the incident.
  const lookupResponse = await fetchProviderProbe(
    'https://api.postmarkapp.com/messages/outbound?count=1&offset=0',
    { headers },
  );
  const lookupBody = await lookupResponse.json().catch(() => ({}));
  const lookupAvailable = lookupResponse.ok;
  if (!lookupAvailable) {
    warnings.push(
      `Delivery lookups are unavailable under the live sending token (HTTP ${lookupResponse.status}: ${lookupBody.Message || 'unknown error'}) — ` +
      'message status can only come from the delivery webhook.',
    );
  }

  const effectiveFrom = normalizePostmarkFrom(requestedFrom);
  const requestedDomain = domainOf(requestedFrom);
  const effectiveAddress = addressOf(effectiveFrom);
  const effectiveDomain = domainOf(effectiveFrom);
  if (requestedDomain && requestedDomain !== effectiveDomain) {
    warnings.push(
      `Configured sender '${addressOf(requestedFrom)}' is rewritten to '${effectiveAddress}' before sending — ` +
      'delivery history is recorded against the rewritten address.',
    );
  }

  // senderVerified must rest on something the PROVIDER said, never on a local
  // env list — a locally-declared "verified domain" is exactly the false
  // assurance this check exists to remove. Three outcomes are possible, and
  // "we could not tell" is a real one that must not masquerade as verified:
  //   true  — Postmark confirms the address/domain is verified in this account
  //   false — Postmark answered and the sender is absent or unconfirmed
  //   null  — the available credential cannot answer the question at all
  let senderVerified = null;
  let senderEvidence = 'The available Postmark credential cannot list sender signatures or verified domains.';

  // Sender signatures and domains are account-scoped, so they need the account
  // token. It is optional here: most deployments only hold a server token.
  const accountToken = process.env.POSTMARK_ACCOUNT_TOKEN;
  if (accountToken) {
    const accountHeaders = { Accept: 'application/json', 'X-Postmark-Account-Token': accountToken };

    // The two tokens are configured independently and can point at different
    // accounts. Evidence from an account that does not own the server we
    // actually send through is worse than no evidence: it is the same false
    // assurance as a local domain list, now wearing the provider's name. So
    // prove the relationship first by finding this exact server in that
    // account's server list, and discard the evidence entirely if it is absent.
    const serversResponse = await fetchProviderProbe(
      'https://api.postmarkapp.com/servers?count=500&offset=0',
      { headers: accountHeaders },
    );
    const serversBody = await serversResponse.json().catch(() => ({}));
    const accountOwnsServer = serversResponse.ok
      && Array.isArray(serversBody.Servers)
      && account.id != null
      && serversBody.Servers.some((entry) => entry.ID === account.id);

    if (!accountOwnsServer) {
      warnings.push(
        serversResponse.ok
          ? `POSTMARK_ACCOUNT_TOKEN belongs to a different account than the live sending server` +
            `${account.name ? ` '${account.name}'` : ''} — its sender signatures prove nothing about this server and were ignored.`
          : `POSTMARK_ACCOUNT_TOKEN could not list servers (HTTP ${serversResponse.status}) — sender ownership could not be tied to the live sending server.`,
      );
    }

    const [signaturesResponse, domainsResponse] = accountOwnsServer
      ? await Promise.all([
        fetchProviderProbe('https://api.postmarkapp.com/senders?count=500&offset=0', { headers: accountHeaders }),
        fetchProviderProbe('https://api.postmarkapp.com/domains?count=500&offset=0', { headers: accountHeaders }),
      ])
      : [{ ok: false, status: 0 }, { ok: false, status: 0 }];
    const signaturesBody = signaturesResponse.ok ? await signaturesResponse.json().catch(() => ({})) : {};
    const domainsBody = domainsResponse.ok ? await domainsResponse.json().catch(() => ({})) : {};

    if (signaturesResponse.ok || domainsResponse.ok) {
      const signature = (signaturesResponse.ok ? signaturesBody.SenderSignatures || [] : [])
        .find((entry) => String(entry.EmailAddress || '').toLowerCase() === effectiveAddress);
      const domainEntry = (domainsResponse.ok ? domainsBody.Domains || [] : [])
        .find((entry) => String(entry.Name || '').toLowerCase() === effectiveDomain);

      if (signature?.Confirmed) {
        senderVerified = true;
        senderEvidence = `Postmark reports a confirmed sender signature for '${effectiveAddress}' in this account.`;
      } else if (domainEntry && (domainEntry.DKIMVerified || domainEntry.ReturnPathDomainVerified)) {
        senderVerified = true;
        senderEvidence = `Postmark reports domain '${effectiveDomain}' as verified in this account.`;
      } else {
        senderVerified = false;
        senderEvidence = signature
          ? `Postmark has a sender signature for '${effectiveAddress}' but it is not confirmed.`
          : `Postmark has no confirmed signature for '${effectiveAddress}' and no verified '${effectiveDomain}' domain in this account.`;
      }
    } else if (accountOwnsServer) {
      warnings.push(
        `POSTMARK_ACCOUNT_TOKEN was rejected (HTTP ${signaturesResponse.status}/${domainsResponse.status}) — sender ownership could not be confirmed.`,
      );
    }
  }

  // Without the account token, outbound history under the SAME server token is
  // the only provider evidence available. A real message already sent from this
  // address proves the account accepts it — but silence proves nothing, so it
  // can raise the answer to "verified" and never lower it to "not verified".
  if (senderVerified === null) {
    const historyResponse = await fetchProviderProbe(
      `https://api.postmarkapp.com/messages/outbound?count=1&offset=0&fromemail=${encodeURIComponent(effectiveAddress)}`,
      { headers },
    );
    const historyBody = await historyResponse.json().catch(() => ({}));
    if (historyResponse.ok && Number(historyBody.TotalCount) > 0) {
      senderVerified = true;
      senderEvidence = `Postmark's own outbound history for this server contains messages sent from '${effectiveAddress}'.`;
    } else {
      warnings.push(
        `Sender ownership for '${effectiveAddress}' is UNCONFIRMED: ${senderEvidence} ` +
        'Set POSTMARK_ACCOUNT_TOKEN to let this check read sender signatures and verified domains.',
      );
    }
  }

  if (senderVerified === false) {
    warnings.push(senderEvidence);
  }

  return {
    ok: true,
    provider: 'postmark',
    account,
    sender: effectiveAddress,
    configuredSender: addressOf(requestedFrom),
    senderVerified,
    senderEvidence,
    lookupAvailable,
    lookupSampleCount: Number(lookupBody.TotalCount) || 0,
    warnings,
  };
}

async function verifySesSenderConfiguration(requestedFrom) {
  const accessKey = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_API_KEY;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY;
  const region = process.env.AWS_REGION || 'us-east-1';
  const host = `email.${region}.amazonaws.com`;
  const path = '/v2/email/identities';
  const response = await fetchProviderProbe(`https://${host}${path}`, {
    method: 'GET',
    headers: sesSignedHeaders({ method: 'GET', host, path, body: '', accessKey, secretKey, region }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      provider: 'ses',
      error: `AWS SES rejected the sending credentials (HTTP ${response.status}): ${body.message || body.__type || 'unknown error'}`,
    };
  }

  const identities = Array.isArray(body.EmailIdentities) ? body.EmailIdentities : [];
  const address = addressOf(requestedFrom);
  const domain = domainOf(requestedFrom);
  const match = identities.find((identity) => {
    const name = String(identity.IdentityName || '').toLowerCase();
    return name === address || name === domain;
  });
  const warnings = [];
  if (!match) {
    warnings.push(`Sender '${address}' has no verified identity in this SES account (region ${region}).`);
  } else if (match.SendingEnabled === false) {
    warnings.push(`SES identity '${match.IdentityName}' exists but sending is disabled for it.`);
  }

  return {
    ok: true,
    provider: 'ses',
    account: { id: accessKey ? `${String(accessKey).slice(0, 8)}…` : null, name: `SES ${region}` },
    sender: address,
    configuredSender: address,
    senderVerified: Boolean(match && match.SendingEnabled !== false),
    // SES has no per-message lookup API; delivery state comes from SNS events.
    lookupAvailable: false,
    warnings: warnings.concat(
      'SES reports delivery only through SNS event notifications — confirm the delivery webhook subscription is active.',
    ),
  };
}

async function verifyResendSenderConfiguration(requestedFrom) {
  const response = await fetchProviderProbe('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      provider: 'resend',
      error: `Resend rejected the API key (HTTP ${response.status}): ${body.message || 'unknown error'}`,
    };
  }
  const domains = Array.isArray(body.data) ? body.data : [];
  const domain = domainOf(requestedFrom);
  const match = domains.find((entry) => String(entry.name || '').toLowerCase() === domain);
  return {
    ok: true,
    provider: 'resend',
    account: { id: null, name: 'Resend' },
    sender: addressOf(requestedFrom),
    configuredSender: addressOf(requestedFrom),
    senderVerified: Boolean(match && String(match.status || '').toLowerCase() === 'verified'),
    lookupAvailable: true,
    warnings: match
      ? []
      : [`Sender domain '${domain}' is not registered in this Resend account.`],
  };
}

async function verifySmtpSenderConfiguration(requestedFrom) {
  await getSmtpTransporter().verify();
  const { from: effectiveFrom } = normalizeSmtpFrom(requestedFrom);
  const warnings = [
    'SMTP relays expose no delivery-lookup API — message status depends entirely on the delivery webhook or bounce mailbox.',
  ];
  if (addressOf(effectiveFrom) !== addressOf(requestedFrom)) {
    warnings.push(
      `Configured sender '${addressOf(requestedFrom)}' is replaced by the authenticated relay mailbox '${addressOf(effectiveFrom)}'.`,
    );
  }
  return {
    ok: true,
    provider: 'smtp',
    account: { id: null, name: process.env.SMTP_HOST || 'SMTP relay' },
    sender: addressOf(effectiveFrom),
    configuredSender: addressOf(requestedFrom),
    senderVerified: true,
    lookupAvailable: false,
    warnings,
  };
}

async function verifyPlatformSenderConfiguration() {
  const provider = activeProvider();
  const requestedFrom = defaultFrom();
  try {
    if (provider === 'postmark') return await verifyPostmarkSenderConfiguration(requestedFrom);
    if (provider === 'ses') return await verifySesSenderConfiguration(requestedFrom);
    if (provider === 'resend') return await verifyResendSenderConfiguration(requestedFrom);
    if (provider === 'smtp') return await verifySmtpSenderConfiguration(requestedFrom);
    return { ok: false, provider: 'none', error: 'No platform email provider is configured' };
  } catch (error) {
    const label = provider === 'ses' ? 'AWS SES' : provider === 'none' ? 'email provider' : provider[0].toUpperCase() + provider.slice(1);
    return { ok: false, provider, error: `Could not verify the ${label} sender configuration: ${error.message}` };
  }
}

// ── Unified sender ────────────────────────────────────────────────────────────

async function sendPlatformEmail(opts = {}, retries = 3) {
  const to = normalizeRecipients(opts.to, opts.subject);
  const cc = opts.cc ? normalizeRecipients(opts.cc, opts.subject) : [];
  const recipients = [...new Set([...to, ...cc].map((recipient) => recipient.toLowerCase()))];
  if (recipients.length > 25) {
    const error = new Error('[Email] At most 25 recipients are allowed per send');
    error.code = 'EMAIL_TOO_MANY_RECIPIENTS';
    error.noRetry = true;
    throw error;
  }
  emailSafety.assertContentWithinLimits(opts);
  // Pick up a pause tripped by another process (cron/websocket server) or by a
  // previous boot before deciding this send is allowed.
  await emailHealth.ensureHydrated();
  emailHealth.assertDeliveryAllowed();
  await emailSafety.assertCanSend(opts.context, recipients.length);
  const provider = activeProvider();
  const prepared = { ...opts, to, ...(cc.length ? { cc } : {}) };
  try {
    let result;
    if (provider === 'postmark') result = await sendViaPostmark(prepared, retries);
    else if (provider === 'ses') result = await sendViaSES(prepared, retries);
    else if (provider === 'smtp') result = await sendViaSMTP(prepared, retries);
    else if (provider === 'resend') result = await sendViaResendBasic(prepared, retries);
    else throw new Error(`[Email] No usable email provider configured${process.env.EMAIL_PROVIDER ? ` for EMAIL_PROVIDER='${process.env.EMAIL_PROVIDER}'` : ''} — check the provider credentials`);
    emailSafety.recordDeliveryAttempt({ context: opts.context, recipients, subject: opts.subject, result }).catch(() => {});
    return result;
  } catch (error) {
    emailSafety.recordDeliveryAttempt({ context: opts.context, recipients, subject: opts.subject, error }).catch(() => {});
    throw error;
  }
}

/**
 * Subscriber lifecycle and account-recovery mail follows the operator's
 * configured provider too. Otherwise EMAIL_PROVIDER=smtp repairs company mail
 * while leaving essential login/recovery messages on an unusable Postmark
 * account. SMTP sends from its authenticated mailbox (see normalizeSmtpFrom).
 * Resend remains excluded from this sensitive path.
 */
async function sendPlatformSubscriberEmail(opts = {}, retries = 1) {
  const to = normalizeRecipients(opts.to, opts.subject);
  const cc = opts.cc ? normalizeRecipients(opts.cc, opts.subject) : [];
  const recipients = [...new Set([...to, ...cc].map((recipient) => recipient.toLowerCase()))];
  if (recipients.length > 25) {
    const error = new Error('[Email] At most 25 recipients are allowed per send');
    error.code = 'EMAIL_TOO_MANY_RECIPIENTS';
    error.noRetry = true;
    throw error;
  }
  emailSafety.assertContentWithinLimits(opts);
  await emailHealth.ensureHydrated();
  emailHealth.assertDeliveryAllowed();
  await emailSafety.assertCanSend(opts.context, recipients.length);

  const provider = activeProvider();
  if (!['postmark', 'ses', 'smtp'].includes(provider)) {
    const error = new Error('[Email] Subscriber mail requires Postmark, AWS SES, or a configured SMTP relay');
    error.code = 'SUBSCRIBER_EMAIL_PROVIDER_UNAVAILABLE';
    error.noRetry = true;
    throw error;
  }

  const prepared = {
    ...opts,
    to,
    ...(cc.length ? { cc } : {}),
    preserveRequestedDomain: provider === 'postmark',
  };
  try {
    const result = provider === 'postmark'
      ? await sendViaPostmark(prepared, retries)
      : provider === 'ses'
        ? await sendViaSES(prepared, retries)
        : await sendViaSMTP(prepared, retries);
    emailSafety.recordDeliveryAttempt({ context: opts.context, recipients, subject: opts.subject, result }).catch(() => {});
    return result;
  } catch (error) {
    emailSafety.recordDeliveryAttempt({ context: opts.context, recipients, subject: opts.subject, error }).catch(() => {});
    throw error;
  }
}

module.exports = {
  sendPlatformEmail,
  sendPlatformSubscriberEmail,
  activeProvider,
  probePlatformEmailProvider,
  verifyPlatformSenderConfiguration,
  normalizeRecipients,
  MAX_RECIPIENTS_PER_SEND,
  CORRELATION_HEADER,
};
