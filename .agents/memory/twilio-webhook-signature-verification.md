---
name: Twilio webhook signature verification (CJS)
description: lib/twilioSignature.cjs adds X-Twilio-Signature verification for CJS server routes; mirrors the Deno functions/_twilioSignature.ts pattern; MONITOR-mode-by-default rollout.
---

# Twilio webhook signature verification — CJS mirror of the Deno pattern

`functions/_twilioSignature.ts` (`verifyTwilioSignature`/`shouldRejectTwilio`) was already
proven in `functions/recordingWebhook.ts` for Deno serverless functions. `lib/twilioSignature.cjs`
is the CJS equivalent for plain Node HTTP routes (`vite-twilio-ws-plugin.js` dev,
`prod-server.cjs` prod), using the `twilio` npm package's `validateRequest`.

Key design points:
- Looks up the company's `auth_token` from `generic_entities` (`entity_type='TwilioSettings'`)
  by `data->>'account_sid'` (from the POST body's `AccountSid` field — always present on real
  Twilio requests) first, falling back to `company_id` if passed explicitly. This means it
  works BEFORE company/routing resolution has happened for the request.

- Tries the request URL twice: once using `req.headers.host` + `req.url` directly, and once
  using the canonical public host (`VITE_REPLIT_APP_URL` env, matching `getPublicHost()` used
  elsewhere in both files) — this handles reverse-proxy URL rewrites that would otherwise break
  signature validation even for legitimate Twilio requests.

- **Rollout convention (3rd use of this pattern in the codebase, after `TENANT_GUARD_MODE` and
  the Deno `TWILIO_REQUIRE_SIGNATURE`):** default is MONITOR mode — invalid/missing signatures
  are logged (`[TwilioVerify:<endpoint>] MONITOR — ...`) but the request is still allowed through.
  Set `TWILIO_REQUIRE_SIGNATURE=1` to flip to enforcement (403 on failure), after confirming via
  logs that legitimate Twilio traffic is passing.

- **Env-token fallback also applies with NO TwilioSettings row.** Recordings/calls started with
  platform creds get callbacks signed with the platform token; without this fallback, enforce
  mode 403s the legit callback with `reason=no_settings`. Strictly additive — invalid signatures
  still fail against every token.

- **`matchedToken` trust semantics (`'company' | 'platform'`), returned by `verifyTwilioWebhook`:**
  a `'company'` match only proves the sender knows that company's own auth token — a hostile
  BYO-Twilio tenant knows theirs and can self-sign an arbitrary forged payload (any CallSid, any
  companyId in the URL). So on a `'company'` match, trust ONLY `settings.company_id` and ignore
  URL params; on a `'platform'` match, Twilio itself signed the callback URL we generated, so its
  query params are trustworthy. Any webhook that writes rows by a body-supplied identifier
  (CallSid etc.) MUST scope the lookup/patch to this trusted company or it is a cross-tenant
  write hole.

**Wired endpoints (dev `vite-twilio-ws-plugin.js` + prod `prod-server.cjs`, both required so no
mirroring gap):** `/twiml/voice`, `/api/whatsapp-webhook` (+`/api/functions/incomingSMS` alias),
`/api/sarah-missed-call`.

**Deliberately NOT wired:** `/twiml/outbound` (dev `/twiml/outbound`, prod
`/api/twilio/outbound-voice`) — this route's TwiML-serving branch responds immediately from URL
query params only, without ever reading the POST body (a separate method-gated branch further
down in the same handler does read a body for a different action). Retrofitting signature
verification here needs a body-read restructure of that handler; lower priority since its
`companyId` comes from a URL we generate ourselves for outbound calls, not attacker-supplied
inbound routing. Left as a follow-up.

Also note: `functions/incomingSMS.ts` (Deno) exists but is dead code for `/api/functions/incomingSMS`
— that path is intercepted directly by `prod-server.cjs`'s own handler (same block as
`/api/whatsapp-webhook`) before it would ever reach the Deno function dispatcher.
