import { createRequire } from 'module';
import { CREDIT_PACKAGES, BUNDLE_PACKAGES } from './src/config/creditPackages.js';
const require = createRequire(import.meta.url);
const crypto = require('crypto');
const chatBot = require('./lib/chatBot.cjs');
const { loadManagedStripeWebhookSecret } = require('./lib/stripeWebhookSecret.cjs');
const { resolveAppUrl } = require('./lib/appUrl.cjs');
const { allocatePaymentNumber } = require('./lib/paymentNumbers.cjs');

// Builds a short-lived Stripe idempotency key so an accidental double-click or a
// browser/network retry within the same window reuses the original Checkout
// Session instead of creating a duplicate one. The time bucket rolls over after
// 30s so a deliberate follow-up purchase later still gets a fresh session.
function makeIdempotencyKey(parts) {
  const bucket = Math.floor(Date.now() / 30000);
  const raw = [...parts, bucket].join(':');
  return 'ck_' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

let stripeClient = null;
let stripeSync = null;
let stripeReady = false;
let stripeInitPromise = null;

async function getStripeCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken || !hostname) {
    throw new Error('Replit connector environment not available');
  }

  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', 'stripe');
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Replit-Token': xReplitToken
    }
  });

  const data = await response.json();
  const connectionSettings = data.items?.[0];

  if (!connectionSettings?.settings?.publishable || !connectionSettings?.settings?.secret) {
    throw new Error(`Stripe ${targetEnvironment} connection not found`);
  }

  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

async function getStripeClient() {
  if (stripeClient) return stripeClient;

  const { secretKey } = await getStripeCredentials();
  const Stripe = require('stripe');
  stripeClient = new Stripe(secretKey, { apiVersion: '2025-08-27.basil' });
  return stripeClient;
}

async function getStripePublishableKey() {
  const { publishableKey } = await getStripeCredentials();
  return publishableKey;
}

async function initStripe(pool) {
  if (stripeInitPromise) return stripeInitPromise;

  stripeInitPromise = (async () => {
    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        console.warn('[Stripe] DATABASE_URL not set, skipping Stripe init');
        return;
      }

      console.log('[Stripe] Initializing...');

      const { runMigrations, StripeSync } = require('stripe-replit-sync');
      const { secretKey } = await getStripeCredentials();

      await runMigrations({ databaseUrl, schema: 'stripe' });
      console.log('[Stripe] Schema ready');

      const Stripe = require('stripe');
      stripeClient = new Stripe(secretKey, { apiVersion: '2025-08-27.basil' });

      stripeSync = new StripeSync({
        poolConfig: { connectionString: databaseUrl, max: 2 },
        stripeSecretKey: secretKey,
      });

      const webhookBaseUrl = resolveAppUrl();
      const webhookIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(webhookBaseUrl);
      if (!webhookIsLocal) {
        try {
          const result = await stripeSync.findOrCreateManagedWebhook(
            `${webhookBaseUrl}/api/stripe/webhook`
          );
          const webhookUrl = result?.webhook?.url || result?.url || webhookBaseUrl + '/api/stripe/webhook';
          const managedSecret =
            result?.secret ||
            result?.webhook?.secret ||
            await loadManagedStripeWebhookSecret(pool, {
              endpointId: result?.id || result?.webhook?.id,
              url: webhookUrl,
            });
          if (managedSecret) {
            // The managed secret belongs to the endpoint that just completed
            // setup, so it wins over a stale process/deployment value.
            process.env.STRIPE_WEBHOOK_SECRET = managedSecret;
            console.log('[Stripe] Webhook secret loaded from managed webhook store.');
          }
          console.log(`[Stripe] Webhook configured: ${webhookUrl}`);
        } catch (err) {
          console.warn(`[Stripe] Webhook setup warning: ${err.message}`);
        }
      }

      stripeSync.syncBackfill()
        .then(() => console.log('[Stripe] Data synced'))
        .catch(err => console.warn('[Stripe] Sync warning:', err.message));

      stripeReady = true;
      console.log('[Stripe] Ready');
    } catch (err) {
      console.error('[Stripe] Init error:', err.message);
    }
  })();

  return stripeInitPromise;
}

