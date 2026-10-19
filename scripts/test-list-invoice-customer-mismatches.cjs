'use strict';

const assert = require('node:assert/strict');
const {
  classifyInvoiceCustomerLink,
  getInvoicesForCustomerProfile,
} = require('../lib/invoiceCustomerMatch.cjs');
const {
  INVOICE_CUSTOMER_MISMATCH_SQL,
  describeProposal,
  executeRefusal,
  main,
} = require('./list-invoice-customer-mismatches.cjs');

const chad = {
  id: 'local_1772801063426_4t3id847y',
  company_id: 'yicn',
  name: 'Chad Sohl',
  email: 'chad@example.test',
  base44_id: 'base44-chad',
};
const wanda = {
  id: '39932ccc-b3a5-4dbe-b6b7-bbadf49ae131',
  company_id: 'yicn',
  name: 'Wanda Simpson',
  email: 'wanda@example.test',
};
const beverly = {
  id: 'cust-beverly',
  company_id: 'yicn',
  name: 'Beverly Owens-Jackson',
  email: 'beverly@example.test',
};

const chadInvoice = classifyInvoiceCustomerLink({
  id: 'inv_1781649945868_w1midi5ea',
  company_id: 'yicn',
  invoice_number: 'INV-2026-0385',
  customer_id: 'stale-not-a-customer',
  customer_name: 'Chad Sohl',
}, [chad, beverly, wanda]);
assert.equal(chadInvoice.problem, 'mismatched');
assert.equal(chadInvoice.proposal_status, 'exact-name');
assert.equal(chadInvoice.proposal.customer_id, chad.id);
assert.equal(chadInvoice.proposal.customer_email, chad.email);

const wandaInvoice = classifyInvoiceCustomerLink({
  id: 'local_1791343462428_05hsvlmvs',
  company_id: 'yicn',
  invoice_number: 'INV-2026-0901',
  customer_id: '',
  customer_name: 'Wanda Simpson',
}, [chad, beverly, wanda]);
assert.equal(wandaInvoice.problem, 'missing');
assert.equal(wandaInvoice.proposal.customer_id, wanda.id);

const sameNameOtherId = classifyInvoiceCustomerLink({
  id: 'inv-beverly',
  company_id: 'yicn',
  customer_id: beverly.id,
  customer_name: 'Chad Sohl',
}, [chad, beverly]);
assert.equal(sameNameOtherId.problem, 'mismatched');
assert.equal(sameNameOtherId.proposal.customer_id, chad.id);

const alreadyLinked = classifyInvoiceCustomerLink({
  id: 'inv-ok',
  company_id: 'yicn',
  customer_id: chad.base44_id,
  customer_name: 'Chad Sohl',
}, [chad]);
assert.equal(alreadyLinked, null);

const ambiguous = classifyInvoiceCustomerLink({
  id: 'inv-two',
  company_id: 'yicn',
  customer_id: '',
  customer_name: 'Chad Sohl',
}, [chad, { ...chad, id: 'chad-2', email: 'other@example.test' }]);
assert.equal(ambiguous.proposal_status, 'ambiguous');
assert.equal(ambiguous.proposal, null);

const profile = getInvoicesForCustomerProfile([
  { id: 'by-local', customer_id: chad.id, customer_name: 'Someone Else', company_id: 'yicn' },
  { id: 'by-base44', customer_id: chad.base44_id, customer_name: 'Chad Sohl', company_id: 'yicn' },
  { id: 'by-name', customer_id: '', customer_name: 'Chad Sohl', company_id: 'yicn' },
  { id: 'other-person', customer_id: beverly.id, customer_name: 'Chad Sohl', company_id: 'yicn' },
  { id: 'blank-other', customer_id: '', customer_name: 'Wanda Simpson', company_id: 'yicn' },
], chad);
assert.deepEqual(profile.map((row) => row.id), ['by-local', 'by-base44', 'by-name']);

assert.match(describeProposal({
  proposal_count: 1,
  proposal_customer_id: wanda.id,
  proposal_customer_name: 'Wanda Simpson',
  proposal_customer_email: 'wanda@example.test',
}), /exact-name match Wanda Simpson/);
assert.match(describeProposal({ proposal_count: 2 }), /ambiguous/);
assert.match(describeProposal({ proposal_count: 0 }), /no exact-name match/);

assert.doesNotMatch(INVOICE_CUSTOMER_MISMATCH_SQL, /\b(UPDATE|DELETE|INSERT|ALTER|DROP)\b/i);
assert.match(executeRefusal('postgres://user:secret@db.example.com:5432/app'), /Refusing to connect/);
assert.equal(executeRefusal('postgres://user:secret@127.0.0.1:5432/app'), null);
assert.match(executeRefusal(''), /Not connecting/);

async function checkDryRun() {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const code = await main([], { DATABASE_URL: 'postgres://user:secret@db.example.com:5432/prod' });
    assert.equal(code, 0);
    assert.match(logs.join('\n'), /No database connection was opened/);
    assert.match(logs.join('\n'), /Nothing is updated/);
    assert.doesNotMatch(logs.join('\n'), /secret@db/);
  } finally {
    console.log = originalLog;
  }
  console.log('invoice customer mismatch dry-run and exact-name proposals passed');
}

checkDryRun().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
