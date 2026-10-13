---
name: Google Calendar prod callback missing
description: Root cause of months-long Google Calendar OAuth failure in production — the callback route only existed in the dev vite plugin, never in prod-server.cjs.
---

## The Rule
Any OAuth callback route added to `vite-functions-plugin.js` MUST also be added to `prod-server.cjs` or it 404s in production. This is a special case of the general dev/prod endpoint parity rule.

**Why:** The vite plugin only runs in development (via `vite dev`). Production runs `prod-server.cjs` directly (via `node dist/index.cjs`). A callback route in the vite plugin is completely invisible to the production server.

**How to apply:** After adding any `/api/*-callback` route handler in `vite-functions-plugin.js`, immediately mirror it into `prod-server.cjs`. The function handlers themselves (`functionHandlers.*`) do NOT need mirroring (they flow via `prodIntegrations.getFunctionHandlers()`), but the raw `req.url.startsWith('/api/...')` HTTP route blocks absolutely do.

## Affected Routes (as of July 2026)
- `/api/google-calendar-callback` — was dev-only for months before fix; now in both
- `/api/microsoft-calendar-callback` — added to both from day one
- `/api/quickbooks-callback` — verify it exists in prod-server.cjs too

## Diagnostic Signal
If an OAuth integration "never worked in production" but works fine locally, check `prod-server.cjs` for the callback route first. This is the most likely cause.
