---
name: Cash-received reporting must key on payment_date
description: Why "how much came in this month" must filter payments on payment_date (not created_at), exclude withheld-fee offsets, and stay identical across all four copies of the financial-summary handler.
---

# Rule

Any "cash received / collected / made this month" figure must filter payments on
`COALESCE(payment_date, created_at)`, exclude withheld-fee offsets, and restrict to
`COALESCE(status,'received') IN ('received','paid','completed')`.

Withheld offsets are stored as `data->>'is_withheld_offset'` (top level; a nested
`data->'data'->>'is_withheld_offset'` form also exists). Compare as text
(`NOT IN ('true','t','1')`) rather than casting to boolean — a stray non-boolean
value makes a `::boolean` cast throw and kills the whole summary.

**Why:** filtering on `created_at` reports payments in the month somebody *typed the
row in*, not the month the money arrived. In real tenant data the two differ for the
large majority of rows, because back-dated checks are entered in batches. On one
month this overstated cash by ~19% and silently pulled in payments from a prior month
plus a future-dated one. Withheld offsets inflate the figure further; they represent a
fee netted out, so no cash was received.

**How to apply:** whenever touching revenue/cash reporting for the assistant or a
dashboard. Invoice-side totals legitimately use `created_at` — that measures
*invoices issued*, a different question. Keep the two labelled distinctly
(`cash_received` vs `invoices_issued`); never substitute one for the other.

# The handler exists in four copies

The financial-summary tool is duplicated across the dev text path, the dev native
voice path, the production server, and the shared prod-integrations module. They had
drifted: two filtered on `created_at`, two on `payment_date`, and none excluded
withheld offsets — so the assistant returned a *different number depending on whether
the user typed or spoke*. Grep every copy and change them together.

Identical SQL predicates do not establish identical reporting periods. Validate
company-local dates and exclusive end bounds across chat and voice, including
previous-month year rollover and instants when UTC and the company are in
different months. Execute the runtime branches; syntax checks cannot detect a
context variable copied from a differently scoped handler.

# Related trap in the same tool

The generic CRM-data tool computed an invoice `total_revenue` by summing the ten
newest sampled rows, using the frozen legacy `amount` field. Any total returned
alongside a truncated sample must be a real SQL aggregate over the full table (and
must read `total_amount`, the live column). Returning a sample-derived total next to
a full-table `count` reads as authoritative and is off by orders of magnitude.
