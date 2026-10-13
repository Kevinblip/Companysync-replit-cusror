---
name: OSM footprints are often bare rectangles
description: Why an OpenStreetMap building outline can silently understate perimeter, and the rules for choosing between OSM and the Solar facet trace.
---

# A 4-corner OSM way cannot represent an articulated house

OpenStreetMap building outlines are volunteer-drawn and very frequently a plain
rectangle thrown over a house that actually has wings, an L, or a garage bump-out.
Accepting one unconditionally understates the perimeter (observed: 197 LF against
a true wall perimeter of ~216 LF, about 9% low).

**Do not calibrate this against a competitor's drip-edge or fascia figure.** Those
cover eaves + rakes and run 30-50% longer than the wall perimeter on a gabled
house; the comparable line is the wall / level-starter perimeter. An override gate
tuned to a drip-edge target (e.g. "the trace must be >= 1.15x the OSM perimeter")
will reject a correct trace and accept an over-long one — and because perimeter
multiplies wall height, an over-long outline inflates every siding quote.

**Rule:** treat an OSM way with <= 5 corners as *provisional*. A quadrilateral is
geometrically incapable of expressing a re-entrant corner, so when that is all OSM
has, still attempt the roof-facet union trace and keep whichever outline is better.

**Why:** the facet-union trace preserves wings and re-entrant corners, but it used
to sit behind OSM as a pure fallback and therefore never ran for the exact houses
that needed it most.

**How to apply:**
- Only let the trace override OSM when it is a genuinely *traced* polygon AND
  materially longer (a rectangle-approximation candidate is no better than OSM's
  rectangle, and swapping one box for another moves billed numbers for nothing).
- Keep the existing area-sanity bounds on the trace; a wild trace means bad facets,
  not an unusual house.
- The extra satellite call is opportunistic, so bound it (abort timeout, fewer
  quality retries) and make any failure leave the OSM result standing.
- Do not emit a "satellite rejected" warning when OSM legitimately stands — that
  path is a normal outcome, not a rejection.

# Fascia and soffit do not follow the siding perimeter

In the photo path, fascia/soffit are derived from **bounding-box dimensions**,
completely independently of the perimeter used for siding. Correcting the perimeter
does nothing for them; they must be pointed at the traced outline separately.

Two consequences worth remembering:
- A house can report a correct siding perimeter while fascia and soffit are ~30% low.
- A bbox-derived drip edge is **rotation-dependent**: for a rectangle rotated off
  north, the bbox circumscribes the shape and over-quotes fascia by up to ~35%.
  True polygon edge perimeter is rotation-invariant and correct. Offsetting a closed
  rectilinear plan outward by `d` adds `8d`, which reduces exactly to the old bbox
  formula for an axis-aligned rectangle — so that identity is the backward-compat
  test to assert when changing this.
