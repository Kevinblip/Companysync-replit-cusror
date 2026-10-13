'use strict';

/**
 * Inbound provider delivery webhook (delivery / bounce / spam complaint).
 *
 * Two separate jobs run off the same ingress:
 *
 * 1. The outbound safety circuit breaker in lib/emailProviderHealth.cjs can only
 *    trip on signals it actually receives. Providers report bounces and
 *    complaints asynchronously, so without this ingress the breaker is inert in
 *    production — it would only ever see synchronous send failures, which is not
 *    how a spam complaint arrives.
 *
 * 2. Provider acceptance is NOT inbox delivery. The communications row written
 *    at send time only records that the provider took the request; the terminal
 *    outcome arrives here, minutes to hours later. Matching that outcome back to
 *    the row by provider message id is the only way staff can tell a delivered
 *    message from one that bounced or was filtered.
 *
 * This is a PUBLIC route (the provider calls it, not a logged-in user), so it
 * must be mirrored in both the dev vite plugin and prod-server.cjs. It is
 * required directly by both rather than duplicated.
 */

const crypto = require('crypto');

const MAX_BODY_BYTES = 512 * 1024;
const ROUTE = '/api/email/delivery-webhook';

function timingSafeEqualStr(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined && req.body !== null) {
      resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Webhook body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function firstRecipient(value) {
  if (Array.isArray(value)) return value[0] || null;
  if (typeof value === 'string') return value || null;
  return null;
}

// Our own pre-send correlation id, echoed back by every provider. It is what
// makes a callback matchable when the provider's message id never reached the
// database, so it is read from whichever field each provider returns it in.
const CORRELATION_HEADER = 'X-Delivery-Correlation';

function headerValue(headers, name) {
  if (!headers) return null;
  const wanted = String(name).toLowerCase();
  if (Array.isArray(headers)) {
    const hit = headers.find((entry) => String(entry?.name || entry?.Name || '').toLowerCase() === wanted);
    return hit ? (hit.value || hit.Value || null) : null;
  }
  if (typeof headers === 'object') {
    const key = Object.keys(headers).find((entry) => entry.toLowerCase() === wanted);
    return key ? (headers[key] || null) : null;
  }
  return null;
}

function tagValue(tags, name) {
  if (!tags || typeof tags !== 'object') return null;
  // Resend can also return tags in the send-side array form.
  if (Array.isArray(tags)) {
    const hit = tags.find((entry) => String(entry?.name || '').toLowerCase() === name);
    return hit ? (hit.value || null) : null;
  }
  // SES message tags arrive as { name: [value] }; Resend as { name: value }.
  const key = Object.keys(tags).find((entry) => entry.toLowerCase() === name);
  if (!key) return null;
  const value = tags[key];
  return Array.isArray(value) ? (value[0] || null) : (value || null);
}

/**
 * Normalize the three provider payload shapes we can receive into the
 * { event, provider, messageId, recipient } contract reportDeliveryEvent takes.
 * Anything we do not recognise yields no events rather than a guessed one — a
 * misparsed payload that invents a bounce would pause delivery for everyone.
 */
function parseProviderEvents(payload) {
  if (!payload || typeof payload !== 'object') return [];

  // Postmark: one event per POST, discriminated by RecordType.
  if (typeof payload.RecordType === 'string') {
    const type = payload.RecordType.toLowerCase();
    const event = type === 'bounce'
      ? 'bounce'
      : type === 'spamcomplaint'
        ? 'complaint'
        : type === 'delivery'
          ? 'delivered'
          : null;
    if (!event) return [];
    return [{
      event,
      provider: 'postmark',
      messageId: payload.MessageID || payload.MessageId || null,
      correlationId: payload.Metadata?.correlation || payload.Metadata?.Correlation || null,
      recipient: payload.Email || payload.Recipient || null,
      detail: payload.Description || payload.Details || null,
      occurredAt: payload.DeliveredAt || payload.BouncedAt || null,
    }];
  }

  // Resend: { type: 'email.delivered' | 'email.bounced' | 'email.complained', data: {...} }
  if (typeof payload.type === 'string' && payload.type.startsWith('email.')) {
    const suffix = payload.type.slice('email.'.length);
    const event = suffix === 'bounced'
      ? 'bounce'
      : suffix === 'complained'
        ? 'complaint'
        : suffix === 'delivered'
          ? 'delivered'
          : null;
    if (!event) return [];
    const data = payload.data || {};
    return [{
      event,
      provider: 'resend',
      messageId: data.email_id || data.id || null,
      // Resend returns tags as a { name: value } map on the event; the
      // outbound header is not echoed, so the tag is the real carrier.
      correlationId: tagValue(data.tags, 'correlation') || headerValue(data.headers, CORRELATION_HEADER),
      recipient: firstRecipient(data.to),
      detail: data.reason || data.bounce?.message || null,
      occurredAt: data.created_at || payload.created_at || null,
    }];
  }

  // Amazon SES delivers through SNS: the real notification is a JSON *string*
  // in Message. Subscription confirmations are handled by the caller.
  if (payload.Type === 'Notification' && typeof payload.Message === 'string') {
    let inner = null;
    try { inner = JSON.parse(payload.Message); } catch { return []; }
    return parseSesNotification(inner);
  }
  if (typeof payload.notificationType === 'string' || typeof payload.eventType === 'string') {
    return parseSesNotification(payload);
  }

  return [];
}

function parseSesNotification(inner) {
  if (!inner || typeof inner !== 'object') return [];
  const kind = String(inner.notificationType || inner.eventType || '').toLowerCase();
  const event = kind === 'bounce'
    ? 'bounce'
    : kind === 'complaint'
      ? 'complaint'
      : kind === 'delivery'
        ? 'delivered'
        : null;
  if (!event) return [];
  const mail = inner.mail || {};
  const recipient = event === 'bounce'
    ? (inner.bounce?.bouncedRecipients?.[0]?.emailAddress || firstRecipient(mail.destination))
    : event === 'complaint'
      ? (inner.complaint?.complainedRecipients?.[0]?.emailAddress || firstRecipient(mail.destination))
      : (firstRecipient(inner.delivery?.recipients) || firstRecipient(mail.destination));
  const detail = event === 'bounce'
    ? [inner.bounce?.bounceType, inner.bounce?.bounceSubType].filter(Boolean).join('/') || null
    : event === 'delivered'
      ? (inner.delivery?.smtpResponse || null)
      : null;
  return [{
    event,
    provider: 'ses',
    messageId: mail.messageId || null,
    correlationId: tagValue(mail.tags, 'correlation') || headerValue(mail.headers, CORRELATION_HEADER),
    recipient: recipient || null,
    detail,
    occurredAt: inner.delivery?.timestamp || inner.bounce?.timestamp || inner.complaint?.timestamp || null,
  }];
}

// ── Communication record reconciliation ──────────────────────────────────────
//
// Terminal outcomes can arrive out of order and more than once (every provider
// here retries until it gets a 2xx). Ranking the states means a late "delivered"
// retry can never erase a bounce that has already been recorded, and a repeated
// webhook is a no-op instead of a rewrite.
const STATUS_RANK = {
  skipped: 0,
  queued: 0,
  submitted: 0,
  accepted: 0,
  sent: 0,
  delivered: 1,
  complained: 2,
  bounced: 3,
  failed: 3,
};

const EVENT_TO_STATUS = {
  delivered: 'delivered',
  bounce: 'bounced',
  complaint: 'complained',
};

function getPoolSafe() {
  try { return require('../db/prod-db.cjs').getPool(); } catch { return null; }
}

/**
 * Provider callbacks are the ONLY source of a delivery outcome, and they arrive
 * exactly once unless we refuse them. Two things routinely go wrong at that
 * moment, and both silently destroy the outcome if the event is not stored:
 *
 *   - the callback wins the race against our own send handler, so no row
 *     carries the provider message id yet and the update matches nothing;
 *   - the database is briefly unavailable, so the update throws.
 *
 * So every event is persisted first and applied second. An unapplied event stays
 * on the ledger and is retried, instead of being acknowledged into oblivion.
 */
async function recordDeliveryEvent(event, deps = {}) {
  const pool = deps.pool || getPoolSafe();
  if (!pool) return { stored: false, isNew: false, reason: 'no_database' };

  // Deterministic id = provider retries collapse onto one ledger row, which is
  // what lets the reputation breaker see each real event exactly once.
  const id = crypto.createHash('sha256')
    .update(`${event.provider || ''}|${event.messageId || ''}|${event.event}|${event.occurredAt || ''}`)
    .digest('hex');

  const result = await pool.query(
    `INSERT INTO email_delivery_events (id, provider, message_id, correlation_id, event, detail, occurred_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [id, event.provider || null, event.messageId || null, event.correlationId || null,
     event.event, event.detail || null, event.occurredAt || null],
  );
  return { stored: true, isNew: result.rowCount > 0, id };
}

async function markDeliveryEventApplied(id, matched, deps = {}) {
  const pool = deps.pool || getPoolSafe();
  if (!pool || !id) return;
  try {
    await pool.query(
      `UPDATE email_delivery_events
          SET applied_at = NOW(), matched = $2, attempts = attempts + 1
        WHERE id = $1`,
      [id, matched],
    );
  } catch (error) {
    console.warn('[EmailWebhook] Could not mark delivery event applied:', error.message);
  }
}

/**
 * attempts counts FAILED applications only. "No row carries this message id
 * yet" is the normal early-callback state, not a failure — counting it would
 * let unrelated webhook traffic burn through the retry budget of an event that
 * was never given a chance, and then permanently exclude it.
 */
async function noteDeliveryEventAttempt(id, deps = {}) {
  const pool = deps.pool || getPoolSafe();
  if (!pool || !id) return;
  try {
    await pool.query('UPDATE email_delivery_events SET attempts = attempts + 1 WHERE id = $1', [id]);
  } catch { /* the ledger row is what matters; the counter is advisory */ }
}

/**
 * Records that a row was examined, without judging the outcome. This is what
 * keeps a bounded sweep moving: waiting rows are otherwise indistinguishable
 * from one sweep to the next, so the same page would be re-read forever.
 */
async function touchDeliveryEvent(id, deps = {}) {
  const pool = deps.pool || getPoolSafe();
  if (!pool || !id) return;
  try {
    await pool.query('UPDATE email_delivery_events SET last_attempted_at = NOW() WHERE id = $1', [id]);
  } catch { /* advisory: a missed touch only costs fairness on one sweep */ }
}

/**
 * Re-apply events that have not landed on a communications record yet. Called
 * after each webhook batch (recovers from a transient database failure) and
 * after a send stores its provider message id (resolves the early-callback
 * race deterministically instead of waiting for the next webhook).
 */
async function applyPendingDeliveryEvents(deps = {}) {
  const pool = deps.pool || getPoolSafe();
  if (!pool) return { applied: 0, reason: 'no_database' };
  const messageId = deps.messageId ? String(deps.messageId) : null;

  try {
    // A targeted replay is triggered BY the arrival of the matching send
    // record, so it must never be filtered by the failure budget or by age —
    // that is the one moment the event is finally applicable.
    const { rows } = await pool.query(
      messageId
        ? `SELECT id, provider, message_id, correlation_id, event, detail, occurred_at
             FROM email_delivery_events
            WHERE applied_at IS NULL AND message_id = $1
            ORDER BY created_at ASC
            LIMIT 25`
        // Rows that are merely waiting never change, so ordering a bounded
        // sweep by age alone means the oldest 100 waiters are the ONLY rows
        // ever examined and everything behind them starves. Order by when each
        // row was last looked at instead: never-tried rows go first, and every
        // sweep advances the queue by a full page.
        : `SELECT id, provider, message_id, correlation_id, event, detail, occurred_at
             FROM email_delivery_events
            WHERE applied_at IS NULL
              AND attempts < 25
              AND created_at > NOW() - INTERVAL '30 days'
            ORDER BY last_attempted_at ASC NULLS FIRST, created_at ASC
            LIMIT 100`,
      messageId ? [messageId] : [],
    );

    let applied = 0;
    let retired = 0;
    for (const row of rows) {
      const outcome = await applyDeliveryStatusToCommunication({
        provider: row.provider,
        messageId: row.message_id,
        correlationId: row.correlation_id,
        event: row.event,
        detail: row.detail,
        occurredAt: row.occurred_at,
      }, { pool });
      if (outcome.matched > 0) {
        applied += outcome.matched;
        await markDeliveryEventApplied(row.id, outcome.matched, { pool });
      } else if (outcome.reason === 'superseded') {
        // The record already holds an outcome at least as bad as this one, so
        // there is nothing left to do with the event. Retire it rather than
        // letting it circulate forever.
        retired++;
        await markDeliveryEventApplied(row.id, 0, { pool });
      } else if (outcome.reason === 'update_failed') {
        // Only a real failure spends retry budget. An event still waiting for
        // its send record is left untouched so it keeps its full budget for
        // when the record finally exists.
        await noteDeliveryEventAttempt(row.id, { pool });
        await touchDeliveryEvent(row.id, { pool });
      } else {
        await touchDeliveryEvent(row.id, { pool });
      }
    }
    return { applied, retired, pending: rows.length - applied - retired };
  } catch (error) {
    console.warn('[EmailWebhook] Could not drain pending delivery events:', error.message);
    return { applied: 0, reason: 'drain_failed' };
  }
}

// A record is "settled" once a real outcome has been recorded, in either the
// canonical JSON field or the legacy status column.
const TERMINAL_RECORDED_SQL = `(
  COALESCE(CASE lower(COALESCE(data->>'delivery_status', ''))
             WHEN 'delivered'  THEN 1
             WHEN 'complained' THEN 2
             WHEN 'bounced'    THEN 3
             WHEN 'failed'     THEN 3
             ELSE 0
           END, 0) > 0
  OR COALESCE(CASE lower(COALESCE(status, ''))
                WHEN 'delivered'  THEN 1
                WHEN 'complained' THEN 2
                WHEN 'bounced'    THEN 3
                WHEN 'failed'     THEN 3
                ELSE 0
              END, 0) > 0
)`;

/**
 * The one way to write "the provider accepted this" onto a communication.
 *
 * Acceptance is the WEAKEST thing we can know, and it is written last — after
 * a network round trip during which the provider may already have called back
 * with the real outcome (it can match on the correlation id written before the
 * send). A finalizer that blindly writes 'submitted' therefore overwrites a
 * bounce that is already recorded, and the event that carried it has already
 * been retired from the ledger, so nothing will ever restore it.
 *
 * So identifiers and audit fields are always merged, but the acceptance state
 * is applied only while nothing better is recorded — decided inside the same
 * statement, leaving no window between the check and the write.
 */
async function finalizeSendRecord(finalization, deps = {}) {
  const pool = deps.pool || getPoolSafe();
  const { communicationId, status, always = {}, optimistic = {} } = finalization || {};
  if (!pool) throw new Error('No database available to finalize the send record');
  if (!communicationId) throw new Error('finalizeSendRecord requires a communication id');

  return pool.query(
    `UPDATE communications
        SET status = CASE WHEN ${TERMINAL_RECORDED_SQL} THEN status ELSE $2 END,
            data = COALESCE(data, '{}'::jsonb)
                   || $3::jsonb
                   || CASE WHEN ${TERMINAL_RECORDED_SQL} THEN '{}'::jsonb ELSE $4::jsonb END,
            updated_at = NOW()
      WHERE id = $1`,
    [communicationId, status, JSON.stringify(always), JSON.stringify(optimistic)],
  );
}

/**
 * Writes the provider's message id onto the communication that produced it,
 * and returns whether that association is durable.
 *
 * The mail has already been accepted at this point, so failing here must never
 * look like a failed send — but it also cannot be shrugged off. The message id
 * is the only key a delivery callback can match on, so a record that lost it is
 * unreconcilable forever: its bounce can sit safely on the ledger and still
 * never reach it. When the update fails, the association is queued for repair
 * instead, which is the one thing that makes the record recoverable without
 * re-sending anything.
 */
async function associateProviderMessage(association, deps = {}) {
  const pool = deps.pool || getPoolSafe();
  const { communicationId, provider, messageId, deliveryStatus = 'submitted' } = association || {};
  if (!pool) return { ok: false, reason: 'no_database' };
  if (!communicationId || !messageId) return { ok: false, reason: 'incomplete' };

  // Only the identifiers are unconditional. This runs again on every repair
  // attempt, and a repair can happen AFTER the outcome already arrived, so
  // writing 'submitted' unconditionally would walk a recorded bounce backwards
  // — the timeline reads this field first. The optimistic status is therefore
  // applied only while nothing better is recorded, in the same statement, so
  // there is no window between reading and writing.
  const identity = { provider: provider || null, provider_message_id: messageId };
  const optimistic = {
    delivery_status: deliveryStatus,
    delivery_status_at: new Date().toISOString(),
  };
  try {
    await finalizeSendRecord({
      communicationId,
      // Repair must never revive an old send state either; a settled record
      // keeps whatever the callback recorded.
      status: deliveryStatus === 'submitted' ? 'sent' : deliveryStatus,
      always: identity,
      optimistic,
    }, { pool });
    // The callback can already be waiting on the ledger for this id.
    await applyPendingDeliveryEvents({ pool, messageId });
    return { ok: true };
  } catch (error) {
    console.warn('[EmailWebhook] Could not associate provider message id:', error.message);
    try {
      await pool.query(
        `INSERT INTO email_pending_associations
           (communication_id, provider, message_id, delivery_status, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (communication_id) DO UPDATE
           SET provider = EXCLUDED.provider,
               message_id = EXCLUDED.message_id,
               delivery_status = EXCLUDED.delivery_status`,
        [communicationId, provider || null, messageId, deliveryStatus],
      );
      return { ok: false, queued: true, reason: 'update_failed' };
    } catch (queueError) {
      console.error('[EmailWebhook] Provider message id is UNRECOVERABLE for', communicationId, '-', queueError.message);
      return { ok: false, queued: false, reason: 'queue_failed' };
    }
  }
}

/** Retry associations whose original write failed after the mail was accepted. */
async function applyPendingAssociations(deps = {}) {
  const pool = deps.pool || getPoolSafe();
  if (!pool) return { repaired: 0 };
  let repaired = 0;
  try {
    const { rows } = await pool.query(
      `SELECT communication_id, provider, message_id, delivery_status
         FROM email_pending_associations
        WHERE created_at > NOW() - INTERVAL '30 days'
        ORDER BY attempts ASC, created_at ASC
        LIMIT 100`,
    );
    for (const row of rows) {
      const result = await associateProviderMessage({
        communicationId: row.communication_id,
        provider: row.provider,
        messageId: row.message_id,
        deliveryStatus: row.delivery_status || 'submitted',
      }, { pool });
      if (result.ok) {
        repaired++;
        await pool.query('DELETE FROM email_pending_associations WHERE communication_id = $1', [row.communication_id]);
      } else {
        await pool.query(
          'UPDATE email_pending_associations SET attempts = attempts + 1 WHERE communication_id = $1',
          [row.communication_id],
        ).catch(() => {});
      }
    }
  } catch (error) {
    console.warn('[EmailWebhook] Could not drain pending associations:', error.message);
  }
  return { repaired };
}

/**
 * Scheduled recovery. Webhook traffic is bursty and can stop entirely, so
 * draining only on the next callback leaves an acknowledged-but-unapplied
 * outcome stranded indefinitely. This runs on a timer instead, and takes the
 * opportunity to retire ledger rows that have done their job.
 */
async function reconcileEmailDeliveryEvents(deps = {}) {
  const pool = deps.pool || getPoolSafe();
  if (!pool) return { success: false, reason: 'no_database' };
  // Associations first: an event cannot match a record that never recorded its
  // provider message id, so repairing those unblocks the drain that follows.
  const associations = await applyPendingAssociations({ pool });
  const drained = await applyPendingDeliveryEvents({ pool });
  let purged = 0;
  try {
    const result = await pool.query(
      `DELETE FROM email_delivery_events
        WHERE (applied_at IS NOT NULL AND applied_at < NOW() - INTERVAL '90 days')
           OR (applied_at IS NULL AND created_at < NOW() - INTERVAL '180 days')`,
    );
    purged = result.rowCount || 0;
  } catch (error) {
    console.warn('[EmailWebhook] Could not purge old delivery events:', error.message);
  }
  return {
    success: true,
    repaired: associations.repaired || 0,
    applied: drained.applied || 0,
    retired: drained.retired || 0,
    pending: drained.pending || 0,
    purged,
  };
}

/**
 * Stamp the terminal provider outcome onto the communications row that carries
 * this provider message id. Matching on the id (not the recipient) is what keeps
 * one person's bounce from relabelling every message ever sent to them.
 */
async function applyDeliveryStatusToCommunication(event, deps = {}) {
  const status = EVENT_TO_STATUS[event?.event];
  const messageId = event?.messageId ? String(event.messageId) : null;
  // Our own correlation id is written BEFORE the send, so it is the identifier
  // that survives when the post-send write of the provider's message id failed.
  const correlationId = event?.correlationId ? String(event.correlationId) : null;
  if (!status) return { matched: 0, reason: 'unmapped_event' };
  if (!messageId && !correlationId) return { matched: 0, reason: 'no_message_id' };

  const pool = deps.pool || getPoolSafe();
  if (!pool) return { matched: 0, reason: 'no_database' };

  const rank = STATUS_RANK[status] ?? 0;
  const patch = {
    delivery_status: status,
    delivery_status_at: event.occurredAt || new Date().toISOString(),
    delivery_detail: event.detail || null,
    delivery_reported_by: event.provider || null,
  };

  try {
    const result = await pool.query(
      `UPDATE communications
          SET status = $2,
              data = COALESCE(data, '{}'::jsonb) || $3::jsonb,
              updated_at = NOW()
        WHERE ($1::text IS NOT NULL AND data->>'provider_message_id' = $1
               OR $5::text IS NOT NULL AND data->>'delivery_correlation_id' = $5)
          -- SMS rows carry their own provider ids; never let a mail event land
          -- on one because two providers happened to mint the same string.
          AND COALESCE(communication_type, type) = 'email'
          AND COALESCE(
                CASE lower(COALESCE(status, ''))
                  WHEN 'delivered'  THEN 1
                  WHEN 'complained' THEN 2
                  WHEN 'bounced'    THEN 3
                  WHEN 'failed'     THEN 3
                  ELSE 0
                END, 0) <= $4`,
      [messageId, status, JSON.stringify(patch), rank, correlationId],
    );
    if (result.rowCount > 0) return { matched: result.rowCount, status };

    // Nothing changed, for one of two very different reasons. Either the send
    // record does not exist yet (keep waiting), or it exists and already holds
    // an outcome this event cannot improve on — a late 'delivered' behind a
    // bounce. The second is resolved, not pending: leaving it on the ledger
    // makes it a permanent passenger that crowds out real work.
    const existing = await pool.query(
      `SELECT 1 FROM communications
        WHERE ($1::text IS NOT NULL AND data->>'provider_message_id' = $1
               OR $2::text IS NOT NULL AND data->>'delivery_correlation_id' = $2)
          AND COALESCE(communication_type, type) = 'email'
        LIMIT 1`,
      [messageId, correlationId],
    );
    return existing.rowCount > 0
      ? { matched: 0, status, reason: 'superseded' }
      : { matched: 0, status, reason: 'no_record_yet' };
  } catch (error) {
    // The circuit breaker still has to see this event, so a storage problem must
    // not turn into a 5xx that makes the provider retry the whole delivery.
    console.warn('[EmailWebhook] Could not update communication delivery status:', error.message);
    return { matched: 0, reason: 'update_failed' };
  }
}

function sendJson(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

/**
 * Returns true when the request was this webhook (handled or rejected), false
 * when the caller should continue to its other routes.
 */
async function handleEmailDeliveryWebhook(req, res, deps = {}) {
  const url = req.url || '';
  if (!url.split('?')[0].endsWith(ROUTE)) return false;
  if (req.method !== 'POST') {
    sendJson(res, { error: 'Method not allowed' }, 405);
    return true;
  }

  const expected = String(process.env.EMAIL_PROVIDER_WEBHOOK_SECRET || '').trim();
  if (!expected) {
    // Fail closed. An unauthenticated bounce endpoint is itself an abuse vector:
    // anyone could forge complaints and pause all outbound mail.
    console.error('[EmailWebhook] EMAIL_PROVIDER_WEBHOOK_SECRET is not set — delivery webhook refused');
    sendJson(res, { error: 'Delivery webhook is not configured' }, 503);
    return true;
  }

  let token = req.headers?.['x-email-webhook-secret'];
  if (!token) {
    // Some provider consoles only allow configuring a URL, not custom headers.
    try { token = new URL(url, 'http://localhost').searchParams.get('token'); } catch { token = null; }
  }
  if (!timingSafeEqualStr(token, expected)) {
    sendJson(res, { error: 'Unauthorized webhook' }, 401);
    return true;
  }

  let payload = null;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    sendJson(res, { error: 'Invalid webhook payload' }, err.statusCode === 413 ? 413 : 400);
    return true;
  }

  // SNS will not deliver anything until the subscription is confirmed.
  if (payload?.Type === 'SubscriptionConfirmation' && payload.SubscribeURL) {
    console.warn(`[EmailWebhook] SNS subscription confirmation received; confirm at: ${payload.SubscribeURL}`);
    sendJson(res, { received: true, pendingConfirmation: true });
    return true;
  }

  const health = deps.emailHealth || require('./emailProviderHealth.cjs');
  const events = parseProviderEvents(payload);
  if (events.length === 0) {
    // Opened/clicked/delivery-delayed events are legitimate traffic we ignore.
    sendJson(res, { received: true, applied: 0, reconciled: 0 });
    return true;
  }

  // Persist BEFORE acknowledging. An event we cannot store must be refused so
  // the provider redelivers it — acknowledging an outcome we then drop is how a
  // bounce disappears permanently, and there is no second source for it.
  const ledger = [];
  for (const event of events) {
    try {
      ledger.push({ event, ...(await recordDeliveryEvent(event, deps)) });
    } catch (error) {
      console.error('[EmailWebhook] Could not persist delivery event, asking the provider to retry:', error.message);
      sendJson(res, { error: 'Delivery event could not be stored; please retry' }, 503);
      return true;
    }
  }

  // Only bounces and complaints are reputation signals. A delivery confirmation
  // must never reach the breaker — it is timeline information, not a safety one.
  // Redelivered events are skipped so a provider retry cannot double-count a
  // single complaint into a pause.
  const results = ledger
    .filter(({ event, isNew, stored }) => (event.event === 'bounce' || event.event === 'complaint') && (isNew || !stored))
    .map(({ event }) => health.reportDeliveryEvent(event));
  const paused = results.some((result) => result && result.paused);

  let reconciled = 0;
  for (const entry of ledger) {
    const outcome = await applyDeliveryStatusToCommunication(entry.event, deps);
    reconciled += outcome.matched;
    if (entry.stored) {
      if (outcome.matched > 0) await markDeliveryEventApplied(entry.id, outcome.matched, deps);
      else await noteDeliveryEventAttempt(entry.id, deps);
    }
  }

  // Anything still unapplied — an earlier database blip, or a callback that beat
  // its own send handler — gets another chance now rather than being forgotten.
  const drained = await applyPendingDeliveryEvents(deps);
  reconciled += drained.applied || 0;

  const summary = `${events.length} delivery signal(s): ${events.map((e) => e.event).join(', ')}`;
  const log = events.some((e) => e.event !== 'delivered') ? console.warn : console.log;
  log(`[EmailWebhook] Applied ${summary}; ${reconciled} communication record(s) updated${paused ? ' — delivery is now paused' : ''}`);
  sendJson(res, { received: true, applied: events.length, reconciled, paused });
  return true;
}

module.exports = {
  handleEmailDeliveryWebhook,
  parseProviderEvents,
  applyDeliveryStatusToCommunication,
  applyPendingDeliveryEvents,
  applyPendingAssociations,
  associateProviderMessage,
  finalizeSendRecord,
  reconcileEmailDeliveryEvents,
  recordDeliveryEvent,
  ROUTE,
};
