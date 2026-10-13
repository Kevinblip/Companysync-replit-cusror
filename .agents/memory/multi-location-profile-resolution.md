---
name: Multi-location company selection
description: The active company is a per-user browser preference, not global browser state; the platform tenant is the safe default.
---

The selected company must be scoped to the authenticated email. A single global
browser key lets a YICN selection made in one session silently route a later
CompanySync login into the wrong tenant.

**Why:** active-company resolution happens in the visible shell, data hooks,
and request defaults. If any of them accepts a stale global selection, the app
can look like it changes tenant as users navigate and can send unscoped reads
to that wrong context.

**How to apply:** keep one shared selection/default resolver. Ignore legacy
unscoped values rather than migrating them when ownership cannot be proven.
Clear impersonation storage *and its mounted React state* when the authenticated
identity changes. CompanySync is the default for someone with a CompanySync
profile; a permitted tenant remains selected only after that same user has
explicitly switched to it. Never restore an impersonated company for a different
authenticated user.

An explicit CompanySync/owned-company switch also outranks an already-running
impersonation expiry stop. It must preserve that new selection and wait for the
server to end the old session before reloading.

Page-level access checks must select the caller's staff profile for the resolved
active company before evaluating role permissions. API result order is not an
identity signal when one user has profiles in multiple companies.

**Why:** using the first returned profile can evaluate permissions from another
tenant and incorrectly redirect an otherwise authorized user to Dashboard.

**How to apply:** resolve the active company first, then match `company_id` on
the user's profiles; only fall back to an admin profile or the first profile
when no company-specific match exists. Compare owner emails case-insensitively.