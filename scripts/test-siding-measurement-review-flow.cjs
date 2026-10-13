#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const estimator = fs.readFileSync(path.join(root, 'src/pages/AIEstimator.jsx'), 'utf8');

function extractFunction(source, declaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing ${declaration}`);
  const nextFunction = source.indexOf('\n  const ', start + declaration.length);
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction);
}

async function run() {
  const flowModule = await import(pathToFileURL(path.join(root, 'src/utils/sidingMeasurementFlow.js')).href);
  const { completeSidingMeasurement } = flowModule;
  const measurements = { wall_area_sq: 18.5, customer_info: { property_address: 'Test property' } };

  for (const label of ['Photos Only', 'Photos + Satellite', 'Satellite Only', 'Remeasure']) {
    const state = { measurements: null, lineItems: [], currentEstimate: null };
    let buildCalls = 0;
    await completeSidingMeasurement({
      measurements,
      autoBuild: false,
      setMeasurements: value => { state.measurements = value; },
      buildEstimate: async value => {
        buildCalls += 1;
        state.lineItems = [{ description: 'Siding', quantity: value.wall_area_sq }];
        state.currentEstimate = { title: 'Siding Estimate' };
      },
    });

    assert.deepEqual(state.measurements, measurements, `${label} must expose measurements for review`);
    assert.deepEqual(state.lineItems, [], `${label} must not populate line items during measurement`);
    assert.equal(state.currentEstimate, null, `${label} must not create an estimate during measurement`);
    assert.equal(buildCalls, 0, `${label} must not invoke the estimate builder during measurement`);

    await completeSidingMeasurement({
      measurements: state.measurements,
      autoBuild: true,
      setMeasurements: value => { state.measurements = value; },
      buildEstimate: async value => {
        buildCalls += 1;
        state.lineItems = [{ description: 'Siding', quantity: value.wall_area_sq }];
        state.currentEstimate = { title: 'Siding Estimate' };
      },
    });
    assert.equal(state.lineItems.length, 1, `${label} explicit build must populate line items`);
    assert.ok(state.currentEstimate, `${label} explicit build must create the estimate`);
    assert.equal(buildCalls, 1, `${label} explicit build must invoke the builder once`);
  }

  for (const label of ['Generate Estimate', 'Regenerate Estimate']) {
    const state = { measurements: null, lineItems: [], currentEstimate: null };
    await completeSidingMeasurement({
      measurements,
      autoBuild: true,
      setMeasurements: value => { state.measurements = value; },
      buildEstimate: async value => {
        state.lineItems = [{ description: 'Siding', quantity: value.wall_area_sq }];
        state.currentEstimate = { title: 'Siding Estimate' };
      },
    });
    assert.deepEqual(state.measurements, measurements, `${label} must retain measurements`);
    assert.equal(state.lineItems.length, 1, `${label} must auto-build line items`);
    assert.ok(state.currentEstimate, `${label} must auto-build the estimate`);
  }

  const analyzeSiding = extractFunction(estimator, 'const handleAnalyzeSiding = async');
  assert.match(
    analyzeSiding,
    /completeSidingMeasurement\(\{[\s\S]*?autoBuild,[\s\S]*?buildEstimate:\s*convertSidingMeasurementsToLineItems/,
    'siding analysis must route successful results through the tested auto-build contract',
  );

  const analyzePhotos = extractFunction(estimator, 'const handleAnalyzePhotos = async');
  assert.match(
    analyzePhotos,
    /completeSidingMeasurement\(\{[\s\S]*?autoBuild:\s*false,[\s\S]*?setMeasurements:\s*setPhotoSidingAnalysis/,
    'Photos Only analysis must store measurements without building an estimate',
  );

  const measurementButtons = [
    ['satellite result remeasure', 'button-remeasure-siding', /handleAnalyzeSiding\(undefined,\s*\{\s*satelliteOnly:\s*useSatelliteMode,\s*autoBuild:\s*false\s*\}\)/],
    ['satellite-only measure', 'button-analyze-satellite-siding', /handleAnalyzeSiding\(undefined,\s*\{\s*satelliteOnly:\s*true,\s*autoBuild:\s*false\s*\}\)/],
    ['Photos + Satellite measure', 'button-analyze-photos-satellite', /handleAnalyzeSiding\(undefined,\s*\{\s*autoBuild:\s*false\s*\}\)/],
    ['standalone satellite measure', 'button-analyze-siding', /handleAnalyzeSiding\(undefined,\s*\{\s*satelliteOnly:\s*true,\s*autoBuild:\s*false\s*\}\)/],
  ];
  for (const [label, testId, invocation] of measurementButtons) {
    const index = estimator.indexOf(testId);
    assert.notEqual(index, -1, `${label} button must exist`);
    assert.match(estimator.slice(index, index + 650), invocation, `${label} must explicitly disable auto-build`);
  }

  assert.match(
    estimator,
    /data-testid="button-build-siding-estimate"[\s\S]{0,260}handleBuildSidingEstimate\(sd\)/,
    'the satellite review panel must expose the explicit estimate build action',
  );
  assert.match(
    estimator,
    /data-testid="button-build-photo-siding-estimate"[\s\S]{0,380}handleBuildSidingEstimate\(hasEdits \? eff : photoSidingAnalysis\)/,
    'the photo review panel must expose the explicit estimate build action',
  );

  const defaultAutoBuildCalls = estimator.match(/handleAnalyzeSiding\(undefined,\s*\{\s*satelliteOnly:\s*useSatelliteMode\s*\}\)/g) || [];
  assert.equal(defaultAutoBuildCalls.length, 2, 'Generate and Regenerate Estimate must retain exactly two default auto-build calls');

  console.log('✓ Siding measurement paths stop for review; explicit and Generate Estimate builds remain guarded.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});