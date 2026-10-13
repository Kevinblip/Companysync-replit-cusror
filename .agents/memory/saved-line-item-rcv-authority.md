---
name: A saved line item's RCV is the authority
description: Never recompute quantity x rate when reading a saved estimate line; and never append a summary tax line without checking whether the line RCVs already contain the tax.
---

# A saved line item's stored value is the authority

**Rule:** when READING a saved estimate/invoice line item, use the stored RCV.
Only fall back to `quantity x rate` when no value was ever stored. Recalculation
belongs to the edit path (changing qty or rate in the grid), never the load,
render, or export path.

Use the shared helpers in `src/utils/estimateTotals.js`
(`resolveStoredRcv`, `sumRcv`, `normalizeSavedLineItem`, `lineQuantity`, `lineRate`).
Server-side code that cannot import from `src/` has a mirror helper — keep them
in lockstep.

**Why:**
1. An insurance carrier's RC column legitimately differs from `qty x rate`.
   Carriers round, and some documents fold tax into the line. Recomputing on load
   made the list and the editor show two different totals for the same estimate,
   and pressing Save then overwrote the carrier's real number with our invented one.
2. `rcv || amount || qty * rate` is the specific idiom that causes this. It is
   TRUTHY, so a legitimate **$0 line is treated as missing** and gets re-priced.
   Carrier documents really do contain $0 lines (carrier-furnished material,
   ITEL supply lines) sitting next to a live quantity and rate. Use a nullish
   chain instead: a stored 0 is a real number.

**How to apply:** any new read of a line item's money. The dangerous variant is
the one that falls through to `qty * rate` or to a recomputed `amount + tax + O&P`;
a chain that merely ends in `|| 0` cannot re-price, only mis-read a stale `amount`.
Editing qty/rate in the grid still recalculates the line, so trusting saved values
does not freeze anything.

**Where this had to be fixed at once (the same estimate must be worth the same
number everywhere):** the editor load path, the editor's own subtotal (including
the one the save mutation writes), the customer-facing estimate view, the
Xactimate PDF adapter, the ESX/Symbility generators, the Xactimate Excel export,
the server-side estimate PDF generator, the material-list export, and
convert-to-invoice. Grep for the truthy idiom before assuming it is done.

# Never charge sales tax twice on an imported estimate

Document import appends a summary "Sales Tax" line from the AI-extracted tax
total. Some carrier documents have **already distributed that tax into the line
RC values**, so appending the line double-charges it.

Detect with `taxIsBakedIntoLines(items, summaryTax)`: sum `rcv - (qty x rate)`
across measurable lines and compare against the summary tax. Tolerance is
`max($0.05, one cent per measurable line)` — the ONLY difference worth forgiving
is per-line cent rounding.

**Why the tolerance is that tight, and the bias deliberate:** a loose percentage
window lets an unrelated gap (a carrier price adjustment, allocated O&P) look
like tax and silently delete real money from the estimate. Suppressing the tax
line is the newer behaviour so it must clear a high bar; wrongly *adding* a tax
line is visible in the total, wrongly *removing* one is not.

**Honest limits — this is a best-effort import heuristic, not a guarantee.** An
adjustment that happens to equal the tax exactly will still fool it, and tax
embedded only in rollup/unmeasurable lines is invisible to it and still
double-charges. The robust fix is explicit provenance from extraction (ask the
model whether tax is embedded) and/or reconciling the line total against the
document's own stated RCV. Not implemented yet.
