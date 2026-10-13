---
name: Automated SMS recipient guard
description: Guardrails for preventing Twilio sends to junk, disposable, test, or malformed contacts without disabling valid-lead automation.
---

All automated SMS paths must validate the recipient before any Twilio request or SMS usage charge. The guard should normalize valid US/international numbers, reject placeholders and malformed numbers, reject known disposable/test contacts, and return a skipped result so workflows continue.

**Why:** failed Twilio sends still consume money and operational attention, while globally disabling workflows would lose valid leads.

**How to apply:** the deployed Replit runtime must import the shared Node/CommonJS guard from `lib/` at its central sender; do not make production delivery depend on Base44/Deno `functions/` utilities. Pass contact name, email, status, and existing test/junk/demo flags when available. A phone allowlist may bypass test-contact heuristics for staff testing, but not malformed phone validation.