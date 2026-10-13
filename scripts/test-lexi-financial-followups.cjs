'use strict';

const assert = require('assert');
const { expandFinancialFollowup } = require('../lib/lexiFollowupContext.cjs');

const financialHistory = [
  { role: 'user', content: 'How much did we earn this month?' },
  { role: 'assistant', content: "This month, we've collected $108,652.68 in payments and issued 13 invoices." },
];

const yearly = expandFinancialFollowup('what about for the year?', financialHistory);
assert.match(yearly, /period "this_year"/);
assert.match(yearly, /get_financial_summary/);

const monthly = expandFinancialFollowup('and this month?', financialHistory);
assert.match(monthly, /period "this_month"/);

assert.equal(
  expandFinancialFollowup('what about for the year?', [{ role: 'assistant', content: 'I found three customers in Ohio.' }]),
  'what about for the year?'
);

console.log('Lexi financial follow-up expansion checks passed.');