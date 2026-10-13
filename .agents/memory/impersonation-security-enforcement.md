---
name: Impersonation security enforcement
description: How server-side impersonation write-blocking and audit logging is implemented; key pitfalls.
---

## Rule
Impersonation sessions are stored server-side (sessions table JSONB merge) and expose `isImpersonating` via `resolveRequestContext()` in `lib/tenantGuard.cjs`. Write blocks must appear in **both** entity route branches of **both** server files.

**Why:** Client-side-only blocking is trivially bypassed. The pattern `isImpersonating && method !== 'GET' → 403` must appear in 4 places total:
- `vite-db-plugin.js` → entityCollectionMatch branch
- `vite-db-plugin.js` → entitySingleMatch branch
- `db/prod-db.cjs` → entityCollectionMatch branch
- `db/prod-db.cjs` → entitySingleMatch branch

## Endpoints
`/api/impersonation/start|stop|logs` are handled by:
- Dev: inline in `vite-db-plugin.js` (placed before `if (!req.url.startsWith('/api/local/'))`
- Prod: `handleImpersonationRoute()` exported from `db/prod-db.cjs`, routed in `prod-server.cjs` before `/api/local/`

Session merge: `UPDATE sessions SET sess = sess || $1::jsonb WHERE sid = $2`
Session strip: `UPDATE sessions SET sess = sess - 'key1' - 'key2' WHERE sid = $1`

## React pitfall
The Access Log UI component (`AccessLogTab`) must be a **named function component**, not an IIFE inside JSX. Using `useState`/`useEffect` inside `{(() => { ... })()}` violates Rules of Hooks and causes a React runtime error.

## ImpersonationContext
`startImpersonation` now calls `POST /api/impersonation/start` and throws on non-ok response (was a fire-and-forget base44 entity create). The `reason` parameter is threaded through from the UI dialog.
