# Railway migration branch (`migration/railway-unified`)

Base: `replit-live` (snapshot of the code running on getcompanysync.com). Nothing here is deployed.

## Included
- Google sign-in fix from PR #1 (`db/google-auth.cjs`, login error banner). Conflict with the
  live callback resolved by using the shared module and keeping live's
  trimmed, case-insensitive email match (`LOWER(BTRIM(email))`).
- `lib/voice-call-flow.cjs` (+ tests) from PR #7 as a helper module only — not wired in.
- `.dockerignore` (from PR #11, adjusted so app icons are not excluded).
- `package-lock.json`: 150 packages pointed at Replit's private npm mirror; now registry.npmjs.org (same versions/hashes).
- `vite.config.js`: build process exits when done (it hung forever before).
- `railway.toml`, `railpack.json`, `nixpacks.toml`, and `.node-version`: Node 20.
  `main.py` is a Replit stub and is not part of the web process, so the build is
  pinned to the Node provider (Python detection was skipping Node packages).
  Railpack installs packages; the build command is `npm run build` only.
  `PORT` stays whatever Railway injects, and `prod-server.cjs` listens on
  `process.env.PORT`. The Replit start script
  is not used; it looks for Node inside `/nix/store`.
- Schema: `scripts/ensure-schema.cjs` runs before `node prod-server.cjs` and adds
  any missing tables or columns. Additive only (no drops, no data rewrites).
- `.replit`: ENCRYPTION_KEY, SARAH_BRIDGE_SECRET, LEXI_NATIVE_BRIDGE_SECRET removed;
  read from environment only. Startup now logs a warning if a critical secret is missing.
  **Add these to Replit Secrets before this ever reaches live Replit.**

## Not included (need a dedicated port + live test calls)
- PR #7 voice turn-taking/hangup changes, PR #8 per-rep Twilio routing, PR #10 commission
  calculator: live code was rewritten in these areas after the fixes were written, so a
  mechanical merge would undo live behavior. See the PR description for details.

See SECRETS-INVENTORY.md and UPLOADS-PLAN.md.
