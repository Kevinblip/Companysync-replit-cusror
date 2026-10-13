'use strict';

// The signing-link sender is deliberately shared by the Vite and production
// servers. It accepts only an existing, tenant-owned signing session; request
// data is never a source of recipient, company, or contract details.
const crypto = require('crypto');
const tenantGuard = require('./tenantGuard.cjs');
const emailTransport = require('./emailTransport.cjs');

const MAX_BODY_BYTES = 32 * 1024;
const MAX_SENDS_PER_HOUR = 10;
const SMS_REQUEST_TIMEOUT_MS = 10_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SENDABLE_STATUSES = ['draft', 'signed_by_rep', 'awaiting_customer', 'sent_to_customer', 'expired'];

function json(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function signingFromAddr(displayName) {
  const envFrom = process.env.EMAIL_FROM || 'CompanySync <noreply@companysync.io>';
  const address = envFrom.match(/<([^>]+)>/)?.[1] || envFrom;
  return `${String(displayName || 'Contract Signing').replace(/[\r\n<>]/g, '').slice(0, 100)} <${address}>`;
}

async function readLimitedJson(req) {
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    parts.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON request body');
    error.statusCode = 400;
    throw error;
  }
}

function buildSigningEmailHtml({ customerName, repName, templateName, contractName, signingLink, expiresDate, companyName }) {
  const contract = escapeHtml(templateName || contractName);
  const job = templateName && contractName ? `<p><strong>Job:</strong> ${escapeHtml(contractName)}</p>` : '';
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><div style="background:#5b5bd6;padding:28px;text-align:center;color:white"><h2 style="margin:0">${escapeHtml(companyName || 'Contract Signing')}</h2><h1 style="font-size:24px">Contract Ready for Your Signature</h1></div><div style="background:#f9fafb;padding:30px"><p>Hello <strong>${escapeHtml(customerName || 'Customer')}</strong>,</p><p>${repName ? `${escapeHtml(repName)} has` : 'You have been'} sent you a contract for electronic signature.</p>${contract ? `<div style="background:white;padding:16px;border-left:4px solid #5b5bd6"><p><strong>Contract:</strong> ${contract}</p>${job}<p><strong>Expires:</strong> ${escapeHtml(expiresDate)}</p></div>` : ''}<p style="text-align:center"><a href="${encodeURI(signingLink)}" style="display:inline-block;background:#5b5bd6;color:white;padding:15px 32px;text-decoration:none;border-radius:8px">Review &amp; Sign Contract</a></p></div></body></html>`;
}

function getCanonicalAppUrl() {
  if (process.env.REPLIT_DEPLOYMENT !== '1' && process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return (process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com').replace(/\/$/, '');
}

async function canSendForCompany(pool, context, companyId, channel) {
  if (context.isSuperAdmin) return true;
  if (!context.allowedCompanyIds?.has(companyId)) return false;
  if (context.administratorCompanyIds?.has(companyId)) return true;
  const owner = await pool.query(
    `SELECT 1 FROM companies WHERE id=$1 AND LOWER(COALESCE(created_by,''))=LOWER($2) LIMIT 1`,
    [companyId, context.email],
  );
  if (owner.rowCount > 0) return true;

  // Non-admin office staff can send only when their company-scoped StaffRole
  // explicitly grants Communication Hub's matching channel capability.
  const profile = await pool.query(
    `SELECT role_id FROM staff_profiles
     WHERE company_id=$1 AND (LOWER(email)=LOWER($2) OR LOWER(user_email)=LOWER($2))
       AND is_active=true LIMIT 1`,
    [companyId, context.email],
  );
  const roleId = profile.rows[0]?.role_id;
  if (!roleId) return false;
  const role = await pool.query(
    `SELECT data FROM generic_entities
     WHERE id=$1 AND entity_type='StaffRole' AND company_id=$2 LIMIT 1`,
    [roleId, companyId],
  );
  const data = typeof role.rows[0]?.data === 'string' ? JSON.parse(role.rows[0].data) : role.rows[0]?.data;
  const permissions = data?.permissions || {};
  const capability = channel === 'sms' ? 'send_sms' : 'send_email';
  return permissions?.communication_hub?.[capability] === true
    || permissions?.['Communication Hub']?.[capability] === true;
}

function storedPhone(phone) {
  const normalized = String(phone || '').replace(/[^\d+]/g, '');
  return /^\+?[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

async function freezeContractSnapshot(client, session) {
  if (session.html_content) return { html: session.html_content };
  if (!session.template_id) return { html: null };
  const template = await client.query(
    `SELECT data FROM generic_entities
     WHERE id=$1 AND entity_type='ContractTemplate' AND company_id=$2 LIMIT 1`,
    [session.template_id, session.company_id],
  );
  // A referenced template must belong to the signing session's tenant. This
  // prevents a crafted session row from turning a public signing token into a
  // cross-company document reader.
  if (!template.rowCount) return { invalidTemplate: true };
  const data = typeof template.rows[0].data === 'string' ? JSON.parse(template.rows[0].data) : template.rows[0].data;
  let html = data?.html_content;
  if (html && typeof html === 'object') html = JSON.stringify(html);
  if (!html || typeof html !== 'string' || html.trim()[0] !== '{') return { html: null };
  try { JSON.parse(html); } catch { return { html: null }; }
  const saved = await client.query(
    `UPDATE signing_sessions SET html_content=$1
     WHERE id=$2 AND company_id=$3 AND html_content IS NULL RETURNING html_content`,
    [html, session.id, session.company_id],
  );
  session.html_content = saved.rows[0]?.html_content || session.html_content || html;
  return { html: session.html_content };
}

async function reserveDelivery(pool, { email, sessionId, context, signingToken, expiresAt }) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => {};
  const deliveryId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const sessionLock = `contract-signing-session:${sessionId}`;
  let lockHeld = false;
  const abandonReservation = async () => {
    let unlocked = !lockHeld;
    if (lockHeld) {
      try {
        const result = await client.query('SELECT pg_advisory_unlock(hashtext($1)) AS unlocked', [sessionLock]);
        unlocked = result.rows[0]?.unlocked !== false;
      } catch (_) {}
    }
    // Never return a client to the pool if its session-level lock may remain.
    // pg accepts release(true) to discard that connection.
    if (typeof client.release === 'function') client.release(!unlocked);
  };
  try {
    // Hold this session-specific lock through the provider call. Otherwise a
    // second resend can rotate the token while the first message is in flight,
    // causing a "sent" message to arrive with an already-invalid link.
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [sessionLock]);
    lockHeld = true;
    await client.query('BEGIN');
    const prior = await client.query(
      'SELECT * FROM signing_sessions WHERE id=$1 FOR UPDATE',
      [sessionId],
    );
    if (!prior.rowCount) {
      await client.query('ROLLBACK');
      await abandonReservation();
      return { missing: true };
    }
    if (!SENDABLE_STATUSES.includes(prior.rows[0].status)) {
      await client.query('ROLLBACK');
      await abandonReservation();
      return { terminal: true };
    }
    const companyId = prior.rows[0].company_id;
    const channel = prior.rows[0].delivery_method === 'sms' ? 'sms' : 'email';
    const recipient = channel === 'email'
      ? String(prior.rows[0].customer_email || '').trim()
      : storedPhone(prior.rows[0].customer_phone);
    if (!companyId || !(await canSendForCompany(client, context, companyId, channel))) {
      await client.query('ROLLBACK');
      await abandonReservation();
      return { forbidden: true };
    }
    if ((channel === 'email' && !EMAIL_PATTERN.test(recipient)) || !recipient) {
      await client.query('ROLLBACK');
      await abandonReservation();
      return { invalidRecipient: true, channel };
    }
    const snapshot = await freezeContractSnapshot(client, prior.rows[0]);
    if (snapshot.invalidTemplate) {
      await client.query('ROLLBACK');
      await abandonReservation();
      return { invalidTemplate: true };
    }
    // Serialize sends for a company/actor pair. Counting then recording outside
    // this transaction would let a burst of concurrent requests become a relay.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`contract-signing:${companyId}:${email.toLowerCase()}`]);
    const recent = await client.query(
      `SELECT COUNT(*)::int AS count FROM communications
       WHERE company_id=$1 AND created_by=$2 AND created_at > NOW() - INTERVAL '1 hour'
         AND data->>'source'='contract_signing'`,
      [companyId, email],
    );
    if ((recent.rows[0]?.count || 0) >= MAX_SENDS_PER_HOUR) {
      await client.query('ROLLBACK');
      await abandonReservation();
      return null;
    }
    const updated = await client.query(
      `UPDATE signing_sessions
       SET signing_token=$1,status='awaiting_customer',current_signer='customer',
           expires_at=$2,sent_to_customer_at=NOW(),updated_at=NOW()
       WHERE id=$3 AND company_id=$4 AND status = ANY($5::text[])
       RETURNING *`,
      [signingToken, expiresAt, sessionId, companyId, SENDABLE_STATUSES],
    );
    if (!updated.rowCount) {
      await client.query('ROLLBACK');
      await abandonReservation();
      return { conflict: true };
    }
    await client.query(
      `INSERT INTO communications
        (id, company_id, type, communication_type, direction, contact_name, contact_email, contact_phone,
         subject, body, message, status, created_by, data, created_at, updated_at)
       VALUES ($1,$2,$3,$3,'outbound',NULL,$4,$5,$6,NULL,NULL,'pending',$7,$8,NOW(),NOW())`,
      [deliveryId, companyId, channel, channel === 'email' ? recipient : null, channel === 'sms' ? recipient : null,
        'Contract signing link delivery', email, JSON.stringify({
          source: 'contract_signing', related_entity_type: 'ContractSigningSession',
          related_entity_id: String(sessionId), attempted_at: new Date().toISOString(),
          // Written before the send, echoed back by the provider: the outcome
          // stays matchable even if the post-send write never lands.
          delivery_correlation_id: correlationId,
        })],
    );
    await client.query('COMMIT');
    return {
      session: updated.rows[0], priorSession: prior.rows[0], deliveryId, correlationId, client, channel, recipient,
      release: abandonReservation,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await abandonReservation();
    throw error; // Fail closed: no provider call without a durable reservation.
  }
}

async function finishDelivery(pool, deliveryId, status, error, outcome = null) {
  // 'accepted' means the provider took the request, which is not delivery.
  // Record the provider message id alongside it so the delivery/bounce webhook
  // can find this row later and replace that acceptance with the real outcome.
  // Identifiers and the error are always recorded; the acceptance state only
  // while nothing better is. The provider can call back (matching the pre-send
  // correlation id) before this update runs, and a bounce recorded that way
  // must survive — the ledger event carrying it has already been retired.
  await require('./emailDeliveryWebhook.cjs').finalizeSendRecord({
    communicationId: deliveryId,
    status,
    always: {
      error: error || null,
      ...(outcome?.provider_message_id ? { provider_message_id: outcome.provider_message_id } : {}),
      ...(outcome?.provider ? { provider: outcome.provider } : {}),
    },
    optimistic: {
      delivery_status: status === 'accepted' ? 'submitted' : 'failed',
      delivery_status_at: new Date().toISOString(),
    },
  }, { pool });

  // The callback can outrun this update, in which case the event is already
  // waiting on the ledger with nothing to match. Now that the id is stored,
  // give it the chance to land.
  if (outcome?.provider_message_id) {
    await require('./emailDeliveryWebhook.cjs')
      .applyPendingDeliveryEvents({ pool, messageId: outcome.provider_message_id })
      .catch((err) => console.warn('[Signing] Could not replay delivery events:', err.message));
  }
}

async function restoreSessionAfterFailedDelivery(client, priorSession, reservedToken) {
  await client.query(
    `UPDATE signing_sessions
     SET signing_token=$1,status=$2,current_signer=$3,expires_at=$4,
         sent_to_customer_at=$5,updated_at=NOW()
     WHERE id=$6 AND company_id=$7 AND signing_token=$8`,
    [
      priorSession.signing_token, priorSession.status, priorSession.current_signer,
      priorSession.expires_at, priorSession.sent_to_customer_at,
      priorSession.id, priorSession.company_id, reservedToken,
    ],
  );
}

async function handleSigningLinkDelivery(req, res, { pool }) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return true;
  }
  if (req.method !== 'POST') {
    json(res, { success: false, error: 'Method not allowed' }, 405);
    return true;
  }

  let reservation = null;
  try {
    const context = await tenantGuard.resolveRequestContext(req, pool);
    // Service tokens are for trusted background operations, not browser mail
    // delivery. This endpoint always needs a real, signed staff session.
    if (!context.authenticated || context.viaServiceToken) {
      json(res, { success: false, error: 'Authentication required' }, 401);
      return true;
    }
    // Impersonation is deliberately read-only throughout the app. Never allow
    // a platform administrator to rotate a customer signing token or trigger
    // an external delivery while viewing a tenant on their behalf.
    if (context.isImpersonating) {
      json(res, { success: false, error: 'Writes are not allowed while impersonating' }, 403);
      return true;
    }

    const body = await readLimitedJson(req);
    const sessionId = body?.sessionId || body?.session_id;
    if (typeof sessionId !== 'string' && typeof sessionId !== 'number') {
      json(res, { success: false, error: 'sessionId is required' }, 400);
      return true;
    }
    const lookupId = String(sessionId);
    if (!lookupId || lookupId.length > 200) {
      json(res, { success: false, error: 'Invalid sessionId' }, 400);
      return true;
    }

    // The stored company is authoritative. Do not accept sessionData/company_id
    // from the browser, even to create a row: drafts must be created through the
    // tenant-guarded entity API first.
    const existing = await pool.query(
      `SELECT * FROM signing_sessions
       WHERE base44_session_id=$1 OR id::text=$1
       ORDER BY id LIMIT 1`,
      [lookupId],
    );
    const session = existing.rows[0];
    if (!session) {
      json(res, { success: false, error: 'Signing session not found' }, 404);
      return true;
    }
    const signingToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    reservation = await reserveDelivery(pool, {
      email: context.email, sessionId: session.id, context, signingToken, expiresAt,
    });
    if (!reservation) {
      json(res, { success: false, error: 'Signing-link send limit reached. Please try again later.' }, 429);
      return true;
    }
    if (reservation.missing) {
      json(res, { success: false, error: 'Signing session no longer exists' }, 404);
      return true;
    }
    if (reservation.terminal) {
      json(res, { success: false, error: 'This signing session can no longer be sent' }, 409);
      return true;
    }
    if (reservation.conflict) {
      json(res, { success: false, error: 'This signing session changed before it could be sent' }, 409);
      return true;
    }
    if (reservation.forbidden) {
      json(res, { success: false, error: 'Forbidden' }, 403);
      return true;
    }
    if (reservation.invalidRecipient) {
      json(res, { success: false, error: `This signing session has no valid customer ${reservation.channel === 'email' ? 'email address' : 'phone number'}` }, 400);
      return true;
    }
    if (reservation.invalidTemplate) {
      json(res, { success: false, error: 'Signing session references an unavailable contract template' }, 409);
      return true;
    }
    const current = reservation.session;
    const deliveryMethod = reservation.channel;
    const recipient = reservation.recipient;
    const companyRow = await reservation.client.query('SELECT company_name FROM companies WHERE id=$1 LIMIT 1', [current.company_id]);
    const companyName = companyRow.rows[0]?.company_name || '';
    const signingLink = `${getCanonicalAppUrl()}/sign-contract-customer?token=${signingToken}`;
    const subject = `Contract Ready: ${current.template_name || current.contract_name || 'Review & Sign'}`;

    let emailSent = false;
    let emailError = null;
    // Keep the provider's message id: it is the ONLY key the delivery/bounce
    // webhook can match this communication on. Discarding it leaves the record
    // frozen at "accepted" forever, no matter what actually happened to it.
    let deliveryOutcome = null;
    try {
      if (deliveryMethod === 'email') {
        const sendResult = await emailTransport.sendPlatformEmail({
          from: signingFromAddr(companyName), to: [recipient], subject,
          correlationId: reservation.correlationId,
          context: { source: 'contract_signing', companyId: current.company_id, actorEmail: context.email },
          html: buildSigningEmailHtml({
            customerName: current.customer_name, repName: current.rep_name,
            templateName: current.template_name, contractName: current.contract_name,
            signingLink, expiresDate: expiresAt.toLocaleDateString(), companyName,
          }),
        });
        deliveryOutcome = {
          provider: sendResult?.provider || null,
          provider_message_id: sendResult?.id || null,
        };
      } else {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        const from = process.env.TWILIO_PHONE_NUMBER;
        if (!sid || !token || !from) throw new Error('Twilio not configured');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SMS_REQUEST_TIMEOUT_MS);
        timeout.unref?.();
        let sms;
        try {
          sms = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
            method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
            body: new URLSearchParams({ From: from, To: recipient, Body: `Hi ${current.customer_name || 'there'}, review and sign your contract: ${signingLink}` }).toString(),
          });
          if (!sms.ok) {
            throw new Error((await sms.json().catch(() => ({}))).message || 'Twilio API error');
          }
        } catch (error) {
          if (error?.name === 'AbortError') throw new Error('Twilio request timed out');
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      }
      emailSent = true;
    } catch (error) {
      emailError = error.message || 'Email send error';
    }
    if (!emailSent) {
      await restoreSessionAfterFailedDelivery(reservation.client, reservation.priorSession, signingToken)
        .catch((error) => console.error('[Signing] Could not restore failed delivery session:', error.message));
    }
    await finishDelivery(reservation.client, reservation.deliveryId, emailSent ? 'accepted' : 'failed', emailError, deliveryOutcome)
      .catch(async (error) => {
        // Already accepted by the provider, so this cannot become a failed
        // send — but the record just lost the only key its delivery callback
        // could match on. Queue the association for repair.
        console.warn('[Signing] Could not finalize delivery attempt:', error.message);
        if (deliveryOutcome?.provider_message_id) {
          await require('./emailDeliveryWebhook.cjs').associateProviderMessage({
            communicationId: reservation.deliveryId,
            provider: deliveryOutcome.provider,
            messageId: deliveryOutcome.provider_message_id,
          }, { pool: reservation.client }).catch(() => {});
        }
      });

    json(res, {
      success: emailSent,
      signing_link: signingLink,
      local_session_id: current.id,
      // The handle for the delivery record itself, so the caller can follow the
      // real outcome instead of stopping at "accepted".
      communication_id: reservation.deliveryId,
      expires_at: expiresAt.toISOString(),
      delivery_method: deliveryMethod,
      email_sent: deliveryMethod === 'email' && emailSent,
      sms_sent: deliveryMethod === 'sms' && emailSent,
      message: emailSent ? `${deliveryMethod === 'email' ? 'Email' : 'SMS'} sent to ${recipient}` : `${deliveryMethod === 'email' ? 'Email' : 'SMS'} not sent: ${emailError}`,
      ...(emailError ? { error: emailError, email_warning: emailError } : {}),
    }, emailSent ? 200 : 502);
  } catch (error) {
    console.error('[Signing] send-signing-link error:', error.message);
    json(res, { success: false, error: error.message || 'Could not send signing link' }, error.statusCode || 500);
  } finally {
    await reservation?.release?.();
  }
  return true;
}

module.exports = { handleSigningLinkDelivery, MAX_BODY_BYTES, MAX_SENDS_PER_HOUR };