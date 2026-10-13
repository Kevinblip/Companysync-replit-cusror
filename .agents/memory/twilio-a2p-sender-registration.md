---
name: Twilio A2P sender registration (30034 vs 30024)
description: Why outbound texts silently fail per-number, and why a registered number must be sent through its Messaging Service.
---

Outbound SMS can fail per-from-number even when the account, brand, and campaign
are all approved. Two distinct Twilio errors, both invisible to the operator
(status `undelivered`, no app-level error):

- **30034** — the from-number belongs to no registered A2P 10DLC campaign.
- **30024** — the number IS in a Messaging Service, but the send used a bare
  `From` instead of `MessagingServiceSid`. Adding a number to a service *changes
  how you must send from it*.

**Why it matters:** one tenant can have several numbers where some deliver and
some don't, so "our texts work" is never account-wide evidence. Diagnose per
sending number by pulling the Messages list and reading `error_code`, not by
testing a different feature that happens to use a different number.

**How to apply:** prefer a stored `messaging_service_sid`; on 30024/30034,
discover the service that owns the number, retry through it, and persist the
sid. Adding a number to a Messaging Service is safe for inbound routing **only
when** the service has `use_inbound_webhook_on_number: true` — otherwise the
service's inbound webhook overrides the number's own and inbound handling breaks.
