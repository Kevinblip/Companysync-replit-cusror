---
name: Signed-in browser test fixtures
description: How seeded authenticated Playwright regressions stay safe and self-cleaning in this repo (auth seeding, provider stubbing, fixture teardown).
---

# Seeding and tearing down a signed-in browser test

**Rule:** a seeded authenticated browser test creates its tenant through the entity API but must
tear it down with SQL, and must stub every paid provider at the browser network boundary.

**Why:**
- The authenticated entity API deletes child rows (customers, staff profiles) fine, but a
  `DELETE` on a `Company` answers 404 — dedicated tenant rows are not deletable that way. An
  API-only teardown therefore leaks one test tenant (plus incidental `Notification` /
  `UserPresence` rows the page writes) on every run, and those pile up silently.
- Subscription/plan fields are stripped from client writes by the tenant guard, so a fixture
  company's plan has to be set with SQL too.
- Estimator/measurement pages call Maps, Solar, and Gemini on load. Left unstubbed, every test
  run bills real quota and becomes nondeterministic.

**How to apply:**
- Seed: insert a `sessions` row + forge the signed cookie, create Company/StaffProfile/Customer
  via the entity API, then `UPDATE companies SET subscription_plan/status` directly.
- Teardown: delete `generic_entities`, `customers`, `staff_profiles` by `company_id`, then the
  `companies` row, then the session — in a `finally` block so a failed assertion still cleans up.
- Stub providers at the API boundary and hard-fail (record) upload/LLM/messaging endpoints, while
  letting auth and entity traffic reach the real dev server when the test needs seeded DB state.
  Assert the recorded provider-call list is empty so a new paid call fails the test.
- For browser tests that mock all API responses, route `**/*` and continue unless the URL pathname
  starts with `/api/`. The broader `**/api/**` glob also matches Vite modules such as
  `/src/api/base44Client.js`, which can replace the app's API client module with the mock response.
- Fixtures should be deliberately rotated/asymmetric (e.g. a house whose front faces east, with
  distinct per-wall openings/confidence) so a hardcoded or mixed-up mapping cannot pass by luck.

## Image fixtures in a PWA

Check image decoding, not just saved URLs and counts. Synthetic same-origin image
routes can fall through to the app's HTML fallback when its service worker bypasses
browser route interception.

**Why:** A persisted photo fixture survived reload correctly but rendered broken
because its synthetic URL returned HTML instead of image bytes. Blocking the
service worker also disrupted app initialization, so it was not a reliable workaround.

**How to apply:** Use actual image bytes through a data/blob URL or a genuinely
served fixture resource, and assert `naturalWidth > 0` for previews and thumbnails.
If interception prevents the app-level check, verify the real component separately
without a service worker rather than treating the harness failure as an app bug.
