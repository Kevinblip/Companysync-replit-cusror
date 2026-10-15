#!/usr/bin/env node
/**
 * Plan Feature Gate Smoke Test
 * ─────────────────────────────
 * Verifies that each subscription plan only has access to its allowed features
 * and that numeric limits (users, leads, customers) are configured correctly.
 *
 * Requires the three test companies created by:
 *   npm run seed:plan-companies
 *
 * Tests are grouped into three sections:
 *   1. DB state   — companies exist with correct plan/status/limit fields
 *   2. hasFeature — the feature-access logic returns the right allow/block
 *   3. Limits     — checkSubscriptionLimits API returns the right ceiling
 *
 * Prerequisites:
 *   - App server running on PORT (default 5000) — `npm run dev`
 *   - npm run seed:plan-companies must have been run at least once
 *
 * Usage:  node scripts/test-plan-feature-gates.cjs
 *         npm run test:plan-gates
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http     = require('http');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool     = createPool({ connectionString: process.env.DATABASE_URL });

const BASIC_ID      = 'plan_test_basic';
const BUSINESS_ID   = 'plan_test_business';
const ENTERPRISE_ID = 'plan_test_enterprise';

// ── Counters ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function ok(name, cond, got) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else       { console.log(`  ✗ ${name}${got !== undefined ? ` (got: ${JSON.stringify(got)})` : ''}`); failed++; }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port:     u.port || 80,
        path:     u.pathname + u.search,
        method:   opts.method || 'GET',
        headers:  { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      },
      (res) => {
        let b = '';
        res.on('data', c => (b += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
          catch { resolve({ status: res.statusCode, body: b }); }
        });
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

const crypto = require('crypto');
let invokeCookie = '';

async function ensureInvokeSession(db) {
  if (invokeCookie) return;
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required for checkSubscriptionLimits');
  const sid = 'plan_gate_session_001';
  const session = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email: 'test@basic.test', sub: 'plan_test_user_basic' } } },
  };
  await db.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
    [sid, JSON.stringify(session), new Date(Date.now() + 3600000)],
  );
  const signature = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
  invokeCookie = `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}

async function invokeFunction(name, params = {}) {
  const r = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    headers: invokeCookie ? { Cookie: invokeCookie } : {},
    body: { functionName: name, params },
  });
  return r.body?.data ?? r.body;
}

// ── Load gate logic from the real source of truth ────────────────────────────
// We dynamically parse src/components/SubscriptionGate.jsx so the test always
// exercises the live PLAN_FEATURES / hasFeatureAccess definitions.  If someone
// changes those values in the source file the test immediately reflects it —
// there is no local copy that can silently drift.
const path = require('path');
const fs   = require('fs');
const vm   = require('vm');

function loadGateLogicFromSource() {
  const filePath = path.resolve(__dirname, '../src/components/SubscriptionGate.jsx');
  let src;
  try {
    src = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read gate source file: ${filePath}\n${e.message}`);
  }

  // Truncate before the React component — JSX can't run in vm.runInNewContext.
  // React components are PascalCase; helper functions (hasFeatureAccess) are
  // camelCase, so matching an uppercase first letter avoids cutting them off.
  const componentBoundary = src.search(/\nexport\s+(?:default\s+)?function\s+[A-Z]\w*\s*[({]/);
  const purePart = (componentBoundary >= 0 ? src.slice(0, componentBoundary) : src)
    // Remove all ES module import lines (not runnable in vm context)
    .replace(/^import\s+.*$/gm, '')
    // Drop 'export' keyword
    .replace(/^export\s+(const|let|var|function)\s+/gm, '$1 ')
    // Replace const/let with var so vm.runInNewContext exposes them on the ctx object
    // (block-scoped const/let are NOT accessible as ctx properties after runInNewContext)
    .replace(/\bconst\b/g, 'var')
    .replace(/\blet\b/g, 'var');

  const ctx = {};
  vm.createContext(ctx);
  try {
    vm.runInNewContext(purePart, ctx);
  } catch (e) {
    throw new Error(`Failed to evaluate gate logic from ${filePath}: ${e.message}`);
  }

  if (typeof ctx.hasFeatureAccess !== 'function') {
    throw new Error('hasFeatureAccess not found in SubscriptionGate.jsx — has the file structure changed?');
  }
  if (!ctx.PLAN_FEATURES || !ctx.PLAN_FEATURES.basic) {
    throw new Error('PLAN_FEATURES not found in SubscriptionGate.jsx — has the file structure changed?');
  }

  return {
    PLAN_FEATURES:       ctx.PLAN_FEATURES,
    SUBSCRIPTION_LIMITS: ctx.SUBSCRIPTION_LIMITS,
    hasFeatureAccess:    ctx.hasFeatureAccess,
  };
}

// Fail fast if the source file can't be parsed — no point running gate checks
// against a stale or missing implementation.
let PLAN_FEATURES, hasFeatureAccess;
try {
  ({ PLAN_FEATURES, hasFeatureAccess } = loadGateLogicFromSource());
} catch (gateLoadErr) {
  console.error('\n✗ Could not load gate logic from source:', gateLoadErr.message);
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('\n── Plan Feature Gate Smoke Test ───────────────────────────────\n');

    // Verify server — wait up to 60s (all test workflows start at once and the
    // dev server may still be booting or busy; a single probe loses that race)
    {
      let up = false;
      for (let i = 0; i < 30 && !up; i++) {
        try { await fetchJson(`${BASE_URL}/api/health`); up = true; }
        catch { await new Promise(r => setTimeout(r, 2000)); }
      }
      if (!up) {
        console.error(`✗ Server not reachable at ${BASE_URL} after 60s. Start with: npm run dev`);
        process.exit(1);
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 1: DB State — companies exist with correct fields
    // ════════════════════════════════════════════════════════════════════════
    console.log('[ 1 ] DB State — companies and limit columns\n');

    const compRes = await pool.query(
      `SELECT id, company_name, subscription_plan, subscription_status,
              max_users, max_leads, features_enabled, onboarding_completed
       FROM companies WHERE id = ANY($1)`,
      [[BASIC_ID, BUSINESS_ID, ENTERPRISE_ID]]
    );
    const byId = {};
    for (const r of compRes.rows) byId[r.id] = r;

    // Basic
    {
      const c = byId[BASIC_ID];
      ok('Basic company exists',               !!c);
      ok('Basic plan = basic',                  c?.subscription_plan === 'basic',          c?.subscription_plan);
      ok('Basic status = active',               c?.subscription_status === 'active',       c?.subscription_status);
      ok('Basic max_users = 5',                 c?.max_users === 5,                        c?.max_users);
      ok('Basic max_leads = 250',               c?.max_leads === 250 || c?.max_leads === '250', c?.max_leads);
      ok('Basic max_customers = 100 (JSONB)',   c?.features_enabled?.max_customers === 100, c?.features_enabled?.max_customers);
      ok('Basic onboarding_completed = true',   c?.onboarding_completed === true);
    }
    console.log('');

    // Business
    {
      const c = byId[BUSINESS_ID];
      ok('Business company exists',                  !!c);
      ok('Business plan = business',                  c?.subscription_plan === 'business',       c?.subscription_plan);
      ok('Business status = active',                  c?.subscription_status === 'active',       c?.subscription_status);
      ok('Business max_users = 10',                   c?.max_users === 10,                       c?.max_users);
      ok('Business max_leads = null (unlimited)',      c?.max_leads === null,                     c?.max_leads);
      ok('Business max_customers = 1000 (JSONB)',     c?.features_enabled?.max_customers === 1000, c?.features_enabled?.max_customers);
      ok('Business onboarding_completed = true',      c?.onboarding_completed === true);
    }
    console.log('');

    // Enterprise
    {
      const c = byId[ENTERPRISE_ID];
      ok('Enterprise company exists',                     !!c);
      ok('Enterprise plan = enterprise',                   c?.subscription_plan === 'enterprise',     c?.subscription_plan);
      ok('Enterprise status = active',                     c?.subscription_status === 'active',       c?.subscription_status);
      ok('Enterprise max_users = 25',                      c?.max_users === 25,                       c?.max_users);
      ok('Enterprise max_leads = null (unlimited)',         c?.max_leads === null,                     c?.max_leads);
      ok('Enterprise max_customers = null (unlimited)',     c?.features_enabled?.max_customers === null, c?.features_enabled?.max_customers);
      ok('Enterprise onboarding_completed = true',         c?.onboarding_completed === true);
    }
    console.log('');

    // Staff logins exist
    const staffRes = await pool.query(
      `SELECT user_email, company_id, is_administrator FROM staff_profiles
       WHERE id = ANY($1)`,
      [['plan_test_staff_basic', 'plan_test_staff_business', 'plan_test_staff_enterprise']]
    );
    const staffByCompany = {};
    for (const r of staffRes.rows) staffByCompany[r.company_id] = r;

    ok('Basic staff profile exists as admin',      staffByCompany[BASIC_ID]?.is_administrator === true);
    ok('Business staff profile exists as admin',   staffByCompany[BUSINESS_ID]?.is_administrator === true);
    ok('Enterprise staff profile exists as admin', staffByCompany[ENTERPRISE_ID]?.is_administrator === true);

    const userRes = await pool.query(
      `SELECT email, is_local_auth, must_change_password FROM users
       WHERE email = ANY($1)`,
      [['test@basic.test', 'test@business.test', 'test@enterprise.test']]
    );
    const userByEmail = {};
    for (const r of userRes.rows) userByEmail[r.email] = r;

    ok('Basic login user exists (is_local_auth)',      userByEmail['test@basic.test']?.is_local_auth === true);
    ok('Business login user exists (is_local_auth)',   userByEmail['test@business.test']?.is_local_auth === true);
    ok('Enterprise login user exists (is_local_auth)', userByEmail['test@enterprise.test']?.is_local_auth === true);
    ok('Basic must_change_password = false',           userByEmail['test@basic.test']?.must_change_password === false);
    ok('Business must_change_password = false',        userByEmail['test@business.test']?.must_change_password === false);
    ok('Enterprise must_change_password = false',      userByEmail['test@enterprise.test']?.must_change_password === false);

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 2: Feature access logic (mirrors hasFeatureAccess)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[ 2 ] hasFeatureAccess — feature allow/block by plan\n');

    // ── Basic: core features allowed, Business/Enterprise blocked ──────────
    console.log('  Basic plan:');
    ok('  basic → customers (allowed)',        hasFeatureAccess('basic', 'customers'));
    ok('  basic → estimates (allowed)',        hasFeatureAccess('basic', 'estimates'));
    ok('  basic → invoices (allowed)',         hasFeatureAccess('basic', 'invoices'));
    ok('  basic → calendar (allowed)',         hasFeatureAccess('basic', 'calendar'));
    ok('  basic → storm_tracking (BLOCKED)',   !hasFeatureAccess('basic', 'storm_tracking'));
    ok('  basic → sarah_ai (BLOCKED)',         !hasFeatureAccess('basic', 'sarah_ai'));
    // Product decision: workflow automation is available to every paid subscriber.
    ok('  basic → workflows (allowed)', hasFeatureAccess('basic', 'workflows'));
    ok('  basic → campaigns (BLOCKED)',        !hasFeatureAccess('basic', 'campaigns'));
    ok('  basic → accounting_full (BLOCKED)',  !hasFeatureAccess('basic', 'accounting_full'));
    ok('  basic → subcontractors (BLOCKED)',   !hasFeatureAccess('basic', 'subcontractors'));
    ok('  basic → advanced_analytics (BLOCKED)', !hasFeatureAccess('basic', 'advanced_analytics'));

    // ── Business: Basic + Business features, Enterprise blocked ────────────
    console.log('\n  Business plan:');
    ok('  business → customers (allowed)',         hasFeatureAccess('business', 'customers'));
    ok('  business → estimates (allowed)',         hasFeatureAccess('business', 'estimates'));
    ok('  business → storm_tracking (allowed)',    hasFeatureAccess('business', 'storm_tracking'));
    ok('  business → sarah_ai (allowed)',          hasFeatureAccess('business', 'sarah_ai'));
    ok('  business → workflows (allowed)',         hasFeatureAccess('business', 'workflows'));
    ok('  business → campaigns (allowed)',         hasFeatureAccess('business', 'campaigns'));
    ok('  business → commission_tracking (allowed)', hasFeatureAccess('business', 'commission_tracking'));
    ok('  business → quickbooks (allowed)',        hasFeatureAccess('business', 'quickbooks'));
    ok('  business → accounting_full (BLOCKED)',   !hasFeatureAccess('business', 'accounting_full'));
    ok('  business → subcontractors (BLOCKED)',    !hasFeatureAccess('business', 'subcontractors'));
    ok('  business → advanced_analytics (BLOCKED)', !hasFeatureAccess('business', 'advanced_analytics'));
    ok('  business → white_label_portal (BLOCKED)', !hasFeatureAccess('business', 'white_label_portal'));

    // ── Enterprise: everything allowed ─────────────────────────────────────
    console.log('\n  Enterprise plan:');
    ok('  enterprise → customers (allowed)',           hasFeatureAccess('enterprise', 'customers'));
    ok('  enterprise → storm_tracking (allowed)',      hasFeatureAccess('enterprise', 'storm_tracking'));
    ok('  enterprise → sarah_ai (allowed)',            hasFeatureAccess('enterprise', 'sarah_ai'));
    ok('  enterprise → workflows (allowed)',           hasFeatureAccess('enterprise', 'workflows'));
    ok('  lifetime → workflows (allowed)',             hasFeatureAccess('lifetime', 'workflows'));
    ok('  legacy → workflows (allowed)',               hasFeatureAccess('legacy', 'workflows'));
    ok('  unlimited → workflows (allowed)',            hasFeatureAccess('unlimited', 'workflows'));
    ok('  professional → workflows (allowed)',         hasFeatureAccess('professional', 'workflows'));
    ok('  enterprise → accounting_full (allowed)',     hasFeatureAccess('enterprise', 'accounting_full'));
    ok('  enterprise → subcontractors (allowed)',      hasFeatureAccess('enterprise', 'subcontractors'));
    ok('  enterprise → advanced_analytics (allowed)',  hasFeatureAccess('enterprise', 'advanced_analytics'));
    ok('  enterprise → white_label_portal (allowed)',  hasFeatureAccess('enterprise', 'white_label_portal'));
    ok('  enterprise → api_access (allowed)',          hasFeatureAccess('enterprise', 'api_access'));

    // ── Trial mirrors Basic ─────────────────────────────────────────────────
    console.log('\n  Trial plan (mirrors Basic):');
    ok('  trial → customers (allowed)',        hasFeatureAccess('trial', 'customers'));
    ok('  trial → storm_tracking (BLOCKED)',   !hasFeatureAccess('trial', 'storm_tracking'));
    ok('  trial → sarah_ai (BLOCKED)',         !hasFeatureAccess('trial', 'sarah_ai'));

    // ── Unknown plan blocks everything ─────────────────────────────────────
    ok('  unknown plan → customers (BLOCKED)', !hasFeatureAccess('', 'customers'));

    // ════════════════════════════════════════════════════════════════════════
    // SECTION 3: Numeric limits via checkSubscriptionLimits API
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[ 3 ] Numeric limits — checkSubscriptionLimits API\n');
    await ensureInvokeSession(pool);

    const ENTITY_TYPES = ['staff', 'lead', 'customer'];
    const EXPECTED_LIMITS = {
      [BASIC_ID]:      { staff: 5,      lead: 250,   customer: 100  },
      [BUSINESS_ID]:   { staff: 10,     lead: 999999, customer: 1000 },
      [ENTERPRISE_ID]: { staff: 25,     lead: 999999, customer: 999999 },
    };
    const PLAN_LABELS = {
      [BASIC_ID]:      'Basic',
      [BUSINESS_ID]:   'Business',
      [ENTERPRISE_ID]: 'Enterprise',
    };

    for (const [companyId, expected] of Object.entries(EXPECTED_LIMITS)) {
      const label = PLAN_LABELS[companyId];
      for (const entityType of ENTITY_TYPES) {
        const r = await invokeFunction('checkSubscriptionLimits', { company_id: companyId, entity_type: entityType });
        const gotLimit = r?.limit;
        const expLimit = expected[entityType];
        ok(
          `${label} ${entityType} limit = ${expLimit === 999999 ? '∞ (999999)' : expLimit}`,
          gotLimit === expLimit,
          gotLimit
        );
        // Also confirm can_create is true when there's no data
        ok(
          `${label} ${entityType} can_create = true (empty company)`,
          r?.can_create === true || r?.allowed === true,
          r?.can_create
        );
      }
      console.log('');
    }

    // ════════════════════════════════════════════════════════════════════════
    // Results
    // ════════════════════════════════════════════════════════════════════════
    console.log('── Summary ────────────────────────────────────────────────────');
    console.log(`   Passed: ${passed}   Failed: ${failed}`);
    if (failed > 0) {
      console.log('\n✗ Some tests failed — see details above.');
      console.log('  If companies are missing, run: npm run seed:plan-companies\n');
      process.exit(1);
    } else {
      console.log('\n✓ All tests passed.\n');
    }

  } catch (err) {
    console.error('\n✗ Unexpected error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
