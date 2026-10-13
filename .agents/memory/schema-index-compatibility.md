---
name: Schema index compatibility
description: Startup schema initialization must upgrade legacy tables before creating indexes that reference newer columns.
---

When a table already exists, `CREATE TABLE IF NOT EXISTS` does not add columns
introduced by a newer schema. Add those columns with idempotent `ALTER TABLE ...
ADD COLUMN IF NOT EXISTS` statements before creating indexes that reference
them, in both development and production schema paths.

**Why:** an index on a missing newer column aborts the full initialization
batch. The web server may still open its port, but the database-ready flag never
turns on, so every entity API returns 503 and unrelated UI such as onboarding
and role-gated navigation appears broken.

**How to apply:** whenever an existing table gains an indexed column, place its
compatibility `ALTER TABLE` before the index statement and verify a restart
reaches the explicit database-ready log message.
