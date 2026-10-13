---
name: Google OAuth client health probe
description: How to diagnose "Error 401 invalid_client / OAuth client was not found" on Google Calendar connect, and common credential-paste mistakes
---

# Google OAuth client health probe

**Rule:** When Google's own page shows "Access blocked … invalid_client — The OAuth client was not found", the client_id being sent does not exist at Google. Diagnose with a token-endpoint probe before touching code — POST `https://oauth2.googleapis.com/token` with a bogus `code` and the stored client_id/secret:
- `invalid_grant` ("Malformed auth code") → client is ALIVE; problem is elsewhere (e.g. prod deployment has a stale secret value).
- `invalid_client` → the OAuth client (or its whole GCP project) was deleted; new credentials are required from the owner.

**Why:** This one HTTP call cleanly separates "credential dead at Google" from "dev/prod secret drift" without any UI clicking, and never prints secret values.

**How to apply:**
- Also probe the authorization endpoint (`accounts.google.com/o/oauth2/v2/auth?...` with `redirect: 'manual'`): a 302 to Google sign-in = client + redirect_uri accepted; an error page = invalid_client or redirect_uri_mismatch.
- Common user paste mistake: a 39-char value starting `AIza` is a Google **API key**, not an OAuth Client ID. A real OAuth client ID is ~72 chars and always ends `.apps.googleusercontent.com`. Check `length` + `endsWith` without printing the value.
- After a bash-visible secret update, allow a few seconds for propagation; a stale-looking value may just be lag. Restart the dev server so running processes pick up new env.
- Required redirect URIs for this app's Google client: `https://getcompanysync.com/api/google-calendar-callback` and the dev preview domain + same path. Both dev (vite-functions-plugin.js) and prod (prod-server.cjs) read `process.env.GOOGLE_CLIENT_ID/SECRET` at request time — credential swaps need no code change, but PROD only picks up new secrets on republish.
- If the OAuth consent screen is left in "Testing" status, refresh tokens expire after 7 days — connections silently die weekly until the app is published.
