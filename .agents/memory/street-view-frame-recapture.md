---
name: Street View frame recapture
description: Why a rejected auto-fetched Street View frame must be re-fetched rather than skipped, and what actually constitutes a different capture.
---

# Rejecting a Street View frame is not the same as the wall being unmeasurable

Auto-fetched Street View frames are aimed purely by map geometry (a bearing from
a road panorama toward the house centroid). That aim knows nothing about street
trees, camera pitch versus roof height, or a nearer neighbouring house. So a
frame that shows foliage/sky/the wrong house is evidence of a **bad aim**, not
of an unmeasurable wall.

**Rule:** a rejected machine-aimed frame must trigger a bounded recapture before
the wall is reported unmeasured. Only an uploaded human photo is allowed to be
"all we have".

**Why:** detection alone turns a wooded lot from four usable angles into one,
which drops the estimate's confidence grade and widens the error range — the
honesty fix silently became an accuracy regression.

**How to apply:** the verdict and the retry ladder must live in the SAME module,
or the categories that trigger a retry drift from the categories the ladder
knows how to remedy.

## The remedy depends on WHY the frame failed

Re-aiming a camera that is buried in a tree does nothing; walking down the
street does nothing when the camera is tilted at the sky. Foliage/obstruction →
change the panorama SEARCH DISTANCE (that is what surfaces an adjacent
panorama). Sky → lower the pitch from the same vantage. Neighbouring building →
get closer and narrow the field of view.

## A "different capture" is not just a different panorama id

Fingerprint an attempt on `panoId + heading + pitch + fov`. Keying on the pano
id alone discards re-aim attempts as duplicates — and re-aiming the same
panorama is the entire remedy for a sky-filled or neighbour-filled frame.

Empirically (Cleveland residential, verified against live metadata): searching
from a different distance yields a genuinely new panorama for most walls, but
some walls resolve to the same pano at every distance. Those walls are only
recoverable by re-aiming, so the fingerprint must permit it.

## Retries need two ceilings, not one

Per-wall attempts AND a request-wide budget. Per-wall alone lets an address
where every angle is blocked multiply AI spend and latency by the per-wall
ceiling across all four faces. Keep the request budget strictly below
`4 × per-wall`.

An attempt that finds no panorama costs no vision call — do not charge it
against the request budget, and do not let it end the ladder early.

## Fail open on a missing verdict, fail closed on an explicit one

Contractor uploads predate the frame-subject field. Refusing to measure a good
uploaded photo because the model omitted one key is a far worse regression than
the bug being fixed. Only reject an upload on an explicit rejection category.
Machine-aimed frames may additionally fail closed on a zeroed measurement,
because no human chose that framing.

## "We stopped trying" is not "the house is blocked"

A bounded retry ladder has two very different ways of ending, and they must not
share a status:

- The ladder ran out of rungs — every reachable alternative was tried or does
  not exist. This is the ONLY ending that is evidence about the house, and the
  only one that may be shown as "obscured / skipped".
- The ladder was cut short by one of our own limits — the shared request budget
  was already spent on earlier walls, or the lookup key is missing. The wall is
  equally unmeasured, but nothing was learned about the house.

**Why:** with a per-wall ceiling AND a smaller request-wide budget, the later
walls of a fully-blocked address predictably receive ZERO attempts. Collapsing
both endings into one status makes the UI tell the estimator that a wall nobody
looked at is obscured from the street — a confident claim on evidence never
gathered, which is the same dishonesty the retry feature was built to remove.

**How to apply:** have the loop record WHY it stopped and pass that into the
summary; default null (ran out of rungs). Both endings still drop the rejected
frame from aggregation — they differ only in what is claimed, never in what is
measured. Test the interaction at the handler level: a summary fed hand-written
failed attempts cannot catch a wall that was never attempted at all.

## A provider failure is not a finding

The same trap recurs one level down, inside each rung. When an attempt does not
produce a measurement there are two very different causes:

- **Determinate** — the provider answered. Street View metadata returning
  ZERO_RESULTS/NOT_FOUND really means no panorama near that point, and a frame
  that was fetched, analyzed, and judged unusable really was unusable. These
  are rungs of the ladder and may end in an honest "obscured".
- **Indeterminate** — the provider never answered. A network timeout,
  REQUEST_DENIED, OVER_QUERY_LIMIT, an unreadable body, or a vision/image call
  that threw. Nothing was learned; the angle was never actually judged.

**Why:** collapsing these makes an outage, an expired key, or a blown quota
render as "this wall is obscured from every angle we could reach" — a confident
claim about the house manufactured out of our own downtime. It is the same
dishonesty as reporting an un-attempted wall as skipped, and it is easy to
reintroduce because the natural `if (!frame || frame.error)` guard lumps both
together.

**How to apply:** have the resolver return the provider's status, not just
null/error, and branch on a whitelist of statuses that count as a real answer;
treat everything else as indeterminate. Stop the ladder on an indeterminate
failure rather than retrying into the same outage. Test with the actual status
strings — a synthetic "no panorama" stub passes while the failure paths stay
broken.
