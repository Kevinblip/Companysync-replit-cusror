---
name: Production company deletion access
description: Constraint for permanently removing a tenant from production
---

Production company cleanup cannot be performed through the production SQL read path. The supported destructive route is the application’s authenticated platform-admin deletion handler, and it requires a live platform super-admin session; an unauthenticated invocation returns an authorization failure.

**Why:** The production database callback is intentionally read-only, while the tenant deletion handler removes company-scoped rows before the company row. This prevents an agent from bypassing the app’s authorization boundary with a raw production mutation.

**How to apply:** Verify exact company IDs, deletion flags, and related-row counts with production reads first. Preserve the protected primary tenant. Then use the signed-in SaaS admin flow for the approved non-primary IDs; do not attempt to mutate production through the read-only SQL callback or ask for session credentials.