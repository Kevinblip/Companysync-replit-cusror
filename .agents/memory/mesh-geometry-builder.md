---
name: MeshGeometryBuilder — parametric roof topology
description: New shared utility for watertight 3D roof geometry; replaces Solar API floating bbox quads; location, pipeline, and key constraints.
---

## Architectural rule
When a usable traced footprint exists, it owns the rendered roof's coordinate
space, extent, concavities, eave ring, and fascia. Solar/canonical inputs may
provide pitch/orientation hints, but their centers and bounding boxes must never
size or position the rendered roof. A complete physical-photo roof is the only
source allowed to bypass the outline.

**Why:** Solar bbox planes use a different origin from traced walls and inflate
rotated facets, producing detached oversized roofs. Gating the outline on
surviving Solar facets also makes ordinary no-coverage jobs collapse L/T houses
back to a rectangle.

**How to apply:** Attempt outline geometry before canonical/Solar/parametric
geometry whenever the polygon is present. If polygon validation or offsetting
fails, show the house-centred parametric fallback without an error overlay.

## Key constraints
- `buildParametricGable`/`buildParametricHip` return raw `Float32Array` — caller owns Three.js object creation and `toDispose` registration
- `slope` = rise/run (6/12 → 0.5), not degrees
- Overhang `ov` defaults to 1.0 ft; HouseModel3D passes its computed `overhang` clamped to [1.0, 2.0]
- `EDGE_COLORS` (existing constant in HouseModel3D) is used for rake/eave/hip/ridge lines — do not redefine

## External geometry numeric validation

Satellite geometry coordinates and areas must be finite numeric primitives,
not merely values that can be coerced by `Number()`. `null`, `''`, and booleans
must reject the record; optional height values alone may default to zero.

**Why:** JavaScript converts `null` and empty strings to zero, which can turn
an incomplete satellite payload into a plausible-looking roof or send it down a
parametric fallback rather than exposing the data problem.

**How to apply:** validate polygon vertices, edge endpoints, segment centers,
bounding boxes, and areas at the shared geometry boundary before any arithmetic.
If satellite data was supplied but none survives validation, render the
observable house-centred parametric fallback rather than detached boxes or an
error overlay that hides the fallback.

## Toolbar badge
Footprint type badge is the 3rd toolbar item (after Labels / Stone / Real-shape). Shows green=rectangle, amber=l-shape, purple=t-shape; tooltip includes L/W/fill%. When `forcedParametric` the badge also says "· parametric" and the roof-geometry badge shows 🔷 instead of ⚠.
