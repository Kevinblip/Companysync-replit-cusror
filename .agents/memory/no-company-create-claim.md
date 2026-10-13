---
name: No-company create claim guard
description: How brand-new users (empty allowedCompanyIds) are stopped from linking themselves into foreign tenants via StaffProfile creates, and why companies.created_by is the ownership root.
---

# No-company create claim guard

**Rule:** A caller with EMPTY company membership (no `users.company_id`, no active `staff_profiles` rows) who supplies a `company_id` on an entity CREATE must be the target company's `created_by` (case-insensitive session-email match). `staff_profiles` failures are ALWAYS blocked regardless of `TENANT_GUARD_MODE` (a row there IS a membership grant); other entity types follow the mode. DB lookup errors fail closed.

**Why:** `enforceCreateCompanyId` deliberately passes no-company bodies through untouched (onboarding needs it), so before this guard a brand-new user could POST a StaffProfile with an arbitrary `company_id`, become a "member" of any tenant, and then pass `startCompanyTrial`'s staff-membership ownership check.

**How to apply:**
- Guards live in `lib/tenantGuard.cjs`: `enforceCompanyCreatedBy` (stamps `companies.created_by` from the session on create — the entity API previously never set it, so QuickSetup companies had `created_by=NULL`) and `verifyNoCompanyCreateTarget` (the async claim check). Wired into POST single+bulk in BOTH `vite-db-plugin.js` and `db/prod-db.cjs`.
- `companies.created_by` is the root of the ownership chain — it must always be server-stamped, never client-trusted. Any new "is this my company?" authz should accept created_by OR staff membership.
- Membership resolution reads ONLY `users.company_id` + the real `staff_profiles` table (see `resolveRequestContext`); generic_entities 'StaffProfile' rows grant nothing, and there is no `User` SDK mapping, so `users.company_id` is unreachable via the entity API. `stripCompanyIdFromUpdate` blocks re-homing via PUT.
- Legacy caveat: companies created via QuickSetup BEFORE this fix have `created_by=NULL` → no created_by claim exists for them (backfill proposed as a follow-up).
- Known quirk (pre-existing): under enforce mode, `enforceCreateCompanyId` re-homes a member's create targeting a company outside their memberships to their first allowed id — this breaks the Utilities child-company flow (owner's StaffProfile for the new child gets re-homed to the parent). Fix is to honor a created_by claim there too.
- Regression suite: `scripts/test-tenant-guard-nocompany.cjs` (pre-push check #15).
