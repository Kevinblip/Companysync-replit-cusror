---
name: Batch AI classification silently drops inputs
description: Why assignment loops must iterate the uploaded items, not the LLM's response array, and why non-abortable timeouts must still collect late successes.
---

# Batch AI classification silently drops inputs

When a batch of user-supplied items (photos, rows, files) is classified by one
LLM call and then assigned to slots, **iterate the INPUTS and look up the
classification, never iterate the model's response array.**

**Why:** cramming ~12 images into a single Gemini call routinely returns a
*short* array — the model just stops early. An assignment loop written as
`for (const cls of aiResponse) { const item = inputs[cls.index]; ... }` places
only the items the model happened to mention and discards the rest with no error,
no log, and a success message. The observed symptom was a contractor uploading a
dozen exterior photos and seeing exactly one appear.

Three failure modes stacked in the same loop, all silent:
1. iterating the response array (above);
2. a fixed number of overflow slots with a hard `break` past the last one;
3. duplicate labels (several shots of the same wall) funnelled into that same
   truncated overflow.

**How to apply:**
- Iterate inputs; a missing classification is a *default*, not a drop.
- Split large multi-item classification into small parallel chunks (~4). Fewer
  truncations, and concurrency makes it faster than one big call. Remap each
  chunk-local index back to the owning input's global index.
- A failed chunk must let its items fall through to the default bucket, never
  lose them.
- Parse defensively: a model may wrap its array in an object or return a JSON
  string. `JSON.parse(JSON.stringify(x))` cannot turn an object into an array.
- Grow the overflow UI to fit the data instead of truncating the data to fit
  fixed UI slots.
- Status messages must count what actually landed and name what failed;
  counting filled slots reports a drop as a success.

## Conservative facade classification

Batch photo classification should return a constrained label plus shot type,
confidence, evidence, and a short reason. Low-confidence, detail, non-building,
and uncertain-orientation results belong in numbered Detail slots, while duplicate
face shots remain visible as details. Mark manually assigned face slots so later
AI batches cannot replace them silently.

**Why:** A label-only model guess is not reliable enough to decide whether a
photo is a usable facade measurement. An oblique/cropped image can contain words
like “front” or “side” in its label while still being invalid as a straight-face
scale anchor.

**How to apply:** Keep EXIF heading and footprint geometry authoritative for
physical facade binding. Never grant satellite wall-width anchors to corner or
detail labels based only on substring matching.

## A timeout that cannot abort still owns its result

`Core.UploadFile` takes no `AbortSignal`. Racing it against a timeout only frees
the worker — the request keeps running and may succeed afterwards. If the result
array is snapshotted the moment the worker pool drains, that successful upload is
orphaned: stored remotely, counted as failed, never shown.

**How to apply:** attach a `.then` that records the late result, keep the
promises, and after the pool drains give stragglers a bounded grace window
(`Promise.race([Promise.allSettled(inFlight), timeout])`) before snapshotting.
Also be conservative raising worker counts when timeouts can't abort — in-flight
requests are not actually capped by the worker count.

## Related invariant worth testing

Extract the pure slot-assignment logic out of the component and assert the blunt
invariant directly: **every input URL appears in the output.** The bug class is
silent by nature, so only an explicit no-drop test catches a regression.
