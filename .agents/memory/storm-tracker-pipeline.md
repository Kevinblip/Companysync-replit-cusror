---
name: Storm tracker data pipeline invariants
description: Why storms "vanish" or never alert — retention vs UI window, cron LSR ingestion, alert eligibility clause, office_locations state derivation
---

# Storm tracker pipeline invariants

Three coupled invariants; breaking any one makes the tracker look "random":

1. **Retention must cover the UI search window.** `purgeOldStormEvents` keeps 365 days because the Storm Tracker "Search History" dropdown goes to 365. A shorter purge silently deletes storms users can still search for (this is exactly how a huge OH hail storm "disappeared"). The purge handler also self-heals: after deleting, it backfills `fetchStormDataV2({daysBack: 365})` nightly.
2. **The alert cron must ingest real storm reports itself.** IEM LSR (hail/wind/tornado) data otherwise only enters the DB when a user clicks Refresh in the UI — so the alert cron had nothing to alert on. `checkAndSendStormAlerts` Step 3b ingests the last 24h of LSRs for monitored states every 30-min run.
3. **IEM rows are inserted with status `'ended'`, never `'active'`.** An alert query matching only `status='active'` OR fresh NWS_ACTIVE will never alert on hail. IEM eligibility uses the storm `start_time` from the last 24 hours with no `created_date` gate; per-company `notified_storm_ids` prevents duplicates. The `start_time` condition is the anti-spam guard: a user-triggered 365-day backfill creates rows with a fresh `created_date` but old storm times, which must NOT notify.

The production scheduler must run the shared alert check shortly after process startup, then continue every 30 minutes. Development already performs its first cron tick about a minute after startup.

**Why:** A server outage longer than the former six-hour `created_date` window permanently swallowed real reports, and waiting another full interval after recovery extended the blind spot.

**How to apply:** Keep dev and production invoking the same shared alert engine. Test both sides of the window: an ended IEM report about eight hours old must alert once, while a fresh insert whose storm `start_time` is over 24 hours old must stay silent.

**State derivation gotcha:** `fetchStormDataV2` derives states from StormAlertSettings; it must read `office_locations` (newer multi-office UI) in addition to legacy `service_center_location`/`service_areas`, or office-only companies silently fall back to the OH/TX/FL default list. This derivation is duplicated (inline in vite-functions-plugin.js AND db/storm-functions.cjs) — keep in lockstep. The module `fetchStormDataV2` also accepts an explicit `states:[…]` param (used by the alert cron, which derives states its own way).

**Testing note:** module fns in db/storm-functions.cjs can be exercised directly via node + pg Pool against the dev DB; calling `checkAndSendStormAlerts(pool, {})` without `sendEmailFn` skips emails, but SMS would still send if TwilioSettings creds + notify_sms recipients + a matching fresh storm all exist.

## IEM live LSR endpoint outages
The live lsr.php endpoint intermittently returns 503; suggestStormSwathAreas now falls back to our own StormEvent hail rows (same IEM data we ingest) so "confirmed" badges stay truthful during outages. reportSource in the response says which source was used.

## Nationwide dedup pool-window shift
Nationwide digest used the SHARED 1000-row service-area pool. Between consecutive cron ticks the NWS expiry cleanup changes some alerts status='active'→'expired', shifting the ORDER BY ranking. Storms ranked just outside top-1000 in tick N slip into tick N+1's pool — never in notifiedNationwideIds → false resend.

**Fix:** Nationwide digest builds its OWN query (event_type IN hail/high_wind/tornado/thunderstorm, LIMIT 5000, same 48h IEM + 6h NWS_ACTIVE window) AND notified_nationwide_ids retention trimmed to 6000 (must exceed the query window or surviving IDs get discarded and resend) — pool-window shifts can't cause leaks. The shared 1000-row pool remains for service-area checks only.

## Storm smoke tests pollute each other
The nationwide and city-isolation smoke tests share the live storm_events table (and both enable nationwide on test companies). Run concurrently, one test's inserted storms appear as "new" in the other's second dedup call → false resend failure. Run them sequentially.

**Why:** 2026-08-14 nationwide test failed its dedup assertion only when city-isolation ran alongside it; solo re-run passed 8/8.
