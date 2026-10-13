---
name: Launch Checklist real test runner
description: Durable pitfalls/decisions for the Launch Checklist automated tests (runLaunchTest).
---

# Launch Checklist real test runner

The Launch Checklist runs each test through the `runLaunchTest` function handler,
which does REAL health checks. No test blindly returns "passed".

## One handler serves dev AND prod
Prod reaches the same handler because the prod function-invoke layer dynamically
imports the dev plugin's `functionHandlers`. So one edit fixes both. The Deno
`functions/runLaunchTest.ts` is NOT on the prod path — it's dead code.
**How to apply:** edit the handler in the plugin only; don't duplicate logic into
the Deno file expecting it to run.

## getPool ESM pitfall (cost >1 attempt to find)
Inside the dev plugin module, do NOT re-import getPool via
`await import(...prod-db)` — in the Vite ESM context the named export resolves to
a non-function and throws `getPoolN is not a function`. Use the module-scoped
`getPool()` the other helpers already use.

## Correct data layer per entity
Core CRM entities live in DEDICATED tables; most other entity types live in the
shared JSONB `generic_entities` table. A reachability check must target the right
one — querying generic_entities for an entity that has its own table produces
false failures (the original bug).

## Smoke checks should pass on empty data
"Does feature X work" tests verify the data layer is reachable, NOT that the
company already has rows. A brand-new company legitimately has zero
proposals/notifications/etc. Making these fail on empty data reintroduces the
false-failures this rewrite was meant to kill.
**Why:** the whole task started from "Twilio shows failed even though it works."

## Live vendor checks must be read-only AND authorized
Integration validation calls vendor APIs (Twilio/Stripe/Resend) using the
company's own resolved creds — use READ-only endpoints with a short abort
timeout; never send/charge. Because the handler makes credential-backed calls for
a caller-supplied companyId, it MUST authorize the caller (authenticated
staff/admin of that company, or super-admin) and fail closed. The generic
function-invoke endpoint has no blanket auth, so the handler self-gates.

## companies name lives in columns, not JSONB
The companies row stores the name in top-level columns; its `settings`/`data`
JSONB are often empty `{}`. A "company configured" check must read the columns or
 it false-fails.

## UI company context
The checklist page must use the app's shared active-company resolver, not look up
companies only by `created_by === currentUser.email`.

**Why:** staff members legitimately belong to a company they did not create, and
owner-only lookup leaves the page permanently without a company even though the
shell and server session already have the correct tenant.

**How to apply:** wait for both membership/ownership resolution and the target
company fetch before enabling automatic test controls. Keep the server handler's
independent membership/admin authorization as the final security gate.
