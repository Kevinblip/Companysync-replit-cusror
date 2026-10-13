---
name: Crew photo mobile upload reliability
description: Mobile crew-photo uploads should avoid concurrent base64 requests
---

Keep public crew-photo uploads sequential and send compressed files as
`multipart/form-data`, rather than sending several base64 JSON requests.

**Why:** A prior concurrency optimization caused Android Chrome/mobile network
queues to reject requests with a fetch-level connection error. Sequential
base64 still failed on a later 42-photo batch; browser-native multipart avoids
the base64 memory spike and roughly 33% wire-size expansion.

**How to apply:** If upload speed needs improvement, prefer smaller payloads,
progress feedback, or an idempotent resumable protocol. Keep legacy JSON
support server-side for old clients, and test Android Chrome with a 40+ photo
batch before changing the transport or concurrency.

Large batches also need low-resolution preview blobs rather than rendering every
original camera file as an image thumbnail. Per-photo client retries should
carry an idempotency key so a lost response cannot create a duplicate media row.