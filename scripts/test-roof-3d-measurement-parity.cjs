#!/usr/bin/env node
/**
 * Regression coverage for the contract between the Measurement Summary and
 * HouseModel3D. Each fixture represents the metrics after one of the four
 * source-selection paths has produced its roof mesh.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nearlyEqual = (actual, expected, epsilon = 0.01) =>
  Math.abs(actual - expected) <= epsilon;

async function run() {
  const parity = await import(path.join(process.cwd(), 'src/utils/roof3DMeasurementParity.js'));
  const geometry = await import(path.join(process.cwd(), 'src/utils/MeshGeometryBuilder.js'));
  const sourceSelection = await import(path.join(process.cwd(), 'src/utils/roof3DSourceSelection.js'));
  const {
    compareRoof3DMeasurements,
    fitRoofSurfaceArraysToArea,
    lineLength,
    positionArraySurfaceArea,
  } = parity;
  const { buildParametricGable, buildParametricHip } = geometry;
  const { resolveRoof3DSource } = sourceSelection;

  const assertRenderedAreaFit = (name, surfaceArrays, wallHeightFt) => {
    const startingArea = surfaceArrays.reduce(
      (sum, vertices) => sum + positionArraySurfaceArea(vertices), 0
    );
    const targetArea = startingArea * 1.18;
    const fit = fitRoofSurfaceArraysToArea({
      surfaceArrays,
      wallHeightFt,
      targetAreaSqft: targetArea,
    });
    assert.equal(fit.applied, true, `${name}: roof mesh should be fitted to its source area`);
    assert.ok(nearlyEqual(fit.areaSqft, targetArea, 0.02), `${name}: fitted mesh area matches source`);
    fit.surfaceArrays.forEach((vertices, arrayIndex) => {
      vertices.forEach((value, index) => {
        if (index % 3 === 1 && nearlyEqual(surfaceArrays[arrayIndex][index], wallHeightFt)) {
          assert.ok(nearlyEqual(value, wallHeightFt), `${name}: wall plate remains fixed`);
        }
      });
    });
    console.log(`✓ ${name} rendered surface is fitted to its authoritative area`);
  };

  const assertParity = (name, rendered, summary) => {
    const result = compareRoof3DMeasurements({ rendered, summary });
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.mismatches)}`);
    assert.equal(result.checks.find(check => check.key === 'facetCount')?.pass, true, `${name}: facet count`);
    assert.equal(result.checks.find(check => check.key === 'wallHeightFt')?.pass, true, `${name}: wall height`);
    assert.equal(result.checks.find(check => check.key === 'eaveLf')?.pass, true, `${name}: eave LF`);
    assert.equal(result.checks.find(check => check.key === 'ridgeLf')?.pass, true, `${name}: ridge LF`);
    console.log(`✓ ${name}`);
  };

  // Calibrated physical-photo planes: two 20 ft × 10 ft slope planes.
  assertParity('physical-photo planes', {
    facetCount: 2,
    roofSurfaceAreaSqft: 400,
    eaveLf: 40,
    ridgeLf: 40,
    wallHeightFt: 9,
  }, {
    facetCount: 2,
    roofAreaSqft: 400,
    eaveLf: 40,
    ridgeLf: 40,
    wallHeightFt: 9,
  });

  // Canonical classified facets: topology-derived paths retain their own
  // segment count while matching the summary's source quantities.
  assertParity('canonical roof facets', {
    facetCount: 3,
    roofSurfaceAreaSqft: 960,
    eaveLf: 96,
    ridgeLf: 24,
    wallHeightFt: 18,
  }, {
    facetCount: 3,
    roofAreaSqft: 960,
    eaveLf: 96,
    ridgeLf: 24,
    wallHeightFt: 18,
  });

  // Filtered Solar segments: the post-filter count, not the raw API count, is
  // the number that appears in both the toolbar and summary.
  assertParity('filtered Solar segments', {
    facetCount: 4,
    roofSurfaceAreaSqft: 1200,
    eaveLf: 120,
    ridgeLf: 30,
    wallHeightFt: 9,
  }, {
    facetCount: 4,
    roofAreaSqft: 1200,
    eaveLf: 120,
    ridgeLf: 30,
    wallHeightFt: 9,
  });

  // The actual renderer runs these non-indexed triangle lists through the same
  // fitter after each selected path has built its mesh.
  assertRenderedAreaFit('physical-photo planes', [
    [0, 9, 0, 20, 9, 0, 20, 14, 10, 0, 9, 0, 20, 14, 10, 0, 14, 10],
    [0, 9, 10, 20, 9, 10, 20, 14, 0, 0, 9, 10, 20, 14, 0, 0, 14, 0],
  ], 9);
  assertRenderedAreaFit('canonical facets', [
    [0, 9, 0, 20, 9, 0, 10, 15, 10],
    [20, 9, 0, 40, 9, 0, 30, 15, 10],
  ], 9);
  assertRenderedAreaFit('Solar segment quads', [
    [0, 9, 0, 16, 9, 0, 16, 14, 8, 0, 9, 0, 16, 14, 8, 0, 14, 8],
    [16, 9, 0, 32, 9, 0, 32, 14, 8, 16, 9, 0, 32, 14, 8, 16, 14, 8],
  ], 9);

  const photoGraph = {
    coverage: { area_complete: true },
    planes: [
      { face: 'front', width_ft: 20, slope_length_ft: 12, area_sqft: 240 },
      { face: 'back', width_ft: 20, slope_length_ft: 12, area_sqft: 240 },
    ],
  };
  const graphFacets = [
    { id: 'graph-a', area_sqft: 200, edges: [], polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }] },
    { id: 'graph-b', area_sqft: 200, edges: [], polygon: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 15, y: 8 }] },
    { id: 'graph-c', area_sqft: 200, edges: [], polygon: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 25, y: 8 }] },
  ];

  const physicalSource = resolveRoof3DSource({
    roofGeometrySource: 'physical_photos',
    roofMeasurementGraph: photoGraph,
    measurementGraph: { roof_facets: graphFacets },
  });
  assert.deepEqual(
    { path: physicalSource.path, facetCount: physicalSource.facetCount },
    { path: 'physical_photos', facetCount: 2 },
    'authoritative complete photo planes are selected'
  );

  const rejectedPhotoSource = resolveRoof3DSource({
    roofGeometrySource: 'satellite',
    roofMeasurementGraph: photoGraph,
    measurementGraph: { roof_facets: graphFacets },
  });
  assert.deepEqual(
    { path: rejectedPhotoSource.path, facetCount: rejectedPhotoSource.facetCount },
    { path: 'canonical_facets', facetCount: 3 },
    'complete but non-authoritative photo planes do not replace the rendered canonical source'
  );

  const graphWinsOverSatellite = resolveRoof3DSource({
    roofGeometrySource: 'satellite',
    measurementGraph: { roof_facets: graphFacets.slice(0, 2) },
    roofFacets: [...graphFacets, { id: 'satellite-extra', area_sqft: 200, edges: [], polygon: [{ x: 30, y: 0 }, { x: 40, y: 0 }, { x: 35, y: 8 }] }],
  });
  assert.deepEqual(
    { path: graphWinsOverSatellite.path, facetCount: graphWinsOverSatellite.facetCount },
    { path: 'canonical_facets', facetCount: 2 },
    'measurement graph facets win over a conflicting satellite facet set'
  );
  console.log('✓ shared source selection honors roof authority and graph precedence');

  const L = 40;
  const W = 20;
  const wallHeightFt = 9;
  const slope = 0.5;
  const overhang = 1;
  const slopedWidth = Math.hypot(W / 2 + overhang, (W / 2) * slope);

  const gable = buildParametricGable(L, W, wallHeightFt, slope, overhang);
  const gableArea = positionArraySurfaceArea(gable.southFace.verts)
    + positionArraySurfaceArea(gable.northFace.verts);
  const expectedGableArea = 2 * (L + 2 * overhang) * slopedWidth;
  assert.ok(nearlyEqual(gableArea, expectedGableArea), 'gable mesh surface area is calculated from its faces');
  assertParity('parametric gable fallback', {
    facetCount: 2,
    roofSurfaceAreaSqft: gableArea,
    eaveLf: gable.eaveEdges.reduce((sum, edge) => sum + lineLength(edge.from, edge.to), 0),
    ridgeLf: lineLength(gable.ridge.from, gable.ridge.to),
    wallHeightFt,
  }, {
    facetCount: 2,
    roofAreaSqft: expectedGableArea,
    eaveLf: 2 * (L + 2 * overhang),
    ridgeLf: L + 2 * overhang,
    wallHeightFt,
  });
  assertRenderedAreaFit('parametric gable fallback', [
    gable.southFace.verts,
    gable.northFace.verts,
  ], wallHeightFt);

  const hip = buildParametricHip(L, W, wallHeightFt, slope, overhang);
  const hipArea = [hip.southVerts, hip.northVerts, hip.westVerts, hip.eastVerts]
    .reduce((sum, vertices) => sum + positionArraySurfaceArea(vertices), 0);
  assert.ok(nearlyEqual(hipArea, expectedGableArea), 'hip mesh surface area is calculated from its faces');
  assertParity('parametric hip fallback', {
    facetCount: 4,
    roofSurfaceAreaSqft: hipArea,
    eaveLf: hip.eaveEdges.reduce((sum, edge) => sum + lineLength(edge.from, edge.to), 0),
    ridgeLf: lineLength(hip.ridge.from, hip.ridge.to),
    wallHeightFt,
  }, {
    facetCount: 4,
    roofAreaSqft: expectedGableArea,
    eaveLf: 2 * (L + 2 * overhang) + 2 * (W + 2 * overhang),
    ridgeLf: L - W,
    wallHeightFt,
  });
  assertRenderedAreaFit('parametric hip fallback', [
    hip.southVerts,
    hip.northVerts,
    hip.westVerts,
    hip.eastVerts,
  ], wallHeightFt);

  const mismatch = compareRoof3DMeasurements({
    rendered: { facetCount: 2, wallHeightFt: 9 },
    summary: { facetCount: 3, wallHeightFt: 9 },
  });
  assert.equal(mismatch.ok, false, 'a facet-count mismatch is not silently accepted');
  assert.equal(mismatch.mismatches[0].key, 'facetCount');

  const component = fs.readFileSync(path.join(process.cwd(), 'src/components/estimator/HouseModel3D.jsx'), 'utf8');
  const estimator = fs.readFileSync(path.join(process.cwd(), 'src/pages/AIEstimator.jsx'), 'utf8');
  assert.match(component, /console\.warn\(formatRoof3DParityWarning\(parity\)/, 'dev mismatch warning is wired');
  assert.match(component, /data-testid="house-model-3d-facet-count"/, 'toolbar exposes rendered facet count');
  assert.match(component, /renderedFacetCount/, 'toolbar count is derived from the rendered path');
  assert.match(estimator, /data-testid="measurement-summary-roof-facet-count"/, 'card exposes facet count');

  console.log('\nRoof 3D measurement parity: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});