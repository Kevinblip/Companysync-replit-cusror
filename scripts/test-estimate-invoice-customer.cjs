'use strict';

const assert = require('node:assert/strict');
const {
  ESTIMATE_CUSTOMER_CANDIDATES_SQL,
  UNLINKED_ESTIMATE_INVOICES_SQL,
  candidateQueryParams,
  resolveEstimateInvoiceCustomer,
} = require('../lib/estimateInvoiceCustomer.cjs');
const { getInvoicesForCustomerProfile } = require('../lib/invoiceCustomerMatch.cjs');
const { describeResolution, main } = require('./list-unlinked-estimate-invoices.cjs');

const greg = { id: 'cust-greg', base44_id: 'b44-greg', company_id: 'yicn', name: 'Greg Curry', email: 'greg@example.test' };
const otherGreg = { id: 'cust-greg-2', company_id: 'yicn', name: 'Greg Curry', email: 'g2@example.test' };
const wanda = { id: 'cust-wanda', company_id: 'yicn', name: 'Wanda Simpson', email: 'wanda@example.test' };
const elsewhere = { id: 'cust-x', company_id: 'other-co', name: 'Greg Curry', email: 'greg@example.test' };
const all = [greg, wanda, elsewhere];

const r = (estimate, customers = all, lead = null) => resolveEstimateInvoiceCustomer({ estimate: { company_id: 'yicn', ...estimate }, lead, customers });

// 1. explicit id and base44 alias
assert.equal(r({ customer_id: 'cust-greg' }).customer.id, 'cust-greg');
assert.equal(r({ customer_id: 'b44-greg' }).via, 'customer_id');
assert.equal(r({ customer_id: 'b44-greg' }).customer.id, 'cust-greg');
// 2. estimate made against a lead / typed name: INV-2026-0446 case
assert.equal(r({ customer_name: 'Greg Curry', customer_email: '' }).customer.id, 'cust-greg');
assert.equal(r({ customer_name: '  greg   CURRY ' }).via, 'name');
assert.equal(r({ customer_name: 'G. Curry', customer_email: 'GREG@example.test' }).via, 'email');
assert.equal(r({ customer_name: '' }, all, { name: 'Greg Curry', email: '' }).customer.id, 'cust-greg');
// 3. never another company, never a guess
assert.equal(r({ customer_name: 'Greg Curry' }, [elsewhere]).customer, null);
assert.equal(r({ customer_name: 'Greg Curry' }, [greg, otherGreg]).reason, 'ambiguous-name');
assert.equal(r({ customer_name: 'Greg Curry', customer_email: 'g2@example.test' }, [greg, otherGreg]).customer.id, 'cust-greg-2');
assert.equal(r({ customer_name: 'Nobody' }).reason, 'no-match');
// stale id falls back to the estimate's identity
assert.equal(r({ customer_id: 'deleted-id', customer_name: 'Wanda Simpson' }).customer.id, 'cust-wanda');

assert.deepEqual(candidateQueryParams({ estimate: { company_id: 'yicn', customer_id: ' x ', customer_email: 'A@B.c', customer_name: ' Greg  Curry ' }, lead: { email: 'a@b.c', name: 'Greg Curry' } }),
  ['yicn', 'x', ['a@b.c'], ['greg curry']]);

// Profile: unlinked invoice from one of the profile's estimates shows, even with a different typed name
const invoices = [
  { id: 'inv-0446', company_id: 'yicn', customer_id: '', customer_name: 'Gregory Curry', estimate_id: 'est-1' },
  { id: 'inv-data', company_id: 'yicn', customer_id: '', customer_name: 'x', data: { estimate_id: 'est-1' } },
  { id: 'inv-other-est', company_id: 'yicn', customer_id: '', customer_name: 'Someone', estimate_id: 'est-9' },
  { id: 'inv-linked-other', company_id: 'yicn', customer_id: 'cust-wanda', customer_name: 'Greg Curry', estimate_id: 'est-1' },
];
assert.deepEqual(getInvoicesForCustomerProfile(invoices, greg, { estimateIds: ['est-1'] }).map((i) => i.id), ['inv-0446', 'inv-data']);
assert.deepEqual(getInvoicesForCustomerProfile(invoices, greg).map((i) => i.id), []);

for (const sql of [ESTIMATE_CUSTOMER_CANDIDATES_SQL, UNLINKED_ESTIMATE_INVOICES_SQL]) {
  assert.doesNotMatch(sql, /\b(UPDATE|DELETE|INSERT|ALTER|DROP|TRUNCATE)\b/i);
}
assert.match(describeResolution({ customer: greg, via: 'name' }), /not applied/);
assert.match(describeResolution({ customer: null, reason: 'ambiguous-name' }), /no safe match/);

(async () => {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    assert.equal(await main([], { DATABASE_URL: 'postgres://u:secret@db.example.com/prod' }), 0);
  } finally { console.log = orig; }
  assert.match(logs.join('\n'), /No database connection was opened/);
  assert.doesNotMatch(logs.join('\n'), /secret/);
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  try {
    assert.equal(await main(['--execute'], { DATABASE_URL: 'postgres://u:secret@db.example.com/prod' }), 2);
  } finally { console.error = origErr; }
  assert.match(errs.join('\n'), /Refusing to connect/);
  console.log('estimate -> invoice customer link tests passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
