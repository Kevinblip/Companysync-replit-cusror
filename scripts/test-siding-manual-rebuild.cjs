#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');

(async () => {
  const { buildSidingMeasurementGraph } =
    await import('../functions/utils/sidingMeasurementGraph.js');
  const { rebuildSidingMeasurementsFromEdits } =
    await import('../src/utils/rebuildSidingMeasurements.js');

  const originalGraph = buildSidingMeasurementGraph({
    perPhotoResults: [
      {
        view_label: 'Front',
        confidence: 0.9,
        openings: [
          {
            observation_id: 'window-group',
            type: 'window',
            width_ft: 8,
            height_ft: 4,
            pos_x: 8,
            pos_y: 3,
            components: [
              { type: 'window', width_ft: 4, height_ft: 4 },
              { type: 'window', width_ft: 4, height_ft: 4 },
            ],
          },
          {
            observation_id: 'garage-1',
            type: 'garage_door',
            width_ft: 16,
            height_ft: 7,
            pos_x: 24,
            pos_y: 0,
          },
        ],
      },
      { view_label: 'Back', confidence: 0.9 },
      { view_label: 'Left', confidence: 0.9 },
      { view_label: 'Right', confidence: 0.9 },
    ],
    storyCount: 1,
    wallHeightFt: 9,
    grossWallAreaSqft: 1080,
    accentDeductionSqft: 0,
    perimeterFt: 120,
    buildingWidthFt: 30,
    buildingLengthFt: 30,
    smallOpeningsInWaste: true,
  });
  const original = {
    perimeter_ft: 120,
    story_count: 1,
    story_height_ft: 9,
    building_width_ft: 30,
    building_length_ft: 30,
    windows_count: 1,
    doors_count: 0,
    garage_door_count: 1,
    trim_totals: {
      j_channel_lf: originalGraph.totals.j_channel_lf,
      starter_strip_lf: originalGraph.totals.starter_strip_lf,
    },
    measurement_graph: originalGraph,
  };

  assert.strictEqual(
    rebuildSidingMeasurementsFromEdits(original, {}),
    original,
    'no edits must retain the exact canonical result',
  );

  const rebuilt = rebuildSidingMeasurementsFromEdits(original, {
    perimeter_ft: 140,
    windows_count: 3,
    doors_count: 2,
    garage_door_count: 2,
  });
  const graph = rebuilt.measurement_graph;

  assert.equal(graph.counts.window_assemblies, 3);
  assert.equal(graph.counts.window_units, 4, 'retained grouped window keeps two components');
  assert.equal(graph.counts.entry_doors, 2);
  assert.equal(graph.counts.garage_doors, 2);
  assert.equal(graph.opening_groups.length, 7, '3D receives all edited openings');
  assert.equal(
    graph.opening_groups.filter((opening) => opening.uncertainty === 'count_based_default_geometry').length,
    5,
    'new count-only openings are visibly synthetic',
  );
  assert.equal(graph.totals.starter_strip_lf, 108, '140 perimeter - two 16ft garage doors');
  assert.equal(rebuilt.starter_strip_lf, graph.totals.starter_strip_lf);
  assert.equal(rebuilt.j_channel_openings_lf, graph.totals.j_channel_lf);
  assert.equal(rebuilt.opening_deduction_sqft, graph.totals.opening_deduction_sqft);
  assert.equal(rebuilt.wall_area_sqft, graph.totals.net_siding_area_sqft);
  assert.equal(rebuilt.gross_wall_area_sqft, graph.totals.gross_wall_area_sqft);
  assert.deepEqual(graph.coverage, originalGraph.coverage, 'manual edits do not manufacture coverage');
  assert.equal(graph.reconciliation.consistent, true);

  const reduced = rebuildSidingMeasurementsFromEdits(original, {
    windows_count: 0,
    garage_door_count: 0,
  });
  assert.equal(reduced.measurement_graph.opening_groups.length, 0);
  assert.equal(reduced.measurement_graph.counts.rough_openings, 0);
  assert.equal(reduced.starter_strip_lf, 120);
  assert.equal(reduced.wall_area_sqft, reduced.measurement_graph.totals.net_siding_area_sqft);

  console.log('PASS: manual siding edits rebuild canonical openings, trim, totals, and scalars');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});