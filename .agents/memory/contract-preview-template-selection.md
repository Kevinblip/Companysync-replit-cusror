---
name: Contract preview template selection
description: Completed contract previews must render the session's selected template, not company-wide contingency editor content.
---

The signing-session `template_id` is authoritative for the contract document shown in the CRM. Render a session snapshot or its matching uploaded template/PDF first. Use the company-scoped contingency editor content only as a legacy fallback when the session is explicitly contingency-style and has no uploaded document.

**Why:** A company can have several contract forms, but the old preview selected the first editor-content row for every session. The metadata could say “Certificate of Satisfaction” while the body displayed the contingency agreement.

**How to apply:** Resolve the matching template by `template_id`; prefer a signed PDF when available, otherwise the session/template PDF or HTML snapshot. Never use the first company template or editor-content row for an unrelated session.