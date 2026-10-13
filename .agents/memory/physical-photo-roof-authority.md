---
name: Physical-photo roof authority
description: Quantity-safety rules for calibrated roof measurements from physical photos.
---

# Physical-photo roof authority

Physical-photo roof measurements are already slope-area measurements. Never apply a second pitch multiplier.

Photo area may become estimate-authoritative only when all strict graph gates pass: a mapped OSM/Solar/measured-eave footprint OR a fully calibrated photo footprint, four verified elevation calibrations, stable unique plane identities, every plane unoccluded with known face/pitch and confidence >=70, conservative simple topology (two opposing planes or four one-per-elevation planes), pitch-projected footprint consistency, and no more than 25% disagreement with satellite when satellite exists.

**Why:** Phone photos can omit, overlap, or hallucinate planes. Loose coverage rules can create expensive shingle and accessory quantity errors.

**How to apply:**
- Recompute each plane area from calibrated width × slope length; model-reported area is diagnostic only.
- Keep area, roof-edge, and gutter completeness separate.
- Never infer gutters from eaves.
- Preserve satellite linears unless photo edge/gutter coverage is independently complete.
- Photo-only area can succeed while incomplete edge/gutter quantities fail closed to zero with review warnings.
- 3D photo planes render only when reconciliation selects `physical_photos` as `estimate_area_source`; otherwise use Solar facets or clearly labeled inferred geometry.
- A complete photo graph may replace the roof area source for the photo-only flow; incomplete photo graphs remain evidence only and preserve Satellite fallback.