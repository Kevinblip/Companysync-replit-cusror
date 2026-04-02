import { createRequire } from 'module';
const require = createRequire(import.meta.url);

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

      const domains = process.env.REPLIT_DOMAINS;
      if (domains) {
        const webhookBaseUrl = `https://${domains.split(',')[0]}`;
        try {
          const result = await stripeSync.findOrCreateManagedWebhook(
            `${webhookBaseUrl}/api/stripe/webhook`
          );
          const webhookUrl = result?.webhook?.url || result?.url || webhookBaseUrl + '/api/stripe/webhook';
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
      const staffRes = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'StaffProfile' AND company_id = $1`,
        [companyId]
      );
      const admins = staffRes.rows
        .map(r => typeof r.data === 'string' ? JSON.parse(r.data) : r.data)
        .filter(d => d.is_administrator);

      for (const admin of admins) {
        await pool.query(
          `INSERT INTO generic_entities (entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, NOW(), NOW())`,
          ['Notification', companyId, JSON.stringify({
            company_id: companyId,
            user_email: admin.user_email,
            title, message, type, is_read: false
          })]
        );
      }
    } catch (err) {
      console.warn('[Stripe] Notify error:', err.message);
    }
  }

  return {
    async createCheckoutSession(params, userEmail) {
      const stripe = await getStripeClient();
      const { priceId, mode = 'subscription', companyId, planName, metadata = {} } = params;

      if (!priceId) throw new Error('priceId is required');

      let customerId = null;
      if (companyId) {
        const company = await getCompanyById(companyId);
        if (company?.stripe_customer_id) customerId = company.stripe_customer_id;
      }

      const domains = process.env.REPLIT_DOMAINS;
      const host = domains ? `https://${domains.split(',')[0]}` : 'http://localhost:5000';

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

      const session = await stripe.checkout.sessions.create(sessionConfig);
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

    async purchaseCredits(params, userEmail) {
      const stripe = await getStripeClient();
      const { type, credits, amount } = params;

      if (!type || !credits || !amount) throw new Error('Missing required fields');

      const companyId = await getCompanyByUser(userEmail);
      if (!companyId) throw new Error('Company not found');

      const domains = process.env.REPLIT_DOMAINS;
      const host = domains ? `https://${domains.split(',')[0]}` : 'http://localhost:5000';

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
      });

      console.log(`[Stripe] Credit purchase session created: ${session.id}`);
      return { success: true, url: session.url };
    },

    async createConnectedAccount(params, userEmail) {
      const stripe = await getStripeClient();
      const companyId = await getCompanyByUser(userEmail);
      if (!companyId) throw new Error('Company not found');

      const company = await getCompanyById(companyId);
      if (!company) throw new Error('Company not found');

      const domains = process.env.REPLIT_DOMAINS;
      const appUrl = domains ? `https://${domains.split(',')[0]}` : 'http://localhost:5000';

      if (company.stripe_account_id) {
        const accountLink = await stripe.accountLinks.create({
          account: company.stripe_account_id,
          refresh_url: `${appUrl}/settings?stripe_refresh=true`,
          return_url: `${appUrl}/settings?stripe_connected=true`,
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
        refresh_url: `${appUrl}/settings?stripe_refresh=true`,
        return_url: `${appUrl}/settings?stripe_connected=true`,
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

    async createPaymentLinkForInvoice(params, userEmail) {
      const stripe = await getStripeClient();
      const { invoice_id } = params;
      if (!invoice_id) throw new Error('invoice_id required');

      const invRes = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'Invoice' AND id = $1`,
        [invoice_id]
      );
      if (!invRes.rows[0]) throw new Error('Invoice not found');
      const invoice = typeof invRes.rows[0].data === 'string' ? JSON.parse(invRes.rows[0].data) : invRes.rows[0].data;

      const companyId = invoice.company_id;
      const company = companyId ? await getCompanyById(companyId) : null;

      const domains = process.env.REPLIT_DOMAINS;
      const appUrl = domains ? `https://${domains.split(',')[0]}` : 'http://localhost:5000';

      const sessionConfig = {
        payment_method_types: ['card', 'us_bank_account'],
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Invoice #${invoice.invoice_number}`,
              description: invoice.customer_name ? `Payment for ${invoice.customer_name}` : 'Invoice payment',
            },
            unit_amount: Math.round((invoice.amount || 0) * 100),
          },
          quantity: 1,
        }],
        success_url: `${appUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoice_id}`,
        cancel_url: `${appUrl}/payment-cancel?invoice_id=${invoice_id}`,
        metadata: {
          invoice_id: invoice.id || invoice_id,
          invoice_number: invoice.invoice_number || '',
          company_id: companyId || 'unknown'
        }
      };

      if (company?.stripe_account_id) {
        const platformFeeAmount = Math.round((invoice.amount || 0) * 0.005 * 100);
        sessionConfig.payment_intent_data = {
          application_fee_amount: platformFeeAmount,
          transfer_data: { destination: company.stripe_account_id },
        };
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);

      await pool.query(
        `UPDATE generic_entities SET data = data || $1::jsonb, updated_date = NOW() WHERE entity_type = 'Invoice' AND id = $2`,
        [JSON.stringify({ stripe_payment_link: session.url, stripe_session_id: session.id }), invoice_id]
      );

      console.log(`[Stripe] Payment link created for invoice: ${invoice.invoice_number}`);
      return { success: true, payment_url: session.url, session_id: session.id };
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
        let event;
        try {
          const webhooks = await stripe.webhookEndpoints.list({ limit: 1 });
          const secret = webhooks.data[0]?.secret;
          if (secret) {
            event = stripe.webhooks.constructEvent(rawBody.toString(), signature, secret);
          }
        } catch (e) {
          try {
            event = JSON.parse(rawBody.toString());
          } catch (parseErr) {
            console.warn('[Stripe] Could not parse webhook body');
          }
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

async function handleStripeEvent(event, stripe, pool) {
  console.log(`[Stripe] Event: ${event.type}`);

  async function updateCompany(companyId, fields) {
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await pool.query(`UPDATE companies SET ${sets} WHERE id = $1`, [companyId, ...values]);
  }

  async function notifyAdmins(companyId, title, message, type) {
    try {
      const staffRes = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'StaffProfile' AND company_id = $1`,
        [companyId]
      );
      const admins = staffRes.rows
        .map(r => typeof r.data === 'string' ? JSON.parse(r.data) : r.data)
        .filter(d => d.is_administrator);

      for (const admin of admins) {
        await pool.query(
          `INSERT INTO generic_entities (entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, NOW(), NOW())`,
          ['Notification', companyId, JSON.stringify({
            company_id: companyId, user_email: admin.user_email,
            title, message, type, is_read: false
          })]
        );
      }
    } catch (err) {
      console.warn('[Stripe] Notify error:', err.message);
    }
  }

  async function sendEmail(to, subject, body) {
    try {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) return;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'noreply@resend.dev', to, subject, text: body })
      });
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
        const creditType = session.metadata.credit_type || 'ai_estimator';
        const credits = parseInt(session.metadata.credits || '0');
        const company = await pool.query(`SELECT * FROM companies WHERE id = $1`, [companyId]);
        if (company.rows[0]) {
          const fieldMap = { lexi: 'extra_lexi_credits', marcus: 'extra_marcus_credits' };
          const fieldName = fieldMap[creditType] || 'extra_ai_credits';
          const currentCredits = company.rows[0][fieldName] || 0;
          await updateCompany(companyId, { [fieldName]: currentCredits + credits });
          await notifyAdmins(companyId, 'Credits Added', `Successfully added ${credits} credits.`, 'payment_received');
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
          `SELECT data FROM generic_entities WHERE entity_type = 'StaffProfile' AND company_id = $1`,
          [companyId]
        );
        const admins = staffRes.rows
          .map(r => typeof r.data === 'string' ? JSON.parse(r.data) : r.data)
          .filter(d => d.is_administrator);

        for (const admin of admins) {
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
