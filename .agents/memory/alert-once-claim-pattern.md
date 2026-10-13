---
name: Alert-once claim column pattern
description: How to make a "detected a bad state, alert the user exactly once" path idempotent when a cron re-enters it, without permanently silencing future alerts.
---

# Alert-once claim column pattern

Used for the Google Calendar disconnect alert, and applicable to any
detector that a cron re-enters on every tick (integration revoked, token
expired, webhook broken). The state transition itself must stay unconditional;
only the *alert* is claimed.

**The pattern:** a nullable `*_alerted_at TIMESTAMPTZ` column on the affected row.

1. **Claim and transition in ONE transaction, under `SELECT ... FOR UPDATE`.**
   Read the old gate value, then `UPDATE ... SET <transition>,
   gate = COALESCE(gate, NOW())`. You alerted iff the old value was NULL.
2. **Reset the gate to NULL on every recovery path** (each OAuth callback, the
   manual disconnect handler, dev *and* prod copies) or the second incident is
   never announced.
3. **Release the claim if no channel delivered.** Winning the claim reserves the
   right to alert; it is not proof of alerting. Only release when *every* channel
   failed, so a partial success can't produce duplicates.
4. **Separate durable event/bell creation from external delivery state.** If the
   event must remain recorded even when email fails, retain the event claim but
   track email attempts and successful recipients separately. Retry undelivered
   recipients after a cooldown; never treat the event claim as proof of delivery.
5. **Compare the full failed credential snapshot when tokens can be retained.**
   Some providers may issue a new access token during reconnect while retaining
   the same refresh token. A refresh-token-only CAS can therefore erase a fresh
   reconnect; compare both the access and refresh token that belonged to the
   failed sync.

**Why:** doing the transition and the claim as two autocommitted statements
leaves a window where a recovery can interleave — recovery nulls the gate, then
the stale detector stamps it. The row now reads "connected" with a non-NULL gate,
and the user's next real incident is silently un-alertable, forever. This is the
exact failure the feature exists to prevent, so it fails closed in the worst
possible way and no smoke test catches it. Likewise, claiming a durable alert
before contacting email and then swallowing transport errors permanently loses
the real email unless delivery has its own retryable state.

**How to apply:** any time you add "only notify once" logic, check whether the
recovery path and the detector can run concurrently. If they touch the same row,
they need the row lock. Also note this is the same trap as trial-nurture
idempotency — never mark a touch "sent" before a send actually succeeded. For
OAuth cleanup, identify every credential a reconnect can change and require the
stored snapshot to match all of them before clearing anything.
