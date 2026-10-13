---
name: Tenant-guard billing-field strip (entity-API self-grant)
description: How paid-credit self-grant is blocked on the universal entity API, and the sdkName-vs-entityType bypass that makes naive guards useless.
---

# Blocking Company paid-credit self-grant via the entity API

Paid usage credits (`ai_credits_purchased`, `sms_credits_purchased`,
`call_credits_purchased`, `extra_ai_credits`, `extra_lexi_credits`,
`extra_marcus_credits` on the `companies` table) are ONLY ever granted
server-side by the Stripe webhook after a confirmed payment. Nothing in the app
writes them through the universal entity API. `tenantGuard.stripProtectedBillingFields`
deletes these keys from any Company CREATE/UPDATE body so a tenant can't hand
themselves free credits by POSTing/PUTting to `/api/local/entity`.

## The sdkName-vs-entityType bypass (money-critical gotcha)
**Rule:** any protective strip/guard on the entity API must key on the RESOLVED
table name (`entityType === 'companies'`), NEVER on the raw SDK alias
(`sdkName === 'Company'`).

**Why:** the route takes the entity name straight from the URL and resolves it
with `SDK_TO_TABLE[sdkName] || sdkName`. Both `Company` (the SDK alias) and the
raw table name `companies` resolve to the same `companies` table. A guard keyed
on `'Company'` is silently bypassed by hitting
`PUT /api/local/entity/companies/<id>` directly — entityType still resolves to
`companies` and the real columns get written. This defeated the whole fix on the
first pass and was only caught in review.

**How to apply:** pass the already-computed `entityType` into the guard at every
create / bulk-create / put call site in BOTH `vite-db-plugin.js` (dev) and
`db/prod-db.cjs` (prod), and match on `entityType === 'companies'`. Super-admins
and the internal service token bypass; enforcement is UNCONDITIONAL (not gated by
`TENANT_GUARD_MODE`) because it's money-critical. Regression:
`scripts/test-tenant-guard-billing.cjs` (wired into pre-push on `lib/tenantGuard.cjs`).

## Deliberately NARROW scope
Do NOT strip `subscription_plan`, `subscription_status`, `trial_end_date` /
`trial_ends_at`, or the `max_*` plan limits. Onboarding (`QuickSetup.jsx`) and
free-trial start (`Pricing.jsx`) legitimately set those through the entity API;
stripping them breaks new-company creation and trial start.

## Known remaining gaps (not fixed — separate/lower severity)
- A tenant can still self-set `subscription_status='active'` or extend
  `trial_end_date` via the entity API (grants free *time*, not paid credits).
  Proper fix = move plan/trial writes server-side, then strip these too.
- `checkOwnership` is a no-op for `companies` rows: the table's `companyField`
  is `id` and there's no `company_id` column, so `record.company_id` is
  undefined and it falls into the "orphan, allow" branch. Any authenticated
  tenant can therefore PUT any company row (the credit strip is the only
  defense on that path). Fix = make checkOwnership use `record.id` when
  `companyField === 'id'`.
