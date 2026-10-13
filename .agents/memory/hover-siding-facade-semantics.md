---
name: HOVER siding facade semantics
description: How to interpret HOVER Complete Measurements facade and net-siding quantities.
---

When a HOVER Complete Measurements report says its siding facade values include
openings, treat `Facades` as the pre-opening siding-clad surface. Do not
substitute it for a post-opening net-siding value.

**Why:** A comparison against a CompanySync net siding value would mix
measurement stages and create a large but unsupported discrepancy or accuracy
claim.

**How to apply:** Map the printed HOVER Facades value to the pre-opening siding
facade comparison only. Leave HOVER net siding unavailable unless the report
explicitly prints a post-opening value; never infer it from a waste table or
total.

## Satellite-only siding overshoots multi-story houses

The photo-free siding path multiplies the traced perimeter by
`storyCount × storyHeight` around the WHOLE building. On a benchmark house that
HOVER reports as "> 1 story", the real total facade averaged ~12 ft of wall
height because only part of the footprint is two storeys — a full 2 × 9 ft
assumption came out ~56% high. Two further one-way biases stack on top:
the satellite path deducts a flat opening percentage (which ran more than
double the report's actual opening area) and deducts zero masonry even when the
report shows a few hundred square feet of brick facade.

Its derived roofline quantities lean the other way: fascia and soffit came out
~25% and ~64% short of the report.

**How to apply:** Never present a photo-free siding number as comparable to a
HOVER siding total. Say which inputs are assumed (storey count, storey height,
opening percentage, no masonry) and get elevation photos before claiming
accuracy. A photo-free number matching the report is usually a coincidence of
offsetting assumptions, not agreement.