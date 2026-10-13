---
name: Bell notifications live in generic_entities
description: There is no `notifications` table; raw INSERTs against one are silently dead code. Write entity_type 'Notification' rows into generic_entities instead.
---

# Bell notifications live in `generic_entities`

There is **no `notifications` table** in this database. The in-app bell reads
`base44.entities.Notification`, which resolves to `generic_entities` rows with
`entity_type = 'Notification'` and the payload in `data` JSONB.

Shape the bell actually renders (all inside `data`):
`user_email`, `title`, `message`, `type`, `link_url`, `is_read` (+ `read_at` once read).
A row with **no** `user_email` is treated as company-wide and shown to everyone.
The bell query filters by `company_id`, so a row without one is invisible.

**Why:** server code contains several `INSERT INTO notifications (...)` statements.
Every one of them throws `relation "notifications" does not exist`, and every one is
wrapped in a try/catch that only logs — so they are silently dead. Copying that
pattern looks correct in review and in passing tests, and produces no bell entry.

**How to apply:** when adding a server-side bell notification, insert into
`generic_entities`, not `notifications`. `generic_entities.id` has no DB default, so
pass an explicit id, and `ON CONFLICT` must name `(id, entity_type)`. If a test
asserts an alert was created, query `generic_entities` with
`data->>'type' = '<your type>'` — a query against `notifications` fails outright
rather than returning 0, which is at least a loud failure.
