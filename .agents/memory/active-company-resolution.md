---
name: Active-company resolution & impersonation lifetimes
description: Why the sidebar can brand one tenant while the dashboard reads another, and the rules that keep the shell and the data layer in agreement.
---

## The failure shape

A platform admin switches to a tenant and gets the target tenant's branding in
the sidebar while the dashboard greets a *different* company and shows empty
widgets. Nothing errors; both halves believe they are correct.

It happens because "which company is active" is resolved independently by the
app shell, the role-based data hook, and the current-company hook, and because
impersonation state spans three different lifetimes:

- **per-tab** — the client impersonation flag in sessionStorage (gone in a new tab)
- **persistent, cross-tab** — the per-user "last used company" selection in localStorage (survives expiry, logout of the session, everything)
- **server session row** — the real authority; scopes reads and blocks writes

Writing the impersonated tenant into the *persistent* selection is what turns a
30-minute audited session into a permanent mismatch: the tab flag expires, the
selection does not, so the shell keeps branding a tenant the API no longer
serves.

## Rules

1. **One resolver decision, used everywhere.** The shell, the data hook and the
   current-company hook must feed the same inputs to the same resolver. If the
   shell accepts a stored selection on its own (e.g. "it's in my company list"),
   it will accept selections the data layer rejects.
2. **List eligibility must match selection eligibility.** A company that can be
   resolved but is missing from the loaded company list makes the shell fall
   back while the data layer stays put — the same divergence from the other
   direction.
3. **Client cross-tenant permission must mirror the server's unscoped-read
   rule.** A looser client rule (e.g. accepting `platform_role === 'admin'`,
   which the server does not treat as unscoped) produces exactly the
   empty-dashboard symptom, because the API still scopes those reads.
   **Why:** the server is the authority; the client rule only decides what the
   UI is allowed to *believe*.
   Caveat: ordinary tenant owners in this database carry `is_super_admin` on
   their staff rows, so that flag alone is not a safe client-side signal for
   cross-tenant access; require the platform company.
4. **Reconcile impersonation with the server on load.** The session cookie, not
   the tab, decides whether an impersonation is active. Adopt a server session
   the tab doesn't know about, drop a tab session the server already ended, and
   on a network failure change nothing rather than guessing.
5. **Version the reconciliation against start/stop.** A status response that was
   requested before a start/stop must not be applied after it, or the UI stops
   impersonating while the server session stays active (writes then 403 while
   everything looks normal).
6. **Never drop an impersonation session on a request *error*.** Only a
   successful "company not found" result justifies clearing it. Clearing on
   error silently repoints the whole page at another tenant.
7. **Platform-admin default home.** Platform staff with no platform staff row
   must default to the platform company, but only *after* the platform-profile
   and owned-company checks — tenant owners must never be defaulted to it.
8. **Named platform users may have a server-backed preferred tenant.** Store the
   preferred tenant on their platform staff profile and apply it during login;
   do not change company `created_by` or invent a tenant membership just to
   control the landing page.
   **Why:** `created_by` records who created a workspace, not business ownership,
   and browser-only selections disappear on a new device or clean session.
   **How to apply:** validate the preference through the normal active-company
   resolver, preserve explicit in-session switches, and keep CompanySync as the
   default when no preference is configured.
