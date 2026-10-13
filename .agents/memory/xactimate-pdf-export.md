---
name: Xactimate PDF export (AIEstimator)
description: How the AIEstimator "Xactimate PDF" export + options work, and the non-obvious money/reconciliation and localStorage rules.
---

# Xactimate-style PDF export from AIEstimator

`generateXactimateHTML(data, options={})` (src/utils/insuranceEstimateTemplates.js) takes an
optional 2nd `options` arg. `options.showDepColumns` adds per-line AGE/LIFE, COND., DEP %,
DEPREC., ACV columns (table widens from 5 to 10 cells via dynamic `detailCols`);
`options.includeTradeSummary` toggles the trade page. **Defaults reproduce the original
byte-for-byte** — EstimateEditor.jsx calls it with one arg and must stay unaffected.

The AIEstimator has its OWN "Xactimate PDF" export (menu item + shadcn dialog), separate from
the roof-report "Download PDF". It maps state → generator input via the pure adapter
`src/utils/xactimatePdfAdapter.js` (`buildXactimateDataFromAIEstimator`), which returns
`{ data, options }`.

## Money model (non-obvious — don't "fix" the mismatch)
- Tax and depreciation apply to **material lines only**. `isMaterialLine()` excludes pure
  tear-off / haul / debris / disposal / labor lines by keyword. "Remove & replace" IS material.
- Never trust the AIEstimator `acv` field (it just mirrors RCV). The adapter sets
  `depreciation_percent` and lets the generator compute `ACV = RCV − depreciation`.
- Age/life mode: `dep% = min(age/life, 1) * 100`.
- **Detail/trade columns reconcile to the cover summary by CENT-ACCURATE allocation (not just a
  per-line formula):** the detail RCV column, category subtotals, DEPREC cell, and trade-summary
  RCV/ACV all route through `lineRcvFull`/`lineDepFull`/`lineAcvFull` closures *local to
  generateXactimateHTML* (shared module helpers stay raw — Symbility uses them). When
  `foldExtras = totalTax>0 || opPctTotal>0`, tax + each line's O&P share is folded in, BUT the
  key trap is rounding: cells render at 2 dp, so summing a per-line float formula drifts a cent
  from the once-rounded summary (repro: 33.33×3 @10% O&P → 109.98 vs summary 109.99). Fix =
  allocate the summary totals across lines in whole cents via largest-remainder (`allocateCents`):
  floor(ideal*100) per line, then hand the leftover cents to the largest fractional parts. Targets:
  `rcvTargetCents=round(rcvTotal*100)`, `acvTargetCents=round(acvTotal*100)`,
  `depTargetCents=rcvTarget−acvTarget` (forces per-line ACV=RCV−DEP AND ties the ACV column). Dep
  is allocated over ONLY depreciated lines so undepreciated lines never show a phantom cent.
  **Why:** naive per-line rounding fails the "add up exactly" requirement on fractional inputs — a
  reviewer rejected the first (formula-only) attempt for exactly this. **How to apply:** any per-
  line column that must tie to a once-rounded aggregate needs largest-remainder allocation, not a
  formula. With tax=0 & O&P=0 `foldExtras` is false and the closures fall back to the raw helpers,
  so default output stays byte-for-byte identical — never push the fold into the shared helpers
  (Symbility would double-count).

## Symbility fold (same reconciliation, applied per DISPLAY ROW)
`generateSymbilityHTML` has the same class of drift but applies **no O&P** — only tax is folded
(`foldExtras = totalTax>0`). The shared helpers stay raw; the fold lives in local accessors
(`rowRcv`/`rowDep`/`rowAcv` + `itemRcv`/`itemDep` for subtotals). **Key difference from Xactimate:
Symbility splits one item into a Remove + Replace PAIR, so allocate across DISPLAY ROWS ("units"),
not items** — RCV weight = the item's `lineRcv` share (+ the item's tax on the single/replace row
only) with remove/replace shares = `remove_cost : replace_cost`; dep split the same way. Same
targets as Xactimate (`depTarget = rcvTarget − acvTarget`, dep over depreciated units only).
**Why:** summing per-row floats drifts a cent from the once-rounded summary, and keying allocation
by item (not row) would mis-tie the two-row case. **How to apply:** when a generator renders one
logical item as multiple rows, the largest-remainder allocation unit must be the RENDERED ROW.
The units gate (`rTot>0 && pTot>0`) MUST match the render branch's remove/replace gate exactly or
allocation units and rows diverge. No-tax output stays byte-for-byte identical (raw fallback).

## localStorage rule (was a real bug)
Export-option dialogs that persist settings must **never persist per-claim / per-entity fields**
(claim #, policy #, deductible, dates, insurer, loss type). Persisting them leaks one customer's
claim details onto the next customer's export. Only reusable settings (toggles, percentages,
section/price list) are saved; per-claim fields are re-seeded from the current `customerInfo`
each time the dialog opens.

**Why:** shared localStorage keys outlive the customer context they were entered in.
**How to apply:** for any "remember my export settings" feature, split reusable vs. per-record
fields; strip per-record fields before `setItem` and re-seed on open.
