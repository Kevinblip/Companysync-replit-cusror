---
name: AI damage count reconciliation and inspector review
description: PhotoSync material-first classification, confidence thresholds, photo types, correction history, and hail/wind count guardrails.
---

Gemini-based damage counters (roof/siding/gutter/metal/brick prompts, plus the drone/wide-angle analyzer) used to be explicitly instructed to "lean toward counting ambiguous damage," and the freeform count field (e.g. `hail_hits_counted`) was never cross-checked against the actual bounding boxes the model drew. Result: on close-up shingle photos, normal granule texture/shadows/tar streaks could get reported as e.g. "1,000,000 hail hits."

**Why:** LLM vision models asked to "lean toward counting ambiguous" cases on a repetitively-textured surface (shingle granules) will over-count, and a freeform numeric field has no structural connection to the itemized detections unless you force one.

**Marker caps (Aug 2026):** owner also wants annotation volume capped — draw at most 20 hail circles / 10 wind brackets, legend switches to "20+"/"10+" wording. Enforced in THREE layers: prompt marker-limit instruction, server-side per-type detection clamp in `_analyzeCrewCamPhotoImpl`, and `annotateImage` draw cap. reconcileCount allows reported > boxes ONLY when boxes hit the cap, bounded at cap×5. Prompt also demands boxes lie tightly ON the damaged surface (marks were being drawn off the roof).

**Material-first review:** Identify the surface before counting damage. If material confidence is below 80%, ask the inspector to choose from alternatives and keep marks uncounted. Count only material-rule-compliant detections at 70% confidence or higher; keep lower confidence marks as separate possible evidence. Aluminum/steel and soft metals use dent evidence; vinyl uses cracks/punctures/holes; shingles require a discrete impact with granule loss, bruising, or fractured mat. Wind findings must match the surface (creases/lifted/torn/missing tabs, panels, seams, or sections).

**Section and photo type:** Inspector-confirmed material and shingle facts are stored per named elevation/slope/component and applied to future re-analysis. Overview photos contribute no hail coordinates or counts. Only Test Square photos contribute to hail/SQ; Close-ups support evidence and, when no square exists, show confirmed raw hits without a density. Never average overview/close-up photos into a square count. Nonroof surfaces use dents/impacts, not Hail/SQ.

**Chalk and spatial review:** Human chalk is a locator, never damage evidence; count a chalk target only when the underlying material independently shows qualifying damage. Suppress repeated hail candidates that form long, straight alignments consistent with shingle courses, valleys, shadows, or imaging artifacts, and flag them for inspection.

**Why:** Mixing photo types inflates or dilutes density, while chalk and repetitive roof patterns can look like impacts. A Test Square is the only defined sampling unit; close-ups and overview images answer different questions.

**Corrections:** Keep each inspector correction linked to its source photo, section, original AI result, and corrected answer. The tenant's recent relevant examples can guide future analyses but must not override the current photo's evidence or explicit confirmed facts.

**How to apply:** Any AI damage/defect counter should (1) word the prompt as evidence-based and list normal-texture false positives, (2) reconcile counts against qualified detections rather than the model's freeform total, (3) preserve the confidence/material rules and marker caps, and (4) flag unresolved observations for human review instead of silently trusting them.
