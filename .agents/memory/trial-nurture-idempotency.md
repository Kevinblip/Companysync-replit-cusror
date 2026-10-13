---
name: Trial-nurture (14-day campaign) idempotency & day-math
description: Rules for the processTrialLifecycle cron + Day-0 hook so trials never double-send, never permanently skip a touch on a transient outage, and compute the day boundary correctly.
---

# Trial-nurture idempotency & day-math

The 14-day trial-conversion campaign lives in `vite-functions-plugin.js`
(handlers there are shared to prod via dynamic import — do NOT mirror to `prod-server.cjs`).

## Only mark a touch "sent" when a send actually succeeded
- `sendTrialDayTouch` returns `{ attempted, succeeded }`.
- A touch (email/SMS) day should be recorded in `TrialNurtureLog` only when
  `attempted === 0` (nothing to send — no template/recipients) OR `succeeded > 0`.
- **Why:** a transient Resend/Twilio outage where every send fails must NOT be marked
  sent, or that company permanently skips that day. Leave the current day unsent so the
  daily cron retries it next run.
- Anti-flood exception: still mark the *older backlog* days (dueUnsent minus the current
  `dayToSend`) even on failure, so a cron that was down for a while doesn't blast every
  missed touchpoint at once. Only the single current day is retried.
- Same pattern applies in the Day-0 welcome hook (fired on trial start): only mark day0
  sent if it delivered.

## Day boundary math must be UTC
- `trial_ends_at` is stored date-only (`"YYYY-MM-DD"`), which `new Date()` parses as UTC
  midnight. Normalize both "today" and `trialEnd` with `setUTCHours(0,0,0,0)` (NOT
  `setHours`) so `daysRemaining` is stable regardless of server timezone.
