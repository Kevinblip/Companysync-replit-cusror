#!/usr/bin/env node
/**
 * Stripe Subscription Webhook → MRR Sync Regression Test
 * ────────────────────────────────────────────────────────
 * Verifies that customer.subscription.{updated,deleted} webhook events
 * correctly write stripe_subscription_amount and stripe_subscription_status
 * to the companies row (prod-server.cjs subscription sync block).
 *
 * Strategy:
 *   Spawn an isolated prod-server.cjs on PORT 5099 with a self-generated
 *   STRIPE_WEBHOOK_SECRET.  stripe.webhooks.constructEvent is a pure local
 *   HMAC check — no live Stripe API call — so fake-signed payloads work
 *   against the real production handler code.
 *
 * What it covers:
 *   1. subscription.updated — lookup by stripe_subscription_id (no metadata)
 *      → amount + status written
 *   2. subscription.updated — price change → amount updated
 *   3. subscription.updated — lookup by metadata.company_id
 *   4. subscription.deleted — status forced to 'canceled' regardless of sub.status
 *   5. Unknown company — server does not crash (200, graceful no-op)
 *
 * Prerequisites:
 *   - DATABASE_URL must be set (shared with the spawned process)
 *   - A Stripe API key (STRIPE_SECRET_KEY or STRIPE_API_KEY starting with sk_)
 *     must be in the environment so new Stripe(key) in the server is valid.
 *     The key is only used by the webhook constructor; no real API call is made.
 *
 * Usage:  node scripts/test-stripe-subscription-webhook.cjs
 *
 * Fixtures use a "smoke_stripe_wh_" prefix and are cleaned up on exit.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http      = require('http');
const crypto    = require('crypto');
const { spawn } = require('child_process');
const path      = require('path');

const ROOT     = path.resolve(__dirname, '..');
const TEST_PORT = 5099;

// Self-generated signing secret — prod-server constructEvent is a local HMAC
const TEST_WEBHOOK_SECRET = 'whsec_' + crypto.randomBytes(32).toString('hex');

const pool = createPool({ connectionString: process.env.DATABASE_URL });

// ── Fixture IDs ──────────────────────────────────────────────────────────────
const COMPANY_A = 'smoke_stripe_wh_co_a';
const COMPANY_B = 'smoke_stripe_wh_co_b';
const SUB_ID_A  = 'sub_smoke_wh_test_a';
const CUST_ID_A = 'cus_smoke_wh_test_a';

// ── Helpers ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`);
    failed++;
  }
}

/** Build a Stripe webhook signature over `rawBody` using `secret`. */
function stripeSign(secret, rawBody) {
  const ts  = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac('sha256', secret)
                    .update(`${ts}.${rawBody}`)
                    .digest('hex');
  return `t=${ts},v1=${mac}`;
}

/** Minimal customer.subscription.* event payload. */
function makeSubEvent(type, subId, customerId, status, amountCents, metaCompanyId) {
  const sub = {
    id:       subId,
    object:   'subscription',
    customer: customerId,
    status,
    items: {
      object: 'list',
      data: [{
        id:       `si_${crypto.randomBytes(4).toString('hex')}`,
        price:    { unit_amount: amountCents },
        quantity: 1,
      }],
    },
    metadata: metaCompanyId ? { company_id: metaCompanyId } : {},
  };
  return JSON.stringify({
    id:     `evt_${crypto.randomBytes(8).toString('hex')}`,
    object: 'event',
    type,
    data:   { object: sub },
  });
}

/** POST a signed payload to the test server's webhook endpoint. */
function postWebhook(rawBody) {
  const sig = stripeSign(TEST_WEBHOOK_SECRET, rawBody);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port:     TEST_PORT,
      path:     '/api/stripe/webhook',
      method:   'POST',
      headers: {
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(rawBody),
        'stripe-signature': sig,
      },
    };
    const req = http.request(opts, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let d; try { d = JSON.parse(b); } catch { d = b; }
        resolve({ status: res.statusCode, data: d });
      });
    });
    req.on('error', reject);
    req.write(rawBody);
    req.end();
  });
}

async function getCompanyRow(id) {
  const { rows } = await pool.query('SELECT * FROM companies WHERE id = $1 LIMIT 1', [id]);
  return rows[0] || null;
}

