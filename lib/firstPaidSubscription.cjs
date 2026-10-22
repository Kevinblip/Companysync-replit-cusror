'use strict';

// First real CompanySync subscription charge (the invoice that ends the free
// trial, or the first invoice when there is no trial). Contractor Connect
// payments and $0 trial invoices are ignored. The MarketingConversion row is
// the idempotency key: Stripe delivers invoice.payment_succeeded at least once.

const FIRST_PAID_REASONS = new Set(['subscription_create', 'subscription_cycle']);

function subscriptionIdOf(invoice) {
  if (!invoice) return null;
  if (typeof invoice.subscription === 'string' && invoice.subscription) return invoice.subscription;
  if (invoice.subscription && typeof invoice.subscription === 'object' && invoice.subscription.id) {
    return invoice.subscription.id;
  }
  return invoice.parent?.subscription_details?.subscription
    || null;
}

function companyIdFromInvoice(invoice) {
  return invoice?.subscription_details?.metadata?.company_id
    || invoice?.parent?.subscription_details?.metadata?.company_id
    || invoice?.metadata?.company_id
    || invoice?.lines?.data?.[0]?.metadata?.company_id
    || null;
}

function qualifiesAsFirstSubscriptionCharge(event) {
  if (!event || event.account) return false;
  if (event.type !== 'invoice.payment_succeeded') return false;
  const invoice = event.data?.object;
  if (!invoice || !subscriptionIdOf(invoice)) return false;
  if (!(Number(invoice.amount_paid) > 0)) return false;
  return FIRST_PAID_REASONS.has(invoice.billing_reason);
}

async function lookupCompanyId(pool, invoice) {
  const direct = companyIdFromInvoice(invoice);
  if (direct) return direct;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  if (!customerId) return null;
  const found = await pool.query(
    'SELECT id FROM companies WHERE stripe_customer_id = $1 LIMIT 1',
    [customerId]
  );
  return found.rows[0]?.id || null;
}

async function recordFirstPaidSubscription(pool, event, options = {}) {
  if (!qualifiesAsFirstSubscriptionCharge(event)) {
    return { recorded: false, reason: 'not_applicable' };
  }
  const send = options.sendServerEvent || require('./serverTracking.cjs').sendServerEvent;
  const invoice = event.data.object;
  try {
    const companyId = await lookupCompanyId(pool, invoice);
    if (!companyId) return { recorded: false, reason: 'no_company' };

    const conversionId = `firstpaid_${companyId}`;
    const eventId = `subinv_${invoice.id}`;
    const value = Number(invoice.amount_paid) / 100;
    const currency = String(invoice.currency || 'usd').toUpperCase();
    const inserted = await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'MarketingConversion', $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (id, entity_type) DO NOTHING
       RETURNING id`,
      [conversionId, companyId, JSON.stringify({
        event: 'purchase',
        meta_event: 'Subscribe',
        event_id: eventId,
        invoice_id: invoice.id,
        amount_paid: invoice.amount_paid,
        currency,
        billing_reason: invoice.billing_reason,
      })]
    );
    if (!inserted.rows.length) {
      return { recorded: false, reason: 'already_recorded', companyId, eventId };
    }

    let email = invoice.customer_email || null;
    let attr = {};
    try {
      const row = await pool.query(
        `SELECT email, data->'marketing_attribution' AS a FROM companies WHERE id = $1`,
        [companyId]
      );
      email = email || row.rows[0]?.email || null;
      const raw = row.rows[0]?.a;
      attr = raw && typeof raw === 'object' ? raw : {};
    } catch (error) {
      console.warn('[firstPaid] attribution lookup failed:', error.message);
    }

    await send({
      event_name: 'purchase',
      event_id: eventId,
      value,
      currency,
      user: {
        email,
        fbp: attr.fbp,
        fbc: attr.fbc,
        ip: attr.ip,
        ua: attr.ua,
      },
      extra: {
        meta_event: 'Subscribe',
        plan: invoice.lines?.data?.[0]?.price?.nickname || undefined,
        billing_reason: invoice.billing_reason,
      },
    });
    console.log(`[firstPaid] recorded ${eventId} for company ${companyId} ($${value} ${currency})`);
    return { recorded: true, companyId, eventId, value, currency };
  } catch (error) {
    console.error('[firstPaid] record failed:', error.message);
    return { recorded: false, reason: 'error' };
  }
}

module.exports = {
  qualifiesAsFirstSubscriptionCharge,
  companyIdFromInvoice,
  recordFirstPaidSubscription,
};
