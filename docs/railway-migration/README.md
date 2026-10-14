# Railway migration branch (`migration/railway-unified`)

Base: `replit-live` (snapshot of the code running on getcompanysync.com). Nothing here is deployed.

## Included
- Google sign-in fix from PR #1 (`db/google-auth.cjs`, login error banner). Conflict with the
  live callback resolved by using the shared module and keeping live's
  trimmed, case-insensitive email match (`LOWER(BTRIM(email))`).
- `lib/voice-call-flow.cjs` (+ tests) from PR #7 as a helper module only — not wired in.
- `.dockerignore` (from PR #11, adjusted so app icons are not excluded).
- `railway.toml` + `.node-version`: Railway builds with `npm run build` and starts
  `node prod-server.cjs` (the Replit start script needs Replit's Nix store).
- `.replit`: ENCRYPTION_KEY, SARAH_BRIDGE_SECRET, LEXI_NATIVE_BRIDGE_SECRET removed;
  read from environment only. Startup now logs a warning if a critical secret is missing.
  **Add these to Replit Secrets before this ever reaches live Replit.**

## Not included (need a dedicated port + live test calls)
- PR #7 voice turn-taking/hangup changes, PR #8 per-rep Twilio routing, PR #10 commission
  calculator: live code was rewritten in these areas after the fixes were written, so a
  mechanical merge would undo live behavior. See the PR description for details.

See SECRETS-INVENTORY.md and UPLOADS-PLAN.md.
