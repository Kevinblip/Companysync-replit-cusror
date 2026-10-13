#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');

(async () => {
  const {
    benchmarkSidingMeasurements,
    matchSidingBenchmarkProperty,
    SIDING_DISCREPANCY_CAUSES,
  } = await import('../functions/utils/sidingBenchmark.js');

  const subjectProperty = {
    address: '20638 Centuryway Rd, Maple Heights, OH 44137',
  };
  const canonicalGraph = {
    version: '1.0.0',
    wall_facets: [
      { id: 'facet_front', face: 'front' },
      { id: 'facet_back', face: 'back' },
      { id: 'facet_left', face: 'left_side' },
      { id: 'facet_right', face: 'right_side' },
    ],
    opening_groups: [
      { id: 'window-1', type: 'window' },
      { id: 'window-2', type: 'window' },
      { id: 'door-1', type: 'entry_door' },
    ],
    opening_components: [
      { id: 'window-1a', group_id: 'window-1' },
      { id: 'window-1b', group_id: 'window-1' },
    ],
    coverage: {
      status: 'review_required',
      confidence: 0.75,
      covered_faces: ['front', 'back', 'left_side'],
      missing_faces: ['right_side'],
    },
    totals: {
      siding_facade_area_sqft: 650,
      opening_deduction_sqft: 92,
      net_siding_area_sqft: 558,
      j_channel_lf: 101,
      starter_strip_lf: 94,
    },
  };
  const matchedHover = {
    provider: 'HOVER',
    report_category: 'complete_measurements',
    extraction_method: 'structured',
    property: {
      address: '20638 Centuryway Road, Maple Heights, OH 44137',
      property_id: 'HOVER-CENTURYWAY-TEST',
    },
    measurements: {
      wall_facets_count: 4,
      wall_facets: [
        { id: 'F-1', area_sqft: 160 },
        { id: 'F-2', area_sqft: 170 },
        { id: 'F-3', area_sqft: 155 },
        { id: 'F-4', area_sqft: 165 },
      ],
      facade_area_sqft: 640,
      rough_openings_count: 3,
      rough_openings: [
        { id: 'W-1', component_count: 2 },
        { id: 'W-2', component_count: 1 },
        { id: 'D-1', component_count: 1 },
      ],
      opening_components_count: 4,
      opening_area_sqft: 90,
      opening_perimeter_lf: 100,
      net_siding_area_sqft: 550,
      trim: { level_starter_lf: 95 },
      coverage: { covered_faces: ['front', 'back', 'left_side', 'right_side'] },
    },
  };

  const identity = matchSidingBenchmarkProperty(subjectProperty, matchedHover.property);
  assert.equal(identity.status, 'matched');
  assert.equal(identity.evidence.checks.report_property_id_present, true);

  const mismatch = benchmarkSidingMeasurements({
    subjectProperty,
    canonicalGraph,
    hoverReport: {
      ...matchedHover,
      property: {
        address: '17410 Lakesedge Trl, Chagrin Falls, OH 44023',
        property_id: '21374888',
      },
    },
  });
  assert.equal(mismatch.scoreable, false);
  assert.equal(mismatch.status, 'property_mismatch');
  assert.deepEqual(mismatch.categories, []);
  assert.equal(mismatch.aggregate_accuracy_score, null);
  assert.equal(mismatch.calibration_allowed, false);
  assert.ok(mismatch.blockers.includes('property_identity_mismatch'));

  const noPropertyId = benchmarkSidingMeasurements({
    subjectProperty,
    canonicalGraph,
    hoverReport: {
      ...matchedHover,
      property: { address: '20638 Centuryway Rd, Maple Heights, OH 44137' },
    },
  });
  assert.equal(noPropertyId.scoreable, false);
  assert.ok(noPropertyId.blockers.includes('property_identity_unverified'));

  const wrongZip = benchmarkSidingMeasurements({
    subjectProperty,
    canonicalGraph,
    hoverReport: {
      ...matchedHover,
      property: {
        address: '20638 Centuryway Rd, Maple Heights, OH 44023',
        property_id: 'wrong-zip',
      },
    },
  });
  assert.equal(wrongZip.scoreable, false);
  assert.ok(wrongZip.blockers.includes('property_identity_mismatch'));

  const nonHover = benchmarkSidingMeasurements({
    subjectProperty,
    canonicalGraph,
    hoverReport: { ...matchedHover, provider: 'CompanySync' },
  });
  assert.equal(nonHover.scoreable, false);
  assert.ok(nonHover.blockers.includes('source_not_hover'));

  const roofOnly = benchmarkSidingMeasurements({
    subjectProperty,
    canonicalGraph,
    hoverReport: { ...matchedHover, report_category: 'roof' },
  });
  assert.equal(roofOnly.scoreable, false);
  assert.ok(roofOnly.blockers.includes('roof_report_not_siding_benchmark'));

  const compared = benchmarkSidingMeasurements({
    subjectProperty,
    canonicalGraph,
    hoverReport: matchedHover,
  });
  assert.equal(compared.scoreable, true);
  assert.equal(compared.status, 'compared');
  assert.equal(compared.categories.length, 8);
  assert.equal(compared.aggregate_accuracy_score, null);
  assert.equal(compared.calibration_allowed, false);

  const allMetrics = compared.categories.flatMap((item) => item.metrics);
  const net = allMetrics.find((metric) => metric.key === 'net_siding_area_sqft');
  assert.equal(net.signed_difference, 8);
  assert.equal(net.absolute_difference, 8);
  assert.equal(net.signed_percent_difference, 1.45);
  assert.equal(net.absolute_percent_difference, 1.45);
  assert.equal(net.severity, 'within_uncertainty');
  assert.equal(net.discrepancy_cause, SIDING_DISCREPANCY_CAUSES.ESTIMATE_CONVERSION);
  assert.ok(net.uncertainty.combined_absolute > 0);

  const publishedHoverFacade = benchmarkSidingMeasurements({
    subjectProperty,
    canonicalGraph: {
      ...canonicalGraph,
      totals: {
        ...canonicalGraph.totals,
        siding_facade_area_sqft: 1000,
      },
    },
    hoverReport: {
      ...matchedHover,
      measurements: {
        ...matchedHover.measurements,
        gross_siding_facade_area_sqft: 1003,
        // HOVER Facades explicitly includes openings, so it cannot be used as
        // a post-opening net siding reference.
        net_siding_area_sqft: null,
      },
    },
  });
  const publishedFacadeMetrics = publishedHoverFacade.categories
    .flatMap((item) => item.metrics);
  const grossFacade = publishedFacadeMetrics.find((metric) => metric.key === 'siding_facade_area_sqft');
  const publishedNet = publishedFacadeMetrics.find((metric) => metric.key === 'net_siding_area_sqft');
  assert.equal(grossFacade.signed_difference, -3);
  assert.equal(grossFacade.absolute_percent_difference, 0.3);
  assert.equal(publishedNet.comparable, false);
  assert.equal(publishedNet.hover_value, null);

  const facadeOnlyHoverExtraction = benchmarkSidingMeasurements({
    subjectProperty,
    canonicalGraph: {
      ...canonicalGraph,
      totals: {
        ...canonicalGraph.totals,
        siding_facade_area_sqft: 1000,
      },
    },
    hoverReport: {
      ...matchedHover,
      measurements: {
        ...matchedHover.measurements,
        // The extractor may only populate the generic facade field. It is
        // still valid for the pre-opening comparison, never net siding.
        facade_area_sqft: 1003,
        gross_siding_facade_area_sqft: null,
        net_siding_area_sqft: null,
      },
    },
  });
  const facadeOnlyMetrics = facadeOnlyHoverExtraction.categories
    .flatMap((item) => item.metrics);
  assert.equal(
    facadeOnlyMetrics.find((metric) => metric.key === 'siding_facade_area_sqft').hover_value,
    1003,
  );
  assert.equal(
    facadeOnlyMetrics.find((metric) => metric.key === 'net_siding_area_sqft').hover_value,
    null,
  );

  const partialHistoricalGraph = benchmarkSidingMeasurements({
    subjectProperty,
    canonicalGraph: {
      version: '1.0.0',
      // This mirrors a historical result where only a final net area survived;
      // unavailable graph nodes must not become zero-valued comparisons.
      totals: { net_siding_area_sqft: 558 },
    },
    hoverReport: {
      ...matchedHover,
      measurements: {
        gross_siding_facade_area_sqft: 1003,
        net_siding_area_sqft: null,
      },
    },
  });
  const partialMetrics = partialHistoricalGraph.categories.flatMap((item) => item.metrics);
  assert.equal(partialMetrics.find((metric) => metric.key === 'wall_facet_count').canonical_value, null);
  assert.equal(partialMetrics.find((metric) => metric.key === 'rough_opening_count').canonical_value, null);
  assert.equal(partialMetrics.find((metric) => metric.key === 'opening_component_count').canonical_value, null);
  assert.equal(partialMetrics.find((metric) => metric.key === 'net_siding_area_sqft').hover_value, null);

  const categories = new Set(compared.categories.map((item) => item.key));
  for (const required of [
    'wall_facets',
    'rough_opening_assemblies',
    'opening_components',
    'opening_deductions',
    'j_channel',
    'net_siding',
    'trim',
    'coverage',
  ]) {
    assert.ok(categories.has(required), `missing benchmark category ${required}`);
  }

  console.log('PASS: HOVER report identity requires address, city/state/ZIP, and printed property ID');
  console.log('PASS: Lakesedge, non-HOVER, roof-only, and unverified reports are non-scoreable');
  console.log('PASS: matched siding comparisons report signed/absolute/% differences, uncertainty, and causes');
  console.log('PASS: HOVER Facades stays pre-opening and missing historical graph fields never become zero');
  console.log('PASS: benchmark never emits an aggregate accuracy score or calibration permission');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});