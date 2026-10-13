---
name: Siding catalog pricing boundaries
description: Commercial and safety decisions for generated siding estimates and Xactimate source claims.
---

Generated siding estimates must use the selected company's imported catalog, not substitute preset rates or guessed codes. A matching code alone is insufficient: trade, removal versus installation activity, material, and billing unit must also agree. Separate installation plus removal must not also charge a combined remove-and-replace item.

**Why:** A broad fastener search selected a hip/ridge/rake/eave roofing product for siding, while unresolved material lines were zero-priced and the displayed subtotal looked like a completed estimate. These mistakes can silently change insurance billing.

**How to apply:** Missing catalog pricing must remain visibly unresolved, but must never prevent saving an estimate. Preserve user-entered rates and amounts when saving; warn without blocking. Catalog-pricing review may still gate exports. Convert square-to-square-foot units mathematically; never infer a piece length, package size, or weight-to-box conversion. Keep measured lengths separate from purchase-package counts. Fix generation or an explicitly rebuilt draft, never automatically rewrite already saved financial amounts.

Saving work is always permitted despite missing catalog matches, blank item codes, zero rates, or unresolved pricing-review flags.

**Why:** The user explicitly rejected the save blocker: “it can not stop me from saving the estimate.” Manually entered prices can be valid without a catalog link, and incomplete work still needs to be saved.

**How to apply:** Keep the normal authentication, company/customer identity and persistence protections, but make pricing-related save notices informational only in both the initial handler and the final create/update path. Never reprice rows as a side effect of saving.

An “Xactimate” source label means imported catalog data here, not a live Verisk regional pricing feed.

**Why:** Users expect recognized insurance line items, but a source label cannot prove regional pricing, date, licensing, or live access.

**How to apply:** Describe pricing provenance accurately, and surface missing data rather than claiming current regional rates.

Imported catalogs can encode removal-and-replacement solely as a leading “R&R” in the description, with no separate activity metadata. Such entries are valid combined scopes, not invalid installation prices. Use compatible combined pricing when separate installation pricing is unavailable, and exclude only the matching area of base removal; additional-layer removal stays separate.

**Why:** The company's imported vinyl, J-trim and house-wrap entries were being rejected even though they had usable rates, because the matcher required installation-only descriptions.

**How to apply:** Recognize descriptive activity before matching and preserve it across draft repricing. “J trim” is the catalog's terminology for J-channel. Do not substitute an insulated, premium or specialty product for a generic request merely because it is the only priced candidate. Repricing is an explicit draft action, not a saved-record backfill.
