---
name: Roof map imagery/tilt controls are shared, not per-page
description: Why the manual and auto roof maps must share one imagery/tilt module rather than each keeping a copy.
---

The manual roof map and the auto (AI Estimate) roof map each grew their own copy
of the satellite-imagery picker and tilt control. They rendered the same buttons,
so the divergence was invisible — but the auto copy was materially weaker: less
detail at high zoom, no placeholder-tile detection, buttons not shielded from map
pointer events, and historical imagery releases ordered by an id field instead of
by date, so the named captures could resolve to the wrong image entirely.

The alternate imagery picker is currently hidden from roof maps because its
seasonal choices did not reliably produce useful tree-free imagery. Standard
satellite imagery remains visible, and roof-tilt controls remain available.
Do not restore alternate-source buttons unless property-level coverage is
verified and the selected imagery actually loads at the property.

**Why:** the displayed preset controls implied a reliable current, leaf-off, or
historical view, but users still saw the same obscured imagery. Leaving those
choices visible damaged trust. Also, an unencoded Overpass query can return HTTP
406 and silently remove the independent footprint check. The imagery provider's
config shape drifts, so date logic must parse dates rather than trust an ordering
field.

**How to apply:** both roof maps must keep alternate imagery controls hidden until
coverage and display behavior are verified. If the feature is restored, use the
shared imagery module and retain the auto page's distinct tilt-control position.
Treat alternate imagery as measurement input only after an actual
capture/geometry pipeline consumes those pixels; never infer that from a selected
button.

Wayback archive publication dates are not imagery acquisition dates. A December,
January, or February archive can contain summer imagery at a particular property.
Never claim leaf-off coverage merely from an archive's publication month.

**Why:** Esri explicitly distinguishes archive dates from capture dates; a
season-labeled archive can still show the same tree-obscured roof.

**How to apply:** consult location-specific acquisition metadata and review the
actual imagery before describing it as leaf-off. Display unknown dates and
unavailable coverage honestly, and identify fallback imagery rather than retaining
an unsupported seasonal claim. Source:
https://community.esri.com/t5/arcgis-living-atlas-questions/the-acquisition-time-of-historical-images-when/td-p/1401765

Public GIS catalogs can list aerial services that are stopped or unavailable;
ArcGIS may return HTTP 200 with an error object instead of usable metadata.

**Why:** catalog visibility alone does not establish that imagery can actually
be displayed. Reporting it as available recreates misleading source selectors.

**How to apply:** check the service response body as well as HTTP status, expose
provider outages, and distinguish available captures from catalog entries.

Historical selections must not silently expose current Google satellite pixels
under missing or loading tiles. Top/compass controls must retain the selected
imagery source; only an explicit Default selection should restore Google imagery.

**Why:** users still saw leafy trees after changing sources because the overlay
was transparent where tiles failed, and navigation controls restored the current
satellite base. A dated label alone does not establish what pixels are visible.

**How to apply:** use a non-photographic base for alternate imagery, preserve it
through navigation, and report tile success only after the photograph decodes.
