---
name: functionHandlers dev/prod generic fallthrough
description: Why adding a base44 function handler ONCE (vite functionHandlers) serves both dev and prod — unlike public HTTP routes, which must be mirrored.
---

# functionHandlers reach prod via a generic fallthrough — do NOT duplicate

Adding a new `base44.functions.invoke('<name>', ...)` handler is done in ONE place:
the `functionHandlers` registry in `vite-functions-plugin.js`. It automatically
works in BOTH dev and prod.

- **Dev**: `/api/functions/invoke` (vite middleware) looks up `functionHandlers[name]`,
  calls `handler(params, apiKey, req)`, and responds `{ data: result }`.
- **Prod**: `db/prod-integrations.cjs` `handleFunctionInvoke` has a GENERIC FALLTHROUGH:
  `getFunctionHandlers()` dynamically imports the same vite `functionHandlers` registry,
  then calls `handlers[name](params, process.env.GOOGLE_GEMINI_API_KEY, req)` and wraps
  `{ data: result }`. So the prod call reaches the SAME handler function.

**Why this matters:** it is the opposite of the route-mirroring rule. Public HTTP
routes defined in `vite-functions-plugin.js` (dev) MUST be re-implemented in
`prod-server.cjs` (prod) or they 404 in production (see dev-prod-endpoint-parity).
But `functionHandlers` do NOT need mirroring — duplicating one into `prod-server.cjs`
or `db/prod-integrations.cjs` is wasted effort and a lockstep-drift hazard. Same
pattern the `runLaunchTest` handler relies on.

**How to apply:** to add a server-side RPC callable from the frontend, write it once
in the vite `functionHandlers` registry. Both `req` (session) and `apiKey` are passed
in both environments, so auth (`getUserFromRequest(req)`) and Gemini key access work
identically. Handler return value is what the client sees under `resp.data`.

**CRITICAL: always register at MODULE LEVEL, never inside `configureServer`.**
`getFunctionHandlers()` loads the module and reads `functionHandlers` immediately —
it never calls `configureServer` (a Vite dev-only hook). Any handler added inside
`configureServer` works in dev (where Vite calls the hook at startup) but is MISSING
in prod. A missing handler returns `{ data: {}, warning: '...' }` which after
`unwrapInvoke` collapses to `{}`, making `result?.error` undefined — the frontend
shows only its hardcoded generic fallback message with no way to diagnose the real
cause. Register all handlers either inside the `const functionHandlers = { ... }`
block itself or immediately after it (like the Google Calendar aliases at ~line 20912).

**Caveat:** the generic function-handler path has NO per-call authz of its own — the
handler itself must authenticate/authorize (resolve `getUserFromRequest(req)` and
verify company membership) if it mutates tenant data or spends quota. The client can
send any `params`, including a forged `company_id`.
