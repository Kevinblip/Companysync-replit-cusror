---
name: Dev/prod endpoint parity
description: Public API endpoints added to the dev Vite plugin must be mirrored into prod-server.cjs or they 404 in production.
---

# Dev/prod endpoint parity

Public HTTP endpoints live in TWO places and must stay in lockstep:
- **Dev**: `vite-functions-plugin.js` (handles requests when running `npm run dev`)
- **Prod**: `prod-server.cjs` (the deployed server on getcompanysync.com → built to `dist/index.cjs`)

An endpoint that exists only in the dev plugin works in the Replit dev preview but returns **404 "Not found"** in production. Symptom seen: crew photo upload (`POST /api/public/crew-photos`) worked in dev, failed in prod because the route was never ported.

**Why:** the two runtimes are completely separate request handlers; there is no shared router. Easy to add a feature in dev and forget prod.

**How to apply:**
- Whenever you add/modify a public route (especially `/api/public/*`), grep BOTH files for the path and confirm both have it.
- Watch for convention differences when porting: dev uses `import()` / `parseBody()` / `__require()`; prod uses `require()` / `JSON.parse(await readBody(req, limit))` / `fs`/`path`. Mirror dev's safe-parse semantics (malformed JSON → 400, not 500).
- Prod portal routes live inside the `if (pathname.startsWith('/api/public/portal') || ...)` block in prod-server.cjs; non-portal public paths must be added to that guard or given their own block. The block exposes `portalJson()` and `pool`.
- **The reverse failure exists too**: the DEV portal block in vite-functions-plugin.js has its own outer prefix gate (`/api/public/portal*`, `/api/projects/*` log/milestone/photos, now also `/api/public/crew-photos` and `/api/public/color-viz`). A handler placed INSIDE the block whose path isn't admitted by the gate silently 404s in dev while working in prod. When adding a route to either portal block, update that file's outer gate condition, then curl the path in dev to prove it's reachable.
- Gemini inline image parts: prod uses camelCase (`inlineData`/`mimeType`), dev uses snake_case (`inline_data`/`mime_type`). Both are accepted by the Gemini REST v1beta API; keep each file internally consistent.

**Exception — `functionHandlers` auto-mirror:** handlers added to the `functionHandlers`
export object in `vite-functions-plugin.js` do NOT need manual porting. `db/prod-integrations.cjs`
`getFunctionHandlers()` dynamically `import()`s the plugin and reads `mod.functionHandlers`;
prod's `/api/functions/invoke` calls `handlers[name](params, GEMINI_KEY, req)` — the SAME
`(params, apiKey, req)` signature as dev. So a new `base44.functions.invoke('foo')` handler is
available in prod automatically, with the same `getUserFromRequest(req)` + admin checks. Only
direct HTTP routes (the `if (pathname === …)` blocks) need manual mirroring into prod-server.cjs.
