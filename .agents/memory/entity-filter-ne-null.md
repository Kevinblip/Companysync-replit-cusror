---
name: Entity filter $ne excludes NULL rows
description: The MongoDB-style { field: { $ne: x } } filter excludes NULL-valued rows in the local Postgres layer but matches them in Base44/Mongo.
---

# `$ne` in the entity filter layer drops NULL rows (Postgres only)

The entity API filter translation converts `{ field: { $ne: 'x' } }` to SQL
`field != $n`. In Postgres, `NULL != 'x'` evaluates to NULL (not TRUE), so **every
row whose column IS NULL is silently excluded**. In real Base44/Mongo the same
`$ne` *matches* null/missing values — so behavior diverges by environment.

**Why:** This bit the appointment-reminder cron: it fetched
`CalendarEvent.filter({ status: { $ne: 'cancelled' } })`, which dropped all
legacy/manual events created with no status — exactly the ones that still need
reminders. The fix was to remove the status filter from the query and apply a
post-fetch status DENYLIST instead.

**How to apply:** When you want "everything except value X" and NULL should be
included, do NOT use `$ne` against a sometimes-null column. Either omit the filter
and screen in JS, or build a NULL-safe SQL condition (`field IS NULL OR field != x`).
Only `$ne: null` is special-cased (it maps to `IS NOT NULL`). Translation lives in
`vite-db-plugin.js` (dev) and `db/prod-db.cjs` (prod).
