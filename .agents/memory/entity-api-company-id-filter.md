---
name: Entity API company_id $in filter
description: The universal entity API must handle company_id as scalar OR {$in:[...]}; dev and prod paths must stay in lockstep.
---

The universal entity API (`GET /api/local/entity/<Type>?company_id=...`) is served by TWO
separate implementations that must behave identically:
- DEV: `vite-db-plugin.js` → `genericFilter()`
- PROD: `db/prod-db.cjs` → `universalFilter()` (reached via `prod-server.cjs` → `handleLocalDbRoute`)

`company_id` can arrive as a plain scalar OR as a Mongo-style operator object `{$in:[id]}`
(JSON-encoded in the query string). The "complete backup" flow
(`functions/createCompleteBackup.ts`) ALWAYS sends the `$in` form.

**Rule:** both filter implementations must translate `company_id={$in:[...]}` into a proper
`IN (...)` clause for BOTH the dedicated-table path (customers, leads, estimates, invoices,
projects, tasks, …) and the `generic_entities` path. A scalar must still work too.

**Why:** prod's `universalFilter` once pushed the raw `{$in:[id]}` object straight into
`company_id = $N`, which matched 0 rows for every entity type — so backups silently captured
0 customers/estimates/invoices/etc. while still capturing entity types that happened to be
queried with a scalar. Dev's `genericFilter` already handled `$in`, so the bug was prod-only
and invisible in the workspace.

**How to apply:** any time you touch company_id filtering or the entity-collection GET route
in either file, mirror the change in the other. Verify with `node scripts/test-backup-filter.cjs`
(asserts scalar and `$in` forms return identical counts against the live DB).
