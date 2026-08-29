# CompanySync

Roofing business management platform (CRM, estimates, invoicing, crew ops, and AI inspection).

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

## Hover 3D house model (in-app viewer)

The AI Estimator satellite panel and Lead Profile render an assembled 3D house (roof planes attached to walls) instead of exploded Solar bounding boxes. When a Hover job is linked, geometry comes from Hover `cad_export.xml` (FACE → LINE → POINT in one XYZ frame).

### Secrets (optional — viewer still assembles a footprint without them)

Read in `src/lib/hoverHouseModel.js` (`getHoverEnv`) and `functions/getHoverHouseModel.ts`. Do not invent keys.

| Variable | Required for live Hover | Purpose |
|---|---|---|
| `HOVER_CLIENT_ID` | Yes | Hover OAuth client ID. Fallback: `Hover_Client_Id`. |
| `HOVER_CLIENT_SECRET` | Yes | Hover OAuth client secret. Fallbacks: `Hover_Client_Secret`, `Hover_Secret_Key`. |
| `HOVER_REFRESH_TOKEN` | Yes | OAuth refresh token from `POST https://hover.to/oauth/token`. Fallback: `Hover_Refresh_Token`. |
| `HOVER_ACCESS_TOKEN` | No | Optional short-lived bearer token if you already have one. Fallback: `Hover_Access_Token`. |

Without these, the UI still shows a coherent house from satellite/OSM footprint measurements (not 48×9 estimated boxes once wall faces exist). To preview Kevin’s Antoinette Hover job (`2-1514588` / model `21937601`), set the three OAuth secrets, restart, then paste the job ID into **Load Hover job**.
