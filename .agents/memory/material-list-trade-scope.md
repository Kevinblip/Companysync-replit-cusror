---
name: Material-list trade scope
description: Durable rules for converting estimate lines into trade-specific purchase lists.
---

The material purchase builder must classify both roofing and siding products, and it must resolve the estimate trade before converting generic accessory names such as starter strip or nails. Siding evidence takes precedence over a stray roofing accessory; explicitly roofing-tagged lines stay visible in the full breakdown but do not enter a siding order sheet.

**Why:** A siding estimate previously placed its actual siding products in “Other,” leaving unrelated starter/nail rows as the only visible materials.

**How to apply:** Keep trade metadata flowing from the estimate editor into the server builder, and add regression coverage whenever a new trade or purchase-unit conversion is introduced.

Users expect a siding purchase list to cover J-channels, starter, corners, light mounting boxes, water/hose-bib mounting boxes, nails, and sealant—not only wall siding and wrap. When the estimate does not supply an accessory quantity, flag it for confirmation instead of silently omitting it or inventing a count. A water spigot is not the mounting block around it.

**Why:** The user found a saved supplier list lacking the accessories required for the job. Some estimates cover more than one trade, so real roof and siding work must both remain on a combined order list.

**How to apply:** Treat a stray roofing accessory differently from a genuine combined roof/siding scope. Preserve measured units and distinguish physical products; refreshing a saved purchase-list snapshot must not alter estimate financial amounts.

An estimate row awaiting catalog pricing still represents an existing material quantity. Do not tell the user an accessory is absent simply because its rate is zero or it has “price needed” in its description. Existing water/hose-bib scope should not trigger a demand for a second, unmeasured water mounting block; preserve the actual source description.

**Why:** The user explicitly corrected a missing-scope explanation: the accessories and quantities were already visible in the AI Estimator line items.

**How to apply:** Separate missing prices from missing quantities, and generate the current draft's purchase list from its visible rows rather than assuming an older saved snapshot contains those edits.