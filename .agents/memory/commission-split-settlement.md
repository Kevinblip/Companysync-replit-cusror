---
name: Commission split settlement & undo
description: Two settlement paths on invoice commission splits, stored IDs for exact undo, heuristic fallback risks
---

**Two settlement paths** in the invoice-details commission split dialog (users confuse them — one real user clicked the wrong one and thought the balance bug'd):
- **Payout** ("I sent them the money myself"): creates a commission Expense only; does NOT touch the invoice balance.
- **Withheld** ("they kept their fee out of the payment", `paid_via:'withheld'`): creates an offset Payment (`is_withheld_offset:true`, notes contain "Fee withheld by <vendor>") + Expense, then closes the invoice balance via recalc.

**Undo contract:** Both settlement mutations now store `paid_expense_id` (and `paid_offset_payment_id` for withheld) on the split so undo deletes by exact ID. Heuristic fallback (for pre-ID records) matches vendor+amount within 1¢; vendor-only fallback fires ONLY when exactly one candidate exists AND no other paid split shares the vendor. Offset-payment fallback must include the vendor name in the notes match, never bare "Fee withheld by".

**Why:** vendor-only matching can delete ANOTHER split's expense on the same invoice (same vendor, same reference_number), silently unbalancing books. Real cash payments are safe: deletion only runs for `paid_via==='withheld'` and only matches offset markers.

**How to apply:** Any new code creating linked records from a split settlement must store the created IDs on the split; undo/reversal must prefer IDs over heuristics. Invoice `amount_paid`/status is always recomputed from SUM(payments) (`_recalcInvoiceBalance`), never adjusted incrementally.
