# AI Smart Setup (Quick Setup onboarding)

Quick Setup is now a 5-step wizard: Company Info (0) → Smart Fill (1) → AI Assistants (2) → Integrations (3) → Done (4). New companies must finish (or skip) it before reaching the dashboard.

**Opening step:** the wizard opens on **Smart Fill (step 1)** whenever the signed-in user's company already exists (the normal case — companies are created at signup / auto-created from onboarding data). A one-shot effect in `QuickSetup.jsx` (`openedOnSmartRef`) bumps `currentStep` from 0→1 the first time `myCompany` resolves; it never fires again, so Back still reaches Company Info and manual navigation is untouched. Users with no company at all still start on Company Info so there's a company to apply Smart Fill results to.

## Parse-only AI extraction (`smartSetupParse`)

- Handler lives in `vite-functions-plugin.js` `functionHandlers` (registered ONCE; prod serves the same handler via `getFunctionHandlers` — do NOT mirror in `prod-server.cjs`).
- Takes `{ section, text, websiteUrl }` for one section at a time (`company`, `hours`, `staff`, `areas`, `subcontractors`, `knowledge`) and returns **structured JSON only** — it never creates entities, never sends invites, never touches subscription fields.
- AI usage is gated via `requireGatedCompany(req, 'ai')`; unknown sections and empty input return friendly errors.
- `fetchWebsiteTextForSetup` reduces a company website to plain text for the AI. SSRF-hardened: `assertPublicSetupUrl` blocks internal TLDs, private/loopback IPs (any textual encoding — DNS lookup canonicalizes decimal/hex forms), and hostnames that *resolve* to private IPs; redirects are followed manually (max 3 hops) with re-validation on every hop. It returns `{ text, logoUrl, brandColors }`.
- **Brand assets are extracted deterministically from the raw markup, never by the AI** (`ssExtractBrandAssets`): logo = `<img>` tags mentioning "logo" > `og:image` > `apple-touch-icon` > favicon, resolved against the final URL and restricted to http(s); brand colors = `theme-color` meta first, else the most frequent saturated (non-white/black/gray) hex colors. The company section also asks the AI for a `tagline` (with its own confidence). Server validation: tagline `ssStr(…,160)`, logo must URL-parse as http(s), colors must match `#hex6`; a "no logo found" warning is pushed when a website parse finds none.

## Human-in-the-loop apply (`src/components/setup/SmartSetupPanel.jsx`)

- Parsed results render in an editable Review & Edit table (per-row inputs, remove buttons, low-confidence highlighting). Nothing is written until "Confirm & Apply Everything".
- **Logo + branding intake:** the company section has an Upload Logo button (`base44.integrations.Core.UploadFile` → `file_url`) that works with or without a parse (uploading first initializes a draft holding just the logo). A hand-uploaded logo always wins over the website-discovered one on re-parse (`_logoSource: "upload"`). The review grid shows a tagline input, a logo preview with Remove (website-found logos are badged), and two color pickers for brand primary/secondary. Apply writes `company_tagline`, `logo_url`, `brand_primary_color`, `brand_secondary_color` (colors live in the companies `data` JSONB — same fields CompanySetup reads).
- The apply mutation checkpoints progress in a ref (`appliedRef`): if a partial failure occurs, retrying skips sections/rows that already persisted (staff/subs keyed by `_key`, KB articles by title) so no duplicates are created.
- Staff invite emails send only when the "send invites" checkbox is on, and only during the confirmed apply.
- Business hours are stashed in `sessionStorage.smart_setup_hours` and merged into AssistantSettings `scheduling_defaults` (existing assistants updated immediately; the AI Assistants step picks the stash up at creation time).

## Onboarding gate (`src/Layout.jsx`)

- `companies.onboarding_completed` boolean (dev `db/schema.js` + prod `db/prod-db.cjs`, one-time migration). Existing companies were grandfathered to `true`/NULL.
- **Known edge case (403 during onboarding for invited non-admin staff):** the entity API now blocks non-admin staff from *changing* top-level company identity fields (`company_name`, `phone`, `email`, `logo_url`, ... — see `enforceAdminOnlyCompanyFields` in `lib/tenantGuard.cjs`). The Layout onboarding gate bounces ANY member of a company with `onboarding_completed === false` into QuickSetup, so a non-admin staff member invited *before* the owner finishes onboarding will get 403s if they try to apply Smart Fill identity changes. Echoing unchanged values still succeeds; the owner (`created_by`) and administrators are unaffected. If a support report says "onboarding stuck at Smart Fill / save fails", check whether the user is a non-admin member of a not-yet-onboarded company — the fix is for the owner/admin to complete setup.
- The gate redirects to QuickSetup **only on explicit `false`** — NULL/undefined never redirects. It skips impersonation sessions, the QuickSetup page itself, and public pages.
- **Completion paths must do three things** (all three QuickSetup completion sites — final "Go to Dashboard", Skip with existing company, Skip creating a new company — already do): write `onboarding_completed: true`, pin `localStorage.last_used_company_id` to the completed company (Layout's *first-priority* active-company resolution — without this a multi-company owner can complete company A while the gate checks company B), and flip the flag inside the cached `['layout-companies-list']` query via `setQueriesData` + invalidate (the gate reads THAT query, whose staleTime is 3 min; invalidating only `['companies']` leaves the gate on stale `false` and bounces the user straight back).

## Subcontractor CSV import

- Shared parser `src/utils/subcontractorCsv.js` (`parseCsv`, `parseSubcontractorCsv`, `SUB_SPECIALTIES`) used by SmartSetupPanel AND the Subcontractors page Import CSV flow.
- Column detection is priority-ordered with exact-match preference (a "contact name" header can't steal the company-name slot; "name" candidates never match headers containing "contact").
- `src/pages/Subcontractors.jsx` import: hidden file input → editable review dialog → dedupe-by-name skip → per-row `Subcontractor.create` with `company_id` scoping.

## Integrations step

Consolidated step 3 shows connect/status cards for Twilio, Email (Resend), Google Calendar, Stripe, and QuickBooks (`checkQuickBooksConnection`).
