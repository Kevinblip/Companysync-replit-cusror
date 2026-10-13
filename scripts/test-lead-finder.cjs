#!/usr/bin/env node
/**
 * Lead Finder Smoke Test
 * ──────────────────────────────────────────────────────────────────────────
 * Confirms the end-to-end Lead Finder round-trip:
 *
 *   1. Search by ZIP returns results (leads table + ProspectList)
 *   2. All results have source='imported'
 *   3. storm_score is a number on every result; > 0 when a nearby storm exists
 *   4. Lead already in the CRM (leads table) has already_in_crm=true
 *   5. ProspectList prospect NOT yet in CRM has already_in_crm=false
 *   6. ProspectList entry whose street matches a CRM lead has already_in_crm=true
 *   7. "Add to CRM" POST creates a leads row with the correct fields
 *   8. Re-search after "Add to CRM" shows the new lead as already_in_crm=true
 *
 * Prerequisites:
 *   - Dev server must be running on PORT (default 5000): npm run dev
 *   - DATABASE_URL, SESSION_SECRET must match the running server
 *
 * Usage: node scripts/test-lead-finder.cjs
 */
'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http     = require('http');
const https    = require('https');
const crypto   = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool     = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture IDs ─────────────────────────────────────────────────────
const COMPANY_ID       = 'smoke_plf_company_001';
const OWNER_EMAIL      = 'smoke-plf-owner@example.com';
const OWNER_UID        = 'smoke_plf_owner_user_001';
const OWNER_SID        = 'smoke_plf_owner_session_001';
const LEAD_ID          = 'smoke_plf_lead_001';
const PROSPECT_LIST_ID = 'smoke_plf_plist_001';
const STORM_ID         = 'smoke_plf_storm_001';

