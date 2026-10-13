---
name: Day-cadence reminders (punch list)
description: Rules for reminders whose cadence is measured in days, and why the age clock must live on the work, not on the reminder row.
---

A recurring reminder whose cadence is measured in DAYS cannot ride the generic
overdue escalation ladder, and its age must be derived from the underlying work
rather than from the reminder record that happens to be open.

**Why:** The shared ladder is hours-based (levels at ~2h and ~6h, hourly in-app
pings, daily email/SMS). Pointing a "chase every few days" requirement at it
produces hourly nagging. Separately, if the escalation clock starts when the
reminder row was created, every event that replaces the row — a human dismissal
that later expires, a close-and-recreate, a cleanup — silently resets the clock,
so an item that has been open for weeks never escalates. That defeats the point
of a reminder that exists to stop work being forgotten.

**How to apply:** For any day-scale reminder:
- Exclude it by `type` inside the generic escalation scan, and re-arm its own
  due date each time it fires.
- Keep exactly ONE open reminder per parent job (not per sub-item) and close
  extra open rows on sight. Take the create claim under a per-entity
  `pg_advisory_xact_lock` and re-check inside the lock, or a cron pass and a
  browser save racing on the same job each create one.
- Run the escalation threshold on its own clock, evaluated on every pass, not
  only when the cadence due date has passed — with 3-day re-arms, a 7-day
  threshold checked at the due date first fires on day 9.
- Derive that clock from the source work (checklist items carry their own
  created_at) and let a replacement reminder inherit the age of a human-closed
  predecessor, so dismissing cannot postpone escalation indefinitely.
- Re-derive state from the source record every pass: auto-close when the work is
  done, re-open when it comes back, and mark auto-closes distinctly from human
  dismissals so a dismissal suppresses recreation for one interval while an
  auto-close does not.
- Honor an explicit future `snoozed_until` ahead of both clocks; a re-arm that
  ignores it silently overrides a user's week-long snooze.
