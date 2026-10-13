---
name: Storm alert email/SMS recipients
description: Why storm alerts can show in-app but send no email/SMS, and the admin fallback.
---

# Storm alert delivery (email/SMS) vs in-app banner

The in-app "Active Weather Warning" banner and the email/SMS storm alerts are **separate
paths**. The banner is a state-wide NWS active-alerts query; email/SMS comes from the
cron `checkAndSendStormAlerts` in `db/storm-functions.cjs` (shared by dev
`vite-functions-plugin.js` and prod `prod-server.cjs` + `db/prod-integrations.cjs` — one
file keeps them in lockstep).

## The silent-drop trap
The cron skips a company entirely when `StormAlertSettings.alert_recipients` is empty —
even if `enable_email_alerts`/`enable_sms_alerts` are on. Symptom: user sees the banner
but never gets email/SMS; logs read `[StormAlerts] Done — 0 companies, 0 storms, 0 emails,
0 SMS` after `N candidate storms, 1 companies`.

**Fix in place:** when alerts are enabled but recipients is empty, fall back to active
company admins from `staff_profiles` (`is_administrator`/`is_super_admin`/`role='admin'`),
deduped by normalized email+phone. So alerts are never dropped just because the list is
empty.

**Why:** non-technical owners enable the toggles but never add themselves as a recipient.

## The blank-office-location trap (silent, total)
A company whose office `location` is empty string matches NOTHING: the proximity
check needs coordinates and the text fallback needs a location/service-area
string. Every run logs the company, resolves recipients, then reports
`0 companies, 0 storms, 0 emails`. There is a company-address geo fallback, but
it is dead when `companies.address` is also blank — which is the norm for
accounts that never finished setup. Net effect: alerts look enabled in the UI
and never fire, with no warning anywhere.

**How to apply:** When a user reports missing storm alerts, check the office
location string FIRST — before recipients, severity, or cron health. Confirm by
looking for a peer company in the same run that did receive emails.

## Delivery must gate the dedupe list
`notified_storm_ids` may only be written for storms that actually reached a
person. Writing it on a run where every channel failed permanently suppresses
that storm — the next tick treats it as already sent, so a carrier-blocked or
provider-rejected alert is lost forever with no trace. Failures now retry with a
per-storm attempt cap, then raise an in-app failure notice; a "no sender
configured" skip counts as a failure, not a success. Carrier-level SMS rejection
is the most common cause here — see twilio-a2p-sender-registration.md.

## Other gates that must pass for a storm to send (besides recipients)
- Severity ≥ threshold (`min_severity` / legacy `alert_severity_threshold`, backend
  fallback 'moderate' — the settings UI shows 'severe' as its default, so the two
  disagree for a row that never stored the field). Wind ≥58mph = 'severe'. The threshold
  gates BOTH the service-area pass and the nationwide hail/wind digest; the digest's own
  hail-inch / wind-mph floors are additional, not a substitute.
- `event_type` ∈ `storm_types_to_monitor`.
- Proximity: office coords within `radius_miles`, or text match on affected areas.
- Not already in `notified_storm_ids` (per-company dedup).
- Active-storm window: only `status='active'` or `NWS_ACTIVE` rows created in the last
  6 hours qualify — so storms that have already "Ended" will NOT re-fire (by design).

## Auditing "I got an alert I should not have"
`notified_storm_ids` is the delivery ledger: join its elements against
`StormEvent.data->>'event_id'` and group by severity and `created_date` to see exactly
what a company was sent and when. A complaint about an out-of-policy alert is usually a
storm whose event row predates the settings change — compare the event's `created_date`
with when the setting was saved before suspecting a code bypass. The ledger is capped at
the most recent 500 IDs, so older history is gone.
