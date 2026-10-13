---
name: Mobile photo reliability
description: Camera lifecycle and crew-upload constraints that require explicit mobile handling.
---

- [Camera lifecycle](mobile-camera-state-loss.md) — Android may kill the tab during camera capture.
- [Crew upload transport](crew-photo-mobile-upload-reliability.md) — Keep base64 upload requests sequential on mobile; concurrent uploads can all fail.