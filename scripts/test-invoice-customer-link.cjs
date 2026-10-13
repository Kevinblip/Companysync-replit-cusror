'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  guardInvoiceCustomerUpdate,
  linkUnassignedInvoice,
  validateInvoiceCustomerReference,
} = require('../lib/invoiceCustomerLink.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function fakePool({
  owner = 'owner@example.test',
  invoiceCompanyId = 'company-1',
  invoiceCustomerId = '',
  customerCompanyId = 'company-1',
} = {}) {
  const calls = [];
  const invoice = { id: 'invoice-1', company_id: invoiceCompanyId, customer_id: invoiceCustomerId };
  const customer = { id: 'customer-1', company_id: customerCompanyId };
  return {
    calls,
    async query(sql, args = []) {
      calls.push({ sql, args });
      if (sql.startsWith('UPDATE invoices')) {
        const valid = invoice.company_id === args[2] &&
          !invoice.customer_id &&
          customer.id === args[0] &&
          customer.company_id === invoice.company_id;
        if (!valid) return { rows: [] };
        invoice.customer_id = args[0];
        return { rows: [{ id: invoice.id, company_id: invoice.company_id, customer_id: invoice.customer_id }] };
      }
      if (sql.includes('FROM companies')) {
        return { rows: [{ id: args[0], created_by: owner }] };
      }
      if (sql.includes('FROM invoices')) {
        return { rows: invoice.company_id === args[1] ? [invoice] : [] };
      }
      if (sql.includes('FROM customers')) {
        return { rows: customer.id === args[0] && customer.company_id === args[1] ? [customer] : [] };
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

  const linkedPool = fakePool({ invoiceCustomerId: 'already-linked' });
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
  });
  const update = successPool.calls.find(({ sql }) => sql.startsWith('UPDATE invoices'));
  assert.ok(update.sql.includes('NULLIF(BTRIM(customer_id), \'\') IS NULL'));
  assert.ok(update.sql.includes('c.company_id = invoices.company_id'));
  assert.ok(update.sql.includes("COALESCE(data, '{}'::jsonb) || jsonb_build_object('customer_id', $1)"));
  assert.deepEqual(update.args, ['customer-1', 'invoice-1', 'company-1']);

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

  console.log('invoice customer identity, authorization, tenant isolation, and explicit-link regression checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
