---
name: Tenant guard — companies scoping & is_super_admin escalation
description: How the universal entity API scopes the companies table, and the standing self-escalation hole via staff_profiles.is_super_admin.
---

# Companies table has no `company_id` column

A `companies` row IS the tenant boundary — its own `id` is the company id. So any
tenant-scoping code in the universal entity API must special-case
`entityType === 'companies'` and key on `record.id`, NOT `record.company_id`
(which is undefined for that table). This applies to at least three sibling
mechanisms in `lib/tenantGuard.cjs`, and they must stay consistent:
- `checkOwnership` (by-id GET/PUT/DELETE ownership)
- `stripProtectedBillingFields` (money-critical credit-field strip)
- list scoping (`companyField: 'id'` in the ENTITY_CONFIG / SDK_TO_TABLE maps)

**Why:** the generic "no company_id → allow" fallthrough silently disabled the
ownership check for company records, letting any authenticated user read/write any
company's row. Fixed by resolving `entityType==='companies' ? record.id : record.company_id`.

**How to apply:** always key companies on the RESOLVED lowercase table name
(`'companies'`), never the SDK alias (`'Company'`) or a capitalized string — the
route resolves `Company`/`/entity/companies/<id>` to `'companies'` first, so keying
on the resolved name is bypass-proof; any other casing falls through to
`generic_entities` (a different table) and cannot reach real company rows. Guards
respect `TENANT_GUARD_MODE` (enforce vs log) uniformly; the billing strip is the
only always-enforced carve-out (no legitimate entity-API writer for credit fields).

# Standing hole: staff_profiles.is_super_admin self-escalation

`resolveRequestContext` promotes `staff_profiles.is_super_admin === true` to a
PLATFORM super-admin that bypasses ALL tenant checks (ownership, list scoping, the
billing strip). But `is_super_admin` is writable on `staff_profiles` through the
same entity API: prod's update whitelist includes it and dev's genericUpdate writes
any real column with no protected-field strip outside `companies`. A tenant can
PUT their OWN staff profile (passes checkOwnership — it's their own company's row)
with `is_super_admin: true`, then on the next request gain platform super-admin.

Onboarding also stamps every owner's staff_profile with `is_super_admin: true`, so
a chunk of normal owners already hold a platform-wide bypass.

**Why:** this is a working privilege-escalation path that nullifies checkOwnership
and the billing strip; it was left out of the ownership-check fix (which was
required to keep super-admin bypass "exactly as before").

**How to apply:** the real fix is to strip `is_super_admin` /`is_administrator` /
`platform_role` from tenant-initiated staff_profiles writes (mirror the billing
strip pattern, dev + prod), and reserve true platform super-admin for
`users.platform_role`, not per-company staff_profiles. Owners should be
`is_administrator` only.
