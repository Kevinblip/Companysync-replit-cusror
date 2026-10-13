---
name: Dev-workspace links must not hardcode the production domain
description: Customer/staff-facing links (estimate share links, portal links, workflow notification URLs) generated in the dev workspace must resolve to the dev preview domain, not production — otherwise records that only exist in the dev DB produce links that 404 in prod.
---

Any server-side code that builds a full URL to send to a user (email links, in-app
notification links, share links, webhook callback URLs) must resolve the base
domain through a single environment-aware helper, not an inline
`process.env.SOME_APP_URL || 'https://production-domain.com'` fallback.

**Why:** In this project, `VITE_REPLIT_APP_URL` is set to the production domain even
inside the dev workspace. Every inline fallback that defaulted to the hardcoded
production URL therefore generated correct-looking, correctly-signed links that
pointed at production — even for records (e.g. a test estimate) that only ever
existed in the dev database. The result: a real HMAC-valid link that 404s
("Not Found") with no error in the logs, because the domain was right but the
environment/database was wrong. This class of bug is invisible in code review
because the URL "looks fine" — it only surfaces when someone actually clicks the link
from the *other* environment's data.

**How to apply:** Centralize base-URL resolution in one helper (e.g. `getAppUrl()`).
Inside it, check `process.env.REPLIT_DEPLOYMENT !== '1'` (the existing convention
this codebase already uses elsewhere to distinguish dev from a published
deployment) and, if true and `REPLIT_DEV_DOMAIN` is set, return
`https://${REPLIT_DEV_DOMAIN}` instead of falling through to the production
default. Route every link-building call site through that one helper — do not let
individual handlers duplicate the inline fallback, or the fix silently misses some
of them (this codebase had ~9 duplicate copies of the same fallback expression
across workflow emails, share links, invoice pay links, Twilio webhook URLs, and
portal links before consolidating).
