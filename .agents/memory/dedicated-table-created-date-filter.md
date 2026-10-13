---
name: Dedicated table created_date filter remap
description: buildDedicatedFilterWhere must remap created_date→created_at; without it, date range filters on leads/customers/communications silently return zero rows.
---

## Rule
When filtering dedicated tables (leads, customers, communications, etc.) with `created_date: { $gte: ..., $lte: ... }`, the entity API's `buildDedicatedFilterWhere()` must remap `created_date` → `created_at` before checking `tableColumns.has(key)`.

Without the remap:
- `tableColumns.has('created_date')` → `false` (column is `created_at`)
- Falls back to `data->>'created_date'` (JSONB lookup)
- JSONB field is empty for dedicated table rows → all date-range filters silently return zero results

**Why:** Dedicated tables use `created_at` as the timestamp column; `created_date` is the SDK-level alias that is synthesized on the way OUT (e.g. `merged.created_date = row.created_at`). The sort path already remaps it (`if (sortCol === 'created_date') orderCol = 'created_at'`) but the WHERE clause builder did not.

**How to apply:**
- Fix is in `buildDedicatedFilterWhere` in `vite-db-plugin.js` AND `db/prod-db.cjs` (both must stay in lockstep).
- Pattern: `const normalizedKey = (key === 'created_date' && tableColumns && tableColumns.has('created_at')) ? 'created_at' : key;`
- Use `normalizedKey` for `isDirectCol`, `colRef`, and all direct-column SQL fragments (`"${normalizedKey}" >= $N`).
- Applies to all dedicated tables: leads, customers, communications, payments, invoices, projects, tasks, calendar_events, estimates, etc.

## Related
- invoice `issue_date` is TEXT (not TIMESTAMP) — use `SUBSTRING(issue_date, 1, 10)` with `YYYY-MM-DD` params in raw SQL to avoid lexicographic boundary bugs where `'2026-07-01' < '2026-07-01T00:00:00.000Z'`.
- communications has no dedicated `assigned_to` column; must use `data->>'assigned_to' AS assigned_to` in raw SQL.