// Maple Heights, OH — real zip with known coords ~(41.41, -81.67)
const TEST_ZIP   = '44137';
// A lead already in the CRM leads table
const CRM_STREET = '1234 Smoke Test Lane';
// A prospect in ProspectList NOT yet in CRM
const NEW_STREET = '999 Fresh Prospect Ave';

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
  // Insert a user whose company_id matches COMPANY_ID so the auth check passes
  await pool.query(
    `INSERT INTO users (id, email, first_name, company_id, created_at, updated_at)
     VALUES ($1, $2, 'SmokePLF', $3, NOW(), NOW())
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
    await pool.query(`DELETE FROM leads WHERE company_id = $1`, [COMPANY_ID]);
    await pool.query(
      `DELETE FROM generic_entities WHERE company_id = $1 OR id IN ($2, $3)`,
      [COMPANY_ID, STORM_ID, PROSPECT_LIST_ID]
    );
    await pool.query(`DELETE FROM companies WHERE id = $1`, [COMPANY_ID]);
    await pool.query(
      `DELETE FROM users WHERE id = $1 OR LOWER(email) = LOWER($2)`,
      [OWNER_UID, OWNER_EMAIL]
    );
    await pool.query(`DELETE FROM sessions WHERE sid = $1`, [OWNER_SID]);
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

async function run() {
  console.log('\n🔍  Lead Finder Smoke Test\n');
  console.log(`  ZIP under test : ${TEST_ZIP}  (Maple Heights, OH)`);
  console.log(`  CRM lead street: ${CRM_STREET}`);
  console.log(`  New prospect   : ${NEW_STREET}\n`);

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
       VALUES ($1, $1, 'PLF Smoke Co', $2, $2, 'business', 'active', 10, 10, false, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [COMPANY_ID, OWNER_EMAIL]
    );

    const cookie = await seedSession();

    // ── Seed leads table: one property already in CRM ─────────────────────
    await pool.query(
      `INSERT INTO leads (id, company_id, name, street, city, state, zip, source, lead_source, status, created_at, updated_at)
       VALUES ($1, $2, 'Existing CRM Owner', $3, 'Maple Heights', 'OH', $4, 'county_data', 'county_data', 'new', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [LEAD_ID, COMPANY_ID, CRM_STREET, TEST_ZIP]
    );

    // ── Seed ProspectList: two prospects, one new + one matching CRM ──────
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'ProspectList', $2, $3, NOW(), NOW())
       ON CONFLICT (id, entity_type) DO NOTHING`,
      [PROSPECT_LIST_ID, COMPANY_ID, JSON.stringify({
        list_name: 'PLF Smoke List 44137',
        prospects: [
          {
            id: 'p_new_001',
            name: 'New Prospect Owner',
            street: NEW_STREET,
            city: 'Maple Heights',
            state: 'OH',
            zip: TEST_ZIP,
          },
          {
            id: 'p_crm_001',
            name: 'Existing CRM Owner',
            street: CRM_STREET,  // same street+zip as the CRM lead above
            city: 'Maple Heights',
            state: 'OH',
            zip: TEST_ZIP,
          },
        ],
      })]
    );

    // ── Seed a StormEvent very close to zip 44137 ─────────────────────────
    // Maple Heights, OH is ~41.41, -81.67. Storm at 41.415, -81.672 is <1 mi away.
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'StormEvent', 'companysync_master_001', $2, NOW(), NOW())
       ON CONFLICT (id, entity_type) DO NOTHING`,
      [STORM_ID, JSON.stringify({
        event_id:         'TEST_PLF_HAIL_MAPLEHEIGHTS',
        event_type:       'hail',
        severity:         'severe',
        title:            'Hail — Maple Heights, OH',
        affected_areas:   ['Maple Heights, OH'],
        start_time:       new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
        latitude:         41.415,
        longitude:        -81.672,
        status:           'active',
        hail_size_inches: 1.5,
        source:           'IEM V2',
      })]
    );

    // ── Test 1: searchPropertyLeads returns 200 with results ──────────────
    console.log('─── Test 1: Search by ZIP returns results ───');
    const s1 = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: {
        functionName: 'searchPropertyLeads',
        params: { location: TEST_ZIP, radiusMiles: 10, propertyType: 'all', companyId: COMPANY_ID },
      },
    });

    ok('searchPropertyLeads returns HTTP 200', s1.status === 200, `got ${s1.status}`);

    // The function returns { data: { results: [...], ... } } wrapped by the invoke layer
    const searchData = s1.data?.data || s1.data || {};
    const results1 = searchData.results || [];

    ok('results array is present', Array.isArray(results1), `type=${typeof results1}`);
    ok('At least 2 results (1 CRM lead + ≥1 ProspectList prospect)',
      results1.length >= 2, `got ${results1.length}`);

    // ── Test 2: source='imported' on every result ─────────────────────────
    console.log('\n─── Test 2: source field ───');
    const badSource = results1.filter(r => r.source !== 'imported');
    ok('All results have source="imported"',
      badSource.length === 0,
      `Non-imported: ${badSource.map(r => `${r.street}→${r.source}`).join(', ')}`);

    // ── Test 3: storm_score is a number; > 0 when geocoding works ─────────
    console.log('\n─── Test 3: storm_score ───');
    const missingScore = results1.filter(r => typeof r.storm_score !== 'number');
    ok('Every result has a numeric storm_score',
      missingScore.length === 0,
      `Bad types: ${missingScore.map(r => r.street).join(', ')}`);

    const maxScore = Math.max(0, ...results1.map(r => r.storm_score || 0));
    ok('At least one result has storm_score > 0 (geocoding + nearby storm works)',
      maxScore > 0,
      `max storm_score=${maxScore}; passes only when GOOGLE_MAPS_API_KEY geocodes 44137`);

    // ── Test 4: leads-table entry has already_in_crm=true ─────────────────
    console.log('\n─── Test 4: CRM lead is marked already_in_crm=true ───');
    const crmEntry = results1.find(r => r.id === LEAD_ID || r.street === CRM_STREET);
    ok('Lead from leads table appears in results', !!crmEntry,
      `Streets found: ${results1.map(r => r.street).join('; ')}`);
    if (crmEntry) {
      ok('CRM lead has already_in_crm=true',
        crmEntry.already_in_crm === true,
        `got ${crmEntry.already_in_crm}`);
    }

    // ── Test 5: new ProspectList prospect has already_in_crm=false ────────
    console.log('\n─── Test 5: New ProspectList prospect has already_in_crm=false ───');
    const newProspect = results1.find(r => r.street === NEW_STREET);
    ok('New prospect appears in results', !!newProspect,
      `Streets: ${results1.map(r => r.street).join('; ')}`);
    if (newProspect) {
      ok('New prospect has already_in_crm=false',
        newProspect.already_in_crm === false,
        `got ${newProspect.already_in_crm}`);
    }

    // ── Test 6: CRM-duplicate ProspectList entry has already_in_crm=true ──
    console.log('\n─── Test 6: Duplicate ProspectList entry dedup ───');
    // Either the duplicate is dropped (isDupe guard) or it surfaces with already_in_crm=true
    const dupEntries = results1.filter(r => r.street === CRM_STREET);
    const dupHandledCorrectly = dupEntries.length === 0 ||
      dupEntries.every(r => r.already_in_crm === true);
    ok('ProspectList entry matching CRM lead is either deduped or shows already_in_crm=true',
      dupHandledCorrectly,
      `${dupEntries.length} entries: ${dupEntries.map(r => `already_in_crm=${r.already_in_crm}`).join(', ')}`);

    // ── Test 7: "Add to CRM" creates a leads row ───────────────────────────
    console.log('\n─── Test 7: "Add to CRM" round-trip ───');
    const addResp = await fetchJson(`${BASE_URL}/api/local/entity/Lead`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: {
        name:      'New Prospect Owner',
        street:    NEW_STREET,
        city:      'Maple Heights',
        state:     'OH',
        zip:       TEST_ZIP,
        company_id: COMPANY_ID,
        source:    'property_data',
        lead_source: 'imported',
        status:    'new',
      },
    });
    ok('"Add to CRM" returns 2xx',
      addResp.status === 200 || addResp.status === 201,
      `got ${addResp.status}: ${JSON.stringify(addResp.data).slice(0, 120)}`);

    const addedRow = await pool.query(
      `SELECT id, name, street FROM leads
       WHERE company_id = $1 AND LOWER(TRIM(street)) = LOWER($2) AND zip = $3
       LIMIT 1`,
      [COMPANY_ID, NEW_STREET, TEST_ZIP]
    );
    ok('Lead row exists in DB after "Add to CRM"',
      addedRow.rows.length === 1,
      `rows found: ${addedRow.rows.length}`);
    if (addedRow.rows.length > 0) {
      ok('Lead row has correct name',
        addedRow.rows[0].name === 'New Prospect Owner',
        `got "${addedRow.rows[0].name}"`);
    }

    // ── Test 8: re-search shows new lead as already_in_crm=true ───────────
    console.log('\n─── Test 8: Re-search shows new lead as in-CRM ───');
    const s2 = await fetchJson(`${BASE_URL}/api/functions/invoke`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: {
        functionName: 'searchPropertyLeads',
        params: { location: TEST_ZIP, radiusMiles: 10, propertyType: 'all', companyId: COMPANY_ID },
      },
    });
    const results2 = (s2.data?.data || s2.data)?.results || [];
    // After "Add to CRM", the address appears in the leads table, so it shows already_in_crm=true
    const newProspectAfterAdd = results2.find(r => r.street === NEW_STREET);
    ok('After "Add to CRM", the address is present in re-search results',
      !!newProspectAfterAdd,
      `Streets in re-search: ${results2.map(r => r.street).join('; ')}`);
    if (newProspectAfterAdd) {
      ok('After "Add to CRM", already_in_crm=true',
        newProspectAfterAdd.already_in_crm === true,
        `got ${newProspectAfterAdd.already_in_crm}`);
    }

  } finally {
    await cleanup();
    await pool.end();
  }

  console.log('\n─────────────────────────────────────────');
  if (failed === 0) {
    console.log(`✅  All ${passed} tests passed`);
    process.exit(0);
  } else {
    console.error(`❌  ${failed} test(s) failed, ${passed} passed`);
    failures.forEach(f => console.error(`   • ${f}`));
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error:', err.message, err.stack);
  pool.end().catch(() => {});
  process.exit(1);
});
