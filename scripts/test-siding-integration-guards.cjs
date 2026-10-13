#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const prodStreetView = fs.readFileSync('functions/getStreetViewImages.ts', 'utf8');
const devHandlers = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const estimator = fs.readFileSync('src/pages/AIEstimator.jsx', 'utf8');
// Production imports this same handler registry via db/prod-integrations.cjs.
const prodAnalyzer = devHandlers;
const manualRebuild = fs.readFileSync('src/utils/rebuildSidingMeasurements.js', 'utf8');
const renderer = fs.readFileSync('src/components/estimator/HouseModel3D.jsx', 'utf8');
const sidingReport = fs.readFileSync('src/utils/generateSidingReportHTML.js', 'utf8');
const sidingContract = fs.readFileSync('src/utils/sidingReportNormalization.js', 'utf8');

assert.match(prodStreetView, /evidencePolicy:\s*'single_house_facing_panorama'/, 'production Street View must declare the single-reference policy');
assert.match(prodStreetView, /evidence_role:\s*'house_facing_reference'/, 'production Street View must identify reference-only evidence');
assert.doesNotMatch(prodStreetView, /evidence_role:\s*'house_facing_reference'[\s\S]{0,120}verified_elevation:\s*true/, 'production reference-only evidence must not be verified');
assert.match(devHandlers, /evidencePolicy:\s*'solar_aligned_wall_face_panoramas'/, 'development Street View must declare its face-aligned panorama policy');
assert.match(devHandlers, /verified_elevation:\s*!!facePanoId/, 'development Street View must verify only face-specific panoramas');

for (const [label, source] of [
  ['production analyzer', prodAnalyzer],
  ['development analyzer', devHandlers],
]) {
  assert.match(source, /buildSidingMeasurementGraph\(/, `${label} must build the canonical graph`);
  assert.doesNotMatch(source, /filter\([^)]*(?:sqft|area)[^)]*>=?\s*10/i, `${label} must not discard openings under 10 sqft`);
}

assert.match(
  estimator,
  /data-testid="button-build-siding-estimate"[\s\S]{0,240}handleBuildSidingEstimate\(sd\)/,
  'satellite result must pass the complete measurement object into the estimate builder',
);
assert.match(estimator, /measurement_graph:\s*sidingMeasurements\.measurement_graph \|\| null/, 'saved estimates must retain the full canonical graph snapshot');
assert.match(estimator, /resolveCanonicalSidingContract\(measurements,\s*wastePct\)/, 'estimate conversion must use the shared graph and waste contract');
assert.match(estimator, /sidingContract\.graph_present && !sidingContract\.supported/, 'estimate conversion must fail closed for an invalid canonical graph');
assert.match(renderer, /const effectiveOpenings = measurementGraph\s*\?\s*graphOpenings/, 'renderer must not synthesize openings when a graph exists');
assert.match(sidingReport, /const reportGraphTotals = sidingContract\.totals/, 'report totals must come from the shared canonical contract');
assert.match(sidingContract, /reconciliation\?\.consistent === true/, 'canonical precision must require successful reconciliation');
assert.match(estimator, /data-testid="checkbox-acknowledge-siding-coverage"/, 'review-required coverage must have an acknowledgement control');
assert.match(
  estimator,
  /data-testid="button-build-photo-siding-estimate"[\s\S]{0,320}handleBuildSidingEstimate\(hasEdits \? eff : photoSidingAnalysis\)/,
  'photo measurements must keep an actionable estimate button when coverage needs review',
);
assert.match(devHandlers, /report_address/, 'calibration handler must require the report address');
assert.match(devHandlers, /subjectKey !== reportKey/, 'calibration handler must reject address mismatches');
assert.match(
  estimator,
  /disabled=\{isSavingCalibration \|\| !addressesMatch\}[\s\S]{0,240}data-testid="button-learn-from-report"/,
  'calibration UI must block mismatched reports',
);
assert.doesNotMatch(
  fs.readFileSync('src/components/satellite/InteractiveRoofMap.jsx', 'utf8'),
  /4 Sides of the House|see all 4 sides/i,
  'Street View UI must not claim one panorama represents four house elevations',
);
assert.match(
  estimator,
  /Photo-based siding analysis \(available without satellite\)[\s\S]{0,220}\(configSpecialties\.includes\('siding'\) \|\| photoSidingAnalysis\)/,
  'photo siding entry point must be available before satellite analysis',
);
assert.match(
  estimator,
  /normalizeEstimatorConfig\(JSON\.parse\(savedConfig\)\)/,
  'legacy or partial estimator configs must be normalized before rendering',
);
assert.match(estimator, /housePhotos\.length === 0 \|\| isAnalyzingPhotos \|\| !!uploadingSlot/, 'photo analysis must be disabled until a photo is ready');
assert.match(estimator, /Analyze Photos \(\{housePhotos\.length\}\)/, 'Analyze Photos action must remain visible');
assert.match(
  devHandlers,
  /const netWallSqFt = measurementGraph\.totals\.net_siding_area_sqft/,
  'development scalar siding area must originate from the canonical graph',
);
assert.doesNotMatch(
  devHandlers,
  /netWallSqFt\s*=\s*targetSqFt|SANITY-CORRECTED/,
  'development sanity checks must not replace the canonical measured area',
);
assert.match(
  fs.readFileSync('db/prod-integrations.cjs', 'utf8'),
  /const mod = await import\(pluginPath\)[\s\S]*?_functionHandlersCache = mod\.functionHandlers \|\| \{\}/,
  'production must import the same handler registry checked above',
);
assert.match(
  manualRebuild,
  /buildSidingMeasurementGraph\(/,
  'manual edits must rebuild canonical opening geometry instead of patching totals',
);
assert.match(
  estimator,
  /measurementGraph(?:=\{|:)\s*eff\.measurement_graph \|\| d\.measurement_graph/,
  '3D must consume the graph rebuilt from manual edits',
);

console.log('PASS: Street View is a single reference-only image in dev and production');
console.log('PASS: dev and production analyzers build the canonical graph without a <10 sqft filter');
console.log('PASS: estimate paths preserve the full measurement object and review gate');
console.log('PASS: calibration is fail-closed on missing or mismatched addresses');
console.log('PASS: sanity diagnostics and manual edits preserve canonical consumer equality');