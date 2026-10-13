# Loading and capacity baseline — 2026-09-29

## Measurement method

The browser runs used a synthetic signed-in administrator, intercepted API responses, and one-pixel placeholder images. They did not use production photos, credentials, or external providers. The measurements characterize browser startup and rendering, not production network or database latency. A first run immediately after restarting Vite spent 7.4 seconds compiling development modules; the table uses a fresh browser load after that server-side compile cache was warm.

- **Cold** is the first page load in a fresh browser context.
- **Warm** is a reload in the same context.
- Dashboard timing ends when its heading is visible; the synthetic company has empty entity collections.
- Inspection timing ends when the first gallery card is visible with 2,500 synthetic media rows. Before the change, the gallery mounted all 2,500 cards at once.

## Signed-in loading

Dashboard shell time to visible heading:

| Viewport | Cold | Warm |
| --- | ---: | ---: |
| Desktop, 1440×1000 | 1.59 s | 1.40 s |
| Mobile, 390×844 | 1.28 s | 1.86 s |

Inspection gallery, 2,500 synthetic rows:

| Viewport | Before: all cards mounted | After: first 100 cards | After warm reload |
| --- | ---: | ---: | ---: |
| Desktop, 1440×1000 | 11.24 s | 2.41 s | 1.60 s |
| Mobile, 390×844 | 12.81 s | 1.85 s | 1.86 s |

The post-change cold first-card time is about 79% lower on desktop and 86% lower on mobile in this fixture. The intercepted `JobMedia` response was about 850 KB. Its measured browser request time was 27–76 ms in the post-change runs. This points to mounting thousands of card components—not the mocked request—as the dominant measured gallery delay. The regression test also verifies that loading another batch adds 100 cards, changing sections resets the window, and “Select All” still selects all 2,500 media rows.

The gallery now renders up to 100 cards initially and adds more on demand. The query, section counts, selection, downloads, and bulk operations still use the full media collection; tenant filtering and financial calculations were not changed.

## Storage capacity

### PostgreSQL

- Production snapshot: **1,406,935,040 bytes** (about **1.31 GiB**) against a **10 GiB** limit, or about **13%**.
- In the 90-day aggregate, **2,590 JobMedia rows** represented about **815 KB of JSON metadata**. This is not the binary photo footprint.
- New generic-entity rows over the same period represented about **641 MB of gross logical JSON payload** by `pg_column_size`. This is not net database growth; it does not account for updates, deletes, or row/index overhead.

### App Storage

Current object-storage bytes, object count, and bucket lifecycle policy could not be read from this workspace. App Storage is therefore **unmeasured**, not zero. The `file_uploads` metadata table and PostgreSQL JSON estimates are not substitutes for object-storage usage.

The backup-row review found 411 unpinned backups with future expiry dates, 7 unpinned backups without an expiry, and 4 pinned backups without an expiry. The expiry cleanup removes expired PostgreSQL rows but has no object-delete path. No historical objects or customer data were deleted, and no bucket lifecycle policy was changed.

## Follow-up measurement needed

Obtain read-only App Storage usage and lifecycle-policy visibility, then record object count and bytes separately from PostgreSQL. Production per-request database timing for Dashboard and JobMedia was not captured by the API-mocked browser runs and should be measured separately with an approved production-safe method.