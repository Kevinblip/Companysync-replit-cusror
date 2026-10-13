# Invoice `data` JSONB column & the supplement field

## `invoices.data` is shared storage — always merge, never replace

`invoices.data` holds the flexible per-invoice fields that have no column of
their own. Several unrelated parts of the app write into it:

- `estimate_id` — how an estimate finds its invoice
  (`SELECT ... WHERE data->>'estimate_id' = $1` in `db/prod-integrations.cjs`)
- change-order / revision bookkeeping and job links
- the invoice editor's own non-column fields: `deposit_type`, `deposit_value`,
  `discount_type`, `discount_value`, `adjustment_amount`, `supplement_amount`,
  `depreciation_held`

**Rule:** any write path that touches `data` must merge into the stored object.
A payload such as `data: { deposit_type, deposit_value }` states "replace the
whole column"; the moment a write path honours that intent, editing a deposit
silently destroys every other key — no error, nothing visible in the UI.

The invoice detail editor builds its payload with
`buildInvoiceUpdatePayload()` (`src/utils/invoiceEditorPayload.js`), which
starts from the invoice's existing `data` and overlays the editor's values.
`scripts/test-invoice-data-merge.cjs` (`npm run test:invoice-data-merge`)
locks this in.

### Dev/prod merge-order drift

The entity layer folds unknown (non-column) payload keys into `data` and
applies them with jsonb `||`. The two implementations disagree on precedence
when the same key arrives both inside an explicit `data` object and as a
folded top-level field:

- dev (`vite-db-plugin.js`): the explicit `data` object wins
- prod (`db/prod-db.cjs`): the folded top-level field wins

So a payload must never carry two different values for one key. The builder
refreshes every stored key the form also has a value for, which keeps the two
copies identical and makes the result independent of merge order. The test
asserts dev and prod land on the identical row.

## Decision: `supplement_amount` is a reference note, not billed money

`supplement_amount` does **not** affect `total_amount`, the balance, or
anything collected. It is a recorded approval amount only.

**Why:** invoice money is line-item math — `total_amount` is
`subtotal(items) − discount + adjustment`, and payments/balance derive from
that. Letting a free-typed field add to the total would create an amount with
no line item behind it, invisible to the PDF, the customer portal, QuickBooks
sync and the change-order delta rules, and impossible to reconcile. Approved
supplement work belongs on the invoice the same way as everything else: as
line items (or a change order, which bills its net delta).

**How it is presented:** the "Insurance Pays" figure on the invoice detail page
is `total − depreciation_held − deductible` and excludes the supplement. The
supplement is shown below that figure as "Supplement approved (not billed)"
with a note to add line items to bill it, and the field's helper text says the
same. If the field is ever made to affect money, it must go through line items
rather than being added to a total.
