---
name: Estimator calibration blending
description: How AI estimator learned corrections (report calibration + finished-job learning) must be blended and reverted
---

# Estimator calibration blending

**Rule:** All learned correction sources (AIMemory categories `estimator_calibration` from report comparisons AND `job_calibration` from paid invoices) must blend into ONE averaged, clamped multiplier per field, applied once to the raw AI values. Never apply category multipliers sequentially — that stacks corrections.

**Why:** Two independent learning paths write ratio rows into AIMemory. If each path applied its own multiplier, a company with both kinds of history would get compounding adjustments (e.g. 1.2 × 1.2 = 1.44) far beyond what either source justifies.

**How to apply:**
- Guardrails: company-scoped, 12-month recency, MIN_SAMPLES=3 per field, per-row ratios discarded outside 0.5–2.0 at learn time, final multiplier clamped 0.8–1.25 at apply time.
- Area (`area_ratio`, learned from shingle/underlayment quantities) is applied to `totalAreaSqFt`/`roofAreaSquares` BEFORE the waste/order-quantity calc, so downstream order math inherits it — don't also correct the order quantity.
- The revert toggle in AIEstimator swaps snapshot values (`uncalibrated_linears`/`calibrated_linears`); when area is swapped, derived values (`corrected_area_sq/_sqft`, `final_order_quantity_sq`) must be scaled proportionally or consumers reading corrected||roof drift out of sync.
- Learning is Solar-path-only (the Gemini handler applies no calibration) — accepted asymmetry.
- Job learning is idempotent per `invoice_id`; fired fire-and-forget when an invoice transitions to paid.
- AIMemory rows carry `company_id` both as a real column and inside `data` JSONB — keep both populated on new inserts.
