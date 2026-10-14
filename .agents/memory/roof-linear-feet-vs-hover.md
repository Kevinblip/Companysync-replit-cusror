---
name: Roof linear feet vs HOVER (headline vs facet-edge)
description: Why our satellite roof area lands close to HOVER while ridge/hip/rake/eave lengths do not, and which internal field is actually trustworthy.
---

Satellite (Solar-based) roof measurement produces TWO independent sets of linear
quantities, and they disagree:

- The roof-type and area heuristics produce fallback linears when usable facet
  geometry cannot be traced.
- Facet-edge linears can replace heuristic linears only as one set after the
  trace proves connected topology with no unresolved uphill boundaries.

When the roof-type classifier calls a mixed gable/hip roof a pure "hip", its
fallback emits `rake_lf: 0` (hip roofs have no rakes by definition) and inflates
`hip_lf`, while the facet-edge set still reports a rake total close to reality.
Reconciliation must happen after geometry is traced so pricing cannot retain
the contradictory fallback.

**Why:** Roof AREA can be accurate (Solar segment sum) at the same time the
SHAPE classification is wrong, so a good area number is not evidence that the
linears are good. Linears drive drip edge, starter, ridge cap, and gutters —
under-ordering perimeter material and over-ordering ridge cap at the same time
can look "roughly right" in total dollars while both line items are wrong.

**How to apply:** When comparing against HOVER/EagleView, compare area, pitch,
and EACH linear separately, and check the facet-edge totals before blaming the
geometry: the usable edge data often already exists. A partial/disconnected
trace or provisional ridge is diagnostic only, never pricing authority. Surface
material fallback-vs-trace differences for diagnosis. Solar segment count
(e.g. 4) routinely under-counts real facets (e.g. 7), so a low segment count is
an early warning that the shape classification — and therefore every linear —
is suspect.

A hip or valley is drawn only when the facet rectangles overlap. Nearby corners
with no overlap are not a valley, and they must not delete the perimeter edges
beside them. A side that tracks another facet's eave in plan is an eave. Shared
ridge copies that sit a foot or two apart are the same ridge and are counted
once. The length Solar never published (the facets it merged away) stays missing.
