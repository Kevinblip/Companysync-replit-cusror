---
name: Roof area sanity guards
description: Why garage structures showed whole-house roof areas, and the two guards that now enforce footprint consistency and the garage ceiling.
---

# Roof area sanity guards

**The "25 SQ 2-car garage" symptom was NOT a facet-duplication or radian bug.**
A full audit found no loop applying total footprint per facet, and all pitch trig
is radian-correct (`1/cos(atan(rise/12))` ≡ `sqrt(1+(rise/12)²)` — covered by
`scripts/test-roof-area-sanity.cjs`). The real cause: Google Solar
`findClosest` snaps garage-pinned or offset-probe coordinates to the nearest
building and returns the **whole main house's** roof stats for a "Garage"
structure. The auto-detect-nearby-structures probe (4 small lat/lng offsets) is
especially prone to this.

## Guards now in place
1. **Footprint-consistency clamp** in `_aiRoofMeasurementImpl`
   (vite-functions-plugin.js — the LIVE dev+prod handler; functions/aiRoofMeasurement.ts
   is a lockstep reference copy): per-segment flat projection
   (Σ segArea × cos(segPitch)) must stay ≤ mapped OSM footprint (shoelace on the
   real polygon, bbox fallback) × 1.35. Breach → scale total down, cap
   confidence ≤55, return `footprint_clamped: true`, log `FOOTPRINT CLAMP`.
   **Must be re-applied after learned calibration** — the ×0.8–1.25 area
   calibration runs later and can push the total back over the ceiling.
2. **Strict garage reconstruction** `enforceGarageRoofSanity`
   (src/utils/roofAreaSanity.js): NO hardcoded defaults (the owner explicitly
   rejected a "standard 2-car 440 sqft" fallback). The handler returns the
   QUERIED structure's coordinate-matched OSM polygon metrics
   (`osm_garage_footprint_sqft`/`osm_garage_perimeter_ft`, point-in-polygon →
   nearest-centroid ≤25 m). Snap evidence = satellite area >
   `(footprint + perimeter×1.5ft + 4×1.5²) / cos(atan(rise/12))` × 1.35 →
   replace with that exact reconstruction. Consistent areas are NEVER
   overridden (legit large garages stay). No exact geometry + >1,000 sqft →
   FAIL CLOSED: zero areas, `requires_manual_dimensions`, UI demands real
   length × width (pinned path skips + explains; auto-detect drops it).

**How to apply:** guard applies ONLY to satellite-derived garage analyses
(auto-detect + pinned garage). Never cap sheds or user-entered dimension
builds (trusted input, formula-safe by construction). Never reintroduce a
"standard garage" fallback number — fail closed instead. The 1.35 allowance
covers ~12% eave overhang + footprint tolerance; legit roofs must never trip
it.

**Why:** an uncapped snap error feeds ~5× material quantities straight into
estimates; silent scaling without flags would hide it from the contractor.
