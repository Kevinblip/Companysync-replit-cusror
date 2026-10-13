---
name: Lexi calendar event timezone storage
description: How to correctly convert Gemini-generated datetimes so the calendar displays the right local time.
---

## The Rule

Calendar frontend displays times via `new Date(start_time)` (timezone-aware).
To show **noon ET**, the DB must store **`T16:00:00.000Z`** (noon + 4h = UTC), NOT a local wall-clock string.

## Correct `toStorageUtc` pattern (used in both dev plugin and prod-server.cjs)

```js
function toStorageUtc(isoString, tzOffset) {
  if (!isoString) return isoString;
  // Bare time (no suffix) — treat as local wall-clock
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(isoString)) {
    const d = new Date(isoString + tzOffset);
    return isNaN(d.getTime()) ? isoString : d.toISOString();
  }
  // Z-suffix — Gemini ignored tz instruction; reinterpret time as local
  if (isoString.endsWith('Z')) {
    const local = isoString.slice(0, 19);
    const d = new Date(local + tzOffset);
    return isNaN(d.getTime()) ? isoString : d.toISOString();
  }
  // Has explicit offset — just convert to UTC
  const d = new Date(isoString);
  return isNaN(d.getTime()) ? isoString : d.toISOString();
}
```

**Why:** The prior (wrong) approach converted `T12:00:00Z` → `T08:00:00-04:00` (local wall-clock with offset). `new Date("T08:00:00-04:00")` correctly reads that as 8am ET — still 4 hours off from noon.

**How to apply:** Any Lexi tool call that writes a `start_time`/`end_time` to `calendar_events` must pass the value through `toStorageUtc(raw, tzOffset)` before the INSERT. `tzOffset` comes from `getUtcOffset(companyTimezone)`.

## Confirming an offered slot must echo local wall-clock

Lexi's conflict response returns alternatives as **UTC `Z` strings**, but the
confirm path runs `start_time` back through `toStorageUtc`, which reinterprets a
`Z` suffix as company-local. Echoing an offered slot verbatim therefore shifts it
by the tz offset and fails the "must match an offered slot" check with
`SCHEDULE_CONFIRMATION_INVALID`.

**Why:** the normalizer assumes the model ignored the timezone instruction, so a
genuinely-UTC input is indistinguishable from a mislabeled local one.

**How to apply:** confirmations (and any test driving them) must send the chosen
alternative as a bare local wall-clock time in the company timezone.

## Calendar form also stores UTC

When users manually create/edit events via the UI, `Calendar.jsx` line ~1300 does:
```js
if (!finalFormData.start_time.endsWith('Z')) {
  finalFormData.start_time = new Date(finalFormData.start_time).toISOString();
}
```
This converts datetime-local inputs (local time strings) to UTC Z format — consistent with the Lexi approach.
