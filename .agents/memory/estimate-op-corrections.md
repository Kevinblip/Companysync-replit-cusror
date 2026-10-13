---
name: Estimate O&P corrections
description: Product scope for removing overhead and profit without a supplement or a company-wide format change.
---

An overhead/profit correction must be available directly on the existing estimate. Do not require a supplement or change order solely to remove O&P, and do not change the company's shared format defaults.

**Why:** The user explicitly expects to edit the estimate itself and found the Revise / Supplement dialog unsuitable for removing O&P.

**How to apply:** Keep the correction estimate-specific, require an explicit save, and honor zero rates on reopen and customer-facing documents. Preserve unrelated saved carrier line amounts rather than rebuilding them from quantity × rate.