/** Poll until the test server responds on TEST_PORT or the timeout elapses. */
async function waitForTestServer(maxMs = 60000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: TEST_PORT, path: '/', method: 'GET' },
          (res) => { res.resume(); resolve(res.statusCode); }
        );
        req.setTimeout(1500, () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
        req.end();
      });
      return true; // got any HTTP response
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function cleanup() {
  for (const id of [COMPANY_A, COMPANY_B]) {
    await pool.query('DELETE FROM staff_profiles WHERE company_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM companies    WHERE id          = $1', [id]).catch(() => {});
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('[stripe-webhook] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  // prod-server.cjs needs a value for STRIPE_SECRET_KEY / STRIPE_API_KEY so that
  // `new Stripe(key)` constructs without throwing.  stripe.webhooks.constructEvent
  // is purely local HMAC — it never makes a network call — so any syntactically
  // valid sk_test_* key works fine for this test.  We prefer a real key when one
  // is present in the environment, and fall back to a synthetic test key otherwise.
  const stripeKey = [process.env.STRIPE_SECRET_KEY, process.env.STRIPE_API_KEY]
    .find(k => k?.startsWith('sk_')) || 'sk_test_smoketestwebhookregression0000';

  // ── Spawn isolated prod-server.cjs ────────────────────────────────────────
  console.log(`[stripe-webhook] Spawning prod-server.cjs on port ${TEST_PORT}…`);
  const child = spawn('node', ['prod-server.cjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT:                  String(TEST_PORT),
      STRIPE_API_KEY:        stripeKey,
      STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      NODE_ENV:              'test',
      REPLIT_DEPLOYMENT:     '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Forward child errors to stderr for debugging
  child.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) process.stderr.write(`[child:err] ${line}\n`);
  });

  // Log key child stdout lines only
  child.stdout.on('data', (d) => {
    const line = d.toString().trim();
    if (/Server running on port|Stripe|schema|error/i.test(line)) {
      process.stderr.write(`[child] ${line}\n`);
    }
  });

  child.on('error', (err) => {
    console.error('[stripe-webhook] Failed to spawn prod-server.cjs:', err.message);
  });

  let exitCode = null;
  child.on('exit', (code) => { exitCode = code; });

  try {
    if (!(await waitForTestServer(90000))) {
      console.error('[stripe-webhook] prod-server.cjs did not start within 90s.');
      child.kill('SIGTERM');
      await pool.end();
      process.exit(1);
    }
    console.log(`[stripe-webhook] Test server ready on port ${TEST_PORT} ✓`);

    await cleanup();

    // ── Seed fixture companies ───────────────────────────────────────────────
    // Company A: pre-seeded stripe_subscription_id — tests lookup-by-sub-id path
    await pool.query(
      `INSERT INTO companies
         (id, name, stripe_subscription_id, stripe_customer_id,
          stripe_subscription_amount, stripe_subscription_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
      [COMPANY_A, 'Smoke Stripe WH Co A', SUB_ID_A, CUST_ID_A, 0, 'active']
    );
    // Company B: both stripe_subscription_id AND stripe_customer_id are NULL so
    // that neither fallback lookup path can find this company.  Only the
    // metadata.company_id branch should match — if that branch is removed or
    // broken, Step 3 will correctly fail (no row updated).
    await pool.query(
      `INSERT INTO companies
         (id, name, stripe_subscription_id, stripe_customer_id,
          stripe_subscription_amount, stripe_subscription_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
      [COMPANY_B, 'Smoke Stripe WH Co B', null, null, 0, 'active']
    );

    // ────────────────────────────────────────────────────────────────────────
    // Step 1: subscription.updated — lookup by stripe_subscription_id
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n[stripe-webhook] Step 1: subscription.updated (lookup by stripe_subscription_id)');
    const r1 = await postWebhook(
      makeSubEvent('customer.subscription.updated', SUB_ID_A, CUST_ID_A, 'active', 29900, null)
    );
    ok(`webhook returns 200 (got ${r1.status})`, r1.status === 200);

    let rowA = await getCompanyRow(COMPANY_A);
    ok('stripe_subscription_amount = 299', Number(rowA.stripe_subscription_amount) === 299, rowA.stripe_subscription_amount);
    ok('stripe_subscription_status = active', rowA.stripe_subscription_status === 'active', rowA.stripe_subscription_status);
    ok('subscription_status = active', rowA.subscription_status === 'active', rowA.subscription_status);
    ok('stripe_subscription_id preserved', rowA.stripe_subscription_id === SUB_ID_A, rowA.stripe_subscription_id);

    // ────────────────────────────────────────────────────────────────────────
    // Step 2: price change — amount updates on a second updated event
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n[stripe-webhook] Step 2: price change → stripe_subscription_amount updated');
    const r2 = await postWebhook(
      makeSubEvent('customer.subscription.updated', SUB_ID_A, CUST_ID_A, 'active', 49900, null)
    );
    ok(`webhook returns 200 (got ${r2.status})`, r2.status === 200);

    rowA = await getCompanyRow(COMPANY_A);
    ok('stripe_subscription_amount updated to 499', Number(rowA.stripe_subscription_amount) === 499, rowA.stripe_subscription_amount);
    ok('stripe_subscription_status still active', rowA.stripe_subscription_status === 'active', rowA.stripe_subscription_status);

    // ────────────────────────────────────────────────────────────────────────
    // Step 3: subscription.updated — lookup by metadata.company_id
    // ────────────────────────────────────────────────────────────────────────
    // Company B has null stripe_subscription_id and null stripe_customer_id.
    // The event sub ID and customer ID are unique strings not present in any
    // company row, so neither fallback lookup can find it — only the
    // metadata.company_id branch succeeds.  If that branch is removed, rowB
    // will show amount=0 and Step 3 assertions will correctly fail.
    console.log('\n[stripe-webhook] Step 3: subscription.updated (lookup by metadata.company_id — only path that matches)');
    const SUB_ID_B = 'sub_smoke_wh_meta_only';
    const r3 = await postWebhook(
      makeSubEvent('customer.subscription.updated', SUB_ID_B, 'cus_smoke_wh_meta_only', 'trialing', 9900, COMPANY_B)
    );
    ok(`webhook returns 200 (got ${r3.status})`, r3.status === 200);

    const rowB = await getCompanyRow(COMPANY_B);
    ok('company B stripe_subscription_amount = 99', Number(rowB.stripe_subscription_amount) === 99, rowB.stripe_subscription_amount);
    ok('company B stripe_subscription_status = trialing', rowB.stripe_subscription_status === 'trialing', rowB.stripe_subscription_status);
    ok('company B subscription_status = trial', rowB.subscription_status === 'trial', rowB.subscription_status);

    // ────────────────────────────────────────────────────────────────────────
    // Step 4: subscription.deleted → status MUST be 'canceled' regardless of
    //         sub.status ('active' in the Stripe event object)
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n[stripe-webhook] Step 4: subscription.deleted → status forced to canceled');
    const r4 = await postWebhook(
      // Stripe sends status='active' on the sub object even for deleted events
      makeSubEvent('customer.subscription.deleted', SUB_ID_A, CUST_ID_A, 'active', 49900, null)
    );
    ok(`webhook returns 200 (got ${r4.status})`, r4.status === 200);

    rowA = await getCompanyRow(COMPANY_A);
    ok('stripe_subscription_status is canceled (not sub.status=active)', rowA.stripe_subscription_status === 'canceled', rowA.stripe_subscription_status);
    ok('subscription_status is cancelled', rowA.subscription_status === 'cancelled', rowA.subscription_status);
    ok('stripe_subscription_amount still written on deletion', Number(rowA.stripe_subscription_amount) === 499, rowA.stripe_subscription_amount);

    // ────────────────────────────────────────────────────────────────────────
    // Step 5 (negative): unknown company — server must return 200, not crash
    // ────────────────────────────────────────────────────────────────────────
    console.log('\n[stripe-webhook] Step 5: unknown company → graceful no-op');
    const r5 = await postWebhook(
      makeSubEvent('customer.subscription.updated', 'sub_unknown_xyz', 'cus_unknown_xyz', 'active', 9900, null)
    );
    ok(`unknown-company event returns 200 (got ${r5.status})`, r5.status === 200);

    console.log('\n[stripe-webhook] Step 6: checkout.session.completed subscription mode');
    const checkoutBody = JSON.stringify({
      id: `evt_${crypto.randomBytes(8).toString('hex')}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_smoke_subscription',
          object: 'checkout.session',
          mode: 'subscription',
          payment_status: 'paid',
          customer: CUST_ID_A,
          metadata: { company_id: COMPANY_A },
          subscription: 'sub_checkout_smoke',
        },
      },
    });
    const r6 = await postWebhook(checkoutBody);
    ok(`checkout webhook returns 200 (got ${r6.status})`, r6.status === 200);
    rowA = await getCompanyRow(COMPANY_A);
    ok('checkout sets subscription_status = active', rowA.subscription_status === 'active', rowA.subscription_status);
    ok('checkout does not replace an existing stripe subscription id', rowA.stripe_subscription_id === SUB_ID_A, rowA.stripe_subscription_id);

  } catch (e) {
    console.error('[stripe-webhook] UNEXPECTED ERROR:', e);
    failed++;
  } finally {
    try { await cleanup(); } catch (e) { console.error('[stripe-webhook] cleanup error:', e.message); }
    await pool.end();
    child.kill('SIGTERM');
    // Give child a moment to exit cleanly
    await new Promise((r) => setTimeout(r, 500));
    if (exitCode === null) child.kill('SIGKILL');
  }

  console.log(`\n[stripe-webhook] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
