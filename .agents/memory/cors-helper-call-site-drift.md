---
name: CORS helper call-site drift after removing wildcard fallback
description: Tightening a shared setCorsHeaders(res, req)-style helper can silently break call sites that only ever passed `res`.
---

When a CORS helper's fallback-for-unrecognized-origin behavior changes from "allow all" (`*`) to "allow known origins only," every call site must actually pass `req` (or whatever carries the origin) into the helper. Call sites that only pass `res` don't error — they just silently stop setting any CORS header for their origin, which read as `*` before and reads as nothing after.

**Why:** In one server file, ~26 of ~42 call sites to `setCorsHeaders` predated the origin-based allowlist and never passed `req`. Before the fix they got a harmless implicit wildcard; after removing the wildcard fallback they'd have gone from open to silently broken, with no exception thrown.

**How to apply:** After narrowing a wildcard/permissive default in a shared response-header helper, grep every call site for the helper name and confirm each one passes the same arguments the new logic depends on (origin/req, not just res). Don't assume "it compiled" means "it still behaves the same."
