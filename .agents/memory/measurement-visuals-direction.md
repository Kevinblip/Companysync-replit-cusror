---
name: Measurement visuals direction
description: Owner's product direction for measurement visualization — wants Hover-level realism; all four rendering options stay under consideration
---

The owner wants measurement output to look as realistic as Hover's reports and is "curious about all" rendering options — keep them all in consideration, don't treat the chosen path as exclusive.

**The four options presented (2026-08-15), in the owner's chosen order:**
1. ✅ SHIPPED — Polished 2D elevations (course lines, corner boards, eave/fascia band, ticked dimension lines) in elevationDrawings.js
2. ✅ SHIPPED — Photo-textured 3D: 📷 Photos toggle on HouseModel3D wraps real facade photos onto azimuth-matched walls (src/utils/facePhotos.js + src/components/estimator/photoTextures.js; illustrative only)
3. Still of interest — AI-beautified photorealistic render (clearly-labeled illustration only, never measurement)
4. (baseline) 2D to-scale elevations — the trusted layer, shipped in the summary card

**Why:** Hover's look comes from real photogrammetry, which we cannot replicate via Gemini; the owner cares about the visual gap but the 2D elevations are the trust anchor — decoration must never outrun measurement honesty.

**How to apply:** when touching measurement visualization (elevations, HouseModel3D, reports), keep the honest-vs-illustrative distinction explicit in UI copy, and remember options 2 and 3 remain of interest even after earlier phases ship.

**Facade evidence principle:** Compass controls can select a calculated physical wall, but only a trusted semantic-facade-to-azimuth mapping may attach that wall to measurements or photos. Never label unverified aerial or Street View imagery as proof of a facade.

**Why:** Rotated or tilted satellite tiles cannot reveal a house facade, nearby Street View panoramas can show the wrong property, and an unordered footprint cannot establish which wall is semantic “front.”

**How to apply:** when the trusted mapping is absent, show calculated orientation only and explicitly leave evidence unavailable rather than guessing a semantic face or upload slot.

**Printable report shares the ONE elevation builder (2026-08-15):** generateSidingReportHTML embeds renderElevationSet SVGs at generation time (canvas elevation engine deleted; iso/perimeter views still canvas). Never reintroduce a second elevation drawing implementation — that duplication previously hid a latent crash (undefined header var) because the report template path was never executed until smoke-tested. scripts/test-siding-report.cjs guards generation; run it after report or elevationDrawings changes.
