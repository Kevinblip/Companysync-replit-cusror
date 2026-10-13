#!/usr/bin/env node
/**
 * Payments must never be attributed to the wrong customer.
 *
 * The real incident this guards against: two unrelated invoices both numbered
 * INV-2026-0385 (one for "Sohl, Chad", one for "Beverly Owens-Jackson"). The
 * customer profile claimed payments by matching that number, then auto-rewrote
 * customer_id to whoever's profile had just been opened — so $25,744.19 of
 * Chad's money showed up, and got permanently re-stamped, onto Beverly's file.
 *
 * Run: node scripts/test-payment-ownership.cjs
 */

const fs = require('fs');
const path = require('path');

// The util is an ES module and this is a CJS script; transpile the handful of
// `export` keywords away rather than pulling in a bundler.
const utilPath = path.join(__dirname, '..', 'src', 'utils', 'paymentOwnership.js');
const src = fs.readFileSync(utilPath, 'utf8').replace(/^export\s+function/gm, 'function');
const moduleFns = {};
new Function(
  'exports',
  `${src}\nexports.sameName = sameName;
   exports.findUnknownInvoiceIds = findUnknownInvoiceIds;
   exports.findForeignInvoiceIds = findForeignInvoiceIds;
   exports.rejectForeignPayments = rejectForeignPayments;
   exports.selectPaymentsToRelink = selectPaymentsToRelink;
   exports.pickInvoiceForPayment = pickInvoiceForPayment;
   exports.getPaymentPayerDetails = getPaymentPayerDetails;
   exports.paymentPayerDiffersFromCustomer = paymentPayerDiffersFromCustomer;`
)(moduleFns);

const {
  sameName,
  findUnknownInvoiceIds,
  findForeignInvoiceIds,
  rejectForeignPayments,
  selectPaymentsToRelink,
  pickInvoiceForPayment,
  getPaymentPayerDetails,
  paymentPayerDiffersFromCustomer,
} = moduleFns;

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
}

// ── Real production shapes, taken from the incident ────────────────────────
const CHAD = { id: 'cust_chad', name: 'Sohl, Chad' };
const BEVERLY = { id: 'local_1781945125171_o1obbfv6o', name: 'Beverly Owens-Jackson' };
const CHAD_INVOICE = {
  id: 'inv_1781649945868_w1midi5ea',
  invoice_number: 'INV-2026-0385',
  customer_name: 'Sohl, Chad',
};
const BEVERLY_INVOICE = {
  id: 'inv_1782911040494_xaui6rds8',
  invoice_number: 'INV-2026-0385', // same number, different customer
  customer_name: 'Beverly Owens-Jackson',
};
// All three already mis-stamped with Beverly's customer_id by the old reconcile.
const CHADS_PAYMENTS = [
  { id: 'pay_a', amount: 15394.19, invoice_id: CHAD_INVOICE.id, invoice_number: 'INV-2026-0385', customer_id: BEVERLY.id, customer_name: BEVERLY.name },
  { id: 'pay_b', amount: 4650.00, invoice_id: CHAD_INVOICE.id, invoice_number: 'INV-2026-0385', customer_id: BEVERLY.id, customer_name: BEVERLY.name },
  { id: 'pay_c', amount: 5700.00, invoice_id: CHAD_INVOICE.id, invoice_number: 'INV-2026-0385', customer_id: BEVERLY.id, customer_name: BEVERLY.name },
];

console.log('\nname matching');
check('exact', sameName('Sohl, Chad', 'Sohl, Chad'), true);
check('case + whitespace insensitive', sameName('  beverly owens-jackson ', 'Beverly Owens-Jackson'), true);
check('different people never match', sameName('Sohl, Chad', 'Beverly Owens-Jackson'), false);
check('empty never matches empty', sameName('', ''), false);
check('null never matches', sameName(null, 'Sohl, Chad'), false);
check('undefined never matches', sameName(undefined, undefined), false);

