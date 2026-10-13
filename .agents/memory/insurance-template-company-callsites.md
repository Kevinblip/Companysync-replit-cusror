---
name: Insurance template company object dual call sites
description: Xactimate/Symbility HTML templates receive a `company` object built independently in two places; new company fields must be added to both.
---

`generateXactimateHTML` / `generateSymbilityHTML` (src/utils/insuranceEstimateTemplates.js) take a `company` object with fields like `company_name`, `address`, `phone`, `contact_name`, `logo_url`. This object is built in TWO separate, independent call sites:

1. `src/utils/xactimatePdfAdapter.js` — `buildXactimateDataFromAIEstimator`, used by `XactimateExportDialog.jsx` (AIEstimator's export flow).
2. `src/pages/EstimateEditor.jsx` — `buildInsuranceTemplateData`, used by EstimateEditor's own native Symbility export button.

**Why:** These evolved as separate features and were never refactored into a shared builder. Adding a new company field (e.g. logo_url) to the template renderer is a no-op for one export path unless you also update the other call site's object literal.

**How to apply:** Whenever adding/changing a `company.*` field consumed by these templates, grep both files above and update the object literal in each. Templates render conditionally (no-op) when a field is empty, so missing data degrades gracefully but silently — it won't error, it'll just be blank in that one export path.
