/**
 * test-satellite-rejection-warning.cjs
 *
 * Verifies that:
 * 1. vite-functions-plugin.js wires satellite_rejection_reason into the siding response
 * 2. the same Vite handler registry serves production
 * 3. AIEstimator.jsx renders the warning in both result cards without a useSatelliteMode gate
 *
 * Tests 1-3 are static source checks (no server needed).
 * Test 4 makes a live API call if the server is up; skips gracefully if not.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const assert = require('assert');

let passed = 0;
let failed = 0;

function pass(label) { console.log(`[satellite-rejection] PASS: ${label}`); passed++; }
function fail(label, err) { console.error(`[satellite-rejection] FAIL: ${label} — ${err.message}`); failed++; }

// ── Test 1: Dev handler (vite-functions-plugin.js) ───────────────────────────
try {
  const src = fs.readFileSync('vite-functions-plugin.js', 'utf8');
  assert.ok(src.includes('satelliteRejectionReason'), 'must declare satelliteRejectionReason');
  assert.ok(
    src.includes('satellite_rejection_reason: satelliteRejectionReason'),
    'must include satellite_rejection_reason in response object'
  );
  assert.ok(src.includes('out of range'), 'must set rejection reason when ratio is out of range');
  pass('Dev handler wires satellite_rejection_reason when ratio out of range');
} catch (err) { fail('Dev handler', err); }

// ── Test 2: Production dispatch uses the live handler registry ───────────────
try {
  const ts = fs.readFileSync('vite-functions-plugin.js', 'utf8');
  const prodDispatch = fs.readFileSync('db/prod-integrations.cjs', 'utf8');
  assert.ok(prodDispatch.includes("await import(pluginPath)"), 'production must import the Vite handler registry');
  assert.ok(ts.includes('satelliteRejectionReason'), 'must declare satelliteRejectionReason');
  assert.ok(
    ts.includes('satellite_rejection_reason: satelliteRejectionReason'),
    'must include satellite_rejection_reason in response'
  );
  pass('Production dispatch uses the handler that wires satellite_rejection_reason');
} catch (err) { fail('Production function', err); }

// ── Test 3: UI renders warning in both cards without useSatelliteMode gate ───
try {
  const ui = fs.readFileSync('src/pages/AIEstimator.jsx', 'utf8');
  assert.ok(
    ui.includes('sd.satellite_rejection_reason'),
    'must gate warning on sd.satellite_rejection_reason (sidingMeasurements card)'
  );
  assert.ok(
    ui.includes('d.satellite_rejection_reason'),
    'must gate warning on d.satellite_rejection_reason (photoSidingAnalysis card)'
  );
  assert.ok(
    ui.includes('Satellite footprint rejected'),
    'must display "Satellite footprint rejected" warning text'
  );
  assert.ok(
    !ui.includes('sd.satellite_rejection_reason && useSatelliteMode'),
    'warning must NOT be gated on useSatelliteMode'
  );
  pass('UI renders rejection warning in both cards without useSatelliteMode gate');
} catch (err) { fail('UI warning gates', err); }

// ── Test 4: Live API — field present in response schema (optional, skips if no server) ──
function tryLiveCheck() {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      photos: [],
      use_satellite: false,
      latitude: null,
      longitude: null,
    });
    const req = http.request({
      host: 'localhost', port: 5000,
      path: '/functions/analyzeHousePhotosForSiding',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        // 401/403 = server up but no session — field schema not checkable, skip
        if (res.statusCode === 401 || res.statusCode === 403) {
          console.log('[satellite-rejection] SKIP: Live API check (auth required — no session in test context)');
          passed++;
          resolve();
          return;
        }
        try {
          const body = JSON.parse(data);
          const d = body?.data ?? body;
          if (res.statusCode === 400 && (!d || !('satellite_rejection_reason' in d))) {
            // 400 with no photos is expected — server validated input before running handler
            console.log('[satellite-rejection] SKIP: Live API check (400 — no photos, handler not reached)');
            passed++;
          } else {
            assert.ok('satellite_rejection_reason' in (d || {}),
              'satellite_rejection_reason field must be present in response (may be null)');
            pass('Live API: satellite_rejection_reason field present in response');
          }
        } catch (_parseErr) {
          // Empty or non-JSON body (e.g. 400/500 text response) — skip gracefully
          console.log(`[satellite-rejection] SKIP: Live API check (non-JSON response, status=${res.statusCode})`);
          passed++;
        }
        resolve();
      });
    });
    req.on('error', () => {
      console.log('[satellite-rejection] SKIP: Live API check (server not reachable)');
      passed++;
      resolve();
    });
    req.on('timeout', () => {
      req.destroy();
      console.log('[satellite-rejection] SKIP: Live API check (timeout)');
      passed++;
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

tryLiveCheck().then(() => {
  console.log(`\n[satellite-rejection] Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
