---
name: MRMS MESH hail radar integration
description: Durable rules for safely using NOAA's rolling hail-radar grid with historical storms
---

# MRMS MESH hail radar (Storm Tracker)

Live MESH data covers only the trailing day; NOAA does not provide the needed public archive. Never sample the live grid for an older storm because that can attribute today's hail to a historical event.

**Why:** Without an ingest-time snapshot, radar confidence and heatmaps disappear permanently after the rolling window. Sampling the current grid instead produces false historical evidence.

**How to apply:** Capture one compact raw-value crop per hail-relevant storm after every ingestion producer, but only after the event has begun. Raw values must support both point sampling and overlays. Archived consumers prefer that crop and visibly label it as archived; concurrent captures must be atomic.

## Full-grid decoding and site-wide responsiveness

Keep decompression and PNG decoding of the full live grid off the HTTP server's event loop. Preserve the last validated fallback grid and its original age; limit and time out decode work rather than letting a bad feed stall requests indefinitely.

**Why:** The 7000×3500-cell decode blocked a local event-loop timer for over four seconds, and a live production grid load coincided with a nearly seven-second gap in request logs. That can slow unrelated pages and clicks. Browser tests with mocked API responses cannot reveal this server-side stall. The full decode also briefly raised process memory by hundreds of MiB, so moving it to a worker does not remove the need for VM memory headroom.

**How to apply:** When changing radar ingestion, check both decoded-value parity and event-loop responsiveness using a real-sized feed, and confirm the published VM has enough memory during refresh. Cache writes should become visible only after a feed validates; a disk fallback must not receive a new freshness timestamp.
