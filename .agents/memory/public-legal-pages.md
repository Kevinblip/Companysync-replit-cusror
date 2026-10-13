---
name: Public legal pages
description: Constraints for CompanySync privacy and terms pages and their public routing
---

Public Privacy Policy and Terms of Service pages must remain readable while logged out, use `/privacy` and `/terms` as canonical URLs, and redirect `/Privacy` and `/Terms` to those lowercase paths. Their copy is dated September 2, 2026 and must not name the disallowed email provider; describe CompanySync email delivery in provider-neutral terms unless the owner provides updated approved wording.

**Why:** The owner needs customers to review the legal documents before account creation and explicitly requires the current provider positioning not to be contradicted in public or product-facing copy.

**How to apply:** Keep legal routes before the authentication catch-all, preserve the shared legal layout, and run the public onboarding static checks whenever legal links or auth routing change.