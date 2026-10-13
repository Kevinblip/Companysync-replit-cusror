#!/usr/bin/env node
/**
 * Enterprise AI Interaction Cap Smoke Test
 * ─────────────────────────────────────────
 * Verifies that the 50,000/month AI interaction cap for Enterprise plan
 * companies is correctly enforced by checkAIUsage() in vite-functions-plugin.js.
 *
 * Assertions:
 *   A. Enterprise company with 49,999 interactions → allowed = true
 *   B. Enterprise company with 50,000 interactions → allowed = false
 *   C. Enterprise company with 50,001 interactions but BYOK Gemini key → allowed = true
 *
 * Each group uses a separate company ID so the 5-minute in-memory
 * _aiUsageCache never carries a stale result across groups.
 *
 * The test data uses total_cost = 0 deliberately so the dollar-based spend
 * circuit breaker ($200 hard cap) never fires — isolating the count cap as
 * the sole variable under test.
 *
 * Prerequisites:
 *   - App server running on PORT (default 5000) — `npm run dev`
 *   - DATABASE_URL env var set (same DB the server uses)
 *   - SESSION_SECRET env var set (used to sign forged session cookies in other
 *     tests; not directly needed here but required by the running server)
 *   - ENCRYPTION_KEY env var set — required for the BYOK assertion (group C).
 *     The test encrypts the fake Gemini key with AES-256-GCM using this 32-byte
 *     hex key, matching what encryptApiKey()/decryptApiKey() expect server-side.
 *     In this project ENCRYPTION_KEY is set in replit.nix userenv.shared.
 *
 * Usage:  node scripts/test-enterprise-ai-cap.cjs
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http     = require('http');
const crypto   = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool     = createPool({ connectionString: process.env.DATABASE_URL });

// Stable fixture IDs — one company per assertion group to avoid cache collisions.
const CO_UNDER_CAP_ID  = 'smoke_ent_cap_A';  // 49,999 interactions → allowed
const CO_AT_CAP_ID     = 'smoke_ent_cap_B';  // 50,000 interactions → blocked
const CO_BYOK_ID       = 'smoke_ent_cap_C';  // 50,001 interactions + BYOK → allowed

const ENTERPRISE_LIMIT = 50000; // must match AI_PLAN_LIMITS.enterprise in vite-functions-plugin.js

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

async function invokeFunction(name, params = {}) {
  const r = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    body: { functionName: name, params },
  });
  return r.body?.data ?? r.body;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function seedEnterpriseCompany(companyId) {
  await pool.query(
    `INSERT INTO companies (id, company_name, email, subscription_status, subscription_plan, ai_credits_purchased, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', 'enterprise', 0, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE
       SET subscription_status   = 'active',
           subscription_plan     = 'enterprise',
           ai_credits_purchased  = 0,
           updated_at            = NOW()`,
    [companyId, `Smoke Enterprise ${companyId}`, `smoke-ent-${companyId}@example.com`]
  );
}

/**
 * Insert a single SubscriptionUsage entity with the given unit count for the
 * current billing month.  total_cost is deliberately 0 so the dollar-based
 * spend circuit breaker never fires — we only want to test the count cap.
 */
async function insertMonthlyUsage(companyId, units) {
  const now        = new Date();
  const usageMonth = now.toISOString().slice(0, 7);
  const usageDate  = now.toISOString().slice(0, 10);
  const id         = `smoke_ent_usage_${companyId}_${crypto.randomBytes(4).toString('hex')}`;
  const data = {
    company_id:  companyId,
    feature:     'lexi',          // any AI_USAGE_FEATURES member
    units,
    unit_cost:   0,               // zero cost → spend circuit breaker never fires
    total_cost:  0,
    usage_month: usageMonth,
    usage_date:  usageDate,
    logged_at:   now.toISOString(),
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
    [id, companyId, JSON.stringify(data)]
  );
}

/**
 * Encrypt a plaintext key using the same AES-256-GCM scheme as encryptApiKey()
 * in vite-functions-plugin.js so decryptApiKey() can read it back.
 * Requires the ENCRYPTION_KEY env var (32-byte hex string).
 */
function encryptForTest(rawKey) {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) throw new Error('ENCRYPTION_KEY env var not set — needed to encrypt test BYOK key');
  const key  = Buffer.from(keyHex, 'hex');
  const iv   = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(rawKey, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${enc}`;
}

/**
 * Insert a CompanyApiKeys entity with a BYOK Gemini key so checkAIUsage
 * detects getCompanyGeminiKeyInfo().isOwn === true and bypasses the cap.
 * The field name must be `gemini_api_key` (encrypted), matching the server read.
 */
async function insertByokKey(companyId) {
  const id   = `smoke_ent_apikeys_${companyId}`;
  const data = {
    company_id:      companyId,
    gemini_api_key:  encryptForTest('AIza_smoke_byok_test_key_not_real'),
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'CompanyApiKeys', $2, $3, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE SET data = EXCLUDED.data, updated_date = NOW()`,
    [id, companyId, JSON.stringify(data)]
  );
}

