---
name: Siding elevation face binding — two vocabularies, two payload shapes
description: Why elevation drawings silently render every wall as an un-photographed generic box; the face-token and payload-shape mismatches behind it.
---

# Siding elevation face binding

Two independent mismatches sit between the photo analysis and the elevation
drawings. Both fail **silently and identically** — the drawings still render, so
nothing errors; the walls just come out as generic estimated rectangles with no
openings. Suspect these first whenever elevations look plausible but wrong.

## 1. Two face-token vocabularies that disagree only on the sides

- Analyzer per-face records: `front`, `back`, **`left`**, **`right`**
- Measurement graph (`wall_facets`, `coverage.missing_faces`, and each
  opening's `wall_face`): `front`, `back`, **`left_side`**, **`right_side`**

Front and back match in both, so any raw `===` comparison *looks* correct in
casual testing and fails only on the two side walls. Symptoms: side elevations
draw with zero openings, and a missing side wall never gets flagged as
un-photographed. Always normalize a face token before comparing it.

## 2. Per-face records reach the drawings under two different keys

The analyzer emits a rich `faces` **array**; the local/graph path emits only
`wall_facets`. A consumer that reads one key sees nothing on the other path.

**Why:** the drawing builder derived "photographed" from the *presence of a
dimension record* rather than from photo evidence. On the path with no `faces`
key that record never existed, so `photographed` was structurally false for
every wall, and every per-face width/height fell back to the global building
box — producing four identical rectangles all stamped
"NOT PHOTOGRAPHED — ESTIMATED" no matter how many photos the user uploaded.

Note a third trap in the same area: one screen reads `faces` as an **object
keyed by face** while the drawing builder requires an **array**. Check the shape,
not just the key name.

**How to apply:** derive coverage claims from real evidence (a facet's photo
count, or `coverage.missing_faces`), never from "is there a record here". Let
coverage veto a raw photo count, since coverage deliberately excludes
reference-only Street View imagery that a photo count would happily include.
When adding per-face dimensions, prefer flat single-wall photos over corner
shots — a corner shot's width describes whichever wall is more prominent in the
frame, which may be the neighbouring wall.
