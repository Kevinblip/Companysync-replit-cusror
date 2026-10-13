---
name: Lexi reminder availability
description: Distinguishes non-blocking reminders from calendar bookings in Lexi scheduling.
---

When a user asks Lexi to set a reminder, the calendar event must use the `reminder` type and must not be blocked by an overlapping scheduled event. Conflict checks remain required for actual meetings, appointments, calls, and inspections.

**Why:** A reminder can be useful during an occupied time. Treating it as a one-hour booking makes a simple alert fail unexpectedly and leads the model to retry a conflict instead of confirming the reminder.

**How to apply:** Keep the tool contract, system prompts, and every scheduling execution path aligned. A calendar event is conflict-exempt only when its explicit type is `reminder`; do not weaken double-booking protection for other event types.