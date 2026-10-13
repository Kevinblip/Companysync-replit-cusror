---
name: Line-item scoping rules (starter, drip edge, house wrap)
description: Measuring an edge correctly is only half the job — which edges a given line item bills is a separate decision, and getting it wrong is invisible in the measurement report.
---

# Scoping is a separate decision from measurement

The measurement engine answers "how long is the eave". A line item needs a second
answer: "does this product bill the eave, or the eave plus the rake". That second
answer is not derivable from the measurement, it is a trade convention, and when
it is wrong nothing in the measurement report looks off — the error only surfaces
when an adjuster scopes the job differently than we did.

**Why this matters commercially:** over-scoping is not free revenue. On an
insurance job the carrier scopes to convention, so anything above it becomes a
write-off the contractor eats.

## The conventions that were wrong here

- **Asphalt starter course bills the EAVES only.** Xactimate and Hover both scope
  it that way. Running starter up the rakes is a legitimate wind-uplift upgrade
  and some manufacturer warranties ask for it, so it stays available — but as an
  explicit setting, never as a silent default.
- **Drip edge bills eaves + rakes.** This one genuinely is the full roof
  perimeter, and a competitor's "Drip Edge/Perimeter" line equals eaves + rakes
  exactly. Starter and drip edge sharing one `totalEdge` variable is how the two
  got conflated.
- **House wrap is NOT deducted for masonry.** A weather-resistive barrier is
  installed behind brick and stone veneer too, so wrap follows the whole sheathed
  wall: net siding + masonry area − openings already charged to the masonry
  column. Reusing the siding quantity for wrap under-orders it on every
  mixed-material house.

**How to apply:** whenever two line items share a quantity variable, check whether
they actually share a scope. If a competitor's report lists them as separate
lines with different lengths, they do not. Where a convention is defensible in
both directions, make it a setting with the carrier-standard value as the default
and put the chosen scope in the line item's note so the estimate is auditable.

Fallback discipline: a scope narrowing must never make a line vanish. When the
narrower input is unavailable (e.g. eave length missing on a legacy measurement),
fall back to the old combined quantity rather than emitting zero.

## Chat area corrections are not a full remeasurement

An area quoted “per side” is insufficient to rebuild the whole siding estimate.
“SQ” might mean a 100-SF siding square or square feet; the side count, openings,
masonry, corners, and trim lengths still matter. An explicitly requested
installation-line quantity can be converted between SF and SQ, but it must not
automatically rescale wrap or accessories.

**Why:** A broad numeric chat shortcut once treated an area correction as a new
unpriced item; conversely, guessing the total from partial geometry would produce
a plausible but materially wrong estimate.

**How to apply:** Ask for the units and missing dimensions, then rebuild from
measurements for whole-estimate changes. Never infer a catalog rate from an
aggregate $/SQ target unless the user explicitly requests a price override.
