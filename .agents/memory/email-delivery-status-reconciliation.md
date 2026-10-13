---
name: Email delivery-status reconciliation
description: How asynchronous provider delivery/bounce events are matched back to a communications row, and the traps that make the result wrong.
---

# Email delivery-status reconciliation

Provider acceptance and inbox delivery are two different facts. A send handler
can only ever record the first one; the second arrives later, asynchronously,
through the provider's delivery webhook. Treat them as separate states
(`submitted` → `delivered` / `bounced` / `complained` / `failed`), never as one
"sent" boolean.

**Why:** staff read "sent" as "arrived". When a message actually bounced or was
filtered, that misreading costs a real customer conversation, and nobody goes
looking because the UI already claimed success.

## Rules

1. **Carry two join keys, and mint one of them yourself.** The webhook has no
   session, company, or tenant context, so a callback can only be matched by an
   identifier that is already on the record. The provider's message id exists
   only *after* acceptance, so every write of it can fail with the mail already
   gone; an id you generate and persist *before* sending, and that the provider
   echoes back (metadata, message tags, or a custom header), is the only key
   that survives a database outage spanning the whole send. Match on either,
   index both, and scope the match to the channel — an SMS provider id can
   otherwise collide with an email one.

2. **Rank the outcomes and never downgrade.** Provider webhooks are
   at-least-once and can arrive out of order, so a late "delivered" retry can
   land after a bounce. Enforce the ranking (submitted < delivered < complained
   < bounced/failed) in the UPDATE's WHERE clause, not in application code, so
   a stale event cannot erase a worse, newer truth.

3. **A delivery confirmation is not a reputation signal.** Only bounces and
   complaints may reach the sending circuit breaker. Feeding it deliveries
   pollutes the failure accounting it uses to pause outbound mail.

4. **An outcome has exactly one delivery, so acknowledge only what is stored.**
   Persist each event before returning 2xx, and apply it afterwards. If it
   cannot be stored, refuse the request so the provider redelivers — swallowing
   the error and answering 200 destroys the only copy of a bounce that will
   ever exist. Because refusal means redelivery, the ledger row must be keyed
   deterministically so a retried event is counted against reputation once.

5. **The callback can beat your own send handler.** An event whose message id
   matches nothing is normal, not garbage: keep it pending and re-apply it when
   the send records its id, and again on later batches. An unapplied event that
   is merely logged is an outcome silently lost.

6. **Retry budgets must count failures, not waiting.** "No row carries this id
   yet" is the expected early state, so if a shared sweep spends budget on it,
   unrelated traffic retires an event before it was ever applicable. Spend
   budget only on genuine apply errors, and exempt the targeted replay from the
   budget entirely — it runs precisely because the record just appeared.

7. **Recovery needs its own clock.** Draining only when the next callback
   arrives ties recovery to traffic that may never come. Anything acknowledged
   but unapplied needs a scheduled sweep (in every environment's scheduler),
   plus retention, or the ledger becomes an unbounded graveyard.

8. **A bounded sweep over rows that do not change starves.** Waiting rows are
   identical from one pass to the next, so `ORDER BY created_at LIMIT n` reads
   the same first page forever and never reaches anything behind it. Order by
   *when each row was last examined* so every pass advances, and retire rows
   that can no longer change anything (an outcome the rank guard will always
   reject) instead of letting them circulate. A test whose fake database
   ignores LIMIT cannot see any of this.

9. **Distinguish "not yet" from "never again".** Zero rows updated has two
   opposite meanings — the record does not exist yet, or it exists and already
   holds a better outcome. Probe for the record to tell them apart; collapsing
   them either retires an event too early or keeps a dead one forever.

10. **Every sender must persist the id, not just the one you built the feature
    for.** The message id is the only join key, so any code path that records an
    outbound email and discards its transport result leaves that record frozen
    at acceptance forever. Audit all senders, not the headline one.

11. **Every writer of "accepted" must be monotonic, not just the repair path.**
    Acceptance is the weakest thing you can know and it is written last, after
    a network round trip during which the real outcome can already have landed
    (a pre-send correlation id makes that race routine rather than rare). Once
    the outcome is applied its ledger event is retired, so a finalizer that
    blindly writes "submitted" destroys it with nothing left to replay. Route
    every finalizer — success, failure, and repair — through one guarded
    statement that always writes identifiers but applies the acceptance state
    only while nothing better is recorded. Decide it inside the statement, and
    merge rather than replace, or the pre-send correlation id is wiped too.

12. **A new identifier is worthless until every wrapper forwards it, in the
    field that provider actually echoes.** Send paths accumulate layers
    (per-tenant SMTP overrides, provider-selection wrappers), and each one that
    drops the field silently disables recovery for everything behind it. Worse,
    an outbound custom header is NOT generally echoed on the callback: each
    provider has its own round-trip channel (Postmark metadata, SES message
    tags, Resend tags — sent as a name/value array, returned as a map). Check
    the provider's own webhook payload documentation and fixture the tests from
    it; a self-invented payload will happily prove a correlation that real mail
    never carries.

13. **The association itself must be recoverable.** Writing that id back can
    fail after the provider already accepted the mail — which must not be
    reported as a failed send (it would invite a duplicate), but also cannot be
    logged and forgotten: the record is then permanently unreconcilable while
    its bounce sits safely on the ledger. Queue the association for repair and
    drain it on the same schedule, before draining the events themselves.

**How to apply:** any time an outbound channel gains asynchronous provider
callbacks (email today, but the same shape applies to SMS status callbacks).

## Sender verification

Authenticating a sending credential does not prove a message is traceable. A
token can be valid for sending while unable to read message history, or the
configured From can be silently rewritten to a verified address — in both cases
an accepted message ends up in an account or under an address nobody thinks to
query. Verify sending and delivery-lookup access **with the same credential**,
and report the effective sender, not the configured one.

**Bind the evidence to the thing you actually send through.** Providers split
these reads across differently-scoped credentials, and the credentials are
configured independently — so the token that lists verified senders may belong
to a different account than the token that sends. Prove the two belong together
(find the live sending server in that account's own server list) before
believing a word of the evidence, and otherwise report unconfirmed. Evidence
from the wrong account is not weaker proof, it is the same false assurance in
provider clothing.

**"Verified" must come from the provider.** A locally configured list of
verified domains is a deployment setting, not evidence: it keeps returning
"verified" for a token pointed at an account that has never heard of the
sender, which is exactly the failure this check exists to catch. Sender
verification is three-valued — verified, provider says no, and *cannot tell* —
and the third must be reported as unconfirmed rather than rounded up. Note that
provider APIs often split this across scopes: on Postmark, sender signatures
and domains need the account token, while a server token can only prove the
address by finding real messages already sent from it.
