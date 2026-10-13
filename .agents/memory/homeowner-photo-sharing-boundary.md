---
name: Homeowner photo sharing boundary
description: Customer-bound approval and the limits of hiding publicly stored crew images.
---

Crew-photo approval belongs to a specific customer and company, not just to a project. Relinking a project must never grant its new homeowner access to crew photos approved for the previous homeowner.

**Why:** Project association can change after publication. Filtering a public gallery only by the project's current owner makes that reassignment silently publish another customer's evidence.

**How to apply:** Bind approval to the publishing customer/company, check that binding on portal reads and visibility writes, and resolve conflicting legacy customer-link fields consistently rather than authorizing every matching field.

Hiding from the portal is not revocation of an existing public image URL or a downloaded copy.

**Why:** This feature intentionally reuses the existing upload storage model. The user approved portal curation, not a migration of all originals to private delivery.

**How to apply:** Describe the distinction in sharing controls. Stronger URL revocation requires an explicit private-delivery change; do not claim portal visibility controls already provide it.