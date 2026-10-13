#!/usr/bin/env node
'use strict';

// Regression tests for tenantGuard.checkOwnership — the by-id GET/PUT/DELETE
// ownership check for the universal entity API. Run via
// `node scripts/test-tenant-guard-ownership.cjs`.
//
// CORE REGRESSION: the `companies` table has NO `company_id` column — a company
// row IS the tenant boundary, so ownership must be scoped on record.id when
// entityType === 'companies'. Before the fix, company records fell through the
// "no company_id -> allow" branch and any authenticated user could read/write
// any company's record. The guard MUST key on the RESOLVED table name
// ('companies'), not the SDK alias ('Company'), so the raw
// `/api/local/entity/companies/<id>` route can't bypass it.

const path = require('path');
const { checkOwnership } = require(path.join('..', 'lib', 'tenantGuard.cjs'));

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else { console.log(`  \u2717 ${name}`); failed++; }
}

// checkOwnership reads process.env.TENANT_GUARD_MODE at call time (not cached),
// so we flip it per-scenario.
function withMode(mode, fn) {
  const prev = process.env.TENANT_GUARD_MODE;
  process.env.TENANT_GUARD_MODE = mode;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.TENANT_GUARD_MODE;
    else process.env.TENANT_GUARD_MODE = prev;
  }
}

console.log('[tenant-guard-ownership] running tests...');

const tenantA = { authenticated: true, isSuperAdmin: false, email: 'a@example.com', allowedCompanyIds: new Set(['company_A']) };
const tenantB = { authenticated: true, isSuperAdmin: false, email: 'b@example.com', allowedCompanyIds: new Set(['company_B']) };
const multiLoc = { authenticated: true, isSuperAdmin: false, email: 'm@example.com', allowedCompanyIds: new Set(['company_A', 'company_C']) };
const superAdmin = { authenticated: true, isSuperAdmin: true, email: 'admin@example.com', allowedCompanyIds: new Set() };
const service = { authenticated: true, isSuperAdmin: true, viaServiceToken: true, email: 'internal-service', allowedCompanyIds: new Set() };
const anon = { authenticated: false, allowedCompanyIds: new Set() };

// A `companies` record has NO company_id column — only its own id.
const companyARecord = { id: 'company_A', name: 'Acme Roofing', subscription_status: 'active' };
const companyBRecord = { id: 'company_B', name: 'Beta Builders' };
// A normal tenant-scoped record (lead) carries company_id.
const leadInA = { id: 'lead_1', company_id: 'company_A' };
const leadInB = { id: 'lead_2', company_id: 'company_B' };

// ---------------------------------------------------------------------------
// 1. CORE REGRESSION: company record scopes on record.id (not record.company_id)
// ---------------------------------------------------------------------------
withMode('enforce', () => {
  ok('own company record allowed (scoped on record.id)',
    checkOwnership(tenantA, 'companies', companyARecord, 'GET Company').allowed === true);
  ok('own company record not blocked',
    checkOwnership(tenantA, 'companies', companyARecord, 'GET Company').blocked === false);

  const cross = checkOwnership(tenantA, 'companies', companyBRecord, 'PUT Company');
  ok('cross-company record BLOCKED in enforce', cross.blocked === true && cross.allowed === false);

  ok('multi-location member allowed on a company they belong to',
    checkOwnership(multiLoc, 'companies', companyARecord, 'GET Company').allowed === true);
  const multiCross = checkOwnership(multiLoc, 'companies', companyBRecord, 'GET Company');
  ok('multi-location member blocked on a company they do NOT belong to', multiCross.blocked === true);
});

// ---------------------------------------------------------------------------
// 2. Mode gating: log mode allows the would-be block through (audit first)
// ---------------------------------------------------------------------------
withMode('log', () => {
  const cross = checkOwnership(tenantA, 'companies', companyBRecord, 'PUT Company');
  ok('cross-company record ALLOWED (would-block logged) in log mode', cross.allowed === true && cross.blocked === false);
});

// ---------------------------------------------------------------------------
// 3. Bypasses: super-admin and internal service token always pass
// ---------------------------------------------------------------------------
withMode('enforce', () => {
  ok('super-admin bypasses cross-company company record', checkOwnership(superAdmin, 'companies', companyBRecord, 'PUT Company').allowed === true);
  ok('service token bypasses cross-company company record', checkOwnership(service, 'companies', companyBRecord, 'DELETE Company').allowed === true);
});

// ---------------------------------------------------------------------------
// 4. Unauthenticated is always blocked; null record is a no-op allow
// ---------------------------------------------------------------------------
withMode('enforce', () => {
  ok('unauthenticated caller blocked', (() => { const r = checkOwnership(anon, 'companies', companyARecord, 'GET Company'); return r.allowed === false && r.blocked === true; })());
  ok('null record allowed (nothing to scope)', checkOwnership(tenantA, 'companies', null, 'GET Company').allowed === true);
});

// ---------------------------------------------------------------------------
// 5. Non-company entities keep scoping on company_id (unchanged behavior)
// ---------------------------------------------------------------------------
withMode('enforce', () => {
  ok('own lead allowed via company_id', checkOwnership(tenantA, 'leads', leadInA, 'GET Lead').allowed === true);
  const crossLead = checkOwnership(tenantA, 'leads', leadInB, 'PUT Lead');
  ok('cross-company lead blocked via company_id', crossLead.blocked === true);
});

// ---------------------------------------------------------------------------
// 6. Bypass-proofing: only the RESOLVED lowercase 'companies' triggers id-scoping.
//    An unresolved alias ('Companies'/'Company') is NOT the companies table
//    (it resolves to generic_entities), so a body with no company_id falls
//    through to the orphan-allow branch rather than being id-scoped.
// ---------------------------------------------------------------------------
withMode('enforce', () => {
  ok("capitalized 'Companies' is NOT treated as companies (no id-scoping)",
    checkOwnership(tenantB, 'Companies', companyARecord, 'GET Companies').allowed === true);
  ok("SDK alias 'Company' is NOT treated as companies (route resolves it first)",
    checkOwnership(tenantB, 'Company', companyARecord, 'GET Company').allowed === true);
});

// ---------------------------------------------------------------------------
// 7. Orphan record (no company_id) on a normal entity is allowed but logged
// ---------------------------------------------------------------------------
withMode('enforce', () => {
  ok('orphan lead with no company_id allowed (can\'t scope)',
    checkOwnership(tenantA, 'leads', { id: 'lead_orphan' }, 'GET Lead').allowed === true);
});

console.log(`\n[tenant-guard-ownership] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
