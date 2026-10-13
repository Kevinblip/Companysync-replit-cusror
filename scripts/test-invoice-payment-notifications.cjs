const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const includes = (source, fragment, message) => assert.ok(source.includes(fragment), message);

const dev = read('vite-stripe-plugin.js');
const prod = read('prod-server.cjs');

for (const [name, source] of [['development', dev], ['production', prod]]) {
  includes(source, 'checkout.session.async_payment_succeeded', `${name} must handle cleared ACH webhooks`);
  includes(source, 'status=\'ach_pending\'', `${name} must transition only pending ACH payments`);
  includes(source, 'SUM(amount)', `${name} must derive invoice paid totals from payment rows`);
  includes(source, 'is_administrator = true', `${name} must notify administrators only`);
  includes(source, 'company_id = $1', `${name} admin lookup must be company-scoped`);
}

includes(prod, 'stripe.webhookEndpoints.update(existing.id', 'Production must update an existing Stripe endpoint');
includes(prod, 'enabled_events: [...new Set([...enabledEvents, ...missingEvents])]', 'Production endpoint updates must preserve existing events');
includes(prod, "'checkout.session.async_payment_succeeded',", 'New production endpoints must subscribe to ACH clearing');

for (const [name, source] of [['development', dev], ['production', prod]]) {
  includes(source, 'WHERE NOT EXISTS (SELECT 1 FROM payments WHERE reference_number', `${name} card/ACH recording must be idempotent`);
  includes(source, 'pg_advisory_xact_lock(hashtext', `${name} must serialize concurrent webhook retries`);
  includes(source, 'rowCount > 0', `${name} must distinguish a new payment transition`);
  includes(source, 'paymentExistsForInvoice', `${name} must recover notifications after a partial webhook failure`);
  includes(source, 'adminEmailBody', `${name} must provide a separate company-admin email body`);
  includes(source, 'const customerEmail', `${name} must keep customer receipt handling separate from admin notifications`);
}

console.log('invoice payment notification regression checks passed');