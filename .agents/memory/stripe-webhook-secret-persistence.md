---
name: Stripe webhook secret persistence
description: How managed Stripe signing secrets survive restarts when a Replit app cannot mutate the project secret store.
---

A running Replit app cannot programmatically write the Project Editor's secret store. Persist a newly-created Stripe signing secret in the existing managed-webhook database store, then hydrate `process.env` from that durable row during later startups.

**Why:** Stripe returns a webhook signing secret only when the endpoint is created. Listing or retrieving an existing endpoint omits it, and a process-only assignment disappears on restart.

**How to apply:** Prefer an explicitly configured environment secret when present. Otherwise match the active endpoint by ID or URL in the managed-webhook store, load its secret before handling requests, and never log any part of the secret.