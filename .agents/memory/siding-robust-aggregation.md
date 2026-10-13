---
name: Photo siding robust aggregation
description: MAD outlier rejection for per-photo eave/width anchors; labeled height floors; Hover garage benchmark fixture
---

# Photo siding robust aggregation

**Rule:** Per-photo AI measurement anchors (eave heights, facade widths) must be aggregated with MAD-based outlier rejection (`robustAvg` in `db/siding-aggregate.cjs`), never a plain arithmetic mean. Any floor/default that replaces a measured value must append a `raised_to_*` suffix to the height source label and set `height_adjusted`.

**Why:** Real incident (Aug 2026): 8 photos of a 1-story detached garage measured 926 ft² net siding vs Hover's 593 ft² (+56%). Two bad photos (ridge read as eave → 13-14 ft; background included in facade width → 40 ft) dragged plain means from ~8 ft/24 ft to 9.5 ft/29 ft. Compounding: `Math.round(9.5)=10` in the returned `story_height_ft` and in AIEstimator's detected-config writeback inflated every rebuild by another 0.5 ft, and AIEstimator hardcoded garage wall height to 10 ft regardless of calibration.

**Key decisions:**
- 1-story height floor is *physical* (7.5 ft), not the spec stories×9 — an 8-ft garage/ranch must be measurable. 2+ stories keep the spec floor (photos may show only one floor).
- `garage_door_anchor` (7.0 ft sectional door) is a calibrated height method in both prompts and `CALIBRATED_METHODS`.
- `story_height_ft` keeps half-foot precision end-to-end (handler response, AIEstimator config writeback).
- Aggregation lives in THREE places that must stay in lockstep: `db/siding-aggregate.cjs` (dev + prod runtime via functionHandlers fallthrough), `functions/analyzeHousePhotosForSiding.ts` (TS mirror), and the prompts in `vite-functions-plugin.js` + the TS file.
- Structure-type fallbacks must not clamp stale config from a different structure type into range — fall back to the type default instead.

**How to apply:** `scripts/test-siding-hover-benchmark.cjs` encodes the incident as a fixture — plain mean must reproduce the wrong 926 ft², robust pipeline must land within ±15% of Hover 593 ft². Run it plus `scripts/test-siding-aggregate.cjs` after touching any siding aggregation logic.
