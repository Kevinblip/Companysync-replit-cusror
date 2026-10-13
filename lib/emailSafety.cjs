// Outbound email safety controls shared by every Node sender. This is deliberately
// below product workflows, so a new caller cannot accidentally bypass the limits.
'use strict';

const crypto = require('crypto');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_COMPANY = 60;
const MAX_PER_ACTOR = 25;
const MAX_PLATFORM = 250;
const recentSends = new Map();
let platformWindow = { startedAt: 0, count: 0 };

function windowFor(key) {
  const now = Date.now();
  const prior = recentSends.get(key);
  const state = !prior || now - prior.startedAt >= WINDOW_MS ? { startedAt: now, count: 0 } : prior;
  recentSends.set(key, state);
  return state;
}

function hasCapacity(key, amount, limit) {
  return windowFor(key).count + amount <= limit;
}

function consume(key, amount) {
  windowFor(key).count += amount;
}

// Content caps live here, beside the rate limits, because they are the same
// class of control: every sender must apply them. Keeping them inline in one
// transport let the company-SMTP path pass unbounded HTML straight to nodemailer.
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 250000;

function assertContentWithinLimits({ subject, html, text } = {}) {
  if (
    String(subject || '').trim().length > MAX_SUBJECT_LENGTH ||
    String(html || text || '').length > MAX_BODY_LENGTH
  ) {
    const error = new Error('[Email] Email content is too large');
    error.code = 'EMAIL_CONTENT_TOO_LARGE';
    error.noRetry = true;
    throw error;
  }
}

