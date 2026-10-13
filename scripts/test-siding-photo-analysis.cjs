#!/usr/bin/env node
/**
 * Smoke test — analyzeHousePhotosForSiding dev handler
 * ─────────────────────────────────────────────────────────────────────────
 * Regression guard for the class of bug where a variable (e.g. avgGableRise)
 * is defined in the prod TypeScript function but was missing from the dev
 * handler copy. That bug caused every contractor attempt to return HTTP 500
 * with no measurements and no actionable error message.
 *
 * What is tested
 * ──────────────
 * Section 1 — Nominal call (3 photos: Front, Back, Gable End)
 *   • Server responds HTTP 200 (no 500 crash)
 *   • data.success === true
 *   • data.wall_area_sqft is a positive number (> 0)
 *   • data.gable_rise_ft is typeof 'number' and not NaN  ← the original bug
 *   • data.photos_analyzed is a number
 *   • facade_pitch_slopes is a validated numeric photo-reading array
 *   • masonry_deduction_sqft is always returned as the canonical photo-material field
 *
 * Section 2 — 8-photo cap
 *   • Sending 9 photos returns data.photos_analyzed <= 8
 *   • The response is still success:true (no crash from excess photos)
 *
 * Prerequisites
 * ─────────────
 *   - Dev server running on PORT (default 5000): npm run dev
 *   - GOOGLE_GEMINI_API_KEY must be set (real AI call, ~$0.01 per run)
 *   - Fixture images at public/test-fixtures/siding-test-{front,back,gable}.jpg
 *     (copied from public/uploads during task setup — real house photos)
 *
 * Usage:
 *   node scripts/test-siding-photo-analysis.cjs
 *   BASE_URL=http://localhost:5000 node scripts/test-siding-photo-analysis.cjs
 */

'use strict';

const http  = require('http');
const https = require('https');
const net   = require('net');
const { URL } = require('url');

const RAW_BASE = process.env.BASE_URL || 'http://localhost:5000';
const BASE     = new URL(RAW_BASE);
const IS_HTTPS = BASE.protocol === 'https:';
const HOST     = BASE.hostname;
const PORT     = parseInt(BASE.port || (IS_HTTPS ? '443' : '80'), 10);
const ORIGIN   = `${BASE.protocol}//${BASE.host}`;

// Fixture photo URLs — served from the running dev server's static file handler.
// These are small real house photos copied from project uploads so they always
// produce structured Gemini output (not the "not a house" fallback).
const FIXTURE_FRONT  = `${ORIGIN}/test-fixtures/siding-test-front.jpg`;
const FIXTURE_BACK   = `${ORIGIN}/test-fixtures/siding-test-back.jpg`;
const FIXTURE_GABLE  = `${ORIGIN}/test-fixtures/siding-test-gable.jpg`;

let passed = 0;
let failed = 0;

