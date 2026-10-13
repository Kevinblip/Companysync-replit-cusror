#!/usr/bin/env node
/**
 * Owner Enrichment & Prospect List Smoke Test
 * ──────────────────────────────────────────────────────────────────────────
 * Validates the full "Unlock Owner Data → Save as Prospect List" flow:
 *
 *  1. enrichStormAddresses with NO BatchLeads key → { hasApiKey: false } (no throw)
 *  2. saveStormProspectList writes a ProspectList row; data.prospects is readable
 *  3. searchPropertyLeads finds the saved prospects for the storm area
 *  4. Every ProspectList result has a numeric storm_score and an "Add" path
 *     (already_in_crm=false for fresh prospects)
 *  5. Prospect whose street already exists in leads → already_in_crm=true
 *
 * Prerequisites:
 *   - Dev server running on PORT (default 5000): npm run dev
 *   - DATABASE_URL and SESSION_SECRET must match the running server
 *
 * Usage: node scripts/test-owner-enrichment.cjs
 */
'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http     = require('http');
const https    = require('https');
const crypto   = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool     = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture IDs ─────────────────────────────────────────────────────
const COMPANY_ID    = 'smoke_oenr_company_001';
const OWNER_EMAIL   = 'smoke-oenr-owner@example.com';
const OWNER_UID     = 'smoke_oenr_owner_user_001';
const OWNER_SID     = 'smoke_oenr_owner_session_001';
const STORM_ID      = 'smoke_oenr_storm_001';
const LEAD_ID       = 'smoke_oenr_lead_001';

// Maple Heights, OH 44137 — lat ~41.41, lng ~-81.67
const TEST_CITY  = 'Maple Heights';
const TEST_STATE = 'OH';
const TEST_ZIP   = '44137';

// One address already in the CRM leads table (should become already_in_crm=true)
const CRM_STREET = '742 Evergreen Terrace';
// One brand-new address (should become already_in_crm=false)
const NEW_STREET = '1600 Pennsylvania Ave';

let passed = 0, failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } else {
    const msg = detail ? `${name} — ${detail}` : name;
    console.error(`  ❌ FAIL  ${msg}`);
    failures.push(msg);
    failed++;
  }
}

