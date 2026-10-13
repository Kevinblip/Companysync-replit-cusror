---
name: Estimate chat edit boundary
description: Existing estimates must survive failed or partially resolvable AI edit requests.
---

Treat a chat request against an existing estimate as an edit, not permission to regenerate it. Apply compound edits together; if a replacement cannot be resolved or priced, retain the original lines and report the unresolved part.

**Why:** The user reported an incorrect applied edit and other requests producing no change. A failed edit falling into fresh estimate generation, or removing a line before its replacement is available, can silently damage financial work.

**How to apply:** Preserve untouched saved amounts and metadata, distinguish item rates from whole-estimate targets, resolve explicit line numbers, and report actual changes or explicit failures. Roof height surcharges are not high-grade roofing materials; descriptive scope and compatible billing units matter more than a shared keyword.

Do not silently restrict searches to an internal import subtype or repair malformed billing units by inference.

**Why:** A newer Xactimate import contained truncated steep-charge descriptions billed as “EA”, while intact area-billed entries existed in the other Xactimate import. Restricting the search made available catalog items appear missing.

**How to apply:** Prefer complete, compatible imported rows available to the current company. Do not confuse sheathing charges with roofing charges or add a financial line merely because a user asks whether it is included.

The user expects uploaded line items to be usable by the AI estimator for every subscriber company, not merely visible in the catalog browser. Catalog availability and reliable AI retrieval are separate requirements.

**Why:** The user questioned the value of uploading line items if the estimator cannot find them, and explicitly extended that expectation to other companies uploading their own items.

**How to apply:** Evaluate complete company-scoped catalog coverage, not just a successful match for one tenant or one material. Model references should be retrieved from the entire available catalog rather than the first arbitrary page.

Every active line item visible in the app must be usable by the estimator without another source-selection or approval step. The selected pricing source is a preference, not an exclusion boundary.

**Why:** The user explicitly rejected the added step: “If its listed inside the app under line items, it should be avaialble.” This applies to every subscriber's own uploads.

**How to apply:** Search the same catalog the Items screen makes available, including existing shared entries, but never another subscriber's private rows. Prefer the selected source and retain the actual matched item's pricing provenance. Keep existing saved prices untouched unless the user requests an edit.
