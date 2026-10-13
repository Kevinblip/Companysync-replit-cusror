---
name: invoice_number is not unique
description: Why every join, claim, recalculation, or balance adjustment keyed on invoice_number is a latent cross-customer money bug, and what to key on instead.
---

# invoice_number has never been unique

Invoice numbers collide across customers in this codebase's production data —
different customers legitimately hold invoices with the same number, generated
years apart by different code paths. Nothing enforces uniqueness at the database
level and nothing ever has.

**The rule: `invoice_id` is the only safe key.** `invoice_number` is a display
label. Treat it as a fallback only for legacy rows that have no `invoice_id`, and
only when it resolves to exactly one invoice — otherwise refuse and tell the user.

**Why:** a real incident. Two unrelated customers each had an invoice with the
same number. A customer profile gathered payments by matching that number, then
an auto-reconcile effect permanently rewrote each payment's `customer_id` to
whichever profile had just been opened. Tens of thousands of dollars of one
customer's payments appeared on — and were re-stamped onto — the other's file,
and the two profiles took turns stealing them back on every page view. Invoice
*balances* survived (they are summed by `invoice_id`), but customer-level
attribution did not.

**How to apply:**

- Any `find`/`filter` of the shape `p.invoice_id === inv.id || p.invoice_number === inv.invoice_number`
  is wrong. The `||` lets the number override an id that disagrees. Use the shared
  `matchesInvoice` helper in `src/utils/paymentOwnership.js`: when the payment has
  an id, the id decides, full stop.
- The server-side recalculation handler resolves `invoice_number` with `LIMIT 1`.
  Invoking it by number silently rewrites the balance of whichever duplicate comes
  back first, and never touches the other. Always invoke it by id.
- Bulk tools that iterate "each unique invoice number" reach only the first of
  each duplicate pair. Iterate ids.
- Client-side "next invoice number" generators must compute their high-water mark
  over the **unfiltered** company invoice list. Computing max+1 over a
  permission-filtered list is how a rep who can only see their own customers
  reissues a number another rep already used. Concurrency between two users
  remains an accepted residual — there is no server-side atomic allocation.
- When a UI lets the user pick an invoice by number, narrow the candidates by
  customer id then name; if that is not decisive, **refuse** rather than picking
  the first. Guessing is how the money lands on a stranger's invoice.

## Ownership repair rules

Deciding whether a payment belongs on a customer's profile:

- Only *exclude* a payment when its invoice is **positively confirmed** to belong
  to someone else. A failed lookup, or an invoice carrying no owner at all, is
  unknown — not proof — and must never hide money.
- An invoice's explicit `customer_id` beats a name match. Duplicate customer
  records sharing one person's name are real in this data.
- Only *re-stamp* a payment's `customer_id` when the payment sits on one of this
  customer's invoices by id, or is a true orphan (no `customer_id`) with a
  matching name. Never claim an already-owned payment on a name match alone, or
  two profiles will ping-pong it forever.
- Keep payer identity separate from the customer receiving invoice credit. A
  spouse, insurer, lender, or bank may supply the money, so a differing payer is
  a review signal rather than an automatic reassignment. Preserve payer name and
  email and show both "Paid by" and "Applied to" in financial history.

## Legacy sequence hygiene

Yearly invoice allocators must only treat a 1–9 digit suffix as a normal
sequence. Timestamp-sized legacy suffixes are ignored when finding the next
`INV-YYYY-####` number, while the final candidate is still checked for
duplicates.

**Why:** an imported/legacy timestamp-style suffix overflowed PostgreSQL
`INTEGER` during estimate conversion and prevented the invoice from being
created.

**How to apply:** keep the bounded suffix guard in every server-side
invoice-number allocator, including development and production handlers.
