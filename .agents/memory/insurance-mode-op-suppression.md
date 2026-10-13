---
name: Insurance Mode O&P suppression
description: Why O&P (overhead & profit) can still appear on an insurance-mode estimate even when the format says "no O&P", the falsy-zero trap in rate fallbacks, and why uploaded carrier estimates must never be repriced from the active price list.
---

# Insurance Mode O&P suppression

`LineItemEditor` decides whether to show the O&P column/summary from the active
*format* object alone (`format.show_op_column`). It does not automatically know
the estimate is an insurance job. If a company's default/insurance format was
cloned from (or falls back to) an O&P-enabled format, O&P renders even though
Insurance Mode is supposed to promise "no O&P" — the promise lives in product
messaging, not in a hard gate in the editor.

**Why:** insurance carrier estimates already bake O&P into the RCV column line
items (see `xactimate-symbility-format.md`); a separate O&P line/column on top
of that double-counts it and breaks totals.

**How to apply:** any component that renders O&P for line items must take an
explicit `isInsuranceJob` flag and AND it into the format-derived
`showOpColumn`/`opRate` — never infer "no O&P" purely from format config, since
formats are reused across insurance and retail jobs. Also: when reading a rate
field that legitimately may be `0` (e.g. `overhead_profit_rate`, `tax_rate`),
use `??` not `||` for the default fallback — `0 || 20` silently becomes `20`
and overrides an intentional zero rate.

## Uploaded carrier estimates: never reprice from the active price list

`_generateAndSetEstimate` in AIEstimator has a `fromFileUpload` flag. When
it is true, the active pricing source (Xactimate/Symbility/custom) must be
completely ignored for rcvTotal and rate computation. The document is the
sole authority.

**The bugs that were fixed (now resolved):**
- `||` on `extractedRate`: `0 || matchedItemPrice` fell through to the price
  list for ITEL supply lines ($0.00 rate), repricing them at Xactimate rates.
- `> 0` on `extractedRcv`: `(extractedRcv > 0) ? rcv : price * qty` fell back
  to price × qty when the document's RC column was $0.00, compounding the
  inflation.
- "REVISED placeholder" filter stripped legitimate $0 ITEL supply lines.

**Fixed logic (fromFileUpload=true):**
```
rcvTotal = extractedRcv != null ? extractedRcv : (extractedRate ?? 0) * qty
price    = extractedRate ?? 0   // never use price list
matchedItem = null              // skip smartDescriptionMatch entirely
```

Liberty Mutual / Symbility estimates also do NOT bake tax into individual
line RC values — tax appears as a summary-level line only. So the per-item
RC sum will be slightly below the document's headline RCV (which includes tax).
