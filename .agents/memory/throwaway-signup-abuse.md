---
name: Throwaway-domain trial signups are the abuse vector
description: Self-serve trials from disposable email domains are the delivery mechanism for platform abuse, and expired trials do not stop it.
---

Self-serve trial signup is an unauthenticated attacker's cheapest way to get an
authenticated session. Treat a disposable-email signup as hostile until proven
otherwise, and never assume a rate limit keyed to "a logged-in tenant" is safe
just because signup required an inbox.

**Why:** an abuse run against the platform came in as two throwaway signups from
the same disposable-mail domain minutes apart, each with no name, no payment,
and a company record left in the default pending state. They generated tens of
thousands of metered events over the following days. Trial *expiry* did not stop
the activity — the company rows stayed enabled after the trial end date passed,
so the session kept working.

**How to apply:** when adding any capability that costs money or sends outbound
messages, check what a brand-new trial tenant can do with it before checking
what a paying tenant can. Verify that trial expiry actually disables the
capability rather than only hiding UI. Cluster signups by email domain and
creation window when investigating anomalies — abusive signups arrive in pairs
or bursts, not alone.

Signup protection now needs to be applied at every owner-trial entry point, not
only the visible `/api/signup` form: public onboarding and marketing
orchestration can create the pending company before the password step.

**Why:** the same trial transition was reachable through three server-side
paths with separate IP limiters, so protecting one route still left another
route able to create a trial from a disposable address.

**How to apply:** reject known disposable/reserved/probe domains before company
creation, throttle new trials by both IP and email domain, and keep
RFC-reserved fixture addresses available only in development so smoke tests do
not become production signups.
