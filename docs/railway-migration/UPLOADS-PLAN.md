# Customer uploads: keep every file when moving to Railway

## Where uploads live today (live Replit app)
1. **Replit Object Storage (Google Cloud bucket)** — new uploads are written here first
   (`db/object-storage.cjs`), using Replit's local sidecar at `127.0.0.1:1106`.
   That sidecar does NOT exist on Railway, so this code path will fail there.
2. **Replit VM disk `public/uploads/`** — every upload is also written to disk, and
   `prod-server.cjs` falls back to disk when a file isn't in storage. This folder is
   in `.gitignore` on the live code, so it is NOT in this branch. (Older commits on
   `main` still carry ~196 MB of it; we are not rewriting git history.)
3. **Database rows** (e.g. `project_photos.photo_url = /uploads/<uuid>.jpg`) only hold paths,
   so the URLs keep working as long as the same filenames are served.

## Plan (nothing here has been done yet)
1. **Pick storage on Railway.** Recommended: a Railway Volume mounted at `/app/public/uploads`
   (simplest; same paths, disk fallback code works unchanged; size ~1–5 GB to start).
   Longer term: S3-compatible bucket (Cloudflare R2 / AWS S3) behind a small adapter
   replacing the sidecar calls in `db/object-storage.cjs`.
2. **Inventory before copying** (read-only, on Replit shell): file count + total size of
   `public/uploads/`, and an object listing of the Replit bucket `public/` prefix.
3. **Copy, don't move.** Download a zip of `public/uploads/` + every object in the bucket;
   keep that zip as an off-platform backup (Kevin's Drive) too.
4. **Load into Railway volume**, then verify counts and checksums match the inventory.
5. **Code change (separate PR, before cutover):** make `db/object-storage.cjs` detect
   "not on Replit" and skip the sidecar (write to the volume / S3 instead). Today it
   already falls back to disk when the upload to storage fails, so uploads still save,
   but each one logs a warning and waits for the failed sidecar call.
6. **Cutover night:** freeze uploads (short maintenance window), copy the delta of files
   created since step 3, re-verify counts, then switch DNS.
7. **Keep Replit storage untouched for 30 days** after cutover as the rollback copy.

## Do not
- Do not delete `public/uploads` or the Replit bucket.
- Do not purge git history to shrink the repo; `.dockerignore` already keeps the build small.
