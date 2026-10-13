const fs = require('fs');
const assert = require('assert');

const ui = fs.readFileSync('src/pages/Payments.jsx', 'utf8');
const dev = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const prod = fs.readFileSync('db/prod-integrations.cjs', 'utf8');

function handlerBlock(source, start, end) {
  const startIndex = source.indexOf(start);
  assert(startIndex >= 0, `Missing handler start: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert(endIndex > startIndex, `Missing handler end after: ${start}`);
  return source.slice(startIndex, endIndex);
}

const devHandler = handlerBlock(
  dev,
  'async createInvoiceFromUnlinkedPayment(params, _apiKey, req)',
  '\n  async mergeEstimates'
);
const prodHandler = handlerBlock(
  prod,
  "if (functionName === 'createInvoiceFromUnlinkedPayment')",
  "\n    if (functionName === 'markOldInvoicesPaid')"
);

const sharedContracts = [
  'FOR UPDATE',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'pg_advisory_xact_lock',
  "status = 'received'",
  'invoice_id = $1',
  'invoice_number = $2',
  "status, total_amount, amount_paid",
  "'paid'",
  'COALESCE(SUM(amount), 0)',
  "COALESCE(status, 'received') = 'received'",
  "INV-${invoiceYear}-",
  'customer-invoice:${company_id}:${customer.id}',
  'This customer already has an invoice',
];

for (const contract of sharedContracts) {
  assert(devHandler.includes(contract), `Dev handler missing contract: ${contract}`);
  assert(prodHandler.includes(contract), `Prod handler missing contract: ${contract}`);
}

assert(
  devHandler.includes('getUserFromRequest(req)') &&
  devHandler.includes('Not authorized for this company'),
  'Dev handler must authenticate and authorize company membership'
);
assert(
  prodHandler.includes('getSessionFromRequest(req, pool)') &&
  prodHandler.includes('session?.data?.passport?.user?.claims?.email') &&
  prodHandler.includes('Not authorized for this company'),
  'Prod handler must authenticate and authorize company membership'
);
for (const [name, block] of [['Dev', devHandler], ['Prod', prodHandler]]) {
  assert(
    block.indexOf('customer-invoice:${company_id}:${customer.id}') <
      block.indexOf('SELECT 1 FROM invoices WHERE company_id = $1'),
    `${name} handler must lock the customer before checking for an existing invoice`
  );
}
assert(
  ui.includes("base44.functions.invoke('createInvoiceFromUnlinkedPayment'") &&
  ui.includes('data-testid={`button-create-invoice-from-payment-${p.id}`}') &&
  ui.includes('canCreateInvoiceFromPayment(p)'),
  'Payments banner must expose the one-click create invoice action'
);
assert(
  ui.includes("queryClient.invalidateQueries({ queryKey: ['payments'] })") &&
  ui.includes("queryClient.invalidateQueries({ queryKey: ['invoices'] })"),
  'Successful creation must refresh payments and invoices'
);

console.log('✓ Create-invoice-from-payment dev/prod and UI contracts are in sync');