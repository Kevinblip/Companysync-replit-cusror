---
name: Notification channel cost policy
description: Defines which automated notifications should use SMS versus lower-cost email and in-app delivery.
---

Routine entity updates and overdue-invoice reminders use email plus in-app notifications, not SMS. Appointment reminders use email at early intervals and may use SMS only at the one-hour interval. Keep SMS for explicit, time-sensitive paths such as high-priority tasks and appointment changes.

**Why:** The owner confirmed that routine automated SMS volume was causing frequent Twilio balance recharges and preferred email for less important updates.

**How to apply:** New automated notifications should default to email/in-app. Add SMS only when delayed awareness would create a real operational or customer problem, and keep the SMS decision visible and testable at the sender.