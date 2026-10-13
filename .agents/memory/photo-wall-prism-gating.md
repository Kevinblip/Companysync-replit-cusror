---
name: Photo wall prism as hero wall area
description: When photo-measured wall planes may replace the footprint extrusion for siding, and the guards that keep the swap honest.
---

Four photo elevations describe a BOX. The footprint extrusion (perimeter x wall
height + gables) describes the real outline. Letting the box become the hero
wall area is only safe behind all of these gates:

1. At least 3 canonical faces measured from photos.
2. MEASURED perimeter >= 98% of the footprint perimeter. Substituted faces
   (width taken from the footprint) fill gaps in the prism but may NEVER count
   toward coverage: on a rectangular footprint a hybrid measured+substituted
   figure is 100% by construction, so it would certify itself. In practice this
   means an unphotographed elevation blocks the prism.
3. Fail CLOSED when the footprint perimeter is unknown — without it nothing can
   detect a wing.
4. The prism may never exceed the extrusion by more than ~2%. Four planes are a
   LOWER bound on wall area; a prism above the extrusion means the FOOTPRINT
   perimeter is under-called, and boxing the house would paper over that.

**Why:** a real benchmark address has a 294 LF traced perimeter while its four
photo faces only account for 204 LF. Without gates 2 and 4 the prism replaced a
correct traced extrusion with a rectangle and under-reported siding ~30%, and
separately inflated a too-short bbox extrusion — each of which decoupled the
"perimeter fix and masonry fix must ship together" benchmark.

**How to apply:** any future change that lets photo evidence override footprint
geometry needs the same shape of guard — prove the photos covered the whole
footprint using photo evidence ALONE, and never let the narrower source inflate
the wider one. If part of the hero area is footprint-derived, the provenance
line must not call it photo-calibrated.

Related: when the extrusion IS the hero, the extrusion-derived sanity total is
the same arithmetic as the answer, so its delta is trivially 0. Report no delta
rather than a zero that reads like corroboration, and never grade on it.
