#!/usr/bin/env node
/**
 * HouseModel3D opening-position regression test.
 *
 * The siding analyzer reports opening centers in feet. Older records can carry
 * an explicit normalized/fraction unit. This test exercises the exact position
 * helper used by HouseModel3D and the graph path that supplies opening data.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

let passed = 0;
let failed = 0;
function ok(label, condition, got, expected) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label} — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    failed++;
  }
}

(async () => {
  const modelPath = path.join(process.cwd(), 'src/components/estimator/HouseModel3D.jsx');
  const modelSource = fs.readFileSync(modelPath, 'utf8');
  const helperMatch = modelSource.match(
    /function openingPositionFraction\(value, dimensionFt, opening\) \{[\s\S]*?\n\}/
  );
  if (!helperMatch) throw new Error('openingPositionFraction not found in HouseModel3D');
  const openingPositionFraction = new Function(`${helperMatch[0]}\nreturn openingPositionFraction;`)();

  console.log('\n── HouseModel3D opening positions ──');
  ok('12-ft position on a 36-ft wall becomes 1/3',
    openingPositionFraction(12, 36, { position_unit: 'feet' }) === 1 / 3,
    openingPositionFraction(12, 36, { position_unit: 'feet' }), 1 / 3);
  ok('unmarked current 1-ft edge position stays at 1/30',
    openingPositionFraction(1, 30, {}) === 1 / 30,
    openingPositionFraction(1, 30, {}), 1 / 30);
  ok('explicit legacy fraction stays a fraction',
    openingPositionFraction(1 / 30, 30, { position_unit: 'fraction' }) === 1 / 30,
    openingPositionFraction(1 / 30, 30, { position_unit: 'fraction' }), 1 / 30);
  ok('explicit legacy normalized vertical position stays a fraction',
    openingPositionFraction(0.4, 10, { position_unit: 'normalized' }) === 0.4,
    openingPositionFraction(0.4, 10, { position_unit: 'normalized' }), 0.4);

  const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');
  const graph = buildSidingMeasurementGraph({
    perPhotoResults: [{
      view_label: 'Front',
      confidence: 0.9,
      openings: [{
        type: 'window',
        width_ft: 3,
        height_ft: 4,
        pos_x: 1,
        pos_y: 3,
        position_unit: 'feet',
      }],
    }],
    grossWallAreaSqft: 1000,
    accentDeductionSqft: 0,
    perimeterFt: 120,
    smallOpeningsInWaste: true,
  });
  const opening = graph.opening_groups[0];
  console.log('\n── Canonical opening propagation ──');
  ok('graph keeps the measured horizontal position', opening.pos_x === 1, opening.pos_x, 1);
  ok('graph keeps the measured vertical position', opening.pos_y === 3, opening.pos_y, 3);
  ok('graph keeps the coordinate unit for HouseModel3D', opening.position_unit === 'feet', opening.position_unit, 'feet');

  const { partitionGableEndOpenings } = await import('../src/utils/gableOpeningRouting.js');
  const routed = partitionGableEndOpenings([
    { id: 'wall-west', type: 'window', wall_face: 'west', width_ft: 3, height_ft: 4, pos_y: 5 },
    { id: 'gable-west', type: 'window', wall_face: 'left_side', width_ft: 3, height_ft: 4, pos_y: 12 },
    { id: 'gable-east', type: 'window', wall_face: 'E', width_ft: 3, height_ft: 4, pos_y: 13 },
    { id: 'legacy-east', type: 'window', wall_face: 'east', width_ft: 3, height_ft: 4 },
    { id: 'front-high', type: 'window', wall_face: 'front', width_ft: 3, height_ft: 4, pos_y: 13 },
  ], 9);
  console.log('\n── Parametric gable opening routing ──');
  ok('ordinary west wall window stays out of the gable', routed.wall.some(o => o.id === 'wall-west'), routed.wall.map(o => o.id), ['wall-west']);
  ok('measured left-side window above the wall plate routes to west gable', routed.west.map(o => o.id).includes('gable-west'), routed.west.map(o => o.id), ['gable-west']);
  ok('measured E-cardinal window above the wall plate routes to east gable', routed.east.map(o => o.id).includes('gable-east'), routed.east.map(o => o.id), ['gable-east']);
  ok('unpositioned legacy east window stays on its wall', routed.wall.some(o => o.id === 'legacy-east'), routed.wall.map(o => o.id), ['legacy-east']);
  ok('high front window never routes to an end gable', routed.wall.some(o => o.id === 'front-high'), routed.wall.map(o => o.id), ['front-high']);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});