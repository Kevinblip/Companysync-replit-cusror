const fs = require('fs');
const assert = require('assert');

const ui = fs.readFileSync('src/pages/Invoices.jsx', 'utf8');
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
  'async markOldInvoicesPaid(params)',
  '\n  async recalculateInvoicePayments'
);
const prodHandler = handlerBlock(
  prod,
  "if (functionName === 'markOldInvoicesPaid')",
  "\n    if (functionName === 'grantStaffAdminAccess')"
);

for (const [name, handler] of [['Dev', devHandler], ['Prod', prodHandler]]) {
  assert(
    handler.includes('due_date IS NOT NULL AND due_date < $2::date'),
    `${name} handler must prioritize the invoice due date`
  );
  assert(
    handler.includes('due_date IS NULL AND created_at < $2::date'),
    `${name} handler must use invoices.created_at when no due date exists`
  );
  assert(
    !handler.includes('created_date'),
    `${name} handler must not query generic-entity-only created_date`
  );
  assert(
    handler.includes("status = 'partially_paid'") && handler.includes("SET status = 'paid'"),
    `${name} handler must only settle partially paid invoices`
  );
}

assert(
  ui.includes('data-testid="button-mark-old-paid"') &&
    ui.includes("base44.functions.invoke('markOldInvoicesPaid'") &&
    ui.includes("cutoff_date: '2026-01-01'"),
  'Invoices UI must expose the pre-2026 settlement confirmation action'
);

console.log('✓ Mark-old-invoices-paid dev/prod query and UI contracts are in sync');