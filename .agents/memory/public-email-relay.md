---
name: Public email relay incident
description: Outbound email provider credentials must never be reachable through an unauthenticated generic send endpoint.
---

Treat every low-level "send email" HTTP endpoint as a potentially public mail
relay, even when its provider token is kept correctly in server-side secrets.
An attacker does not need to extract the token if they can ask the application
to send arbitrary recipient, subject, and HTML values.

**Why:** the provider sees a valid server-token request and will send it;
delivery exports then resemble a stolen-key incident, while ordinary app logs
may not retain the precise abuse window.

**How to apply:** require a signed authenticated session before accepting a
generic send request, derive identity/company from that session rather than
client headers, cap recipient count and payload size, and rate-limit by
authenticated sender. Protect both the development route and the production
route. On suspected abuse, revoke and replace the provider token even if the
open relay is the most likely cause, since logs alone may not rule out token
exposure.