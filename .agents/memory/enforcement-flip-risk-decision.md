---
name: TENANT_GUARD_MODE / TWILIO_REQUIRE_SIGNATURE enforcement flip
description: why these two guards were switched from monitor/log mode to hard-enforce without the originally-planned production log-verification window.
---

`TENANT_GUARD_MODE=enforce` and `TWILIO_REQUIRE_SIGNATURE=1` were set (shared env, so they apply to both dev and prod) based on the owner's explicit call, not on a production monitoring window showing zero would-block hits (the original plan's safety gate).

**Why:** at the time of the flip, the app had no published deployment yet — only the owner's own company (YICN Roofing) was using/testing it, so the blast radius of a false-positive block was limited to their own testing session, and they accepted that risk given "we have time."

**How to apply:** if a second real tenant/company onboards, or the app is published as a live deployment serving outside traffic, re-verify there are no `[tenantGuard] LOG-MODE would-block` or `[TwilioVerify:*] REJECTED` log lines from legitimate traffic before assuming enforcement is still safe — the original verification step was skipped, not proven clean. If real Twilio calls start failing, check `VITE_REPLIT_APP_URL` matches the actual public host and that the company's `TwilioSettings.auth_token` is correct — both were confirmed correct at flip time but drift (e.g. token rotation) would break signature validation silently under enforce mode.
