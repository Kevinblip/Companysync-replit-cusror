#!/usr/bin/env node
/**
 * Estimate adjustment → invoice line, and the confirmed invoice update.
 *
 * Anita and Greg Curry (AB Squared LTD): the estimate Adjustment of +$1,755
 * for wrapping 27 windows brought the estimate RCV to $22,205, but linked
 * invoice INV-2026-0443 stayed at $20,450 after a $10,000 payment. The
 * adjustment lived only on the estimate field, so the invoice never gained a
 * line and nothing on the estimate could push the change across.
 *
 * No database and no network. Usage: node scripts/test-estimate-invoice-sync.cjs
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ADJUSTMENT_CODE,
  invoiceDraftFromEstimate,
  previewEstimateInvoiceUpdate,
  buildLinkedInvoiceUpdate,
  assertSafeInvoiceUpdate,
  coerceLineItems,
  blankInvoiceLine,
} = require('../lib/estimateInvoiceSync.cjs');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function curryEstimate(overrides = {}) {
  return {
    id: 'est_curry',
    estimate_number: 'EST-CURRY',
    customer_name: 'Anita and Greg Curry',
    company_id: 'co_absquared',
    total_amount: 22205,
    amount: 22205,
    adjustment_amount: 1755,
    adjustment_label: 'wrapping 27 windows',
    discount_type: 'none',
    discount_value: 0,
    items: [
      { description: 'Window package', quantity: 1, rate: 10000, amount: 10000 },
      { description: 'Remaining scope', quantity: 1, rate: 10450, amount: 10450 },
    ],
    data: {},
    ...overrides,
  };
}

function curryInvoice(overrides = {}) {
  return {
    id: 'inv_curry',
    invoice_number: 'INV-2026-0443',
    company_id: 'co_absquared',
    status: 'partially_paid',
    total_amount: 20450,
    amount: 20450,
    amount_paid: 10000,
    items: [
      { description: 'Window package', quantity: 1, rate: 10000, amount: 10000 },
      { description: 'Remaining scope', quantity: 1, rate: 10450, amount: 10450 },
    ],
    data: {
      estimate_id: 'est_curry',
      estimate_number: 'EST-CURRY',
      job_id: 'job_curry',
    },
    ...overrides,
  };
}

function sumAmounts(items) {
  return Math.round(items.reduce((sum, item) => sum + Number(item.amount || 0), 0) * 100) / 100;
}

function main() {
  const draft = invoiceDraftFromEstimate(curryEstimate());
  const adjustment = draft.items.find((item) => item.code === ADJUSTMENT_CODE);
  assert.ok(adjustment, 'conversion adds an adjustment line');
  assert.equal(adjustment.description, 'Adjustment: wrapping 27 windows');
  assert.equal(adjustment.amount, 1755);
  assert.equal(adjustment.quantity, 1);
  assert.equal(draft.total, 22205);
  assert.equal(sumAmounts(draft.items), 22205, 'the adjustment is in the total once');
  assert.equal(draft.items.filter((item) => item.code === ADJUSTMENT_CODE).length, 1);

  const alreadyIncluded = invoiceDraftFromEstimate(curryEstimate({
    total_amount: 22205,
    amount: 22205,
  }));
  assert.equal(alreadyIncluded.total, 22205);
  assert.equal(sumAmounts(alreadyIncluded.items), 22205);

  const staleTotal = invoiceDraftFromEstimate(curryEstimate({
    total_amount: 20450,
    amount: 20450,
  }));
  assert.equal(staleTotal.total, 22205, 'a total saved before the adjustment still picks the field up');
  assert.equal(sumAmounts(staleTotal.items), 22205);

  const noAdjustment = invoiceDraftFromEstimate(curryEstimate({
    adjustment_amount: 0,
    adjustment_label: '',
    total_amount: 20450,
    amount: 20450,
  }));
  assert.equal(noAdjustment.items.some((item) => item.code === ADJUSTMENT_CODE), false);
  assert.equal(noAdjustment.total, 20450);

  const credit = invoiceDraftFromEstimate(curryEstimate({
    adjustment_amount: -500,
    adjustment_label: 'courtesy',
    total_amount: 19950,
    amount: 19950,
  }));
  const creditLine = credit.items.find((item) => item.code === ADJUSTMENT_CODE);
  assert.equal(creditLine.amount, -500);
  assert.equal(credit.total, 19950);

  const fromDataOnly = invoiceDraftFromEstimate({
    id: 'est_generic',
    items: [{ description: 'Scope', quantity: 1, amount: 20450 }],
    data: { adjustment_amount: 1755, adjustment_label: 'wrapping 27 windows', amount: 22205 },
  });
  assert.equal(fromDataOnly.total, 22205);
  assert.equal(fromDataOnly.items.at(-1).description, 'Adjustment: wrapping 27 windows');

  const preview = previewEstimateInvoiceUpdate(curryInvoice(), curryEstimate());
  assert.equal(preview.added.length, 1);
  assert.equal(preview.added[0].description, 'Adjustment: wrapping 27 windows');
  assert.equal(preview.added[0].amount, 1755);
  assert.deepEqual(preview.removed, []);
  assert.deepEqual(preview.changed, []);
  assert.equal(preview.previousTotal, 20450);
  assert.equal(preview.nextTotal, 22205);
  assert.equal(preview.amountPaid, 10000);
  assert.equal(preview.amountDue, 12205);
  assert.equal(preview.notifiesCustomer, false);
  assert.equal(preview.touchesPayments, false);
  assert.equal(preview.nextStatus, null);

  const { payload } = buildLinkedInvoiceUpdate(curryInvoice(), curryEstimate());
  assert.equal(payload.total_amount, 22205);
  assert.equal(payload.amount_paid, undefined);
  assert.equal(payload.data.estimate_id, 'est_curry');
  assert.equal(payload.data.job_id, 'job_curry');
  assert.equal(payload.data.adjustment_amount, 0, 'the line carries the adjustment, so the field is not added again');
  assert.equal(payload.items.filter((item) => item.code === ADJUSTMENT_CODE).length, 1);
  assert.equal(payload.status, undefined, 'partially paid stays partially paid');
  assert.equal(payload.discount_type, undefined);

  const discounted = buildLinkedInvoiceUpdate(
    curryInvoice({
      discount_type: 'percentage',
      discount_value: 10,
      data: { estimate_id: 'est_curry', discount_type: 'percentage', discount_value: 10 },
    }),
    curryEstimate({
      discount_type: 'percentage',
      discount_value: 10,
      total_amount: 20160,
      amount: 20160,
    })
  );
  assert.equal(discounted.payload.discount_type, 'none');
  assert.equal(discounted.payload.data.discount_value, 0);
  assert.equal(discounted.payload.data.estimate_id, 'est_curry');
  assert.ok(discounted.payload.items.some((item) => item.description === 'Discount (10%)' && item.amount === -2045));
  assert.doesNotThrow(() => assertSafeInvoiceUpdate(payload));
  for (const key of Object.keys(payload)) {
    assert.equal(/email|sms|text|receipt|notify/i.test(key), false, key);
  }

  const second = previewEstimateInvoiceUpdate(
    { ...curryInvoice(), total_amount: 22205, items: payload.items, amount_paid: 10000 },
    curryEstimate()
  );
  assert.equal(second.added.length, 0);
  assert.equal(second.removed.length, 0);
  assert.equal(second.changed.length, 0);

  const raised = curryEstimate({
    adjustment_amount: 2000,
    adjustment_label: 'wrapping 27 windows',
    total_amount: 22450,
    amount: 22450,
  });
  const raisedPreview = previewEstimateInvoiceUpdate(
    { ...curryInvoice(), total_amount: 22205, items: payload.items, amount_paid: 10000 },
    raised
  );
  assert.equal(raisedPreview.added.length, 0);
  assert.equal(raisedPreview.changed.length, 1);
  assert.equal(raisedPreview.changed[0].before.amount, 1755);
  assert.equal(raisedPreview.changed[0].after.amount, 2000);
  assert.equal(raisedPreview.amountPaid, 10000);

  const removedScope = curryEstimate({
    items: [{ description: 'Window package', quantity: 1, rate: 10000, amount: 10000 }],
    adjustment_amount: 1755,
    total_amount: 11755,
    amount: 11755,
  });
  const removedPreview = previewEstimateInvoiceUpdate(curryInvoice(), removedScope);
  assert.equal(removedPreview.removed.length, 1);
  assert.equal(removedPreview.removed[0].description, 'Remaining scope');
  assert.equal(removedPreview.added[0].description, 'Adjustment: wrapping 27 windows');

  const changedQty = previewEstimateInvoiceUpdate(
    curryInvoice(),
    curryEstimate({
      items: [
        { description: 'Window package', quantity: 2, rate: 10000, amount: 20000 },
        { description: 'Remaining scope', quantity: 1, rate: 10450, amount: 10450 },
      ],
      adjustment_amount: 0,
      adjustment_label: '',
      total_amount: 30450,
      amount: 30450,
    })
  );
  assert.equal(changedQty.changed.length, 1);
  assert.equal(changedQty.changed[0].before.quantity, 1);
  assert.equal(changedQty.changed[0].after.quantity, 2);
  assert.equal(changedQty.added.length, 0);

  const paidOff = buildLinkedInvoiceUpdate(
    curryInvoice({ amount_paid: 22205, status: 'partially_paid' }),
    curryEstimate()
  );
  assert.equal(paidOff.payload.status, 'paid');
  assert.equal(paidOff.payload.amount_paid, undefined);

  assert.throws(
    () => assertSafeInvoiceUpdate({ amount_paid: 10000, total_amount: 1 }),
    /amount paid/
  );
  assert.throws(
    () => assertSafeInvoiceUpdate({ send_email: true, total_amount: 1 }),
    /notify/
  );

  assert.deepEqual(coerceLineItems({ items: [], data: { items: [{ description: 'Hidden', amount: 40 }] } }), [
    { description: 'Hidden', quantity: 1, rate: 0, amount: 40 },
  ]);
  assert.deepEqual(coerceLineItems('[{"description":"Parsed","quantity":2,"rate":3,"amount":6}]'), [
    { description: 'Parsed', quantity: 2, rate: 3, amount: 6 },
  ]);
  assert.deepEqual(blankInvoiceLine(), { description: '', quantity: 1, rate: 0, amount: 0 });
  const manual = [...coerceLineItems(null), blankInvoiceLine()];
  assert.equal(manual.length, 1);
  assert.equal(manual[0].description, '');

  const devFunctions = read('vite-functions-plugin.js');
  const converterStart = devFunctions.indexOf('async convertEstimateToInvoice(');
  const converterEnd = devFunctions.indexOf('async updateLeadScore(', converterStart);
  const converter = devFunctions.slice(converterStart, converterEnd);
  assert.match(converter, /invoiceDraftFromEstimate\(estimate\)/);
  assert.match(converter, /SELECT id FROM customers WHERE id = \$1 AND company_id = \$2/);
  assert.doesNotMatch(converter, /SendEmail|sendSMS|sendInvoiceEmail/);

  const syncStart = devFunctions.indexOf('async syncEstimateAdjustmentToInvoice(');
  const sync = devFunctions.slice(syncStart, converterStart);
  assert.match(sync, /buildLinkedInvoiceUpdate\(/);
  assert.doesNotMatch(sync, /amount_paid\s*=/);
  assert.doesNotMatch(sync, /SendEmail|sendSMS|sendInvoiceEmail/);

  const prodSync = read('db/prod-integrations.cjs');
  const prodStart = prodSync.indexOf("if (functionName === 'syncEstimateAdjustmentToInvoice')");
  const prodEnd = prodSync.indexOf("if (functionName === 'updatePublicEstimateStatus')", prodStart);
  const prodBody = prodSync.slice(prodStart, prodEnd);
  assert.match(prodBody, /buildLinkedInvoiceUpdate\(/);
  assert.doesNotMatch(prodBody, /amount_paid\s*=/);
  assert.doesNotMatch(prodBody, /SendEmail|sendSMS/);

  const editor = read('src/pages/EstimateEditor.jsx');
  assert.match(editor, /Update invoice from estimate/);
  assert.match(editor, /menu-update-invoice-from-estimate/);
  assert.match(editor, /button-confirm-update-invoice/);
  assert.doesNotMatch(editor, /syncEstimateAdjustmentToInvoice/);
  assert.match(editor, /No email, text, or receipt is sent/);

  const invoicePage = read('src/pages/invoice-details.jsx');
  assert.match(invoicePage, /button-add-invoice-line/);
  assert.match(invoicePage, /blankInvoiceLine\(\)/);
  assert.match(invoicePage, /coerceLineItems\(invoice\)/);

  const deployed = read('functions/convertEstimateToInvoice.ts');
  assert.match(deployed, /ESTIMATE_ADJUSTMENT/);
  assert.match(deployed, /Adjustment: \$\{adjustmentLabel\}/);
  assert.match(deployed, /email_customer && updatedInvoice\.customer_email/);

  console.log('estimate adjustment invoice sync checks passed');
}

main();
