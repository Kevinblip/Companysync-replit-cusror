'use strict';

// Focused, database-free regression checks for the work-order contract.
// Route-level behavior is intentionally centralized in lib/workOrders.cjs so
// these arithmetic and guard assertions apply to both development and prod.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  centsFor,
  moneyToCents,
  quantityToMilli,
  resolveRateItems,
} = require('../lib/workOrders.cjs');

async function run() {
  // Decimal-safe money and measurement conversion.
  assert.strictEqual(moneyToCents('4.10'), 410);
  assert.strictEqual(moneyToCents('0.015'), null, 'more than two dollar decimals is rejected');
  assert.strictEqual(moneyToCents('-1'), null);
  assert.strictEqual(quantityToMilli('1.125'), 1125);
  assert.strictEqual(quantityToMilli('0'), null);
  assert.strictEqual(centsFor(1500, 1075), 1613, '1.5 × $10.75 rounds to cents once');

  // Missing/inactive rates cannot produce a payout. The mocked query mirrors
  // the one resolveRateItems runs against tenant-scoped labor_rates.
  const pool = {
    async query(_sql, [_companyId, ids, subcontractorId]) {
      return { rows: ids.includes('active-rate') ? [{
        id: 'active-rate', name: 'Install shingles', category: 'Roofing',
        unit: 'square', rate_cents: 12500, custom_rate: subcontractorId === 'custom-sub' ? '132.50' : null,
      }] : [] };
    },
  };
  const calculated = await resolveRateItems(pool, 'company-a', [{ labor_rate_id: 'active-rate', quantity: '2.5' }]);
  assert.strictEqual(calculated.payoutCents, 31250);
  assert.strictEqual(calculated.items[0].total_cents, 31250);
  const overridden = await resolveRateItems(pool, 'company-a', 'custom-sub', [{ labor_rate_id: 'active-rate', quantity: '2.5' }]);
  assert.strictEqual(overridden.payoutCents, 33125, 'subcontractor custom rate takes precedence over standard rate');
  const missing = await resolveRateItems(pool, 'company-a', [{ labor_rate_id: 'missing-rate', quantity: 1 }]);
  assert.match(missing.error, /missing or inactive/i);

  // Guardrails must remain in the shared server path: no duplicate completion,
  // no complete-without-photo, and no paid status before approval.
  const handler = fs.readFileSync(path.join(__dirname, '../lib/workOrders.cjs'), 'utf8');
  for (const fragment of [
    "status = 'accepted'",
    "SELECT 1 FROM work_order_completion_photos",
    "already submitted for payment",
    "const expected = operation === 'approve' ? 'completed' : 'approved'",
    "WHERE id=$1 AND company_id=$2 AND status=$4",
    "access_token = $1",
    "company_id = $1",
  ]) assert.ok(handler.includes(fragment), `missing work-order guard: ${fragment}`);

  // Schema and routing must stay available in dev and production.
  const devSchema = fs.readFileSync(path.join(__dirname, '../db/schema.js'), 'utf8');
  const prodSchema = fs.readFileSync(path.join(__dirname, '../db/prod-db.cjs'), 'utf8');
  for (const table of ['labor_rates', 'subcontractor_rates', 'work_orders', 'work_order_items', 'work_order_completion_photos']) {
    assert.ok(devSchema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `dev schema missing ${table}`);
    assert.ok(prodSchema.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `prod schema missing ${table}`);
  }
  for (const file of ['../vite-functions-plugin.js', '../prod-server.cjs']) {
    assert.ok(fs.readFileSync(path.join(__dirname, file), 'utf8').includes('handleWorkOrderRoute'), `${file} must register work-order routes`);
  }
  for (const fragment of [
    'subcontractor_rates',
    '/api/subcontractors/',
    'custom_rate',
    'subcontractorId, body.items',
  ]) assert.ok(handler.includes(fragment), `missing custom-rate behavior: ${fragment}`);

  // Crew-link deliveries must stay tenant-scoped and use the injected guarded
  // company transports in both environments, while preserving a visible result.
  for (const fragment of [
    '(approve|paid|link|send)',
    "invite_delivery_status='sent'",
    "invite_delivery_status='failed'",
    "invite_delivery_status='sending'",
    "invite_delivered_at=NULL",
    'invite sent but status update failed',
    'invite_delivery_method=$3, invite_delivery_status=\'failed\', invite_delivered_at=NULL',
    'subcontractor_email',
    'companyId,',
    'senderEmail: ctx.email',
    'getAppUrl(req)',
  ]) assert.ok(handler.includes(fragment), `missing work-order delivery behavior: ${fragment}`);
  for (const file of ['../db/schema.js', '../db/prod-db.cjs']) {
    const schema = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const field of ['invite_delivery_method', 'invite_delivery_status', 'invite_delivered_at', 'invite_delivery_error']) {
      assert.ok(schema.includes(field), `${file} missing delivery status field ${field}`);
    }
  }
  for (const file of ['../vite-functions-plugin.js', '../prod-server.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(source.includes('sendSMS:'), `${file} must provide SMS delivery to work orders`);
    assert.ok(source.includes('sendEmail:'), `${file} must provide email delivery to work orders`);
  }
  console.log('work-order regression checks passed');
}

run().catch((error) => {
  console.error('work-order regression checks failed:', error);
  process.exit(1);
});