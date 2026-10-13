---
name: Twilio number webhook host drift
description: Why inbound SMS silently disappears for some numbers — webhooks stamped with the provisioning-time host go stale after domain/deployment changes.
---

# Twilio number webhook host drift

**The rule:** When inbound SMS "never arrives" for a specific number, check Twilio's `IncomingPhoneNumbers` `sms_url` FIRST (via API, print only URLs, never tokens). Auto-provision stamps webhooks with whatever `host` the app had at provisioning time, so numbers provisioned under an old deployment domain (e.g. `code-analyzer-1.replit.app`) keep pointing there forever. Twilio logs these as inbound `received` with error **11200** (couldn't reach webhook) — the message is received by Twilio but never reaches the app.

**Why:** July 2026: staff rep's assigned number (+12169995444) had sms_url on the dead old Replit domain; customer replies died with 11200 while outbound worked fine (outbound doesn't use the webhook). Voice URLs on the same numbers were fine, which hid the problem.

**How to apply:**
- Debugging "customer replied but nothing shows up": query Twilio Messages log (shows inbound + error_code) and IncomingPhoneNumbers (shows sms_url) before digging into app routing.
- Fix = POST to the number's IncomingPhoneNumbers resource with `SmsUrl=https://getcompanysync.com/api/whatsapp-webhook`, `SmsMethod=POST`.
- Old missed replies are NOT retried by Twilio — the customer must text again.

## Related Twilio error codes seen in this account
- **21612** — destination not reachable: SMS to Philippine (+63) numbers fails because PH is disabled in Twilio Console → Messaging → Geo permissions (console-only setting, no public API). All staff-cell forwards to PH VAs fail until enabled.
- **30034** — A2P 10DLC unregistered: US carriers block messages from unregistered numbers (+12164801287 storm alerts/digests to US cells were `undelivered`). Needs A2P brand/campaign registration in Twilio Console.

## Inbound SMS company resolution (prod-server.cjs whatsapp-webhook)
3-tier: TwilioSettings (main/available_numbers) → call_routing_cache → **staff_profiles.twilio_number** (this last tier is what routes rep personal numbers). Rep-number inbound goes to the rep inbox (communications row + bell notification + SMS forward to rep cell) and Sarah stays silent if the last outbound was `sent_by_rep`.

## Number ownership gotchas (this Twilio account)
The account holds numbers for MULTIPLE apps: GoHighLevel numbers point at `services.msgsndr.com`, old Base44 numbers at `*.base44.app`. Do NOT bulk-repoint every number — only fix numbers referenced by staff_profiles.twilio_number or TwilioSettings. Raffy VA's +12169994704 sms_url intentionally(?) points at GoHighLevel — flagged to owner, not changed.
