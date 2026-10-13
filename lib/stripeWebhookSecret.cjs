'use strict';

const MANAGED_WEBHOOKS_TABLE = '"stripe"."_managed_webhooks"';

function isStripeWebhookSecret(value) {
  return typeof value === 'string' && value.trim().startsWith('whsec_');
}

/**
 * Read the signing secret that stripe-replit-sync stores for a managed
 * endpoint. Stripe's webhookEndpoints.list() API intentionally omits the
 * signing secret, so this database row is the durable source for endpoints
 * that already exist.
 */
async function loadManagedStripeWebhookSecret(pool, { endpointId, url } = {}) {
  if (!pool || (!endpointId && !url)) return null;

  const conditions = [];
  const values = [];
  if (endpointId) {
    values.push(endpointId);
    conditions.push(`id = $${values.length}`);
  }
  if (url) {
    values.push(url);
    conditions.push(`url = $${values.length}`);
  }

  try {
    const result = await pool.query(
      `SELECT secret
       FROM ${MANAGED_WEBHOOKS_TABLE}
       WHERE secret IS NOT NULL
         AND secret <> ''
         AND (${conditions.join(' OR ')})
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      values
    );
    const secret = result.rows[0]?.secret;
    return isStripeWebhookSecret(secret) ? secret.trim() : null;
  } catch (error) {
    // The Stripe sync schema is optional in production. A missing table must
    // not prevent the HTTP server from starting or Stripe registration from
    // being attempted.
    if (!/relation .*_managed_webhooks.* does not exist/i.test(error.message || '')) {
      console.warn('[Stripe] Could not read managed webhook secret:', error.message);
    }
    return null;
  }
}

/**
 * Keep a newly-created endpoint's one-time secret in the managed webhook
 * store. This is what lets a later restart recover the secret even though
 * Stripe will not return it from webhookEndpoints.list().
 */
async function persistManagedStripeWebhookSecret(pool, endpoint, account) {
  const accountId = typeof account === 'string' ? account : account?.id;
  if (
    !pool ||
    !endpoint?.id ||
    !accountId ||
    !isStripeWebhookSecret(endpoint.secret)
  ) {
    return false;
  }

  try {
    // A newly-connected Stripe account can create its first webhook before
    // stripe-replit-sync has mirrored the account. Seed that parent row so the
    // managed-webhook foreign key does not turn persistence into a no-op.
    if (account && typeof account === 'object') {
      await pool.query(
        `INSERT INTO "stripe"."accounts" (_raw_data)
         VALUES ($1::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           _raw_data = EXCLUDED._raw_data,
           _last_synced_at = NOW(),
           _updated_at = NOW()`,
        [JSON.stringify(account)]
      );
    }

    await pool.query(
      `INSERT INTO ${MANAGED_WEBHOOKS_TABLE}
         (id, object, url, enabled_events, description, enabled, livemode,
          metadata, secret, status, api_version, created, updated_at,
          last_synced_at, account_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9, $10, $11,
               $12, NOW(), NULL, $13)
       ON CONFLICT (id) DO UPDATE SET
         url = EXCLUDED.url,
         enabled_events = EXCLUDED.enabled_events,
         metadata = EXCLUDED.metadata,
         secret = EXCLUDED.secret,
         status = EXCLUDED.status,
         updated_at = NOW(),
         account_id = EXCLUDED.account_id`,
      [
        endpoint.id,
        endpoint.object || 'webhook_endpoint',
        endpoint.url,
        JSON.stringify(endpoint.enabled_events || []),
        endpoint.description || null,
        endpoint.enabled ?? null,
        endpoint.livemode ?? null,
        JSON.stringify(endpoint.metadata || {}),
        endpoint.secret,
        endpoint.status || 'enabled',
        endpoint.api_version || null,
        endpoint.created || null,
        accountId,
      ]
    );
    return true;
  } catch (error) {
    if (!/relation .*_managed_webhooks.* does not exist/i.test(error.message || '')) {
      console.warn('[Stripe] Could not persist managed webhook secret:', error.message);
    }
    return false;
  }
}

module.exports = {
  isStripeWebhookSecret,
  loadManagedStripeWebhookSecret,
  persistManagedStripeWebhookSecret,
};