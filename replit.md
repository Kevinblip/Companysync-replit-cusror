# replit.md

## Overview
This project is a comprehensive SaaS platform designed for roofing contractors. It integrates CRM, estimating, invoicing, crew management, and accounting functionalities, enhanced with AI-powered features for damage inspection and roof measurements. The platform aims to be a leading solution in the roofing industry by streamlining operations, improving efficiency, and providing advanced tools for businesses.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React single-page application built with Vite, using `shadcn/ui` (New York style) and Tailwind CSS for the UI. State management is handled by TanStack React Query, and forms by React Hook Form. It supports custom AI components, focusing on mobile UX and PWA for offline capabilities.

### Backend
The backend uses a hybrid architecture, routing all data operations through a local PostgreSQL database via a universal entity API. Multi-tenancy is enforced with `company_id`. Authentication supports Replit OIDC for internal users and email/password for external users via Passport. Admin access is database-driven.

### Core Integrations (Local)
A Vite plugin locally replaces Base44's Core integration APIs:
- **InvokeLLM**: Routes to Google Gemini API.
- **UploadFile**: Uses local file storage.
- **SendEmail**: Routes to Resend API.

### Local PostgreSQL
The primary data layer is a local PostgreSQL database with 13 dedicated tables and a `generic_entities` table using JSONB for over 80 other entity types. It includes an SDK name mapping and a filter translation layer for MongoDB-style operators. Call routing uses a 3-tier lookup: in-memory cache, local PostgreSQL, and Base44 API fallback.

### Serverless Functions
Serverless functions, written in TypeScript and executed on Deno, are located in `functions/`. They support authentication, cron jobs, and service role operations for features like AI Analysis, Calendar Sync, and Workflow Automation.

### Build Schedule
The platform includes a Build Schedule feature for tracking installations and repairs, with data stored as `BuildSchedule` entities in `generic_entities`.

### Financing Integration
Estimates can include financing options (Hearth, GreenSky, Wisetack, or custom) configurable per-company, allowing customers to view payment breakdowns and apply for financing directly.