function forgeSessionCookie(sid) {
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const lib  = u.protocol === 'https:' ? https : http;
    const body = opts.body ? JSON.stringify(opts.body) : undefined;
    const req  = lib.request(
      {
        hostname: u.hostname,
        port:     u.port || (u.protocol === 'https:' ? 443 : 80),
        path:     u.pathname + u.search,
        method:   opts.method || 'GET',
        headers:  {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          let d;
          try { d = JSON.parse(b); } catch { d = b; }
          resolve({ status: res.statusCode, data: d });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function seedSession() {
  await pool.query(
    `INSERT INTO users (id, email, first_name, company_id, created_at, updated_at)
     VALUES ($1, $2, 'SmokeOENR', $3, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET company_id = $3`,
    [OWNER_UID, OWNER_EMAIL, COMPANY_ID]
  );
  const sess = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email: OWNER_EMAIL } } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3`,
    [OWNER_SID, JSON.stringify(sess), new Date(Date.now() + 3600000)]
  );
  return forgeSessionCookie(OWNER_SID);
}

async function cleanup() {
  try {
    await pool.query(`DELETE FROM leads WHERE company_id = $1`,           [COMPANY_ID]);
    await pool.query(`DELETE FROM generic_entities WHERE company_id = $1`, [COMPANY_ID]);
    await pool.query(`DELETE FROM generic_entities WHERE id = $1`,         [STORM_ID]);
    await pool.query(`DELETE FROM companies WHERE id = $1`,                [COMPANY_ID]);
    await pool.query(`DELETE FROM users WHERE id = $1`,                    [OWNER_UID]);
    await pool.query(`DELETE FROM sessions WHERE sid = $1`,                [OWNER_SID]);
  } catch (e) {
    console.warn('[cleanup] warning:', e.message);
  }
}

async function waitForServer(maxMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetchJson(`${BASE_URL}/api/local/entity/Company?limit=1`);
      if (r.status !== undefined) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function invoke(cookie, functionName, params) {
  const r = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method:  'POST',
    headers: { Cookie: cookie },
    body:    { functionName, params },
  });
  return r;
}

async function run() {
  console.log('\n🔍  Owner Enrichment & Prospect List Smoke Test\n');

  if (!process.env.SESSION_SECRET) {
    console.error('SESSION_SECRET not set. Aborting.');
    process.exit(1);
  }

  console.log('  Waiting for dev server…');
  const up = await waitForServer();
  if (!up) {
    console.error('Dev server unreachable. Run: npm run dev');
    process.exit(1);
  }
  console.log('  Server is up.\n');

  try {
    await cleanup();

    // ── Seed company ──────────────────────────────────────────────────────
    await pool.query(
      `INSERT INTO companies (id, name, company_name, created_by, email, subscription_plan, subscription_status, max_users, max_leads, is_deleted, created_at, updated_at)
       VALUES ($1, $1, 'OENR Smoke Co', $2, $2, 'business', 'active', 10, 10, false, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [COMPANY_ID, OWNER_EMAIL]
    );

    const cookie = await seedSession();

    // ── Seed a nearby StormEvent (lat/lng close to Maple Heights 44137) ──
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'StormEvent', 'companysync_master_001', $2, NOW(), NOW())
       ON CONFLICT (id, entity_type) DO NOTHING`,
      [STORM_ID, JSON.stringify({
        event_id:         'TEST_OENR_HAIL_MH',
        event_type:       'hail',
        severity:         'severe',
        title:            'Hail — Maple Heights, OH',
        affected_areas:   ['Maple Heights, OH'],
        start_time:       new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
        latitude:         41.415,
        longitude:        -81.672,
        status:           'active',
        hail_size_inches: 1.75,
        source:           'IEM V2',
      })]
    );

    // ── Seed one existing CRM lead (to test already_in_crm detection) ────
    await pool.query(
      `INSERT INTO leads (id, company_id, name, street, city, state, zip, source, status, created_at, updated_at)
       VALUES ($1, $2, 'Existing CRM Owner', $3, $4, $5, $6, 'county_data', 'new', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [LEAD_ID, COMPANY_ID, CRM_STREET, TEST_CITY, TEST_STATE, TEST_ZIP]
    );

    // ─────────────────────────────────────────────────────────────────────
    // TEST 1: enrichStormAddresses with NO BatchLeads key → hasApiKey=false
    // ─────────────────────────────────────────────────────────────────────
    console.log('─── Test 1: enrichStormAddresses — no BatchLeads key path ───');

    // No CompanyApiKeys row exists for COMPANY_ID, so hasApiKey should be false.
    const t1 = await invoke(cookie, 'enrichStormAddresses', {
      addresses: [
        { street: NEW_STREET, city: TEST_CITY, state: TEST_STATE, zip: TEST_ZIP },
        { street: CRM_STREET, city: TEST_CITY, state: TEST_STATE, zip: TEST_ZIP },
      ],
      stormTitle: 'Test Hail Storm',
      stormId:    STORM_ID,
    });

    ok('enrichStormAddresses returns HTTP 200',
      t1.status === 200,
      `got HTTP ${t1.status}`);

    const t1d = t1.data?.data || t1.data || {};
    ok('No-key path: hasApiKey is false',
      t1d.hasApiKey === false,
      `got hasApiKey=${JSON.stringify(t1d.hasApiKey)}`);
    ok('No-key path: does not throw (success field is false, not an error)',
      t1d.hasApiKey === false && !t1.data?.error,
      `response: ${JSON.stringify(t1.data).slice(0, 200)}`);

    // ─────────────────────────────────────────────────────────────────────
    // TEST 2: saveStormProspectList writes a readable ProspectList entity
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n─── Test 2: saveStormProspectList writes ProspectList entity ───');

    const sampleAddresses = [
      { street: NEW_STREET,  city: TEST_CITY, state: TEST_STATE, zip: TEST_ZIP, ownerName: 'Jane Prospect', phone: '2165550001' },
      { street: CRM_STREET,  city: TEST_CITY, state: TEST_STATE, zip: TEST_ZIP, ownerName: 'John Existing',  phone: null },
    ];

    const t2 = await invoke(cookie, 'saveStormProspectList', {
      addresses:  sampleAddresses,
      stormTitle: 'Maple Heights Hail Jul 2026',
      stormId:    STORM_ID,
    });

    ok('saveStormProspectList returns HTTP 200',
      t2.status === 200,
      `got HTTP ${t2.status}`);

    const t2d = t2.data?.data || t2.data || {};
    ok('saveStormProspectList returns success=true',
      t2d.success === true,
      `response: ${JSON.stringify(t2.data).slice(0, 300)}`);

    const savedListId = t2d.id;
    ok('saveStormProspectList returns an id',
      !!savedListId,
      `id=${savedListId}`);

    ok('saveStormProspectList returns correct count',
      t2d.count === sampleAddresses.length,
      `expected ${sampleAddresses.length}, got ${t2d.count}`);

    // Verify the row is actually in the DB with the right shape
    if (savedListId) {
      const dbRow = await pool.query(
        `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = 'ProspectList'`,
        [savedListId]
      );
      ok('ProspectList row exists in generic_entities',
        dbRow.rows.length === 1,
        `rows found: ${dbRow.rows.length}`);

      if (dbRow.rows.length) {
        const d = dbRow.rows[0].data;
        ok('data.prospects is an array',
          Array.isArray(d.prospects),
          `type=${typeof d.prospects}`);
        ok('data.prospects has correct length',
          d.prospects?.length === sampleAddresses.length,
          `expected ${sampleAddresses.length}, got ${d.prospects?.length}`);
        ok('data.storm_id is stored',
          d.storm_id === STORM_ID,
          `got ${d.storm_id}`);
        ok('data.list_name is stored',
          typeof d.list_name === 'string' && d.list_name.length > 0,
          `got ${d.list_name}`);

        const p0 = d.prospects?.[0] || {};
        ok('Each prospect has id, street, city, state, zip',
          p0.id && p0.street && p0.city && p0.state,
          `p0=${JSON.stringify(p0)}`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 3: searchPropertyLeads returns the saved ProspectList prospects
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n─── Test 3: searchPropertyLeads finds the ProspectList prospects ───');

    const t3 = await invoke(cookie, 'searchPropertyLeads', {
      location:     TEST_ZIP,
      radiusMiles:  10,
      propertyType: 'all',
      companyId:    COMPANY_ID,
    });

    ok('searchPropertyLeads returns HTTP 200',
      t3.status === 200,
      `got HTTP ${t3.status}`);

    const t3d   = t3.data?.data || t3.data || {};
    const res3  = t3d.results || [];
    ok('results array is present',
      Array.isArray(res3),
      `type=${typeof res3}`);

    // Should contain the CRM lead + the two ProspectList entries
    // (CRM lead itself appears once, then the ProspectList prospect for that address
    //  is deduplicated if source=imported already covers it — so at minimum 2)
    ok('At least 2 results (CRM lead + ≥1 ProspectList prospect)',
      res3.length >= 2,
      `got ${res3.length}`);

    // ── Test 4: storm_score is numeric on every result ────────────────────
    console.log('\n─── Test 4: storm_score is numeric ───');
    const noScore = res3.filter(r => typeof r.storm_score !== 'number');
    ok('Every result has a numeric storm_score',
      noScore.length === 0,
      `Missing/wrong type on: ${noScore.map(r => r.street).join(', ')}`);

    // If GOOGLE_MAPS_API_KEY is set, geocoding works and scores should be > 0
    if (process.env.GOOGLE_MAPS_API_KEY) {
      const maxScore = Math.max(0, ...res3.map(r => r.storm_score || 0));
      ok('At least one result has storm_score > 0 (geocoding + nearby storm active)',
        maxScore > 0,
        `max score=${maxScore}`);
    } else {
      console.log('  ℹ️  SKIP  storm_score>0 check (GOOGLE_MAPS_API_KEY not set)');
    }

    // ── Test 5: CRM lead → already_in_crm=true ───────────────────────────
    console.log('\n─── Test 5: CRM lead flagged already_in_crm=true ───');
    const crmResult = res3.find(r =>
      r.street?.toLowerCase() === CRM_STREET.toLowerCase() && r.already_in_crm === true
    );
    ok('CRM lead appears with already_in_crm=true',
      !!crmResult,
      `Streets: ${res3.map(r => `${r.street}→already=${r.already_in_crm}`).join(' | ')}`);

    // ── Test 6: New prospect → already_in_crm=false ───────────────────────
    console.log('\n─── Test 6: New ProspectList prospect has already_in_crm=false ───');
    const newResult = res3.find(r =>
      r.street?.toLowerCase() === NEW_STREET.toLowerCase()
    );
    ok('New prospect appears in search results',
      !!newResult,
      `Streets: ${res3.map(r => r.street).join(' | ')}`);
    if (newResult) {
      ok('New prospect has already_in_crm=false',
        newResult.already_in_crm === false,
        `got ${newResult.already_in_crm}`);
      ok('New prospect has prospect_list_id (links back to ProspectList)',
        !!newResult.prospect_list_id,
        `got ${newResult.prospect_list_id}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TEST 7: enrichStormAddresses with a corrupted/malformed stored key →
    //          must NOT throw 500; must return HTTP 200 with hasApiKey=false
    //          and a human-readable message asking the user to re-enter it.
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n─── Test 7: enrichStormAddresses with malformed stored key → graceful failure ───');

    // The server stores keys as iv:authTag:ciphertext (AES-256-GCM).
    // Storing a plain base64 blob (no colons) simulates a corrupted key row.
    const akId = 'smoke_oenr_apikeys_001';
    const corruptedKey = Buffer.from('CORRUPT_BL_KEY_' + Date.now()).toString('base64');
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'CompanyApiKeys', $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (id, entity_type) DO UPDATE SET data = $3::jsonb`,
      [akId, COMPANY_ID, JSON.stringify({ batchleads_api_key: corruptedKey })]
    );

    const t7 = await invoke(cookie, 'enrichStormAddresses', {
      addresses: [
        { street: NEW_STREET,  city: TEST_CITY, state: TEST_STATE, zip: TEST_ZIP },
        { street: CRM_STREET, city: TEST_CITY, state: TEST_STATE, zip: TEST_ZIP },
      ],
      stormTitle: 'Test Hail Storm',
      stormId:    STORM_ID,
    });

    ok('enrichStormAddresses (corrupted key) returns HTTP 200 — no 500',
      t7.status === 200,
      `got HTTP ${t7.status}`);

    const t7d = t7.data?.data || t7.data || {};
    ok('Corrupted key: hasApiKey=false (not a crash)',
      t7d.hasApiKey === false,
      `got hasApiKey=${t7d.hasApiKey}`);
    ok('Corrupted key: response includes a human-readable message',
      typeof t7d.message === 'string' && t7d.message.length > 10,
      `got message=${JSON.stringify(t7d.message)}`);

    // Clean up the junk API key
    await pool.query(`DELETE FROM generic_entities WHERE id = $1`, [akId]);

  } finally {
    await cleanup();
    await pool.end();
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log(`  Passed: ${passed}   Failed: ${failed}`);
  if (failures.length) {
    console.error('\nFailed checks:');
    failures.forEach(f => console.error(`  ✗ ${f}`));
    console.log('');
    process.exit(1);
  } else {
    console.log('\n  ✅  All checks passed.\n');
  }
}

run().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