console.log('\nfinding invoices worth looking up');
check(
  'a payment on an unknown invoice is flagged for lookup',
  findUnknownInvoiceIds(CHADS_PAYMENTS, new Set([BEVERLY_INVOICE.id])),
  [CHAD_INVOICE.id]
);
check(
  'payments on our own invoices need no lookup',
  findUnknownInvoiceIds(CHADS_PAYMENTS, new Set([CHAD_INVOICE.id])),
  []
);
check(
  'duplicate invoice ids are collapsed',
  findUnknownInvoiceIds(CHADS_PAYMENTS, new Set()).length,
  1
);
check('payments with no invoice_id need no lookup', findUnknownInvoiceIds([{ id: 'p', customer_id: 'x' }], new Set()), []);
check('empty input is safe', findUnknownInvoiceIds(null, null), []);

console.log('\nidentifying another customer\'s invoices');
check(
  'Chad\'s invoice is foreign when viewed from Beverly\'s profile',
  [...findForeignInvoiceIds([CHAD_INVOICE], { customerId: BEVERLY.id, customerName: BEVERLY.name })],
  [CHAD_INVOICE.id]
);
check(
  'Chad\'s invoice is NOT foreign on Chad\'s own profile',
  [...findForeignInvoiceIds([CHAD_INVOICE], { customerId: CHAD.id, customerName: CHAD.name })],
  []
);
check(
  'matched by customer_id even when the name differs',
  [...findForeignInvoiceIds(
    [{ id: 'inv_x', customer_id: CHAD.id, customer_name: 'Chad Sohl (typo)' }],
    { customerId: CHAD.id, customerName: CHAD.name }
  )],
  []
);
check(
  'matched by name even when customer_id is blank (the production case)',
  [...findForeignInvoiceIds(
    [{ id: 'inv_y', customer_id: '', customer_name: 'Beverly Owens-Jackson' }],
    { customerId: BEVERLY.id, customerName: BEVERLY.name }
  )],
  []
);
check(
  'an invoice we could not load is NEVER called foreign',
  [...findForeignInvoiceIds([null, undefined], { customerId: BEVERLY.id, customerName: BEVERLY.name })],
  []
);

console.log('\nwhat shows on the profile');
{
  // Beverly's page: the three payments arrive via the shared invoice number.
  const foreign = findForeignInvoiceIds([CHAD_INVOICE], { customerId: BEVERLY.id, customerName: BEVERLY.name });
  const shown = rejectForeignPayments(CHADS_PAYMENTS, foreign);
  check('Chad\'s payments do not appear on Beverly\'s profile', shown, []);
  check(
    'Beverly\'s total is no longer inflated by $25,744.19',
    shown.reduce((s, p) => s + p.amount, 0),
    0
  );
}
{
  // Chad's page: same payments, his invoice — all three belong.
  const foreign = findForeignInvoiceIds([], { customerId: CHAD.id, customerName: CHAD.name });
  const shown = rejectForeignPayments(CHADS_PAYMENTS, foreign);
  check('all three still appear on Chad\'s profile', shown.length, 3);
  check('Chad\'s total is intact', Number(shown.reduce((s, p) => s + p.amount, 0).toFixed(2)), 25744.19);
}
check(
  'a payment with no invoice_id is never hidden',
  rejectForeignPayments([{ id: 'p1', customer_id: BEVERLY.id }], new Set(['inv_anything'])).length,
  1
);
check('nothing foreign means nothing is dropped', rejectForeignPayments(CHADS_PAYMENTS, new Set()).length, 3);

