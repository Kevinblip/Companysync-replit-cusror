---
name: calendar_events status column
description: Why calendar_events must carry status/google_event_id and how the dev vs prod schema files differ in migration ordering.
---

The `calendar_events` table is written/read with a `status` column (and
`google_event_id`) by Lexi's create_calendar_event path, the inspection
scheduler, get_calendar_events, and the Google calendar sync. If the column is
absent, INSERTs that name `status` throw "missing status column" and the AI
assistant silently fails to create events.

**Rule:** any column the calendar code reads/writes must exist in BOTH schema
sources, which are NOT shared:
- `db/schema.js` — dev DB bootstrap.
- `db/prod-db.cjs` — production DB bootstrap.

**Migration ordering gotcha (dev only):** in `db/schema.js` the whole init is
one big multi-statement query, and `CREATE TABLE calendar_events` sits ~160
lines BELOW the early `ALTER TABLE customers ...` block. An `ALTER TABLE
calendar_events` placed in that early block runs before the table exists and
aborts bootstrap on a fresh DB with "relation does not exist". Put
calendar_events ALTERs immediately AFTER its CREATE TABLE.
**Why:** statements in a single query execute top-to-bottom; a failure aborts
the entire init query.
**How to apply:** in prod-db.cjs the ALTERs live in a separate try/catch
p.query() that runs after all CREATEs, so order there is already safe — just
match column definitions.

**Date handling rule for Lexi create_calendar_event:** `calendar_events.start_time`/
`end_time` are `TIMESTAMP` (no timezone). Pass the model's ORIGINAL date string
straight into the INSERT — do NOT run it through `new Date().toISOString()` first.
toISOString() coerces to UTC, and storing UTC into a tz-naive TIMESTAMP shifts the
wall-clock hour by the offset (e.g. a `-04:00` input lands 4h off). Use `new Date()`
ONLY to validate (return a friendly error on NaN) and to compute the +1h default
end_time when none is supplied.
**Why:** an earlier "harden the date" change normalized to ISO and silently shifted
event times; architect flagged it.
**How to apply:** four parallel handlers must stay in lockstep — text path
db/prod-integrations.cjs & vite-functions-plugin.js; voice path prod-server.cjs &
vite-lexi-native-plugin.js.
