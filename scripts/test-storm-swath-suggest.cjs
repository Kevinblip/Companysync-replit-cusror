#!/usr/bin/env node
/**
 * Storm swath suggestion smoke test
 * ──────────────────────────────────────────────────────────────────────────
 * Verifies that suggestStormSwathAreas:
 *   1. Falls back to locally-ingested StormEvent hail reports when IEM returns none
 *   2. Marks a ring suggestion as confirmed when its nearest report is within 5 mi
 *   3. Rejects unauthenticated requests, as does geocodeAddress
 *
 * The fixture is future-dated so IEM has no matching live reports; the seeded
 * StormEvent at the center is four miles from every inner suggestion ring point.
 *
 * Prerequisites:
 *   - Dev server running on PORT (default 5000): npm run dev
 *   - DATABASE_URL, SESSION_SECRET, and GOOGLE_MAPS_API_KEY available
 *
 * Usage: node scripts/test-storm-swath-suggest.cjs
 */
'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const COMPANY_ID = 'smoke_swath_company_001';
const OWNER_EMAIL = 'smoke-swath-owner@example.com';
const OWNER_UID = 'smoke_swath_owner_user_001';
const OWNER_SID = 'smoke_swath_owner_session_001';
const STORM_ID = 'smoke_swath_hail_001';
const STORM_START = '2035-05-20T18:00:00.000Z';
// Rural northeast Ohio. A report at the center is exactly 4 mi from inner ring points.
const STORM_CENTER = { lat: 41.11, lng: -81.62 };

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    const message = detail ? `${name} — ${detail}` : name;
    console.error(`  FAIL  ${message}`);
    failures.push(message);
    failed++;
  }
}

function forgeSessionCookie(sid) {
  const signature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const request = client.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.headers || {}),
      },
    }, (response) => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, data: JSON.parse(text) });
        } catch {
          resolve({ status: response.statusCode, data: text });
        }
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function waitForServer(maxMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    try {
      const response = await fetchJson(`${BASE_URL}/api/local/entity/Company?limit=1`);
      if (response.status !== undefined) return true;
    } catch { /* server has not started yet */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

async function seedSession() {
  await pool.query(
    `INSERT INTO users (id, email, first_name, company_id, created_at, updated_at)
     VALUES ($1, $2, 'StormSwathSmoke', $3, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, company_id = EXCLUDED.company_id`,
    [OWNER_UID, OWNER_EMAIL, COMPANY_ID]
  );
  const session = {
    cookie: { originalMaxAge: 3600000, httpOnly: true, path: '/' },
    passport: { user: { claims: { email: OWNER_EMAIL } } },
  };
  await pool.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
    [OWNER_SID, JSON.stringify(session), new Date(Date.now() + 3600000)]
  );
  return forgeSessionCookie(OWNER_SID);
}

async function cleanup() {
  try {
    await pool.query(`DELETE FROM generic_entities WHERE id = $1 AND entity_type = 'StormEvent'`, [STORM_ID]);
    await pool.query(`DELETE FROM sessions WHERE sid = $1`, [OWNER_SID]);
    await pool.query(`DELETE FROM users WHERE id = $1 OR LOWER(email) = LOWER($2)`, [OWNER_UID, OWNER_EMAIL]);
  } catch (error) {
    console.warn('[cleanup] warning:', error.message);
  }
}

async function invoke(functionName, params, cookie) {
  return fetchJson(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
    body: { functionName, params },
  });
}

async function run() {
  console.log('\nStorm swath suggestion smoke test\n');

  if (!process.env.SESSION_SECRET || !process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error('SESSION_SECRET and GOOGLE_MAPS_API_KEY must be set');
  }
  if (!await waitForServer()) {
    throw new Error('Dev server unreachable. Run: npm run dev');
  }

  try {
    await cleanup();
    const cookie = await seedSession();

    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'StormEvent', 'companysync_master_001', $2::jsonb, NOW(), NOW())`,
      [STORM_ID, JSON.stringify({
        event_id: 'TEST_SWATH_FALLBACK_HAIL_001',
        event_type: 'hail',
        severity: 'severe',
        title: 'Smoke test hail report',
        start_time: STORM_START,
        latitude: STORM_CENTER.lat,
        longitude: STORM_CENTER.lng,
        hail_size_inches: 1.5,
        status: 'ended',
        source: 'IEM V2',
      })]
    );

    console.log('─── Authenticated suggestion and DB fallback ───');
    const suggestionResponse = await invoke('suggestStormSwathAreas', {
      lat: STORM_CENTER.lat,
      lng: STORM_CENTER.lng,
      startTime: STORM_START,
      affectedAreas: [],
      secondaryAreas: [],
    }, cookie);
    const result = suggestionResponse.data?.data || suggestionResponse.data || {};
    const suggestions = result.suggestions || [];

    ok('suggestStormSwathAreas returns HTTP 200', suggestionResponse.status === 200, `got ${suggestionResponse.status}`);
    ok('fallback source is db-fallback', result.reportSource === 'db-fallback', `got ${result.reportSource}`);
    ok('fallback includes the seeded hail report', result.iemCount >= 1, `got ${result.iemCount}`);
    ok('at least one area was suggested', suggestions.length > 0, 'Google reverse geocoding returned no usable areas');
    const confirmed = suggestions.filter(suggestion => suggestion.confirmed === true);
    ok('a suggestion within the five-mile cutoff is confirmed',
      confirmed.some(suggestion => Number(suggestion.distMiles) <= 5),
      `confirmed=${JSON.stringify(confirmed.map(s => ({ name: s.name, distMiles: s.distMiles })))}`);

    console.log('\n─── Unauthenticated endpoint guards ───');
    const unauthSuggest = await invoke('suggestStormSwathAreas', {
      lat: STORM_CENTER.lat,
      lng: STORM_CENTER.lng,
      startTime: STORM_START,
    });
    ok('suggestStormSwathAreas rejects unauthenticated callers',
      unauthSuggest.status >= 400 && String(unauthSuggest.data?.error || '').includes('Authentication required'),
      `status=${unauthSuggest.status}, body=${JSON.stringify(unauthSuggest.data)}`);

    const unauthGeocode = await invoke('geocodeAddress', { address: '123 Test Street' });
    ok('geocodeAddress rejects unauthenticated callers',
      unauthGeocode.status >= 400 && String(unauthGeocode.data?.error || '').includes('Authentication required'),
      `status=${unauthGeocode.status}, body=${JSON.stringify(unauthGeocode.data)}`);
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log('\n─────────────────────────────────────────');
  if (failed === 0) {
    console.log(`All ${passed} checks passed`);
    process.exit(0);
  }
  console.error(`${failed} check(s) failed, ${passed} passed`);
  failures.forEach(failure => console.error(`  • ${failure}`));
  process.exit(1);
}

run().catch(async error => {
  console.error('Fatal error:', error.message);
  await cleanup();
  await pool.end();
  process.exit(1);
});