#!/usr/bin/env node
'use strict';

// Regression tests for tenantGuard.stripProtectedBillingFields — the money-critical
// guard that stops a tenant from self-granting PAID usage credits by writing the
// Company credit columns through the universal entity API. Run via
// `node scripts/test-tenant-guard-billing.cjs`.
//
// The guard MUST key on the resolved table name ('companies'), not the SDK alias
// ('Company'), otherwise `PUT /api/local/entity/companies/<id>` bypasses it.

const path = require('path');
const {
  stripProtectedBillingFields,
  PROTECTED_COMPANY_BILLING_FIELDS,
} = require(path.join('..', 'lib', 'tenantGuard.cjs'));

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else { console.log(`  \u2717 ${name}`); failed++; }
}

console.log('[tenant-guard-billing] running tests...');

const tenant = { authenticated: true, isSuperAdmin: false, viaServiceToken: false, email: 't@example.com' };
const superAdmin = { authenticated: true, isSuperAdmin: true, email: 'admin@example.com' };
const service = { authenticated: true, viaServiceToken: true, email: 'internal-service' };

const allCreditFields = () => {
  const o = { name: 'Acme Roofing' };
  for (const f of PROTECTED_COMPANY_BILLING_FIELDS) o[f] = 999999;
  return o;
};

const hasNoCreditFields = (obj) =>
  PROTECTED_COMPANY_BILLING_FIELDS.every((f) => !Object.prototype.hasOwnProperty.call(obj, f));
const keepsAllCreditFields = (obj) =>
  PROTECTED_COMPANY_BILLING_FIELDS.every((f) => obj[f] === 999999);

// 1. The list itself covers every known paid-credit column.
ok('protected list is non-empty', Array.isArray(PROTECTED_COMPANY_BILLING_FIELDS) && PROTECTED_COMPANY_BILLING_FIELDS.length >= 6);
for (const f of ['ai_credits_purchased', 'sms_credits_purchased', 'call_credits_purchased', 'extra_ai_credits', 'extra_lexi_credits', 'extra_marcus_credits']) {
  ok(`protected list includes ${f}`, PROTECTED_COMPANY_BILLING_FIELDS.includes(f));
}

// 2. CORE REGRESSION: guard keys on resolved entityType 'companies', so the raw
//    alias route is stripped exactly like the 'Company' SDK route.
const viaAlias = stripProtectedBillingFields(tenant, 'companies', allCreditFields(), 'PUT companies');
ok('tenant write via resolved companies is stripped', hasNoCreditFields(viaAlias));
ok('non-credit fields survive the strip', viaAlias.name === 'Acme Roofing');

// 3. Super-admin and internal service token bypass the strip (legit granters).
ok('super-admin keeps credit fields', keepsAllCreditFields(stripProtectedBillingFields(superAdmin, 'companies', allCreditFields(), 'PUT companies')));
ok('service token keeps credit fields', keepsAllCreditFields(stripProtectedBillingFields(service, 'companies', allCreditFields(), 'PUT companies')));

// 4. Non-company entities are never touched (guard is company-scoped).
const onLead = stripProtectedBillingFields(tenant, 'leads', { name: 'x', ai_credits_purchased: 5 }, 'PUT leads');
ok('non-company entity is left untouched', onLead.ai_credits_purchased === 5);

// 5. A wrong-case / unmapped alias that does NOT resolve to the companies table
//    must not be treated as companies (it would write a different/absent table).
ok('capitalized Companies is NOT treated as companies', stripProtectedBillingFields(tenant, 'Companies', allCreditFields(), 'PUT Companies').ai_credits_purchased === 999999);
ok('SDK alias Company is NOT treated as companies (route resolves it first)', stripProtectedBillingFields(tenant, 'Company', allCreditFields(), 'PUT Company').ai_credits_purchased === 999999);

// 6. Partial bodies: only present credit fields are removed, others untouched.
const partial = stripProtectedBillingFields(tenant, 'companies', { name: 'y', sms_credits_purchased: 10 }, 'PUT companies');
ok('partial credit body: credit field stripped', partial.sms_credits_purchased === undefined);
ok('partial credit body: other field kept', partial.name === 'y');

// 7. CORE REGRESSION: nested `data` JSONB bypass. Company fields merged from the
//    JSONB blob on read must be stripped inside `{data:{...}}` too, or a tenant
//    smuggles paid credits past a top-level-only strip.
const nestedBill = stripProtectedBillingFields(tenant, 'companies', { name: 'y', data: { ai_credits_purchased: 999999, keep: 1 } }, 'PUT companies');
ok('nested credit body: data.ai_credits_purchased stripped', !Object.prototype.hasOwnProperty.call(nestedBill.data, 'ai_credits_purchased'));
ok('nested credit body: other data field kept', nestedBill.data.keep === 1);
ok('nested credit body: top-level field kept', nestedBill.name === 'y');
ok('nested strip does not mutate original body.data', (() => { const b = { data: { ai_credits_purchased: 5 } }; stripProtectedBillingFields(tenant, 'companies', b, 'PUT companies'); return b.data.ai_credits_purchased === 5; })());
ok('super-admin keeps nested data credits', stripProtectedBillingFields(superAdmin, 'companies', { data: { ai_credits_purchased: 5 } }, 'PUT companies').data.ai_credits_purchased === 5);
ok('body whose data has no credit fields is unchanged (same ref)', (() => { const b = { data: { keep: 1 } }; return stripProtectedBillingFields(tenant, 'companies', b, 'PUT companies') === b; })());

// 8. Non-object / empty bodies are returned as-is without throwing.
ok('null body returns null', stripProtectedBillingFields(tenant, 'companies', null, 'PUT companies') === null);
ok('body with no credit fields is returned unchanged', (() => { const b = { name: 'z' }; return stripProtectedBillingFields(tenant, 'companies', b, 'PUT companies') === b; })());

console.log(`\n[tenant-guard-billing] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