async function consumeDurableRateLimits({ companyId, actorEmail, amount }) {
  // Process-local maps reset on deploy and do not coordinate web/workflow
  // processes. Keep a rolling-window counter in the database so a staff
  // compose sender cannot regain its allowance by changing processes.
  const pool = require('../db/prod-db.cjs').getPool();
  const actorId = actorEmail ? `email-rate:actor:${actorEmail.toLowerCase()}` : null;
  const companyRateId = `email-rate:company:${companyId}`;
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const now = Date.now();
  const resetAt = now - WINDOW_MS;
  const ids = actorId ? [actorId, companyRateId].sort() : [companyRateId];
  try {
    await client.query('BEGIN');
    for (const id of ids) {
      await client.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'EmailRateLimit', $2, $3, NOW(), NOW())
         ON CONFLICT (id, entity_type) DO NOTHING`,
        [id, companyId, JSON.stringify({ window_started_at: new Date(now).toISOString(), count: 0 })],
      );
    }
    const locked = await client.query(
      `SELECT id, data FROM generic_entities
       WHERE entity_type = 'EmailRateLimit' AND id = ANY($1) FOR UPDATE`,
      [ids],
    );
    const counters = new Map(locked.rows.map((row) => [row.id, typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {})]));
    const countFor = (id) => {
      const data = counters.get(id) || {};
      return new Date(data.window_started_at || 0).getTime() <= resetAt ? 0 : Number(data.count) || 0;
    };
    const actorOverLimit = actorId && countFor(actorId) + amount > MAX_PER_ACTOR;
    const companyOverLimit = countFor(companyRateId) + amount > MAX_PER_COMPANY;
    if (actorOverLimit || companyOverLimit) {
      await client.query('ROLLBACK');
      return actorOverLimit ? 'actor' : 'company';
    }
    // Both buckets were locked and validated before either was changed. This
    // matters: a rejected company limit must never consume the actor allowance.
    const bucketStarts = new Map();
    for (const id of ids) {
      const data = counters.get(id) || {};
      const startedAt = new Date(data.window_started_at || 0).getTime();
      bucketStarts.set(id, startedAt <= resetAt ? now : startedAt);
    }
    for (const id of ids) {
      const count = countFor(id) + amount;
      await client.query(
        `UPDATE generic_entities SET data = $2, updated_date = NOW()
         WHERE id = $1 AND entity_type = 'EmailRateLimit'`,
        [id, JSON.stringify({ window_started_at: new Date(bucketStarts.get(id)).toISOString(), count })],
      );
    }
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release?.();
  }
}

async function assertCanSend(context = {}, recipientCount) {
  if (!Number.isInteger(recipientCount) || recipientCount < 1) {
    const error = new Error('At least one email recipient is required');
    error.code = 'EMAIL_RECIPIENTS_REQUIRED';
    error.noRetry = true;
    throw error;
  }
  const now = Date.now();
  if (now - platformWindow.startedAt >= WINDOW_MS) platformWindow = { startedAt: now, count: 0 };
  if (platformWindow.count + recipientCount > MAX_PLATFORM) {
    const error = new Error('Platform email safety limit reached. Sending is temporarily paused.');
    error.code = 'EMAIL_PLATFORM_RATE_LIMIT';
    error.noRetry = true;
    throw error;
  }
  const companyId = context.companyId ? String(context.companyId) : null;
  // Tenantless system/auth mail is protected only by the intentional platform
  // safety bucket above. Do not make unrelated companies compete for a
  // fabricated durable "platform" company allowance.
  if (!companyId) {
    platformWindow.count += recipientCount;
    return;
  }
  const actor = String(context.actorEmail || '');
  const actorKey = actor ? `actor:${actor.toLowerCase()}` : null;

  // Check every bucket BEFORE consuming any of them. Consuming the company
  // bucket first meant one over-limit actor could burn the whole company's
  // allowance with repeated attempts that were then rejected anyway.
  if (actorKey && !hasCapacity(actorKey, recipientCount, MAX_PER_ACTOR)) {
    const error = new Error('Your email sending limit has been reached. Please try again in 15 minutes.');
    error.code = 'EMAIL_ACTOR_RATE_LIMIT';
    error.noRetry = true;
    throw error;
  }
  if (!hasCapacity(`company:${companyId}`, recipientCount, MAX_PER_COMPANY)) {
    const error = new Error('This company has reached its email safety limit. Please try again in 15 minutes.');
    error.code = 'EMAIL_COMPANY_RATE_LIMIT';
    error.noRetry = true;
    throw error;
  }

  // Do the durable checks before consuming process-local mirrors. Both durable
  // counters are locked, checked, and incremented in one transaction.
  const durableLimit = await consumeDurableRateLimits({ companyId, actorEmail: actor || null, amount: recipientCount });
  if (durableLimit !== true) {
    if (durableLimit === 'actor') {
    const error = new Error('Your email sending limit has been reached. Please try again in 15 minutes.');
    error.code = 'EMAIL_ACTOR_RATE_LIMIT';
    error.noRetry = true;
    throw error;
    }
    const error = new Error('This company has reached its email safety limit. Please try again in 15 minutes.');
    error.code = 'EMAIL_COMPANY_RATE_LIMIT';
    error.noRetry = true;
    throw error;
  }

  if (actorKey) consume(actorKey, recipientCount);
  consume(`company:${companyId}`, recipientCount);
  platformWindow.count += recipientCount;
}

async function recordDeliveryAttempt({ context = {}, recipients = [], subject, result, error } = {}) {
  // Attribution is best-effort only: a database outage must never change a
  // provider-accepted message into a duplicate resend.
  try {
    const pool = require('../db/prod-db.cjs').getPool();
    const data = {
      provider: result?.provider || null,
      provider_message_id: result?.id || null,
      source: context.source || 'system',
      actor_email: context.actorEmail || null,
      recipient_count: recipients.length,
      recipients: recipients.slice(0, 25),
      subject: String(subject || '').slice(0, 200),
      status: result?.success ? 'accepted' : 'failed',
      error: error ? String(error.message || error).slice(0, 500) : null,
      attempted_at: new Date().toISOString(),
    };
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'EmailDeliveryEvent', $2, $3, NOW(), NOW())`,
      [crypto.randomUUID(), context.companyId || 'companysync_master_001', JSON.stringify(data)],
    );
  } catch (e) {
    console.warn('[EmailSafety] Could not persist email delivery attribution:', e.message);
  }
}

module.exports = {
  assertCanSend,
  recordDeliveryAttempt,
  assertContentWithinLimits,
  MAX_SUBJECT_LENGTH,
  MAX_BODY_LENGTH,
};