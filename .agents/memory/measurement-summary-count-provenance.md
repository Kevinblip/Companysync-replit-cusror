---
name: Opening counts have two producers with different field names
description: Why the Measurement Summary blanked out windows/doors, and the rule for mixing exact vs estimated counts.
---

Siding measurement objects (`sd`) are populated by two different producers that
use **different field names for the same quantity**:

- satellite-only path → `estimated_windows`, `estimated_doors` (inferred from
  building size; no opening was ever observed)
- photo-analysis path → `windows_count`, `window_assemblies_count`,
  `doors_count`, `garage_door_count`, `shutters_count`, `shutter_panel_count`,
  `shutter_pair_count` (exact, from a real per-opening inventory)

**Rule:** any consumer must read BOTH families. Prefer the exact count, fall
back to the estimate, and only label a number "(est.)" when it really is one.

**Why:** the Measurement Summary read only the `estimated_*` pair, so uploading
photos — the single path that produces exact counts — made the rows render an
em-dash, while the caption simultaneously promised "photo analysis gives exact
counts". The elevation drawings directly below stayed correct because they read
`openings_detail`, which made the panel look selectively broken.

**The zero trap:** do not treat a bare `windows_count: 0` as authoritative.
`buildRoofFootprintFallback` hardcodes `windows_count: 0` / `doors_count: 0`
while knowing nothing about openings. Gate "exactness" on an opening inventory
actually existing (`window_assemblies_count != null`, `measurement_graph`
present, or `openings_detail` is an array) and on
`!_estimated_from_roof_footprint`. A genuine 0 from real photo analysis (a
windowless garage) must still display as 0 — "unknown" and "none" are different
answers and users read a confident 0 as measured.

**Window semantics:** `window_assemblies_count` (rough openings — a mulled
triple window in one frame is ONE) is the contractor-facing number.
`window_units_count` counts sashes and is a different metric; do not mix them.

Shared helper: `src/utils/openingCounts.js`
(`resolveOpeningCounts`, `hasOpeningInventory`, `summaryCaption`,
`formatShutters`). Provenance is **per number** — windows can be exact while
doors are unknown, so a blanket "these are estimates" caption understates real
measured data.
