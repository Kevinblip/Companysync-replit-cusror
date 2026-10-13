#!/usr/bin/env node
/**
 * Manual Calibration Wins — Smoke Test
 *
 * Exercises the shared wall-height aggregator imported by the live
 * analyzeHousePhotosForSiding handler. No copied analyzer source is evaluated.
 *
 * Usage: node scripts/test-manual-calibration-wins.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { deriveWallHeight } = require('../db/siding-aggregate.cjs');

let passed = 0;
let failed = 0;

function ok(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
    return;
  }
  console.log(`  ✗ ${label}${detail === undefined ? '' : ` (got: ${JSON.stringify(detail)})`}`);
  failed++;
}

console.log('\n── Manual Calibration Wins Smoke Test ─────────────────────────\n');

const liveSource = fs.readFileSync(
  path.resolve(__dirname, '../vite-functions-plugin.js'),
  'utf8',
);
ok(
  'live handler imports deriveWallHeight from the shared aggregator',
  /deriveWallHeight:\s*_deriveWallHeight/.test(liveSource)
    && /const _dwh = _deriveWallHeight\(heightResults, storyCount\)/.test(liveSource),
);

{
  const results = [
    {
      view_label: 'Front',
      eave_height_ft: 15,
      manually_calibrated: true,
      height_method: 'manual_calibration',
    },
    {
      view_label: 'Back',
      eave_height_ft: 19,
      manually_calibrated: false,
      height_method: 'door_anchor',
      height_clamped: false,
    },
  ];
  const derived = deriveWallHeight(results, 2);
  ok('manual 15ft beats an automatic 19ft anchor', derived.wallHeightFt === 15, derived);
  ok('height source credits manual calibration', derived.heightSource.includes('manual_calibration'), derived);
}

{
  const results = [
    { eave_height_ft: 15, manually_calibrated: true, height_method: 'manual_calibration' },
    { eave_height_ft: 15.5, manually_calibrated: true, height_method: 'manual_calibration' },
    { eave_height_ft: 24, manually_calibrated: true, height_method: 'manual_calibration' },
  ];
  const derived = deriveWallHeight(results, 2);
  ok('manual outliers are rejected before aggregation', derived.wallHeightFt === 15.5, derived);
  ok('outlier rejection is disclosed in provenance', derived.heightSource.includes('outlier(s) rejected'), derived);
}

{
  const results = [
    { eave_height_ft: 6.5, manually_calibrated: true, height_method: 'manual_calibration' },
    { eave_height_ft: 35, manually_calibrated: true, height_method: 'manual_calibration' },
  ];
  const derived = deriveWallHeight(results, 2);
  ok('invalid manual heights fall back to the two-story formula', derived.wallHeightFt === 18, derived);
  ok('fallback provenance is explicit', derived.heightSource.startsWith('formula_fallback'), derived);
}

{
  const results = [
    { eave_height_ft: 8, height_method: 'garage_door_anchor', height_clamped: false },
    { eave_height_ft: 20, height_method: 'ai_estimate', height_clamped: false },
  ];
  const derived = deriveWallHeight(results, 1);
  ok('a calibrated automatic anchor beats an uncalibrated AI estimate', derived.wallHeightFt === 8, derived);
}

console.log('\n── Summary ────────────────────────────────────────────────────');
console.log(`   Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.error('\n✗ Manual-calibration aggregation has regressed.\n');
  process.exit(1);
}
console.log('\n✓ All manual-calibration aggregation checks passed.\n');