---
name: Storm canvass address coverage
description: Distinguishes map-mapped address points from a complete property inventory in storm canvassing.
---

# Storm canvass address coverage

OpenStreetMap address results are only the addresses mapped in OSM. They are not a census or complete property roster, especially in rural areas. Reverse-geocoding a few sample coordinates can return plausible addresses, but it does not discover all homes and must never be used to pad a canvassing list.

**Why:** Sparse sample points can look like a useful property list while badly understating the number of homes; public Overpass instances can also be temporarily unavailable.

**How to apply:** Keep map-data counts explicitly qualified as incomplete, show an outage state and retry path when the provider fails, and use a separately selected property-data provider when a comprehensive list is required. Require a clear user action before invoking any provider that may incur usage charges.