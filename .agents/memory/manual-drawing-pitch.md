---
name: Manual drawing roof-area correction
description: Manual flat footprints must use the canonical pitch-plus-overhang formula; roof_area_sq remains flat and corrected_area_sq is the order quantity.
---

# Manual drawing tool converts flat footprints to order area

The manual drawing tool (`src/components/satellite/InteractiveRoofMap.jsx`) draws a
FLAT footprint on the satellite map. Materials must be ordered from the actual
sloped roof area, including the standard eave/rake allowance. Use
`calculateRoofAreaFromFootprint(footprint, pitchRise)` rather than rebuilding the
calculation from a pitch multiplier or an overhang constant.

**Convention (must stay consistent):**
- `roof_area_sq` / `roof_area_sqft` = FLAT footprint.
- `corrected_area_sq` / `corrected_area_sqft` = canonical pitch-plus-overhang result. This is what materials order from.
- `pitch_multiplier` is also emitted so downstream can show/verify it.
- This matches the satellite convention in `calculateRealConfidence`, which multiplies flat area by the pitch multiplier for non-solar sources and SKIPS correction for `google_solar`/`gemini_vision` (their areas are already surface area). Auto-detected structures therefore set `corrected_area_sq = roof_area_sq`.

**Why:** manual values that apply only slope still omit the standard eave/rake
allowance, systematically under-ordering material. This is money-critical.

**How to apply:** any consumer that turns a measurement into material quantities must
read `corrected_area_sq || roof_area_sq` (never bare `roof_area_sq`). In
`src/pages/AIEstimator.jsx` the combine paths, the metal/flat line-item converters,
the estimate title, toasts, and manual-add-on notes all follow this. Do NOT
re-multiply `corrected_area_sq` by the pitch again anywhere (double-count) — the
display banner reads it directly.

**Guard:** `src/__tests__/pitchMultiplier.test.js` locks the multiplier table, the
never-flat fallback, and the canonical manual-footprint allowance.
