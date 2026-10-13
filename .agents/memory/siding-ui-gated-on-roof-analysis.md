---
name: Siding UI must not be gated on roof analysis
description: Why siding review panels vanish — they get nested inside the satelliteAnalysis (roof) JSX gate, which a siding-only job never satisfies.
---

# Siding review UI must never be gated on `satelliteAnalysis`

In the AI Estimator, the big satellite card is wrapped in a JSX gate that requires
`satelliteAnalysis` — the **roof** measurement result. Siding measurement state
(`sidingMeasurements`) is produced by a completely different backend call and a
siding-only job **never runs a roof measurement at all**.

Any siding panel authored inside that gate is therefore dead UI for the exact
workflow it was built for. The symptom the user reports is *not* "panel missing" —
it's **"the tool reset / it starts over"**, because the chat says "review the
Measurement Summary below" and there is nothing below, while the satellite card
still shows its initial AI Auto-Detect / Manual Drawing chooser.

**Why:** the two measurement paths are independent, but the JSX nesting implies a
dependency that does not exist. It is very easy to add siding UI "next to the
satellite stuff" and land inside the roof gate without noticing.

**How to apply:** anything keyed on `sidingMeasurements` (summary, confidence
grade, elevation drawings, the Build Siding Estimate button) belongs in a sibling
`{sidingMeasurements && ...}` block *outside* the roof gate. Only controls that
genuinely consume satellite data — e.g. the "Measure Siding from Satellite"
button — stay inside. Consumers that take `satelliteAnalysis` must be null-safe
(`satelliteAnalysis || {}`), since it is legitimately null on this path.

## Auto-build masks broken review UI

This defect sat latent for a long time because the flow used to auto-build an
estimate as soon as measuring finished: the estimate editor produced visible
output, so nobody noticed the review panel never rendered. The moment
measuring was changed to stop at "here are your measurements" (an explicit
`autoBuild: false`), the missing panel became the whole user-visible bug.

**Why:** an auto-advance step downstream of a broken screen hides that the screen
is broken.

**How to apply:** when removing or gating an auto-advance step, explicitly verify
the intermediate screen it used to skip past actually renders — it may never have
been exercised.

## Don't auto-collapse the photo panel on photo-driven measurements

An effect collapses the "Measure Siding from House Photos" accordion when fresh
measurements arrive. That is right for a **satellite-only** run (results render
in the card above) and wrong for a **photo-driven** run — it yanks the user's own
photos off screen at the moment they're told to review the numbers, reinforcing
the "it started over" reading.

**How to apply:** gate the collapse on measurement *provenance*, not on the
measurement value changing. A ref set at the top of the analyze handler works;
a data flag does not, because the uploaded-photos variable is not in scope at
every `setSidingMeasurements` call site.
