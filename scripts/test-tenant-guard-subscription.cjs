#!/usr/bin/env node
'use strict';

// Regression tests for tenantGuard.stripProtectedSubscriptionFields — the
// money-critical guard that stops a tenant from self-activating a subscription,
// extending their own free trial, or raising their plan limits by writing the
// Company subscription columns through the universal entity API. Run via
// `node scripts/test-tenant-guard-subscription.cjs`.
//
// Two behaviours are asserted:
//   * the subscription fields are stripped for tenants on BOTH create and update, and
//   * on CREATE the status is forced to 'pending' so a stripped body can't fall
//     through to the companies.subscription_status DEFAULT 'active' (a free active
//     company). It must NEVER force a status on UPDATE (that would downgrade a
//     live company). Super-admins and the internal service token bypass entirely.
//
// The guard MUST key on the resolved table name ('companies'), not the SDK alias
// ('Company'), otherwise `POST/PUT /api/local/entity/companies/<id>` bypasses it.

const path = require('path');
const {
  stripProtectedSubscriptionFields: strip,
  PROTECTED_COMPANY_SUBSCRIPTION_FIELDS: SUBS,
} = require(path.join('..', 'lib', 'tenantGuard.cjs'));

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else { console.log(`  \u2717 ${name}`); failed++; }
}

console.log('[tenant-guard-subscription] running tests...');

const tenant = { authenticated: true, isSuperAdmin: false, viaServiceToken: false, email: 't@example.com' };
const superAdmin = { authenticated: true, isSuperAdmin: true, email: 'admin@example.com' };
const service = { authenticated: true, viaServiceToken: true, email: 'internal-service' };

const has = (obj, f) => Object.prototype.hasOwnProperty.call(obj, f);
const allSubFields = () => ({
  company_name: 'Acme Roofing',
  subscription_plan: 'enterprise',
  subscription_status: 'active',
  trial_ends_at: '2099-01-01',
  trial_end_date: '2099-01-01',
  max_users: 999,
  max_leads: 999,
  max_customers: 999,
});
// Every protected field removed.
const allStripped = (obj) => SUBS.every((f) => !has(obj, f));
// Every protected field kept at its self-granted value (bypass paths).
const keepsAll = (obj) =>
  obj.subscription_plan === 'enterprise' &&
  obj.subscription_status === 'active' &&
  obj.trial_ends_at === '2099-01-01' &&
  obj.trial_end_date === '2099-01-01' &&
  obj.max_users === 999 &&
  obj.max_leads === 999 &&
  obj.max_customers === 999;
// On CREATE, everything except subscription_status (which is re-forced to
// 'pending') must be gone.
const nonStatusStripped = (obj) =>
  ['subscription_plan', 'trial_ends_at', 'trial_end_date', 'max_users', 'max_leads', 'max_customers']
    .every((f) => !has(obj, f));

// 1. The list itself covers every subscription/plan column (both trial spellings).
ok('protected list has exactly 7 fields', Array.isArray(SUBS) && SUBS.length === 7);
for (const f of ['subscription_plan', 'subscription_status', 'trial_ends_at', 'trial_end_date', 'max_users', 'max_leads', 'max_customers']) {
  ok(`protected list includes ${f}`, SUBS.includes(f));
}

// 2. UPDATE: strip every subscription field, keep the rest, and do NOT invent a
//    status (forcing one on update would silently downgrade a live company).
const upd = strip(tenant, 'companies', allSubFields(), false, 'PUT companies');
ok('update strips all subscription fields', allStripped(upd));
ok('update keeps non-subscription fields', upd.company_name === 'Acme Roofing');
ok('update does NOT force a status', !has(upd, 'subscription_status'));

// 3. CREATE: strip plan/trial/limits AND force subscription_status='pending' so a
//    self-granted 'active' can't survive and the DB default can't take over.
const cre = strip(tenant, 'companies', allSubFields(), true, 'POST companies');
ok('create strips plan/trial/limit fields', nonStatusStripped(cre));
ok('create forces subscription_status=pending (defeats self-grant AND DB default)', cre.subscription_status === 'pending');
ok('create keeps non-subscription fields', cre.company_name === 'Acme Roofing');

// 4. CREATE with no subscription fields at all STILL forces pending (the DB
//    default is 'active', so an untouched create would be a free active company).
const creBare = strip(tenant, 'companies', { company_name: 'Bare Co' }, true, 'POST companies');
ok('create with no subscription fields still forces pending', creBare.subscription_status === 'pending');
ok('create with no subscription fields keeps name', creBare.company_name === 'Bare Co');

