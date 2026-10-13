---
name: Lexi chat and access lessons
description: Index of chat reply reliability, greeting cadence, caller data access, and grounded answers.
---

- [Greeting cadence and reminders](lexi-daily-greeting-cadence.md) — once per local day; non-blocking personal reminders; also see [reminder availability](lexi-reminder-availability.md).
- [Chat reply handling](lexi-composer-lock-recovery.md) — unlock on every send exit; never turn an empty post-tool reply into a greeting; see [tool-result fallback](lexi-tool-result-fallback.md).
- [Rep data access](lexi-rep-data-access.md) — non-admin reads are server-scoped to caller-owned work, never prompt-authorized.
- [Production schema portability](lexi-production-schema-portability.md) — ownership SQL must use production-supported columns.
- [Answer grounding](lexi-answer-grounding.md) — facts require a same-turn tool read; see [tool-failure fallback](lexi-tool-failure-fallback.md).
