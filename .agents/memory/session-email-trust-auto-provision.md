---
name: Session email trust for auto-provision endpoints
description: any endpoint that provisions/looks up account data from a client-supplied "email" field must resolve the email from the authenticated session instead, or any caller can read/create another company's data.
---

`/api/local/auto-provision` (in both the dev Vite plugin and the prod server — two separate inline copies, not shared code) accepted a client-supplied `email` field with zero auth check. Any unauthenticated POST with an arbitrary `email` could read back a full `companies` row (including `stripe_customer_id`, `stripe_subscription_id`, phone, address) or silently create a new company+admin for that email.

**Why:** provisioning/lookup-by-email handlers are an easy place to accidentally trust the request body instead of the session, because the "happy path" (a freshly logged-in user auto-provisioning their own company) never sends a forged email, so the bug is invisible in normal testing.

**How to apply:** for any handler that provisions or fetches account/company data keyed by email, resolve the email server-side from the authenticated session only (e.g. `tenantGuard.resolveSessionEmail(req, pool)`), return 401 if there's no session, and ignore/discard any client-supplied `email` in the body entirely. Add rate limiting as defense-in-depth. Check both the dev and prod copies of the handler — they are not shared.
