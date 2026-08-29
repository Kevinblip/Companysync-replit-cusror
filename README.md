# CompanySync

Roofing business management platform (CRM, estimates, invoicing, crew ops, and AI inspection).

## Local development (Cursor)

Open this repo in Cursor and run it on your machine. Hosting can stay on Replit / [getcompanysync.com](https://getcompanysync.com) until you move it.

See **[LOCAL.md](./LOCAL.md)** for clone, `.env`, Postgres, `npm install`, `npm run dev` (Vite on `0.0.0.0:5000`), and `npm start` after a build.

`npm run build` is a normal Vite build. It does **not** force-push `main`. The old auto-deploy helper is optional: `npm run deploy:replit` only.

## Google subscriber sign-in (production)

Production login at `https://getcompanysync.com/login` uses a **full-page redirect** to Google OAuth (not a pop-up).

`GET /api/auth/google` sends the browser to Google with:

- `client_id=783326703651-7cked810oe2o1tvt0vdtrd3n6ai0q0tc.apps.googleusercontent.com`
- `redirect_uri=https://getcompanysync.com/api/auth/google/callback`

A successful consent must exchange the authorization `code` for tokens, create or resume the subscriber session, and redirect to `/`. Failures redirect to `/login?error=google_auth_failed`. The real reason is written to **server logs** as `[GoogleAuth]` (never secrets, never the auth code).

### Secrets that must be set in Replit / production

These values **must belong to the same Google Cloud OAuth 2.0 Web client** shown above. Do not invent a new secret, and do not pair this client ID with a Calendar-sync (or any other) client's secret.

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | Exactly `783326703651-7cked810oe2o1tvt0vdtrd3n6ai0q0tc.apps.googleusercontent.com`. Fallback name: `Google_Client_Id`. |
| `GOOGLE_CLIENT_SECRET` | Yes | The client secret **for that same OAuth client** from Google Cloud Console → APIs & Services → Credentials. Fallback name: `Google_Secret_Key`. |
| `SESSION_SECRET` | Yes | Already required for email/password sessions. Used to sign the `connect.sid` cookie after Google login. |
| `DATABASE_URL` | Yes | Already required. User upsert and session insert. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Optional | Override if the public Host header is not `getcompanysync.com`. Production must be exactly `https://getcompanysync.com/api/auth/google/callback`. |

In Google Cloud Console, the Web client's **Authorized redirect URIs** must include:

`https://getcompanysync.com/api/auth/google/callback`

After changing Replit secrets, restart the production deployment so the Node process picks up the new values.
