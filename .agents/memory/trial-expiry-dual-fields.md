---
name: Trial expiry dual fields & voice gate
description: Why trial end dates live in two fields, how the voice-access gate decides expiry, and the prod Stripe webhook gap that must never lock out paying customers.
---

# Trial expiry: dual date fields, status-keyed gate, Stripe webhook gap

## The dual-field trap
Trial end dates exist in TWO places on `companies`:
- `trial_end_date` — real TIMESTAMP column (both dev & prod schemas).
- `data->>'trial_ends_at'` — date-only string in the JSONB blob (what `startCompanyTrial` historically wrote exclusively).

**Rule:** any writer must set BOTH (`startCompanyTrial` now does); any reader/gate must fall back column → JSONB. An idempotent backfill in both `db/schema.js` and `db/prod-db.cjs` copies JSONB → column for legacy rows (try/catch-wrapped).

## Expiry must key on STATUS, not plan
Action-started trials carry the *chosen* plan (`basic`/`business`/…) with `subscription_status='trial'`. A `plan === 'trial'` check never fires for them. The gate condition is:
`status==='expired' || (trialExpired && (status==='trial' || plan==='trial'))`.

## subscription_status column exists only in dev
Dev `schema.js` has a real `subscription_status` column; prod `prod-db.cjs` companies table does NOT (status lives in `data` JSONB there). Shared gate code must `SELECT *` (naming the column throws in prod) and read `company.subscription_status ?? company.data?.subscription_status`.

## Never lock out converted subscribers (prod webhook gap)
Prod's Stripe webhook has NO `customer.subscription.*` handler — nothing in prod ever flips status to `'active'` after checkout (dev's vite-stripe-plugin does). Defense-in-depth: the voice gates and `processTrialLifecycle` cron both SKIP companies with a `stripe_subscription_id` (column or JSONB) so a paying customer stuck at status='trial' is never blocked/expired/nurture-emailed.

**How to apply:** any new paid-feature gate or trial-lifecycle logic must (1) use the status-keyed condition, (2) use column→JSONB fallbacks for status and dates, (3) exempt rows with a live `stripe_subscription_id` until prod webhook subscription lifecycle handling exists.

Test: `node scripts/test-voice-access-trial-expiry.cjs` (exercises the real exported gate against the dev DB).