function ok(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitForPort(host, port, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const sock = net.createConnection({ host, port });
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start >= timeoutMs) {
          return reject(new Error(`Dev server not ready on ${host}:${port} after ${timeoutMs}ms`));
        }
        setTimeout(attempt, 800);
      });
    }
    attempt();
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const bytes   = Buffer.byteLength(payload);
    const lib     = IS_HTTPS ? https : http;
    const req     = lib.request(
      {
        host: HOST, port: PORT, path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': bytes,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Invoke a function through the dev server's local function handler.
// Returns the parsed `data` object from the response, or throws on HTTP error.
async function invokeFunction(functionName, params) {
  const { status, json } = await post('/api/functions/invoke', { functionName, params });
  if (status === 500) {
    const msg = json?.error || '(no error message)';
    throw new Error(`Handler crashed with HTTP 500: ${msg}`);
  }
  return { status, data: json?.data ?? json };
}

// ── Section 1: Nominal call with gable photo ──────────────────────────────────

async function section1() {
  console.log('\n[Section 1] Nominal call — Front + Back + Gable End photos\n');

  const photos = [
    { url: FIXTURE_FRONT, label: 'Front' },
    { url: FIXTURE_BACK,  label: 'Back'  },
    { url: FIXTURE_GABLE, label: 'Gable End' },
  ];

  let result;
  try {
    const r = await invokeFunction('analyzeHousePhotosForSiding', { photos });
    result = r.data;
  } catch (err) {
    // A crash (500) is itself a failure; log it so the dev can see the stack
    console.error('  Handler threw:', err.message);
    ok('Handler completes without crashing (no HTTP 500)', false,
       'Server returned 500 — likely a ReferenceError or missing variable in the dev handler');
    // The remaining assertions are meaningless if the handler crashed
    ok('success: true', false, 'request failed');
    ok('wall_area_sqft > 0', false, 'request failed');
    ok('gable_rise_ft is typeof number (not undefined/NaN)', false, 'request failed');
    ok('photos_analyzed is a number', false, 'request failed');
    return;
  }

  ok('Handler completes without crashing (no HTTP 500)', true);

  const success = result?.success;
  ok('success: true', success === true,
     `got success=${JSON.stringify(success)}. If false, check dev server logs — Gemini may have returned no measurements from the fixture images.`);

  if (success) {
    const wallArea = result.wall_area_sqft;
    ok('wall_area_sqft > 0',
       typeof wallArea === 'number' && wallArea > 0,
       `got ${wallArea}`);

    // KEY REGRESSION ASSERTION: avgGableRise must be defined in the handler.
    // If it is missing, Math.round(undefined) === NaN, or the handler throws
    // ReferenceError before reaching this field.
    const gableRise = result.gable_rise_ft;
    ok('gable_rise_ft is typeof number (regression: avgGableRise must be defined)',
       typeof gableRise === 'number' && !Number.isNaN(gableRise),
       `got ${JSON.stringify(gableRise)} (typeof ${typeof gableRise})`);

    const analyzed = result.photos_analyzed;
    ok('photos_analyzed is a number',
       typeof analyzed === 'number',
       `got ${JSON.stringify(analyzed)}`);

    const facadePitches = result.facade_pitch_slopes;
    ok('facade_pitch_slopes is a validated photo-reading array',
       Array.isArray(facadePitches) && facadePitches.every(
         (pitch) => typeof pitch === 'number' && pitch >= 2 && pitch <= 20,
       ),
       `got ${JSON.stringify(facadePitches)}`);

    const masonryDeduction = result.masonry_deduction_sqft;
    ok('masonry_deduction_sqft is returned as a numeric canonical field',
       typeof masonryDeduction === 'number' && masonryDeduction >= 0,
       `got ${JSON.stringify(masonryDeduction)}`);

    // Log summary for visibility
    console.log(`\n  Summary: wall_area=${wallArea} sqft | gable_rise=${gableRise} ft | photos_analyzed=${analyzed}`);
    console.log(`  Ground pitch: ${facadePitches?.length ? facadePitches.map((pitch) => `${pitch}/12`).join(', ') : 'not confidently visible'} | masonry=${masonryDeduction} sqft`);
    console.log(`  Confidence: ${result.confidence_grade ?? 'n/a'} | footprint_source: ${result.footprint_source ?? 'n/a'}`);
  } else {
    // success:false is not necessarily a crash — Gemini may have returned no
    // dimensional data from the fixture. Still check gable_rise_ft shape.
    const gableRise = result?.gable_rise_ft;
    ok('gable_rise_ft is typeof number even on success:false (no crash path)',
       result && typeof gableRise === 'number' && !Number.isNaN(gableRise),
       `got ${JSON.stringify(gableRise)}`);
    console.log(`  Note: success:false — error: ${result?.error}`);
    console.log('  If this is unexpected, ensure GOOGLE_GEMINI_API_KEY is set and fixture images are accessible.');
  }
}

// ── Section 2: 8-photo cap ────────────────────────────────────────────────────

async function section2() {
  console.log('\n[Section 2] 8-photo cap — send 9 photos, expect success:true and photos_analyzed === 8\n');

  // Build 9 photo entries using the same fixture (label varies so they are
  // treated as distinct wall faces by the handler). The cap must trim the list
  // to exactly 8 before any Gemini calls are made.
  const labels = ['Front', 'Back', 'Left Side', 'Right Side',
                  'FL Corner', 'FR Corner', 'BL Corner', 'BR Corner', 'Detail'];
  const photos = labels.map((label) => ({ url: FIXTURE_FRONT, label }));

  let result;
  try {
    const r = await invokeFunction('analyzeHousePhotosForSiding', { photos });
    result = r.data;
  } catch (err) {
    ok('9-photo call does not crash the handler (no HTTP 500)', false, err.message);
    ok('success: true even with 9-photo input', false, 'request failed');
    ok('photos_analyzed === 8 (cap trims input before Gemini calls)', false, 'request failed');
    return;
  }

  ok('9-photo call does not crash the handler (no HTTP 500)', true);

  const success = result?.success;
  ok('success: true even with 9-photo input',
     success === true,
     `got success=${JSON.stringify(success)}`);

  // photos_received is the count AFTER the cap slice, before any Gemini calls —
  // it must be exactly 8 regardless of whether individual AI analyses succeed or
  // fail. photos_analyzed (AI-dependent) may be ≤ 8 due to partial Gemini
  // failures and is NOT asserted here.
  const received = result?.photos_received;
  ok('photos_received === 8 (cap slices input to exactly 8 before Gemini calls)',
     typeof received === 'number' && received === 8,
     `got photos_received=${received} (expected 8 — handler must slice to MAX_SIDING_PHOTOS=8)`);

  const analyzed = result?.photos_analyzed;
  if (typeof received === 'number') {
    console.log(`  photos_received=${received}, photos_analyzed=${analyzed} (submitted 9, cap trimmed to 8 before AI)`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const isLocal = HOST === 'localhost' || HOST === '127.0.0.1';
  if (isLocal) {
    console.log(`[siding-photo-analysis] Waiting for dev server on ${HOST}:${PORT}…`);
    await waitForPort(HOST, PORT);
  }
  console.log(`[siding-photo-analysis] Running against ${ORIGIN}`);
  console.log('Note: this test makes real Gemini API calls (~$0.01/run). Fixture images must be real house photos.\n');

  await section1();
  await section2();

  console.log(`\n[siding-photo-analysis] Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error('[siding-photo-analysis] FAIL');
    process.exit(1);
  }
  console.log('[siding-photo-analysis] PASS ✓');
}

run().catch((err) => {
  console.error('[siding-photo-analysis] Fatal:', err.message);
  process.exit(1);
});
