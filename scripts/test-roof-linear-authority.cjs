#!/usr/bin/env node
const assert = require('node:assert/strict');

const LAT0 = 41.0;
const LNG0 = -81.0;
const FT_PER_LAT = 364567.2;
const ftPerLng = lat => FT_PER_LAT * Math.cos(lat * Math.PI / 180);
function seg(eastFt, northFt, azimuth, A = 12, B = 30) {
  const lat = LAT0 + northFt / FT_PER_LAT;
  const lng = LNG0 + eastFt / ftPerLng(LAT0);
  const azR = azimuth * Math.PI / 180;
  const bboxW = A * Math.abs(Math.sin(azR)) + B * Math.abs(Math.cos(azR));
  const bboxH = A * Math.abs(Math.cos(azR)) + B * Math.abs(Math.sin(azR));
  return {
    pitchDegrees: 26,
    azimuthDegrees: azimuth,
    center: { latitude: lat, longitude: lng },
    boundingBox: {
      sw: { latitude: lat - bboxH / 2 / FT_PER_LAT, longitude: lng - bboxW / 2 / ftPerLng(LAT0) },
      ne: { latitude: lat + bboxH / 2 / FT_PER_LAT, longitude: lng + bboxW / 2 / ftPerLng(LAT0) },
    },
    stats: { areaMeters2: 40 },
  };
}

(async () => {
  const { buildRoofFacetsFromSolarSegments, computeEdgeTotals } =
    await import('../functions/utils/roofFacetGeometry.js');
  const { reconcileRoofLinearsWithFacetEdges } =
    await import('../functions/utils/roofLinearAuthority.js');

  const completeGable = buildRoofFacetsFromSolarSegments([
    seg(0, -6, 180),
    seg(0, 6, 0),
  ]);
  const gableResult = reconcileRoofLinearsWithFacetEdges({
    ridge_lf: 55, hip_lf: 20, valley_lf: 0, rake_lf: 0, eave_lf: 90,
  }, computeEdgeTotals(completeGable), completeGable);
  assert.equal(gableResult.source, 'roof_facet_edges');
  assert.equal(gableResult.trace_quality.usable, true);
  assert.ok(gableResult.linears.rake_lf > 0);
  assert.equal(gableResult.linears.hip_lf, 0);

  const benchmarkFacets = structuredClone(completeGable);
  const mixedGableHip = reconcileRoofLinearsWithFacetEdges({
    ridge_lf: 34, hip_lf: 96, valley_lf: 0, rake_lf: 0, eave_lf: 197,
  }, {
    ridge: 31.2, hip: 37.1, valley: 0, rake: 128.1, eave: 166.1,
  }, benchmarkFacets);
  assert.equal(mixedGableHip.linears.eave_lf + mixedGableHip.linears.rake_lf, 294.2);
  assert.equal(mixedGableHip.linears.ridge_lf + mixedGableHip.linears.hip_lf, 68.3);
  assert.equal(mixedGableHip.differences.rake_lf.relative_difference, 1);

  const heuristic = {
    ridge_lf: 42, hip_lf: 70, valley_lf: 18, rake_lf: 0, eave_lf: 150,
  };
  const oneFacet = buildRoofFacetsFromSolarSegments([seg(0, -6, 180)]);
  const oneFacetResult = reconcileRoofLinearsWithFacetEdges(
    heuristic, computeEdgeTotals(oneFacet), oneFacet
  );
  assert.equal(oneFacetResult.trace_quality.reason, 'insufficient_facets');
  assert.deepEqual(oneFacetResult.linears, heuristic);

  const disconnected = buildRoofFacetsFromSolarSegments([
    seg(0, 0, 180),
    seg(80, 80, 90),
  ]);
  const disconnectedTotals = computeEdgeTotals(disconnected);
  const disconnectedResult = reconcileRoofLinearsWithFacetEdges(
    heuristic, disconnectedTotals, disconnected
  );
  assert.equal(disconnectedResult.trace_quality.reason, 'disconnected_facets');
  assert.equal(disconnectedResult.trace_quality.usable, false);
  if (disconnectedTotals.rake > 0) {
    assert.equal(disconnectedResult.source, 'roof_facet_edges_rake_kept');
    assert.equal(disconnectedResult.linears.rake_lf, disconnectedTotals.rake);
  } else {
    assert.deepEqual(disconnectedResult.linears, heuristic);
  }

  const unresolved = structuredClone(completeGable);
  const provisionalRidge = unresolved[0].edges.find(edge => edge.type === 'ridge');
  provisionalRidge.shared_with = null;
  const unresolvedTotals = computeEdgeTotals(unresolved);
  const unresolvedResult = reconcileRoofLinearsWithFacetEdges(
    heuristic, unresolvedTotals, unresolved
  );
  assert.equal(unresolvedResult.trace_quality.reason, 'unresolved_uphill_edges');
  assert.equal(unresolvedResult.trace_quality.usable, false);
  if (unresolvedTotals.rake > 0) {
    assert.equal(unresolvedResult.source, 'roof_facet_edges_rake_kept');
    assert.equal(unresolvedResult.linears.rake_lf, unresolvedTotals.rake);
    assert.equal(unresolvedResult.linears.hip_lf, unresolvedTotals.hip);
  } else {
    assert.deepEqual(unresolvedResult.linears, heuristic);
  }

  console.log('roof linear authority: all assertions passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});