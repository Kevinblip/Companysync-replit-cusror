#!/usr/bin/env node
/**
 * Regression coverage for the combined house-photo flow.
 *
 * This stays network-free: the graph is the contract that decides whether
 * photo roof evidence is authoritative, while source checks ensure both
 * handlers and the estimator surface the result.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');

const completePhotos = ['front', 'back', 'left_side', 'right_side'].map((face) => ({
  view_label: face,
  wall_face: face,
  confidence: 90,
  roof_edge_observation_complete: true,
  gutter_observation_complete: true,
  roof_planes: face === 'front' || face === 'back' ? [{
    observation_id: `main_${face}`,
    face,
    width_ft: 40,
    slope_length_ft: 18,
    pitch: '6/12',
    confidence: 90,
  }] : [],
  roof_edges: [
    { edge_id: `eave_${face}`, type: 'eave', face, length_ft: 32, confidence: 90 },
  ],
}));

(async () => {
  const { buildRoofMeasurementGraph, reconcileRoofMeasurement, summarizeRoofMeasurement } =
    await import('../functions/utils/roofMeasurementGraph.js');

  const completeGraph = buildRoofMeasurementGraph({
    perPhotoResults: completePhotos,
    buildingWidthFt: 40,
    buildingLengthFt: 32,
    footprintSource: 'photos',
  });
  assert.equal(completeGraph.coverage.area_complete, true, 'four calibrated photo elevations can complete the roof graph');
  const complete = summarizeRoofMeasurement(completeGraph);
  assert.equal(complete.status, 'complete');
  assert.ok(complete.area_sq > 0, 'complete photo roof exposes authoritative area');
  assert.equal(complete.pitch, '6/12');

  const partialGraph = buildRoofMeasurementGraph({
    perPhotoResults: completePhotos.slice(0, 2),
    buildingWidthFt: 40,
    buildingLengthFt: 32,
    footprintSource: 'photos',
  });
  const partial = summarizeRoofMeasurement(partialGraph);
  assert.equal(partial.status, 'partial', 'insufficient elevation coverage stays partial');
  assert.equal(partial.area_sq, null, 'partial photo roof never exposes a whole-roof area');
  assert.ok(partial.pitch, 'partial graph may still report observed pitch');

  const pitchOnlyGraph = buildRoofMeasurementGraph({
    perPhotoResults: [{
      view_label: 'Detail',
      wall_face: 'unknown',
      confidence: 90,
      roof_pitch_detected: '8/12',
      roof_pitch_confidence: 'high',
    }],
    buildingWidthFt: 40,
    buildingLengthFt: 32,
    footprintSource: 'photos',
  });
  const pitchOnly = summarizeRoofMeasurement(pitchOnlyGraph);
  assert.equal(pitchOnly.status, 'partial', 'pitch-only evidence is not a roof total');
  assert.equal(pitchOnly.area_sq, null);

  const sidingOnly = summarizeRoofMeasurement(buildRoofMeasurementGraph({
    perPhotoResults: completePhotos.map(photo => ({ ...photo, roof_planes: [], roof_edges: [] })),
    buildingWidthFt: 40,
    buildingLengthFt: 32,
    footprintSource: 'photos',
  }));
  assert.equal(sidingOnly.status, 'unavailable', 'siding-only photos do not invent roof geometry');

  const satellite = { roof_area_sq: 20, corrected_area_sq: 20, eave_lf: 144, confidence_warnings: [] };
  const fallback = reconcileRoofMeasurement(satellite, partialGraph);
  assert.equal(fallback.corrected_area_sq, 20, 'incomplete photo roof preserves Satellite fallback');

  const plugin = fs.readFileSync('vite-functions-plugin.js', 'utf8');
  const compatibility = fs.readFileSync('functions/analyzeHousePhotosForSiding.ts', 'utf8');
  const estimator = fs.readFileSync('src/pages/AIEstimator.jsx', 'utf8');
  for (const [label, source] of [['development/production handler', plugin], ['compatibility handler', compatibility]]) {
    assert.match(source, /summarizeRoofMeasurement/, `${label} returns the validated roof summary`);
    assert.match(source, /roof_measurement_graph/, `${label} preserves the graph for 3D/review consumers`);
  }
  assert.match(estimator, /Measure Siding \+ Roof from House Photos/);
  assert.match(estimator, /panel-photo-roof-summary/);

  console.log('photo roof measurement: all assertions passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});