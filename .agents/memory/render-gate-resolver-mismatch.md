---
name: Render gate must use the send handler's resolver
description: Why a "can we contact this person" button gate has to call the same resolution function the action uses, or the fallback becomes unreachable dead code.
---

# Render gate must use the same resolver as the action

When an action handler resolves a value through an ordered fallthrough (phone
number from the document snapshot → linked customer → originating lead), the
button that triggers it must decide its own visibility by calling that **same**
resolver, not by testing the first candidate.

**Why:** gating a "Text" button on `document.customer_phone` while the handler
falls back to the linked customer or lead hides the button for exactly the
records the fallback was written to rescue. The fallback code is present, tested,
and permanently unreachable — nothing errors, so it looks shipped. This shipped
here once already for estimate/invoice texting, and the same shape exists
anywhere a list row decides whether to offer email/call/text.

**How to apply:** export a `has<Thing>` predicate next to the resolver
(`hasTextablePhone` beside `resolveSmsPhone` in `src/utils/documentSms.js`) and
use it in the JSX gate and the `disabled`/`title` props. When the last fallback
in the chain requires an async lookup (fetching the lead by `lead_id`), let the
gate treat the *possibility* as enough — show the control and have the handler
report a clear failure — rather than hiding it.

Related trap: document "snapshot" columns (`customer_phone`, `customer_email`)
are frequently blank on older rows even when the linked contact has the value,
so a snapshot-only gate degrades quietly over time.
