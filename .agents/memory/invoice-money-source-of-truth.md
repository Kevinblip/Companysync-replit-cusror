---
name: Invoice money source of truth
description: amount_paid/status and dashboard "Paid" must derive from SUM(real payments), never from invoice fields or increment.
---

# Invoice money source of truth

Invoice `amount_paid` and `status` must ALWAYS be recomputed from the SUM of the
invoice's real linked payments — never `previousPaid + amount` (increment) and never
read off the invoice's own stored fields.

**Legacy credit must survive recalculation:** Production also contains cash
payments without an invoice ID. Include them only when company, invoice label,
and customer evidence resolve to one invoice; ambiguous ownership must block
the financial operation, not silently erase the credit.

**Why:** An ID-only sum can turn a valid remaining cash payment into a zero paid
balance when undoing an unrelated fee. Cached subtraction is not a safe remedy:
it can apply twice after a failed deletion and page refresh.

**Accounting pair reversals must be transactional.** Verify ownership, remove
both entries, and recalculate in one server transaction. Client-side linking
followed by separate deletes is not an atomic claim.

**Why:** Two legacy deductions can share a fingerprint. Concurrent browser
requests can both claim one expense, and interrupted requests can leave only
half of the accounting pair.

**How to apply:** Treat legacy matching and balance preservation as part of the
reversal itself; test concurrent claims and retry with other cash payments left.

**Paid-transition UI must use the locked recalculation result.** For prompts or
notifications that should fire only when an invoice newly becomes paid, compare
the recalculator's `previous_status` and `status`; never infer the transition by
adding the latest payment to a cached client `amount_paid`.

**Why:** Closely spaced payments can finish the invoice in the database while
the browser still has the balance from before either payment, so the final
small payment fails a client-side total comparison.

**How to apply:** Return the pre-update status from the same transaction that
recomputes and writes the balance, then trigger paid-only side effects on a
non-paid → paid transition.

When a payment write resolves an `invoice_id`, overwrite the payment's
`invoice_number` and customer identity from that invoice. Do not preserve
caller-entered customer fields after the invoice has been resolved.

**Why:** A payment-entry form can contain a stale customer name or ID even when
its invoice-number lookup correctly identifies the invoice. Persisting both
values creates a payment that is linked by ID to one customer but displayed
under another.

**How to apply:** Build the final payment payload only after invoice resolution;
use the resolved invoice as authoritative for `invoice_id`, display number, and
customer fields. Leave number-only legacy payments subject to explicit review.

- "Real payments" = `status NOT IN ('failed','refunded','ach_pending','void','cancelled')`.
- Status derivation: `(total_amount > 0 && amount_paid >= total_amount) ? 'paid' : 'partially_paid'`.
  The `total_amount > 0` guard matters because imported invoices can have `total_amount = 0`
  (no line items, no stored total) — without it they'd flip to "paid" at $0.
- Dashboard "collected / Paid" should SUM the `payments` table, NOT `invoices.total_amount`
  or `invoices.amount_paid`. A large fleet of imported invoices had `total_amount = 0`
  despite real payments, so summing invoice fields massively under/over-reported revenue.
- `amount_paid` drifts over time when write paths increment; treat it as derived/cache, and
  judge "does this invoice have linked payments?" by an actual `COUNT(payments WHERE invoice_id=…)`,
  not by `amount_paid > 0` (which can be 0 while payments exist, or non-zero with none).

**Why:** multiple write paths (Stripe card/ACH webhooks, manual record-payment, payment delete,
reconciliation) all touch the same invoice; increment-based updates compound rounding/double-count
drift. Recompute-from-sum is idempotent and self-healing.

**Stripe webhook idempotency:** insert the payment idempotently keyed on the Stripe reference
(`payment_intent || session.id`). A UNIQUE index on `payments.reference_number` is NOT viable
because the live table already contains legacy duplicate references (index creation would fail).
Instead serialize concurrent deliveries with a transaction-scoped advisory lock:
`BEGIN; SELECT pg_advisory_xact_lock(hashtext(ref)); INSERT … WHERE NOT EXISTS(reference_number=ref); recompute; UPDATE; COMMIT;`
A bare `INSERT … WHERE NOT EXISTS` alone is NOT concurrency-safe under READ COMMITTED.

**Cross-row creation invariants:** locking the payment row is insufficient when the
business rule spans every payment for the same customer (for example, "create only
when this customer has no invoice"). Serialize on the shared business key first,
then re-check the invariant after acquiring that lock. Two requests may lock
different payment rows and otherwise both observe the same pre-insert state.

**Why:** row locks protect one record; they do not protect a negative query over a
different table or across sibling records.

**How to apply:** for financial create-and-link operations, identify the actual
invariant scope (reference, customer, invoice, or company), take a transaction-scoped
advisory lock for that scope, then run the existence check and writes in one transaction.
