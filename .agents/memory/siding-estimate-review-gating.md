---
name: Siding estimate review gating
description: Distinguishes advisory photo-coverage warnings from measurement-graph failures that must block estimate creation.
---

Incomplete or low-confidence elevation coverage must remain visibly flagged, but it must not disable the Build Siding Estimate action. Only missing canonical totals or failed graph reconciliation should block conversion.

**Why:** Detail photos can support a usable estimate without establishing complete whole-wall coverage. Disabling the estimate action behind a separate acknowledgement made successful measurement appear broken.

**How to apply:** Keep coverage warnings and acknowledgements advisory for ordering review. Fail closed only when the canonical graph cannot produce internally reconciled quantities, and show the reason to the user.