function createStripeHandlers(pool) {
  const PAYMENT_OPTION_KEYS = [
    'zelle_email',
    'cashapp_handle',
    'venmo_handle',
    'check_payment_instructions',
    'cash_payment_instructions',
  ];

  async function loadInvoice(invoiceId) {
    const dedicated = await pool.query(
      `SELECT id, company_id, customer_id, customer_name, customer_email, invoice_number,
              status, total_amount, amount_paid, due_date, notes, items, data
       FROM invoices WHERE id = $1 LIMIT 1`,
      [invoiceId]
    );
    if (dedicated.rows[0]) {
      const row = dedicated.rows[0];
      const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
      return { ...data, ...row };
    }

    const legacy = await pool.query(
      `SELECT id, company_id, data FROM generic_entities WHERE entity_type = 'Invoice' AND id = $1 LIMIT 1`,
      [invoiceId]
    );
    if (!legacy.rows[0]) return null;
    const row = legacy.rows[0];
    const data = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
    return { ...data, id: row.id, company_id: row.company_id || data.company_id };
  }

  async function loadPaymentOptions(companyId) {
    if (!companyId) return {};
    const result = await pool.query(
      `SELECT data FROM generic_entities
       WHERE entity_type = 'CompanySetting' AND company_id = $1
       ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
      [companyId]
    );
    const raw = result.rows[0]?.data;
    const settings = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    return Object.fromEntries(
      PAYMENT_OPTION_KEYS
        .map(key => [key, typeof settings[key] === 'string' ? settings[key].trim() : ''])
        .filter(([, value]) => value)
    );
  }

  function invoiceBalance(invoice) {
    const total = Number(invoice?.total_amount) || 0;
    const paid = Number(invoice?.amount_paid) || 0;
    return Math.max(0, Math.round((total - paid) * 100) / 100);
  }

  async function canAuthenticatedUserPay(invoice, userEmail) {
    if (!userEmail || !invoice?.company_id) return false;
    if (
      invoice.customer_email &&
      invoice.customer_email.toLowerCase() === userEmail.toLowerCase()
    ) return true;

    const access = await pool.query(
      `SELECT 1
       WHERE EXISTS (
         SELECT 1 FROM staff_profiles
         WHERE company_id = $1 AND (LOWER(user_email) = LOWER($2) OR LOWER(email) = LOWER($2))
       ) OR EXISTS (
         SELECT 1 FROM companies WHERE id = $1 AND LOWER(created_by) = LOWER($2)
       )`,
      [invoice.company_id, userEmail]
    );
    return access.rows.length > 0;
  }

  async function createInvoiceSession(invoice, req) {
    if (!invoice) throw new Error('Invoice not found');
    if (invoice.status === 'cancelled') throw new Error('This invoice has been cancelled');

    const chargeAmount = invoiceBalance(invoice);
    if (chargeAmount <= 0) throw new Error('This invoice has no remaining balance');

    const company = await getCompanyById(invoice.company_id);
    if (!company?.stripe_account_id) {
      throw new Error('Online card payments have not been enabled by this company');
    }

    const stripe = await getStripeClient();
    const account = await stripe.accounts.retrieve(company.stripe_account_id);
    if (!account?.charges_enabled) {
      throw new Error('Online card payments are temporarily unavailable');
    }

    const appUrl = resolveAppUrl(req);
    const companyName = company.company_name || company.name || '';
    const safeDesc = (companyName || 'Invoice Payment')
      .replace(/[<>"'\\]/g, '')
      .substring(0, 22)
      .trim();

    const sessionConfig = {
      payment_method_types: ['card', 'us_bank_account'],
      payment_method_options: {
        us_bank_account: { financial_connections: { permissions: ['payment_method'] } },
      },
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: companyName
              ? `${companyName} — Invoice #${invoice.invoice_number}`
              : `Invoice #${invoice.invoice_number}`,
            description: invoice.customer_name ? `Payment for ${invoice.customer_name}` : 'Invoice payment',
          },
          unit_amount: Math.round(chargeAmount * 100),
        },
        quantity: 1,
      }],
      success_url: `${appUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoice.id}`,
      cancel_url: `${appUrl}/payment-cancel?invoice_id=${invoice.id}`,
      metadata: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number || '',
        company_id: invoice.company_id,
        connected_account_id: company.stripe_account_id,
      },
      payment_intent_data: {
        statement_descriptor: safeDesc,
        on_behalf_of: company.stripe_account_id,
        application_fee_amount: Math.round(chargeAmount * 0.005 * 100),
        transfer_data: { destination: company.stripe_account_id },
      },
    };

    const idempotencyKey = makeIdempotencyKey([
      'invoice-checkout',
      invoice.id,
      Math.round(chargeAmount * 100),
    ]);
    const session = await stripe.checkout.sessions.create(sessionConfig, { idempotencyKey });

    await Promise.all([
      pool.query(
        `UPDATE invoices
         SET data = COALESCE(data, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [JSON.stringify({ stripe_payment_link: session.url, stripe_session_id: session.id }), invoice.id, invoice.company_id]
      ),
      pool.query(
        `UPDATE generic_entities
         SET data = data || $1::jsonb, updated_date = NOW()
         WHERE entity_type = 'Invoice' AND id = $2 AND company_id = $3`,
        [JSON.stringify({ stripe_payment_link: session.url, stripe_session_id: session.id }), invoice.id, invoice.company_id]
      ),
    ]);

    return {
      success: true,
      checkout_url: session.url,
      payment_url: session.url,
      session_id: session.id,
      amount_due: chargeAmount,
    };
  }

  async function getCompanyByUser(userEmail) {
    const staffRes = await pool.query(
      `SELECT company_id FROM staff_profiles WHERE user_email = $1 LIMIT 1`,
      [userEmail]
    );
    if (staffRes.rows.length > 0) return staffRes.rows[0].company_id;

    const compRes = await pool.query(
      `SELECT id FROM companies WHERE created_by = $1 LIMIT 1`,
      [userEmail]
    );
    return compRes.rows[0]?.id || null;
  }

  async function getCompanyById(companyId) {
    const res = await pool.query(`SELECT * FROM companies WHERE id = $1`, [companyId]);
    return res.rows[0] || null;
  }

  async function updateCompany(companyId, fields) {
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await pool.query(`UPDATE companies SET ${sets} WHERE id = $1`, [companyId, ...values]);
  }

  async function notifyAdmins(companyId, title, message, type) {
    try {
      const { randomUUID } = await import('crypto');
      const staffRes = await pool.query(
        `SELECT user_email FROM staff_profiles WHERE company_id = $1 AND is_active = true AND is_administrator = true`,
        [companyId]
      );
      for (const admin of staffRes.rows) {
        const nId = randomUUID();
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3::jsonb, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [nId, companyId, JSON.stringify({ id: nId, company_id: companyId, user_email: admin.user_email, title, message, type, link_url: '/payments', is_read: false })]
        );
      }
    } catch (err) {
      console.warn('[Stripe] Notify error:', err.message);
    }
  }

  return {
    async createCheckoutSession(params, userEmail, req) {
      const stripe = await getStripeClient();
      const { priceId, mode = 'subscription', companyId, planName, metadata = {} } = params;

      if (!priceId) throw new Error('priceId is required');

      let customerId = null;
      if (companyId) {
        const company = await getCompanyById(companyId);
        if (company?.stripe_customer_id) customerId = company.stripe_customer_id;
      }

      const host = resolveAppUrl(req);

      const sessionConfig = {
        mode: mode === 'subscription' ? 'subscription' : 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${host}/SubscriptionSuccess`,
        cancel_url: `${host}/SubscriptionCancel`,
        customer_email: userEmail,
        metadata: {
          user_email: userEmail,
          company_id: companyId || '',
          plan_name: planName || '',
          ...metadata
        }
      };

      if (customerId) sessionConfig.customer = customerId;

      if (mode === 'subscription') {
        const extendTrial = metadata.extend_trial === '7';
        sessionConfig.subscription_data = {
          trial_period_days: extendTrial ? 21 : 14,
          metadata: {
            company_id: companyId || '',
            plan_name: planName || '',
            bonus_days_applied: extendTrial ? '7' : '0'
          }
        };
      }

      const idempotencyKey = makeIdempotencyKey(['checkout', userEmail, companyId || '', priceId, mode]);
      const session = await stripe.checkout.sessions.create(sessionConfig, { idempotencyKey });
      console.log(`[Stripe] Checkout session created: ${session.id}`);
      return { success: true, id: session.id, url: session.url };
    },

    async cancelSubscription(params, userEmail) {
      const stripe = await getStripeClient();
      const { companyId, stripeSubscriptionId } = params;

      if (!companyId || !stripeSubscriptionId) throw new Error('Missing required fields');

      const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: true
      });

      await updateCompany(companyId, { subscription_status: 'cancelled' });
      console.log(`[Stripe] Subscription cancelled for company ${companyId}`);

      return {
        success: true,
        cancel_at: subscription.cancel_at,
        message: 'Subscription will be cancelled at the end of the billing period'
      };
    },

    async purchaseCredits(params, userEmail, req) {
      const stripe = await getStripeClient();
      const { type, credits, amount } = params;

      if (!type || !credits || !amount) throw new Error('Missing required fields');

      const companyId = await getCompanyByUser(userEmail);
      if (!companyId) throw new Error('Company not found');

      const host = resolveAppUrl(req);

      const creditsIdempotencyKey = makeIdempotencyKey(['credits', userEmail, companyId, type, credits, amount]);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${credits} AI Credits`,
              description: `Add ${credits} credits for ${type.replace('_', ' ').toUpperCase()}`,
            },
            unit_amount: amount * 100,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${host}/AIEstimator?success=true`,
        cancel_url: `${host}/AIEstimator?canceled=true`,
        metadata: {
          company_id: companyId,
          purchase_type: 'credits',
          credit_type: type,
          credits: String(credits),
          user_email: userEmail
        },
        customer_email: userEmail,
      }, { idempotencyKey: creditsIdempotencyKey });

      console.log(`[Stripe] Credit purchase session created: ${session.id}`);
      return { success: true, url: session.url };
    },

    // Subscription-Usage page credit / bundle purchases. Unlike the legacy
    // purchaseCredits above, the price and the number of credits are resolved
    // SERVER-SIDE from src/config/creditPackages.js — the browser only sends an
    // index, so it can never dictate the amount charged or the credits granted.
    // The webhook (dev: handleStripeEvent; prod: prod-server.cjs) reads the
    // grant amounts back from signed metadata and increments the real columns.
    async purchaseUsageCredits(params, userEmail, req) {
      const stripe = await getStripeClient();
      const { kind, creditType, packageIndex } = params || {};

      const companyId = await getCompanyByUser(userEmail);
      if (!companyId) throw new Error('Company not found');

      const idx = Number(packageIndex);
      if (!Number.isInteger(idx) || idx < 0) throw new Error('Invalid package selection');

      let priceDollars, productName, packageLabel;
      let addAi = 0, addSms = 0, addCall = 0;

      if (kind === 'bundle') {
        const bundle = BUNDLE_PACKAGES[idx];
        if (!bundle) throw new Error('Invalid bundle selection');
        priceDollars = bundle.price;
        addAi = bundle.ai;
        addSms = bundle.sms;
        addCall = bundle.call;
        packageLabel = bundle.name;
        productName = `${bundle.name} — ${bundle.ai.toLocaleString()} AI credits, ${bundle.sms.toLocaleString()} SMS, ${bundle.call} call minutes`;
      } else {
        const list = CREDIT_PACKAGES[creditType];
        if (!list) throw new Error('Invalid credit type');
        const pkg = list[idx];
        if (!pkg) throw new Error('Invalid package selection');
        priceDollars = pkg.price;
        packageLabel = pkg.label;
        productName = pkg.label;
        if (creditType === 'ai_interaction') addAi = pkg.amount;
        else if (creditType === 'sms') addSms = pkg.amount;
        else if (creditType === 'call_minute') addCall = pkg.amount;
        else throw new Error('Invalid credit type');
      }

      const unitAmount = Math.round(priceDollars * 100);
      if (!Number.isInteger(unitAmount) || unitAmount < 50) throw new Error('Invalid package price');

      const host = resolveAppUrl(req);

      const idempotencyKey = makeIdempotencyKey(['usage_credits', userEmail, companyId, kind || '', creditType || '', String(idx)]);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: productName },
            unit_amount: unitAmount,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${host}/SubscriptionUsage?success=true`,
        cancel_url: `${host}/SubscriptionUsage?canceled=true`,
        metadata: {
          company_id: companyId,
          purchase_type: 'usage_credits',
          add_ai: String(addAi),
          add_sms: String(addSms),
          add_call: String(addCall),
          package_label: packageLabel,
          user_email: userEmail,
        },
        customer_email: userEmail,
      }, { idempotencyKey });

      console.log(`[Stripe] Usage-credit purchase session created: ${session.id} (company ${companyId}, +${addAi}ai/+${addSms}sms/+${addCall}call)`);
      return { success: true, url: session.url };
    },

    async createConnectedAccount(params, userEmail, req) {
      const stripe = await getStripeClient();
      const companyId = await getCompanyByUser(userEmail);
      if (!companyId) throw new Error('Company not found');

      const company = await getCompanyById(companyId);
      if (!company) throw new Error('Company not found');

      const appUrl = resolveAppUrl(req);
      const returnPath = params?.return_to === '/QuickSetup' ? '/QuickSetup' : '/settings';

      if (company.stripe_account_id) {
        const accountLink = await stripe.accountLinks.create({
          account: company.stripe_account_id,
          refresh_url: `${appUrl}${returnPath}?stripe_refresh=true`,
          return_url: `${appUrl}${returnPath}?stripe_connected=true`,
          type: 'account_onboarding',
        });
        return { success: true, account_id: company.stripe_account_id, onboarding_url: accountLink.url };
      }

      const account = await stripe.accounts.create({
        type: 'standard',
        email: userEmail,
        business_type: 'company',
        metadata: { company_id: companyId, user_email: userEmail }
      });

      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${appUrl}${returnPath}?stripe_refresh=true`,
        return_url: `${appUrl}${returnPath}?stripe_connected=true`,
        type: 'account_onboarding',
      });

      await updateCompany(companyId, {
        stripe_account_id: account.id,
        stripe_onboarding_status: 'pending'
      });

      console.log(`[Stripe] Connected account created: ${account.id}`);
      return { success: true, account_id: account.id, onboarding_url: accountLink.url };
    },

    async checkStripeAccountStatus(params, userEmail) {
      const stripe = await getStripeClient();
      const companyId = await getCompanyByUser(userEmail);
      if (!companyId) return { connected: false, onboarding_complete: false };

      const company = await getCompanyById(companyId);
      if (!company?.stripe_account_id) return { connected: false, onboarding_complete: false };

      const account = await stripe.accounts.retrieve(company.stripe_account_id);
      const onboardingComplete = account.charges_enabled && account.payouts_enabled;

      await updateCompany(companyId, {
        stripe_onboarding_status: onboardingComplete ? 'complete' : 'pending'
      });

      return {
        connected: true,
        onboarding_complete: onboardingComplete,
        charges_enabled: account.charges_enabled,
        payouts_enabled: account.payouts_enabled,
        account_id: account.id,
        details_submitted: account.details_submitted,
        requirements: account.requirements
      };
    },

    async createPaymentLinkForInvoice(params, userEmail, req) {
      const stripe = await getStripeClient();
      const { invoice_id, custom_amount } = params;
      if (!invoice_id) throw new Error('invoice_id required');

      // Invoices live in the dedicated `invoices` table; fall back to generic_entities for legacy data
      let invoice = null;
      const dedRes = await pool.query(
        `SELECT id, company_id, customer_name, customer_email, invoice_number,
                status, total_amount, amount_paid, due_date, notes, items, data
         FROM invoices WHERE id = $1 LIMIT 1`,
        [invoice_id]
      );
      if (dedRes.rows[0]) {
        const row = dedRes.rows[0];
        const jsonb = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {});
        invoice = { ...jsonb, ...row };
      } else {
        const genRes = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'Invoice' AND id = $1`,
          [invoice_id]
        );
        if (!genRes.rows[0]) throw new Error('Invoice not found');
        invoice = typeof genRes.rows[0].data === 'string' ? JSON.parse(genRes.rows[0].data) : genRes.rows[0].data;
      }

      const companyId = invoice.company_id;
      const company = companyId ? await getCompanyById(companyId) : null;

      const appUrl = resolveAppUrl(req);

      const companyName = company?.company_name || company?.name || '';
      const safeDesc = (companyName || 'Invoice Payment')
        .replace(/[<>"'\\]/g, '')
        .substring(0, 22)
        .trim();

      const chargeAmount = (custom_amount && custom_amount > 0)
        ? custom_amount
        : (invoice.amount || 0);

      const sessionConfig = {
        payment_method_types: ['card', 'us_bank_account'],
        payment_method_options: {
          us_bank_account: {
            financial_connections: { permissions: ['payment_method'] },
          },
        },
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: companyName
                ? `${companyName} — Invoice #${invoice.invoice_number}`
                : `Invoice #${invoice.invoice_number}`,
              description: invoice.customer_name ? `Payment for ${invoice.customer_name}` : 'Invoice payment',
            },
            unit_amount: Math.round(chargeAmount * 100),
          },
          quantity: 1,
        }],
        success_url: `${appUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoice_id}`,
        cancel_url: `${appUrl}/payment-cancel?invoice_id=${invoice_id}`,
        metadata: {
          invoice_id: invoice.id || invoice_id,
          invoice_number: invoice.invoice_number || '',
          company_id: companyId || 'unknown'
        },
        payment_intent_data: {
          statement_descriptor: safeDesc,
        },
      };

      if (company?.stripe_account_id) {
        const platformFeeAmount = Math.round(chargeAmount * 0.005 * 100);
        sessionConfig.payment_intent_data = {
          ...sessionConfig.payment_intent_data,
          // on_behalf_of makes Stripe show the connected company's name/logo on
          // the checkout page instead of "CompanySync". Must be nested inside
          // payment_intent_data — Stripe rejects it as a top-level Checkout
          // Session param ("Received unknown parameter: on_behalf_of").
          on_behalf_of: company.stripe_account_id,
          application_fee_amount: platformFeeAmount,
          transfer_data: { destination: company.stripe_account_id },
        };
      }

      const invoiceIdempotencyKey = makeIdempotencyKey(['invoice-payment-link', invoice_id, custom_amount || '']);
      const session = await stripe.checkout.sessions.create(sessionConfig, { idempotencyKey: invoiceIdempotencyKey });

      await pool.query(
        `UPDATE generic_entities SET data = data || $1::jsonb, updated_date = NOW() WHERE entity_type = 'Invoice' AND id = $2`,
        [JSON.stringify({ stripe_payment_link: session.url, stripe_session_id: session.id }), invoice_id]
      );

      console.log(`[Stripe] Payment link created for invoice: ${invoice.invoice_number}`);
      return { success: true, payment_url: session.url, session_id: session.id };
    },

    async createInvoiceCheckout(params, userEmail, req) {
      const invoiceId = params?.invoice_id;
      if (!invoiceId) throw new Error('invoice_id required');
      const invoice = await loadInvoice(invoiceId);
      if (!invoice) throw new Error('Invoice not found');
      if (!(await canAuthenticatedUserPay(invoice, userEmail))) {
        throw new Error('You do not have access to this invoice');
      }
      return createInvoiceSession(invoice, req);
    },

    async createPublicInvoiceCheckout(params, req) {
      const invoiceId = params?.invoice_id;
      const portalToken = params?.token;
      if (!invoiceId || !portalToken) throw new Error('token and invoice_id required');

      const customerResult = await pool.query(
        `SELECT id, company_id, name, email FROM customers WHERE portal_token = $1 LIMIT 1`,
        [portalToken]
      );
      const customer = customerResult.rows[0];
      if (!customer) throw new Error('Invalid or expired portal link');

      const invoice = await loadInvoice(invoiceId);
      const belongsToCustomer = invoice &&
        invoice.company_id === customer.company_id &&
        (
          (invoice.customer_id && invoice.customer_id === customer.id) ||
          (invoice.customer_email && customer.email &&
            invoice.customer_email.toLowerCase() === customer.email.toLowerCase()) ||
          (!invoice.customer_id && !invoice.customer_email &&
            invoice.customer_name && customer.name &&
            invoice.customer_name.toLowerCase() === customer.name.toLowerCase())
        );
      if (!belongsToCustomer) throw new Error('Invoice not found');

      return createInvoiceSession(invoice, req);
    },

    async getInvoicePaymentOptions(params, userEmail) {
      const invoice = await loadInvoice(params?.invoice_id);
      if (!invoice) throw new Error('Invoice not found');
      if (!(await canAuthenticatedUserPay(invoice, userEmail))) {
        throw new Error('You do not have access to this invoice');
      }
      return {
        success: true,
        amount_due: invoiceBalance(invoice),
        payment_options: await loadPaymentOptions(invoice.company_id),
      };
    },

    async getStripePublishableKey() {
      const key = await getStripePublishableKey();
      return { publishableKey: key };
    }
  };
}

