# Legacy base44 Deno cloud functions — NOT executed in this app

These `.ts` files are the original base44 Deno cloud functions from before the
migration to Replit. **They have no runtime loader here**: nothing imports,
bundles, or serves them.

- All live function handlers are defined in `vite-functions-plugin.js` and are
  served via `/api/functions/invoke` in dev, and in production through the same
  registry via `db/prod-integrations.cjs` `getFunctionHandlers()` fallthrough
  (see `prod-server.cjs`).
- The only files under `functions/` that ARE used at runtime are the plain-JS
  shared utils in `functions/utils/` (imported directly by the vite plugin and
  test scripts).
- References to `Deno.env`, direct Resend fetches, or hardcoded from-addresses
  inside these `.ts` files are therefore dead code. They are kept as historical
  reference for what each handler is supposed to do.

Platform email in the live code goes through `lib/emailTransport.cjs`
(Postmark when `POSTMARK_SERVER_TOKEN` is set, Resend otherwise) with health
tracking in `lib/emailProviderHealth.cjs`.
