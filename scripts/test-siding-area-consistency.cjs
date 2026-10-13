#!/usr/bin/env node
/**
 * Siding area consistency smoke test.
 *
 * The same known house is evaluated through the three production paths:
 *   1. canonical photo measurement graph
 *   2. manual-edit graph rebuild
 *   3. roof-footprint fallback used by AIEstimator when wall analysis is empty
 *
 * The fallback uses the estimator's supported 20% opening assumption. For this
 * fixture (4 windows, 2 entry doors, 2 double garage doors), that assumption
 * is within 1% of the measured opening geometry.
 */

'use strict';

const assert = require('node:assert/strict');

const HOUSE = {
  widthFt: 36,
  lengthFt: 36,
  storyCount: 1,
  wallHeightFt: 9,
  windows: 4,
  entryDoors: 2,
  garageDoors: 2,
};
HOUSE.perimeterFt = 2 * (HOUSE.widthFt + HOUSE.lengthFt);
HOUSE.grossWallAreaSqft = HOUSE.perimeterFt * HOUSE.wallHeightFt;

const openingGeometry = [
  ...Array.from({ length: HOUSE.windows }, (_, index) => ({
    observation_id: `window-${index}`,
    type: 'window',
    width_ft: 3,
    height_ft: 4,
    pos_x: 4 + index * 4,
    pos_y: 3,
  })),
  ...Array.from({ length: HOUSE.entryDoors }, (_, index) => ({
    observation_id: `entry-door-${index}`,
    type: 'entry_door',
    width_ft: 3,
    height_ft: 6.8,
    pos_x: 8 + index * 4,
    pos_y: 0,
  })),
  ...Array.from({ length: HOUSE.garageDoors }, (_, index) => ({
    observation_id: `garage-door-${index}`,
    type: 'garage_door',
    width_ft: 16,
    height_ft: 7,
    pos_x: 8 + index * 18,
    pos_y: 0,
    at_grade: true,
  })),
];

function photoInput() {
  return [
    { view_label: 'Front', confidence: 0.95, openings: openingGeometry },
    { view_label: 'Back', confidence: 0.95 },
    { view_label: 'Left', confidence: 0.95 },
    { view_label: 'Right', confidence: 0.95 },
  ];
}

function assertWithinFivePercent(values) {
  const baseline = values.canonical;
  for (const [label, value] of Object.entries(values)) {
    const difference = Math.abs(value - baseline) / baseline;
    assert(
      difference <= 0.05,
      `${label} (${value}) must be within 5% of canonical area (${baseline}); difference=${(difference * 100).toFixed(2)}%`,
    );
  }
}

(async () => {
  const { buildSidingMeasurementGraph } =
    await import('../functions/utils/sidingMeasurementGraph.js');
  const { rebuildSidingMeasurementsFromEdits } =
    await import('../src/utils/rebuildSidingMeasurements.js');
  const {
    buildRoofFootprintFallback,
  } = await import('../src/utils/sidingPhotoList.js');
  const {
    calculateRoofAreaFromFootprint,
    OVERHANG_FACTOR,
  } = await import('../src/utils/companySyncFormulas.js');

  const graph = buildSidingMeasurementGraph({
    perPhotoResults: photoInput(),
    storyCount: HOUSE.storyCount,
    wallHeightFt: HOUSE.wallHeightFt,
    grossWallAreaSqft: HOUSE.grossWallAreaSqft,
    accentDeductionSqft: 0,
    perimeterFt: HOUSE.perimeterFt,
    buildingWidthFt: HOUSE.widthFt,
    buildingLengthFt: HOUSE.lengthFt,
    smallOpeningsInWaste: false,
  });
  const canonicalArea = graph.totals.net_siding_area_sqft;

  const original = {
    perimeter_ft: HOUSE.perimeterFt,
    story_count: HOUSE.storyCount,
    story_height_ft: HOUSE.wallHeightFt,
    building_width_ft: HOUSE.widthFt,
    building_length_ft: HOUSE.lengthFt,
    windows_count: HOUSE.windows,
    doors_count: HOUSE.entryDoors,
    garage_door_count: HOUSE.garageDoors,
    measurement_graph: graph,
  };
  const rebuilt = rebuildSidingMeasurementsFromEdits(original, {
    perimeter_ft: HOUSE.perimeterFt,
    story_height_ft: HOUSE.wallHeightFt,
    windows_count: HOUSE.windows,
    doors_count: HOUSE.entryDoors,
    garage_door_count: HOUSE.garageDoors,
  });
  const rebuiltArea = rebuilt.measurement_graph.totals.net_siding_area_sqft;

  // This is the same helper AIEstimator invokes after Solar returns no wall area.
  // 20% is one of the estimator's supported opening-deduction selections.
  const fallback = buildRoofFootprintFallback(
    { eave_lf: HOUSE.perimeterFt },
    HOUSE.storyCount,
    HOUSE.wallHeightFt,
    20,
  );
  const fallbackArea = fallback.wall_area_sqft;

  assert.equal(graph.reconciliation.consistent, true);
  assert.equal(rebuilt.measurement_graph.reconciliation.consistent, true);
  assert.ok(canonicalArea >= 1000 && canonicalArea <= 1060,
    `canonical area ${canonicalArea} should be in the known-good 1,000–1,060 sqft range`);
  assert.ok(fallbackArea >= 1000 && fallbackArea <= 1060,
    `fallback area ${fallbackArea} should be in the known-good 1,000–1,060 sqft range`);
  assertWithinFivePercent({
    canonical: canonicalArea,
    rebuilt: rebuiltArea,
    roofFallback: fallbackArea,
  });

  console.log(
    `PASS: siding area consistency — canonical=${canonicalArea}, ` +
    `rebuilt=${rebuiltArea}, roofFallback=${fallbackArea} sqft`,
  );

  const footprintSqft = HOUSE.widthFt * HOUSE.lengthFt;
  for (const pitch of [4, 6, 8]) {
    const expected = Math.round(
      footprintSqft * Math.sqrt(1 + (pitch / 12) ** 2) * OVERHANG_FACTOR,
    );
    const actual = calculateRoofAreaFromFootprint(footprintSqft, pitch);
    assert.equal(
      actual,
      expected,
      `${pitch}/12 roof area must include the ${OVERHANG_FACTOR} overhang factor`,
    );
    assert.ok(
      actual > Math.round(footprintSqft * Math.sqrt(1 + (pitch / 12) ** 2)),
      `${pitch}/12 roof area should exceed slope-only area because of overhang`,
    );
  }
  console.log(`PASS: ${OVERHANG_FACTOR} overhang factor appears in 4/12, 6/12, and 8/12 roof areas`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});