async function handleWebhook(req, res, pool) {
  return new Promise((resolve, reject) => {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(body);
        const signature = req.headers['stripe-signature'];

        if (!signature) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing stripe-signature' }));
          return resolve();
        }

        if (stripeSync) {
          await stripeSync.processWebhook(rawBody, signature);
          console.log('[Stripe] Webhook processed via stripe-replit-sync');
        }

        const stripe = await getStripeClient();
        // SECURITY: never fall back to trusting an unverified/unsigned payload.
        // Stripe's webhookEndpoints.list() API does not return the signing
        // secret, so that lookup always misses — look up the real secret the
        // same way stripe-replit-sync does (DB-backed managed webhook row)
        // and verify against it. If verification fails for any reason, skip
        // custom event handling entirely rather than trusting raw JSON.
        let event = null;
        try {
          let webhookSecret = null;
          if (stripeSync) {
            const accountId = await stripeSync.getAccountId();
            const secretRes = await pool.query(
              `SELECT secret FROM "stripe"."_managed_webhooks" WHERE account_id = $1 LIMIT 1`,
              [accountId]
            );
            webhookSecret = secretRes.rows[0]?.secret || null;
          }
          if (webhookSecret) {
            event = stripe.webhooks.constructEvent(rawBody.toString(), signature, webhookSecret);
          } else {
            console.error('[Stripe] No webhook secret available — skipping custom event handling (unsigned fallback disabled)');
          }
        } catch (e) {
          console.error('[Stripe] Webhook signature verification failed — skipping custom event handling:', e.message);
        }

        if (event) {
          await handleStripeEvent(event, stripe, pool);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
        resolve();
      } catch (err) {
        console.error('[Stripe] Webhook error:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Webhook processing error' }));
        resolve();
      }
    });
    req.on('error', reject);
  });
}

