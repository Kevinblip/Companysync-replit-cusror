#!/usr/bin/env node
'use strict';

// Regression tests for tenantGuard.enforceAdminOnlyCompanyFields — the role guard
// that stops NON-ADMIN staff from changing top-level company identity/branding
// fields (company_name, phone, address, logo_url, branding, parent_company_id...)
// through the universal entity API. Run via
// `node scripts/test-tenant-guard-company-fields.cjs`.
//
// Key semantics under test:
// - keys on the resolved table name ('companies'), not the SDK alias ('Company')
// - CHANGE-detection, not key presence: bodies that echo unchanged values (pages
//   spread the full company record back on save) must NOT 403
// - the company owner (companies.created_by === session email) bypasses, mirroring
//   the frontend isAdmin logic
// - nested `{data:{company_name:...}}` smuggling is blocked (on read, data
//   JSONB fills in empty columns, so a data-key write can shadow an unset column)
// - timezone / preferred_language / onboarding_completed stay writable (legit
//   non-admin flows in GeneralSettings / QuickSetup)

const path = require('path');
const {
  enforceAdminOnlyCompanyFields,
  ADMIN_ONLY_COMPANY_FIELDS,
} = require(path.join('..', 'lib', 'tenantGuard.cjs'));

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else { console.log(`  \u2717 ${name}`); failed++; }
}

console.log('[tenant-guard-company-fields] running tests...');

const staff = { authenticated: true, isSuperAdmin: false, viaServiceToken: false, isAdministrator: false, administratorCompanyIds: new Set(), email: 'staff@example.com' };
const admin = { ...staff, isAdministrator: true, administratorCompanyIds: new Set(['comp_1']), email: 'admin@example.com' };
const superAdmin = { authenticated: true, isSuperAdmin: true, administratorCompanyIds: new Set(), email: 'root@example.com' };
const service = { authenticated: true, viaServiceToken: true, administratorCompanyIds: new Set(), email: 'internal-service' };
const owner = { ...staff, email: 'owner@example.com' };

const existing = {
  id: 'comp_1',
  company_name: 'Acme Roofing',
  name: 'Acme Roofing',
  phone: '+15550001111',
  address: '1 Main St',
  logo_url: 'https://x/logo.png',
  branding: { primary: '#112233' },
  created_by: 'owner@example.com',
  timezone: 'America/Chicago',
};

// existingB is a different company (comp_2) — used for the cross-company admin test.
const existingB = {
  id: 'comp_2',
  company_name: 'Beta Roofing',
  name: 'Beta Roofing',
  phone: '+15551112222',
  address: '2 Other St',
  logo_url: 'https://y/logo.png',
  branding: { primary: '#334455' },
  created_by: 'owner-b@example.com',
  timezone: 'America/Chicago',
};

// 1. The list covers the core identity fields from the task.
ok('list is non-empty', Array.isArray(ADMIN_ONLY_COMPANY_FIELDS) && ADMIN_ONLY_COMPANY_FIELDS.length >= 10);
for (const f of ['company_name', 'phone', 'address', 'logo_url', 'name', 'branding', 'parent_company_id', 'created_by', 'is_deleted']) {
  ok(`list includes ${f}`, ADMIN_ONLY_COMPANY_FIELDS.includes(f));
}
ok('list excludes timezone (GeneralSettings non-admin flow)', !ADMIN_ONLY_COMPANY_FIELDS.includes('timezone'));
ok('list excludes preferred_language (GeneralSettings non-admin flow)', !ADMIN_ONLY_COMPANY_FIELDS.includes('preferred_language'));
ok('list excludes onboarding_completed (QuickSetup flow)', !ADMIN_ONLY_COMPANY_FIELDS.includes('onboarding_completed'));
ok('list excludes settings (own guard)', !ADMIN_ONLY_COMPANY_FIELDS.includes('settings'));

// 2. CORE: non-admin CHANGING an identity field is blocked, on resolved 'companies'.
const chg = enforceAdminOnlyCompanyFields(staff, 'companies', { company_name: 'Evil Corp' }, existing, 'PUT companies');
ok('non-admin company_name change is blocked', chg.blocked === true && typeof chg.reason === 'string');
ok('non-admin phone change is blocked', enforceAdminOnlyCompanyFields(staff, 'companies', { phone: '+15559990000' }, existing, 'PUT Company').blocked === true);
ok('non-admin logo_url change is blocked', enforceAdminOnlyCompanyFields(staff, 'companies', { logo_url: 'https://evil/x.png' }, existing, 'PUT Company').blocked === true);
ok('non-admin branding object change is blocked', enforceAdminOnlyCompanyFields(staff, 'companies', { branding: { primary: '#ff0000' } }, existing, 'PUT Company').blocked === true);
ok('non-admin created_by change is blocked', enforceAdminOnlyCompanyFields(staff, 'companies', { created_by: 'staff@example.com' }, existing, 'PUT Company').blocked === true);
ok('non-admin parent_company_id change is blocked', enforceAdminOnlyCompanyFields(staff, 'companies', { parent_company_id: 'comp_2' }, existing, 'PUT Company').blocked === true);

// 3. CHANGE-detection: echoing unchanged values (full-record spread-back) passes.
const echoBody = { company_name: 'Acme Roofing', phone: '+15550001111', address: '1 Main St', logo_url: 'https://x/logo.png', branding: { primary: '#112233' }, settings: { pdf: {} } };
ok('unchanged echo of admin-only fields is allowed', enforceAdminOnlyCompanyFields(staff, 'companies', echoBody, existing, 'PUT Company').blocked === false);
ok('null over absent field is a no-op (allowed)', enforceAdminOnlyCompanyFields(staff, 'companies', { company_tagline: null }, existing, 'PUT Company').blocked === false);
ok('mixed body: one changed field still blocks', enforceAdminOnlyCompanyFields(staff, 'companies', { ...echoBody, address: '666 Hacker Way' }, existing, 'PUT Company').blocked === true);

