---
name: QuickBooks sandbox vs production environment
description: Intuit dev-key OAuth connections bind to sandbox realms; API base must match qb_environment; connection status must live-verify, not just check token existence.
---

# QuickBooks sandbox vs production

**The rule:** An Intuit OAuth connection made with DEVELOPMENT keys can only connect to Intuit sandbox companies (e.g. "Sandbox Company_US_1"). Those tokens 403 (`ApplicationAuthorizationFailed`) against `https://quickbooks.api.intuit.com` but work against `https://sandbox-quickbooks.api.intuit.com`. Token validity ≠ usable connection.

**Why:** A prod tenant "connected" QuickBooks via dev keys; the app hardcoded the production API base and the status check only tested that tokens existed — so the UI said connected while every sync silently failed.

**How to apply:**
- `QuickBooksSettings.data.qb_environment` ('production'|'sandbox') is written by the OAuth callbacks (dev `vite-functions-plugin.js` + prod `prod-server.cjs` — these raw HTTP routes must stay mirrored) and self-healed by `checkQuickBooksConnection`.
- Every QB API call site must pick the base from `cfg.qb_environment === 'sandbox'` — `lib/quickbooksSync.cjs` `getApiBase(realmId, sandbox)` and the inline base in `syncQuickBooksInvoice`.
- `checkQuickBooksConnection` live-verifies via a `companyinfo` probe (prod base then sandbox base), refreshes on 401 once, returns `{connected, environment, sandbox, company_name, needs_reconnect, error}`; Settings.jsx shows an amber sandbox banner and a red needs_reconnect alert.
- Legacy rows without `qb_environment` default to the prod base until the user opens Settings (which self-heals the row).
- Going live for real books: get Production keys in the Intuit developer portal (Keys & credentials → Production; requires registering the redirect URI, e.g. `https://<domain>/api/quickbooks-callback`), update `QB_CLIENT_ID`/`QB_CLIENT_SECRET`, then Disconnect + reconnect choosing the real company.
- `refreshQBToken` persists refreshed tokens with a shallow JSONB merge (`data = data || patch`) so it can't clobber self-healed fields; full-row `data = $1` replaces from stale in-memory cfg are the enemy.
- The `functions/*.ts` QB files that hardcode sandbox are legacy/dead — the vite-registry handlers serve both dev & prod.