// Idempotently record a paid credit grant and apply the increment in the SAME
// transaction. Returns true when THIS call actually performed the grant, and
// false when the Stripe session was already processed (a webhook retry — Stripe
// delivers at-least-once). The UNIQUE constraint on credit_grants.session_id is
// what makes concurrent/duplicate deliveries safe: only one INSERT can win, and
// wrapping the INSERT + UPDATE together means a crash mid-way rolls back the
// ledger row so a retry can re-grant. Keep in lockstep with prod-server.cjs.
async function grantCreditsOnce(pool, sessionId, companyId, purchaseType, granted, applyFn) {
  const { randomUUID } = require('crypto');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO credit_grants (id, session_id, company_id, purchase_type, granted)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (session_id) DO NOTHING
       RETURNING id`,
      [randomUUID(), sessionId, companyId || null, purchaseType || null, JSON.stringify(granted || {})]
    );
    if (ins.rows.length === 0) {
      await client.query('COMMIT');
      return false;
    }
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

async function handleStripeEvent(event, stripe, pool) {
  console.log(`[Stripe] Event: ${event.type}`);

  async function updateCompany(companyId, fields) {
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await pool.query(`UPDATE companies SET ${sets} WHERE id = $1`, [companyId, ...values]);
  }

  async function notifyAdmins(companyId, title, message, type, emailBody = null, dedupeKey = null) {
    try {
      const { randomUUID, createHash } = await import('crypto');
      const staffRes = await pool.query(
        `SELECT COALESCE(NULLIF(user_email, ''), email) AS user_email
         FROM staff_profiles
         WHERE company_id = $1 AND COALESCE(is_active, true) = true AND is_administrator = true
           AND COALESCE(NULLIF(user_email, ''), email) IS NOT NULL`,
        [companyId]
      );
      for (const admin of staffRes.rows) {
        const nId = dedupeKey
          ? `stripe_${type}_${createHash('sha256').update(`${dedupeKey}:${admin.user_email}`).digest('hex').slice(0, 32)}`
          : randomUUID();
        const inserted = await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3::jsonb, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [nId, companyId, JSON.stringify({ id: nId, company_id: companyId, user_email: admin.user_email, title, message, type, link_url: '/payments', is_read: false })]
        );
        if (inserted.rowCount > 0 && admin.user_email && emailBody) {
          await sendEmail(admin.user_email, title, emailBody);
        }
      }
    } catch (err) {
      console.warn('[Stripe] Notify error:', err.message);
    }
  }

  async function sendEmail(to, subject, body) {
    try {
      if (require('./lib/emailTransport.cjs').activeProvider() === 'none') return;
      await require('./lib/emailTransport.cjs').sendPlatformEmail({ from: process.env.EMAIL_FROM || 'CompanySync <noreply@companysync.io>', to, subject, text: body });
    } catch (err) {
      console.warn('[Stripe] Email error:', err.message);
    }
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const companyId = session.metadata?.company_id;
      const purchaseType = session.metadata?.purchase_type;

      if (companyId && purchaseType === 'credits') {
        // Legacy AIEstimator credit purchase (extra_lexi/marcus/ai credits).
        // Only grant on a genuinely paid session, and only once per session.
        if (session.payment_status && session.payment_status !== 'paid') {
          console.log(`[Stripe] credits session ${session.id} not paid (${session.payment_status}); skipping`);
          break;
        }
        const creditType = session.metadata.credit_type || 'ai_estimator';
        const credits = Math.max(0, parseInt(session.metadata.credits || '0', 10) || 0);
        const fieldMap = { lexi: 'extra_lexi_credits', marcus: 'extra_marcus_credits' };
        const fieldName = fieldMap[creditType] || 'extra_ai_credits';
        if (credits > 0) {
          const didGrant = await grantCreditsOnce(pool, session.id, companyId, 'credits', { field: fieldName, credits }, async (client) => {
            await client.query(
              `UPDATE companies SET ${fieldName} = COALESCE(${fieldName}, 0) + $2 WHERE id = $1`,
              [companyId, credits]
            );
          });
          if (didGrant) {
            await notifyAdmins(companyId, 'Credits Added', `Successfully added ${credits} credits.`, 'payment_received');
          } else {
            console.log(`[Stripe] Duplicate webhook for credits session ${session.id}; grant skipped`);
          }
        }
      } else if (companyId && purchaseType === 'usage_credits') {
        // Subscription-Usage page credit / bundle purchase. Grant amounts come
        // from server-set, signature-verified metadata — never from the client.
        if (session.payment_status && session.payment_status !== 'paid') {
          console.log(`[Stripe] usage_credits session ${session.id} not paid (${session.payment_status}); skipping`);
          break;
        }
        const addAi = Math.max(0, parseInt(session.metadata.add_ai || '0', 10) || 0);
        const addSms = Math.max(0, parseInt(session.metadata.add_sms || '0', 10) || 0);
        const addCall = Math.max(0, parseInt(session.metadata.add_call || '0', 10) || 0);
        const label = session.metadata.package_label || 'Credits';
        if (addAi + addSms + addCall > 0) {
          const didGrant = await grantCreditsOnce(pool, session.id, companyId, 'usage_credits', { add_ai: addAi, add_sms: addSms, add_call: addCall, label }, async (client) => {
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
            await notifyAdmins(companyId, 'Credits Added', `${label}: added ${addAi.toLocaleString()} AI credits, ${addSms.toLocaleString()} SMS, and ${addCall} call minutes.`, 'payment_received');
          } else {
            console.log(`[Stripe] Duplicate webhook for usage_credits session ${session.id}; grant skipped`);
          }
        }
      } else if (session.metadata?.invoice_id) {
        // HANDLE CUSTOMER INVOICE PAYMENT
        const invoiceId = session.metadata.invoice_id;
        const paymentAmount = (session.amount_total || 0) / 100;
        const isAchPending = session.payment_status === 'unpaid';
        console.log(`[Stripe] Invoice payment: $${paymentAmount} for invoice ${session.metadata.invoice_number || invoiceId}${isAchPending ? ' (ACH pending)' : ''}`);
        try {
          const invRes = await pool.query(`SELECT * FROM invoices WHERE id = $1 LIMIT 1`, [invoiceId]);
          if (invRes.rows[0]) {
            const inv = invRes.rows[0];
            const { randomUUID } = require('crypto');
            const paymentId = randomUUID();

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
                   SELECT $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, NOW(), NOW()
                   WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number = $9)`,
                  [paymentId, inv.company_id, invoiceId, inv.invoice_number, paymentNumber, inv.customer_name,
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
                let companyName = 'Your contractor';
                try {
                  const coRes = await pool.query(`SELECT name FROM companies WHERE id = $1 LIMIT 1`, [inv.company_id]);
                  if (coRes.rows[0]?.name) companyName = coRes.rows[0].name;
                } catch (_) {}
                await sendEmail(customerEmail,
                  `🏦 Bank Transfer Initiated – Invoice ${inv.invoice_number || ''}`,
                  `Hi ${inv.customer_name || 'there'},\n\nWe've received your bank transfer request for $${paymentAmount.toFixed(2)} toward invoice ${inv.invoice_number || ''}. Bank transfers typically take 3–5 business days to process.\n\nYou'll receive a confirmation email once the payment fully clears.\n\nThank you for your business,\n${companyName}`
                );
              }
              console.log(`[Stripe] Invoice ${inv.invoice_number} — ACH ${pendingRecorded ? 'pending' : 'duplicate pending event'} $${paymentAmount}`);
            } else {
              // Card or instant payment — record and close immediately
              const cardRef = session.payment_intent || session.id;
              const cardClient = await pool.connect();
              let paymentRecorded = false;
              let newAmountPaid = 0;
              const totalAmount = parseFloat(inv.total_amount || 0);
              let newStatus = 'partially_paid';
              try {
                await cardClient.query('BEGIN');
                await cardClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [cardRef]);
                await cardClient.query('SELECT id FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
                  const paymentNumber = await allocatePaymentNumber(cardClient, inv.company_id);
                const paymentInsert = await cardClient.query(
                    `INSERT INTO payments (id, company_id, invoice_id, invoice_number, payment_number, customer_name, amount, payment_method, payment_date, reference_number, notes, status, created_at, updated_at)
                     SELECT $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11, NOW(), NOW()
                     WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number = $9)`,
                    [paymentId, inv.company_id, invoiceId, inv.invoice_number, paymentNumber, inv.customer_name,
                     paymentAmount, 'stripe', cardRef,
                   'Paid via Stripe Checkout', 'completed']
                );
                paymentRecorded = paymentInsert.rowCount > 0;
                const cardSum = await cardClient.query(
                  `SELECT COALESCE(SUM(amount), 0) AS total
                   FROM payments
                   WHERE invoice_id = $1
                     AND status NOT IN ('failed', 'refunded', 'ach_pending', 'void', 'cancelled')`,
                  [invoiceId]
                );
                newAmountPaid = parseFloat(cardSum.rows[0].total || 0);
                newStatus = newAmountPaid >= totalAmount ? 'paid' : 'partially_paid';
                await cardClient.query(
                  `UPDATE invoices SET amount_paid = $1, status = $2, updated_at = NOW() WHERE id = $3`,
                  [newAmountPaid, newStatus, invoiceId]
                );
                await cardClient.query('COMMIT');
              } catch (cardErr) {
                await cardClient.query('ROLLBACK').catch(() => {});
                throw cardErr;
              } finally {
                cardClient.release();
              }
              const paymentExistsForInvoice = paymentRecorded || (await pool.query(
                `SELECT 1 FROM payments WHERE reference_number = $1 AND invoice_id = $2 AND status = 'completed' LIMIT 1`,
                [cardRef, invoiceId]
              )).rowCount > 0;
              if (paymentExistsForInvoice) {
                // CompanySync Bot chat alert — only on a real transition into 'paid'
                if (inv.company_id && newStatus === 'paid' && String(inv.status || '').toLowerCase() !== 'paid') {
                  chatBot.notifyInvoicePaid(pool, inv.company_id, inv)
                    .catch(e => console.warn('[ChatBot] invoice-paid alert failed:', e.message));
                }
                const remaining = Math.max(0, totalAmount - newAmountPaid);
                const adminEmailBody = `A payment has been recorded.\n\nCustomer: ${inv.customer_name || 'Unknown'}\nInvoice: ${inv.invoice_number || ''}\nAmount Paid: $${paymentAmount.toFixed(2)}\nStatus: ${newStatus === 'paid' ? 'Fully Paid' : `Partially Paid (remaining: $${remaining.toFixed(2)})`}`;
                await notifyAdmins(inv.company_id, '💰 Invoice Payment Received',
                  `${inv.customer_name || 'Customer'} paid $${paymentAmount.toFixed(2)} for invoice ${inv.invoice_number || ''}`,
                  'payment_received', adminEmailBody, cardRef);
                const customerEmail = session.customer_email || inv.customer_email;
                if (customerEmail) {
                  let companyName = 'Your contractor';
                  try {
                    const coRes = await pool.query(`SELECT name FROM companies WHERE id = $1 LIMIT 1`, [inv.company_id]);
                    if (coRes.rows[0]?.name) companyName = coRes.rows[0].name;
                  } catch (_) {}
                  await sendEmail(customerEmail,
                    `✅ Payment Received – Invoice ${inv.invoice_number || ''}`,
                    `Hi ${inv.customer_name || 'there'},\n\nWe've received your payment of $${paymentAmount.toFixed(2)} for invoice ${inv.invoice_number || ''}. Thank you!\n\n${newStatus === 'paid' ? 'Your invoice is now fully paid.' : `Remaining balance: $${Math.max(0, totalAmount - newAmountPaid).toFixed(2)}`}\n\nThank you for your business,\n${companyName}`
                  );
                }
              } else {
                console.log(`[Stripe] Duplicate invoice payment ${cardRef}; company notification skipped`);
              }
              console.log(`[Stripe] Invoice ${inv.invoice_number} updated: $${newAmountPaid} paid, status: ${newStatus}`);
            }
          } else {
            console.error(`[Stripe] Invoice not found for payment: ${invoiceId}`);
          }
        } catch (err) {
          console.error(`[Stripe] Error recording invoice payment:`, err.message);
        }
      } else if (companyId) {
        const planName = session.metadata?.plan_name;
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 14);
        await updateCompany(companyId, {
          subscription_plan: planName?.toLowerCase() || 'professional',
          subscription_status: 'trial',
          trial_end_date: trialEndsAt.toISOString(),
          stripe_subscription_id: session.subscription || ''
        });
        await notifyAdmins(companyId, 'Subscription Started!', `Your ${planName || 'Professional'} plan trial has begun. You have 14 days to explore all features.`, 'subscription_created');
      }
      break;
    }

    case 'checkout.session.async_payment_succeeded': {
      // ACH bank transfer cleared — upgrade pending payment to completed
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
            console.log(`[Stripe] Duplicate or unknown ACH clearing event ${piRef}; company notification skipped`);
            break;
          }
          const invRes = await pool.query(`SELECT * FROM invoices WHERE id=$1 LIMIT 1`, [invoiceId]);
          if (invRes.rows[0]) {
            const inv = invRes.rows[0];
            const achSum = await pool.query(
              `SELECT COALESCE(SUM(amount), 0) AS total
               FROM payments
               WHERE invoice_id = $1
                 AND status NOT IN ('failed', 'refunded', 'ach_pending', 'void', 'cancelled')`,
              [invoiceId]
            );
            const newAmountPaid = parseFloat(achSum.rows[0].total || 0);
            const totalAmount = parseFloat(inv.total_amount || 0);
            const newStatus = newAmountPaid >= totalAmount ? 'paid' : 'partially_paid';
            await pool.query(`UPDATE invoices SET amount_paid=$1, status=$2, updated_at=NOW() WHERE id=$3`, [newAmountPaid, newStatus, invoiceId]);
            // CompanySync Bot chat alert — only on a real transition into 'paid'
            if (inv.company_id && newStatus === 'paid' && String(inv.status || '').toLowerCase() !== 'paid') {
              chatBot.notifyInvoicePaid(pool, inv.company_id, inv)
                .catch(e => console.warn('[ChatBot] invoice-paid alert failed:', e.message));
            }
            if (achPaymentRecorded && inv.company_id) {
              const remaining = Math.max(0, totalAmount - newAmountPaid);
              const adminEmailBody = `ACH bank transfer cleared.\n\nCustomer: ${inv.customer_name || 'Unknown'}\nInvoice: ${inv.invoice_number || ''}\nAmount: $${paymentAmount.toFixed(2)}\nStatus: ${newStatus === 'paid' ? 'Fully Paid' : `Partially Paid (remaining: $${remaining.toFixed(2)})`}`;
              await notifyAdmins(inv.company_id, '✅ ACH Payment Cleared',
                `${inv.customer_name || 'Customer'} — ACH payment of $${paymentAmount.toFixed(2)} cleared for invoice ${inv.invoice_number || ''}`,
                'payment_received', adminEmailBody, piRef);
            }
            const customerEmail = session.customer_email || inv.customer_email;
            if (achJustCleared && customerEmail) {
              let companyName = 'Your contractor';
              try {
                const coRes = await pool.query(`SELECT name FROM companies WHERE id=$1 LIMIT 1`, [inv.company_id]);
                if (coRes.rows[0]?.name) companyName = coRes.rows[0].name;
              } catch (_) {}
              await sendEmail(customerEmail,
                `✅ Bank Transfer Confirmed – Invoice ${inv.invoice_number || ''}`,
                `Hi ${inv.customer_name || 'there'},\n\nGreat news! Your bank transfer of $${paymentAmount.toFixed(2)} for invoice ${inv.invoice_number || ''} has fully cleared.\n\n${newStatus === 'paid' ? 'Your invoice is now fully paid.' : `Remaining balance: $${Math.max(0, totalAmount - newAmountPaid).toFixed(2)}`}\n\nThank you for your business,\n${companyName}`
              );
            }
            console.log(`[Stripe] ACH cleared for invoice ${inv.invoice_number}`);
          }
        } catch (err) {
          console.error(`[Stripe] ACH async payment error:`, err.message);
        }
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const companyId = subscription.metadata?.company_id;
      if (companyId) {
        const statusMap = { trialing: 'trial', active: 'active', past_due: 'past_due', canceled: 'cancelled' };
        const updateData = {
          stripe_subscription_id: subscription.id,
          subscription_status: statusMap[subscription.status] || 'trial'
        };
        if (subscription.status === 'active' && subscription.metadata?.plan_name) {
          updateData.subscription_plan = subscription.metadata.plan_name.toLowerCase();
        }
        await updateCompany(companyId, updateData);
        console.log(`[Stripe] Updated subscription for company ${companyId}`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const companyId = subscription.metadata?.company_id;
      if (companyId) {
        await updateCompany(companyId, { subscription_status: 'cancelled', subscription_plan: 'trial' });
        console.log(`[Stripe] Cancelled subscription for company ${companyId}`);
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const amountPaid = ((invoice.amount_paid || 0) / 100).toFixed(2);
      let companyId = invoice.metadata?.company_id;

      if (!companyId && invoice.subscription) {
        try {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          companyId = sub.metadata?.company_id;
        } catch (e) { /* ignore */ }
      }

      if (companyId) {
        await notifyAdmins(companyId, 'Payment Received', `Payment of $${amountPaid} has been successfully processed.`, 'payment_received');

        const staffRes = await pool.query(
          `SELECT user_email FROM staff_profiles WHERE company_id = $1 AND is_active = true AND is_administrator = true`,
          [companyId]
        );
        for (const admin of staffRes.rows) {
          await sendEmail(admin.user_email, 'Payment Confirmation - Invoice Paid',
            `Payment of $${amountPaid} has been received.\nInvoice: ${invoice.number || invoice.id}\nDate: ${new Date((invoice.created || 0) * 1000).toLocaleDateString()}`
          );
        }
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      let companyId = invoice.metadata?.company_id;

      if (!companyId && invoice.subscription) {
        try {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          companyId = sub.metadata?.company_id;
        } catch (e) { /* ignore */ }
      }

      if (companyId) {
        await updateCompany(companyId, { subscription_status: 'past_due' });
        const amount = ((invoice.amount_due || 0) / 100).toFixed(2);
        await notifyAdmins(companyId, 'Payment Failed', `Your payment of $${amount} could not be processed. Please update your payment method.`, 'payment_failed');
      }
      break;
    }

    case 'account.updated': {
      const account = event.data.object;
      const compRes = await pool.query(
        `SELECT id FROM companies WHERE stripe_account_id = $1`, [account.id]
      );
      if (compRes.rows[0]) {
        const onboardingComplete = account.charges_enabled && account.payouts_enabled;
        await pool.query(
          `UPDATE companies SET stripe_onboarding_status = $2 WHERE id = $1`,
          [compRes.rows[0].id, onboardingComplete ? 'complete' : 'pending']
        );
      }
      break;
    }
  }
}

export default function stripePlugin() {
  return {
    name: 'vite-stripe-plugin',
    configureServer(server) {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });

      initStripe(pool).catch(err => console.error('[Stripe] Startup error:', err.message));

      const handlers = createStripeHandlers(pool);

      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/stripe/webhook' && req.method === 'POST') {
          return handleWebhook(req, res, pool);
        }

        if (req.url?.startsWith('/api/public/portal/invoice-payment-status?') && req.method === 'GET') {
          try {
            const urlObj = new URL(req.url, 'http://localhost');
            const sessionId = urlObj.searchParams.get('session_id');
            const invoiceId = urlObj.searchParams.get('invoice_id');
            if (!sessionId || !invoiceId || !sessionId.startsWith('cs_')) {
              res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ status: 'error', error: 'Invalid payment reference' }));
              return;
            }
            const stripe = await getStripeClient();
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            if (session.metadata?.invoice_id !== invoiceId) {
              res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ status: 'error', error: 'Payment reference does not match invoice' }));
              return;
            }
            const invRes = await pool.query(`SELECT id, company_id FROM invoices WHERE id=$1 LIMIT 1`, [invoiceId]);
            const invoice = invRes.rows[0];
            if (!invoice || (session.metadata?.company_id && session.metadata.company_id !== invoice.company_id)) {
              res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ status: 'error', error: 'Invoice ownership check failed' }));
              return;
            }
            const paymentRef = typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id || session.id;
            let paymentRes = await pool.query(
              `SELECT status FROM payments WHERE invoice_id=$1 AND company_id=$2 AND reference_number=$3 ORDER BY updated_at DESC LIMIT 1`,
              [invoiceId, invoice.company_id, paymentRef]
            );
            // Stripe has already authenticated this Checkout Session and the
            // invoice ownership check above has passed. Recover a completed
            // card checkout when its webhook did not finish before the success
            // page polls; the normal handler is idempotent on paymentRef.
            if (!paymentRes.rows[0] && session.status === 'complete' && session.payment_status === 'paid') {
              await handleStripeEvent({ type: 'checkout.session.completed', data: { object: session } }, stripe, pool);
              paymentRes = await pool.query(
                `SELECT status FROM payments WHERE invoice_id=$1 AND company_id=$2 AND reference_number=$3 ORDER BY updated_at DESC LIMIT 1`,
                [invoiceId, invoice.company_id, paymentRef]
              );
            }
            const crmStatus = paymentRes.rows[0]?.status;
            const confirmed = crmStatus === 'completed';
            const achPending = crmStatus === 'ach_pending' ||
              (session.status === 'complete' && session.payment_status === 'unpaid');
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({
              status: confirmed ? 'confirmed' : achPending ? 'ach_pending' : 'processing',
              stripe_status: session.payment_status || null,
              recorded: Boolean(crmStatus),
            }));
          } catch (err) {
            console.warn('[Stripe] Payment status error:', err.message);
            res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ status: 'error', error: 'Unable to verify payment status' }));
          }
          return;
        }

        if (req.url === '/api/stripe/publishable-key' && req.method === 'GET') {
          try {
            const result = await handlers.getStripePublishableKey();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        if (req.url === '/api/stripe/overview' && req.method === 'GET') {
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
              summary: {
                totalRevenue,
                paidInvoicesTotal,
                activeSubscriptions,
                totalCustomers: custRes.rows.length,
                paidInvoices: invRes.rows.filter(i => i.status === 'paid').length,
              }
            }));
          } catch (err) {
            console.error('[Stripe Overview]', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message, subscriptions: [], invoices: [], customers: [], summary: { totalRevenue: 0, activeSubscriptions: 0, totalCustomers: 0, paidInvoices: 0 } }));
          }
          return;
        }

        next();
      });
    }
  };
}

export { createStripeHandlers, initStripe, getStripeClient, getStripePublishableKey };
