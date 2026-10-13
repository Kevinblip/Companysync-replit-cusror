const assert = require('node:assert/strict');

(async () => {
  const { benchmarkSidingMeasurements } = await import('../functions/utils/sidingBenchmark.js');
  const { selectActiveSidingMeasurement } = await import('../src/utils/selectActiveSidingMeasurement.js');
  const subjectProperty = { address: '123 Main Street, Columbus, OH 43215' };
  const hoverReport = {
    provider: 'hover',
    report_category: 'siding',
    property: {
      property_id: 'hover-123',
      address: '123 Main St, Columbus, OH 43215',
    },
    measurements: {
      net_siding_area_sqft: 900,
      wall_facets_count: 4,
      rough_openings_count: 3,
      opening_components_count: 4,
      opening_deduction_sqft: 100,
      j_channel_lf: 80,
      level_starter_lf: 120,
      coverage: { covered_face_count: 4 },
    },
  };

  const legacy = benchmarkSidingMeasurements({
    subjectProperty,
    hoverReport,
    canonicalGraph: {
      version: 'legacy',
      totals: { net_siding_area_sqft: 950 },
    },
  });
  assert.equal(legacy.scoreable, true);
  assert.equal(legacy.status, 'partial_comparison');
  assert.equal(legacy.canonical_graph_status, 'partial');
  const facetMetric = legacy.categories[0].metrics[0];
  assert.equal(facetMetric.comparable, false);
  assert.equal(facetMetric.canonical_value, null);

  const complete = benchmarkSidingMeasurements({
    subjectProperty,
    hoverReport,
    canonicalGraph: {
      version: '1.1.0',
      wall_facets: [],
      opening_groups: [],
      opening_components: [],
      trim_edges: [],
      coverage: { covered_faces: [] },
      totals: { net_siding_area_sqft: 950 },
    },
  });
  assert.equal(complete.status, 'compared');
  assert.equal(complete.canonical_graph_status, 'complete');

  const satelliteGraph = {
    version: 'satellite',
    wall_facets: [{ id: 'old-facet' }],
    opening_groups: [],
    opening_components: [],
    trim_edges: [],
    coverage: { covered_faces: ['front'] },
    totals: { net_siding_area_sqft: 700 },
  };
  const photoGraph = {
    version: 'photo',
    wall_facets: [{ id: 'front' }, { id: 'back' }],
    opening_groups: [{ id: 'rough-1', component_ids: ['window-1', 'window-2'] }],
    opening_components: [
      { id: 'window-1', group_id: 'rough-1' },
      { id: 'window-2', group_id: 'rough-1' },
    ],
    trim_edges: [{ id: 'j-channel-1', lf: 24 }],
    coverage: { covered_faces: ['front', 'back'] },
    totals: { net_siding_area_sqft: 950, j_channel_lf: 24 },
  };
  const active = selectActiveSidingMeasurement({
    sidingMeasurements: { measurement_graph: satelliteGraph },
    photoSidingAnalysis: { measurement_graph: photoGraph },
  });
  const persisted = JSON.parse(JSON.stringify(active));
  const restored = persisted;
  assert.deepEqual(restored.measurement_graph, photoGraph);
  assert.notDeepEqual(restored.measurement_graph, satelliteGraph);

  console.log('siding benchmark historical graph checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});