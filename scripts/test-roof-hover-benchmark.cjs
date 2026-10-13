#!/usr/bin/env node
/**
 * Recorded HOVER roof benchmark for 5688 Gemini Ct.
 *
 * Replays the captured Google Solar and OpenStreetMap responses through the
 * shipped _aiRoofMeasurementImpl handler. CI never calls either live service.
 * HOVER values document the trusted external benchmark; shipped_baseline pins
 * the current customer-facing output so future drift is caught per quantity.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const fixturePath = path.join(__dirname, 'fixtures', 'hover-roof-5688-gemini-ct.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function allowedDelta(expected, tolerance) {
  return Math.max(
    Number(tolerance.absolute_ft || 0),
    Math.abs(expected) * Number(tolerance.percent || 0) / 100,
  );
}

function checkQuantity(name, actual, expected, tolerance) {
  const delta = Math.abs(actual - expected);
  const allowed = allowedDelta(expected, tolerance);
  check(
    `${name}: ${actual.toFixed(2)} within ±${allowed.toFixed(2)} of shipped ${expected.toFixed(2)}`,
    Number.isFinite(actual) && delta <= allowed,
    `delta ${delta.toFixed(2)}`,
  );
}

function pitchRise(pitch) {
  const match = String(pitch || '').match(/^(\d+(?:\.\d+)?)\/12$/);
  return match ? Number(match[1]) : NaN;
}

(async () => {
  console.log('\n── HOVER roof benchmark: recorded handler replay ──────────────');

  check('fixture includes the HOVER reference report', fixture.hover_reference?.roof_area_sqft === 2481);
  check('fixture includes the captured Solar response', Array.isArray(fixture.solar?.solarPotential?.roofSegmentStats));
  check('fixture includes the captured OSM response', Array.isArray(fixture.osm?.elements));

  const originalFetch = globalThis.fetch;
  const originalGoogleKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = '__recorded_fixture__';

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('solar.googleapis.com')) {
      return new Response(JSON.stringify(fixture.solar), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (requestUrl.includes('overpass-api.de')) {
      return new Response(JSON.stringify(fixture.osm), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Benchmark attempted an unexpected live request: ${requestUrl}`);
  };

  let result;
  try {
    const { functionHandlers } = await import('../vite-functions-plugin.js');
    const { latitude, longitude } = fixture.coordinates;
    result = await functionHandlers._aiRoofMeasurementImpl({
      latitude,
      longitude,
      address: fixture.recorded_for,
    }, 'unused', null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGoogleKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalGoogleKey;
  }

  check('shipped roof handler completed successfully', result?.success === true, result?.error);

  const actual = {
    roof_area_sqft: Number(result.roof_area_sqft),
    pitch: result.pitch,
    ridge_hip_lf: Number(result.ridge_lf || 0) + Number(result.hip_lf || 0),
    valley_lf: Number(result.valley_lf || 0),
    rake_lf: Number(result.rake_lf || 0),
    eave_lf: Number(result.eave_lf || 0),
    perimeter_lf: Number(result.eave_lf || 0) + Number(result.rake_lf || 0),
  };

  const baseline = fixture.shipped_baseline;
  const tolerances = fixture.tolerances;
  checkQuantity('roof area ft²', actual.roof_area_sqft, baseline.roof_area_sqft, tolerances.roof_area_sqft);
  check(
    `pitch: ${actual.pitch} within ±${tolerances.pitch.rise_x12}/12 of shipped ${baseline.pitch}`,
    Math.abs(pitchRise(actual.pitch) - pitchRise(baseline.pitch)) <= tolerances.pitch.rise_x12,
  );
  checkQuantity('ridge + hip LF', actual.ridge_hip_lf, baseline.ridge_hip_lf, tolerances.ridge_hip_lf);
  checkQuantity('valley LF', actual.valley_lf, baseline.valley_lf, tolerances.valley_lf);
  checkQuantity('rake LF', actual.rake_lf, baseline.rake_lf, tolerances.rake_lf);
  checkQuantity('eave LF', actual.eave_lf, baseline.eave_lf, tolerances.eave_lf);
  checkQuantity('drip edge / perimeter LF', actual.perimeter_lf, baseline.perimeter_lf, tolerances.perimeter_lf);

  console.log('\n── External reference (informational) ─────────────────────────');
  console.log(`  HOVER: ${fixture.hover_reference.roof_area_sqft} ft², ${fixture.hover_reference.pitch}, `
    + `${fixture.hover_reference.ridge_hip_lf.toFixed(2)} ridge+hip LF, `
    + `${fixture.hover_reference.valley_lf.toFixed(2)} valley LF, `
    + `${fixture.hover_reference.rake_lf.toFixed(2)} rake LF, `
    + `${fixture.hover_reference.eave_lf.toFixed(2)} eave LF`);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\n✗ Roof measurements drifted outside the recorded per-quantity bands.');
    process.exit(1);
  }
  console.log('\n✓ Shipped roof baseline remains within the recorded per-quantity tolerances.');
})().catch((error) => {
  console.error('\nRoof HOVER benchmark crashed:', error);
  process.exit(1);
});