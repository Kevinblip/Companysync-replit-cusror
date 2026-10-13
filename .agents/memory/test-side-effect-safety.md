---
name: Test side-effect safety
description: Existing lessons on avoiding paid-provider effects and leaked browser-test tenants.
---

- [Real-mail hazards](test-suites-send-real-mail.md) — Some smoke tests invoke live cron delivery across companies.
- [Signed-in browser fixtures](signed-in-browser-fixtures.md) — Stub paid providers and purge seeded tenants through SQL; Company rows cannot be deleted through the entity API.