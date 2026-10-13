---
name: Twilio inbound call routing & number resolution
description: How inbound calls resolve to a company in prod-server.cjs, and the gotchas (webhook drift, shared-number collision, cache precedence) that cause a tenant's AI line to misbehave.
---

# Twilio inbound call routing (prod-server.cjs incomingCall / /api/twilio/voice)

## Voice model experiments must reuse the established call transport
Use the standard production TwiML and Twilio media handlers for line-specific
model/tool experiments; do not revive the standalone raw-WebSocket test server.
**Why:** On 2026-10-03 the user explicitly abandoned that isolated experiment
after incoming-call media handoffs failed and requested the proven production path.
**How to apply:** Keep model/tool overrides confined to the intended line and
preserve other lines' routing, CRM authorization, and audio transport.

## Resolution order (first match wins)
1. `AssistantSettings.sarah_inbound_phone` exact match (DB).
2. In-memory `subscriberCache` (populated by `refreshCacheFromAPI` → Base44 `getAllSubscriberRouting`, 5-min TTL, periodic refresh ~every 6 min). **Only contains the numbers Base44 returns.**
3. `call_routing_cache` table (often empty).
4. `TwilioSettings` SQL lookup over `generic_entities` (`main_phone_number` / `available_numbers`).
A real inbound call also caches its resolved company back into `subscriberCache`. A deploy restarts the server and clears the in-memory cache, so the first post-deploy call re-resolves from DB.

## Shared-number collision (demo vs tenant)
**Why:** The CompanySync sales-demo number (ends `...7154`, owned by the demo/master company) was ALSO a real tenant's main line. Two bugs hijacked the tenant: (a) the demo `scenario=saas_demo` trigger fired on the *number* alone, ignoring which company resolved; (b) the TwilioSettings lookup used `LIMIT 1` with no `ORDER BY`, so a shared number resolved nondeterministically to the demo company.
**How to apply:** When a number can belong to multiple companies, make the SQL lookup deterministic — `ORDER BY (company_id IN (<master/default ids>)) ASC, updated_date DESC NULLS LAST` so a real tenant wins. And gate the demo scenario on `resolvedCompanyId === '<master id>'`, never on the dialed number alone. Default/master ids seen: master `companysync_master_001`, default `695944e3c1fb00b7ab716c6f`.

## Webhook drift after migration/redeploy (check this FIRST when a tenant's calls misbehave)
**Why:** After moving to a new domain/deploy, a number's `IncomingPhoneNumbers.voice_url` can still point at a stale deployment (old `*.replit.app`) or `demo.twilio.com`, so calls never reach the current app. Worse, a `voice_application_sid` (Twilio Application) OVERRIDES `voice_url` entirely — repointing the URL does nothing until you also clear the app sid (`VoiceApplicationSid=''`).
**How to apply:** List `IncomingPhoneNumbers`, compare each `voice_url` to the current domain, and check `voice_application_sid`. Repoint voice + statusCallback to the live `/api/twilio/voice` and `/api/sarah-missed-call`; clear any stale app sid. Only touch the tenant's own numbers on a shared Twilio account. Creds live in that tenant's `TwilioSettings` (plaintext account_sid/auth_token) — never log them.

## Latent landmine (unfixed, dead for empty sarah_inbound_phone)
The `sarah_inbound_phone` block assigns `resolvedCompanyId` BEFORE its `let` declaration → TDZ `ReferenceError` swallowed by an empty `catch`. Harmless only while no company sets `sarah_inbound_phone` to a dialed number; if one does, that resolution path silently fails. Fix requires moving the `let` above the block AND preserving precedence so the early match isn't clobbered by the later `url-param || cached || null` assignment.
