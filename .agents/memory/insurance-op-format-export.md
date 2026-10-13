---
name: Insurance O&P format/export contract
description: How estimate-format O&P settings map into printed insurance exports
---

Insurance estimate formats store O&P as a combined `overhead_profit_rate` for the editor, while printed Xactimate output consumes separate overhead and profit percentages. When no explicit estimate-level split exists, divide the selected format's combined rate evenly between overhead and profit; explicit saved percentages remain authoritative.

**Why:** The editor can visibly calculate a nonzero O&P amount from the format while the export silently renders $0.00 if it only reads the estimate-level fields.

**How to apply:** Any insurance print/PDF/export adapter that consumes `overhead_pct` and `profit_pct` must resolve them from the selected format before rendering, without overwriting an explicit carrier-specific split.

Carrier-style O&P belongs on every detail line, not only in separate roll-up
rows. For each line, calculate tax first; calculate overhead and profit
separately from `(line base + line tax)`; round each component to cents; then
set line RCV to `base + tax + rounded overhead + rounded profit`. The estimate
summary must sum those rounded line results.

**Why:** The reference carrier estimate proves that rounding a combined 20%
amount or applying O&P only to the estimate subtotal produces different cents
than the actual per-line 10% overhead plus 10% profit calculation.

**How to apply:** Preserve an immutable pre-O&P line base so reopening or
switching formats cannot compound markup. When per-line O&P is requested,
replace legacy O&P roll-up rows with persisted per-line tax, overhead, profit,
O&P, and RCV values. Printed detail and trade summaries must use the same
per-line values.