---
name: Siding photo satellite scale
description: Rules for calibrating ground-level siding photos with satellite/OSM wall widths.
---

Resolve the OSM/Solar footprint before per-photo Gemini analysis so a physical wall-width anchor can be included in the vision prompt. Follow the siding engine's established geometry convention: front/back photos use building width; left/right photos use building length. Do not assign a fixed width to corner, detail, or otherwise ambiguous shots.

**Why:** Resolving the footprint only after vision analysis is too late to calibrate the photo. Swapping the axes or anchoring ambiguous shots makes the fixed scale confidently wrong.

**How to apply:** Keep development and production analyzers in lockstep. Log both the resolved footprint and each per-photo anchor, and enforce the fixed width after model generation so prompt drift cannot replace it.