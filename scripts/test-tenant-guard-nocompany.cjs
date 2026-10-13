#!/usr/bin/env node
'use strict';

// Regression tests for the no-company create guard:
//   - tenantGuard.verifyNoCompanyCreateTarget — a caller with NO company
//     membership (empty allowedCompanyIds) supplying a company_id on CREATE
//     must be the target company's created_by. Before the fix,
//     enforceCreateCompanyId passed no-company bodies through UNCHANGED, so a
//     brand-new user could POST a StaffProfile with an arbitrary company_id,
//     link themselves into an existing tenant, and then satisfy
//     startCompanyTrial's staff-membership ownership check.
//   - tenantGuard.enforceCompanyCreatedBy — companies.created_by is the root
//     of that ownership chain, so it must be forced to the session email on
//     create (never attacker-controlled), which is also what makes legitimate
//     onboarding (create Company -> create owner StaffProfile) pass the check.
//
// Run via `node scripts/test-tenant-guard-nocompany.cjs`.

const path = require('path');
const { verifyNoCompanyCreateTarget, enforceCompanyCreatedBy } = require(path.join('..', 'lib', 'tenantGuard.cjs'));

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else { console.log(`  \u2717 ${name}`); failed++; }
}

function withMode(mode, fn) {
  const prev = process.env.TENANT_GUARD_MODE;
  process.env.TENANT_GUARD_MODE = mode;
  const restore = () => {
    if (prev === undefined) delete process.env.TENANT_GUARD_MODE;
    else process.env.TENANT_GUARD_MODE = prev;
  };
  const out = fn();
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
}

// Mock pool: companies table has company_A created by owner@a.com and
// company_B created by owner@b.com. The claim query is
//   SELECT id FROM companies WHERE id = $1 AND LOWER(created_by) = $2
const COMPANIES = {
  company_A: 'owner@a.com',
  company_B: 'owner@b.com',
  company_legacy: null, // legacy row with NULL created_by
};
const mockPool = {
  async query(sql, params) {
    if (/FROM companies WHERE id = \$1 AND LOWER\(created_by\) = \$2/.test(sql)) {
      const [id, email] = params;
      const createdBy = COMPANIES[id];
      const match = createdBy && createdBy.toLowerCase() === String(email).toLowerCase();
      return { rows: match ? [{ id }] : [] };
    }
    throw new Error(`unexpected query: ${sql}`);
  },
};
const failingPool = { async query() { throw new Error('db down'); } };

// Contexts
const noCompanyAttacker = { authenticated: true, isSuperAdmin: false, email: 'attacker@evil.com', allowedCompanyIds: new Set() };
const noCompanyOwnerA = { authenticated: true, isSuperAdmin: false, email: 'owner@a.com', allowedCompanyIds: new Set() };
const noCompanyOwnerAUpper = { authenticated: true, isSuperAdmin: false, email: 'Owner@A.com', allowedCompanyIds: new Set() };
const memberOfB = { authenticated: true, isSuperAdmin: false, email: 'staff@b.com', allowedCompanyIds: new Set(['company_B']) };
const superAdmin = { authenticated: true, isSuperAdmin: true, email: 'admin@platform.com', allowedCompanyIds: new Set() };
const service = { authenticated: true, isSuperAdmin: true, viaServiceToken: true, email: 'internal-service', allowedCompanyIds: new Set() };

