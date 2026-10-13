#!/usr/bin/env node
/**
 * MRMS MESH Radar Regression Test
 * ──────────────────────────────────────────────────────────────────────────
 * Protects canvassing decisions from GRIB decode, grid-orientation, confidence
 * tier, historical-window, and unauthenticated-function regressions.
 *
 * The MRMS feed is rolling, so its decoded cell values cannot be a checked-in
 * constant. When NOAA is reachable, this test derives a known row/column's
 * expected physical value directly from the GRIB payload and verifies that the
 * public coordinate sampler reaches that exact cell. When NOAA is offline,
 * that live-feed section is skipped while the deterministic tier tests remain.
 *
 * Prerequisites for endpoint checks:
 *   - npm run dev running on port 5000 (or TEST_BASE_URL)
 *   - DATABASE_URL and SESSION_SECRET set
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const zlib = require('zlib');
const { createPool } = require('./lib/db-pool.cjs');
const mesh = require('../db/mrms-mesh.cjs');

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:5000';
const MESH_URL = 'https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/MRMS_MESH_Max_1440min.latest.grib2.gz';
const SESSION_SECRET = process.env.SESSION_SECRET;

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function skip(name, detail) {
  skipped++;
  console.log(`  - ${name} (skipped: ${detail})`);
}

function signSessionId(sid, secret) {
  const signature = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return `s:${sid}.${signature}`;
}

function findSectionOffset(buffer, sectionNumber) {
  let offset = 16;
  while (offset < buffer.length - 4 && buffer.slice(offset, offset + 4).toString() !== '7777') {
    const length = buffer.readUInt32BE(offset);
    if (length < 5 || offset + length > buffer.length) return -1;
    if (buffer[offset + 4] === sectionNumber) return offset;
    offset += length;
  }
  return -1;
}

async function testLiveGribDecode() {
  console.log('\nLive GRIB2 decode and orientation');
  let raw;
  try {
    const response = await fetch(MESH_URL, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    raw = zlib.gunzipSync(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    skip('live NOAA grid decode', error.message);
    return;
  }

  const grid = mesh.parseGrib2(raw);
  check('MRMS grid dimensions are 7000×3500', grid.ni === 7000 && grid.nj === 3500, `${grid.ni}×${grid.nj}`);

  // Choose a stable interior cell, not an edge, and independently calculate its
  // coordinate/value. sampleGrid must map north→south rows and west→east columns.
  const row = 1732;
  const col = 3481;
  const rawValue = grid.data[row * grid.ni + col];
  const expectedInches = (grid.R + rawValue * Math.pow(2, grid.E)) / Math.pow(10, grid.D) / 25.4;
  const sampled = mesh.sampleGrid(grid, grid.lat0 - row * grid.dj, grid.lon0 + col * grid.di);
  check('known grid coordinate samples its expected hail value',
    Math.abs(sampled - (expectedInches <= 0 ? 0 : expectedInches)) < 1e-9,
    `expected ${expectedInches}, got ${sampled}`);

  const mutated = Buffer.from(raw);
  const section3 = findSectionOffset(mutated, 3);
  assert(section3 >= 0, 'GRIB2 section 3 must be present');
  mutated[section3 + 71] = 0x80;
  check('non-zero GRIB scan mode is rejected',
    (() => {
      try { mesh.parseGrib2(mutated); return false; }
      catch (error) { return /scan mode/.test(error.message); }
    })());
}

function testConfidenceTiers() {
  console.log('\nConfidence tier boundaries');
  check('0.50" with a report is high confidence',
    mesh.classifyConfidence({ meshInches: 0.5, hasSpotterReport: true }) === 'high_confidence');
  check('0.99" with a report is high confidence',
    mesh.classifyConfidence({ meshInches: 0.99, hasSpotterReport: true }) === 'high_confidence');
  check('1.00" without a report is high opportunity',
    mesh.classifyConfidence({ meshInches: 1.0, hasSpotterReport: false }) === 'high_opportunity');
  check('0.50" without a report is low priority',
    mesh.classifyConfidence({ meshInches: 0.5, hasSpotterReport: false }) === 'low_priority');
  check('0.99" without a report is low priority',
    mesh.classifyConfidence({ meshInches: 0.99, hasSpotterReport: false }) === 'low_priority');
  check('unavailable radar is unknown',
    mesh.classifyConfidence({ meshInches: null, hasSpotterReport: true }) === 'unknown');
}

async function invoke(functionName, params, cookie) {
  const response = await fetch(`${BASE}/api/functions/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ functionName, params }),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { response, body };
}

async function testProtectedEndpoints() {
  console.log('\nProtected radar endpoints and historical-storm gate');
  const oldStormTime = new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString();
  const points = [{ lat: 39.5, lng: -82.5 }];

  try {
    const noSessionSample = await invoke('sampleMeshPoints', { points, stormTime: oldStormTime });
    const noSessionOverlay = await invoke('getMeshSwathOverlay', {
      minLat: 39, maxLat: 40, minLng: -83, maxLng: -82, stormTime: oldStormTime,
    });
    check('sampleMeshPoints rejects an unauthenticated request',
      noSessionSample.response.status >= 400 || /Authentication required/i.test(JSON.stringify(noSessionSample.body)),
      `HTTP ${noSessionSample.response.status}: ${JSON.stringify(noSessionSample.body).slice(0, 180)}`);
    check('getMeshSwathOverlay rejects an unauthenticated request',
      noSessionOverlay.response.status >= 400 || /Authentication required/i.test(JSON.stringify(noSessionOverlay.body)),
      `HTTP ${noSessionOverlay.response.status}: ${JSON.stringify(noSessionOverlay.body).slice(0, 180)}`);
  } catch (error) {
    skip('HTTP authentication checks', `${BASE} unavailable (${error.message})`);
    return;
  }

  if (!SESSION_SECRET || !process.env.DATABASE_URL) {
    skip('authenticated historical-storm check', 'DATABASE_URL or SESSION_SECRET is not set');
    return;
  }

  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  let sid;
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(email, ''), NULLIF(user_email, '')) AS email
         FROM staff_profiles
        WHERE COALESCE(NULLIF(email, ''), NULLIF(user_email, '')) IS NOT NULL
        LIMIT 1`
    );
    if (!rows[0]?.email) {
      skip('authenticated historical-storm check', 'no staff user is available in the development database');
      return;
    }
    const email = rows[0].email;
    sid = crypto.randomUUID();
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    // Keep this exact shape in sync with getUserFromRequest: it must be a real
    // express-session payload, not a client-provided pretend user.
    const sess = {
      cookie: { originalMaxAge: 3600000, expires: expires.toISOString(), httpOnly: true, path: '/' },
      passport: { user: { claims: { sub: email, email } } },
    };
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sid, JSON.stringify(sess), expires]
    );
    const cookie = `connect.sid=${encodeURIComponent(signSessionId(sid, SESSION_SECRET))}`;
    const { response, body } = await invoke('sampleMeshPoints', { points, stormTime: oldStormTime }, cookie);
    const data = body.data || body;
    const allUnknown = Array.isArray(data.results) && data.results.every(result =>
      result.meshInches === null && result.confidence === 'unknown');
    check('an older-than-26-hour storm cannot sample today’s radar',
      response.ok && data.available === false && data.reason === 'outside_mesh_window' && allUnknown,
      `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  } catch (error) {
    check('authenticated historical-storm check completed', false, error.message);
  } finally {
    if (sid) await pool.query('DELETE FROM sessions WHERE sid = $1', [sid]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

(async () => {
  console.log('\nMRMS MESH Radar Regression Test');
  await testLiveGribDecode();
  testConfidenceTiers();
  await testProtectedEndpoints();
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(error => {
  console.error('Fatal test error:', error.stack || error.message);
  process.exit(1);
});