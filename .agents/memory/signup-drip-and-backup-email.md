---
name: Signup drip bypass & backup email
description: handleSignup must create company as 'pending' then trigger startCompanyTrial internally; backup cron must use sendViaResend not core.SendEmail.
---

## Rules

**Backup cron email**: Never use `core.SendEmail` from `vite-integrations-plugin.js`. That module doesn't export `SendEmail` — it's a Base44 stub. Always use `sendViaResend()` which is defined at the top of `vite-functions-plugin.js`.

**Signup drip wiring**: `handleSignup` in `db/local-auth.cjs` must:
1. Create company with `subscription_status='pending'` (not `'trial'`), so `startCompanyTrial` sees it as a fresh trial (`isFresh=true`) and fires Day-0 drip + TrialNurtureLog.
2. After creating the session, fire-and-forget a fetch to `/api/functions/invoke` → `startCompanyTrial` using the new signed session cookie for auth (`signSessionId(sid, SESSION_SECRET)`).

If the company is created with `status='trial'` directly, `startCompanyTrial` sees `isOnTrial=true` (not `isFresh`) and skips Day-0. The company never gets a TrialNurtureLog entry and the daily cron never sends drip touches.

**OAuth auto-provisioning**: The authenticated auto-provision route in both dev and production must also create the company as `pending`, record an explicit signup source, and complete through `startCompanyTrial`. It must not grant an active Professional company directly.

**Why:** A production-only auto-provision implementation once created Google-auth companies without a trial status. The UI treated the missing status as active, while signup events, admin alerts, and the entire nurture campaign were bypassed.

**Admin alert coverage**:
- Email/password signups: `sendAdminNewSignupAlert()` in `handleSignup` (immediate) + admin alert in `startCompanyTrial`'s `isFresh` block (includes trial details).
- Replit OIDC signups: only the `startCompanyTrial` block fires (no `handleSignup`).

**adminBackfillCompany**: Super-admin function handler for companies missing from local DB (e.g. signed up via Base44). Creates company+staff record as `'pending'`, calls `startCompanyTrial` with a forged `fakeReq` containing the owner's email to pass membership check.

**Why**: `core.SendEmail` error was crashing the daily backup cron for all tenants. Drip bypass meant email/password signups never got Day-0 nurture touch or TrialNurtureLog, so the cron skipped them on every day.

**How to apply**: After any changes to `handleSignup` that touch company creation, verify `subscription_status='pending'` in the INSERT and that the `setImmediate` fetch to `startCompanyTrial` is present.
