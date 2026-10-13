---
name: generic_entities id has no DB default
description: Every INSERT INTO generic_entities must explicitly supply id, or it fails a NOT NULL constraint
---

The `generic_entities` table has no database-level default (no `gen_random_uuid()` etc.) for its `id` primary key column. Any raw SQL `INSERT INTO generic_entities (...)` that omits `id` from the column list fails at insert time with `null value in column "id" of relation "generic_entities" violates not-null constraint`.

**Why:** This is easy to miss because many other tables in the app do have server-generated ids, and because the failure only surfaces at runtime (no compile-time or schema-level warning) — it silently breaks the first write path through a brand-new handler.

**How to apply:** When adding a new backend handler (in `vite-functions-plugin.js` or elsewhere) that inserts into `generic_entities`, always generate the id explicitly with `crypto.randomUUID()` (already imported at the top of `vite-functions-plugin.js`) and pass it as the first bound parameter, matching the pattern used by existing inserts (e.g. Lead, AIMemory, IntegrationLog inserts in that file).

**Also:** the `id` column is NOT NULL but has **no unique/PK constraint**, so `INSERT ... ON CONFLICT (id) DO ...` fails with `there is no unique or exclusion constraint matching the ON CONFLICT specification`. Use a bare `INSERT` (or `ON CONFLICT DO NOTHING` with no target column) — do not target `(id)` in an upsert. Dedup instead with a prior `SELECT` on `entity_type + company_id + data->>'...'`.
