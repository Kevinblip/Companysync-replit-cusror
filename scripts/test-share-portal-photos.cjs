#!/usr/bin/env node
/**
 * Share Portal Photo Load Smoke Test
 * ─────────────────────────────────────────────────────────────────────────
 * Verifies the public proof-package portal end-to-end:
 *
 *  A) GET /api/public/proof-package/:hash returns JSON with photos.length > 0
 *     when at least one JobMedia record is linked via related_entity_id.
 *
 *  B) GET /api/public/proof-package/:hash/pdf returns Content-Type: application/pdf.
 *
 *  C) A JobMedia record linked ONLY via job_id (legacy fallback) is also
 *     included in the photo list (OR clause in the query).
 *
 *  D) The endpoint returns 404 for an unknown hash.
 *
 * Both the dev vite handler and prod-server handler use the same SQL:
 *   data->>'related_entity_id' = $1 OR data->>'job_id' = $1
 * This script exercises the dev handler.  The prod handler is a line-for-line
 * mirror; the same fixture data would exercise it identically.
 *
 * Prerequisites:
 *   - Dev server running on PORT (default 5000)  —  npm run dev
 *   - DATABASE_URL and SESSION_SECRET env vars set
 *
 * Usage:  node scripts/test-share-portal-photos.cjs
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const http     = require('http');
const crypto   = require('crypto');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const pool     = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers (smoke_ prefix so they're easy to find/delete) ──
const COMPANY_ID     = 'smoke_shr_co_001';
const JOB_ID         = 'smoke_shr_job_001';
const MEDIA_REL_ID   = 'smoke_shr_media_rel_001';   // linked via related_entity_id
const MEDIA_JOB_ID   = 'smoke_shr_media_job_001';   // linked via legacy job_id only
const PKG_ID         = 'smoke_shr_pkg_001';
const PKG_HASH       = 'smoke_shr_testhash_' + Date.now();

// ── Counters ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`);
    failed++;
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'GET' },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      }
    );
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

function parseJson(buf) {
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

// ── Fixtures ──────────────────────────────────────────────────────────────
async function seed() {
  // Company row (minimal — companies table has no company_id col, id IS tenant id)
  await pool.query(`
    INSERT INTO companies (id, company_name, created_by)
    VALUES ($1, 'Smoke SharePortal Co', 'smoke-shr@example.com')
    ON CONFLICT (id) DO NOTHING
  `, [COMPANY_ID]);

  // InspectionJob
  const jobData = JSON.stringify({
    id: JOB_ID,
    company_id: COMPANY_ID,
    property_address: '123 Smoke Test Lane, Testville, OH 44001',
    client_name: 'Smoke Client',
    inspection_date: '2026-06-01',
    damage_type: 'Hail',
    inspector_name: 'Smoke Inspector',
  });
  await pool.query(`
    INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
    VALUES ($1, 'InspectionJob', $2, $3::jsonb, NOW(), NOW())
    ON CONFLICT (id, entity_type) DO UPDATE SET data = $3::jsonb, updated_date = NOW()
  `, [JOB_ID, COMPANY_ID, jobData]);

  // JobMedia — canonical link via related_entity_id
  const mediaRelData = JSON.stringify({
    id: MEDIA_REL_ID,
    company_id: COMPANY_ID,
    related_entity_id: JOB_ID,
    related_entity_type: 'InspectionJob',
    file_type: 'photo',
    file_url: 'https://example.com/smoke-photo-rel.jpg',
    caption: 'Smoke hail photo (related_entity_id)',
    section: 'Roof',
    ai_analysis: {
      severity_level: 'Moderate',
      hail_impact_count: 3,
      wind_damage_count: 1,
      damage_description: 'Multiple hail impacts visible on shingles',
      coverage_verdict: 'covered',
    },
  });
  await pool.query(`
    INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
    VALUES ($1, 'JobMedia', $2, $3::jsonb, NOW(), NOW())
    ON CONFLICT (id, entity_type) DO UPDATE SET data = $3::jsonb, updated_date = NOW()
  `, [MEDIA_REL_ID, COMPANY_ID, mediaRelData]);

  // JobMedia — legacy link via job_id only (fallback path)
  const mediaJobData = JSON.stringify({
    id: MEDIA_JOB_ID,
    company_id: COMPANY_ID,
    job_id: JOB_ID,
    file_type: 'photo',
    file_url: 'https://example.com/smoke-photo-job.jpg',
    caption: 'Smoke wind photo (job_id legacy)',
    section: 'Roof',
  });
  await pool.query(`
    INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
    VALUES ($1, 'JobMedia', $2, $3::jsonb, NOW(), NOW())
    ON CONFLICT (id, entity_type) DO UPDATE SET data = $3::jsonb, updated_date = NOW()
  `, [MEDIA_JOB_ID, COMPANY_ID, mediaJobData]);

  // ProofPackage
  const pkgData = JSON.stringify({
    id: PKG_ID,
    company_id: COMPANY_ID,
    inspection_job_id: JOB_ID,
    hash: PKG_HASH,
    include_annotations: false,
    include_xactimate: false,
    created_at: new Date().toISOString(),
    storm_events: [],
  });
  await pool.query(`
    INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
    VALUES ($1, 'ProofPackage', $2, $3::jsonb, NOW(), NOW())
    ON CONFLICT (id, entity_type) DO UPDATE SET data = $3::jsonb, updated_date = NOW()
  `, [PKG_ID, COMPANY_ID, pkgData]);

  console.log('  Fixtures seeded');
}

// ── Cleanup ───────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('\n── Cleanup ──────────────────────────────────────────────────');
  try {
    await pool.query(
      `DELETE FROM generic_entities WHERE id = ANY($1) AND entity_type IN ('ProofPackage','InspectionJob','JobMedia')`,
      [[PKG_ID, JOB_ID, MEDIA_REL_ID, MEDIA_JOB_ID]]
    );
    await pool.query(`DELETE FROM companies WHERE id = $1`, [COMPANY_ID]);
    console.log('  Smoke fixtures removed');
  } catch (err) {
    console.warn('  Cleanup warning:', err.message);
  }
  await pool.end();
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== Share Portal Photo Load Smoke Test ===\n');
  console.log(`Target: ${BASE_URL}\n`);

  // ── 0. Server reachability ────────────────────────────────────────────
  console.log('Group 0: Server reachability');
  try {
    const res = await httpGet(`${BASE_URL}/api/auth/user`);
    ok('Server is responding', res.status < 500, `HTTP ${res.status}`);
  } catch (err) {
    ok('Server is responding', false, err.message);
    console.log('\n⚠  Server not reachable — aborting.\n');
    await pool.end();
    process.exit(1);
  }

  // ── 1. Seed DB fixtures ───────────────────────────────────────────────
  console.log('\nGroup 1: Seed fixtures');
  try {
    await seed();
    ok('Fixtures inserted into DB', true);
  } catch (err) {
    ok('Fixtures inserted into DB', false, err.message);
    await cleanup();
    process.exit(1);
  }

  // ── 2. JSON portal load ───────────────────────────────────────────────
  console.log('\nGroup 2: GET /api/public/proof-package/:hash (JSON)');

  let jsonData = null;
  try {
    const res = await httpGet(`${BASE_URL}/api/public/proof-package/${PKG_HASH}`);
    ok('HTTP 200', res.status === 200, `HTTP ${res.status}`);
    jsonData = parseJson(res.body);
    ok('Response is valid JSON', jsonData !== null);
    ok('photos array present', Array.isArray(jsonData?.photos), jsonData?.photos);
    ok('photos.length > 0', (jsonData?.photos?.length ?? 0) > 0,
       `got ${jsonData?.photos?.length ?? 'no'} photos`);
    ok('At least 2 photos returned (related_entity_id + job_id)',
       (jsonData?.photos?.length ?? 0) >= 2,
       `got ${jsonData?.photos?.length} photos`);

    // Verify the canonical related_entity_id photo is present
    const hasRelPhoto = jsonData?.photos?.some(p => p.id === MEDIA_REL_ID);
    ok('Photo linked via related_entity_id is returned', hasRelPhoto);

    // Verify the legacy job_id photo is returned via OR-fallback
    const hasJobPhoto = jsonData?.photos?.some(p => p.id === MEDIA_JOB_ID);
    ok('Photo linked via legacy job_id is returned (fallback path)', hasJobPhoto);

    // Verify job data present
    ok('job.property_address present', !!jsonData?.job?.property_address, jsonData?.job?.property_address);

    // Verify AI analysis data is passed through on the related_entity_id photo
    const relPhoto = jsonData?.photos?.find(p => p.id === MEDIA_REL_ID);
    ok('ai_analysis fields forwarded to portal', !!relPhoto?.ai_analysis?.damage_description);
  } catch (err) {
    ok('JSON request completed without exception', false, err.message);
  }

  // ── 3. 404 for unknown hash ───────────────────────────────────────────
  console.log('\nGroup 3: 404 for unknown hash');
  try {
    const res = await httpGet(`${BASE_URL}/api/public/proof-package/this_hash_does_not_exist_smoke`);
    ok('HTTP 404 for unknown hash', res.status === 404, `HTTP ${res.status}`);
    const body = parseJson(res.body);
    ok('Error field present in 404 body', !!body?.error, body);
  } catch (err) {
    ok('404 request completed without exception', false, err.message);
  }

  // ── 4. PDF download ───────────────────────────────────────────────────
  console.log('\nGroup 4: GET /api/public/proof-package/:hash/pdf');
  try {
    const res = await httpGet(`${BASE_URL}/api/public/proof-package/${PKG_HASH}/pdf`);
    ok('HTTP 200 for PDF endpoint', res.status === 200, `HTTP ${res.status}`);
    const ct = res.headers['content-type'] || '';
    ok('Content-Type: application/pdf', ct.includes('application/pdf'), ct);
    const cd = res.headers['content-disposition'] || '';
    ok('Content-Disposition: attachment', cd.includes('attachment'), cd);
    ok('PDF body is non-empty', res.body.length > 100, `${res.body.length} bytes`);

    // Sanity: real PDF starts with %PDF
    const magic = res.body.slice(0, 4).toString('ascii');
    ok('Response body starts with %PDF magic bytes', magic === '%PDF', magic);
  } catch (err) {
    ok('PDF request completed without exception', false, err.message);
  }

  // ── Summary ───────────────────────────────────────────────────────────
  await cleanup();
  console.log(`\n── Results: ${passed} passed, ${failed} failed ─────────────────\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\nFatal error:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
