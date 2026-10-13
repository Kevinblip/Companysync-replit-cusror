---
name: Invoice "owed" and "overdue" computation
description: How to correctly compute money owed / overdue invoices in the roofing SaaS, and the field traps that cause massive undercounts.
---

# Computing money owed / overdue invoices

**Rule:** An invoice owes money iff `balance > 0` where `balance = total_amount - amount_paid` (clamped ≥ 0). The stored `status` is a label, NOT the source of truth. For "outstanding" / "to collect" / aging buckets, exclude only `status === 'cancelled'` and then gate on `balance > 0`. Drafts are additionally excluded for "overdue".

**Why:** A real incident showed ~$33k "outstanding" vs ~$509k actually owed for one company. Two independent traps:

1. **Almost no invoice has a `due_date` set (~99% null).** Any logic that gates overdue on `due_date < today` silently drops nearly every owing invoice. Use an *effective* due date: `due_date` if present, else `created_at` (or `created_date`) + 30 days. Helper: `getEffectiveDueDate` / `getDaysOverdue` / `isInvoiceOverdue` in `src/utils/invoiceFinance.js`.

2. **Pre-import / legacy invoices can have `total_amount = 0` but a recorded `amount_paid`** (e.g. "anything before 2026 paid in full"). These net to balance 0 and must be excluded — filtering on `status !== 'paid'` alone leaves them showing as `partially_paid`/`sent` and inflates A/R counts and aging.

**Field traps:**
- `amount` is **not a real SQL column** on `invoices` — it is merged onto the invoice object from the legacy `data` JSONB and is a *frozen/stale* value. SQL audits referencing `amount` error with `column "amount" does not exist`. Use `total_amount` (canonical) everywhere for balances. Do NOT use `(total_amount || amount)`.
- `amount_paid` is authoritative (derived from SUM of real payments), so `balance` is reliable; a `status='paid'` row with `balance>0` is genuinely owing (mis-flagged) and should still be counted.

**How to apply:** Use the shared helpers in `src/utils/invoiceFinance.js` (`getInvoiceBalance`, `isInvoiceSettled`, `getInvoiceDisplayStatus`, `getEffectiveDueDate`, `getDaysOverdue`, `isInvoiceOverdue`) for any new "owed/overdue/paid" surface so Dashboard, A/R report, and Invoices list stay consistent. Unit tests live in `src/__tests__/invoiceFinance.test.js`.

## The badge/tab divergence trap

**Rule:** On any invoice surface, the *badge* and the *bucket the row lands in* must be computed from the SAME function. If one reads the balance and the other reads the stored `status` column, they will contradict each other in the UI — a row showing a green "Paid" badge and a $0.00 balance while sitting in the Overdue tab.

**Why:** This shipped once. The row badge used `getInvoiceDisplayStatus` (balance-derived) while the tab lists/counts filtered on raw `invoice.status`. Imported invoices carry `total_amount = 0` with a real `amount_paid`, so their stored status is stuck at `partially_paid` forever and can never flip to `paid` — the balance said settled, the status said not-settled, and both were rendered on the same row. Users read this as "the app thinks a paid invoice is overdue," which destroys trust in every A/R number on the page.

**How to apply:**
- Derive one predicate set per surface (display status / open / overdue) at the top of the component and route *every* list, count, table filter, aging bucket, and CSV export through it. Never re-inline the `status === 'sent' || status === 'viewed' || ...` list — that duplicated list is exactly how the two definitions drifted apart.
- "Overdue" must gate on `balance > 0`, never on the stored status alone. Nothing with a zero balance can be late.
- Exclude drafts from overdue (never sent → cannot be late) and cancelled from everything.
- Exports should write the *displayed* status, not the raw column, or the CSV contradicts the screen.
- The invariant worth testing is not any single tab's contents — it is that badge and tab never disagree. Assert that directly (`scripts/test-aging-bucket-filter.cjs`).
