---
name: Admin-only company fields guard
description: Design rules for the entity-API guard that blocks non-admin staff from changing top-level company identity columns
---

# Admin-only company-fields guard (enforceAdminOnlyCompanyFields, lib/tenantGuard.cjs)

**Rule:** Non-admin staff must not CHANGE top-level company identity/branding columns
(company_name, name, phone, email, address, logo_url, company_logo, company_tagline,
website, industry, branding, features_enabled, parent_company_id, created_by,
base44_id, is_deleted) via the entity API. 403, not silent strip.

**Why the specific semantics matter:**
- **CHANGE-detection, not key presence** — several pages (CompanySetup etc.) spread the
  full company record back on save; blocking on mere presence of an unchanged
  company_name would 403 every legitimate save by any staff member. Compare against the
  already-fetched `existing` record; null ≡ undefined via JSON.stringify.
- **Owner bypass** — allow when `existing.created_by` matches the session email
  (case-insensitive). Frontend isAdmin parity: older owner accounts may lack an
  `is_administrator` staff profile; created_by is server-stamped and itself in the
  guarded list, so it can't be rewritten to self-promote.
- **Deliberate exclusions** — timezone + preferred_language (GeneralSettings lets ANY
  staff change them, no admin gate in that UI), onboarding_completed (QuickSetup gate
  bounce-loop risk), settings (own guard), billing/subscription fields (already
  stripped by other guards). Adding these would break real non-admin flows.
- **Nested data smuggle** — `{data:{company_name:...}}` must be compared/blocked too;
  on read the data JSONB fills EMPTY columns (columns win when set), so a data-key
  write can shadow an unset column.
- Always hard-enforced (no TENANT_GUARD_MODE gate); keys on resolved
  entityType === 'companies' so the raw /entity/companies/<id> alias is covered.

**Known accepted edge case:** a non-admin staffer invited before the owner completes
onboarding gets 403s from Smart Fill identity writes (documented in
docs/ai-smart-setup.md). Fails safe; owner/admin completes setup.

**Residual gap (follow-up proposed):** ctx.isAdministrator is GLOBAL across all of a
user's companies — an admin of company A who is plain staff in company B passes both
ownership and the admin bypass for B. Fix = per-company admin scoping.

**How to apply:** when adding new company columns that carry identity/branding/structural
meaning, add them to ADMIN_ONLY_COMPANY_FIELDS; when adding non-admin-editable company
fields, verify they are NOT in the list. Tests: scripts/test-tenant-guard-company-fields.cjs
(pre-push 15b) + scripts/test-company-fields-guard.cjs (live workflow).
