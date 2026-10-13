---
name: Google Calendar sync semantics
description: Invariants for the two-way Google Calendar sync (pull/push, echo suppression, locking, retry) — read before touching syncUserGoogleCalendar or its cron.
---

# Google Calendar sync semantics

**The rule:** the CS→Google push must never PUT an event that CS didn't actually change, and a failed push must self-heal on the next run.

**Why:** Google's events PUT is a *full replace*. The pushed body contains only summary/description/location/start/end with empty reminders, so an "echo" push of a Google-originated event strips its attendees, reminders, and Meet links. A 15-minute server cron (bulkSyncAllCalendars) made this run 24/7, amplifying what used to only happen while the Calendar page was open.

**How to apply (invariants that must hold together):**
- Pull phase stores **Google's own `updated` timestamp** as the CS row's `updated_at` (not NOW()), so pulled rows read as "unchanged since last sync" on future runs.
- Push skips a row when it was touched FROM Google this run (in-memory set) OR `updated_at <= users.last_google_sync`.
- `last_google_sync` is stamped with the sync **start** time (captured at run start, written at run end) — otherwise a CS edit made mid-sync lands before the stamp and is skipped forever.
- Any **failed** PUT/POST must dirty-mark the row (`updated_at = NOW()`) or the skip rule permanently drops that push after one transient Google error.
- Token refresh needs its own per-user advisory lock before the sync lock, must persist a rotated refresh token, and must not clear credentials for `invalid_client` configuration errors.
- Concurrency: three triggers overlap (client auto-sync every 5 min while Calendar page mounted, manual Sync Now, 15-min server cron). A per-user `pg_try_advisory_lock(hashtext('gcal_sync:'+email))` on a dedicated client (try/finally unlock+release) serializes them; losers return `{skipped:true}`.
- Belt-and-braces: partial unique index on `google_event_id` (in BOTH dev and prod schema init) + `ON CONFLICT ... DO NOTHING` on the pull insert. The index creation is preceded by a deterministic dedupe DELETE (keep newest) — schema init aborts the whole server start on failure, so a unique index over possibly-dirty data must always self-heal first.
- The cron must exist in BOTH vite-cron-plugin.js (dev CRON_JOBS) and prod-server.cjs (setInterval with reentrancy guard) — standard dev/prod cron mirroring.
- Deleting a whole RECURRING series in Google does NOT return its instances as status 'cancelled' (that only happens for individual deletions) — instances just vanish from the listing. Deletion propagation therefore needs an orphan sweep: delete CS rows whose google_event_id is absent from a COMPLETE (all pages fetched, non-empty) listing, run BEFORE the push phase so the PUT-404-recreate path can't resurrect them. Listing must paginate via nextPageToken — maxResults caps one page at 250.

Known accepted edges: a Google edit landing between sync start and the fetch echoes exactly once then converges; `fromGoogleCreated` counts ON CONFLICT no-ops (cosmetic).