### Storm Tracking System
This system integrates data from IEM LSR, NWS Active Alerts, and NWS Historical data for storm tracking. It features server-side geographic filtering, real-time active storm banners, map visualization, and a cron for email/SMS notifications based on user-defined settings. StormEvents are retained 365 days (matching the UI's max search window), the nightly purge cron self-heals by backfilling the full 365-day window afterward, and the alert cron runs shortly after startup and every 30 minutes thereafter. It ingests and alerts on the last 24h of real IEM hail/wind reports (not just NWS warnings), while `notified_storm_ids` prevents duplicate sends. State derivation for fetches reads `office_locations` in addition to `service_center_location`/`service_areas`.

## Feature Deep Dives
The features below have detailed implementation notes (file paths, function names, edge cases) kept in dedicated docs so this file stays scannable. Start here for a one-line summary, then follow the link for specifics.

- **[Public Estimate Link Signing (HMAC)](docs/estimate-link-signing.md)** — public estimate view/approve/PDF links require a signed token, not just the estimate ID.
- **[Scope of Work / Job Completion Checklist](docs/scope-of-work-checklist.md)** — per-job checklist on Build Schedule generated from estimate line items + job-type templates, with a soft completion gate.
- **[Hidden Features Registry](docs/hidden-features-registry.md)** — feature flags in `src/config/hiddenFeatures.js` that hide (without deleting) specific UI pieces, including Permit Assistant when its flag is off.
- **[Launch Checklist](docs/launch-checklist.md)** — the Launch Checklist page runs real health checks (live API calls, DB read/write probes) instead of blindly passing.
- **[Unified Customer & Lead Notes Feed](docs/customer-lead-notes-feed.md)** — notes from any part of the app (tasks, builds, manual entry) surface in one combined feed per customer/lead.
- **[Workflow Automation Engine](docs/workflow-automation-engine.md)** — event-triggered workflows for communications, notifications/tasks, and status updates, with delayed steps via cron.
- **[Action Items & Follow-Up Queue](docs/action-items-queue.md)** — auto-created reminders (estimate sent, new lead, stale lead) with escalating in-app/email/SMS notifications.
- **[Invoice `data` JSONB & supplement field](docs/invoice-data-column.md)** — `invoices.data` is shared storage (estimate/change-order links); every write must merge, never replace. `supplement_amount` is a reference note and does not affect the total or balance.
- **[Map Server-Side Geocoding](docs/map-geocoding.md)** — lead/customer coordinates are geocoded and persisted server-side so map pins load instantly.
- **[AI Capabilities](docs/ai-capabilities.md)** — CrewCam photo analysis, AI roof measurement, calibration memory, report extraction, satellite vision, and the Lexi/Sarah voice bridge.
- **[AI Systems Audit (pre-launch)](docs/ai-systems-audit.md)** — pre-launch audit of every AI-powered handler: usage/cost gating, dev/prod drift, timeouts/retries, and output validation.
- **[Price List Bulk Import Authorization](docs/price-list-bulk-import-authorization.md)** — bulk price list import now verifies the caller belongs to the target company instead of trusting a client-supplied `company_id`.
- **[Proactive Customer Outreach (Reminders)](docs/proactive-outreach-reminders.md)** — build/install + appointment reminders routed through one shared sender (valid phone, STOP opt-out, business hours, AI-id line); TEXT by default with an opt-in AI voice call per reminder type; build reminders are human-approval-gated Action Items and the AI identifies itself in every message.
- **[Staff Voice PIN Access](docs/staff-voice-pin-access.md)** — staff call the company AI number from their own cell; caller-ID match + spoken PIN (salted-hash, lockout, transcript redaction) unlocks Lexi's full CRM tool set by phone.
- **[AI Smart Setup (Quick Setup onboarding)](docs/ai-smart-setup.md)** — 5-step onboarding wizard that opens on the Smart Fill (AI) step, with parse-only AI extraction (`smartSetupParse`, incl. tagline + deterministic logo/brand-color extraction from the website markup), logo upload, an editable Review & Edit table before any writes, a `companies.onboarding_completed` dashboard gate in Layout.jsx (explicit `false` only), a consolidated integrations step, and a shared subcontractor CSV importer.
- **3D model dev harness** — `dev-3d-harness.html` (repo root, dev-only; not in the production `dist` build) mounts `HouseModel3D` with a 92×35 ft hip-roof fixture for visual verification. Screenshot it with puppeteer-core + nix chromium swiftshader flags (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`); headless captures without those flags have no WebGL.

## External Dependencies

### Core Platform
- **Base44 BaaS**: Authentication and serverless functions.

### AI / ML Services
- **Google Gemini API**: AI image analysis and speech-to-speech.
- **Poe API**: Advanced multi-photo damage analysis.
- **Google Solar API**: Satellite roof measurements and building insights.
- **Google Maps / Geocoding API**: Address geocoding and mapping.

### Communication
- **Twilio**: SMS, voice calls, and AI call agents.
- **Resend API**: Email sending.
- **Google Calendar API**: OAuth-based calendar synchronization.

### Payments
- **Stripe**: Payment processing.

### BYOK (Bring Your Own Key) Billing Engine
- **BYOK**: Allows paid subscribers to use their own API keys for Gemini, Twilio, and SMTP/Resend, with AES-256-GCM encryption. Includes daily AI call limits for trial users and metered billing for paid subscribers.

### CRM Integration
- **GoHighLevel (GHL)**: Lead synchronization via local handlers, including bulk import, pushing leads to GHL, and scheduled auto-sync.

### Supply Chain
- **ABC Supply**: Material ordering integration.

## Developer Workflow

### Local Git Hooks

A pre-push hook in `.githooks/pre-push` runs a set of fast, file-pattern-gated checks automatically on every push. Each check is a no-op unless the relevant files appear in the pushed commits.

**Hooks are activated automatically** via the `prepare` npm lifecycle script (`scripts/setup-dev.sh`) — no manual step required. Running `npm install` after cloning is sufficient. Output confirms: `[setup] Git hooks activated via .githooks`

The hook is a no-op in CI/CD environments where `.git` is absent.

The following checks are registered (in order):

| # | Check | Triggered by file pattern | Script |
|---|-------|--------------------------|--------|
| 1 | **Email verify-step lint** — surfaces missing "Verify … email delivery (Resend)" steps before code reaches CI | `.github/workflows/**` | `scripts/check-email-verify-steps.cjs` |
| 2 | **Portal privacy SQL guard** — detects `is_public` regressions in the portal query layer | `vite-functions-plugin.js`, `prod-server.cjs` | `scripts/check-portal-privacy-sql.cjs` |
| 3 | **Alerting-heartbeat workflow static analysis** — validates the heartbeat workflow YAML structure | `.github/workflows/alerting-heartbeat.yml` | `scripts/test-heartbeat-workflow.cjs` |
| 4 | **Email verify-step lint unit tests** — runs the lint script's own test suite when the script itself changes | `scripts/check-email-verify-steps.cjs`, `scripts/test-email-verify-steps.cjs` | `scripts/test-email-verify-steps.cjs` |
| 5 | **Slack webhook delivery-check tests** — validates Slack webhook delivery and post-deploy check scripts | `scripts/test-slack-webhook-check.sh`, `scripts/post-deploy-privacy-check.sh`, `scripts/post-deploy-body-limit-check.sh` | `scripts/test-slack-webhook-check.sh` |
| 6 | **Resend verify-action jq filter tests** — validates jq filter logic in the Resend verify GitHub Action | `.github/actions/verify-resend-delivery/**`, `scripts/test-resend-verify-action.sh` | `scripts/test-resend-verify-action.sh` |
| 7 | **Estimate-token HMAC unit tests** — verifies HMAC signing/validation logic for public estimate links | `lib/estimateToken.cjs`, `functions/_estimateToken.ts`, `scripts/test-estimate-token.cjs` | `scripts/test-estimate-token.cjs` |
| 8 | **Pre-push shell-guard self-test** — verifies the `$BASH_VERSION` guard exits 0 with the expected warning when the hook is invoked via `sh` | `.githooks/pre-push`, `scripts/test-pre-push-shell-guard.sh` | `scripts/test-pre-push-shell-guard.sh` |
| 9 | **Insurance estimate template tests** — runs the vitest suite for all insurance carrier template generators to catch regressions before push | `src/utils/insuranceEstimateTemplates.js` | `npx vitest run src/__tests__/insuranceEstimateTemplates.test.js` |
| 10 | **Duplicate-payment guard tests** — runs the vitest suite for duplicate-payment protection guards to catch regressions before push | `src/pages/Estimates.jsx`, `src/pages/Invoices.jsx`, `src/pages/Payments.jsx`, `src/pages/invoice-details.jsx`, `src/utils/duplicateCheck.js`, `src/__tests__/duplicatePaymentGuards.test.js` | `npx vitest run src/__tests__/duplicatePaymentGuards.test.js` |
| 11 | **Xactimate export tests** — runs the vitest suites for the Xactimate PDF export: the pure per-claim re-seed unit tests plus the DOM/integration test that drives the export dialog and asserts the produced HTML (sections/totals) and that per-claim fields re-seed from the current customer (no cross-customer leak) | `src/utils/xactimatePdfAdapter.js`, `src/utils/insuranceEstimateTemplates.js`, `src/pages/AIEstimator.jsx`, `src/components/estimates/XactimateExportDialog.jsx`, `src/__tests__/xactimateDialogSeeding.test.js`, `src/__tests__/xactimateExportDialog.test.jsx` | `npx vitest run src/__tests__/xactimateDialogSeeding.test.js src/__tests__/xactimateExportDialog.test.jsx` |
| 12 | **Tenant-guard billing strip tests** — verifies the money-critical guard that stops a tenant from self-granting paid usage credits via the entity API; asserts the strip keys on the resolved `companies` table (so the `PUT /entity/companies/<id>` alias can't bypass it) and that super-admins/service token still pass | `lib/tenantGuard.cjs`, `scripts/test-tenant-guard-billing.cjs` | `scripts/test-tenant-guard-billing.cjs` |
| 13 | **Tenant-guard ownership-check tests** — verifies the by-id GET/PUT/DELETE ownership guard scopes `companies` rows on their own `id` (the `companies` table has no `company_id` column, so without this any authenticated user could read/write any company's record); asserts cross-company access is blocked in enforce mode, super-admins/service token bypass, and non-company entities still scope on `company_id` | `lib/tenantGuard.cjs`, `scripts/test-tenant-guard-ownership.cjs` | `scripts/test-tenant-guard-ownership.cjs` |
| 14 | **Tenant-guard subscription strip tests** — verifies the money-critical guard that stops a tenant from self-activating a subscription, extending their own free trial, or raising plan limits via the entity API; asserts the 7 subscription fields (`subscription_plan`, `subscription_status`, `trial_ends_at`, `trial_end_date`, `max_users`, `max_leads`, `max_customers`) are stripped on both create and update, that create forces `subscription_status='pending'` (so a stripped body can't inherit the `companies` DB DEFAULT `'active'`), that update never invents a status (no live-company downgrade), and that super-admins/service token bypass | `lib/tenantGuard.cjs`, `scripts/test-tenant-guard-subscription.cjs` | `scripts/test-tenant-guard-subscription.cjs` |
| 15 | **Tenant-guard no-company create tests** — verifies the guard that stops a brand-new user (no company membership) from creating a StaffProfile with an arbitrary `company_id` to link themselves into an existing tenant (which would then satisfy `startCompanyTrial`'s staff-membership ownership check); asserts the caller must be the target company's `created_by`, that `staff_profiles` is always blocked regardless of `TENANT_GUARD_MODE`, that `created_by` is forced to the session email on company create, and that legitimate onboarding (create company → create owner StaffProfile) still passes | `lib/tenantGuard.cjs`, `scripts/test-tenant-guard-nocompany.cjs` | `scripts/test-tenant-guard-nocompany.cjs` |
| 15b | **Tenant-guard admin-only company-fields tests** — verifies the role guard that stops NON-ADMIN staff from changing top-level company identity/branding columns (`company_name`, `phone`, `address`, `logo_url`, `branding`, `parent_company_id`, `created_by`, ...) via `PUT /api/local/entity/Company/<id>`; asserts CHANGE-detection semantics (echoing unchanged values from a full-record spread-back must NOT 403), the company-owner (`created_by`) bypass, the nested `data` JSONB smuggling block, and that `timezone`/`preferred_language`/`onboarding_completed` stay writable for legitimate non-admin flows | `lib/tenantGuard.cjs`, `scripts/test-tenant-guard-company-fields.cjs` | `scripts/test-tenant-guard-company-fields.cjs` |
| 15c | **Staff voice-PIN auth unit tests** — verifies the phone-CRM auth module used by the Twilio bridges: caller-ID last-10 candidate matching (active + PIN-set profiles only), salted SHA-256 PIN verification, 5-fail→15-min persisted lockout with counter reset on success, and digit redaction for unverified-call transcripts | `lib/staffVoiceAuth.cjs`, `scripts/test-staff-voice-auth.cjs` | `scripts/test-staff-voice-auth.cjs` |
| 16 | **Company email sender regression tests** — verifies the from-address construction and Resend routing for per-company outbound email | `vite-functions-plugin.js`, `prod-server.cjs`, `scripts/test-company-email-sender.cjs` | `scripts/test-company-email-sender.cjs` |
| 17 | **Price-list cross-tenant authz tests** — verifies that bulk price-list imports reject callers whose session company doesn't match the target `company_id` | `vite-functions-plugin.js`, `scripts/test-price-list-authz.cjs` | `scripts/test-price-list-authz.cjs` |
| 18 | **Plan feature-gate regression tests** — verifies that `PLAN_FEATURES` / `SUBSCRIPTION_LIMITS` in `SubscriptionGate.jsx` still produce the correct allow/block results and numeric ceilings for Basic, Business, and Enterprise plans; skips gracefully when `DATABASE_URL` is unset or the dev server isn't running | `src/components/SubscriptionGate.jsx`, `scripts/seed-plan-test-companies.cjs`, `scripts/test-plan-feature-gates.cjs` | `scripts/test-plan-feature-gates.cjs` |

If any triggered check fails, the push is blocked with a clear error message identifying the violation. All checks are independent and only run when their file patterns match.

## Plan Test Accounts

Three persistent companies exist in the dev database — one per subscription tier — for manually verifying that the UI hides/shows the right features for each plan, and for the automated gate test.

| Plan       | Login email               | Password  | Max users | Max customers | Max leads |
|------------|---------------------------|-----------|-----------|---------------|-----------|
| Basic      | test@basic.test           | Test1234! | 5         | 100           | 250       |
| Business   | test@business.test        | Test1234! | 10        | 1,000         | Unlimited |
| Enterprise | test@enterprise.test      | Test1234! | 25        | Unlimited     | Unlimited |

**Re-creating / resetting:** `npm run seed:plan-companies` is fully idempotent — safe to re-run at any time.

**Automated gate check:** `npm run test:plan-gates` (also runs as the `test:plan-gates` workflow) — verifies DB state, `hasFeatureAccess` logic, and numeric limits via the `checkSubscriptionLimits` API.

**What to check manually:**
- Log in as Basic → sidebar should be missing Storm Tracking, Sarah AI, Workflows, Commission Tracking
- Log in as Business → those items appear; Subcontractors, full Accounting, Advanced Analytics should still be hidden
- Log in as Enterprise → everything is visible

---

### Live Smoke Tests (require a running dev server)

These end-to-end tests drive real HTTP requests against the running app (`npm run dev`) plus the dev database, so they are exposed as workflows rather than pre-push hooks:

- **`test:onboarding-trial`** (`scripts/test-onboarding-trial.cjs`) — proves the real QuickSetup sign-up flow still works after the subscription lockdown: Company create (forged subscription fields stripped → status `'pending'`, `created_by` stamped from session) → owner StaffProfile create (allowed via `created_by` claim) → `startCompanyTrial` flips to a 14-day `'trial'` with plan limits; negative checks assert an entity-API PUT can't self-activate/extend the trial and a second `startCompanyTrial` never re-extends it. Cleans up its fixtures on every run.
- **`test:body-limit`** (`scripts/test-body-limit.cjs`) — request body-size limit checks.
- **`test:company-fields-guard`** (`scripts/test-company-fields-guard.cjs`) — end-to-end proof that a non-admin staff member gets a 403 when changing top-level company identity fields (`company_name`, `phone`, `logo_url`, nested `data` smuggle, raw `companies` alias route) while unchanged-value echoes, `timezone` changes, admin renames, and owner (`created_by`) updates all still return 200. Cleans up its fixtures on every run.
- **`test:lexi-ws-auth`** (`scripts/test-lexi-ws-auth.cjs`) — Lexi voice WebSocket session verification: `/ws/lexi-native` resolves the user from the signed `connect.sid` session cookie via `lib/lexiWsAuth.cjs` (shared by dev plugin and prod-server) and confirms company membership server-side; connections with no session, or requesting a company the user doesn't belong to, are closed with code 1008. The client's `companyId`/`userEmail` query params are display hints only.

---

### Publish image size — keep large files OUT of the project folder

Everything in the project folder ships inside the published VM image, which is capped at **8 GiB** (a July 2026 publish failed on this). Rules:

- **Large media (videos, big uploads) go to Replit Object Storage, not the repo.** App videos live under the public prefix at `videos/…` and `generated_marketing_videos/…`; the app serves them via a 302 redirect to a signed GCS URL (`prod-server.cjs` static fallback + `vite-integrations-plugin.js` dev middleware). To add/update a video, drop it in `public/videos/` locally, run `node scripts/upload-videos-to-storage.cjs`, then delete the local copy.
- `public/uploads/` is only a disk cache — object storage is the source of truth; it's safe to clear.
- Don't leave one-off artifacts (zips, video-generation intermediates, giant PDFs/screenshots) in `attached_assets/` or `scripts/` — archive to private object storage (`archives/…`) or delete. Video intermediates dirs are gitignored (`scripts/mv-tmp/`, `scripts/video/{clips,final,audio,frames}/`).
- Keep total project size under ~5.5 GB for headroom. Check with `du -sh ~/workspace`.
