---
name: Crew photo archive downloads
description: Completeness and JSZip compatibility rules for bulk crew-photo archives.
---

Insurance photo archives must include every photo in the gallery, regardless of the active filter, and must not silently produce an incomplete ZIP when any original cannot be fetched. Fetch originals sequentially. Convert each fetched Blob to a `Uint8Array` before adding it to JSZip; Node's JSZip runtime does not accept its native Blob object as file data.

**Why:** An incomplete photo set is misleading insurance evidence; fetching many originals concurrently increases memory/network pressure, and Node tests expose a platform difference in Blob support.

**How to apply:** Preserve full-set and fail-closed behavior in future crew-photo exports, and keep archive generation compatible with both browser and Node tests.