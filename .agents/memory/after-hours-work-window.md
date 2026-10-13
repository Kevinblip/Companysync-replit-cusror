---
name: After-hours / work-hours window for AI receptionist
description: How Alex (Sarah) decides a staff member is "off hours", where the logic lives, and its built-in limitations (server-local time, no overnight windows).
---

# After-hours work-window gating (prod-server.cjs)

## Single source of truth
`isOutsideWorkHours(scheduleData, now = new Date())` returns true ONLY when `after_hours_enabled` + `after_hours_start` + `after_hours_end` are all set AND `now` falls outside the window `[start, end)`. Returns false for null/partial schedules (so unconfigured staff keep prior behavior).

Used at THREE call sites that must stay in lockstep via this helper (do not re-inline the minutes math):
1. Call start, cached subscriber path.
2. Call start, DB staff path.
3. Mid-call transfer gate (added in Task #628) — even when a person is marked "available", a transfer is blocked if they're outside their hours.

## Where the schedule data lives
`after_hours_*` fields live in `staff_profiles.data` (JSONB) and are mirrored into `subscriberCache` entries as `entry.data`. The transfer gate reads cache `entry.data` first, then falls back to a `staff_profiles` SELECT that must include the `data` column.

## What blocking does
Off-hours (and the manual "unavailable" flag) make Alex take a message instead of transferring: apologize, collect name + callback number + reason, promise a callback. Same response shape pushed into the voice function-call `responses` array, then `continue`.

## Timezone handling (fixed)
`isOutsideWorkHours(scheduleData, now, timezone)` now accepts a third `timezone` argument (IANA string, default `'America/New_York'`). It converts `now` to the company's local wall-clock time via `Intl.DateTimeFormat` with `hourCycle: 'h23'`. Falls back to server local time if the timezone string is invalid.

All three call sites now:
1. **Cached path** — fetches `companies.data->>'timezone'` for `cached.companyId` before calling `isOutsideWorkHours`.
2. **DB path** — same, using `resolvedCompanyId`.
3. **Mid-call transfer** — uses `callCompanyTimezone` (WS-handler-level variable), set from `crm.timezone` in the `settingsApplied` block.

## Overnight windows (fixed)
When `startMins > endMins` (e.g. 22:00–06:00): inside = at/after start OR before end; outside = `currentMins >= endMins && currentMins < startMins`. Degenerate case `start === end` returns false (always available).

## Still open
Staff members don't have their own timezone field — the company timezone is used for all staff. A future task could add `after_hours_timezone` to `staff_profiles.data` and pass it as the timezone arg (the function already accepts it).
