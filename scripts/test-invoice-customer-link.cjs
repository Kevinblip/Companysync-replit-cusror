'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  guardInvoiceCustomerUpdate,
  linkUnassignedInvoice,
  resolveInvoiceCustomerForCreate,
  validateInvoiceCustomerReference,
} = require('../lib/invoiceCustomerLink.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function fakePool({
  owner = 'owner@example.test',
  invoiceCompanyId = 'company-1',
  invoiceCustomerId = '',
  invoiceCustomerName = 'Jordan Lee',
  customerCompanyId = 'company-1',
  customerName = 'Jordan Lee',
  customerEmail = 'jordan@example.test',
  extraCustomers = [],
} = {}) {
  const calls = [];
  const invoice = {
    id: 'invoice-1',
    company_id: invoiceCompanyId,
    customer_id: invoiceCustomerId,
    customer_name: invoiceCustomerName,
  };
  const customer = {
    id: 'customer-1',
    company_id: customerCompanyId,
    name: customerName,
    email: customerEmail,
    base44_id: null,
  };
  const customers = [customer, ...extraCustomers];
  return {
    calls,
    customers,
    invoice,
    async query(sql, args = []) {
      calls.push({ sql, args });
      if (sql.startsWith('UPDATE invoices')) {
        const [customerId, name, email, invoiceId, companyId] = args;
        const target = customers.find((row) => row.id === customerId && row.company_id === companyId);
        const currentId = String(invoice.customer_id || '').trim();
        const current = customers.find((row) =>
          row.company_id === invoice.company_id && (row.id === currentId || row.base44_id === currentId)
        );
        const sameName = current &&
          String(current.name || '').trim().toLowerCase() === String(invoice.customer_name || '').trim().toLowerCase();
        const blocked = Boolean(current && target && current.id !== target.id && sameName && current.name);
        const valid = invoice.company_id === companyId && invoice.id === invoiceId && target && !blocked;
        if (!valid) return { rows: [] };
        invoice.customer_id = customerId;
        invoice.customer_name = name;
        invoice.customer_email = email;
        return { rows: [{ ...invoice }] };
      }
      if (sql.includes('FROM companies')) {
        return { rows: [{ id: args[0], created_by: owner }] };
      }
      if (sql.includes('FROM invoices')) {
        return { rows: invoice.company_id === args[1] ? [invoice] : [] };
      }
      if (sql.includes('FROM customers') && sql.includes('LOWER(BTRIM(name))')) {
        const matches = customers.filter((row) =>
          row.company_id === args[0] &&
          String(row.name || '').trim().toLowerCase() === String(args[1] || '').trim().toLowerCase()
        );
        return { rows: matches.slice(0, 2), rowCount: Math.min(matches.length, 2) };
      }
      if (sql.includes('FROM customers') && sql.includes('OR base44_id')) {
        const found = customers.find((row) =>
          row.company_id === args[0] && (row.id === args[1] || row.base44_id === args[1])
        );
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      if (sql.includes('FROM customers')) {
        const found = customers.find((row) => row.id === args[0] && row.company_id === args[1]);
        return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

const ownerCtx = {
  authenticated: true,
  email: 'owner@example.test',
  administratorCompanyIds: new Set(),
  platformRole: null,
  isImpersonating: false,
};

async function main() {
  const sameCompanyPool = fakePool();
  assert.deepEqual(
    await validateInvoiceCustomerReference(sameCompanyPool, 'invoices', {
      company_id: 'company-1',
      customer_id: 'customer-1',
    }),
    { blocked: false },
  );
  const crossCompanyPool = fakePool({ customerCompanyId: 'company-2' });
  assert.equal(
    (await validateInvoiceCustomerReference(crossCompanyPool, 'invoices', {
      company_id: 'company-1',
      customer_id: 'customer-1',
    })).blocked,
    true,
    'an invoice cannot reference a customer from another company',
  );
  assert.equal(
    guardInvoiceCustomerUpdate('invoices', { customer_id: '' }, { customer_id: 'customer-1' }).blocked,
    true,
    'generic edits cannot bypass the explicit confirmation action',
  );
  assert.equal(
    guardInvoiceCustomerUpdate('invoices', { customer_id: 'customer-1' }, { customer_id: 'customer-1' }).blocked,
    false,
  );
  assert.equal(
    guardInvoiceCustomerUpdate('invoices', { customer_id: '' }, {
      data: { customer_id: 'customer-1' },
    }).blocked,
    true,
    'nested JSON updates cannot bypass the explicit confirmation action',
  );
  assert.equal(
    guardInvoiceCustomerUpdate('invoices', { customer_id: '', data: '{"customer_id":"customer-1"}' }, {
      data: { customer_id: 'customer-1' },
    }).blocked,
    false,
    'rewriting the same existing nested relationship is allowed',
  );
  assert.equal(
    (await validateInvoiceCustomerReference(sameCompanyPool, 'invoices', {
      company_id: 'company-1',
      data: { customer_id: 'customer-1' },
    })).blocked,
    false,
  );

  const unconfirmedPool = fakePool();
  const unconfirmed = await linkUnassignedInvoice({
    pool: unconfirmedPool,
    ctx: ownerCtx,
    invoiceId: 'invoice-1',
    customerId: 'customer-1',
    companyId: 'company-1',
    confirmed: false,
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmedPool.calls.length, 0);

  const noAccessPool = fakePool();
  const noAccess = await linkUnassignedInvoice({
    pool: noAccessPool,
    ctx: { ...ownerCtx, email: 'staff@example.test' },
    invoiceId: 'invoice-1',
    customerId: 'customer-1',
    companyId: 'company-1',
    confirmed: true,
  });
  assert.equal(noAccess.status, 403);
  assert.equal(noAccessPool.calls.some(({ sql }) => sql.startsWith('UPDATE invoices')), false);

  const crossTenantLink = await linkUnassignedInvoice({
    pool: fakePool({ customerCompanyId: 'company-2' }),
    ctx: ownerCtx,
    invoiceId: 'invoice-1',
    customerId: 'customer-1',
    companyId: 'company-1',
    confirmed: true,
  });
  assert.equal(crossTenantLink.status, 404);

  const linkedPool = fakePool({
    invoiceCustomerId: 'customer-keep',
    invoiceCustomerName: 'Keep Me',
    extraCustomers: [{
      id: 'customer-keep',
      company_id: 'company-1',
      name: 'Keep Me',
      email: 'keep@example.test',
      base44_id: null,
    }],
  });
  const alreadyLinked = await linkUnassignedInvoice({
    pool: linkedPool,
    ctx: ownerCtx,
    invoiceId: 'invoice-1',
    customerId: 'customer-1',
    companyId: 'company-1',
    confirmed: true,
  });
  assert.equal(alreadyLinked.status, 409);
  assert.equal(linkedPool.calls.some(({ sql }) => sql.startsWith('UPDATE invoices')), false);

  const mismatchedPool = fakePool({
    invoiceCustomerId: 'stale-id',
    invoiceCustomerName: 'Chad Sohl',
    customerName: 'Chad Sohl',
    customerEmail: 'chad@example.test',
  });
  const relinked = await linkUnassignedInvoice({
    pool: mismatchedPool,
    ctx: ownerCtx,
    invoiceId: 'invoice-1',
    customerId: 'customer-1',
    companyId: 'company-1',
    confirmed: true,
  });
  assert.equal(relinked.status, 200);
  assert.equal(relinked.body.invoice.customer_id, 'customer-1');
  assert.equal(relinked.body.invoice.customer_name, 'Chad Sohl');
  assert.equal(relinked.body.invoice.customer_email, 'chad@example.test');

  const successPool = fakePool();
  const linked = await linkUnassignedInvoice({
    pool: successPool,
    ctx: ownerCtx,
    invoiceId: 'invoice-1',
    customerId: 'customer-1',
    companyId: 'company-1',
    confirmed: true,
  });
  assert.equal(linked.status, 200);
  assert.deepEqual(linked.body.invoice, {
    id: 'invoice-1',
    company_id: 'company-1',
    customer_id: 'customer-1',
    customer_name: 'Jordan Lee',
    customer_email: 'jordan@example.test',
  });
  const update = successPool.calls.find(({ sql }) => sql.startsWith('UPDATE invoices'));
  assert.ok(update.sql.includes('NULLIF(BTRIM(customer_id), \'\') IS NULL'));
  assert.ok(update.sql.includes('customer_name = $2'));
  assert.ok(update.sql.includes('customer_email = $3'));
  assert.ok(update.sql.includes('c.company_id = invoices.company_id'));
  assert.ok(update.sql.includes("'customer_name', $2::text"));
  assert.ok(update.sql.includes("'customer_email', COALESCE($3::text, '')"));
  assert.deepEqual(update.args, ['customer-1', 'Jordan Lee', 'jordan@example.test', 'invoice-1', 'company-1']);

  const createPool = fakePool({
    extraCustomers: [{
      id: 'local_1772801063426_4t3id847y',
      company_id: 'company-1',
      name: 'Chad Sohl',
      email: 'chad@example.test',
      base44_id: 'base44-chad',
    }],
  });
  const createdFromName = await resolveInvoiceCustomerForCreate(createPool, 'company-1', {
    customer_name: 'Chad Sohl',
  });
  assert.equal(createdFromName.ok, true);
  assert.equal(createdFromName.customer.id, 'local_1772801063426_4t3id847y');
  const missingCustomer = await resolveInvoiceCustomerForCreate(fakePool(), 'company-1', {});
  assert.equal(missingCustomer.ok, false);
  assert.match(missingCustomer.error, /needs a customer/);
  const ambiguous = await resolveInvoiceCustomerForCreate(fakePool({
    extraCustomers: [{
      id: 'customer-dup',
      company_id: 'company-1',
      name: 'Jordan Lee',
      email: 'other@example.test',
      base44_id: null,
    }],
  }), 'company-1', { customer_name: 'Jordan Lee' });
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error, /More than one customer/);

  const devFunctions = read('vite-functions-plugin.js');
  const devDbPlugin = read('vite-db-plugin.js');
  const productionDb = read('db/prod-db.cjs');
  const converterStart = devFunctions.indexOf('async convertEstimateToInvoice(');
  const converterEnd = devFunctions.indexOf('async updateLeadScore(', converterStart);
  const converter = devFunctions.slice(converterStart, converterEnd);
  assert.match(converter, /SELECT id FROM customers WHERE id = \$1 AND company_id = \$2/);
  assert.match(converter, /INSERT INTO invoices \([^)]*customer_id/);
  assert.doesNotMatch(converter, /customers WHERE name\s*=/);
  for (const [label, server] of [['development', devDbPlugin], ['production', productionDb]]) {
    assert.match(server, /\/api\/local\/invoices\/link-customer/);
    assert.match(server, /linkUnassignedInvoice\(\{/);
    assert.match(server, /guardInvoiceCustomerUpdate\(entityType, existing, body\)/);
    assert.match(server, /validateInvoiceCustomerReference\(/);
    assert.match(
      server,
      /const invoiceCustomerLink = (?:nodeRequire|require)\(['"][^'"]*invoiceCustomerLink\.cjs['"]\)/,
      `${label} server imports the shared invoice identity guard`,
    );
  }

  const deployedConverter = read('functions/convertEstimateToInvoice.ts');
  assert.match(deployedConverter, /Customer\.filter\(\{\s*id: estimate\.customer_id,\s*company_id: companyId/);
  assert.match(deployedConverter, /String\(p\.customer_id \|\| ''\) === String\(customerId\)/);
  assert.doesNotMatch(deployedConverter, /String\(p\.customer_name/);

  for (const file of ['vite-lexi-native-plugin.js', 'vite-functions-plugin.js', 'prod-server.cjs']) {
    const source = read(file);
    assert.match(source, /resolveInvoiceCustomerForCreate\(/, `${file} must require a customer before Lexi creates an invoice`);
    assert.match(source, /needs_customer: true/);
  }
  assert.match(read('src/pages/Payments.jsx'), /Needs a customer before an invoice can be created/);
  assert.match(read('src/pages/Invoices.jsx'), /invoiceNeedsCustomerLink/);
  assert.match(read('src/pages/CustomerProfile.jsx'), /getInvoicesForCustomerProfile/);
  assert.match(read('src/pages/invoice-details.jsx'), /invoiceCollectibleBalance/);
  assert.match(read('src/pages/invoice-details.jsx'), /insurancePaysAmount/);
  assert.match(read('src/pages/invoice-details.jsx'), /input-adjustment-label/);
  assert.doesNotMatch(read('src/pages/invoice-details.jsx'), /deductible_waived_or_collected/);
  assert.match(read('src/pages/Estimates.jsx'), /input-confirm-delete-estimates/);
  assert.doesNotMatch(read('src/pages/Estimates.jsx'), /deleteAllEstimatesMutation/);

  console.log('invoice customer identity, authorization, tenant isolation, and explicit-link regression checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
