---
name: Estimate document identity safety
description: Policy for customer and property identity mismatches during carrier-estimate imports.
---

A carrier appraisal import must never silently switch the selected CRM customer or property. A different homeowner or property address is a hard block, not a confirmation prompt. Normalize common punctuation, street suffixes, and directions before treating address formatting as a conflict; do not ignore a different house number or unit just because much of the address matches.

**Why:** PDF formatting differences should not repeatedly interrupt a correct import, but allowing a confirmed conflict can mix another home's line items into the open estimate. The user requested a fail-closed property mismatch rather than an override.

**How to apply:** Compare extracted identities before changing the estimate or its history. Show the document and current values for every conflicting field and ask the user to select or correct the matching record. Keep the policy consistent across all carrier-estimate upload paths, including fallback extraction; preserve the staged-document context guard.

Carrier PDFs can print a homeowner as “LAST, FIRST” while the CRM stores “First Last,” and the postal city can differ from a local municipality for the same street, house number, state, and five-digit ZIP. Those are formatting differences, not evidence that a customer cannot have another estimate. Keep different house numbers, units, states, and genuinely different customers blocked.

**Why:** A legitimate import was rejected on both customer and property even though its names contained the same complete tokens and the addresses shared the street, house number, state, and ZIP; only name order and city label differed.

**How to apply:** Compare complete name tokens without depending on order. Accept a differing city label only when the full street/number/unit and five-digit ZIP agree and known states do not conflict. Apply this to single and multi-document imports without weakening the different-property guard.

**Batch safety:** Validate each uploaded document against the open estimate and against the other uploaded documents before committing any line items or derived measurements. A single-document guard does not protect a separate multi-document merge path.

**Why:** A review found that a multi-document import could merge a different homeowner's line items even while the single-file path blocked correctly.

**How to apply:** Stage extracted results in memory until every document's identity is checked, then commit them together; include cross-document conflicts in offline regression cases.