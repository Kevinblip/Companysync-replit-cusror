const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const prodDb = require('./db/prod-db.cjs');
const tenantGuard = require('./lib/tenantGuard.cjs');
const prodAuth = require('./db/prod-auth.cjs');
const prodIntegrations = require('./db/prod-integrations.cjs');
const localAuth = require('./db/local-auth.cjs');
const nodemailer = require('nodemailer');
const { fetchWithRetry } = require('./lib/fetchWithRetry.cjs');
const emailDeliveryWebhook = require('./lib/emailDeliveryWebhook.cjs');
const {
  getNotificationQuietHours,
  getStaffNotificationQuietHours,
} = require('./lib/notificationQuietHours.cjs');
// The assistant is always "Alex"; stale AssistantSettings rows still say
// "sarah"/"lexi" and must not win. Logic is shared with vite-twilio-ws-plugin.js.
const { ASSISTANT_NAME, resolveAssistantName } = require('./lib/assistantName.cjs');
const {
  deriveSpokenBrandName,
  applySpokenCompanyName,
  rewriteVoiceText,
} = require('./lib/spokenBrandName.cjs');
const { groundingRulesBlock: lexiGroundingRules, annotateToolResult: groundToolResult } = require('./lib/lexiGrounding.cjs');
const { isVoiceGroundingSensitive, auditVoiceTurn } = require('./lib/lexiVoiceGrounding.cjs');
const { getVerifiedLexiChannels, canonicalPhone } = require('./lib/insuranceClaimWelcome.cjs');
const {
  getCustomerPublicProgress,
  buildVoiceProgressScript,
  isExactVoiceProgressTranscript,
} = require('./lib/customerProjectProgress.cjs');
const { toolDedupeKey, createToolCallCache } = require('./lib/toolDedupe.cjs');
const { GEMINI_38_MODEL, SUPPLEMENT_TOOL, calculateRoofSupplement, isGemini38Line, applyTwilioLineProfile, invokeRoofSupplement } = require('./lib/twilioLineProfile.cjs');
const { canonicalizeGenericEntityType, normalizeGenericEntityData } = require('./lib/expenseNormalize.cjs');
const emailHealth = require('./lib/emailProviderHealth.cjs');
const {
  loadManagedStripeWebhookSecret,
  persistManagedStripeWebhookSecret,
} = require('./lib/stripeWebhookSecret.cjs');
const { resolveStripeApiKey, resolveStripeWebhookSecret, mapAppSubscriptionStatus } = require('./lib/stripeEnv.cjs');
const { geminiLiveModel, isAllowedGeminiLiveEngine } = require('./lib/geminiLiveModel.cjs');
const { authenticateLexiWs } = require('./lib/lexiWsAuth.cjs');
const { confirmScheduleAndCreate } = require('./lib/lexiScheduleConfirmation.cjs');
const { assertBuildDate, buildDayRange } = require('./lib/buildScheduleTime.cjs');
const { allocatePaymentNumber } = require('./lib/paymentNumbers.cjs');
const { calendarBuildRouteGuard, manageEntityBuildRouteGuard } = require('./lib/lexiBuildIntent.cjs');
const { buildScheduleConfirmationGuard, isBuildSchedulingMutation } = require('./lib/lexiBuildConfirmation.cjs');
const {
  authorizeOutboundCall,
  consumeOutboundCallRateLimit,
  normalizeOutboundDestination,
} = require('./lib/outboundCallGuard.cjs');
// Staff phone mode: caller-ID candidate match + spoken-PIN verification
// (shared with vite-twilio-ws-plugin.js — logic lives ONCE in lib/staffVoiceAuth.cjs).
const {
  findStaffByCallerPhone,
  verifyPinAttempt,
  redactPinDigits,
  buildStaffPhonePrompt,
  VERIFY_STAFF_PIN_TOOL,
  MAX_ATTEMPTS_PER_CALL: STAFF_PIN_MAX_ATTEMPTS_PER_CALL,
} = require('./lib/staffVoiceAuth.cjs');
const chatBot = require('./lib/chatBot.cjs');
const lexiTeamChat = require('./lib/lexiTeamChat.cjs');
const { handleWorkOrderRoute } = require('./lib/workOrders.cjs');
const qbSync = require('./lib/quickbooksSync.cjs');
const {
  analyzePropertyPhotos,
  listPropertyMeasurements,
  resolveMeasurementCompany,
  PropertyMeasurementError,
} = require('./lib/propertyMeasurements.cjs');

async function sendPaymentAlertSms({ to, message, companyId, context = 'PaymentAlert' }) {
  if (!to) return { success: false, skipped: true, reason: 'missing_recipient_phone' };
  const handlers = await prodIntegrations.getFunctionHandlers();
  if (typeof handlers.sendSMS !== 'function') throw new Error('SMS delivery is unavailable.');
  const result = await handlers.sendSMS({ to, message, companyId });
  if (result?.success !== true) {
    const reason = result?.reason || result?.error || 'SMS sender did not confirm delivery';
    throw new Error(reason);
  }
  console.log(`[${context}] SMS accepted for delivery`);
  return result;
}

// ============================================================
// AI RECEPTIONIST ENHANCEMENTS — shared dev/prod logic.
// deriveSpokenBrandName lives once in lib/spokenBrandName.cjs.
// The transcript helpers below stay verbatim in vite-twilio-ws-plugin.js.
// Keep those two in LOCKSTEP across both files.
// ============================================================

// Merge consecutive same-role conversation fragments into clean turns,
// then render a readable transcript string. Gemini's live transcription
// emits many tiny same-role chunks; this collapses them.
function buildCleanTranscript(conversationLog) {
  const merged = [];
  for (const e of (conversationLog || [])) {
    if (!e) continue;
    const text = String(e.text == null ? '' : e.text).trim();
    if (!text) continue;
    const role = e.role || 'unknown';
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.text += ' ' + text;
    else merged.push({ role, text });
  }
  return merged.map((e) => `${e.role}: ${e.text}`).join('\n');
}

// Best-effort post-call synopsis via the Gemini text model. NEVER throws
// (returns null on any failure) and has a hard timeout so it can never
// block the call-log save.
async function generateCallSynopsis(transcript, apiKey) {
  if (!apiKey || !transcript || transcript.trim().length < 25) return null;
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are summarizing a phone call for a roofing company's CRM. Today is ${today}.
From the transcript below, return ONLY a JSON object with these keys:
- caller_name (string or null)
- phone (string or null)
- address (string or null)
- service_needed (string or null): what the caller wants (e.g. "roof leak repair", "free inspection", "quote")
- appointment_datetime (string or null): the date/time if an appointment or inspection was scheduled, otherwise null
- summary (string): a 1-3 sentence plain-English recap of the call
- next_action (string or null): the follow-up the team should take

TRANSCRIPT:
${transcript.slice(0, 8000)}`;
  try {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: 'application/json' },
        }),
      },
      { timeoutMs: 12000 }
    );
    if (!res.ok) { console.warn('[Synopsis] Gemini error:', res.status); return null; }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return null;
    let parsed = null;
    try { parsed = JSON.parse(text); }
    catch (_) { const m = text.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch (__) {} } }
    if (!parsed || typeof parsed !== 'object') return null;
    const summary = (parsed.summary || '').toString().trim();
    if (!summary) return null;
    return { call_summary: summary, call_synopsis: parsed };
  } catch (e) {
    console.warn('[Synopsis] generateCallSynopsis failed:', e.message);
    return null;
  }
}

async function sendEmail({ to, subject, html, message, from, cc, companyId, context }) {
  let fromAddr = from;
  if (!fromAddr && companyId) {
    try {
      const pool = prodDb.getPool();
      const coRow = await pool.query('SELECT COALESCE(company_name, name) AS company_name FROM companies WHERE id = $1 LIMIT 1', [companyId]);
      const coName = coRow.rows[0]?.company_name;
      if (coName) {
        const emailDomain = (process.env.EMAIL_FROM || '').match(/<([^>]+)>/)?.[1] || 'noreply@companysync.io';
        fromAddr = `${coName} <${emailDomain}>`;
      }
    } catch (_) {}
  }
  if (!fromAddr) fromAddr = process.env.EMAIL_FROM || 'CompanySync <noreply@companysync.io>';
  const toArr = Array.isArray(to) ? to : [to];
  if (companyId && toArr.length === 1) {
    try {
      const quietHours = await getStaffNotificationQuietHours(
        prodDb.getPool(),
        companyId,
        { email: toArr[0] },
      );
      if (quietHours.active) {
        console.log(`[sendEmail] Deferred internal staff email until ${quietHours.deferredUntil}: ${toArr[0]}`);
        return {
          success: false,
          skipped: true,
          reason: 'company_notification_quiet_hours',
          deferred_until: quietHours.deferredUntil,
        };
      }
    } catch (error) {
      console.warn('[sendEmail] Could not evaluate staff quiet hours:', error.message);
    }
  }
  const ccArr = cc ? (Array.isArray(cc) ? cc : cc.split(',').map(e => e.trim()).filter(Boolean)) : [];
  const htmlBody = html || (message ? `<div style="font-family:sans-serif;white-space:pre-wrap">${message}</div>` : '');
  // Always delegate to the shared transport (Postmark → SES → Resend last-resort)
  return require('./lib/emailTransport.cjs').sendPlatformEmail({
    to: toArr, from: fromAddr, subject: subject || 'No Subject', html: htmlBody,
    cc: ccArr.length ? ccArr : undefined,
    // Without this the send is charged to the default platform bucket with no
    // attribution, so the per-company limit does not apply to any caller of this
    // wrapper. Callers that know the actor should pass a fuller context; the
    // companyId they already supply is the minimum tenant attribution.
    context: {
      ...(context || {}),
      companyId: context?.companyId || companyId || null,
      source: context?.source || 'prod-server.sendEmail',
    },
  });
}

// A Stripe webhook is the primary payment-recording path. This is a narrowly
// scoped recovery path for a completed card Checkout Session whose webhook did
// not finish recording the payment before the customer reaches the success
// page. The session is retrieved directly from Stripe and checked against the
// invoice before this helper is called. Payment rows and notifications are
// keyed by the Stripe PaymentIntent, so repeated success-page polls are safe.
async function reconcileCompletedInvoiceCheckout(pool, session) {
  const { createHash, randomUUID } = require('crypto');
  if (session?.status !== 'complete' || session?.payment_status !== 'paid') {
    return { reconciled: false, reason: 'session_not_paid' };
  }
  const invoiceId = session.metadata?.invoice_id;
  const paymentRef = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || session.id;
  if (!invoiceId || !paymentRef) return { reconciled: false, reason: 'missing_payment_reference' };

  const invoiceResult = await pool.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
  const invoice = invoiceResult.rows[0];
  if (!invoice) return { reconciled: false, reason: 'invoice_not_found' };

  const amount = (session.amount_total || 0) / 100;
  const client = await pool.connect();
  let paymentRecorded = false;
  let amountPaid = 0;
  let invoiceStatus = 'partially_paid';
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [paymentRef]);
    await client.query('SELECT id FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
    const paymentNumber = await allocatePaymentNumber(client, invoice.company_id);
    const inserted = await client.query(
      `INSERT INTO payments (id, company_id, invoice_id, invoice_number, payment_number, customer_name, amount, payment_method, payment_date, reference_number, notes, status, created_at, updated_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, 'stripe', NOW(), $8, 'Paid via Stripe Checkout (success-page recovery)', 'completed', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number = $8)`,
      [randomUUID(), invoice.company_id, invoiceId, invoice.invoice_number, paymentNumber, invoice.customer_name, amount, paymentRef]
    );
    paymentRecorded = inserted.rowCount > 0;
    const sumResult = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM payments
       WHERE invoice_id = $1
         AND status NOT IN ('failed', 'refunded', 'ach_pending', 'void', 'cancelled')`,
      [invoiceId]
    );
    amountPaid = parseFloat(sumResult.rows[0]?.total || 0);
    invoiceStatus = amountPaid >= parseFloat(invoice.total_amount || 0) ? 'paid' : 'partially_paid';
    await client.query(
      `UPDATE invoices SET amount_paid = $1, status = $2, updated_at = NOW() WHERE id = $3`,
      [amountPaid, invoiceStatus, invoiceId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const paymentExists = paymentRecorded || (await pool.query(
    `SELECT 1 FROM payments WHERE invoice_id = $1 AND reference_number = $2 AND status = 'completed' LIMIT 1`,
    [invoiceId, paymentRef]
  )).rowCount > 0;
  if (!paymentExists) return { reconciled: false, reason: 'payment_not_recorded' };

  const quietHours = await getNotificationQuietHours(pool, invoice.company_id);
  const staffResult = await pool.query(
    `SELECT COALESCE(NULLIF(user_email, ''), email) AS user_email,
            COALESCE(NULLIF(cell_phone, ''), NULLIF(phone, '')) AS notification_phone
     FROM staff_profiles
     WHERE company_id = $1
       AND COALESCE(is_active, true) = true
       AND is_administrator = true
       AND COALESCE(NULLIF(user_email, ''), email) IS NOT NULL`,
    [invoice.company_id]
  );
  const remaining = Math.max(0, parseFloat(invoice.total_amount || 0) - amountPaid);
  const title = `💰 Invoice Payment Received – ${invoice.invoice_number || ''}`;
  const message = `${invoice.customer_name || 'Customer'} paid $${amount.toFixed(2)} for invoice ${invoice.invoice_number || ''}`;
  const emailBody = `A payment has been recorded.\n\nCustomer: ${invoice.customer_name || 'Unknown'}\nInvoice: ${invoice.invoice_number || ''}\nAmount Paid: $${amount.toFixed(2)}\nStatus: ${invoiceStatus === 'paid' ? 'Fully Paid' : `Partially Paid (remaining: $${remaining.toFixed(2)})`}`;

  for (const admin of staffResult.rows) {
    const notificationId = `stripe_payment_received_${createHash('sha256').update(`${paymentRef}:${admin.user_email}`).digest('hex').slice(0, 32)}`;
    const notification = await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'Notification', $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [notificationId, invoice.company_id, JSON.stringify({
        id: notificationId,
        company_id: invoice.company_id,
        user_email: admin.user_email,
        title,
        message,
        type: 'payment_received',
        link_url: '/payments',
        is_read: false,
        ...(quietHours.active ? {
          deferred_until: quietHours.deferredUntil,
          deferred_reason: 'company_notification_quiet_hours',
        } : {}),
      })]
    );
    if (notification.rowCount > 0 && !quietHours.active) {
      await sendEmail({ to: admin.user_email, subject: title, message: emailBody, companyId: invoice.company_id })
        .catch(error => console.warn('[StripeRecovery] Admin email error:', error.message));
      if (admin.notification_phone) {
        await sendPaymentAlertSms({
          to: admin.notification_phone,
          message: `${title}\n${message}`,
          companyId: invoice.company_id,
          context: 'StripeRecovery',
        }).catch(error => console.warn('[StripeRecovery] Admin SMS error:', error.message));
      }
    }
  }

  console.warn(`[StripeRecovery] Reconciled Checkout Session ${session.id} for invoice ${invoiceId}${paymentRecorded ? '' : ' (payment already existed)'}`);
  return { reconciled: true, paymentRecorded, amountPaid, invoiceStatus };
}

let stripeClient = null;
// Resolve the contract wording for a signing session.
// Prefers the frozen snapshot (signing_sessions.html_content); for legacy rows without a
// snapshot it falls back to the ContractTemplate entity, then the ContractEditorContent
// silo (company-scoped), and backfills the snapshot so the contract freezes from then on.
async function resolveSessionHtml(pool, s, sessionData) {
  if (s && s.html_content) return s.html_content;
  // Only accept JSON-block content (the format ContractHtmlRenderer expects). Non-JSON
  // (e.g. raw HTML) is rejected so the renderer never silently falls back to the built-in
  // default legal text of the wrong company.
  const isJsonBlocks = (v) => {
    if (typeof v !== 'string' || v.trim()[0] !== '{') return false;
    try { const o = JSON.parse(v); return !!o && typeof o === 'object'; } catch (_) { return false; }
  };
  let snap = null;
  if (sessionData && isJsonBlocks(sessionData.html_content)) snap = sessionData.html_content;
  if (!snap && s && s.template_id) {
    try {
      const tr = await pool.query(
        `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = 'ContractTemplate' AND company_id = $2 LIMIT 1`,
        [s.template_id, s.company_id]
      );
      if (tr.rows.length > 0) {
        const d = typeof tr.rows[0].data === 'string' ? JSON.parse(tr.rows[0].data) : tr.rows[0].data;
        let hc = d && d.html_content;
        if (hc && typeof hc === 'object') hc = JSON.stringify(hc);
        if (isJsonBlocks(hc)) snap = hc;
      }
    } catch (_) {}
  }
  // Legacy contingency wording lives in the company-scoped ContractEditorContent silo.
  // Apply it ONLY to contingency-style templates that are NOT uploaded PDFs, so an uploaded
  // PDF template is never overwritten by another document's text.
  if (!snap && s && !s.original_file_url) {
    const nm = (s.template_name || '').toLowerCase();
    if (nm.includes('contingency')) {
      try {
        const ce = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'ContractEditorContent' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
          [s.company_id]
        );
        if (ce.rows.length > 0) {
          const d = typeof ce.rows[0].data === 'string' ? JSON.parse(ce.rows[0].data) : ce.rows[0].data;
          let content = d && d.content;
          if (content && typeof content === 'object') content = JSON.stringify(content);
          if (isJsonBlocks(content)) snap = content;
        }
      } catch (_) {}
    }
  }
  if (snap && s && s.id != null) {
    await pool.query(
      `UPDATE signing_sessions SET html_content=$1 WHERE id=$2 AND html_content IS NULL`,
      [snap, s.id]
    ).catch(() => {});
    s.html_content = snap;
  }
  return snap || null;
}

async function getStripeClientProd() {
  if (stripeClient) return stripeClient;
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.WEB_REPL_RENEWAL ? 'depl ' + process.env.WEB_REPL_RENEWAL : (process.env.REPL_IDENTITY ? 'repl ' + process.env.REPL_IDENTITY : null);
    if (!xReplitToken || !hostname) return null;
    const url = new URL(`https://${hostname}/api/v2/connection`);
    url.searchParams.set('include_secrets', 'true');
    url.searchParams.set('connector_names', 'stripe');
    url.searchParams.set('environment', process.env.REPLIT_DEPLOYMENT === '1' ? 'production' : 'development');
    const resp = await fetch(url.toString(), { headers: { 'Accept': 'application/json', 'X-Replit-Token': xReplitToken } });
    const data = await resp.json();
    const cs = data.items?.[0];
    if (!cs?.settings?.secret) return null;
    const Stripe = require('stripe');
    stripeClient = new Stripe(cs.settings.secret);
    return stripeClient;
  } catch (e) { console.error('[Stripe] Init error:', e.message); return null; }
}

// Register the live-mode Stripe webhook endpoint on every production startup.
// Uses the Stripe API directly. The signing secret is persisted in the
// stripe-replit-sync managed-webhook table because Stripe never returns it from
// webhookEndpoints.list(). This also lets a later restart hydrate process.env
// without requiring a manual dashboard step.
async function registerStripeWebhook() {
  try {
    // Resolve the actual Stripe API key. Historically STRIPE_SECRET_KEY was
    // incorrectly set to a whsec_* signing secret; STRIPE_API_KEY holds the
    // real sk_* key in that case, so we check both and pick the sk_ one.
    const stripeSecretKey = resolveStripeApiKey();
    if (!stripeSecretKey) {
      console.warn('[Stripe] Webhook registration skipped: no sk_ API key found (set STRIPE_API_KEY)');
      return;
    }

    const domains = process.env.REPLIT_DOMAINS;
    const webhookUrl = domains
      ? `https://${domains.split(',')[0]}/api/stripe/webhook`
      : 'https://getcompanysync.com/api/stripe/webhook';

    const Stripe = require('stripe');
    const stripe = new Stripe(stripeSecretKey);

    // Check if our endpoint is already registered in Stripe
    const list = await stripe.webhookEndpoints.list({ limit: 100 });
    const existing = list.data.find(w => w.url === webhookUrl && w.status === 'enabled');

    if (existing) {
      // Keep an endpoint created before ACH support in sync. Stripe retries
      // asynchronous bank-account payments through this event, so merely
      // having a signing secret is not enough.
      const requiredEvents = [
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.payment_failed',
        'invoice.payment_succeeded',
      ];
      const enabledEvents = Array.isArray(existing.enabled_events) ? existing.enabled_events : [];
      const missingEvents = requiredEvents.filter(eventName => !enabledEvents.includes(eventName));
      if (missingEvents.length > 0) {
        await stripe.webhookEndpoints.update(existing.id, {
          enabled_events: [...new Set([...enabledEvents, ...missingEvents])],
        });
        console.log(`[Stripe] Webhook endpoint updated with: ${missingEvents.join(', ')}`);
      }

      // The managed row is tied to this exact endpoint and is more reliable
      // than a deployment secret that may belong to a deleted/rotated endpoint.
      const managedSecret = await loadManagedStripeWebhookSecret(prodDb.getPool(), {
        endpointId: existing.id,
        url: webhookUrl,
      });
      if (managedSecret) {
        process.env.STRIPE_WEBHOOK_SECRET = managedSecret;
        console.log('[Stripe] Webhook secret loaded from managed webhook store.');
      }

      if (process.env.STRIPE_WEBHOOK_SECRET) {
        console.log('[Stripe] Webhook endpoint verified ✓');
      } else {
        console.warn('[Stripe] ⚠️  Webhook endpoint exists but no signing secret is available.');
        console.warn('[Stripe] ⚠️  Invoice payments will NOT auto-record until the managed webhook store is populated.');
      }
      return;
    }

    // Create a fresh endpoint — Stripe returns the signing secret only at creation
    const newEndpoint = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: [
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.payment_failed',
        'invoice.payment_succeeded',
      ],
    });

    if (newEndpoint.secret) {
      process.env.STRIPE_WEBHOOK_SECRET = newEndpoint.secret;
      let persisted = false;
      try {
        const account = await stripe.accounts.retrieve();
        persisted = await persistManagedStripeWebhookSecret(
          prodDb.getPool(),
          newEndpoint,
          account
        );
      } catch (persistErr) {
        console.warn('[Stripe] Could not resolve Stripe account for webhook secret persistence:', persistErr.message);
      }
      console.log(`[Stripe] ✅ Webhook endpoint created: ${webhookUrl}`);
      console.log(
        persisted
          ? '[Stripe] ✅ Signing secret loaded and persisted in the managed webhook store.'
          : '[Stripe] ✅ Signing secret loaded for this session; managed-store persistence was unavailable.'
      );
    }
  } catch (err) {
    console.warn('[Stripe] Webhook registration warning:', err.message);
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.warn('[Stripe] ⚠️  STRIPE_WEBHOOK_SECRET not set — invoice payments will NOT auto-record.');
      console.warn('[Stripe] → Go to Stripe dashboard → Developers → Webhooks and set the signing secret.');
    }
  }
}

async function billAIUsage(companyId, units = 1) {
  if (!companyId || companyId === 'companysync_master_001') return;
  try {
    const stripe = await getStripeClientProd();
    if (!stripe) return;
    const pool = prodDb.getPool();
    const { rows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'CompanySubscription' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
      [companyId]
    );
    const sub = rows[0]?.data;
    if (!sub?.stripe_subscription_id || !sub?.ai_usage_item_id) return;
    if (sub.plan === 'trial') return;
    await stripe.subscriptionItems.createUsageRecord(sub.ai_usage_item_id, { quantity: units, timestamp: Math.floor(Date.now() / 1000), action: 'increment' });
  } catch (e) { console.error('[Billing] AI usage billing failed (non-blocking):', e.message); }
}

const USAGE_UNIT_COSTS_PROD = { lexi: 0.05, sarah: 0.10, sms_ai: 0.02, ai_estimator: 0.08, marcus: 0.06, crew_cam: 0.12 };
async function logUsageEvent(companyId, feature, units = 1) {
  if (!companyId || companyId === 'companysync_master_001') return;
  try {
    const pool = prodDb.getPool();
    const unitCost = USAGE_UNIT_COSTS_PROD[feature] || 0.05;
    const totalCost = unitCost * units;
    const usageMonth = new Date().toISOString().slice(0, 7);
    const id = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const data = { company_id: companyId, feature, units, unit_cost: unitCost, total_cost: totalCost, usage_month: usageMonth, logged_at: new Date().toISOString() };
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
      [id, companyId, JSON.stringify(data)]
    );
  } catch (e) { console.error('[Usage] Failed to log usage event:', e.message); }
}

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (kept alive):', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection (kept alive):', reason?.message || reason);
});

const PORT = parseInt(process.env.PORT || '5000', 10);
const DIST_DIR = path.join(__dirname, 'dist');
const SETTINGS_FILE = path.resolve('.sarah-voice-settings.json');

// SSE clients for live-call push updates: companyId -> Set of res objects
const liveCallSseClients = new Map();
const LIVE_CALL_SSE_MAX_PER_COMPANY = 25;
const LIVE_CALL_SSE_MAX_GLOBAL = 500;

function liveCallSseTotalCount() {
  let total = 0;
  for (const set of liveCallSseClients.values()) total += set.size;
  return total;
}

function broadcastLiveCallUpdate(companyId, payload) {
  const clients = liveCallSseClients.get(companyId);
  if (!clients || clients.size === 0) return;
  const data = `event: live-call-update\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch (_) {}
  }
}

// Cache index.html in memory at startup for instant health-check responses
let INDEX_HTML_CACHE = null;
try {
  INDEX_HTML_CACHE = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
  console.log('[Server] index.html cached in memory (' + INDEX_HTML_CACHE.length + ' bytes)');
} catch (e) {
  console.warn('[Server] Could not cache index.html:', e.message);
}

const BASE44_API_URL = process.env.BASE44_SARAH_API_URL || '';
const BRIDGE_SECRET = process.env.SARAH_BRIDGE_SECRET || '';
const DEFAULT_COMPANY_ID = '695944e3c1fb00b7ab716c6f';

const LEXI_BRIDGE_API_URL = process.env.BASE44_LEXI_BRIDGE_API_URL || '';
const LEXI_BRIDGE_SECRET = process.env.LEXI_NATIVE_BRIDGE_SECRET || '';

// ============================================================
// IN-MEMORY SUBSCRIBER CACHE
// Maps Twilio phone numbers -> subscriber routing config
// Refreshed when subscribers save settings, or periodically
// ============================================================
const subscriberCache = new Map(); // key: normalized phone number, value: { companyId, companyName, assistantName, routingMode, cellPhone, repName, repEmail, twilioSid, twilioToken, twilioPhone }
let cacheLastRefreshed = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function normalizePhone(phone) {
  if (!phone) return '';
  let clean = phone.replace(/[^\d+]/g, '');
  if (clean.length === 10) clean = '+1' + clean;
  else if (clean.length === 11 && clean.startsWith('1')) clean = '+' + clean;
  else if (!clean.startsWith('+')) clean = '+' + clean;
  return clean;
}

function getCachedSubscriber(phoneNumber) {
  const normalized = normalizePhone(phoneNumber);
  const entry = subscriberCache.get(normalized);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    subscriberCache.delete(normalized);
    return null;
  }
  return entry;
}

function setCachedSubscriber(phoneNumber, data) {
  const normalized = normalizePhone(phoneNumber);
  if (normalized) {
    subscriberCache.set(normalized, { ...data, cachedAt: Date.now() });
    console.log(`[Cache] Set: ${normalized} -> company=${data.companyId}, rep=${data.repName || 'none'}, routing=${data.routingMode || 'sarah_answers'}`);
  }
}

// Shared CRM phone lookup — resolves a caller from generic_entities CRM leads,
// customers, or leads (in that priority order). Extracted to lib/ so it can
// be unit tested in isolation. See lib/lookupCallerByCrmPhone.cjs.
const { lookupCallerByCrmPhone, invalidateCallerCache, invalidateCallerCacheForCompany } = require('./lib/lookupCallerByCrmPhone.cjs');
const smsAssistant = require('./lib/smsAssistant.cjs');
const { handleWhatsAppPhotoUpload, resolveInstallerPendingChoice } = require('./lib/whatsappPhotoHandler.cjs');

function removeCachedSubscriber(phoneNumber) {
  const normalized = normalizePhone(phoneNumber);
  subscriberCache.delete(normalized);
}

// Nickname → common full-name aliases (bidirectional) — shared with lib/lookupCallerByCrmPhone.cjs
const { NICKNAME_MAP } = require('./lib/nicknameMap.cjs');
function nameMatchesSearch(storedName, searchTerm) {
  const stored = (storedName || '').toLowerCase();
  const search = (searchTerm || '').toLowerCase().trim();
  if (!search || !stored) return false;
  if (stored.includes(search)) return true;
  const storedWords = stored.split(/\s+/);
  const searchAliases = NICKNAME_MAP[search] || [];
  for (const word of storedWords) {
    if (word === search) return true;
    if (searchAliases.includes(word)) return true;
    if ((NICKNAME_MAP[word] || []).includes(search)) return true;
  }
  return false;
}

// Shared after-hours window check. Returns true only when a work-hours schedule
// is configured AND the current time falls outside it. Used at call start AND at
// mid-call transfer so the off-hours behavior is identical in both places.
//
// timezone: IANA timezone string (e.g. 'America/Chicago') for the company or staff
//   member — defaults to 'America/New_York'. Pass the company's configured timezone
//   so the check reflects the business's local clock, not the server clock.
//
// Overnight windows (start > end, e.g. 22:00–06:00) are handled correctly:
//   "inside hours" wraps midnight, so "outside" = between end and start of day.
function isOutsideWorkHours(scheduleData, now = new Date(), timezone = 'America/New_York') {
  if (!scheduleData || !scheduleData.after_hours_enabled || !scheduleData.after_hours_start || !scheduleData.after_hours_end) {
    return false;
  }
  // Convert `now` to the company's local wall-clock hour/minute.
  let currentMins;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    const parts = fmt.formatToParts(now);
    const h = parseInt((parts.find(p => p.type === 'hour') || {}).value || '0', 10);
    const m = parseInt((parts.find(p => p.type === 'minute') || {}).value || '0', 10);
    currentMins = h * 60 + (isNaN(m) ? 0 : m);
  } catch (_) {
    // Fallback to server local time if timezone is invalid
    currentMins = now.getHours() * 60 + now.getMinutes();
  }
  const [sH, sM] = String(scheduleData.after_hours_start).split(':').map(Number);
  const [eH, eM] = String(scheduleData.after_hours_end).split(':').map(Number);
  const startMins = sH * 60 + (sM || 0);
  const endMins = eH * 60 + (eM || 0);
  if (startMins === endMins) return false; // degenerate: treat as always available
  if (startMins < endMins) {
    // Normal daytime window (e.g. 08:00–18:00): outside = before start OR at/after end
    return currentMins < startMins || currentMins >= endMins;
  } else {
    // Overnight window (e.g. 22:00–06:00): inside = at/after start OR before end
    // Outside = between end (inclusive) and start (exclusive)
    return currentMins >= endMins && currentMins < startMins;
  }
}

function generateTwilioToken(accountSid, apiKeySid, apiKeySecret, identity, twimlAppSid, ttl = 3600) {
  const twilio = require('twilio');
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: twimlAppSid,
    incomingAllow: true,
  });
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity, ttl });
  token.addGrant(voiceGrant);
  return token.toJwt();
}

async function refreshCacheFromAPI() {
  if (!BASE44_API_URL || !BRIDGE_SECRET) return;
  try {
    const result = await callBase44API('getAllSubscriberRouting', null);
    if (result?.subscribers && Array.isArray(result.subscribers)) {
      for (const sub of result.subscribers) {
        if (sub.phone_number) {
          setCachedSubscriber(sub.phone_number, {
            companyId: sub.company_id,
            companyName: sub.company_name || '',
            assistantName: sub.assistant_name || 'Alex',
            routingMode: sub.routing_mode || 'sarah_answers',
            cellPhone: sub.cell_phone || '',
            repName: sub.rep_name || '',
            repEmail: sub.rep_email || '',
            twilioSid: sub.twilio_sid || '',
            twilioToken: sub.twilio_token || '',
            twilioPhone: sub.twilio_phone || '',
            availabilityStatus: sub.availability_status || 'available',
            data: sub.data || {},
          });
        }
      }
      cacheLastRefreshed = Date.now();
      console.log(`[Cache] Refreshed: ${result.subscribers.length} subscriber numbers cached`);
    }
  } catch (err) {
    console.warn('[Cache] Full refresh failed:', err.message);
  }
}

// Refresh cache periodically
setInterval(async () => {
  if (Date.now() - cacheLastRefreshed > CACHE_TTL_MS) {
    await refreshCacheFromAPI();
  }
}, 60000);

// Process workflow queue every 60 seconds
let workflowQueueRunning = false;
setInterval(async () => {
  if (workflowQueueRunning) {
    console.warn('[Cron:processWorkflowQueue] Previous run still active; skipping overlap');
    return;
  }
  workflowQueueRunning = true;
  try {
    const prodDb = require('./db/prod-db.cjs');
    const pool = prodDb.getPool();
    const prodIntegrations = require('./db/prod-integrations.cjs');
    const now = new Date();

    const activeResult = await pool.query(
      `SELECT * FROM generic_entities WHERE entity_type = 'WorkflowExecution'
       AND (data->>'status' = 'active' OR data->>'status' = 'waiting_for_trigger')
       LIMIT 100`
    );

    const executions = activeResult.rows;
    if (executions.length === 0) return;
    console.log(`[Cron:processWorkflowQueue] Found ${executions.length} active executions`);
    let processed = 0;

    for (const execRow of executions) {
      try {
        const exec = typeof execRow.data === 'string' ? JSON.parse(execRow.data) : (execRow.data || {});
        if (exec.status === 'active' && exec.next_run_at && new Date(exec.next_run_at) > now) continue;

        const workflowResult = await pool.query(
          `SELECT * FROM generic_entities WHERE entity_type = 'Workflow' AND id = $1`,
          [exec.workflow_id]
        );
        if (workflowResult.rows.length === 0) {
          await pool.query(`UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{status}', '"error"'), updated_date = NOW() WHERE id = $1`, [execRow.id]);
          continue;
        }

        const workflow = typeof workflowResult.rows[0].data === 'string' ? JSON.parse(workflowResult.rows[0].data) : (workflowResult.rows[0].data || {});
        const steps = workflow.actions || workflow.steps || [];
        const currentStep = exec.current_step || 0;

        if (currentStep >= steps.length) {
          await pool.query(`UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{status}', '"completed"'), updated_date = NOW() WHERE id = $1`, [execRow.id]);
          processed++;
          continue;
        }

        const step = steps[currentStep];
        const actionType = step.action_type || step.action || step.type;

        if (actionType === 'delay' || actionType === 'wait') {
          const delayMs = (step.config?.minutes || step.minutes || step.delay_minutes || 5) * 60000;
          const nextRunAt = new Date(now.getTime() + delayMs);
          await pool.query(`UPDATE generic_entities SET data = jsonb_set(jsonb_set(data::jsonb, '{current_step}', $2::jsonb), '{next_run_at}', $3::jsonb), updated_date = NOW() WHERE id = $1`,
            [execRow.id, JSON.stringify(currentStep + 1), JSON.stringify(nextRunAt.toISOString())]);
          processed++;
          continue;
        }

        const entityData = exec.entity_data || {};
        const actionResult = await prodIntegrations.executeProdWorkflowAction(pool, step, entityData, exec.company_id || execRow.company_id, exec.entity_type, exec.entity_id);
        if (actionResult && actionResult.success === false) {
          throw new Error(actionResult.reason || `${actionType} did not complete`);
        }

        const nextStep = currentStep + 1;
        const newStatus = nextStep >= steps.length ? 'completed' : 'active';
        await pool.query(`UPDATE generic_entities SET data = jsonb_set(jsonb_set(data::jsonb, '{current_step}', $2::jsonb), '{status}', $3::jsonb), updated_date = NOW() WHERE id = $1`,
          [execRow.id, JSON.stringify(nextStep >= steps.length ? 0 : nextStep), JSON.stringify(newStatus)]);
        processed++;
      } catch (execErr) {
        console.error(`[Cron:processWorkflowQueue] Execution ${execRow.id} error:`, execErr.message);
        const failedAt = new Date().toISOString();
        const execData = typeof execRow.data === 'string' ? JSON.parse(execRow.data) : (execRow.data || {});
        const execLog = Array.isArray(execData.execution_log) ? execData.execution_log : [];
        execLog.push({
          step: execData.current_step || 0,
          action: 'workflow_step',
          timestamp: failedAt,
          success: false,
          message: execErr.message,
        });
        await pool.query(
          `UPDATE generic_entities SET data = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(data::jsonb, '{status}', '"failed"'),
                '{execution_log}', $2::jsonb
              ),
              '{error_message}', $3::jsonb
            ),
            '{failed_at}', $4::jsonb
          ), updated_date = NOW() WHERE id = $1`,
          [execRow.id, JSON.stringify(execLog), JSON.stringify(execErr.message), JSON.stringify(failedAt)]
        ).catch(updateErr => console.error(`[Cron:processWorkflowQueue] Could not mark ${execRow.id} failed:`, updateErr.message));
      }
    }
    console.log(`[Cron:processWorkflowQueue] Complete: ${processed}/${executions.length} processed`);
  } catch (err) {
    if (err.message && !err.message.includes('Cannot find module')) {
      console.error('[Cron:processWorkflowQueue] Error:', err.message);
    }
  } finally {
    workflowQueueRunning = false;
  }
}, 60000);

// Send timezone-aware morning (5am) and EOD (8pm) reports every 15 minutes
setInterval(async () => {
  try {
    const response = await callInternalFunction('sendScheduledDailyReports', {});
    const result = response?.data || response || {};
    if (result.success) {
      const triggered = result.triggered || [];
      if (triggered.length > 0) {
        console.log(`[Cron:sendScheduledDailyReports] Triggered reports for: ${triggered.join(', ')}`);
      } else {
        console.log('[Cron:sendScheduledDailyReports] No reports due at this time');
      }
    } else if (result.error) {
      console.error('[Cron:sendScheduledDailyReports] Error:', result.error);
    }
  } catch (err) {
    console.error('[Cron:sendScheduledDailyReports] Failed:', err.message);
  }
}, 15 * 60 * 1000);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

const BASE44_MARKETING_DOMAIN = process.env.BASE44_MARKETING_DOMAIN || '';

function getAllowedOrigins() {
  const origins = [
    'https://getcompanysync.com',
    'https://company-sync-crm-bf62df1e.base44.app',
    'https://companysync.io',
    'https://www.companysync.io',
  ];
  if (BASE44_MARKETING_DOMAIN) {
    const domain = BASE44_MARKETING_DOMAIN.replace(/\/+$/, '');
    if (!domain.startsWith('http')) {
      origins.push(`https://${domain}`);
      origins.push(`http://${domain}`);
    } else {
      origins.push(domain);
    }
  }
  const appUrl = process.env.VITE_REPLIT_APP_URL || '';
  if (appUrl) origins.push(appUrl.replace(/\/+$/, ''));
  return origins;
}

// ── Rate limiter for unauthenticated/auth endpoints ────────────────────────
// Simple in-memory sliding-window limiter. Keyed by (kind, IP). Map cleans
// itself every minute via the unref'd interval below. Surviving a process
// restart isn't a goal — this is brute-force protection, not abuse tracking.
const RATE_LIMIT_BUCKETS = new Map();
const RATE_LIMITS = {
  login:  { window: 60_000, max: 10 },
  signup: { window: 60_000, max: 5 },
  forgot: { window: 60_000, max: 5 },
  reset:  { window: 60_000, max: 5 },
};
function getClientIps(req) {
  // The leftmost X-Forwarded-For hop is client-supplied. When a proxy is
  // trusted, rate-limit the rightmost hop it appended and ignore the shared
  // proxy socket so one client cannot fill the bucket for everyone.
  const { getClientIp } = require('./lib/rateLimit.cjs');
  return [getClientIp(req)];
}
function checkRateLimit(req, res, kind) {
  const cfg = RATE_LIMITS[kind];
  if (!cfg) return true;
  const ips = getClientIps(req);
  const now = Date.now();
  // First pass: reject if ANY of the keys is over budget (don't increment yet).
  for (const ip of ips) {
    const key = `${kind}:${ip}`;
    const bucket = RATE_LIMIT_BUCKETS.get(key) || [];
    const fresh = bucket.filter(ts => now - ts < cfg.window);
    if (fresh.length >= cfg.max) {
      const retryAfter = Math.ceil(cfg.window / 1000);
      console.warn(`[RateLimit] ${kind} blocked for ${ip} (${fresh.length}/${cfg.max} in ${cfg.window}ms)`);
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      });
      res.end(JSON.stringify({ error: 'Too many requests', retryAfter }));
      return false;
    }
  }
  // Second pass: record the hit on every bucket.
  for (const ip of ips) {
    const key = `${kind}:${ip}`;
    const bucket = (RATE_LIMIT_BUCKETS.get(key) || []).filter(ts => now - ts < cfg.window);
    bucket.push(now);
    RATE_LIMIT_BUCKETS.set(key, bucket);
  }
  return true;
}
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [k, v] of RATE_LIMIT_BUCKETS.entries()) {
    const fresh = v.filter(ts => ts > cutoff);
    if (fresh.length === 0) RATE_LIMIT_BUCKETS.delete(k);
    else RATE_LIMIT_BUCKETS.set(k, fresh);
  }
}, 60_000).unref();

function setCorsHeaders(res, req) {
  const origin = req?.headers?.origin || '';
  const allowed = getAllowedOrigins();
  const isAllowed = origin && (
    allowed.some(a => origin === a || origin.startsWith(a)) ||
    origin.endsWith('.replit.app') ||
    origin.endsWith('.replit.dev')
  );
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  // No Access-Control-Allow-Origin header for unrecognized origins: browsers
  // deny the cross-origin read by default instead of us explicitly allowing '*'.
  // Same-origin requests (the normal app UI) never rely on this header at all.
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    voice: 'Kore',
    response_speed: 'normal',
    background_audio: 'none',
    interim_audio: 'typing',
    personality_assertiveness: 50,
    personality_humor: 20
  };
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function getPublicHost(reqHeaders) {
  const envUrl = process.env.VITE_REPLIT_APP_URL || '';
  if (envUrl) {
    try { return new URL(envUrl).host; } catch (e) {}
  }
  return reqHeaders?.host || 'localhost:5000';
}

async function getAuthenticatedProdUser(req) {
  const session = await prodAuth.getSessionFromRequest(req, prodDb.getPool());
  const data = session?.data;
  const email = data?.passport?.user?.claims?.email || data?.user?.email || data?.email;
  if (!email) return null;
  const pool = prodDb.getPool();
  const userResult = await pool.query('SELECT platform_role, company_id FROM users WHERE email = $1', [email]);
  const userRow = userResult.rows[0];
  const staffResult = await pool.query(
    `SELECT is_super_admin, is_administrator, company_id
     FROM staff_profiles
     WHERE (email = $1 OR user_email = $1)
       AND ($2::text IS NULL OR company_id = $2)
     ORDER BY CASE WHEN company_id = $2 THEN 0 ELSE 1 END, id
     LIMIT 1`,
    [email, userRow?.company_id || null],
  );
  const staffRow = staffResult.rows[0];
  const company_id = userRow?.company_id || staffRow?.company_id || null;
  return {
    email,
    platform_role: userRow?.platform_role || null,
    company_id,
    is_super_admin: staffRow?.is_super_admin === true
      || userRow?.platform_role === 'super_admin',
    is_administrator: staffRow?.is_administrator === true,
  };
}

// Sends a 413 response if err.statusCode === 413, otherwise 500.
// Used by route-level catch blocks to surface body-too-large errors cleanly.
function replyError(res, err, { json = true } = {}) {
  if (res.headersSent) return;
  if (err?.statusCode === 413) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  } else {
    if (json) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error' }));
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
}

// Default 1 MB cap protects all routes that read small JSON (notes, settings,
// chat messages, Twilio webhooks, etc.). The portal/photo JSON branch
// explicitly passes 30 MB. Pass null to disable the cap (not recommended).
async function readBody(req, maxBytes = 1 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let totalBytes = 0;
    let limitExceeded = false;
    req.on('data', chunk => {
      if (limitExceeded) return;
      totalBytes += chunk.length;
      if (maxBytes !== null && totalBytes > maxBytes) {
        limitExceeded = true;
        req.resume(); // drain remaining data; keep socket alive so a 413 response can be sent
        return reject(Object.assign(new Error(`Request body too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB)`), { statusCode: 413 }));
      }
      body += chunk;
    });
    req.on('end', () => { if (!limitExceeded) resolve(body); });
    req.on('error', err => reject(err));
  });
}

function readBodyBuffer(req, maxBytes = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let limitExceeded = false;
    req.on('data', chunk => {
      if (limitExceeded) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) { limitExceeded = true; req.resume(); return reject(Object.assign(new Error('Request body too large'), { statusCode: 413 })); }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!limitExceeded) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function parseMultipartPortal(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(boundaryBuffer);
  while (start !== -1) {
    start += boundaryBuffer.length;
    if (buffer[start] === 0x2D && buffer[start + 1] === 0x2D) break;
    start += 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = buffer.slice(start, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuffer, dataStart);
    const dataEnd = nextBoundary !== -1 ? nextBoundary - 2 : buffer.length;
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
    parts.push({
      name: nameMatch ? nameMatch[1] : 'unknown',
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
      data: buffer.slice(dataStart, dataEnd),
    });
    start = nextBoundary;
  }
  return parts;
}

async function localGetSettings(companyId) {
  const pool = prodDb.getPool();
  try {
    // Latency: all six lookups below only depend on companyId, so run them in
    // parallel instead of serially (this runs on the call-start hot path before
    // the greeting can be spoken). Same behavior on failure as the old
    // per-query try/catch: each one degrades to empty independently.
    const safeQuery = (sql, params) => pool.query(sql, params).then(r => r.rows).catch((e) => { console.log(`[localGetSettings] query error: ${e.message}`); return []; });
    const [settingsRows, companyRows, memories, articles, training, staffRows] = await Promise.all([
      safeQuery(
        `SELECT data FROM generic_entities WHERE entity_type = 'AssistantSettings' AND company_id = $1 ORDER BY (LOWER(BTRIM(COALESCE(data->>'assistant_name',''))) <> 'lexi') DESC, (LOWER(BTRIM(COALESCE(data->>'assistant_name',''))) IN ('sarah','')) DESC, COALESCE(updated_date > created_date + interval '5 seconds', false) DESC, updated_date DESC NULLS LAST LIMIT 1`,
        [companyId]
      ),
      safeQuery(`SELECT name, data, preferred_language FROM companies WHERE id = $1 LIMIT 1`, [companyId]),
      safeQuery(
        // Voice call context: only include company-level memories (no user_email
        // or category='company'). Personal per-user memories must not leak into
        // other users' sessions — see task #907. The Lexi text chat path
        // (lexiChat handler) does its own user-scoped query with effectiveEmail.
        `SELECT data FROM generic_entities
         WHERE entity_type = 'AIMemory'
           AND company_id = $1
           AND (data->>'is_active')::boolean = true
           AND (
             data->>'user_email' IS NULL
             OR data->>'user_email' = ''
             OR data->>'category' = 'company'
           )
         ORDER BY (data->>'importance')::int DESC NULLS LAST LIMIT 50`,
        [companyId]
      ),
      safeQuery(
        `SELECT data FROM generic_entities WHERE entity_type = 'KnowledgeBaseArticle' AND company_id = $1 AND data->>'status' = 'published' LIMIT 30`,
        [companyId]
      ),
      safeQuery(
        `SELECT data FROM generic_entities WHERE entity_type = 'AITrainingData' AND company_id = $1 AND data->>'status' = 'active' LIMIT 50`,
        [companyId]
      ),
      safeQuery(
        `SELECT full_name, role, cell_phone, twilio_number, availability_status FROM staff_profiles WHERE company_id = $1 AND is_active = true ORDER BY full_name`,
        [companyId]
      ),
    ]);
    const settings = settingsRows[0]?.data || {};

    const company = companyRows[0] || {};
    const companyName = settings.brand_short_name || company.name || company.data?.company_name || 'our company';
    const companyTimezone = company.data?.timezone || 'America/New_York';
    const preferredLanguage = company.preferred_language || 'en';

    let rawName = (settings.assistant_name || 'Alex').trim();
    if (/^\{.*\}$/.test(rawName)) rawName = 'Alex';
    const assistantDisplayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

    let knowledgeParts = [];

    if (memories.length > 0) {
      const userMemories = memories.filter(m =>
        !['estimator_calibration', 'job_calibration'].includes(m.data?.category)
      );
      if (userMemories.length > 0) {
        knowledgeParts.push(userMemories.map(m => {
          const label = m.data?.key || m.data?.title || '';
          const detail = m.data?.value || m.data?.content || '';
          return label || detail ? `- ${label}: ${detail}` : null;
        }).filter(Boolean).join('\n'));
      }
    }

    if (articles.length > 0) {
      knowledgeParts.push(articles.map(a => `- ${a.data?.title || ''}: ${(a.data?.content || a.data?.summary || '').substring(0, 500)}`).join('\n'));
    }

    if (training.length > 0) {
      knowledgeParts.push(training.map(t => `- ${t.data?.category || 'General'}: ${t.data?.content || ''}`).join('\n'));
    }

    if (settings.knowledge_base) {
      knowledgeParts.push(settings.knowledge_base);
    }

    if (settings.website_urls && Array.isArray(settings.website_urls) && settings.website_urls.length > 0) {
      knowledgeParts.push('Company websites: ' + settings.website_urls.join(', '));
    }

    if (staffRows.length > 0) {
      knowledgeParts.push('\nTEAM MEMBERS:\n' + staffRows.map(s =>
        `- ${s.full_name}${s.role ? ` (${s.role})` : ''}${s.availability_status === 'available' ? ' — available' : ' — unavailable'}`
      ).join('\n'));
    }

    const fullKnowledge = knowledgeParts.filter(Boolean).join('\n');

    console.log(`[localGetSettings] company=${companyName}, assistant=${assistantDisplayName}, timezone=${companyTimezone}, settings_keys=${Object.keys(settings).length}, knowledge_parts=${knowledgeParts.length}, knowledge_length=${fullKnowledge.length}`);

    return {
      settings,
      companyName,
      assistantName: assistantDisplayName,
      timezone: companyTimezone,
      customSystemPrompt: settings.system_prompt || '',
      transferInstructions: settings.transfer_instructions || '',
      screeningEnabled: settings.screen_calls_enabled || false,
      screeningInstructions: settings.screening_instructions || '',
      knowledgeBase: fullKnowledge,
      companyDescription: company.data?.description || '',
      companyServices: company.data?.services || '',
      preferredLanguage,
    };
  } catch (err) {
    console.error('[localGetSettings] Error:', err.message);
    return { error: err.message };
  }
}

async function localGetMessagingSettings(companyId) {
  const pool = prodDb.getPool();
  try {
    const { rows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'MessagingSettings' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
      [companyId]
    );
    const settings = rows[0]?.data || {};
    return {
      whatsapp_enabled: settings.whatsapp_enabled || false,
      sms_auto_reply: settings.sms_auto_reply !== false,
      missed_call_followup_enabled: settings.missed_call_followup_enabled || false,
      missed_call_channel: settings.missed_call_channel || 'sms',
      missed_call_template: settings.missed_call_template || '',
      ...settings,
    };
  } catch (e) {
    console.error('[localGetMessagingSettings] Error:', e.message);
    return null;
  }
}

const smsConversationHistory = new Map();

async function localHandleIncomingMessage(companyId, msgData) {
  const pool = prodDb.getPool();
  const { from, to, body, channel, message_sid } = msgData;
  console.log(`[LocalSMS] Handling ${channel} from ${from} for company ${companyId}`);

  // Guard: if the last outbound message in this thread was sent by a rep (not AI),
  // Sarah stays silent — the rep owns the conversation.
  // Auto-expires after 4 hours so AI re-engages when a customer follows up later.
  // This covers both the rep-routed path and the main-company-number path.
  try {
    const { rows: repCheckRows } = await pool.query(
      `SELECT data, created_at FROM communications
       WHERE company_id = $1 AND contact_phone = $2 AND direction = 'outbound'
       ORDER BY created_at DESC NULLS LAST LIMIT 1`,
      [companyId, from]
    );
    const lastData = repCheckRows[0]?.data || {};
    const lastSentAt = repCheckRows[0]?.created_at;
    const repThreadExpired = lastSentAt && (Date.now() - new Date(lastSentAt).getTime()) > 4 * 60 * 60 * 1000;
    if ((lastData.sent_by_rep === true || lastData.sent_by_rep === 'true') && !repThreadExpired) {
      console.log(`[LocalSMS] Skipping AI reply — last outbound to ${from} was rep-sent`);
      return { reply: null, skipped: true, reason: 'rep_owns_thread' };
    }
  } catch (repCheckErr) {
    console.warn('[LocalSMS] sent_by_rep check failed:', repCheckErr.message);
  }

  try {
    const settingsResult = await localGetSettings(companyId);
    if (settingsResult.error) {
      console.error('[LocalSMS] Failed to get settings:', settingsResult.error);
      return { reply: null };
    }
    const { settings, companyName, assistantName, knowledgeBase, customSystemPrompt } = settingsResult;

    let apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    try {
      const companyKey = await prodDb.getCompanyGeminiKey(companyId);
      if (companyKey) apiKey = companyKey;
    } catch (e) { console.error('[LocalSMS] BYOK key lookup failed:', e.message); }
    if (!apiKey) {
      console.error('[LocalSMS] GOOGLE_GEMINI_API_KEY not set');
      return { reply: null };
    }

    // Hand off to the unified SMS assistant (shared with the test simulator).
    // It handles: tool dispatch, caller lookup, persistent history, multi-turn loop.
    let reply = '';
    let smsResult = null;
    try {
      smsResult = await smsAssistant.processInboundSms({
        pool,
        companyId,
        fromPhone: from,
        toPhone: to,
        body,
        channel,
        apiKey,
        settings: {
          assistant_name: assistantName,
          brand_short_name: companyName,
          custom_system_prompt: customSystemPrompt || '',
          knowledge_base: knowledgeBase || '',
          company_description: settings?.company_description || '',
          sms_auto_reply: settings?.sms_auto_reply !== false,
        },
      });
      reply = smsResult?.reply || '';
    } catch (aiErr) {
      console.error('[LocalSMS] processInboundSms error:', aiErr.message);
    }

    if (reply) {
      const tools = smsResult?.toolCalls?.length ? ` (tools: ${smsResult.toolCalls.map(t => t.name).join(',')})` : '';
      console.log(`[LocalSMS] AI reply (${reply.length} chars)${tools}: "${reply.substring(0, 100)}..."`);
      billAIUsage(companyId, 1);
      logUsageEvent(companyId, 'sms_ai', 1).catch(() => {});
    }

    try {
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'Communication', $2, $3, NOW(), NOW())`,
        [
          `local_comm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          companyId,
          JSON.stringify({
            type: channel === 'whatsapp' ? 'whatsapp' : 'sms',
            direction: 'inbound',
            contact_phone: from,
            company_phone: to,
            message_body: body,
            ai_reply: reply,
            message_sid: message_sid,
            status: 'completed',
            created_at: new Date().toISOString(),
          }),
        ]
      );
    } catch (logErr) { console.warn('[LocalSMS] Failed to log communication:', logErr.message); }

    // Notify rep + admins about the inbound message (bell + email + SMS to cell)
    try {
      const { rows: smsAdminRows } = await pool.query(
        `SELECT user_email, full_name, cell_phone FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
        [companyId]
      );
      const { rows: smsRepRows } = await pool.query(
        `SELECT user_email, full_name, cell_phone FROM staff_profiles WHERE company_id = $1 AND (twilio_number = $2 OR twilio_number = $3) LIMIT 1`,
        [companyId, to, to.replace(/^\+1/, '')]
      );
      const { rows: twNotifRows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
        [companyId]
      );
      const twNotif = twNotifRows[0]?.data || {};
      const twNotifSid = twNotif.account_sid || process.env.TWILIO_ACCOUNT_SID;
      const twNotifToken = twNotif.auth_token || process.env.TWILIO_AUTH_TOKEN;
      const twNotifFrom = twNotif.main_phone_number || process.env.TWILIO_PHONE_NUMBER;

      // Merge rep + admins, dedupe by email
      const seenEmails = new Set();
      const notifTargets = [];
      for (const r of [...smsRepRows, ...smsAdminRows]) {
        if (r.user_email && !seenEmails.has(r.user_email)) {
          seenEmails.add(r.user_email);
          notifTargets.push(r);
        }
      }

      const preview = body.length > 140 ? body.substring(0, 137) + '...' : body;
      const channelIcon = channel === 'whatsapp' ? '💬' : '📱';
      const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : 'text';
      // Look up contact name for notification title
      let notifContactName = from;
      try {
        const custNR = await pool.query(`SELECT name FROM customers WHERE company_id = $1 AND (phone = $2 OR phone_2 = $2) AND name IS NOT NULL AND name != '' LIMIT 1`, [companyId, from]);
        if (custNR.rows.length > 0) notifContactName = custNR.rows[0].name;
        else {
          const leadNR = await pool.query(`SELECT name FROM leads WHERE company_id = $1 AND phone = $2 AND name IS NOT NULL AND name != '' LIMIT 1`, [companyId, from]);
          if (leadNR.rows.length > 0) notifContactName = leadNR.rows[0].name;
        }
      } catch (e) {}
      const notifTitle = `${channelIcon} New ${channelLabel} from ${notifContactName}`;
      const quietHours = await getNotificationQuietHours(pool, companyId);

      for (const target of notifTargets) {
        // 1. Bell notification
        const nId = `notif_sms_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [nId, companyId, JSON.stringify({
            id: nId,
            type: 'incoming_sms',
            title: notifTitle,
            message: preview,
            user_email: target.user_email,
            is_read: false,
            caller_phone: from,
            channel: channel,
            created_at: new Date().toISOString(),
            ...(quietHours.active ? {
              deferred_until: quietHours.deferredUntil,
              deferred_reason: 'company_notification_quiet_hours',
            } : {}),
          })]
        );

        // 2. Email
        try {
          if (quietHours.active) continue;
          const emailSubject = notifTitle;
          const emailBody = `<h2 style="color:#1e40af">${notifTitle}</h2>
<p style="font-family:sans-serif;font-size:14px"><strong>From:</strong> ${from}</p>
<p style="font-family:sans-serif;font-size:14px"><strong>Message:</strong> ${body}</p>
${reply ? `<p style="font-family:sans-serif;font-size:14px;color:#6b7280"><strong>${assistantName} replied:</strong> ${reply}</p>` : ''}`;
          await sendEmail({ to: target.user_email, subject: emailSubject, html: emailBody, companyId });
        } catch (emailErr) { console.warn('[LocalSMS] Email error:', emailErr.message); }

        // 3. SMS to rep's personal cell phone
        if (!quietHours.active && target.cell_phone && twNotifSid && twNotifToken && twNotifFrom) {
          try {
            const cellSmsBody = `${channelIcon} New ${channelLabel} from ${from}:\n"${body.substring(0, 120)}"`;
            const authStr = Buffer.from(`${twNotifSid}:${twNotifToken}`).toString('base64');
            await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twNotifSid}/Messages.json`, {
              method: 'POST',
              headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ To: target.cell_phone, From: twNotifFrom, Body: cellSmsBody }).toString()
            });
          } catch (cellSmsErr) { console.warn('[LocalSMS] Cell SMS error:', cellSmsErr.message); }
        }
      }
      console.log(`[LocalSMS] Notified ${notifTargets.length} staff (bell+email+SMS) for inbound ${channel} from ${from}`);
    } catch (notifErr) { console.warn('[LocalSMS] Notification error:', notifErr.message); }

    return { reply, success: true };
  } catch (err) {
    console.error('[LocalSMS] Error:', err.message);
    return { reply: null };
  }
}

// Monthly platform-voice cap — mirrors the constant in vite-twilio-ws-plugin.js.
// BYOK Twilio subscribers are exempt; platform-key subscribers are capped at 500 min/mo.
const PLATFORM_VOICE_MINUTES_CAP = 500;

// ── Voice usage nudge (80% of monthly cap) ───────────────────────────────────
// Fires at most once per calendar month per company via a deterministic
// SubscriptionUsageNudge entity (ON CONFLICT DO NOTHING de-duplication).
// BYOK Twilio companies never reach this — they early-return above.
// Mirrors sendVoiceUsageNudge in vite-twilio-ws-plugin.js — keep in lockstep.
async function sendVoiceUsageNudge(companyId, minutesUsed, cap) {
  const nudgeMonth = new Date().toISOString().slice(0, 7);
  const pool = prodDb.getPool();
  const nudgeId = `usagenudge_${companyId}_${nudgeMonth}_voice_minutes`;
  try {
    const claimRes = await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'SubscriptionUsageNudge', $2, $3, NOW(), NOW())
       ON CONFLICT (id, entity_type) DO NOTHING`,
      [nudgeId, companyId, JSON.stringify({ company_id: companyId, nudge_month: nudgeMonth, cap_type: 'voice_minutes', sent_at: new Date().toISOString() })]
    );
    if (claimRes.rowCount === 0) return; // already sent this month

    const title = `You've used ${minutesUsed} of ${cap} platform voice minutes this month`;
    const message = `You're approaching your monthly voice-minutes limit (${minutesUsed}/${cap} min). Add your own Twilio account in Settings → API Keys to remove this limit entirely.`;
    const appUrl = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';
    const now = new Date().toISOString();

    // In-app bell for every admin user at this company.
    const { rows: adminRows } = await pool.query(
      `SELECT COALESCE(NULLIF(user_email,''), email) AS email
       FROM staff_profiles
       WHERE company_id = $1 AND is_administrator = true AND is_active = true
         AND COALESCE(NULLIF(user_email,''), email) IS NOT NULL`,
      [companyId]
    );
    for (const { email } of adminRows) {
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'Notification', $2, $3, NOW(), NOW())`,
        [`notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
         companyId, JSON.stringify({
           company_id: companyId, user_email: email, title, message,
           type: 'usage_nudge', link_url: '/APIKeysSettings', is_read: false, created_at: now,
         })]
      );
    }
    console.log(`[Voice] 80% nudge sent to ${adminRows.length} admin(s) for company ${companyId} (${minutesUsed}/${cap} min)`);

    // Email to company owner (created_by).
    const { rows: coRows } = await pool.query(
      `SELECT COALESCE(company_name, data->>'company_name', id) AS name, created_by FROM companies WHERE id = $1`,
      [companyId]
    );
    const co = coRows[0];
    if (co?.created_by) {
      await sendEmail({
        to: co.created_by,
        companyId,
        subject: title,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1f2937;margin-top:0;">You're approaching your voice minutes limit</h2>
          <p style="color:#374151;">Your company has used <strong>${minutesUsed} of ${cap} platform voice minutes</strong> this month (80% of your monthly cap).</p>
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:16px 0;">
            <p style="color:#92400e;margin:0;"><strong>Heads-up:</strong> once you hit ${cap} minutes, new AI voice calls will be paused for the rest of the month. Add your own Twilio account in Settings → API Keys to remove this limit entirely.</p>
          </div>
          <p style="margin-top:24px;">
            <a href="${appUrl}/APIKeysSettings" style="background:#2563eb;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;font-size:14px;">Add your own API key →</a>
          </p>
        </div>`,
      }).catch((emailErr) => console.warn(`[Voice] Nudge email to ${co.created_by} failed:`, emailErr.message));
    }
  } catch (e) {
    console.warn('[Voice] sendVoiceUsageNudge failed:', e.message);
  }
}

async function localCheckVoiceAccess(companyId) {
  const pool = prodDb.getPool();
  try {
    // SELECT * on purpose: subscription_status is a real column in dev but lives
    // only in the data JSONB blob in prod (prod-db.cjs's companies table has no
    // such column) — naming it in the column list would throw there. (Task #672)
    const { rows } = await pool.query(
      `SELECT * FROM companies WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1`,
      [companyId]
    );
    const company = rows[0];
    if (!company) {
      console.warn(`[localCheckVoiceAccess] Company ${companyId} not found in local DB — allowing call (phone routing already validated)`);
      return { allowed: true };
    }

    const plan = (company.subscription_plan || company.data?.subscription_plan || 'trial').toLowerCase();
    // Status: real column (dev) → data JSONB (prod) fallback.
    const status = String(company.subscription_status ?? company.data?.subscription_status ?? 'active').toLowerCase();
    // Trials started via the startCompanyTrial action historically wrote only
    // data->>'trial_ends_at' (JSONB), not the trial_end_date column — fall back
    // to it so those trials are still enforced here. (Task #672)
    const trialEndRaw = company.trial_end_date
      ?? (company.data && typeof company.data === 'object' ? company.data.trial_ends_at : null);
    const trialExpired = company.data?.trial_expired === true ||
      (trialEndRaw && new Date(trialEndRaw) < new Date());

    // Expiry keys on subscription_status, not subscription_plan: action-started
    // trials carry the chosen plan name ('basic'/'business'/...) with
    // status='trial', so a plan-only check never fires for them. 'expired' is
    // what the processTrialLifecycle cron writes once the trial lapses.
    // Defense-in-depth: a live Stripe subscription means the company converted
    // to paid — never trial-block them even if a webhook gap left status='trial'
    // (prod's Stripe webhook has no customer.subscription.* handler that flips
    // status to 'active'). Explicit cancelled/suspended still blocks below.
    const hasStripeSub = !!(company.stripe_subscription_id || company.data?.stripe_subscription_id);
    if (!hasStripeSub && (status === 'expired' || (trialExpired && (status === 'trial' || plan === 'trial')))) {
      return { allowed: false, reason: 'Trial expired. Please upgrade to continue using voice features.' };
    }
    if (status === 'cancelled' || status === 'suspended') {
      return { allowed: false, reason: `Subscription ${status}. Please contact support to reactivate.` };
    }

    // BYOK Twilio check: if the company has their own Twilio account configured,
    // "unlimited call minutes" applies fully — skip the platform-key cap.
    let hasByokTwilio = false;
    try {
      const { rows: keyRows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'CompanyApiKeys' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
        [companyId]
      );
      const keyData = keyRows[0]?.data;
      hasByokTwilio = !!(keyData?.twilio_account_sid && keyData?.twilio_auth_token);
    } catch (e) {
      console.warn(`[localCheckVoiceAccess] Could not check BYOK Twilio status: ${e.message}`);
    }

    if (!hasByokTwilio) {
      // Platform Twilio: enforce monthly voice-minutes cap using actual sarah usage events.
      try {
        const usageMonth = new Date().toISOString().slice(0, 7);
        const { rows: usageRows } = await pool.query(
          `SELECT COALESCE(SUM((data->>'units')::numeric), 0) AS used
           FROM generic_entities
           WHERE entity_type = 'SubscriptionUsage' AND company_id = $1
             AND data->>'feature' = 'sarah' AND data->>'usage_month' = $2`,
          [companyId, usageMonth]
        );
        const minutesUsed = Number(usageRows[0]?.used || 0);
        // 80% nudge: checked BEFORE the hard cap so a jump from <80% directly to ≥100%
        // in one call still creates the nudge. Skipped for active trials (status or
        // plan === 'trial') — only paid platform-key subscribers should be nudged.
        const isTrial = (status === 'trial' || plan === 'trial');
        if (!isTrial && minutesUsed >= PLATFORM_VOICE_MINUTES_CAP * 0.8) {
          sendVoiceUsageNudge(companyId, minutesUsed, PLATFORM_VOICE_MINUTES_CAP).catch((e) =>
            console.warn('[Voice] sendVoiceUsageNudge async failed:', e.message));
        }
        if (minutesUsed >= PLATFORM_VOICE_MINUTES_CAP) {
          console.warn(`[localCheckVoiceAccess] Company ${companyId} hit platform voice cap: ${minutesUsed}/${PLATFORM_VOICE_MINUTES_CAP} min`);
          return {
            allowed: false,
            reason: `Monthly voice minutes limit reached (${minutesUsed}/${PLATFORM_VOICE_MINUTES_CAP} min). Add your own Twilio account in Settings → API Keys to remove this limit.`,
            call_minutes_used: minutesUsed,
            call_minutes_limit: PLATFORM_VOICE_MINUTES_CAP,
          };
        }
        console.log(`[localCheckVoiceAccess] Company ${companyId} (${company.name}) allowed — plan=${plan}, voice=${minutesUsed}/${PLATFORM_VOICE_MINUTES_CAP} min (platform Twilio)`);
        return { allowed: true, plan, call_minutes_used: minutesUsed, call_minutes_limit: PLATFORM_VOICE_MINUTES_CAP };
      } catch (e) {
        console.warn(`[localCheckVoiceAccess] Could not check voice usage limits — allowing: ${e.message}`);
      }
    }

    console.log(`[localCheckVoiceAccess] Company ${companyId} (${company.name}) allowed — plan=${plan}, status=${status}${hasByokTwilio ? ' (BYOK Twilio)' : ''}`);
    return { allowed: true, plan, call_minutes_used: 0, call_minutes_limit: -1 };
  } catch (err) {
    console.error('[localCheckVoiceAccess] Error:', err.message);
    return { allowed: true };
  }
}

async function localSendMissedCallFollowup(companyId, callData) {
  const pool = prodDb.getPool();
  const { caller_phone, called_number, channel } = callData;
  console.log(`[LocalMissedCall] Sending follow-up to ${caller_phone} for company ${companyId}`);
  try {
    const settingsResult = await localGetSettings(companyId);
    const { companyName, assistantName } = settingsResult;

    let twilioSid, twilioToken, twilioPhone;
    const { rows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
      [companyId]
    );
    const tw = rows[0]?.data || {};
    twilioSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
    twilioToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
    twilioPhone = tw.main_phone_number || called_number;

    if (!twilioSid || !twilioToken) {
      console.error('[LocalMissedCall] No Twilio credentials found');
      return { success: false };
    }

    const msgSettings = await localGetMessagingSettings(companyId);
    let template = msgSettings?.missed_call_template || '';
    if (!template) {
      template = `Hi! This is ${assistantName} from ${companyName}. We noticed we missed your call. How can we help you? Feel free to reply to this text or call us back anytime!`;
    }
    template = template.replace(/\{brand\}/gi, companyName).replace(/\{agent\}/gi, assistantName);

    const authHeader = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
    const smsParams = new URLSearchParams({ To: caller_phone, From: twilioPhone, Body: template });
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: smsParams.toString(),
      }
    );

    if (twilioRes.ok) {
      console.log(`[LocalMissedCall] Follow-up SMS sent to ${caller_phone}`);
      return { success: true };
    } else {
      const errText = await twilioRes.text();
      console.error('[LocalMissedCall] Twilio SMS failed:', twilioRes.status, errText.substring(0, 200));
      return { success: false };
    }
  } catch (err) {
    console.error('[LocalMissedCall] Error:', err.message);
    return { success: false };
  }
}

async function sendPostCallNotifications(companyId, { callerPhone, callerName, transcript, durationSeconds, commId, repName, repEmail, repCell, companyName, assistantName, callDirection, toolCallsMade, callSid }) {
  const pool = prodDb.getPool();
  try {
    // 1. Get admin emails and Twilio creds
    const { rows: adminRows } = await pool.query(
      `SELECT user_email, full_name FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
      [companyId]
    );
    const { rows: twilioRows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
      [companyId]
    );
    const tw = twilioRows[0]?.data || {};
    const twilioSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = tw.main_phone_number || process.env.TWILIO_PHONE_NUMBER;

    const { rows: tzRows } = await pool.query(`SELECT data->>'timezone' as timezone FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
    const companyTimezone = tzRows[0]?.timezone || 'America/New_York';

    // Look up caller name from CRM if not already known
    let resolvedCallerName = callerName;
    if ((!resolvedCallerName || resolvedCallerName === 'Voice Caller') && callerPhone) {
      try {
        const { name: foundName } = await lookupCallerByCrmPhone(pool, companyId, callerPhone);
        if (foundName) resolvedCallerName = foundName;
      } catch (e) { /* name lookup is best-effort */ }
    }

    const callerLabel = resolvedCallerName && resolvedCallerName !== 'Voice Caller' ? `${resolvedCallerName} (${callerPhone})` : callerPhone;
    const durationMin = Math.floor(durationSeconds / 60);
    const durationSec = durationSeconds % 60;
    const durationLabel = durationMin > 0 ? `${durationMin}m ${durationSec}s` : `${durationSec}s`;
    const dirLabel = callDirection === 'outbound' ? 'Outbound call' : callDirection === 'forwarded' ? 'Staff line call' : 'Inbound call';

    // Build a compact transcript preview — strip role prefixes, first 350 chars
    const transcriptPreview = (() => {
      if (!transcript || transcript.trim().length === 0) return '';
      const lines = transcript.split('\n').filter(l => l.trim());
      const callerLines = lines.filter(l => l.toLowerCase().startsWith('user:')).map(l => l.replace(/^user:\s*/i, '').trim());
      if (callerLines.length > 0) return callerLines.join(' | ').substring(0, 350);
      return transcript.replace(/^(assistant|user|sarah):\s*/gim, '').substring(0, 350);
    })();

    // 2. In-app notifications — notify rep (if available) and all admins
    const quietHours = await getNotificationQuietHours(pool, companyId);
    const notifyEmails = new Set();
    if (repEmail) notifyEmails.add(repEmail);
    adminRows.forEach(r => notifyEmails.add(r.user_email));

    for (const email of notifyEmails) {
      const notifId = `notif_call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const notifMessage = transcriptPreview
        ? `From ${callerLabel} (${durationLabel}): "${transcriptPreview}${transcriptPreview.length >= 350 ? '…' : ''}"`
        : `${assistantName} handled a ${durationLabel} call from ${callerLabel}. No transcript captured.`;
      const notifData = {
        id: notifId,
        type: 'call_completed',
        title: `📞 ${dirLabel} — ${callerLabel}`,
        message: notifMessage,
        user_email: email,
        is_read: false,
        caller_phone: callerPhone,
        caller_name: callerName,
        duration_seconds: durationSeconds,
        communication_id: commId,
        call_direction: callDirection,
        created_at: new Date().toISOString(),
        ...(quietHours.active ? {
          deferred_until: quietHours.deferredUntil,
          deferred_reason: 'company_notification_quiet_hours',
        } : {}),
      };
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [notifId, companyId, JSON.stringify(notifData)]
      );
    }
    console.log(`[PostCall] Created ${notifyEmails.size} in-app notification(s) for ${callerLabel}`);

    // 3. SMS to rep's cell + admin cells — include actual caller message content.
    // Try tenant credentials first, then platform credentials when the tenant
    // row contains a stale token for the platform account.
    if (!quietHours.active && twilioFrom) {
      const smsSnippet = transcriptPreview ? ` Msg: "${transcriptPreview.substring(0, 120)}${transcriptPreview.length > 120 ? '…' : ''}"` : '';
      const smsBody = `📞 Call from ${callerLabel} (${durationLabel}).${smsSnippet} Call back: ${callerPhone}`;
      const smsCredentials = [];
      if (twilioSid && twilioToken) smsCredentials.push([twilioSid, twilioToken, 'company']);
      const platformSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim().replace(/["']/g, '');
      const platformToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim().replace(/["']/g, '');
      if (platformSid && platformToken && !(platformSid === twilioSid && platformToken === twilioToken)) {
        smsCredentials.push([platformSid, platformToken, 'platform']);
      }
      const smsTargets = new Set();
      if (repCell) smsTargets.add(repCell);
      try {
        const { rows: adminCellRows } = await pool.query(
          `SELECT cell_phone, phone FROM staff_profiles WHERE company_id = $1 AND is_administrator = true AND (cell_phone IS NOT NULL OR phone IS NOT NULL) LIMIT 5`,
          [companyId]
        );
        for (const r of adminCellRows) {
          const cell = r.cell_phone || r.phone;
          if (cell && cell.length >= 10) smsTargets.add(cell);
        }
      } catch (e) { /* admin cell lookup best-effort */ }
      for (const targetPhone of smsTargets) {
        let sent = false;
        for (const [sid, token, label] of smsCredentials) {
          try {
            const authStr = Buffer.from(`${sid}:${token}`).toString('base64');
            const smsResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
              method: 'POST',
              headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ To: targetPhone, From: twilioFrom, Body: smsBody }).toString()
            });
            if (smsResp.ok) {
              console.log(`[PostCall] SMS sent to ${targetPhone} (${label} creds)`);
              sent = true;
              break;
            }
            console.warn(`[PostCall] SMS to ${targetPhone} failed with ${label} creds:`, smsResp.status);
          } catch (smsErr) {
            console.warn(`[PostCall] SMS error for ${targetPhone} with ${label} creds:`, smsErr.message);
          }
        }
        if (!sent) console.warn(`[PostCall] SMS delivery exhausted all credential sets for ${targetPhone}`);
      }
    }

    // 4. Email to rep / admins. The recording webhook lands a few seconds AFTER
    // hang-up and carries the FULL recording-based transcript + the recording URL;
    // the live transcript is a partial fallback. Wait (bounded) for it so the
    // email isn't missing content, then include a listen link.
    let emailTranscript = transcript || '';
    let recordingUrl = '';
    if (commId) {
      const deadline = Date.now() + 90000;          // hard cap: 90s
      const noRecordingCutoff = Date.now() + 25000; // webhook normally fires within ~10s of hang-up
      while (Date.now() < deadline) {
        try {
          const { rows } = await pool.query(`SELECT data FROM communications WHERE id = $1 LIMIT 1`, [commId]);
          const d = rows[0]?.data || {};
          if (d.recording_url) recordingUrl = d.recording_url;
          if (d.transcription_source === 'recording' && d.transcription && d.transcription.trim()) {
            emailTranscript = d.transcription;
            break;
          }
          if (!recordingUrl && Date.now() > noRecordingCutoff) break; // no recording is coming
        } catch (e) { break; }
        await new Promise(r => setTimeout(r, 4000));
      }
      if (recordingUrl && emailTranscript === (transcript || '')) {
        console.log(`[PostCall] Recording found but no recording transcript yet — emailing live transcript for ${commId}`);
      }
    }

    const emailTargets = [];
    if (repEmail) emailTargets.push({ email: repEmail, name: repName || 'Rep' });
    adminRows.forEach(r => { if (r.user_email !== repEmail) emailTargets.push({ email: r.user_email, name: r.full_name || 'Admin' }); });

    for (const target of emailTargets.slice(0, 3)) {
      try {
        if (quietHours.active) continue;
        const subject = `📞 [${companyName}] Call from ${callerLabel} (${durationLabel})`;
        const bodyHtml = `
<div style="font-family:sans-serif;max-width:680px">
<h2 style="color:#1e40af;margin-bottom:4px">📞 ${dirLabel}</h2>
<p style="color:#6b7280;font-size:13px;margin-top:0">${new Date().toLocaleString('en-US', { timeZone: companyTimezone, dateStyle: 'full', timeStyle: 'short' })}</p>
<table style="font-size:14px;border-collapse:collapse;margin-bottom:16px">
  <tr><td style="padding:4px 16px 4px 0;font-weight:bold;color:#374151">Caller</td><td>${callerLabel}</td></tr>
  <tr><td style="padding:4px 16px 4px 0;font-weight:bold;color:#374151">Duration</td><td>${durationLabel}</td></tr>
  <tr><td style="padding:4px 16px 4px 0;font-weight:bold;color:#374151">Handled by</td><td>${assistantName}</td></tr>
  ${repName ? `<tr><td style="padding:4px 16px 4px 0;font-weight:bold;color:#374151">Assigned rep</td><td>${repName}</td></tr>` : ''}
  ${toolCallsMade > 0 ? `<tr><td style="padding:4px 16px 4px 0;font-weight:bold;color:#374151">Actions taken</td><td>${toolCallsMade}</td></tr>` : ''}
</table>
${recordingUrl ? `<p style="margin:0 0 16px 0"><a href="${recordingUrl}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:bold">▶ Listen to Call Recording</a></p>` : ''}
${emailTranscript ? `
<h3 style="color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:8px">Full Call Transcript</h3>
<pre style="background:#f9fafb;border:1px solid #e5e7eb;padding:16px;border-radius:8px;font-size:13px;white-space:pre-wrap;line-height:1.6;max-width:640px">${emailTranscript.substring(0, 10000)}</pre>
` : '<p style="color:#6b7280;font-style:italic">No transcript available for this call.</p>'}
<p style="color:#9ca3af;font-size:12px;margin-top:24px;border-top:1px solid #f3f4f6;padding-top:12px">CompanySync — ${companyName} | To call back: ${callerPhone}</p>
</div>`;
        await sendEmail({ to: target.email, subject, html: bodyHtml, companyId });
        console.log(`[PostCall] Email sent to ${target.email}${recordingUrl ? ' (with recording link)' : ''}`);
      } catch (emailErr) { console.warn('[PostCall] Email error:', emailErr.message); }
    }
  } catch (err) {
    console.error('[PostCall] Notification error:', err.message);
  }
}

async function callBase44API(action, companyId, data = null) {
  if (action === 'getSettings' && companyId) {
    try {
      const localResult = await localGetSettings(companyId);
      if (!localResult.error && localResult.settings && Object.keys(localResult.settings).length > 0) {
        console.log(`[Sarah CRM] getSettings served LOCALLY: assistant="${localResult.assistantName}", company="${localResult.companyName}"`);
        return localResult;
      }
    } catch (e) {
      console.warn('[Sarah CRM] Local getSettings failed, falling back to Base44:', e.message);
    }
  }

  if (action === 'handleIncomingMessage' && companyId) {
    try {
      const localResult = await localHandleIncomingMessage(companyId, data);
      // Treat skipped (rep owns thread) as terminal — do NOT fall through to Base44 fallback.
      if (localResult && localResult.skipped) {
        console.log(`[Sarah CRM] handleIncomingMessage SKIPPED locally for company ${companyId} — reason: ${localResult.reason}`);
        return localResult;
      }
      if (localResult && (localResult.reply || localResult.success)) {
        console.log(`[Sarah CRM] handleIncomingMessage served LOCALLY for company ${companyId}`);
        return localResult;
      }
    } catch (e) {
      console.warn('[Sarah CRM] Local handleIncomingMessage failed, falling back to Base44:', e.message);
    }
  }

  if (action === 'getMessagingSettings' && companyId) {
    try {
      const localResult = await localGetMessagingSettings(companyId);
      if (localResult) {
        console.log(`[Sarah CRM] getMessagingSettings served LOCALLY for company ${companyId}`);
        return localResult;
      }
    } catch (e) {
      console.warn('[Sarah CRM] Local getMessagingSettings failed, falling back to Base44:', e.message);
    }
  }

  if (action === 'sendMissedCallFollowup' && companyId) {
    try {
      const localResult = await localSendMissedCallFollowup(companyId, data);
      if (localResult) {
        console.log(`[Sarah CRM] sendMissedCallFollowup served LOCALLY for company ${companyId}`);
        return localResult;
      }
    } catch (e) {
      console.warn('[Sarah CRM] Local sendMissedCallFollowup failed, falling back to Base44:', e.message);
    }
  }

  if (action === 'checkVoiceAccess' && companyId) {
    try {
      const localResult = await localCheckVoiceAccess(companyId);
      console.log(`[Sarah CRM] checkVoiceAccess served LOCALLY for company ${companyId}: allowed=${localResult.allowed}`);
      return localResult;
    } catch (e) {
      console.warn('[Sarah CRM] Local checkVoiceAccess failed, allowing call:', e.message);
      return { allowed: true };
    }
  }

  if ((action === 'scheduleInspection' || action === 'bookAppointment' || action === 'sendCalendarInvite') && companyId && data) {
    // NEW FLOW: a caller-requested appointment NEVER books the calendar directly.
    // Instead we (1) find/create the Lead and (2) create a "pending appointment
    // approval" ActionItem. A human approves it in the app, which is what creates
    // the real CalendarEvent (status 'scheduled') that drives the existing reminders.
    try {
      const pool = prodDb.getPool();

      const customerName = data.customer_name || data.name || 'Customer';
      const rawPhone = (data.customer_phone || data.phone || data.contact_phone || '').toString();
      const cleanPhone = rawPhone.replace(/[^\d+]/g, '');
      const address = data.address || data.property_address || data.location || '';
      const rawDateTime = data.date_time || data.slot_time || data.start_time || data.appointment_time || data.datetime || '';
      const title = data.title || (action === 'scheduleInspection' ? `Roof Inspection - ${customerName}` : `Appointment - ${customerName}`);
      const description = data.description || data.notes || data.service_needed || '';

      // Never silently turn a vague/missing time into "about a day from now".
      // That made "tomorrow morning" look like a confirmed appointment at the
      // current clock time and allowed the model to submit before confirmation.
      if (!rawDateTime) {
        return { success: false, requires_exact_time: true, message: 'I need the exact inspection date and time before I can submit the request.' };
      }
      const startTime = new Date(rawDateTime);
      if (isNaN(startTime.getTime())) {
        return { success: false, requires_exact_time: true, message: 'I need an exact inspection date and time, not a general period such as tomorrow morning.' };
      }
      const endTime = new Date(startTime.getTime() + 3600000);
      const startIso = startTime.toISOString();
      // Look up company timezone so the action-item notification shows the correct local time.
      let apptTimezone = 'America/New_York';
      try {
        const { rows: tzR } = await pool.query(`SELECT timezone, settings FROM companies WHERE id=$1 LIMIT 1`, [companyId]);
        const tzRow = tzR[0];
        if (tzRow) {
          const tzS = tzRow.settings ? (typeof tzRow.settings === 'string' ? JSON.parse(tzRow.settings) : tzRow.settings) : {};
          apptTimezone = tzRow.timezone || tzS?.time_zone || tzS?.timezone || apptTimezone;
        }
      } catch (_) {}
      const friendlyTime = startTime.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: apptTimezone });

      // 1) Find or create the Lead (dedicated leads table), keyed by phone.
      let leadId = '';
      let leadName = customerName;
      if (cleanPhone) {
        const phoneVariants = [cleanPhone, cleanPhone.replace(/^\+1/, ''), '+1' + cleanPhone.replace(/^\+1/, '')];
        const existingLead = await pool.query(
          `SELECT id, name FROM leads WHERE company_id = $1 AND phone = ANY($2) ORDER BY updated_at DESC LIMIT 1`,
          [companyId, phoneVariants]
        );
        if (existingLead.rows.length > 0) { leadId = existingLead.rows[0].id; leadName = existingLead.rows[0].name || customerName; }
      }
      if (!leadId) {
        leadId = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        await pool.query(
          `INSERT INTO leads (id, company_id, name, phone, source, status, service_needed, notes, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'ai_voice', 'new', $5, $6, $7, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [leadId, companyId, customerName, cleanPhone, description, address,
           JSON.stringify({ source: 'ai_voice', address, requested_appointment: startIso })]
        );
        console.log(`[Sarah CRM] Appointment: created Lead ${leadId} for ${customerName}`);
      }

      // 2) Idempotency — skip if a pending approval already exists for this lead/phone + time.
      const dupCheck = await pool.query(
        `SELECT id FROM generic_entities
         WHERE entity_type = 'ActionItem' AND company_id = $1
           AND data->>'type' = 'pending_appointment_approval'
           AND data->>'status' IN ('pending','snoozed')
           AND data#>>'{proposed_appointment,start_time}' = $2
           AND (data->>'related_lead_id' = $3 OR data#>>'{proposed_appointment,contact_phone}' = $4)
         LIMIT 1`,
        [companyId, startIso, leadId, cleanPhone]
      );
      if (dupCheck.rows.length > 0) {
        console.log('[Sarah CRM] Appointment approval already pending — skipping duplicate');
        return { success: true, message: `You're all set — I've already got that request in for our team to confirm. Anything else I can help with?` };
      }

      // 3) Create the pending-approval ActionItem (NO calendar event yet).
      const aiId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const proposed = { start_time: startIso, end_time: endTime.toISOString(), address, title, description, contact_phone: cleanPhone, contact_name: customerName };
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'ActionItem', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [aiId, companyId, JSON.stringify({
          id: aiId, company_id: companyId, type: 'pending_appointment_approval',
          title: `Confirm appointment: ${leadName}`,
          description: `${title} requested for ${friendlyTime}${address ? ` at ${address}` : ''}. Phone: ${cleanPhone || 'N/A'}. Approve to add it to the calendar.`,
          status: 'pending', priority: 'high', due_at: dueAt,
          related_lead_id: leadId, proposed_appointment: proposed,
          source: 'ai_voice', created_by: 'system', escalation_level: 0,
          created_at: new Date().toISOString(),
        })]
      );

      // Notify the team so they can confirm it.
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [notifId, companyId, JSON.stringify({
          id: notifId, company_id: companyId, type: 'appointment_request',
          title: `📅 Appointment to confirm — ${leadName}`,
          message: `${title} requested for ${friendlyTime}${address ? ` at ${address}` : ''}. Open Action Items to approve.`,
          is_read: false, priority: 'high', link_url: '/ActionItems',
          created_at: new Date().toISOString(),
        })]
      );
      console.log(`[Sarah CRM] Appointment pending approval created (${aiId}) for ${companyId}`);
      return { success: true, message: `Perfect — I've got you down for ${friendlyTime}. Someone from our team will give you a quick confirmation shortly. Anything else I can help with?` };
    } catch (e) {
      console.warn(`[Sarah CRM] Local ${action} failed:`, e.message);
      return { success: false, message: 'I had trouble noting that appointment. Let me take your details and have someone follow up.' };
    }
  }

  if (action === 'sendAlert' && companyId && data) {
    try {
      const pool = prodDb.getPool();
      const notifId = `notif_alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const urgency = data.urgency || 'medium';
      const notifData = {
        id: notifId,
        company_id: companyId,
        type: 'ai_alert',
        title: `${data.category ? '[' + data.category + '] ' : ''}Alert from AI${data.caller_name ? ': ' + data.caller_name : ''}`,
        message: data.message || '',
        caller_name: data.caller_name || '',
        caller_phone: data.caller_phone || '',
        urgency,
        is_read: false,
        priority: urgency === 'urgent' || urgency === 'high' ? 'high' : 'medium',
        created_at: new Date().toISOString()
      };
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [notifId, companyId, JSON.stringify(notifData)]
      );
      console.log(`[Sarah CRM] sendAlert saved LOCALLY as Notification: ${notifId}`);
    } catch (e) {
      console.warn('[Sarah CRM] Local sendAlert notification failed:', e.message);
    }
  }

  if (action === 'saveCallLog' && companyId && data) {
    try {
      const pool = prodDb.getPool();
      const commId = data.comm_id || `comm_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const durMins = data.duration_seconds ? Math.max(1, Math.round(data.duration_seconds / 60)) : null;
      const extraData = {
        call_sid: data.call_sid || '',
        twilio_sid: data.call_sid || '',
        transcription: data.transcript || '',
        transcript: data.transcript || '',
        assistant_name: data.assistant_name || 'AI Assistant',
        tool_calls_made: data.tool_calls_made || 0,
        source: 'ai_voice',
        live: false,
        screening_outcome: data.screening_outcome || null,
      };
      // UPSERT so a live in-progress row written mid-call by upsertLiveCallRecord
      // gets finalized here at hang-up instead of producing a duplicate.
      await pool.query(
        `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, contact_name, status, duration_minutes, data, created_at, updated_at)
         VALUES ($1,$2,'call','call',$3,$4,$5,'completed',$6,$7,NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET
           direction = EXCLUDED.direction,
           contact_phone = EXCLUDED.contact_phone,
           contact_name = EXCLUDED.contact_name,
           status = 'completed',
           duration_minutes = EXCLUDED.duration_minutes,
           data = communications.data || EXCLUDED.data,
           updated_at = NOW()`,
        [commId, companyId, data.direction || 'inbound', data.caller_phone || 'Unknown', data.caller_name || 'Voice Caller', durMins, JSON.stringify(extraData)]
      );
      console.log(`[Sarah CRM] saveCallLog saved LOCALLY to communications: ${commId} (${data.duration_seconds}s)`);
    } catch (e) {
      console.warn('[Sarah CRM] Local saveCallLog failed:', e.message);
    }
  }

  // Local: lookupByPhone — find company by Twilio number
  if (action === 'lookupByPhone') {
    try {
      const phone = data?.phone_number || '';
      const pool = prodDb.getPool();
      const norm = phone.replace(/[^\d+]/g, '').replace(/^(\d{10})$/, '+1$1').replace(/^1(\d{10})$/, '+1$1');
      const bare = norm.replace(/^\+1/, '');
      const { rows } = await pool.query(
        `SELECT c.id as company_id FROM generic_entities g
         JOIN companies c ON c.id = g.company_id OR c.base44_id = g.company_id
         WHERE g.entity_type = 'TwilioSettings'
           AND (g.data->>'main_phone_number' = $1 OR g.data->'available_numbers' ? $1 OR g.data->'available_numbers' ? $2)
         LIMIT 1`,
        [norm, bare]
      );
      if (rows[0]) {
        console.log(`[Sarah CRM] lookupByPhone LOCAL: ${phone} -> ${rows[0].company_id}`);
        return { success: true, company_id: rows[0].company_id, sarah_enabled: true };
      }
      const { rows: staffRows } = await pool.query(
        `SELECT company_id FROM staff_profiles WHERE twilio_number = $1 OR twilio_number = $2 LIMIT 1`,
        [norm, bare]
      );
      if (staffRows[0]) {
        console.log(`[Sarah CRM] lookupByPhone LOCAL (staff): ${phone} -> ${staffRows[0].company_id}`);
        return { success: true, company_id: staffRows[0].company_id, sarah_enabled: true };
      }
    } catch (e) { console.warn('[Sarah CRM] Local lookupByPhone error:', e.message); }
    return { success: false };
  }

  // Local: lookupStaffByTwilioNumber
  if (action === 'lookupStaffByTwilioNumber' && companyId) {
    try {
      const pool = prodDb.getPool();
      const tw = data?.twilio_number || '';
      const localCompanyId = companyId;
      let resolvedLocalId = localCompanyId;
      try {
        const { rows: compRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [localCompanyId]);
        if (compRows[0]) resolvedLocalId = compRows[0].id;
      } catch (e) {}
      const { rows } = await pool.query(
        `SELECT full_name, user_email, cell_phone, call_routing_mode, availability_status, data FROM staff_profiles WHERE (twilio_number = $1 OR twilio_number = $2) AND company_id = $3 LIMIT 1`,
        [tw, tw.replace(/^\+/, ''), resolvedLocalId]
      );
      if (rows[0]) {
        console.log(`[Sarah CRM] lookupStaffByTwilioNumber LOCAL: ${tw} -> ${rows[0].full_name}`);
        return { success: true, staff: { full_name: rows[0].full_name, email: rows[0].user_email, cell_phone: rows[0].cell_phone, call_routing_mode: rows[0].call_routing_mode, availability_status: rows[0].availability_status, data: rows[0].data || {} } };
      }
    } catch (e) { console.warn('[Sarah CRM] Local lookupStaffByTwilioNumber error:', e.message); }
    return { success: false };
  }

  // Local: getTwilioSettings
  if (action === 'getTwilioSettings' && companyId) {
    try {
      const pool = prodDb.getPool();
      const { rows: compRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = compRows[0]?.id || companyId;
      const { rows } = await pool.query(`SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`, [localId]);
      if (rows[0]?.data) {
        console.log(`[Sarah CRM] getTwilioSettings LOCAL for ${companyId}`);
        return { success: true, ...rows[0].data };
      }
    } catch (e) { console.warn('[Sarah CRM] Local getTwilioSettings error:', e.message); }
  }

  // Local: getAllSubscriberRouting
  if (action === 'getAllSubscriberRouting') {
    try {
      const pool = prodDb.getPool();
      const { rows: staffRows } = await pool.query(
        `SELECT sp.company_id, sp.full_name, sp.user_email, sp.cell_phone, sp.twilio_number,
                sp.call_routing_mode, sp.availability_status, sp.data as staff_data,
                COALESCE(a.data->>'brand_short_name', c.name) as company_name,
                ts.data as twilio_settings
         FROM staff_profiles sp
         JOIN companies c ON c.id = sp.company_id
         LEFT JOIN generic_entities a ON a.company_id = sp.company_id AND a.entity_type = 'AssistantSettings'
         LEFT JOIN generic_entities ts ON ts.company_id = sp.company_id AND ts.entity_type = 'TwilioSettings'
         WHERE sp.twilio_number IS NOT NULL AND sp.is_active = true`
      );
      const routing = {};
      const subscribers = [];
      for (const row of staffRows) {
        if (row.twilio_number) {
          const entry = {
            companyId: row.company_id, companyName: row.company_name || '',
            repName: row.full_name || '', repEmail: row.user_email || '',
            cellPhone: row.cell_phone || '', routingMode: row.call_routing_mode || 'sarah_answers',
            availabilityStatus: row.availability_status || 'available',
            twilioSid: row.twilio_settings?.account_sid || '',
            twilioToken: row.twilio_settings?.auth_token || '',
            data: row.staff_data || {},
          };
          routing[row.twilio_number] = entry;
          subscribers.push({
            phone_number: row.twilio_number,
            company_id: row.company_id,
            company_name: row.company_name || '',
            rep_name: row.full_name || '',
            rep_email: row.user_email || '',
            cell_phone: row.cell_phone || '',
            routing_mode: row.call_routing_mode || 'sarah_answers',
            availability_status: row.availability_status || 'available',
            twilio_sid: row.twilio_settings?.account_sid || '',
            twilio_token: row.twilio_settings?.auth_token || '',
            data: row.staff_data || {},
          });
        }
      }
      console.log(`[Sarah CRM] getAllSubscriberRouting LOCAL: ${subscribers.length} numbers`);
      return { success: true, routing, subscribers };
    } catch (e) { console.warn('[Sarah CRM] Local getAllSubscriberRouting error:', e.message); }
  }

  // Local: saveLead
  if (action === 'saveLead' && companyId) {
    try {
      const pool = prodDb.getPool();
      const { rows: compRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = compRows[0]?.id || companyId;
      const phone = (data?.phone || data?.caller_phone || '').replace(/[^\d+]/g, '');
      const callSid = data?.call_sid || '';
      const leadName = data?.name || data?.customer_name || '';
      const leadEmail = data?.email || '';
      const leadAssigned = data?.assigned_to || '';
      const leadService = data?.service_needed || '';
      const leadNotes = data?.notes || data?.address || '';
      const leadData = JSON.stringify({ source: 'sarah_ai', call_sid: callSid, ...data });

      // ONE lead per call — see the matching comment in vite-twilio-ws-plugin.js.
      // Alex saves details progressively and the early saves have no phone yet,
      // so phone-only matching created a duplicate lead per save.
      let existingId = null;
      if (callSid) {
        const bySid = await pool.query(
          `SELECT id FROM leads WHERE company_id = $1 AND data->>'call_sid' = $2 ORDER BY created_at LIMIT 1`,
          [localId, callSid]
        );
        existingId = bySid.rows[0]?.id || null;
      }
      if (!existingId && phone) {
        const byPhone = await pool.query(`SELECT id FROM leads WHERE company_id = $1 AND phone = $2 LIMIT 1`, [localId, phone]);
        existingId = byPhone.rows[0]?.id || null;
      }

      if (existingId) {
        await pool.query(
          `UPDATE leads SET
             name = CASE WHEN $3 <> '' THEN $3 ELSE name END,
             phone = CASE WHEN $4 <> '' THEN $4 ELSE phone END,
             email = CASE WHEN $5 <> '' THEN $5 ELSE email END,
             assigned_to = CASE WHEN $6 <> '' THEN $6 ELSE assigned_to END,
             service_needed = CASE WHEN $7 <> '' THEN $7 ELSE service_needed END,
             notes = CASE WHEN $8 <> '' THEN $8 ELSE notes END,
             data = COALESCE(data, '{}'::jsonb) || $9::jsonb,
             updated_at = NOW()
           WHERE id = $1 AND company_id = $2`,
          [existingId, localId, leadName, phone, leadEmail, leadAssigned, leadService, leadNotes, leadData]
        );
        console.log(`[Sarah CRM] saveLead LOCAL: enriched existing lead ${existingId} for ${localId}`);
        if (phone) invalidateCallerCache(localId, phone);
        return { success: true, leadId: existingId };
      }

      const leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await pool.query(
        `INSERT INTO leads (id, company_id, name, phone, email, source, status, assigned_to, service_needed, notes, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'sarah_ai', 'new', $6, $7, $8, $9, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [leadId, localId, leadName || 'Unknown Caller', phone, leadEmail, leadAssigned, leadService, leadNotes, leadData]
      );
      console.log(`[Sarah CRM] saveLead LOCAL: ${leadName || 'Unknown'} for ${localId}`);
      if (phone) invalidateCallerCache(localId, phone);
      return { success: true, leadId };
    } catch (e) { console.warn('[Sarah CRM] Local saveLead error:', e.message); }
  }

  // Local: trackCallMinutes
  if (action === 'trackCallMinutes' && companyId) {
    try {
      const pool = prodDb.getPool();
      const { rows: compRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = compRows[0]?.id || companyId;
      const minutes = Math.ceil((data?.duration_seconds || 0) / 60);
      const usageId = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
        [usageId, localId, JSON.stringify({ feature: 'voice_minutes', units: minutes, unit_cost: 0.02, total_cost: +(minutes * 0.02).toFixed(2), usage_month: new Date().toISOString().slice(0, 7) })]
      );
      console.log(`[Sarah CRM] trackCallMinutes LOCAL: ${minutes}min for ${localId}`);
      return { success: true };
    } catch (e) { console.warn('[Sarah CRM] Local trackCallMinutes error:', e.message); }
  }

  // Local: notifyRep
  if (action === 'notifyRep' && companyId) {
    try {
      const pool = prodDb.getPool();
      const { rows: compRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = compRows[0]?.id || companyId;
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [notifId, localId, JSON.stringify({ type: 'new_lead', title: data?.title || 'New lead from Alex', message: data?.message || '', is_read: false, created_at: new Date().toISOString() })]
      );
      console.log(`[Sarah CRM] notifyRep LOCAL for ${localId}`);
      return { success: true };
    } catch (e) { console.warn('[Sarah CRM] Local notifyRep error:', e.message); }
  }

  if (!BASE44_API_URL || !BRIDGE_SECRET) {
    console.warn('[Sarah CRM] API not configured');
    return { error: 'CRM not configured' };
  }
  try {
    const body = { action, companyId };
    if (data) body.data = data;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const resp = await fetch(BASE44_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BRIDGE_SECRET}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const text = await resp.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Non-JSON response (${resp.status})` }; }
  } catch (err) {
    console.error(`[Sarah CRM] ${action} failed:`, err.message);
    return { error: err.message };
  }
}

async function callLexiBridgeAPI(action, companyId, userEmail, data = null) {
  if (!LEXI_BRIDGE_API_URL || !LEXI_BRIDGE_SECRET) return { error: 'Not configured' };
  try {
    const body = { action, companyId, userEmail };
    if (data) body.data = data;
    const resp = await fetch(LEXI_BRIDGE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LEXI_BRIDGE_SECRET}` },
      body: JSON.stringify(body)
    });
    const text = await resp.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Non-JSON (${resp.status})` }; }
  } catch (err) { return { error: err.message }; }
}

function getBase44FunctionUrl(functionName) {
  if (!BASE44_API_URL) return null;
  return BASE44_API_URL.replace(/\/functions\/[^/]+$/, '/functions/') + functionName;
}

function serveStaticFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  return require('./lib/static-file.cjs').serveStaticFile(req, res, filePath, mime, ext === '.html');
}

const CRM_TOOLS = [
  { name: "save_lead_details", description: "Save caller's contact information as a lead. Also use this to record a message for a rep when a transfer can't go through — put the message in the notes field. When call screening is active, always set screening_outcome here for non-transfer outcomes.", parameters: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, service_needed: { type: "string" }, address: { type: "string" }, notes: { type: "string", description: "Freeform notes, e.g. a message to pass to a specific rep: \"Message for Kevin: roof leak. Callback: 555-123-4567.\"" }, assigned_to: { type: "string", description: "Email of rep to assign the lead to" }, screening_outcome: { type: "string", enum: ["approved", "self_handled", "declined"], description: "When call screening is active: set 'self_handled' if you booked/handled the call without transferring, 'declined' if you ended the call (solicitor/robocall). Only set 'approved' here if used without transfer_call." } }, required: ["name"] } },
  { name: "check_availability", description: "Check available appointment slots.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "book_appointment", description: "Book an appointment for the caller.", parameters: { type: "object", properties: { slot_time: { type: "string" }, name: { type: "string" }, email: { type: "string" }, description: { type: "string" } }, required: ["slot_time", "name"] } },
  { name: "send_alert", description: "Send an urgent alert to the business team.", parameters: { type: "object", properties: { message: { type: "string" }, caller_name: { type: "string" }, caller_phone: { type: "string" }, urgency: { type: "string" }, category: { type: "string" } }, required: ["message"] } },
  { name: "schedule_inspection", description: "Submit a roof inspection request for staff approval. This does NOT create a calendar event or confirm the appointment. Only call after checking availability and explicitly reading back the caller's full name, callback number, exact property address, exact date, and exact time, then receiving a clear confirmation. Never pass vague times such as 'tomorrow morning'.", parameters: { type: "object", properties: { date_time: { type: "string", description: "Exact date and time for the inspection, preferably ISO format; vague times are not allowed" }, customer_name: { type: "string", description: "Full name, read back and confirmed by the caller" }, customer_phone: { type: "string", description: "Callback phone number; use the caller's verified number when available" }, address: { type: "string", description: "Complete property address, read back and confirmed by the caller" }, notes: { type: "string", description: "Special notes about the inspection" }, assigned_to: { type: "string", description: "Staff member name or email to assign this inspection to" } }, required: ["date_time", "customer_name", "address"] } },
  { name: "notify_rep", description: "Send an SMS or WhatsApp notification to a specific sales rep about a new lead, appointment, or update.", parameters: { type: "object", properties: { rep_name: { type: "string", description: "Name of the rep to notify" }, rep_phone: { type: "string", description: "Phone number of the rep" }, message: { type: "string", description: "The notification message to send" }, notification_type: { type: "string", description: "Type: new_lead, inspection_scheduled, callback_request, general" } }, required: ["message"] } },
  { name: "transfer_call", description: "Transfer the current call to a staff member's cell phone. BEFORE calling this you MUST have already collected and confirmed THREE things: the caller's name, a callback phone number, and the reason for their call. Never transfer without all three. Use this when: 1) the caller asks to speak to a specific person by name (pass target_person), or 2) the call routing mode is sarah_then_transfer and you have gathered the caller's info. If the transfer cannot be completed, take a message instead of dropping the call. When call screening is active, always include screening_outcome.", parameters: { type: "object", properties: { reason: { type: "string", description: "The reason the caller is calling / why the call is being transferred" }, target_person: { type: "string", description: "Name of the specific staff member the caller wants to speak to (e.g. 'Vicky', 'Kevin'). Leave empty to transfer to the default rep." }, caller_name: { type: "string", description: "The caller's full name — must be collected and confirmed before transferring" }, callback_number: { type: "string", description: "A phone number to reach the caller back on — must be collected and confirmed before transferring" }, screening_outcome: { type: "string", enum: ["approved", "self_handled", "declined"], description: "Result of call screening: 'approved' if caller was screened and approved for transfer, 'self_handled' if inspection/appointment was booked directly without a transfer, 'declined' if call was ended (solicitor, robocall). Omit if screening is not enabled." } }, required: ["caller_name", "callback_number", "reason"] } },
  { name: "collect_caller_name", description: "Record the caller's name when they introduce themselves or say their name during the conversation. Call this as soon as you learn the caller's name so the call log can reference them by name instead of 'Voice Caller'.", parameters: { type: "object", properties: { name: { type: "string", description: "The caller's name as they stated it" } }, required: ["name"] } }
];

const VALID_GEMINI_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr'];

const BIAS = 0x84;
const CLIP = 32635;
const EXP_LUT = new Uint8Array([0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7]);

function mulawEncode(sample) {
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  const exponent = EXP_LUT[(sample >> 7) & 0xFF];
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

const MULAW_DECODE_TABLE = new Int16Array(256);
(function() {
  for (let i = 0; i < 256; i++) {
    const val = ~i & 0xFF;
    const sign = val & 0x80;
    const exponent = (val >> 4) & 0x07;
    const mantissa = val & 0x0F;
    let magnitude = ((mantissa << 3) + BIAS) << exponent;
    magnitude -= BIAS;
    MULAW_DECODE_TABLE[i] = sign ? -magnitude : magnitude;
  }
})();

function twilioToGemini(mulawB64) {
  const buf = Buffer.from(mulawB64, 'base64');
  const nSrc = buf.length;
  const pcm8k = new Int16Array(nSrc);
  for (let i = 0; i < nSrc; i++) pcm8k[i] = MULAW_DECODE_TABLE[buf[i]];
  const nDst = nSrc * 2;
  const pcm16 = new Int16Array(nDst);
  for (let i = 0; i < nSrc - 1; i++) {
    pcm16[i * 2] = pcm8k[i];
    pcm16[i * 2 + 1] = (pcm8k[i] + pcm8k[i + 1]) >> 1;
  }
  pcm16[nDst - 2] = pcm8k[nSrc - 1];
  pcm16[nDst - 1] = pcm8k[nSrc - 1];
  return Buffer.from(pcm16.buffer).toString('base64');
}

const LP_COEFFS = new Float64Array([0.0595, 0.0990, 0.1571, 0.2030, 0.2218, 0.2030, 0.1571, 0.0990, 0.0595]);
const LP_LEN = LP_COEFFS.length;
const LP_HALF = (LP_LEN - 1) >> 1;

function geminiToTwilio(pcmB64) {
  const buf = Buffer.from(pcmB64, 'base64');
  const nSrc = buf.length >> 1;
  const pcm = new Float64Array(nSrc);
  for (let i = 0; i < nSrc; i++) pcm[i] = buf.readInt16LE(i * 2);
  let prev = pcm[0];
  for (let i = 1; i < nSrc; i++) { const orig = pcm[i]; pcm[i] = orig - 0.4 * prev; prev = orig; }
  const ratio = 3;
  const nDst = Math.floor(nSrc / ratio);
  const out = Buffer.alloc(nDst);
  for (let i = 0; i < nDst; i++) {
    const center = i * ratio;
    let acc = 0;
    for (let k = 0; k < LP_LEN; k++) {
      const idx = center - LP_HALF + k;
      if (idx >= 0 && idx < nSrc) acc += pcm[idx] * LP_COEFFS[k];
    }
    out[i] = mulawEncode(Math.max(-32768, Math.min(32767, Math.round(acc))));
  }
  return out.toString('base64');
}

// Pre-computed 500ms typing-sound chunk (3 brief click pulses at 16kHz PCM, converted
// to Twilio mulaw 8kHz). Injected on loop while the AI processes the caller's utterance.
const TYPING_CHUNK_MULAW = (() => {
  const RATE = 16000;
  const samples = Math.floor(RATE * 0.5); // 500ms
  const buf = Buffer.alloc(samples * 2, 0);
  for (const clickMs of [80, 220, 360]) {
    const start = Math.floor(clickMs * RATE / 1000);
    const len = Math.floor(7 * RATE / 1000); // 7ms per click
    for (let i = 0; i < len && (start + i) < samples; i++) {
      const decay = Math.exp(-i / (len * 0.35));
      const noise = (Math.random() * 2 - 1);
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(3200 * decay * noise))), (start + i) * 2);
    }
  }
  return geminiToTwilio(buf.toString('base64'));
})();

const CUSTOMER_LEXI_VOICE_TOOLS = [
  {
    name: 'get_customer_public_progress',
    description: "Read only this caller's current project milestone and updates explicitly published for homeowners. Never request customer or project IDs. If multiple projects exist, ask which property address to check.",
    parameters: {
      type: 'object',
      properties: {
        property_address: { type: 'string', description: "The exact property address the caller provided, only to choose among their own projects." },
      },
      required: [],
    },
  },
  {
    name: 'request_customer_callback',
    description: 'Ask the office team to call this caller back. Use only when they request a person or accept a callback offer.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Brief reason for the requested callback.' } },
      required: ['reason'],
    },
  },
];

async function handleToolCall(functionCall, companyId, context = {}) {
  const { name, args } = functionCall;
  let parsedArgs = {};
  try { parsedArgs = typeof args === 'string' ? JSON.parse(args) : (args || {}); } catch (e) { parsedArgs = {}; }
  console.log(`[Sarah CRM] Tool: ${name}`, JSON.stringify(parsedArgs));
  switch (name) {
    case 'get_customer_public_progress': {
      if (!context.customerLexiVoiceEnabled || !context.callerPhone) {
        return { ok: false, reason: 'unverified_phone', voice_script: buildVoiceProgressScript({ ok: false, reason: 'unverified_phone' }) };
      }
      const progress = await getCustomerPublicProgress(
        prodDb.getPool(),
        companyId,
        context.callerPhone,
        parsedArgs.property_address || '',
      );
      return { ...progress, voice_script: buildVoiceProgressScript(progress) };
    }
    case 'request_customer_callback': {
      if (!context.customerLexiVoiceEnabled) return { success: false, message: 'Customer callback requests are unavailable on this line.' };
      const reason = String(parsedArgs.reason || '').trim().slice(0, 300);
      if (!reason) return { success: false, message: 'Ask what the caller would like the team to discuss.' };
      return callBase44API('sendAlert', companyId, {
        message: `Homeowner requested a callback: ${reason}`,
        caller_name: '',
        caller_phone: context.callerPhone || '',
        urgency: 'medium',
        category: 'callback_request',
      });
    }
    case 'save_lead_details': return callBase44API('saveLead', companyId, {
      ...parsedArgs,
      phone: parsedArgs.phone || parsedArgs.caller_phone || context.callerPhone || '',
      call_sid: context.callSid || ''
    });
    case 'check_availability': {
      const result = await callBase44API('checkAvailability', companyId);
      if (context.schedulingState && result && result.success !== false && !result.error) {
        context.schedulingState.availabilityChecked = true;
      }
      return result;
    }
    case 'book_appointment': return callBase44API('bookAppointment', companyId, parsedArgs);
    case 'send_alert': return callBase44API('sendAlert', companyId, parsedArgs);
    case 'schedule_inspection': {
      if (!context.schedulingState?.availabilityChecked) {
        return {
          success: false,
          requires_availability_check: true,
          message: 'Before I can submit an inspection request, I must check the calendar and offer a real available time. Ask for an exact date and time if needed, then call check_availability first.'
        };
      }
      if (context.schedulingState.submitted) {
        return {
          success: false,
          duplicate_request: true,
          message: 'This inspection request was already submitted during this call. Do not submit another one unless the caller clearly changes the confirmed date or time.'
        };
      }
      const result = await callBase44API('scheduleInspection', companyId, {
        ...parsedArgs,
        customer_phone: parsedArgs.customer_phone || context.callerPhone || '',
        call_sid: context.callSid || '',
      });
      if (result?.success && context.schedulingState) context.schedulingState.submitted = true;
      return result;
    }
    case 'notify_rep': return callBase44API('notifyRep', companyId, parsedArgs);
    case 'transfer_call': return { success: true, message: 'Transfer initiated' };
    case 'collect_caller_name': return { success: true, message: `Caller name recorded: ${parsedArgs.name || ''}` };
    default: return { error: `Unknown tool: ${name}` };
  }
}

const COMPANYSYNC_DEFAULT_KNOWLEDGE = `

KNOWLEDGE BASE — You MUST use this information when answering questions about CompanySync. Do NOT guess or invent details:

WHAT IS COMPANYSYNC:
CompanySync is an all-in-one roofing business management platform. It replaces spreadsheets, disconnected tools, and manual processes with a single system designed specifically for roofing contractors.

CORE FEATURES:
- CRM & Lead Management: Track every lead from first contact to signed contract. Storm-based lead generation, automated follow-ups, lead scoring, pipeline management.
- Estimates & Invoicing: Create professional estimates with material calculators, convert to invoices with one click, accept online payments via Stripe.
- Crew Management: Assign crews to jobs, track schedules, manage staff profiles and roles.
- PhotoSync (CrewCam AI Inspection): The app's field photo and roof inspection module. Crews take photos on-site to document roof damage. AI analysis identifies materials, detects hail/wind damage with bounding boxes, and measures severity. Also called CrewCam internally.
- Calendar & Scheduling: Built-in calendar with Google Calendar sync. Schedule inspections, appointments, and jobs. Automated reminders.
- Storm Tracking: Real-time NOAA severe weather monitoring. Track hail, wind, tornado events. Generate leads from storm-affected areas. Nationwide coverage.
- Contract Signing: Digital contract creation and e-signature. Send contracts for signing, track status, store signed documents.
- Communications: Track all calls, texts, and emails in one place. Integrated with Twilio for voice and SMS.

AI ASSISTANTS:
- Alex (AI Voice): Answers phone calls, qualifies leads, books inspections, handles customer inquiries 24/7. Uses Google Gemini speech-to-speech. Can make outbound follow-up calls. Customizable personality and knowledge base per company.
- Lexi (AI Chat): In-app AI chat assistant for CRM operations. Can look up customers, create tasks, check calendar, send emails — all through natural conversation.
- Marcus (AI Marketing): AI-powered marketing assistant. Generates social media content, email campaigns, and marketing strategies tailored to the roofing industry.

SUBSCRIPTION PLANS:
- Basic Plan: $49/month — CRM, estimates, invoicing, calendar, 1 user.
- Business Plan: $99/month — Everything in Basic plus AI assistants (Alex, Lexi, Marcus), crew management, storm tracking, unlimited users.
- Enterprise Plan: $199/month — Everything in Business plus priority support, custom integrations, advanced reporting, white-label options.
- All plans include a free trial period. No long-term contracts required.

INTEGRATIONS:
- Stripe for payment processing
- Twilio for voice calls and SMS
- Google Calendar for scheduling
- Google Maps for address geocoding
- NOAA for storm data
- Resend for transactional emails

WEBSITE: https://getcompanysync.com
SUPPORT: Available through the platform or by calling our main line.`;

const DEFAULT_TRANSFER_INSTRUCTIONS = `Don't transfer a call right away. First, get the caller's name, a good callback number, and the reason they're calling — ask for whatever you're missing, one question at a time, and confirm it back.
Once you have their name, callback number, and reason: if they asked for a specific person, check whether that person is available. If they're available, say "Let me connect you with [name] now" and transfer the call. If that person is marked unavailable, don't transfer — take a message instead.
If a transfer can't go through (there's no phone number on file for that person, or they don't pick up), do NOT hang up or start the conversation over. Apologize, take a message with the caller's name, callback number, and reason, and let them know that person will call them back as soon as possible.`;

function buildSystemPrompt(cName, aName, isOutbound, outboundLeadName, outboundLeadService, subscriberPrompt, companyDescription, companyKnowledge, forwardedInfo, routingMode, scenario, transferInstructions, screeningEnabled, screeningInstructions) {
  let prompt = '';

  if (scenario === 'saas_demo') {
    prompt = `IDENTITY & ROLE:
You are ${aName}, the Lead Sales Representative for CompanySync.io.
CompanySync is the "Roof Operating System" - the all-in-one CRM built specifically for roofing contractors.
Your goal is to GET THE ROOFER TO SUBSCRIBE or BOOK A DEMO.

VALUE PROPOSITION:
- All-in-One: Replaces JobNimbus, Acculynx, and ServiceTitan for just $99/month (flat rate).
- AI-Powered: Comes with an AI text assistant and "${aName}" (YOU - the AI voice receptionist).
- Speed: Sets up in 5 minutes. No 4-week onboarding.
- Features: AI Estimating, Storm Tracking, Mobile App, Automations, Payments.

CONVERSATION FLOW:
1. QUALIFY:
   - "Thanks for calling CompanySync! Are you currently running a roofing business?"
   - "How many crews or sales reps do you have?"
   - "What software are you using right now?"
2. PITCH:
   - If they use JobNimbus/Acculynx: "We replace them for a fraction of the cost, and we include the AI receptionist feature for free."
   - If they use nothing: "CompanySync is perfect for you. It organizes your leads, estimates, and jobs."
3. CLOSE:
   - Push for a live demo: "Want me to set up a quick demo? Takes 15 minutes and you'll see exactly how it works."
   - Or sign up: "You can start your free trial right now at getcompanysync.com."

RULES:
- Be enthusiastic but not pushy.
- Never mention being AI unless directly asked.
- ONE question at a time.
- Keep responses under 25 words.`;

  } else if (forwardedInfo && forwardedInfo.isForwarded && !subscriberPrompt) {
    const rName = forwardedInfo.repName || 'the team';
    const rEmail = forwardedInfo.repEmail || '';
    const isThenTransfer = routingMode === 'sarah_then_transfer';
    const step6 = isThenTransfer
      ? `6. Once you have their name, a callback number, and what they need, say "Let me connect you with ${rName} right now" — then call transfer_call. If the transfer can't go through (no number on file or no answer), take a message instead of dropping the call.`
      : `6. Let them know: "${rName} will follow up with you shortly."`;
    const assignRule = isThenTransfer
      ? '- TRANSFER IS YOUR PRIMARY GOAL: After getting the caller\'s name, callback number, and reason, call transfer_call. Only fall back to taking a message if the transfer cannot be completed.'
      : `- Assign EVERY lead to ${rName} (${rEmail || 'their account'}). Always use assigned_to.`;
    prompt = `You are ${aName}, the lead qualifier and office manager for ${cName}. You're picking up a call ${isThenTransfer ? 'for' : 'forwarded from'} ${rName}'s line.

Personality: Conversational, warm, and real. You sound like a person — not a script. Use contractions (you're, we're, it's, I'll). Vary your phrasing. Never say the same thing twice. Never mention being AI.

GREETING (vary each time — pick ONE, don't repeat):
- "Hey! You've reached ${cName}, I'm ${aName} picking up for ${rName}. What's going on?"
- "Hi there! This is ${aName} at ${cName} — ${rName}'s line. How can I help?"
- "Thanks for calling ${cName}! ${rName} stepped away so I've got you. What do you need?"

CALL FLOW:
1. Answer naturally — acknowledge what they say before asking anything.
2. If new lead: get their name first, then address, then what they need. One question at a time.
3. Save with save_lead_details (assigned_to="${rEmail || rName}") as soon as you have a name.
4. If they want scheduling: use schedule_inspection (assigned_to="${rEmail || rName}").
5. After capturing info: use notify_rep to alert ${rName} about the call.
${step6}

TRIAGE (answer first, then ask ONE follow-up):
- Leak? "Got it — is water coming in right now or is it an older issue?"
- Storm damage? "When did the storm hit? We can get someone out to take a look."
- Pricing? "We do free inspections — takes about 15 minutes. Want to schedule one?"
- Wants a meeting/demo (not inspection)? Use check_availability then book_appointment.
- General? Respond to what they said, then: "What's the best address for service?"

RULES:
${assignRule}
- ONE question at a time. Never stack questions.
- Don't say "How can I assist you further today?" — just help them naturally.
- If they give you info unprompted, save it immediately. Don't wait.
- When using notify_rep, include a clear message like: "New lead from [caller name] at [phone] — needs [service]. Appointment booked for [date/time]." so ${rName} has full context.

YOUR FIRST RESPONSE must be one of the greetings above — short, warm, under 20 words.`;

  } else if (isOutbound && !subscriberPrompt) {
    prompt = `You are ${aName}, the lead qualifier for ${cName}. You're making an OUTBOUND follow-up call.

Personality: Friendly, confident, not pushy. You're calling because they reached out — you're helping, not selling. Use contractions. Sound like a real person. Never mention being AI.

OPENING (vary — pick ONE):
- "Hi, this is ${aName} from ${cName}. Am I speaking with ${outboundLeadName || 'the homeowner'}?"
- "Hey ${outboundLeadName || 'there'}, it's ${aName} with ${cName} — just following up on your request."

CALL FLOW:
1. Confirm you're speaking to the right person.
2. Reference their inquiry: "I see you reached out about ${outboundLeadService || 'your roof'}. What's going on with it?"
3. Qualify: ask about the issue — storm damage, leak, age of roof, insurance claim. ONE question at a time.
4. Offer the inspection: "We do a free inspection — about 15 minutes, you get a full report. Want to set one up?"
5. If yes: use check_availability, then book_appointment. Confirm the address, date, and time.
6. If bad time: "No problem! I can call back or text you a link to book whenever works. What's easier?"

RULES:
- Never be pushy. If they're not interested, thank them and wrap up.
- Save or update their info with save_lead_details as you learn details.
- ONE question at a time. Acknowledge their answers before moving on.

YOUR FIRST RESPONSE must be one of the openings above — short, confident, under 20 words.`;

  } else if (subscriberPrompt) {
    prompt = subscriberPrompt;
  } else {
    prompt = `You are ${aName}, the lead qualifier and office manager for ${cName}.

Personality: Conversational, helpful, and human. You actually know things and share them naturally. Use contractions (you're, we're, it's). Vary your responses — don't repeat the same phrases. Never mention being AI.

GREETING (vary each time — pick ONE):
- "Hi, this is ${aName} with ${cName}. What can I do for you?"
- "Hey! You've reached ${cName}. I'm ${aName} — how can I help?"
- "Thanks for calling ${cName}! What's going on?"

CONVERSATION STYLE:
- Acknowledge what they say FIRST, then respond. Don't jump straight to questions.
- Ask ONE clarifying question max per turn. Never stack questions.
- Give specific answers — not generic "we can help with that" filler.
- If they tell you something, reference it back: "So you've got a leak near the chimney — that's pretty common after storms."

TRIAGE (answer first, then ask ONE follow-up):
- Leak: "Got it. Is water actively coming in, or is it more of a stain situation?"
- Storm/hail/wind damage: "When did the storm come through? We can get someone out to look."
- Missing shingles: "How many are we talking — a few or a larger section?"
- Pricing/estimate: "We do free inspections that take about 15 minutes. Want to schedule one?"
- General/other: Respond naturally, then: "What's the address for the property?"

EMERGENCY KEYWORDS: emergency, urgent, asap, flood, fire, 911
- If detected: use send_alert with urgency="urgent" IMMEDIATELY, then reassure the caller help is on the way.

SCHEDULING NOTE: For roof inspections, use schedule_inspection. For general meetings or demos, use check_availability then book_appointment.

YOUR FIRST RESPONSE must be one of the greetings above — short, warm, under 20 words.`;
  }

  prompt = prompt.replace(/\{agent\}/gi, aName).replace(/\{brand\}/gi, cName);
  if (aName.toLowerCase() !== 'sarah') prompt = prompt.replace(/\bSarah\b/gi, aName);
  if (cName.toLowerCase() !== 'companysync') prompt = prompt.replace(/\bCompanySync\b/gi, cName);

  // Replace any Gemini voice persona names that may have leaked into a custom prompt
  // (e.g. Aoede, Kore, Zephyr) or any first-person "I'm X" / "My name is X" patterns
  // where X differs from the configured assistant name. These cause the AI to introduce
  // itself by the voice model's internal persona name instead of the configured one.
  const GEMINI_VOICE_NAMES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr'];
  for (const vn of GEMINI_VOICE_NAMES) {
    if (vn.toLowerCase() !== aName.toLowerCase()) {
      prompt = prompt.replace(new RegExp(`\\b${vn}\\b`, 'gi'), aName);
    }
  }
  // Sanitize name-identity claims in custom prompts that could override the
  // configured assistant name. Covers "You are X", "I'm X", "I am X",
  // "My name is X", "Your name is X" where X is a proper name ≠ aName.
  // [A-Z][a-z]{2,14} only matches proper single-word names — it won't touch
  // "You are NOT…", "You are an expert…", "You are working in…" etc.
  prompt = prompt.replace(
    /\b(You are|I(?:'m| am)|[Mm]y name is|[Yy]our name is)\s+["']?([A-Z][a-z]{2,14})["']?/g,
    (match, prefix, name) => (name.toLowerCase() === aName.toLowerCase() ? match : `${prefix} ${aName}`)
  );
  // Log a warning if the subscriber prompt still contains any conflicting name assertion
  if (subscriberPrompt) {
    const nameInPrompt = subscriberPrompt.match(/\b(?:You are|I(?:'m| am)|[Mm]y name is|[Yy]our name is)\s+["']?([A-Z][a-z]{2,14})["']?/);
    if (nameInPrompt && nameInPrompt[1]?.toLowerCase() !== aName.toLowerCase()) {
      console.warn(`[${aName}] ⚠️  Subscriber prompt contains name "${nameInPrompt[1]}" but assistant is configured as "${aName}" — verify the custom system prompt does not override the assistant name`);
    }
  }

  prompt += `

VOICE RULES (non-negotiable):
- IDENTITY (non-negotiable): Your name is ${aName}. This overrides any name mentioned in the custom prompt, knowledge base, or any other instruction. Always introduce yourself as ${aName} — never as a different name.
- No internal thinking, reasoning, or markdown. Only say words you'd say out loud on a phone call.
- Keep responses under 25 words. Short and natural.
- NEVER speak for the caller or assume why they're calling. Do not mention leaks, storm damage, or any issue until the CALLER brings it up first.
- Ask ONE question, then STOP and wait for the caller to answer. NEVER answer your own question. NEVER continue as if the caller replied when they didn't.
- If you hear silence, background noise, or can't make out words, do NOT guess what was said. Wait quietly, or after a long silence ask "Are you still there?" — nothing more.
- Only respond to words you clearly heard the caller say. If in doubt, ask them to repeat it.
- LANGUAGE: Speak in whatever language the caller is using. If they speak Spanish, respond entirely in natural, fluent Spanish; if they switch languages, switch with them. Mirror the caller's language for the whole call — never announce that you're switching or translating.
- Never say "I am an AI" or "I'm an artificial intelligence" or reference being a bot.
- Never say "How can I assist you further today?" or similar robotic closers.
- Vary your responses. Don't repeat greetings, phrases, or patterns.
- Tone: warm but professional — like a polished front-desk receptionist at an established company. Composed and courteous, never goofy, slangy, or over-caffeinated. Use light, natural contractions and skip filler like "um", "totally", or "awesome".
- One thought at a time, calm and clear. Project quiet competence so the caller feels they're in good hands.
- Messages wrapped in [System: ...] or [System context: ...] are INTERNAL instructions, never words from the caller. NEVER read them aloud, quote them, or respond to them as if the caller said them — silently follow the instruction and continue the conversation naturally.

CRM TOOLS — use these automatically as info comes in:
- save_lead_details: Save as soon as caller shares name, phone, or what they need. Don't wait. Include service_needed describing their issue. Every caller should be tracked.
- check_availability → book_appointment: For scheduling. Always confirm with caller before booking.
- schedule_inspection: For roof inspection bookings. Include address and assigned_to if this is a forwarded call.
- notify_rep: Text a rep about new leads or appointments. Use after saving a lead or booking.
- send_alert: For complaints, emergencies, or messages for someone specific. Set urgency appropriately (urgent/high/medium). After sending, confirm to the caller.
- After ANY tool call, respond to the caller immediately. Never go silent.
- NEVER make up pricing, service details, warranties, timelines, or company facts. Use your knowledge base below. If you don't know something, say "Let me have someone get back to you on that" or "I'll make sure the right person follows up with those details."
- When a caller asks about services, pricing, or how things work, reference your knowledge base — don't guess.`;

  const isSarahOnly = routingMode === 'sarah_only';
  const transferBlock = isSarahOnly
    ? 'Transfers are DISABLED in this mode. Do NOT use transfer_call under any circumstances. If a caller asks to speak to someone, be honest without implying the person is gone: say something like "[Name] isn\'t taking calls directly on this line, but I can take a message and make sure they get right back to you." Never say the person is "unavailable" or "not available" — you simply handle their calls. Save their info with save_lead_details and send a notification with notify_rep.'
    : ((transferInstructions && transferInstructions.trim()) ? transferInstructions.trim() : DEFAULT_TRANSFER_INSTRUCTIONS);
  prompt += `

TRANSFER & MESSAGE HANDLING:
${transferBlock}

TAKING A MESSAGE (how, always): to take a message, use save_lead_details to save the caller's name, phone number, and reason (write the note as "Message for [person]: [reason]. Callback: [number]."), then use notify_rep to text that person so they follow up. After any tool call, respond to the caller out loud — never go silent, never end the call yourself.`;

  if (screeningEnabled) {
    const screeningRules = (screeningInstructions && screeningInstructions.trim())
      ? screeningInstructions.trim()
      : `- Ask the caller: "What's the reason for your call today?" before deciding what to do.\n- If they need an inspection or free estimate: book it directly using schedule_inspection — no transfer needed.\n- If they want to speak to a specific person and that person is available: gather their name, callback number, and reason, then use transfer_call.\n- If they're selling something, soliciting, or it's a robocall: politely decline and end the call.`;
    prompt += `\n\nCALL SCREENING — REQUIRED: Before transferring or booking, always learn the caller's reason for calling. Based on what they say:\n${screeningRules}\n\nAlways be courteous regardless of the outcome. If declining a call, say something like "Thanks for calling — we're not the right fit for that, but I hope you find what you need."\n\nSCREENING OUTCOME LOGGING (always do this when screening is active):\n- When you TRANSFER the call: pass screening_outcome='approved' in transfer_call.\n- When you HANDLE the call yourself (booked inspection, took message, etc.): pass screening_outcome='self_handled' in save_lead_details.\n- When you DECLINE/end the call (solicitor, robocall, etc.): pass screening_outcome='declined' in save_lead_details.\nYou MUST always record a screening_outcome before ending the call.`;
  }

  if (companyDescription) prompt += `\n\nAbout ${cName}:\n${companyDescription}`;
  if (companyKnowledge) {
    // Cap the knowledge block: an oversized system prompt measurably slows
    // the model's first token and buries the behavioral rules above.
    const MAX_KNOWLEDGE_CHARS = 6000;
    const kb = companyKnowledge.length > MAX_KNOWLEDGE_CHARS
      ? companyKnowledge.slice(0, MAX_KNOWLEDGE_CHARS) + '\n[...knowledge truncated]'
      : companyKnowledge;
    if (companyKnowledge.length > MAX_KNOWLEDGE_CHARS) {
      console.log(`[${aName}] Knowledge base truncated: ${companyKnowledge.length} → ${MAX_KNOWLEDGE_CHARS} chars`);
    }
    prompt += `\n\nCRITICAL IDENTITY RULE: You work for ${cName}. ${cName} is NOT a software company or platform. Do NOT confuse ${cName} with CompanySync (the CRM software). Describe ${cName} ONLY using the knowledge base below.\n\nNAME REMINDER: Your name is ${aName}. The knowledge base below is for business facts only — it may mention other names for context, but your name on this call is always ${aName}.\n\nKNOWLEDGE BASE — You MUST use this information when answering questions about ${cName}. Do NOT guess or invent details. If a caller asks about services, pricing, warranties, process, or anything covered below, use these facts exactly. If the answer isn't here, say you'll have someone follow up:\n${kb}`;
  } else if (cName.toLowerCase().includes('companysync') || cName.toLowerCase().includes('company sync')) {
    prompt += COMPANYSYNC_DEFAULT_KNOWLEDGE;
  }
  return prompt;
}

const LEXI_CRM_TOOLS = [
  { name: "get_build_schedule", description: "List Build Schedule entries for build/install questions, with optional customer, status, job type, and date filters.", parameters: { type: "object", properties: { customer_id: { type: "string" }, customer_name: { type: "string" }, status: { type: "string" }, job_type: { type: "string" }, date_from: { type: "string" }, date_to: { type: "string" }, limit: { type: "integer" } } } },
  { name: "create_build_schedule", description: "Prepare or confirm a Build Schedule build/install. The first call never writes; repeat with confirmation_token only after the user confirms the exact customer and date.", parameters: { type: "object", properties: { customer_id: { type: "string" }, customer_name: { type: "string" }, build_date: { type: "string" }, job_types: { type: "array", items: { type: "string" } }, address: { type: "string" }, customer_phone: { type: "string" }, customer_email: { type: "string" }, rep: { type: "string" }, crew: { type: "array", items: { type: "string" } }, assigned_to: { type: "array", items: { type: "string" } }, notes: { type: "string" }, status: { type: "string" }, confirmation_token: { type: "string" } }, required: ["build_date", "job_types"] } },
  { name: "get_crm_data", description: "Get CRM data counts/details.", parameters: { type: "object", properties: { data_type: { type: "string", enum: ["customers","leads","estimates","invoices","tasks","projects","payments","staff","calendar_events"] }, filters: { type: "object", description: "Optional filters for leads/customers: city, state, status, assigned_to, lead_source", properties: { city: { type: "string" }, state: { type: "string" }, status: { type: "string" }, assigned_to: { type: "string" }, lead_source: { type: "string" } } } }, required: ["data_type"] } },
  { name: "get_calendar_events", description: "Get calendar events for date range.", parameters: { type: "object", properties: { start_date: { type: "string" }, end_date: { type: "string" } }, required: ["start_date"] } },
  { name: "create_calendar_event", description: "Create a calendar event. Use event_type 'reminder' when the user asks to be reminded; reminders are non-blocking alerts. When an appointment conflict is returned, retry only after an explicit confirmation using an offered alternative and its confirmation token.", parameters: { type: "object", properties: { title: { type: "string" }, start_time: { type: "string" }, end_time: { type: "string" }, location: { type: "string" }, description: { type: "string" }, event_type: { type: "string", description: "Use 'reminder' for a personal reminder; otherwise meeting, appointment, call, or inspection." }, attendees: { type: "string" }, email_reminder_minutes: { type: "integer", description: "Send email reminder X minutes before (e.g. 60=1hr, 120=2hrs)" }, sms_reminder_minutes: { type: "integer", description: "Send SMS reminder X minutes before" }, browser_reminder_minutes: { type: "integer", description: "Send browser notification X minutes before" }, assigned_to: { type: "string", description: "Tenant staff email assigned to the event." }, confirmation_token: { type: "string", description: "Required only to confirm an offered alternative." }, customer_id: { type: "string", description: "Tenant-owned customer to notify after confirmation." }, lead_id: { type: "string", description: "Tenant-owned lead to notify after confirmation." }, reschedule_sms_message: { type: "string", description: "Text sent only after the confirmed event is booked." }, not_a_build_token: { type: "string", description: "Only valid after this tool returned BUILD_ROUTE_REQUIRED with a retry_token. Echo that retry_token here, with the same title and start_time, when the event genuinely is a meeting, walkthrough, or inspection rather than an installation job. Never use it to force a real build through." } }, required: ["title","start_time"] } },
  { name: "create_task", description: "Create a CRM task.", parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, assigned_to: { type: "string" }, due_date: { type: "string" }, priority: { type: "string" } }, required: ["name"] } },
  { name: "route_lead_to_sequence", description: "Prepare enrollment of one company-owned lead in an active follow-up sequence. Requires explicit caller confirmation before enrollment.", parameters: { type: "object", properties: { lead_id: { type: "string" }, sequence_name: { type: "string" } }, required: ["lead_id","sequence_name"] } },
  { name: "trigger_document_packet", description: "Prepare a restoration document packet for a company-owned lead or customer. Requires explicit caller confirmation before sending.", parameters: { type: "object", properties: { recipient_type: { type: "string", enum: ["lead","customer"] }, recipient_id: { type: "string" }, channel: { type: "string", enum: ["email","sms"] }, estimate_id: { type: "string" }, inspection_id: { type: "string" }, material_list_id: { type: "string" }, document_id: { type: "string" }, matching_note: { type: "string" } }, required: ["recipient_type","recipient_id","channel"] } },
  { name: "dispatch_team_notification", description: "Create and notify a structured operational ticket for one verified active company teammate.", parameters: { type: "object", properties: { assignee: { type: "string" }, title: { type: "string" }, context_note: { type: "string" }, priority: { type: "string", enum: ["low","medium","high"] }, due_date: { type: "string" }, lead_id: { type: "string" }, customer_id: { type: "string" } }, required: ["assignee","title","context_note"] } },
  { name: "confirm_lexi_orchestration", description: "Complete a previously prepared sequence enrollment or packet only after the caller explicitly approves it.", parameters: { type: "object", properties: { confirmation_token: { type: "string" } }, required: ["confirmation_token"] } },
  { name: "create_lead", description: "Create a CRM lead.", parameters: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, street: { type: "string" }, city: { type: "string" }, state: { type: "string" }, zip: { type: "string" }, notes: { type: "string" }, source: { type: "string" } }, required: ["name"] } },
  { name: "create_customer", description: "Create a CRM customer.", parameters: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, street: { type: "string" }, city: { type: "string" }, state: { type: "string" }, zip: { type: "string" }, notes: { type: "string" } }, required: ["name"] } },
  { name: "send_email", description: "Compose email to customer/lead.", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, message: { type: "string" }, contact_name: { type: "string" } }, required: ["to","subject","message"] } },
  { name: "send_sms", description: "Compose text message.", parameters: { type: "object", properties: { to: { type: "string" }, message: { type: "string" }, contact_name: { type: "string" } }, required: ["to","message"] } },
  { name: "save_memory", description: "Save a personal preference or work-style detail the user shares about THEMSELVES so it is remembered in future conversations (e.g. 'I always add 15% waste', 'I prefer afternoon appointments'). NOT for facts about customers or leads.", parameters: { type: "object", properties: { key: { type: "string", description: "Short label for the preference" }, value: { type: "string", description: "The preference itself" }, importance: { type: "integer", description: "1-10, default 5" }, category: { type: "string", description: "Usually 'lexi' (default)" } }, required: ["key","value"] } },
  { name: "manage_entity", description: "CRUD any CRM entity.", parameters: { type: "object", properties: { entity_action: { type: "string", enum: ["create","update","delete","list"] }, entity_name: { type: "string" }, entity_data: { type: "object" }, entity_id: { type: "string" } }, required: ["entity_action","entity_name"] } },
  { name: "assign_inspection", description: "Create/assign a CrewCam inspection.", parameters: { type: "object", properties: { client_name: { type: "string" }, client_phone: { type: "string" }, client_email: { type: "string" }, property_address: { type: "string" }, assigned_to_email: { type: "string" }, inspection_date: { type: "string" }, inspection_time: { type: "string" }, damage_type: { type: "string" }, special_instructions: { type: "string" }, create_calendar_event: { type: "boolean" }, create_lead: { type: "boolean" } }, required: ["client_name","property_address","assigned_to_email"] } },
  { name: "get_storm_alerts", description: "Get recent storm alerts and weather events in the company service area. Use for hail, tornado, thunderstorm, wind, or other storm activity questions.", parameters: { type: "object", properties: { days_back: { type: "integer", description: "How many days to look back (default 30)" }, event_types: { type: "string", description: "Comma-separated types to filter (e.g. tornado,hail,thunderstorm,high_wind,winter_storm)" }, active_only: { type: "boolean", description: "Only show active/ongoing alerts" }, area_filter: { type: "string", description: "Filter by area name, county, or city" } } } },
  { name: "find_subcontractors", description: "Search and rank subcontractor crews by service area, work radius, specialty, active status, and rating. Use before suggesting a crew; also call get_build_schedule for a requested date before confirming availability.", parameters: { type: "object", properties: { area: { type: "string", description: "City, state, zip, or territory name to search within" }, specialty: { type: "string", description: "Optional trade specialty to filter by (e.g. Roofing, Siding, Gutters)" } } } },
  { name: "add_staff_member", description: "Add a new staff member / team member to the company. Note: staff are always added WITHOUT admin access; an existing admin must grant admin rights in Settings.", parameters: { type: "object", properties: { full_name: { type: "string", description: "Full name" }, email: { type: "string", description: "Email address for login" }, phone: { type: "string" }, role: { type: "string", description: "Role/position (e.g. Sales Rep, Inspector, Project Manager)" } }, required: ["full_name","email"] } },
  { name: "add_family_commission_member", description: "Add a new FAMILY COMMISSION member — a person who receives automatic round-robin commissions from sales. Use this when the user says 'add as family commission member/participant', 'add to family commissions', 'add [name] as family commission', etc. This writes to the Family Commissions module, NOT the staff list. Required: full_name, email.", parameters: { type: "object", properties: { full_name: { type: "string", description: "Full name" }, email: { type: "string", description: "Email address" }, phone: { type: "string", description: "Phone number (optional)" }, commission_percentage: { type: "number", description: "Commission percentage 0-100 (default 1)" }, notes: { type: "string", description: "Optional notes" } }, required: ["full_name","email"] } },
  { name: "get_activity_log", description: "Query the Global Activity Log — a chronological feed of ALL actions across the CRM (leads, communications, estimates, invoices, tasks, customers, workflow executions). Use when the user asks what have we done, what is happening, show recent activity, or any org-wide recent-history question.", parameters: { type: "object", properties: { limit: { type: "number", description: "Number of recent events to return (default 20, max 50)" }, module: { type: "string", enum: ["leads","communications","estimates","invoices","tasks","customers","workflow","all"], description: "Filter to a specific module. Omit or use all for everything." }, days: { type: "number", description: "Only return events from the last N days (optional)" } } } },
  { name: "get_financial_summary", description: "Calculate revenue totals and payment summaries for a time period. Use when the user asks how much money did we make this week/month/year, total invoices for this year, revenue summary, how much have we collected, or any question about money, revenue, or income for a period.", parameters: { type: "object", properties: { period: { type: "string", enum: ["this_week","this_month","last_month","this_year","last_7_days","last_30_days","custom"], description: "Time period to summarize (default: this_month)" }, start_date: { type: "string", description: "ISO date YYYY-MM-DD for custom period start" }, end_date: { type: "string", description: "ISO date YYYY-MM-DD for custom period end, defaults to today" } } } },
  { name: "get_staff_sales_summary", description: "Get sales for a specific staff member OR compare the whole team ranked by sales. Use for 'how much did [name] sell', '[name]s sales this month', 'who sold the most last month', 'show me everyones sales', 'team sales leaderboard', 'compare all reps', 'rank our salespeople', 'who is our top performer' — omit staff_name or pass 'all'/'everyone' to get a ranked leaderboard of the entire team.", parameters: { type: "object", properties: { staff_name: { type: "string", description: "Name of the staff member / sales rep to look up. Omit or pass 'all'/'everyone' to get a ranked leaderboard of the entire team." }, period: { type: "string", enum: ["this_week","this_month","last_month","this_year","last_7_days","last_30_days","all_time","custom"], description: "Time period to summarize (default: this_month)" }, start_date: { type: "string", description: "ISO date YYYY-MM-DD for custom period start" }, end_date: { type: "string", description: "ISO date YYYY-MM-DD for custom period end, defaults to today" } } } },
  { name: "add_note", description: "Add a note to a customer or lead. Provide note_text plus either a customer_name/lead_name (Lexi will look up the record) or a customer_id/lead_id.", parameters: { type: "object", properties: { note_text: { type: "string", description: "The note content" }, customer_name: { type: "string", description: "Customer name to attach the note to (fuzzy matched)" }, customer_id: { type: "string" }, lead_name: { type: "string", description: "Lead name to attach the note to (fuzzy matched)" }, lead_id: { type: "string" } }, required: ["note_text"] } },
  { name: "get_photosync_jobs", description: "Look up PhotoSync inspection jobs (also called CrewCam jobs). Use when user asks about photosync, inspections, inspection jobs, crew photo jobs, job status, or photo documentation.", parameters: { type: "object", properties: { status: { type: "string", description: "Filter by status (e.g. scheduled, completed, in_progress, or all)" }, limit: { type: "number", description: "Number of jobs to return (default 10, max 50)" }, days_back: { type: "number", description: "Only return jobs created within the last N days" } } } },
  { name: "find_claim_documents", description: "Search the company's saved rebuttal letters, supplier letters, insurance matching letters, and claim-support email templates. Use when the user asks 'do we have a letter for [topic]', 'find our [supplier] letter', 'show me the rebuttal for [issue]', 'pull up our 3-tab discontinuation letter', 'do we have anything on [shingle brand]', or any request for a claim-support document or email template. Searches Email Templates (insurance_rebuttals, matching_letters) and Documents (supplier_letters, rebuttal_docs).", parameters: { type: "object", properties: { query: { type: "string", description: "Keyword(s) to search — e.g. '3-tab', 'ABC Supply', 'wind mitigation'. Leave blank to list all." }, type: { type: "string", enum: ["all","email_templates","documents"], description: "Which source: email_templates, documents, or all (default)." } } } },
  { name: "scan_check", description: "Scan a check photo using AI vision and automatically record the payment for a customer. Use IMMEDIATELY when the user provides a check image URL and says 'scan this check', 'process this check', 'record this check payment', or similar. Extracts amount, check number, date, and payer name, then records a Payment and Document.", parameters: { type: "object", properties: { file_url: { type: "string", description: "URL of the uploaded check image" }, customer_name: { type: "string", description: "Customer name (fuzzy matched if customer_id not provided)" }, customer_id: { type: "string", description: "Customer ID (preferred if already known)" } }, required: ["file_url"] } },
  { name: "record_payment", description: "Record a payment for a customer or invoice. Use when the user says 'record a payment', 'mark invoice as paid', 'customer paid', 'log a payment', 'they paid by cash/check/card', etc. Can link to a specific invoice by invoice number. Use scan_check instead when a check photo is attached.", parameters: { type: "object", properties: { amount: { type: "number", description: "Payment amount in dollars (e.g. 1500.00)" }, payment_method: { type: "string", enum: ["cash","check","credit_card","bank_transfer","paypal","stripe","other"], description: "How the payment was made. Optional — defaults to 'other' if not specified. Use credit_card for debit; bank_transfer for ACH/wire." }, customer_name: { type: "string", description: "Customer name (fuzzy matched). Provide this OR customer_id." }, customer_id: { type: "string", description: "Customer ID (preferred if already known)" }, invoice_number: { type: "string", description: "Invoice number to link this payment to (e.g. INV-2025-0042)" }, payment_date: { type: "string", description: "Payment date YYYY-MM-DD (defaults to today)" }, reference_number: { type: "string", description: "Check number, transaction ID, or other reference" }, notes: { type: "string", description: "Optional notes about the payment" } }, required: ["amount"] } },
  { name: "read_emails", description: "Search and list emails in the company Gmail inbox. Use when user asks to check email, show new emails, find emails from someone, search inbox, read messages, etc. Only works if Gmail is connected by the owner in Settings.", parameters: { type: "object", properties: { query: { type: "string", description: "Gmail search query (e.g. 'from:john@example.com', 'subject:invoice', 'is:unread', 'newer_than:7d'). Default: in:inbox." }, limit: { type: "number", description: "Max emails to return (default 10, max 10)" }, unread_only: { type: "boolean", description: "Only return unread emails" } } } },
  { name: "get_email", description: "Get the full content of a specific email by ID. Use after read_emails when the user wants to read an email's full body.", parameters: { type: "object", properties: { email_id: { type: "string", description: "Email message ID (from read_emails results)" } }, required: ["email_id"] } },
  { name: "reply_to_email", description: "Reply to an email thread. Use when user says 'reply to that email', 'send a reply', 'respond to that message'. Always retrieve the email first via get_email before replying.", parameters: { type: "object", properties: { email_id: { type: "string", description: "Message ID to reply to" }, body: { type: "string", description: "Reply body text (plain text)" } }, required: ["email_id","body"] } },
  { name: "mark_email_read", description: "Mark an email as read. Use after viewing an email when the user wants to clear it from unread.", parameters: { type: "object", properties: { email_id: { type: "string", description: "Message ID to mark as read" } }, required: ["email_id"] } }
];

async function getGmailTokenForCompany(pool, companyId) {
  const res = await pool.query(
    `SELECT u.gmail_access_token, u.gmail_refresh_token, u.gmail_token_expires_at, u.gmail_email, u.email
     FROM users u
     JOIN companies c ON LOWER(c.created_by) = LOWER(u.email)
     WHERE c.id = $1 AND u.gmail_connected = true AND u.gmail_access_token IS NOT NULL
     LIMIT 1`,
    [String(companyId)]
  );
  if (res.rows.length === 0) return null;
  const u = res.rows[0];
  let token = u.gmail_access_token;
  const expiry = u.gmail_token_expires_at;
  if (expiry && new Date(expiry) < new Date() && u.gmail_refresh_token) {
    try {
      const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '', refresh_token: u.gmail_refresh_token, grant_type: 'refresh_token' })
      });
      const rd = await refreshResp.json();
      if (!rd.error && rd.access_token) {
        token = rd.access_token;
        const newExp = new Date(Date.now() + (rd.expires_in * 1000)).toISOString();
        await pool.query('UPDATE users SET gmail_access_token = $1, gmail_token_expires_at = $2, updated_at = NOW() WHERE email = $3', [token, newExp, u.email]);
      }
    } catch (refErr) { console.warn('[Gmail] Token refresh failed:', refErr.message); }
  }
  return { token, gmail_email: u.gmail_email, user_email: u.email };
}
async function gmailApiCall(token, path, method, body) {
  method = method || 'GET';
  const opts = { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gmail API error ${resp.status}`);
  }
  return resp.json();
}

// Extract a bare email address from a Gmail "From" header value such as
// "John Smith <john@example.com>" or bare "john@example.com", then
// fuzzy-match it against the company's customers and leads tables.
// Returns { entity_type, id, name, status, phone, email } or null.
async function findCrmContactByEmail(pool, companyId, rawFrom) {
  if (!rawFrom || !companyId) return null;
  const angleMatch = rawFrom.match(/<([^>]+)>/);
  const bareMatch = rawFrom.match(/([^\s<>,;"]+@[^\s<>,;"]+)/);
  const addr = ((angleMatch?.[1] || bareMatch?.[1]) || '').toLowerCase().trim();
  if (!addr || !addr.includes('@')) return null;
  try {
    const cRes = await pool.query(
      `SELECT id, name, status, phone, email FROM customers WHERE company_id = $1 AND LOWER(TRIM(email)) = $2 LIMIT 1`,
      [companyId, addr]
    );
    if (cRes.rows.length > 0) {
      const c = cRes.rows[0];
      return { entity_type: 'customer', id: c.id, name: c.name, status: c.status || null, phone: c.phone || null, email: c.email };
    }
    const lRes = await pool.query(
      `SELECT id, name, status, phone, email FROM leads WHERE company_id = $1 AND LOWER(TRIM(email)) = $2 LIMIT 1`,
      [companyId, addr]
    );
    if (lRes.rows.length > 0) {
      const l = lRes.rows[0];
      return { entity_type: 'lead', id: l.id, name: l.name, status: l.status || null, phone: l.phone || null, email: l.email };
    }
  } catch (_) { /* best-effort — never block email reads */ }
  return null;
}

async function handleLexiToolCall(functionCall, companyId, userEmail, companyTimezone, confirmationState = null) {
  const { name, args } = functionCall;
  let a = {};
  try { a = typeof args === 'string' ? JSON.parse(args) : (args || {}); } catch (e) { a = {}; }
  const pool = prodDb.getPool();
  const { accessDenied: lexiAccessDenied, buildLexiAccessPolicy, canUseCrmDataType, isPermittedRepTool, isRestrictedRepTool, ownRecordCondition } = require('./lib/lexiAccessPolicy.cjs');
  const [companyRes, staffRes] = await Promise.all([
    pool.query('SELECT created_by FROM companies WHERE id = $1 LIMIT 1', [companyId]),
    pool.query(`SELECT * FROM staff_profiles WHERE company_id = $1 AND LOWER(COALESCE(user_email, email, '')) = LOWER($2) LIMIT 1`, [companyId, userEmail]),
  ]);
  const lexiAccess = buildLexiAccessPolicy({ company: companyRes.rows[0], userProfile: staffRes.rows[0], effectiveEmail: userEmail });
  const isAdmin = lexiAccess.isAdmin;
  const genId = () => 'loc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
  console.log(`[Lexi Tool] ${name} called by ${userEmail} for ${companyId}`, JSON.stringify(a).substring(0, 200));

  // Helper: compute current UTC offset for a timezone (e.g. "-04:00" for EDT)
  const getUtcOffset = (tz = 'America/New_York') => {
    try {
      const now = new Date();
      const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
      const tzStr  = now.toLocaleString('en-US', { timeZone: tz });
      const diffMin = Math.round((new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000);
      const sign = diffMin >= 0 ? '+' : '-';
      const abs = Math.abs(diffMin);
      return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    } catch { return '-04:00'; }
  };
  const tzOffset = getUtcOffset(companyTimezone || 'America/New_York');

  try {
    if (!isAdmin && !isPermittedRepTool(name)) {
      return lexiAccessDenied('I can help with your assigned CRM records and personal calendar, but this company-wide or cross-record action requires an administrator.');
    }
    switch (name) {

      case 'get_build_schedule': {
        const limit = Math.min(Math.max(Number(a.limit) || 20, 1), 50);
        const params = [companyId]; let where = `entity_type='BuildSchedule' AND company_id=$1`;
        const add = (sql, v) => { params.push(v); where += ` AND ${sql.replace('?', '$' + params.length)}`; };
        if (a.customer_id) add(`data->>'customer_id'=?`, a.customer_id);
        if (a.customer_name) add(`data->>'customer_name' ILIKE ?`, `%${a.customer_name}%`);
        if (a.status) add(`LOWER(COALESCE(data->>'status',''))=LOWER(?)`, a.status);
        if (a.job_type) add(`LOWER(COALESCE(data->>'job_type','')) LIKE LOWER(?)`, `%${a.job_type}%`);
        if (a.date_from) add(`data->>'build_date'>=?`, a.date_from);
        if (a.date_to) add(`data->>'build_date'<=?`, a.date_to);
        if (!isAdmin) { params.push(userEmail, userEmail, userEmail); const p = params.length; where += ` AND (LOWER(COALESCE(data->>'created_by',''))=LOWER($${p-2}) OR LOWER(COALESCE(data->>'rep_email',''))=LOWER($${p-1}) OR COALESCE(data->'assigned_to_users','[]'::jsonb) @> jsonb_build_array(to_jsonb($${p}::text)))`; }
        const r = await pool.query(`SELECT id,data FROM generic_entities WHERE ${where} ORDER BY data->>'build_date' ASC NULLS LAST LIMIT ${limit}`, params);
        return { success: true, count: r.rows.length, builds: r.rows.map(x => { const b=x.data||{}; return { id:x.id, customer_name:b.customer_name, build_date:b.build_date, status:b.status, job_type:b.job_type||[], address:b.address, rep:b.rep, crew:b.crew||b.assigned_to||[], notes:b.notes||null }; }) };
      }

      case 'create_build_schedule': {
        const types = Array.isArray(a.job_types) ? a.job_types.filter(Boolean) : (a.job_type ? [a.job_type] : []);
        if (!(a.customer_id || a.customer_name) || !a.build_date || !types.length) return { error: 'Build requires customer_name or customer_id, build_date, and one or more job_types.' };
        try { assertBuildDate(a.build_date); } catch (e) { return { error: e.message }; }
        const q = a.customer_id
          ? await pool.query(`SELECT id,name,phone,email,address FROM customers WHERE id=$1 AND company_id=$2 LIMIT 1`, [a.customer_id,companyId])
          : await pool.query(`SELECT id,name,phone,email,address FROM customers WHERE company_id=$1 AND regexp_replace(name, '\\s+', ' ', 'g') ILIKE $2${isAdmin ? '' : ` AND (LOWER(COALESCE(assigned_to,''))=LOWER($3) OR COALESCE(assigned_to_users,'[]'::jsonb) @> jsonb_build_array(to_jsonb($3::text)))`} ORDER BY name LIMIT 3`, isAdmin ? [companyId,`%${String(a.customer_name || '').trim().replace(/\s+/g, ' ')}%`] : [companyId,`%${String(a.customer_name || '').trim().replace(/\s+/g, ' ')}%`, userEmail]);
        if (!a.customer_id && q.rows.length > 1) return { success: false, code: 'CUSTOMER_AMBIGUOUS', error: 'More than one customer matches that name. Please ask which customer they mean.', candidates: q.rows.map(row => ({ id: row.id, name: row.name })) };
        let c=q.rows[0];
        if (!c) return { error: 'Customer was not found in this company.' };
        const canUseConfirmation = confirmationState
          ? Boolean(
              confirmationState.pendingToken &&
              a.confirmation_token === confirmationState.pendingToken &&
              /^(yes|yeah|yep|yup|sure|okay|ok|go ahead|do it|confirm|confirmed)(\b|[\s,.!])/i.test(String(confirmationState.userReply || '').trim())
            )
          : Boolean(a.confirmation_token);
        const confirmation = buildScheduleConfirmationGuard({
          companyId, userEmail, action: 'create', customerId: c.id,
          customerName: c.name, buildDate: a.build_date, jobTypes: types,
        }, canUseConfirmation ? a.confirmation_token : undefined);
        if (confirmation) {
          if (confirmationState) {
            confirmationState.pendingToken = confirmation.confirmation_token;
            confirmationState.userReply = '';
          }
          return confirmation;
        }
        if (confirmationState) {
          confirmationState.pendingToken = null;
          confirmationState.userReply = '';
        }
        const id=genId(), assigned=isAdmin ? (Array.isArray(a.assigned_to)?a.assigned_to:[a.assigned_to||userEmail]) : [userEmail];
        const data={id,company_id:companyId,customer_id:c.id,customer_name:c.name,build_date:a.build_date,job_type:types,address:a.address||c.address||'',customer_phone:a.customer_phone||c.phone||'',customer_email:a.customer_email||c.email||'',rep:isAdmin?(a.rep||userEmail):userEmail,rep_email:userEmail,crew:a.crew||[],assigned_to:assigned,assigned_to_users:assigned,notes:a.notes||'',status:a.status||'scheduled',created_by:userEmail,created_by_name:userEmail};
        const client=await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'BuildSchedule',$2,$3,NOW(),NOW())`,[id,companyId,JSON.stringify(data)]);
          const day=buildDayRange(a.build_date, companyTimezone || 'America/New_York');
          const ev=await client.query(`INSERT INTO calendar_events (id,title,start_time,end_time,event_type,company_id,assigned_to,created_by,location,description,status,created_at) VALUES ($1,$2,$3,$4,'build',$5,$6,$6,$7,$8,'scheduled',NOW()) RETURNING id`,[genId(),`${types.join(' & ')}: ${c.name}`,day.start_time,day.end_time,companyId,assigned[0],data.address,data.notes]);
          await client.query(`UPDATE generic_entities SET data=data || $1 WHERE id=$2 AND company_id=$3`,[JSON.stringify({calendar_event_id:ev.rows[0].id}),id,companyId]);
           const verified=await client.query(`SELECT ge.data->>'calendar_event_id' AS calendar_event_id, EXISTS(SELECT 1 FROM calendar_events WHERE id=$2 AND company_id=$3) AS event_exists FROM generic_entities ge WHERE ge.id=$1 AND ge.entity_type='BuildSchedule' AND ge.company_id=$3`,[id,ev.rows[0].id,companyId]);
           if (verified.rows[0]?.calendar_event_id !== ev.rows[0].id || !verified.rows[0]?.event_exists) throw new Error('Saved build records could not be verified');
          await client.query('COMMIT'); return {success:true,build_id:id,calendar_event_id:ev.rows[0].id};
        } catch(e) { await client.query('ROLLBACK').catch(()=>{}); return {error:`No build was created: ${e.message}`}; } finally { client.release(); }
      }

      case 'create_calendar_event': {
        const buildRouteBlock = calendarBuildRouteGuard(a);
        if (buildRouteBlock) return buildRouteBlock;
        const id = genId();
        // Normalize any datetime Gemini provides to a UTC ISO string for storage.
        // The calendar frontend uses new Date(start_time) which is tz-aware, so to
        // display noon ET the DB must store T16:00:00Z (noon + 4h offset).
        // • bare time "T12:00:00"    → treat as local wall-clock → UTC
        // • Z-suffix  "T12:00:00Z"  → reinterpret time as local (Gemini ignored tz) → UTC
        // • offset    "T12:00:00-04:00" → convert to UTC directly
        const toStorageUtc = (iso) => {
          if (!iso) return iso;
          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(iso)) {
            const d = new Date(iso + tzOffset);
            return isNaN(d.getTime()) ? iso : d.toISOString();
          }
          if (iso.endsWith('Z')) {
            const local = iso.slice(0, 19);
            const d = new Date(local + tzOffset);
            return isNaN(d.getTime()) ? iso : d.toISOString();
          }
          const d = new Date(iso);
          return isNaN(d.getTime()) ? iso : d.toISOString();
        };
        const calStartRaw = a.start_time;
        const calEndRaw = a.end_time;
        const calStart = toStorageUtc(calStartRaw);
        const calEnd = calEndRaw ? toStorageUtc(calEndRaw) : null;
        if (calStartRaw !== calStart) {
          console.log(`[Lexi Tool] Datetime normalized: ${calStartRaw} → ${calStart}`);
        }
        const parsedStart = new Date(calStart);
        if (!calStart || isNaN(parsedStart.getTime())) {
          return { success: false, error: `I couldn't understand the date/time for "${a.title || 'the event'}". Please give me a specific date and time.` };
        }
        const endTime = calEnd || new Date(parsedStart.getTime() + 3600000).toISOString();
        const assignedTo = String(a.assigned_to || a.assigned_to_email || userEmail).trim().toLowerCase();
        if (assignedTo !== String(userEmail).trim().toLowerCase()) {
          const staff = await pool.query(`SELECT 1 FROM staff_profiles WHERE company_id = $1 AND LOWER(COALESCE(user_email, email, '')) = $2 LIMIT 1`, [companyId, assignedTo]);
          if (!staff.rowCount) return { success: false, code: 'INVALID_ASSIGNEE', error: 'That staff member is not part of this company.' };
        }
        if (a.confirmation_token) {
          const emailRem = a.email_reminder_minutes != null ? parseInt(a.email_reminder_minutes) : null;
          const smsRem = a.sms_reminder_minutes != null ? parseInt(a.sms_reminder_minutes) : null;
          const browserRem = a.browser_reminder_minutes != null ? parseInt(a.browser_reminder_minutes) : null;
          const confirmed = await confirmScheduleAndCreate(pool, {
            token: a.confirmation_token, companyId, userEmail, title: a.title, assignedTo, startTime: calStart, endTime,
          }, async (client) => {
            const result = await client.query(
              `INSERT INTO calendar_events (id, company_id, title, event_type, start_time, end_time, location, description, attendees, created_by, assigned_to,
               send_email_notification, email_reminder_minutes, send_sms_notification, sms_reminder_minutes, send_browser_notification, browser_reminder_minutes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
              [id, companyId, a.title, a.event_type || 'meeting', calStart, endTime, a.location || null, a.description || null, a.attendees || null, userEmail, assignedTo,
                emailRem != null, emailRem, smsRem != null, smsRem, browserRem != null, browserRem]
            );
            return result.rows[0].id;
          });
          if (!confirmed.ok) return { success: false, code: confirmed.code, conflict: confirmed.conflict, error: confirmed.code === 'CALENDAR_CONFLICT' ? 'That alternative was just taken. Please choose another available time.' : 'That scheduling confirmation is no longer valid.' };
          let sms = null;
          if (a.reschedule_sms_message && (a.customer_id || a.lead_id)) {
            const table = a.customer_id ? 'customers' : 'leads';
            const contact = await pool.query(`SELECT name, phone FROM ${table} WHERE id = $1 AND company_id = $2 LIMIT 1`, [a.customer_id || a.lead_id, companyId]);
            if (!contact.rowCount || !contact.rows[0].phone) sms = { sent: false, error: 'The selected customer or lead has no phone number in this company.' };
            else sms = await handleLexiToolCall({ name: 'send_sms', args: { to: contact.rows[0].phone, contact_name: contact.rows[0].name, message: a.reschedule_sms_message } }, companyId, userEmail, companyTimezone);
          }
          return { success: true, id: confirmed.event, sms, message: `Calendar event "${a.title}" created after confirmation.` };
        }
        const requestFingerprint = JSON.stringify({ title: a.title, start_time: calStart, end_time: endTime, assigned_to: assignedTo });
        if (a.confirmation_token) {
          const pending = await pool.query(`SELECT id, data FROM generic_entities WHERE id = $1 AND entity_type = 'LexiPendingSchedule' AND company_id = $2 FOR UPDATE`, [a.confirmation_token, companyId]);
          const saved = pending.rows[0]?.data || {};
          const selectedOfferedSlot = Array.isArray(saved.alternatives) && saved.alternatives.some((slot) => slot.start === calStart && slot.end === endTime);
          if (!pending.rowCount || saved.user_email !== userEmail || saved.status !== 'pending' || new Date(saved.expires_at || 0).getTime() < Date.now() || saved.requested?.title !== a.title || saved.requested?.assigned_to !== assignedTo || !selectedOfferedSlot) {
            return { success: false, code: 'SCHEDULE_CONFIRMATION_INVALID', error: 'That scheduling confirmation is no longer valid. Please review the current availability.' };
          }
        }
        // A reminder is a personal alert, not a reservation of calendar availability.
        // Meetings, appointments, calls, and inspections remain conflict-protected.
        const isReminder = String(a.event_type || '').trim().toLowerCase() === 'reminder';
        const conflict = isReminder
          ? { rowCount: 0, rows: [] }
          : await pool.query(
            `SELECT id, title, start_time, end_time FROM calendar_events WHERE company_id = $1 AND assigned_to = $2
             AND COALESCE(status, '') NOT IN ('cancelled', 'tentative') AND start_time < $4 AND end_time > $3 LIMIT 1`,
            [companyId, assignedTo, calStart, endTime]
          );
        if (conflict.rowCount) {
          const token = genId();
          const existing = conflict.rows[0];
          const alternatives = [];
          const durationMs = new Date(endTime).getTime() - new Date(calStart).getTime();
          let candidate = new Date(calStart);
          candidate.setMinutes(candidate.getMinutes() < 30 ? 30 : candidate.getMinutes() === 30 ? 60 : candidate.getMinutes(), 0, 0);
          while (alternatives.length < 3 && candidate.getTime() < Date.now() + 8 * 86400000) {
            const candidateEnd = new Date(candidate.getTime() + durationMs);
            if (candidate.getHours() >= 7 && candidate.getHours() < 18) {
              const busy = await pool.query(`SELECT 1 FROM calendar_events WHERE company_id = $1 AND assigned_to = $2 AND COALESCE(status, '') NOT IN ('cancelled', 'tentative') AND start_time < $4 AND end_time > $3 LIMIT 1`, [companyId, assignedTo, candidate.toISOString(), candidateEnd.toISOString()]);
              if (!busy.rowCount) alternatives.push({ start: candidate.toISOString(), end: candidateEnd.toISOString(), label: candidate.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) });
            }
            candidate = new Date(candidate.getTime() + 30 * 60000);
          }
          await pool.query(`INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'LexiPendingSchedule', $2, $3::jsonb, NOW(), NOW())`,
            [token, companyId, JSON.stringify({ user_email: userEmail, status: 'pending', expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), request_fingerprint: requestFingerprint, requested: { title: a.title, start_time: calStart, end_time: endTime, assigned_to: assignedTo }, conflicts: [existing], alternatives })]);
          return { success: false, code: 'CALENDAR_CONFLICT', conflict: true, requested: { title: a.title, start_time: calStart, end_time: endTime, assigned_to: assignedTo }, conflicts: [existing], alternatives, confirmation_token: token, message: `${assignedTo} is already booked for "${existing.title}". Ask the user before trying an offered time or sending a text.` };
        }
        const emailRem = a.email_reminder_minutes != null ? parseInt(a.email_reminder_minutes) : null;
        const smsRem = a.sms_reminder_minutes != null ? parseInt(a.sms_reminder_minutes) : null;
        const browserRem = a.browser_reminder_minutes != null ? parseInt(a.browser_reminder_minutes) : null;
        if (a.confirmation_token) {
          await pool.query(`UPDATE generic_entities SET data = data || $1::jsonb, updated_date = NOW() WHERE id = $2 AND entity_type = 'LexiPendingSchedule' AND company_id = $3`, [JSON.stringify({ status: 'used', used_at: new Date().toISOString() }), a.confirmation_token, companyId]);
        }
        await pool.query(
          `INSERT INTO calendar_events (id, company_id, title, event_type, start_time, end_time, location, description, attendees, created_by, assigned_to,
           send_email_notification, email_reminder_minutes, send_sms_notification, sms_reminder_minutes, send_browser_notification, browser_reminder_minutes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
           [id, companyId, a.title, a.event_type || 'meeting', calStart, endTime, a.location || null, a.description || null, a.attendees || null, userEmail, assignedTo,
           emailRem != null, emailRem, smsRem != null, smsRem, browserRem != null, browserRem]
        );
        // A reschedule text is a secondary action: only attempt it after the
        // calendar insert has committed and only on a token-confirmed request.
        let sms = null;
        if (a.confirmation_token && a.reschedule_sms_message && (a.customer_id || a.lead_id)) {
          const contactTable = a.customer_id ? 'customers' : 'leads';
          const contactId = a.customer_id || a.lead_id;
          const contact = await pool.query(`SELECT name, phone FROM ${contactTable} WHERE id = $1 AND company_id = $2 LIMIT 1`, [contactId, companyId]);
          if (!contact.rowCount || !contact.rows[0].phone) {
            sms = { sent: false, error: 'The selected customer or lead has no phone number in this company.' };
          } else {
            sms = await handleLexiToolCall(
              { name: 'send_sms', args: { to: contact.rows[0].phone, contact_name: contact.rows[0].name, message: a.reschedule_sms_message } },
              companyId, userEmail, companyTimezone
            );
          }
        }
        const calReminders = [];
        if (emailRem) calReminders.push(`email ${emailRem}min before`);
        if (smsRem) calReminders.push(`SMS ${smsRem}min before`);
        if (browserRem) calReminders.push(`browser ${browserRem}min before`);
        const calRemMsg = calReminders.length > 0 ? ` with reminders: ${calReminders.join(', ')}` : '';
        console.log(`[Lexi Tool] Calendar event created: ${id} - ${a.title}`);
        return { success: true, id, sms, message: `Calendar event "${a.title}" created for ${calStart}${calRemMsg}` };
      }

      case 'get_calendar_events': {
        const start = a.start_date || new Date().toISOString().split('T')[0];
        const end = a.end_date || new Date(new Date(start).getTime() + 7 * 86400000).toISOString().split('T')[0];
        const { rows } = await pool.query(
          `SELECT id, title, event_type, start_time, end_time, location, description, attendees
           FROM calendar_events WHERE company_id = $1 AND start_time >= $2 AND start_time <= $3${isAdmin ? '' : ` AND ${ownRecordCondition('calendar_events', '$4')}`}
           ORDER BY start_time ASC LIMIT 20`,
          isAdmin ? [companyId, start, end + 'T23:59:59'] : [companyId, start, end + 'T23:59:59', userEmail]
        );
        if (rows.length === 0) return { success: true, events: [], message: `No events found between ${start} and ${end}` };
        return { success: true, count: rows.length, events: rows.map(r => ({
          title: r.title, type: r.event_type, start: r.start_time, end: r.end_time, location: r.location, description: r.description
        })) };
      }

      case 'get_crm_data': {
        const tableMap = {
          customers: 'customers', leads: 'leads', estimates: 'estimates', invoices: 'invoices',
          tasks: 'tasks', projects: 'projects', payments: 'payments', staff: 'staff_profiles', calendar_events: 'calendar_events'
        };
        const tbl = tableMap[a.data_type];
        if (!tbl) return { error: `Unknown data type: ${a.data_type}` };
        if (!canUseCrmDataType(lexiAccess, a.data_type)) return lexiAccessDenied();
        const f = a.filters || {};
        if (a.data_type === 'leads') {
          let sql = `SELECT * FROM leads WHERE company_id = $1`;
          const sqlParams = [companyId];
          if (!isAdmin) { sqlParams.push(userEmail); sql += ` AND ${ownRecordCondition('leads', `$${sqlParams.length}`)}`; }
          if (f.city) { sqlParams.push(`%${f.city.toLowerCase()}%`); sql += ` AND LOWER(city) LIKE $${sqlParams.length}`; }
          if (f.state) { sqlParams.push(`%${f.state.toLowerCase()}%`); sql += ` AND LOWER(state) LIKE $${sqlParams.length}`; }
          if (f.status) { sqlParams.push(f.status.toLowerCase()); sql += ` AND LOWER(status) = $${sqlParams.length}`; }
          if (f.assigned_to) { sqlParams.push(`%${f.assigned_to.toLowerCase()}%`); sql += ` AND LOWER(assigned_to) LIKE $${sqlParams.length}`; }
          if (f.lead_source) { sqlParams.push(`%${f.lead_source.toLowerCase()}%`); sql += ` AND LOWER(lead_source) LIKE $${sqlParams.length}`; }
          sql += ` ORDER BY created_at DESC NULLS LAST LIMIT 500`;
          const { rows: leadsRows } = await pool.query(sql, sqlParams);
          return { success: true, data_type: 'leads', count: leadsRows.length, filter_applied: f, leads: leadsRows.map(r => ({ name: r.name, status: r.status, phone: r.phone, email: r.email, city: r.city, state: r.state, assigned_to: r.assigned_to, lead_source: r.lead_source })) };
        } else if (a.data_type === 'customers') {
          let sql = `SELECT * FROM customers WHERE company_id = $1`;
          const sqlParams = [companyId];
          if (!isAdmin) { sqlParams.push(userEmail); sql += ` AND ${ownRecordCondition('customers', `$${sqlParams.length}`)}`; }
          if (f.city) { sqlParams.push(`%${f.city.toLowerCase()}%`); sql += ` AND LOWER(city) LIKE $${sqlParams.length}`; }
          if (f.state) { sqlParams.push(`%${f.state.toLowerCase()}%`); sql += ` AND LOWER(state) LIKE $${sqlParams.length}`; }
          sql += ` ORDER BY created_at DESC NULLS LAST LIMIT 200`;
          const { rows: custRows } = await pool.query(sql, sqlParams);
          return { success: true, data_type: 'customers', count: custRows.length, filter_applied: f, customers: custRows.map(r => ({ name: r.name, email: r.email, phone: r.phone, city: r.city, state: r.state })) };
        }
        if (a.data_type === 'payments') {
          // Return a concise, date-aware payer breakdown. Returning a generic
          // `name` column for payments loses customer_name and makes Lexi unable
          // to answer who paid, despite having access to the payment records.
          let paymentSql = `SELECT
            COALESCE(NULLIF(BTRIM(customer_name), ''), 'Unknown customer') AS customer_name,
            COUNT(*)::int AS payment_count,
            COALESCE(SUM(amount), 0) AS total_collected,
            MAX(COALESCE(payment_date, created_at)) AS most_recent_payment_at
            FROM payments
            WHERE company_id = $1
              AND COALESCE(status, 'received') IN ('received', 'paid', 'completed')
              AND COALESCE(data->>'is_withheld_offset', data->'data'->>'is_withheld_offset', 'false') NOT IN ('true', 't', '1')`;
          const paymentParams = [companyId];
          const paymentDateExpr = 'COALESCE(payment_date, created_at)';
          if (f.start_date) { paymentParams.push(f.start_date); paymentSql += ` AND ${paymentDateExpr} >= $${paymentParams.length}`; }
          if (f.end_date) { paymentParams.push(`${f.end_date}T23:59:59.999Z`); paymentSql += ` AND ${paymentDateExpr} <= $${paymentParams.length}`; }
          paymentSql += ` GROUP BY 1 ORDER BY total_collected DESC, customer_name ASC LIMIT 100`;
          const { rows: paymentRows } = await pool.query(paymentSql, paymentParams);
          const payers = paymentRows.map(r => ({
            customer_name: r.customer_name,
            payment_count: Number(r.payment_count),
            total_collected: Number(r.total_collected),
            most_recent_payment_at: r.most_recent_payment_at,
          }));
          return {
            success: true,
            data_type: 'payments',
            filter_applied: f,
            payment_count: payers.reduce((sum, payer) => sum + payer.payment_count, 0),
            payer_count: payers.length,
            total_collected: payers.reduce((sum, payer) => sum + payer.total_collected, 0),
            payers,
          };
        }
        const ownCondition = !isAdmin ? ownRecordCondition(a.data_type, '$2') : null;
        const queryParams = isAdmin ? [companyId] : [companyId, userEmail];
        const { rows: countRows } = await pool.query(`SELECT COUNT(*) as total FROM ${tbl} WHERE company_id = $1${ownCondition ? ` AND ${ownCondition}` : ''}`, queryParams);
        const total = parseInt(countRows[0].total);
        const nameCol = tbl === 'staff_profiles' ? 'name' : tbl === 'calendar_events' ? 'title' : tbl === 'tasks' ? 'COALESCE(title,name)' : 'name';
        const statusCol = (tbl === 'staff_profiles') ? "availability_status" : (tbl === 'calendar_events') ? "event_type" : "status";
        const orderCol = tbl === 'calendar_events' ? 'start_time DESC' : 'created_at DESC';
        const { rows: recent } = await pool.query(
          `SELECT id, ${nameCol} as label, ${statusCol} as status, created_at FROM ${tbl} WHERE company_id = $1${ownCondition ? ` AND ${ownCondition}` : ''} ORDER BY ${orderCol} LIMIT 5`,
          queryParams
        );
        return { success: true, data_type: a.data_type, total, recent: recent.map(r => ({ id: r.id, name: r.label, status: r.status })) };
      }

      case 'create_task': {
        const id = genId();
        let assignedTo = a.assigned_to || null;
        let assignedName = null;
        if (assignedTo) {
          const { rows: staffRows } = await pool.query(
            `SELECT email, COALESCE(full_name, name) as dname FROM staff_profiles WHERE company_id = $1 AND (LOWER(COALESCE(full_name,name,'')) LIKE $2 OR LOWER(email) = $3) LIMIT 1`,
            [companyId, '%' + assignedTo.toLowerCase() + '%', assignedTo.toLowerCase()]
          );
          if (staffRows.length) { assignedTo = staffRows[0].email; assignedName = staffRows[0].dname; }
        }
        if (!assignedTo) assignedTo = userEmail;
        await pool.query(
          `INSERT INTO tasks (id, company_id, title, name, description, assigned_to, assigned_to_name, due_date, priority, status, created_by)
           VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,'pending',$9)`,
          [id, companyId, a.name, a.description || null, assignedTo, assignedName, a.due_date || null, a.priority || 'medium', userEmail]
        );
        console.log(`[Lexi Tool] Task created: ${id} - ${a.name}`);
        return { success: true, id, message: `Task "${a.name}" created${assignedName ? ` and assigned to ${assignedName}` : ''}` };
      }

      case 'route_lead_to_sequence': {
        if (!isAdmin) return lexiAccessDenied('Only an administrator can approve lead routing or document delivery.');
        const lead = await pool.query(`SELECT id,name FROM leads WHERE id=$1 AND company_id=$2 LIMIT 1`, [a.lead_id, companyId]);
        const workflow = await pool.query(`SELECT id FROM generic_entities WHERE entity_type='Workflow' AND company_id=$1 AND COALESCE(data->>'is_active','true') <> 'false' AND LOWER(COALESCE(data->>'workflow_name',data->>'name',''))=LOWER($2) LIMIT 1`, [companyId, a.sequence_name]);
        if (!lead.rowCount) return { success: false, error: 'That lead is not in this company.' };
        if (!workflow.rowCount) return { success: false, error: 'I could not find an active company follow-up sequence with that name.' };
        const token = genId(), action = { type: 'lexi_sequence', lead_id: a.lead_id, workflow_id: workflow.rows[0].id, sequence_name: a.sequence_name };
        await pool.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'LexiPendingOrchestration',$2,$3,NOW(),NOW())`, [token, companyId, JSON.stringify({ user_email: userEmail, action, status: 'pending', expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })]);
        return { requires_confirmation: true, confirmation_token: token, proposed_action: action, message: `Ready to enroll ${lead.rows[0].name} in ${a.sequence_name}. Ask for explicit approval before enrolling.` };
      }

      case 'trigger_document_packet': {
        if (!isAdmin) return lexiAccessDenied('Only an administrator can approve lead routing or document delivery.');
        const table = a.recipient_type === 'lead' ? 'leads' : a.recipient_type === 'customer' ? 'customers' : null;
        if (!table) return { success: false, error: 'Choose a lead or customer for this packet.' };
        const recipient = await pool.query(`SELECT id,name,email,phone FROM ${table} WHERE id=$1 AND company_id=$2 LIMIT 1`, [a.recipient_id, companyId]);
        if (!recipient.rowCount) return { success: false, error: 'That recipient is not in this company.' };
        if (a.channel === 'email' && !recipient.rows[0].email) return { success: false, error: 'That recipient has no email address.' };
        if (a.channel === 'sms' && !recipient.rows[0].phone) return { success: false, error: 'That recipient has no phone number.' };
        const token = genId(), action = { type: 'lexi_packet', ...a };
        await pool.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'LexiPendingOrchestration',$2,$3,NOW(),NOW())`, [token, companyId, JSON.stringify({ user_email: userEmail, action, status: 'pending', expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })]);
        return { requires_confirmation: true, confirmation_token: token, proposed_action: action, message: `Ready to send a restoration packet to ${recipient.rows[0].name} by ${String(a.channel).toUpperCase()}. Ask for explicit approval before sending.` };
      }

      case 'confirm_lexi_orchestration': {
        const pending = await pool.query(`SELECT data FROM generic_entities WHERE id=$1 AND entity_type='LexiPendingOrchestration' AND company_id=$2 FOR UPDATE`, [a.confirmation_token, companyId]);
        const saved = pending.rows[0]?.data || {}, action = saved.action || {};
        if (!pending.rowCount || saved.user_email !== userEmail || saved.status !== 'pending' || new Date(saved.expires_at || 0).getTime() < Date.now()) return { success: false, error: 'That approval is no longer valid. Please prepare the action again.' };
        const claimed = await pool.query(`UPDATE generic_entities SET data=data || $1::jsonb,updated_date=NOW() WHERE id=$2 AND entity_type='LexiPendingOrchestration' AND company_id=$3 AND data->>'status'='pending' AND (data->>'expires_at')::timestamptz > NOW() RETURNING id`, [JSON.stringify({ status: 'used', used_at: new Date().toISOString() }), a.confirmation_token, companyId]);
        if (!claimed.rowCount) return { success: false, error: 'That approval was already used or expired.' };
        const plugin = await import('./vite-functions-plugin.js');
        return await plugin.functionHandlers.executeLexiOrchestration(
          { companyId, action },
          process.env.GOOGLE_GEMINI_API_KEY,
          { __lexiNativeCaller: { source: 'lexi_native', companyId, email: userEmail } }
        );
        if (action.type === 'lexi_sequence') {
          const lead = await pool.query(`SELECT id,name FROM leads WHERE id=$1 AND company_id=$2 LIMIT 1`, [action.lead_id, companyId]);
          const workflow = await pool.query(`SELECT id FROM generic_entities WHERE id=$1 AND entity_type='Workflow' AND company_id=$2 AND COALESCE(data->>'is_active','true') <> 'false' LIMIT 1`, [action.workflow_id, companyId]);
          if (!lead.rowCount || !workflow.rowCount) return { success: false, error: 'The lead or active sequence is no longer available in this company.' };
          const existing = await pool.query(`SELECT id FROM generic_entities WHERE entity_type='SequenceEnrollment' AND company_id=$1 AND data->>'lead_id'=$2 AND data->>'workflow_id'=$3 AND data->>'status'='active' LIMIT 1`, [companyId, String(action.lead_id), String(action.workflow_id)]);
          if (existing.rowCount) return { success: true, already_enrolled: true, message: `${lead.rows[0].name} is already enrolled in ${action.sequence_name}.` };
          const id = genId();
          await pool.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'SequenceEnrollment',$2,$3,NOW(),NOW())`, [id, companyId, JSON.stringify({ company_id: companyId, lead_id: action.lead_id, workflow_id: action.workflow_id, sequence_name: action.sequence_name, status: 'active', enrolled_at: new Date().toISOString(), enrolled_by: userEmail })]);
          return { success: true, enrollment_id: id, message: `${lead.rows[0].name} was enrolled in ${action.sequence_name}.` };
        }
        if (action.type === 'lexi_packet') {
          const table = action.recipient_type === 'lead' ? 'leads' : action.recipient_type === 'customer' ? 'customers' : null;
          const recipient = table ? await pool.query(`SELECT id,name FROM ${table} WHERE id=$1 AND company_id=$2 LIMIT 1`, [action.recipient_id, companyId]) : { rowCount: 0 };
          if (!recipient.rowCount) return { success: false, error: 'The packet recipient is no longer available in this company.' };
          const id = genId();
          await pool.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'DocumentPacket',$2,$3,NOW(),NOW())`, [id, companyId, JSON.stringify({ company_id: companyId, recipient_type: action.recipient_type, recipient_id: action.recipient_id, channel: action.channel, requested_contents: action, delivered_at: new Date().toISOString(), delivered_by: userEmail })]);
          return { success: true, packet_id: id, message: `Restoration packet approved for ${recipient.rows[0].name}.` };
        }
        return { success: false, error: 'That approval does not contain a supported action.' };
      }

      case 'dispatch_team_notification': {
        if (!isAdmin) return lexiAccessDenied('Only an administrator can route work to a teammate.');
        const needle = String(a.assignee || '').trim().toLowerCase();
        const staff = await pool.query(`SELECT full_name,COALESCE(NULLIF(user_email,''),email) AS email FROM staff_profiles WHERE company_id=$1 AND is_active IS NOT FALSE AND (LOWER(COALESCE(user_email,''))=$2 OR LOWER(COALESCE(email,''))=$2 OR LOWER(COALESCE(full_name,''))=$2) LIMIT 2`, [companyId, needle]);
        if (staff.rowCount !== 1) return { success: false, error: staff.rowCount ? 'More than one teammate matches that name; please use their email.' : 'That teammate is not an active member of this company.' };
        const assignee = staff.rows[0], taskId = genId();
        await pool.query(`INSERT INTO tasks (id,name,description,due_date,priority,status,company_id,assigned_to,created_at) VALUES ($1,$2,$3,$4,$5,'not_started',$6,$7,NOW())`, [taskId, a.title, a.context_note, a.due_date || null, a.priority || 'medium', companyId, assignee.email]);
        await pool.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'Notification',$2,$3,NOW(),NOW())`, [genId(), companyId, JSON.stringify({ company_id: companyId, user_email: assignee.email, title: 'New operational ticket', message: `${a.title}: ${a.context_note}`, type: 'task_assigned', related_entity_type: 'Task', related_entity_id: taskId, link_url: '/Tasks', is_read: false })]);
        return { success: true, task_id: taskId, assignee: assignee.full_name, message: `Operational ticket assigned to ${assignee.full_name}.` };
      }

      case 'create_lead': {
        const id = genId();
        const addr = [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ') || null;
        await pool.query(
          `INSERT INTO leads (id, company_id, name, email, phone, street, city, state, zip, address, notes, source, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new',$13)`,
          [id, companyId, a.name, a.email || null, a.phone || null, a.street || null, a.city || null, a.state || null, a.zip || null, addr, a.notes || null, a.source || 'lexi_ai', userEmail]
        );
        console.log(`[Lexi Tool] Lead created: ${id} - ${a.name}`);
        if (a.phone) invalidateCallerCache(companyId, a.phone);
        return { success: true, id, message: `Lead "${a.name}" created` };
      }

      case 'create_customer': {
        const id = genId();
        const addr = [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ') || null;
        await pool.query(
          `INSERT INTO customers (id, company_id, name, email, phone, street, city, state, zip, address, notes, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12)`,
          [id, companyId, a.name, a.email || null, a.phone || null, a.street || null, a.city || null, a.state || null, a.zip || null, addr, a.notes || null, userEmail]
        );
        console.log(`[Lexi Tool] Customer created: ${id} - ${a.name}`);
        if (a.phone) invalidateCallerCache(companyId, a.phone);
        return { success: true, id, message: `Customer "${a.name}" created` };
      }

      case 'send_email': {
        const result = await sendEmail({ to: a.to, subject: a.subject, html: a.message, companyId });
        const commId = genId();
        await pool.query(
          `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_email, contact_name, subject, body, status, created_by)
           VALUES ($1,$2,'email','email','outbound',$3,$4,$5,$6,'sent',$7)`,
          [commId, companyId, a.to, a.contact_name || null, a.subject, a.message, userEmail]
        );
        console.log(`[Lexi Tool] Email sent to ${a.to}`);
        return { success: true, message: `Email sent to ${a.contact_name || a.to}` };
      }

      case 'send_sms': {
        const { rows: twRows } = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`, [companyId]
        );
        const tw = twRows[0]?.data || {};
        const sid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
        const token = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
        const fromPhone = tw.main_phone_number || process.env.TWILIO_PHONE_FROM || '+12167777154';
        if (!sid || !token) return { error: 'Twilio not configured for this company', success: false };
        const authHeader = Buffer.from(`${sid}:${token}`).toString('base64');
        const smsParams = new URLSearchParams({ To: a.to, From: fromPhone, Body: a.message });
        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          { method: 'POST', headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: smsParams.toString() }
        );
        if (!twilioRes.ok) {
          const errText = await twilioRes.text();
          console.error(`[Lexi Tool] SMS failed:`, twilioRes.status, errText.substring(0, 200));
          return { error: `SMS failed: ${twilioRes.status}`, success: false };
        }
        const commId = genId();
        await pool.query(
          `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, contact_name, message, body, status, created_by)
           VALUES ($1,$2,'sms','sms','outbound',$3,$4,$5,$5,'sent',$6)`,
          [commId, companyId, a.to, a.contact_name || null, a.message, userEmail]
        );
        console.log(`[Lexi Tool] SMS sent to ${a.to}`);
        return { success: true, message: `Text message sent to ${a.contact_name || a.to}` };
      }

      case 'assign_inspection': {
        const id = genId();
        let assigneeId = null;
        let assigneeName = a.assigned_to_email;
        const { rows: staffRows } = await pool.query(
          `SELECT id, email, COALESCE(full_name, name) as dname FROM staff_profiles WHERE company_id = $1 AND LOWER(email) = $2 LIMIT 1`,
          [companyId, (a.assigned_to_email || '').toLowerCase()]
        );
        if (staffRows.length) { assigneeId = staffRows[0].id; assigneeName = staffRows[0].dname; }
        const inspDate = a.inspection_date || new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const inspTime = a.inspection_time || '10:00';
        const startTime = `${inspDate}T${inspTime}:00`;
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data)
           VALUES ($1, 'FieldActivity', $2, $3)`,
          [id, companyId, JSON.stringify({
            name: `Inspection: ${a.client_name} - ${a.property_address}`,
            activity_type: 'inspection', client_name: a.client_name, client_phone: a.client_phone || null,
            client_email: a.client_email || null, property_address: a.property_address,
            assigned_to: a.assigned_to_email, assigned_to_name: assigneeName,
            scheduled_date: inspDate, scheduled_time: inspTime,
            damage_type: a.damage_type || 'general', special_instructions: a.special_instructions || '',
            status: 'scheduled', created_by: userEmail
          })]
        );
        if (a.create_calendar_event !== false) {
          const calId = genId();
          await pool.query(
            `INSERT INTO calendar_events (id, company_id, title, event_type, start_time, end_time, location, description, assigned_to, created_by)
             VALUES ($1,$2,$3,'inspection',$4,$5,$6,$7,$8,$9)`,
            [calId, companyId, `Inspection: ${a.client_name}`, startTime,
             new Date(new Date(startTime).getTime() + 3600000).toISOString(),
             a.property_address, `${a.damage_type || 'General'} inspection. ${a.special_instructions || ''}`.trim(),
             a.assigned_to_email, userEmail]
          );
        }
        if (a.create_lead) {
          const leadId = genId();
          await pool.query(
            `INSERT INTO leads (id, company_id, name, email, phone, address, source, status, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'inspection','new',$7,$8)`,
            [leadId, companyId, a.client_name, a.client_email || null, a.client_phone || null, a.property_address, `Inspection scheduled for ${inspDate}`, userEmail]
          );
          if (a.client_phone) invalidateCallerCache(companyId, a.client_phone);
        }
        console.log(`[Lexi Tool] Inspection assigned: ${id} → ${assigneeName}`);
        return { success: true, id, message: `Inspection for ${a.client_name} at ${a.property_address} assigned to ${assigneeName} on ${inspDate} at ${inspTime}` };
      }

      case 'save_memory': {
        const memKey = String(a.key || '').trim();
        const memValue = String(a.value || '').trim();
        if (!memKey || !memValue) return { error: 'Both key and value are required to save a memory.', success: false };
        const memImportance = Math.min(10, Math.max(1, parseInt(a.importance, 10) || 5));
        // Personal memories only: never allow 'company' (would inject into every
        // user's sessions) or the calibration categories (different schema).
        let memCategory = String(a.category || 'lexi').trim().toLowerCase() || 'lexi';
        if (['company', 'estimator_calibration', 'job_calibration'].includes(memCategory)) memCategory = 'lexi';
        const memId = require('crypto').randomUUID();
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'AIMemory', $2, $3, NOW(), NOW())`,
          [memId, String(companyId), JSON.stringify({
            company_id: String(companyId),
            user_email: userEmail || null,
            key: memKey,
            value: memValue,
            importance: memImportance,
            category: memCategory,
            is_active: true,
            created_by: userEmail || null,
            source: 'lexi_auto'
          })]
        );
        console.log(`[Lexi Tool] save_memory: "${memKey}" for ${userEmail || 'unknown user'}`);
        return { success: true, id: memId, message: `Preference saved — I'll remember "${memKey}".` };
      }

      case 'manage_entity': {
        if (!isAdmin) {
          return lexiAccessDenied('I can help with your assigned CRM records through the dedicated tools, but I can’t use unrestricted entity management.');
        }
        const entityTableMap = {
          lead: 'leads', leads: 'leads', customer: 'customers', customers: 'customers',
          task: 'tasks', tasks: 'tasks', estimate: 'estimates', estimates: 'estimates',
          invoice: 'invoices', invoices: 'invoices', project: 'projects', projects: 'projects',
          payment: 'payments', payments: 'payments', calendar_event: 'calendar_events', calendar_events: 'calendar_events',
          staff: 'staff_profiles', staff_profiles: 'staff_profiles'
        };
        const tbl = entityTableMap[(a.entity_name || '').toLowerCase()];
        // A build must not reach the calendar through the generic CRUD tool either.
        const entityBuildRouteBlock = manageEntityBuildRouteGuard(a.entity_name, a.entity_action, a.entity_data);
        if (entityBuildRouteBlock) return entityBuildRouteBlock;
        const isStaffTarget = tbl === 'staff_profiles' || ['staff', 'staffprofile', 'staff_profile', 'staffprofiles'].includes((a.entity_name || '').toLowerCase());
        if (!isAdmin && a.entity_action === 'list') {
          return lexiAccessDenied('I can look up your assigned leads, customers, tasks, projects, calendar events, and estimates, but I can’t browse unrestricted company records.');
        }
        if (isStaffTarget && a.entity_action !== 'list') {
          return { error: `I can't ${a.entity_action} staff records directly. Ask me to add a staff member (they're added without admin access); changing roles or admin access must be done by an administrator in Settings.`, success: false };
        }

        // CRITICAL: payments must go through record_payment tool — manage_entity saves to generic_entities
        // and payments stored there are completely invisible on the Payments page.
        const isPaymentTarget = tbl === 'payments' || ['payment', 'payments'].includes((a.entity_name || '').toLowerCase());
        if (isPaymentTarget && (a.entity_action === 'create' || a.entity_action === 'update')) {
          return { error: 'ERROR: You MUST use the record_payment tool for payments — NEVER manage_entity. Payments recorded via manage_entity are invisible to the user. Call record_payment now with: amount, customer_name, payment_date, reference_number, and payment_method=bank_transfer.', success: false };
        }

        if (!tbl) {
          const entityType = canonicalizeGenericEntityType((a.entity_name || '').charAt(0).toUpperCase() + (a.entity_name || '').slice(1));
          if (a.entity_action === 'list') {
            const { rows } = await pool.query(
              `SELECT * FROM generic_entities WHERE company_id = $1 AND entity_type = $2 ORDER BY created_date DESC LIMIT 20`,
              [companyId, entityType]
            );
            return { success: true, count: rows.length, items: rows.map(r => ({ id: r.id, ...(r.data || {}) })) };
          }
          if (a.entity_action === 'create' && a.entity_data) {
            const geId = `ge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const payload = normalizeGenericEntityData(entityType, { ...a.entity_data, created_by: userEmail }, { applyDefaults: true });
            if (entityType === 'BuildSchedule' && isBuildSchedulingMutation(a.entity_data)) {
              const confirmation = buildScheduleConfirmationGuard({
                companyId, userEmail, action: 'create',
                customerId: payload.customer_id, customerName: payload.customer_name,
                buildDate: payload.build_date, jobTypes: payload.job_type || payload.job_types,
              }, a.confirmation_token);
              if (confirmation) return confirmation;
              payload.created_by_name = payload.created_by_name || userEmail;
            }
            await pool.query(
              `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, $4, NOW(), NOW())`,
              [geId, entityType, companyId, JSON.stringify(payload)]
            );
            if (entityType === 'Lead') invalidateCallerCacheForCompany(companyId);
            return { success: true, id: geId, message: `${a.entity_name} created successfully` };
          }
          if (a.entity_action === 'update' && a.entity_id && a.entity_data) {
            // Fetch-merge-normalize (instead of a shallow jsonb || patch) so an update
            // also heals legacy alias keys (vendor/date) left on old Expense rows.
            const geExisting = await pool.query(
              `SELECT data FROM generic_entities WHERE id = $1 AND company_id = $2`,
              [a.entity_id, companyId]
            );
            if (geExisting.rows.length === 0) return { error: `${a.entity_name} with ID "${a.entity_id}" not found`, success: false };
            const geMerged = normalizeGenericEntityData(entityType, { ...(geExisting.rows[0].data || {}), ...a.entity_data });
            const geUpdated = await pool.query(
              `UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE id = $2 AND company_id = $3 RETURNING data`,
              [JSON.stringify(geMerged), a.entity_id, companyId]
            );
            if (entityType === 'BuildSchedule') {
              const verified = geUpdated.rows[0]?.data || {};
              const matches = Object.entries(a.entity_data || {}).every(([key, value]) => JSON.stringify(verified[key]) === JSON.stringify(value));
              if (!matches) return { success: false, error: 'The build update could not be verified. Please review the Build Schedule before trying again.' };
              if (verified.calendar_event_id) {
                const calendarFields = {};
                if (a.entity_data.build_date) {
                  const day = buildDayRange(a.entity_data.build_date, companyTimezone || 'America/New_York');
                  calendarFields.start_time = day.start_time;
                  calendarFields.end_time = day.end_time;
                }
                if (a.entity_data.address !== undefined) calendarFields.location = a.entity_data.address;
                if (a.entity_data.notes !== undefined) calendarFields.description = a.entity_data.notes;
                if (a.entity_data.status !== undefined) calendarFields.status = a.entity_data.status;
                if (a.entity_data.assigned_to !== undefined) calendarFields.assigned_to = Array.isArray(a.entity_data.assigned_to) ? a.entity_data.assigned_to[0] : a.entity_data.assigned_to;
                const keys = Object.keys(calendarFields);
                if (keys.length) {
                  const values = Object.values(calendarFields);
                  const assignments = keys.map((key, index) => `${key}=$${index + 1}`).join(', ');
                  const synced = await pool.query(`UPDATE calendar_events SET ${assignments} WHERE id=$${values.length + 1} AND company_id=$${values.length + 2} RETURNING start_time,end_time,status,location,description,assigned_to`, [...values, verified.calendar_event_id, companyId]);
                  const calendarConfirmed = synced.rowCount && keys.every(key => {
                    const actual = synced.rows[0][key];
                    const expected = calendarFields[key];
                    return key.endsWith('_time') ? new Date(actual).toISOString() === new Date(expected).toISOString() : actual === expected;
                  });
                  if (!calendarConfirmed) {
                    await pool.query(`UPDATE generic_entities SET data=$1, updated_date=NOW() WHERE id=$2 AND company_id=$3`, [JSON.stringify(geExisting.rows[0].data), a.entity_id, companyId]);
                    return { success: false, error: 'The linked calendar update could not be verified. Please review the Build Schedule before trying again.' };
                  }
                }
              } else {
                let calendarId = null;
                try {
                  const day = buildDayRange(verified.build_date, companyTimezone || 'America/New_York');
                  calendarId = `cal_${a.entity_id}`;
                  const jobTypes = Array.isArray(verified.job_type) ? verified.job_type : (verified.job_type ? [verified.job_type] : ['Build']);
                  const created = await pool.query(`INSERT INTO calendar_events (id,title,start_time,end_time,event_type,company_id,assigned_to,created_by,location,description,status,created_at) VALUES ($1,$2,$3,$4,'build',$5,$6,$7,$8,$9,$10,NOW()) RETURNING id`, [calendarId, `${jobTypes.join(' & ')}: ${verified.customer_name || 'Build'}`, day.start_time, day.end_time, companyId, Array.isArray(verified.assigned_to) ? verified.assigned_to[0] : (verified.assigned_to || userEmail), verified.created_by || userEmail, verified.address || '', verified.notes || '', verified.status || 'scheduled']);
                  await pool.query(`UPDATE generic_entities SET data=data || $1, updated_date=NOW() WHERE id=$2 AND entity_type='BuildSchedule' AND company_id=$3`, [JSON.stringify({ calendar_event_id: created.rows[0].id }), a.entity_id, companyId]);
                  const linked = await pool.query(`SELECT data->>'calendar_event_id' AS calendar_event_id FROM generic_entities WHERE id=$1 AND entity_type='BuildSchedule' AND company_id=$2`, [a.entity_id, companyId]);
                  if (linked.rows[0]?.calendar_event_id !== calendarId) throw new Error('The calendar link could not be verified');
                } catch (e) {
                  if (calendarId) await pool.query(`DELETE FROM calendar_events WHERE id=$1 AND company_id=$2`, [calendarId, companyId]).catch(() => {});
                  await pool.query(`UPDATE generic_entities SET data=$1, updated_date=NOW() WHERE id=$2 AND company_id=$3`, [JSON.stringify(geExisting.rows[0].data), a.entity_id, companyId]);
                  return { success: false, error: `The build and calendar update could not be completed: ${e.message}` };
                }
              }
            }
            if (entityType === 'Lead') invalidateCallerCacheForCompany(companyId);
            return { success: true, message: `${a.entity_name} updated successfully` };
          }
          if (a.entity_action === 'delete' && a.entity_id) {
            await pool.query(`DELETE FROM generic_entities WHERE id = $1 AND company_id = $2`, [a.entity_id, companyId]);
            if (entityType === 'Lead') invalidateCallerCacheForCompany(companyId);
            return { success: true, message: `${a.entity_name} deleted` };
          }
          return { error: `Invalid action or missing data for ${a.entity_action}`, success: false };
        }

        if (a.entity_action === 'list') {
          const { rows: schCols } = await pool.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`, [tbl]
          );
          const colSet = new Set(schCols.map(r => r.column_name));
          const orderCol = colSet.has('created_at') ? 'created_at' : colSet.has('created_date') ? 'created_date' : 'id';
          const { rows } = await pool.query(`SELECT * FROM ${tbl} WHERE company_id = $1 ORDER BY ${orderCol} DESC LIMIT 10`, [companyId]);
          return { success: true, count: rows.length, items: rows.map(r => ({ id: r.id, name: r.full_name || r.name || r.title, status: r.status || r.availability_status, email: r.email })) };
        }
        const { rows: schemaRows } = await pool.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
          [tbl]
        );
        const validCols = new Set(schemaRows.map(r => r.column_name));
        // Rep assignment: for leads/customers, resolve a rep NAME to a staff email
        // and keep assigned_to_users in sync so the assignment lands on the real
        // field (instead of getting dumped into notes). Reject unknown/ambiguous names.
        if ((tbl === 'leads' || tbl === 'customers') && (a.entity_action === 'create' || a.entity_action === 'update') && a.entity_data && typeof a.entity_data === 'object' && a.entity_data.assigned_to) {
          let repVal = String(a.entity_data.assigned_to).trim();
          if (repVal && !repVal.includes('@')) {
            try {
              const esc = repVal.replace(/[\\%_]/g, '\\$&');
              const staffMatch = await pool.query(
                `SELECT user_email, full_name FROM staff_profiles
                   WHERE company_id = $1 AND is_active = true AND user_email IS NOT NULL
                     AND (LOWER(full_name) = LOWER($2) OR full_name ILIKE $3)`,
                [companyId, repVal, `%${esc}%`]
              );
              const rows = staffMatch.rows || [];
              const exact = rows.filter(r => (r.full_name || '').toLowerCase() === repVal.toLowerCase());
              const pick = exact.length ? exact : rows;
              if (pick.length === 0) {
                return { error: `I couldn't find a team member named "${repVal}". Please check the name or pick someone from your staff list.`, success: false };
              }
              if (pick.length > 1) {
                const names = pick.slice(0, 5).map(r => `${r.full_name} (${r.user_email})`).join(', ');
                return { error: `More than one team member matches "${repVal}": ${names}. Which one should I assign?`, success: false };
              }
              a.entity_data.assigned_to = pick[0].user_email;
              repVal = pick[0].user_email;
            } catch (resolveErr) {
              console.warn('[manage_entity] rep resolution failed:', resolveErr.message);
            }
          }
          if (repVal.includes('@') && a.entity_data.assigned_to_users === undefined && validCols.has('assigned_to_users')) {
            a.entity_data.assigned_to_users = [repVal];
          }
        }
        if (a.entity_action === 'create' && a.entity_data) {
          const id = genId();
          const d = a.entity_data;
          const cols = ['id', 'company_id'];
          const vals = [id, companyId];
          const placeholders = ['$1', '$2'];
          let idx = 3;
          if (validCols.has('created_by')) { cols.push('created_by'); vals.push(userEmail); placeholders.push(`$${idx++}`); }
          for (const [k, v] of Object.entries(d)) {
            if (['id', 'company_id', 'created_by'].includes(k)) continue;
            if (!validCols.has(k)) continue;
            if (v === undefined || v === null || v === '') continue;
            cols.push(k);
            vals.push(v);
            placeholders.push(`$${idx++}`);
          }
          await pool.query(`INSERT INTO ${tbl} (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals);
          if ((tbl === 'leads' || tbl === 'customers') && d.phone) invalidateCallerCache(companyId, d.phone);
          return { success: true, id, message: `${a.entity_name} created` };
        }
        if (a.entity_action === 'update' && a.entity_id && a.entity_data) {
          const d = a.entity_data;
          const sets = [];
          const vals = [];
          let idx = 1;
          for (const [k, v] of Object.entries(d)) {
            if (['id', 'company_id'].includes(k)) continue;
            if (!validCols.has(k)) continue;
            sets.push(`${k} = $${idx}`);
            vals.push(v);
            idx++;
          }
          if (validCols.has('updated_at')) { sets.push(`updated_at = NOW()`); }
          if (sets.length === 0) return { error: 'No fields to update', success: false };
          vals.push(a.entity_id, companyId);
          await pool.query(`UPDATE ${tbl} SET ${sets.join(',')} WHERE id = $${idx} AND company_id = $${idx + 1}`, vals);
          if (tbl === 'leads' || tbl === 'customers') {
            // Use company-wide invalidation on updates: we don't know the old phone,
            // so a phone-number change would leave the old cache key stale until TTL.
            invalidateCallerCacheForCompany(companyId);
          }
          return { success: true, message: `${a.entity_name} ${a.entity_id} updated` };
        }
        if (a.entity_action === 'delete' && a.entity_id) {
          await pool.query(`DELETE FROM ${tbl} WHERE id = $1 AND company_id = $2`, [a.entity_id, companyId]);
          if (tbl === 'leads' || tbl === 'customers') invalidateCallerCacheForCompany(companyId);
          return { success: true, message: `${a.entity_name} ${a.entity_id} deleted` };
        }
        return { error: `Invalid action or missing data for ${a.entity_action}`, success: false };
      }

      case 'get_storm_alerts': {
        const daysBack = Math.max(1, Math.min(365, parseInt(a.days_back) || 30));
        const activeOnly = a.active_only || false;
        const areaFilter = a.area_filter ? a.area_filter.toLowerCase() : null;
        const eventTypes = a.event_types ? a.event_types.split(',').map(t => t.trim().toLowerCase()) : null;
        let stateFilter = null;
        try {
          const settingsRes = await pool.query(`SELECT data FROM generic_entities WHERE entity_type = 'StormAlertSettings' AND (company_id = $1 OR (data->>'company_id') = $1) ORDER BY updated_date DESC NULLS LAST LIMIT 1`, [String(companyId)]);
          if (settingsRes.rows.length > 0) { const s = settingsRes.rows[0].data || {}; if (s.service_states && s.service_states.length > 0) stateFilter = s.service_states; else if (s.service_center_location) { const m = s.service_center_location.match(/,\s*([A-Z]{2})(?:\s|$)/); if (m) stateFilter = [m[1]]; } }
        } catch (e) {}
        if (!stateFilter) { try { const compRes = await pool.query(`SELECT data FROM companies WHERE id = $1`, [companyId]); if (compRes.rows.length > 0 && compRes.rows[0].data) { const cd = typeof compRes.rows[0].data === 'string' ? JSON.parse(compRes.rows[0].data) : compRes.rows[0].data; if (cd.state) stateFilter = [cd.state]; } } catch (e) {} }
        if (!stateFilter) { try { const custStates = await pool.query(`SELECT DISTINCT state FROM customers WHERE company_id = $1 AND state IS NOT NULL AND state != '' LIMIT 5`, [companyId]); if (custStates.rows.length > 0) stateFilter = custStates.rows.map(r => r.state.toUpperCase()); } catch (e) {} }
        const stormParams = [daysBack];
        let stormQuery = `SELECT id, data FROM generic_entities WHERE entity_type = 'StormEvent' AND (data->>'start_time')::timestamp >= NOW() - ($1::int * INTERVAL '1 day')`;
        if (stateFilter && stateFilter.length > 0) { stormParams.push(stateFilter); stormQuery += ` AND data->>'nws_state' = ANY($${stormParams.length})`; }
        if (activeOnly) stormQuery += ` AND data->>'status' = 'active'`;
        stormQuery += ` ORDER BY (data->>'start_time')::timestamp DESC LIMIT 50`;
        const stormRes = await pool.query(stormQuery, stormParams);
        let storms = stormRes.rows.map(r => ({ id: r.id, title: r.data.title, event_type: r.data.event_type, start_time: r.data.start_time, severity: r.data.severity, status: r.data.status, affected_areas: r.data.affected_areas, nws_state: r.data.nws_state }));
        if (eventTypes) storms = storms.filter(s => eventTypes.some(et => (s.event_type || '').toLowerCase().includes(et)));
        if (areaFilter) storms = storms.filter(s => { const areas = Array.isArray(s.affected_areas) ? s.affected_areas.join(' ').toLowerCase() : ''; return areas.includes(areaFilter) || (s.title || '').toLowerCase().includes(areaFilter); });
        const activeCount = storms.filter(s => s.status === 'active').length;
        const typeCounts = {}; storms.forEach(s => { const t = s.event_type || 'unknown'; typeCounts[t] = (typeCounts[t] || 0) + 1; });
        const stateLabel = stateFilter ? stateFilter.join(', ') : 'your area';
        return { success: true, total_count: storms.length, active_count: activeCount, type_breakdown: typeCounts, storms: storms.slice(0, 15), area_searched: stateLabel };
      }

      case 'find_subcontractors': {
        const subsRes = await pool.query(`SELECT id, data FROM generic_entities WHERE entity_type = 'Subcontractor' AND (company_id = $1 OR (data->>'company_id') = $1) ORDER BY created_date DESC NULLS LAST LIMIT 100`, [String(companyId)]);
        const allSubs = subsRes.rows.map(r => ({ id: r.id, ...r.data }));
        let matched = allSubs;
        if (a.area && a.area.trim()) { const kw = a.area.trim().toLowerCase(); matched = matched.filter(sub => [sub.base_address, sub.city, sub.state, sub.zip, sub.notes, sub.name].filter(Boolean).join(' ').toLowerCase().includes(kw)); }
        if (a.specialty && a.specialty.trim()) { const spec = a.specialty.trim().toLowerCase(); matched = matched.filter(sub => { const specs = Array.isArray(sub.specialty) ? sub.specialty : [sub.specialty || '']; return specs.some(s => (s || '').toLowerCase().includes(spec)); }); }
        matched.sort((x, y) => Number(y.is_active !== false) - Number(x.is_active !== false) || (Number(y.rating) || 0) - (Number(x.rating) || 0) || (Number(y.total_jobs_completed) || 0) - (Number(x.total_jobs_completed) || 0));
        const summary = matched.map(sub => ({ id: sub.id, name: sub.name, contact: sub.contact_person || '', phone: sub.phone || '', base_address: sub.base_address || '', rating: Number(sub.rating) || 0, rating_count: Number(sub.rating_count) || 0, service_radius_miles: Number(sub.service_radius_miles ?? sub.service_radius) || 0, specialty: Array.isArray(sub.specialty) ? sub.specialty.join(', ') : (sub.specialty || ''), availability: sub.availability || '', total_jobs_completed: Number(sub.total_jobs_completed) || 0, is_active: sub.is_active !== false }));
        return { success: true, total_in_company: allSubs.length, matched_count: matched.length, filter: { area: a.area || null, specialty: a.specialty || null }, subcontractors: summary, recommended_teams: summary.filter(sub => sub.is_active).slice(0, 3), recommendation_basis: 'Active crews are ranked by rating, then completed jobs. Compare work radius with the job location and call get_build_schedule for the requested date before confirming availability.' };
      }

      case 'add_staff_member': {
        const staffId = genId();
        const staffInsRes = await pool.query(`INSERT INTO staff_profiles (id, company_id, full_name, name, user_email, email, phone, role, position, is_administrator, is_super_admin, is_active, created_at, updated_at, created_by) VALUES ($1, $2, $3, $3, $4, $4, $5, $6, $6, false, false, true, NOW(), NOW(), $7) RETURNING id`, [staffId, companyId, a.full_name, a.email, a.phone || '', a.role || 'Team Member', userEmail]);
        return { success: true, staff_id: staffInsRes.rows[0].id, message: `Staff member "${a.full_name}" added as ${a.role || 'Team Member'}. Added without admin access — an admin can grant that in Settings.` };
      }

      case 'add_family_commission_member': {
        const famId = genId();
        const famData = { full_name: a.full_name, email: a.email, phone: a.phone || '', commission_percentage: a.commission_percentage || 1, notes: a.notes || '', is_active: true, company_id: companyId };
        const famRes = await pool.query(`INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'FamilyMember', $2, $3, NOW(), NOW()) RETURNING id`, [famId, companyId, famData]);
        return { success: true, member_id: famRes.rows[0].id, message: `"${a.full_name}" has been added as a Family Commission Member with ${a.commission_percentage || 1}% commission. They will now appear in the Family Commissions page.` };
      }

      case 'get_activity_log': {
        if (!isAdmin) return lexiAccessDenied('I can help with activity on your assigned work, but I can’t provide the company-wide activity log.');
        const limit = Math.max(1, Math.min(a.limit || 20, 50));
        const moduleFilter = (a.module && a.module !== 'all') ? a.module : null;
        const events = [];
        const moduleTableMap = {
          leads: { table: 'leads', module: 'Leads', action: 'Lead Added', descFn: r => `New lead: ${r.name || 'Unknown'} (${r.status || 'New'})${r.lead_source ? ' via ' + r.lead_source : ''}` },
          communications: { table: 'generic_entities', entityType: 'Communication', module: 'Communications', action: 'Message', descFn: r => `${(r.type || 'message').toUpperCase()} ${r.direction || ''} ${r.direction === 'inbound' ? 'from' : 'to'} ${r.contact_name || r.to_number || 'Unknown'}${r.body ? ': ' + String(r.body).slice(0, 80) : ''}` },
          estimates: { table: 'generic_entities', entityType: 'Estimate', module: 'Sales', action: 'Estimate Created', descFn: r => `Estimate for ${r.customer_name || 'Unknown'} — ${r.status || 'Draft'}${r.total ? ', $' + Number(r.total).toLocaleString() : ''}` },
          invoices: { table: 'invoices', module: 'Billing', action: 'Invoice Created', descFn: r => `Invoice for ${r.customer_name || 'Unknown'} — $${Number(r.amount || 0).toLocaleString()} (${r.status || 'Draft'})` },
          tasks: { table: 'tasks', module: 'Tasks', action: 'Task Created', descFn: r => `Task: "${r.name || 'Untitled'}" — ${r.status || 'Open'}${r.assigned_to ? ', assigned to ' + r.assigned_to : ''}` },
          customers: { table: 'customers', module: 'Customers', action: 'Customer Added', descFn: r => `New customer: ${r.name || 'Unknown'}${r.email ? ' (' + r.email + ')' : ''}` },
          workflow: { table: 'generic_entities', entityType: 'WorkflowExecution', module: 'Automation', action: 'Workflow Executed', descFn: r => `Workflow "${r.workflow_name || 'Unknown'}" ran — ${r.status || 'completed'}` },
        };
        const modulesToQuery = moduleFilter ? [moduleFilter] : Object.keys(moduleTableMap);
        for (const mod of modulesToQuery) {
          const cfg = moduleTableMap[mod];
          if (!cfg) continue;
          try {
            let rows = [];
            if (cfg.entityType) {
              const res = await pool.query(`SELECT data, created_date FROM generic_entities WHERE entity_type = $1 AND (company_id = $2 OR (data->>'company_id') = $2) ORDER BY created_date DESC NULLS LAST LIMIT 30`, [cfg.entityType, String(companyId)]);
              rows = res.rows.map(r => ({ ...r.data, _created_at: r.created_date }));
            } else {
              const res = await pool.query(`SELECT * FROM ${cfg.table} WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 30`, [companyId]);
              rows = res.rows;
            }
            for (const r of rows) {
              const ts = r.created_date || r._created_at || r.created_at;
              if (!ts) continue;
              events.push({ timestamp: ts instanceof Date ? ts.toISOString() : String(ts), module: cfg.module, action: cfg.action, description: cfg.descFn(r), actor: r.created_by || (mod === 'workflow' ? 'System' : undefined) });
            }
          } catch (e) {}
        }
        events.sort((x, y) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime());
        if (a.days && a.days > 0) { const cutoff = new Date(Date.now() - a.days * 24 * 60 * 60 * 1000); events.splice(0, events.length, ...events.filter(e => new Date(e.timestamp) >= cutoff)); }
        const sliced = events.slice(0, limit);
        const byModule = {}; for (const e of sliced) byModule[e.module] = (byModule[e.module] || 0) + 1;
        return { success: true, count: sliced.length, summary_by_module: byModule, events: sliced };
      }

      case 'get_financial_summary': {
        if (!isAdmin) return lexiAccessDenied('I can show your own sales, but I can’t share company-wide financial totals.');
        const period = (a.period || 'this_month').toString().toLowerCase();
        const timezone = companyTimezone || 'America/New_York';
        const zonedDate = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
        const addDays = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
        const today = zonedDate(new Date());
        const [year, month] = today.split('-').map(Number);
        const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
        let startDay, endDay = addDays(today, 1);
        if (period === 'this_week') startDay = addDays(today, -(weekday === 0 ? 6 : weekday - 1));
        else if (period === 'last_month') {
          const firstThisMonth = new Date(`${year}-${String(month).padStart(2, '0')}-01T12:00:00Z`);
          firstThisMonth.setUTCMonth(firstThisMonth.getUTCMonth() - 1);
          startDay = firstThisMonth.toISOString().slice(0, 10);
          endDay = `${year}-${String(month).padStart(2, '0')}-01`;
        }
        else if (period === 'this_year') startDay = `${year}-01-01`;
        else if (period === 'last_7_days') startDay = addDays(today, -6);
        else if (period === 'last_30_days') startDay = addDays(today, -29);
        else if (period === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(a.start_date || '')) { startDay = a.start_date; endDay = /^\d{4}-\d{2}-\d{2}$/.test(a.end_date || '') ? addDays(a.end_date, 1) : endDay; }
        else startDay = `${year}-${String(month).padStart(2, '0')}-01`;
        const [fsPayRes, fsInvRes] = await Promise.all([
          pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM payments WHERE company_id=$1 AND COALESCE(payment_date, created_at) >= $2::date AND COALESCE(payment_date, created_at) < $3::date AND COALESCE(status,'received') IN ('received','paid','completed') AND COALESCE(data->>'is_withheld_offset', data->'data'->>'is_withheld_offset', 'false') NOT IN ('true','t','1')`, [companyId, startDay, endDay]),
          pool.query(`SELECT status, COUNT(*) as count, COALESCE(SUM(total_amount),0) as total FROM invoices WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date AND COALESCE(status,'') NOT IN ('cancelled','void') GROUP BY status ORDER BY total DESC`, [companyId, startDay, endDay])
        ]);
        const fsTotalCollected = Number(fsPayRes.rows[0].total);
        const fsTotalInvoiced = fsInvRes.rows.reduce((s,r) => s + Number(r.total), 0);
        const fsInvoiceCount = fsInvRes.rows.reduce((s,r) => s + Number(r.count), 0);
        const fsBreakdown = fsInvRes.rows.map(r => ({ status: r.status || 'unknown', count: Number(r.count), total: Number(r.total) }));
        const fsFmt = n => '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
        return { success: true, period, reporting_timezone: timezone, period_range: { start: startDay, end_exclusive: endDay }, cash_received: fsTotalCollected, total_collected: fsTotalCollected, invoices_issued: fsTotalInvoiced, total_invoiced: fsTotalInvoiced, invoice_count: fsInvoiceCount, payment_count: Number(fsPayRes.rows[0].count), invoice_breakdown_by_status: fsBreakdown, summary: `Cash received for ${period.replace(/_/g,' ')}: ${fsFmt(fsTotalCollected)} across ${fsPayRes.rows[0].count} received payment(s). Separately, ${fsInvoiceCount} invoice(s) issued totaled ${fsFmt(fsTotalInvoiced)}.` };
      }

      case 'get_staff_sales_summary': {
        const requestedStaffName = (a.staff_name || a.rep_name || a.name || '').toString().trim();
        // A non-admin's requested staff name is untrusted model input. Always
        // resolve it to the authenticated caller, never just team/blank asks.
        if (!isAdmin) a.staff_name = userEmail;
        const rawStaffName = (a.staff_name || a.rep_name || a.name || '').toString().trim();
        const ssTeamKeywords = ['all', 'team', 'everyone', 'all staff', 'all reps', 'whole team', 'the team', 'the whole team'];
        const isTeamQuery = !rawStaffName || ssTeamKeywords.includes(rawStaffName.toLowerCase());
        const period = (a.period || 'this_month').toString().toLowerCase();
        const nowSs = new Date();
        let startDate, endDate = new Date();
        if (period === 'this_week') { const dow = nowSs.getDay(); const back = dow === 0 ? 6 : dow - 1; startDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), nowSs.getDate() - back); }
        else if (period === 'last_month') { startDate = new Date(nowSs.getFullYear(), nowSs.getMonth() - 1, 1); endDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), 0, 23, 59, 59, 999); }
        else if (period === 'this_year') { startDate = new Date(nowSs.getFullYear(), 0, 1); }
        else if (period === 'last_7_days') { startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); }
        else if (period === 'last_30_days') { startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); }
        else if (period === 'all_time') { startDate = new Date(0); }
        else if (period === 'custom' && a.start_date) { startDate = new Date(a.start_date); if (a.end_date) endDate = new Date(a.end_date); }
        else { startDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), 1); }
        if (!startDate || isNaN(startDate.getTime())) startDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), 1);
        const ssFmt = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const ssInvRes = await pool.query(
          `SELECT total_amount, sale_agent, created_by, issue_date, created_at, commission_splits FROM invoices WHERE company_id = $1 AND status = 'paid'`,
          [companyId]
        );
        if (isTeamQuery) {
          const allStaffRes = await pool.query(
            `SELECT user_email, full_name FROM staff_profiles WHERE company_id = $1 AND is_active IS NOT FALSE AND user_email IS NOT NULL ORDER BY full_name`,
            [companyId]
          );
          const salesMap = {}, countMap = {};
          for (const s of allStaffRes.rows) { salesMap[s.user_email] = 0; countMap[s.user_email] = 0; }
          for (const inv of ssInvRes.rows) {
            const dRaw = inv.issue_date || inv.created_at;
            const d = new Date(dRaw);
            if (!dRaw || isNaN(d.getTime()) || d < startDate || d > endDate) continue;
            const invTotal = Number(inv.total_amount || 0);
            const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
            if (splits.length > 0) {
              for (const sp of splits) {
                if (sp && sp.user_email && sp.user_email in salesMap) {
                  salesMap[sp.user_email] += invTotal * (Number(sp.split_percentage || 0) / 100);
                  countMap[sp.user_email]++;
                }
              }
            } else {
              const email = inv.sale_agent || inv.created_by;
              if (email && email in salesMap) { salesMap[email] += invTotal; countMap[email]++; }
            }
          }
          const ranked = allStaffRes.rows
            .map(s => ({ name: s.full_name, total_sales: salesMap[s.user_email] || 0, invoice_count: countMap[s.user_email] || 0 }))
            .sort((a, b) => b.total_sales - a.total_sales)
            .map((s, i) => ({ rank: i + 1, ...s }));
          const lines = ranked.map(s => `${s.rank}. ${s.name}: ${ssFmt(s.total_sales)} (${s.invoice_count} invoice${s.invoice_count === 1 ? '' : 's'})`);
          return {
            success: true,
            period,
            period_range: { start: startDate.toISOString().split('T')[0], end: endDate.toISOString().split('T')[0] },
            leaderboard: ranked,
            total_reps: ranked.length,
            summary: ranked.length > 0 ? `Sales leaderboard for ${period.replace(/_/g, ' ')}:\n${lines.join('\n')}` : `No sales recorded for ${period.replace(/_/g, ' ')}.`
          };
        } else {
          const escSs = rawStaffName.replace(/[\\%_]/g, '\\$&');
          const staffRes = await pool.query(
            `SELECT user_email, full_name FROM staff_profiles WHERE company_id = $1 AND is_active IS NOT FALSE AND user_email IS NOT NULL AND (LOWER(user_email) = LOWER($2) OR LOWER(full_name) = LOWER($2) OR full_name ILIKE $3)`,
            [companyId, rawStaffName, `%${escSs}%`]
          );
          const ssRows = staffRes.rows || [];
          const ssExact = ssRows.filter(r => (r.full_name || '').toLowerCase() === rawStaffName.toLowerCase());
          const ssPick = ssExact.length ? ssExact : ssRows;
          if (ssPick.length === 0) return { error: `I couldn't find a team member named "${rawStaffName}". Please check the name or pick someone from your staff list.`, success: false };
          if (ssPick.length > 1) {
            const names = ssPick.slice(0, 5).map(r => r.full_name).join(', ');
            return { error: `More than one team member matches "${rawStaffName}": ${names}. Which one did you mean?`, success: false };
          }
          const staffMember = ssPick[0];
          if (!isAdmin && String(staffMember.user_email || '').toLowerCase() !== String(userEmail || '').toLowerCase()) {
            return lexiAccessDenied('I can show your own sales, but I can’t share another team member’s sales or earnings.');
          }
          const ssEmail = staffMember.user_email;
          let totalSales = 0, invoiceCount = 0;
          for (const inv of ssInvRes.rows) {
            const dRaw = inv.issue_date || inv.created_at;
            const d = new Date(dRaw);
            if (!dRaw || isNaN(d.getTime()) || d < startDate || d > endDate) continue;
            const invTotal = Number(inv.total_amount || 0);
            const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
            const mySplit = splits.find(s => s && s.user_email === ssEmail);
            if (mySplit) {
              totalSales += invTotal * (Number(mySplit.split_percentage || 0) / 100);
              invoiceCount++;
            } else if (splits.length === 0 && (inv.sale_agent === ssEmail || inv.created_by === ssEmail)) {
              totalSales += invTotal;
              invoiceCount++;
            }
          }
          return {
            success: true,
            staff_name: staffMember.full_name,
            period,
            period_range: { start: startDate.toISOString().split('T')[0], end: endDate.toISOString().split('T')[0] },
            total_sales: totalSales,
            invoice_count: invoiceCount,
            summary: `${staffMember.full_name} brought in ${ssFmt(totalSales)} in sales across ${invoiceCount} paid invoice${invoiceCount === 1 ? '' : 's'} for ${period.replace(/_/g, ' ')}.`
          };
        }
      }

      case 'add_note': {
        const noteText = (a.note_text || a.text || a.content || a.body || a.note || '').toString().trim();
        if (!noteText) return { error: 'note_text is required', success: false };
        let customerId = a.customer_id || null;
        let leadId = a.lead_id || null;
        let parentLabel = '';
        if (customerId) {
          const own = await pool.query(`SELECT name FROM customers WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(customerId), companyId]);
          if (own.rows.length === 0) return { error: `Customer ${customerId} not found in your company.`, success: false };
          parentLabel = `customer "${own.rows[0].name}"`;
        }
        if (leadId) {
          const own = await pool.query(`SELECT name FROM leads WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(leadId), companyId]);
          if (own.rows.length === 0) return { error: `Lead ${leadId} not found in your company.`, success: false };
          parentLabel = `lead "${own.rows[0].name}"`;
        }
        if (!customerId && a.customer_name) {
          const cn = a.customer_name.trim().toLowerCase();
          const cMatch = await pool.query(`SELECT id, name FROM customers WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`, [companyId, `%${cn}%`, cn]);
          if (cMatch.rows.length === 0) return { error: `No customer found matching "${a.customer_name}". Ask the user for the exact name or provide a lead instead.`, success: false };
          if (cMatch.rows.length > 1 && cMatch.rows[0].name.toLowerCase() !== cn) return { error: `Multiple customers match "${a.customer_name}": ${cMatch.rows.map(r => r.name).join(', ')}. Ask which one.`, success: false, candidates: cMatch.rows };
          customerId = cMatch.rows[0].id; parentLabel = `customer "${cMatch.rows[0].name}"`;
        }
        if (!customerId && !leadId && a.lead_name) {
          const ln = a.lead_name.trim().toLowerCase();
          const lMatch = await pool.query(`SELECT id, name FROM leads WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`, [companyId, `%${ln}%`, ln]);
          if (lMatch.rows.length === 0) return { error: `No lead found matching "${a.lead_name}". Ask the user for the exact name or provide a customer instead.`, success: false };
          if (lMatch.rows.length > 1 && lMatch.rows[0].name.toLowerCase() !== ln) return { error: `Multiple leads match "${a.lead_name}": ${lMatch.rows.map(r => r.name).join(', ')}. Ask which one.`, success: false, candidates: lMatch.rows };
          leadId = lMatch.rows[0].id; parentLabel = `lead "${lMatch.rows[0].name}"`;
        }
        if (!customerId && !leadId) return { error: 'No customer or lead specified. Ask the user which customer or lead this note is for.', success: false };
        let createdByName = null;
        try { const spRes = await pool.query(`SELECT full_name FROM staff_profiles WHERE user_email = $1 LIMIT 1`, [userEmail]); if (spRes.rows.length > 0) createdByName = spRes.rows[0].full_name || null; } catch (e) {}
        const noteId = genId();
        const noteData = { note: noteText, created_at: new Date().toISOString(), created_by: userEmail, created_by_name: createdByName, source_type: 'lexi', source_label: 'Lexi' };
        if (customerId) noteData.customer_id = customerId;
        if (leadId) noteData.lead_id = leadId;
        await pool.query(`INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'CustomerNote', $2, $3, NOW(), NOW())`, [noteId, String(companyId), JSON.stringify(noteData)]);
        return { success: true, note_id: noteId, message: `Note added to ${parentLabel || 'record'}.` };
      }

      case 'get_photosync_jobs': {
        if (!isAdmin) {
          return lexiAccessDenied('I can help with your assigned CRM records, but I can’t retrieve the company-wide inspection list.');
        }
        const psStatus = a.status || 'all';
        const psLimit = Math.min(a.limit || 10, 50);
        const psDaysBack = a.days_back;
        const psWhere = [`entity_type = 'InspectionJob'`, `company_id = $1`];
        const psParams = [companyId];
        if (psStatus && psStatus !== 'all') { psParams.push(psStatus); psWhere.push(`data->>'status' = $${psParams.length}`); }
        if (psDaysBack) psWhere.push(`created_date >= NOW() - INTERVAL '${parseInt(psDaysBack)} days'`);
        const psRes = await pool.query(`SELECT id, data, created_date FROM generic_entities WHERE ${psWhere.join(' AND ')} ORDER BY created_date DESC LIMIT ${psLimit}`, psParams);
        const psJobs = psRes.rows.map(r => ({ id: r.id, client: r.data.client_name || r.data.customer_name, client_phone: r.data.client_phone, client_email: r.data.client_email, address: r.data.property_address, status: r.data.status || 'scheduled', priority: r.data.priority, assigned_to: r.data.assigned_to_email, date: r.data.inspection_date || r.data.scheduled_date, time: r.data.inspection_time, damage_type: r.data.damage_type, notes: r.data.notes || null, special_instructions: r.data.special_instructions || null, created: r.created_date }));
        return { jobs: psJobs, total: psJobs.length };
      }

      case 'find_claim_documents': {
        const cdQuery = (a.query || '').toLowerCase().trim();
        const cdType = a.type || 'all';
        const CD_MASTER_IDS = ['695944e3c1fb00b7ab716c6f', 'companysync_master_001'];
        const cdResults = { templates: [], documents: [] };

        if (cdType === 'all' || cdType === 'email_templates') {
          const tplIds = [companyId, ...CD_MASTER_IDS];
          const tplPH = tplIds.map((_, i) => `$${i + 1}`).join(',');
          const tplRes = await pool.query(
            `SELECT id, data FROM generic_entities WHERE entity_type = 'EmailTemplate' AND company_id IN (${tplPH}) AND data->>'category' IN ('insurance_rebuttals','matching_letters') ORDER BY created_date DESC LIMIT 50`,
            tplIds
          );
          for (const row of tplRes.rows) {
            const d = row.data || {};
            const name = d.template_name || d.name || '';
            const subj = d.subject || '';
            const body = d.body || '';
            if (!cdQuery || name.toLowerCase().includes(cdQuery) || subj.toLowerCase().includes(cdQuery) || body.toLowerCase().includes(cdQuery)) {
              cdResults.templates.push({ id: row.id, name, subject: subj, category: d.category || '', preview: body.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 400), full_body: body });
            }
          }
        }

        if (cdType === 'all' || cdType === 'documents') {
          const docRes = await pool.query(
            `SELECT id, data FROM generic_entities WHERE entity_type = 'Document' AND company_id = $1 AND data->>'category' IN ('supplier_letters','rebuttal_docs') ORDER BY created_date DESC LIMIT 50`,
            [companyId]
          );
          for (const row of docRes.rows) {
            const d = row.data || {};
            const name = d.document_name || d.name || '';
            const desc = d.description || '';
            if (!cdQuery || name.toLowerCase().includes(cdQuery) || desc.toLowerCase().includes(cdQuery)) {
              cdResults.documents.push({ id: row.id, name, description: desc, category: d.category || '', file_url: d.file_url || '' });
            }
          }
        }

        const cdTotal = cdResults.templates.length + cdResults.documents.length;
        return { ...cdResults, total: cdTotal, query: a.query || null };
      }

      case 'record_payment': {
        const rpAmt = a.amount, rpMethod = a.payment_method, rpCustName = a.customer_name, rpCustId = a.customer_id,
              rpInvNum = a.invoice_number, rpDateRaw = a.payment_date, rpRef = a.reference_number, rpNotes = a.notes;
        if (!rpAmt || isNaN(Number(rpAmt)) || Number(rpAmt) <= 0) return { error: 'A valid payment amount greater than zero is required.', success: false };
        const rpToday = new Date().toISOString().split('T')[0];
        const rpDate = (typeof rpDateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rpDateRaw)) ? rpDateRaw : rpToday;
        let rpCustomerId = rpCustId || null, rpCustomerName = '', rpInvoiceId = null, rpInvoiceNumber = rpInvNum || null;
        if (rpInvNum) {
          const rpIR = await pool.query(`SELECT id, invoice_number, customer_id, customer_name FROM invoices WHERE company_id = $1 AND LOWER(invoice_number) = LOWER($2) LIMIT 1`, [companyId, rpInvNum.trim()]);
          if (rpIR.rows.length > 0) {
            rpInvoiceId = rpIR.rows[0].id; rpInvoiceNumber = rpIR.rows[0].invoice_number;
            if (!rpCustomerId) rpCustomerId = rpIR.rows[0].customer_id;
            if (!rpCustomerName) rpCustomerName = rpIR.rows[0].customer_name || '';
          } else {
            // Invoice number not found in CRM — treat as external reference (e.g. insurance
            // remittance numbers like BI-XXXXX from Sedgwick, carrier billing IDs, etc.).
            rpInvoiceNumber = rpInvNum.trim();
          }
        }
        if (rpCustomerId && !rpCustomerName) {
          const rpCR = await pool.query(`SELECT id, name FROM customers WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(rpCustomerId), companyId]);
          if (rpCR.rows.length > 0) rpCustomerName = rpCR.rows[0].name;
        } else if (!rpCustomerId && rpCustName) {
          const rpCn = rpCustName.trim().toLowerCase();
          const rpCR = await pool.query(`SELECT id, name FROM customers WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`, [companyId, `%${rpCn}%`, rpCn]);
          if (rpCR.rows.length === 0) return { error: `No customer found matching "${rpCustName}".`, success: false };
          rpCustomerId = rpCR.rows[0].id; rpCustomerName = rpCR.rows[0].name;
        } else if (!rpCustomerId && !rpCustName && !rpInvNum) {
          return { error: 'Who is this payment from? Please provide a customer name or invoice number.', success: false };
        }
        let rpPmtNum = `PMT-${Date.now().toString().slice(-6)}`;
        try { const rpLP = await pool.query(`SELECT payment_number FROM payments WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`, [companyId]); if (rpLP.rows.length > 0 && rpLP.rows[0].payment_number) { const rpM = rpLP.rows[0].payment_number.match(/\d+$/); if (rpM) rpPmtNum = `PMT-${String(parseInt(rpM[0])+1).padStart(5,'0')}`; } } catch (e) {}
        const rpPmtId = genId();
        await pool.query(
          `INSERT INTO payments (id,company_id,customer_id,customer_name,invoice_id,invoice_number,payment_number,amount,payment_method,payment_date,reference_number,notes,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'received',NOW(),NOW())`,
          [rpPmtId, companyId, rpCustomerId||null, rpCustomerName||null, rpInvoiceId||null, rpInvoiceNumber||null, rpPmtNum, Number(rpAmt), rpMethod||'other', rpDate, rpRef||null, rpNotes||null]
        );
        setImmediate(async () => {
          try {
            const pmt = { id: rpPmtId, company_id: companyId, customer_id: rpCustomerId||null, customer_name: rpCustomerName||null, invoice_id: rpInvoiceId||null, invoice_number: rpInvoiceNumber||null, amount: Number(rpAmt), payment_method: rpMethod||'other', payment_date: rpDate, reference_number: rpRef||null };
            await qbSync.pushPaymentToQB(pool, companyId, pmt);
            if (rpInvoiceId) {
              const invRow = await pool.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [rpInvoiceId]);
              if (invRow.rows[0]) await qbSync.pushInvoiceToQB(pool, companyId, invRow.rows[0]);
            }
          } catch (qbErr) { console.warn('[QB auto-sync] payment:', qbErr.message); }
        });
        const methodLabel = {cash:'Cash',check:'Check',credit_card:'Credit Card',bank_transfer:'Bank Transfer',paypal:'PayPal',stripe:'Stripe',other:'Other'}[rpMethod]||rpMethod;
        try {
          const handlers = await require('./db/prod-integrations.cjs').getFunctionHandlers();
          await require('./lib/paymentStaffAlerts.cjs').notifyPaymentStaff(pool, {
            companyId, paymentId: rpPmtId,
            sendSms: opts => handlers.sendSMS(opts),
          });
        } catch (rpNErr) { console.warn('[Lexi] record_payment notify:', rpNErr.message); }
        return { success: true, payment_number: rpPmtNum, customer: rpCustomerName, invoice: rpInvoiceNumber, amount: Number(rpAmt), method: methodLabel, date: rpDate,
          message: `Payment recorded — ${rpPmtNum}: $${Number(rpAmt).toFixed(2)} by ${methodLabel}${rpCustomerName?' from '+rpCustomerName:''}${rpInvoiceNumber?', applied to '+rpInvoiceNumber:''}${rpRef?', Ref: '+rpRef:''}` };
      }

      case 'scan_check': {
        if (!a.file_url) return { error: 'file_url is required.', success: false };
        let scCustomerId = a.customer_id || null;
        let scCustomerName = '';
        if (scCustomerId) {
          const scCR = await pool.query(`SELECT id, name FROM customers WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(scCustomerId), companyId]);
          if (scCR.rows.length > 0) { scCustomerName = scCR.rows[0].name; }
          else { return { error: `Customer "${scCustomerId}" not found.`, success: false }; }
        } else if (a.customer_name) {
          const scCn = a.customer_name.trim().toLowerCase();
          const scCR = await pool.query(`SELECT id, name FROM customers WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`, [companyId, `%${scCn}%`, scCn]);
          if (scCR.rows.length === 0) { return { error: `No customer found matching "${a.customer_name}".`, success: false }; }
          if (scCR.rows.length > 1 && scCR.rows[0].name.toLowerCase() !== scCn) { return { error: `Multiple customers match "${a.customer_name}": ${scCR.rows.map(r => r.name).join(', ')}. Which one?`, success: false }; }
          scCustomerId = scCR.rows[0].id; scCustomerName = scCR.rows[0].name;
        } else { return { error: 'Which customer is this check for? Provide customer_name or customer_id.', success: false }; }
        const scToday = new Date().toISOString().split('T')[0];
        const scApiKey = process.env.GOOGLE_GEMINI_API_KEY;
        let scB64 = null, scMime = 'image/jpeg';
        try {
          const scFR = await fetch(a.file_url);
          if (scFR.ok) { scB64 = Buffer.from(await scFR.arrayBuffer()).toString('base64'); scMime = scFR.headers.get('content-type') || 'image/jpeg'; }
        } catch (e) { console.warn('[Lexi Tool] scan_check img:', e.message); }
        if (!scB64) return { error: 'Could not read the check image. Ensure the file was uploaded.', success: false };
        let scX = {};
        try {
          const scGR = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${scApiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: scMime, data: scB64 } }, { text: `Extract check details as JSON: amount (number, no $ or commas), check_number (string), check_date (YYYY-MM-DD), payer_name (string), memo (string or null). Today is ${scToday}. Never return a future date. Return JSON only.` }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 256, responseMimeType: 'application/json' } }) }, { timeoutMs: 30000 });
          const scGD = await scGR.json();
          if (!scGD.error) { try { scX = JSON.parse(scGD.candidates?.[0]?.content?.parts?.[0]?.text || '{}'); } catch (e) {} }
        } catch (e) { console.warn('[Lexi Tool] scan_check AI:', e.message); }
        const { amount: scAmt, check_number: scChkNum, check_date: scChkDate, payer_name: scPayer, memo: scMemo } = scX;
        let scDate = scToday;
        if (typeof scChkDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(scChkDate)) {
          const scPd = new Date(scChkDate + 'T00:00:00Z');
          if (!isNaN(scPd.getTime()) && scPd <= new Date()) { const scDf = (Date.now() - scPd.getTime()) / 86400000; if (scDf <= 180) { scDate = scChkDate; } else { const [,sm,sd] = scChkDate.split('-').map(Number); const sc = new Date(new Date().getFullYear(), (sm||1)-1, sd||1); if (sc <= new Date()) scDate = sc.toISOString().split('T')[0]; } }
        }
        let scPmtNum = `PMT-${Date.now().toString().slice(-6)}`;
        try { const scLp = await pool.query(`SELECT payment_number FROM payments WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`, [companyId]); if (scLp.rows.length > 0 && scLp.rows[0].payment_number) { const scM = scLp.rows[0].payment_number.match(/\d+$/); if (scM) scPmtNum = `PMT-${String(parseInt(scM[0])+1).padStart(5,'0')}`; } } catch (e) {}
        try { await pool.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'Document',$2,$3,NOW(),NOW())`, [genId(), String(companyId), JSON.stringify({ company_id: String(companyId), document_name: `Check ${scChkNum||scPmtNum}`, file_url: a.file_url, category: 'Check', related_entity_type: 'Customer', related_entity_id: scCustomerId, description: `Check: $${scAmt||0} from ${scPayer||'N/A'}`, uploaded_by: userEmail })]); } catch (e) {}
        const scPmtId = genId();
        await pool.query(`INSERT INTO payments (id,company_id,customer_id,customer_name,payment_number,amount,payment_method,payment_date,reference_number,notes,status,file_url,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'check',$7,$8,$9,'received',$10,NOW(),NOW())`,
          [scPmtId, companyId, scCustomerId, scCustomerName, scPmtNum, scAmt||0, scDate, scChkNum||'', scMemo ? `Payer: ${scPayer||'N/A'}\nMemo: ${scMemo}` : `Payer: ${scPayer||'N/A'}`, a.file_url]);
        return { success: true, payment_number: scPmtNum, customer: scCustomerName, amount: scAmt, check_number: scChkNum, check_date: scDate, payer_name: scPayer, message: `Check payment recorded for ${scCustomerName}: $${scAmt||0}, Check #${scChkNum||'N/A'}, Date: ${scDate}` };
      }

      case 'read_emails': {
        const { query: gmQ, limit: gmL, unread_only: gmU } = a;
        const gmTok = await getGmailTokenForCompany(pool, companyId);
        if (!gmTok) return { error: 'Gmail is not connected. Ask the owner to connect Gmail in Settings → Integrations.' };
        const gmLimit = Math.min(Number(gmL) || 10, 10);
        let gmSearch = gmQ || 'in:inbox';
        if (gmU) gmSearch = `is:unread ${gmSearch}`;
        const gmList = await gmailApiCall(gmTok.token, `/messages?q=${encodeURIComponent(gmSearch)}&maxResults=${gmLimit}`);
        const gmMsgs = gmList.messages || [];
        if (gmMsgs.length === 0) return { emails: [], count: 0, message: 'No emails found matching your search.' };
        const gmDetails = await Promise.all(gmMsgs.slice(0, gmLimit).map(async m => {
          try {
            const md = await gmailApiCall(gmTok.token, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
            const hdrs = Object.fromEntries((md.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
            const crmMatch = await findCrmContactByEmail(pool, companyId, hdrs.from);
            const entry = { id: m.id, from: hdrs.from, to: hdrs.to, subject: hdrs.subject, date: hdrs.date, snippet: md.snippet, unread: (md.labelIds || []).includes('UNREAD'), thread_id: md.threadId };
            if (crmMatch) entry.crm_match = crmMatch;
            return entry;
          } catch (e) { return { id: m.id, error: e.message }; }
        }));
        return { emails: gmDetails, count: gmDetails.length, gmail_account: gmTok.gmail_email };
      }
      case 'get_email': {
        const { email_id: gmId } = a;
        if (!gmId) return { error: 'email_id is required' };
        const gmTok = await getGmailTokenForCompany(pool, companyId);
        if (!gmTok) return { error: 'Gmail is not connected.' };
        const gmMsg = await gmailApiCall(gmTok.token, `/messages/${gmId}?format=full`);
        const gmHdrs = Object.fromEntries((gmMsg.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
        function gmExtractBody(payload) {
          if (payload.mimeType === 'text/plain' && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
          if (payload.parts) { for (const p of payload.parts) { const t = gmExtractBody(p); if (t) return t; } }
          if (payload.mimeType?.startsWith('text/') && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
          return '';
        }
        const gmBody = gmExtractBody(gmMsg.payload || {}).substring(0, 4000);
        const gmCrmMatch = await findCrmContactByEmail(pool, companyId, gmHdrs.from);
        const gmResult = { id: gmId, from: gmHdrs.from, to: gmHdrs.to, subject: gmHdrs.subject, date: gmHdrs.date, body: gmBody, thread_id: gmMsg.threadId, unread: (gmMsg.labelIds || []).includes('UNREAD') };
        if (gmCrmMatch) gmResult.crm_match = gmCrmMatch;
        return gmResult;
      }
      case 'reply_to_email': {
        const { email_id: gmReId, body: gmReBody } = a;
        if (!gmReId || !gmReBody) return { error: 'email_id and body are both required' };
        const gmTok = await getGmailTokenForCompany(pool, companyId);
        if (!gmTok) return { error: 'Gmail is not connected.' };
        const gmOrig = await gmailApiCall(gmTok.token, `/messages/${gmReId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Message-ID`);
        const gmHdrs = Object.fromEntries((gmOrig.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
        const gmSubject = gmHdrs.subject?.startsWith('Re:') ? gmHdrs.subject : `Re: ${gmHdrs.subject || '(no subject)'}`;
        const gmReplyTo = gmHdrs.from || '';
        const gmMsgId = gmHdrs['message-id'] || '';
        const gmRaw = [`From: ${gmTok.gmail_email}`, `To: ${gmReplyTo}`, `Subject: ${gmSubject}`, `In-Reply-To: ${gmMsgId}`, `References: ${gmMsgId}`, `Content-Type: text/plain; charset=utf-8`, ``, gmReBody].join('\r\n');
        const gmEncoded = Buffer.from(gmRaw).toString('base64url');
        await gmailApiCall(gmTok.token, '/messages/send', 'POST', { raw: gmEncoded, threadId: gmOrig.threadId });
        return { success: true, message: `Reply sent to ${gmReplyTo}`, subject: gmSubject };
      }
      case 'mark_email_read': {
        const { email_id: gmMrId } = a;
        if (!gmMrId) return { error: 'email_id is required' };
        const gmTok = await getGmailTokenForCompany(pool, companyId);
        if (!gmTok) return { error: 'Gmail is not connected.' };
        await gmailApiCall(gmTok.token, `/messages/${gmMrId}/modify`, 'POST', { removeLabelIds: ['UNREAD'] });
        return { success: true, message: 'Email marked as read' };
      }
      default:
        console.warn(`[Lexi Tool] Unknown tool: ${name}`);
        return { error: `Unknown tool: ${name}`, success: false };
    }
  } catch (err) {
    console.error(`[Lexi Tool] ${name} error:`, err.message);
    return { error: `Tool ${name} failed: ${err.message}`, success: false };
  }
}

function buildLexiSystemPrompt(companyName, userName, timezone, knowledgeBase, customerList, staffList, preferredLanguage, recentSessionContext, spokenNameSetting) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone });
  const timeStr = now.toLocaleString('en-US', { timeZone: timezone });
  const todayISO = now.toISOString().split('T')[0];
  // Compute current UTC offset for the company timezone (e.g. "-04:00" for EDT)
  let tzOffset = '-04:00';
  try {
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr  = now.toLocaleString('en-US', { timeZone: timezone });
    const diffMin = Math.round((new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000);
    const sign = diffMin >= 0 ? '+' : '-';
    const abs = Math.abs(diffMin);
    tzOffset = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  } catch (_) {}
  let staffCtx = '';
  if (staffList?.length) staffCtx = `\nStaff: ${staffList.map(s => `${s.name} (${s.email}${s.role?', '+s.role:''})`).join(', ')}`;
  const isSpanish = preferredLanguage === 'es';
  const languageInstruction = isSpanish
    ? `\nLANGUAGE: You MUST respond exclusively in Spanish (Español) at all times. Greet in Spanish. All responses must be in Spanish unless the user explicitly switches to English.`
    : '';
  const prompt = `You are Lexi, a helpful AI assistant for ${companyName}. Speaking with ${userName}.${languageInstruction}

CRITICAL: No internal thinking text. No markdown. Speak naturally. Keep under 30 words.

Context: Company=${companyName}, User=${userName}${staffCtx}
${customerList ? `Customers: ${customerList}` : ''}
${knowledgeBase ? `Knowledge Base:\n${knowledgeBase}` : ''}

YOUR CAPABILITIES (use tools for ALL of these):
- Calendar: Create events, look up upcoming events, set reminders, schedule inspections/appointments/meetings/calls
- Tasks: Create tasks with due dates and priorities
- Leads & Customers: Create, update, look up contacts
- PhotoSync Jobs: Query existing PhotoSync/CrewCam inspection jobs (status, crew, client, date) or schedule new ones
- Claim Documents: Use find_claim_documents to retrieve rebuttal letters, supplier letters, and matching letters from the document library and email templates. Pass a keyword to narrow results.
- Email & SMS: Compose and send messages
- CRM Data: Look up records permitted for the current caller
- Payments: ALWAYS use record_payment tool — NEVER manage_entity. manage_entity for payments saves to the wrong table and the payment becomes invisible. For check photos, use scan_check. For ANY payment (manual, PDF, insurance remittance, Sedgwick, etc.) use record_payment with: amount, customer_name, payment_date, payment_method=bank_transfer for ACH/insurance, reference_number=carrier invoice number (e.g. BI-XXXXX). The carrier's billing IDs like BI-XXXXX are external references — pass as reference_number, not invoice_number. Record ALL line items. If customer not found by name, say so — do NOT record with a blank customer.
- Gmail/Email: Use read_emails to list/search inbox. Use get_email to fetch full body. Use reply_to_email to respond (call get_email first). Use mark_email_read to clear unread. If Gmail not connected, tell user to go to Settings → Integrations to connect Gmail. NEVER fabricate email content. CRM AUTO-LINK: read_emails and get_email results may include a "crm_match" field. When present, ALWAYS surface it (e.g. "This is from John Smith (customer)"). After reading an email with a crm_match, proactively offer to log it as a note on that record using add_note. If no crm_match, do not guess or invent a link.
- Generic CRM management: Use only when the server permits it for the current caller
- Memory: When the user shares a personal preference, habit, or standing instruction about THEMSELVES ("I always add 15% waste", "I prefer afternoon appointments"), IMMEDIATELY call save_memory to remember it — just save it and briefly confirm. Never use save_memory for facts about customers or leads.

Date: ${dateStr}, Time: ${timeStr}, TZ: ${timezone} (offset: ${tzOffset}), Today: ${todayISO}
⚠️ CALENDAR DATES: ALWAYS include the timezone offset in start_time. "at 8am" → "${todayISO}T08:00:00${tzOffset}". NEVER use bare times like T08:00:00 — they parse as UTC and display 4 hours early.

TOOL RULES:
- Builds and installs: use create_build_schedule (not manage_entity or a meeting). It requires customer_name/customer_id, build_date, and one-or-more job_types; ask one focused follow-up when missing. Use get_build_schedule for build date, type, status, customer, address, rep, or crew questions.
- When asked to schedule/create/remind, just do it immediately using tools. Don't ask permission.
- For any "remind me" request, call create_calendar_event with event_type "reminder". Reminders are personal alerts and must not be rejected because an appointment occupies that time.
- When asked about calendar/data, use your tools to look it up. Never guess.
- FINANCIAL LANGUAGE: “earned,” “made,” “collected,” and “received” mean cash received, so call get_financial_summary and lead with cash_received. “Invoiced,” “issued,” and “invoice sales” mean invoices_issued. If the user says only “revenue,” name the measure you are reporting and offer the other; never silently substitute invoice totals for cash.
- Never imply unrestricted CRM access. Tool results enforce staff permissions; explain an access denial briefly and offer help with the caller's own work instead.
- Administrators can use manage_entity to assign or reassign a rep or owner to a lead or customer. Staff must use the dedicated, permitted tools for their own work.
- CRITICAL: If a tool returns { "error": "..." } or { "success": false }, explain that briefly, then ask one concise question or offer to retry. NEVER claim an action succeeded if the tool result shows an error or failure.
- If a tool returns { "success": true }, confirm the action to the user naturally.

Only greet ${userName} when this is genuinely the first exchange of a new conversation. If they have spoken with Lexi earlier today or make a substantive request, answer directly without reintroducing yourself.

VOICE & BEHAVIOR RULES (always apply):
1. BREVITY: Keep every response to 1 to 2 short sentences unless you are reading back specific data. Never give long speeches or bulleted lists.
2. NATURAL FLOW: Speak like a real person. Use natural phrases like "Got it," "Sure thing," "On it," or "One sec."
3. ONE QUESTION AT A TIME: When you need clarification, ask a single clear question then stop and wait. Never stack questions.
4. HANDLING INTERRUPTIONS: If the user cuts in or speaks over you, stop and address what they just said. If the request is unclear or incomplete, ask one concise clarification instead of ending the conversation.
5. INTENT: Be fast, direct, and action-oriented. Confirm what you did in one short sentence.
${lexiGroundingRules({ compact: true })}${recentSessionContext ? `\n\nRECENT CONVERSATION CONTEXT (earlier in this same conversation — continue naturally, do NOT re-introduce yourself or re-greet):\n${recentSessionContext}` : ''}`;
  return applySpokenCompanyName(prompt, companyName, deriveSpokenBrandName(spokenNameSetting, companyName));
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
}

const server = http.createServer(async (req, res) => {
  try {
  setSecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, req);
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/health' || pathname === '/_health' || pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // Centralized impersonation expiry guard — enforced on every authenticated /api/ request.
  // Exempts impersonation/stop (so admin can terminate), webhooks, and static asset routes.
  if (pathname.startsWith('/api/') &&
      pathname !== '/api/impersonation/stop' &&
      !pathname.startsWith('/api/stripe/') &&
      !pathname.startsWith('/api/twilio/') &&
      !pathname.startsWith('/api/twiml') &&
      !pathname.startsWith('/api/functions/incoming') &&
      !pathname.startsWith('/api/whatsapp') &&
      !pathname.startsWith('/api/sarah-')) {
    try {
      const pool = prodDb.getPool();
      const impCtx = await tenantGuard.resolveRequestContext(req, pool);
      if (impCtx.impersonationExpired) {
        setCorsHeaders(res, req);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Impersonation session expired. Please return to the admin dashboard.' }));
        return;
      }
      req._impersonationCtx = impCtx;
    } catch (_) { /* don't fail unauthenticated routes due to session lookup errors */ }
  }

  // Provider bounce/complaint ingress. Public by necessity (the provider calls
  // it), authenticated by a server-only shared secret. Mirror of the dev route
  // in vite-functions-plugin.js — both copies are required or it 404s here.
  if (await emailDeliveryWebhook.handleEmailDeliveryWebhook(req, res)) return;

  const inspectionReportUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  if (inspectionReportUrl.pathname === '/api/inspection-reports/upload') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    try {
      const caller = await getAuthenticatedProdUser(req);
      if (!caller?.email) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Authentication required.' }));
        return;
      }
      await require('./lib/inspectionReportDelivery.cjs').handleUploadRoute(req, res, {
        pool: prodDb.getPool(),
        caller,
        jobId: inspectionReportUrl.searchParams.get('inspectionJobId'),
      });
    } catch (error) {
      const status = error.statusCode || 500;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: error.statusCode ? error.message : 'The report could not be stored securely.' }));
    }
    return;
  }
  if (inspectionReportUrl.pathname === '/api/inspection-reports/photo') {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end();
      return;
    }
    try {
      const caller = await getAuthenticatedProdUser(req);
      if (!caller?.email) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'Authentication required.' }));
        return;
      }
      await require('./lib/inspectionReportDelivery.cjs').handlePhotoRoute(req, res, {
        pool: prodDb.getPool(),
        caller,
        jobId: inspectionReportUrl.searchParams.get('inspectionJobId'),
        mediaId: inspectionReportUrl.searchParams.get('mediaId'),
        photoCount: inspectionReportUrl.searchParams.get('photoCount'),
      });
    } catch (error) {
      res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: error.statusCode ? error.message : 'The inspection photo could not be loaded.' }));
    }
    return;
  }
  if (inspectionReportUrl.pathname === '/api/inspection-reports/download') {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end();
      return;
    }
    await require('./lib/inspectionReportDelivery.cjs').handleDownloadRoute(req, res, {
      pool: prodDb.getPool(),
      token: inspectionReportUrl.searchParams.get('token'),
    });
    return;
  }

  if (pathname === '/api/live-call-events' && req.method === 'GET') {
    const companyId = url.searchParams.get('companyId');
    if (!companyId) { res.writeHead(400); res.end('Missing companyId'); return; }
    // Auth: verify caller has a valid session and belongs to the requested company
    try {
      const pool = prodDb.getPool();
      const session = await prodAuth.getSessionFromRequest(req, pool);
      const sessionUser = session?.data?.passport?.user || session?.data?.user;
      const userEmail = (sessionUser?.claims?.email || sessionUser?.email || '').toLowerCase();
      if (!userEmail) {
        setCorsHeaders(res, req);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated' }));
        return;
      }
      // Verify user is a member of the requested company (staff or owner)
      const memberCheck = await pool.query(
        `SELECT 1 FROM staff_profiles WHERE company_id = $1 AND LOWER(user_email) = $2 AND is_active = true LIMIT 1`,
        [companyId, userEmail]
      );
      const ownerCheck = memberCheck.rows.length === 0
        ? await pool.query(`SELECT 1 FROM companies WHERE id = $1 AND LOWER(created_by) = $2 LIMIT 1`, [companyId, userEmail])
        : { rows: [] };
      if (memberCheck.rows.length === 0 && ownerCheck.rows.length === 0) {
        setCorsHeaders(res, req);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authorized for this company' }));
        return;
      }
    } catch (authErr) {
      console.warn('[SSE] Auth check failed:', authErr.message);
      setCorsHeaders(res, req);
      res.writeHead(500);
      res.end('Auth error');
      return;
    }
    setCorsHeaders(res, req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    if (!liveCallSseClients.has(companyId)) liveCallSseClients.set(companyId, new Set());
    // Enforce global connection cap: evict the oldest stream in the largest company when full
    if (liveCallSseTotalCount() >= LIVE_CALL_SSE_MAX_GLOBAL) {
      let largestSet = null;
      let largestCompanyId = null;
      for (const [cid, set] of liveCallSseClients.entries()) {
        if (!largestSet || set.size > largestSet.size) { largestSet = set; largestCompanyId = cid; }
      }
      if (largestSet && largestSet.size > 0) {
        const oldest = largestSet.values().next().value;
        console.warn(`[SSE] Global cap of ${LIVE_CALL_SSE_MAX_GLOBAL} reached — evicting oldest stream from company ${largestCompanyId} (had ${largestSet.size} connections)`);
        try { oldest.write('event: error\ndata: {"reason":"connection_limit"}\n\n'); oldest.end(); } catch (_) {}
        largestSet.delete(oldest);
        if (largestSet.size === 0) liveCallSseClients.delete(largestCompanyId);
      }
    }
    // Re-fetch (or re-create) sseSet after any eviction that may have deleted this company's entry
    if (!liveCallSseClients.has(companyId)) liveCallSseClients.set(companyId, new Set());
    const sseSet = liveCallSseClients.get(companyId);
    // Enforce per-company connection cap: evict the oldest stream when full
    if (sseSet.size >= LIVE_CALL_SSE_MAX_PER_COMPANY) {
      const oldest = sseSet.values().next().value;
      console.warn(`[SSE] Company ${companyId} hit ${LIVE_CALL_SSE_MAX_PER_COMPANY}-connection cap — evicting oldest stream`);
      try { oldest.write('event: error\ndata: {"reason":"connection_limit"}\n\n'); oldest.end(); } catch (_) {}
      sseSet.delete(oldest);
    }
    sseSet.add(res);
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
    req.on('close', () => {
      clearInterval(keepAlive);
      const set = liveCallSseClients.get(companyId);
      if (set) { set.delete(res); if (set.size === 0) liveCallSseClients.delete(companyId); }
    });
    return;
  }

  // Recording proxy — fetches Twilio MP3 with server-side auth so browser can play it
  if (pathname === '/api/recording-proxy' && req.method === 'GET') {
    try {
      const recordingUrl = url.searchParams.get('url');
      if (!recordingUrl) { res.writeHead(400); res.end('Missing url'); return; }
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      const authHeader = accountSid && authToken
        ? 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
        : undefined;
      const resp = await fetch(recordingUrl, authHeader ? { headers: { Authorization: authHeader } } : {});
      if (!resp.ok) { res.writeHead(resp.status); res.end('Upstream error'); return; }
      const buf = await resp.arrayBuffer();
      res.writeHead(200, {
        'Content-Type': resp.headers.get('content-type') || 'audio/mpeg',
        'Content-Length': buf.byteLength,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(Buffer.from(buf));
    } catch (e) {
      res.writeHead(500); res.end('Proxy failed');
    }
    return;
  }

  if (pathname === '/api/image-proxy' && req.method === 'GET') {
    try {
      const imageUrl = url.searchParams.get('url');
      if (!imageUrl) { res.writeHead(400); res.end('Missing url'); return; }
      const resp = await fetch(imageUrl);
      if (!resp.ok) { res.writeHead(502); res.end('Upstream error'); return; }
      const buf = await resp.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      const mime = resp.headers.get('content-type') || 'image/jpeg';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ data: base64, mime }));
    } catch (e) {
      res.writeHead(500); res.end('Proxy failed');
    }
    return;
  }

  // Google Maps proxy — serves Static Maps / Street View images server-side
  if (pathname === '/api/maps-proxy' && req.method === 'GET') {
    try {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) { res.writeHead(400); res.end('GOOGLE_MAPS_API_KEY not configured'); return; }
      const type    = url.searchParams.get('type') || 'streetview';
      let googleUrl;
      if (type === 'staticmap') {
        const center  = url.searchParams.get('center') || '';
        const zoom    = url.searchParams.get('zoom') || '20';
        const size    = url.searchParams.get('size') || '640x420';
        const maptype = url.searchParams.get('maptype') || 'satellite';
        googleUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(center)}&zoom=${zoom}&size=${size}&maptype=${maptype}&key=${apiKey}`;
      } else {
        const lat     = url.searchParams.get('lat') || '';
        const lng     = url.searchParams.get('lng') || '';
        const heading = url.searchParams.get('heading') || '0';
        const size    = url.searchParams.get('size') || '400x300';
        const pitch   = url.searchParams.get('pitch') || '10';
        googleUrl = `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${lat},${lng}&heading=${heading}&pitch=${pitch}&key=${apiKey}`;
      }
      const resp = await fetch(googleUrl);
      if (!resp.ok) { res.writeHead(resp.status); res.end('Upstream error'); return; }
      const buf = await resp.arrayBuffer();
      res.writeHead(200, {
        'Content-Type': resp.headers.get('content-type') || 'image/jpeg',
        'Content-Length': buf.byteLength,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(Buffer.from(buf));
    } catch (e) {
      res.writeHead(500); res.end('Proxy failed');
    }
    return;
  }

  // HOVER OAuth callback (company-scoped; never exposes token material)
  if (pathname === '/api/hover-callback' && req.method === 'GET') {
    const appUrl = (process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com').replace(/\/+$/, '');
    const redirect = (key) => { res.writeHead(302, { Location: `${appUrl}/Integrations?${key}=true` }); res.end(); };
    try {
      if (url.searchParams.get('error')) { redirect('hover_error'); return; }
      const code = url.searchParams.get('code'), state = url.searchParams.get('state');
      if (!code || !state || !process.env.SESSION_SECRET) throw new Error('Invalid HOVER callback');
      const outer = JSON.parse(Buffer.from(state, 'base64url').toString());
      const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(outer.payload).digest('hex');
      const supplied = Buffer.from(String(outer.sig || ''), 'hex'), expectedBuf = Buffer.from(expected, 'hex');
      if (supplied.length !== expectedBuf.length || !crypto.timingSafeEqual(supplied, expectedBuf)) throw new Error('Invalid HOVER state');
      const inner = JSON.parse(outer.payload);
      if (!inner.user_email || !inner.company_id || !inner.nonce || !inner.issued_at || !inner.expires_at || Date.now() > inner.expires_at) throw new Error('Expired HOVER state');
      const pool = prodDb.getPool();
      const admin = await pool.query(
        `SELECT 1
         WHERE EXISTS (
           SELECT 1 FROM companies WHERE id=$1 AND LOWER(created_by)=LOWER($2)
         ) OR EXISTS (
           SELECT 1 FROM staff_profiles
           WHERE company_id=$1 AND (LOWER(user_email)=LOWER($2) OR LOWER(email)=LOWER($2))
             AND is_active=true
             AND (is_administrator=true OR LOWER(position) IN ('owner','admin','administrator'))
         )
         LIMIT 1`,
        [inner.company_id, inner.user_email]
      );
      if (!admin.rowCount) throw new Error('HOVER authorization no longer permitted');
      const tokenResp = await fetch('https://hover.to/oauth/token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${appUrl}/api/hover-callback`, client_id: process.env.HOVER_CLIENT_ID || '', client_secret: process.env.HOVER_CLIENT_SECRET || '' }) });
      const tokens = await tokenResp.json();
      if (!tokenResp.ok || !tokens.access_token || !tokens.refresh_token) throw new Error('HOVER authorization failed');
      const encrypt = (raw) => { const key = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex'); const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]); return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${body.toString('hex')}`; };
      const data = { access_token_enc: encrypt(tokens.access_token), refresh_token_enc: encrypt(tokens.refresh_token), token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(), connected_by: inner.user_email, connected_at: new Date().toISOString(), status: 'connected', is_connected: true };
      const found = await pool.query(`SELECT id FROM generic_entities WHERE entity_type='HoverOAuthConnection' AND company_id=$1 LIMIT 1`, [inner.company_id]);
      if (found.rows[0]) await pool.query(`UPDATE generic_entities SET data=$1, updated_date=NOW() WHERE id=$2`, [JSON.stringify(data), found.rows[0].id]);
      else await pool.query(`INSERT INTO generic_entities (id,company_id,entity_type,data,created_date,updated_date) VALUES ($1,$2,'HoverOAuthConnection',$3,NOW(),NOW())`, [`hover_oauth_${inner.company_id}`, inner.company_id, JSON.stringify(data)]);
      redirect('hover_connected');
    } catch (_) { redirect('hover_error'); }
    return;
  }

  if (pathname === '/api/ghl-oauth-callback' && req.method === 'GET') {
    const appUrl = (process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com').replace(/\/+$/, '');
    const redirect = (connected) => {
      res.writeHead(302, { Location: `${appUrl}/GoHighLevelSettings?ghl_${connected ? 'connected' : 'error'}=true` });
      res.end();
    };
    try {
      if (url.searchParams.get('error')) {
        redirect(false);
        return;
      }
      const handlers = await prodIntegrations.getFunctionHandlers();
      await handlers.completeGHLCallback({
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
        error: url.searchParams.get('error'),
      });
      redirect(true);
    } catch (err) {
      console.error('[GHL OAuth] Callback failed:', err.message);
      redirect(false);
    }
    return;
  }

  // QuickBooks OAuth callback
  if (pathname === '/api/quickbooks-callback' && req.method === 'GET') {
    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const realmId = url.searchParams.get('realmId');
      const oauthError = url.searchParams.get('error');
      const appUrl = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';

      if (oauthError) {
        console.error('[QuickBooks] OAuth error:', oauthError);
        res.writeHead(302, { Location: `${appUrl}/Settings?qb_error=${encodeURIComponent(oauthError)}` });
        res.end();
        return;
      }
      if (!code || !realmId) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing code or realmId</h1></body></html>');
        return;
      }

      let userEmail, companyId;
      try {
        const crypto = require('crypto');
        const stateSecret = process.env.SESSION_SECRET || process.env.QB_CLIENT_SECRET;
        const outer = JSON.parse(Buffer.from(state, 'base64url').toString());
        const expectedSig = crypto.createHmac('sha256', stateSecret).update(outer.payload).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(outer.sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
          throw new Error('State signature mismatch');
        }
        const inner = JSON.parse(outer.payload);
        userEmail = inner.user_email;
        companyId = inner.company_id;
      } catch (e) {
        console.error('[QuickBooks] Invalid or tampered state:', e.message);
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Invalid or tampered state parameter</h1></body></html>');
        return;
      }

      const QB_CLIENT_ID = process.env.QB_CLIENT_ID;
      const QB_CLIENT_SECRET = process.env.QB_CLIENT_SECRET;
      if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>QuickBooks OAuth not configured on server</h1></body></html>');
        return;
      }

      const REDIRECT_URI = `${appUrl}/api/quickbooks-callback`;
      const tokenResp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64')
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
      });
      const tokens = await tokenResp.json();

      if (tokens.error || !tokens.access_token) {
        console.error('[QuickBooks] Token exchange error:', JSON.stringify(tokens));
        const errMsg = tokens.error_description || tokens.error || 'Token exchange failed';
        res.writeHead(302, { Location: `${appUrl}/Settings?qb_error=${encodeURIComponent(errMsg)}` });
        res.end();
        return;
      }

      // Fetch QB company name and detect environment (production vs sandbox).
      // Dev-key connections land in Intuit's sandbox and 403 against the
      // production API base, so try production first then fall back.
      let qbCompanyName = '';
      let qbEnvironment = '';
      for (const env of ['production', 'sandbox']) {
        const ciBase = env === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com';
        try {
          const ciResp = await fetch(`${ciBase}/v3/company/${realmId}/companyinfo/${realmId}`, {
            headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'Accept': 'application/json' }
          });
          if (ciResp.ok) {
            const ci = await ciResp.json();
            qbCompanyName = ci.CompanyInfo?.CompanyName || '';
            qbEnvironment = env;
            break;
          }
        } catch (e) { /* non-fatal — try next base */ }
      }
      if (qbEnvironment === 'sandbox') {
        console.warn('[QuickBooks] Connected realm', realmId, 'is a SANDBOX company:', qbCompanyName);
      }

      const pool = prodDb.getPool();
      const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
      const settingsData = {
        company_id: companyId, realm_id: realmId,
        access_token: tokens.access_token, refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt, qb_company_name: qbCompanyName,
        qb_environment: qbEnvironment || undefined,
        connected_by: userEmail, connected_at: new Date().toISOString(),
        sync_invoices: true, sync_payments: true, sync_customers: true, is_connected: true
      };

      const existing = await pool.query(
        `SELECT id FROM generic_entities WHERE entity_type = 'QuickBooksSettings' AND company_id = $1 LIMIT 1`,
        [companyId]
      );
      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE entity_type = 'QuickBooksSettings' AND company_id = $2`,
          [JSON.stringify(settingsData), companyId]
        );
      } else {
        const newId = `qbs_${companyId}_${Date.now()}`;
        await pool.query(
          `INSERT INTO generic_entities (id, company_id, entity_type, data, created_date, updated_date) VALUES ($1, $2, 'QuickBooksSettings', $3, NOW(), NOW())`,
          [newId, companyId, JSON.stringify(settingsData)]
        );
      }

      console.log('[QuickBooks] Connected for company', companyId, 'realm', realmId, qbCompanyName ? `(${qbCompanyName})` : '');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QuickBooks Connected</title><meta http-equiv="refresh" content="2;url=${appUrl}/Settings?qb_connected=true"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#2ca01c 0%,#0077c5 100%)}.container{background:white;border-radius:16px;padding:40px;max-width:500px;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center}.icon{font-size:64px;margin-bottom:20px}h1{color:#10b981;margin:0 0 20px 0}p{color:#666;line-height:1.6}.btn{display:inline-block;background:#2ca01c;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600}</style></head><body><div class="container"><div class="icon">✅</div><h1>QuickBooks Connected!</h1><p>${qbCompanyName ? `<strong>${qbCompanyName}</strong><br>` : ''}Your QuickBooks account is now connected to CompanySync.</p><a href="${appUrl}/Settings?qb_connected=true" class="btn">Return to Settings</a><p style="color:#999;font-size:14px;margin-top:20px">Redirecting automatically...</p></div></body></html>`);
    } catch (err) {
      console.error('[QuickBooks] Callback error:', err);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>Error</h1><p>${err.message}</p></body></html>`);
    }
    return;
  }

  // Google Calendar OAuth callback
  if (pathname === '/api/google-calendar-callback' && req.method === 'GET') {
    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');
      const appUrl = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';

      if (oauthError) {
        const errorDesc = url.searchParams.get('error_description') || oauthError;
        console.error('[Calendar] Google OAuth error:', oauthError, '-', errorDesc);
        res.writeHead(302, { Location: `${appUrl}/Settings?google_error=${encodeURIComponent(errorDesc)}` });
        res.end();
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing authorization code</h1></body></html>');
        return;
      }
      let userEmail, redirectTo;
      try {
        // The reconnect handler signs the base64url payload as
        // "<payload>.<signature>". Production must validate that same format;
        // decoding the whole dotted value as base64 made every modern
        // reconnect callback fail with "Invalid state parameter".
        const [statePayload, stateSignature] = String(state || '').split('.');
        if (!statePayload || !stateSignature || !process.env.SESSION_SECRET) {
          throw new Error('Unsigned state');
        }
        const expectedSignature = require('crypto')
          .createHmac('sha256', process.env.SESSION_SECRET)
          .update(statePayload)
          .digest('base64url');
        if (
          stateSignature.length !== expectedSignature.length ||
          !require('crypto').timingSafeEqual(
            Buffer.from(stateSignature),
            Buffer.from(expectedSignature)
          )
        ) {
          throw new Error('Invalid state signature');
        }
        const stateData = JSON.parse(Buffer.from(statePayload, 'base64url').toString());
        if (!stateData.expires_at || stateData.expires_at < Date.now()) {
          throw new Error('Expired state');
        }
        userEmail = stateData.user_email;
        redirectTo = stateData.redirect_to === '/QuickSetup' ? '/QuickSetup' : '/calendar';
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Invalid state parameter</h1></body></html>');
        return;
      }
      if (!userEmail) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing user email in state</h1></body></html>');
        return;
      }
      const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
      const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Google OAuth not configured on server</h1></body></html>');
        return;
      }
      const REDIRECT_URI = `${appUrl}/api/google-calendar-callback`;
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' })
      });
      const tokens = await tokenResp.json();
      if (tokens.error || !tokens.access_token) {
        console.error('[Calendar] Google token exchange error:', JSON.stringify(tokens));
        const errMsg = tokens.error_description || tokens.error || 'Token exchange failed';
        res.writeHead(302, { Location: `${appUrl}/Settings?google_error=${encodeURIComponent(errMsg)}` });
        res.end();
        return;
      }
      const pool = prodDb.getPool();
      const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString();
      await pool.query(
        // google_disconnect_alerted_at is cleared alongside the reconnect flag so a
        // FUTURE disconnect is free to alert again (it is the alert's idempotency gate).
        `UPDATE users SET google_calendar_connected = true, google_access_token = $1, google_refresh_token = COALESCE($2, google_refresh_token), google_token_expires_at = $3, google_sync_enabled = true, google_calendar_reconnect_needed = false, google_disconnect_alerted_at = NULL, updated_at = NOW() WHERE email = $4`,
        [tokens.access_token, tokens.refresh_token || null, expiresAt, userEmail]
      );
      console.log('[Calendar] Google Calendar connected for', userEmail);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      // Fire initial sync in the background — do NOT await it or the OAuth callback hangs the browser
      prodIntegrations.getFunctionHandlers().then(handlers => {
        if (handlers?.syncUserGoogleCalendar) {
          return handlers.syncUserGoogleCalendar({ targetUserEmail: userEmail });
        }
      }).then(() => {
        console.log('[Calendar] Initial Google sync completed for', userEmail);
      }).catch(syncErr => {
        console.error('[Calendar] Initial Google sync failed (non-fatal):', syncErr.message);
      });
      res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Calendar Connected</title><meta http-equiv="refresh" content="2;url=${appUrl}${redirectTo}?google_connected=true"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}.container{background:white;border-radius:16px;padding:40px;max-width:500px;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center}.icon{font-size:64px;margin-bottom:20px}h1{color:#10b981;margin:0 0 20px 0}p{color:#666;line-height:1.6}.btn{display:inline-block;background:#667eea;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600}</style></head><body><div class="container"><div class="icon">✅</div><h1>Google Calendar Connected!</h1><p>Your Google Calendar is now synced with CompanySync.</p><a href="${appUrl}${redirectTo}?google_connected=true" class="btn">Return to Calendar</a><p style="color:#999;font-size:14px;margin-top:20px">Redirecting automatically in 2 seconds...</p></div></body></html>`);
    } catch (err) {
      console.error('[Calendar] Google callback error:', err);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>Error</h1><p>${err.message}</p></body></html>`);
    }
    return;
  }

  // Gmail debug — shows exactly what redirect_uri the server would send Google
  if (pathname === '/api/gmail-debug' && req.method === 'GET') {
    const appUrl = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';
    const redirectUri = `${appUrl}/api/gmail-callback`;
    const clientId = process.env.GOOGLE_CLIENT_ID || '(NOT SET)';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ redirect_uri: redirectUri, client_id_set: clientId !== '(NOT SET)', client_id_prefix: clientId.slice(0, 12) + '...', vite_replit_app_url: appUrl }, null, 2));
    return;
  }

  // Google Calendar credential health probe — confirms GOOGLE_CLIENT_ID and
  // GOOGLE_CLIENT_SECRET are set so the OAuth connect flow will work.
  // Call GET /api/gcal-debug from the browser or curl to verify credentials
  // are active after a republish.  Never returns the actual secret values.
  if (pathname === '/api/gcal-debug' && req.method === 'GET') {
    const appUrl = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';
    const clientId     = process.env.GOOGLE_CLIENT_ID     || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri  = `${appUrl}/api/google-calendar-callback`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      client_id_set:     clientId     !== '',
      client_secret_set: clientSecret !== '',
      client_id_prefix:  clientId  ? clientId.slice(0, 12)  + '...' : '(not set)',
      redirect_uri:      redirectUri,
      vite_replit_app_url: appUrl,
      // ACTION: verify Google Cloud Console → APIs & Services → OAuth consent screen
      // Publishing status MUST be "In production" (not "Testing").
      // Testing mode revokes every refresh token after 7 days — connections break weekly.
      // These calendar scopes require no Google verification to publish.
      consent_screen_action: 'Verify OAuth consent screen is published ("In production") in Google Cloud Console to prevent 7-day token expiry',
    }, null, 2));
    return;
  }

  // Gmail OAuth initiation — redirects the signed-in owner to Google's consent screen
  if (pathname === '/api/gmail-auth' && req.method === 'GET') {
    const appUrl = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';
    try {
      const handlers = await prodIntegrations.getFunctionHandlers();
      const result = await handlers.connectGmailForLexi({}, null, req);
      if (result?.authUrl) {
        res.writeHead(302, { Location: result.authUrl });
      } else {
        const msg = result?.error || 'Unable to start Gmail connection';
        res.writeHead(302, { Location: `${appUrl}/settings?gmail_error=${encodeURIComponent(msg)}` });
      }
      res.end();
    } catch (err) {
      console.error('[Gmail] /api/gmail-auth error:', err.message);
      res.writeHead(302, { Location: `${appUrl}/settings?gmail_error=${encodeURIComponent(err.message)}` });
      res.end();
    }
    return;
  }

  // Gmail OAuth callback
  if (pathname === '/api/gmail-callback' && req.method === 'GET') {
    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');
      const appUrl = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';
      if (oauthError) {
        const errorDesc = url.searchParams.get('error_description') || oauthError;
        console.error('[Gmail] OAuth error:', oauthError, '-', errorDesc);
        res.writeHead(302, { Location: `${appUrl}/settings?gmail_error=${encodeURIComponent(errorDesc)}` });
        res.end();
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing authorization code</h1></body></html>');
        return;
      }
      let userEmail, redirectTo;
      try {
        const gmailStateCrypto = require('crypto');
        const outerState = JSON.parse(Buffer.from(decodeURIComponent(state), 'base64url').toString());
        const stateSecret = process.env.GOOGLE_CLIENT_SECRET || 'gmail-oauth-state';
        const expectedSig = gmailStateCrypto.createHmac('sha256', stateSecret).update(outerState.payload).digest('hex');
        if (outerState.sig !== expectedSig) throw new Error('Bad signature');
        const stateData = JSON.parse(outerState.payload);
        if (Date.now() - stateData.ts > 10 * 60 * 1000) throw new Error('State expired');
        userEmail = stateData.user_email;
        redirectTo = stateData.redirect_to || '/settings';
      } catch (e) {
        console.error('[Gmail] Invalid OAuth state:', e.message);
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Invalid or expired state parameter</h1></body></html>');
        return;
      }
      if (!userEmail) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing user email in state</h1></body></html>');
        return;
      }
      const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
      const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Google OAuth not configured</h1></body></html>');
        return;
      }
      const REDIRECT_URI = `${appUrl}/api/gmail-callback`;
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' })
      });
      const tokens = await tokenResp.json();
      if (tokens.error || !tokens.access_token) {
        console.error('[Gmail] Token exchange error:', JSON.stringify(tokens));
        const errMsg = tokens.error_description || tokens.error || 'Token exchange failed';
        res.writeHead(302, { Location: `${appUrl}/settings?gmail_error=${encodeURIComponent(errMsg)}` });
        res.end();
        return;
      }
      // Get the user's Gmail address
      let gmailEmail = userEmail;
      try {
        const profileResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        const profile = await profileResp.json();
        if (profile.email) gmailEmail = profile.email;
      } catch (e) { console.warn('[Gmail] Could not fetch profile email:', e.message); }
      const pool = prodDb.getPool();
      const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString();
      await pool.query(
        'UPDATE users SET gmail_connected = true, gmail_access_token = $1, gmail_refresh_token = COALESCE($2, gmail_refresh_token), gmail_token_expires_at = $3, gmail_email = $4, updated_at = NOW() WHERE email = $5',
        [tokens.access_token, tokens.refresh_token || null, expiresAt, gmailEmail, userEmail]
      );
      console.log('[Gmail] Gmail connected for', userEmail, '(gmail:', gmailEmail, ')');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Gmail Connected</title><meta http-equiv="refresh" content="2;url=${appUrl}${redirectTo}?gmail_connected=true"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#ea4335 0%,#fbbc04 50%,#34a853 100%)}.container{background:white;border-radius:16px;padding:40px;max-width:500px;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center}h1{color:#10b981;margin:0 0 20px 0}.btn{display:inline-block;background:#ea4335;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600}</style></head><body><div class="container"><div style="font-size:64px;margin-bottom:20px">✉️</div><h1>Gmail Connected!</h1><p style="color:#666">Lexi can now read and reply to emails in <strong>${gmailEmail}</strong>.</p><a href="${appUrl}${redirectTo}?gmail_connected=true" class="btn">Return to Settings</a><p style="color:#999;font-size:14px;margin-top:20px">Redirecting in 2 seconds...</p></div></body></html>`);
    } catch (err) {
      console.error('[Gmail] Callback error:', err);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>Error</h1><p>${err.message}</p></body></html>`);
    }
    return;
  }

  // Microsoft / Outlook Calendar OAuth callback
  if (pathname === '/api/microsoft-calendar-callback' && req.method === 'GET') {
    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');
      const appUrl = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';

      if (oauthError) {
        const errorDesc = url.searchParams.get('error_description') || oauthError;
        console.error('[MSCalendar] Microsoft OAuth error:', oauthError, '-', errorDesc);
        res.writeHead(302, { Location: `${appUrl}/Settings?microsoft_error=${encodeURIComponent(errorDesc)}` });
        res.end();
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing authorization code</h1></body></html>');
        return;
      }
      let userEmail, redirectTo;
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
        userEmail = stateData.user_email;
        redirectTo = stateData.redirect_to || '/calendar';
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Invalid state parameter</h1></body></html>');
        return;
      }
      if (!userEmail) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Missing user email in state</h1></body></html>');
        return;
      }
      const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
      const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
      if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Microsoft OAuth not configured. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to environment secrets.</h1></body></html>');
        return;
      }
      const REDIRECT_URI = `${appUrl}/api/microsoft-calendar-callback`;
      const tokenResp = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: MICROSOFT_CLIENT_ID, client_secret: MICROSOFT_CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code', scope: 'Calendars.ReadWrite offline_access' })
      });
      const tokens = await tokenResp.json();
      if (tokens.error || !tokens.access_token) {
        console.error('[MSCalendar] Token exchange error:', JSON.stringify(tokens));
        const errMsg = tokens.error_description || tokens.error || 'Token exchange failed';
        res.writeHead(302, { Location: `${appUrl}/Settings?microsoft_error=${encodeURIComponent(errMsg)}` });
        res.end();
        return;
      }
      const pool = prodDb.getPool();
      const expiresAt = new Date(Date.now() + ((tokens.expires_in || 3600) * 1000)).toISOString();
      await pool.query(
        `UPDATE users SET microsoft_calendar_connected = true, microsoft_access_token = $1,
         microsoft_refresh_token = COALESCE($2, microsoft_refresh_token),
         microsoft_token_expires_at = $3, microsoft_sync_enabled = true,
         microsoft_disconnect_alerted_at = NULL, updated_at = NOW() WHERE email = $4`,
        [tokens.access_token, tokens.refresh_token || null, expiresAt, userEmail]
      );
      console.log('[MSCalendar] Microsoft Calendar connected for', userEmail);
      try {
        const handlers = await prodIntegrations.getFunctionHandlers();
        if (handlers?.syncMicrosoftCalendar) {
          await handlers.syncMicrosoftCalendar({ targetUserEmail: userEmail });
          console.log('[MSCalendar] Initial Microsoft sync completed for', userEmail);
        }
      } catch (syncErr) {
        console.error('[MSCalendar] Initial Microsoft sync failed (non-fatal):', syncErr.message);
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Outlook Calendar Connected</title><meta http-equiv="refresh" content="2;url=${appUrl}${redirectTo}?microsoft_connected=true"><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#0078d4 0%,#40a9ff 100%)}.container{background:white;border-radius:16px;padding:40px;max-width:500px;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center}.icon{font-size:64px;margin-bottom:20px}h1{color:#10b981;margin:0 0 20px 0}p{color:#666;line-height:1.6}.btn{display:inline-block;background:#0078d4;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600}</style></head><body><div class="container"><div class="icon">✅</div><h1>Outlook Calendar Connected!</h1><p>Your Microsoft/Outlook Calendar is now synced with CompanySync.</p><a href="${appUrl}${redirectTo}?microsoft_connected=true" class="btn">Return to Calendar</a><p style="color:#999;font-size:14px;margin-top:20px">Redirecting automatically in 2 seconds...</p></div></body></html>`);
    } catch (err) {
      console.error('[MSCalendar] Microsoft callback error:', err);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<html><body><h1>Error</h1><p>${err.message}</p></body></html>`);
    }
    return;
  }

  // Aerial View API proxy — uses company's own BYOK aerial_view_api_key; no platform key fallback
  if (pathname === '/api/aerial-view' && (req.method === 'GET' || req.method === 'POST')) {
    try {
      const avSession = req.session?.passport?.user || req.session?.user;
      const avEmail = avSession?.claims?.email || avSession?.email;
      if (!avEmail) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }
      const avPool = prodDb.getPool();
      const avStaff = await avPool.query(
        `SELECT company_id FROM staff_profiles WHERE (user_email = $1 OR email = $1) AND is_active = true ORDER BY is_administrator DESC LIMIT 1`,
        [avEmail]
      );
      const avCompanyId = avStaff.rows[0]?.company_id;
      if (!avCompanyId) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Company not found' }));
        return;
      }
      const avKeys = await avPool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'CompanyApiKeys' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
        [avCompanyId]
      );
      const avRawKey = avKeys.rows[0]?.data?.aerial_view_api_key;
      if (!avRawKey) {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Aerial View API key not configured. Add your own Google Aerial View API key in Settings → API Keys.' }));
        return;
      }
      const googleApiKey = prodDb.decryptApiKey(avRawKey);
      const action = url.searchParams.get('action') || 'lookup';
      const address = url.searchParams.get('address');
      if (!address) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'address query param required' }));
        return;
      }
      let upstreamRes;
      if (action === 'render') {
        upstreamRes = await fetch(
          `https://aerialview.googleapis.com/v1/videos:renderVideo?key=${googleApiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) }
        );
      } else {
        upstreamRes = await fetch(
          `https://aerialview.googleapis.com/v1/videos:lookupVideo?address=${encodeURIComponent(address)}&key=${googleApiKey}`
        );
      }
      const upstreamData = await upstreamRes.json();
      console.log(`[AerialView proxy] action=${action} status=${upstreamRes.status}`, JSON.stringify(upstreamData).slice(0, 200));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(upstreamData));
    } catch (e) {
      console.error('[AerialView proxy] error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/proxy-pdf' && req.method === 'GET') {
    const targetUrl = url.searchParams.get('url');
    console.log(`[proxy-pdf] request for: ${targetUrl}`);
    if (!targetUrl || !targetUrl.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or empty url parameter' }));
      return;
    }
    try {
      const parsedTarget = new URL(targetUrl);
      const uploadsMatch = parsedTarget.pathname.match(/^\/uploads\/(.+)$/);
      if (uploadsMatch) {
        const fileName = uploadsMatch[1];
        const ext = path.extname(fileName).toLowerCase();
        const mimeType = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
        const fileHeaders = { 'Content-Type': mimeType, 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=3600' };

        // 1. Object storage first (primary store post-migration)
        let served = false;
        try {
          const fileData = await prodIntegrations.serveFileBuffer(fileName);
          if (fileData) {
            res.writeHead(200, fileHeaders);
            res.end(fileData);
            served = true;
          }
        } catch (e) {
          console.warn(`[proxy-pdf] object storage error: ${e.message}`);
        }

        if (!served) {
          console.warn(`[proxy-pdf] not found in object storage, DB, or disk: ${fileName}`);
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
        }
      } else {
        // Non-uploads URL — extract filename and check local disk first
        const rawPathname = parsedTarget.pathname;
        const localFileName = path.basename(rawPathname);
        const ext = path.extname(localFileName).toLowerCase();
        const mimeType = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';

        // Check local disk candidates before attempting external proxy
        const localCandidates = [
          path.join(process.cwd(), 'public', localFileName),
          path.join(process.cwd(), 'public', rawPathname.replace(/^\//, '')),
          path.join(__dirname, localFileName),
          path.join(__dirname, rawPathname.replace(/^\//, '')),
          path.join(process.cwd(), localFileName),
          // Also check uploads subdirs in case the filename is there too
          path.join(process.cwd(), 'public', 'uploads', localFileName),
          path.join(__dirname, 'uploads', localFileName),
        ];

        let servedLocally = false;
        for (const diskPath of localCandidates) {
          if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
            console.log(`[proxy-pdf] found locally for non-uploads URL: ${diskPath}`);
            const fileData = fs.readFileSync(diskPath);
            res.writeHead(200, { 'Content-Type': mimeType, 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=3600' });
            res.end(fileData);
            servedLocally = true;
            // Also try to sync to DB for future requests
            try {
              const pool = prodDb.getPool();
              await pool.query(
                `INSERT INTO file_uploads (id, original_filename, mime_type, file_size, file_data)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO NOTHING`,
                [localFileName, localFileName, mimeType, fileData.length, fileData]
              );
            } catch (_e) {}
            break;
          }
        }

        if (!servedLocally) {
          // Fall back to external proxy
          const client = parsedTarget.protocol === 'https:' ? require('https') : require('http');
          const proxyReq = client.get(targetUrl, (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=3600' });
            proxyRes.pipe(res);
          });
          proxyReq.on('error', (e) => {
            if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); }
            res.end(JSON.stringify({ error: 'Upstream error: ' + e.message }));
          });
        }
      }
    } catch (e) {
      console.error(`[proxy-pdf] error:`, e.message);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); }
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Serve root path instantly from memory cache — must pass Replit health check fast
  if (pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (INDEX_HTML_CACHE) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? '' : INDEX_HTML_CACHE);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    }
    return;
  }

  if (pathname.startsWith('/api/impersonation/')) {
    return prodDb.handleImpersonationRoute(req, res, pathname, url);
  }

  if (pathname.startsWith('/api/local/')) {
    return prodDb.handleLocalDbRoute(req, res, pathname, url);
  }

  // Shared dev/prod implementation for labor rates, work orders, and the
  // token-scoped crew portal. This must precede the older public portal routes.
  if (await handleWorkOrderRoute(req, res, {
    getPool: prodDb.getPool,
    sendSMS: async (params) => {
      const handlers = await prodIntegrations.getFunctionHandlers();
      if (typeof handlers.sendSMS !== 'function') throw new Error('SMS delivery is unavailable.');
      return handlers.sendSMS(params);
    },
    sendEmail: async (params) => {
      const handlers = await prodIntegrations.getFunctionHandlers();
      if (typeof handlers.sendEmailWithBranding !== 'function') throw new Error('Email delivery is unavailable.');
      return handlers.sendEmailWithBranding(params);
    },
    getAppUrl: () => process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com',
  })) return;

  if (pathname === '/twiml/forward-fallback') {
    setCorsHeaders(res, req);
    const host = getPublicHost(req.headers);
    const companyId = url.searchParams.get('companyId') || '';
    const callerPhone = url.searchParams.get('callerPhone') || '';
    const repName = url.searchParams.get('repName') || '';
    const repEmail = url.searchParams.get('repEmail') || '';
    const maxDuration = url.searchParams.get('maxDuration') || '1800';

    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const dialStatus = params.get('DialCallStatus') || '';
    const dialDuration = parseInt(params.get('DialCallDuration') || '0', 10);

    console.log(`[Sarah] Forward fallback (/twiml): dialStatus=${dialStatus}, dialDuration=${dialDuration}s, company=${companyId}, rep=${repName}`);

    // Only treat as truly completed if rep talked for >15 seconds (real conversation).
    // Short "completed" (voicemail auto-answer) falls through to Sarah.
    if (dialStatus === 'completed' && dialDuration > 15) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      return;
    }

    // Rep did not answer — notify them and admins (non-blocking)
    if (companyId && (dialStatus === 'no-answer' || dialStatus === 'busy' || dialStatus === 'failed' || dialStatus === 'completed')) {
      (async () => {
        try {
          const pool = prodDb.getPool();
          const { rows: fbAdminRows } = await pool.query(
            `SELECT user_email FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
            [companyId]
          );
          const fbNotifyEmails = new Set();
          if (repEmail) fbNotifyEmails.add(repEmail);
          fbAdminRows.forEach(r => fbNotifyEmails.add(r.user_email));
          const statusNote = dialStatus === 'no-answer' ? 'did not answer' : dialStatus === 'busy' ? 'was busy' : dialStatus === 'completed' ? 'went to voicemail' : 'call failed';
          for (const email of fbNotifyEmails) {
            const nId = `notif_fwd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            await pool.query(
              `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
              [nId, companyId, JSON.stringify({
                id: nId,
                type: 'missed_forwarded_call',
                title: `📞 Forwarded call missed — ${callerPhone}`,
                message: `${repName || 'Rep'} ${statusNote}. Alex took over the call with ${callerPhone}.`,
                user_email: email,
                is_read: false,
                caller_phone: callerPhone,
                rep_name: repName,
                dial_status: dialStatus,
                created_at: new Date().toISOString(),
              })]
            );
          }
        } catch (e) { console.warn('[Sarah] Forward fallback notification error:', e.message); }
      })();
    }

    const wsUrl = `wss://${host}/ws/twilio`;
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${repName ? repName + ' is not available at the moment.' : 'The person you are trying to reach is not available right now.'} Let me connect you with our AI assistant who can help.</Say>
    <Connect>
        <Stream url="${wsUrl}">
            <Parameter name="companyId" value="${companyId}" />
            <Parameter name="callerPhone" value="${callerPhone}" />
            <Parameter name="maxCallDuration" value="${maxDuration}" />
            <Parameter name="isForwardedCall" value="true" />
            <Parameter name="forwardedRepName" value="${repName}" />
            <Parameter name="forwardedRepEmail" value="${repEmail}" />
            <Parameter name="callRoutingMode" value="sarah_answers" />
        </Stream>
    </Connect>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(fallbackTwiml);
    return;
  }

  if (pathname === '/twiml/transfer') {
    setCorsHeaders(res, req);
    const cellPhone = url.searchParams.get('cellPhone') || '';
    const callerIdNumber = url.searchParams.get('callerId') || '';
    const repName = url.searchParams.get('repName') || '';
    const callerPhone = url.searchParams.get('callerPhone') || '';

    if (!cellPhone) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">I'm sorry, I don't have a phone number to transfer to.</Say></Response>`);
      return;
    }

    const normalizePhone = p => (p || '').replace(/\D/g, '').slice(-10);
    const isSelfCall = callerPhone && normalizePhone(callerPhone) === normalizePhone(cellPhone);
    if (isSelfCall) {
      console.log(`[Sarah] TRANSFER SELF-CALL: ${callerPhone} is the rep's own cell — skipping transfer dial`);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">It looks like you're calling from the same phone I would transfer to, so I can't complete this transfer right now.</Say><Pause length="60"/></Response>`);
      return;
    }

    const companyId = url.searchParams.get('companyId') || '';
    const transferHost = (process.env.VITE_REPLIT_APP_URL ? new URL(process.env.VITE_REPLIT_APP_URL).host : null) || getPublicHost(req.headers);
    const transferFallbackUrl = `https://${transferHost}/twiml/transfer-fallback?callerPhone=${encodeURIComponent(callerPhone)}&amp;repName=${encodeURIComponent(repName)}&amp;companyId=${encodeURIComponent(companyId)}`;
    const transferTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Let me transfer you to ${repName || 'your representative'} now. One moment please.</Say>
    <Dial callerId="${callerIdNumber || ''}" timeout="30" action="${transferFallbackUrl}">
        <Number>${cellPhone}</Number>
    </Dial>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(transferTwiml);
    console.log(`[Sarah] TRANSFER: connecting ${callerPhone} to ${cellPhone} for rep ${repName}, fallback=${transferFallbackUrl}`);
    return;
  }

  if (pathname === '/twiml/transfer-fallback') {
    setCorsHeaders(res, req);
    const callerPhone = url.searchParams.get('callerPhone') || '';
    const repName = url.searchParams.get('repName') || '';
    const companyId = url.searchParams.get('companyId') || '';
    const body = await readBody(req);
    let dialStatus = '';
    let dialDuration = 0;
    try {
      const params = new URLSearchParams(body);
      dialStatus = params.get('DialCallStatus') || '';
      dialDuration = parseInt(params.get('DialCallDuration') || '0', 10);
    } catch (e) {}
    console.log(`[Sarah] Transfer fallback: dialStatus=${dialStatus}, dialDuration=${dialDuration}s, caller=${callerPhone}, rep=${repName}`);
    if (dialStatus === 'completed' && dialDuration > 15) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      return;
    }
    const wsHost = req.headers.host || process.env.VITE_REPLIT_APP_URL?.replace('https://','') || '';
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${repName || 'The representative'} wasn't able to pick up. Let me reconnect you with your assistant.</Say>
    <Connect>
        <Stream url="wss://${wsHost}/ws/twilio">
            <Parameter name="companyId" value="${companyId}" />
            <Parameter name="callerPhone" value="${callerPhone}" />
            <Parameter name="maxCallDuration" value="1800" />
            <Parameter name="isForwardedCall" value="false" />
            <Parameter name="isTransferReturn" value="true" />
            <Parameter name="transferRepName" value="${repName}" />
            <Parameter name="callRoutingMode" value="sarah_answers" />
        </Stream>
    </Connect>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(fallbackTwiml);
    console.log(`[Sarah] Transfer failed (${dialStatus}), reconnecting caller ${callerPhone} to Sarah with prior context`);
    return;
  }

  if (pathname === '/api/sarah-voice') {
    setCorsHeaders(res, req);
    if (req.method === 'GET') {
      const settings = loadSettings();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(settings));
    } else if (req.method === 'POST' || req.method === 'PUT') {
      const body = JSON.parse(await readBody(req));
      const current = loadSettings();
      const updated = { ...current, ...body };
      saveSettings(updated);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, settings: updated }));
    } else {
      res.writeHead(405); res.end();
    }
    return;
  }

  // ============================================================
  // CACHE UPDATE ENDPOINT - called by frontend when subscriber saves settings
  // Requires BRIDGE_SECRET or valid Referer from same origin
  // ============================================================
  if (pathname === '/api/twilio/update-cache') {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const { phone_number, company_id, company_name, rep_name, rep_email, cell_phone, routing_mode, twilio_sid, twilio_token, availability_status, data: staffData } = body;
        if (phone_number && company_id) {
          const pool = prodDb.getPool();
          const { authorizeTwilioTenant, assertTwilioIdentityAvailable } = require('./lib/twilioTenantGuard.cjs');
          await authorizeTwilioTenant({ req, pool, companyId: company_id, bridgeSecret: BRIDGE_SECRET });
          await assertTwilioIdentityAvailable({ pool, companyId: company_id, accountSid: twilio_sid, phoneNumber: phone_number });
          if (body.validate_only === true) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, validated: true }));
            return;
          }
          setCachedSubscriber(phone_number, {
            companyId: company_id,
            companyName: company_name || '',
            repName: rep_name || '',
            repEmail: rep_email || '',
            cellPhone: cell_phone || '',
            routingMode: routing_mode || 'sarah_answers',
            twilioSid: twilio_sid || '',
            twilioToken: twilio_token || '',
            twilioPhone: phone_number,
            availabilityStatus: availability_status || 'available',
            data: staffData || {},
          });
          // Persist routing fields to staff_profiles so the 5-min cache refresh stays in sync
          try {
            const normalized = normalizePhone(phone_number);
            const updates = [];
            const vals = [];
            if (routing_mode) { updates.push(`call_routing_mode = $${vals.length+1}`); vals.push(routing_mode); }
            if (availability_status) { updates.push(`availability_status = $${vals.length+1}`); vals.push(availability_status); }
            if (cell_phone) { updates.push(`cell_phone = $${vals.length+1}`); vals.push(cell_phone); }
            if (updates.length > 0) {
              vals.push(normalized); vals.push(phone_number);
              await pool.query(
                `UPDATE staff_profiles SET ${updates.join(', ')}, updated_at = NOW()
                 WHERE (twilio_number = $${vals.length-1} OR twilio_number = $${vals.length}) AND company_id = $${vals.length+1}`,
                [...vals, company_id]
              );
            }
          } catch (dbErr) { console.warn('[CacheUpdate] staff_profiles sync failed:', dbErr.message); }
          // Manual clock-in: when staff marks themselves available, fire their morning digest
          // non-blocking. The digest's own 4-hour idempotency guard prevents duplicate sends.
          if (availability_status === 'available' && rep_email) {
            callInternalFunction('sendMorningDigest', { staff_email: rep_email, company_id }).catch(() => {});
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, cached: normalizePhone(phone_number) }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'phone_number and company_id required' }));
        }
      } catch (err) {
        replyError(res, err);
      }
    } else {
      res.writeHead(405); res.end();
    }
    return;
  }

  // ============================================================
  // AUTO-PROVISIONING - configures Twilio webhooks automatically
  // Requires same-origin or BRIDGE_SECRET
  // ============================================================
  if (pathname === '/api/twilio/auto-provision') {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'POST') {
      try {
        const pool = prodDb.getPool();
        const body = JSON.parse(await readBody(req));
        const { account_sid, auth_token, phone_number, company_id, company_name, rep_name, rep_email, cell_phone, routing_mode } = body;
        if (!account_sid || !auth_token || !phone_number || !company_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'account_sid, auth_token, phone_number, and company_id required' }));
          return;
        }
        const { authorizeTwilioTenant, assertTwilioIdentityAvailable } = require('./lib/twilioTenantGuard.cjs');
        await authorizeTwilioTenant({ req, pool, companyId: company_id, bridgeSecret: BRIDGE_SECRET });
        await assertTwilioIdentityAvailable({ pool, companyId: company_id, accountSid: account_sid, phoneNumber: phone_number });
        const host = getPublicHost(req.headers);
        const voiceWebhookUrl = `https://${host}/api/twilio/voice`;
        const smsWebhookUrl = `https://${host}/api/whatsapp-webhook`;
        const statusCallbackUrl = `https://${host}/api/sarah-missed-call`;
        const normalizedPhone = normalizePhone(phone_number);

        const authStr = Buffer.from(`${account_sid}:${auth_token}`).toString('base64');

        // Step 1: Find the phone number SID in the subscriber's Twilio account
        const listResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(normalizedPhone)}`,
          { headers: { 'Authorization': `Basic ${authStr}` } }
        );
        const listData = await listResp.json();

        if (!listData.incoming_phone_numbers?.length) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Phone number ${normalizedPhone} not found in your Twilio account. Make sure you own this number.` }));
          return;
        }

        const phoneSid = listData.incoming_phone_numbers[0].sid;

        // Step 2: Set the webhooks on the phone number
        const updateBody = new URLSearchParams({
          VoiceUrl: voiceWebhookUrl,
          VoiceMethod: 'POST',
          SmsUrl: smsWebhookUrl,
          SmsMethod: 'POST',
          StatusCallback: statusCallbackUrl,
          StatusCallbackMethod: 'POST',
        });

        const updateResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers/${phoneSid}.json`,
          {
            method: 'POST',
            headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: updateBody.toString()
          }
        );
        const updateData = await updateResp.json();

        if (!updateResp.ok) {
          res.writeHead(updateResp.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: updateData.message || 'Failed to update Twilio webhooks', details: updateData }));
          return;
        }

        // Step 3: Create API Key for WebRTC token generation
        let apiKeySid = '', apiKeySecret = '';
        try {
          const keyResp = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/Keys.json`,
            { method: 'POST', headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ FriendlyName: 'CompanySync Browser Dialer' }).toString() }
          );
          const keyData = await keyResp.json();
          if (keyResp.ok && keyData.sid) {
            apiKeySid = keyData.sid;
            apiKeySecret = keyData.secret;
            console.log(`[AutoProvision] API Key created: ${apiKeySid}`);
          } else {
            console.warn('[AutoProvision] API Key creation failed:', JSON.stringify(keyData));
          }
        } catch (keyErr) {
          console.warn('[AutoProvision] API Key error:', keyErr.message);
        }

        // Step 4: Create TwiML App for browser-to-PSTN dialing
        const browserCallTwimlUrl = `https://${host}/api/twilio/browser-call-twiml`;
        let twimlAppSid = '';
        try {
          const appResp = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/Applications.json`,
            { method: 'POST', headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ FriendlyName: 'CompanySync Browser Dialer', VoiceUrl: browserCallTwimlUrl, VoiceMethod: 'POST' }).toString() }
          );
          const appData = await appResp.json();
          if (appResp.ok && appData.sid) {
            twimlAppSid = appData.sid;
            console.log(`[AutoProvision] TwiML App created: ${twimlAppSid}`);
          } else {
            console.warn('[AutoProvision] TwiML App creation failed:', JSON.stringify(appData));
          }
        } catch (appErr) {
          console.warn('[AutoProvision] TwiML App error:', appErr.message);
        }

        // Step 5: Cache this subscriber's routing
        setCachedSubscriber(normalizedPhone, {
          companyId: company_id || '',
          companyName: company_name || '',
          repName: rep_name || '',
          repEmail: rep_email || '',
          cellPhone: cell_phone || '',
          routingMode: routing_mode || 'sarah_answers',
          twilioSid: account_sid,
          twilioToken: auth_token,
          twilioPhone: normalizedPhone,
          availabilityStatus: 'available',
        });

        // Step 6: Save credentials + generated keys back to TwilioSettings so the
        // signature verifier always has the current auth_token, even after a
        // re-provision with a fresh Twilio account or rotated token.
        if (company_id) {
          try {
            const updateFields = {
              account_sid,
              auth_token,
              main_phone_number: normalizedPhone,
              ...(apiKeySid     && { api_key_sid:   apiKeySid }),
              ...(apiKeySecret  && { api_key_secret: apiKeySecret }),
              ...(twimlAppSid   && { twiml_app_sid:  twimlAppSid }),
            };
            // Build jsonb_set chain for each field
            let dataExpr = 'data';
            const qParams = [];
            for (const [key, val] of Object.entries(updateFields)) {
              qParams.push(JSON.stringify(val));
              dataExpr = `jsonb_set(${dataExpr}, '{${key}}', $${qParams.length}::jsonb)`;
            }
            qParams.push(company_id);
            await pool.query(
              `UPDATE generic_entities SET data = ${dataExpr}, updated_date = NOW()
               WHERE entity_type = 'TwilioSettings' AND company_id = $${qParams.length}`,
              qParams
            );
            console.log(`[AutoProvision] Saved credentials + keys to TwilioSettings for ${company_id}`);
          } catch (saveErr) {
            console.warn('[AutoProvision] Could not save credentials to TwilioSettings:', saveErr.message);
          }
        }

        // Step 7: Register number in local TwilioSettings available_numbers for reconciliation
        if (company_id) {
          try {
            const digits = normalizedPhone.replace(/^\+/, '');
            await pool.query(
              `UPDATE generic_entities SET data = jsonb_set(
                data,
                '{available_numbers}',
                (COALESCE(data->'available_numbers', '[]'::jsonb) || $1::jsonb || $2::jsonb)
              ) WHERE entity_type = 'TwilioSettings' AND company_id = $3
                AND NOT (data->'available_numbers' @> $1::jsonb)`,
              [JSON.stringify([normalizedPhone]), JSON.stringify([digits]), company_id]
            );
            console.log(`[AutoProvision] Registered ${normalizedPhone} in TwilioSettings available_numbers for ${company_id}`);
          } catch (regErr) {
            console.warn('[AutoProvision] Could not register number in available_numbers:', regErr.message);
          }
        }

        console.log(`[AutoProvision] Successfully provisioned ${normalizedPhone}: voice=${voiceWebhookUrl}, sms=${smsWebhookUrl}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          phone_sid: phoneSid,
          voice_webhook: voiceWebhookUrl,
          sms_webhook: smsWebhookUrl,
          status_callback: statusCallbackUrl,
          browser_call_twiml_url: browserCallTwimlUrl,
          api_key_sid: apiKeySid, api_key_secret: apiKeySecret, twiml_app_sid: twimlAppSid,
          webrtc_ready: !!(apiKeySid && twimlAppSid),
          message: 'Webhooks configured. Alex is ready to answer calls. Browser dialer is' + (apiKeySid && twimlAppSid ? ' active.' : ' not configured (API key creation failed).')
        }));
      } catch (err) {
        console.error('[AutoProvision] Error:', err.message);
        replyError(res, err);
      }
    } else {
      res.writeHead(405); res.end();
    }
    return;
  }

  // ==========================================
  // WEBRTC TOKEN ENDPOINT
  // ==========================================
  if (pathname === '/api/twilio/webrtc-token' && req.method === 'GET') {
    setCorsHeaders(res, req);
    try {
      const companyId = url.searchParams.get('companyId') || DEFAULT_COMPANY_ID;
      const identity = url.searchParams.get('identity') || 'agent';
      const pool = prodDb.getPool();
      const settings = await pool.query(
        "SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1",
        [companyId]
      ).then(r => r.rows[0]?.data || {}).catch(() => ({}));
      const accountSid = settings.account_sid || process.env.TWILIO_ACCOUNT_SID;
      const apiKeySid = settings.api_key_sid;
      const apiKeySecret = settings.api_key_secret;
      const twimlAppSid = settings.twiml_app_sid;
      if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'WebRTC not configured. Please re-run "Connect Alex to This Number" in Twilio Setup.' }));
        return;
      }
      const token = generateTwilioToken(accountSid, apiKeySid, apiKeySecret, identity, twimlAppSid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token, identity }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ==========================================
  // BROWSER CALL TWIML
  // ==========================================
  if (pathname === '/api/twilio/browser-call-twiml') {
    setCorsHeaders(res, req);
    try {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const to = params.get('To') || url.searchParams.get('To') || '';
      const companyId = params.get('CompanyId') || url.searchParams.get('companyId') || DEFAULT_COMPANY_ID;
      const contactName = params.get('ContactName') || url.searchParams.get('contactName') || '';
      const host = getPublicHost(req.headers);
      const transcriptionCallbackUrl = `https://${host}/api/twilio/transcription-done?companyId=${encodeURIComponent(companyId)}&contactName=${encodeURIComponent(contactName)}`;
      const pool = prodDb.getPool();
      const settings = await pool.query(
        "SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1",
        [companyId]
      ).then(r => r.rows[0]?.data || {}).catch(() => ({}));
      // Prefer rep's own Twilio number (passed as RepPhone), fall back to main company number
      const repPhoneRaw = params.get('RepPhone') || url.searchParams.get('RepPhone') || '';
      const repPhone = repPhoneRaw ? (repPhoneRaw.startsWith('+') ? repPhoneRaw : `+1${repPhoneRaw.replace(/\D/g, '')}`) : '';
      const callerId = repPhone || settings.main_phone_number || process.env.TWILIO_PHONE_NUMBER || '';
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This call may be monitored or recorded for quality assurance.</Say>
  <Dial callerId="${callerId}" record="record-from-ringing" timeout="30">
    <Number>${to}</Number>
  </Dial>
</Response>`;
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml);
      console.log(`[Dialer] Browser call TwiML: to=${to}, from=${callerId}, company=${companyId}${repPhone ? ' (rep line)' : ' (main line)'}`);
    } catch (err) {
      if (err?.statusCode === 413) { replyError(res, err); return; }
      const errTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>We're sorry, the call could not be connected. Please try again.</Say></Response>`;
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(errTwiml);
    }
    return;
  }

  // ==========================================
  // TRANSCRIPTION WEBHOOK
  // ==========================================
  if (pathname === '/api/twilio/transcription-done') {
    setCorsHeaders(res, req);
    try {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const transcriptionText = params.get('TranscriptionText') || '';
      const callSid = params.get('CallSid') || '';
      const companyId = url.searchParams.get('companyId') || DEFAULT_COMPANY_ID;
      const contactName = url.searchParams.get('contactName') || '';
      if (transcriptionText && companyId) {
        const pool = prodDb.getPool();
        const existing = await pool.query(
          "SELECT id FROM communications WHERE company_id=$1 AND data->>'call_sid'=$2 LIMIT 1",
          [companyId, callSid]
        ).catch(() => ({ rows: [] }));
        if (existing.rows[0]) {
          await pool.query(
            "UPDATE communications SET data = data || $1::jsonb, updated_at=NOW() WHERE id=$2",
            [JSON.stringify({ transcription: transcriptionText, transcription_status: 'completed' }), existing.rows[0].id]
          );
        } else {
          const newId = `comm_trans_${Date.now()}`;
          await pool.query(
            `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_name, status, data, created_at, updated_at)
             VALUES ($1,$2,'call','call','outbound',$3,'completed',$4,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
            [newId, companyId, contactName, JSON.stringify({ call_sid: callSid, transcription: transcriptionText, transcription_status: 'completed' })]
          );
        }
        console.log(`[Dialer] Transcription saved for call ${callSid} (${transcriptionText.length} chars)`);
      }
      res.writeHead(204);
      res.end();
    } catch (err) {
      if (err?.statusCode === 413) { replyError(res, err); return; }
      console.error('[Dialer] Transcription webhook error:', err.message);
      res.writeHead(200);
      res.end('ok');
    }
    return;
  }

  // Twilio recording-status callback for AI-answered + forwarded calls.
  // Mirrors the dev route in vite-twilio-ws-plugin.js (dev/prod endpoint
  // parity) — the shared logic lives in lib/callRecording.cjs.
  if (pathname === '/api/functions/recordingWebhook' && req.method === 'POST') {
    try {
      const { handleRecordingWebhook } = require('./lib/callRecording.cjs');
      const rawBody = await readBody(req);
      await handleRecordingWebhook(req, res, rawBody, prodDb.getPool(), {
        fullUrl: req.url,
      });
    } catch (e) {
      console.error('[CallRecording] Prod webhook route error:', e.message);
      if (!res.headersSent) { res.writeHead(200); res.end('ERROR'); }
    }
    return;
  }

  if (pathname === '/api/functions/incomingCall' || pathname === '/api/twilio/voice') {
    setCorsHeaders(res, req);
    const host = getPublicHost(req.headers);
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const from = params.get('From') || params.get('Caller') || '';
    const callSid = params.get('CallSid') || '';
    const calledNumber = params.get('To') || '';
    const pool = prodDb.getPool();

    try {
      const { verifyTwilioWebhook, shouldRejectTwilio } = require('./lib/twilioSignature.cjs');
      const twResult = await verifyTwilioWebhook(req, body, pool);
      if (shouldRejectTwilio(twResult, 'twiml/voice')) {
        res.writeHead(403, { 'Content-Type': 'text/xml' });
        res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
        return;
      }
    } catch (e) { console.warn('[Sarah] Twilio signature check error (voice):', e.message); }

    // Check for custom inbound phone in Sarah settings
    let sarahInboundPhone = '';
    try {
      const { rows } = await pool.query(
        "SELECT data, company_id FROM generic_entities WHERE entity_type = 'AssistantSettings' AND (data->>'sarah_inbound_phone' = $1) LIMIT 1",
        [calledNumber]
      );
      if (rows[0]) {
        sarahInboundPhone = rows[0].data.sarah_inbound_phone;
        resolvedCompanyId = rows[0].company_id;
        console.log(`[Sarah] Custom inbound phone match: ${calledNumber} -> company ${resolvedCompanyId}`);
      }
    } catch (e) {}

    // === FAST PATH: Check in-memory cache first (no DB calls) ===
    let cached = getCachedSubscriber(calledNumber);
    let resolvedCompanyId = url.searchParams.get('companyId') || cached?.companyId || null;
    let forwardedRepName = url.searchParams.get('repName') || cached?.repName || '';
    let forwardedRepEmail = url.searchParams.get('repEmail') || cached?.repEmail || '';
    let forwardedRepPhone = cached?.cellPhone || '';
    let isForwarded = !!(forwardedRepName || url.searchParams.get('forwarded') === 'true');
    let effectiveRoutingMode = cached?.routingMode || 'sarah_answers';
    let cellPhone = cached?.cellPhone || '';

    // If cached subscriber is unavailable, override to sarah_answers
    if (cached && cached.availabilityStatus === 'unavailable') {
      effectiveRoutingMode = 'sarah_answers';
    }

    // After-hours check for cached subscribers (use company's configured timezone)
    if (cached && effectiveRoutingMode !== 'sarah_answers' && cached.data?.after_hours_enabled) {
      let cachedCoTz = 'America/New_York';
      try {
        const tzRow = await pool.query(`SELECT data->>'timezone' AS tz FROM companies WHERE id = $1 LIMIT 1`, [cached.companyId]);
        if (tzRow.rows[0]?.tz) cachedCoTz = tzRow.rows[0].tz;
      } catch (_) {}
      if (isOutsideWorkHours(cached.data, new Date(), cachedCoTz)) {
        effectiveRoutingMode = 'sarah_answers';
        console.log(`[Sarah] After-hours override (cached) for ${forwardedRepName}: routing to sarah_answers (outside ${cached.data.after_hours_start}-${cached.data.after_hours_end}, tz=${cachedCoTz})`);
      }
    }

    // If no cache hit, try local PostgreSQL first, then Base44 API
    if (!cached && calledNumber) {
      console.log(`[Sarah] Cache miss for ${calledNumber}, trying local DB...`);
      try {
        const normalizedNum = calledNumber.replace(/[^\d+]/g, '');
        const e164 = normalizedNum.startsWith('+') ? normalizedNum : `+1${normalizedNum}`;
        const digits = normalizedNum.replace(/^\+/, '');
        const localLookup = await pool.query(
          `SELECT company_id FROM call_routing_cache WHERE phone_number = $1 OR phone_number = $2 OR phone_number = $3 LIMIT 1`,
          [calledNumber, e164, digits]
        );
        if (localLookup.rows[0]) {
          resolvedCompanyId = localLookup.rows[0].company_id;
          console.log(`[Sarah] Local routing cache hit: ${calledNumber} -> company ${resolvedCompanyId}`);
        }
        if (!resolvedCompanyId) {
          const twilioLookup = await pool.query(
            `SELECT company_id FROM generic_entities WHERE entity_type = 'TwilioSettings' AND (
              data->>'main_phone_number' = $1 OR data->>'main_phone_number' = $2 OR data->>'main_phone_number' = $3
              OR data->'available_numbers' ? $1 OR data->'available_numbers' ? $2 OR data->'available_numbers' ? $3
            ) ORDER BY (company_id IN ('companysync_master_001', '695944e3c1fb00b7ab716c6f')) ASC, updated_date DESC NULLS LAST LIMIT 1`,
            [calledNumber, e164, digits]
          );
          if (twilioLookup.rows[0]) {
            resolvedCompanyId = twilioLookup.rows[0].company_id;
            console.log(`[Sarah] Local TwilioSettings hit: ${calledNumber} -> company ${resolvedCompanyId}`);
          }
        }
      } catch (e) { console.warn(`[Sarah] Local DB lookup failed:`, e.message); }

      if (!resolvedCompanyId && BASE44_API_URL) {
        console.log(`[Sarah] Local DB miss, falling back to Base44 API for ${calledNumber}...`);
        try {
          const lookup = await callBase44API('lookupByPhone', null, { phone_number: calledNumber });
          if (lookup?.success && lookup.company_id) {
            resolvedCompanyId = lookup.company_id;
            console.log(`[Sarah] Base44 lookup: ${calledNumber} -> company ${resolvedCompanyId}`);
          }
        } catch (e) { console.warn(`[Sarah] Base44 company lookup failed:`, e.message); }
      }

      // Also restore staff routing from DB on cache miss
      if (resolvedCompanyId) {
        try {
          const staffLookup = await callBase44API('lookupStaffByTwilioNumber', resolvedCompanyId, { twilio_number: calledNumber });
          if (staffLookup?.success && staffLookup.staff) {
            const staff = staffLookup.staff;
            isForwarded = true;
            forwardedRepName = staff.full_name || '';
            forwardedRepEmail = staff.email || '';
            forwardedRepPhone = staff.cell_phone || staff.phone || '';
            cellPhone = staff.cell_phone || staff.phone || '';
            effectiveRoutingMode = staff.availability_status === 'unavailable' ? 'sarah_answers' : (staff.call_routing_mode || 'sarah_answers');

            // After-hours check (use company's configured timezone)
            const staffData = staff.data || {};
            if (effectiveRoutingMode !== 'sarah_answers' && staffData.after_hours_enabled) {
              let staffCoTz = 'America/New_York';
              try {
                const tzRow = await pool.query(`SELECT data->>'timezone' AS tz FROM companies WHERE id = $1 LIMIT 1`, [resolvedCompanyId]);
                if (tzRow.rows[0]?.tz) staffCoTz = tzRow.rows[0].tz;
              } catch (_) {}
              if (isOutsideWorkHours(staffData, new Date(), staffCoTz)) {
                effectiveRoutingMode = 'sarah_answers';
                console.log(`[Sarah] After-hours override for ${forwardedRepName}: routing to sarah_answers (outside ${staffData.after_hours_start}-${staffData.after_hours_end}, tz=${staffCoTz})`);
              }
            }

            console.log(`[Sarah] DB staff routing: rep=${forwardedRepName}, mode=${effectiveRoutingMode}, cell=${cellPhone}`);

            // Populate cache for next time
            try {
              const twilioSettings = await callBase44API('getTwilioSettings', resolvedCompanyId);
              setCachedSubscriber(calledNumber, {
                companyId: resolvedCompanyId,
                companyName: '',
                repName: forwardedRepName,
                repEmail: forwardedRepEmail,
                cellPhone: cellPhone,
                routingMode: staff.call_routing_mode || 'sarah_answers',
                twilioSid: twilioSettings?.account_sid || '',
                twilioToken: twilioSettings?.auth_token || '',
                twilioPhone: calledNumber,
                availabilityStatus: staff.availability_status || 'available',
                data: staffData,
              });
            } catch (e) { /* cache population is best effort */ }
          }
        } catch (e) { console.log(`[Sarah] DB staff lookup: not a staff number`); }
      }
    }
    if (!resolvedCompanyId) resolvedCompanyId = DEFAULT_COMPANY_ID;

    // Reconcile external/cached company ID with local DB — cache may contain Base44 IDs
    try {
      const { rows: localCoRows } = await pool.query(
        `SELECT id FROM companies WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1`,
        [resolvedCompanyId]
      );
      if (localCoRows.length === 0 && calledNumber) {
        // ID from cache not found locally — find the local company by phone number
        const normalizedNum = calledNumber.replace(/[^\d+]/g, '');
        const e164 = normalizedNum.startsWith('+') ? normalizedNum : `+1${normalizedNum}`;
        const digits = normalizedNum.replace(/^\+/, '');
        const { rows: twRows } = await pool.query(
          `SELECT company_id FROM generic_entities WHERE entity_type = 'TwilioSettings' AND (
            data->>'main_phone_number' = $1 OR data->>'main_phone_number' = $2 OR data->>'main_phone_number' = $3
            OR data->'available_numbers' ? $1 OR data->'available_numbers' ? $2 OR data->'available_numbers' ? $4
          ) ORDER BY (company_id IN ('companysync_master_001', '695944e3c1fb00b7ab716c6f')) ASC, updated_date DESC NULLS LAST LIMIT 1`,
          [calledNumber, e164, digits, digits]
        );
        if (twRows[0]) {
          console.log(`[Sarah] Reconciled company ID: ${resolvedCompanyId} -> ${twRows[0].company_id} via TwilioSettings for ${calledNumber}`);
          resolvedCompanyId = twRows[0].company_id;
        } else {
          console.warn(`[Sarah] No local company found for ${calledNumber}, using ID as-is: ${resolvedCompanyId}`);
        }
      }
    } catch (e) { console.warn('[Sarah] Company ID reconciliation failed:', e.message); }

    if (cached) {
      isForwarded = true;
      console.log(`[Sarah] CACHE HIT: ${calledNumber} -> company=${resolvedCompanyId}, rep=${forwardedRepName}, routing=${effectiveRoutingMode}, cell=${cellPhone}`);
    }

    let maxCallDuration = 1800;
    if (BASE44_API_URL) {
      try {
        const accessCheck = await callBase44API('checkVoiceAccess', resolvedCompanyId);
        if (accessCheck && accessCheck.allowed === false) {
          console.warn(`[Sarah] BLOCKED: Company ${resolvedCompanyId} denied: ${accessCheck.reason}`);
          const blockedTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">We're sorry, voice service is currently unavailable. ${accessCheck.reason || 'Please contact your administrator.'}</Say><Hangup/></Response>`;
          res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end(blockedTwiml); return;
        }
        if (accessCheck?.max_call_duration_seconds) maxCallDuration = accessCheck.max_call_duration_seconds;
      } catch (e) { console.warn(`[Sarah] Access check failed, allowing:`, e.message); }
    }

    // This specific test line uses the existing production AI-answer path,
    // regardless of a cached rep's cell-forwarding preference.
    if (isGemini38Line(calledNumber)) effectiveRoutingMode = 'sarah_answers';

    if (effectiveRoutingMode === 'forward_to_cell') {
      const dialTarget = cellPhone;
      if (dialTarget) {
        // Ensure E.164 format for dialing
        const rawCell = dialTarget.replace(/\D/g, '');
        const e164Cell = rawCell.startsWith('1') && rawCell.length === 11 ? `+${rawCell}` : rawCell.length === 10 ? `+1${rawCell}` : dialTarget;
        const recCallbackUrl = `https://${host}/api/functions/recordingWebhook?callerPhone=${encodeURIComponent(from)}&repName=${encodeURIComponent(forwardedRepName)}&companyId=${encodeURIComponent(resolvedCompanyId)}`;
        const forwardTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial callerId="${calledNumber}" timeout="20"
          record="record-from-ringing-dual"
          recordingStatusCallback="${recCallbackUrl}"
          recordingStatusCallbackMethod="POST"
          action="https://${host}/api/twilio/forward-fallback?companyId=${resolvedCompanyId}&callerPhone=${encodeURIComponent(from)}&repName=${encodeURIComponent(forwardedRepName)}&repEmail=${encodeURIComponent(forwardedRepEmail)}&maxDuration=${maxCallDuration}">
        <Number>${e164Cell}</Number>
    </Dial>
</Response>`;
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(forwardTwiml);
        console.log(`[Sarah] FORWARD TO CELL: caller=${from}, forwarding to ${dialTarget} for rep ${forwardedRepName} (recording enabled)`);
        return;
      }
      console.log(`[Sarah] FORWARD TO CELL: no cell phone configured for rep ${forwardedRepName} — routing to Sarah`);
    }

    const isCompanySyncDemo = calledNumber && calledNumber.replace(/\D/g, '').slice(-10) === '2167777154' && resolvedCompanyId === 'companysync_master_001';
    const scenarioParam = isCompanySyncDemo ? '?scenario=saas_demo' : '';
    console.log(`[Sarah] Inbound call from ${from}, SID: ${callSid}, company=${resolvedCompanyId}, forwarded=${isForwarded}${isForwarded ? ` rep=${forwardedRepName}` : ''}, routing=${effectiveRoutingMode}, maxDuration=${maxCallDuration}s${isCompanySyncDemo ? ', scenario=saas_demo' : ''}`);
    const wsUrl = `wss://${host}/ws/twilio${scenarioParam}`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">This call may be monitored or recorded for quality assurance.</Say>
    <Connect>
        <Stream url="${wsUrl}">
            <Parameter name="companyId" value="${resolvedCompanyId}" />
            <Parameter name="from" value="${from}" />
            <Parameter name="callSid" value="${callSid}" />
            <Parameter name="maxCallDuration" value="${maxCallDuration}" />
            <Parameter name="isForwardedCall" value="${isForwarded ? 'true' : 'false'}" />
            <Parameter name="forwardedRepName" value="${forwardedRepName}" />
            <Parameter name="forwardedRepEmail" value="${forwardedRepEmail}" />
            <Parameter name="forwardedRepPhone" value="${forwardedRepPhone}" />
            <Parameter name="callRoutingMode" value="${effectiveRoutingMode}" />
            <Parameter name="staffCellPhone" value="${cellPhone}" />
            <Parameter name="calledNumber" value="${calledNumber}" />
        </Stream>
    </Connect>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
    return;
  }

  if (pathname === '/api/twilio/forward-fallback') {
    setCorsHeaders(res, req);
    const host = getPublicHost(req.headers);
    const companyId = url.searchParams.get('companyId') || '';
    const callerPhone = url.searchParams.get('callerPhone') || '';
    const repName = url.searchParams.get('repName') || '';
    const repEmail = url.searchParams.get('repEmail') || '';
    const maxDuration = url.searchParams.get('maxDuration') || '1800';

    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const dialStatus = params.get('DialCallStatus') || '';
    const dialDuration = parseInt(params.get('DialCallDuration') || '0', 10);

    console.log(`[Sarah] Forward fallback: dialStatus=${dialStatus}, dialDuration=${dialDuration}s, company=${companyId}, rep=${repName}`);

    // Only treat as truly completed (real conversation) if rep talked for >15 seconds.
    // Short "completed" calls (<= 15s) are voicemail auto-answers — fall through to Sarah.
    if (dialStatus === 'completed' && dialDuration > 15) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      return;
    }

    // Rep did not answer — notify them and admins (non-blocking)
    if (companyId && (dialStatus === 'no-answer' || dialStatus === 'busy' || dialStatus === 'failed' || dialStatus === 'completed')) {
      (async () => {
        try {
          const pool = prodDb.getPool();
          const { rows: fbAdminRows2 } = await pool.query(
            `SELECT user_email FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
            [companyId]
          );
          const fbNotifyEmails2 = new Set();
          if (repEmail) fbNotifyEmails2.add(repEmail);
          fbAdminRows2.forEach(r => fbNotifyEmails2.add(r.user_email));
          const statusNote2 = dialStatus === 'no-answer' ? 'did not answer' : dialStatus === 'busy' ? 'was busy' : dialStatus === 'completed' ? 'went to voicemail' : 'call failed';
          for (const email of fbNotifyEmails2) {
            const nId = `notif_fwd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            await pool.query(
              `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
              [nId, companyId, JSON.stringify({
                id: nId,
                type: 'missed_forwarded_call',
                title: `📞 Forwarded call missed — ${callerPhone}`,
                message: `${repName || 'Rep'} ${statusNote2}. Alex took over the call with ${callerPhone}.`,
                user_email: email,
                is_read: false,
                caller_phone: callerPhone,
                rep_name: repName,
                dial_status: dialStatus,
                created_at: new Date().toISOString(),
              })]
            );
          }
        } catch (e) { console.warn('[Sarah] Forward fallback notification error:', e.message); }
      })();
    }

    const wsUrl = `wss://${host}/ws/twilio`;
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${repName ? repName + ' is not available at the moment.' : 'The person you are trying to reach is not available right now.'} Let me connect you with our AI assistant who can help.</Say>
    <Connect>
        <Stream url="${wsUrl}">
            <Parameter name="companyId" value="${companyId}" />
            <Parameter name="callerPhone" value="${callerPhone}" />
            <Parameter name="maxCallDuration" value="${maxDuration}" />
            <Parameter name="isForwardedCall" value="true" />
            <Parameter name="forwardedRepName" value="${repName}" />
            <Parameter name="forwardedRepEmail" value="${repEmail}" />
            <Parameter name="forwardedRepPhone" value="" />
            <Parameter name="callRoutingMode" value="sarah_answers" />
            <Parameter name="staffCellPhone" value="" />
        </Stream>
    </Connect>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(fallbackTwiml);
    return;
  }

  if (pathname === '/api/twilio/transfer') {
    setCorsHeaders(res, req);
    const cellPhone = url.searchParams.get('cellPhone') || '';
    const callerIdNumber = url.searchParams.get('callerId') || '';
    const repName = url.searchParams.get('repName') || '';
    const callerPhone = url.searchParams.get('callerPhone') || '';

    if (!cellPhone) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">I'm sorry, I don't have a phone number to transfer to.</Say></Response>`);
      return;
    }

    const normalizePhoneT = p => (p || '').replace(/\D/g, '').slice(-10);
    const isSelfCallT = callerPhone && normalizePhoneT(callerPhone) === normalizePhoneT(cellPhone);
    if (isSelfCallT) {
      console.log(`[Sarah] TRANSFER SELF-CALL: ${callerPhone} is the rep's own cell — skipping transfer dial`);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">It looks like you're calling from the same phone I would transfer to, so I can't complete this transfer right now.</Say><Pause length="60"/></Response>`);
      return;
    }

    const companyId2 = url.searchParams.get('companyId') || '';
    const transferHost2 = (process.env.VITE_REPLIT_APP_URL ? new URL(process.env.VITE_REPLIT_APP_URL).host : null) || getPublicHost(req.headers);
    const transferFallbackUrl2 = `https://${transferHost2}/twiml/transfer-fallback?callerPhone=${encodeURIComponent(callerPhone)}&amp;repName=${encodeURIComponent(repName)}&amp;companyId=${encodeURIComponent(companyId2)}`;
    const transferTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Let me transfer you to ${repName || 'your representative'} now. One moment please.</Say>
    <Dial callerId="${callerIdNumber || ''}" timeout="30" action="${transferFallbackUrl2}">
        <Number>${cellPhone}</Number>
    </Dial>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(transferTwiml);
    console.log(`[Sarah] TRANSFER: connecting ${callerPhone} to ${cellPhone} for rep ${repName}, fallback=${transferFallbackUrl2}`);
    return;
  }

  if (pathname === '/api/twilio/outbound-voice') {
    setCorsHeaders(res, req);
    const host = getPublicHost(req.headers);
    const body = await readBody(req);

    try {
      const { verifyTwilioWebhook, shouldRejectTwilio } = require('./lib/twilioSignature.cjs');
      const pool = prodDb.getPool();
      const twResult = await verifyTwilioWebhook(req, body, pool);
      // This callback is the only thing allowed to turn a created call into
      // an AI conversation. Do not leave it publicly invokable when the
      // general webhook rollout flag is in monitor mode.
      if (!twResult.valid || shouldRejectTwilio(twResult, 'twiml/outbound')) {
        res.writeHead(403, { 'Content-Type': 'text/xml' });
        res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
        return;
      }
    } catch (e) {
      console.warn('[Sarah] Twilio signature check error (outbound):', e.message);
      res.writeHead(403, { 'Content-Type': 'text/xml' });
      res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
      return;
    }

    const params = new URLSearchParams(body);
    const from = params.get('From') || params.get('Caller') || '';
    const callSid = params.get('CallSid') || '';
    const companyId = url.searchParams.get('companyId') || '';
    if (!companyId) {
      res.writeHead(400, { 'Content-Type': 'text/xml' });
      res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
      return;
    }
    const leadPhone = url.searchParams.get('leadPhone') || '';
    const leadName = url.searchParams.get('leadName') || '';
    const leadService = url.searchParams.get('leadService') || '';
    const leadAddress = url.searchParams.get('leadAddress') || '';
    const maxDuration = url.searchParams.get('maxDuration') || '600';
    const campaignRaw = url.searchParams.get('campaign') || '';
    const escapedCampaign = campaignRaw.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Voice-minutes cap: platform-Twilio companies are capped at 500 min/mo.
    // BYOK-Twilio companies skip the cap entirely (unlimited as sold).
    const voiceAccess = await localCheckVoiceAccess(companyId);
    if (!voiceAccess.allowed) {
      console.warn(`[Sarah] Outbound voice blocked for ${companyId}: ${voiceAccess.reason}`);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">We're sorry, this call cannot be completed. ${voiceAccess.reason || 'Voice service is unavailable.'}</Say><Hangup/></Response>`);
      return;
    }

    const wsUrl = `wss://${host}/ws/twilio`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${wsUrl}">
            <Parameter name="companyId" value="${companyId}" />
            <Parameter name="callerPhone" value="${leadPhone}" />
            <Parameter name="callSid" value="${callSid}" />
            <Parameter name="outbound" value="true" />
            <Parameter name="leadName" value="${leadName}" />
            <Parameter name="leadService" value="${leadService}" />
            <Parameter name="leadAddress" value="${leadAddress}" />
            <Parameter name="maxCallDuration" value="${maxDuration}" />
            <Parameter name="campaign" value="${escapedCampaign}" />
        </Stream>
    </Connect>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
    console.log(`[Sarah] Served outbound TwiML: lead=${leadName}, phone=${leadPhone}, company=${companyId}, campaign=${campaignRaw ? 'yes' : 'none'}`);
    return;
  }

  if (pathname === '/api/twilio/outbound-call') {
    setCorsHeaders(res, req);
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const { to, companyId: cId, leadName: ln, leadService: ls } = body;
        const companyId = String(cId || '').trim();
        const destination = normalizeOutboundDestination(to);
        const pool = prodDb.getPool();
        const authorization = await authorizeOutboundCall({ req, pool, companyId });
        if (!authorization.allowed) {
          res.writeHead(authorization.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: authorization.error }));
          return;
        }
        if (!destination) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'A valid E.164 destination phone number is required' }));
          return;
        }
        const rate = consumeOutboundCallRateLimit(companyId);
        if (!rate.allowed) {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(rate.retryAfter),
          });
          res.end(JSON.stringify({ error: 'Too many outbound calls', retryAfter: rate.retryAfter }));
          return;
        }
        const voiceAccess = await localCheckVoiceAccess(companyId);
        if (voiceAccess?.allowed === false) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: voiceAccess.reason || 'Voice service is unavailable' }));
          return;
        }
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
        if (!accountSid || !authToken || !twilioPhone) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Twilio not configured' }));
          return;
        }
        const host = getPublicHost(req.headers);
        const twimlUrl = `https://${host}/api/twilio/outbound-voice?companyId=${encodeURIComponent(companyId)}&leadName=${encodeURIComponent(ln || '')}&leadService=${encodeURIComponent(ls || '')}`;
        const params = new URLSearchParams({ To: destination, From: twilioPhone, Url: twimlUrl });
        const twilioResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64') },
          body: params.toString()
        });
        const data = await twilioResp.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, callSid: data.sid }));
      } catch (err) {
        replyError(res, err);
      }
    } else {
      res.writeHead(405); res.end();
    }
    return;
  }

  // ==========================================
  // MARKETING / TRIAL EMAIL UNSUBSCRIBE
  // ==========================================
  if (pathname === '/api/email/unsubscribe' && req.method === 'GET') {
    const { checkRateLimit, getClientIp } = require('./lib/rateLimit.cjs');
    const ip = getClientIp(req);
    const limit = checkRateLimit(`email-unsub:${ip}`, { max: 30, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) {
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Too many requests.');
      return;
    }
    await require('./lib/emailUnsubscribe.cjs').handleUnsubscribeRequest(req, res, prodDb.getPool());
    return;
  }

  // ==========================================
  // STRIPE WEBHOOK — invoice payment recording
  // ==========================================
  if (pathname === '/api/stripe/webhook' && req.method === 'POST') {
    const pool = prodDb.getPool();
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(body);
        const signature = req.headers['stripe-signature'];
        // Resolve the actual Stripe API key — STRIPE_SECRET_KEY may have been
        // incorrectly set to a whsec_* signing secret; fall back to STRIPE_API_KEY.
        const stripeSecretKey = resolveStripeApiKey();
        const webhookSecret = resolveStripeWebhookSecret();
        let event;

        // SECURITY: never fall back to trusting an unsigned/unverified payload.
        // Any missing prerequisite or verification failure must reject the
        // request outright — otherwise an attacker could POST a forged
        // "checkout.session.completed" event and get an invoice marked paid.
        if (!stripeSecretKey || !webhookSecret || !signature) {
          console.error('[Stripe Webhook] Rejecting: missing secret key, webhook secret, or signature header');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Webhook signature verification unavailable' }));
          return;
        }
        try {
          const Stripe = require('stripe');
          const stripe = new Stripe(stripeSecretKey);
          event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
        } catch (verifyErr) {
          // A stale endpoint secret must never make us trust the raw request.
          // As a fail-closed recovery path, retrieve the claimed event directly
          // from Stripe and use only that API response. A caller cannot invent
          // an event id, type, or payload this way; replaying a real event is
          // safe because each payment path is idempotent on its Stripe ref.
          try {
            const candidate = JSON.parse(rawBody.toString('utf8'));
            const eventId = typeof candidate?.id === 'string' ? candidate.id : '';
            const allowedEvents = new Set([
              'checkout.session.completed',
              'checkout.session.async_payment_succeeded',
              'customer.subscription.updated',
              'customer.subscription.deleted',
              'invoice.payment_failed',
              'invoice.payment_succeeded',
            ]);
            if (!/^evt_[A-Za-z0-9]+$/.test(eventId) || !allowedEvents.has(candidate?.type)) {
              throw new Error('unrecognized Stripe event reference');
            }
            const Stripe = require('stripe');
            const stripe = new Stripe(stripeSecretKey);
            const verifiedEvent = await stripe.events.retrieve(eventId);
            if (!verifiedEvent || verifiedEvent.id !== eventId || verifiedEvent.type !== candidate.type) {
              throw new Error('Stripe event did not match the delivery');
            }
            event = verifiedEvent;
            console.warn(`[Stripe Webhook] Signature mismatch for ${eventId}; verified the event directly with Stripe instead.`);
          } catch (recoveryErr) {
            console.error('[Stripe Webhook] Signature verification failed:', verifyErr.message);
            console.error('[Stripe Webhook] Direct Stripe event verification also failed:', recoveryErr.message);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid signature' }));
            return;
          }
        }

        async function writeCompanySubscriptionStatus(targetCompanyId, appStatus) {
          if (!targetCompanyId || !appStatus) return;
          await pool.query(
            `UPDATE companies
             SET subscription_status = $2,
                 data = (CASE WHEN jsonb_typeof(data) = 'object' THEN data ELSE '{}'::jsonb END)
                        || jsonb_build_object('subscription_status', $3::text),
                 updated_at = NOW()
             WHERE id = $1`,
            [targetCompanyId, appStatus, appStatus]
          );
        }

        if (event?.type === 'checkout.session.completed') {
          const session = event.data.object;
          const companyId = session.metadata?.company_id;
          const purchaseType = session.metadata?.purchase_type;

          if (session.mode === 'subscription') {
            try {
              let subCompanyId = companyId || null;
              const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
              if (!subCompanyId && customerId) {
                const byCust = await pool.query(
                  `SELECT id FROM companies WHERE stripe_customer_id = $1 AND NOT is_deleted LIMIT 1`,
                  [customerId]
                );
                subCompanyId = byCust.rows[0]?.id || null;
              }
              if (subCompanyId) {
                const subObj = session.subscription && typeof session.subscription === 'object' ? session.subscription : null;
                const appStatus = subObj?.status
                  ? mapAppSubscriptionStatus(subObj.status)
                  : (session.payment_status === 'paid' ? 'active' : 'trial');
                await writeCompanySubscriptionStatus(subCompanyId, appStatus);
                const subId = typeof session.subscription === 'string' ? session.subscription : subObj?.id || null;
                if (subId || customerId) {
                  await pool.query(
                    `UPDATE companies
                     SET stripe_subscription_id = COALESCE(stripe_subscription_id, $2),
                         stripe_customer_id = COALESCE(stripe_customer_id, $3),
                         updated_at = NOW()
                     WHERE id = $1`,
                    [subCompanyId, subId, customerId]
                  );
                }
                console.log(`[StripeWebhook] checkout subscription: company ${subCompanyId} → ${appStatus}`);
              }
            } catch (checkoutSubErr) {
              console.error('[StripeWebhook] checkout subscription status error:', checkoutSubErr.message);
            }
          }

          // Helper: notify admins in-app + email + SMS
          async function notifyAndEmailAdmins(companyId, title, message, type, extraEmailBody, dedupeKey = null) {
            try {
              const { randomUUID, createHash } = require('crypto');
              const quietHours = await getNotificationQuietHours(pool, companyId);
              // Use dedicated staff_profiles table — generic_entities/StaffProfile may be unpopulated
              const staffRes = await pool.query(
                `SELECT COALESCE(NULLIF(user_email, ''), email) AS user_email, full_name,
                        COALESCE(NULLIF(cell_phone, ''), NULLIF(phone, '')) AS notification_phone
                 FROM staff_profiles
                 WHERE company_id = $1 AND COALESCE(is_active, true) = true AND is_administrator = true
                   AND COALESCE(NULLIF(user_email, ''), email) IS NOT NULL`,
                [companyId]
              );
              for (const admin of staffRes.rows) {
                // In-app bell notification (id required — no DB default on generic_entities)
                const nId = dedupeKey
                  ? `stripe_${type}_${createHash('sha256').update(`${dedupeKey}:${admin.user_email}`).digest('hex').slice(0, 32)}`
                  : randomUUID();
                const inserted = await pool.query(
                  `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3::jsonb, NOW(), NOW()) ON CONFLICT DO NOTHING`,
                  [nId, companyId, JSON.stringify({
                    id: nId,
                    company_id: companyId,
                    user_email: admin.user_email,
                    title,
                    message,
                    type,
                    link_url: '/payments',
                    is_read: false,
                    ...(quietHours.active ? {
                      deferred_until: quietHours.deferredUntil,
                      deferred_reason: 'company_notification_quiet_hours',
                    } : {}),
                  })]
                );
                // Email
                if (inserted.rowCount > 0 && admin.user_email && extraEmailBody && !quietHours.active) {
                  try { await sendEmail({ to: admin.user_email, subject: title, message: extraEmailBody, companyId }); } catch (_) {}
                }
                // SMS to admin's cell phone
                if (inserted.rowCount > 0 && admin.notification_phone && !quietHours.active) {
                  try {
                    await sendPaymentAlertSms({
                      to: admin.notification_phone,
                      message: `${title}\n${message}`,
                      companyId,
                      context: 'StripeWebhook',
                    });
                  } catch (smsErr) { console.warn('[StripeWebhook] Admin SMS error:', smsErr.message); }
                }
              }
            } catch (err) {
              console.warn('[StripeWebhook] Notify error:', err.message);
            }
          }

          // Idempotently record a paid credit grant + apply the increment in the
          // same transaction. Returns true only when THIS delivery performed the
          // grant (false on a Stripe retry, which delivers at-least-once). The
          // UNIQUE credit_grants.session_id is what prevents double-granting.
          // Keep in lockstep with vite-stripe-plugin.js grantCreditsOnce.
          async function grantCreditsOnce(sessionId, cId, pType, granted, applyFn) {
            const { randomUUID } = require('crypto');
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              const ins = await client.query(
                `INSERT INTO credit_grants (id, session_id, company_id, purchase_type, granted)
                 VALUES ($1, $2, $3, $4, $5::jsonb)
                 ON CONFLICT (session_id) DO NOTHING
                 RETURNING id`,
                [randomUUID(), sessionId, cId || null, pType || null, JSON.stringify(granted || {})]
              );
              if (ins.rows.length === 0) { await client.query('COMMIT'); return false; }
              await applyFn(client);
              await client.query('COMMIT');
              return true;
            } catch (e) {
              await client.query('ROLLBACK').catch(() => {});
              throw e;
            } finally {
              client.release();
            }
          }

          if (session.metadata?.invoice_id) {
            // ── INVOICE PAYMENT ──────────────────────────────────────
            const invoiceId = session.metadata.invoice_id;
            const paymentAmount = (session.amount_total || 0) / 100;
            const isAchPending = session.payment_status === 'unpaid';
            console.log(`[StripeWebhook] Invoice payment $${paymentAmount} for invoice ${invoiceId}${isAchPending ? ' (ACH pending)' : ''}`);
            try {
              const invRes = await pool.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
              if (invRes.rows[0]) {
                const inv = invRes.rows[0];
                const { randomUUID } = require('crypto');

                if (isAchPending) {
                  // ACH bank transfer — record as pending; invoice stays at current status until cleared
                  const pendingRef = session.payment_intent || session.id;
                  const pendingClient = await pool.connect();
                  let pendingRecorded = false;
                  try {
                    await pendingClient.query('BEGIN');
                    await pendingClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [pendingRef]);
                    const paymentNumber = await allocatePaymentNumber(pendingClient, inv.company_id);
                    const pendingInsert = await pendingClient.query(
                      `INSERT INTO payments (id, company_id, invoice_id, invoice_number, payment_number, customer_name, amount, payment_method, payment_date, reference_number, notes, status, created_at, updated_at)
                       SELECT $1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,NOW(),NOW()
                       WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number=$9)`,
                      [randomUUID(), inv.company_id, invoiceId, inv.invoice_number, paymentNumber, inv.customer_name,
                       paymentAmount, 'ach', pendingRef,
                       'ACH bank transfer — pending (3-5 business days)', 'ach_pending']
                    );
                    pendingRecorded = pendingInsert.rowCount > 0;
                    await pendingClient.query('COMMIT');
                  } catch (pendingErr) {
                    await pendingClient.query('ROLLBACK').catch(() => {});
                    throw pendingErr;
                  } finally {
                    pendingClient.release();
                  }
                  const customerEmail = session.customer_email || inv.customer_email;
                  if (pendingRecorded && customerEmail) {
                    try {
                      let companyName = 'Your contractor';
                      const coRes = await pool.query(`SELECT name FROM companies WHERE id=$1 LIMIT 1`, [inv.company_id]);
                      if (coRes.rows[0]?.name) companyName = coRes.rows[0].name;
                      await sendEmail({
                        to: customerEmail,
                        subject: `🏦 Bank Transfer Initiated – Invoice ${inv.invoice_number || ''}`,
                        message: `Hi ${inv.customer_name || 'there'},\n\nWe've received your bank transfer request for $${paymentAmount.toFixed(2)} toward invoice ${inv.invoice_number || ''}. Bank transfers typically take 3–5 business days to process.\n\nYou'll receive a confirmation email once the payment fully clears.\n\nThank you for your business,\n${companyName}`,
                        companyId: inv.company_id
                      });
                    } catch (emailErr) {
                      console.warn('[StripeWebhook] ACH customer email error:', emailErr.message);
                    }
                  }
                  console.log(`[StripeWebhook] Invoice ${inv.invoice_number} — ACH ${pendingRecorded ? 'pending' : 'duplicate pending event'} $${paymentAmount}`);
                } else {
                  // Card or instant payment — record and close immediately.
                  // Idempotent on the Stripe reference so webhook retries can't double-count.
                  // A transaction-scoped advisory lock keyed on the Stripe reference
                  // serializes concurrent webhook deliveries for the SAME payment, so two
                  // retries can't both pass the NOT EXISTS check and double-insert. (We
                  // can't add a UNIQUE index on reference_number because the live table
                  // already contains legacy duplicate references.)
                  const cardRef = session.payment_intent || session.id;
                  const totalAmount = parseFloat(inv.total_amount || inv.amount || 0);
                  let newAmountPaid, newStatus, paymentRecorded = false;
                  const cardClient = await pool.connect();
                  try {
                    await cardClient.query('BEGIN');
                    await cardClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [cardRef]);
                    await cardClient.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [invoiceId]);
                    const paymentNumber = await allocatePaymentNumber(cardClient, inv.company_id);
                    const paymentInsert = await cardClient.query(
                      `INSERT INTO payments (id, company_id, invoice_id, invoice_number, payment_number, customer_name, amount, payment_method, payment_date, reference_number, notes, status, created_at, updated_at)
                       SELECT $1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,'completed',NOW(),NOW()
                       WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number=$9)`,
                      [randomUUID(), inv.company_id, invoiceId, inv.invoice_number, paymentNumber, inv.customer_name,
                       paymentAmount, 'stripe', cardRef, 'Paid via Stripe Checkout']
                    );
                    paymentRecorded = paymentInsert.rowCount > 0;
                    // Recompute amount_paid from the SUM of real payments (source of truth)
                    const cardSum = await cardClient.query(
                      `SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE invoice_id=$1 AND status NOT IN ('failed','refunded','ach_pending','void','cancelled')`,
                      [invoiceId]
                    );
                    newAmountPaid = parseFloat(cardSum.rows[0].total || 0);
                    newStatus = (totalAmount > 0 && newAmountPaid >= totalAmount) ? 'paid' : 'partially_paid';
                    await cardClient.query(
                      `UPDATE invoices SET amount_paid=$1, status=$2, updated_at=NOW() WHERE id=$3`,
                      [newAmountPaid, newStatus, invoiceId]
                    );
                    await cardClient.query('COMMIT');
                  } catch (txErr) {
                    await cardClient.query('ROLLBACK').catch(() => {});
                    throw txErr;
                  } finally {
                    cardClient.release();
                  }
                  const paymentExistsForInvoice = paymentRecorded || (await pool.query(
                    `SELECT 1 FROM payments WHERE reference_number=$1 AND invoice_id=$2 AND status='completed' LIMIT 1`,
                    [cardRef, invoiceId]
                  )).rowCount > 0;
                  console.log(`[StripeWebhook] Invoice ${inv.invoice_number} → $${newAmountPaid} paid, status: ${newStatus}`);
                  // CompanySync Bot chat alert — only on a real transition into 'paid'
                  if (paymentExistsForInvoice && inv.company_id && newStatus === 'paid' && String(inv.status || '').toLowerCase() !== 'paid') {
                    chatBot.notifyInvoicePaid(pool, inv.company_id, inv)
                      .catch(e => console.warn('[ChatBot] invoice-paid alert failed:', e.message));
                  }
                  setImmediate(async () => {
                    try {
                      const pmtRow = await pool.query(`SELECT * FROM payments WHERE reference_number=$1 AND company_id=$2 LIMIT 1`, [cardRef, inv.company_id]);
                      if (pmtRow.rows[0]) await qbSync.pushPaymentToQB(pool, inv.company_id, pmtRow.rows[0]);
                      const freshInv = await pool.query(`SELECT * FROM invoices WHERE id=$1 LIMIT 1`, [invoiceId]);
                      if (freshInv.rows[0]) await qbSync.pushInvoiceToQB(pool, inv.company_id, freshInv.rows[0]);
                    } catch (qbErr) { console.warn('[QB auto-sync] stripe payment:', qbErr.message); }
                  });
                  const remaining = Math.max(0, totalAmount - newAmountPaid);
                  const adminEmailBody = `A payment has been recorded.\n\nCustomer: ${inv.customer_name || 'Unknown'}\nInvoice: ${inv.invoice_number || ''}\nAmount Paid: $${paymentAmount.toFixed(2)}\nStatus: ${newStatus === 'paid' ? 'Fully Paid' : `Partially Paid (remaining: $${remaining.toFixed(2)})`}\n\nView payments: ${process.env.APP_URL || ''}/payments`;
                  if (paymentExistsForInvoice) {
                    await notifyAndEmailAdmins(inv.company_id, `💰 Invoice Payment Received – ${inv.invoice_number || ''}`,
                      `${inv.customer_name || 'Customer'} paid $${paymentAmount.toFixed(2)} for invoice ${inv.invoice_number || ''}`,
                      'payment_received', adminEmailBody, cardRef);
                  } else {
                    console.log(`[StripeWebhook] Duplicate invoice payment ${cardRef}; company notification skipped`);
                  }
                  const customerEmail = session.customer_email || inv.customer_email;
                  if (paymentRecorded && customerEmail) {
                    try {
                      let companyName = 'Your contractor';
                      const coRes = await pool.query(`SELECT name FROM companies WHERE id=$1 LIMIT 1`, [inv.company_id]);
                      if (coRes.rows[0]?.name) companyName = coRes.rows[0].name;
                      await sendEmail({
                        to: customerEmail,
                        subject: `✅ Payment Received – Invoice ${inv.invoice_number || ''}`,
                        message: `Hi ${inv.customer_name || 'there'},\n\nWe've received your payment of $${paymentAmount.toFixed(2)} for invoice ${inv.invoice_number || ''}. Thank you!\n\n${newStatus === 'paid' ? 'Your invoice is now fully paid.' : `Remaining balance: $${remaining.toFixed(2)}`}\n\nThank you for your business,\n${companyName}`,
                        companyId: inv.company_id
                      });
                    } catch (emailErr) {
                      console.warn('[StripeWebhook] Customer email error:', emailErr.message);
                    }
                  }
                }
              } else {
                console.warn(`[StripeWebhook] Invoice not found: ${invoiceId}`);
              }
            } catch (err) {
              console.error('[StripeWebhook] Invoice payment error:', err.message);
            }

          } else if (companyId && purchaseType === 'credits') {
            // ── LEGACY AIESTIMATOR CREDIT PURCHASE ────────────────────
            // Grant only on a genuinely paid session, and only once per session.
            if (session.payment_status && session.payment_status !== 'paid') {
              console.log(`[StripeWebhook] credits session ${session.id} not paid (${session.payment_status}); skipping`);
            } else {
              const creditType = session.metadata.credit_type || 'ai_estimator';
              const credits = Math.max(0, parseInt(session.metadata.credits || '0', 10) || 0);
              const fieldMap = { lexi: 'extra_lexi_credits', marcus: 'extra_marcus_credits' };
              const fieldName = fieldMap[creditType] || 'extra_ai_credits';
              if (credits > 0) {
                try {
                  const didGrant = await grantCreditsOnce(session.id, companyId, 'credits', { field: fieldName, credits }, async (client) => {
                    await client.query(`UPDATE companies SET ${fieldName} = COALESCE(${fieldName}, 0) + $2 WHERE id = $1`, [companyId, credits]);
                  });
                  if (didGrant) {
                    await notifyAndEmailAdmins(companyId, 'Credits Added', `Successfully added ${credits} credits.`, 'payment_received', null);
                  } else {
                    console.log(`[StripeWebhook] Duplicate webhook for credits session ${session.id}; grant skipped`);
                  }
                } catch (err) {
                  console.error('[StripeWebhook] Credits error:', err.message);
                }
              }
            }
          } else if (companyId && purchaseType === 'usage_credits') {
            // ── SUBSCRIPTION-USAGE CREDIT / BUNDLE PURCHASE ───────────
            // Grant amounts come from server-set, signature-verified metadata.
            if (session.payment_status && session.payment_status !== 'paid') {
              console.log(`[StripeWebhook] usage_credits session ${session.id} not paid (${session.payment_status}); skipping`);
            } else {
              const addAi = Math.max(0, parseInt(session.metadata.add_ai || '0', 10) || 0);
              const addSms = Math.max(0, parseInt(session.metadata.add_sms || '0', 10) || 0);
              const addCall = Math.max(0, parseInt(session.metadata.add_call || '0', 10) || 0);
              const label = session.metadata.package_label || 'Credits';
              if (addAi + addSms + addCall > 0) {
                try {
                  const didGrant = await grantCreditsOnce(session.id, companyId, 'usage_credits', { add_ai: addAi, add_sms: addSms, add_call: addCall, label }, async (client) => {
                    await client.query(
                      `UPDATE companies SET
                         ai_credits_purchased = COALESCE(ai_credits_purchased, 0) + $2,
                         sms_credits_purchased = COALESCE(sms_credits_purchased, 0) + $3,
                         call_credits_purchased = COALESCE(call_credits_purchased, 0) + $4
                       WHERE id = $1`,
                      [companyId, addAi, addSms, addCall]
                    );
                  });
                  if (didGrant) {
                    await notifyAndEmailAdmins(companyId, 'Credits Added', `${label}: added ${addAi.toLocaleString()} AI credits, ${addSms.toLocaleString()} SMS, and ${addCall} call minutes.`, 'payment_received', null);
                  } else {
                    console.log(`[StripeWebhook] Duplicate webhook for usage_credits session ${session.id}; grant skipped`);
                  }
                } catch (err) {
                  console.error('[StripeWebhook] Usage credits error:', err.message);
                }
              }
            }
          }
        } else if (event?.type === 'checkout.session.async_payment_succeeded') {
          // ── ACH BANK TRANSFER CLEARED ─────────────────────────────
          const session = event.data.object;
          const invoiceId = session.metadata?.invoice_id;
          if (invoiceId) {
            const paymentAmount = (session.amount_total || 0) / 100;
            const piRef = session.payment_intent || session.id;
            try {
              const clearedPayment = await pool.query(
                `UPDATE payments SET status='completed', notes='Paid via ACH bank transfer', updated_at=NOW() WHERE reference_number=$1 AND status='ach_pending'`,
                [piRef]
              );
              const achPaymentRecorded = clearedPayment.rowCount > 0 || (await pool.query(
                `SELECT 1 FROM payments WHERE reference_number=$1 AND invoice_id=$2 AND status='completed' LIMIT 1`,
                [piRef, invoiceId]
              )).rowCount > 0;
              const achJustCleared = clearedPayment.rowCount > 0;
              if (!achPaymentRecorded) {
                console.log(`[StripeWebhook] Duplicate or unknown ACH clearing event ${piRef}; company notification skipped`);
              }
              if (achPaymentRecorded) {
              const invRes = await pool.query(`SELECT * FROM invoices WHERE id=$1 LIMIT 1`, [invoiceId]);
              if (invRes.rows[0]) {
                const inv = invRes.rows[0];
                // The ACH payment row was just flipped to 'completed' above; recompute
                // amount_paid from the SUM of real payments instead of incrementing.
                const achSum = await pool.query(
                  `SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE invoice_id=$1 AND status NOT IN ('failed','refunded','ach_pending','void','cancelled')`,
                  [invoiceId]
                );
                const newAmountPaid = parseFloat(achSum.rows[0].total || 0);
                const totalAmount = parseFloat(inv.total_amount || inv.amount || 0);
                const newStatus = (totalAmount > 0 && newAmountPaid >= totalAmount) ? 'paid' : 'partially_paid';
                await pool.query(`UPDATE invoices SET amount_paid=$1, status=$2, updated_at=NOW() WHERE id=$3`, [newAmountPaid, newStatus, invoiceId]);
                // CompanySync Bot chat alert — only on a real transition into 'paid'
                if (inv.company_id && newStatus === 'paid' && String(inv.status || '').toLowerCase() !== 'paid') {
                  chatBot.notifyInvoicePaid(pool, inv.company_id, inv)
                    .catch(e => console.warn('[ChatBot] invoice-paid alert failed:', e.message));
                }
                const remaining = Math.max(0, totalAmount - newAmountPaid);
                const adminEmailBody = `ACH bank transfer cleared.\n\nCustomer: ${inv.customer_name || 'Unknown'}\nInvoice: ${inv.invoice_number || ''}\nAmount: $${paymentAmount.toFixed(2)}\nStatus: ${newStatus === 'paid' ? 'Fully Paid' : `Partially Paid (remaining: $${remaining.toFixed(2)})`}`;

                async function notifyAndEmailAdminsLocal(cId, title, msg, type, emailBody, dedupeKey = null) {
                  try {
                    const { randomUUID, createHash } = require('crypto');
                    const quietHours = await getNotificationQuietHours(pool, cId);
                    const staffRes = await pool.query(
                      `SELECT COALESCE(NULLIF(user_email, ''), email) AS user_email, full_name,
                              COALESCE(NULLIF(cell_phone, ''), NULLIF(phone, '')) AS notification_phone
                       FROM staff_profiles
                       WHERE company_id = $1 AND COALESCE(is_active, true) = true AND is_administrator = true
                         AND COALESCE(NULLIF(user_email, ''), email) IS NOT NULL`,
                      [cId]
                    );
                    for (const admin of staffRes.rows) {
                        const nId = dedupeKey
                          ? `stripe_${type}_${createHash('sha256').update(`${dedupeKey}:${admin.user_email}`).digest('hex').slice(0, 32)}`
                          : randomUUID();
                        const inserted = await pool.query(
                        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3::jsonb, NOW(), NOW()) ON CONFLICT DO NOTHING`,
                        [nId, cId, JSON.stringify({
                          id: nId,
                          company_id: cId,
                          user_email: admin.user_email,
                          title,
                          message: msg,
                          type,
                          link_url: '/payments',
                          is_read: false,
                          ...(quietHours.active ? {
                            deferred_until: quietHours.deferredUntil,
                            deferred_reason: 'company_notification_quiet_hours',
                          } : {}),
                        })]
                      );
                        if (inserted.rowCount > 0 && admin.user_email && emailBody && !quietHours.active) { try { await sendEmail({ to: admin.user_email, subject: title, message: emailBody, companyId: cId }); } catch (_) {} }
                        if (inserted.rowCount > 0 && admin.notification_phone && !quietHours.active) {
                        try {
                          await sendPaymentAlertSms({
                            to: admin.notification_phone,
                            message: `${title}\n${msg}`,
                            companyId: cId,
                            context: 'StripeWebhookACH',
                          });
                        } catch (smsErr) { console.warn('[StripeWebhook] Admin SMS error:', smsErr.message); }
                      }
                    }
                  } catch (_) {}
                }
                if (achPaymentRecorded) {
                  await notifyAndEmailAdminsLocal(inv.company_id, `✅ ACH Payment Cleared – ${inv.invoice_number || ''}`,
                    `${inv.customer_name || 'Customer'} — ACH $${paymentAmount.toFixed(2)} cleared for invoice ${inv.invoice_number || ''}`,
                    'payment_received', adminEmailBody, piRef);
                }

                const customerEmail = session.customer_email || inv.customer_email;
                if (achJustCleared && customerEmail) {
                  try {
                    let companyName = 'Your contractor';
                    const coRes = await pool.query(`SELECT name FROM companies WHERE id=$1 LIMIT 1`, [inv.company_id]);
                    if (coRes.rows[0]?.name) companyName = coRes.rows[0].name;
                    await sendEmail({
                      to: customerEmail,
                      subject: `✅ Bank Transfer Confirmed – Invoice ${inv.invoice_number || ''}`,
                      message: `Hi ${inv.customer_name || 'there'},\n\nGreat news! Your bank transfer of $${paymentAmount.toFixed(2)} for invoice ${inv.invoice_number || ''} has fully cleared.\n\n${newStatus === 'paid' ? 'Your invoice is now fully paid.' : `Remaining balance: $${remaining.toFixed(2)}`}\n\nThank you for your business,\n${companyName}`,
                      companyId: inv.company_id
                    });
                  } catch (_) {}
                }
                console.log(`[StripeWebhook] ACH cleared for invoice ${inv.invoice_number}`);
              }
              }
            } catch (err) {
              console.error('[StripeWebhook] ACH async payment error:', err.message);
            }
          }
        }

        // ── SUBSCRIPTION AMOUNT SYNC ───────────────────────────────────────
        // customer.subscription.{created,updated,deleted}: write the real
        // monthly amount and Stripe status onto the companies row so the
        // SaaS Admin MRR card reads actual billing data, not hardcoded prices.
        if (
          event?.type === 'customer.subscription.created' ||
          event?.type === 'customer.subscription.updated' ||
          event?.type === 'customer.subscription.deleted'
        ) {
          try {
            const sub = event.data.object;
            // Prefer company_id stamped in metadata when the subscription was
            // created; fall back to looking up via stripe_subscription_id or
            // stripe_customer_id so legacy rows without metadata still sync.
            let companyId = sub.metadata?.company_id || null;
            if (!companyId && sub.id) {
              const bySubId = await pool.query(
                `SELECT id FROM companies WHERE stripe_subscription_id = $1 AND NOT is_deleted LIMIT 1`,
                [sub.id]
              );
              companyId = bySubId.rows[0]?.id || null;
            }
            if (!companyId && sub.customer) {
              const byCust = await pool.query(
                `SELECT id FROM companies WHERE stripe_customer_id = $1 AND NOT is_deleted LIMIT 1`,
                [sub.customer]
              );
              companyId = byCust.rows[0]?.id || null;
            }
            if (companyId) {
              // Sum all line items (quantity × unit_amount) then convert cents → dollars.
              const items = Array.isArray(sub.items?.data) ? sub.items.data : [];
              const amountCents = items.reduce((sum, item) => {
                const unitAmount = item.price?.unit_amount ?? item.plan?.amount ?? 0;
                const qty = item.quantity ?? 1;
                return sum + unitAmount * qty;
              }, 0);
              const amountDollars = amountCents / 100;
              // 'deleted' events mean the sub is cancelled; map Stripe status directly.
              const stripeStatus = event.type === 'customer.subscription.deleted'
                ? 'canceled'
                : (sub.status || 'active');
              await pool.query(
                `UPDATE companies
                 SET stripe_subscription_amount = $1,
                     stripe_subscription_status = $2,
                     stripe_subscription_id     = $3,
                     updated_at                 = NOW()
                 WHERE id = $4`,
                [amountDollars, stripeStatus, sub.id, companyId]
              );
              const appStatus = mapAppSubscriptionStatus(stripeStatus, {
                deleted: event.type === 'customer.subscription.deleted',
              });
              await writeCompanySubscriptionStatus(companyId, appStatus);
              console.log(`[StripeWebhook] ${event.type}: company ${companyId} → $${amountDollars}/mo (${stripeStatus}, app ${appStatus})`);
            } else {
              console.warn(`[StripeWebhook] ${event.type}: no matching company for sub ${sub.id} / customer ${sub.customer}`);
            }
          } catch (subErr) {
            console.error(`[StripeWebhook] Subscription sync error:`, subErr.message);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      } catch (err) {
        console.error('[StripeWebhook] Error:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Webhook error' }));
      }
    });
    return;
  }

  // ==========================================
  // STRIPE BACKFILL SUBSCRIPTION AMOUNTS (admin-only, idempotent)
  // ==========================================
  if (pathname === '/api/stripe/backfill-subscription-amounts' && req.method === 'POST') {
    try {
      // ── Auth & impersonation guard ────────────────────────────────────────
      // /api/stripe/* is exempt from the centralized impersonation middleware,
      // so we resolve the tenant context explicitly here.
      // resolveRequestContext reads the connect.sid cookie from the DB —
      // req.session is always undefined in this raw http.createServer context.
      let reqCtx = req._impersonationCtx;
      if (!reqCtx) {
        try { reqCtx = await tenantGuard.resolveRequestContext(req, pool); } catch (_) {}
      }
      if (reqCtx && reqCtx.isImpersonating) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not available during impersonation sessions' }));
        return;
      }
      const userEmail = reqCtx?.email || null;
      if (!userEmail) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated' }));
        return;
      }
      const userCheck = await pool.query('SELECT platform_role FROM users WHERE LOWER(email) = $1', [userEmail.toLowerCase()]);
      const role = userCheck.rows[0]?.platform_role;
      if (role !== 'super_admin' && role !== 'admin') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authorized' }));
        return;
      }

      const stripe = await getStripeClientProd();
      if (!stripe) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Stripe client not available — check Stripe credentials' }));
        return;
      }

      // ── Step 1: Load company lookup maps from DB ──────────────────────────
      // companyBySubId  : stripe_subscription_id  → company id
      // companyByCustId : stripe_customer_id       → company id
      // validCompanyIds : Set of all active (not-deleted) company ids
      const companyRows = await pool.query(
        `SELECT id, stripe_subscription_id, stripe_customer_id FROM companies WHERE NOT is_deleted`
      );
      const companyBySubId  = new Map(); // stripe sub id  → company row id
      const companyByCustId = new Map(); // stripe cust id → company row id
      const validCompanyIds = new Set(); // all active company ids for metadata validation
      for (const row of companyRows.rows) {
        validCompanyIds.add(row.id);
        if (row.stripe_subscription_id) companyBySubId.set(row.stripe_subscription_id, row.id);
        if (row.stripe_customer_id)     companyByCustId.set(row.stripe_customer_id, row.id);
      }

      // ── Step 2: Fetch all Stripe subscriptions (paginated) ────────────────
      let startingAfter = undefined;
      const allSubs = [];
      do {
        const params = { limit: 100, status: 'all' };
        if (startingAfter) params.starting_after = startingAfter;
        const page = await stripe.subscriptions.list(params);
        allSubs.push(...page.data);
        startingAfter = page.has_more ? page.data[page.data.length - 1].id : undefined;
      } while (startingAfter);

      console.log(`[StripeBackfill] Fetched ${allSubs.length} Stripe subscriptions`);

      // ── Step 3: Build a winner map (one canonical sub per company) ─────────
      // Match priority (lower = stronger):
      //   1 = direct stripe_subscription_id match on the company row
      //   2 = metadata.company_id match (only accepted if id is in validCompanyIds)
      //   3 = stripe_customer_id match
      // Status rank within the same priority (lower = better):
      //   1 = active  2 = trialing  3 = past_due  4 = everything else
      // Tiebreaker: higher current_period_end wins (most recent billing period).

      const STATUS_RANK = { active: 1, trialing: 2, past_due: 3 };
      function statusRank(s) { return STATUS_RANK[s] || 4; }

      // winner[companyId] = { sub, matchPriority, sRank, periodEnd, amountDollars, stripeStatus }
      const winner = new Map();

      function trySetWinner(companyId, sub, matchPriority) {
        const items = Array.isArray(sub.items?.data) ? sub.items.data : [];
        const amountCents = items.reduce((sum, item) => {
          const ua = item.price?.unit_amount ?? item.plan?.amount ?? 0;
          const qty = item.quantity ?? 1;
          return sum + ua * qty;
        }, 0);
        const amountDollars = amountCents / 100;
        const stripeStatus  = sub.status || 'active';
        const sRank         = statusRank(stripeStatus);
        const periodEnd     = Number(sub.current_period_end || 0);

        const cur = winner.get(companyId);
        if (!cur) {
          winner.set(companyId, { sub, matchPriority, sRank, periodEnd, amountDollars, stripeStatus });
          return;
        }
        // Keep existing winner unless the new candidate is strictly better
        if (matchPriority < cur.matchPriority) {
          winner.set(companyId, { sub, matchPriority, sRank, periodEnd, amountDollars, stripeStatus });
        } else if (matchPriority === cur.matchPriority) {
          if (sRank < cur.sRank || (sRank === cur.sRank && periodEnd > cur.periodEnd)) {
            winner.set(companyId, { sub, matchPriority, sRank, periodEnd, amountDollars, stripeStatus });
          }
        }
        // else: existing winner is better — no change
      }

      let skipped = 0;
      for (const sub of allSubs) {
        // Priority 1: company row already has this stripe_subscription_id
        const bySubId = companyBySubId.get(sub.id);
        if (bySubId) { trySetWinner(bySubId, sub, 1); continue; }

        // Priority 2: metadata carries our company id — must be a known active company
        const metaCompanyId = sub.metadata?.company_id;
        if (metaCompanyId && validCompanyIds.has(metaCompanyId)) {
          trySetWinner(metaCompanyId, sub, 2);
          continue;
        }

        // Priority 3: match via stripe_customer_id
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        const byCustId   = customerId ? companyByCustId.get(customerId) : null;
        if (byCustId) { trySetWinner(byCustId, sub, 3); continue; }

        skipped++;
      }

      // ── Step 4: Write one row per company ─────────────────────────────────
      let updated = 0;
      let errors  = 0;
      const details = [];

      for (const [companyId, w] of winner) {
        try {
          const result = await pool.query(
            `UPDATE companies
             SET stripe_subscription_amount = $1,
                 stripe_subscription_status = $2,
                 stripe_subscription_id     = $3,
                 updated_at                 = NOW()
             WHERE id = $4 AND NOT is_deleted`,
            [w.amountDollars, w.stripeStatus, w.sub.id, companyId]
          );
          if (result.rowCount === 1) {
            updated++;
            details.push({ company_id: companyId, sub_id: w.sub.id, amount: w.amountDollars, status: w.stripeStatus, match_priority: w.matchPriority });
            console.log(`[StripeBackfill] company=${companyId} sub=${w.sub.id} $${w.amountDollars} ${w.stripeStatus} (priority=${w.matchPriority})`);
          } else {
            // rowCount === 0: company was deleted between map load and write — skip safely
            skipped++;
          }
        } catch (writeErr) {
          console.error(`[StripeBackfill] Write error for company ${companyId}:`, writeErr.message);
          errors++;
        }
      }

      console.log(`[StripeBackfill] Done — total=${allSubs.length} updated=${updated} skipped=${skipped} errors=${errors}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, total: allSubs.length, updated, skipped, errors, details }));
    } catch (err) {
      console.error('[StripeBackfill] Fatal error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ==========================================
  // STRIPE OVERVIEW ENDPOINT
  // ==========================================
  if (pathname === '/api/stripe/overview' && req.method === 'GET') {
    try {
      const schemaCheck = await pool.query(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='stripe' AND table_name='subscriptions'"
      );
      if (schemaCheck.rows[0].count === '0') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ subscriptions: [], invoices: [], customers: [], summary: { totalRevenue: 0, activeSubscriptions: 0, totalCustomers: 0, paidInvoices: 0 } }));
        return;
      }
      const [subsRes, invRes, custRes, piRes] = await Promise.all([
        pool.query(`SELECT id, status, customer, items, metadata, current_period_start, current_period_end, cancel_at_period_end, created, trial_end FROM stripe.subscriptions ORDER BY created DESC NULLS LAST LIMIT 100`),
        pool.query(`SELECT id, total, amount_paid, status, customer, customer_email, customer_name, number, created, hosted_invoice_url, invoice_pdf, currency, subscription FROM stripe.invoices ORDER BY created DESC NULLS LAST LIMIT 50`),
        pool.query(`SELECT id, email, name, created, balance, currency FROM stripe.customers ORDER BY created DESC NULLS LAST LIMIT 100`),
        pool.query(`SELECT SUM(amount_received) as total_received, COUNT(*) as count FROM stripe.payment_intents WHERE status='succeeded'`),
      ]);
      const totalRevenue = Number(piRes.rows[0]?.total_received || 0) / 100;
      const activeSubscriptions = subsRes.rows.filter(s => s.status === 'active' || s.status === 'trialing').length;
      const paidInvoicesTotal = invRes.rows.filter(i => i.status === 'paid').reduce((sum, i) => sum + Number(i.amount_paid || 0), 0) / 100;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        subscriptions: subsRes.rows,
        invoices: invRes.rows,
        customers: custRes.rows,
        summary: { totalRevenue, paidInvoicesTotal, activeSubscriptions, totalCustomers: custRes.rows.length, paidInvoices: invRes.rows.filter(i => i.status === 'paid').length },
      }));
    } catch (err) {
      console.error('[Stripe Overview]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, subscriptions: [], invoices: [], customers: [], summary: { totalRevenue: 0, activeSubscriptions: 0, totalCustomers: 0, paidInvoices: 0 } }));
    }
    return;
  }

  // ==========================================
  // ADMIN HEALTH ENDPOINT
  // ==========================================
  if (pathname === '/admin/health' && req.method === 'GET') {
    try {
      const sessionUser = req.session?.passport?.user || req.session?.user;
      const userEmail = sessionUser?.claims?.email || sessionUser?.email;
      if (!userEmail) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated' }));
        return;
      }
      const userCheck = await pool.query('SELECT platform_role FROM users WHERE email = $1', [userEmail]);
      const role = userCheck.rows[0]?.platform_role;
      if (role !== 'super_admin' && role !== 'admin') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authorized' }));
        return;
      }
      const dbCheck = await pool.query('SELECT COUNT(*) as count FROM users').catch(() => ({ rows: [{ count: -1 }] }));
      const companyCount = await pool.query('SELECT COUNT(*) as count FROM generic_entities WHERE entity_type = $1', ['Company']).catch(() => ({ rows: [{ count: -1 }] }));
      const leadCount = await pool.query('SELECT COUNT(*) as count FROM generic_entities WHERE entity_type = $1', ['Lead']).catch(() => ({ rows: [{ count: -1 }] }));
      const sessionCount = await pool.query('SELECT COUNT(*) as count FROM sessions').catch(() => ({ rows: [{ count: -1 }] }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: { connected: true, users: parseInt(dbCheck.rows[0].count), companies: parseInt(companyCount.rows[0].count), leads: parseInt(leadCount.rows[0].count), active_sessions: parseInt(sessionCount.rows[0].count) },
        memory: { rss: Math.round(process.memoryUsage().rss / 1024 / 1024), heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) },
        environment: process.env.NODE_ENV || 'production',
        services: {
          twilio: !!process.env.TWILIO_ACCOUNT_SID,
          gemini: !!process.env.GOOGLE_GEMINI_API_KEY,
          resend: !!process.env.RESEND_API_KEY,
          google_maps: !!process.env.GOOGLE_MAPS_API_KEY,
        }
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', error: err.message }));
    }
    return;
  }

  // ==========================================
  // AUTH ENDPOINTS
  // ==========================================
  if (req.method === 'OPTIONS' && (pathname === '/api/signup' || pathname === '/api/login-local' || pathname === '/api/change-password' || pathname === '/api/forgot-password' || pathname === '/api/reset-password' || pathname === '/api/auth/google' || pathname === '/api/auth/google/callback')) {
    setCorsHeaders(res, req);
    res.writeHead(200);
    res.end();
    return;
  }

  if (pathname === '/api/auth/google') {
    setCorsHeaders(res, req);
    const host = req.headers.host;
    const callbackUrl = `https://${host}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'profile email',
      access_type: 'offline',
      prompt: 'consent'
    });
    res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
    res.end();
    return;
  }

  if (pathname === '/api/auth/google/callback') {
    setCorsHeaders(res, req);
    try {
      const code = url.searchParams.get('code');
      const host = req.headers.host;
      const callbackUrl = `https://${host}/api/auth/google/callback`;

      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code'
        })
      });

      const tokens = await tokenResp.json();
      if (!tokens.access_token) throw new Error('Failed to get access token');

      const userinfoResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` }
      });
      const profile = await userinfoResp.json();

      const claims = {
        sub: profile.sub,
        email: profile.email,
        first_name: profile.given_name,
        last_name: profile.family_name,
        profile_image_url: profile.picture
      };

      const normalizedEmail = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
      if (!normalizedEmail) throw new Error('Google account did not provide an email address');

      const pool = prodDb.getPool();
      const existingUserResult = await pool.query(
        'SELECT id FROM users WHERE LOWER(BTRIM(email)) = $1 LIMIT 1',
        [normalizedEmail]
      );
      if (existingUserResult.rows.length > 0) {
        const existingUserId = existingUserResult.rows[0].id;
        await pool.query(
          `UPDATE users SET
             first_name = COALESCE($1, first_name),
             last_name = COALESCE($2, last_name),
             profile_image_url = COALESCE($3, profile_image_url),
             updated_at = NOW()
           WHERE id = $4`,
          [claims.first_name, claims.last_name, claims.profile_image_url, existingUserId]
        );
        claims.sub = existingUserId;
      } else {
        await pool.query(
          `INSERT INTO users (id, email, first_name, last_name, profile_image_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET
             email = COALESCE($2, users.email),
             first_name = COALESCE($3, users.first_name),
             last_name = COALESCE($4, users.last_name),
             profile_image_url = COALESCE($5, users.profile_image_url),
             updated_at = NOW()`,
          [claims.sub, claims.email, claims.first_name, claims.last_name, claims.profile_image_url]
        );
      }

      const sessionData = {
        cookie: { originalMaxAge: 7 * 24 * 60 * 60 * 1000, expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
        passport: { user: { claims } }
      };

      const sid = await prodAuth.createSession(pool, sessionData);
      const signedSid = require('crypto').createHmac('sha256', process.env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
      const cookieValue = `connect.sid=${encodeURIComponent('s:' + sid + '.' + signedSid)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;

      res.writeHead(302, { Location: '/', 'Set-Cookie': cookieValue });
      res.end();
    } catch (err) {
      console.error('[GoogleAuth] Callback error:', err.message);
      res.writeHead(302, { Location: '/login?error=google_auth_failed' });
      res.end();
    }
    return;
  }

  if (pathname === '/api/login-local' && req.method === 'POST') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await localAuth.handleLoginLocal(req, res, pool);
    return;
  }

  if (pathname === '/api/signup' && req.method === 'POST') {
    setCorsHeaders(res, req);
    if (!checkRateLimit(req, res, 'signup')) return;
    const pool = prodDb.getPool();
    await localAuth.handleSignup(req, res, pool);
    return;
  }

  if (pathname === '/api/confirm-email') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await localAuth.handleConfirmEmail(req, res, pool);
    return;
  }

  if (pathname === '/api/change-password' && req.method === 'POST') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await localAuth.handleChangePassword(req, res, pool);
    return;
  }

  if (pathname === '/api/forgot-password' && req.method === 'POST') {
    setCorsHeaders(res, req);
    if (!checkRateLimit(req, res, 'forgot')) return;
    const pool = prodDb.getPool();
    await localAuth.handleForgotPassword(req, res, pool);
    return;
  }

  if (pathname === '/api/reset-password' && req.method === 'POST') {
    setCorsHeaders(res, req);
    if (!checkRateLimit(req, res, 'reset')) return;
    const pool = prodDb.getPool();
    await localAuth.handleResetPassword(req, res, pool);
    return;
  }

  if (pathname === '/api/admin/set-staff-password' && req.method === 'POST') {
    const pool = prodDb.getPool();
    await localAuth.handleAdminSetStaffPassword(req, res, pool);
    return;
  }

  // Super-admin: remove stale duplicate AssistantSettings rows (one-time cleanup).
  // Only active companysync_master_001 super-admins may call this.
  // Impersonated sessions are always rejected (platform-only destructive action).
  // GET = dry-run (read-only plan); POST = live delete.
  if (pathname === '/api/admin/dedup-assistant-settings' && (req.method === 'POST' || req.method === 'GET')) {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const pool = prodDb.getPool();
    try {
      // Block impersonated sessions — this is a platform-level destructive action.
      const impCtx = req._impersonationCtx;
      if (impCtx && impCtx.isImpersonating) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not available during impersonation sessions' }));
        return;
      }

      // Auth: caller must be an active is_super_admin on companysync_master_001.
      const prodAuth = require('./db/prod-auth.cjs');
      const sessionData = await prodAuth.getSessionFromRequest(req, pool);
      const callerUserId = sessionData?.data?.passport?.user?.claims?.sub;
      if (!callerUserId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated' }));
        return;
      }
      const callerEmailRes = await pool.query('SELECT email FROM users WHERE id = $1', [callerUserId]);
      const callerEmail = callerEmailRes.rows[0]?.email;
      const masterRes = await pool.query(
        `SELECT is_super_admin FROM staff_profiles
          WHERE user_email = $1
            AND company_id = 'companysync_master_001'
            AND is_active = true
          LIMIT 1`,
        [callerEmail]
      );
      if (!masterRes.rows[0]?.is_super_admin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Active super-admin access required' }));
        return;
      }

      const DRY_RUN = req.method === 'GET'; // GET = dry-run, POST = live

      const {
        isLexiRow: isLexiRowLocal,
        isSarahRow: isSarahRowLocal,
        pickCanonicalSarahRow: pickCanonicalLocal,
        identifyDeletableDuplicates: identifyDeletableLocal,
        SARAH_PERSONA_NAMES_ARRAY: sarahNames,
      } = require('./lib/assistantSettingsHelpers.cjs');

      // Find companies with >1 Sarah-persona AssistantSettings row.
      // Lexi rows and other named assistant rows (marcus, custom) are excluded
      // from this count — they are never candidates for dedup deletion.
      // LOWER(BTRIM(...)) matches isSarahRow() which does .trim().toLowerCase().
      const dupRes = await pool.query(
        `SELECT company_id, COUNT(*) AS cnt
           FROM generic_entities
          WHERE entity_type = 'AssistantSettings'
            AND LOWER(BTRIM(COALESCE(data->>'assistant_name', ''))) = ANY($1)
          GROUP BY company_id
          HAVING COUNT(*) > 1
          ORDER BY company_id`,
        [sarahNames]
      );

      const report = [];
      let totalDeleted = 0;

      for (const { company_id: companyId } of dupRes.rows) {
        const rowsRes = await pool.query(
          `SELECT id,
                  company_id,
                  data->>'assistant_name' AS assistant_name,
                  data->>'brand_name'     AS brand_name,
                  created_date,
                  updated_date
             FROM generic_entities
            WHERE entity_type = 'AssistantSettings'
              AND company_id = $1
            ORDER BY updated_date DESC NULLS LAST`,
          [companyId]
        );
        const rows = rowsRes.rows;
        const canonical = pickCanonicalLocal(rows);
        if (!canonical) { report.push({ companyId, error: 'could not determine canonical Sarah row' }); continue; }

        // Only Sarah-persona rows that were never edited are deletable.
        // Lexi rows and other named assistant rows are NEVER in this list.
        const toDelete = identifyDeletableLocal(rows, canonical);

        const deletedIds = [];
        const skippedIds = []; // rows that were edited between our SELECT and the DELETE
        for (const row of toDelete) {
          if (!DRY_RUN) {
            // Atomic: the WHERE clause re-checks both the stale signature AND
            // the Sarah-persona constraint, so a row that is edited concurrently
            // or belongs to a different assistant is never removed.
            const del = await pool.query(
              `DELETE FROM generic_entities
                WHERE id = $1
                  AND entity_type = 'AssistantSettings'
                  AND company_id = $2
                  AND LOWER(BTRIM(COALESCE(data->>'assistant_name', ''))) <> 'lexi'
                  AND LOWER(BTRIM(COALESCE(data->>'assistant_name', ''))) = ANY($3)
                  AND (
                    created_date IS NULL
                    OR updated_date IS NULL
                    OR updated_date <= created_date + interval '5 seconds'
                  )`,
              [row.id, companyId, sarahNames]
            );
            if (del.rowCount > 0) {
              deletedIds.push(row.id);
              totalDeleted++;
              console.log(`[dedup-assistant-settings] Deleted stale row ${row.id} from ${companyId} (kept ${canonical.id})`);
            } else {
              skippedIds.push(row.id);
              console.log(`[dedup-assistant-settings] Skipped row ${row.id} from ${companyId} — edited concurrently, kept`);
            }
          } else {
            deletedIds.push(`[dry-run] ${row.id}`);
          }
        }

        report.push({
          companyId,
          canonicalId: canonical.id,
          canonicalBrand: canonical.brand_name,
          totalRows: rows.length,
          deletedIds,
          skippedIds,
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        dryRun: DRY_RUN,
        companiesWithDuplicates: dupRes.rows.length,
        totalDeleted: DRY_RUN ? 0 : totalDeleted,
        report,
      }, null, 2));
    } catch (e) {
      console.error('[dedup-assistant-settings] Error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/auth/user') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await prodAuth.handleGetUser(req, res, pool);
    return;
  }

  if (pathname === '/api/login') {
    setCorsHeaders(res, req);
    if (!checkRateLimit(req, res, 'login')) return;
    const pool = prodDb.getPool();
    await prodAuth.handleLogin(req, res, pool);
    return;
  }

  if (pathname === '/api/callback') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await prodAuth.handleCallback(req, res, pool);
    return;
  }

  if (pathname === '/api/logout') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await prodAuth.handleLogout(req, res, pool);
    return;
  }

  // ==========================================
  // SIGNING ENDPOINTS - All use local PostgreSQL
  // ==========================================
  if (pathname === '/api/public/get-signing-session') {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const token = body.token || body?.body?.token || body?.data?.token;
      console.log('[Signing] getSigningSession - token:', token);
      if (!token) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Token required' }));
        return;
      }
      const pool = prodDb.getPool();
      const result = await pool.query('SELECT * FROM signing_sessions WHERE signing_token = $1', [token]);
      if (result.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid or expired signing link' }));
        return;
      }
      const s = result.rows[0];
      if (s.expires_at && new Date(s.expires_at) < new Date()) {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'This signing link has expired' }));
        return;
      }
      const responseSession = {
        id: s.id, base44_session_id: s.base44_session_id, company_id: s.company_id,
        template_id: s.template_id, template_name: s.template_name, contract_name: s.contract_name,
        customer_name: s.customer_name, customer_email: s.customer_email,
        delivery_method: s.delivery_method, rep_name: s.rep_name, rep_email: s.rep_email,
        rep_fields: s.rep_fields || {}, rep_signature_url: s.rep_signature_url,
        status: s.status, current_signer: s.current_signer, final_pdf_url: null,
      };
      let originalFileUrl = s.original_file_url || null;
      // If not stored in signing_sessions, try fetching from the ContractTemplate entity
      if (!originalFileUrl && s.template_id) {
        try {
          const tplResult = await pool.query(
            `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = 'ContractTemplate' AND company_id = $2 LIMIT 1`,
            [s.template_id, s.company_id]
          );
          if (tplResult.rows.length > 0) {
            const tplData = tplResult.rows[0].data || {};
            originalFileUrl = tplData.original_file_url || tplData.file_url || null;
          }
          if (originalFileUrl) {
            // Backfill signing_sessions so future requests are faster
            await pool.query(
              `UPDATE signing_sessions SET original_file_url=$1 WHERE id=$2 AND (original_file_url IS NULL OR original_file_url='')`,
              [originalFileUrl, s.id]
            ).catch(() => {});
          }
        } catch (tplErr) {
          console.warn('[Signing] Could not look up ContractTemplate for original_file_url:', tplErr.message);
        }
      }
      // Prefer the frozen snapshot on the session; fall back to template/silo for legacy
      // rows (resolveSessionHtml also backfills the snapshot so future reads stay frozen).
      const htmlContent = await resolveSessionHtml(pool, s, null);
      let fillableFields = s.fillable_fields || [];
      if (fillableFields.length === 0 && s.template_id) {
        try {
          const tplFR = await pool.query(
            `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = 'ContractTemplate' AND company_id = $2 LIMIT 1`,
            [s.template_id, s.company_id]
          );
          if (tplFR.rows.length > 0) {
            const fd = tplFR.rows[0].data;
            const parsed = typeof fd === 'string' ? JSON.parse(fd) : fd;
            fillableFields = parsed?.fillable_fields || [];
          }
        } catch (_) {}
      }
      const template = {
        id: s.template_id, template_name: s.template_name,
        fillable_fields: fillableFields, original_file_url: originalFileUrl,
        html_content: htmlContent,
      };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, session: responseSession, template }));
    } catch (err) {
      console.error('[Signing] getSigningSession error:', err.message);
      if (err?.statusCode === 413) { replyError(res, err); return; }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Server error: ' + err.message }));
    }
    return;
  }

  if (pathname === '/api/public/sign-contract') {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const token = body.token || body?.body?.token || body?.data?.token;
      const fields = body.fields || body?.body?.fields || body?.data?.fields || {};
      const signature = body.signature || body?.body?.signature || body?.data?.signature;
      console.log('[Signing] signContract - token:', token, 'hasSignature:', !!signature);
      if (!token || !signature) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Token and signature required' }));
        return;
      }
      const pool = prodDb.getPool();
      const result = await pool.query('SELECT * FROM signing_sessions WHERE signing_token = $1', [token]);
      if (result.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid signing link' }));
        return;
      }
      const session = result.rows[0];
      if (session.status === 'completed') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Contract already signed' }));
        return;
      }
      if (session.expires_at && new Date(session.expires_at) < new Date()) {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'This signing link has expired' }));
        return;
      }
      await pool.query(
        `UPDATE signing_sessions SET customer_fields=$1, customer_signature_data=$2, customer_signed_at=$3, status='completed', completed_at=$4, updated_at=$5 WHERE id=$6`,
        [JSON.stringify(fields), signature, new Date(), new Date(), new Date(), session.id]
      );
      console.log('[Signing] Session completed, id:', session.id);

      // Propagate completion to sibling/duplicate rows (legacy dedup safety) so the
      // company-scoped E-Sign list always reflects Completed even when a duplicate
      // signing_sessions row exists for the same contract.
      try {
        const nowTs = new Date();
        await pool.query(
          `UPDATE signing_sessions
           SET status='completed',
               completed_at=COALESCE(completed_at,$1),
               customer_signed_at=COALESCE(customer_signed_at,$2),
               customer_fields=$3, customer_signature_data=$4, updated_at=$5
           WHERE id <> $6 AND status NOT IN ('completed','declined')
             AND (company_id = $7 OR ($7 IS NULL AND company_id IS NULL))
             AND (
                   id::text = $8
                OR base44_session_id = $9
                OR (base44_session_id IS NOT NULL AND base44_session_id = $8)
             )`,
          [nowTs, nowTs, JSON.stringify(fields), signature, nowTs,
           session.id, session.company_id, session.base44_session_id, String(session.id)]
        );
      } catch (sibErr) {
        console.warn('[Signing] sibling completion propagation failed:', sibErr.message);
      }
      if (session.rep_email) {
        try {
          let fieldRows = '';
          if (fields && Object.keys(fields).length > 0) {
            for (const [key, value] of Object.entries(fields)) {
              fieldRows += `<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">${key}</td><td style="padding:8px;border-bottom:1px solid #eee;">${value}</td></tr>`;
            }
          } else {
            fieldRows = '<tr><td colspan="2" style="padding:8px;color:#999;">No additional fields filled.</td></tr>';
          }
          const notifHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><div style="background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);padding:20px;text-align:center;border-radius:10px 10px 0 0;"><h1 style="color:white;margin:0;font-size:22px;">Contract Signed!</h1></div><div style="background:#f9fafb;padding:25px;border-radius:0 0 10px 10px;"><p><strong>Contract:</strong> ${session.contract_name || session.template_name || 'N/A'}</p><p><strong>Customer:</strong> ${session.customer_name}</p><p><strong>Signed at:</strong> ${new Date().toLocaleString()}</p><h3 style="margin-top:20px;border-bottom:2px solid #22c55e;padding-bottom:5px;">Customer Filled Information</h3><table style="width:100%;border-collapse:collapse;">${fieldRows}</table><p style="margin-top:20px;font-size:14px;color:#666;">The signed contract is available in your CRM under Contracts.</p></div></body></html>`;
          await sendEmail({
            to: session.rep_email,
            subject: `Contract Signed: ${session.contract_name || session.template_name} - ${session.customer_name}`,
            html: notifHtml
          });
          console.log('[Signing] Rep notification sent to:', session.rep_email);
        } catch (emailErr) {
          console.error('[Signing] Rep notification error:', emailErr.message);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'Contract signed successfully' }));
    } catch (err) {
      console.error('[Signing] signContract error:', err.message, err.stack);
      if (err?.statusCode === 413) { replyError(res, err); return; }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Server error: ' + err.message }));
    }
    return;
  }

  if (pathname === '/api/contracts/send-signing-link') {
    setCorsHeaders(res, req);
    await require('./lib/signingLinkDelivery.cjs').handleSigningLinkDelivery(req, res, {
      pool: prodDb.getPool(),
    });
    return;
    try {
      const body = JSON.parse(await readBody(req));
      const reqHost = req.headers?.host || '';
      const reqProto = req.headers?.['x-forwarded-proto'] || 'https';
      const replitBaseUrl = (reqHost ? `${reqProto}://${reqHost}` : (process.env.VITE_REPLIT_APP_URL || `https://${getPublicHost(req.headers)}`)).replace(/\/$/, '');
      const sessionId = body.sessionId || body.session_id;
      const sessionData = body.sessionData;

      console.log('[Signing] send-signing-link, sessionId:', sessionId, 'hasSessionData:', !!sessionData);

      if (!sessionId && !sessionData) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'sessionId or sessionData required' }));
        return;
      }

      const pool = prodDb.getPool();
      const { randomUUID } = require('crypto');
      const signingToken = randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      let session;

      // Determine the base44_session_id to look up
      const lookupId = (sessionData && (sessionData.base44_session_id || sessionId)) || sessionId;

      // Always try to find an existing row first (UPSERT pattern).
      // Also match on `id` so that the entity-create row (which has base44_session_id=NULL)
      // is found before a duplicate insert can happen.
      const existing = await pool.query(
        'SELECT * FROM signing_sessions WHERE base44_session_id = $1 OR id::text = $1 ORDER BY id LIMIT 1',
        [lookupId]
      );

      if (existing.rows.length > 0) {
        // Row exists — refresh the token and re-send
        console.log('[Signing] Existing session found (id:', existing.rows[0].id, '), refreshing token...');
        // Merge any new sessionData fields (e.g. updated rep_signature_url) into the row
        const existingId = existing.rows[0].id;
        if (sessionData) {
          await pool.query(
            `UPDATE signing_sessions SET signing_token=$1, status=$2, current_signer=$3, expires_at=$4,
             sent_to_customer_at=$5, updated_at=$6,
             base44_session_id=COALESCE(base44_session_id, $7),
             rep_fields=COALESCE($8::jsonb, rep_fields),
             rep_signature_url=COALESCE($9, rep_signature_url),
             rep_signed_at=COALESCE($10, rep_signed_at),
             fillable_fields=COALESCE($11::jsonb, fillable_fields),
             original_file_url=COALESCE($12, original_file_url)
             WHERE id=$13`,
            [
              signingToken, 'awaiting_customer', 'customer', expiresAt, new Date(), new Date(),
              lookupId,
              sessionData.rep_fields ? JSON.stringify(sessionData.rep_fields) : null,
              sessionData.rep_signature_url || null,
              sessionData.rep_signed_at ? new Date(sessionData.rep_signed_at) : null,
              sessionData.fillable_fields ? JSON.stringify(sessionData.fillable_fields) : null,
              sessionData.original_file_url || null,
              existingId,
            ]
          );
        } else {
          await pool.query(
            'UPDATE signing_sessions SET signing_token=$1, status=$2, current_signer=$3, expires_at=$4, sent_to_customer_at=$5, updated_at=$6, base44_session_id=COALESCE(base44_session_id, $7) WHERE id=$8',
            [signingToken, 'awaiting_customer', 'customer', expiresAt, new Date(), new Date(), lookupId, existingId]
          );
        }
        session = (await pool.query('SELECT * FROM signing_sessions WHERE id = $1', [existingId])).rows[0];
        console.log('[Signing] Token refreshed for session id:', session.id);
      } else if (sessionData) {
        // No existing row and we have data — insert fresh
        console.log('[Signing] No existing session found, inserting new row...');
        const insertResult = await pool.query(
          `INSERT INTO signing_sessions 
            (base44_session_id, company_id, template_id, template_name, contract_name,
             customer_name, customer_email, customer_phone, delivery_method,
             rep_name, rep_email, rep_fields, rep_signature_url, rep_signed_at,
             fillable_fields, original_file_url, signing_token, status, current_signer, expires_at, sent_to_customer_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           RETURNING *`,
          [
            lookupId,
            sessionData.company_id,
            sessionData.template_id,
            sessionData.template_name,
            sessionData.contract_name,
            sessionData.customer_name,
            sessionData.customer_email,
            sessionData.customer_phone,
            sessionData.delivery_method || 'email',
            sessionData.rep_name,
            sessionData.rep_email,
            JSON.stringify(sessionData.rep_fields || {}),
            sessionData.rep_signature_url,
            sessionData.rep_signed_at ? new Date(sessionData.rep_signed_at) : null,
            JSON.stringify(sessionData.fillable_fields || []),
            sessionData.original_file_url,
            signingToken,
            'awaiting_customer',
            'customer',
            expiresAt,
            new Date(),
          ]
        );
        session = insertResult.rows[0];
        console.log('[Signing] New session inserted, id:', session.id);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Session not found. Please provide sessionData to create a new session.' }));
        return;
      }

      // Freeze the contract wording into the session so later template edits do not
      // change an already-sent contract (legal integrity — the sent doc == signed doc).
      try { await resolveSessionHtml(pool, session, sessionData); } catch (_) {}

      const signingLink = `${replitBaseUrl}/sign-contract-customer?token=${signingToken}`;
      console.log('[Signing] Signing link:', signingLink);

      const customerEmail = session.customer_email || '';
      const customerName = session.customer_name || 'Customer';
      const contractName = session.contract_name || '';
      const templateName = session.template_name || '';
      const repName = session.rep_name || '';
      const deliveryMethod = session.delivery_method || 'email';
      const expiresDate = expiresAt.toLocaleDateString();

      let companyName = '';
      try {
        const coRow = await pool.query('SELECT company_name FROM companies WHERE id = $1 LIMIT 1', [session.company_id]);
        companyName = coRow.rows[0]?.company_name || '';
      } catch (coErr) {
        console.warn('[Signing] Could not fetch company name:', coErr.message);
      }

      let emailSent = false;
      let emailError = null;
      let smsSent = false;
      let smsError = null;

      // Send SMS when phone is available (always, regardless of delivery_method)
      if (session.customer_phone) {
        const twilioSid   = process.env.TWILIO_ACCOUNT_SID;
        const twilioToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioFrom  = process.env.TWILIO_PHONE_NUMBER;
        if (!twilioSid || !twilioToken || !twilioFrom) {
          smsError = 'Twilio not configured';
          console.error('[Signing]', smsError);
        } else {
          const smsBody = `Hi ${customerName},${repName ? ` ${repName} has` : ' You have been'} sent you a contract to review and sign.\n\n${signingLink}\n\nExpires: ${expiresDate}`;
          try {
            const smsRes = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
                },
                body: new URLSearchParams({ From: twilioFrom, To: session.customer_phone, Body: smsBody }).toString(),
              }
            );
            const smsResult = await smsRes.json();
            console.log('[Signing] SMS result:', smsRes.ok ? 'SUCCESS' : 'FAILED', smsResult.sid || smsResult.message);
            smsSent = smsRes.ok;
            if (!smsRes.ok) smsError = smsResult.message || 'Twilio API error';
          } catch (smsErr) {
            console.error('[Signing] SMS error:', smsErr.message);
            smsError = smsErr.message;
          }
        }
      }

      // Send email when email address is available (always, regardless of delivery_method)
      if (customerEmail && customerEmail.includes('@')) {
        console.log('[Signing] Sending signing link email to:', customerEmail);
        const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;"><h2 style="color: white; margin: 0 0 5px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">${companyName || 'Contract Signing'}</h2><h1 style="color: white; margin: 0; font-size: 24px;">Contract Ready for Your Signature</h1></div><div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;"><p style="font-size: 16px;">Hello <strong>${customerName}</strong>,</p><p style="font-size: 16px;">${repName ? repName + ' has' : 'You have been'} sent you a contract for electronic signature.</p>${templateName || contractName ? `<div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">${templateName ? `<p style="margin: 5px 0;"><strong>Contract:</strong> ${templateName}</p>` : ''}${contractName ? `<p style="margin: 5px 0;"><strong>Job:</strong> ${contractName}</p>` : ''}<p style="margin: 5px 0;"><strong>Expires:</strong> ${expiresDate}</p></div>` : ''}<p style="text-align: center; margin: 30px 0;"><a href="${signingLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-size: 18px; font-weight: bold;">Review & Sign Contract</a></p><p style="font-size: 14px; color: #666;">This link expires on <strong>${expiresDate}</strong>.</p></div></body></html>`;
        try {
          await sendEmail({
            to: customerEmail,
            subject: `Contract Ready: ${templateName || contractName || 'Review & Sign'}`,
            html: emailHtml,
            from: companyName ? `${companyName} <noreply@companysync.io>` : undefined
          });
          console.log('[Signing] Signing link email sent to:', customerEmail);
          emailSent = true;
        } catch (emailErr) {
          console.error('[Signing] Email error:', emailErr.message);
          emailError = emailErr.message;
        }
      }

      const result = {
        success: true,
        signing_link: signingLink,
        local_session_id: session.id,
        expires_at: expiresAt.toISOString(),
        delivery_method: deliveryMethod,
        email_sent: emailSent,
        sms_sent: smsSent,
        message: [
          emailSent ? `Email sent to ${customerEmail}` : (customerEmail ? `Email failed: ${emailError || 'unknown'}` : null),
          smsSent ? `SMS sent to ${session.customer_phone}` : (session.customer_phone ? `SMS failed: ${smsError || 'unknown'}` : null),
        ].filter(Boolean).join('; ') || 'No contact info available',
      };
      if (emailError) result.email_warning = emailError;
      if (smsError) result.sms_warning = smsError;

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[Signing] sendSigningLink error:', err.message, err.stack);
      if (err?.statusCode === 413) { replyError(res, err); return; }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/functions/incomingSMS' || pathname === '/api/whatsapp-webhook') {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const from = params.get('From') || '';
      const to = params.get('To') || '';
      const messageBody = params.get('Body') || '';
      const messageSid = params.get('MessageSid') || '';
      const numMedia = parseInt(params.get('NumMedia') || '0');
      const isWhatsApp = from.startsWith('whatsapp:') || to.startsWith('whatsapp:');
      const cleanFrom = from.replace('whatsapp:', '');
      const cleanTo = to.replace('whatsapp:', '');

      const pool = prodDb.getPool();

      try {
        const { verifyTwilioWebhook, shouldRejectTwilio } = require('./lib/twilioSignature.cjs');
        const twResult = await verifyTwilioWebhook(req, body, pool);
        if (shouldRejectTwilio(twResult, 'whatsapp-webhook')) {
          res.writeHead(403, { 'Content-Type': 'text/xml' });
          res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
          return;
        }
      } catch (e) { console.warn('[Sarah] Twilio signature check error (whatsapp):', e.message); }

      console.log(`[Sarah] ${isWhatsApp ? 'WhatsApp' : 'SMS'} webhook: from=${cleanFrom}, body="${messageBody.substring(0, 100)}"`);
      const normalizedTo = cleanTo.replace(/[^\d]/g, '').replace(/^(\d{10})$/, '+1$1').replace(/^1(\d{10})$/, '+1$1').replace(/^(\d{11})$/, '+$1');
      const e164To = normalizedTo.startsWith('+') ? normalizedTo : `+${normalizedTo}`;

      let resolvedCompanyId = null;
      try {
        const digits10 = e164To.replace(/^\+1/, '');
        const digits11 = '1' + digits10;

        // TwilioSettings is the authoritative source — check it FIRST.
        // ORDER BY ensures the most recently configured tenant wins when
        // multiple companies share the same number (e.g. old YICN entry +
        // new Virgil Roofing entry). Demo/master company IDs sort last.
        const twilioLookup = await pool.query(
          `SELECT g.company_id FROM generic_entities g
           WHERE g.entity_type = 'TwilioSettings'
             AND (
               g.data->>'main_phone_number' IN ($1,$2,$3)
               OR g.data->>'thoughtly_phone' IN ($1,$2,$3)
               OR g.data->'available_numbers' ? $1
               OR g.data->'available_numbers' ? $2
               OR g.data->'available_numbers' ? $3
             )
           ORDER BY (g.company_id IN ('companysync_master_001', '695944e3c1fb00b7ab716c6f')) ASC,
                    g.updated_date DESC NULLS LAST
           LIMIT 1`,
          [e164To, digits10, digits11]
        );
        if (twilioLookup.rows[0]) {
          resolvedCompanyId = twilioLookup.rows[0].company_id;
          console.log(`[Sarah] SMS TwilioSettings hit: ${e164To} -> ${resolvedCompanyId}`);
          // Self-heal the routing cache so future lookups are correct even
          // if a stale entry was previously cached for a different company.
          pool.query(
            `INSERT INTO call_routing_cache (phone_number, company_id, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (phone_number) DO UPDATE SET company_id = $2, updated_at = NOW()`,
            [e164To, resolvedCompanyId]
          ).catch(() => {});
        }

        // Fall back to routing cache (handles staff personal Twilio numbers
        // and any number not in TwilioSettings).
        if (!resolvedCompanyId) {
          const localLookup = await pool.query(
            `SELECT company_id FROM call_routing_cache WHERE phone_number = $1 OR phone_number = $2 OR phone_number = $3 LIMIT 1`,
            [e164To, digits10, digits11]
          );
          if (localLookup.rows[0]) {
            resolvedCompanyId = localLookup.rows[0].company_id;
            console.log(`[Sarah] SMS routing cache hit: ${e164To} -> ${resolvedCompanyId}`);
          }
        }

        // Last resort: match against staff personal Twilio numbers
        if (!resolvedCompanyId) {
          const staffLookup = await pool.query(
            `SELECT company_id FROM staff_profiles WHERE twilio_number = $1 OR twilio_number = $2 OR twilio_number = $3 LIMIT 1`,
            [e164To, digits10, digits11]
          );
          if (staffLookup.rows[0]) {
            resolvedCompanyId = staffLookup.rows[0].company_id;
            console.log(`[Sarah] SMS staff_profiles hit: ${e164To} -> ${resolvedCompanyId}`);
          }
        }
      } catch (e) {}
      if (!resolvedCompanyId && BASE44_API_URL) {
        try {
          const lookup = await callBase44API('lookupByPhone', null, { phone_number: e164To });
          if (lookup?.success && lookup.company_id) resolvedCompanyId = lookup.company_id;
        } catch (e) {}
      }
      try {
        const smsOptOut = require('./lib/smsOptOut.cjs');
        const keyword = smsOptOut.classifyInboundSms(messageBody);
        if (keyword) {
          await smsOptOut.setOptOut(pool, cleanFrom, resolvedCompanyId, keyword === 'stop');
          const reply = smsOptOut.optOutReply(keyword);
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`);
          return;
        }
      } catch (optErr) {
        console.warn('[SMS] opt-out handling failed:', optErr.message);
      }
      if (!resolvedCompanyId) { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); return; }

      // Check if the To number is a rep's personal Twilio number — if so, route to their inbox, skip Sarah.
      if (!isWhatsApp) {
        try {
          const staffResult = await pool.query(
            `SELECT user_email, full_name, twilio_number, cell_phone FROM staff_profiles
             WHERE company_id = $1 AND is_active = true AND twilio_number IS NOT NULL AND twilio_number != ''`,
            [resolvedCompanyId]
          );
          let routedToRep = null;
          for (const row of staffResult.rows) {
            const n = (row.twilio_number || '').replace(/[^\d+]/g, '');
            const norm = n.startsWith('+') ? n : (n.length === 10 ? `+1${n}` : n.length === 11 ? `+${n}` : n);
            if (norm === e164To) { routedToRep = row; break; }
          }
          if (routedToRep) {
            console.log(`[Sarah] SMS to rep number ${e164To} -> ${routedToRep.full_name} (${routedToRep.user_email}), routing to inbox`);
            let repRouteContactName = cleanFrom;
            let repRouteCustomerId = null;
            try {
              const { name: crmName, source: crmSource, record: crmRecord } = await lookupCallerByCrmPhone(pool, resolvedCompanyId, cleanFrom);
              if (crmName) {
                repRouteContactName = crmName;
                if (crmSource === 'customer' && crmRecord?.id) repRouteCustomerId = crmRecord.id;
              }
            } catch (e) {}
            const repCommId = `comm_rep_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
            pool.query(
              `INSERT INTO communications (id, company_id, communication_type, direction, contact_phone, contact_name, body, message, status, is_read, customer_id, data, created_at, updated_at)
               VALUES ($1,$2,'sms','inbound',$3,$4,$5,$5,'received',false,$6,$7,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
              [repCommId, resolvedCompanyId, cleanFrom, repRouteContactName, messageBody, repRouteCustomerId,
               JSON.stringify({ routed_to_rep_email: routedToRep.user_email, routed_to_rep_name: routedToRep.full_name, to_number: cleanTo, message_sid: messageSid })]
            ).catch(e => console.warn('[Sarah] Failed to save rep SMS:', e.message));
            // Bell + email + SMS-to-cell notifications for the rep
            try {
              const bodySnip = messageBody.length > 120 ? messageBody.substring(0, 117) + '...' : messageBody;
              // 1. Bell notification
              const nId = `notif_rsms_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
              pool.query(
                `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
                [nId, resolvedCompanyId, JSON.stringify({
                  id: nId, type: 'inbound_sms', title: `📱 New SMS from ${repRouteContactName}`,
                  message: `"${bodySnip}"`, is_read: false, user_email: routedToRep.user_email,
                  link_url: '/Communication', created_date: new Date().toISOString()
                })]
              ).catch(() => {});
              // 2. SMS to rep's personal cell phone
              const repCellPhone = routedToRep.cell_phone;
              if (repCellPhone) {
                try {
                  const { rows: twRows } = await pool.query(
                    `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
                    [resolvedCompanyId]
                  );
                  const tw = twRows[0]?.data || {};
                  const twSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
                  const twToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
                  const twFrom = tw.main_phone_number || process.env.TWILIO_PHONE_NUMBER;
                  if (twSid && twToken && twFrom) {
                    const cellMsg = `📱 New text to your line from ${cleanFrom}:\n"${messageBody.substring(0, 120)}"`;
                    const authStr = Buffer.from(`${twSid}:${twToken}`).toString('base64');
                    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twSid}/Messages.json`, {
                      method: 'POST',
                      headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                      body: new URLSearchParams({ To: repCellPhone, From: twFrom, Body: cellMsg }).toString()
                    });
                    console.log(`[Sarah] Rep SMS cell alert sent to ${repCellPhone}`);
                  }
                } catch (cellErr) { console.warn('[Sarah] Rep SMS cell alert error:', cellErr.message); }
              }
            } catch (e) { console.warn('[Sarah] Rep SMS notification error:', e.message); }
            // Check if the last outbound message in this thread was sent by a rep.
            // If so, Sarah stays silent — the rep owns this conversation.
            // NOTE: `sent_by_rep` is written by functionHandlers.sendSMS in
            // vite-functions-plugin.js (loaded via prod-integrations getFunctionHandlers),
            // which is the shared handler for both dev and prod CRM outbound sends.
            let lastOutboundSentByRep = false;
            try {
              const { rows: lastOutRows } = await pool.query(
                `SELECT data, created_at FROM communications
                 WHERE company_id = $1 AND contact_phone = $2 AND direction = 'outbound'
                 ORDER BY created_at DESC NULLS LAST LIMIT 1`,
                [resolvedCompanyId, cleanFrom]
              );
              const lastData = lastOutRows[0]?.data || {};
              const lastSentAt = lastOutRows[0]?.created_at;
              const repThreadExpired = lastSentAt && (Date.now() - new Date(lastSentAt).getTime()) > 4 * 60 * 60 * 1000;
              if ((lastData.sent_by_rep === true || lastData.sent_by_rep === 'true') && !repThreadExpired) {
                lastOutboundSentByRep = true;
              }
            } catch (e) { console.warn('[Sarah] sent_by_rep check failed:', e.message); }
            if (lastOutboundSentByRep) {
              console.log(`[Sarah] Skipping AI reply — last outbound to ${cleanFrom} was rep-sent`);
              res.writeHead(200, { 'Content-Type': 'text/xml' });
              res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
              return;
            }
            // No rep-initiated outbound found — let Sarah respond as usual
            try {
              const aiResp = await callBase44API('handleIncomingMessage', resolvedCompanyId, { from: cleanFrom, to: cleanTo, body: messageBody, message_sid: messageSid, channel: 'sms', num_media: numMedia });
              if (aiResp?.reply) {
                const repAiId = `comm_rep_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
                pool.query(
                  `INSERT INTO communications (id, company_id, communication_type, direction, contact_phone, contact_name, body, message, status, data, created_at, updated_at)
                   VALUES ($1,$2,'sms','outbound',$3,$4,$5,$5,'sent',$6,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
                  [repAiId, resolvedCompanyId, cleanFrom, repRouteContactName, aiResp.reply,
                   JSON.stringify({ routed_to_rep_email: routedToRep.user_email, ai_reply: true, message_sid: messageSid })]
                ).catch(() => {});
                res.writeHead(200, { 'Content-Type': 'text/xml' });
                res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${aiResp.reply}</Message></Response>`);
                return;
              }
            } catch (e) { console.warn('[Sarah] Rep SMS AI reply failed:', e.message); }
            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
            return;
          }
        } catch (e) { console.warn('[Sarah] Rep SMS routing check failed:', e.message); }
      }

      try {
        const msgSettings = await callBase44API('getMessagingSettings', resolvedCompanyId);
        if (isWhatsApp && msgSettings?.whatsapp_enabled !== true) { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); return; }
        const commType = isWhatsApp ? 'whatsapp' : 'sms';
        let webhookContactName = cleanFrom;
        let webhookCustomerId = null;
        try {
          const { name: crmName, source: crmSource, record: crmRecord } = await lookupCallerByCrmPhone(pool, resolvedCompanyId, cleanFrom);
          if (crmName) {
            webhookContactName = crmName;
            if (crmSource === 'customer' && crmRecord?.id) webhookCustomerId = crmRecord.id;
          }
        } catch (e) {}
        const inboundId = `comm_inb_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        pool.query(
          `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, contact_name, message, body, status, customer_id, data, created_at, updated_at)
           VALUES ($1,$2,$3,$3,'inbound',$4,$5,$6,$6,'received',$7,$8,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
          [inboundId, resolvedCompanyId, commType, cleanFrom, webhookContactName, messageBody, webhookCustomerId, JSON.stringify({ message_sid: messageSid, to: cleanTo })]
        ).catch(e => console.warn('[Sarah] Failed to save inbound SMS to local DB:', e.message));

        // WhatsApp installer photo upload — intercept before Sarah handles it
        if (isWhatsApp && numMedia > 0) {
          try {
            const mediaUrls = [];
            for (let mi = 0; mi < numMedia; mi++) {
              const u = params.get(`MediaUrl${mi}`);
              if (u) mediaUrls.push(u);
            }
            if (mediaUrls.length > 0) {
              const { rows: twRows } = await pool.query(
                `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
                [resolvedCompanyId]
              );
              const tw = twRows[0]?.data || {};
              const twSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
              const twToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
              const handled = await handleWhatsAppPhotoUpload({
                pool, companyId: resolvedCompanyId,
                fromPhone: cleanFrom, mediaUrls, messageBody,
                twilioSid: twSid, twilioToken: twToken, toPhone: cleanTo,
              });
              if (handled) {
                res.writeHead(200, { 'Content-Type': 'text/xml' });
                res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
                return;
              }
            }
          } catch (waPhotoErr) {
            console.warn('[WhatsAppPhotos] Handler error:', waPhotoErr.message);
          }
        }

        // WhatsApp job picker — installer replied with a number to select which job
        if (isWhatsApp && numMedia === 0 && /^\s*\d+\s*$/.test(messageBody)) {
          try {
            const { rows: twRows } = await pool.query(
              `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
              [resolvedCompanyId]
            );
            const tw = twRows[0]?.data || {};
            const twSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
            const twToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
            const handled = await resolveInstallerPendingChoice({
              pool, companyId: resolvedCompanyId,
              fromPhone: cleanFrom, choiceText: messageBody,
              twilioSid: twSid, twilioToken: twToken, toPhone: cleanTo,
            });
            if (handled) {
              res.writeHead(200, { 'Content-Type': 'text/xml' });
              res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
              return;
            }
          } catch (waPickErr) {
            console.warn('[WhatsAppPhotos] Pending choice error:', waPickErr.message);
          }
        }

        // Human-takeover check: if any staff member sent a manual SMS to this contact
        // within the last 8 hours, Sarah stays silent so the human can keep handling it.
        // We do NOT require created_by to be set — any non-AI outbound to this number counts.
        // If created_by IS set we also check availability; if it's missing we suppress anyway.
        let humanHandling = false;
        if (!isWhatsApp) {
          try {
            const digits = cleanFrom.replace(/[^\d]/g, '').slice(-10);
            const { rows: recentRows } = await pool.query(
              `SELECT created_by FROM communications
               WHERE company_id = $1
                 AND direction = 'outbound'
                 AND communication_type = 'sms'
                 AND (contact_phone = $2 OR contact_phone LIKE $3 OR contact_phone = $4)
                 AND (data->>'ai_reply' IS NULL OR data->>'ai_reply' != 'true')
                 AND created_at > NOW() - INTERVAL '8 hours'
               ORDER BY created_at DESC LIMIT 1`,
              [resolvedCompanyId, cleanFrom, `%${digits}`, `+1${digits}`]
            );
            if (recentRows.length > 0) {
              const staffEmail = recentRows[0]?.created_by;
              if (staffEmail) {
                // If we know who sent it, check their availability
                const { rows: staffRows } = await pool.query(
                  `SELECT availability_status FROM staff_profiles
                   WHERE company_id = $1 AND user_email = $2 LIMIT 1`,
                  [resolvedCompanyId, staffEmail]
                );
                const avail = staffRows[0]?.availability_status || 'available';
                if (avail !== 'unavailable') {
                  humanHandling = true;
                  console.log(`[Sarah] SMS suppressed — ${staffEmail} is actively handling this conversation (status: ${avail})`);
                } else {
                  console.log(`[Sarah] Staff ${staffEmail} is unavailable — Sarah will respond`);
                }
              } else {
                // No created_by recorded but a non-AI outbound exists — treat as human-handled
                humanHandling = true;
                console.log(`[Sarah] SMS suppressed — recent manual outbound found for ${cleanFrom} (no created_by recorded, suppressing by default)`);
              }
            }
          } catch (suppE) {
            console.warn('[Sarah] Human-takeover check failed:', suppE.message);
          }
        }

        if (humanHandling) {
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
          return;
        }

        const aiResponse = await callBase44API('handleIncomingMessage', resolvedCompanyId, { from: cleanFrom, to: cleanTo, body: messageBody, message_sid: messageSid, channel: isWhatsApp ? 'whatsapp' : 'sms', num_media: numMedia });
        if (aiResponse?.reply) {
          const replyId = `comm_rep_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
          pool.query(
            `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, contact_name, message, body, status, data, created_at, updated_at)
             VALUES ($1,$2,$3,$3,'outbound',$4,$5,$6,$6,'sent',$7,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
            [replyId, resolvedCompanyId, commType, cleanFrom, webhookContactName, aiResponse.reply, JSON.stringify({ message_sid: messageSid, ai_reply: true })]
          ).catch(() => {});
          res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${aiResponse.reply}</Message></Response>`);
        } else { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); }
      } catch (e) { console.error('[Sarah] WhatsApp/SMS error:', e.message); res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); }
    } catch (e) { if (e?.statusCode === 413) { replyError(res, e); return; } res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); }
    return;
  }

  if (pathname === '/api/sarah-missed-call') {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const callStatus = params.get('CallStatus') || '';
      const callerPhone = params.get('From') || params.get('Caller') || '';
      const calledNumber = params.get('To') || params.get('Called') || '';
      const callSid = params.get('CallSid') || '';
      const pool = prodDb.getPool();

      try {
        const { verifyTwilioWebhook, shouldRejectTwilio } = require('./lib/twilioSignature.cjs');
        const twResult = await verifyTwilioWebhook(req, body, pool);
        if (shouldRejectTwilio(twResult, 'sarah-missed-call')) {
          res.writeHead(403); res.end('Forbidden'); return;
        }
      } catch (e) { console.warn('[Sarah] Twilio signature check error (missed-call):', e.message); }

      if (callStatus !== 'no-answer' && callStatus !== 'busy' && callStatus !== 'failed') { res.writeHead(200); res.end('OK'); return; }
      console.log(`[Sarah] Missed call: from=${callerPhone}, status=${callStatus}`);
      let resolvedCompanyId = null;
      try {
        const localLookup = await pool.query(
          `SELECT company_id FROM call_routing_cache WHERE phone_number = $1 LIMIT 1`,
          [calledNumber]
        );
        if (localLookup.rows[0]) resolvedCompanyId = localLookup.rows[0].company_id;
        if (!resolvedCompanyId) {
          const twilioLookup = await pool.query(
            `SELECT g.company_id FROM generic_entities g
             JOIN companies c ON c.id = g.company_id OR c.base44_id = g.company_id
             WHERE g.entity_type = 'TwilioSettings'
               AND (g.data->>'main_phone_number' = $1 OR g.data->'available_numbers' ? $1 OR g.data->'available_numbers' ? $2)
             LIMIT 1`,
            [calledNumber, calledNumber.replace(/^\+1/, '')]
          );
          if (twilioLookup.rows[0]) resolvedCompanyId = twilioLookup.rows[0].company_id;
        }
        if (!resolvedCompanyId) {
          const staffLookup = await pool.query(
            `SELECT company_id FROM staff_profiles WHERE twilio_number = $1 OR twilio_number = $2 LIMIT 1`,
            [calledNumber, calledNumber.replace(/^\+1/, '')]
          );
          if (staffLookup.rows[0]) resolvedCompanyId = staffLookup.rows[0].company_id;
        }
      } catch (e) {}
      if (!resolvedCompanyId && BASE44_API_URL) {
        try { const lookup = await callBase44API('lookupByPhone', null, { phone_number: calledNumber }); if (lookup?.success && lookup.company_id) resolvedCompanyId = lookup.company_id; } catch (e) {}
      }
      if (!resolvedCompanyId) { res.writeHead(200); res.end('OK'); return; }

      // Always notify rep + admins about the missed call (bell + email + SMS to cell)
      try {
        const pool2 = prodDb.getPool();
        const { rows: mcAdminRows } = await pool2.query(
          `SELECT user_email, full_name, cell_phone FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
          [resolvedCompanyId]
        );
        const { rows: mcRepRows } = await pool2.query(
          `SELECT user_email, full_name, cell_phone FROM staff_profiles WHERE company_id = $1 AND (twilio_number = $2 OR twilio_number = $3) LIMIT 1`,
          [resolvedCompanyId, calledNumber, calledNumber.replace(/^\+1/, '')]
        );
        const { rows: twMcRows } = await pool2.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
          [resolvedCompanyId]
        );
        const twMc = twMcRows[0]?.data || {};
        const twMcSid = twMc.account_sid || process.env.TWILIO_ACCOUNT_SID;
        const twMcToken = twMc.auth_token || process.env.TWILIO_AUTH_TOKEN;
        const twMcFrom = twMc.main_phone_number || process.env.TWILIO_PHONE_NUMBER;

        const mcRep = mcRepRows[0] || null;
        const mcSeenEmails = new Set();
        const mcTargets = [];
        for (const r of [...mcRepRows, ...mcAdminRows]) {
          if (r.user_email && !mcSeenEmails.has(r.user_email)) {
            mcSeenEmails.add(r.user_email);
            mcTargets.push(r);
          }
        }

        const mcTitle = `📵 Missed call from ${callerPhone}`;
        const mcMessage = `A call from ${callerPhone} went unanswered${mcRep ? ' on ' + mcRep.full_name + "'s line" : ''} (${calledNumber}). Status: ${callStatus}.`;

        for (const target of mcTargets) {
          // 1. Bell notification
          const nId = `notif_missed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          await pool2.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
            [nId, resolvedCompanyId, JSON.stringify({
              id: nId, type: 'missed_call', title: mcTitle, message: mcMessage,
              user_email: target.user_email, is_read: false,
              caller_phone: callerPhone, called_number: calledNumber, call_status: callStatus,
              created_at: new Date().toISOString(),
            })]
          );
          // 2. Email
          try {
            await sendEmail({ to: target.user_email, subject: mcTitle, html: `<h2 style="color:#dc2626">${mcTitle}</h2><p style="font-family:sans-serif;font-size:14px">${mcMessage}</p>`, companyId: resolvedCompanyId });
          } catch (emailErr) { console.warn('[Sarah] Missed call email error:', emailErr.message); }
          // 3. SMS to personal cell
          if (target.cell_phone && twMcSid && twMcToken && twMcFrom) {
            try {
              const authStr = Buffer.from(`${twMcSid}:${twMcToken}`).toString('base64');
              await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twMcSid}/Messages.json`, {
                method: 'POST',
                headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ To: target.cell_phone, From: twMcFrom, Body: `📵 Missed call from ${callerPhone} on ${calledNumber}. Status: ${callStatus}.` }).toString()
              });
            } catch (smsErr) { console.warn('[Sarah] Missed call cell SMS error:', smsErr.message); }
          }
        }
        console.log(`[Sarah] Missed call: notified ${mcTargets.length} user(s) (bell+email+SMS)`);
      } catch (mcErr) { console.warn('[Sarah] Missed call notification error:', mcErr.message); }

      try {
        const msgSettings = await callBase44API('getMessagingSettings', resolvedCompanyId);
        if (msgSettings?.missed_call_followup_enabled !== true) { console.log(`[Sarah] Missed call follow-up disabled`); res.writeHead(200); res.end('OK'); return; }
        await callBase44API('sendMissedCallFollowup', resolvedCompanyId, { caller_phone: callerPhone, called_number: calledNumber, call_sid: callSid, call_status: callStatus, channel: msgSettings.missed_call_channel || 'sms' });
        console.log(`[Sarah] Missed call follow-up sent to ${callerPhone}`);
      } catch (e) { console.error('[Sarah] Missed call follow-up error:', e.message); }
      res.writeHead(200); res.end('OK');
    } catch (e) { if (e?.statusCode === 413) { replyError(res, e); return; } res.writeHead(200); res.end('OK'); }
    return;
  }

  if (pathname === '/api/messaging-settings') {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const defaults = { whatsapp_enabled: false, missed_call_followup_enabled: false, appointment_reminders_enabled: false, missed_call_channel: 'sms', missed_call_template: '', appointment_reminder_template: '', dedup_window_hours: 24 };
    if (req.method === 'GET') {
      const companyId = url.searchParams.get('companyId') || '';
      if (!companyId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing companyId' })); return; }
      if (!BASE44_API_URL) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(defaults)); return; }
      try {
        const settings = await callBase44API('getMessagingSettings', companyId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(settings || defaults));
      } catch (e) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(defaults)); }
    } else if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const { companyId, ...settings } = body;
        if (!companyId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'companyId required' })); return; }
        if (!BASE44_API_URL) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, ...settings })); return; }
        const result = await callBase44API('saveMessagingSettings', companyId, settings);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (e) { replyError(res, e); }
    } else { res.writeHead(405); res.end(); }
    return;
  }

  if (pathname === '/api/integrations/upload' && req.method === 'POST') {
    await prodIntegrations.handleUpload(req, res);
    return;
  }

  if (pathname === '/api/measurements' || pathname === '/api/measurements/analyze-photos') {
    setCorsHeaders(res, req);
    const sendMeasurementJson = (payload, status = 200) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    try {
      const caller = await getAuthenticatedProdUser(req);
      if (!caller?.email) {
        sendMeasurementJson({ error: 'Authentication required' }, 401);
        return;
      }
      const isList = pathname === '/api/measurements' && req.method === 'GET';
      const isAnalyze = pathname === '/api/measurements/analyze-photos' && req.method === 'POST';
      if (!isList && !isAnalyze) {
        sendMeasurementJson({ error: 'Method not allowed' }, 405);
        return;
      }
      if (isAnalyze && req._impersonationCtx?.isImpersonating) {
        sendMeasurementJson({ error: 'Photo measurement is blocked during an impersonation session.' }, 403);
        return;
      }
      const query = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
      let body = {};
      if (isAnalyze) body = JSON.parse(await readBody(req, 2 * 1024 * 1024));
      const requestedCompanyId = isList
        ? query.searchParams.get('company_id')
        : (body.company_id || body.companyId || null);
      const companyId = await resolveMeasurementCompany({
        pool: prodDb.getPool(),
        caller,
        requestedCompanyId,
        invoiceId: isList ? query.searchParams.get('invoice_id') : (body.invoice_id || body.invoiceId || null),
        jobId: isList ? query.searchParams.get('job_id') : (body.job_id || body.jobId || null),
      });
      if (isList) {
        const rows = await listPropertyMeasurements({
          pool: prodDb.getPool(),
          companyId,
          invoiceId: query.searchParams.get('invoice_id'),
          jobId: query.searchParams.get('job_id'),
        });
        sendMeasurementJson({ measurements: rows });
        return;
      }
      const apiKey = await prodDb.getCompanyGeminiKey(companyId);
      const requestHost = req.headers['x-forwarded-host'] || req.headers.host;
      const requestBaseUrl = requestHost
        ? `https://${requestHost}`
        : (process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com');
      const result = await analyzePropertyPhotos({
        pool: prodDb.getPool(),
        companyId,
        invoiceId: body.invoice_id || body.invoiceId || null,
        jobId: body.job_id || body.jobId || null,
        photoUrls: body.photo_urls || body.photoUrls,
        requestBaseUrl,
        apiKey,
        checkAIUsage: prodIntegrations.checkAIUsageProd,
        logUsageEvent: prodIntegrations.logUsageEventProd,
        createdBy: caller.email,
      });
      sendMeasurementJson({ measurement: result });
    } catch (error) {
      const status = error instanceof PropertyMeasurementError ? error.statusCode : (error instanceof SyntaxError ? 400 : 500);
      console.error('[PropertyMeasurements] request failed:', error.message);
      sendMeasurementJson({ error: status === 500 ? 'Photo measurement failed. Please try again.' : (status === 400 ? 'Invalid JSON request body.' : error.message), code: error.code }, status);
    }
    return;
  }

  if (pathname === '/api/integrations/invoke-llm' && req.method === 'POST') {
    await prodIntegrations.handleInvokeLLM(req, res);
    return;
  }

  if (pathname === '/api/integrations/send-email' && req.method === 'POST') {
    await prodIntegrations.handleSendEmail(req, res);
    return;
  }

  if (pathname === '/api/twilio/reconfigure-webhooks' && req.method === 'POST') {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const authHeader = req.headers['x-bridge-secret'] || '';
    if (!BRIDGE_SECRET || authHeader !== BRIDGE_SECRET) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized - valid bridge secret required' }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req));
      const { companyId } = body;
      if (!companyId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'companyId required' })); return; }
      const pool = prodDb.getPool();
      const { rows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 ORDER BY updated_date DESC LIMIT 1`,
        [companyId]
      );
      if (!rows[0]) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No Twilio settings found' })); return; }
      const ts = rows[0].data;
      const accountSid = ts.account_sid;
      const authToken = ts.auth_token;
      const phoneNumber = ts.main_phone_number;
      if (!accountSid || !authToken || !phoneNumber) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Incomplete Twilio credentials' })); return; }
      const trustedHost = process.env.VITE_REPLIT_APP_URL ? new URL(process.env.VITE_REPLIT_APP_URL).host : getPublicHost(req.headers);
      const appUrl = `https://${trustedHost}`;
      const voiceUrl = `${appUrl}/api/twilio/voice`;
      const smsUrl = `${appUrl}/api/functions/incomingSMS`;
      const searchResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`, {
        headers: { 'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64') }
      });
      const searchData = await searchResp.json();
      if (!searchData.incoming_phone_numbers?.length) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Phone number not found in Twilio' })); return; }
      const phoneSid = searchData.incoming_phone_numbers[0].sid;
      const updateResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneSid}.json`, {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ VoiceUrl: voiceUrl, VoiceMethod: 'POST', SmsUrl: smsUrl, SmsMethod: 'POST' }).toString()
      });
      const updateData = await updateResp.json();
      if (!updateResp.ok) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Twilio update failed', details: updateData })); return; }
      console.log(`[Twilio] Webhooks reconfigured for ${phoneNumber}: voice=${voiceUrl}, sms=${smsUrl}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, phoneNumber, voiceUrl, smsUrl }));
    } catch (e) {
      console.error('[Twilio] Reconfigure error:', e.message);
      replyError(res, e);
    }
    return;
  }

  if (pathname === '/api/functions/invoke' && req.method === 'POST') {
    // Use cached context from centralized middleware (or resolve fresh if not yet set)
    const impCtx = req._impersonationCtx || (() => { try { return tenantGuard.resolveRequestContext(req, prodDb.getPool()); } catch (_) { return null; } })();
    const resolvedCtx = impCtx instanceof Promise ? await impCtx : impCtx;

    if (resolvedCtx?.isImpersonating) {
      // Buffer body to check which function is being invoked
      const bodyBuf = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', d => chunks.push(d));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      let fnName = '';
      try { fnName = JSON.parse(bodyBuf.toString()).functionName || ''; } catch (_) {}

      // Allowlist: only known read-only function prefixes permitted during impersonation
      const READ_ONLY_PREFIXES = ['get', 'list', 'fetch', 'search', 'find', 'load', 'check', 'export',
        'calculate', 'compute', 'analyze', 'verify', 'preview', 'download'];
      const isReadOnly = READ_ONLY_PREFIXES.some(pfx => fnName.toLowerCase().startsWith(pfx));
      if (!isReadOnly) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Function '${fnName}' is blocked during impersonation. Only read-only data retrieval functions are allowed during support sessions.` }));
      }

      // Allowed read-only function — replay buffered body for downstream handler
      const EventEmitter = require('events');
      class BodyReplayReq extends EventEmitter {
        constructor(buf, srcReq) {
          super();
          this.headers = srcReq.headers;
          this.method = srcReq.method;
          this.url = srcReq.url;
          this.session = srcReq.session;
          this.socket = srcReq.socket;
          process.nextTick(() => { this.emit('data', buf); this.emit('end'); });
        }
      }
      await prodIntegrations.handleFunctionInvoke(new BodyReplayReq(bodyBuf, req), res);
      return;
    }
    await prodIntegrations.handleFunctionInvoke(req, res);
    return;
  }

  // ─── Team Chat API ─────────────────────────────────────────────────────────
  // Helper: resolve authenticated email from server-side session.
  // Uses DB-backed session lookup (prodAuth.getSessionFromRequest) because this
  // is a raw http.createServer — there is no Express session middleware, so
  // req.session is always undefined and must never be relied upon here.
  async function getChatAuthedEmail(req) {
    const pool = prodDb.getPool();
    const session = await prodAuth.getSessionFromRequest(req, pool);
    const su = session?.data?.passport?.user || session?.data?.user;
    return su?.claims?.email || su?.email || null;
  }
  // Helper: verify caller is a staff member of the given company (or the company owner via users table)
  async function verifyChatMembership(pool, authedEmail, companyId) {
    const r = await pool.query(
      `SELECT id FROM staff_profiles WHERE company_id = $1 AND user_email = $2 LIMIT 1`,
      [companyId, authedEmail]
    );
    if (r.rows.length > 0) return true;
    // Also allow company owner (created_by) — check company entity
    const co = await pool.query(
      `SELECT id FROM generic_entities WHERE entity_type = 'Company' AND id = $1 AND data->>'created_by' = $2 LIMIT 1`,
      [companyId, authedEmail]
    );
    return co.rows.length > 0;
  }

  if (pathname === '/api/chat/conversations' && req.method === 'GET') {
    try {
      const authedEmail = await getChatAuthedEmail(req);
      if (!authedEmail) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not authenticated' })); return; }
      const pool = prodDb.getPool();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const companyId = url.searchParams.get('company_id');
      if (!companyId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'company_id required' })); return; }
      const isMember = await verifyChatMembership(pool, authedEmail, companyId);
      if (!isMember) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a member of this company' })); return; }
      // Make sure the CompanySync Bot alerts Space exists as soon as
      // anyone opens Team Chat (posts a one-time welcome on creation).
      await chatBot.ensureAlertsSpaceEager(pool, companyId);
      const result = await pool.query(
        `SELECT c.*,
           COALESCE((
             SELECT COUNT(*) FROM chat_messages m
             WHERE m.conversation_id = c.id
               AND m.created_at > COALESCE(
                 (SELECT last_read_at FROM chat_read_receipts r WHERE r.user_email = $3 AND r.conversation_id = c.id),
                 '1970-01-01'::timestamp
               )
               AND m.sender_email != $3
           ), 0)::int AS unread_count
         FROM chat_conversations c
         WHERE c.company_id = $1
           AND (c.chat_type = 'broadcast' OR c.participants @> $2::jsonb OR c.created_by = $3)
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
        [companyId, JSON.stringify([{ email: authedEmail }]), authedEmail]
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ conversations: result.rows }));
    } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  if (pathname === '/api/chat/conversations' && req.method === 'POST') {
    try {
      const authedEmail = await getChatAuthedEmail(req);
      if (!authedEmail) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not authenticated' })); return; }
      const pool = prodDb.getPool();
      const body = JSON.parse(await readBody(req));
      const { company_id, chat_type, name, participants, avatar_url } = body;
      if (!company_id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'company_id required' })); return; }

      // Validate chat_type enum server-side — 'dm' is an alias for 'direct'; 'space' is a named multi-member room
      const requestedType = chat_type === 'dm' ? 'direct' : chat_type;
      const allowedTypes = ['direct', 'group', 'broadcast', 'space'];
      const resolvedType = allowedTypes.includes(requestedType) ? requestedType : 'direct';

      const isMember = await verifyChatMembership(pool, authedEmail, company_id);
      if (!isMember) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a member of this company' })); return; }

      // Validate that all participant emails belong to this company (staff_profiles or owner)
      // Normalise to objects [{email, name}] — this is the stored/query format used throughout
      const rawParticipants = Array.isArray(participants) ? participants : [];
      const participantObjects = rawParticipants.map(p =>
        typeof p === 'string' ? { email: p, name: p } : { email: p?.email || '', name: p?.name || p?.email || '' }
      ).filter(p => p.email);
      const participantEmails = participantObjects.map(p => p.email);

      // Lexi is a conversational teammate: allowed in a two-person direct
      // thread only, never as a Space member.
      if (!lexiTeamChat.isAllowedLexiConversationRequest(resolvedType, participantEmails)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Lexi can only be messaged in a one-to-one direct conversation' }));
        return;
      }

      if (participantEmails.length > 0) {
        // Fetch all valid staff, owner, subcontractor, and vendor emails for this company
        const [staffRows, ownerRow, subRows, vendorRows] = await Promise.all([
          pool.query(`SELECT user_email FROM staff_profiles WHERE company_id = $1`, [company_id]),
          pool.query(`SELECT data->>'created_by' AS owner_email FROM generic_entities WHERE entity_type = 'Company' AND id = $1 LIMIT 1`, [company_id]),
          pool.query(`SELECT data->>'email' AS email FROM generic_entities WHERE entity_type = 'Subcontractor' AND company_id = $1 AND data->>'email' IS NOT NULL`, [company_id]),
          pool.query(`SELECT data->>'email' AS email FROM generic_entities WHERE entity_type = 'Vendor' AND company_id = $1 AND data->>'email' IS NOT NULL`, [company_id]),
        ]);
        const validEmails = new Set(staffRows.rows.filter(r => r.user_email).map(r => r.user_email.toLowerCase()));
        if (ownerRow.rows[0]?.owner_email) validEmails.add(ownerRow.rows[0].owner_email.toLowerCase());
        subRows.rows.forEach(r => { if (r.email) validEmails.add(r.email.toLowerCase()); });
        vendorRows.rows.forEach(r => { if (r.email) validEmails.add(r.email.toLowerCase()); });
        validEmails.add(lexiTeamChat.LEXI_EMAIL);
        const invalid = participantEmails.filter(e => !validEmails.has(e.toLowerCase()));
        if (invalid.length > 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Participants not valid company members: ${invalid.join(', ')}` }));
          return;
        }
      }

      // Server-side DM dedupe: reuse the most-recently-active direct conversation
      // with the exact same participant set instead of creating a duplicate thread.
      if (resolvedType === 'direct' && participantObjects.length > 0) {
        const want = [...new Set(participantObjects.map(p => p.email.toLowerCase()))].sort();
        const existingRes = await pool.query(
          `SELECT * FROM chat_conversations WHERE company_id = $1 AND chat_type = 'direct' ORDER BY last_message_at DESC NULLS LAST, created_at DESC`,
          [company_id]
        );
        const match = existingRes.rows.find(c => {
          const emails = [...new Set((Array.isArray(c.participants) ? c.participants : []).map(p => (p?.email || '').toLowerCase()).filter(Boolean))].sort();
          return emails.length === want.length && emails.every((e, i) => e === want[i]);
        });
        if (match) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ conversation: match }));
          return;
        }
      }

      const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // creator is always the session user (ignore client-supplied created_by)
      // Store participants as [{email, name}] objects — required by all SQL @> containment queries
      await pool.query(
        `INSERT INTO chat_conversations (id, company_id, chat_type, name, participants, avatar_url, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
        [id, company_id, resolvedType, name || null, JSON.stringify(participantObjects), (typeof avatar_url === 'string' && avatar_url) ? avatar_url.slice(0, 2000) : null, authedEmail]
      );
      const result = await pool.query(`SELECT * FROM chat_conversations WHERE id = $1`, [id]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ conversation: result.rows[0] }));
    } catch (e) { replyError(res, e); }
    return;
  }

  // POST /api/chat/conversations/members — add/remove members of a space/group
  if (pathname === '/api/chat/conversations/members' && req.method === 'POST') {
    try {
      const authedEmail = await getChatAuthedEmail(req);
      if (!authedEmail) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not authenticated' })); return; }
      const pool = prodDb.getPool();
      const body = JSON.parse(await readBody(req));
      const { company_id, conversation_id, add, remove } = body;
      if (!company_id || !conversation_id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'conversation_id and company_id required' })); return; }
      const isMember = await verifyChatMembership(pool, authedEmail, company_id);
      if (!isMember) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a member of this company' })); return; }
      const convRes = await pool.query(
        `SELECT * FROM chat_conversations WHERE id = $1 AND company_id = $2`,
        [conversation_id, company_id]
      );
      const conv = convRes.rows[0];
      if (!conv) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Conversation not found' })); return; }
      if (conv.chat_type === 'direct') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Cannot manage members of a direct message' })); return; }
      if (String(conv.id).startsWith('conv_alerts_')) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'The alerts space is managed automatically' })); return; }
      const existingParticipants = Array.isArray(conv.participants) ? conv.participants : [];
      const isParticipant = existingParticipants.some(p => (p?.email || '').toLowerCase() === authedEmail.toLowerCase());
      if (!isParticipant && (conv.created_by || '').toLowerCase() !== authedEmail.toLowerCase()) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Access denied' })); return; }
      const normalizeMembers = (arr) => (Array.isArray(arr) ? arr : []).map(p =>
        typeof p === 'string' ? { email: p, name: p } : { email: p?.email || '', name: p?.name || p?.email || '' }
      ).filter(p => p.email);
      const addList = normalizeMembers(add);
      const removeEmails = new Set((Array.isArray(remove) ? remove : []).map(e => String(typeof e === 'string' ? e : e?.email || '').toLowerCase()).filter(Boolean));
      if (addList.length > 0) {
        const [staffRows, ownerRow, subRows, vendorRows] = await Promise.all([
          pool.query(`SELECT user_email FROM staff_profiles WHERE company_id = $1`, [company_id]),
          pool.query(`SELECT data->>'created_by' AS owner_email FROM generic_entities WHERE entity_type = 'Company' AND id = $1 LIMIT 1`, [company_id]),
          pool.query(`SELECT data->>'email' AS email FROM generic_entities WHERE entity_type = 'Subcontractor' AND company_id = $1 AND data->>'email' IS NOT NULL`, [company_id]),
          pool.query(`SELECT data->>'email' AS email FROM generic_entities WHERE entity_type = 'Vendor' AND company_id = $1 AND data->>'email' IS NOT NULL`, [company_id]),
        ]);
        const validEmails = new Set(staffRows.rows.filter(r => r.user_email).map(r => r.user_email.toLowerCase()));
        if (ownerRow.rows[0]?.owner_email) validEmails.add(ownerRow.rows[0].owner_email.toLowerCase());
        subRows.rows.forEach(r => { if (r.email) validEmails.add(r.email.toLowerCase()); });
        vendorRows.rows.forEach(r => { if (r.email) validEmails.add(r.email.toLowerCase()); });
        const invalid = addList.filter(p => !validEmails.has(p.email.toLowerCase()));
        if (invalid.length > 0) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Members not valid company members: ${invalid.map(p => p.email).join(', ')}` })); return; }
      }
      let updatedParticipants = existingParticipants.filter(p => !removeEmails.has((p?.email || '').toLowerCase()));
      for (const p of addList) {
        if (!updatedParticipants.some(x => (x?.email || '').toLowerCase() === p.email.toLowerCase())) updatedParticipants.push({ email: p.email, name: p.name });
      }
      await pool.query(
        `UPDATE chat_conversations SET participants = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
        [JSON.stringify(updatedParticipants), conversation_id, company_id]
      );
      const out = await pool.query(`SELECT * FROM chat_conversations WHERE id = $1`, [conversation_id]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ conversation: out.rows[0] }));
    } catch (e) { replyError(res, e); }
    return;
  }

  if (pathname === '/api/chat/messages' && req.method === 'GET') {
    try {
      const authedEmail = await getChatAuthedEmail(req);
      if (!authedEmail) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not authenticated' })); return; }
      const pool = prodDb.getPool();
      const url = new URL(req.url, `http://${req.headers.host}`);
      const conversationId = url.searchParams.get('conversation_id');
      const companyId = url.searchParams.get('company_id');
      const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '100') || 100), 200);
      if (!conversationId || !companyId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'conversation_id and company_id required' })); return; }
      // Verify company membership via session identity
      const isMember = await verifyChatMembership(pool, authedEmail, companyId);
      if (!isMember) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a member of this company' })); return; }
      // Verify conversation access — session user must be participant/creator or it's a broadcast
      const authCheck = await pool.query(
        `SELECT id FROM chat_conversations WHERE id = $1 AND company_id = $2
           AND (chat_type = 'broadcast' OR participants @> $3::jsonb OR created_by = $4)`,
        [conversationId, companyId, JSON.stringify([{ email: authedEmail }]), authedEmail]
      );
      if (authCheck.rows.length === 0) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Access denied' })); return; }
      const result = await pool.query(
        `SELECT * FROM (
           SELECT * FROM chat_messages WHERE conversation_id = $1 AND company_id = $2
           ORDER BY created_at DESC LIMIT $3
         ) sub ORDER BY created_at ASC`,
        [conversationId, companyId, limit]
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: result.rows }));
    } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  if (pathname === '/api/chat/messages' && req.method === 'POST') {
    try {
      const authedEmail = await getChatAuthedEmail(req);
      if (!authedEmail) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not authenticated' })); return; }
      const pool = prodDb.getPool();
      const body = JSON.parse(await readBody(req));
      const { company_id, conversation_id, sender_name, message, message_type, task_id, task_title, attachment_name } = body;
      if (!conversation_id || !message || !company_id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'conversation_id, message, and company_id required' })); return; }
      // Verify company membership
      const isMember = await verifyChatMembership(pool, authedEmail, company_id);
      if (!isMember) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a member of this company' })); return; }
      // Verify conversation access using session identity (authedEmail), not client-supplied sender
      const authCheck = await pool.query(
        `SELECT id FROM chat_conversations WHERE id = $1 AND company_id = $2
           AND (chat_type = 'broadcast' OR participants @> $3::jsonb OR created_by = $4)`,
        [conversation_id, company_id, JSON.stringify([{ email: authedEmail }]), authedEmail]
      );
      if (authCheck.rows.length === 0) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Access denied' })); return; }
      // Derive sender_name from staff_profiles (server-side, not client-supplied)
      let resolvedName = authedEmail;
      try {
        const staffRow = await pool.query(`SELECT full_name FROM staff_profiles WHERE company_id = $1 AND user_email = $2 LIMIT 1`, [company_id, authedEmail]);
        if (staffRow.rows[0]?.full_name) resolvedName = staffRow.rows[0].full_name;
      } catch (ne) { /* non-fatal */ }
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await pool.query(
        `INSERT INTO chat_messages (id, company_id, conversation_id, sender_email, sender_name, message, message_type, task_id, task_title, attachment_name, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
        [id, company_id, conversation_id, authedEmail, resolvedName, message, ['text','task_done','system','image','file','audio'].includes(message_type) ? message_type : 'text', task_id || null, task_title || null, (typeof attachment_name === 'string' && attachment_name) ? attachment_name.slice(0, 300) : null]
      );
      // Attachment messages store a URL in `message` — use a friendly
      // label for sidebar previews and notifications instead.
      const resolvedMsgType = ['text','task_done','system','image','file','audio'].includes(message_type) ? message_type : 'text';
      const previewText = resolvedMsgType === 'image' ? '📷 Photo'
        : resolvedMsgType === 'audio' ? '🎤 Voice message'
        : resolvedMsgType === 'file' ? ('📎 ' + ((typeof attachment_name === 'string' && attachment_name) ? attachment_name : 'Attachment')).slice(0, 80)
        : message;
      await pool.query(
        `UPDATE chat_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [previewText.length > 80 ? previewText.slice(0, 80) + '…' : previewText, conversation_id]
      );
      await pool.query(
        `INSERT INTO chat_read_receipts (user_email, conversation_id, last_read_at) VALUES ($1,$2,NOW())
         ON CONFLICT (user_email, conversation_id) DO UPDATE SET last_read_at = NOW()`,
        [authedEmail, conversation_id]
      );
      // Fire-and-forget: Lexi answers in her own direct thread. Her reply is
      // inserted with direct SQL (lib/lexiTeamChat.cjs) so it never re-enters
      // the email/SMS fan-out below.
      (async () => {
        try {
          const lexiConv = await pool.query('SELECT chat_type, participants FROM chat_conversations WHERE id = $1 AND company_id = $2', [conversation_id, company_id]);
          if (!lexiTeamChat.isLexiDirectConversation(lexiConv.rows[0])) return;
          if (resolvedMsgType !== 'text') return;
          await lexiTeamChat.handleLexiTeamChatTurn({
            pool,
            companyId: company_id,
            conversationId: conversation_id,
            userEmail: authedEmail,
            userName: resolvedName,
            text: message,
            // Same handler, same tools, same per-user access scoping as Lexi's
            // own page — the caller's session drives authz.
            invokeLexi: (lexiParams) => prodIntegrations.handleLexiChat(lexiParams, req),
          });
        } catch (lexiErr) { console.warn('[LexiTeamChat]', lexiErr.message); }
      })();
      // Fire-and-forget: email + SMS to other participants
      (async () => {
        try {
          const convRow = await pool.query('SELECT chat_type, participants FROM chat_conversations WHERE id = $1', [conversation_id]);
          const conv = convRow.rows[0];
          if (!conv) return;
          let participants = Array.isArray(conv.participants) ? conv.participants : [];
          // Broadcast/space conversations store participants as [] ("visible
          // to all staff") — resolve recipients from the company's active
          // staff so messages to an "everyone" space actually notify everyone.
          if (conv.chat_type === 'broadcast' || participants.length === 0) {
            const staffRows = await pool.query(
              `SELECT COALESCE(user_email, email) AS email FROM staff_profiles
                WHERE company_id = $1 AND COALESCE(is_active, true) = true
                  AND COALESCE(user_email, email) IS NOT NULL`,
              [company_id]
            );
            const seen = new Set();
            participants = staffRows.rows.filter(r => {
              const e = (r.email || '').toLowerCase();
              if (!e || !e.includes('@') || e.endsWith('@system') || seen.has(e)) return false;
              seen.add(e);
              return true;
            });
          }
          const appUrl = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';
          const quietHours = await getNotificationQuietHours(pool, company_id);
          const senderName = resolvedName;
          const preview = previewText.length > 120 ? previewText.slice(0, 120) + '…' : previewText;
          for (const p of participants) {
            if (!p.email || p.email.toLowerCase() === authedEmail.toLowerCase()) continue;
            // Internal chat identities (alert bot, Lexi) are addressable in
            // Team Chat but are not real mailboxes.
            if (lexiTeamChat.isSystemChatAddress(p.email)) continue;
            if (quietHours.active) {
              console.log(`[Chat notify] Deferred internal alert for ${p.email} until ${quietHours.deferredUntil}`);
              continue;
            }
            // Email notification
            const emailHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:20px"><div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.1)"><p style="margin:0 0 12px;color:#333;font-size:15px"><strong>${senderName}</strong> sent you a message in <strong>CompanySync Team Chat</strong>:</p><div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:8px;padding:12px 16px;margin:12px 0"><p style="margin:0;color:#1e40af;font-size:14px">${preview}</p></div><a href="${appUrl}/team-chat" style="display:inline-block;margin-top:16px;background:#2563eb;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Open Team Chat →</a></div></div>`;
            sendEmail({ to: p.email, subject: `${senderName}: ${preview.slice(0, 60)}`, html: emailHtml, companyId: company_id }).catch(e => console.warn('[Chat notify email]', e.message));
            // SMS notification
            try {
              const sRow = await pool.query('SELECT cell_phone FROM staff_profiles WHERE company_id = $1 AND LOWER(user_email) = LOWER($2) LIMIT 1', [company_id, p.email]);
              const phone = sRow.rows[0]?.cell_phone;
              if (phone) {
                const twSid = process.env.TWILIO_ACCOUNT_SID;
                const twAuth = process.env.TWILIO_AUTH_TOKEN;
                const twPhone = process.env.TWILIO_PHONE_NUMBER;
                if (twSid && twAuth && twPhone) {
                  fetch(`https://api.twilio.com/2010-04-01/Accounts/${twSid}/Messages.json`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${twSid}:${twAuth}`).toString('base64') },
                    body: new URLSearchParams({ To: phone, From: twPhone, Body: `CompanySync - ${senderName}: "${preview.slice(0, 100)}" Reply in app` })
                  }).catch(e => console.warn('[Chat notify SMS]', e.message));
                }
              }
            } catch (_) {}
          }
        } catch (notifyErr) { console.warn('[Chat notify]', notifyErr.message); }
      })();
      const result = await pool.query(`SELECT * FROM chat_messages WHERE id = $1`, [id]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: result.rows[0] }));
    } catch (e) { replyError(res, e); }
    return;
  }

  if (pathname === '/api/chat/reactions' && req.method === 'POST') {
    try {
      const authedEmail = await getChatAuthedEmail(req);
      if (!authedEmail) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not authenticated' })); return; }
      const pool = prodDb.getPool();
      const body = JSON.parse(await readBody(req));
      const { message_id, emoji, company_id } = body;
      if (!message_id || !emoji || !company_id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'message_id, emoji, company_id required' })); return; }
      const isMember = await verifyChatMembership(pool, authedEmail, company_id);
      if (!isMember) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a member' })); return; }
      const { rows } = await pool.query('SELECT reactions FROM chat_messages WHERE id = $1 AND company_id = $2', [message_id, company_id]);
      if (!rows[0]) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Message not found' })); return; }
      const current = rows[0].reactions || {};
      const users = current[emoji] ? [...current[emoji]] : [];
      const idx = users.indexOf(authedEmail);
      if (idx >= 0) users.splice(idx, 1); else users.push(authedEmail);
      if (users.length === 0) delete current[emoji]; else current[emoji] = users;
      await pool.query('UPDATE chat_messages SET reactions = $1 WHERE id = $2', [JSON.stringify(current), message_id]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reactions: current }));
    } catch (e) { replyError(res, e); }
    return;
  }

  if (pathname === '/api/chat/read' && req.method === 'POST') {
    try {
      const authedEmail = await getChatAuthedEmail(req);
      if (!authedEmail) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not authenticated' })); return; }
      const pool = prodDb.getPool();
      const body = JSON.parse(await readBody(req));
      const { conversation_id, company_id } = body;
      if (!conversation_id || !company_id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'conversation_id and company_id required' })); return; }
      // Verify membership before updating read receipt
      const isMember = await verifyChatMembership(pool, authedEmail, company_id);
      if (!isMember) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a member of this company' })); return; }
      const convCheck = await pool.query(
        `SELECT id FROM chat_conversations WHERE id = $1 AND company_id = $2
           AND (chat_type = 'broadcast' OR participants @> $3::jsonb OR created_by = $4)`,
        [conversation_id, company_id, JSON.stringify([{ email: authedEmail }]), authedEmail]
      );
      if (convCheck.rows.length === 0) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Access denied' })); return; }
      await pool.query(
        `INSERT INTO chat_read_receipts (user_email, conversation_id, last_read_at) VALUES ($1,$2,NOW())
         ON CONFLICT (user_email, conversation_id) DO UPDATE SET last_read_at = NOW()`,
        [authedEmail, conversation_id]
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) { replyError(res, e); }
    return;
  }
  // ───────────────────────────────────────────────────────────────────────────

  if (req.method === 'OPTIONS' && pathname.startsWith('/api/integrations/')) {
    setCorsHeaders(res, req);
    res.writeHead(200);
    res.end();
    return;
  }

  if (pathname.startsWith('/uploads/')) {
    if (await prodIntegrations.serveUploadedFile(req, res, pathname)) return;
    // File not found in disk or DB — return proper 404, not the SPA
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File not found' }));
    return;
  }

  // Legacy object-storage URLs (e.g. /replit-objstore-xxx/public/crew_abc.jpg)
  // were written before the URL fix — proxy them via serveUploadedFile so
  // existing photos in the DB still load correctly.
  if (pathname.match(/^\/replit-objstore-[^/]+\/[^/]+\/(.+)$/)) {
    const fileName = pathname.split('/').pop();
    if (await prodIntegrations.serveUploadedFile(req, res, `/uploads/${fileName}`)) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File not found' }));
    return;
  }

  if (pathname === '/api/public/customer' && req.method === 'GET') {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const customerId = urlObj.searchParams.get('id');
    if (!customerId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'id required' }));
      return;
    }
    try {
      const pool = prodDb.getPool();
      const result = await pool.query('SELECT * FROM customers WHERE id = $1 LIMIT 1', [customerId]);
      if (result.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Customer not found' }));
        return;
      }
      const c = result.rows[0];
      const safe = { id: c.id, name: c.name, email: c.email, phone: c.phone, street: c.street, city: c.city, state: c.state, zip: c.zip, company_id: c.company_id };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ success: true, customer: safe }));
    } catch (err) {
      console.error('[Public API] Customer lookup error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error' }));
    }
    return;
  }

  // GET /api/public/color-viz — public share link for color visualizations
  if (pathname === '/api/public/color-viz' && req.method === 'GET') {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const urlObj2 = new URL(req.url, `http://${req.headers.host}`);
    const cvId   = urlObj2.searchParams.get('id');
    const cvType = urlObj2.searchParams.get('type') || 'Customer';
    const cvTok  = urlObj2.searchParams.get('t');
    function cvJson(status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
    if (!cvId || !cvTok) { cvJson(400, { error: 'id and t required' }); return; }
    const cryptoMod = require('crypto');
    const secret = process.env.SESSION_SECRET || '';
    const expected = secret ? cryptoMod.createHmac('sha256', secret).update('colorviz:' + cvId).digest('base64url') : '';
    if (!expected || expected !== cvTok) { cvJson(403, { error: 'Invalid or expired link' }); return; }
    try {
      const pool = prodDb.getPool();
      const cvTable = cvType === 'Lead' ? 'leads' : 'customers';
      const cvRow = await pool.query(`SELECT name, company_id, data FROM ${cvTable} WHERE id=$1 LIMIT 1`, [cvId]);
      if (!cvRow.rows[0]) { cvJson(404, { error: 'Not found' }); return; }
      const ent = cvRow.rows[0];
      const entData = typeof ent.data === 'string' ? JSON.parse(ent.data) : (ent.data || {});
      const compRow = await pool.query('SELECT name FROM companies WHERE id=$1 LIMIT 1', [ent.company_id]);
      const companyName = compRow.rows[0]?.name || 'Your Contractor';
      const usedCount = parseInt(entData.color_viz_public_uses, 10) || 0;
      cvJson(200, {
        success: true,
        name: ent.name,
        companyName,
        visualizations: entData.color_visualizations || [],
        sourcePhoto: entData.color_viz_source_photo || null,
        usesRemaining: Math.max(10 - usedCount, 0),
      });
    } catch (err) {
      console.error('[PublicColorViz] Error:', err.message);
      cvJson(500, { error: 'Server error' });
    }
    return;
  }

  // ── Public: proof-package JSON + PDF (no auth required) ────────────────────
  if (pathname.startsWith('/api/public/proof-package/') && req.method === 'GET') {
    const ppJson = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(body));
    };
    try {
      const ppParts = pathname.split('/');
      const ppHash = ppParts[4];
      const isPdf = ppParts[5] === 'pdf';
      if (!ppHash) { ppJson(400, { error: 'Missing hash' }); return; }

      const pool = prodDb.getPool();
      const pkgRes = await pool.query(
        `SELECT id, data, company_id FROM generic_entities WHERE entity_type = 'ProofPackage' AND data->>'hash' = $1 LIMIT 1`,
        [ppHash]
      );
      if (!pkgRes.rows.length) { ppJson(404, { error: 'Package not found' }); return; }

      const pkg = pkgRes.rows[0].data;
      if (!isPdf && !pkg.viewed_at) {
        await pool.query(
          `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{viewed_at}', $1::jsonb), updated_date = NOW() WHERE id = $2`,
          [JSON.stringify(new Date().toISOString()), pkgRes.rows[0].id]
        );
      }

      let job = {};
      if (pkg.inspection_job_id) {
        const jobRes = await pool.query(`SELECT data FROM generic_entities WHERE id = $1 AND entity_type = 'InspectionJob' LIMIT 1`, [pkg.inspection_job_id]);
        job = jobRes.rows[0]?.data || {};
      }
      // Companies live in the dedicated `companies` table, not generic_entities
      let company = {};
      const ppCoId = pkg.company_id || pkgRes.rows[0].company_id;
      if (ppCoId && ppCoId !== 'unknown') {
        const coRes = await pool.query(`SELECT * FROM companies WHERE id = $1 LIMIT 1`, [ppCoId]);
        if (coRes.rows.length > 0) {
          const crow = coRes.rows[0];
          const cs = typeof crow.settings === 'string' ? JSON.parse(crow.settings) : (crow.settings || {});
          const cd = typeof crow.data === 'object' && crow.data ? crow.data : {};
          company = { ...cd, ...cs, ...crow };
        }
      }
      let photos = [];
      if (pkg.inspection_job_id) {
        const mediaRes = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'JobMedia'
            AND (data->>'related_entity_id' = $1 OR data->>'job_id' = $1)
            ORDER BY created_date`,
          [pkg.inspection_job_id]
        );
        photos = mediaRes.rows.map(r => r.data).filter(m => m && m.file_type === 'photo');
        if (!pkg.include_annotations) photos = photos.map(p => ({ ...p, annotated_url: null }));
      }

      if (isPdf) {
        const { jsPDF } = await import('jspdf');
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
        const W = 215.9, H = 279.4, margin = 15, inner = W - 2 * margin;
        const fetchImgBase64 = async (url) => {
          if (!url) return null;
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 6000);
            const resp = await fetch(url, { signal: ctrl.signal });
            clearTimeout(t);
            if (!resp.ok) return null;
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let mime = 'JPEG';
            if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = 'PNG';
            else if (bytes[0] === 0x47 && bytes[1] === 0x49) mime = 'GIF';
            return { b64: Buffer.from(buf).toString('base64'), mime };
          } catch { return null; }
        };
        const analyzed = photos.filter(p => p.ai_analysis);
        const totalHail = analyzed.reduce((s, p) => s + (p.ai_analysis?.hail_impact_count || 0), 0);
        const totalWind = analyzed.reduce((s, p) => s + (p.ai_analysis?.wind_damage_count || 0), 0);
        const severities = analyzed.map(p => p.ai_analysis?.severity_level).filter(Boolean);
        const overallSev = severities.includes('Severe') ? 'Severe' : severities.includes('Moderate') ? 'Moderate' : severities.includes('Minor') ? 'Minor' : 'N/A';
        const verdicts = analyzed.map(p => p.ai_analysis?.coverage_verdict).filter(Boolean);
        const dominantVerdict = verdicts.includes('covered') ? 'Covered' : verdicts.includes('mixed') ? 'Mixed' : verdicts.length ? 'Not Covered' : 'N/A';
        // Cover page
        doc.setFillColor(30, 58, 138); doc.rect(0, 0, W, 55, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
        doc.text(company?.company_name || 'Inspection Report', margin, 25);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
        doc.text('Damage Evidence Report', margin, 34);
        if (company?.phone) doc.text(company.phone, margin, 42);
        doc.setTextColor(0, 0, 0);
        let y = 70;
        doc.setFontSize(18); doc.setFont('helvetica', 'bold');
        const ppAddr = job?.property_address || pkg.property_address || 'Property Inspection';
        const addrLines = doc.splitTextToSize(ppAddr, inner);
        doc.text(addrLines, margin, y); y += addrLines.length * 7 + 4;
        if (job?.client_name || pkg.client_name) {
          doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
          doc.text(`Client: ${job?.client_name || pkg.client_name}`, margin, y); y += 7;
        }
        if (pkg.created_at) {
          doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80);
          doc.text(`Date: ${new Date(pkg.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, margin, y); y += 10;
        }
        doc.setTextColor(0, 0, 0);
        y = Math.max(y, 110);
        const ppStats = [
          { label: 'Total Photos', val: String(photos.length) }, { label: 'AI Analyzed', val: String(analyzed.length) },
          { label: 'Hail Impacts', val: String(totalHail) }, { label: 'Wind Damage', val: String(totalWind) },
          { label: 'Overall Severity', val: overallSev }, { label: 'Coverage', val: dominantVerdict },
        ];
        const cellW = inner / 3, cellH = 20;
        ppStats.forEach((st, i) => {
          const col = i % 3, row = Math.floor(i / 3);
          const sx = margin + col * cellW, sy = y + row * (cellH + 4);
          doc.setFillColor(245, 247, 255); doc.setDrawColor(200, 210, 240);
          doc.roundedRect(sx, sy, cellW - 2, cellH, 2, 2, 'FD');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(30, 58, 138);
          doc.text(st.val, sx + (cellW - 2) / 2, sy + 9, { align: 'center' });
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
          doc.text(st.label, sx + (cellW - 2) / 2, sy + 16, { align: 'center' });
        });
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9); doc.setTextColor(150, 150, 150);
        doc.text('AI-assisted damage documentation for insurance claim support', W / 2, H - 12, { align: 'center' });
        doc.text(`Generated ${new Date().toLocaleDateString()}`, W / 2, H - 7, { align: 'center' });
        doc.setTextColor(0, 0, 0);
        // Photo pages
        const sectionMap = {};
        photos.forEach(p => { const s = p.section || 'Other'; if (!sectionMap[s]) sectionMap[s] = []; sectionMap[s].push(p); });
        const addFooter = () => {
          doc.setFontSize(8); doc.setTextColor(150, 150, 150);
          doc.text(company?.company_name || '', margin, H - 8);
          doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, W - margin, H - 8, { align: 'right' });
          doc.setTextColor(0, 0, 0);
        };
        // ── Watermark data — fetched once, applied to every photo ──────────────
        const wmCompany = company?.company_name || '';
        const wmDateStr = (() => {
          const ds = job?.inspection_date || pkg.created_at;
          if (!ds) return '';
          try { return new Date(ds).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; }
        })();
        const logoData = company?.logo_url ? await fetchImgBase64(company.logo_url) : null;
        for (const [section, sPhotos] of Object.entries(sectionMap)) {
          doc.addPage(); addFooter();
          let py = margin;
          doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(30, 58, 138);
          doc.text(section, margin, py); py += 8;
          doc.setDrawColor(30, 58, 138); doc.setLineWidth(0.5); doc.line(margin, py, W - margin, py); py += 6;
          doc.setTextColor(0, 0, 0);
          const photoW = (inner - 6) / 2, photoH = photoW * 0.70;
          let col = 0;
          for (const photo of sPhotos) {
            if (py + photoH + 22 > H - 18) { doc.addPage(); addFooter(); py = margin; col = 0; }
            const px = margin + col * (photoW + 6);
            const imgData = await fetchImgBase64(photo.annotated_url || photo.file_url);
            if (imgData) { try { doc.addImage(imgData.b64, imgData.mime, px, py, photoW, photoH); } catch {} }
            else {
              doc.setFillColor(230, 230, 230); doc.rect(px, py, photoW, photoH, 'F');
              doc.setFontSize(8); doc.setTextColor(150, 150, 150);
              doc.text('Image unavailable', px + photoW / 2, py + photoH / 2, { align: 'center' });
              doc.setTextColor(0, 0, 0);
            }
            // ── Attribution watermark ─────────────────────────────────────────
            {
              const stripH = 5.5;
              doc.setFillColor(20, 30, 60);
              doc.rect(px, py + photoH - stripH, photoW, stripH, 'F');
              doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(255, 255, 255);
              const wmText = [wmCompany, wmDateStr].filter(Boolean).join('  |  ');
              if (wmText) doc.text(wmText, px + 2, py + photoH - 1.5);
              doc.setTextColor(0, 0, 0);
            }
            // ── Logo badge (top-right corner) ─────────────────────────────────
            if (logoData) {
              const badgeW = 16, badgeH = 10;
              const bx = px + photoW - badgeW - 1.5, by = py + 1.5;
              doc.setFillColor(255, 255, 255); doc.roundedRect(bx, by, badgeW, badgeH, 1, 1, 'F');
              try { doc.addImage(logoData.b64, logoData.mime, bx + 1, by + 1, badgeW - 2, badgeH - 2, undefined, 'FAST'); } catch {}
            }
            let captionY = py + photoH + 4;
            if (photo.caption) {
              doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
              const capLines = doc.splitTextToSize(photo.caption, photoW);
              doc.text(capLines, px, captionY); captionY += capLines.length * 4;
            }
            const ai = photo.ai_analysis;
            if (ai?.severity_level) {
              const sevColor = ai.severity_level === 'Severe' ? [220, 50, 50] : ai.severity_level === 'Moderate' ? [217, 119, 6] : [161, 140, 22];
              doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...sevColor);
              const parts = [ai.severity_level];
              if (ai.hail_impact_count > 0) parts.push(`${ai.hail_impact_count} Hail`);
              if (ai.wind_damage_count > 0) parts.push(`${ai.wind_damage_count} Wind`);
              doc.text(parts.join('  ·  '), px, captionY); doc.setTextColor(0, 0, 0);
            }
            col++;
            if (col === 2) { col = 0; py += photoH + (photo.caption || photo.ai_analysis ? 22 : 10); }
          }
        }
        const pdfBytes = doc.output('arraybuffer');
        const safeName = ppAddr.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').slice(0, 40).toLowerCase();
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        });
        res.end(Buffer.from(pdfBytes));
        return;
      }

      ppJson(200, { job, photos, company, created_at: pkg.created_at, xactimate_pdf_url: pkg.include_xactimate ? pkg.xactimate_pdf_url : null, storm_events: pkg.storm_events || [] });
    } catch (ppErr) {
      console.error('[publicProofPackage] Error:', ppErr.message);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: ppErr.message }));
    }
    return;
  }

  // POST /api/portal/send-portal-link (authenticated staff action)
  if (pathname === '/api/portal/send-portal-link' && req.method === 'POST') {
    setCorsHeaders(res, req);
    const sessionEmail = req.session?.email;
    if (!sessionEmail) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    try {
      const rawBody = await readBody(req);
      const { customer_id, method } = JSON.parse(rawBody);
      if (!customer_id) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'customer_id required' })); return; }
      const pool = prodDb.getPool();
      const staffRes = await pool.query(`SELECT company_id FROM staff_profiles WHERE user_email = $1 LIMIT 1`, [sessionEmail]);
      const company_id = staffRes.rows[0]?.company_id;
      if (!company_id) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not authorized' })); return; }
      const custRes = await pool.query(`SELECT id, name, email, phone, company_id, portal_token FROM customers WHERE id = $1 AND company_id = $2 LIMIT 1`, [customer_id, company_id]);
      if (!custRes.rows.length) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Customer not found' })); return; }
      const cust = custRes.rows[0];
      let tok = cust.portal_token;
      if (!tok) {
        tok = crypto.randomUUID();
        await pool.query(`UPDATE customers SET portal_token = $1 WHERE id = $2`, [tok, cust.id]);
      }
      const portalUrl = `${getAppUrl()}/CustomerPortalPublic?token=${encodeURIComponent(tok)}`;
      const custName = cust.name || 'there';
      const smsMsg = `Hi ${custName}! Here's your private project portal — track your claim status, project progress, and documents: ${portalUrl}`;
      const emailHtml = `<div style="font-family:Arial,sans-serif;color:#333;max-width:600px"><h2 style="color:#2563eb">Your Project Portal</h2><p>Hi ${custName},</p><p>Click below to view your private project portal where you can track your claim status, see project milestones, and stay up to date.</p><p style="margin:24px 0"><a href="${portalUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">View My Portal</a></p><p style="font-size:12px;color:#888">Or copy this link: ${portalUrl}</p></div>`;
      let smsSent = false, emailSent = false;
      const { functionHandlers } = require('./db/prod-integrations.cjs');
      if ((method === 'sms' || method === 'both') && cust.phone) {
        try { await functionHandlers.sendSMS({ to: cust.phone, message: smsMsg, companyId: company_id }); smsSent = true; }
        catch (e) { console.warn('[send-portal-link] SMS failed:', e.message); }
      }
      if ((method === 'email' || method === 'both') && cust.email) {
        try { await functionHandlers.sendViaResend({ to: cust.email, subject: 'Your Project Portal Link', html: emailHtml, company_id }); emailSent = true; }
        catch (e) { console.warn('[send-portal-link] Email failed:', e.message); }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, sms_sent: smsSent, email_sent: emailSent, portal_url: portalUrl }));
    } catch (err) {
      console.error('[send-portal-link] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error' }));
    }
    return;
  }

  // ── Homeowner Portal API ─────────────────────────────────────────────────────
  if (pathname.startsWith('/api/public/portal') || pathname === '/api/public/crew-photos' || (pathname.startsWith('/api/projects/') && (pathname.includes('/log') || pathname.includes('/milestone') || pathname.includes('/photos')))) {
    setCorsHeaders(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const { getMilestones, getMilestoneLabel, ALERT_KEYWORDS } = require('./lib/projectMilestones.cjs');
    const pool = prodDb.getPool();

    function portalJson(status, data) {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    }

    // GET /api/public/portal/invoice-payment-status
    // The Checkout Session id is an opaque Stripe-issued capability. Validate
    // its server-set metadata before exposing whether the matching CRM payment
    // has actually been recorded.
    if (pathname === '/api/public/portal/invoice-payment-status' && req.method === 'GET') {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const sessionId = urlObj.searchParams.get('session_id');
        const invoiceId = urlObj.searchParams.get('invoice_id');
        if (!sessionId || !invoiceId || !sessionId.startsWith('cs_')) {
          portalJson(400, { status: 'error', error: 'Invalid payment reference' });
          return;
        }
        const stripe = await getStripeClientProd();
        if (!stripe) throw new Error('Online payment service unavailable');
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.metadata?.invoice_id !== invoiceId) {
          portalJson(403, { status: 'error', error: 'Payment reference does not match invoice' });
          return;
        }
        const invRes = await pool.query(
          `SELECT id, company_id FROM invoices WHERE id=$1 LIMIT 1`,
          [invoiceId]
        );
        const invoice = invRes.rows[0];
        if (!invoice || (session.metadata?.company_id && session.metadata.company_id !== invoice.company_id)) {
          portalJson(403, { status: 'error', error: 'Invoice ownership check failed' });
          return;
        }
        const paymentRef = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id || session.id;
        let paymentRes = await pool.query(
          `SELECT status FROM payments WHERE invoice_id=$1 AND company_id=$2 AND reference_number=$3 ORDER BY updated_at DESC LIMIT 1`,
          [invoiceId, invoice.company_id, paymentRef]
        );
        // Do not leave a paid card checkout in "Confirming Payment" when a
        // webhook was delayed or failed after Stripe accepted it. The direct
        // Stripe lookup above is authoritative and the recovery helper is
        // idempotent on paymentRef.
        if (!paymentRes.rows[0] && session.status === 'complete' && session.payment_status === 'paid') {
          await reconcileCompletedInvoiceCheckout(pool, session);
          paymentRes = await pool.query(
            `SELECT status FROM payments WHERE invoice_id=$1 AND company_id=$2 AND reference_number=$3 ORDER BY updated_at DESC LIMIT 1`,
            [invoiceId, invoice.company_id, paymentRef]
          );
        }
        const crmStatus = paymentRes.rows[0]?.status;
        const confirmed = crmStatus === 'completed';
        const achPending = crmStatus === 'ach_pending' ||
          (session.status === 'complete' && session.payment_status === 'unpaid');
        portalJson(200, {
          status: confirmed ? 'confirmed' : achPending ? 'ach_pending' : 'processing',
          stripe_status: session.payment_status || null,
          recorded: Boolean(crmStatus),
        });
      } catch (err) {
        console.warn('[PortalInvoicePaymentStatus]', err?.message || err);
        portalJson(400, { status: 'error', error: 'Unable to verify payment status' });
      }
      return;
    }

    // POST /api/public/portal/invoice-checkout — token-gated invoice payment
    // This must stay outside the authenticated function route: homeowners do
    // not have staff sessions, but the Stripe handler still verifies the
    // opaque portal token and invoice/customer/company ownership.
    if (pathname === '/api/public/portal/invoice-checkout' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req, 64 * 1024));
        const handlers = await prodIntegrations.getFunctionHandlers();
        if (typeof handlers.createPublicInvoiceCheckout !== 'function') {
          throw new Error('Online payment service unavailable');
        }
        const result = await handlers.createPublicInvoiceCheckout({
          token: body.token,
          invoice_id: body.invoice_id,
        });
        portalJson(200, result);
      } catch (err) {
        const message = err?.message || 'Unable to start payment';
        const status = /Invalid|not found|access/i.test(message) ? 403 : 400;
        console.warn('[PortalInvoiceCheckout]', message);
        portalJson(status, { success: false, error: message });
      }
      return;
    }

    // GET /api/public/portal?token=<uuid>
    if (pathname === '/api/public/portal' && req.method === 'GET') {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const token = urlObj.searchParams.get('token');
        if (!token) { portalJson(400, { error: 'token required' }); return; }
        // Resolve customer strictly by portal_token — never by id (opaque token gate)
        const custRes = await pool.query(`SELECT id, name, email, phone, street, city, state, zip, company_id, portal_token, insurance_company, claim_number, adjuster_name, adjuster_phone FROM customers WHERE portal_token = $1 LIMIT 1`, [token]);
        if (custRes.rows.length === 0) { portalJson(404, { error: 'Invalid portal link' }); return; }
        const c = custRes.rows[0];
        const safeCustomer = { id: c.id, name: c.name, email: c.email, phone: c.phone, street: c.street, city: c.city, state: c.state, zip: c.zip };
        // Exact customer-ID linkage only; names are never used as a fallback.
        const projRes = await pool.query(
          `SELECT id, title, status, project_type, current_milestone, address, description, assigned_to, data FROM projects WHERE company_id = $1 AND COALESCE(NULLIF(related_customer_id, ''), NULLIF(data->>'related_customer_id', ''), NULLIF(customer_id, ''), NULLIF(data->>'customer_id', '')) = $2 AND status != 'cancelled' ORDER BY created_at DESC`,
          [c.company_id, c.id]
        );
        const projects = projRes.rows;
        const projectIds = projects.map(p => p.id);
        let logs = [];
        let photos = [];
        if (projectIds.length > 0) {
          const logsRes = await pool.query(
            `SELECT id, project_id, author_role, author_name, content_body, created_at FROM project_logs WHERE project_id = ANY($1) AND is_public = true ORDER BY created_at DESC LIMIT 50`,
            [projectIds]
          );
          logs = logsRes.rows;
          const photosRes = await pool.query(
            `SELECT pp.id, pp.project_id, pp.photo_url, pp.caption, pp.milestone, pp.is_public, pp.uploaded_by, pp.created_at
             FROM project_photos pp
             WHERE pp.company_id = $2 AND pp.project_id = ANY($1::text[])
               AND (pp.is_public = true OR pp.uploaded_by LIKE 'homeowner:%')
               AND EXISTS (
                 SELECT 1 FROM projects p
                 WHERE p.id = pp.project_id AND p.company_id = $2
                   AND COALESCE(NULLIF(p.related_customer_id, ''), NULLIF(p.data->>'related_customer_id', ''), NULLIF(p.customer_id, ''), NULLIF(p.data->>'customer_id', '')) = $3
                   AND p.status != 'cancelled'
               )
               AND (
                 pp.source_media_id IS NULL
                 OR pp.source_customer_id = $3
                 OR (pp.source_customer_id IS NULL AND EXISTS (
                   SELECT 1 FROM generic_entities legacy_media
                   WHERE legacy_media.id = pp.source_media_id
                     AND legacy_media.entity_type = 'JobMedia'
                     AND legacy_media.company_id = $2
                     AND legacy_media.data->>'related_entity_type' = 'Customer'
                     AND legacy_media.data->>'related_entity_id' = $3
                     AND legacy_media.data->>'source' IN ('crew_upload', 'whatsapp_upload')
                 ))
               )
             ORDER BY pp.created_at DESC`,
            [projectIds, c.company_id, c.id]
          );
          photos = photosRes.rows;
        }
        let pm = null;
        if (projects.length > 0) {
          const pmEmail = projects[0].assigned_to || projects[0].data?.assigned_to;
          if (pmEmail) {
            const pmRes = await pool.query(`SELECT full_name, cell_phone, email, twilio_number FROM staff_profiles WHERE company_id = $1 AND (user_email = $2 OR email = $2) LIMIT 1`, [c.company_id, pmEmail]);
            if (pmRes.rows.length > 0) pm = pmRes.rows[0];
          }
        }
        // Whitelist safe public-facing fields only — never expose projects.data or internal CRM fields
        const enriched = projects.map(p => ({
          id: p.id,
          title: p.title,
          status: p.status,
          project_type: p.project_type,
          current_milestone: p.current_milestone,
          address: p.address,
          description: p.description,
          milestones: getMilestones(p.project_type),
        }));
        // Claim info — all customer-owned data, safe to expose on their own portal
        const claim = {
          insurance_company: c.insurance_company || null,
          claim_number: c.claim_number || null,
          adjuster_name: c.adjuster_name || null,
          adjuster_phone: c.adjuster_phone || null,
          contract_status: null,
          contract_signed_at: null,
          rep_signed_at: null,
        };
        try {
          const sessRes = await pool.query(
            `SELECT status, customer_signed_at, rep_signed_at FROM signing_sessions WHERE company_id = $1 AND (customer_name ILIKE $2 OR customer_email = $3) ORDER BY created_at DESC LIMIT 1`,
            [c.company_id, c.name, c.email || '']
          );
          if (sessRes.rows.length > 0) {
            claim.contract_status = sessRes.rows[0].status;
            claim.contract_signed_at = sessRes.rows[0].customer_signed_at;
            claim.rep_signed_at = sessRes.rows[0].rep_signed_at;
          }
        } catch (_) {}
        let payment_options = {};
        try {
          const settingsRes = await pool.query(
            `SELECT data FROM generic_entities
             WHERE entity_type = 'CompanySetting' AND company_id = $1
             ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
            [c.company_id]
          );
          const raw = settingsRes.rows[0]?.data;
          const settings = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
          for (const key of ['zelle_email', 'cashapp_handle', 'venmo_handle', 'check_payment_instructions', 'cash_payment_instructions']) {
            if (typeof settings[key] === 'string' && settings[key].trim()) {
              payment_options[key] = settings[key].trim();
            }
          }
        } catch (settingsErr) {
          console.warn('[PortalAPI] Payment settings unavailable:', settingsErr.message);
        }
        portalJson(200, { success: true, customer: safeCustomer, projects: enriched, logs, photos, pm, claim, payment_options });
      } catch (err) {
        console.error('[PortalAPI] GET error:', err.message);
        if (err?.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }

    // POST /api/public/portal/photo — homeowner uploads a photo (JSON base64 or multipart)
    if (pathname === '/api/public/portal/photo' && req.method === 'POST') {
      try {
        const contentType = req.headers['content-type'] || '';
        let token, project_id, caption, buffer, mimeType;
        if (contentType.includes('multipart/form-data')) {
          const rawBuf = await readBodyBuffer(req);
          const parts = parseMultipartPortal(rawBuf, contentType);
          if (!parts) { portalJson(400, { error: 'Invalid multipart body' }); return; }
          const field = (name) => parts.find(p => p.name === name && !p.filename)?.data?.toString('utf8')?.trim();
          const filePart = parts.find(p => p.filename);
          token = field('token');
          project_id = field('project_id');
          caption = field('caption') || null;
          if (!filePart) { portalJson(400, { error: 'No file part in multipart upload' }); return; }
          buffer = filePart.data;
          mimeType = (filePart.contentType || 'image/jpeg').toLowerCase();
        } else {
          const body = JSON.parse(await readBody(req, 30 * 1024 * 1024));
          token = body.token;
          project_id = body.project_id;
          caption = body.caption || null;
          const photo_base64 = body.photo_base64;
          const mime_type = body.mime_type;
          if (!photo_base64) { portalJson(400, { error: 'token, project_id and photo_base64 required' }); return; }
          mimeType = (mime_type || 'image/jpeg').toLowerCase();
          buffer = Buffer.from(photo_base64, 'base64');
        }
        if (!token || !project_id) { portalJson(400, { error: 'token and project_id required' }); return; }
        if (buffer.length > 20 * 1024 * 1024) { portalJson(400, { error: 'Photo exceeds 20 MB limit' }); return; }
        const custRes = await pool.query(`SELECT id, name, company_id FROM customers WHERE portal_token = $1 LIMIT 1`, [token]);
        if (custRes.rows.length === 0) { portalJson(403, { error: 'Invalid token' }); return; }
        const c = custRes.rows[0];
        const projRes = await pool.query(`SELECT id, assigned_to, address, data FROM projects WHERE id = $1 AND company_id = $2 AND COALESCE(NULLIF(related_customer_id, ''), NULLIF(data->>'related_customer_id', ''), NULLIF(customer_id, ''), NULLIF(data->>'customer_id', '')) = $3 LIMIT 1`, [project_id, c.company_id, c.id]);
        if (projRes.rows.length === 0) { portalJson(403, { error: 'Invalid project' }); return; }
        const proj = projRes.rows[0];
        const extMap = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };
        const ext = extMap[mimeType] || '.jpg';
        const { randomUUID } = require('crypto');
        const uniqueName = `${randomUUID()}${ext}`;
        const photoUrl = `/uploads/${uniqueName}`;
        try {
          const objStorage = require('./db/object-storage.cjs');
          await objStorage.uploadToObjectStorage(uniqueName, buffer, mimeType);
        } catch (osErr) {
          console.warn('[PortalPhoto] Object storage upload failed, using local disk:', osErr.message);
        }
        try {
          const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
          fs.writeFileSync(path.join(uploadsDir, uniqueName), buffer);
        } catch (diskErr) {
          console.warn('[PortalPhoto] Disk save failed:', diskErr.message);
        }
        const photoId = `pphoto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await pool.query(
          `INSERT INTO project_photos (id, project_id, company_id, photo_url, caption, milestone, is_public, uploaded_by, created_at) VALUES ($1,$2,$3,$4,$5,NULL,false,$6,NOW())`,
          [photoId, project_id, c.company_id, photoUrl, caption || null, `homeowner:${c.name}`]
        );
        console.log(`[PortalPhoto] Homeowner ${c.name} uploaded photo ${uniqueName} for project ${project_id}`);
        // Notify PM (or admin fallback) about homeowner photo upload (fire-and-forget)
        const pmEmail = proj.assigned_to || proj.data?.assigned_to;
        const notifyPhotoRecipient = async (recipientEmail, channels) => {
          const sendEmailChan = channels?.email !== false;
          const sendSmsChan = channels?.sms !== false;
          const addr = proj.address || 'your project';
          const projectLink = `${process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com'}/projects/${project_id}?tab=photos`;
          let brandColor = '#2563eb';
          try {
            const brandRes = await pool.query(`SELECT data->>'brand_primary_color' AS brand_primary_color FROM companies WHERE id = $1 LIMIT 1`, [c.company_id]);
            const bc = brandRes.rows[0]?.brand_primary_color;
            if (bc && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(bc)) brandColor = bc;
          } catch (brandErr) {
            console.warn('[PortalPhoto] Failed to fetch brand color:', brandErr.message);
          }
          if (sendEmailChan) {
            let emailSubject = `📸 New Photo Uploaded: ${addr}`;
            let emailHtml = `<div style="font-family:Arial,sans-serif;color:#333"><h2 style="color:${brandColor}">New Homeowner Photo Upload</h2><p><strong>${c.name}</strong> uploaded a photo for the project at <strong>${addr}</strong>.</p><p>The photo is pending your review.</p><p style="margin-top:20px"><a href="${projectLink}" style="background:${brandColor};color:white;padding:10px 20px;border-radius:4px;text-decoration:none">Review Photo</a></p></div>`;
            try {
              const emailTplRes = await pool.query(
                `SELECT data FROM generic_entities WHERE entity_type = 'EmailTemplate' AND company_id = $1 AND data->>'template_name' = 'Homeowner Photo Upload' AND data->>'is_active' = 'true' ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
                [c.company_id]
              );
              const emailTpl = emailTplRes.rows[0]?.data;
              if (emailTpl?.subject && emailTpl.subject.trim()) {
                emailSubject = emailTpl.subject.replaceAll('{name}', c.name).replaceAll('{addr}', addr).replaceAll('{link}', projectLink);
              }
              if (emailTpl?.body && emailTpl.body.trim()) {
                emailHtml = emailTpl.body.replaceAll('{name}', c.name).replaceAll('{addr}', addr).replaceAll('{link}', projectLink);
              }
            } catch (tplErr) {
              console.warn('[PortalPhoto] Failed to load email template, using default:', tplErr.message);
            }
            sendEmail({ to: recipientEmail, subject: emailSubject, html: emailHtml, companyId: c.company_id }).catch(e => console.warn('[PortalPhoto] notification email failed:', e.message));
          } else {
            console.log(`[PortalPhoto] Skipping email to ${recipientEmail} (opted out of homeowner photo email)`);
          }
          if (sendSmsChan) {
            try {
              const staffRes = await pool.query(`SELECT cell_phone FROM staff_profiles WHERE company_id = $1 AND (user_email = $2 OR email = $2) LIMIT 1`, [c.company_id, recipientEmail]);
              const phone = staffRes.rows[0]?.cell_phone;
              if (phone) {
                let smsBody = `${c.name} uploaded a photo for [${addr}]. Review: ${projectLink}`;
                try {
                  const tplRes = await pool.query(
                    `SELECT data FROM generic_entities WHERE entity_type = 'SMSTemplate' AND company_id = $1 AND data->>'template_name' = 'Homeowner Photo Upload' AND data->>'is_active' = 'true' ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
                    [c.company_id]
                  );
                  const tplMsg = tplRes.rows[0]?.data?.message;
                  if (tplMsg && tplMsg.trim()) {
                    smsBody = tplMsg.replaceAll('{name}', c.name).replaceAll('{addr}', addr).replaceAll('{link}', projectLink);
                  }
                } catch (tplErr) {
                  console.warn('[PortalPhoto] Failed to load SMS template, using default:', tplErr.message);
                }
                callInternalFunction('sendSMS', { to: phone, message: smsBody, companyId: c.company_id }).catch(e => console.warn('[PortalPhoto] notification SMS failed:', e.message));
              }
            } catch {}
          } else {
            console.log(`[PortalPhoto] Skipping SMS to ${recipientEmail} (opted out of homeowner photo SMS)`);
          }
        };
        // Resolve per-channel preferences for the recipient (default: both enabled)
        const getPhotoChannels = async (recipientEmail) => {
          try {
            const prefRes = await pool.query(
              `SELECT data FROM generic_entities WHERE entity_type = 'NotificationPreference' AND company_id = $1 AND LOWER(data->>'user_email') = LOWER($2) LIMIT 1`,
              [c.company_id, recipientEmail]
            );
            const prefs = prefRes.rows[0]?.data;
            if (!prefs) return { email: true, sms: true };
            if (prefs.mute_all_notifications === true) return { email: false, sms: false };
            return {
              email: prefs.notify_on_homeowner_photo_upload !== false,
              sms: prefs.notify_on_homeowner_photo_upload_sms !== false,
            };
          } catch { return { email: true, sms: true }; }
        };
        if (pmEmail) {
          getPhotoChannels(pmEmail).then(channels => {
            if (channels.email || channels.sms) notifyPhotoRecipient(pmEmail, channels).catch(() => {});
            else console.log(`[PortalPhoto] Skipping all notifications to ${pmEmail} (opted out)`);
          }).catch(() => { notifyPhotoRecipient(pmEmail, { email: true, sms: true }).catch(() => {}); });
        } else {
          // No PM assigned — fall back to first company admin/owner
          pool.query(`SELECT COALESCE(NULLIF(user_email,''), email) AS email FROM staff_profiles WHERE company_id = $1 AND (is_administrator = true OR role = 'admin' OR role = 'owner') AND is_active = true AND COALESCE(NULLIF(user_email,''), email) IS NOT NULL ORDER BY created_at LIMIT 1`, [c.company_id]).then(adminRes => {
            const adminEmail = adminRes.rows[0]?.email;
            if (adminEmail) {
              getPhotoChannels(adminEmail).then(channels => {
                if (channels.email || channels.sms) notifyPhotoRecipient(adminEmail, channels).catch(() => {});
                else console.log(`[PortalPhoto] Skipping all notifications to ${adminEmail} (opted out)`);
              }).catch(() => { notifyPhotoRecipient(adminEmail, { email: true, sms: true }).catch(() => {}); });
            }
          }).catch(() => {});
        }
        portalJson(200, { success: true, id: photoId });
      } catch (err) {
        console.error('[PortalAPI] POST /photo error:', err.message);
        if (err.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }

    // POST /api/public/crew-photos — crew member uploads photos via shareable link (no auth required)
    if (pathname === '/api/public/crew-photos' && req.method === 'POST') {
      try {
        const contentType = req.headers['content-type'] || '';
        let portal_token, customer_id, upload_id, photo_base64, mime_type, caption, buffer;
        if (contentType.includes('multipart/form-data')) {
          const rawBuf = await readBodyBuffer(req);
          const parts = parseMultipartPortal(rawBuf, contentType);
          if (!parts) { portalJson(400, { error: 'Invalid multipart body' }); return; }
          const field = (name) => parts.find(p => p.name === name && !p.filename)?.data?.toString('utf8')?.trim();
          const filePart = parts.find(p => p.filename);
          portal_token = field('portal_token');
          customer_id = field('customer_id');
          upload_id = field('upload_id');
          caption = field('caption') || null;
          if (!filePart) { portalJson(400, { error: 'No photo in upload' }); return; }
          buffer = filePart.data;
        } else {
          const rawBody = await readBody(req, 30 * 1024 * 1024);
          let body = {};
          try { body = JSON.parse(rawBody) || {}; } catch (_) { body = {}; }
          ({ portal_token, customer_id, upload_id, photo_base64, mime_type, caption } = body || {});
          if (!photo_base64) { portalJson(400, { error: 'portal_token and photo_base64 required' }); return; }
          buffer = Buffer.from(photo_base64, 'base64');
        }
        if (!portal_token || !buffer?.length) { portalJson(400, { error: 'portal_token and photo required' }); return; }
        const custRes = await pool.query(`SELECT id, name, company_id FROM customers WHERE portal_token = $1 LIMIT 1`, [portal_token]);
        if (custRes.rows.length === 0) { portalJson(403, { error: 'Invalid upload link' }); return; }
        const c = custRes.rows[0];
        if (customer_id && customer_id !== c.id) { portalJson(403, { error: 'Invalid upload link' }); return; }
        // A client retry can arrive after the server stored the photo but
        // before the response reached a mobile browser. Reuse the existing
        // media row instead of creating a duplicate.
        if (upload_id) {
          const existingUpload = await pool.query(
            `SELECT id, data FROM generic_entities
             WHERE entity_type = 'JobMedia' AND company_id = $1
               AND data->>'upload_id' = $2
             LIMIT 1`,
            [c.company_id, upload_id]
          );
          if (existingUpload.rows.length > 0) {
            const existingData = existingUpload.rows[0].data || {};
            portalJson(200, {
              success: true,
              file_url: existingData.file_url || null,
              media_id: existingUpload.rows[0].id,
              already_exists: true,
            });
            return;
          }
        }
        if (buffer.length > 25 * 1024 * 1024) { portalJson(400, { error: 'Photo exceeds 25 MB limit' }); return; }
        // Sniff actual image type from magic bytes — never trust the client-declared MIME.
        // This is more secure (we determine the real type) and more permissive (handles
        // any mobile compression pipeline that mismatches declared vs actual format).
        const sniffMime = (() => {
          if (buffer.length < 4) return null;
          const b0 = buffer[0], b1 = buffer[1], b2 = buffer[2], b3 = buffer[3];
          if (b0 === 0xFF && b1 === 0xD8) return 'image/jpeg';
          if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47) return 'image/png';
          if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
          if (buffer.length >= 12 && ['ftyp', 'mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx'].some(sig => buffer.slice(4, 12).toString('ascii').includes(sig))) return 'image/heic';
          return null;
        })();
        if (!sniffMime) { portalJson(400, { error: 'Unrecognized image format. Please upload a JPEG, PNG, WebP, or HEIC photo.' }); return; }
        const mimeType = sniffMime;
        const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };
        const ext = extMap[mimeType] || '.jpg';
        const { randomUUID } = require('crypto');
        const uniqueName = `crew_${c.id}_${randomUUID()}${ext}`;
        const photoUrl = `/uploads/${uniqueName}`;
        let persisted = false;
        try {
          const objStorage = require('./db/object-storage.cjs');
          await objStorage.uploadToObjectStorage(uniqueName, buffer, mimeType);
          // Keep photoUrl as /uploads/{name} — serveUploadedFile fetches from
          // object storage automatically, so no need to rewrite the URL.
          persisted = true;
        } catch (osErr) {
          console.warn('[CrewPhotos] Object storage upload failed, trying local disk:', osErr.message);
        }
        try {
          const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
          fs.writeFileSync(path.join(uploadsDir, uniqueName), buffer);
          persisted = true;
        } catch (diskErr) {
          console.warn('[CrewPhotos] Disk save also failed:', diskErr.message);
        }
        if (!persisted) { portalJson(500, { error: 'Could not store the photo. Please try again.' }); return; }
        const mediaId = `crew_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const mediaData = {
          related_entity_id: c.id,
          related_entity_type: 'Customer',
          file_url: photoUrl,
          file_type: 'photo',
          section: 'crew_upload',
          caption: caption || null,
          source: 'crew_upload',
          uploaded_by_name: 'Crew Upload',
          company_id: c.company_id,
          upload_id: upload_id || null,
          created_at: new Date().toISOString(),
        };
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'JobMedia', $2, $3, NOW(), NOW())`,
          [mediaId, c.company_id, JSON.stringify(mediaData)]
        );
        // Notifications are ancillary. Do not hold the photo response behind
        // an advisory lock or a slow database connection: on a large mobile
        // batch that makes successful storage look like a failed upload.
        void (async () => {
          const adminRes = await pool.query(`SELECT user_email FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`, [c.company_id]);
          const adminEmails = adminRes.rows.map(r => r.user_email).filter(Boolean);
          const profilePath = `/CustomerProfile?id=${c.id}`;
          const notifClient = await pool.connect();
          try {
            await notifClient.query('BEGIN');
            await notifClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crew_photo_notif_${c.id}`]);
            for (const adminEmail of adminEmails) {
              const existing = await notifClient.query(
                `SELECT id, data FROM generic_entities
                 WHERE entity_type = 'Notification' AND company_id = $1
                   AND data->>'type' = 'crew_photo'
                   AND data->>'user_email' = $2
                   AND data->>'related_entity_id' = $3
                   AND COALESCE(data->>'is_read', 'false') <> 'true'
                   AND created_date > NOW() - INTERVAL '24 hours'
                 ORDER BY created_date DESC LIMIT 1`,
                [c.company_id, adminEmail, c.id]
              );
              if (existing.rows.length > 0) {
                const prev = existing.rows[0];
                const count = (parseInt(prev.data?.photo_count, 10) || 1) + 1;
                await notifClient.query(
                  `UPDATE generic_entities SET data = data || $2::jsonb, created_date = NOW(), updated_date = NOW() WHERE id = $1`,
                  [prev.id, JSON.stringify({
                    photo_count: count,
                    message: `Crew uploaded ${count} new photos for customer ${c.name}. Tap to view.`,
                  })]
                );
              } else {
                const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const notifData = {
                  user_email: adminEmail,
                  title: `📸 New Crew Photos — ${c.name}`,
                  message: `Crew uploaded a new photo for customer ${c.name}. Tap to view.`,
                  type: 'crew_photo',
                  photo_count: 1,
                  related_entity_type: 'Customer',
                  related_entity_id: c.id,
                  link_url: profilePath,
                  is_read: false,
                  company_id: c.company_id,
                };
                await notifClient.query(
                  `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW())`,
                  [notifId, c.company_id, JSON.stringify(notifData)]
                );
              }
            }
            await notifClient.query('COMMIT');
          } catch (notifErr) {
            try { await notifClient.query('ROLLBACK'); } catch (_) {}
            console.warn('[CrewPhotos] Notification write failed:', notifErr.message);
          } finally {
            notifClient.release();
          }
        })().catch((notifErr) => console.warn('[CrewPhotos] Notification setup failed:', notifErr.message));
        console.log(`[CrewPhotos] Crew uploaded photo ${uniqueName} for customer ${c.id} (${c.name})`);
        portalJson(200, { success: true, file_url: photoUrl, media_id: mediaId });
      } catch (err) {
        console.error('[CrewPhotos] Error:', err.message);
        if (err?.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }

    // POST /api/public/portal/note
    if (pathname === '/api/public/portal/note' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const { token, project_id, content_body } = body;
        if (!token || !project_id || !content_body?.trim()) { portalJson(400, { error: 'token, project_id and content_body required' }); return; }
        // Resolve customer strictly by portal_token — never by id
        const custRes = await pool.query(`SELECT id, name, phone, company_id, portal_token FROM customers WHERE portal_token = $1 LIMIT 1`, [token]);
        if (custRes.rows.length === 0) { portalJson(403, { error: 'Invalid token' }); return; }
        const c = custRes.rows[0];
        const portalToken = c.portal_token || c.id;
        // Strict ownership — customer_id only
        const projRes = await pool.query(`SELECT id, assigned_to, address, data FROM projects WHERE id = $1 AND company_id = $2 AND COALESCE(NULLIF(related_customer_id, ''), NULLIF(data->>'related_customer_id', ''), NULLIF(customer_id, ''), NULLIF(data->>'customer_id', '')) = $3 LIMIT 1`, [project_id, c.company_id, c.id]);
        if (projRes.rows.length === 0) { portalJson(403, { error: 'Invalid project' }); return; }
        const proj = projRes.rows[0];
        const logId = `plog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const noteNow = new Date().toISOString();
        await pool.query(`INSERT INTO project_logs (id, project_id, company_id, author_role, author_name, content_body, is_public, created_at) VALUES ($1,$2,$3,'homeowner',$4,$5,false,NOW())`, [logId, project_id, c.company_id, c.name, content_body.trim()]);
        // Auto-reply SMS to homeowner (fire-and-forget)
        if (c.phone) {
          callInternalFunction('sendSMS', { to: c.phone, message: `Got your note — your project manager will get back to you shortly. View your project: ${process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com'}/portal?token=${portalToken}`, companyId: c.company_id }).catch(e => console.warn('[PortalNote] Auto-reply SMS failed:', e.message));
        }
        // Keyword alert to PM (fire-and-forget)
        const lowerNote = content_body.toLowerCase();
        const matched = ALERT_KEYWORDS.filter(k => lowerNote.includes(k));
        if (matched.length > 0) {
          const pmEmail = proj.assigned_to || proj.data?.assigned_to;
          if (pmEmail) {
            const addr = proj.address || 'your project';
            const projectLink = `${process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com'}/projects/${project_id}`;
            const snippet = content_body.slice(0, 300);
            // Email notification — always sent regardless of SMS availability
            const emailHtml = `<div style="font-family:Arial,sans-serif;color:#333"><h2 style="color:#dc2626">&#9888; Urgent Homeowner Note</h2><p><strong>${c.name}</strong> submitted a note for <strong>${addr}</strong> containing flagged keywords: <strong>${matched.join(', ')}</strong></p><blockquote style="border-left:4px solid #dc2626;margin:12px 0;padding:8px 16px;background:#fef2f2;color:#333">${snippet}</blockquote><p style="margin-top:20px"><a href="${projectLink}" style="background:#2563eb;color:white;padding:10px 20px;border-radius:4px;text-decoration:none">View Project</a></p></div>`;
            sendEmail({ to: pmEmail, subject: `⚠ Urgent Note: ${addr} (${matched.join(', ')})`, html: emailHtml }).catch(e => console.warn('[PortalNote] Keyword alert email failed:', e.message));
            // SMS notification — only if PM has a cell phone on file
            pool.query(`SELECT cell_phone FROM staff_profiles WHERE company_id = $1 AND (user_email = $2 OR email = $2) LIMIT 1`, [c.company_id, pmEmail]).then(pmRes => {
              const pmPhone = pmRes.rows[0]?.cell_phone;
              if (pmPhone) {
                callInternalFunction('sendSMS', { to: pmPhone, message: `[${addr}] — Homeowner note flagged (${matched.join(', ')}): "${content_body.slice(0, 200)}"`, companyId: c.company_id }).catch(e => console.warn('[PortalNote] Keyword alert SMS failed:', e.message));
              }
            }).catch(() => {});
          }
        }
        // Return full inserted log row
        portalJson(200, { success: true, log: { id: logId, project_id, company_id: c.company_id, author_role: 'homeowner', author_name: c.name, content_body: content_body.trim(), is_public: false, created_at: noteNow } });
      } catch (err) {
        console.error('[PortalAPI] POST /note error:', err.message);
        if (err?.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }

    // GET /api/public/portal/admin-check?token=<portal_token>
    // Returns { isAdmin: true } when the authenticated session belongs to a staff/owner of the customer's company
    if (pathname === '/api/public/portal/admin-check' && req.method === 'GET') {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        if (!token) { portalJson(200, { isAdmin: false }); return; }
        const custRes = await pool.query(`SELECT company_id FROM customers WHERE portal_token = $1 LIMIT 1`, [token]);
        if (custRes.rows.length === 0) { portalJson(200, { isAdmin: false }); return; }
        const companyId = custRes.rows[0].company_id;
        const user = await getUserFromRequest(req);
        if (!user) { portalJson(200, { isAdmin: false }); return; }
        const isAdmin = await verifyPortalCompanyAccess(user, companyId);
        portalJson(200, { isAdmin });
      } catch (err) {
        portalJson(200, { isAdmin: false });
      }
      return;
    }

    // Helper: resolve authenticated user from signed session cookie
    async function getUserFromRequest(req) {
      const SESSION_SECRET = process.env.SESSION_SECRET;
      if (!SESSION_SECRET) return null;
      const cookieHeader = req.headers?.cookie || '';
      const cookies = {};
      cookieHeader.split(';').forEach(c => {
        const idx = c.indexOf('=');
        if (idx > 0) {
          const key = c.slice(0, idx).trim();
          const val = c.slice(idx + 1).trim();
          try { cookies[key] = decodeURIComponent(val); } catch { cookies[key] = val; }
        }
      });
      const signedSid = cookies['connect.sid'];
      if (!signedSid || !signedSid.startsWith('s:')) return null;
      const val = signedSid.slice(2);
      const dotIndex = val.lastIndexOf('.');
      if (dotIndex === -1) return null;
      const sid = val.slice(0, dotIndex);
      const sig = val.slice(dotIndex + 1);
      const expected = require('crypto').createHmac('sha256', SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
      if (sig !== expected) return null;
      try {
        const result = await pool.query('SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()', [sid]);
        if (result.rows.length === 0) return null;
        const sess = typeof result.rows[0].sess === 'string' ? JSON.parse(result.rows[0].sess) : result.rows[0].sess;
        const email = sess?.passport?.user?.claims?.email || sess?.passport?.user?.email;
        if (!email) return null;
        const userResult = await pool.query('SELECT platform_role, company_id FROM users WHERE email = $1', [email]);
        const userRow = userResult.rows[0];
        const platform_role = userRow?.platform_role || null;
        const staffResult = await pool.query(
          'SELECT is_super_admin, is_administrator FROM staff_profiles WHERE (email = $1 OR user_email = $1) LIMIT 1',
          [email]
        );
        const staffRow = staffResult.rows[0];
        const is_super_admin = staffRow?.is_super_admin === true || platform_role === 'super_admin';
        return { email, platform_role, is_super_admin, is_administrator: staffRow?.is_administrator === true };
      } catch (e) {
        console.error('[PortalAPI] getUserFromRequest error:', e.message);
        return null;
      }
    }

    // Helper: verify caller is staff or owner of a given company (used for IDOR prevention)
    const VALID_PROJECT_TYPES = ['standard', 'sedgwick_claim'];

    async function verifyPortalCompanyAccess(user, companyId) {
      if (user.platform_role === 'super_admin' || user.is_super_admin) return true;
      const [s, o] = await Promise.all([
        pool.query(`SELECT id FROM staff_profiles WHERE company_id=$1 AND user_email=$2 LIMIT 1`, [companyId, user.email]),
        pool.query(`SELECT id FROM generic_entities WHERE entity_type='Company' AND id=$1 AND data->>'created_by'=$2 LIMIT 1`, [companyId, user.email]),
      ]);
      return s.rows.length > 0 || o.rows.length > 0;
    }

    // Crew-to-project sharing routes intentionally precede the generic
    // /api/projects/:id/photos routes below, since "crew" is not a project id.
    if (pathname === '/api/projects/crew/photos' && req.method === 'GET') {
      try {
        const user = await getUserFromRequest(req);
        if (!user) { portalJson(401, { error: 'Not authenticated' }); return; }
        const customerId = new URL(req.url, `http://${req.headers.host}`).searchParams.get('customer_id');
        if (!customerId) { portalJson(400, { error: 'customer_id is required' }); return; }
        const customer = await pool.query(`SELECT company_id FROM customers WHERE id = $1 LIMIT 1`, [customerId]);
        if (!customer.rows.length) { portalJson(404, { error: 'Customer not found' }); return; }
        const sharing = require('./lib/crewPhotoSharing.cjs');
        if (!(await sharing.hasActiveCompanyAccess(pool, user, customer.rows[0].company_id))) {
          portalJson(403, { error: 'Forbidden' }); return;
        }
        portalJson(200, await sharing.listCustomerCrewPhotos(
          pool, customerId, customer.rows[0].company_id, user
        ));
      } catch (err) {
        const status = err.statusCode || (err instanceof SyntaxError ? 400 : 500);
        portalJson(status, { error: status < 500 ? err.message : 'Server error' });
      }
      return;
    }

    const crewPhotosPostMatch = pathname.match(/^\/api\/projects\/([^/]+)\/photos\/crew$/);
    if (crewPhotosPostMatch && req.method === 'POST') {
      try {
        const user = await getUserFromRequest(req);
        if (!user) { portalJson(401, { error: 'Not authenticated' }); return; }
        const impCtx = req._impersonationCtx || await tenantGuard.resolveRequestContext(req, pool);
        if (impCtx?.isImpersonating) {
          portalJson(403, { error: 'Crew photo sharing is not permitted during impersonation' }); return;
        }
        const projectId = crewPhotosPostMatch[1];
        const body = JSON.parse(await readBody(req));
        const customerId = body?.customer_id;
        if (!customerId) { portalJson(400, { error: 'customer_id is required' }); return; }
        const customer = await pool.query(`SELECT company_id FROM customers WHERE id = $1 LIMIT 1`, [customerId]);
        if (!customer.rows.length) { portalJson(404, { error: 'Customer not found' }); return; }
        const sharing = require('./lib/crewPhotoSharing.cjs');
        if (!(await sharing.hasActiveCompanyAccess(pool, user, customer.rows[0].company_id))) {
          portalJson(403, { error: 'Forbidden' }); return;
        }
        const result = await sharing.publishCrewPhotos(pool, {
          projectId,
          customerId,
          authorizedCompanyId: customer.rows[0].company_id,
          actor: user,
          photos: body.photos,
        });
        portalJson(200, result);
      } catch (err) {
        const status = err.statusCode || (err instanceof SyntaxError ? 400 : 500);
        portalJson(status, { error: status < 500 ? err.message : 'Server error' });
      }
      return;
    }

    // Non-blocking homeowner milestone notification (SMS + email)
    async function sendPortalMilestoneUpdate(projectId) {
      try {
        const projRes = await pool.query(`SELECT id, company_id, customer_id, project_type, current_milestone, address FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
        const proj = projRes.rows[0];
        if (!proj) return;
        const custRes = await pool.query(`SELECT id, name, phone, email, portal_token FROM customers WHERE id = $1 LIMIT 1`, [proj.customer_id]);
        const cust = custRes.rows[0];
        if (!cust) return;
        const milestoneLabel = getMilestoneLabel(proj.project_type, proj.current_milestone);
        const custToken = cust.portal_token || cust.id;
        const portalLink = `${process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com'}/portal?token=${custToken}`;
        const addr = proj.address || cust.name;
        if (cust.phone) callInternalFunction('sendSMS', { to: cust.phone, message: `Update on your project at ${addr}: We've reached the "${milestoneLabel}" stage. View details: ${portalLink}`, companyId: proj.company_id }).catch(e => console.warn('[PortalMilestone] SMS failed:', e.message));
        if (cust.email) {
          const emailHtml = `<div style="font-family:Arial,sans-serif;color:#333"><h2 style="color:#2563eb">Project Update</h2><p>Great news! Your project at <strong>${addr}</strong> has reached the <strong>${milestoneLabel}</strong> stage.</p><p style="margin-top:20px"><a href="${portalLink}" style="background:#2563eb;color:white;padding:10px 20px;border-radius:4px;text-decoration:none">View My Project Portal</a></p></div>`;
          callInternalFunction('sendEmailFromCRM', { to: cust.email, subject: `Project Update: ${milestoneLabel}`, html: emailHtml, company_id: proj.company_id }).catch(e => console.warn('[PortalMilestone] Email failed:', e.message));
        }
      } catch (e) { console.warn('[sendPortalMilestoneUpdate] failed:', e.message); }
    }

    // POST /api/projects/:id/log — admin adds log entry
    const logMatch = pathname.match(/^\/api\/projects\/([^/]+)\/log$/);
    if (logMatch && req.method === 'POST') {
      try {
        const user = await getUserFromRequest(req);
        if (!user) { portalJson(401, { error: 'Not authenticated' }); return; }
        const projectId = logMatch[1];
        const body = JSON.parse(await readBody(req));
        const { content_body, is_public } = body;
        if (!content_body?.trim()) { portalJson(400, { error: 'content_body required' }); return; }
        const projRes = await pool.query(`SELECT id, company_id FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
        if (projRes.rows.length === 0) { portalJson(404, { error: 'Project not found' }); return; }
        if (!(await verifyPortalCompanyAccess(user, projRes.rows[0].company_id))) { portalJson(403, { error: 'Forbidden' }); return; }
        const logId = `plog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const isPublic = is_public === true || is_public === 'true';
        await pool.query(`INSERT INTO project_logs (id, project_id, company_id, author_role, author_name, content_body, is_public, created_at) VALUES ($1,$2,$3,'admin',$4,$5,$6,NOW())`, [logId, projectId, projRes.rows[0].company_id, user.email, content_body.trim(), isPublic]);
        portalJson(200, { success: true, log: { id: logId, project_id: projectId, author_role: 'admin', author_name: user.email, content_body: content_body.trim(), is_public: isPublic, created_at: new Date().toISOString() } });
      } catch (err) {
        console.error('[PortalAPI] POST /log error:', err.message);
        if (err?.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }

    // GET /api/projects/:id/log
    const logGetMatch = pathname.match(/^\/api\/projects\/([^/]+)\/log$/);
    if (logGetMatch && req.method === 'GET') {
      try {
        const user = await getUserFromRequest(req);
        if (!user) { portalJson(401, { error: 'Not authenticated' }); return; }
        const projectId = logGetMatch[1];
        const projCheckRes = await pool.query(`SELECT company_id FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
        if (projCheckRes.rows.length === 0) { portalJson(404, { error: 'Project not found' }); return; }
        if (!(await verifyPortalCompanyAccess(user, projCheckRes.rows[0].company_id))) { portalJson(403, { error: 'Forbidden' }); return; }
        const logsRes = await pool.query(`SELECT * FROM project_logs WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
        portalJson(200, { success: true, logs: logsRes.rows });
      } catch (err) {
        if (err?.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }

    // PATCH /api/projects/:id/milestone
    const msMatch = pathname.match(/^\/api\/projects\/([^/]+)\/milestone$/);
    if (msMatch && req.method === 'PATCH') {
      try {
        const user = await getUserFromRequest(req);
        if (!user) { portalJson(401, { error: 'Not authenticated' }); return; }
        const projectId = msMatch[1];
        const body = JSON.parse(await readBody(req));
        const { current_milestone, project_type } = body;
        const projCheckRes = await pool.query(`SELECT id, company_id, customer_id, customer_name, project_type, current_milestone, address, assigned_to, data FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
        if (projCheckRes.rows.length === 0) { portalJson(404, { error: 'Project not found' }); return; }
        const projCheck = projCheckRes.rows[0];
        if (!(await verifyPortalCompanyAccess(user, projCheck.company_id))) { portalJson(403, { error: 'Forbidden' }); return; }
        // Validate project_type against allowed set
        if (project_type && !VALID_PROJECT_TYPES.includes(project_type)) {
          portalJson(400, { error: `Invalid project_type '${project_type}'. Must be one of: ${VALID_PROJECT_TYPES.join(', ')}` }); return;
        }
        // Validate milestone against allowed set for effective project type
        const effectiveProjType = project_type || projCheck.project_type || 'standard';
        const allowedMilestones = getMilestones(effectiveProjType).map(m => m.key);
        if (current_milestone && !allowedMilestones.includes(current_milestone)) {
          portalJson(400, { error: `Invalid milestone '${current_milestone}' for project type '${effectiveProjType}'` }); return;
        }
        let setClause = `current_milestone = $2, updated_at = NOW()`;
        const params = [projectId, current_milestone];
        if (project_type) { setClause += `, project_type = $${params.length + 1}`; params.push(project_type); }
        await pool.query(`UPDATE projects SET ${setClause} WHERE id = $1`, params);
        const projRes = await pool.query(`SELECT id, company_id, customer_id, customer_name, project_type, current_milestone, address, assigned_to, data FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
        const proj = projRes.rows[0];
        // Notify homeowner via dedicated helper (non-blocking)
        sendPortalMilestoneUpdate(projectId).catch(() => {});
        portalJson(200, { success: true, project: proj });
      } catch (err) {
        console.error('[PortalAPI] PATCH /milestone error:', err.message);
        if (err?.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }

    // GET /api/projects/:id/photos
    const photosGetMatch = pathname.match(/^\/api\/projects\/([^/]+)\/photos$/);
    if (photosGetMatch && req.method === 'GET') {
      try {
        const user = await getUserFromRequest(req);
        if (!user) { portalJson(401, { error: 'Not authenticated' }); return; }
        const projectId = photosGetMatch[1];
        const projCheckRes = await pool.query(`SELECT company_id FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
        if (projCheckRes.rows.length === 0) { portalJson(404, { error: 'Project not found' }); return; }
        if (!(await verifyPortalCompanyAccess(user, projCheckRes.rows[0].company_id))) { portalJson(403, { error: 'Forbidden' }); return; }
        const photosRes = await pool.query(`SELECT * FROM project_photos WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
        portalJson(200, { success: true, photos: photosRes.rows });
      } catch (err) {
        if (err?.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }

    // POST /api/projects/:id/photos
    const photosPostMatch = pathname.match(/^\/api\/projects\/([^/]+)\/photos$/);
    if (photosPostMatch && req.method === 'POST') {
      try {
        const user = await getUserFromRequest(req);
        if (!user) { portalJson(401, { error: 'Not authenticated' }); return; }
        const projectId = photosPostMatch[1];
        const body = JSON.parse(await readBody(req));
        const { photo_url, caption, milestone, is_public } = body;
        if (!photo_url) { portalJson(400, { error: 'photo_url required' }); return; }
        const projRes = await pool.query(`SELECT company_id FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
        if (projRes.rows.length === 0) { portalJson(404, { error: 'Project not found' }); return; }
        if (!(await verifyPortalCompanyAccess(user, projRes.rows[0].company_id))) { portalJson(403, { error: 'Forbidden' }); return; }
        const photoId = `pphoto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await pool.query(`INSERT INTO project_photos (id, project_id, company_id, photo_url, caption, milestone, is_public, uploaded_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`, [photoId, projectId, projRes.rows[0].company_id, photo_url, caption || null, milestone || null, is_public === true, user.email]);
        portalJson(200, { success: true, id: photoId });
      } catch (err) {
        if (err?.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }

    // PATCH /api/projects/:id/photos/:photoId
    const photoToggleMatch = pathname.match(/^\/api\/projects\/([^/]+)\/photos\/([^/]+)$/);
    if (photoToggleMatch && req.method === 'PATCH') {
      try {
        const user = await getUserFromRequest(req);
        if (!user) { portalJson(401, { error: 'Not authenticated' }); return; }
        const [, projectId, photoId] = photoToggleMatch;
        const projCheckRes = await pool.query(`SELECT company_id FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
        if (projCheckRes.rows.length === 0) { portalJson(404, { error: 'Project not found' }); return; }
        const crewShareRes = await pool.query(
          `SELECT source_media_id FROM project_photos
           WHERE id = $1 AND project_id = $2 AND company_id = $3 LIMIT 1`,
          [photoId, projectId, projCheckRes.rows[0].company_id]
        );
        const body = JSON.parse(await readBody(req));
        if (crewShareRes.rows[0]?.source_media_id) {
          const impCtx = req._impersonationCtx || await tenantGuard.resolveRequestContext(req, pool);
          if (impCtx?.isImpersonating) {
            portalJson(403, { error: 'Crew photo sharing changes are not permitted during impersonation' }); return;
          }
          const sharing = require('./lib/crewPhotoSharing.cjs');
          const result = await sharing.setCrewSharePublic(pool, {
            projectId,
            photoId,
            authorizedCompanyId: projCheckRes.rows[0].company_id,
            actor: user,
            isPublic: body.is_public === true,
          });
          portalJson(200, result);
          return;
        } else if (!(await verifyPortalCompanyAccess(user, projCheckRes.rows[0].company_id))) {
          portalJson(403, { error: 'Forbidden' }); return;
        }
        const updated = await pool.query(
          `UPDATE project_photos pp
           SET is_public = $1
           WHERE pp.id = $2 AND pp.project_id = $3 AND pp.company_id = $4
             AND pp.source_media_id IS NULL
             AND EXISTS (
               SELECT 1 FROM projects p
               WHERE p.id = pp.project_id AND p.company_id = $4
             )
           RETURNING pp.id`,
          [body.is_public === true, photoId, projectId, projCheckRes.rows[0].company_id]
        );
        if (!updated.rows.length) { portalJson(404, { error: 'Project photo not found' }); return; }
        portalJson(200, { success: true });
      } catch (err) {
        if (err?.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        if (err?.statusCode) { portalJson(err.statusCode, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }

    // DELETE /api/projects/:id/photos/:photoId — admin rejects/deletes a homeowner-uploaded photo
    if (photoToggleMatch && req.method === 'DELETE') {
      try {
        const user = await getUserFromRequest(req);
        if (!user) { portalJson(401, { error: 'Not authenticated' }); return; }
        const [, projectId, photoId] = photoToggleMatch;
        const projCheckRes = await pool.query(`SELECT company_id FROM projects WHERE id = $1 LIMIT 1`, [projectId]);
        if (projCheckRes.rows.length === 0) { portalJson(404, { error: 'Project not found' }); return; }
        if (!(await verifyPortalCompanyAccess(user, projCheckRes.rows[0].company_id))) { portalJson(403, { error: 'Forbidden' }); return; }
        await pool.query(`DELETE FROM project_photos WHERE id = $1 AND project_id = $2 AND uploaded_by LIKE 'homeowner:%' AND is_public = false`, [photoId, projectId]);
        portalJson(200, { success: true });
      } catch (err) {
        if (err?.statusCode === 413) { portalJson(413, { error: err.message }); return; }
        portalJson(500, { error: 'Server error' });
      }
      return;
    }
  }

  // ── Google Chat inbound file-sync webhook ──────────────────────────────
  // POST /api/google-chat-webhook?company_id=<id>&token=<token>
  if (pathname === '/api/google-chat-webhook' && req.method === 'POST') {
    const gcUrl = new URL(req.url, `https://${req.headers.host}`);
    const gcCompanyId = gcUrl.searchParams.get('company_id');
    const gcToken = gcUrl.searchParams.get('token');
    const gcJson = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (!gcCompanyId || !gcToken) { gcJson(400, { error: 'Missing company_id or token' }); return; }
      const pool = prodDb.getPool();
      const coRes = await pool.query('SELECT settings FROM companies WHERE id = $1 LIMIT 1', [gcCompanyId]);
      const co = coRes.rows[0];
      if (!co) { gcJson(401, { error: 'Unauthorized' }); return; }
      const coSettings = (typeof co.settings === 'string' ? JSON.parse(co.settings) : co.settings) || {};
      if (coSettings.google_chat_inbound_token !== gcToken) { gcJson(401, { error: 'Unauthorized' }); return; }
      if (coSettings.google_chat_enabled !== true) { gcJson(403, { error: 'Google Chat integration is disabled' }); return; }
      // SSRF guard — only download from Google's own domains
      const isTrustedGchatUrl = (url) => {
        try {
          const u = new URL(url);
          if (u.protocol !== 'https:') return false;
          const h = u.hostname.toLowerCase();
          if (!/\.(google\.com|googleapis\.com|googleusercontent\.com)$/.test(h)) return false;
          if (/^(localhost|0\.0\.0\.0|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(h)) return false;
          return true;
        } catch (_) { return false; }
      };
      // Parse JSON or multipart/form-data
      let body = {};
      const multipartFiles = [];
      try {
        const ctHeader = req.headers['content-type'] || '';
        const boundaryM = ctHeader.match(/boundary=([^\s;,]+)/);
        if (ctHeader.includes('multipart/') && boundaryM) {
          const rawChunks = [];
          await new Promise((resolve, reject) => {
            req.on('data', c => rawChunks.push(c));
            req.on('end', resolve);
            req.on('error', reject);
          });
          const rawBuf = Buffer.concat(rawChunks);
          const boundary = boundaryM[1];
          const sep = Buffer.from(`\r\n--${boundary}`);
          let cur = rawBuf.indexOf(Buffer.from(`--${boundary}\r\n`));
          while (cur >= 0 && cur < rawBuf.length) {
            const next = rawBuf.indexOf(sep, cur + boundary.length + 4);
            const partEnd = next === -1 ? rawBuf.length : next;
            const hEnd = rawBuf.indexOf(Buffer.from('\r\n\r\n'), cur);
            if (hEnd === -1 || hEnd >= partEnd) break;
            const hStr = rawBuf.slice(cur, hEnd).toString('utf8');
            const dataBuf = rawBuf.slice(hEnd + 4, partEnd);
            const disp = hStr.match(/Content-Disposition:[^\r\n]*/i)?.[0] || '';
            const fName = disp.match(/\bfilename="([^"]+)"/)?.[1] || null;
            const fieldName = disp.match(/\bname="([^"]+)"/)?.[1] || '';
            const fCt = hStr.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || 'application/octet-stream';
            if (fName) { multipartFiles.push({ filename: fName, contentType: fCt, buffer: dataBuf }); }
            else if (fieldName === 'payload_json' || fieldName === 'body') { try { body = JSON.parse(dataBuf.toString('utf8')); } catch (_2) {} }
            if (next === -1) break;
            cur = next + 2;
          }
        } else {
          const chunks = [];
          await new Promise((resolve, reject) => {
            req.on('data', c => chunks.push(c));
            req.on('end', resolve);
            req.on('error', reject);
          });
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        }
      } catch (_) {}
      const msg = body.message || {};
      const senderName = msg.sender?.displayName || msg.sender?.name || 'Google Chat';
      const msgText = msg.text || '';
      const attachments = msg.attachment || [];
      let matchedCustomerId = null;
      let matchedCustomerName = null;
      if (senderName || msgText) {
        const searchTerms = [senderName, ...(msgText.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) || [])].filter(Boolean);
        for (const term of searchTerms) {
          const match = await pool.query(
            `(SELECT id, name FROM customers WHERE company_id = $1 AND name ILIKE $2 LIMIT 1)
             UNION ALL
             (SELECT id, name FROM leads WHERE company_id = $1 AND name ILIKE $2 LIMIT 1)
             LIMIT 1`,
            [gcCompanyId, `%${term}%`]
          );
          if (match.rows.length > 0) {
            matchedCustomerId = match.rows[0].id;
            matchedCustomerName = match.rows[0].name || senderName;
            break;
          }
        }
      }
      // Service-account JWT flow for authenticated Google Chat attachment downloads.
      // Uses GOOGLE_CHAT_CREDENTIALS (JSON service account key) if present.
      const getGoogleChatAccessToken = async () => {
        const credsJson = process.env.GOOGLE_CHAT_CREDENTIALS;
        if (!credsJson) return null;
        try {
          const creds = JSON.parse(credsJson);
          const now = Math.floor(Date.now() / 1000);
          const jwtPayload = {
            iss: creds.client_email,
            scope: 'https://www.googleapis.com/auth/chat.messages.readonly',
            aud: 'https://oauth2.googleapis.com/token',
            iat: now, exp: now + 3600,
          };
          const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
          const bdy = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');
          const unsigned = `${hdr}.${bdy}`;
          const { createSign } = require('crypto');
          const sign = createSign('RSA-SHA256');
          sign.update(unsigned);
          const sig = sign.sign(creds.private_key, 'base64url');
          const jwt = `${unsigned}.${sig}`;
          const resp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
            signal: AbortSignal.timeout(10000),
          });
          if (!resp.ok) return null;
          const data = await resp.json();
          return data.access_token || null;
        } catch (_) { return null; }
      };
      let savedCount = 0;
      let failedCount = 0;
      // Merge JSON attachment refs with directly-uploaded multipart files
      const allAttSources = [
        ...attachments.map(a => ({ ...a, _buf: null })),
        ...multipartFiles.map(f => ({ _buf: f.buffer, name: f.filename, contentType: f.contentType })),
      ];
      for (const att of allAttSources) {
        const fileUrl = att._buf ? '' : (att.downloadUri || att.thumbnailUri || att.sourceUrl || '');
        if (!fileUrl && !att._buf) continue;
        const mediaId = `gchat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        let storedUrl = '';
        let storedContentType = att.contentType || 'application/octet-stream';
        let binaryStored = false;
        try {
          const { uploadToObjectStorage } = require('./db/object-storage.cjs');
          const firstPath = (process.env.PUBLIC_OBJECT_SEARCH_PATHS || '').split(',')[0]?.trim();
          if (att._buf) {
            // Multipart upload — store binary directly in object storage
            const ext = (storedContentType.split('/')[1] || 'bin').split(';')[0];
            const fname = att.name || `gchat_${mediaId}.${ext}`;
            await uploadToObjectStorage(fname, att._buf, storedContentType);
            if (firstPath) storedUrl = `/${firstPath.replace(/^\//, '')}/${fname}`;
            binaryStored = true;
          } else if (isTrustedGchatUrl(fileUrl)) {
            // Authenticated download then store — uses service account if available
            const accessToken = await getGoogleChatAccessToken();
            const fetchHeaders = accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {};
            const dlResp = await fetch(fileUrl, { headers: fetchHeaders, signal: AbortSignal.timeout(15000) });
            if (dlResp.ok) {
              const buf = Buffer.from(await dlResp.arrayBuffer());
              const contentType = dlResp.headers.get('content-type') || storedContentType;
              const ext = (contentType.split('/')[1] || 'bin').split(';')[0];
              const fname = att.name || `gchat_${mediaId}.${ext}`;
              await uploadToObjectStorage(fname, buf, contentType);
              if (firstPath) storedUrl = `/${firstPath.replace(/^\//, '')}/${fname}`;
              storedContentType = contentType;
              binaryStored = true;
            } else {
              console.log(`[GoogleChatWebhook] Attachment HTTP ${dlResp.status}${accessToken ? '' : ' — set GOOGLE_CHAT_CREDENTIALS for auth'}`);
            }
          } else if (fileUrl) {
            console.log(`[GoogleChatWebhook] Skipping untrusted attachment URL (SSRF guard)`);
          }
        } catch (dlErr) {
          console.log(`[GoogleChatWebhook] Attachment store error: ${dlErr.message}`);
        }
        // Only persist to vault when binary was actually stored
        if (!binaryStored) { failedCount++; continue; }
        const mediaData = {
          company_id: gcCompanyId,
          image_url: storedUrl,
          file_name: att.name || 'google-chat-attachment',
          content_type: storedContentType,
          source: 'google_chat',
          sender_name: senderName,
          message_text: msgText.slice(0, 500),
          customer_id: matchedCustomerId || null,
          customer_name: matchedCustomerName || null,
          uploaded_at: new Date().toISOString(),
        };
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'JobMedia', $2, $3, NOW(), NOW())`,
          [mediaId, gcCompanyId, JSON.stringify(mediaData)]
        );
        savedCount++;
      }
      const googleChatLexi = require('./lib/googleChatLexi.cjs');
      const lexiResponse = await googleChatLexi.handleLexiMessage({
        pool,
        companyId: gcCompanyId,
        body,
        invokeLexi: async (params, caller) => {
          const pluginModule = await import('./vite-functions-plugin.js');
          const handlers = await prodIntegrations.getFunctionHandlers();
          const keyInfo = await pluginModule.getCompanyGeminiKeyInfo(gcCompanyId);
          return handlers.lexiChat(
            params,
            keyInfo.key,
            { headers: {}, __googleChatCaller: caller }
          );
        },
      });
      console.log(`[GoogleChatWebhook] company=${gcCompanyId} sender=${senderName} stored=${savedCount} failed=${failedCount} customer=${matchedCustomerName || 'unmatched'} lexi=${!!lexiResponse}`);
      gcJson(200, lexiResponse || { ok: true, saved: savedCount, failed: failedCount, matched_customer: matchedCustomerName || null });
    } catch (gcErr) {
      console.error('[GoogleChatWebhook] Error:', gcErr.message);
      gcJson(500, { error: 'Internal server error' });
    }
    return;
  }
  // ─────────────────────────────────────────────────────────────────────

  if (pathname === '/marketing-features-pdf' && req.method === 'GET') {
    try {
      const { generateFeatureBriefPdf } = require('./lib/generateFeatureBriefPdf.cjs');
      const pdfBuf = await generateFeatureBriefPdf();
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="CompanySync-Feature-Brief.pdf"',
        'Content-Length': pdfBuf.length,
      });
      res.end(pdfBuf);
    } catch (err) {
      console.error('[marketing-features-pdf] PDF generation error:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('PDF generation failed: ' + err.message);
    }
    return;
  }

  if (pathname === '/api/public-estimate-pdf' && req.method === 'GET') {
    try {
      const url = new URL(req.url, `https://${req.headers.host}`);
      const id = url.searchParams.get('id');
      const t = url.searchParams.get('t');
      if (!id) { res.writeHead(400); res.end('Missing id'); return; }
      const { checkEstimateAccess } = require('./lib/estimateToken.cjs');
      const access = checkEstimateAccess(id, t, 'public-estimate-pdf');
      if (!access.ok) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Unauthorized estimate link' })); return; }
      const pool = prodDb.getPool();
      let estRow = null;
      let estData = {};
      const estRes1 = await pool.query(`SELECT * FROM estimates WHERE id = $1 LIMIT 1`, [id]);
      if (estRes1.rows.length > 0) {
        const r = estRes1.rows[0];
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
        estRow = r; estData = { ...d, ...r };
      } else {
        const estRes2 = await pool.query(`SELECT * FROM generic_entities WHERE id = $1 AND LOWER(entity_type) = 'estimate' LIMIT 1`, [id]);
        if (estRes2.rows.length > 0) {
          const r = estRes2.rows[0];
          const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
          estRow = r; estData = { ...d };
        }
      }
      if (!estRow) { res.writeHead(404); res.end('Estimate not found'); return; }
      const estNum = estData.estimate_number || id.slice(-6);
      let company = {};
      const compId = estRow.company_id;
      if (compId) {
        const cRes = await pool.query(`SELECT * FROM companies WHERE id = $1 LIMIT 1`, [compId]);
        if (cRes.rows.length > 0) {
          const co = cRes.rows[0];
          const coData = typeof co.settings === 'string' ? JSON.parse(co.settings || '{}') : (co.settings || {});
          company = { ...coData, ...co };
        }
      }
      // A public link is authorized above against this saved estimate. Render it
      // with the same handler used for preview, download, and email rather than
      // maintaining a second, visually and financially divergent PDF template.
      const savedItems = estData.line_items || estData.items || [];
      if (savedItems.length && compId) {
        let selectedFormat = null;
        if (estData.format_id && estData.format_id !== '__professional_proposal__') {
          const formatResult = await pool.query(
            `SELECT data FROM generic_entities
             WHERE id = $1 AND LOWER(entity_type) = 'estimateformat'
               AND (company_id = $2 OR company_id IS NULL OR company_id = 'companysync_master_001')
             LIMIT 1`,
            [estData.format_id, compId],
          );
          selectedFormat = formatResult.rows[0]?.data || null;
        }
        const { getFunctionHandlers } = require('./db/prod-integrations.cjs');
        const handlers = await getFunctionHandlers();
        const pdfResult = await handlers.generateEstimatePDF({
          estimate: { ...estData, company_id: compId, line_items: savedItems },
          trusted_company: company,
          customerInfo: {
            customer_name: estData.customer_name,
            customer_phone: estData.customer_phone,
            customer_email: estData.customer_email,
            property_address: estData.property_address || estData.address,
            insurance_company: estData.insurance_company,
            claim_number: estData.claim_number,
            adjuster_name: estData.adjuster_name,
            adjuster_phone: estData.adjuster_phone,
            deductible: estData.deductible,
            notes: estData.notes,
          },
          format: selectedFormat || (estData.format && typeof estData.format === 'object' ? estData.format : { category: estData.category }),
          pdf_style: estData.format_id === '__professional_proposal__' ? 'professional_proposal' : estData.pdf_style,
          show_as_proposal: estData.show_as_proposal || false,
          returnBase64: true,
        }, null, {});
        if (!pdfResult?.base64) throw new Error('Estimate PDF renderer returned no PDF');
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="estimate-${String(estNum).replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`,
          'Cache-Control': 'no-cache',
        });
        res.end(Buffer.from(pdfResult.base64, 'base64'));
        return;
      }
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      let y = 20;
      const hexToRgb = (hex) => { const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return r ? { r: parseInt(r[1],16), g: parseInt(r[2],16), b: parseInt(r[3],16) } : { r: 30, g: 58, b: 138 }; };
      const primary = company.brand_primary_color ? hexToRgb(company.brand_primary_color) : { r: 30, g: 58, b: 138 };
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(primary.r, primary.g, primary.b);
      doc.text(company.company_name || company.name || 'Your Company', margin, y); y += 8;
      if (company.address) { doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(100,100,100); doc.text(company.address, margin, y); y += 5; }
      if (company.phone) { doc.text(company.phone, margin, y); y += 5; }
      if (company.email) { doc.text(company.email, margin, y); y += 5; }
      y += 5;
      doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(primary.r, primary.g, primary.b);
      doc.text(`${estData.show_as_proposal ? 'PROPOSAL' : 'ESTIMATE'} #${estNum}`, margin, y); y += 8;
      if (estData.supplement_of_number) {
        doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(200, 100, 0);
        doc.text(`Supplement to Estimate #${estData.supplement_of_number}`, margin, y); y += 6;
        doc.setTextColor(primary.r, primary.g, primary.b);
      }
      doc.setDrawColor(primary.r, primary.g, primary.b); doc.setLineWidth(0.5); doc.line(margin, y, pageWidth - margin, y); y += 8;
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(60,60,60);
      doc.text('Customer:', margin, y); doc.setFont('helvetica','normal');
      if (estData.customer_name) { doc.text(estData.customer_name, margin + 25, y); y += 5; }
      if (estData.property_address || estData.address) { doc.text(estData.property_address || estData.address, margin + 25, y); y += 5; }
      if (estData.customer_email) { doc.text(estData.customer_email, margin + 25, y); y += 5; }
      if (estData.customer_phone) { doc.text(estData.customer_phone, margin + 25, y); y += 5; }
      y += 8;
      const lineItems = estData.line_items || estData.items || [];
      if (lineItems.length > 0) {
        doc.setFillColor(primary.r, primary.g, primary.b); doc.rect(margin, y, pageWidth - 2*margin, 8, 'F');
        doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(9);
        doc.text('Description', margin+2, y+5.5); doc.text('Qty', pageWidth-80, y+5.5); doc.text('Unit Price', pageWidth-60, y+5.5); doc.text('Total', pageWidth-margin-15, y+5.5, { align:'right' });
        y += 10; doc.setTextColor(60,60,60); doc.setFont('helvetica','normal');
        for (const item of lineItems) {
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text(String(item.description || item.name || ''), margin+2, y);
          doc.text(String(item.quantity || item.qty || 1), pageWidth-80, y);
          doc.text(`$${parseFloat(item.unit_price || item.price || 0).toFixed(2)}`, pageWidth-60, y);
          doc.text(`$${parseFloat(item.total || item.amount || item.rcv || 0).toFixed(2)}`, pageWidth-margin-2, y, { align:'right' });
          y += 6;
        }
        y += 4; doc.setLineWidth(0.3); doc.setDrawColor(200,200,200); doc.line(margin, y, pageWidth-margin, y); y += 6;
      }
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(primary.r, primary.g, primary.b);
      const total = estData.total_rcv || estData.total || estData.total_amount || 0;
      doc.text('TOTAL:', pageWidth-70, y); doc.text(`$${parseFloat(total).toFixed(2)}`, pageWidth-margin-2, y, { align:'right' }); y += 10;
      if (estData.notes) {
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(60,60,60); doc.text('Notes:', margin, y); y += 5;
        doc.setFont('helvetica','normal');
        const lines = doc.splitTextToSize(estData.notes, pageWidth - 2*margin);
        for (const l of lines) { if (y > 280) { doc.addPage(); y = 20; } doc.text(l, margin, y); y += 4; }
      }
      const pdfBytes = doc.output('arraybuffer');
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="estimate-${estNum}.pdf"`, 'Cache-Control': 'no-cache' });
      res.end(Buffer.from(pdfBytes));
    } catch (err) {
      console.error('[publicEstimatePDF] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname.startsWith('/api/')) {
    console.warn(`[Server] 404 API route not found: ${req.method} ${pathname}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveStaticFile(req, res, filePath);
    return;
  }

  // Large app videos live in Replit Object Storage, not the app package
  // (they blew past the 8 GiB publish image limit). Redirect to a signed
  // GCS URL — GCS handles Range requests natively so playback/seek works.
  const videoMatch = pathname.match(/^\/(videos|generated_marketing_videos)\/([\w.\-() ]+\.mp4)$/);
  if (videoMatch) {
    try {
      const objStorage = require('./db/object-storage.cjs');
      const signed = await objStorage.getSignedUrl(`${videoMatch[1]}/${decodeURIComponent(videoMatch[2])}`, 'GET', 3600);
      res.writeHead(302, { Location: signed, 'Cache-Control': 'no-store' });
      res.end();
    } catch (e) {
      console.error('[videos] object storage redirect failed:', e.message);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Video not found');
    }
    return;
  }

  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    serveStaticFile(req, res, indexPath);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
  } catch (err) {
    if (err?.statusCode === 413) {
      if (!res.headersSent) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); }
    } else {
      console.error('[Server] Request handler error:', err.message, req.url);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Internal Server Error'); }
    }
  }
});

const twilioWss = new WebSocketServer({ noServer: true });
const lexiWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/ws/twilio')) {
    twilioWss.handleUpgrade(req, socket, head, ws => twilioWss.emit('connection', ws, req));
  } else if (req.url?.startsWith('/ws/lexi-native')) {
    lexiWss.handleUpgrade(req, socket, head, ws => lexiWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

const transferContextMap = new Map();

twilioWss.on('connection', async (twilioWs, req) => {
  console.log('[Sarah] Twilio media stream connected');
  const wsUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const wsScenario = wsUrl.searchParams.get('scenario') || '';
  let geminiWs = null;
  let currentStreamSid = null;
  let setupComplete = false;
  let waitingForOutboundGreeting = false;
  let outboundGreetingGateTimer = null;
  let callCompanyId = null;
  let callCompanyTimezone = 'America/New_York'; // set from crm.timezone after settings load
  let callerPhone = null;
  let customerLexiVoiceEnabled = false;
  let customerLexiAudit = null;
  let callSid = null;
  let callStartTime = Date.now();
  let conversationLog = [];
  let toolCallsMade = [];
  let collectedCallerName = null;
  let callLogSaved = false;
  let companyName = 'CompanySync';
  let assistantName = ASSISTANT_NAME;
  let isOutboundCall = false;
  let outboundLeadName = '';
  let outboundLeadService = '';
  let outboundLeadAddress = '';
  let outboundCampaign = null;
  let subscriberSystemPrompt = '';
  let companyDescription = '';
  let companyKnowledge = '';
  let callScreeningEnabled = false;
  let callScreeningInstructions = '';
  let callScreeningOutcome = null;
  let geminiKeepaliveInterval = null;
  let geminiReconnectAttempts = 0;
  let callTerminated = false;
  let typingInterval = null;       // setInterval handle for typing-sound loop
  let typingSoundsEnabled = false; // set from AssistantSettings.interim_audio + response_speed
  let responseSpeedSetting = 'normal'; // AssistantSettings.response_speed — also drives VAD tuning
  let subscriberGeminiModel = ''; // set from AssistantSettings.engine — overrides the hardcoded default
  let postToolNudgeTimer = null;   // watchdog: nudge only if Gemini stays silent after a tool response

  // --- STAFF PHONE MODE state (mirrored in vite-twilio-ws-plugin.js) ---
  // staffCandidate: caller ID matched an active staff profile WITH a voice
  // PIN set — the call runs the staff prompt + Lexi tool set, but every
  // tool stays LOCKED server-side until the PIN verifies (caller ID is
  // spoofable; the PIN is the real factor).
  let staffCandidate = null;        // { staffId, fullName, userEmail, timezone } | null
  let staffVerified = false;        // flipped ONLY by a successful verify_staff_pin
  let staffPinAttemptsThisCall = 0; // in-call cap (persistent lockout lives in DB)
  let staffLookupPromise = Promise.resolve(null);

  // --- Latency instrumentation (mirrored in vite-twilio-ws-plugin.js) ---
  // One line per milestone so slow calls can be diagnosed from logs alone:
  // stream start → settings loaded → Gemini open → setup complete → greeting → first audio,
  // plus per-turn caller→first-audio gaps and per-tool durations.
  let latT0 = Date.now();
  let latLast = latT0;
  let respPendingSince = 0;  // set when caller speech transcribed; cleared on first audio back
  let firstAudioSeen = false;
  const markLatency = (label) => {
    const now = Date.now();
    console.log(`[LATENCY][${callSid || currentStreamSid || 'pre-start'}] ${label}: +${now - latT0}ms (step ${now - latLast}ms)`);
    latLast = now;
  };
  let isForwardedCall = false;
  let isTransferReturn = false;
  let transferReturnRepName = '';
  let forwardedRepName = '';
  let forwardedRepEmail = '';
  let forwardedRepPhone = '';
  let callRoutingMode = 'sarah_answers';
  let staffCellPhone = '';
  let calledTwilioNumber = '';
  // Gemini routinely re-issues the SAME tool call many times in one turn (one
  // emergency call fired 19 identical send_alerts). Key the first in-flight
  // promise by tool name + args so the side effect happens once per call.
  // Mirrors vite-twilio-ws-plugin.js.
  const toolCallCache = createToolCallCache();
  // Tool calls inside one Gemini response run via Promise.all, so two
  // progressive lead saves could both miss the existing row and insert
  // duplicates. Serialise lead saves for the lifetime of the call.
  let leadSaveChain = Promise.resolve();
  // Scheduling is also serialized so Gemini cannot create two pending
  // inspection requests when it re-issues the same intent with slightly
  // different arguments.
  let appointmentScheduleChain = Promise.resolve();
  const schedulingState = { availabilityChecked: false, submitted: false };
  // Persistent id for the live (in-progress) communications row written
  // mid-call by upsertLiveCallRecord. Reused at hang-up so the same row
  // gets finalized to status='completed' instead of producing a duplicate.
  let liveCallCommId = null;

  let geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;

  // Write/refresh an in-progress communications row so the dashboard's
  // recent-calls list can show the captured caller name in real time
  // (the Communication page polls every ~10s). Safe to call repeatedly:
  // the first call inserts the row, subsequent calls UPDATE the same id.
  async function upsertLiveCallRecord(status) {
    if (!callCompanyId) return;
    if (!liveCallCommId) {
      liveCallCommId = `comm_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    }
    try {
      const pool = prodDb.getPool();
      const callerName = collectedCallerName || outboundLeadName || 'Voice Caller';
      const callDirection = isForwardedCall ? 'forwarded' : (isOutboundCall ? 'outbound' : 'inbound');
      const dur = Math.round((Date.now() - callStartTime) / 1000);
      const durMins = dur > 0 ? Math.max(1, Math.round(dur / 60)) : null;
      const transcript = conversationLog.map(e => `${e.role}: ${e.text}`).join('\n');
      const extraData = {
        call_sid: callSid || '',
        twilio_sid: callSid || '',
        transcription: transcript,
        transcript: transcript,
        assistant_name: assistantName,
        tool_calls_made: toolCallsMade,
        source: 'ai_voice',
        live: status === 'in_progress',
        screening_outcome: callScreeningOutcome || null,
      };
      await pool.query(
        `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, contact_name, status, duration_minutes, data, created_at, updated_at)
         VALUES ($1,$2,'call','call',$3,$4,$5,$6,$7,$8::jsonb, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           direction = EXCLUDED.direction,
           contact_phone = EXCLUDED.contact_phone,
           contact_name = EXCLUDED.contact_name,
           status = EXCLUDED.status,
           duration_minutes = COALESCE(EXCLUDED.duration_minutes, communications.duration_minutes),
           data = communications.data || EXCLUDED.data,
           updated_at = NOW()`,
        [liveCallCommId, callCompanyId, callDirection, callerPhone || 'Unknown', callerName, status, durMins, JSON.stringify(extraData)]
      );
      broadcastLiveCallUpdate(callCompanyId, { commId: liveCallCommId, status, callerName, callerPhone: callerPhone || 'Unknown' });
    } catch (e) {
      console.warn('[Sarah] upsertLiveCallRecord failed:', e.message);
    }
  }

  async function saveCallToBase44() {
    if (callLogSaved) return;
    callLogSaved = true;
    // Push a completed status via SSE so the dashboard updates instantly on hang-up
    upsertLiveCallRecord('completed').catch(() => {});
    const dur = Math.round((Date.now() - callStartTime) / 1000);
    // Collapse the many tiny same-role chunks Gemini emits into clean turns.
    const transcript = buildCleanTranscript(conversationLog);
    // Diagnostic (counts only, never caller content): confirms transcription capture worked.
    console.log(`[${assistantName}] saveCallLog: ${conversationLog.length} log entries, ${transcript.length} transcript chars, ${dur}s, tools=${Array.isArray(toolCallsMade) ? toolCallsMade.length : 0}`);
    const callDirection = isForwardedCall ? 'forwarded' : (isOutboundCall ? 'outbound' : 'inbound');
    const callerDisplayName = collectedCallerName || outboundLeadName || 'Voice Caller';
    if (!liveCallCommId) liveCallCommId = `comm_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const commId = liveCallCommId;
    try {
      await callBase44API('saveCallLog', callCompanyId, { comm_id: commId, caller_phone: callerPhone || 'Unknown', caller_name: callerDisplayName, duration_seconds: dur, transcript, call_sid: callSid || '', tool_calls_made: toolCallsMade, assistant_name: assistantName, direction: callDirection, screening_outcome: callScreeningOutcome || null });
      await callBase44API('trackCallMinutes', callCompanyId, { duration_seconds: dur });
      billAIUsage(callCompanyId, Math.max(1, Math.ceil(dur / 60)));
      logUsageEvent(callCompanyId, 'sarah', Math.max(1, Math.ceil(dur / 60))).catch(() => {});
    } catch (err) { console.error('[Sarah] Save failed:', err.message); }

    // Best-effort post-call synopsis. The Communication is ALREADY saved above;
    // this only patches it in place and can never block or fail the call log.
    if (commId && transcript) {
      (async () => {
        try {
          const synth = await generateCallSynopsis(transcript, geminiApiKey);
          if (!synth) return;
          const sPool = prodDb.getPool();
          const patch = {
            call_summary: synth.call_summary,
            call_synopsis: synth.call_synopsis,
            ai_analyzed: true,
            ai_summary_generated_at: new Date().toISOString(),
          };
          await sPool.query(
            `UPDATE communications SET data = data || $2::jsonb, updated_at = NOW() WHERE id = $1`,
            [commId, JSON.stringify(patch)]
          );
          console.log(`[${assistantName}] Call synopsis saved for ${commId}`);
        } catch (e) {
          console.warn(`[${assistantName}] Synopsis generation failed:`, e.message);
        }
      })();
    }

    // Send post-call notifications (non-blocking)
    if (dur >= 5) {
      sendPostCallNotifications(callCompanyId, {
        callerPhone: callerPhone || 'Unknown',
        callerName: callerDisplayName,
        transcript,
        durationSeconds: dur,
        commId,
        repName: forwardedRepName || '',
        repEmail: forwardedRepEmail || '',
        repCell: staffCellPhone || forwardedRepPhone || '',
        companyName,
        assistantName,
        callDirection,
        toolCallsMade,
        callSid: callSid || '',
      }).catch(e => console.error('[Sarah] Post-call notifications failed:', e.message));
    }
  }

  try {
    const companyKey = await prodDb.getCompanyGeminiKey(callCompanyId);
    if (companyKey) geminiApiKey = companyKey;
  } catch (e) { console.error('[Sarah] BYOK key lookup failed:', e.message); }
  if (!geminiApiKey) { console.error('[Sarah] No API key'); twilioWs.close(); return; }

  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;

  const MAX_GEMINI_RECONNECTS = 3;

  // Calm, professional hand-off used ONLY after we've exhausted reconnect attempts.
  // Plays a courteous message, flags a follow-up for staff, and saves the call.
  function gracefulHandoff(closeCode) {
    if (callTerminated) { saveCallToBase44(); return; }
    callTerminated = true;
    console.log(`[${assistantName}] Gemini connection lost after ${geminiReconnectAttempts} reconnect attempt(s) (code=${closeCode}) — graceful hand-off to a human`);

    // 1) Play a calm message to the caller (needs Twilio creds + an open line).
    //    Prefer the subscriber's own Twilio creds (BYO-Twilio); fall back to platform creds.
    try {
      const cachedSub = calledTwilioNumber ? getCachedSubscriber(calledTwilioNumber) : null;
      const twilioSid = (cachedSub && cachedSub.twilioSid) || process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = (cachedSub && cachedSub.twilioToken) || process.env.TWILIO_AUTH_TOKEN;
      if (twilioSid && twilioToken && callSid && twilioWs.readyState === WebSocket.OPEN) {
        const handoffMsg = "I'm so sorry — it looks like our connection just cut out. Let me have someone from our team give you a call right back. Thanks so much for your patience.";
        const twiml = `<Response><Say voice="Polly.Joanna">${handoffMsg}</Say><Hangup/></Response>`;
        const updateUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls/${callSid}.json`;
        const authB64 = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        fetch(updateUrl, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${authB64}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `Twiml=${encodeURIComponent(twiml)}`
        }).catch(e => console.error('[Sarah] Hand-off TwiML update failed:', e.message));
      } else {
        console.warn('[Sarah] Hand-off: no Twilio creds or line already closed — skipped caller message');
      }
    } catch (handoffErr) {
      console.error('[Sarah] Hand-off caller-message error:', handoffErr.message);
    }

    // 2) ALWAYS file a staff follow-up when we know the company, even if the caller
    //    message couldn't be played, so an unrecoverable drop is never silent.
    if (callCompanyId) {
      try {
        const notifId = `notif_bailout_${Date.now()}`;
        const pool = prodDb.getPool();
        pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [notifId, callCompanyId, JSON.stringify({
            id: notifId,
            company_id: callCompanyId,
            type: 'ai_bailout',
            title: `${assistantName} lost connection during a call`,
            message: `${assistantName}'s connection dropped during a call${collectedCallerName ? ' with ' + collectedCallerName : ''}${callerPhone ? ' (' + callerPhone + ')' : ''} and couldn't recover. The caller was told someone would call them right back — please follow up.`,
            is_read: false,
            priority: 'high',
            created_at: new Date().toISOString()
          })]
        ).catch(e => console.error('[Sarah] Hand-off notification DB save failed:', e.message));
      } catch (notifErr) {
        console.error('[Sarah] Hand-off notification error:', notifErr.message);
      }
    }

    saveCallToBase44();
  }

  async function connectGemini(isReconnect = false) {
    const currentSettings = loadSettings();
    let voiceName = currentSettings.voice || 'Kore';

    let inboundGreeting = '';
    let callTransferInstructions = '';
    let spokenBrand = ''; // letter-by-letter / override pronunciation

    // Latency: run the CRM-settings load, the caller-history lookup, and the
    // Gemini WebSocket handshake IN PARALLEL. Previously each step waited for
    // the one before it (settings → socket → setup → history → greeting),
    // and every millisecond of that chain was dead air for the caller.
    const historyPromise = (!isReconnect && callerPhone && callCompanyId)
      ? (async () => {
          try {
            // NOTE: no `pool` exists in this scope chain — the old greeting-time
            // lookup referenced a bare `pool` and ALWAYS threw (swallowed by its
            // catch), so prod never actually recognized returning callers.
            const histPool = prodDb.getPool();
            const lookup = await lookupCallerByCrmPhone(histPool, callCompanyId, callerPhone);
            let lastComm = null;
            if (lookup?.source === 'crm_lead' && lookup.record && lookup.name) {
              try {
                const commResult = await histPool.query(
                  `SELECT * FROM communications WHERE company_id = $1 AND lead_id = $2 ORDER BY created_at DESC LIMIT 3`,
                  [callCompanyId, lookup.record.id || '']
                );
                lastComm = commResult.rows[0] || null;
              } catch (_) {}
            }
            return { ...lookup, lastComm };
          } catch (e) {
            console.log(`[Sarah] No prior history found for ${callerPhone}`);
            return null;
          }
        })()
      : Promise.resolve(null);

    const settingsApplied = (async () => {
    if (callCompanyId) {
      try {
        const crm = await callBase44API('getSettings', callCompanyId);
        const rawDisplay = (crm.settings?.intent_templates?._assistant_display_name || '').trim();
        const rawAssistant = (crm.settings?.assistant_name || '').trim();
        const rawBrand = (crm.settings?.brand_short_name || '').trim();
        if (rawBrand) companyName = rawBrand; else if (crm.companyName) companyName = crm.companyName;
        assistantName = resolveAssistantName(rawDisplay, rawAssistant);
        customerLexiVoiceEnabled = false;
        try {
          const customerChannels = await getVerifiedLexiChannels(prodDb.getPool(), callCompanyId);
          customerLexiVoiceEnabled = !isOutboundCall
            && customerChannels.voice
            && canonicalPhone(calledTwilioNumber) === customerChannels.phone;
          if (customerLexiVoiceEnabled) assistantName = 'Lexi';
        } catch (lexiError) {
          console.warn('[Lexi Customer Voice] Could not verify this inbound phone route:', lexiError.message);
        }
        if (crm.settings?.voice_id && VALID_GEMINI_VOICES.includes(crm.settings.voice_id)) voiceName = crm.settings.voice_id;
        else if (crm.settings?.voice && VALID_GEMINI_VOICES.includes(crm.settings.voice)) voiceName = crm.settings.voice;
        if (crm.customSystemPrompt) subscriberSystemPrompt = crm.customSystemPrompt;
        if (crm.transferInstructions) callTransferInstructions = crm.transferInstructions;
        if (crm.screeningEnabled) { callScreeningEnabled = true; callScreeningInstructions = crm.screeningInstructions || ''; console.log('[Sarah] Call screening ENABLED'); }
        if (crm.knowledgeBase) {
          // Warn when the knowledge base text mentions a different name — this is a
          // common source of the AI introducing itself by the wrong name on live calls.
          const kbNameMatch = crm.knowledgeBase.match(/\b(?:I(?:'m| am)|[Mm]y name is)\s+([A-Z][a-z]{2,14})\b/);
          if (kbNameMatch && kbNameMatch[1]?.toLowerCase() !== assistantName.toLowerCase()) {
            console.warn(`[Sarah] ⚠️  Knowledge base contains name "${kbNameMatch[1]}" but assistant is configured as "${assistantName}" — this may cause the AI to introduce itself by the wrong name. Update the "What ${assistantName} knows" field to remove or correct any first-person name references.`);
          }
          companyKnowledge = crm.knowledgeBase;
        }
        if (crm.companyDescription) companyDescription = crm.companyDescription;
        if (crm.companyServices) companyDescription += '\nServices: ' + crm.companyServices;
        if (crm.timezone) callCompanyTimezone = crm.timezone;
        if (crm.settings?.inbound_greeting) inboundGreeting = crm.settings.inbound_greeting;
        spokenBrand = deriveSpokenBrandName(crm.settings?.spoken_name, companyName);
        if (spokenBrand && spokenBrand !== companyName) console.log(`[Sarah] Spoken brand name: "${spokenBrand}"`);
        // Wire the typing-sound preference into the call pipeline
        const rawInterimAudio = crm.settings?.interim_audio || currentSettings.interim_audio || 'typing';
        const rawResponseSpeed = crm.settings?.response_speed || currentSettings.response_speed || 'normal';
        responseSpeedSetting = ['fast', 'normal', 'relaxed'].includes(rawResponseSpeed) ? rawResponseSpeed : 'normal';
        typingSoundsEnabled = rawInterimAudio === 'typing' && rawResponseSpeed === 'normal';
        console.log(`[Sarah] Typing sounds: ${typingSoundsEnabled} (interim_audio=${rawInterimAudio}, response_speed=${rawResponseSpeed})`);
        // Wire the AI Engine setting into the call model (only native-audio models are valid here)
        const rawEngine = crm.settings?.engine || currentSettings.engine || '';
        if (rawEngine && isAllowedGeminiLiveEngine(rawEngine)) {
          subscriberGeminiModel = geminiLiveModel(rawEngine);
          console.log(`[Sarah] Engine override: ${subscriberGeminiModel}`);
        }
      } catch (e) { console.warn('[Sarah] CRM load failed:', e.message); }
    }

    if (!VALID_GEMINI_VOICES.includes(voiceName)) { console.warn(`[Sarah] Invalid voice "${voiceName}", using Kore`); voiceName = 'Kore'; }
    console.log(`[Sarah] Connecting Gemini: voice=${voiceName}, company=${companyName}, assistant=${assistantName}`);
    })();

    // Open the Gemini socket NOW — the WS/TLS handshake runs while the
    // settings queries above are still in flight. The 'open' handler
    // awaits settingsApplied before building the setup payload.
    if (callTerminated || twilioWs.readyState !== WebSocket.OPEN) {
      console.log('[Sarah] Caller gone before (re)connecting to Gemini — aborting connect');
      saveCallToBase44();
      return;
    }

    // Reset the setup gate so caller audio is NOT forwarded to the new socket until its
    // OWN setupComplete arrives — critical on reconnect, where it is already true.
    setupComplete = false;
    geminiWs = new WebSocket(geminiUrl);
    const thisWs = geminiWs; // guard against reconnects swapping the socket mid-handshake

    geminiWs.on('open', async () => {
      markLatency('gemini_ws_open');
      // Settings usually resolve before the TLS handshake finishes; if not,
      // this is the only remaining wait before setup can be sent.
      try { await settingsApplied; } catch (_) {}
      markLatency('settings_ready');

      // The caller may have hung up while the settings load was running —
      // don't send setup on an orphan socket (close handler does cleanup).
      if (callTerminated || twilioWs.readyState !== WebSocket.OPEN || thisWs !== geminiWs || thisWs.readyState !== WebSocket.OPEN) {
        console.log(`[${assistantName}] Caller gone (or socket replaced) before Gemini setup — skipping`);
        try { thisWs.close(); } catch (_) {}
        return;
      }

      // STAFF PHONE MODE: if the caller ID matched a staff profile with a
      // voice PIN, install the lean staff prompt + Lexi tool set instead of
      // the customer-facing script. The prompt deliberately carries NO
      // customer/knowledge data — the caller is unverified until the PIN
      // check passes, and all data flows through server-gated tools.
      if (!isReconnect) {
        try { staffCandidate = await staffLookupPromise; } catch (_) { staffCandidate = null; }
      }
      if (staffCandidate) {
        console.log(`[${assistantName}][StaffMode] Caller ID matched staff "${staffCandidate.fullName}" (${staffCandidate.userEmail}) — PIN verification required`);
      }

      const forwardedInfo = isForwardedCall ? { isForwarded: true, repName: forwardedRepName, repEmail: forwardedRepEmail, repPhone: forwardedRepPhone } : null;
      let prompt = buildSystemPrompt(companyName, assistantName, isOutboundCall, outboundLeadName, outboundLeadService, subscriberSystemPrompt, companyDescription, companyKnowledge, forwardedInfo, callRoutingMode, wsScenario, callTransferInstructions, callScreeningEnabled, callScreeningInstructions);
      // Universal voice/behavior rules — appended AFTER every prompt branch
      // (default, forwarded, outbound, AND custom subscriber prompts) so the
      // live-phone conversational style is guaranteed regardless of prompt source.
      // Keep IDENTICAL to the copy in vite-twilio-ws-plugin.js (dev/prod lockstep).
      prompt += `\n\nVOICE & BEHAVIOR RULES (always apply):
1. BREVITY: Keep every response to 1 to 2 short sentences. Never give long speeches or bulleted lists.
2. NATURAL FLOW: Speak like a real person over the phone. Use natural, conversational language (e.g., "Gotcha," "Makes sense," "No problem").
3. ONE QUESTION AT A TIME: When you need information, end your turn with a single, clear question, then STOP speaking and wait for the caller to reply. Never stack questions.
4. HANDLING INTERRUPTIONS: If the caller cuts in or speaks over you, stop immediately and address what they just said.
5. INTENT: Be helpful, direct, and focused on guiding the conversation to the next step without sounding rigid or scripted.
6. INSPECTION SAFETY: Before requesting an inspection, collect the caller's full name, callback number, complete property address, exact date, and exact time. Read all five items back and ask for a clear confirmation. Never treat "tomorrow morning" or another vague period as a time, never invent a time, and never claim the appointment is confirmed.
7. CALENDAR CHECK: For an inspection, call check_availability before schedule_inspection and only offer times returned by that tool. If the caller changes the time, check availability again.
8. LEAD RECORD: Save the caller's name, phone, email when provided, address, service need, and scheduling details with save_lead_details. The caller's phone is the callback number unless they provide a different one.
9. APPROVAL LANGUAGE: schedule_inspection submits a request for staff approval; it does not create a calendar event. Tell the caller the request was sent to the team for confirmation, not that they are booked.
10. DUPLICATES: Do not call schedule_inspection more than once for the same confirmed request.`;

      if (customerLexiVoiceEnabled && !staffCandidate) {
        prompt = `You are Lexi, ${companyName}'s AI project update assistant, not its COO or a human employee. Say that you are an AI assistant in your opening.

You may only answer customer project questions with a successful get_customer_public_progress result from this same call. Never use caller claims, old call history, company knowledge, or assumptions as proof. Read the server-provided voice_script exactly, without adding details or paraphrasing.

The tool is limited to one uniquely phone-matched customer and returns only that customer's current milestone and updates explicitly published for homeowners. Never disclose or infer money, insurance or adjuster details, internal notes, tasks, crew or schedule information, unpublished photos, addresses, or another customer's records. Do not accept customer or project IDs.

If a property selection is needed, ask for the exact address and use only the address the caller gives. If identity, project selection, or lookup fails, say you could not safely verify the information and offer a callback. Use request_customer_callback only when the caller asks for a person or accepts a callback.

Keep responses brief, conversational, and in the caller's language.`;
      }

      // STAFF PHONE MODE: replace the whole customer prompt with the lean
      // staff prompt (it carries its own voice/behavior rules and NO
      // customer data). Keep IDENTICAL semantics in vite-twilio-ws-plugin.js.
      if (staffCandidate) {
        prompt = buildStaffPhonePrompt(companyName, assistantName, staffCandidate.fullName, staffCandidate.timezone);
      }

      // Turn-taking speed follows the subscriber's response_speed setting.
      // silence_duration_ms is how long Gemini waits after the caller stops
      // talking before it starts answering — the single biggest lever on
      // perceived response lag. START stays LOW in all modes: phone lines
      // carry noise + echo of the assistant's own voice, and high start
      // sensitivity makes Gemini "hear" speech nobody said.
      const VAD_BY_SPEED = {
        fast:    { end: 'END_SENSITIVITY_HIGH', silenceMs: 400 },
        normal:  { end: 'END_SENSITIVITY_LOW',  silenceMs: 900 },
        relaxed: { end: 'END_SENSITIVITY_LOW',  silenceMs: 1400 },
      };
      const vad = VAD_BY_SPEED[responseSpeedSetting] || VAD_BY_SPEED.normal;
      console.log(`[${assistantName}] VAD tuning: speed=${responseSpeedSetting}, end=${vad.end}, silence=${vad.silenceMs}ms`);

      thisWs.send(JSON.stringify({
        setup: applyTwilioLineProfile({
          // Gemini 3.8 Live is the default. A saved allowed engine wins.
          model: subscriberGeminiModel || geminiLiveModel(),
          generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voiceName } } } },
          input_audio_transcription: {},
          output_audio_transcription: {},
          realtime_input_config: {
            automatic_activity_detection: {
              disabled: false,
              start_of_speech_sensitivity: "START_SENSITIVITY_LOW",
              end_of_speech_sensitivity: vad.end,
              prefix_padding_ms: 100,
              silence_duration_ms: vad.silenceMs
            }
          },
          system_instruction: { parts: [{ text: applySpokenCompanyName(prompt, companyName, spokenBrand) }] },
          // Staff callers get Lexi's full CRM tool set + the PIN gate;
          // execution stays LOCKED server-side until the PIN verifies.
          tools: [{ function_declarations: staffCandidate
            ? [VERIFY_STAFF_PIN_TOOL, ...LEXI_CRM_TOOLS]
            : customerLexiVoiceEnabled
              ? CUSTOMER_LEXI_VOICE_TOOLS
              : (callRoutingMode === 'sarah_only' ? CRM_TOOLS.filter(t => t.name !== 'transfer_call') : CRM_TOOLS) }]
        }, !isOutboundCall ? calledTwilioNumber : '')
      }));
      markLatency('gemini_setup_sent');
    });

    geminiWs.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.setupComplete) {
          // If the caller hung up during the Gemini handshake, don't start a keepalive on
          // an orphan socket — close it and bail.
          if (callTerminated || twilioWs.readyState !== WebSocket.OPEN) {
            console.log(`[${assistantName}] Caller gone by Gemini setupComplete — closing orphan socket`);
            try { geminiWs.close(); } catch (_) {}
            saveCallToBase44();
            return;
          }
          setupComplete = true;
          console.log(`[${assistantName}] Gemini setup complete, sending greeting (outbound: ${isOutboundCall}, forwarded: ${isForwardedCall})...`);

          if (geminiKeepaliveInterval) clearInterval(geminiKeepaliveInterval);
          geminiKeepaliveInterval = setInterval(() => {
            if (geminiWs?.readyState === WebSocket.OPEN) {
              geminiWs.send(JSON.stringify({ realtime_input: { audio: { data: Buffer.alloc(320).toString('base64'), mimeType: "audio/pcm;rate=16000" } } }));
            } else {
              clearInterval(geminiKeepaliveInterval);
            }
          }, 5000);

          // Mid-call reconnect: the connection briefly dropped and we re-established it.
          // Skip the full greeting/caller-lookup and just smoothly resume the conversation.
          if (isReconnect) {
            console.log(`[${assistantName}] Gemini reconnected mid-call (attempt ${geminiReconnectAttempts}) — resuming without re-greeting`);
            if (geminiWs?.readyState === WebSocket.OPEN) {
              geminiWs.send(JSON.stringify({ client_content: { turns: [{ role: "user", parts: [{ text: "[System: The audio connection briefly dropped and just reconnected. In ONE short, calm sentence, apologize for the brief cut-out and invite them to continue (for example: \"Sorry about that — I lost you for a second there. Please go ahead.\"). Do NOT re-introduce yourself or restart the conversation.]" }] }], turn_complete: true } }));
            }
            return;
          }

          markLatency('gemini_setup_complete');

          // Caller-history: the lookup was ALREADY started in parallel back in
          // connectGemini. Give it a short window to land so the greeting can
          // use the caller's name; if it's slower than that, greet generically
          // NOW and inject the context silently once it arrives (better a fast
          // generic greeting than dead air).
          const applyCallerContext = (h, isLate) => {
            if (!h) {
              console.log(`[${assistantName}] No CRM record found for ${callerPhone} — caller is unknown`);
              return '';
            }
            const { name: foundName, source, record, lastComm } = h;
            if (foundName) {
              collectedCallerName = foundName;
              upsertLiveCallRecord('in_progress');
            }
            if (source === 'crm_lead' && record) {
              // Build rich greeting context from the CRM lead record
              if (!foundName) {
                console.log(`[${assistantName}] CRM lead found but name missing for ${callerPhone} — caller is unknown`);
                return '';
              }
              let ctx = `\n\nRETURNING CALLER CONTEXT: This caller (${callerPhone}) is ${foundName}. `;
              if (lastComm) ctx += `Last interaction: ${lastComm.type || 'contact'} on ${lastComm.date || lastComm.created_date || 'unknown date'}. `;
              if (record.service_needed || record.service_type) ctx += `They previously inquired about: ${record.service_needed || record.service_type}. `;
              if (record.notes) ctx += `Notes: ${record.notes}. `;
              if (!isLate) ctx += `Greet them by name and reference your prior conversation. Don't ask for info you already have.`;
              console.log(`[${assistantName}] Returning CRM lead detected: ${foundName}`);
              return ctx;
            }
            if (foundName) {
              const label = source === 'customer' ? 'customer' : 'lead';
              console.log(`[${assistantName}] Returning ${label} detected: ${foundName}`);
              return `\n\nCALLER CONTEXT: This caller is a known ${label} named ${foundName}.${isLate ? '' : ' Greet them by first name.'}`;
            }
            console.log(`[${assistantName}] No CRM record found for ${callerPhone} — caller is unknown`);
            return '';
          };

          let returningLeadContext = '';
          let historyStillPending = false;
          if (callerPhone && callCompanyId) {
            const HISTORY_WAIT_MS = 250;
            const raced = await Promise.race([
              historyPromise,
              new Promise(resolve => setTimeout(() => resolve('__HISTORY_PENDING__'), HISTORY_WAIT_MS)),
            ]);
            if (raced === '__HISTORY_PENDING__') {
              historyStillPending = true;
              console.log(`[${assistantName}] Caller history not ready within ${HISTORY_WAIT_MS}ms — greeting now, will inject context when it lands`);
            } else {
              returningLeadContext = applyCallerContext(raced, false);
            }
          }

          const callerIsUnknown = !collectedCallerName && !isOutboundCall && !isTransferReturn;
          const unknownCallerInstruction = callerIsUnknown
            ? '\n\nNAME CAPTURE: This caller has no CRM record and their name is unknown. If they introduce themselves or mention their name at any point during the conversation, immediately call the collect_caller_name tool with their name so the call log shows who you spoke with instead of "Voice Caller". Capture the name passively whenever they say it — do not interrupt them or pepper them with the question. SOFT PROMPT (one-time only): If the conversation has gone on for several back-and-forth exchanges (roughly 4+ turns) and the caller still has not offered their name, you may ask once, naturally and conversationally, something like "By the way, who am I speaking with?" or "Sorry, I didn\'t catch your name — what should I call you?". Choose a calm moment (e.g. after wrapping up a topic, before moving to the next question, or while confirming details) — never interrupt them mid-sentence, never ask during an emotional or urgent moment (e.g. they\'re upset, describing damage, or in a hurry), and never ask if they have already declined to share or said they\'d rather not. If they don\'t answer or deflect, drop it and do not ask again for the rest of the call. As soon as they tell you their name, call collect_caller_name immediately.'
            : '';

          let greetingText;
          const TOOL_FALLBACK_REMINDER = ' If any CRM tool fails, say a brief warm fallback line and keep the conversation moving — never go silent or repeat yourself.';

          if (staffCandidate) {
            // STAFF PHONE MODE greeting: short, by first name, straight to the
            // PIN challenge. Never use the customer greeting or returning-lead
            // context — the caller is unverified until the PIN check passes.
            const staffFirstName = (staffCandidate.fullName || '').split(' ')[0] || 'there';
            greetingText = `An internal team member's phone number just called (matched to ${staffCandidate.fullName}). Greet them VERY briefly by first name ("Hey ${staffFirstName}!") and ask for their voice PIN to unlock CRM access. Keep it to one short sentence. Do not reveal any business information until they are verified.`;
          } else if (customerLexiVoiceEnabled && !isOutboundCall) {
            greetingText = `A homeowner has reached ${companyName}'s customer assistant. Introduce yourself as Lexi, clearly say you are an AI project update assistant, and ask how you can help with their project. Do not share project information until get_customer_public_progress returns a successful result.`;
          } else if (isTransferReturn) {
            let transferContext = '';
            if (callerPhone) {
              const key = callerPhone.replace(/\D/g, '').slice(-10);
              const saved = transferContextMap.get(key);
              if (saved) {
                transferContext = `\n\nPRIOR CONVERSATION (you were JUST speaking with this person before the transfer attempt):\n${saved.transcript}\n\nThe caller's name is: ${saved.callerName || 'unknown'}. You tried to transfer them to ${saved.repName || transferReturnRepName || 'a representative'} but they didn't pick up.`;
                if (saved.callerName) {
                  collectedCallerName = saved.callerName;
                  upsertLiveCallRecord('in_progress');
                }
                transferContextMap.delete(key);
                console.log(`[${assistantName}] Loaded transfer context for returning caller (${saved.transcript.length} chars)`);
              }
            }
            greetingText = `You are ${assistantName}, an AI assistant for ${companyName}. You were JUST speaking with this caller moments ago. The transfer to ${transferReturnRepName || 'the representative'} did not go through — they didn't answer or are not available right now.${transferContext}${returningLeadContext}\n\nIMPORTANT: Do NOT greet them like a new caller and do NOT re-introduce yourself. Your VERY FIRST words must acknowledge the failed transfer naturally — something like: "Hey, I'm back — ${transferReturnRepName || 'they'} isn't picking up right now. I can take a message for ${transferReturnRepName ? 'them' : 'the team'} and make sure they get back to you — what would you like me to pass along, and what's the best number for them to reach you?" Do NOT re-ask for their name or any info you already have. Once you have their message and callback number, call save_lead_details with a note summarizing the message (e.g. "Caller left message for ${transferReturnRepName || 'rep'}: [their message]. Best callback: [number]."), then call notify_rep to send ${transferReturnRepName || 'the rep'} an SMS so they know to follow up immediately.${TOOL_FALLBACK_REMINDER}`;
          } else if (isForwardedCall && callRoutingMode === 'sarah_then_transfer') {
            greetingText = `A customer just called ${forwardedRepName}'s line. Greet them warmly as ${assistantName} with ${companyName}, answering for ${forwardedRepName}. Your goal is to: 1) Get their name, phone number, and what they need help with. 2) Save their info using save_lead_details (assign to ${forwardedRepName}). 3) Once you have their info, tell them you'll connect them with ${forwardedRepName} now and call transfer_call. Keep the conversation brief and focused on gathering info before transferring. Remember your name is ${assistantName}.${returningLeadContext}`;
          } else if (isForwardedCall) {
            greetingText = `A customer just called ${forwardedRepName}'s line and it was forwarded to you. Greet them warmly as ${assistantName} with ${companyName}, answering for ${forwardedRepName}. Remember your name is ${assistantName}. Any leads from this call should be assigned to ${forwardedRepName}.${returningLeadContext}${unknownCallerInstruction}`;
          } else if (isOutboundCall) {
            if (outboundCampaign && outboundCampaign.intro) {
              const replaceVars = (t) => (t || '').replace(/\{agent\}/g, assistantName).replace(/\{brand\}/g, companyName).replace(/\{lead_name\}/g, outboundLeadName || 'the homeowner').replace(/\{lead_service\}/g, outboundLeadService || 'their inquiry');
              const campaignIntro = replaceVars(outboundCampaign.intro);
              const campaignPoints = outboundCampaign.points ? `\n\nTALKING POINTS:\n${replaceVars(outboundCampaign.points)}` : '';
              const campaignGoals = outboundCampaign.goals ? `\n\nGOALS: ${outboundCampaign.goals}` : '';

              let campaignTraining = '';
              if (outboundCampaign.campaign_system_prompt) campaignTraining += `\n\nCAMPAIGN SYSTEM PROMPT:\n${outboundCampaign.campaign_system_prompt}`;
              if (outboundCampaign.knowledge_base) campaignTraining += `\n\nCAMPAIGN KNOWLEDGE BASE:\n${outboundCampaign.knowledge_base}`;
              if (outboundCampaign.tone_style) {
                const toneMap = { warm_empathetic: 'Be warm, caring, and empathetic. Show genuine concern.', professional: 'Be polished and professional.', casual_friendly: 'Be casual and friendly, like talking to a neighbor.', direct_confident: 'Be direct and confident without being pushy.' };
                campaignTraining += `\n\nTONE: ${toneMap[outboundCampaign.tone_style] || ''}`;
              }
              if (outboundCampaign.humor_level !== undefined) campaignTraining += ` Humor level: ${outboundCampaign.humor_level}% (${outboundCampaign.humor_level < 20 ? 'very serious' : outboundCampaign.humor_level < 50 ? 'light' : 'witty'}).`;
              if (outboundCampaign.example_conversations?.length > 0) {
                campaignTraining += '\n\nEXAMPLE CONVERSATIONS:';
                outboundCampaign.example_conversations.forEach((ex, i) => { campaignTraining += `\n--- Example ${i+1} ---\nCustomer: "${ex.customer}"\nYou: "${ex.sarah}"`; });
              }
              if (outboundCampaign.objection_handling?.length > 0) {
                campaignTraining += '\n\nOBJECTION HANDLING:';
                outboundCampaign.objection_handling.forEach(oh => { campaignTraining += `\nIf they say: "${oh.objection}" → Respond: "${oh.response}"`; });
              }
              if (outboundCampaign.dos?.length > 0) campaignTraining += '\n\nDO: ' + outboundCampaign.dos.join('; ');
              if (outboundCampaign.donts?.length > 0) campaignTraining += '\nDO NOT: ' + outboundCampaign.donts.join('; ');
              if (outboundCampaign.bailout_message) campaignTraining += `\n\nBAILOUT SCRIPT: If the conversation stalls or the lead becomes unresponsive, say: "${outboundCampaign.bailout_message}"`;


              let aiIdLine = '';
              if (outboundCampaign.ai_identification) aiIdLine = `\n\nAI DISCLOSURE: ${outboundCampaign.ai_identification_text || 'If asked, honestly tell them you are an AI assistant.'}`;

              let customGreetingLine = '';
              if (outboundCampaign.custom_greeting) customGreetingLine = `\n\nCUSTOM OPENING LINE: Use this greeting: "${replaceVars(outboundCampaign.custom_greeting)}"`;

              greetingText = `You are making an outbound call to ${outboundLeadName || 'a potential customer'}. ${campaignIntro}${aiIdLine}${customGreetingLine}${campaignPoints}${campaignGoals}${campaignTraining}\n\nRemember your name is ${assistantName}. Start the conversation now.`;
            } else {
              greetingText = `You are making an outbound call to ${outboundLeadName || 'a potential customer'}${outboundLeadService ? ' who inquired about ' + outboundLeadService : ''}. Introduce yourself as ${assistantName}, an AI assistant from ${companyName}, and ask if you're speaking with ${outboundLeadName || 'the homeowner'}. You MUST mention you are an AI assistant in your opening line. Then continue the conversation naturally. Remember your name is ${assistantName}.`;
            }
          } else {
            const inboundReplaceVars = (t) => (t || '').replace(/\{agent\}/g, assistantName).replace(/\{brand\}/g, companyName);
            if (inboundGreeting) {
              greetingText = `A customer just called. Use this custom opening: "${inboundReplaceVars(inboundGreeting)}". You MUST identify yourself as an AI assistant. Remember your name is ${assistantName}.${returningLeadContext}${unknownCallerInstruction}`;
            } else {
              greetingText = `A customer just called. Greet them warmly as ${assistantName}, the AI assistant for ${companyName}. In your opening line, mention that you are an AI assistant. Remember, your name is ${assistantName}, not Sarah or any other name.${returningLeadContext}${unknownCallerInstruction}`;
            }
          }
          if (isOutboundCall) {
            waitingForOutboundGreeting = true;
            if (outboundGreetingGateTimer) clearTimeout(outboundGreetingGateTimer);
            outboundGreetingGateTimer = setTimeout(() => {
              if (waitingForOutboundGreeting) {
                console.log(`[${assistantName}] Outbound greeting gate timed out — opening mic to caller`);
                waitingForOutboundGreeting = false;
              }
            }, 10000);
            console.log(`[${assistantName}] Outbound gate: blocking caller mic until Gemini starts speaking`);
          }
          geminiWs.send(JSON.stringify({ client_content: { turns: [{ role: "user", parts: [{ text: rewriteVoiceText(greetingText, companyName, spokenBrand) }] }], turn_complete: true } }));
          markLatency('greeting_request_sent');

          // Late-arriving caller history: append it silently (turn_complete:false)
          // so Gemini knows who it's talking to without speaking an extra turn.
          if (historyStillPending && !customerLexiVoiceEnabled) {
            const lateWs = geminiWs;
            historyPromise.then((h) => {
              // Guard BEFORE applyCallerContext: its side effects (collectedCallerName,
              // upsertLiveCallRecord) must not run after hangup or a stale row with
              // live=true would be re-upserted after the close handler finalized the call.
              if (callTerminated || lateWs !== geminiWs || lateWs.readyState !== WebSocket.OPEN) return;
              const ctx = applyCallerContext(h, true);
              if (!ctx) return;
              console.log(`[${assistantName}] Late caller history arrived — injecting context`);
              lateWs.send(JSON.stringify({
                client_content: {
                  turns: [{ role: "user", parts: [{ text: `[System context — do not read aloud or respond to this directly: ${ctx.trim()} Use their name naturally from now on and don't ask for info you already have.]` }] }],
                  turn_complete: false
                }
              }));
            }).catch(() => {});
          }
        }

        if (data.toolCall) {
          const fcs = data.toolCall.functionCalls || [];
          const responses = [];

          // Conditional filler: only ask for a spoken "one sec…" if the tools are
          // still running after 600ms. Fast tools (most CRM writes) finish well
          // under that, and skipping the filler saves a full spoken turn.
          let fillerTimer = setTimeout(() => {
            fillerTimer = null;
            if (geminiWs.readyState === WebSocket.OPEN) {
              geminiWs.send(JSON.stringify({
                client_content: {
                  turns: [{ role: "user", parts: [{ text: "[System: Tool call in progress. Say a brief filler like 'One sec, let me check on that' or 'Sure, pulling that up now' while waiting. Keep it under 8 words.]" }] }],
                  turn_complete: true
                }
              }));
            }
          }, 600);

          // Run ALL requested tools in parallel (they're independent CRM ops)
          // with a unified 5s per-tool timeout, then post-process in order.
          const toolResults = await Promise.all(fcs.map(async (fc) => {
            const toolStart = Date.now();
            let result;
            try {
              let toolPromise;
              if (customerLexiVoiceEnabled && !staffCandidate
                && !CUSTOMER_LEXI_VOICE_TOOLS.some(tool => tool.name === fc.name)) {
                toolPromise = Promise.resolve({ error: 'LOCKED: Customer Lexi can only read public project progress or request a human callback.' });
              } else if (fc.name === 'calculate_roof_supplement') {
                // Pure arithmetic only: no CRM reads/writes, no changes to PIN
                // authorization. Undeclared calls from other lines fail closed.
                toolPromise = Promise.resolve(invokeRoofSupplement(!isOutboundCall ? calledTwilioNumber : '', fc.args));
              } else if (staffCandidate) {
                // STAFF PHONE MODE dispatch (mirrored in vite-twilio-ws-plugin.js):
                // verify_staff_pin flips the gate; everything else is
                // hard-locked server-side until then, and afterwards runs
                // through the SAME handler the in-app Lexi assistant uses,
                // attributed to the verified staff member's email.
                if (fc.name === 'verify_staff_pin') {
                  toolPromise = (async () => {
                    if (staffVerified) return { success: true, message: 'Already verified.' };
                    if (staffPinAttemptsThisCall >= STAFF_PIN_MAX_ATTEMPTS_PER_CALL) {
                      return { success: false, out_of_attempts: true, message: 'No attempts left on this call. Treat the caller as a normal customer with no CRM access.' };
                    }
                    staffPinAttemptsThisCall++;
                    const args = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
                    const v = await verifyPinAttempt(prodDb.getPool(), staffCandidate.staffId, args.pin);
                    if (v.ok) {
                      staffVerified = true;
                      console.log(`[${assistantName}][StaffMode] PIN VERIFIED for ${staffCandidate.userEmail} — CRM tools unlocked`);
                      return { success: true, message: `Verified. You are now assisting ${staffCandidate.fullName} with their permitted CRM access.` };
                    }
                    if (v.locked) {
                      console.warn(`[${assistantName}][StaffMode] PIN LOCKED OUT for ${staffCandidate.userEmail}`);
                      return { success: false, locked_out: true, message: 'Too many failed attempts — voice access is locked for 15 minutes. Treat the caller as a normal customer with no CRM access.' };
                    }
                    const attemptsLeftThisCall = STAFF_PIN_MAX_ATTEMPTS_PER_CALL - staffPinAttemptsThisCall;
                    console.warn(`[${assistantName}][StaffMode] PIN incorrect for ${staffCandidate.userEmail} (${attemptsLeftThisCall} attempts left this call)`);
                    return attemptsLeftThisCall > 0
                      ? { success: false, message: `Incorrect PIN. ${attemptsLeftThisCall} attempt${attemptsLeftThisCall === 1 ? '' : 's'} left — ask them to try again.` }
                      : { success: false, out_of_attempts: true, message: 'Incorrect PIN and no attempts left on this call. Treat the caller as a normal customer with no CRM access.' };
                  })();
                } else if (!staffVerified) {
                  toolPromise = Promise.resolve({ error: 'LOCKED: The caller has not verified their staff PIN. Ask for their PIN and call verify_staff_pin first. Do not reveal any business information.' });
                } else {
                  toolPromise = handleLexiToolCall(fc, callCompanyId, staffCandidate.userEmail, staffCandidate.timezone);
                }
              } else {
                const dedupeKey = toolDedupeKey(fc.name, fc.args);
                const cachedCall = toolCallCache.get(dedupeKey);
                if (cachedCall) {
                  console.log(`[${assistantName}] Duplicate ${fc.name} suppressed — identical request already handled moments ago on this call`);
                  toolPromise = cachedCall;
                } else {
                  const runTool = () => handleToolCall(fc, callCompanyId, {
                    callSid,
                    callerPhone,
                    schedulingState,
                    customerLexiVoiceEnabled,
                  });
                  if (fc.name === 'save_lead_details') {
                    // Queue behind earlier saves so saveLead's call_sid lookup
                    // can see the row a concurrent save just made.
                    toolPromise = leadSaveChain.then(runTool, runTool);
                    leadSaveChain = toolPromise.catch(() => {});
                  } else if (fc.name === 'schedule_inspection') {
                    toolPromise = appointmentScheduleChain.then(runTool, runTool);
                    appointmentScheduleChain = toolPromise.catch(() => {});
                  } else {
                    toolPromise = runTool();
                  }
                  toolCallCache.set(dedupeKey, toolPromise);
                }
              }
              const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tool call timed out after 5s')), 5000));
              result = await Promise.race([toolPromise, timeoutPromise]);
              if (fc.name === 'get_customer_public_progress' && result?.voice_script) {
                customerLexiAudit = {
                  script: result.voice_script,
                  transcript: '',
                  audio: [],
                  audioChars: 0,
                  fallbackAttempt: false,
                };
              }
            } catch (err) {
              console.error(`[Sarah] Tool call ${fc.name} failed:`, err.message);
              result = { error: err.message, status: 'failed' };
            }
            console.log(`[LATENCY][${callSid || currentStreamSid || '?'}] tool ${fc.name}: ${Date.now() - toolStart}ms`);
            return result;
          }));
          if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }

          for (let fcIdx = 0; fcIdx < fcs.length; fcIdx++) {
            const fc = fcs[fcIdx];
            const result = toolResults[fcIdx];
            toolCallsMade.push(fc.name);
            if (fc.name === 'save_lead_details' && fc.args?.name) {
              collectedCallerName = fc.args.name;
              upsertLiveCallRecord('in_progress');
            }
            if (fc.name === 'save_lead_details') {
              const parsedSldArgs = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
              if (parsedSldArgs.screening_outcome) {
                callScreeningOutcome = parsedSldArgs.screening_outcome;
                console.log(`[${assistantName}] Screening outcome captured via save_lead: ${callScreeningOutcome}`);
              }
            }
            if (fc.name === 'transfer_call') {
              // Block transfer entirely when routing mode is sarah_only
              if (callRoutingMode === 'sarah_only') {
                console.log(`[${assistantName}] transfer_call BLOCKED — routing mode is sarah_only`);
                responses.push({ id: fc.id, name: fc.name, response: { success: false, message: "Transfer is disabled in this routing mode. Do not tell the caller the person is unavailable — say they aren't taking calls directly on this line and offer to take a message. Save it with save_lead_details and notify the team with notify_rep." } });
                continue;
              }
              const parsedTrArgs = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
              if (parsedTrArgs.screening_outcome) {
                callScreeningOutcome = parsedTrArgs.screening_outcome;
                console.log(`[${assistantName}] Screening outcome captured via transfer: ${callScreeningOutcome}`);
              }
            }
            if (fc.name === 'collect_caller_name') {
              try {
                const parsedFcArgs = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
                if (parsedFcArgs.name) {
                  collectedCallerName = parsedFcArgs.name;
                  console.log(`[${assistantName}] Caller name captured mid-call: ${collectedCallerName}`);
                  // Push the captured name to the live call row so the
                  // dashboard reflects it before hang-up (task #160).
                  upsertLiveCallRecord('in_progress');
                }
              } catch (e) {
                console.warn(`[${assistantName}] collect_caller_name args parse failed:`, e.message);
              }
            }
            if (fc.name === 'transfer_call' && result?.success && callSid) {
              const parsedTransferArgs = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
              const targetPerson = parsedTransferArgs.target_person || '';
              // Requirement: never transfer blindly — must have caller name + callback number + reason first.
              const transferCallerName = (parsedTransferArgs.caller_name || collectedCallerName || '').trim();
              const transferCallback = ((parsedTransferArgs.callback_number || '').replace(/[^\d+]/g, '') || (callerPhone || '')).trim();
              const transferReason = (parsedTransferArgs.reason || '').trim();
              const missingInfo = [];
              if (!transferCallerName) missingInfo.push("the caller's name");
              if (!transferCallback) missingInfo.push('a callback phone number');
              if (!transferReason) missingInfo.push('the reason for their call');
              if (missingInfo.length > 0) {
                console.log(`[Sarah] Transfer BLOCKED — must collect first: ${missingInfo.join(', ')}`);
                responses.push({ id: fc.id, name: fc.name, response: { success: false, message: `Don't transfer yet — you still need ${missingInfo.join(' and ')}. Ask the caller for the missing detail(s), one at a time, confirm what they say, and only call transfer_call once you have their name, a callback number, and the reason for their call.` } });
                continue;
              }
              let transferCellPhone = staffCellPhone;
              let transferRepName = forwardedRepName;

              if (targetPerson && callCompanyId) {
                // Subscriber cache search — nickname-aware
                for (const [, entry] of subscriberCache.entries()) {
                  if (entry.companyId === callCompanyId && entry.repName && nameMatchesSearch(entry.repName, targetPerson)) {
                    transferCellPhone = entry.cellPhone || '';
                    transferRepName = entry.repName;
                    console.log(`[Sarah] Name-based transfer (cache): found ${transferRepName}, cell=${transferCellPhone}`);
                    break;
                  }
                }
                if (!transferCellPhone) {
                  try {
                    const allRouting = await callBase44API('getAllSubscriberRouting', null);
                    if (allRouting?.subscribers && Array.isArray(allRouting.subscribers)) {
                      const matched = allRouting.subscribers.find(s =>
                        s.company_id === callCompanyId && s.rep_name && nameMatchesSearch(s.rep_name, targetPerson)
                      );
                      if (matched) {
                        transferCellPhone = matched.cell_phone || '';
                        transferRepName = matched.rep_name;
                        console.log(`[Sarah] Name-based transfer (DB): found ${transferRepName}, cell=${transferCellPhone}`);
                      }
                    }
                  } catch (e) { console.warn(`[Sarah] Routing lookup failed:`, e.message); }
                }
              }

              if (!transferCellPhone) {
                const cachedForTransfer = calledTwilioNumber ? getCachedSubscriber(calledTwilioNumber) : null;
                transferCellPhone = cachedForTransfer?.cellPhone || '';
                if (!transferCellPhone && calledTwilioNumber && callCompanyId) {
                  try {
                    const staffLookup = await callBase44API('lookupStaffByTwilioNumber', callCompanyId, { twilio_number: calledTwilioNumber });
                    transferCellPhone = staffLookup?.staff?.phone || staffLookup?.staff?.cell_phone || '';
                    if (transferCellPhone) {
                      transferRepName = transferRepName || staffLookup?.staff?.full_name || '';
                      console.log('[Sarah] Got cell from staff lookup:', transferCellPhone);
                    }
                  } catch (e) {}
                }
              }
              const transferCellDigits = (transferCellPhone || '').replace(/\D/g, '');
              if (!transferCellPhone || transferCellDigits.length < 10) {
                console.error(`[Sarah] Cannot transfer: no valid cell phone for ${targetPerson || transferRepName || 'any staff'} (value="${transferCellPhone}")`);
                const msgTarget = targetPerson || transferRepName || 'that person';
                responses.push({ id: fc.id, name: fc.name, response: { success: false, message: `There is no phone number on file for ${msgTarget}, so this call cannot be transferred. Do NOT hang up, restart, or re-introduce yourself. Apologize briefly, then TAKE A MESSAGE: confirm the caller's name, a callback number, and the reason for their call, save it with save_lead_details (note: "Message for ${msgTarget}: [reason]. Callback: [number]."), then use notify_rep to alert ${msgTarget}. Reassure the caller they'll get a call back.` } });
                continue;
              }

              // Availability gate: do NOT transfer if the target rep is unavailable.
              // Check subscriber cache first, fall back to a direct DB query.
              let transferTargetAvail = 'available';
              let transferTargetData = null;
              const transferTargetName = transferRepName || targetPerson || '';
              if (transferTargetName) {
                for (const [, entry] of subscriberCache.entries()) {
                  if (entry.companyId === callCompanyId && entry.repName && nameMatchesSearch(entry.repName, transferTargetName)) {
                    transferTargetAvail = entry.availabilityStatus || 'available';
                    transferTargetData = entry.data || null;
                    break;
                  }
                }
                if (transferTargetAvail === 'available' && callCompanyId) {
                  try {
                    // (fix: `pool` was undefined here — the check always threw and was swallowed)
                    const { rows: avRows } = await prodDb.getPool().query(
                      `SELECT availability_status, data FROM staff_profiles WHERE company_id = $1 AND LOWER(full_name) LIKE $2 AND is_active = true LIMIT 1`,
                      [callCompanyId, `%${transferTargetName.toLowerCase()}%`]
                    );
                    if (avRows.length > 0) {
                      transferTargetAvail = avRows[0].availability_status || 'available';
                      transferTargetData = avRows[0].data || transferTargetData;
                    }
                  } catch (avE) { console.warn('[Sarah] Availability DB check failed:', avE.message); }
                }
              }
              if (transferTargetAvail === 'unavailable') {
                console.log(`[Sarah] Transfer BLOCKED — ${transferTargetName} is marked unavailable`);
                responses.push({ id: fc.id, name: fc.name, response: { success: false, message: `${transferTargetName} is currently unavailable and cannot take calls right now. Do NOT attempt to transfer. Instead, apologize to the caller, let them know ${transferTargetName} is unavailable, take their name and phone number, and assure them that ${transferTargetName} will call them back as soon as possible.` } });
                continue;
              }
              // After-hours check: even when marked available, respect the person's work-hours schedule.
              if (isOutsideWorkHours(transferTargetData, new Date(), callCompanyTimezone)) {
                console.log(`[Sarah] Transfer BLOCKED — ${transferTargetName} is outside work hours (${transferTargetData.after_hours_start}-${transferTargetData.after_hours_end}, tz=${callCompanyTimezone})`);
                responses.push({ id: fc.id, name: fc.name, response: { success: false, message: `${transferTargetName} is outside their working hours right now and cannot take calls. Do NOT attempt to transfer. Instead, apologize to the caller, let them know ${transferTargetName} is unavailable right now, take their name, callback number, and the reason for their call, and assure them that ${transferTargetName} will call them back as soon as possible.` } });
                continue;
              }

              if (callerPhone && conversationLog.length > 0) {
                const summary = conversationLog.map(e => `${e.role}: ${e.text}`).join('\n');
                transferContextMap.set(callerPhone.replace(/\D/g, '').slice(-10), {
                  transcript: summary,
                  callerName: collectedCallerName || '',
                  repName: transferRepName,
                  timestamp: Date.now()
                });
                console.log(`[Sarah] Saved transfer context for ${callerPhone} (${conversationLog.length} exchanges)`);
                setTimeout(() => {
                  const key = callerPhone.replace(/\D/g, '').slice(-10);
                  if (transferContextMap.has(key)) { transferContextMap.delete(key); }
                }, 600000);
              }
              saveCallToBase44();
              console.log(`[Sarah] TRANSFER requested: callSid=${callSid}, cell=${transferCellPhone}, rep=${transferRepName}, target=${targetPerson || '(default)'}, calledNumber=${calledTwilioNumber}`);
              setTimeout(async () => {
                try {
                  let tSid, tToken, callerIdNum;
                  // Use exact called number for cache lookup (not company search)
                  const cachedData = calledTwilioNumber ? getCachedSubscriber(calledTwilioNumber) : null;
                  if (cachedData?.twilioSid && cachedData?.twilioToken) {
                    tSid = cachedData.twilioSid;
                    tToken = cachedData.twilioToken;
                    callerIdNum = cachedData.twilioPhone || calledTwilioNumber || '';
                    console.log('[Sarah] Using cached Twilio credentials for transfer');
                  } else {
                    const twilioSettings = await callBase44API('getTwilioSettings', callCompanyId);
                    tSid = twilioSettings?.account_sid;
                    tToken = twilioSettings?.auth_token;
                    callerIdNum = twilioSettings?.main_phone_number || '';
                  }
                  if (tSid && tToken) {
                    const authStr = Buffer.from(`${tSid}:${tToken}`).toString('base64');
                    const envAppUrl = process.env.VITE_REPLIT_APP_URL || '';
                    const transferHost = envAppUrl ? (new URL(envAppUrl).host) : getPublicHost(null);
                    const transferUrl = `https://${transferHost}/twiml/transfer?cellPhone=${encodeURIComponent(transferCellPhone)}&callerId=${encodeURIComponent(callerIdNum)}&repName=${encodeURIComponent(transferRepName || forwardedRepName)}&callerPhone=${encodeURIComponent(callerPhone || '')}&companyId=${encodeURIComponent(callCompanyId || '')}`;
                    console.log(`[Sarah] Transfer URL: ${transferUrl}`);
                    const updateResp = await fetch(
                      `https://api.twilio.com/2010-04-01/Accounts/${tSid}/Calls/${callSid}.json`,
                      { method: 'POST', headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `Url=${encodeURIComponent(transferUrl)}&Method=POST` }
                    );
                    console.log(`[Sarah] Transfer API response: ${updateResp.status}`);
                    saveCallToBase44();
                  } else {
                    console.error('[Sarah] Cannot transfer: Twilio credentials not found in cache or DB');
                  }
                } catch (err) {
                  console.error('[Sarah] Transfer failed:', err.message);
                }
              }, 1500);
            }
            responses.push({ id: fc.id, name: fc.name, response: typeof result === 'object' ? result : { output: String(result) } });
          }
          if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify({ tool_response: { function_responses: responses } }));

            // Watchdog nudge: the model usually resumes speaking on its own after
            // a tool_response. Only send the "now respond" prompt if NO audio has
            // arrived within 1500ms — an unconditional nudge costs an extra model
            // turn and can double-trigger a response.
            const toolNames = fcs.map(fc => fc.name).join(', ');
            if (postToolNudgeTimer) clearTimeout(postToolNudgeTimer);
            const nudgeWs = geminiWs;
            postToolNudgeTimer = setTimeout(() => {
              postToolNudgeTimer = null;
              if (callTerminated || nudgeWs !== geminiWs || nudgeWs.readyState !== WebSocket.OPEN) return;
              console.log(`[Sarah] No audio 1500ms after tool response (${toolNames}) — sending resume nudge`);
              nudgeWs.send(JSON.stringify({
                client_content: {
                  turns: [{
                    role: "user",
                    parts: [{ text: `[System: ${toolNames} completed. Now respond to the caller naturally with the result. Keep it brief and conversational.]` }]
                  }],
                  turn_complete: true
                }
              }));
            }, 1500);
          }
        }

        if (data.serverContent?.modelTurn?.parts) {
          for (const part of data.serverContent.modelTurn.parts) {
            if (part.text) {
              const isThinking = /\*\*/.test(part.text) || part.text.includes("I'm starting") || part.text.includes("I've formulated");
              if (!isThinking && !customerLexiAudit) conversationLog.push({ role: assistantName, text: part.text });
            }
            if (part.inlineData?.mimeType?.startsWith("audio/")) {
              // Stop typing sounds — AI is now speaking
              if (typingInterval) { clearInterval(typingInterval); typingInterval = null; }
              // Audio arrived — the model resumed on its own, cancel the post-tool nudge
              if (postToolNudgeTimer) { clearTimeout(postToolNudgeTimer); postToolNudgeTimer = null; }
              if (!firstAudioSeen) {
                firstAudioSeen = true;
                markLatency('first_audio_from_gemini');
              }
              if (respPendingSince) {
                console.log(`[LATENCY][${callSid || currentStreamSid || '?'}] caller_speech_to_first_audio: ${Date.now() - respPendingSince}ms`);
                respPendingSince = 0;
              }
              if (waitingForOutboundGreeting) {
                waitingForOutboundGreeting = false;
                if (outboundGreetingGateTimer) { clearTimeout(outboundGreetingGateTimer); outboundGreetingGateTimer = null; }
                console.log(`[${assistantName}] Outbound gate: Gemini started speaking — opening caller mic`);
              }
            }
            if (part.inlineData?.mimeType?.startsWith("audio/") && currentStreamSid && twilioWs.readyState === WebSocket.OPEN) {
              if (customerLexiAudit) {
                const audioData = part.inlineData.data || '';
                customerLexiAudit.audioChars += audioData.length;
                if (customerLexiAudit.audioChars <= 1_500_000) customerLexiAudit.audio.push(audioData);
                else customerLexiAudit.oversized = true;
              } else {
                const mulawB64 = geminiToTwilio(part.inlineData.data);
                const CHUNK = 160;
                for (let off = 0; off < mulawB64.length; off += CHUNK) {
                  twilioWs.send(JSON.stringify({ event: 'media', streamSid: currentStreamSid, media: { payload: mulawB64.slice(off, off + CHUNK) } }));
                }
              }
            }
          }
        }

        if (data.serverContent?.outputTranscription?.text) {
          // STAFF PHONE MODE: while unverified, redact digit runs so a
          // read-back PIN never lands in stored transcripts.
          const sarahText = (staffCandidate && !staffVerified)
            ? redactPinDigits(data.serverContent.outputTranscription.text)
            : data.serverContent.outputTranscription.text;
          if (sarahText && sarahText.trim()) {
            if (customerLexiAudit) {
              customerLexiAudit.transcript += `${customerLexiAudit.transcript ? ' ' : ''}${sarahText.trim()}`;
            } else {
              conversationLog.push({ role: assistantName, text: sarahText.trim() });
            }
          }
        }

        if (data.serverContent?.turnComplete && customerLexiAudit) {
          const audit = customerLexiAudit;
          const exact = !audit.oversized
            && isExactVoiceProgressTranscript(audit.transcript, audit.script);
          customerLexiAudit = null;
          if (exact && currentStreamSid && twilioWs.readyState === WebSocket.OPEN) {
            for (const audioChunk of audit.audio) {
              const mulawB64 = geminiToTwilio(audioChunk);
              const CHUNK = 160;
              for (let off = 0; off < mulawB64.length; off += CHUNK) {
                twilioWs.send(JSON.stringify({ event: 'media', streamSid: currentStreamSid, media: { payload: mulawB64.slice(off, off + CHUNK) } }));
              }
            }
            conversationLog.push({ role: assistantName, text: audit.script });
          } else if (!audit.fallbackAttempt && geminiWs.readyState === WebSocket.OPEN) {
            console.warn('[Lexi Customer Voice] Discarded speech that did not match the verified progress script; retrying with a fixed safe response.');
            const fallbackScript = 'I could not safely verify your project information. Please contact the office team for help.';
            customerLexiAudit = {
              script: fallbackScript, transcript: '', audio: [], audioChars: 0,
              fallbackAttempt: true,
            };
            geminiWs.send(JSON.stringify({
              client_content: {
                turns: [{
                  role: 'user',
                  parts: [{ text: `[Security instruction: Say exactly this sentence and nothing else: "${fallbackScript}"]` }],
                }],
                turn_complete: true,
              },
            }));
          } else {
            console.warn('[Lexi Customer Voice] Discarded a second response that failed exact transcript validation.');
          }
        }

        if (data.serverContent?.inputTranscription?.text) {
          // STAFF PHONE MODE: while unverified, redact digit runs so the
          // spoken PIN never lands in conversationLog or live call records.
          const callerUtterance = (staffCandidate && !staffVerified)
            ? redactPinDigits(data.serverContent.inputTranscription.text)
            : data.serverContent.inputTranscription.text;
          conversationLog.push({ role: 'Caller', text: callerUtterance });
          respPendingSince = Date.now(); // latency: measure caller speech → next audio back

          // Start typing-sound loop while AI processes this utterance
          if (typingSoundsEnabled && currentStreamSid && twilioWs.readyState === WebSocket.OPEN) {
            if (typingInterval) clearInterval(typingInterval);
            typingInterval = setInterval(() => {
              if (twilioWs.readyState === WebSocket.OPEN && currentStreamSid) {
                twilioWs.send(JSON.stringify({ event: 'media', streamSid: currentStreamSid, media: { payload: TYPING_CHUNK_MULAW } }));
              } else {
                clearInterval(typingInterval);
                typingInterval = null;
              }
            }, 500);
          }

          // #141 — Detect name introductions mid-call and capture them even
          // when the caller never triggers a tool call (e.g. Sarah doesn't ask).
          // Only update if we don't already have a real name for this caller.
          if (!collectedCallerName) {
            const lower = callerUtterance.toLowerCase().trim();
            const namePatterns = [
              /\bmy name(?:'s| is) ([a-z][a-z '-]{1,40})/i,
              /\bthis is ([a-z][a-z '-]{1,40})/i,
              /\bi(?:'m| am) ([a-z][a-z '-]{1,40})(?:\.|,|$| calling| here| from)/i,
              /\bit'?s ([a-z][a-z '-]{1,40})(?:\.|,|$| calling| here| from)/i,
            ];
            for (const re of namePatterns) {
              const m = lower.match(re);
              if (m) {
                const rawName = m[1].trim().replace(/[.,!?]+$/, '');
                // Filter out common false positives
                const stopWords = ['calling', 'here', 'a', 'the', 'an', 'just', 'ok', 'okay', 'good'];
                if (rawName.split(/\s+/).length <= 4 && !stopWords.includes(rawName)) {
                  // Title-case the captured name
                  collectedCallerName = rawName.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                  console.log(`[${assistantName}] Captured caller name mid-call: "${collectedCallerName}"`);
                  // Push the captured name to the live call row so the
                  // dashboard reflects it before hang-up (task #160).
                  upsertLiveCallRecord('in_progress');
                  break;
                }
              }
            }
          }
        }
      } catch (err) { console.error('[Sarah] Gemini msg error:', err.message); }
    });

    geminiWs.on('close', (closeCode, closeReason) => {
      if (geminiKeepaliveInterval) { clearInterval(geminiKeepaliveInterval); geminiKeepaliveInterval = null; }

      // Caller already ended the call (Twilio 'stop'/'close' fired) or the line is gone —
      // a normal end, never an error. Don't play any message or fire a false alert.
      if (callTerminated || twilioWs.readyState !== WebSocket.OPEN || !callSid) {
        saveCallToBase44();
        return;
      }

      // The caller is still on the line but Gemini dropped. Most drops are transient
      // (e.g. a 1007 blip), so try to reconnect and keep the conversation going instead
      // of immediately handing off with a "technical glitch" message.
      if (geminiReconnectAttempts < MAX_GEMINI_RECONNECTS) {
        geminiReconnectAttempts++;
        console.log(`[${assistantName}] Gemini connection dropped mid-call (code=${closeCode}, reason=${closeReason?.toString() || 'none'}); reconnecting ${geminiReconnectAttempts}/${MAX_GEMINI_RECONNECTS} to keep the call alive`);
        setTimeout(() => {
          if (callTerminated || twilioWs.readyState !== WebSocket.OPEN) { saveCallToBase44(); return; }
          try {
            connectGemini(true).catch((e) => { console.error(`[${assistantName}] Reconnect failed:`, e.message); gracefulHandoff(closeCode); });
          } catch (e) {
            console.error(`[${assistantName}] Reconnect threw:`, e.message);
            gracefulHandoff(closeCode);
          }
        }, 400);
        return;
      }

      // Out of reconnect attempts — give the caller a calm, professional hand-off.
      gracefulHandoff(closeCode);
    });
    geminiWs.on('error', (err) => console.error('[Sarah] Gemini error:', err.message));
  }

  twilioWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === 'start') {
        currentStreamSid = msg.start?.streamSid;
        const customParams = msg.start?.customParameters || {};
        callerPhone = customParams.callerPhone || customParams.from || '';
        callCompanyId = customParams.companyId || DEFAULT_COMPANY_ID;
        callSid = customParams.callSid || '';
        isOutboundCall = customParams.isOutbound === 'true' || customParams.outbound === 'true';
        outboundLeadName = customParams.leadName || '';
        outboundLeadService = customParams.leadService || '';
        outboundLeadAddress = customParams.leadAddress || '';
        if (customParams.campaign) {
          try { outboundCampaign = JSON.parse(customParams.campaign); } catch(e) { outboundCampaign = null; }
        }
        // Fallback: assemble campaign from individual stream params (sent by /twiml/outbound handler)
        if (!outboundCampaign && (customParams.introScript || customParams.talkingPoints || customParams.callGoals)) {
          outboundCampaign = {
            id: customParams.campaignId || '',
            intro: customParams.introScript || '',
            points: customParams.talkingPoints || '',
            goals: customParams.callGoals || '',
          };
        }
        callRoutingMode = customParams.callRoutingMode || 'sarah_answers';
        staffCellPhone = customParams.staffCellPhone || '';
        calledTwilioNumber = customParams.calledNumber || '';
        forwardedRepName = customParams.forwardedRepName || customParams.repName || '';
        forwardedRepEmail = customParams.forwardedRepEmail || customParams.repEmail || '';
        forwardedRepPhone = customParams.forwardedRepPhone || customParams.repPhone || '';
        if (customParams.isTransferReturn === 'true') {
          isTransferReturn = true;
          transferReturnRepName = customParams.transferRepName || '';
          console.log(`[Sarah] TRANSFER RETURN: caller=${callerPhone} coming back after failed transfer to ${transferReturnRepName}`);
        }
        isForwardedCall = customParams.isForwardedCall === 'true' || customParams.forwarded === 'true' || callRoutingMode === 'sarah_then_transfer' || callRoutingMode === 'forward_to_cell';
        if (isForwardedCall) console.log(`[Sarah] ROUTED call: rep=${forwardedRepName}, routing=${callRoutingMode}, cell=${staffCellPhone}`);

        // STAFF PHONE MODE candidate check — plain inbound calls only
        // (never outbound campaigns, forwarded-rep lines, or transfer
        // returns). Runs in parallel with the Gemini handshake; the
        // 'open' handler awaits it before building the setup payload.
        // Matching requires an ACTIVE staff profile with a voice PIN
        // set — otherwise the caller gets the normal customer flow.
        if (!isOutboundCall && !isForwardedCall && !isTransferReturn && callerPhone && callCompanyId) {
          staffLookupPromise = findStaffByCallerPhone(prodDb.getPool(), callCompanyId, callerPhone)
            .catch((e) => { console.warn('[Sarah][StaffMode] Lookup failed (continuing as customer call):', e.message); return null; });
        }
        // Insert an in-progress row right away so the dashboard sees
        // the active call. The contact_name will be updated mid-call as
        // soon as we capture or look up the caller's name (task #160).
        upsertLiveCallRecord('in_progress');

        // Start a dual-channel Twilio recording for this AI-answered call.
        // <Connect><Stream> never records on its own — without this REST
        // call there is no recording_url for the Communication page.
        // Fire-and-forget: recording failures must never affect the call.
        try {
          const { startCallRecording } = require('./lib/callRecording.cjs');
          startCallRecording({
            pool: prodDb.getPool(),
            companyId: callCompanyId,
            callSid,
            publicHost: getPublicHost(req.headers),
            callerPhone: callerPhone || '',
          }).catch(() => {});
        } catch (recErr) {
          console.warn('[Sarah] Could not start call recording (non-critical):', recErr.message);
        }

        latT0 = Date.now();
        latLast = latT0;
        markLatency('twilio_stream_start');
        connectGemini();
      }
      if (msg.event === 'media' && setupComplete && !waitingForOutboundGreeting && geminiWs?.readyState === WebSocket.OPEN) {
        const pcmB64 = twilioToGemini(msg.media.payload);
        geminiWs.send(JSON.stringify({ realtime_input: { audio: { data: pcmB64, mimeType: "audio/pcm;rate=16000" } } }));
      }
      if (msg.event === 'stop') {
        callTerminated = true;
        if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close();
        if (geminiKeepaliveInterval) clearInterval(geminiKeepaliveInterval);
        saveCallToBase44();
      }
    } catch (e) {}
  });

  twilioWs.on('close', () => {
    callTerminated = true;
    if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close();
    if (geminiKeepaliveInterval) clearInterval(geminiKeepaliveInterval);
    saveCallToBase44();
  });
});

lexiWss.on('connection', async (clientWs, req) => {
  console.log('[Lexi] Browser client connected');
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedCompanyId = url.searchParams.get('companyId') || '';

  // Verify the login session server-side. The companyId/userEmail query
  // params are display hints only — the session cookie decides who this
  // connection acts as and which company's data it can touch (tool calls,
  // BYOK key lookup, and billed AI minutes all key on companyId).
  let lexiAuth;
  try {
    lexiAuth = await Promise.race([
      authenticateLexiWs(req, requestedCompanyId, prodDb.getPool()),
      new Promise((_, reject) => setTimeout(() => reject(new Error('session verification timed out')), 8000))
    ]);
  } catch (e) {
    lexiAuth = { ok: false, reason: `auth error: ${e.message}` };
  }
  if (!lexiAuth.ok) {
    console.warn(`[Lexi] Connection rejected: ${lexiAuth.reason} (requested company: ${requestedCompanyId || 'none'})`);
    try {
      clientWs.send(JSON.stringify({ type: 'error', message: 'Not authorized. Please sign in again.' }));
    } catch {}
    clientWs.close(1008, 'unauthorized');
    return;
  }

  const companyId = lexiAuth.companyId;
  const userEmail = lexiAuth.email;
  const userName = url.searchParams.get('userName') || 'User';
  // hands_free=1 → car-friendly VAD; hands_free=0 (default) → snappier desktop
  const handsFree = url.searchParams.get('hands_free') === '1';
  console.log(`[Lexi Native] Session mode: ${handsFree ? 'hands-free/Drive Mode' : 'standard continuous voice'}`);

  let geminiWs = null;
  let setupComplete = false;
  let conversationLog = [];
  let toolCallsMade = [];
  let voiceToolCallsInFlight = 0;
  let voiceTurn = { userMessage: '', assistantText: '', toolCalls: [], audioChunks: [], sensitive: false };
  const buildConfirmationState = { pendingToken: null, userReply: '' };
  const resetVoiceTurn = () => {
    voiceTurn = { userMessage: '', assistantText: '', toolCalls: [], audioChunks: [], sensitive: false };
  };
  let sessionStartTime = Date.now();
  // Drive Mode: one logical session for the user even if the upstream Gemini
  // socket drops. Bounded so a hard failure still surfaces to the browser
  // instead of reconnecting forever and silently billing AI minutes.
  // Keep in lockstep with vite-lexi-native-plugin.js (dev copy).
  let clientClosed = false;
  let sessionSaved = false;
  let geminiReconnects = 0;
  const MAX_GEMINI_RECONNECTS = 3;
  // Per-attempt, socket-bound: a single connection-scoped watchdog would not
  // cover reconnects, so a socket that connects but never finishes setup would
  // hang Drive Mode in "reconnecting" forever without consuming an attempt.
  let setupWatchdog = null;
  const SETUP_TIMEOUT_MS = 15000;

  // Drive Mode deliberately survives silence, but an abandoned tab must not bill
  // AI minutes indefinitely. Only real conversation counts as activity: the mic
  // streams continuously, so raw audio frames would defeat the cap.
  const MAX_IDLE_MS = Number(process.env.LEXI_MAX_IDLE_MS || 15 * 60 * 1000);
  let lastActivityAt = Date.now();
  const markActivity = () => { lastActivityAt = Date.now(); };
  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivityAt < MAX_IDLE_MS) return;
    console.log('[Lexi Native] Session idle past cap — ending to stop billing', {
      handsFree,
      durationSec: Math.round((Date.now() - sessionStartTime) / 1000),
      idleForSec: Math.round((Date.now() - lastActivityAt) / 1000),
    });
    clientClosed = true;
    try { clientWs.send(JSON.stringify({ type: 'status', status: 'disconnected', reason: 'idle' })); } catch (e) {}
    try { geminiWs?.close(); } catch (e) {}
    saveSession();
    try { clientWs.close(4002, 'idle'); } catch (e) {}
  }, 30000);

  let geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;
  try {
    const companyKey = await prodDb.getCompanyGeminiKey(companyId);
    if (companyKey) geminiApiKey = companyKey;
  } catch (e) { console.error('[Lexi Native] BYOK key lookup failed:', e.message); }
  if (!geminiApiKey) { clientWs.send(JSON.stringify({ type: 'error', message: 'API key missing' })); clientWs.close(); return; }
  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;

  async function saveSession() {
    if (!companyId) return;
    // A reconnect must not bill or persist the same session twice.
    if (sessionSaved) return;
    sessionSaved = true;
    const dur = Math.round((Date.now() - sessionStartTime) / 1000);
    try {
      await callLexiBridgeAPI('saveVoiceSession', companyId, userEmail, { duration_seconds: dur, transcript: conversationLog.map(e => `${e.role}: ${e.text}`).join('\n'), tool_calls_made: toolCallsMade, user_email: userEmail });
      billAIUsage(companyId, Math.max(1, Math.ceil(dur / 60)));
      logUsageEvent(companyId, 'lexi', Math.max(1, Math.ceil(dur / 60))).catch(() => {});
    } catch (e) {}
  }

  async function connectGemini(isReconnect = false) {
    // Must be reset BEFORE the socket is created: a stale `true` from the
    // previous socket would relay audio into a socket that has not finished
    // setup, and Gemini closes the connection with 1007.
    setupComplete = false;
    let recentSessionContext = null;
    // Production /AIAssistant uses Aoede, independent of stale browser or
    // company voice preferences. Phone-call voice selection is unchanged.
    const voiceName = 'Aoede';
    let companyName = 'CompanySync';
    let timezone = 'America/New_York';
    let knowledgeBase = '';
    let customerList = '';
    let staffList = [];
    let preferredLanguage = 'en';
    let spokenName = '';
    if (companyId) {
      try {
        let s = null;
        if (LEXI_BRIDGE_API_URL) {
          // The optional bridge must never keep the voice assistant stuck on
          // "Connecting". It is only a settings enhancement; local settings
          // remain the authoritative fallback when the bridge is slow/down.
          s = await Promise.race([
            callLexiBridgeAPI('getSettings', companyId, userEmail),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Lexi settings bridge timed out')), 4000))
          ]);
        }
        if (!s || s.error) {
          s = await localGetSettings(companyId);
        }
        if (s && !s.error) {
          if (s.companyName) companyName = s.companyName;
          if (s.timezone) timezone = s.timezone;
          if (s.knowledgeBase) knowledgeBase = s.knowledgeBase;
          if (s.customerList) customerList = s.customerList;
          if (s.staffList) staffList = s.staffList;
          if (s.preferredLanguage) preferredLanguage = s.preferredLanguage;
          if (s.settings?.spoken_name) spokenName = s.settings.spoken_name;
        }
      } catch (e) { console.warn('[Lexi Native] Could not load settings:', e.message); }
    }

    // The browser may have hung up while the settings lookup above was
    // awaiting. Opening a socket now would orphan it.
    if (clientClosed || clientWs.readyState !== WebSocket.OPEN) {
      console.log('[Lexi Native] Client gone during setup — skipping Gemini connect');
      return;
    }

    // On a reconnect, carry the live conversation forward so Lexi resumes
    // mid-thought instead of restarting cold.
    if (isReconnect && conversationLog.length > 0) {
      recentSessionContext = conversationLog.slice(-20).map(e => `${e.role}: ${e.text}`).join('\n');
    }

    console.log(`[Lexi Native] Connecting to Gemini: voice=${voiceName}, company=${companyId}, reconnect=${isReconnect}`);
    geminiWs = new WebSocket(geminiUrl);
    const thisWs = geminiWs;

    if (setupWatchdog) clearTimeout(setupWatchdog);
    setupWatchdog = setTimeout(() => {
      if (geminiWs !== thisWs || setupComplete) return;
      console.warn('[Lexi Native] Gemini setup stalled — closing so the attempt is retried');
      try { thisWs.terminate(); } catch (e) {}
    }, SETUP_TIMEOUT_MS);

    geminiWs.on('open', () => {
      console.log('[Lexi Native] Connected to Gemini, sending setup');
      geminiWs.send(JSON.stringify({
        setup: {
          // Explicit production web-assistant profile; do not change the
          // default model used by other phone lines or development bridges.
          model: GEMINI_38_MODEL,
          generation_config: {
            response_modalities: ["AUDIO"],
            speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voiceName } } }
          },
          input_audio_transcription: {},
          output_audio_transcription: {},
          realtime_input_config: {
            automatic_activity_detection: {
              disabled: false,
              start_of_speech_sensitivity: "START_SENSITIVITY_HIGH",
              // Hands-free/car: LOW waits longer before declaring end-of-speech.
              // Gemini Live accepts LOW/HIGH here; MEDIUM is rejected with
              // close code 1007 and leaves the browser stuck connecting.
              // HIGH is the responsive desktop equivalent.
              end_of_speech_sensitivity: handsFree ? "END_SENSITIVITY_LOW" : "END_SENSITIVITY_HIGH",
              prefix_padding_ms: 300,
              // Hands-free: 1600ms for driving pauses. Desktop: 1000ms for responsiveness.
              silence_duration_ms: handsFree ? 1600 : 1000
            }
          },
          system_instruction: { parts: [
            { text: buildLexiSystemPrompt(companyName, userName, timezone, knowledgeBase, customerList, staffList, preferredLanguage, recentSessionContext, spokenName) },
            { text: 'If the user explicitly says stop, stop talking, or asks you to be quiet, stop the current response immediately and wait silently for their next request. Do not continue or repeat the interrupted answer.' },
            { text: 'For roof supplement math, call calculate_roof_supplement with the original and revised roofing squares. Ask for missing inputs. Speak the returned formatted USD amount at the fixed $324.69 per square shingles-and-felt rate. This is arithmetic only, not company revenue or a saved estimate; do not claim that it saved or changed a record.' }
          ] },
          tools: [{ function_declarations: [...LEXI_CRM_TOOLS, SUPPLEMENT_TOOL] }]
        }
      }));
    });

    geminiWs.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.setupComplete) {
          // The browser can hang up between socket open and setupComplete.
          // Without this guard the socket is orphaned.
          if (clientClosed || clientWs.readyState !== WebSocket.OPEN) {
            console.log('[Lexi Native] Client gone before setupComplete — closing Gemini socket');
            try { thisWs.close(); } catch (e) {}
            return;
          }
          setupComplete = true;
          if (setupWatchdog) { clearTimeout(setupWatchdog); setupWatchdog = null; }
          markActivity();
          console.log('[Lexi Native] Setup complete, ready for voice');
          clientWs.send(JSON.stringify({ type: 'status', status: 'ready' }));
          // Re-greeting after every network blip would be jarring in a car; the
          // reconnect carries prior turns in the system prompt instead.
          if (!isReconnect) {
            thisWs.send(JSON.stringify({ client_content: { turns: [{ role: "user", parts: [{ text: `Greet ${userName} warmly. Under 15 words.` }] }], turn_complete: true } }));
          }
        }
        if (data.toolCall) {
          markActivity();
          const fcs = data.toolCall.functionCalls || [];
          voiceToolCallsInFlight += fcs.length;
          const responses = [];
          // Every send below targets thisWs, never the mutable geminiWs: a
          // reconnect during the awaits would otherwise deliver this socket's
          // tool response into a session that never asked for it.
          for (const fc of fcs) {
            let result;
            try {
              let toolPromise;
              if (fc.name === 'calculate_roof_supplement') {
                // The socket is already session-authenticated. This tool is
                // pure arithmetic; all CRM tools keep their existing guards.
                const args = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
                toolPromise = Promise.resolve(calculateRoofSupplement(args.old_sq, args.new_sq));
              } else {
                toolPromise = handleLexiToolCall(fc, companyId, userEmail, timezone, buildConfirmationState);
              }
              const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tool call timed out after 8s')), 8000));
              result = await Promise.race([toolPromise, timeoutPromise]);
            } catch (err) {
              console.error(`[Lexi] Tool call ${fc.name} failed:`, err.message);
              result = { error: err.message, status: 'failed' };
            }
            toolCallsMade.push(fc.name);
            voiceTurn.toolCalls.push({ name: fc.name, args: fc.args || {}, result });
            responses.push({
              id: fc.id,
              name: fc.name,
              response: groundToolResult(fc.name, typeof result === 'object' ? result : { output: String(result) }),
            });
            voiceToolCallsInFlight = Math.max(0, voiceToolCallsInFlight - 1);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'tool_call', name: fc.name }));
            }
          }
          // The tool handlers above are awaited and side-effecting. If the socket
          // was superseded meanwhile, drop the response rather than injecting it
          // into the new session.
          if (geminiWs !== thisWs) {
            console.warn('[Lexi Native] Gemini socket superseded during tool call — discarding stale tool response');
          } else if (thisWs.readyState === WebSocket.OPEN) {
            thisWs.send(JSON.stringify({ tool_response: { function_responses: responses } }));
            const toolSummaries = responses.map(r => {
              const res = r.response;
              if (res.error || res.success === false) return `${r.name}: FAILED - ${res.error || 'unknown error'}`;
              return `${r.name}: SUCCESS - ${res.message || 'done'}`;
            }).join('; ');
            thisWs.send(JSON.stringify({
              client_content: {
                turns: [{
                  role: "user",
                  parts: [{ text: `[System: Tool results: ${toolSummaries}. Respond naturally. If any tool FAILED, tell the user honestly. Keep it brief.]` }]
                }],
                turn_complete: true
              }
            }));
          }
        }
        if (data.serverContent?.inputTranscription?.text) {
          const userText = data.serverContent.inputTranscription.text;
          markActivity();
          if (buildConfirmationState.pendingToken) {
            buildConfirmationState.userReply = userText;
          }
          voiceTurn.userMessage += `${voiceTurn.userMessage ? ' ' : ''}${userText}`;
          voiceTurn.sensitive = isVoiceGroundingSensitive(voiceTurn.userMessage);
          conversationLog.push({ role: 'User', text: userText });
          clientWs.send(JSON.stringify({ type: 'transcript', role: 'user', text: userText }));
        }
        if (data.serverContent?.outputTranscription?.text) {
          const lexiText = data.serverContent.outputTranscription.text;
          markActivity();
          voiceTurn.assistantText += `${voiceTurn.assistantText ? ' ' : ''}${lexiText}`;
          if (!voiceTurn.sensitive) {
            conversationLog.push({ role: 'Lexi', text: lexiText });
            clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: lexiText }));
          }
        }
        if (data.serverContent?.modelTurn?.parts) {
          for (const part of data.serverContent.modelTurn.parts) {
            if (part.text && !/\*\*/.test(part.text)) {
              voiceTurn.assistantText += `${voiceTurn.assistantText ? ' ' : ''}${part.text}`;
              if (!voiceTurn.sensitive) {
                conversationLog.push({ role: 'Lexi', text: part.text });
                clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: part.text }));
              }
            }
            if (part.inlineData?.mimeType?.startsWith("audio/") && clientWs.readyState === WebSocket.OPEN) {
              const audioSize = part.inlineData.data?.length || 0;
              if (audioSize > 0) {
                if (voiceTurn.sensitive) {
                  voiceTurn.audioChunks.push({ data: part.inlineData.data, mimeType: part.inlineData.mimeType });
                } else {
                  geminiIsSpeaking = true;
                  if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
                  clientWs.send(JSON.stringify({ type: 'audio', data: part.inlineData.data, mimeType: part.inlineData.mimeType }));
                }
              } else {
                console.warn('[Lexi Native] Empty audio chunk received from Gemini — skipping');
              }
            }
          }
        }
        if (data.serverContent?.interrupted) {
          geminiIsSpeaking = false;
          if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
          clientWs.send(JSON.stringify({ type: 'interrupted' }));
        }
        if (data.serverContent?.turnComplete) {
          if (voiceTurn.sensitive && voiceToolCallsInFlight > 0) {
            console.log('[Lexi Native] Deferring sensitive turn completion until tool results arrive');
            return;
          }
          if (voiceTurn.sensitive) {
            // "How much" activates the money guard, which normally requires a
            // CRM financial lookup. Ground calculator answers in their own
            // successful same-turn result instead, without relaxing that guard.
            const roofSupplement = voiceTurn.toolCalls.findLast(call =>
              call.name === 'calculate_roof_supplement'
              && !call.result?.error
              && typeof call.result?.supplement_amount_formatted === 'string');
            const verdict = roofSupplement ? {
              blocked: false, replaced: true, reason: 'deterministic_roof_supplement',
              response: `The roof supplement is ${roofSupplement.result.supplement_amount_formatted} for ${roofSupplement.result.supplement_sq} squares at $324.69 per square. This calculation has not changed any records.`,
            } : auditVoiceTurn(voiceTurn);
            const finalText = String(verdict.response || voiceTurn.assistantText || '').trim();
            if (verdict.replaced || verdict.blocked) {
              console.warn(`[Lexi Native] Blocked/replaced voice answer: ${verdict.reason || 'grounding audit'}`);
              if (finalText) {
                conversationLog.push({ role: 'Lexi', text: finalText });
                clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: finalText }));
                clientWs.send(JSON.stringify({ type: 'speak_text', text: finalText }));
              }
            } else {
              if (finalText) {
                conversationLog.push({ role: 'Lexi', text: finalText });
                clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: finalText }));
              }
              for (const chunk of voiceTurn.audioChunks) {
                clientWs.send(JSON.stringify({ type: 'audio', data: chunk.data, mimeType: chunk.mimeType }));
              }
              if (voiceTurn.audioChunks.length > 0) geminiIsSpeaking = true;
            }
            resetVoiceTurn();
          }
          clientWs.send(JSON.stringify({ type: 'turn_complete' }));
          if (geminiIsSpeaking) {
            setTimeout(() => {
              if (geminiIsSpeaking) {
                geminiIsSpeaking = false;
                console.log('[Lexi Native] Safety timeout: force-cleared geminiIsSpeaking after turnComplete');
              }
            }, 10000);
          }
        }
      } catch (err) { console.error('[Lexi Native] Gemini message error:', err.message); }
    });

    geminiWs.on('close', (code, reason) => {
      if (setupWatchdog) { clearTimeout(setupWatchdog); setupWatchdog = null; }
      console.warn('[Lexi Native] Gemini disconnected:', {
        code,
        reason: reason?.toString() || '(no reason)',
        handsFree,
        durationSec: Math.round((Date.now() - sessionStartTime) / 1000),
        browserOpen: clientWs.readyState === WebSocket.OPEN,
        clientClosed,
        reconnectAttempt: geminiReconnects,
      });
      // A superseded socket (already replaced by a reconnect) must not trigger
      // another reconnect or tear the live session down.
      if (geminiWs !== thisWs) return;
      setupComplete = false;

      if (clientClosed || clientWs.readyState !== WebSocket.OPEN) {
        saveSession();
        return;
      }

      if (geminiReconnects < MAX_GEMINI_RECONNECTS) {
        const attempt = ++geminiReconnects;
        const waitMs = attempt * 700;
        console.log(`[Lexi Native] Reconnecting to Gemini (${attempt}/${MAX_GEMINI_RECONNECTS}) in ${waitMs}ms`);
        // The browser socket stays open, so from the user's side this is still
        // one continuous session.
        clientWs.send(JSON.stringify({ type: 'status', status: 'reconnecting', attempt, max: MAX_GEMINI_RECONNECTS }));
        geminiIsSpeaking = false;
        if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
        setTimeout(() => {
          if (clientClosed || clientWs.readyState !== WebSocket.OPEN) return;
          connectGemini(true).catch(err => console.error('[Lexi Native] Reconnect failed:', err.message));
        }, waitMs);
        return;
      }

      // Reconnects exhausted. Own the teardown: close the browser socket too,
      // otherwise the client keeps a dead session alive with the mic and wake
      // lock still held and never runs its own recovery.
      saveSession();
      clientClosed = true;
      clientWs.send(JSON.stringify({ type: 'status', status: 'disconnected', code, fatal: true }));
      try { clientWs.close(4001, 'gemini-unreachable'); } catch (e) {}
    });
    geminiWs.on('error', (err) => {
      if (setupWatchdog) { clearTimeout(setupWatchdog); setupWatchdog = null; }
      console.error('[Lexi Native] Gemini error:', err.message);
      clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
    });
  }

  let geminiIsSpeaking = false;
  let geminiSpeechEndTimer = null;
  const POST_SPEECH_BUFFER_MS = 1200;

  connectGemini();

  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'playback_done') {
        if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
        geminiSpeechEndTimer = setTimeout(() => {
          geminiIsSpeaking = false;
          geminiSpeechEndTimer = null;
        }, POST_SPEECH_BUFFER_MS);
      }
      if (msg.type === 'user_interrupted') {
        // The browser has already stopped local playback and gated acoustic
        // echo. Forward mic audio immediately so Gemini can hear the barge-in;
        // applying POST_SPEECH_BUFFER_MS here used to discard "stop" itself.
        if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
        geminiIsSpeaking = false;
      }
      if (msg.type === 'audio' && geminiWs?.readyState === WebSocket.OPEN && setupComplete && !geminiIsSpeaking) {
        geminiWs.send(JSON.stringify({ realtime_input: { audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" } } }));
      }
      if (msg.type === 'text' && geminiWs?.readyState === WebSocket.OPEN && setupComplete) {
        if (buildConfirmationState.pendingToken) {
          buildConfirmationState.userReply = String(msg.text || '');
        }
        geminiWs.send(JSON.stringify({ client_content: { turns: [{ role: "user", parts: [{ text: msg.text }] }], turn_complete: true } }));
        conversationLog.push({ role: 'User', text: msg.text });
      }
    } catch (e) {}
  });

  clientWs.on('close', (code, reason) => {
    console.log('[Lexi Native] Browser client disconnected:', {
      code: code || 1005,
      reason: reason?.toString() || '(no reason)',
      handsFree,
      durationSec: Math.round((Date.now() - sessionStartTime) / 1000),
      geminiState: geminiWs?.readyState,
      setupComplete,
      reconnectAttempt: geminiReconnects,
    });
    if (setupWatchdog) { clearTimeout(setupWatchdog); setupWatchdog = null; }
    // Set BEFORE closing the upstream socket so its close handler treats this
    // as an intentional stop and does not schedule a reconnect.
    clientClosed = true;
    saveSession();
    if (idleTimer) clearInterval(idleTimer);
    if (geminiWs && (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING)) geminiWs.close();
  });
});

prodDb.initDatabase().then(async () => {
  console.log('[Production] Local database ready');
  try {
    const pool = prodDb.getPool();
    const { rows } = await pool.query(
      `SELECT id, data FROM generic_entities WHERE entity_type = 'AssistantSettings' AND data->>'voice_id' IS NOT NULL`
    );
    let fixed = 0;
    for (const row of rows) {
      const voiceId = row.data?.voice_id;
      if (voiceId && !VALID_GEMINI_VOICES.includes(voiceId)) {
        await pool.query(
          `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{voice_id}', '"Kore"'), updated_date = NOW() WHERE id = $1`,
          [row.id]
        );
        fixed++;
        console.log(`[VoiceMigration] Fixed invalid voice_id "${voiceId}" -> "Kore" for AssistantSettings ${row.id}`);
      }
    }
    if (fixed > 0) console.log(`[VoiceMigration] Cleaned up ${fixed} invalid voice IDs`);
  } catch (e) {
    console.warn('[VoiceMigration] Non-critical error:', e.message);
  }

  try {
    const pool = prodDb.getPool();
    // Sync is_administrator from staff_profiles (authoritative) → generic_entities (UI store)
    const syncResult = await pool.query(
      `SELECT sp.user_email, sp.is_administrator, ge.id as ge_id, (ge.data->>'is_administrator')::text as ge_admin
       FROM staff_profiles sp
       JOIN generic_entities ge ON ge.entity_type = 'StaffProfile' AND (ge.data->>'user_email' = sp.user_email OR ge.data->>'email' = sp.user_email)
       WHERE sp.is_administrator IS NOT NULL`
    );
    let synced = 0;
    for (const row of syncResult.rows) {
      const spAdmin = row.is_administrator === true ? 'true' : 'false';
      if (row.ge_admin !== spAdmin) {
        await pool.query(
          `UPDATE generic_entities SET data = jsonb_set(data, '{is_administrator}', $1::jsonb), updated_date = NOW() WHERE id = $2`,
          [spAdmin, row.ge_id]
        );
        synced++;
      }
    }
    if (synced > 0) console.log(`[Security] Synced is_administrator for ${synced} staff profile(s) from staff_profiles → generic_entities`);

    // #691: Backfill created_by for legacy companies that predate the guard
    try {
      const bfResult = await pool.query(`
        UPDATE companies c
        SET created_by = sp.user_email
        FROM (
          SELECT DISTINCT ON (company_id) company_id, user_email
          FROM staff_profiles
          WHERE is_administrator = true AND user_email IS NOT NULL AND user_email <> ''
          ORDER BY company_id, created_at
        ) sp
        WHERE c.id = sp.company_id
          AND (c.created_by IS NULL OR c.created_by = '')
      `);
      if (bfResult.rowCount > 0) {
        console.log(`[Startup] Backfilled created_by for ${bfResult.rowCount} legacy company/companies`);
      }
    } catch (bfErr) {
      console.warn('[Startup] created_by backfill failed (non-fatal):', bfErr.message);
    }

  } catch (e) {
    console.warn('[Security] Server startup admin flag cleanup failed:', e.message);
  }


}).catch(err => {
  // Weak item #10: crash loudly on init failure so the supervisor restarts us
  // with a fresh attempt, instead of silently warning and continuing in a
  // half-initialised state where every request will 500.
  console.error('[Production] FATAL: database initialization failed', err);
  process.exit(1);
});

// Storm alert cron — catch up shortly after startup, then run every 30 minutes.
// The startup run prevents downtime from extending into another 30-minute blind
// window after the server is healthy again.
async function runStormAlertCron() {
  try {
    const pool = prodDb.getPool();
    const stormFns = require('./db/storm-functions.cjs');
    const prodInteg = require('./db/prod-integrations.cjs');
    const result = await stormFns.checkAndSendStormAlerts(pool, {
      sendEmailFn: async (emailData) => prodInteg.sendEmailWithData(emailData, emailData.companyId),
    });
    console.log(
      `[Cron:stormAlerts] ran — ${result.totalStorms || 0} candidates, ` +
      `${result.totalCompanies || 0} companies, ${(result.emailsSent || 0) + (result.smsSent || 0)} sent`
    );
  } catch (err) {
    console.error('[Cron:stormAlerts] Error:', err.message);
  }
}

setTimeout(runStormAlertCron, 90 * 1000);
setInterval(runStormAlertCron, 30 * 60 * 1000);

// Helper: call internal function API
// Attaches an X-Cron-Token header (HMAC of 'internal-cron-2026' via SESSION_SECRET)
// so handlers that run cross-tenant sweeps can distinguish trusted server-side
// cron invocations from unauthenticated browser calls to /api/functions/invoke.
// Deliberately fails closed: if SESSION_SECRET is absent the token is an empty
// string, which the handler will reject (it also fails closed without the secret).
const _cronToken = process.env.SESSION_SECRET
  ? require('crypto')
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update('internal-cron-2026')
      .digest('hex')
  : '';

async function callInternalFunction(functionName, params = {}) {
  const resp = await fetch('http://localhost:5000/api/functions/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-token': _cronToken },
    body: JSON.stringify({ functionName, params }),
  });
  return resp.json();
}

// checkReminders — calendar event reminders every 5 minutes
setInterval(async () => {
  try {
    const result = await callInternalFunction('checkReminders', {});
    if (result?.data?.notifications_sent > 0) console.log(`[Cron:checkReminders] ${result.data.notifications_sent} reminders sent`);
  } catch (err) {
    console.error('[Cron:checkReminders] Error:', err.message);
  }
}, 5 * 60 * 1000);

// processLeadConfirmationOutreach — sends queued new-lead texts and escalates
// unreplied leads through the guarded Alex caller every 5 minutes.
setInterval(async () => {
  try {
    const result = await callInternalFunction('processLeadConfirmationOutreach', {});
    const d = result?.data || {};
    if ((d.sent || 0) + (d.called || 0) + (d.replied || 0) > 0) {
      console.log(`[Cron:processLeadConfirmationOutreach] texted=${d.sent || 0} called=${d.called || 0} replied=${d.replied || 0}`);
    }
  } catch (err) {
    console.error('[Cron:processLeadConfirmationOutreach] Error:', err.message);
  }
}, 5 * 60 * 1000);

// bulkSyncAllCalendars — two-way Google Calendar sync every 15 minutes.
// Without this, events created in Google Calendar only reached CS while a
// user had the Calendar page open (the client-side auto-sync runs every 5
// minutes but only while the page is mounted). This keeps both directions
// flowing server-side for every connected user.
let bulkCalendarSyncRunning = false;
setInterval(async () => {
  if (bulkCalendarSyncRunning) return; // don't pile up if a run outlasts the interval
  bulkCalendarSyncRunning = true;
  try {
    const result = await callInternalFunction('bulkSyncAllCalendars', {});
    const d = result?.data || result || {};
    if ((d.success ?? 0) > 0 || (d.failed ?? 0) > 0) {
      console.log(`[Cron:bulkSyncAllCalendars] synced=${d.success ?? 0} failed=${d.failed ?? 0}`);
    }
  } catch (err) {
    console.error('[Cron:bulkSyncAllCalendars] Error:', err.message);
  } finally {
    bulkCalendarSyncRunning = false;
  }
}, 15 * 60 * 1000);

// processActionItemEscalation — every 15 minutes
setInterval(async () => {
  try {
    const result = await callInternalFunction('processActionItemEscalation', {});
    const d = result?.data || {};
    if (d.escalated > 0 || d.reminded > 0 || d.reactivated > 0) {
      console.log(`[Cron:processActionItemEscalation] ${d.reactivated} reactivated, ${d.escalated} escalated, ${d.reminded} reminded`);
    }
  } catch (err) {
    console.error('[Cron:processActionItemEscalation] Error:', err.message);
  }
}, 15 * 60 * 1000);

// purgeStaleStormLeads — once daily (2 AM UTC): archives storm_canvass leads with 30+ days no engagement
setInterval(async () => {
  const nowUtc = new Date().getUTCHours();
  if (nowUtc !== 2) return; // only run in the 2 AM UTC window
  try {
    const result = await callInternalFunction('purgeStaleStormLeads', {});
    const d = result?.data || {};
    if (d.archived > 0) {
      console.log(`[Cron:purgeStaleStormLeads] Archived ${d.archived} stale storm canvass leads (30d no engagement)`);
    }
  } catch (err) {
    console.error('[Cron:purgeStaleStormLeads] Error:', err.message);
  }
}, 60 * 60 * 1000); // check every hour, gate on UTC hour

// scanBuildReminders — every hour (idempotent): drafts approval-gated build reminders into Action Items
setInterval(async () => {
  try {
    const result = await callInternalFunction('scanBuildReminders', {});
    const d = result?.data || {};
    if (d.drafted > 0) console.log(`[Cron:scanBuildReminders] ${d.drafted} drafted, ${d.skipped} skipped`);
  } catch (err) {
    console.error('[Cron:scanBuildReminders] Error:', err.message);
  }
}, 60 * 60 * 1000);

// checkStaleLeads — every 8 hours. Also closes untouched New leads at 60 days.
// Run once after startup too, so a deployment does not leave an existing
// 60-day backlog waiting for the next interval.
setTimeout(async () => {
  try {
    const result = await callInternalFunction('checkStaleLeads', {});
    const d = result?.data || {};
    if (d.totalLost > 0) {
      console.log(`[Cron:checkStaleLeads] Startup catch-up marked ${d.totalLost} stale lead(s) lost`);
    }
  } catch (err) {
    console.error('[Cron:checkStaleLeads] Startup catch-up error:', err.message);
  }
}, 90 * 1000);

setInterval(async () => {
  try {
    const result = await callInternalFunction('checkStaleLeads', {});
    const d = result?.data || {};
    if (d.totalFlagged > 0 || d.totalNotified > 0 || d.totalLost > 0) {
      console.log(`[Cron:checkStaleLeads] ${d.totalFlagged} flagged, ${d.totalNotified} notified, ${d.followUpCreated} follow-ups created, ${d.totalLost} marked lost`);
    }
  } catch (err) {
    console.error('[Cron:checkStaleLeads] Error:', err.message);
  }
}, 8 * 60 * 60 * 1000);

// sendStaleLeadDigest — every 5 minutes, self-gated to 7:00-7:59 AM in
// America/New_York with a durable per-company/rep/day delivery claim.
setInterval(async () => {
  try {
    const result = await callInternalFunction('sendStaleLeadDigest', {});
    const d = result?.data || {};
    if (d.sent > 0) {
      console.log(`[Cron:sendStaleLeadDigest] ${d.sent} rep digest(s) sent for ${d.stale_leads || 0} stale lead(s)`);
    }
  } catch (err) {
    console.error('[Cron:sendStaleLeadDigest] Error:', err.message);
  }
}, 5 * 60 * 1000);

// scanBuildProgressUpdates — every 15 min, gated internally to Thursday 10am per company timezone (weekly customer progress texts)
setInterval(async () => {
  try {
    const result = await callInternalFunction('scanBuildProgressUpdates', {});
    const d = result?.data || {};
    if (d.sent > 0) console.log(`[Cron:scanBuildProgressUpdates] ${d.sent} progress text(s) sent`);
  } catch (err) {
    console.error('[Cron:scanBuildProgressUpdates] Error:', err.message);
  }
}, 15 * 60 * 1000);

// scanStuckJobs — every 8 hours (internal-only stuck-job alerts; built-in dedup per build+stage)
setInterval(async () => {
  try {
    const result = await callInternalFunction('scanStuckJobs', {});
    const d = result?.data || {};
    if (d.alerted > 0) console.log(`[Cron:scanStuckJobs] ${d.alerted} stuck-job alert(s) created`);
  } catch (err) {
    console.error('[Cron:scanStuckJobs] Error:', err.message);
  }
}, 8 * 60 * 60 * 1000);

// scanPunchListReminders — every hour (nag cadence is 3 days; the hourly pass
// only re-arms nags whose due date has passed, and closes nags the moment the
// last punch item is checked off)
setInterval(async () => {
  try {
    const result = await callInternalFunction('scanPunchListReminders', {});
    const d = result?.data || {};
    if (d.created > 0 || d.rearmed > 0 || d.closed > 0) {
      console.log(`[Cron:scanPunchListReminders] ${d.created} opened, ${d.rearmed} re-armed, ${d.escalated} escalated, ${d.closed} closed`);
    }
  } catch (err) {
    console.error('[Cron:scanPunchListReminders] Error:', err.message);
  }
}, 60 * 60 * 1000);

// nagPersonalTodos — every 30 minutes (cooldown built-in: 4h overdue, 12h due-today)
setInterval(async () => {
  try {
    const result = await callInternalFunction('nagPersonalTodos', {});
    const d = result?.data || {};
    if (d.notified > 0) {
      console.log(`[Cron:nagPersonalTodos] ${d.notified} nagged, ${d.skipped} in cooldown`);
    }
  } catch (err) {
    console.error('[Cron:nagPersonalTodos] Error:', err.message);
  }
}, 30 * 60 * 1000);

// processScheduledCampaigns — every 5 minutes
setInterval(async () => {
  try {
    const result = await callInternalFunction('processScheduledCampaigns', {});
    const d = result?.data || {};
    if (d.sent > 0) console.log(`[Cron:processScheduledCampaigns] ${d.sent} campaigns sent`);
  } catch (err) {
    console.error('[Cron:processScheduledCampaigns] Error:', err.message);
  }
}, 5 * 60 * 1000);

// ghlAutoSyncCron — run on startup, then every 30 minutes. Waiting for the
// first interval left a freshly restarted production app unsynced for 30 min.
const runGhlAutoSyncCron = async () => {
  try {
    const result = await callInternalFunction('ghlAutoSyncCron', {});
    const details = result?.data || result || {};
    if (details.results?.some?.(item => item.error)) {
      console.error('[Cron:ghlAutoSyncCron] One or more company syncs failed:', JSON.stringify(details.results));
    }
  } catch (err) {
    console.error('[Cron:ghlAutoSyncCron] Error:', err.message);
  }
};
setInterval(runGhlAutoSyncCron, 30 * 60 * 1000);
runGhlAutoSyncCron();

// checkInvoiceReminders — every 15 minutes (function checks internally if it's 9am)
setInterval(async () => {
  try {
    await callInternalFunction('checkInvoiceReminders', {});
  } catch (err) {
    console.error('[Cron:checkInvoiceReminders] Error:', err.message);
  }
}, 15 * 60 * 1000);

// checkTaskReminders — every 15 minutes (function checks internally if it's 9am)
setInterval(async () => {
  try {
    await callInternalFunction('checkTaskReminders', {});
  } catch (err) {
    console.error('[Cron:checkTaskReminders] Error:', err.message);
  }
}, 15 * 60 * 1000);

// decayLeadScores — every 6 hours
setInterval(async () => {
  try {
    await callInternalFunction('decayLeadScores', {});
  } catch (err) {
    console.error('[Cron:decayLeadScores] Error:', err.message);
  }
}, 6 * 60 * 60 * 1000);

// sendFridayPortalRecap — every 15 minutes, gated to Friday 5pm per company timezone
setInterval(async () => {
  try {
    const result = await callInternalFunction('sendFridayPortalRecap', {});
    const d = result?.data || {};
    if (d.sent > 0) console.log(`[Cron:sendFridayPortalRecap] ${d.sent} recap(s) sent`);
  } catch (err) {
    console.error('[Cron:sendFridayPortalRecap] Error:', err.message);
  }
}, 15 * 60 * 1000);

// processReviewRequests — every 6 hours
setInterval(async () => {
  try {
    const result = await callInternalFunction('processReviewRequests', {});
    const d = result?.data || {};
    if (d.sent > 0) console.log(`[Cron:processReviewRequests] ${d.sent} review message(s) sent`);
  } catch (err) {
    console.error('[Cron:processReviewRequests] Error:', err.message);
  }
}, 6 * 60 * 60 * 1000);

// reconcileEmailDeliveryEvents — every 10 minutes. Provider delivery/bounce
// callbacks that could not be applied on arrival (the callback beat its own
// send record, or the database was briefly unavailable) are retained on a
// ledger. Webhook traffic is bursty and can stop entirely, so without a timer
// an acknowledged outcome that will never be resent stays stranded.
setInterval(async () => {
  try {
    const result = await require('./lib/emailDeliveryWebhook.cjs')
      .reconcileEmailDeliveryEvents({ pool: prodDb.getPool() });
    if (result?.applied || result?.repaired || result?.retired || result?.purged) {
      console.log(`[Cron:reconcileEmailDeliveryEvents] repaired ${result.repaired}, applied ${result.applied}, retired ${result.retired}, still pending ${result.pending}, purged ${result.purged}`);
    }
  } catch (err) {
    console.error('[Cron:reconcileEmailDeliveryEvents] Error:', err.message);
  }
}, 10 * 60 * 1000);

// createDailyBackup — daily at 2am UTC. This was registered in the dev-only
// cron scheduler (vite-cron-plugin.js) but never mirrored here, so production
// was never getting automated daily/weekly/monthly backups — only manual ones.
// Checked every 5 min; fires once when UTC hour hits 2, guarded by a 20h cooldown.
let lastDailyBackupRunAt = 0;
setInterval(async () => {
  try {
    const now = new Date();
    const withinWindow = now.getUTCHours() === 2 && now.getUTCMinutes() <= 4;
    if (withinWindow && Date.now() - lastDailyBackupRunAt >= 20 * 60 * 60 * 1000) {
      lastDailyBackupRunAt = Date.now();
      const result = await callInternalFunction('createDailyBackup', {});
      const count = result?.backups?.length ?? result?.data?.backups?.length;
      console.log(`[Cron:createDailyBackup] ${result?.success !== false ? `completed (${count ?? '?'} companies)` : `failed: ${result?.error || result?.data?.error}`}`);
    }
  } catch (err) {
    console.error('[Cron:createDailyBackup] Error:', err.message);
  }
}, 5 * 60 * 1000);

// cronCleanupBackups — daily at 3am UTC (auto-delete expired backups + 7-day
// expiry warnings). Same dev-only gap as createDailyBackup above.
let lastCleanupBackupsRunAt = 0;
setInterval(async () => {
  try {
    const now = new Date();
    const withinWindow = now.getUTCHours() === 3 && now.getUTCMinutes() <= 4;
    if (withinWindow && Date.now() - lastCleanupBackupsRunAt >= 20 * 60 * 60 * 1000) {
      lastCleanupBackupsRunAt = Date.now();
      await callInternalFunction('cronCleanupBackups', {});
      console.log('[Cron:cronCleanupBackups] completed');
    }
  } catch (err) {
    console.error('[Cron:cronCleanupBackups] Error:', err.message);
  }
}, 5 * 60 * 1000);

// checkOverdueInvoices — daily at 8am UTC (create Action Items for invoices 7+
// days past due). Was dev-only in vite-cron-plugin.js; mirror to production.
let lastOverdueInvoicesRunAt = 0;
setInterval(async () => {
  try {
    const now = new Date();
    const withinWindow = now.getUTCHours() === 8 && now.getUTCMinutes() <= 4;
    if (withinWindow && Date.now() - lastOverdueInvoicesRunAt >= 20 * 60 * 60 * 1000) {
      lastOverdueInvoicesRunAt = Date.now();
      await callInternalFunction('checkOverdueInvoices', {});
      console.log('[Cron:checkOverdueInvoices] completed');
    }
  } catch (err) {
    console.error('[Cron:checkOverdueInvoices] Error:', err.message);
  }
}, 5 * 60 * 1000);

// processTrialLifecycle — daily at 10am UTC (14-day trial nurture emails/SMS +
// expire trials past their end date). Was dev-only in vite-cron-plugin.js;
// mirror to production so trial companies actually get onboarding/conversion
// touches and get flipped to 'expired' when their trial runs out.
let lastTrialLifecycleRunAt = 0;
setInterval(async () => {
  try {
    const now = new Date();
    const withinWindow = now.getUTCHours() === 10 && now.getUTCMinutes() <= 4;
    if (withinWindow && Date.now() - lastTrialLifecycleRunAt >= 20 * 60 * 60 * 1000) {
      lastTrialLifecycleRunAt = Date.now();
      const result = await callInternalFunction('processTrialLifecycle', {});
      console.log(`[Cron:processTrialLifecycle] ${result?.success !== false ? 'completed' : `failed: ${result?.error || result?.data?.error}`}`);
    }
  } catch (err) {
    console.error('[Cron:processTrialLifecycle] Error:', err.message);
  }
}, 5 * 60 * 1000);

// purgeOldStormEvents — daily at 4am UTC (delete StormEvents older than 365 days;
// retention must cover the UI's 365-day search-history window).
// Was dev-only in vite-cron-plugin.js; mirror to production.
let lastPurgeStormRunAt = 0;
setInterval(async () => {
  try {
    const now = new Date();
    const withinWindow = now.getUTCHours() === 4 && now.getUTCMinutes() <= 4;
    if (withinWindow && Date.now() - lastPurgeStormRunAt >= 20 * 60 * 60 * 1000) {
      lastPurgeStormRunAt = Date.now();
      await callInternalFunction('purgeOldStormEvents', {});
      console.log('[Cron:purgeOldStormEvents] completed');
    }
  } catch (err) {
    console.error('[Cron:purgeOldStormEvents] Error:', err.message);
  }
}, 5 * 60 * 1000);

// cronCleanupLexiPendingSchedules — hourly. Lexi writes a LexiPendingSchedule row
// on every calendar conflict; confirmed ones are stamped 'used' and unanswered ones
// are simply abandoned. Both are unusable after their 10-minute token TTL, so they
// are swept once an hour. Mirrors the vite-cron-plugin.js registration.
setInterval(async () => {
  try {
    const result = await callInternalFunction('cronCleanupLexiPendingSchedules', {});
    const deleted = result?.deleted ?? result?.data?.deleted ?? 0;
    if (deleted > 0) console.log(`[Cron:cronCleanupLexiPendingSchedules] deleted ${deleted} stale confirmation(s)`);
  } catch (err) {
    console.error('[Cron:cronCleanupLexiPendingSchedules] Error:', err.message);
  }
}, 60 * 60 * 1000);

// purgeOldDailyReports — daily at 4am UTC (delete DailyReports older than 90 days).
// Was dev-only in vite-cron-plugin.js; mirror to production.
let lastPurgeReportsRunAt = 0;
setInterval(async () => {
  try {
    const now = new Date();
    const withinWindow = now.getUTCHours() === 4 && now.getUTCMinutes() <= 4;
    if (withinWindow && Date.now() - lastPurgeReportsRunAt >= 20 * 60 * 60 * 1000) {
      lastPurgeReportsRunAt = Date.now();
      await callInternalFunction('purgeOldDailyReports', {});
      console.log('[Cron:purgeOldDailyReports] completed');
    }
  } catch (err) {
    console.error('[Cron:purgeOldDailyReports] Error:', err.message);
  }
}, 5 * 60 * 1000);

// sendWeeklyCommissionDigest — every 15 min, self-gated to Friday 4pm per company
// timezone. Was dev-only in vite-cron-plugin.js; mirror to production.
setInterval(async () => {
  try {
    const result = await callInternalFunction('sendWeeklyCommissionDigest', {});
    const d = result?.data || {};
    if (d.sent > 0) console.log(`[Cron:sendWeeklyCommissionDigest] ${d.sent} digest(s) sent`);
  } catch (err) {
    console.error('[Cron:sendWeeklyCommissionDigest] Error:', err.message);
  }
}, 15 * 60 * 1000);

// sendWeeklyLeaderboardDigest — every 15 min, self-gated to Monday 8am per
// company timezone. Sends last week's staff leaderboard to all active staff.
setInterval(async () => {
  try {
    const result = await callInternalFunction('sendWeeklyLeaderboardDigest', {});
    const d = result?.data || {};
    if (d.sent > 0) console.log(`[Cron:sendWeeklyLeaderboardDigest] ${d.sent} digest(s) sent`);
  } catch (err) {
    console.error('[Cron:sendWeeklyLeaderboardDigest] Error:', err.message);
  }
}, 15 * 60 * 1000);

// sendMorningDigest — every 5 min, self-gated to each staff member's work-hours
// start window. Sends overnight call/text/action-item summary to all staff with
// a Twilio number. Also fires immediately on manual clock-in (availability toggle).
setInterval(async () => {
  try {
    const result = await callInternalFunction('sendMorningDigest', {});
    const d = result?.data || {};
    if (d.sent > 0) console.log(`[Cron:sendMorningDigest] ${d.sent} morning digest(s) sent`);
  } catch (err) {
    console.error('[Cron:sendMorningDigest] Error:', err.message);
  }
}, 5 * 60 * 1000);

// checkTenantCostAlerts — daily at 9 AM UTC.  Scans every active paid tenant's
// month-to-date platform-key API costs and emails/notifies the super-admin when
// any single tenant's spend exceeds 50% of their $149 plan price ($74.50).
// Fires at most once per tenant per calendar month (CostAlert entity is the dedup).
let lastTenantCostAlertRunAt = 0;
setInterval(async () => {
  try {
    const now = new Date();
    const withinWindow = now.getUTCHours() === 9 && now.getUTCMinutes() <= 4;
    if (withinWindow && Date.now() - lastTenantCostAlertRunAt >= 20 * 60 * 60 * 1000) {
      lastTenantCostAlertRunAt = Date.now();
      const result = await callInternalFunction('checkTenantCostAlerts', {});
      const d = result?.data || result || {};
      console.log(`[Cron:checkTenantCostAlerts] ${d.alertsSent ?? 0} alert(s) sent, BYOK adoption: ${d.byokAdoptionPct ?? '?'}% (${d.byokCount ?? '?'}/${d.totalPaid ?? '?'} paid)`);
    }
  } catch (err) {
    console.error('[Cron:checkTenantCostAlerts] Error:', err.message);
  }
}, 5 * 60 * 1000);

// ============================================================
// GEMINI LIVE API HEALTH-CHECK PROBE
// Logic lives in lib/geminiLiveProbe.cjs (shared with test script).
// Opens a real WS session, sends one silence audio frame, holds the
// socket open for a 4-second quiet window, and resolves ok only when
// no error/close arrives during that window — so a MIME/format
// regression is caught rather than masked.
// If the probe fails an admin bell + email fires so API deprecations
// are caught within ~2 hours instead of waiting for a user report.
// ============================================================
const { probeGeminiLiveApi, normalizeRecipientEmails } = require('./lib/geminiLiveProbe.cjs');

// Send a bell notification + email to all super-admins when the probe fails.
async function fireGeminiApiHealthAlert(errorReason, closeCode) {
  const title = '⚠️ Gemini Live API health-check failed';
  const message = `The Gemini Live WebSocket probe failed — AI voice calls may be broken. Error: ${errorReason || 'unknown'}${closeCode != null ? ` (close code ${closeCode})` : ''}. Check GOOGLE_GEMINI_API_KEY and the Gemini Live API model name.`;
  try {
    const pool = prodDb.getPool();
    // Notify all super-admins (any company) + admins of the master company
    // Select raw columns — normalizeRecipientEmails() handles NULLIF/BTRIM
    // equivalent logic (empty AND whitespace-only fallback) and deduplication,
    // so the production path is identical to the unit-tested helper.
    // No LIMIT — must reach every super-admin regardless of org size.
    const { rows: adminRows } = await pool.query(
      `SELECT user_email, email FROM staff_profiles WHERE is_super_admin = true AND is_active = true
       UNION
       SELECT email AS user_email, email FROM users WHERE platform_role = 'super_admin'`
    );
    const adminEmails = normalizeRecipientEmails(adminRows);
    // Always include ADMIN_PHONE owner email if set in the environment
    const adminEmailEnv = process.env.ADMIN_EMAIL;
    if (adminEmailEnv && !adminEmails.includes(adminEmailEnv)) adminEmails.push(adminEmailEnv);
    for (const email of adminEmails) {
      // Bell notification
      const nId = `notif_geminiprobe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', 'companysync_master_001', $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [nId, JSON.stringify({
            id: nId, type: 'system_alert', title, message,
            user_email: email, is_read: false,
            error_reason: errorReason, close_code: closeCode,
            created_at: new Date().toISOString(),
          })]
        );
      } catch (dbErr) { console.warn('[GeminiProbe] Bell insert error:', dbErr.message); }
      // Email
      try {
        await sendEmail({
          to: email, subject: title,
          html: `<h2 style="color:#dc2626">${title}</h2><p style="font-family:sans-serif;font-size:14px">${message}</p><hr/><p style="font-family:sans-serif;font-size:12px;color:#666">This alert fires every time the Gemini Live health-check probe detects a failure. Check the server logs for details ([Cron:geminiLiveProbe]).</p>`,
        });
      } catch (emailErr) { console.warn('[GeminiProbe] Email error:', emailErr.message); }
    }
    console.warn(`[Cron:geminiLiveProbe] Alert sent to ${adminEmails.length} admin(s): ${errorReason}`);
  } catch (e) {
    console.error('[Cron:geminiLiveProbe] Failed to fire alert:', e.message);
  }
}

// geminiLiveProbe — every 2 hours (detects API changes within ~2 hours).
// Alerts immediately on first failure, then re-alerts every 6 hours while
// the API remains down, so sustained outages produce approximately one
// alert per 6 hours rather than per probe run.
let geminiProbeLastFailureAlertAt = 0;
let geminiProbeLastStatus = null; // 'ok' | 'fail' | null
setInterval(async () => {
  try {
    const result = await probeGeminiLiveApi();
    if (result.ok) {
      if (geminiProbeLastStatus === 'fail') {
        console.log(`[Cron:geminiLiveProbe] ✅ Gemini Live API recovered (latency ${result.latencyMs}ms)`);
      } else {
        console.log(`[Cron:geminiLiveProbe] ✅ OK (setupComplete + audio quiet window passed in ${result.latencyMs}ms)`);
      }
      geminiProbeLastStatus = 'ok';
    } else {
      console.error(`[Cron:geminiLiveProbe] ❌ FAILED: ${result.errorReason} (latency ${result.latencyMs}ms)`);
      const now = Date.now();
      // Alert on first failure OR after 6-hour re-alert cooldown during sustained failure.
      // With a 2-hour probe interval this gives a re-alert spacing of 6-8 hours (2h probe
      // granularity means the first probe that clears the 6h cooldown fires the alert).
      const shouldAlert = geminiProbeLastStatus !== 'fail' || (now - geminiProbeLastFailureAlertAt >= 6 * 60 * 60 * 1000);
      geminiProbeLastStatus = 'fail';
      if (shouldAlert) {
        geminiProbeLastFailureAlertAt = now;
        await fireGeminiApiHealthAlert(result.errorReason, result.closeCode);
      } else {
        const nextAlertMins = Math.round((6 * 60 * 60 * 1000 - (now - geminiProbeLastFailureAlertAt)) / 60000);
        console.warn(`[Cron:geminiLiveProbe] Still failing — next alert in ~${nextAlertMins}min`);
      }
    }
  } catch (err) {
    console.error('[Cron:geminiLiveProbe] Unexpected error:', err.message);
  }
}, 2 * 60 * 60 * 1000);

require('./lib/startupSecrets.cjs').assertStartupSecrets();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Production] Server running on port ${PORT}`);
  console.log(`[Production] Auth: /api/login, /api/callback, /api/auth/user, /api/logout, /api/auth/google, /api/auth/google/callback, /api/login-local, /api/signup, /api/confirm-email, /api/change-password`);
  console.log(`[Production] Integrations: /api/integrations/* (invoke-llm, upload, send-email)`);
  console.log(`[Production] Functions: /api/functions/invoke`);
  console.log(`[Production] Auto-provisioning: /api/twilio/auto-provision`);
  console.log(`[Production] Local DB API: /api/local/*`);
  console.log(`[Production] Lexi native bridge: /ws/lexi-native`);
  console.log(`[Production] Sarah voice bridge: /ws/twilio`);
  refreshCacheFromAPI().then(() => {
    console.log(`[Production] Subscriber cache loaded: ${subscriberCache.size} entries`);
  }).catch(err => {
    console.warn(`[Production] Initial cache load failed (will retry):`, err.message);
  });
  // Register/update the live Stripe webhook URL so events reach this server.
  // Non-blocking — a failure here only logs a warning and does not crash startup.
  registerStripeWebhook().catch(err => {
    console.warn('[Stripe] Startup webhook registration failed:', err.message);
  });
});
