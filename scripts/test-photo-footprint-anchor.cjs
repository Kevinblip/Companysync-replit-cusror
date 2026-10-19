#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const { acceptSatelliteFootprint, footprintFromClientPolygon } = await import('../functions/utils/photoFootprintAnchor.js');
  const { applyMeasuredOpeningDeduction, openingDeductionLabel } = await import('../src/utils/openingDeductionDisplay.js');

  // Coleman: photos boxed the house at 108 LF. Hover's wall line is 154'3".
  const kept = acceptSatelliteFootprint({ photoPerimeterFt: 108, satellitePerimeterFt: 154.25 });
  assert.equal(kept.accept, true);
  assert.equal(kept.reason, 'within_band');

  // A photo run that sees one wing must not discard a much longer outline.
  const shortPhotos = acceptSatelliteFootprint({ photoPerimeterFt: 30, satellitePerimeterFt: 154.25 });
  assert.equal(shortPhotos.accept, true);
  assert.equal(shortPhotos.reason, 'photos_short_of_footprint');

  // Satellite much smaller than the photos is the wrong building.
  const wrongBuilding = acceptSatelliteFootprint({ photoPerimeterFt: 200, satellitePerimeterFt: 80 });
  assert.equal(wrongBuilding.accept, false);
  assert.equal(wrongBuilding.reason, 'satellite_smaller_than_photos');

  const ring = [[-29.1, -9.45], [29.1, -9.45], [29.1, 9.45], [-29.1, 9.45]];
  const anchored = footprintFromClientPolygon(ring);
  assert.ok(anchored);
  assert.equal(anchored.perimeterFt, 154);
  assert.equal(anchored.lengthFt, 58);
  assert.equal(anchored.widthFt, 19);
  assert.equal(footprintFromClientPolygon([[0, 0], [10, 0], [10, 10]]), null);

  const measured = {
    gross_wall_area_sqft: 1074,
    opening_deduction_sqft: 178,
    wall_area_sqft: 854,
    windows_count: 18,
    doors_count: 2,
    openings_detail: [{ type: 'window', sqft: 140 }, { type: 'door', sqft: 38 }],
    measurement_graph: { totals: { opening_area_total_sqft: 178, net_siding_area_sqft: 854 }, counts: { rough_openings: 20 } },
  };
  const applied = applyMeasuredOpeningDeduction(measured);
  assert.equal(applied.measured, true);
  assert.equal(measured.opening_deduction_basis, 'measured');
  assert.notEqual(measured.opening_deduction_pct, 15);
  assert.equal(measured.wall_area_sqft, 854);
  assert.match(openingDeductionLabel(measured), /178 sqft measured/);

  const allowance = applyMeasuredOpeningDeduction({
    gross_wall_area_sqft: 1400,
    opening_deduction_sqft: 136,
    windows_count: 8,
    doors_count: 2,
    measurement_graph: { totals: { net_siding_area_sqft: 1264 } },
  });
  assert.equal(allowance.measured, false);
  assert.equal(allowance.snappedPct, 10);

  const page = fs.readFileSync('src/pages/AIEstimator.jsx', 'utf8');
  assert.match(page, /use_satellite: !isGarageMode && photoLat != null && photoLng != null/);
  assert.doesNotMatch(page, /use_satellite: !isGarageMode && useSatelliteMode/);
  assert.match(page, /Brick veneer — excluded from vinyl siding/);
  assert.match(page, /description: 'Fascia'/);
  assert.match(page, /description: 'Soffit'/);
  assert.match(page, /description: 'Gutter, aluminum'/);

  const plugin = fs.readFileSync('vite-functions-plugin.js', 'utf8');
  assert.match(plugin, /acceptSatelliteFootprint/);
  assert.match(plugin, /footprintFromClientPolygon/);
  assert.match(plugin, /opening_deduction_basis: measurementGraph\.counts\.rough_openings > 0 \? 'measured' : 'allowance'/);
  assert.match(plugin, /sqft measured/);

  console.log('Photo footprint anchor, measured openings, and estimate lines passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
