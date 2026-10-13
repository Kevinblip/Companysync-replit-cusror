---
name: Replit VM image-size packaging
description: Durable guidance for avoiding Reserved VM publish failures caused by oversized workspace images.
---

Replit Reserved VM and Autoscale publish images have an 8 GiB limit, and
`.replitignore` is not supported.

**Rule:** Keep one production artifact tree. If the workspace contains large
editor state, Git history, source assets, or local upload copies, remove them
only after the production build in the disposable publish builder.

**Why:** Replit packages the Repl layer after the build command. A successful
compiler run can still fail later with `image size is over the limit of 8 GiB`.
Copying `public/` into multiple `dist` locations compounds the problem.

**How to apply:** Preserve runtime modules and built static assets, point
`publicDir` at the actual Vite output, and use a build-command cleanup for
workspace-only directories. Never delete production uploads blindly; confirm
that `/uploads/*` resolves through object storage first.

## Concurrent cache cleanup

Temporary cache cleanup must not invalidate a successful production build when
the cache is still being written. Retry briefly, then issue a visible warning
if it remains busy; compilation and required packaging failures must remain fatal.

**Why:** A publish failed after successful compilation because recursive removal
of the temporary cache returned `Directory not empty`. The build and application
were not the failure.

**How to apply:** Handle only optional cache cleanup as best-effort. Keep required
cleanup and the compiler in the failure-propagating command chain, and never test
the destructive publish-cleanup command in the live workspace.

## Packaging evidence

**Rule:** A successful compiler run or Node version print does not prove that
post-build exclusions completed. Require an explicit completion marker and
measure the remaining workspace payload after cleanup.

**Why:** Generic container-creation failures can stop before image-layer logs
appear, without exposing the infrastructure error. Large development directories
are not proof of an oversized final image when publishing excludes them.

**How to apply:** Test cleanup only in isolated temporary fixtures. Distinguish
the workspace payload from the entire container, which also includes Nix/system
and hosting layers. Do not label instrumentation as a confirmed publish fix.

**Large app videos (Aug 2026 change):** training clips and marketing videos no
longer live in `public/videos/` or `public/generated_marketing_videos/` — they
are in public object storage under `videos/…` and `generated_marketing_videos/…`
and served via a 302 redirect to a signed GCS URL (prod-server static fallback
+ dev middleware in the integrations vite plugin; GCS handles Range so seek
works). To add a video: drop it in `public/videos/`, run
`node scripts/upload-videos-to-storage.cjs`, delete the local copy. Both dirs
are gitignored. `public/uploads/` and uuid-named `public/*.jpg` are disk caches
only — object storage is source of truth; a verify-then-delete sweep (exists →
else upload+verify → unlink) is the safe way to clear them (found ~780 files
that were disk-only before the sweep). One-off attached_assets media archived
to private object storage at `archives/attached-media-archive-2026-08-16.tar.gz`.
That archive covers the demo/generated media and the Code Analyzer ZIP, but not
the two company-sync backup ZIPs; those are in
`archives/attached-zip-attachments-2026-09-01.tar.gz`. Large unreferenced
PDFs, screenshots/photos, and the manual JSON backup are in
`archives/attached-chat-attachments-2026-09-01.tar.gz`.