#!/usr/bin/env node
/**
 * Invoice editor `data` JSONB merge regression test
 * ─────────────────────────────────────────────────
 * The invoice detail page used to save `data: { deposit_type, deposit_value }`,
 * i.e. a payload that means "replace the whole JSONB column". `invoices.data`
 * is shared storage — `estimate_id` (how the app finds the invoice for an
 * estimate), change-order bookkeeping and job links all live there — so a
 * deposit edit expressed that way destroys unrelated data the moment any write
 * path honours the replace intent.
 *
 * Scenarios covered
 * ─────────────────
 *  1. An unrelated key (estimate_id) survives a deposit edit
 *  2. Every other stored key survives too (change-order + job links)
 *  3. The deposit edit itself is applied
 *  4. Clearing the deposit writes the 'none'/0 defaults, keeps the rest
 *  5. An invoice with no existing `data` still gets the deposit fields
 *  6. A non-object `data` (null / array / legacy string) is tolerated
 *  7. Edited flexible fields (supplement_amount, discount_*) are NOT reverted
 *     to their stored values by the merge
 *  8. total_amount is the line-item math only — supplement_amount never
 *     silently inflates it (the recorded product decision: supplement is a
 *     reference note, it reaches the balance only as line items)
 *  9. End-to-end through the DEV entity-layer merge semantics
 * 10. End-to-end through the PROD entity-layer merge semantics
 *     (dev and prod disagree on explicit-vs-folded precedence, so the payload
 *      must be unambiguous — both must land on the same row)
 *
 * Runs in-process; no server or database required.
 *
 * Usage:  node scripts/test-invoice-data-merge.cjs
 */

'use strict';

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    const detail = extra !== undefined ? ` — got ${JSON.stringify(extra)}` : '';
    console.log(`  ✗ ${name}${detail}`);
    failed++;
  }
}

/* ─── entity-layer simulation ──────────────────────────────────────────── */
// Real columns on the `invoices` table (db/schema.js). Anything else in an
// update payload is folded into the `data` JSONB by the entity layer.
const INVOICE_COLUMNS = new Set([
  'id', 'base44_id', 'company_id', 'customer_id', 'customer_name', 'customer_email',
  'invoice_number', 'status', 'total_amount', 'amount_paid', 'total_tax',
  'deductible_amount', 'due_date', 'issue_date', 'project_name', 'sale_agent',
  'insurance_company', 'claim_number', 'policy_number', 'items', 'tags',
  'commission_splits', 'notes', 'created_by', 'data', 'synced_at', 'created_at',
  'updated_at', 'quickbooks_invoice_id',
]);

/**
 * Mirrors genericUpdate (vite-db-plugin.js) / universalUpdate (db/prod-db.cjs)
 * for a dedicated table: known columns are written as columns, unknown keys are
 * folded into a jsonb patch, and the patch is applied with `data || patch`
 * (a shallow merge that keeps untouched keys).
 *
 * `explicitWins` reflects the one difference between the two implementations:
 *   dev  → { ...folded, ...explicit }   (explicit `data` wins)
 *   prod → { ...explicit, ...folded }   (folded fields win)
 */
function applyEntityUpdate(storedData, payload, { explicitWins }) {
  const folded = {};
  let explicit = null;
  for (const [key, val] of Object.entries(payload)) {
    if (key === 'data') {
      if (val && typeof val === 'object' && !Array.isArray(val)) explicit = val;
      continue;
    }
    if (!INVOICE_COLUMNS.has(key)) folded[key] = val;
  }
  const patch = explicitWins
    ? { ...folded, ...(explicit || {}) }
    : { ...(explicit || {}), ...folded };
  return { ...(storedData || {}), ...patch }; // jsonb `||`
}

/* ─── fixtures ─────────────────────────────────────────────────────────── */

function storedInvoice(overrides = {}) {
  return {
    id: 'inv_1',
    customer_name: 'Jane Homeowner',
    total_amount: 10000,
    deductible_amount: 1000,
    items: [{ description: 'Roof', amount: 10000 }],
    data: {
      estimate_id: 'est_42',
      change_order_parent_id: 'est_41',
      job_id: 'job_7',
      supplement_amount: 800,
      depreciation_held: 2200,
      discount_type: 'none',
      discount_value: 0,
      adjustment_amount: 0,
      deposit_type: 'none',
      deposit_value: 0,
    },
    ...overrides,
  };
}

function editFormFor(invoice, overrides = {}) {
  return {
    customer_name: invoice.customer_name || '',
    customer_email: invoice.customer_email || '',
    issue_date: invoice.issue_date || '',
    due_date: invoice.due_date || '',
    items: invoice.items || [],
    notes: invoice.notes || '',
    claim_number: invoice.claim_number || '',
    insurance_company: invoice.insurance_company || '',
    discount_type: invoice.data?.discount_type || 'none',
    discount_value: invoice.data?.discount_value || 0,
    adjustment_amount: invoice.data?.adjustment_amount || 0,
    deposit_type: invoice.data?.deposit_type || 'none',
    deposit_value: invoice.data?.deposit_value || 0,
    deductible_amount: Number(invoice.deductible_amount || 0),
    supplement_amount: Number(invoice.data?.supplement_amount || 0),
    depreciation_held: Number(invoice.data?.depreciation_held || 0),
    ...overrides,
  };
}

