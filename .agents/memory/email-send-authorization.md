---
name: Email send authorization and abuse controls
description: Rules for keeping app email from being used as an open relay and from being paused by abusive traffic.
---

Every outbound send path must be authorized, tenant-scoped, rate-limited,
attributed, and gated on provider health. The threat is not a stolen API key —
the key never leaves the server. It is that an under-authorized endpoint accepts
arbitrary mail, generating bounces and complaints until the provider pauses
delivery for the whole platform.

**A missing request must never mean "trusted internal caller."** These handlers
are legitimately called two ways: over HTTP with a session, and directly by
crons, workflows and webhooks that have no request at all. Authorizing only when
a request happens to be present means any caller that forgets to forward one is
indistinguishable from trusted internal traffic — and that is reachable from the
public dispatcher. Too many genuine no-request callers exist to simply require
one, so invert the default: the dispatcher, the single place external input
enters, marks each externally invoked call, and handlers fail closed on a marked
call with no request. Keep the marker enumerable so it survives the object
spreads these handlers do.

**Why:** a dropped request should be a hard failure, not a silent bypass.

**Cross-tenant scheduled handlers must guard the default invocation, not only
test overrides.** If a generic public dispatcher can reach a sender, an empty
parameter object is still an external control surface. HTTP calls without test
overrides must prove they came from the internal scheduler (for example, with
the existing server HMAC); scoped simulated-clock calls may instead use an
authenticated administrative test path. Direct in-process calls can remain
trusted only when no HTTP request exists.

**Why:** protecting only `simulated_now` or scope parameters still leaves the
ordinary all-company scheduler callable by anyone during a live send window.

**How to apply:** regression tests must invoke the public route with default
empty parameters and assert rejection before any report/send row is created,
then separately verify the scoped administrative simulation path.

**Resolve the owner from the row, not the request.** For document email the
authoritative company is the one that owns the record. Overwrite the caller's
company id with the resolved owner — do not merge and hope the caller's value
loses, since spreading the original params reintroduces it.

**The guard and the sender must resolve the target with the SAME code.** This is
the sharpest version of the accept-every-spelling rule, and it produced a real
cross-tenant hole: the authorization step read only the camelCase document id
while the sender accepted snake_case too. An attacker authorizes against a
company they genuinely belong to, names another tenant's document in the
spelling the guard cannot see, and the send proceeds with the victim's document,
branding and recipient. Extracting a shared resolver is not enough — every
call site, in every environment, has to actually call it. Grep for the resolver
and confirm no branch still indexes the params object directly.

**Why:** a guard that answers a different question than the operation it guards
is not a guard. Environments are authorized separately, so proving it in one
proves nothing about the other; regression tests must drive each dispatcher.

**A lookup failure must fail closed.** Falling back to the caller-supplied
company when the ownership query errors lets a caller send as another tenant by
making that query fail.

**Attribution belongs on the terminal send, not the entry point.** A handler
that resolves context at the top and then has several exit branches will drift:
one branch carried it while the branch customers actually use did not, so those
sends escaped the per-company cap and stored unattributed events. Assert
attribution on the options the transport really receives, per branch.

**A refusal is a decision, not an outage.** Never fall back to an ungoverned
send helper when the guarded transport refuses. Doing so converts every control
— including the kill switch protecting a disabled path — into "send it anyway by
another route."

**Config-read failure and send failure are different.** A company-SMTP path may
fall back to the platform provider only when nothing was transmitted. Verifying
the connection separates the two; falling back after a failed send
double-delivers.

**Every sender shares the same controls.** Recipient normalization, reserved
domains, recipient ceilings and content-size caps must come from one shared
routine. Caps left inline in a single transport get skipped by the alternate
company-SMTP branch, which then reaches recipients and sizes the platform path
rejects.

**Check every rate bucket before consuming any.** Consuming per-actor, then
per-company, then platform as you go means a rejected over-limit actor still
burns the company's allowance on the way to being denied.

**A circuit breaker that nothing can clear is an outage.** If clearing a pause
requires a successful send, the pause blocks its own recovery. A delivery pause
needs a cooldown and an explicit recovery path, must be adopted from persisted
state on boot, and must not be cleared by a send that was already in flight when
it tripped. Bounce and complaint signals arrive asynchronously by webhook, so a
breaker with no webhook ingress is inert in production — and that webhook needs
its own authentication, or anyone can forge complaints and pause all mail.
Provider webhooks are at-least-once, so deduplicate signals or one retried
bounce pauses everything.

**Guard tests must be behavioral, and must use reserved test recipients.** A
source-level grep for a guard call cannot see that the guard is skipped when the
request is absent; only invoking the handler shows it. Stub the shared transport
and capture its options. Always address probes to reserved test addresses — a
real message reached a live domain while probing this exact bug before the
transport was stubbed.
