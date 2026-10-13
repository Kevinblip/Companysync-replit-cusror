---
name: Withheld-fee offset payments
description: Payments flagged is_withheld_offset (fee kept out of a claim check, e.g. Sedgwick MRP) are bookkeeping entries — every payment_received side effect must skip them.
---

# Withheld-fee offset payments

Some invoices are settled short because a third party (e.g. Sedgwick MRP) deducts
its fee from the claim check before it arrives. The app records this as an
**offset Payment** (closes the invoice balance) plus a **matching Expense**
(category `commission`) and marks the commission split `paid_via: 'withheld'`.
Net books: full invoice = revenue, withheld fee = expense, cash = difference.

**Rule:** these payments represent NO cash received. Any current or future
`payment_received` side effect must skip them — QuickBooks push, tenant
workflows, outgoing webhooks, admin "Payment Received" bells/emails,
commission-earned alerts, customer receipts.

**Detection (use all three):** `is_withheld_offset === true` on the record,
`data.is_withheld_offset === true` (dedicated-table JSONB routing), or
`/no cash received/i` in `notes`.

**Why:** payment side effects fire from SEVERAL independent places (dev
auto-trigger handler, prod workflow-trigger function, two separate
notification-config copies, the QB sync lib incl. bulk sync). A new side
effect added to any of them will silently push phantom cash to QuickBooks or
text the customer "payment received" unless it checks the offset flag —
gate inside shared libs (e.g. the QB push function itself) where possible so
all call sites are covered at once.

**How to apply:** when adding anything that reacts to a Payment create/update,
check the offset detection first; when adding a new bookkeeping-only payment
kind, reuse this flag pattern rather than inventing a new sentinel.
