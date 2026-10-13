---
name: tasks table dedicated columns (column / board_id)
description: The tasks table stores kanban column & board_id as REAL columns, not in data JSONB — handlers scanning tasks must read the dedicated columns or they silently no-op.
---

# tasks table: `column` / `board_id` are dedicated columns

The `tasks` dedicated table has REAL columns for `board_id` and `"column"`
(reserved word — always quote it), alongside `related_to`, `customer_id`,
`customer_name`, `status`, etc. Kanban position (`column`) and `board_id` do NOT
live in `tasks.data` JSONB.

**Why:** the universal entity write path (`genericUpdate` in vite-db-plugin.js)
routes any incoming key that matches a real table column to that column, and only
spills UNMATCHED keys into `data` JSONB. Tasks.jsx drag-and-drop writes
`{ column, board_id }` top-level, so every real board move lands in the dedicated
columns. A handler that reads `data->>'column'` / `td.board_id` finds nothing and
silently skips 100% of board-managed tasks (dead code that passes naive tests).

**How to apply:** when a cron/handler scans tasks for board state, SELECT the real
columns: `SELECT ..., board_id, "column" AS board_column, data FROM tasks` and read
`t.board_column || td.column` (dedicated first, JSONB fallback). Fields with NO
matching column (e.g. `is_archived`, or a handler-private baseline key like
`progress_last_notified_column`) correctly live in `data` JSONB — and survive UI
updates because genericUpdate merges via `data = data || newJsonb`.

**Gotcha that hid this:** all 194 existing tasks are un-boarded CSV imports (empty
column/board in BOTH places), so a "0 rows have data->>'column'" probe can't tell
you where board data *would* land. Confirm via `information_schema.columns` +
the write path, not by sampling legacy rows.
