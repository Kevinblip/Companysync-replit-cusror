---
name: Photo full-plane height semantics
description: Rules for interpreting photo-calibrated wall heights and story counts in siding measurement.
---

Photo-calibrated wall height is a single grade-to-eave measurement for the visible elevation. It must be used once for photo planes, even when the property has multiple stories. Story count is descriptive on that path; it is a multiplier only for the footprint-extrusion fallback.

**Why:** Multiplying a valid full-plane anchor by stories turns ordinary residential elevations into inflated siding totals and produces misleading UI such as “2 stories × 22 ft.”

**How to apply:** Accept residential photo anchors only from 7–28 ft. If anchors disagree by more than 15%, use the median survivor and disclose rejected outliers. Keep full-plane metadata on the response and display it as `wallHt=... full plane`; reserve `stories × ... story height` for the per-story extrusion fallback.