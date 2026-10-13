---
name: Development cron delivery
description: Keeps preview schedules from sending real customer/staff communications.
---

Development cron jobs must not deliver real email or SMS. Production is the only environment that should run scheduled external delivery; tests exercise shared delivery code with explicit mock senders.

**Why:** Development and production have separate settings and notified-event state. A preview cron can therefore send a second real batch with a different threshold or dedup history, even while production is correctly configured.

**How to apply:** When adding a scheduled sender, make the development handler explicitly skip external delivery. Preserve deterministic, mock-driven coverage for the common engine rather than using real recipients as test fixtures.