#!/usr/bin/env node
/**
 * Email delivery-status regression test
 * -------------------------------------
 * Covers the gap between "the provider accepted the request" and "the message
 * reached the inbox":
 *
 * - provider webhooks are parsed into delivered / bounce / complaint events
 * - those events land on the communications row that carries the provider
 *   message id, and cannot downgrade an already-recorded bounce
 * - a delivery confirmation never reaches the reputation circuit breaker
 * - the live sender configuration is checked against the SAME provider account
 *   that a delivery lookup would read
 * - the quick-email path records a 'submitted' delivery state and returns the
 *   communication id so the sender can be linked to the real outcome
 *
 * No network calls and no database: providers and the pool are stubbed.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Keep provider auto-detection deterministic — an ambient SMTP relay or an
// EMAIL_PROVIDER override would send the sender-verification assertions to a
// different branch than the one under test.
delete process.env.EMAIL_PROVIDER;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_API_KEY;
delete process.env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_SECRET_KEY;
delete process.env.RESEND_API_KEY;
process.env.POSTMARK_SERVER_TOKEN = 'pm_test_delivery_status';
process.env.POSTMARK_VERIFIED_DOMAINS = 'companysync.io';
process.env.EMAIL_PROVIDER_WEBHOOK_SECRET = 'test-webhook-secret';

const webhook = require('../lib/emailDeliveryWebhook.cjs');
const transport = require('../lib/emailTransport.cjs');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── Fake communications table ────────────────────────────────────────────────
// Only the one UPDATE statement the webhook issues has to be understood, so the
// stub reimplements its WHERE clause (message id match + status ranking) rather
// than pretending to be Postgres.
const STATUS_RANK = { delivered: 1, complained: 2, bounced: 3, failed: 3 };

// A record is matchable by the provider's message id OR by our own pre-send
// correlation id — the latter is what still works when the post-send write of
// the provider id never landed.
function matchesIdentifiers(row, messageId, correlationId) {
  if (messageId && row.data?.provider_message_id === messageId) return true;
  if (correlationId && row.data?.delivery_correlation_id === correlationId) return true;
  return false;
}

function makePool(rows, options = {}) {
  const calls = [];
  const ledger = [];
  const associations = [];
  let clock = 0;
  let seq = 0;
  return {
    rows,
    ledger,
    associations,
    options,
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (/INSERT INTO email_delivery_events/i.test(sql)) {
        if (options.failLedgerInsert) throw new Error('ledger unavailable');
        const [id, provider, messageId, correlationId, event, detail, occurredAt] = params;
        if (ledger.some((entry) => entry.id === id)) return { rowCount: 0, rows: [] };
        ledger.push({ id, provider, message_id: messageId, correlation_id: correlationId, event, detail, occurred_at: occurredAt, applied_at: null, attempts: 0, last_attempted_at: null, seq: seq++, created_at: new Date() });
        return { rowCount: 1, rows: [{ id }] };
      }

      if (/UPDATE email_delivery_events/i.test(sql)) {
        const entry = ledger.find((row) => row.id === params[0]);
        if (!entry) return { rowCount: 0, rows: [] };
        if (/applied_at = NOW\(\)/i.test(sql)) {
          entry.applied_at = new Date();
          entry.matched = params[1];
        } else if (/last_attempted_at = NOW\(\)/i.test(sql)) {
          entry.last_attempted_at = ++clock;
        } else {
          entry.attempts += 1;
        }
        return { rowCount: 1, rows: [] };
      }

      if (/DELETE FROM email_delivery_events/i.test(sql)) {
        return { rowCount: 0, rows: [] };
      }

      if (/FROM email_delivery_events/i.test(sql)) {
        // The targeted replay deliberately carries no attempts/age filter, so
        // the stub must not silently apply one either.
        const targeted = /message_id = \$1/.test(sql);
        let matching = ledger.filter((entry) => !entry.applied_at
          && (targeted ? entry.message_id === params[0] : entry.attempts < 25));
        // LIMIT and ORDER BY are the whole point of the sweep's fairness, so the
        // stub has to honour them: ignoring LIMIT would hide head-of-line
        // starvation entirely.
        if (/ORDER BY last_attempted_at ASC NULLS FIRST/i.test(sql)) {
          matching = matching.slice().sort((a, b) => {
            const left = a.last_attempted_at ?? -1;
            const right = b.last_attempted_at ?? -1;
            return left - right || a.seq - b.seq;
          });
        }
        const limit = Number((sql.match(/LIMIT\s+(\d+)/i) || [])[1] || matching.length);
        return { rows: matching.slice(0, limit) };
      }

      if (/INSERT INTO email_pending_associations/i.test(sql)) {
        if (options.failAssociationQueue) throw new Error('db down');
        const [communicationId, provider, messageId, deliveryStatus] = params;
        const existing = associations.find((row) => row.communication_id === communicationId);
        if (existing) Object.assign(existing, { provider, message_id: messageId, delivery_status: deliveryStatus });
        else associations.push({ communication_id: communicationId, provider, message_id: messageId, delivery_status: deliveryStatus, attempts: 0 });
        return { rowCount: 1, rows: [] };
      }

      if (/DELETE FROM email_pending_associations/i.test(sql)) {
        if (options.failAssociationDelete) throw new Error('db down');
        const index = associations.findIndex((row) => row.communication_id === params[0]);
        if (index >= 0) associations.splice(index, 1);
        return { rowCount: index >= 0 ? 1 : 0, rows: [] };
      }

      if (/UPDATE email_pending_associations/i.test(sql)) {
        const entry = associations.find((row) => row.communication_id === params[0]);
        if (entry) entry.attempts += 1;
        return { rowCount: entry ? 1 : 0, rows: [] };
      }

      // Kept AFTER the write branches: they all contain this same phrase, and
      // matching it first would quietly turn a DELETE into a SELECT.
      if (/FROM email_pending_associations/i.test(sql)) {
        return { rows: associations.slice().sort((a, b) => a.attempts - b.attempts).slice(0, 100) };
      }

      // Existence probe: does a record carry this id at all? This is what tells
      // "still waiting for its send record" apart from "already superseded".
      if (/SELECT 1 FROM communications/i.test(sql)) {
        return {
          rowCount: rows.filter((row) => matchesIdentifiers(row, params[0], params[1])
            && (row.communication_type || row.type) === 'email').length,
          rows: [],
        };
      }

      // The association write: merge provider fields onto one record by id.
      // finalizeSendRecord: [id, status, always, optimistic]
      if (/UPDATE communications/i.test(sql) && /WHERE id = \$1/i.test(sql)) {
        if (options.failAssociation) throw new Error('db down');
        const row = rows.find((entry) => entry.id === params[0]);
        if (!row) return { rowCount: 0, rows: [] };
        // Mirrors the CASE in the real statement: an outcome already recorded
        // in EITHER the JSON field or the status column settles the record, so
        // only the identity fields are merged over it.
        const settled = Math.max(
          STATUS_RANK[String(row.data?.delivery_status || '').toLowerCase()] || 0,
          STATUS_RANK[String(row.status || '').toLowerCase()] || 0,
        ) > 0;
        row.data = { ...row.data, ...JSON.parse(params[2] || '{}') };
        if (!settled) {
          row.status = params[1];
          row.data = { ...row.data, ...JSON.parse(params[3] || '{}') };
        }
        return { rowCount: 1, rows: [] };
      }

      if (!/UPDATE communications/i.test(sql)) throw new Error(`Unexpected SQL: ${sql}`);
      if (options.failCommunicationUpdate) throw new Error('db down');
      const [messageId, status, patchJson, rank, correlationId] = params;
      const patch = JSON.parse(patchJson);
      let rowCount = 0;
      const emailOnly = /communication_type, type\) = 'email'/.test(sql);
      for (const row of rows) {
        if (!matchesIdentifiers(row, messageId, correlationId)) continue;
        if (emailOnly && (row.communication_type || row.type) !== 'email') continue;
        const currentRank = STATUS_RANK[String(row.status || '').toLowerCase()] || 0;
        if (currentRank > rank) continue;
        row.status = status;
        row.data = { ...row.data, ...patch };
        rowCount++;
      }
      return { rowCount, rows: [] };
    },
  };
}

async function main() {
// ── 1. Webhook parsing ───────────────────────────────────────────────────────
console.log('\n1. Provider payloads parse into delivery outcomes');
{
  const postmarkDelivery = webhook.parseProviderEvents({
    RecordType: 'Delivery', MessageID: 'pm-1', Recipient: 'a@real-domain.com', DeliveredAt: '2026-09-09T10:00:00Z',
  });
  check('Postmark Delivery → delivered', postmarkDelivery[0]?.event === 'delivered', JSON.stringify(postmarkDelivery));
  check('Postmark Delivery keeps the message id', postmarkDelivery[0]?.messageId === 'pm-1');

  const postmarkBounce = webhook.parseProviderEvents({ RecordType: 'Bounce', MessageID: 'pm-2', Email: 'b@real-domain.com' });
  check('Postmark Bounce → bounce', postmarkBounce[0]?.event === 'bounce');

  const postmarkComplaint = webhook.parseProviderEvents({ RecordType: 'SpamComplaint', MessageID: 'pm-3', Email: 'c@real-domain.com' });
  check('Postmark SpamComplaint → complaint', postmarkComplaint[0]?.event === 'complaint');

  check('Postmark Open is still ignored', webhook.parseProviderEvents({ RecordType: 'Open', MessageID: 'pm-4' }).length === 0);

  const resendDelivered = webhook.parseProviderEvents({ type: 'email.delivered', data: { email_id: 're-1', to: ['d@real-domain.com'] } });
  check('Resend email.delivered → delivered', resendDelivered[0]?.event === 'delivered' && resendDelivered[0]?.messageId === 're-1');

  const sesDelivery = webhook.parseProviderEvents({
    Type: 'Notification',
    Message: JSON.stringify({
      notificationType: 'Delivery',
      mail: { messageId: 'ses-1', destination: ['e@real-domain.com'] },
      delivery: { recipients: ['e@real-domain.com'], smtpResponse: '250 OK' },
    }),
  });
  check('SES Delivery notification → delivered', sesDelivery[0]?.event === 'delivered' && sesDelivery[0]?.messageId === 'ses-1');
  check('SES Delivery carries the SMTP response as detail', sesDelivery[0]?.detail === '250 OK');

  const sesBounce = webhook.parseProviderEvents({
    notificationType: 'Bounce',
    mail: { messageId: 'ses-2', destination: ['f@real-domain.com'] },
    bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'f@real-domain.com' }] },
  });
  check('SES Bounce still parses', sesBounce[0]?.event === 'bounce' && sesBounce[0]?.detail === 'Permanent/General');
}

// ── 2. Reconciliation onto the communications row ────────────────────────────
console.log('\n2. Outcomes update the matching communications record');
{
  const pool = makePool([
    { id: 'comm-a', communication_type: 'email', status: 'accepted', data: { provider_message_id: 'pm-1', delivery_status: 'submitted' } },
    { id: 'comm-b', communication_type: 'email', status: 'accepted', data: { provider_message_id: 'pm-2', delivery_status: 'submitted' } },
    { id: 'comm-sms', communication_type: 'sms', status: 'sent', data: { provider_message_id: 'pm-1' } },
  ]);

  const delivered = await webhook.applyDeliveryStatusToCommunication(
    { event: 'delivered', provider: 'postmark', messageId: 'pm-1', occurredAt: '2026-09-09T10:00:00Z' },
    { pool },
  );
  check('delivered matches exactly one row', delivered.matched === 1, JSON.stringify(delivered));
  check('delivered row status becomes delivered', pool.rows[0].status === 'delivered');
  check('delivered row delivery_status becomes delivered', pool.rows[0].data.delivery_status === 'delivered');
  check('unrelated row untouched', pool.rows[1].status === 'accepted');
  check('an SMS row sharing the id is not reclassified', pool.rows[2].status === 'sent');

  const bounced = await webhook.applyDeliveryStatusToCommunication(
    { event: 'bounce', provider: 'postmark', messageId: 'pm-2', detail: 'HardBounce' },
    { pool },
  );
  check('bounce matches its own row', bounced.matched === 1);
  check('bounced row status becomes bounced', pool.rows[1].status === 'bounced');
  check('bounce detail is retained', pool.rows[1].data.delivery_detail === 'HardBounce');

  // Providers retry until they get a 2xx and can deliver out of order.
  const lateDelivered = await webhook.applyDeliveryStatusToCommunication(
    { event: 'delivered', provider: 'postmark', messageId: 'pm-2' },
    { pool },
  );
  check('a late delivered event cannot erase a bounce', lateDelivered.matched === 0 && pool.rows[1].status === 'bounced');

  const complaint = await webhook.applyDeliveryStatusToCommunication(
    { event: 'complaint', provider: 'postmark', messageId: 'pm-1' },
    { pool },
  );
  check('a complaint after delivery is recorded', complaint.matched === 1 && pool.rows[0].status === 'complained');

  const noId = await webhook.applyDeliveryStatusToCommunication({ event: 'delivered', provider: 'postmark' }, { pool });
  check('an event without a message id updates nothing', noId.matched === 0 && noId.reason === 'no_message_id');

  const unknownId = await webhook.applyDeliveryStatusToCommunication(
    { event: 'delivered', provider: 'postmark', messageId: 'not-ours' },
    { pool },
  );
  check('an unknown message id matches no rows', unknownId.matched === 0);

  const brokenPool = { async query() { throw new Error('db down'); } };
  const survived = await webhook.applyDeliveryStatusToCommunication(
    { event: 'bounce', provider: 'postmark', messageId: 'pm-2' },
    { pool: brokenPool },
  );
  check('a storage failure is swallowed, not thrown', survived.matched === 0 && survived.reason === 'update_failed');
}

// ── 3. The HTTP handler wires both jobs together ─────────────────────────────
console.log('\n3. Webhook handler applies outcomes without misfiring the breaker');
{
  function makeRes() {
    const res = { statusCode: null, body: null, headers: null };
    res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; };
    res.end = (payload) => { res.body = JSON.parse(payload); };
    return res;
  }
  function makeReq(payload) {
    return {
      url: `/api/email/delivery-webhook?token=${process.env.EMAIL_PROVIDER_WEBHOOK_SECRET}`,
      method: 'POST',
      headers: {},
      body: JSON.stringify(payload),
    };
  }

  const reported = [];
  const fakeHealth = {
    reportDeliveryEvent(event) { reported.push(event); return { accepted: true, paused: false }; },
  };

  const pool = makePool([
    { id: 'comm-c', communication_type: 'email', status: 'accepted', data: { provider_message_id: 'pm-9', delivery_status: 'submitted' } },
  ]);

  const deliveredRes = makeRes();
  await webhook.handleEmailDeliveryWebhook(
    makeReq({ RecordType: 'Delivery', MessageID: 'pm-9', Recipient: 'g@real-domain.com' }),
    deliveredRes,
    { emailHealth: fakeHealth, pool },
  );
  check('delivery webhook returns 200', deliveredRes.statusCode === 200, JSON.stringify(deliveredRes.body));
  check('delivery webhook reports it reconciled a record', deliveredRes.body?.reconciled === 1, JSON.stringify(deliveredRes.body));
  check('a delivery confirmation never reaches the circuit breaker', reported.length === 0, JSON.stringify(reported));
  check('the record is now delivered', pool.rows[0].status === 'delivered');

  const bounceRes = makeRes();
  await webhook.handleEmailDeliveryWebhook(
    makeReq({ RecordType: 'Bounce', MessageID: 'pm-9', Email: 'g@real-domain.com' }),
    bounceRes,
    { emailHealth: fakeHealth, pool },
  );
  check('a bounce still reaches the circuit breaker', reported.length === 1 && reported[0].event === 'bounce');
  check('the record is now bounced', pool.rows[0].status === 'bounced');

  const ignoredRes = makeRes();
  await webhook.handleEmailDeliveryWebhook(
    makeReq({ RecordType: 'Open', MessageID: 'pm-9' }),
    ignoredRes,
    { emailHealth: fakeHealth, pool },
  );
  check('an ignored record type reconciles nothing', ignoredRes.body?.applied === 0 && ignoredRes.body?.reconciled === 0);

  // A provider that gets a 200 never sends the event again. If we cannot store
  // it, refusing is the only way the outcome survives.
  const unstorablePool = makePool([], { failLedgerInsert: true });
  const unstorableRes = makeRes();
  await webhook.handleEmailDeliveryWebhook(
    makeReq({ RecordType: 'Bounce', MessageID: 'pm-unstorable', Email: 'h@real-domain.com' }),
    unstorableRes,
    { emailHealth: fakeHealth, pool: unstorablePool },
  );
  check('an unstorable event is refused so the provider retries', unstorableRes.statusCode === 503, JSON.stringify(unstorableRes.body));

  // A transient database failure must not consume the event either.
  const flakyRows = [{ id: 'comm-d', communication_type: 'email', status: 'accepted', data: { provider_message_id: 'pm-flaky', delivery_status: 'submitted' } }];
  const flakyOptions = { failCommunicationUpdate: true };
  const flakyPool = makePool(flakyRows, flakyOptions);
  const flakyRes = makeRes();
  await webhook.handleEmailDeliveryWebhook(
    makeReq({ RecordType: 'Bounce', MessageID: 'pm-flaky', Email: 'i@real-domain.com' }),
    flakyRes,
    { emailHealth: fakeHealth, pool: flakyPool },
  );
  check('a database failure still records the event for retry', flakyPool.ledger.length === 1 && !flakyPool.ledger[0].applied_at);
  check('the record is untouched while the database is failing', flakyRows[0].status === 'accepted');

  flakyOptions.failCommunicationUpdate = false;
  const recovered = await webhook.applyPendingDeliveryEvents({ pool: flakyPool });
  check('the retained event is applied once the database recovers', recovered.applied === 1 && flakyRows[0].status === 'bounced', JSON.stringify(recovered));

  // The callback can beat our own send handler to the record.
  const racyRows = [];
  const racyPool = makePool(racyRows);
  const racyRes = makeRes();
  await webhook.handleEmailDeliveryWebhook(
    makeReq({ RecordType: 'Bounce', MessageID: 'pm-early', Email: 'j@real-domain.com' }),
    racyRes,
    { emailHealth: fakeHealth, pool: racyPool },
  );
  check('an early callback is acknowledged but retained', racyRes.statusCode === 200 && racyPool.ledger.length === 1 && !racyPool.ledger[0].applied_at);
  racyRows.push({ id: 'comm-e', communication_type: 'email', status: 'accepted', data: { provider_message_id: 'pm-early', delivery_status: 'submitted' } });
  const late = await webhook.applyPendingDeliveryEvents({ pool: racyPool, messageId: 'pm-early' });
  check('the early callback lands once the send records its id', late.applied === 1 && racyRows[0].status === 'bounced', JSON.stringify(late));

  // Providers redeliver until they see a 2xx; one complaint must count once.
  const retryPool = makePool([{ id: 'comm-f', communication_type: 'email', status: 'accepted', data: { provider_message_id: 'pm-retry' } }]);
  const complaintPayload = { RecordType: 'SpamComplaint', MessageID: 'pm-retry', Email: 'k@real-domain.com' };
  reported.length = 0;
  await webhook.handleEmailDeliveryWebhook(makeReq(complaintPayload), makeRes(), { emailHealth: fakeHealth, pool: retryPool });
  await webhook.handleEmailDeliveryWebhook(makeReq(complaintPayload), makeRes(), { emailHealth: fakeHealth, pool: retryPool });
  check('a redelivered complaint is counted against reputation only once', reported.length === 1, JSON.stringify(reported));

  const unauthorizedRes = makeRes();
  await webhook.handleEmailDeliveryWebhook(
    { url: '/api/email/delivery-webhook', method: 'POST', headers: {}, body: JSON.stringify({ RecordType: 'Delivery', MessageID: 'pm-9' }) },
    unauthorizedRes,
    { emailHealth: fakeHealth, pool },
  );
  check('an unsigned delivery webhook is still rejected', unauthorizedRes.statusCode === 401);
}

// ── 3b. Retained events survive until their send record exists ───────────────
console.log('\n3b. A retained event keeps its retry budget until it is applicable');
{
  // Heavy unrelated webhook traffic sweeps the ledger repeatedly while the
  // send record is still missing. Waiting is the normal early-callback state,
  // so it must not consume the failure budget — otherwise the event is retired
  // before it was ever applicable and the outcome is lost for good.
  const pool = makePool([]);
  await webhook.recordDeliveryEvent(
    { provider: 'postmark', messageId: 'orphan-1', event: 'bounce', detail: 'hard bounce' },
    { pool },
  );
  for (let i = 0; i < 40; i++) await webhook.applyPendingDeliveryEvents({ pool });
  check('waiting for a send record never counts as a failed attempt', pool.ledger[0].attempts === 0, `attempts=${pool.ledger[0].attempts}`);

  // Even so, force the budget to zero and confirm the targeted replay — which
  // only runs BECAUSE the record just appeared — can still recover it.
  pool.ledger[0].attempts = 99;
  pool.rows.push({ id: 'c-orphan', type: 'email', communication_type: 'email', status: 'sent', data: { provider_message_id: 'orphan-1' } });
  const recovered = await webhook.applyPendingDeliveryEvents({ pool, messageId: 'orphan-1' });
  check('a targeted replay recovers an exhausted event', recovered.applied === 1, JSON.stringify(recovered));
  check('the recovered outcome reaches the record', pool.rows[0].data.delivery_status === 'bounced', JSON.stringify(pool.rows[0]));
  check('the recovered event is retired', pool.ledger[0].applied_at !== null);
}

console.log('\n3bb. A bounded sweep reaches events behind a backlog of waiters');
{
  // 150 callbacks whose send records do not exist (and never will, in this
  // test) sit at the head of the queue. Ordering a LIMIT-ed sweep by age alone
  // would re-read the same first page forever and never reach the one event
  // that can actually be applied.
  const pool = makePool([{ id: 'c-buried', type: 'email', communication_type: 'email', status: 'sent', data: { provider_message_id: 'buried-1' } }]);
  for (let i = 0; i < 150; i++) {
    await webhook.recordDeliveryEvent(
      { provider: 'postmark', messageId: `waiter-${i}`, event: 'bounce', occurredAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z` },
      { pool },
    );
  }
  await webhook.recordDeliveryEvent({ provider: 'postmark', messageId: 'buried-1', event: 'delivered' }, { pool });

  let applied = 0;
  for (let sweep = 0; sweep < 3 && !applied; sweep++) {
    applied += (await webhook.applyPendingDeliveryEvents({ pool })).applied;
  }
  check('a buried event is reached despite a backlog of waiters', applied === 1, `applied=${applied}`);
  check('the buried outcome lands on its record', pool.rows[0].data.delivery_status === 'delivered', JSON.stringify(pool.rows[0].data));
  check('waiting events still spend no retry budget', pool.ledger.every((entry) => entry.attempts === 0));
}

console.log('\n3bc. Events that can no longer change anything are retired');
{
  // A late 'delivered' behind a recorded bounce can never be applied. Left
  // pending it would circulate through every sweep forever, crowding out work
  // that still matters.
  const pool = makePool([{ id: 'c-done', type: 'email', communication_type: 'email', status: 'bounced', data: { provider_message_id: 'done-1', delivery_status: 'bounced' } }]);
  await webhook.recordDeliveryEvent({ provider: 'postmark', messageId: 'done-1', event: 'delivered' }, { pool });
  const result = await webhook.applyPendingDeliveryEvents({ pool });
  check('a superseded event is retired, not retried', result.retired === 1, JSON.stringify(result));
  check('the superseded event leaves the pending queue', pool.ledger[0].applied_at !== null);
  check('the recorded bounce is untouched', pool.rows[0].status === 'bounced');
}

console.log('\n3bd. A failed post-send write leaves the record reconcilable');
{
  // The provider has already accepted the mail, so the send cannot be retried
  // — but if the message id never reaches the record, no callback can ever
  // find it again. The association itself has to be recoverable.
  const pool = makePool([{ id: 'c-assoc', type: 'email', communication_type: 'email', status: 'pending', data: {} }], { failAssociation: true });
  const queued = await webhook.associateProviderMessage(
    { communicationId: 'c-assoc', provider: 'postmark', messageId: 'assoc-1' },
    { pool },
  );
  check('a failed association is queued for repair', queued.ok === false && queued.queued === true, JSON.stringify(queued));
  check('the repair queue holds the provider message id', pool.associations[0]?.message_id === 'assoc-1');

  // Its bounce arrives while the record still has no provider id.
  await webhook.recordDeliveryEvent({ provider: 'postmark', messageId: 'assoc-1', event: 'bounce', detail: 'hard' }, { pool });
  await webhook.applyPendingDeliveryEvents({ pool });
  check('the bounce waits rather than being lost', pool.ledger[0].applied_at === null);

  // The database recovers and the scheduled sweep repairs both.
  pool.options.failAssociation = false;
  const repaired = await webhook.reconcileEmailDeliveryEvents({ pool });
  check('the scheduled sweep repairs the association', repaired.repaired === 1, JSON.stringify(repaired));
  check('the repair queue is emptied', pool.associations.length === 0);
  check(
    'the stranded bounce finally reaches the record',
    pool.rows[0].data.delivery_status === 'bounced',
    JSON.stringify(pool.rows[0].data),
  );

  // Every sender that records an outbound email must use this repair path.
  for (const [label, file] of [
    ['dev compose', 'vite-integrations-plugin.js'],
    ['prod compose', path.join('db', 'prod-integrations.cjs')],
    ['signing link', path.join('lib', 'signingLinkDelivery.cjs')],
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    check(`${label} queues a failed association for repair`, /associateProviderMessage\(/.test(source));
  }
}

console.log('\n3be. Repairing an association never walks a recorded outcome backwards');
{
  // The repair queue can outlive the outcome it was waiting for: the bounce
  // arrives, the repair applies, and then deleting the queue row fails (or the
  // process dies before it). The next sweep repairs the SAME association again
  // — and must not rewrite the bounce back to 'submitted'.
  const pool = makePool([{
    id: 'c-late', type: 'email', communication_type: 'email', status: 'bounced',
    data: { provider_message_id: 'late-1', delivery_status: 'bounced', delivery_detail: 'hard' },
  }], { failAssociationDelete: true });
  pool.associations.push({ communication_id: 'c-late', provider: 'postmark', message_id: 'late-1', delivery_status: 'submitted', attempts: 0 });

  await webhook.applyPendingAssociations({ pool });
  check('a repeat repair keeps the recorded bounce', pool.rows[0].data.delivery_status === 'bounced', JSON.stringify(pool.rows[0].data));
  check('a repeat repair keeps the bounce detail', pool.rows[0].data.delivery_detail === 'hard');

  // ...and again on the following sweep, with the queue row still undeleted.
  await webhook.applyPendingAssociations({ pool });
  check('further sweeps still keep the bounce', pool.rows[0].data.delivery_status === 'bounced');
  check('the provider message id is still written', pool.rows[0].data.provider_message_id === 'late-1');
}

console.log('\n3bf. A correlation id written before the send survives a full outage');
{
  // Worst case: the association update AND the repair queue both fail, because
  // the database is down rather than one statement being unlucky. Nothing about
  // the provider message id can be stored at all — but the record was written
  // before the send with our own correlation id, which the provider echoes back.
  const pool = makePool([{
    id: 'c-corr', type: 'email', communication_type: 'email', status: 'pending',
    data: { delivery_status: 'pending', delivery_correlation_id: 'corr-1' },
  }], { failAssociation: true, failAssociationQueue: true });

  const outcome = await webhook.associateProviderMessage(
    { communicationId: 'c-corr', provider: 'postmark', messageId: 'corr-msg-1' },
    { pool },
  );
  check('a total outage reports the association as non-durable', outcome.ok === false && outcome.queued === false, JSON.stringify(outcome));

  // The provider's bounce arrives once the database is back, carrying the
  // correlation id from the send.
  pool.options.failAssociation = false;
  pool.options.failAssociationQueue = false;
  const events = webhook.parseProviderEvents({
    RecordType: 'Bounce', MessageID: 'corr-msg-1', Email: 'x@real-domain.com',
    Metadata: { correlation: 'corr-1' }, Description: 'mailbox full',
  });
  check('the provider echoes the correlation id back', events[0]?.correlationId === 'corr-1', JSON.stringify(events[0]));
  await webhook.recordDeliveryEvent(events[0], { pool });
  const drained = await webhook.applyPendingDeliveryEvents({ pool });
  check('the outcome still reaches the record', drained.applied === 1, JSON.stringify(drained));
  check('the record shows the bounce', pool.rows[0].data.delivery_status === 'bounced', JSON.stringify(pool.rows[0].data));

  // Callers are told tracking is degraded, never that the send failed — a
  // duplicate send is worse than a late status.
  for (const [label, file] of [
    ['dev compose', 'vite-integrations-plugin.js'],
    ['prod compose', path.join('db', 'prod-integrations.cjs')],
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    check(`${label} reports degraded tracking rather than a failed send`, /deliveryTrackingDegraded/.test(source));
    check(`${label} writes a correlation id before sending`, /delivery_correlation_id/.test(source) && /correlationId/.test(source));
  }
  const signingSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'signingLinkDelivery.cjs'), 'utf8');
  check('signing link writes a correlation id before sending', /delivery_correlation_id: correlationId/.test(signingSource));

  // The correlation only works if the transport actually sends it.
  const transport = fs.readFileSync(path.join(__dirname, '..', 'lib', 'emailTransport.cjs'), 'utf8');
  check('Postmark sends the correlation as metadata', /Metadata: \{ correlation: correlationId \}/.test(transport));
  check('SES sends the correlation as a message tag', /EmailTags = \[\{ Name: 'correlation'/.test(transport));
  check('SMTP sends it as a header', (transport.match(/\[CORRELATION_HEADER\]: correlationId/g) || []).length >= 2);
  // Resend does not echo outbound custom headers back on its webhooks; only a
  // tag survives the round trip, so the header alone would be unmatched mail.
  check(
    'Resend sends the correlation as a tag',
    /tags: \[\{ name: 'correlation', value: correlationId \}\]/.test(transport),
  );
}

console.log('\n3bg. Correlation ids are read back from every provider shape');
{
  // Shape taken from Resend's documented email.bounced payload: tags come back
  // as a { name: value } MAP, and the outbound header is not present at all.
  const resend = webhook.parseProviderEvents({
    type: 'email.bounced',
    created_at: '2026-11-22T23:41:12.126Z',
    data: {
      created_at: '2026-11-22T23:41:11.894Z',
      email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
      message_id: '<111-222-333@email.example.com>',
      from: 'Acme <onboarding@resend.dev>',
      to: ['x@real-domain.com'],
      subject: 'Sending this example',
      bounce: { message: 'The recipient is on the suppression list.', subType: 'Suppressed', type: 'Permanent' },
      tags: { category: 'confirm_email', correlation: 'corr-resend' },
    },
  });
  check('Resend correlation is read from its tags', resend[0]?.correlationId === 'corr-resend', JSON.stringify(resend[0]));
  check('the documented Resend bounce parses as a bounce', resend[0]?.event === 'bounce' && resend[0]?.messageId === '56761188-7520-42d8-8898-ff6fc54ce618');
  check('the Resend bounce keeps its reason', /suppression list/.test(resend[0]?.detail || ''), resend[0]?.detail);

  const resendDelivered = webhook.parseProviderEvents({
    type: 'email.delivered',
    created_at: '2026-11-22T23:41:12.126Z',
    data: {
      created_at: '2026-11-22T23:41:11.894Z',
      email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
      to: ['x@real-domain.com'],
      subject: 'Sending this example',
      tags: { correlation: 'corr-resend-2' },
    },
  });
  check('the documented Resend delivery parses with its correlation', resendDelivered[0]?.event === 'delivered' && resendDelivered[0]?.correlationId === 'corr-resend-2');

  const ses = webhook.parseProviderEvents({
    Type: 'Notification',
    Message: JSON.stringify({
      notificationType: 'Bounce',
      mail: { messageId: 'ses-c1', destination: ['y@real-domain.com'], tags: { correlation: ['corr-ses'] } },
      bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: 'y@real-domain.com' }] },
    }),
  });
  check('SES correlation is read from its message tags', ses[0]?.correlationId === 'corr-ses', JSON.stringify(ses[0]));

  const bare = webhook.parseProviderEvents({ RecordType: 'Delivery', MessageID: 'pm-nc' });
  check('a payload without a correlation id is still valid', bare[0]?.event === 'delivered' && bare[0]?.correlationId === null);
}

console.log('\n3bg2. A Resend bounce lands with ONLY the pre-send correlation id');
{
  // The worst realistic case: the provider accepted the mail, then every write
  // that would have recorded its message id failed — no provider_message_id on
  // the record and no repair row. All that exists is the id we wrote before
  // sending. A real (documented-shape) Resend callback must still find it.
  const pool = makePool([{
    id: 'c-resend-only', type: 'email', communication_type: 'email', status: 'pending',
    data: { delivery_status: 'pending', delivery_correlation_id: 'only-corr' },
  }]);

  const [event] = webhook.parseProviderEvents({
    type: 'email.bounced',
    created_at: '2026-11-22T23:41:12.126Z',
    data: {
      created_at: '2026-11-22T23:41:11.894Z',
      email_id: 'resend-unassociated-1',
      to: ['x@real-domain.com'],
      subject: 'Sending this example',
      bounce: { message: 'mailbox unavailable', subType: 'General', type: 'Permanent' },
      tags: { correlation: 'only-corr' },
    },
  });
  await webhook.recordDeliveryEvent(event, { pool });
  const drained = await webhook.applyPendingDeliveryEvents({ pool });

  check('the unassociated Resend bounce still applies', drained.applied === 1, JSON.stringify(drained));
  check('it lands on the record it was sent for', pool.rows[0].data.delivery_status === 'bounced', JSON.stringify(pool.rows[0].data));
  check('and it carries the bounce reason', /mailbox unavailable/.test(pool.rows[0].data.delivery_detail || ''));
  check('no repair row was needed', (pool.associations || []).length === 0);
}

console.log('\n3bh. An outcome that arrives mid-send survives finalization');
{
  // The pre-send correlation id means a callback can now match BEFORE the send
  // handler has written anything down. The bounce is applied and its ledger
  // event retired — so if finalization then writes acceptance over it, nothing
  // is left to restore it. Finalization must yield to the recorded outcome.
  const pool = makePool([{
    id: 'c-mid', type: 'email', communication_type: 'email', status: 'pending',
    data: { delivery_status: 'pending', delivery_correlation_id: 'mid-corr' },
  }]);

  await webhook.recordDeliveryEvent(webhook.parseProviderEvents({
    RecordType: 'Bounce', MessageID: 'mid-msg', Email: 'z@real-domain.com',
    Metadata: { correlation: 'mid-corr' }, Description: 'mailbox does not exist',
  })[0], { pool });
  await webhook.applyPendingDeliveryEvents({ pool });
  check('the early bounce is recorded', pool.rows[0].data.delivery_status === 'bounced');
  check('its ledger event is retired', pool.ledger[0].applied_at !== null);

  // Now the send handler finally finalizes, as every sender does on success.
  await webhook.finalizeSendRecord({
    communicationId: 'c-mid',
    status: 'sent',
    always: { provider: 'postmark', provider_message_id: 'mid-msg', delivery_correlation_id: 'mid-corr' },
    optimistic: { delivery_status: 'submitted', delivery_status_at: new Date().toISOString() },
  }, { pool });

  check('finalization does not overwrite the bounce', pool.rows[0].data.delivery_status === 'bounced', JSON.stringify(pool.rows[0].data));
  check('finalization does not overwrite the status column', pool.rows[0].status === 'bounced', pool.rows[0].status);
  check('the bounce detail is preserved', pool.rows[0].data.delivery_detail === 'mailbox does not exist');
  check('finalization still writes the provider message id', pool.rows[0].data.provider_message_id === 'mid-msg');

  // A record with no outcome yet must still get its acceptance state.
  const fresh = makePool([{ id: 'c-fresh', type: 'email', communication_type: 'email', status: 'pending', data: { delivery_status: 'pending' } }]);
  await webhook.finalizeSendRecord({
    communicationId: 'c-fresh', status: 'sent',
    always: { provider_message_id: 'fresh-1' },
    optimistic: { delivery_status: 'submitted' },
  }, { pool: fresh });
  check('an unsettled record still records acceptance', fresh.rows[0].data.delivery_status === 'submitted' && fresh.rows[0].status === 'sent');

  // Every sender must finalize through that shared guard, not its own UPDATE.
  for (const [label, file] of [
    ['dev compose', 'vite-integrations-plugin.js'],
    ['prod compose', path.join('db', 'prod-integrations.cjs')],
    ['signing link', path.join('lib', 'signingLinkDelivery.cjs')],
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    check(`${label} finalizes through the shared monotonic guard`, /finalizeSendRecord\(/.test(source));
  }
}

console.log('\n3bi. Production carries the correlation id all the way to the transport');
{
  // The identifier is worthless if a wrapper drops it before the provider sees
  // it: the provider can only echo back what it was given.
  const transportPath = require.resolve('../lib/emailTransport.cjs');
  const realTransport = require.cache[transportPath];
  const seen = [];
  require.cache[transportPath] = {
    id: transportPath, filename: transportPath, loaded: true, exports: {
      sendPlatformEmail: async (opts) => { seen.push(opts); return { success: true, id: 'prod-1', provider: 'postmark' }; },
      normalizeRecipients: (value) => (Array.isArray(value) ? value : [value]).filter(Boolean),
      MAX_RECIPIENTS_PER_SEND: 25,
      CORRELATION_HEADER: 'X-Delivery-Correlation',
    },
  };
  try {
    const prod = require('../db/prod-integrations.cjs');
    await prod.sendEmailWithData({
      to: 'someone@real-domain.com', subject: 'Prod path', body: 'hello',
      correlationId: 'prod-corr-1',
    });
    check('the production wrapper forwards the correlation id', seen[0]?.correlationId === 'prod-corr-1', JSON.stringify(seen[0]?.correlationId));
  } finally {
    if (realTransport) require.cache[transportPath] = realTransport; else delete require.cache[transportPath];
  }

  // Company SMTP is a delivery path too, and needs the header form.
  const prodSource = fs.readFileSync(path.join(__dirname, '..', 'db', 'prod-integrations.cjs'), 'utf8');
  check(
    'company SMTP sends the correlation header',
    /\[transportLib\.CORRELATION_HEADER\]: correlationId/.test(prodSource),
  );
}

console.log('\n3c. Recovery is scheduled, not dependent on further webhook traffic');
{
  const pool = makePool([{ id: 'c-late', type: 'email', communication_type: 'email', status: 'sent', data: { provider_message_id: 'late-1' } }]);
  // The event was acknowledged to the provider but never applied, and no
  // further callbacks arrive to trigger another drain.
  await webhook.recordDeliveryEvent({ provider: 'postmark', messageId: 'late-1', event: 'delivered' }, { pool });

  const result = await webhook.reconcileEmailDeliveryEvents({ pool });
  check('the scheduled sweep applies stranded events', result.applied === 1, JSON.stringify(result));
  check('the sweep reports success', result.success === true);
  check('the swept outcome reaches the record', pool.rows[0].data.delivery_status === 'delivered');

  // Both schedulers must run it: a dev-only cron leaves production stranded.
  const devCron = fs.readFileSync(path.join(__dirname, '..', 'vite-cron-plugin.js'), 'utf8');
  const prodServer = fs.readFileSync(path.join(__dirname, '..', 'prod-server.cjs'), 'utf8');
  const devFunctions = fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
  check('the dev scheduler registers the recovery job', /reconcileEmailDeliveryEvents/.test(devCron));
  check('the dev handler implements the recovery job', /async reconcileEmailDeliveryEvents\(/.test(devFunctions));
  check('production schedules the recovery job too', /reconcileEmailDeliveryEvents/.test(prodServer));
}

// ── 4. Live sender configuration vs. the delivery-lookup account ─────────────
console.log('\n4. Sender configuration is verified against the lookup account');
{
  const originalFetch = global.fetch;
  const respond = (routes) => async (url) => {
    // Longest match wins: '/server' is a substring of '/servers', and picking
    // the wrong one would quietly answer the account probe with server data.
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((route) => String(url).includes(route));
    const entry = key ? routes[key] : { status: 404, body: {} };
    return { ok: entry.status >= 200 && entry.status < 300, status: entry.status, json: async () => entry.body };
  };

  const originalAccountToken = process.env.POSTMARK_ACCOUNT_TOKEN;
  process.env.EMAIL_FROM = 'CompanySync <noreply@companysync.io>';

  // Provider evidence, the strongest form: the account itself lists a confirmed
  // signature for the address we send from.
  process.env.POSTMARK_ACCOUNT_TOKEN = 'account-token';
  global.fetch = respond({
    '/server': { status: 200, body: { ID: 12345, Name: 'CompanySync Production' } },
    '/servers': { status: 200, body: { Servers: [{ ID: 12345, Name: 'CompanySync Production' }] } },
    '/messages/outbound': { status: 200, body: { TotalCount: 42, Messages: [] } },
    '/senders': { status: 200, body: { SenderSignatures: [{ EmailAddress: 'noreply@companysync.io', Confirmed: true }] } },
    '/domains': { status: 200, body: { Domains: [] } },
  });
  let result = await transport.verifyPlatformSenderConfiguration();
  check('healthy Postmark config verifies', result.ok === true, JSON.stringify(result));
  check('the live account is identified', result.account?.id === 12345 && result.account?.name === 'CompanySync Production');
  check('delivery lookups are reported available', result.lookupAvailable === true);
  check('the verified sender is reported', result.sender === 'noreply@companysync.io' && result.senderVerified === true);
  check('verification cites provider evidence', /confirmed sender signature/i.test(result.senderEvidence || ''), result.senderEvidence);
  check('a healthy config raises no warnings', (result.warnings || []).length === 0, JSON.stringify(result.warnings));

  // The account answers and the sender is simply not there. That is a real
  // provider "no" and must fail, not pass on a locally-declared domain list.
  global.fetch = respond({
    '/server': { status: 200, body: { ID: 12345, Name: 'CompanySync Production' } },
    '/servers': { status: 200, body: { Servers: [{ ID: 12345, Name: 'CompanySync Production' }] } },
    '/messages/outbound': { status: 200, body: { TotalCount: 0 } },
    '/senders': { status: 200, body: { SenderSignatures: [{ EmailAddress: 'someone-else@companysync.io', Confirmed: true }] } },
    '/domains': { status: 200, body: { Domains: [{ Name: 'companysync.io', DKIMVerified: false, ReturnPathDomainVerified: false }] } },
  });
  result = await transport.verifyPlatformSenderConfiguration();
  check('an absent sender is reported unverified', result.senderVerified === false, JSON.stringify(result));
  check('the unverified sender is explained', (result.warnings || []).some((w) => /no confirmed signature/i.test(w)), JSON.stringify(result.warnings));

  // The account token and the server token are configured independently and can
  // point at different Postmark accounts. Sender signatures from an account
  // that does not own the live sending server prove nothing about it — treating
  // them as proof rebuilds exactly the false assurance this check removes.
  process.env.POSTMARK_ACCOUNT_TOKEN = 'other-account-token';
  global.fetch = respond({
    '/server': { status: 200, body: { ID: 12345, Name: 'CompanySync Production' } },
    '/servers': { status: 200, body: { Servers: [{ ID: 99999, Name: 'Someone Else' }] } },
    '/messages/outbound': { status: 200, body: { TotalCount: 0 } },
    '/senders': { status: 200, body: { SenderSignatures: [{ EmailAddress: 'noreply@companysync.io', Confirmed: true }] } },
    '/domains': { status: 200, body: { Domains: [{ Name: 'companysync.io', DKIMVerified: true }] } },
  });
  result = await transport.verifyPlatformSenderConfiguration();
  check(
    'evidence from an unrelated account never verifies the sender',
    result.senderVerified !== true,
    JSON.stringify({ senderVerified: result.senderVerified, evidence: result.senderEvidence }),
  );
  check(
    'the account mismatch is reported',
    (result.warnings || []).some((w) => /different account/i.test(w)),
    JSON.stringify(result.warnings),
  );

  // The account token cannot even list servers, so the relationship is unknown.
  global.fetch = respond({
    '/server': { status: 200, body: { ID: 12345, Name: 'CompanySync Production' } },
    '/servers': { status: 401, body: {} },
    '/messages/outbound': { status: 200, body: { TotalCount: 0 } },
    '/senders': { status: 200, body: { SenderSignatures: [{ EmailAddress: 'noreply@companysync.io', Confirmed: true }] } },
    '/domains': { status: 200, body: { Domains: [] } },
  });
  result = await transport.verifyPlatformSenderConfiguration();
  check('unprovable account ownership is not verified', result.senderVerified !== true, JSON.stringify(result));
  check(
    'the unprovable link is reported',
    (result.warnings || []).some((w) => /could not list servers/i.test(w)),
    JSON.stringify(result.warnings),
  );
  process.env.POSTMARK_ACCOUNT_TOKEN = 'account-token';

  // A verified domain covers every address on it.
  global.fetch = respond({
    '/server': { status: 200, body: { ID: 12345, Name: 'CompanySync Production' } },
    '/servers': { status: 200, body: { Servers: [{ ID: 12345, Name: 'CompanySync Production' }] } },
    '/messages/outbound': { status: 200, body: { TotalCount: 0 } },
    '/senders': { status: 200, body: { SenderSignatures: [] } },
    '/domains': { status: 200, body: { Domains: [{ Name: 'companysync.io', DKIMVerified: true }] } },
  });
  result = await transport.verifyPlatformSenderConfiguration();
  check('a DKIM-verified domain verifies the sender', result.senderVerified === true, JSON.stringify(result));

  // No account token: ownership genuinely cannot be established. "Unknown" must
  // never be dressed up as verified — that is the assurance being removed here.
  delete process.env.POSTMARK_ACCOUNT_TOKEN;
  global.fetch = respond({
    '/server': { status: 200, body: { ID: 12345, Name: 'CompanySync Production' } },
    '/servers': { status: 200, body: { Servers: [{ ID: 12345, Name: 'CompanySync Production' }] } },
    '/messages/outbound': { status: 200, body: { TotalCount: 0 } },
  });
  result = await transport.verifyPlatformSenderConfiguration();
  check('an unprovable sender is neither verified nor denied', result.senderVerified === null, JSON.stringify(result));
  check('the unprovable sender is called out', (result.warnings || []).some((w) => /UNCONFIRMED/.test(w)), JSON.stringify(result.warnings));

  // Weaker but real provider evidence: this server has actually sent from it.
  global.fetch = respond({
    '/server': { status: 200, body: { ID: 12345, Name: 'CompanySync Production' } },
    '/servers': { status: 200, body: { Servers: [{ ID: 12345, Name: 'CompanySync Production' }] } },
    '/messages/outbound': { status: 200, body: { TotalCount: 7 } },
  });
  result = await transport.verifyPlatformSenderConfiguration();
  check('outbound history counts as provider evidence', result.senderVerified === true && /outbound history/i.test(result.senderEvidence || ''), JSON.stringify(result));

  // The env domain list still drives the send-side From rewrite, which is a
  // behaviour, not evidence. It must not leak back into the verdict: a locally
  // declared "verified domain" is precisely the false assurance being removed.
  const transportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'emailTransport.cjs'), 'utf8');
  const verifierBody = transportSource.slice(
    transportSource.indexOf('async function verifyPostmarkSenderConfiguration'),
    transportSource.indexOf('async function verifySesSenderConfiguration'),
  );
  check(
    'no local env list can declare a sender verified',
    verifierBody.length > 0 && !/POSTMARK_VERIFIED_DOMAINS/.test(verifierBody),
  );

  // The exact production symptom: sending works, but the credential cannot read
  // message details, so an accepted message cannot be traced.
  global.fetch = respond({
    '/server': { status: 200, body: { ID: 12345, Name: 'CompanySync Production' } },
    '/servers': { status: 200, body: { Servers: [{ ID: 12345, Name: 'CompanySync Production' }] } },
    '/messages/outbound': { status: 401, body: { Message: 'Not authorized' } },
  });
  result = await transport.verifyPlatformSenderConfiguration();
  check('a lookup-blind credential still verifies sending', result.ok === true);
  check('a lookup-blind credential is flagged', result.lookupAvailable === false && (result.warnings || []).some((w) => /lookups are unavailable/i.test(w)), JSON.stringify(result.warnings));

  // A From on an unverified domain is silently rewritten before sending, so the
  // delivery history is filed under a different address than staff expect.
  process.env.EMAIL_FROM = 'CompanySync <noreply@not-verified-here.example>';
  global.fetch = respond({
    '/server': { status: 200, body: { ID: 12345, Name: 'CompanySync Production' } },
    '/servers': { status: 200, body: { Servers: [{ ID: 12345, Name: 'CompanySync Production' }] } },
    '/messages/outbound': { status: 200, body: { TotalCount: 3 } },
  });
  result = await transport.verifyPlatformSenderConfiguration();
  check('a rewritten sender is surfaced', (result.warnings || []).some((w) => /rewritten/i.test(w)), JSON.stringify(result.warnings));
  check('the effective sender is the rewritten one', result.sender === 'noreply@companysync.io');

  global.fetch = respond({ '/server': { status: 401, body: { Message: 'Invalid token' } } });
  result = await transport.verifyPlatformSenderConfiguration();
  check('a rejected token fails verification', result.ok === false && /rejected the sending token/i.test(result.error || ''));

  process.env.EMAIL_FROM = 'CompanySync <noreply@companysync.io>';
  if (originalAccountToken === undefined) delete process.env.POSTMARK_ACCOUNT_TOKEN;
  else process.env.POSTMARK_ACCOUNT_TOKEN = originalAccountToken;
  global.fetch = originalFetch;
}

// ── 5. Send path records a submitted state and returns the record id ─────────
console.log('\n5. Quick email records a submitted state and links to the record');
{
  const source = fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
  check(
    'recordOutgoingEmail stamps a canonical delivery_status',
    /delivery_status: EMAIL_SEND_STATUS_TO_DELIVERY_STATE\[sendStatus\]/.test(source),
  );
  check(
    "an accepted send maps to 'submitted', not a delivery claim",
    /accepted: 'submitted'/.test(source) && /failed: 'failed'/.test(source),
  );
  check(
    'recordOutgoingEmail returns the new communication id',
    /return communicationId;/.test(source),
  );
  check(
    'sendUnifiedEmail hands the communication id back to the caller',
    /success: true, communicationId, deliveryStatus: 'submitted'/.test(source),
  );
  check(
    'the launch checklist verifies the sender against the lookup account',
    /verifyPlatformSenderConfiguration\(\)/.test(source),
  );

  const dialog = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'communication', 'EmailDialog.jsx'), 'utf8');
  // Strip comments so a note ABOUT the old wording is not mistaken for the wording.
  const dialogCode = dialog.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('the dialog never claims the email was delivered', !/sent successfully|Email sent!|successfully sent/i.test(dialogCode));
  check('the dialog shows a neutral provider-submission confirmation', /Email submitted successfully/i.test(dialogCode));
  check('the dialog omits the unwanted delivery-warning banner', !/Delivery has not been confirmed yet/i.test(dialogCode));
  check('the dialog links to the message status', /button-view-delivery-status/.test(dialog) && /\?comm=/.test(dialog));

  const timeline = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Communication.jsx'), 'utf8');
  for (const label of ['Submitted', 'Delivered', 'Bounced', 'Marked as spam', 'Failed']) {
    check(`the timeline distinguishes '${label}'`, timeline.includes(`label: '${label}'`));
  }
  check('the timeline honours the deep link to one record', /params\.get\('comm'\)/.test(timeline));

  // The dialog posts to /api/integrations/send-email, NOT the unified handler.
  // If that endpoint omits the record id, "View delivery status" degrades to a
  // generic list and the whole link-to-the-outcome promise quietly fails.
  const client = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'base44Client.js'), 'utf8');
  check(
    'the dialog send path is the integrations endpoint',
    /base44\.integrations\.Core\.SendEmail/.test(dialog) && /'\/api\/integrations\/send-email'/.test(client),
  );
  for (const [label, file] of [
    ['dev', 'vite-integrations-plugin.js'],
    ['prod', path.join('db', 'prod-integrations.cjs')],
  ]) {
    const endpoint = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    check(
      `the ${label} compose endpoint returns the communication id`,
      /communicationId: composeAudit\.id/.test(endpoint),
    );
    check(
      `the ${label} compose endpoint records a submitted state`,
      /delivery_status: 'submitted'/.test(endpoint),
    );
    check(
      `the ${label} compose endpoint applies callbacks that arrived early`,
      /applyPendingDeliveryEvents\(\{[\s\S]{0,140}?messageId/.test(endpoint),
    );
  }

  // Every path that records an outbound email has to keep the provider message
  // id, not just the quick-email dialog. A sender that drops it leaves its
  // communication frozen at acceptance forever, because the webhook has no
  // other key to find that row by.
  const signing = fs.readFileSync(path.join(__dirname, '..', 'lib', 'signingLinkDelivery.cjs'), 'utf8');
  check(
    'the signing-link sender keeps the transport result',
    /const sendResult = await emailTransport\.sendPlatformEmail\(/.test(signing),
  );
  check(
    'the signing-link sender persists the provider message id',
    /provider_message_id: sendResult\?\.id/.test(signing)
      && /provider_message_id: outcome\.provider_message_id/.test(signing),
  );
  check(
    'the signing-link sender records a submitted state',
    /delivery_status: status === 'accepted' \? 'submitted' : 'failed'/.test(signing),
  );
  check(
    'the signing-link sender replays callbacks that arrived early',
    /applyPendingDeliveryEvents\(\{[\s\S]{0,80}?messageId/.test(signing),
  );
  check(
    'the signing-link response hands back the delivery record',
    /communication_id: reservation\.deliveryId/.test(signing),
  );

  // The link is usually followed from the Communication page itself, so the
  // focus must track the URL rather than only the initial mount.
  check(
    'the deep link re-focuses on later navigations',
    /\[location\.search\]/.test(timeline),
  );

  // Production initializes through prod-db.cjs, so schema.js alone never ships.
  for (const [label, file] of [['dev', path.join('db', 'schema.js')], ['prod', path.join('db', 'prod-db.cjs')]]) {
    const schema = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    check(`${label} indexes provider message id lookups`, /idx_comms_provider_message_id/.test(schema));
    check(`${label} creates the delivery event ledger`, /CREATE TABLE IF NOT EXISTS email_delivery_events/.test(schema));
  }
}

console.log(`\n${'─'.repeat(60)}`);
if (failures.length) {
  console.log(`❌ ${failures.length} check(s) failed, ${passed} passed:`);
  failures.forEach((failure) => console.log(`   - ${failure}`));
  process.exit(1);
}
console.log(`✅ All ${passed} checks passed.`);
}

main().catch((error) => {
  console.error('❌ Test run crashed:', error);
  process.exit(1);
});
