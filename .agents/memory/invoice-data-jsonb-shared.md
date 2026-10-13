---
name: Invoice data JSONB is shared storage
description: Why every invoice write must merge into the data column, the dev/prod merge-order drift that can revert an edit, and the decision that supplement_amount is not billed money.
---

# `invoices.data` is shared storage — merge, never replace

Several unrelated parts of the app keep keys in the invoice's `data` JSONB:
the estimate link (`estimate_id`, looked up with `data->>'estimate_id'`),
change-order / revision bookkeeping, job links, and the invoice editor's own
non-column fields (deposit, discount, adjustment, supplement, depreciation).

**Rule:** a write path that sends its own small object for `data` is saying
"replace the column". Build the payload from the stored object and overlay.

**Why:** a deposit edit that ships `data: { deposit_type, deposit_value }`
destroys every other key the moment any write path honours the replace intent.
The loss is silent — no error, nothing in the UI, and the invoice keeps working
until something tries to find it by estimate.

**How to apply:** merge in the client payload AND assume nothing about the
server's merge semantics (see below).

## Dev/prod merge-order drift on jsonb folding

The entity layer folds unknown (non-column) payload keys into `data` and
applies the patch with jsonb `||`. Precedence for a key present BOTH in an
explicit `data` object and as a folded top-level field differs by environment:
dev lets the explicit object win, prod lets the folded field win.

**Why it bites:** once the payload echoes the stored `data` back, a field the
user just edited exists twice — old value inside `data`, new value at top
level. One environment saves the edit, the other reverts it.

**How to apply:** never let a payload carry two different values for one key.
Refresh every stored key the form also has a current value for, then assert in
a test that both merge orders produce an identical row.

## Decision: `supplement_amount` is a reference note, not billed money

It does not affect the invoice total, the balance, or anything collected; the
"Insurance Pays" figure excludes it and the UI labels it "not billed".

**Why:** invoice money is line-item math (subtotal − discount + adjustment) and
payments derive from that total. A free-typed number added to a total has no
line item behind it and is invisible to the PDF, the customer portal, the
accounting sync, and the change-order delta rules.

**How to apply:** approved supplement work reaches money as line items or as a
change order (which bills its net delta) — never as a scalar added to a total.
