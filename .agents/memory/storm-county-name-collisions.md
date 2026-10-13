---
name: Storm county-name collisions pin out-of-state alerts to Ohio
description: Why a storm ~300 miles away in another state renders as "60 mi away" and passes the office radius filter — the county→coords lookup is keyed by bare county name.
---

# Storm county-name collisions

The county/city → coordinate lookup tables in `db/storm-functions.cjs` are keyed by a
**bare lowercase county name** with no state, and they are populated almost entirely with
Ohio (plus a few PA) counties. Example: `'carroll': { lat: 40.5763, lng: -81.0890 }` is
Carroll County, **Ohio**.

County names are massively duplicated across states — Carroll, Hamilton, Montgomery,
Warren, Clinton, Monroe, Jackson, Lawrence, Marion, Brown, Greene, Knox, Washington and
many more exist in a dozen states each. NWS zone alerts carry a plain county-name list and
no state in that list.

Result: an NWS advisory for an out-of-state zone whose **first** county name happens to
collide with an Ohio county gets stamped with the Ohio county's coordinates. A wind
advisory covering Indiana counties (Carroll, Warren, Tippecanoe, Clinton, Howard,
Fountain, Montgomery, Boone, Tipton, Hamilton) was stored at Carroll County OHIO's
coordinates — about 62 miles from a Bedford Heights, OH office instead of ~300.

**Why it matters:** the alert cron's distance gate trusts the stored `latitude`/`longitude`.
Bad coordinates defeat the radius filter completely, so the alert email reports a real
distance ("60.6 mi away") next to a county list from a different state. The distance is
not merely cosmetic — it is what let the storm through.

**Why the existing guard doesn't catch it:** there *is* a state guard, but only on the
**text fallback** matcher (the "Cleveland, NC must not match Cleveland, OH" path), and that
fallback only runs when coordinates are absent. When a bogus coordinate exists, the
coordinate path wins and the guard is never consulted.

**How to apply:**
- Any county/city → coordinate lookup must be keyed by **(state, name)**, never name alone.
  All storm geography now lives in ONE shared CJS module so the dev plugin and the prod
  storm functions cannot drift apart again; both require it rather than holding a local copy.
- Resolve the storm's state from the NWS zone / UGC code (which encodes the state), not by
  inferring it from the area names. Persist those states on the row at ingestion so the
  alert cron never has to re-infer them.
- Treat a coordinate whose derived state disagrees with the event's zone state as missing,
  and fall back to the state-guarded text matcher rather than trusting it.
- When auditing, look for many distinct events sharing one exact lat/lng — that is the
  signature of a name-keyed fallback table being hit.

**Distrust the coordinate only when it is NAME-derived.** A real alert polygon can straddle
a state line, so its centroid legitimately falls just outside the first UGC code's state —
rejecting on state disagreement alone throws away good measured positions (it flagged ~200
genuine multi-state polygon centroids, e.g. an alert covering Ashtabula OH + Crawford PA).
The reliable discriminator is that the coordinate lands *exactly* on a lookup-table
centroid; a measured polygon centroid or a storm-report GPS fix essentially never does.

**`has_geometry` is not a trustworthy provenance flag on its own.** The active-alert path
set it from "did we end up with a latitude" rather than "did this come from a polygon", so
centroid fallbacks were labelled as geometry. Fixed, but rows written before that keep the
wrong flag — which is why the exact-centroid test carries the weight.

**A zone-level state guard is required in the text fallback too.** NWS `areaDesc` carries
bare county names with no state ("Carroll; Warren; Tippecanoe"), so the pre-existing
per-area state guard can never see a state to compare. Only the UGC-derived zone state can.
