---
name: Platform subscriber mail
description: Subscriber lifecycle mail has a fixed identity and must not inherit company SMTP settings.
---

Subscriber welcome, password-reset, and trial-lifecycle mail must use the fixed CompanySync identity and the existing Postmark or AWS SES integration. Keep this path separate from company-scoped mail so a tenant's SMTP configuration cannot spoof or replace the platform sender.

**Why:** The platform sender requires an exact From/Reply-To contract, while company-scoped mail may intentionally use a different provider and sender identity.

**How to apply:** Preserve the requested From so Postmark/SES can enforce sender verification; if neither approved provider is configured or the sender is unverified, fail closed instead of falling back to SMTP or silently rewriting the identity.