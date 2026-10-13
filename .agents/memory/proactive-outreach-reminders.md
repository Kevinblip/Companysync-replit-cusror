---
name: Proactive outreach / build reminders
description: How the build/install + appointment reminder outreach is wired and the non-obvious rules it must uphold.
---

# Proactive customer outreach (build/install + appointment reminders)

All proactive customer outreach is TEXT by default. An AI voice call is opt-in
per reminder type (SarahSettings `appointment_reminder_ai_call_enabled` /
`build_reminder_ai_call_enabled`) and falls back to text if the call can't be
placed. Text is the safe default; keep it that way unless the owner asks.

## Non-obvious rules (durable)
- **One shared send path.** Every proactive customer reminder (build AND
  appointment) must go through the single `sendCustomerReminder` handler. Do NOT
  add a second send path or call `sendSMS` / the voice bridge directly for
  reminders. **Why:** the guardrails (valid phone, STOP opt-out, business hours,
  AI-id line) live in that one place so nothing can skip them.
- **Build reminders are approval-gated, appointment reminders are automatic.**
  `scanBuildReminders` NEVER sends — it only drafts a `pending_build_reminder`
  ActionItem; the only build send path is the Approve button in ActionItems.jsx.
  `checkReminders` (appointments) sends automatically. **Why:** the owner (Kevin)
  wants a human to sign off on every build message.
- **Business hours: enforced for automated sends, bypassed for approved ones.**
  The shared sender gates on the company timezone + window; a human-approved
  build send passes `force: true` to bypass it (a soft `window.confirm` still
  warns at approval time). Automated appointment sends pass `force: false`.
- **Only mark "sent" on real success.** Callers read the sender's
  `{ success, skipped }` result and only stamp their sent-flag when it actually
  went out, so a business-hours deferral retries on the next run instead of being
  silently lost.
- **The AI must self-identify in EVERY customer message.** The identity line is
  prepended at draft time, re-prepended by the sender, and re-prepended at
  approval time (the approver can edit the Textarea and delete it). Never rely on
  the draft alone.
- **STOP/opt-out** = customer inbound history lookup + Twilio carrier level.
  There is still no app-level opt-out registry; a failed lookup must not block.

## Where it lives
- Settings card + toggles: `src/pages/SarahSettings.jsx` (AssistantSettings entity).
- `sendCustomerReminder`, `checkReminders`, `scanBuildReminders`:
  `vite-functions-plugin.js` (shared `functionHandlers`, serves dev+prod — do NOT
  mirror the handler).
- Cron registration IS mirrored: `vite-cron-plugin.js` (dev) + `prod-server.cjs` (prod).
- Approval UI + mutations: `src/pages/ActionItems.jsx` (`pending_build_reminder`).
