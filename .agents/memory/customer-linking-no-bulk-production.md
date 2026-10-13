---
name: Customer linking stays explicit
description: Production customer relationships must not be auto-backfilled or bulk-linked without explicit user consent.
---

Never bulk-link or automatically backfill customer relationships in production. When a record needs a customer association, require an authorized person to choose the exact customer record and confirm the individual change. Preserve financial fields and do not perform hidden relationship migrations.

**Why:** The user explicitly ruled out bulk linking or automatic production updates; duplicate names and financial records make inferred relationships risky.

**How to apply:** Add safe per-record UI and server authorization when needed. Do not run production writes, migrations, or bulk relinking unless the user separately authorizes that work.

Property identity is not financial ownership. A homeowner and an insurance claimant can be separate customer records at the same address; keep insurer proceeds attached to the claimant's explicitly identified claim/invoice, and keep owner-paid work attached to the owner's invoice.

**Why:** Matching by a shared address can transfer claim payments or work charges to the wrong customer after a property changes hands.

**How to apply:** Require an explicit customer/invoice choice for each financial link. Never merge customers or reassign money solely because their property addresses match.
