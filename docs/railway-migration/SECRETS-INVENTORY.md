# CompanySync secrets & settings inventory (NAMES ONLY — no values)
Prepared 2026-10-14 for the Replit → Railway move. Branch: migration/railway-unified.
Values live only in Replit Secrets (today) and Railway Variables (after the move). Never paste values in chat, email, or git.

## A. NEVER CHANGE (copy the exact current value)
| Name | Why it must never change |
|---|---|
| ENCRYPTION_KEY | Decrypts stored integration credentials (Twilio/QuickBooks/GHL/email tokens) in the database. A new value = all saved connections unreadable. Was plaintext in .replit. |
| SESSION_SECRET | Signs login cookies. Changing it logs everyone out and breaks Google sign-in cookies. |
| DATABASE_URL | Points at the production Postgres. Change only during the planned database move, never by accident. |
| SARAH_BRIDGE_SECRET | Shared secret with Base44 (Sarah/Alex voice bridge). Must match the Base44 side. Was plaintext in .replit. |
| LEXI_NATIVE_BRIDGE_SECRET | Shared secret with Base44 Lexi bridge. Must match Base44. Was plaintext in .replit. |
| LEXI_VOICE_BRIDGE_SECRET, INTERNAL_SERVICE_TOKEN, ESTIMATE_LINK_SECRET | Signs/authorizes links and service calls already issued; changing breaks existing estimate links / callers. |
| STRIPE_WEBHOOK_SECRET | Must match the endpoint configured in Stripe (changes only when the webhook URL is re-registered at cutover). |

## B. MUST BE SET (secret, can be re-entered with the same value)
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, TWILIO_PHONE_FROM,
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_GEMINI_API_KEY, GEMINI_API_KEY, GOOGLE_MAPS_API_KEY, GOOGLE_CHAT_CREDENTIALS, OPENAI_API_KEY,
STRIPE_SECRET_KEY, STRIPE_API_KEY, QB_CLIENT_ID, QB_CLIENT_SECRET, GHL_CLIENT_ID, GHL_CLIENT_SECRET,
MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, HOVER_CLIENT_ID, HOVER_CLIENT_SECRET,
RESEND_API_KEY, POSTMARK_SERVER_TOKEN, POSTMARK_ACCOUNT_TOKEN, EMAIL_PROVIDER_WEBHOOK_SECRET, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (AWS_API_KEY / AWS_SECRET_KEY legacy names)

## C. Plain settings (not secret; from .replit [userenv] or code defaults)
BASE44_SARAH_API_URL, BASE44_LEXI_BRIDGE_API_URL, VITE_REPLIT_APP_URL, VITE_BASE44_FUNCTIONS_URL, EMAIL_FROM, EMAIL_PROVIDER, EMAIL_POSTMARK_DISABLED,
TENANT_GUARD_MODE, TWILIO_REQUIRE_SIGNATURE, ADMIN_EMAIL, ADMIN_PHONE, OWNER_ALERT_PHONE, APP_URL, PUBLIC_APP_URL, GMAIL_REDIRECT_URI_BASE,
GEMINI_MODEL, GEMINI_NATIVE_AUDIO_MODEL, NODE_ENV=production, POSTMARK_VERIFIED_DOMAINS, plus optional tuning vars (LEXI_MAX_IDLE_MS, LOCAL_UPLOAD_CACHE_*, CALLER_CACHE_MAX_SIZE, SMS_TEST_ALLOWLIST, ESTIMATE_REQUIRE_TOKEN, ROOF_IMAGERY_TAKEOFF).
PORT: Railway sets it automatically — do not set.

## D. Replit-only (do NOT copy to Railway; need a replacement)
REPLIT_DEPLOYMENT, REPLIT_DOMAINS, REPLIT_DEV_DOMAIN, REPL_ID, REPL_IDENTITY, WEB_REPL_RENEWAL, REPLIT_CONNECTORS_HOSTNAME, ISSUER_URL,
PUBLIC_OBJECT_SEARCH_PATHS, PRIVATE_OBJECT_DIR, DEFAULT_OBJECT_STORAGE_BUCKET_ID (Replit Object Storage via the 127.0.0.1:1106 sidecar — unreachable from Railway; see UPLOADS-PLAN).

## Where each must be set
1. **Replit Secrets — BEFORE any branch without the .replit values reaches live Replit.** Add ENCRYPTION_KEY, SARAH_BRIDGE_SECRET, LEXI_NATIVE_BRIDGE_SECRET to Replit Secrets with the *identical* values currently in .replit, then confirm Publish still works. Only after that may this branch's .replit change be merged into anything Replit pulls from. (Nothing on live Replit was touched today.)
2. **Railway Variables (companysync-master → app service):** every name in A, B, C, with values copied exactly from Replit Secrets/.replit. Use Railway "Raw editor" paste; double-check A-list values by comparing length + first/last 4 characters only.
3. **External dashboards at cutover:** Google OAuth redirect URI, Stripe webhook, Twilio webhooks + fallback, QuickBooks/Microsoft/GHL redirect URIs — host changes only, secrets stay the same.

## Rotation (NOT now)
ENCRYPTION_KEY sat in plaintext in a committed file, so it should eventually be rotated — but ONLY with a data re-encryption plan: (1) add a second key var, (2) a script that decrypts every encrypted column with the old key and re-encrypts with the new, verified on a DB copy, (3) switch, (4) remove the old key. SARAH/LEXI bridge secrets rotate together with Base44. Git history still contains the old values (we did not rewrite history), so treat them as exposed until rotated.
