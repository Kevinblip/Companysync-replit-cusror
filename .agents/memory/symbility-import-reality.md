---
name: Symbility/Cotality import reality — no estimate-XML import exists
description: What Claims Workspace (fka Claims Connect/Symbility) can actually import; read before promising "Symbility export" features.
---

# Symbility (Cotality Claims Workspace) import reality

- Claims Workspace/Claims Estimate imports only **Roofplan XML** (roof measurement/sketch diagrams — the format HOVER/EagleView deliver), via Documentation → Import diagram. Imported roofplans are static.
- There is **no contractor-facing "import estimate XML with line items"** path; estimates are built inside Claims Workspace or flow via Cotality partner integrations.
- Therefore our `<SymbilityEstimate>` XML export is a structured data hand-off document (adjuster reads/re-keys it), NOT a file Symbility ingests. Never claim in UI that it "imports into Symbility".
- The consolidated generator is `generateSymbilityXml` in `src/utils/esxExport.js` — ALL call sites (EstimateEditor, AIEstimator, XactimateEstimateView) must use it. Per-item ACV=RCV rule enforced there (see symbility-xml-acv-format.md); a since-removed inline AIEstimator builder wrote ACV=RCV−dep per item (understates payout) — don't reintroduce inline builders.
- A potentially valuable real feature would be generating **Roofplan XML** from our roof measurements (that IS importable) — needs a real HOVER/EagleView roofplan XML sample to match.
