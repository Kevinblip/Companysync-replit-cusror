---
name: AI receptionist appointment approval flow
description: How an AI-booked appointment becomes a calendar event, and why reminders use a status denylist.
---

# AI receptionist appointment → approval → calendar/reminders

When the AI receptionist (Sarah/Alex) books an appointment on a call, the bridges
(`vite-twilio-ws-plugin.js` dev / `prod-server.cjs` prod, kept in lockstep) create/
update a **Lead** and a **pending ActionItem** (`type 'pending_appointment_approval'`
with a `proposed_appointment` JSON). They do **NOT** create a CalendarEvent on the
call. A human approves the ActionItem in the UI (`ActionItems.jsx` action row +
`LeadProfile.jsx` inline), which creates the real `CalendarEvent` with
`status: 'scheduled'` and completes the item.

**Why a pending step:** an AI can mis-hear; a half-booked appointment must never
trigger customer-facing reminders until a human confirms it.

**Reminder gating uses a DENYLIST, not an allowlist** (`functions/checkReminders.ts`).
It skips `pending/tentative/draft/proposed/awaiting_approval/needs_approval/cancelled/
completed` and allows everything else **including null status**. An allowlist
(scheduled/confirmed only) would break reminders for the many manual events created
with no status by Calendar/Dashboard/BookAppointment.

**How to apply:** Reminders fire on `assigned_to || created_by`, so approval must set
one of those plus `status:'scheduled'`, `start_time`, `end_time`. Approval is guarded
for idempotency (re-checks the item isn't already completed/dismissed) to avoid
double-booking from two tabs. Keep the reminder fetch status-filter-free (see
[entity-filter-ne-null](entity-filter-ne-null.md)).

The voice bridge must enforce the pre-submit flow, not rely only on prompt wording: check availability first, require an exact parseable date/time, carry the caller's phone into the lead, and serialize repeated scheduling tool calls within one call. The assistant must read back the full name, callback number, property address, date, and time before submitting; submitting creates a pending request, never a confirmed calendar event.

**Why:** Alex accepted “tomorrow morning” before collecting an exact time, did not read back the caller's details, and issued repeated scheduling calls that created duplicate leads and pending requests.

**How to apply:** Keep the tool schema, universal voice rules, and server-side handler semantics aligned in both dev and prod bridges. Reject missing/vague times instead of defaulting them to the current clock plus one day.

## Post-approval confirmation loop (SMS "YES" detection)

Approval also fires `approveAppointmentNotify` (registered ONCE in
`vite-functions-plugin.js` functionHandlers — serves dev+prod, do NOT mirror), which
stamps `calendar_events.data` with `contact_phone`/`contact_name`/`timezone`/
`awaiting_customer_confirmation`, sends the customer confirmation through the shared
guarded sender (`sendCustomerReminder`, text default / opt-in AI call), and notifies
the inspector (bell + cell SMS via `lib/appointmentNotify.cjs`).

The customer's "YES" reply is intercepted in `lib/smsAssistant.cjs`
`handleAppointmentConfirmationReply` **before** Gemini: strict affirmative regex on
short bodies + company-scoped last-10-digit phone match on
`data->>'contact_phone'` + future `start_time` + `awaiting_customer_confirmation='true'`.
It idempotently flips the flag (second "YES" is a no-op → falls through to the AI) and
notifies the inspector. **Why pre-Gemini:** the AI would otherwise answer
conversationally and never trigger the inspector alert. The SMS assistant's
`request_appointment` tool must never claim the appointment is booked — booking only
happens at human approval. Default inspector comes from
`AssistantSettings.default_inspector_email` (SarahSettings UI), falling back to the
approver.
