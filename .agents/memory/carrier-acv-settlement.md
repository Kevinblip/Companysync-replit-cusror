---
name: Carrier ACV settlement semantics
description: Distinguishes individual line-item ACV from carrier net ACV when payment summaries exclude paid-when-incurred amounts.
---

Line-item ACV is the sum of the carrier's individual ACV cells. Net ACV before deductible may be lower when the payment summary separately excludes a paid-when-incurred amount, such as debris removal. Keep that amount as a separate adjustment; do not alter RCV or ordinary line-item depreciation.

**Why:** A Liberty Mutual estimate can show recoverable depreciation and line-item ACV that reconcile perfectly while still reducing settlement ACV by a separate paid-when-incurred amount.

**How to apply:** Import the summary amount explicitly, label the resulting total as net ACV, and keep the deductible as a separate downstream settlement deduction.

Keep limited roof-surfacing payment schedules separate from repair prices and ordinary recoverable depreciation. Show the carrier's stated settlement, deductible, conditional code allowances and recovery terms alongside the full repair cost.

**Why:** The user needs insurance estimates to reflect policy-limited roof payments, not just matching repair line-item amounts. A carrier letter may conflict with its ACV recap or include amounts marked paid when incurred elsewhere.

**How to apply:** Preserve reported figures and their source, flag conflicts instead of silently reconciling them, and never turn a stated check into a payment record or label the repair-cost difference as a final customer balance.