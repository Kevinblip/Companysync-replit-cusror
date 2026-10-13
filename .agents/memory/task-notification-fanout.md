---
name: Task notification fan-out
description: Durable guidance for preventing repeated task and overdue-action-item email/SMS alerts.
---

Task-related alerts can be emitted by several independent paths: browser mutation handlers, automatic workflow triggers, universal notification dispatch, and scheduled overdue-item escalation. Treat those paths as separate senders and explicitly choose one owner for each event; do not assume a single UI action implies a single delivery attempt.

**Why:** A single task event previously combined manual email, an explicit workflow trigger, an automatic mutation trigger, and a dispatcher. Separately, the overdue-action cron sent one email and SMS per critical item, so a backlog became a burst of messages.

**How to apply:** Keep built-in task assignment delivery in one idempotent dispatcher, let configured workflows run through the server mutation path only, and aggregate overdue external alerts into one digest per recipient with a cooldown. Preserve item-level in-app history separately.

External-delivery claims must commit before contacting providers, independently of a reminder's schedule-update transaction. An accepted send must not become eligible again if schedule advancement rolls back.

**Why:** A database rollback can undo an uncommitted claim but cannot undo an email/SMS already accepted by a provider.

**How to apply:** Keep the atomic per-recipient claim durable before sending; advance recurring schedules separately and let replay detect existing claims. Do not automatically retry uncertain provider acceptance.