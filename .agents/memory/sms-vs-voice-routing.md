---
name: SMS vs voice routing divergence
description: SMS webhook company resolution must use TwilioSettings-first (not cache-first) because the routing cache can hold a stale company_id from a previous owner of the number.
---

## The Rule

In `prod-server.cjs` SMS handler, **TwilioSettings must be checked first** (with `ORDER BY` to pick the most recently updated non-demo company), then fall back to `call_routing_cache`, then `staff_profiles`.

The **opposite order** (cache first) causes the wrong company to be returned when a phone number was previously owned by another tenant — the cache has a stale entry and the TwilioSettings fallback is never reached.

**Why:** Voice routing works differently because it uses an **in-memory `subscriberCache`** (updated on every voice call setup) before hitting the DB. SMS has no in-memory layer, so a stale DB cache entry silently wins. When Virgil Roofing connected a number previously owned by YICN Roofing, YICN's cache entry persisted and all SMS routed to YICN while voice correctly routed to Virgil (via in-memory cache).

**How to apply:**
- `prod-server.cjs` SMS handler at `/api/functions/incomingSMS` + `/api/whatsapp-webhook`:
  1. TwilioSettings first — 3 phone formats (e164, 10-digit, 11-digit), `thoughtly_phone` field, demo company IDs deprioritized via `ORDER BY (company_id IN (...)) ASC, updated_date DESC NULLS LAST LIMIT 1`
  2. After a TwilioSettings hit: fire-and-forget `UPSERT call_routing_cache ... ON CONFLICT DO UPDATE SET company_id` to self-heal the cache
  3. `call_routing_cache` as fallback (handles staff personal Twilio numbers not in TwilioSettings)
  4. `staff_profiles.twilio_number` as last resort

- The Deno functions (`functions/incomingSMS.ts`, `functions/incomingSMSWebhook.ts`) are NOT the active SMS webhook target — the `smsUrl` configured in Twilio points to `/api/functions/incomingSMS` which is handled directly by prod-server.cjs.