console.log('\nwho gets re-stamped (the corruption itself)');
{
  // Beverly's profile must NOT claim Chad's payments.
  const toFix = selectPaymentsToRelink(CHADS_PAYMENTS, {
    customerId: BEVERLY.id,
    customerName: BEVERLY.name,
    myInvoiceIds: [BEVERLY_INVOICE.id],
  });
  check('Beverly\'s profile claims none of Chad\'s payments', toFix, []);
}
{
  // Chad's profile SHOULD reclaim them — invoice_id is authoritative, so the
  // mis-stamped rows heal the next time his profile is opened.
  const toFix = selectPaymentsToRelink(CHADS_PAYMENTS, {
    customerId: CHAD.id,
    customerName: CHAD.name,
    myInvoiceIds: [CHAD_INVOICE.id],
  });
  check('Chad\'s profile reclaims all three', toFix.map(p => p.id), ['pay_a', 'pay_b', 'pay_c']);
}
{
  // The ping-pong: alternating page views must reach a stable state, not flip.
  let owner = BEVERLY.id;
  const rows = CHADS_PAYMENTS.map(p => ({ ...p }));
  const visit = (cust, invIds) => {
    const toFix = selectPaymentsToRelink(rows, { customerId: cust.id, customerName: cust.name, myInvoiceIds: invIds });
    for (const p of toFix) { p.customer_id = cust.id; p.customer_name = cust.name; }
    owner = rows[0].customer_id;
  };
  visit(CHAD, [CHAD_INVOICE.id]);
  check('after visiting Chad, the payments are his', owner, CHAD.id);
  visit(BEVERLY, [BEVERLY_INVOICE.id]);
  check('visiting Beverly does not steal them back', owner, CHAD.id);
  visit(BEVERLY, [BEVERLY_INVOICE.id]);
  visit(CHAD, [CHAD_INVOICE.id]);
  visit(BEVERLY, [BEVERLY_INVOICE.id]);
  check('ownership is stable across repeated visits', owner, CHAD.id);
}
check(
  'a genuine orphan with a matching name IS adopted',
  selectPaymentsToRelink(
    [{ id: 'orphan', customer_id: null, customer_name: 'Beverly Owens-Jackson' }],
    { customerId: BEVERLY.id, customerName: BEVERLY.name, myInvoiceIds: [] }
  ).map(p => p.id),
  ['orphan']
);
check(
  'an orphan with a different name is not adopted',
  selectPaymentsToRelink(
    [{ id: 'orphan2', customer_id: null, customer_name: 'Sohl, Chad' }],
    { customerId: BEVERLY.id, customerName: BEVERLY.name, myInvoiceIds: [] }
  ),
  []
);
check(
  'a payment already owned by someone else is not taken on a name match alone',
  selectPaymentsToRelink(
    [{ id: 'owned', customer_id: 'cust_other', customer_name: 'Beverly Owens-Jackson' }],
    { customerId: BEVERLY.id, customerName: BEVERLY.name, myInvoiceIds: [] }
  ),
  []
);
check(
  'the "Patricia" → "Patricia hallick" repair still works via invoice_id',
  selectPaymentsToRelink(
    [{ id: 'pat', customer_id: 'stale_id', customer_name: 'Patricia', invoice_id: 'inv_pat' }],
    { customerId: 'cust_pat', customerName: 'Patricia hallick', myInvoiceIds: ['inv_pat'] }
  ).map(p => p.id),
  ['pat']
);
check(
  'payments already correctly owned are left alone',
  selectPaymentsToRelink(
    [{ id: 'fine', customer_id: BEVERLY.id, customer_name: BEVERLY.name }],
    { customerId: BEVERLY.id, customerName: BEVERLY.name, myInvoiceIds: [] }
  ),
  []
);
check('empty input is safe', selectPaymentsToRelink(null, { customerId: 'x', customerName: 'y', myInvoiceIds: [] }), []);

section('payer identity audit trail');
check(
  'customer_email is not misrepresented as the payer',
  getPaymentPayerDetails({ customer_email: 'timmbland@gmail.com' }),
  { name: '', email: '' }
);
check(
  'new payer fields take precedence over legacy fields',
  getPaymentPayerDetails({ payer_name: 'Timothy Bland', payer_email: 'tim@example.com', customer_email: 'old@example.com' }),
  { name: 'Timothy Bland', email: 'tim@example.com' }
);
check(
  'an explicitly recorded payer email is flagged for review',
  paymentPayerDiffersFromCustomer({ payer_email: 'timmbland@gmail.com' }, { email: 'j2dagee@sbcglobal.net' }),
  true
);
check(
  'same payer email is not flagged',
  paymentPayerDiffersFromCustomer({ payer_email: 'J2DAGEE@sbcglobal.net' }, { email: 'j2dagee@sbcglobal.net' }),
  false
);

// ---------------------------------------------------------------------------
section('invoices with no owner recorded on them');

