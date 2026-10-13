---
name: Footprint polygon geometry
description: Why footprints are traced polygons rather than rectangles, what Google Solar actually returns, and the invariants every footprint path must hold.
---

# Footprint polygon geometry

## Google Solar does not return a building outline

The Solar API (`buildingInsights:findClosest`) returns a whole-building
`boundingBox` and a per-segment bounding box in
`solarPotential.roofSegmentStats[]`. **There is no outline polygon.** Any plan
that says "just use the Solar polygon" is unimplementable as written — check
this before promising outline fidelity on a Solar-only address.

Only OSM gives a genuine surveyed outline, and OSM building coverage is far
from universal, so a Solar path that returns nothing is not an option.

## How each source produces a polygon

| Source | Outline |
| --- | --- |
| OSM | true surveyed way; walk the vertices |
| Solar | union of the roof-facet rectangles, inset by the eave overhang |
| roof_eave | whichever outline already exists, resized to the measured perimeter |
| photos | centred rectangle from the photo-derived dimensions |

**Every path emits a real polygon, and the perimeter is always measured off the
polygon that is actually returned.** That invariant is the point of the whole
design: the 3D model, the report and the estimate physically cannot disagree
about the shape of the building.

**Why:** the old code synthesised a rectangle from `sqrt(area x aspect)` and
then multiplied the sides by a magic `0.925`. That erased every wing and jog —
an L-shaped house rendered as a squashed box — and the perimeter it reported
belonged to a building that did not exist.

## Two fields, deliberately

- `footprintSource` — `osm` / `solar` / `roof_eave` / `photos`. Keep this
  vocabulary: `buildRoofMeasurementGraph` whitelists exactly
  `['osm','solar','roof_eave']` for `mappedFootprint`.
- `footprintGeometry` — `traced_polygon` | `rectangle_estimate`. Shape fidelity
  rides here so confidence and the 3D model can react to it without disturbing
  the source whitelist.

## Traps

- **Rotate before you rasterise.** The facet union is traced on a raster grid.
  A house at 30 degrees to north traces as a staircase and inflates perimeter by
  up to 41%. Rotate onto the area-weighted dominant facet azimuth (folded to
  90 degrees, averaged on the 4-theta circle) first, trace, then rotate back.
- **A traced outline already contains the attached garage.** Anything that used
  to compensate for the missing wing must be gated off, or it double-counts:
  this killed a wall-area supplement in the analyser and a synthesised wing mesh
  in the 3D viewer. Both were added back when the rectangle erased the garage;
  both are wrong now.
- **`width * length` is the bounding box, not the plan area.** Once L-shapes
  survive, every ratio computed from the bbox reads low and can trip the
  siding-to-footprint sanity warning on a perfectly good measurement. Use the
  polygon's true area.
- **A measured perimeter is a number, not a shape.** When a roof-eave line or a
  contractor edit overrides the perimeter, resize the polygon about its centroid
  rather than rebuilding a rectangle from the number.
- **Leave the AI photo-scaling prompt hint alone.** There is a second `0.925`
  used to describe the Solar bbox to the vision model. It is a separately tuned
  subsystem with its own benchmark, not perimeter math.

## Eave overhang

`DEFAULT_EAVE_OVERHANG_FT` must stay equal to `DEFAULT_OVERHANG_FT` in the
derived-quantity math, or fascia/soffit totals describe a different building
than the footprint does. A test asserts this lockstep across all three files.

## OSM-to-Solar replacement is a geometry override, not an area correction

A traced Solar facet union may replace a crude rectangular OSM footprint to
preserve wings and re-entrant corners only when their wall-line perimeters agree
within 10%. Do not require the Solar trace to be longer and do not use roof drip
edge as evidence that the wall line is longer.

**Why:** gross siding wall area is perimeter × height. A benchmark initially
treated a 294 ft Hover roof drip edge (eaves + rakes) as wall perimeter, while
Hover's actual Level Starter wall line was about 216 ft and the existing OSM
perimeter was 197 ft. Rewarding a materially longer trace would have accepted
the wrong roof-edge-like number, rejected the correct wall line, and inflated
the siding quote by 20–50%.

**How to apply:** use agreement between the independent OSM and Solar sources as
the evidence for a shape-only replacement. If they differ by more than 10%, keep
the existing wall-line source and require explicit wall-line evidence or manual
review before changing billed perimeter.
