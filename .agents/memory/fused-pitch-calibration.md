---
name: Fused satellite-to-photo pitch calibration
description: Rules for applying a photo-derived roof pitch over the satellite baseline without compounding or dishonest provenance
---

# Fused satellite-to-photo pitch calibration

**Rule:** When a ground-photo pitch overrides the satellite baseline, the roof area must be re-projected from an isolated 2D footprint (Solar ground stats preferred, de-projection by the ORIGINAL satellite pitch as fallback) — and every re-application must derive from cached immutable baselines (isolated footprint, original linears), never from already-scaled values.

**Why:** Scaling scaled values compounds on repeated refinement (photo → street-view → manual) and never reverts; de-projecting a recalibrated sloped area with the old basis pitch inflates it each round.

**Key policies:**
- Raw `roof_area_*` must follow the fused value, not stay at the satellite reading — export/report paths read the raw fields, so leaving them stale makes documents contradict the UI. Pre-override value lives in provenance fields only.
- Ridge/eave are horizontal (unchanged by pitch); rake scales ∝√(1+s²); hip/valley ∝√(2+s²) — always from baseline linears.
- If the photo measurement graph takes area authority during reconciliation, clear the "area recalculated from footprint" claim — the pitch badge may not assert a re-projection that isn't what's displayed.
- Fail honest: if no footprint can be isolated (unknown satellite pitch, no ground stats), update only the pitch label and say so — never guess an area recalculation.
- The stored order-quantity field must be recomputed from the re-projected area + waste. Estimate and measurement-report HTML PREFER that stored field over recomputing from area, so leaving it alone makes exports print the pre-override quantity while the UI shows the new one.

**Provenance is a separate axis from the maths.** A hand-picked pitch and a photo-detected pitch run the identical re-projection, but they must not share the "photo-verified" flag — the engine takes a `source` option and derives the badge/label flags from it. Consumers that branch on the photo flag (3D model pitch, chat-message pitch note, badges) each need the manual case added explicitly, or a manual override silently renders/reports the old satellite pitch.

**Any sticky pitch state is property-scoped.** A pitch (photo or manual) held in page state will be re-applied to the NEXT address's footprint and recalibrate its area — a cross-job estimate error. Reset it wherever a new address is confirmed, alongside the story-count reset that already guards the same class of bleed.

**Crew-camera acceptance is fail-closed.** A photo pitch needs explicit visible gable/rake evidence plus high/medium confidence. Never derive it from a Solar segment; reject contradictory two-photo readings and remove outliers before fusion.

**Why:** A plausible but ungrounded Gemini slope silently turns Solar’s own estimate into fake “ground truth,” and one conflicting elevation can materially change a priced roof.

**How to apply:** Keep the dev and production photo prompts/handlers in lockstep. Preserve an explicit visible-rake field, return only corroborated numeric slopes, and let the fused formula re-check the consensus for any saved/legacy payload.

**How to apply:** Extend the calibration regression coverage when changing pitch/area math or provenance flags.
