---
name: Prod bare `pool` ReferenceError swallowed by catch
description: Production handlers have no shared pool; bare references fail at runtime even when syntax checks pass.
---

# Prod bare `pool` ReferenceError swallowed by catch

The Twilio WS connection handler in `prod-server.cjs` has NO `pool` variable anywhere in its scope chain — every DB-using function declares its own local `const pool = prodDb.getPool()`.

**Why this matters:** code that referenced a bare `pool` (greeting-time caller-history lookup, transfer availability DB check) threw `ReferenceError: pool is not defined` at runtime, and the surrounding try/catch swallowed it into a benign-looking log line ("No prior history found"). Result: prod silently never recognized returning callers and never enforced rep availability via DB — for a long time, with zero errors in logs.

**How to apply:**
- This applies to HTTP routes as well as Twilio handlers. A valid public estimate link reached PDF generation but failed with `pool is not defined`; the online viewer used a separate working route.
- When porting dev bridge code to prod, never assume `pool` resolves — always take `prodDb.getPool()` locally.
- When a feature "never seems to trigger" in prod but works in dev, suspect a swallowed ReferenceError inside a broad try/catch; grep the prod copy for bare identifiers that only exist in the dev plugin's scope.
- Broad `catch (e) { console.log('benign message') }` blocks hide typo-level bugs — log `e.message` at minimum.
