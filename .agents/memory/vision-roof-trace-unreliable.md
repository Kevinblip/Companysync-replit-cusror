---
name: Single-shot vision roof tracing is not measurement-grade
description: Why an AI trace of aerial imagery cannot set or gate roof measurements, and what to benchmark before trusting any replacement.
---

Asking a vision model to trace roof facet polygons from aerial imagery — even
with every foot computed in code from an exact Web-Mercator tile scale — is not
repeatable enough to price a job or to flag another source.

**Why:** Benchmarked against a roof with an independent HOVER report
(2,481 sq ft, 7 facets, 5/12), repeat traces of the *same clear image* with the
same model and temperature returned 1,185 / 1,424 / 1,576 / 2,523 / 3,307 sq ft.
Google Solar returned 2,371 sq ft (-4.4%) on that property. The trace was both
unstable (~16% spread between identical runs) and systematically 30-40% low
when framed tightly, because it silently traces only the part of the house it
is most confident about and reports high confidence anyway.

The failure is not fixable by better inputs. All of these were tried and none
converged: a wide neighbourhood frame, a tight ~220 ft crop upscaled for
attention, and genuinely higher-native-resolution Google tiles at z20
(0.18 ft/px, 0% reported obstruction).

**How to apply:**
- Never let a vision trace overwrite a Solar/geometric measurement.
- Do not use it as a disagreement detector either. A gate driven by a estimator
  this noisy sends *correct* measurements to manual review at random — that is
  worse for the user than not running it, and it also burns an AI call per
  measurement.
- Before promoting any future tracer, run the repeatability test first: same
  image, same prompt, 3+ runs. Compare the spread against the ±10% estimating
  tolerance BEFORE comparing the mean to truth. A single run that happens to
  land near truth proves nothing — one of the runs above was +1.7%.

**Separate, still-valid pieces** (these passed their tests and are worth
keeping): the tile stitching math, honest ground-scale reporting, and the
facet graph that turns polygons into slope-corrected edge lengths. Only the
trace feeding them is unsound.

## Imagery availability traps found while investigating

- Esri World Imagery returns a ~2,521-byte **placeholder** tile for z20+ in
  areas it has not flown, with HTTP 200. Byte-size detection is required, or
  you upscale a blank tile and call it detail.
- Esri "Wayback" **winter** selection keys on the release *publication* month,
  not the capture season of imagery at that tile. At one test address the
  winter and recent stitches were byte-identical, and probing the 40 newest of
  196 releases found only 2 distinct images, both leaf-on. This is the likely
  root cause of user reports that the Clear/Winter/Recent switcher does
  nothing. Selecting candidate imagery by tile content hash and canopy score
  would be the real fix.
- A fully tree-occluded property is simply not measurable from any top-down
  source. Confirm with a second opinion (Solar ground area vs. a third-party
  report) before assuming the pipeline is broken.