/* ─── tests ────────────────────────────────────────────────────────────── */

async function run() {
  const { buildInvoiceUpdatePayload } = await import('../src/utils/invoiceEditorPayload.js');

  console.log('\nInvoice editor data-merge regression');
  console.log('─────────────────────────────────────');

  // 1–3: a plain deposit edit
  {
    const invoice = storedInvoice();
    const form = editFormFor(invoice, { deposit_type: 'percentage', deposit_value: 50 });
    const payload = buildInvoiceUpdatePayload(form, invoice);

    ok('1. estimate_id survives a deposit edit', payload.data.estimate_id === 'est_42', payload.data.estimate_id);
    ok('2. change-order + job keys survive',
      payload.data.change_order_parent_id === 'est_41' && payload.data.job_id === 'job_7',
      payload.data);
    ok('3. deposit edit is applied',
      payload.data.deposit_type === 'percentage' && payload.data.deposit_value === 50,
      { t: payload.data.deposit_type, v: payload.data.deposit_value });
  }

  // 4: clearing the deposit
  {
    const invoice = storedInvoice({ data: { ...storedInvoice().data, deposit_type: 'fixed', deposit_value: 500 } });
    const form = editFormFor(invoice, { deposit_type: 'none', deposit_value: 0 });
    const payload = buildInvoiceUpdatePayload(form, invoice);

    ok('4. clearing the deposit keeps unrelated keys',
      payload.data.deposit_type === 'none' && payload.data.deposit_value === 0 && payload.data.estimate_id === 'est_42',
      payload.data);
  }

  // 5–6: missing / malformed existing data
  {
    const noData = buildInvoiceUpdatePayload(editFormFor({ items: [] }), { id: 'inv_2' });
    ok('5. invoice with no stored data still gets deposit fields',
      noData.data.deposit_type === 'none' && noData.data.deposit_value === 0, noData.data);

    for (const bad of [null, [], 'legacy-string', 42]) {
      const payload = buildInvoiceUpdatePayload(editFormFor({ items: [] }), { id: 'inv_3', data: bad });
      ok(`6. non-object data (${JSON.stringify(bad)}) is tolerated`,
        payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
          && payload.data.deposit_type === 'none',
        payload.data);
    }
  }

  // 7: edits to flexible (non-column) fields are not reverted by the merge
  {
    const invoice = storedInvoice();
    const form = editFormFor(invoice, {
      supplement_amount: 1750,
      discount_type: 'fixed',
      discount_value: 250,
      adjustment_amount: 100,
      deposit_type: 'fixed',
      deposit_value: 2000,
    });
    const payload = buildInvoiceUpdatePayload(form, invoice);

    ok('7. edited supplement/discount/adjustment are not reverted to stored values',
      payload.data.supplement_amount === 1750
      && payload.data.discount_type === 'fixed'
      && payload.data.discount_value === 250
      && payload.data.adjustment_amount === 100,
      payload.data);
  }

  // 8: supplement never inflates the invoice total
  {
    const invoice = storedInvoice();
    const base = buildInvoiceUpdatePayload(editFormFor(invoice), invoice);
    const withSupplement = buildInvoiceUpdatePayload(editFormFor(invoice, { supplement_amount: 5000 }), invoice);

    ok('8a. total_amount is the line-item math (subtotal − discount + adjustment)',
      base.total_amount === 10000 && base.amount === 10000, base.total_amount);
    ok('8b. supplement_amount does not change total_amount',
      withSupplement.total_amount === base.total_amount, withSupplement.total_amount);
  }

  // 9–10: end-to-end through both entity-layer merge orders
  {
    const invoice = storedInvoice();
    const form = editFormFor(invoice, {
      deposit_type: 'percentage',
      deposit_value: 50,
      supplement_amount: 1750,
      discount_type: 'fixed',
      discount_value: 250,
    });
    const payload = buildInvoiceUpdatePayload(form, invoice);

    for (const [label, explicitWins, n] of [['dev', true, 9], ['prod', false, 10]]) {
      const row = applyEntityUpdate(invoice.data, payload, { explicitWins });
      ok(`${n}. ${label}: estimate_id + change-order keys still stored`,
        row.estimate_id === 'est_42' && row.change_order_parent_id === 'est_41' && row.job_id === 'job_7', row);
      ok(`${n}. ${label}: deposit + supplement edits stored`,
        row.deposit_type === 'percentage' && row.deposit_value === 50
        && row.supplement_amount === 1750 && row.discount_value === 250, row);
      ok(`${n}. ${label}: untouched stored key keeps its value`,
        row.depreciation_held === 2200, row.depreciation_held);
    }

    // Both merge orders must produce an identical row — the payload may not
    // depend on dev/prod precedence.
    const devRow = applyEntityUpdate(invoice.data, payload, { explicitWins: true });
    const prodRow = applyEntityUpdate(invoice.data, payload, { explicitWins: false });
    ok('11. dev and prod land on the identical stored row',
      JSON.stringify(devRow) === JSON.stringify(prodRow), { devRow, prodRow });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