// 4. Fields NOT in the list stay writable by non-admins.
ok('timezone change is allowed for non-admin', enforceAdminOnlyCompanyFields(staff, 'companies', { timezone: 'America/New_York' }, existing, 'PUT Company').blocked === false);
ok('preferred_language change is allowed for non-admin', enforceAdminOnlyCompanyFields(staff, 'companies', { preferred_language: 'es' }, existing, 'PUT Company').blocked === false);
ok('data JSONB non-identity keys are allowed', enforceAdminOnlyCompanyFields(staff, 'companies', { data: { lexi_voice_id: 'v2' } }, existing, 'PUT Company').blocked === false);

// 5. Bypasses: admin, super-admin, service token, company owner.
const evil = { company_name: 'New Name' };
ok('administrator bypasses', enforceAdminOnlyCompanyFields(admin, 'companies', evil, existing, 'PUT Company').blocked === false);
ok('super-admin bypasses', enforceAdminOnlyCompanyFields(superAdmin, 'companies', evil, existing, 'PUT Company').blocked === false);
ok('service token bypasses', enforceAdminOnlyCompanyFields(service, 'companies', evil, existing, 'PUT Company').blocked === false);
ok('company owner (created_by) bypasses', enforceAdminOnlyCompanyFields(owner, 'companies', evil, existing, 'PUT Company').blocked === false);
ok('owner match is case-insensitive', enforceAdminOnlyCompanyFields({ ...staff, email: 'OWNER@Example.com' }, 'companies', evil, existing, 'PUT Company').blocked === false);

// 6. Nested `data` JSONB smuggling is blocked (merged over columns on read).
ok('data.company_name smuggle is blocked', enforceAdminOnlyCompanyFields(staff, 'companies', { data: { company_name: 'Evil Corp' } }, existing, 'PUT Company').blocked === true);
ok('data.logo_url smuggle is blocked', enforceAdminOnlyCompanyFields(staff, 'companies', { data: { logo_url: 'https://evil/x.png' } }, existing, 'PUT Company').blocked === true);
ok('data echo of unchanged value is allowed', enforceAdminOnlyCompanyFields(staff, 'companies', { data: { company_name: 'Acme Roofing' } }, existing, 'PUT Company').blocked === false);

// 7. Scoping: only the resolved companies table is guarded.
ok('non-company entity is never blocked', enforceAdminOnlyCompanyFields(staff, 'leads', { company_name: 'x' }, { company_name: 'y' }, 'PUT leads').blocked === false);
ok('SDK alias Company (unresolved) is not treated as companies', enforceAdminOnlyCompanyFields(staff, 'Company', evil, existing, 'PUT Company').blocked === false);

// 8. Missing baseline record: presence of an admin-only field is treated as a change.
ok('no existing record: change attempt blocked', enforceAdminOnlyCompanyFields(staff, 'companies', evil, null, 'PUT Company').blocked === true);

// 9. Degenerate inputs never throw.
ok('null body allowed', enforceAdminOnlyCompanyFields(staff, 'companies', null, existing, 'PUT Company').blocked === false);
ok('unauthenticated ctx passes through (401 upstream)', enforceAdminOnlyCompanyFields({ authenticated: false }, 'companies', evil, existing, 'PUT Company').blocked === false);
ok('missing ctx passes through', enforceAdminOnlyCompanyFields(null, 'companies', evil, existing, 'PUT Company').blocked === false);

// 10. Cross-company admin: admin of comp_1 writing to comp_2 is BLOCKED.
// This is the core bug fix — isAdministrator was global, so admin@comp_1 could
// also mutate comp_2 where they are only plain staff. Now administratorCompanyIds
// is checked against the TARGET company's id.
console.log('\n[tenant-guard-company-fields] 10: cross-company admin guard...');
const adminOfAWritesToB = enforceAdminOnlyCompanyFields(admin, 'companies', { company_name: 'Hijacked' }, existingB, 'PUT Company');
ok('admin of comp_1 writing comp_2 identity fields is BLOCKED', adminOfAWritesToB.blocked === true);
ok('admin of comp_1 writing comp_1 identity fields is ALLOWED', enforceAdminOnlyCompanyFields(admin, 'companies', { company_name: 'New Name' }, existing, 'PUT Company').blocked === false);
ok('admin of comp_1 echo of comp_2 unchanged values is ALLOWED', enforceAdminOnlyCompanyFields(admin, 'companies', { company_name: 'Beta Roofing' }, existingB, 'PUT Company').blocked === false);
ok('plain staff of comp_1 writing comp_2 is blocked (unchanged)', enforceAdminOnlyCompanyFields(staff, 'companies', { company_name: 'Beta Roofing' }, existingB, 'PUT Company').blocked === false);
ok('plain staff of comp_1 changing comp_2 identity is blocked', enforceAdminOnlyCompanyFields(staff, 'companies', { company_name: 'Hijacked' }, existingB, 'PUT Company').blocked === true);

// Legacy ctx without administratorCompanyIds falls back to isAdministrator global flag.
const legacyAdmin = { authenticated: true, isSuperAdmin: false, viaServiceToken: false, isAdministrator: true, email: 'legacy@example.com' };
ok('legacy ctx (no administratorCompanyIds) uses isAdministrator fallback — allowed', enforceAdminOnlyCompanyFields(legacyAdmin, 'companies', { company_name: 'X' }, existing, 'PUT Company').blocked === false);

console.log(`\n[tenant-guard-company-fields] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
