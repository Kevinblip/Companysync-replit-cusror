# Proactive Customer Outreach (Build/Install + Appointment Reminders)

The AI assistant (Sarah/Alex) can proactively reach out to customers about
upcoming work. Outreach is **TEXT by default**. An **AI voice call** is only
placed when the owner opts in per-reminder-type; if a call can't be placed it
**falls back to text**. Every automated message identifies itself as coming from
an AI.

## The shared sender — `sendCustomerReminder` (vite-functions-plugin.js)
All proactive customer outreach (build **and** appointment) goes through this one
`functionHandlers` method, so no caller can accidentally skip a guardrail. It is
defined once and therefore serves dev and prod identically (prod reaches it via
`prod-integrations` `getFunctionHandlers`; do not mirror it). In order, it:

1. **Requires a valid phone** — normalizes to a 10-digit US number, skips
   otherwise (`skipped: 'invalid_phone'`).
2. **Honors STOP / opt-out** — best-effort lookup of the customer's own inbound
   STOP-style message in `Communication` history; Twilio also enforces this at
   the carrier level (`skipped: 'opted_out'`). A failed lookup never blocks.
3. **Respects business hours** — unless the caller passes `force: true` (a human
   just approved the send). Uses the company timezone + configured window
   (`skipped: 'business_hours'`).
4. **Prepends the AI-identification line** (idempotent — won't double-add).
5. **Delivers**: `channel: 'call'` places an AI voice call via `sarahBridgeAPI`
   `initiateOutboundCall` and falls back to `sendSMS` if the call fails;
   otherwise it sends a text. For a reminder call the drafted message is promoted
   to the campaign `intro` (with the AI-id text) so the voice bridge — which only
   speaks the custom greeting/AI-id when `outboundCampaign.intro` is present in
   both dev and prod — actually says the reminder wording, not just a generic
   opener.

Note on business hours: the gate checks the **time-of-day window only**; it does
NOT block weekends, because a reminder is tied to a specific scheduled event (a
Saturday appointment must still get its Saturday reminder) and roofing crews
commonly work weekends.

Returns `{ success, channel, skipped?, ... }`. Callers only mark a reminder as
"sent" when `success` is true, so a business-hours deferral retries next run.

## Settings — `src/pages/SarahSettings.jsx`
A "Proactive Outreach" card persists these fields onto the `AssistantSettings`
entity (per company):

- `ai_identification_line` — the mandatory AI-identity line; supports
  `{assistant}` and `{company}` tokens.
- `appointment_reminders_customer_enabled` — gates the customer-facing
  appointment reminder path in `checkReminders` (default on).
- `appointment_reminder_ai_call_enabled` — when on, appointment reminders are
  placed as an AI voice call instead of a text (sub-toggle, default **off**).
- `build_reminders_enabled` — master switch for build/install reminder drafts.
- `build_reminder_days_before` — how many days ahead of a build to draft.
- `build_reminder_template` — message body; supports `{customer_name}`,
  `{company}`, `{address}`, `{build_date}` tokens.
- `build_reminder_ai_call_enabled` — when on, an approved build reminder is
  placed as an AI voice call instead of a text (default **off**).

Text is the safe default; the AI-call toggles are opt-in.

## Appointment reminders — `checkReminders` (vite-functions-plugin.js)
- Skips build-type calendar events on the customer path (builds go through the
  approval-gated flow instead).
- Honors `appointment_reminders_customer_enabled`.
- Loads `AssistantSettings` per event's company (cached), picks the channel from
  `appointment_reminder_ai_call_enabled`, and routes through
  `sendCustomerReminder` with `force: false` (so business hours are respected)
  and the company timezone + scheduling business-hours window.
- Only stamps `reminders_sent_customer_sms` when the send actually succeeds.

## Build reminders — `scanBuildReminders` (vite-functions-plugin.js)
Hourly cron (registered in **both** `vite-cron-plugin.js` for dev and
`prod-server.cjs` for prod — the handlers themselves are served from the shared
`functionHandlers` object so they are not mirrored). For each company with
`build_reminders_enabled`:

1. Find `BuildSchedule` entities with `build_date` in `[today, today+daysBefore]`.
2. **Guardrail:** skip builds without a valid phone (≥10 digits).
3. Dedup against any open `pending_build_reminder` ActionItem for the build.
4. **Idempotency:** skip if the build's `reminder_queued_for_date` already equals
   its `build_date`; otherwise stamp it after drafting.
5. Create a `pending_build_reminder` ActionItem holding a `proposed_reminder`
   (`message` with the AI line already prepended, `ai_line`, `customer_phone`,
   `channel` from `build_reminder_ai_call_enabled`, `timezone`,
   `business_hours_start/end`, `build_date`).

**The scan never sends anything** — it only drafts an approval item.

## Approval — `src/pages/ActionItems.jsx`
`pending_build_reminder` items render an editable message box plus Approve/Skip:

- **Approve & Send:** soft business-hours confirm (warns if outside the
  customer's local window, still allows), re-checks the item/build hasn't already
  been handled (guards the read-then-send race), re-prepends the AI line if the
  approver deleted it, then invokes `sendCustomerReminder` with `force: true`
  (human-approved) and the drafted `channel`. On success it stamps the build
  `reminder_sent_for_date` and completes the item; on a skip/failure it surfaces
  the reason and does not complete.
- **Skip:** dismisses the item and stamps `reminder_skipped_for_date`; nothing is
  sent.

## Guardrails summary (all centralized in `sendCustomerReminder`)
- Valid-phone-only (also pre-checked in the build scan).
- Business hours — enforced for automated sends; bypassed only for
  human-approved build reminders (soft-confirmed at approval time).
- STOP/opt-out — customer inbound history + Twilio carrier level.
- Human approval required for every build reminder.
- AI self-identification enforced on every message.
- AI voice call is opt-in per reminder type; text is the default and the
  fallback.