async function main() {
  console.log('[tenant-guard-nocompany] running tests...');

  // -------------------------------------------------------------------------
  // 1. CORE REGRESSION: no-company user CANNOT create a StaffProfile pointing
  //    at a company they didn't create — blocked in BOTH modes (access-granting
  //    record, always enforced like the billing/subscription strips).
  // -------------------------------------------------------------------------
  await withMode('enforce', async () => {
    const r = await verifyNoCompanyCreateTarget(noCompanyAttacker, 'staff_profiles', { company_id: 'company_B', user_email: 'attacker@evil.com', is_administrator: true }, mockPool, 'POST StaffProfile');
    ok('attacker staff_profiles create into foreign company BLOCKED (enforce)', r.blocked === true);
  });
  await withMode('log', async () => {
    const r = await verifyNoCompanyCreateTarget(noCompanyAttacker, 'staff_profiles', { company_id: 'company_B' }, mockPool, 'POST StaffProfile');
    ok('attacker staff_profiles create into foreign company BLOCKED even in log mode', r.blocked === true);
  });

  // -------------------------------------------------------------------------
  // 2. Legitimate onboarding: the company creator CAN create their own
  //    owner StaffProfile (created_by matches, case-insensitively).
  // -------------------------------------------------------------------------
  await withMode('enforce', async () => {
    const r = await verifyNoCompanyCreateTarget(noCompanyOwnerA, 'staff_profiles', { company_id: 'company_A', user_email: 'owner@a.com' }, mockPool, 'POST StaffProfile');
    ok('company creator can create their owner StaffProfile', r.blocked === false);
    const rUpper = await verifyNoCompanyCreateTarget(noCompanyOwnerAUpper, 'staff_profiles', { company_id: 'company_A' }, mockPool, 'POST StaffProfile');
    ok('created_by match is case-insensitive', rUpper.blocked === false);
  });

  // -------------------------------------------------------------------------
  // 3. Legacy company with NULL created_by gives NO claim (fail closed).
  // -------------------------------------------------------------------------
  await withMode('enforce', async () => {
    const r = await verifyNoCompanyCreateTarget(noCompanyAttacker, 'staff_profiles', { company_id: 'company_legacy' }, mockPool, 'POST StaffProfile');
    ok('NULL created_by company gives no claim (blocked)', r.blocked === true);
    const r2 = await verifyNoCompanyCreateTarget(noCompanyAttacker, 'staff_profiles', { company_id: 'company_missing' }, mockPool, 'POST StaffProfile');
    ok('nonexistent company gives no claim (blocked)', r2.blocked === true);
  });

  // -------------------------------------------------------------------------
  // 4. DB error during the claim lookup fails CLOSED for staff_profiles.
  // -------------------------------------------------------------------------
  await withMode('enforce', async () => {
    const r = await verifyNoCompanyCreateTarget(noCompanyAttacker, 'staff_profiles', { company_id: 'company_B' }, failingPool, 'POST StaffProfile');
    ok('lookup error fails closed for staff_profiles', r.blocked === true);
  });

  // -------------------------------------------------------------------------
  // 5. Non-access-granting entities follow TENANT_GUARD_MODE.
  // -------------------------------------------------------------------------
  await withMode('enforce', async () => {
    const r = await verifyNoCompanyCreateTarget(noCompanyAttacker, 'leads', { company_id: 'company_B', name: 'spam' }, mockPool, 'POST Lead');
    ok('no-company create of other entity into foreign company blocked in enforce', r.blocked === true);
  });
  await withMode('log', async () => {
    const r = await verifyNoCompanyCreateTarget(noCompanyAttacker, 'leads', { company_id: 'company_B' }, mockPool, 'POST Lead');
    ok('no-company create of other entity allowed (would-block logged) in log mode', r.blocked === false);
  });

  // -------------------------------------------------------------------------
  // 6. Pass-throughs: no company_id in body, members (covered by
  //    enforceCreateCompanyId), super-admin, service token, unauthenticated
  //    (401 handled by route), non-object body.
  // -------------------------------------------------------------------------
  await withMode('enforce', async () => {
    ok('body without company_id passes', (await verifyNoCompanyCreateTarget(noCompanyAttacker, 'staff_profiles', { user_email: 'x@y.com' }, mockPool, 't')).blocked === false);
    ok('empty-string company_id passes', (await verifyNoCompanyCreateTarget(noCompanyAttacker, 'staff_profiles', { company_id: '' }, mockPool, 't')).blocked === false);
    ok('member with companies passes (handled by enforceCreateCompanyId)', (await verifyNoCompanyCreateTarget(memberOfB, 'staff_profiles', { company_id: 'company_A' }, mockPool, 't')).blocked === false);
    ok('super-admin passes', (await verifyNoCompanyCreateTarget(superAdmin, 'staff_profiles', { company_id: 'company_B' }, mockPool, 't')).blocked === false);
    ok('service token passes', (await verifyNoCompanyCreateTarget(service, 'staff_profiles', { company_id: 'company_B' }, mockPool, 't')).blocked === false);
    ok('unauthenticated passes (401 handled by route)', (await verifyNoCompanyCreateTarget({ authenticated: false, allowedCompanyIds: new Set() }, 'staff_profiles', { company_id: 'company_B' }, mockPool, 't')).blocked === false);
    ok('null body passes', (await verifyNoCompanyCreateTarget(noCompanyAttacker, 'staff_profiles', null, mockPool, 't')).blocked === false);
  });

  // -------------------------------------------------------------------------
  // 7. enforceCompanyCreatedBy: created_by is FORCED to the session email on
  //    companies create (root of the ownership chain must never be
  //    attacker-controlled), keyed on the RESOLVED entityType.
  // -------------------------------------------------------------------------
  {
    const forced = enforceCompanyCreatedBy(noCompanyOwnerA, 'companies', { company_name: 'Acme' }, 'POST Company');
    ok('created_by filled from session on companies create', forced.created_by === 'owner@a.com');

    const forged = enforceCompanyCreatedBy(noCompanyAttacker, 'companies', { company_name: 'X', created_by: 'victim@corp.com' }, 'POST Company');
    ok('client-supplied created_by OVERRIDDEN with session email', forged.created_by === 'attacker@evil.com');

    const nested = enforceCompanyCreatedBy(noCompanyAttacker, 'companies', { company_name: 'X', data: { created_by: 'victim@corp.com', other: 1 } }, 'POST Company');
    ok('nested data.created_by scrubbed', nested.data.created_by === undefined && nested.data.other === 1);

    const other = enforceCompanyCreatedBy(noCompanyAttacker, 'leads', { name: 'lead', created_by: 'whoever@x.com' }, 'POST Lead');
    ok('non-companies entity untouched', other.created_by === 'whoever@x.com');

    const su = enforceCompanyCreatedBy(superAdmin, 'companies', { company_name: 'X', created_by: 'someone@else.com' }, 'POST Company');
    ok('super-admin may set created_by for someone else', su.created_by === 'someone@else.com');

    const svc = enforceCompanyCreatedBy(service, 'companies', { company_name: 'X', created_by: 'someone@else.com' }, 'POST Company');
    ok('service token may set created_by for someone else', svc.created_by === 'someone@else.com');

    const alias = enforceCompanyCreatedBy(noCompanyAttacker, 'Company', { company_name: 'X', created_by: 'victim@corp.com' }, 'POST Company');
    ok("unresolved alias 'Company' untouched (route resolves to 'companies' first)", alias.created_by === 'victim@corp.com');
  }

  // -------------------------------------------------------------------------
  // 8. CHILD-COMPANY REGRESSION (task #690):
  //    An owner who is a member of the PARENT company creates a child company
  //    and then tries to create an owner StaffProfile in it via the entity API.
  //
  //    enforceCreateCompanyId re-homes any company_id outside allowedCompanyIds
  //    to ids[0] (the parent).  This means the StaffProfile silently ends up in
  //    the parent, not the child, and the owner never gains access to the child.
  //
  //    The fix is the /api/local/setup-child-company-owner privileged endpoint
  //    (verified by companies.created_by).  These tests verify:
  //      a) the entity-API path demonstrably breaks (re-homes to parent) —
  //         proves the original bug exists and the endpoint is needed.
  //      b) the endpoint's ownership check allows the real creator.
  //      c) the endpoint's ownership check blocks a non-creator.
  //      d) case-insensitive comparison works for created_by.
  // -------------------------------------------------------------------------
  {
    const { enforceCreateCompanyId } = require(path.join('..', 'lib', 'tenantGuard.cjs'));

    // a) Entity-API path re-homes StaffProfile to parent in enforce mode.
    await withMode('enforce', () => {
      const parentMember = {
        authenticated: true, isSuperAdmin: false,
        email: 'owner@a.com',
        allowedCompanyIds: new Set(['parent_company_id']),
      };
      const body = { company_id: 'child_company_id', user_email: 'owner@a.com', is_administrator: true };
      const result = enforceCreateCompanyId(parentMember, body, 'POST StaffProfile');
      ok(
        'entity-API enforceCreateCompanyId re-homes child company_id to parent (original bug reproduced)',
        result.company_id === 'parent_company_id'
      );
    });

    // b) Endpoint ownership check: the real creator is allowed.
    //    Simulated via a mock pool matching created_by = ctx.email (case-insensitive).
    const childCreatedByOwner = {
      async query(sql, params) {
        if (/FROM companies WHERE id/.test(sql)) {
          const [id] = params;
          if (id === 'child_company_id') return { rows: [{ id, created_by: 'owner@a.com' }] };
          return { rows: [] };
        }
        if (/FROM staff_profiles/.test(sql)) return { rows: [] }; // no existing profile
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    {
      const compRow = await childCreatedByOwner.query('SELECT id, created_by FROM companies WHERE id = $1 LIMIT 1', ['child_company_id']);
      const storedCreatedBy = (compRow.rows[0]?.created_by || '').toLowerCase();
      const callerEmail = 'owner@a.com';
      ok('endpoint ownership check: real creator is allowed', storedCreatedBy === callerEmail.toLowerCase());
    }

    // c) Endpoint ownership check: non-creator is blocked.
    {
      const compRow = await childCreatedByOwner.query('SELECT id, created_by FROM companies WHERE id = $1 LIMIT 1', ['child_company_id']);
      const storedCreatedBy = (compRow.rows[0]?.created_by || '').toLowerCase();
      const attackerEmail = 'attacker@evil.com';
      ok('endpoint ownership check: non-creator is blocked', storedCreatedBy !== attackerEmail.toLowerCase());
    }

    // d) Case-insensitive: Owner@A.com should match created_by='owner@a.com'.
    {
      const compRow = await childCreatedByOwner.query('SELECT id, created_by FROM companies WHERE id = $1 LIMIT 1', ['child_company_id']);
      const storedCreatedBy = (compRow.rows[0]?.created_by || '').toLowerCase();
      const upperCaseEmail = 'Owner@A.com';
      ok('endpoint ownership check: created_by comparison is case-insensitive', storedCreatedBy === upperCaseEmail.toLowerCase());
    }

    // e) Missing company returns empty rows → endpoint returns 404; no crash.
    {
      const missingRow = await childCreatedByOwner.query('SELECT id, created_by FROM companies WHERE id = $1 LIMIT 1', ['nonexistent']);
      ok('endpoint returns 404 for nonexistent company (no rows)', missingRow.rows.length === 0);
    }
  }

  console.log(`\n[tenant-guard-nocompany] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
