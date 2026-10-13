---
name: Forged session for authenticated dev testing
description: How to mint a valid connect.sid for puppeteer/HTTP tests against the dev server; the old make-session.cjs helper is gone.
---

# Forged session for authenticated dev testing

`scripts/video/capture-live.cjs` still references `scripts/video/make-session.cjs`, but that helper NO LONGER EXISTS — its auto-session path fails. Forge a session inline instead:

1. Insert a row into `sessions` (sid, sess JSON, expire). The `sess` shape must match `db/local-auth.cjs` createSession: `{ cookie: {...}, passport: { user: { claims: { sub, email, full_name, ... }, expires_at } } }`.
2. Sign it exactly like `signSessionId` in db/local-auth.cjs: `'s:' + sid + '.' + hmacSHA256(sid, SESSION_SECRET).base64` with trailing `=` stripped, then URL-encode the whole value for the `connect.sid` cookie.
3. Delete the sessions row when done.

**Why**: the Replit screenshot tool has no session and always lands on the login page; this is the reliable path for authenticated screenshots and HTTP e2e tests.

**Gotcha**: `sess.cookie` must include an `expires` (ISO string). Without it, express-session's store throws `Cannot read properties of undefined (reading 'expires')` on touch — which surfaces as a full-screen vite HMR error overlay in puppeteer screenshots, and as a 500 on some API calls while others still succeed. Several existing test fixtures omit it and get away with it; add it.

**How to apply**: scripts must run from the workspace root (puppeteer-core resolves from project node_modules; /tmp scripts can't require it). Chromium binary path is pinned in capture-live.cjs.