async function cleanup() {
  const companyIds = [CO_UNDER_CAP_ID, CO_AT_CAP_ID, CO_BYOK_ID];

  // Delete test SubscriptionUsage and CompanyApiKeys rows
  await pool.query(
    `DELETE FROM generic_entities
     WHERE company_id = ANY($1::text[])
       AND entity_type IN ('SubscriptionUsage', 'CompanyApiKeys', 'SubscriptionUsageNudge')`,
    [companyIds]
  );

  // Delete test companies
  await pool.query(
    `DELETE FROM companies WHERE id = ANY($1::text[])`,
    [companyIds]
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // exitCode is set inside try/catch; process.exit() is called AFTER finally
  // so cleanup always runs regardless of test outcome or unexpected errors.
  let exitCode = 0;

  try {
    // Baseline connectivity check
    const ping = await fetchJson(`${BASE_URL}/api/health`).catch(() => null);
    if (!ping || ping.status >= 500) {
      console.error(`✗ Server not reachable at ${BASE_URL} — is 'npm run dev' running?`);
      exitCode = 1;
      return; // jump to finally for cleanup then exit
    }

    // Clean any stale fixtures from a previous run
    await cleanup();

    // Seed the three test companies
    await Promise.all([
      seedEnterpriseCompany(CO_UNDER_CAP_ID),
      seedEnterpriseCompany(CO_AT_CAP_ID),
      seedEnterpriseCompany(CO_BYOK_ID),
    ]);

    // ════════════════════════════════════════════════════════════════════════
    // SECTION A: Under cap (49,999 interactions) → allowed = true
    // ════════════════════════════════════════════════════════════════════════
    console.log(`\n[ A: ${ENTERPRISE_LIMIT - 1} interactions (under cap) → allowed ]`);

    await insertMonthlyUsage(CO_UNDER_CAP_ID, ENTERPRISE_LIMIT - 1);
    const rA = await invokeFunction('getTrialDailyUsage', { companyId: CO_UNDER_CAP_ID });
    ok(`A1: getTrialDailyUsage succeeds`, rA?.success === true, rA?.success);
    ok(`A2: ${ENTERPRISE_LIMIT - 1} interactions → allowed = true`, rA?.ai?.allowed === true, rA?.ai?.allowed);

    // ════════════════════════════════════════════════════════════════════════
    // SECTION B: At cap (50,000 interactions) → allowed = false
    // ════════════════════════════════════════════════════════════════════════
    console.log(`\n[ B: ${ENTERPRISE_LIMIT} interactions (at cap) → blocked ]`);

    await insertMonthlyUsage(CO_AT_CAP_ID, ENTERPRISE_LIMIT);
    const rB = await invokeFunction('getTrialDailyUsage', { companyId: CO_AT_CAP_ID });
    ok(`B1: getTrialDailyUsage succeeds`, rB?.success === true, rB?.success);
    ok(`B2: ${ENTERPRISE_LIMIT} interactions → allowed = false`, rB?.ai?.allowed === false, rB?.ai?.allowed);
    ok(`B3: allowed is a strict boolean false (not undefined/null)`, rB?.ai?.allowed === false, typeof rB?.ai?.allowed);

    // ════════════════════════════════════════════════════════════════════════
    // SECTION C: Over cap (50,001) but BYOK Gemini key → allowed = true
    // ════════════════════════════════════════════════════════════════════════
    console.log(`\n[ C: ${ENTERPRISE_LIMIT + 1} interactions + BYOK Gemini key → allowed ]`);

    await insertMonthlyUsage(CO_BYOK_ID, ENTERPRISE_LIMIT + 1);
    await insertByokKey(CO_BYOK_ID);
    const rC = await invokeFunction('getTrialDailyUsage', { companyId: CO_BYOK_ID });
    ok(`C1: getTrialDailyUsage succeeds`, rC?.success === true, rC?.success);
    ok(`C2: BYOK key bypasses cap → allowed = true`, rC?.ai?.allowed === true, rC?.ai?.allowed);

    // ════════════════════════════════════════════════════════════════════════
    // Results
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n── Summary ───────────────────────────────────────────────────');
    console.log(`   Passed: ${passed}   Failed: ${failed}`);
    if (failed > 0) {
      console.log('\n✗ Some tests failed — see details above.');
      exitCode = 1;
    } else {
      console.log('\n✓ All tests passed.');
    }

  } catch (err) {
    console.error('\n✗ Unexpected error:', err.message);
    exitCode = 1;
  } finally {
    // Always clean up fixtures and close the pool — even when tests fail or
    // an unexpected error is thrown — so no synthetic data is left behind.
    try {
      await cleanup();
      console.log('Fixtures cleaned up.');
    } catch (e) {
      console.warn('Cleanup error (non-fatal):', e.message);
    }
    await pool.end();
  }

  // Exit only after finally has fully completed (pool closed, DB cleaned).
  if (exitCode !== 0) process.exit(exitCode);
})();
