#!/usr/bin/env node
'use strict';

const fs = require('fs');
const assert = require('node:assert/strict');
async function run() {
  const { resolveCustomerCompanyId, normalizeAssignmentStaff } = await import('../src/utils/customerStaffAssignment.js');
  assert.equal(resolveCustomerCompanyId(undefined, 'selected-company'), 'selected-company');
  assert.equal(resolveCustomerCompanyId({ id: 'loaded-company' }, 'selected-company'), 'loaded-company');
  assert.equal(resolveCustomerCompanyId(undefined, null), null);
  const rows = normalizeAssignmentStaff([
    { id: 'one', user_email: '   ', email: ' First@Example.test ', name: 'First Staff' },
    { id: 'duplicate', user_email: 'first@example.test' },
    { id: 'two', data: { user_email: 'second@example.test', full_name: 'Second Staff' } },
    { id: 'no-address', full_name: 'No Address' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].user_email, 'first@example.test');
  assert.equal(rows[0].full_name, 'First Staff');
  assert.equal(rows[1].user_email, 'second@example.test');
  const customers = fs.readFileSync('src/pages/Customers.jsx', 'utf8');
  const picker = fs.readFileSync('src/components/customers/StaffMultiSelect.jsx', 'utf8');
  assert.match(customers, /StaffProfile\.filter\(\{ company_id: assignmentCompanyId \}/);
  assert.match(customers, /const companyId = assignmentCompanyId/);
  assert.match(picker, /onClick=\{event => event\.stopPropagation\(\)\}/);
  assert.match(picker, /Could not load staff/);
  assert.doesNotMatch(customers, /<SheetContent[^>]*z-\[100\]/);
  console.log('PASS: customer assignment company resolution, legacy staff normalization, single-toggle checkbox and load-error handling.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });