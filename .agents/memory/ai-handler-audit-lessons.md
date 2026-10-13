---
name: AI handler audit lessons (usage gating, dev/prod drift, output trust)
description: Recurring failure patterns found auditing AI-powered handlers in a dev/prod dual-runtime app; what to check when adding or reviewing an AI feature
---

When a codebase runs the same business logic in two places (a Vite dev
middleware registry and a separate prod integration layer, or a Deno
`functions/` copy vs. a Node port), three specific failure modes recur for
AI-powered handlers and are easy to miss in review:

1. **Usage/cost gating bypass.** A new AI handler can be wired up to call a
   paid model without ever routing through the shared usage-limit gate
   (e.g. `checkAIUsage`/`incrementAIUsage`). This is invisible functionally
   (the feature "works") but silently exempts that feature from plan limits
   and cost tracking. **Check:** every call site that hits a paid model
   resolves a real company/tenant id and calls the gate before the paid call.

2. **Dead-code drift between runtime copies.** One runtime (e.g. prod
   integrations) can keep its own older intercept/implementation of a
   handler instead of falling through to the shared registry handler that
   dev uses. Both copies then silently diverge over time as only one gets
   updated. **Check:** prefer a single shared handler with a generic
   fallthrough (matching the working pattern used elsewhere in this app)
   over maintaining parallel copies; if parallel copies must exist, diff
   them explicitly rather than assuming parity.

3. **Blind trust in AI JSON shape.** Vision/LLM calls that use a lenient
   parser (regex-extract JSON from markdown fences, catch-and-return-`{}`
   on parse failure) can hand back an empty or partially-empty object after
   a soft failure. Downstream code that applies `field || default`
   everywhere then reports `success: true` with a fully fabricated,
   all-defaults payload that is indistinguishable from a real result.
   **Check:** after any AI JSON parse, assert that at least one of the
   handler's core expected fields is actually present before treating the
   result as real; throw/return a clear error instead of silently
   proceeding with defaults when the response is effectively empty.

4. **Internal impl functions callable directly, bypassing the wrapper's
   gate.** When a handler is split into a public name (`fooHandler`) that
   does auth/usage-gating and then delegates to an internal `_fooImpl`, a
   generic-by-name function dispatcher (e.g. "call whatever function name
   the client sent") will happily invoke `_fooImpl` directly if the client
   just asks for it by name — completely skipping the wrapper's checks.
   **Check:** the dispatcher itself must reject any function name matching
   the "internal impl" naming convention (e.g. leading underscore) before
   doing the lookup, in every runtime copy of the dispatcher (dev and prod).

5. **Testing an auth-gated handler that needs a real session.** Once a
   handler requires `getUserFromRequest`-style session/DB-backed auth, a
   fast unit test (fake `req` with no cookie, mocked DB pool) can no longer
   drive it end-to-end — the real auth call will always resolve "no user".
   Retrofitting a real login flow into the test is heavy-weight and the
   wrong layer for a unit test whose actual purpose is unrelated business
   logic (e.g. cache invalidation). **Fix:** add a minimal, clearly-named
   test-injection seam (an exported setter that swaps the cached
   auth-helpers reference) so the test can supply a fake "authenticated
   caller" and exercise the business logic without a live session — the
   same spirit as require.cache-based module mocking already used
   elsewhere in this codebase, just for a dynamic `import()`-loaded module
   where require.cache injection doesn't apply.

**Why:** all five are "the feature still runs" bugs — they pass a happy-path
smoke test but quietly break billing accuracy, maintainability, security, or
test coverage. They only surface in a deliberate audit, not normal usage.