check(
  'an invoice with neither id nor name is NOT called foreign (unknown is not proof)',
  [...findForeignInvoiceIds(
    [{ id: 'inv_blank', customer_id: null, customer_name: '' }],
    { customerId: BEVERLY.id, customerName: BEVERLY.name }
  )],
  []
);
check(
  'and its payment therefore stays visible',
  rejectForeignPayments(
    [{ id: 'p1', amount: 500, invoice_id: 'inv_blank' }],
    new Set([...findForeignInvoiceIds(
      [{ id: 'inv_blank', customer_id: null, customer_name: '   ' }],
      { customerId: BEVERLY.id, customerName: BEVERLY.name }
    )])
  ).map(p => p.id),
  ['p1']
);

section('duplicate customer names never beat an explicit customer_id');

check(
  "an invoice explicitly owned by someone else is foreign even when the names match",
  [...findForeignInvoiceIds(
    [{ id: 'inv_twin', customer_id: 'cust_other_beverly', customer_name: BEVERLY.name }],
    { customerId: BEVERLY.id, customerName: BEVERLY.name }
  )],
  ['inv_twin']
);
check(
  'an invoice explicitly owned by me is mine even when the name is spelled differently',
  [...findForeignInvoiceIds(
    [{ id: 'inv_mine', customer_id: BEVERLY.id, customer_name: 'B. Owens Jackson' }],
    { customerId: BEVERLY.id, customerName: BEVERLY.name }
  )],
  []
);
check(
  'two customer records for the same person do not ping-pong a payment between them',
  selectPaymentsToRelink(
    [{ id: 'dupe', customer_id: 'cust_beverly_copy', customer_name: BEVERLY.name, invoice_id: 'inv_shared' }],
    { customerId: BEVERLY.id, customerName: BEVERLY.name, myInvoiceIds: ['inv_shared'] }
  ),
  []
);
check(
  'but a payment stamped with a DIFFERENT name is still reclaimed (the Chad repair)',
  selectPaymentsToRelink(
    [{ id: 'chad1', customer_id: BEVERLY.id, customer_name: BEVERLY.name, invoice_id: 'inv_chad' }],
    { customerId: CHAD.id, customerName: CHAD.name, myInvoiceIds: ['inv_chad'] }
  ).map(p => p.id),
  ['chad1']
);

section('picking the right invoice when the number is not unique');

const DUP_A = { id: 'inv_chad', invoice_number: 'INV-2026-0385', customer_id: null, customer_name: CHAD.name };
const DUP_B = { id: 'inv_bev', invoice_number: 'INV-2026-0385', customer_id: null, customer_name: BEVERLY.name };

check(
  'a single match is used as-is',
  pickInvoiceForPayment([DUP_A], { customerName: CHAD.name }).invoice?.id,
  'inv_chad'
);
check(
  'duplicates are split by customer name',
  pickInvoiceForPayment([DUP_A, DUP_B], { customerName: BEVERLY.name }).invoice?.id,
  'inv_bev'
);
check(
  'duplicates are split by customer id when present',
  pickInvoiceForPayment(
    [{ ...DUP_A, customer_id: CHAD.id }, { ...DUP_B, customer_id: BEVERLY.id }],
    { customerId: CHAD.id, customerName: 'who knows' }
  ).invoice?.id,
  'inv_chad'
);
check(
  'an undecidable duplicate is refused rather than guessed',
  pickInvoiceForPayment([DUP_A, DUP_B], { customerName: 'Someone Else' }).ambiguous,
  true
);
check(
  'and no invoice is returned when it is refused',
  pickInvoiceForPayment([DUP_A, DUP_B], { customerName: 'Someone Else' }).invoice,
  null
);
check(
  'two invoices for the SAME customer sharing a number are also refused',
  pickInvoiceForPayment(
    [DUP_B, { ...DUP_B, id: 'inv_bev2' }],
    { customerName: BEVERLY.name }
  ).ambiguous,
  true
);
check('no candidates is not ambiguous', pickInvoiceForPayment([], { customerName: CHAD.name }).ambiguous, false);
check('null candidates is safe', pickInvoiceForPayment(null, {}).invoice, null);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
