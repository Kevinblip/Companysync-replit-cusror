const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function includes(source, fragment, message) {
  assert.ok(source.includes(fragment), message);
}

(async () => {
  const finance = await import(pathToFileURL(path.join(root, 'src/utils/invoiceFinance.js')));

  assert.equal(finance.getInvoiceBalance({ total_amount: 1250, amount_paid: 0 }), 1250);
  assert.equal(finance.getInvoiceBalance({ total_amount: 1250, amount_paid: 450.25 }), 799.75);
  assert.equal(finance.getInvoiceBalance({ total_amount: 1250, amount_paid: 1300 }), 0);
  assert.equal(
    finance.getInvoiceBalance({
      total_amount: 1000,
      amount_paid: 100,
      discount_type: 'fixed',
      discount_value: 50,
      items: [{ rcv: 600 }, { rcv: 400 }],
    }),
    850,
  );

  const stripe = read('vite-stripe-plugin.js');
  includes(stripe, "payment_method_types: ['card', 'us_bank_account']", 'Checkout must offer card and ACH');
  includes(stripe, "if (!account?.charges_enabled)", 'Checkout must reject unavailable connected accounts');
  includes(stripe, "if (invoice.status === 'cancelled')", 'Checkout must reject cancelled invoices');
  includes(stripe, "if (chargeAmount <= 0)", 'Checkout must reject invoices without a balance');
  includes(stripe, "'invoice-checkout',", 'Invoice Checkout must use an idempotency key');
  includes(stripe, 'WHERE portal_token = $1 LIMIT 1', 'Public checkout must resolve an opaque portal token');
  includes(stripe, 'invoice.company_id === customer.company_id', 'Public checkout must enforce company ownership');
  includes(stripe, 'invoice.customer_id === customer.id', 'Public checkout must enforce customer ownership');
  includes(stripe, 'unit_amount: Math.round(chargeAmount * 100)', 'Stripe amount must come from server balance');

  const dev = read('vite-functions-plugin.js');
  const prod = read('prod-server.cjs');
  const route = '/api/public/portal/invoice-checkout';
  includes(dev, route, 'Development server must expose public invoice checkout');
  includes(prod, route, 'Production server must expose public invoice checkout');
  includes(dev, 'createPublicInvoiceCheckout', 'Development route must use the token-gated handler');
  includes(prod, 'createPublicInvoiceCheckout', 'Production route must use the token-gated handler');
  includes(dev, 'payment_options: paymentOptions', 'Development portal must return sanitized payment options');
  includes(prod, 'payment_options });', 'Production portal must return sanitized payment options');

  const optionKeys = [
    'zelle_email',
    'cashapp_handle',
    'venmo_handle',
    'check_payment_instructions',
    'cash_payment_instructions',
  ];
  for (const key of optionKeys) {
    includes(stripe, `'${key}'`, `Stripe resolver must whitelist ${key}`);
    includes(prod, `'${key}'`, `Production portal must whitelist ${key}`);
  }

  const authenticatedPortal = read('src/pages/CustomerPortal.jsx');
  const publicPortal = read('src/pages/CustomerPortalPublic.jsx');
  for (const source of [authenticatedPortal, publicPortal]) {
    includes(source, '<InvoicePaymentOptions', 'Both portals must render the shared payment section');
    includes(source, 'amountDue > 0', 'Payment section must require a positive balance');
    includes(source, "invoice.status !== 'cancelled'", 'Payment section must hide cancelled invoices');
  }
  includes(publicPortal, "fetch('/api/public/portal/invoice-checkout'", 'Public portal must use token-gated checkout');
  includes(publicPortal, 'body: JSON.stringify({ token, invoice_id: invoice.id })', 'Public checkout must submit token and invoice id');

  console.log('invoice payment options regression checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});