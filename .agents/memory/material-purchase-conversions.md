---
name: Material purchase-unit conversions
description: How the Material Purchase List converts raw roof measurements into purchase units, and the 3 places that must stay in lockstep.
---

# Material purchase-unit conversions

The Material Purchase List modal (Order Sheet + Vendor List tabs) converts roof
measurements into orderable purchase units (bundles, rolls, sticks, boxes).

**Key rule:** a purchase list must be derived deterministically from the
estimate's *install* line items, never from an LLM-generated generic material
bucket. An AI result like `"Shingles": 13 SQ` has no product identity; a fuzzy
frontend matcher can therefore apply it to both laminate and 3-tab rows.

Every generated material row now carries its own `order_quantity`, `order_unit`,
and conversion note. The frontend uses those fields before its legacy fallback
matcher. Removal/tear-off/detach/disposal lines are labor, not orderable
materials; identical physical products are aggregated deliberately (for
example, two felt lines), while distinct shingle products stay separate.

**Roofing conversion factors (verify against the active shared generator in `lib/materialList.cjs`, not the legacy hosted function):**
- Field shingles: SQ × 3 = bundles
- Underlayment/felt/synthetic: SQ ÷ 10 = rolls
- Ice & water shield: LF ÷ 50 (SF ÷ 3 → LF first) = rolls
- Ridge/hip cap: LF ÷ 33 = bundles
- Starter strip: LF ÷ 100 = bundles
- Drip edge: LF ÷ 10 = sticks
- Valley metal: LF ÷ 10 = sections/pieces
- Step flashing: LF ÷ 50 = boxes
- Roofing nails: SQ ÷ 15 = boxes  (NOT 18 — frontend once drifted to 18)

**How to apply:** the shared deterministic generator is the source of truth;
both Estimate Editor and AI Estimator must respect its per-item order fields.
The old client matchers are backward-compatible fallbacks only, for historical
lists that do not have the per-item fields.

**Why:** Vendor List / Order Qty are what reps actually order from; a wrong
factor—or a correct factor attached to the wrong product—causes over/under-ordering.
The frontend nails factor once drifted to ÷18 while the purchase rule was ÷15.

**Matching gotcha:** "Starter Shingles" contains "shingle" and not "cap", so the
field-shingle matcher grabs it unless you also exclude `'starter'`. Field-shingle
match must be `includes('shingle') && !includes('cap') && !includes('starter')`.
