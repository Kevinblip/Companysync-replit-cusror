---
name: Street View frames in the siding measurement
description: The AIEstimator Street View frame pipeline was dead code, and why the estimator's per-frame veto keys on the wall face rather than the panorama id.
---

## The static Street View frame panel was unreachable dead code

The AI Estimator's `elevationImages` state, and the panel that loads it, sat inside
a JSX block gated by `{false && (`. Every merge path downstream of it — the
photo-list builder, the uploaded-photo de-duplication, the facade/3D textures —
was written and correct, but **no Street View frame ever reached the siding
measurement**, because nothing ever populated the state.

**Why it matters:** reading the merge code bottom-up makes the feature look live.
The only way to tell is to check who *writes* the state, not who reads it.

**How to apply:** when a measurement input looks wired up but never seems to
affect results, grep for the state's setters and confirm at least one is on a
reachable code path. A `{false && (` or `display:none` ancestor makes every
setter inside it unreachable while leaving the readers looking healthy.

Loading these frames costs a Google Street View Static API call per face, so the
load is behind an explicit button rather than firing on address selection.

## A frame veto keys on the wall face, never the panorama id

When the estimator rejects a frame ("wrong house", "truck blocking the wall"),
the veto is stored against the normalized wall face (`front`, `right_side`, …)
scoped to the property address.

**Why:** Google re-shoots streets and returns a new `panorama_id` for the same
address. A pano-scoped key would silently re-admit the rejected face the next
time the imagery refreshed — exactly the failure the veto exists to prevent.
The face-scoped key is deliberately broader than the thing that was rejected.

**How to apply:** any per-frame estimator decision needs the same treatment. Pair
it with an explicit undo control in the UI, since a sticky key that outlives the
imagery must never become a dead end. Also apply the veto everywhere the frame
is consumed — the submitted photo list, the saved estimate evidence, and the
facade/3D textures — or a frame the estimator rejected still visibly represents
the measurement it was excluded from.
