---
name: Google reverse geocode rural ZERO_RESULTS
description: Why result_type filters break reverse geocoding in rural/township areas, and the safe pattern.
---

# Google reverse geocode in rural areas

Rule: never pass `result_type=locality|sublocality` to the Google reverse-geocoding API when points can land in rural/township areas — it returns `ZERO_RESULTS` for most of storm country (unincorporated land). Do a plain reverse geocode and pull the city from `address_components`, with `administrative_area_level_3` (township) as a fallback type.

**Why:** Storm Tracker "Auto-suggest low-competition areas" silently returned zero suggestions around Wooster OH because all 16 ring points failed the result_type-filtered lookup; per-point try/catch swallowed it, so the endpoint returned 200 with an empty list.

**How to apply:** any handler reverse-geocoding storm/map ring points (e.g. suggestStormSwathAreas). Also: client-side Nominatim geocoding is rate-limited/flaky — fall back to the server `geocodeAddress` function (which must require auth; it burns platform Google quota via the unauthenticated raw invoke route otherwise).
