---
name: Voice assistant duplicate tool calls
description: Gemini Live re-issues the same phone-assistant tool call many times per turn; how the bridges dedupe it without suppressing genuine repeats.
---

Gemini Live routinely re-issues the SAME logical tool call many times inside a
single turn, **re-wording the free-text arguments each time**. One simulated
emergency call fired 19 `send_alert`s and produced 19 staff notifications.

**Why naive fixes fail:**
- Keying dedupe on raw argument JSON misses them, because the wording differs.
- Deduping a lead save on phone number alone misses them, because the assistant
  saves details *progressively* and the early saves have no phone yet — each one
  inserted a fresh duplicate lead.
- Caching the promise "until it rejects" does nothing: these handlers RESOLVE
  with `{success:false}` / `{error}` shapes instead of rejecting, so a failure
  gets cached and blocks the retry that would have worked.
- Tool calls in one response run under `Promise.all`, so a read-then-insert
  dedupe races against itself and still writes duplicates.

**The rules that hold:**
- Notification-style tools (`send_alert`, `notify_rep`) dedupe on the fields
  identifying *who/what* the request concerns, never the message text.
- Booking tools (`schedule_inspection`, `book_appointment`) must keep
  exact-argument keying. Callers genuinely change the time mid-call ("tomorrow
  10am" → "Thursday afternoon"); collapsing those books the WRONG slot.
- Give the cache a short TTL (~60s), not call lifetime, or a real escalation
  later in the same call is silently swallowed.
- Evict resolved-failure results, not just rejections.
- Serialize per-call lead saves so the dedupe lookup can see the row a
  concurrent save just created.
- If every identifying field is blank, fall back to wording rather than
  collapsing unrelated alerts together.

**Why:** staff receive real SMS/notifications per alert, and duplicate leads
corrupt the CRM. The failure is invisible in the transcript — the assistant
sounds perfectly normal while writing the same record five times.

**How to apply:** shared logic lives in `lib/toolDedupe.cjs`, required by BOTH
`vite-twilio-ws-plugin.js` (dev) and `prod-server.cjs` (prod) so the two bridges
cannot drift. Verify fixes by counting DB rows after a call, never by reading
the transcript.
