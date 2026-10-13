---
name: Email provider health & switch constraints
description: Provider chain, health tracker module, and key constraints for all app email sending.
---

## Provider chain (as of Sep 2026)

**Automatic priority: Postmark → AWS SES → SMTP → Resend (deprecated last-resort)**

- Postmark was the primary provider; `DeliveryType: Live` is not evidence that mail is currently entering its outbound stream.
- AWS SES is fallback (pure-Node Signature V4 using `AWS_ACCESS_KEY_ID`/`AWS_API_KEY` + `AWS_SECRET_ACCESS_KEY`/`AWS_SECRET_KEY` + `AWS_REGION`). SES drops attachments with a warning (Simple mode limitation).
- Resend is suspended / last-resort only. Logs a warning if used.

## Key files

- `lib/emailTransport.cjs` — Node/vite-plugin shared sender. Call `sendPlatformEmail({ to, from, subject, html, text, replyTo, attachments }, retries)`. Returns `{ success, id, provider }`.
- `lib/emailProviderHealth.cjs` — shared health tracker. Exports `reportResult({ ok, status, message })` (also aliased as `reportResendResult` for backward compat). Provider-neutral; `STATUS_ID = 'email_provider_status'`.
- `functions/_sendEmail.ts` — Deno/function-handler shared helper. Exports `sendEmail(opts)`. Uses Postmark REST directly. Throws if `POSTMARK_SERVER_TOKEN` not set.
- `vite-functions-plugin.js` — `sendViaResend()` now always delegates to `lib/emailTransport.cjs`. Function name kept for the 21 call sites.

## Domain & from-address

All `from` addresses use `companysync.io` (e.g. `noreply@companysync.io`). Old `mycrewcam.com` addresses were replaced across all Deno functions.

## Health tracker

- `reportResult({ ok })` — call after every send attempt; persists state to `generic_entities` under `STATUS_ID`.
- State flips: `ok` → clears auth_failed; auth failure (HTTP 401/403 or keyword match) → logs loudly + persists `auth_failed`.
- Transient errors do NOT flip the marker.
- Banner reads from persisted state and also from in-memory `mem.state`.

## Constraints

- Never probe a new SES/Postmark account with a dev address before checking it can send externally — sandbox accounts appear to auth OK but can't deliver.
- `EMAIL_FROM` env var overrides the default sender in `lib/emailTransport.cjs`; use it to rebrand without code changes.

## Provider acceptance is not delivery

A stored provider message ID proves only that the API accepted the payload. If a
later message-details lookup for that ID returns 422 "This message was not found",
the send is **untraceable** — the record cannot be tied to a real delivery attempt,
which usually means the sending credential and the diagnostic credential belong to
different provider accounts/servers. Never report an untraceable send as delivered;
say it was submitted and delivery is unconfirmed.

**Why:** the app previously showed "Email accepted for delivery" on API acceptance
alone, so silent non-delivery looked like success to the user and hid a real outage.

**How to apply:** UI and logs must distinguish submitted / delivered / bounced.
Confirm the diagnostic token targets the same Postmark server as the sending token
before concluding anything from a message-details lookup.

## Signature: provider accepts but account is cut off

Postmark can return `HTTP 200 / ErrorCode 0 / "OK"` **with a real MessageID** while
the account is unable to send. The message never enters the outbound stream and
`/messages/outbound/{id}/details` returns 422 ErrorCode 701 "This message was not
found" seconds later. Because the API reports success, the Postmark→SES→Resend
failover chain never triggers — every send looks fine and nothing is delivered.

**Confirm with account-level counters, not a single lookup:**
`/stats/outbound?fromdate=&todate=` showing `Sent: 0` across days the app was
sending, plus `/messages/outbound` whose newest message is stale, is proof. A lone
422 could be an indexing delay; zero sends over days cannot be.

**Root cause to check first:** abuse. An unauthenticated send endpoint lets attackers
blast phishing from the verified domain; the resulting hard bounces and spam
complaints get the account cut off. Inspect the newest outbound messages — unfamiliar
recipients, foreign-language subjects, or impersonated brands confirm it.

**How to apply:** treat "accepted but unverifiable" as a hard failure, not success.
Verify a fallback provider's credentials are actually complete before relying on the
chain — SES needs access key **and** secret **and** region, and a stored key can be
rejected as invalid. Rotate the provider token after suspected abuse even when an
open relay is the likelier vector.

## EMAIL_PROVIDER override lever

Provider selection is auto-detected by credential presence, which cannot express
"these credentials exist but the account is dead." EMAIL_PROVIDER pins the sender
('postmark' | 'ses' | 'smtp' | 'resend') so a non-sending provider can be bypassed
without a code change. An override naming a provider with no credentials now
fails closed, rather than falling back to an auto-detected dead provider and
claiming it sent mail.

**Gotcha:** it is a global override, so any test that selects a provider by
manipulating credentials must `delete process.env.EMAIL_PROVIDER` — and also clear
SMTP_* , since SMTP outranks Resend. A suite that skips this stops testing its
intended provider and, on the SMTP path, sends REAL mail from a test run.

**Gotcha:** provider detection was duplicated in the health module, so the admin
banner and launch checklist reported a different provider than the one actually
sending. Health now defers to the transport (lazy require — the transport requires
health at load time). Keep exactly one implementation.

Production SMTP has previously returned `454 Too many login attempts`, while
Postmark later accepted sends without adding them to its outbound stream. Neither
credential presence nor an authenticated session proves delivery health.

**Why:** Either provider can fail independently, and a global override that only
affects company-scoped mail still leaves subscriber/account-recovery emails on a
dead Postmark path.

**How to apply:** Verify the selected provider in the running production app
after each republish and check an actual delivery result before promising email
is restored. The override must cover account-recovery sends too; never silently
fall back to another provider if the selected provider's credentials are missing.

## Deployment secrets take precedence over production env settings

A published-app Deployment secret can override a same-named setting in the
project's production environment. Seeing a changed production setting in the
workspace does not prove the live process will read it after republishing.

**Why:** A stale provider secret can keep the live app pinned to an unusable
sender despite a production environment override and a successful publish.

**How to apply:** Check for same-named deployment secrets before relying on
production env edits. For an urgent sender outage, block the known-bad
provider with an independently named setting that fails closed when the
replacement is unavailable. Verify the running app's selected provider after
publishing; provider authentication still does not prove inbox delivery.

## Provider-agnostic send guards

Never gate a send with `POSTMARK_SERVER_TOKEN || RESEND_API_KEY`: that silently
skips mail when the configured active provider is SMTP or SES. Call the shared
transport (or check its `activeProvider() !== 'none'`) instead.

**Why:** after moving away from a paused Postmark stream, notification and
contract paths still had legacy Postmark/Resend-only preconditions, even though
SMTP was healthy and selected.

**How to apply:** all Node/CJS send paths use `lib/emailTransport.cjs` for both
provider selection and sending; do not infer configured providers from raw
environment variables at individual call sites.

## Interactive auth email deadlines

Interactive account-recovery requests must use a bounded provider request and a
short, single-attempt send budget. If delivery cannot be confirmed in that
window, return an explicit retryable error rather than reporting success or
leaving the browser in a loading state.

**Why:** an email provider connection without a timeout kept Forgot Password
requests open until the browser aborted them, while the handler could also
ignore a failed send and claim success.

**How to apply:** keep provider HTTP/SMTP operations deadline-bound, pass a
smaller retry budget for password reset and similar interactive auth flows, and
make the UI clear its submitting state on timeout or non-2xx responses.
