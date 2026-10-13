---
name: Subscription / trial self-grant guard
description: How a tenant is stopped from self-activating a subscription or extending their own free trial via the universal entity API, and the non-obvious traps.
---

# Company subscription/trial fields are tenant-writable — must be guarded

The company subscription/trial/plan-limit fields flow through the universal entity
API like any other field. Without a guard a tenant can `PUT`/`POST` them to
self-activate a paid subscription, extend their own free trial, or raise plan limits.
`tenantGuard.stripProtectedSubscriptionFields(...)` strips them for
non-super-admin / non-service callers, keyed on the RESOLVED table name `companies`
(never the SDK alias `Company`/`Companies`, which the route resolves first).

## The three traps that make this non-trivial

1. **The DB DEFAULT trap (why `isCreate` exists).** The `companies.subscription_status`
   column has `DEFAULT 'active'`. So merely *stripping* the field on CREATE leaves a
   brand-new company that inherits `'active'` — a free paid account. The guard must
   **force `subscription_status='pending'` on create**. On **update it must NOT invent
   a status** — forcing one there would silently downgrade a live paying company.

2. **The nested `data` JSONB smuggling trap (the easy one to miss).** Some company
   fields (notably `trial_ends_at` and `max_customers`) are NOT real columns — they
   live only in the `data` JSONB blob and are merged *over* the real columns on read
   (e.g. the trial banner reads `company.trial_ends_at`). The update/create paths
   merge a client-supplied `body.data` straight into that JSONB. A top-level-only
   strip is therefore bypassable with `PUT {data:{trial_ends_at:'2099-...', max_customers:999999}}`.
   **The guard must strip protected fields from BOTH the top level AND `body.data`.**
   The billing-credit strip had the same blind spot and was fixed in lockstep.
   **Why:** the JSONB merge makes a smuggled `data.*` value authoritative on read.
   **How to apply:** any future protected-field strip on a table with a `data` JSONB
   column must recurse into `body.data`, not just check top-level keys.

3. **Legit path = a dedicated guarded server action, not the entity API.** The only
   way a tenant legitimately starts a trial is a server handler (`startCompanyTrial`)
   that re-validates eligibility server-side: fresh 14-day trial only when status is
   null/''/pending; plan-only swap when already `'trial'` (no re-extend); reject
   anything else. Onboarding UIs create the company (subscription fields omitted) +
   the owner's staff profile, then invoke that action.

## Other gotchas
- **Check `res.error`.** `invokeLocalFunction` throws on a handler returning `{error}`
  and its catch hands back `{error, data:{}}` — a fake success. Callers of
  `startCompanyTrial` (and any handler) must check `res?.error` or a rejected
  trial-start looks like it worked.
- **'pending' does not hard-lock the UI** (no SubscriptionGuard block; TrialReminder
  banner returns null), so leaving a secondary create path at 'pending' is a safe,
  strictly-more-secure fallback — the user can still start a trial from Pricing (whose
  brand-new gate must also treat `'pending'` as eligible).
- **Every company-create path must set status, not rely on the column default.** The
  dev-only `/api/local/auto-provision` INSERT had to be given `'pending'` explicitly
  for the same DB-DEFAULT reason as trap #1.
- **Dev/prod lockstep:** the strip is applied in BOTH `vite-db-plugin.js` (dev) and
  `db/prod-db.cjs` (prod) at POST-bulk, POST-single, and PUT; `startCompanyTrial` is
  registered once in the vite functions registry (serves both). Miss one and the two
  environments diverge.
- **Editing a Vite server-side plugin can keep a STALE require cache.** After adding a
  new export to a `.cjs` required by `vite-db-plugin.js`, the on-save auto-reload may
  still hold the old module → `tenantGuard.<newFn> is not a function` at runtime even
  though `node -e require(...)` shows the export. A full workflow restart (SIGTERM)
  clears it. Don't trust the auto-reload for new exports on the plugin path.
