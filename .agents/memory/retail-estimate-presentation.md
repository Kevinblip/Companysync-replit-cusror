---
name: Retail estimate presentation
description: Rules for separating customer-facing retail estimate language from insurance claim settlement language.
---

Standard retail estimates must use quantity, unit, rate, amount, subtotal, and total. RCV, ACV, depreciation, deductibles, and insurance-payment labels are reserved for an explicitly selected insurance format.

**Why:** Carrier-compatible line-item data can retain RCV/ACV fields internally, but showing those claim-settlement terms on a normal contractor proposal is confusing and incorrect for retail customers.

**How to apply:** A missing format and new custom formats are retail-safe by default. An insurance layout requires `show_rcv_acv: true`, or a legacy insurance-category format that has not explicitly disabled it. Public views that lack the full format must use an explicit insurance category or actual claim-settlement fields; never infer insurance solely from a stored ACV amount.