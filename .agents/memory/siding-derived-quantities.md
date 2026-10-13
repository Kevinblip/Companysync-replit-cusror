---
name: Siding derived exterior quantities
description: fascia/soffit/trim/roof-perimeter are computed by one shared util; the subtle rules that keep the card and report honest and consistent
---

Fascia LF, soffit sqft, trim sqft, and roof perimeter come from `computeDerivedExteriorQuantities` (src/utils/sidingDerivedQuantities.js), called by BOTH the AIEstimator summary card and generateSidingReportHTML. Legacy `fascia_lf`/`soffit_sqft`/`trim_sqft` fields on the measurement object are stale — nothing computes them; never display them.

Non-obvious rules (learned via code review, 2026-08-14):
- **Soffit has two components**: level frieze beneath eaves and sloped frieze beneath rakes. Keep their depths independent; fascia/roof-perimeter remain eave+rake.
- **Pass RAW measured edges** (satelliteAnalysis.eave_lf/rake_lf) to the util, never geometric fallbacks fabricated from W/D/pitch — the report has such fallbacks for its own linears display, and feeding them in made the report disagree with the card and falsely drop the "(est.)" label.
- When the siding handler marks edges as roof-facet sourced, those 3D edges outrank older satellite-analysis linears in every consumer; otherwise the pitch-corrected rakes are silently replaced by heuristics.
- **story_height_ft is TOTAL wall height** in analyzer output (fallback = storyCount × 9). Do not multiply by story_count again.
- Corner count: prefer analyzer's `trim_totals.outside_corners_count`; polygon-derived count is fallback only.
- OSM footprint perimeter: analyzer must preserve the true polygon perimeter, not recompute 2×(W+L) from the bbox.
- **Partial edge sets are "estimated"**: gable roofs need BOTH eave+rake positive for a 'measured' label (a gable necessarily has both); a lone eave or rake gets its counterpart filled by ratio and the result labeled estimated. Otherwise partial data underreports the drip edge while suppressing the "(est.)" warning. Hips need eaves only.
- Derived-quantity changes must be regression-checked with the dedicated unit test (`test:siding-derived`) — the card/report parity bugs above are exactly what it guards.

**Why:** Hover comparisons showed stale footprint-derived values underquoted roof-edge accessories. The 5688 Gemini Ct benchmark explicitly separates level and sloped frieze, proving the earlier eave-only rule was incomplete.
Related: `src/utils/elevationDrawings.js` renders to-scale SVG elevations from `openings_detail` — openings carry a 5-zone horizontal position (`far_left`…`far_right`) and canonical faces (`front`/`back`/`left`/`right`); front/back anchor to building WIDTH. The printable report has its OWN canvas elevation system (drawData/faceOps, capped at 6 openings/face) — the two drawing systems must not drift on the zone/face contract.

**How to apply:** any change to derived-quantity math goes in the shared util only; any new consumer passes raw analyzer fields per the rules above.
