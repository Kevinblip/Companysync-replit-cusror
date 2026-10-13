---
name: Lexi rep data access
description: Server-side Lexi reads must resolve the caller from the authenticated session and constrain non-admin results to owned work.
---

Lexi permission wording is not authorization. Resolve the caller's staff profile and company ownership from the authenticated identity; only an explicit administrator, super-admin, or company creator has company-wide visibility. Do not use a permissive fallback role or a different staff profile when the caller lookup misses.

**Why:** Chat and native voice tools can otherwise disclose team earnings, company payments, activity, or records unrelated to the rep even if the UI hides them.

**How to apply:** Put the policy before every data-returning Lexi tool in typed chat and native voice. Non-admins can receive only their own sales and records assigned to or created by them; deny organization-wide financials, team leaderboards, staff lists, payments/invoices, unrestricted entity lists, and company-wide activity. Prompt text should match this policy but never replace it.