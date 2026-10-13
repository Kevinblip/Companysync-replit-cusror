---
name: 3D viewer renders a box because it is starved of data, not missing features
description: HouseModel3D already does polygon walls, punched openings and per-face materials; a null footprint polygon silently downgrades all of it. Check the payload before writing geometry code.
---

## The rule

When the 3D house viewer renders "a generic untextured box", suspect the
**payload**, not the renderer. `HouseModel3D` picks its wall builder off one
input:

- `footprintPolygon` present → `buildPolyWalls`: extrudes every polygon edge
  (L-shapes and wings work), and punches real window/door holes as
  `THREE.Path` entries in `shape.holes` — genuine geometry subtraction.
- `footprintPolygon` null/absent → `buildBoxWalls`: four `BoxGeometry` slabs.
  **This path punches no openings at all.**

So a single null field silently disables both the polygon geometry and every
opening cut, and the result looks exactly like "the feature was never built".

**Why:** the satellite siding handler shipped for a long time with a hardcoded
`footprint_polygon_xy: null` while the photo handler emitted a real traced
outline. Every satellite job therefore rendered a featureless box, and this was
repeatedly misread as the renderer lacking polygon/opening support. It has had
that support all along.

**How to apply:** before writing any new geometry code for this viewer, log or
inspect what `footprintPolygon`, `measurementGraph.opening_groups` and
`measurementGraph.wall_facets` actually contain for the failing job. Emit a
polygon from *every* footprint source — even the degenerate rectangle from
`rectanglePolygon(L, W)` is strictly better than null, because it still routes
through `buildPolyWalls` and gets openings cut.

## The pricing invariant

`perimeterFt`, `buildingLengthFt` and `buildingWidthFt` already drive wall area
and therefore money. Footprint geometry added for rendering must be **read-only**
with respect to them. Trace the outline, then pin it to the already-computed
perimeter with `scalePolygonToPerimeter` (scales about the centroid, so wings
and re-entrant corners survive) — the shape improves, the estimate does not move.

**Why:** re-deriving the perimeter from a traced outline would silently reprice
every historical satellite estimate.

## Incomplete satellite roof geometry

When satellite data is present but no roof facet or segment is safe to render,
the 3D panel must say **“Roof preview unavailable — satellite data incomplete”**
instead of inventing an inferred roof or allowing malformed values to reach
Three.js. No satellite roof data at all remains a normal case that can use the
inferred roof.

**Why:** a null polygon, undersized polygon, invalid vertex/bounding box, or
missing coordinate used to escalate from a visualization defect to the
estimator-wide error boundary. A fabricated roof would also hide the upstream
satellite-quality problem from the user.

**How to apply:** validate external geometry at every rendering boundary.
Coordinates and bounding-box spans must be finite; heights are optional and
default to wall-plate height. Do not divide a derived apex by an empty vertex
set. Keep this visualization-only failure separate from measurement and pricing
data so the rest of the estimator remains usable.

## Never infer a material onto an unobserved wall

Per-face cladding resolves each footprint edge to the nearest measured face by
azimuth, and refuses the match beyond 45°. Unmatched edges must fall back to
**null → plain lap siding**, never to the house's majority material.

**Why:** with only the front elevation photographed, a majority-material
fallback paints brick onto the back and both sides — the model then claims a
material nobody ever observed, which is the same dishonesty the measurement
graph refuses elsewhere. Caught in code review, not by a test.

**How to apply:** with all four canonical faces measured, every azimuth is
within 45° of one of them, so the fallback only fires on genuinely unmeasured
elevations. Keep it null.