// 5. Super-admin bypasses entirely — keeps every field, no forced status.
ok('super-admin update keeps all fields', keepsAll(strip(superAdmin, 'companies', allSubFields(), false, 'PUT companies')));
const superCreate = strip(superAdmin, 'companies', allSubFields(), true, 'POST companies');
ok('super-admin create keeps all fields', keepsAll(superCreate));
ok('super-admin create is NOT forced to pending (bypass)', superCreate.subscription_status === 'active');

// 6. Internal service token bypasses too (webhook/backup restore paths).
ok('service token update keeps all fields', keepsAll(strip(service, 'companies', allSubFields(), false, 'PUT companies')));
ok('service token create keeps all fields', keepsAll(strip(service, 'companies', allSubFields(), true, 'POST companies')));

// 7. Non-company entities are never touched and never forced to pending.
const onLeadUpd = strip(tenant, 'leads', { name: 'x', subscription_status: 'active', max_users: 5 }, false, 'PUT leads');
ok('non-company update is left untouched', onLeadUpd.subscription_status === 'active' && onLeadUpd.max_users === 5);
const onLeadCre = strip(tenant, 'leads', { name: 'x' }, true, 'POST leads');
ok('non-company create is NOT forced to pending', !has(onLeadCre, 'subscription_status'));

// 8. A wrong-case / unmapped alias must NOT be treated as companies (the route
//    resolves 'Company'/'Companies' to 'companies' BEFORE calling the guard).
ok('capitalized Companies is NOT treated as companies', strip(tenant, 'Companies', allSubFields(), false, 'PUT Companies').subscription_status === 'active');
const aliasCreate = strip(tenant, 'Company', allSubFields(), true, 'POST Company');
ok('SDK alias Company is NOT treated as companies', aliasCreate.subscription_status === 'active');
ok('SDK alias Company create is NOT forced to pending', aliasCreate.max_users === 999);

// 9. Partial bodies: only the present subscription field is removed.
const partialUpd = strip(tenant, 'companies', { name: 'y', trial_ends_at: '2099-01-01' }, false, 'PUT companies');
ok('partial update strips the present subscription field', partialUpd.trial_ends_at === undefined);
ok('partial update keeps the other field', partialUpd.name === 'y');

// 9b. CORE REGRESSION: nested `data` JSONB bypass. trial_ends_at / max_customers
//     are NOT real columns — they live only in the companies `data` JSONB and are
//     merged over the columns on read. A `{data:{...}}` body must be stripped there
//     too, or a tenant perpetually extends their own trial past a top-level strip.
const nestedUpd = strip(tenant, 'companies', { name: 'y', data: { trial_ends_at: '2099-01-01', max_customers: 999999, keep: 1 } }, false, 'PUT companies');
ok('nested update strips data.trial_ends_at', !Object.prototype.hasOwnProperty.call(nestedUpd.data, 'trial_ends_at'));
ok('nested update strips data.max_customers', !Object.prototype.hasOwnProperty.call(nestedUpd.data, 'max_customers'));
ok('nested update keeps other data fields', nestedUpd.data.keep === 1);
ok('nested update keeps top-level fields', nestedUpd.name === 'y');
const nestedCre = strip(tenant, 'companies', { name: 'z', data: { subscription_status: 'active', trial_ends_at: '2099-01-01' } }, true, 'POST companies');
ok('nested create strips data.subscription_status', !Object.prototype.hasOwnProperty.call(nestedCre.data, 'subscription_status'));
ok('nested create strips data.trial_ends_at', !Object.prototype.hasOwnProperty.call(nestedCre.data, 'trial_ends_at'));
ok('nested create still forces top-level pending', nestedCre.subscription_status === 'pending');
ok('nested strip does not mutate original body.data', (() => { const b = { data: { trial_ends_at: 'x' } }; strip(tenant, 'companies', b, false, 'PUT companies'); return b.data.trial_ends_at === 'x'; })());
ok('super-admin keeps nested data subscription fields', strip(superAdmin, 'companies', { data: { trial_ends_at: '2099-01-01' } }, false, 'PUT companies').data.trial_ends_at === '2099-01-01');
ok('body whose data has no subscription fields is unchanged (same ref)', (() => { const b = { data: { keep: 1 } }; return strip(tenant, 'companies', b, false, 'PUT companies') === b; })());

// 10. Non-object / empty bodies are returned as-is without throwing.
ok('null body update returns null', strip(tenant, 'companies', null, false, 'PUT companies') === null);
ok('null body create returns null', strip(tenant, 'companies', null, true, 'POST companies') === null);

// 11. An update with no subscription fields is returned unchanged (same ref).
ok('update with no subscription fields returns the same object', (() => { const b = { name: 'z' }; return strip(tenant, 'companies', b, false, 'PUT companies') === b; })());

console.log(`\n[tenant-guard-subscription] ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
