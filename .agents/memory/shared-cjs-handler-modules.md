---
name: Shared CJS handler modules need no dev/prod mirroring
description: Which server-side CJS modules are required directly by both the dev vite plugins and prod-server.cjs, so a fix in one place covers both environments.
---

# Some CJS modules are already shared — don't duplicate fixes into both envs

Unlike public HTTP route handlers defined inline in `vite-*-plugin.js` (dev) and
`prod-server.cjs` (prod), which are separate code paths that must be mirrored
(see dev-prod-endpoint-parity), some logic lives in a standalone `.cjs` module
that BOTH environments `require(...)` directly. Fixing the module fixes both.

Confirmed shared modules (as of this session):
- `db/local-auth.cjs` (`handleLoginLocal`, `handleSignup`, confirm-email, change-password)
  — required by `vite-auth-plugin.js` (dev) AND `prod-server.cjs` (prod).
- `db/prod-integrations.cjs` (`handleUpload`, `handleInvokeLLM`, `handleFunctionInvoke`,
  email senders, etc.) — required by `vite-functions-plugin.js` (dev) AND `prod-server.cjs`
  (prod). Despite the "prod-" filename prefix, this file is NOT prod-only.

**Why this matters:** applying a fix (e.g. rate limiting, error-message sanitization) to
one of these files automatically covers both dev and prod. Duplicating it into the other
environment's file would be redundant and risks drift. Before mirroring a fix, grep both
`vite-*-plugin.js` and `prod-server.cjs` for `require(...)` of the target file — if both
require the same module, fix it once there.

**Caveat:** always verify with a grep (`grep -rn "require('./db/<file>" prod-server.cjs
vite-*.js`) rather than assuming from the filename — "prod-" prefixed files are sometimes
dev-shared, and vice versa.
