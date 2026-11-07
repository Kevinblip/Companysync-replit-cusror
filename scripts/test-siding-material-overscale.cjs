'use strict';

// Malec regression: an incomplete material map that holds more wall than the
// canonical gross must be fitted down before siding is billed, and stucco
// must come off siding the same way stone and brick do. Synthetic data only;
// no AI provider, database, or external API is called.

let passed = 0;
let failed = 0;
function ok(label, condition, got, expected) {
  if (condition) { console.log(`  ✓ ${label}`); passed += 1; }
  else { console.error(`  ✗ ${label} — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); failed += 1; }
}
const near = (a, b, tol = 1) => Math.abs(Number(a) - Number(b)) <= tol;

(async () => {
  const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');
  // Three photographed faces (no right side) → incomplete map. 720+720+540 = 1980 sqft mapped.
  const faces = [
    { wall_face: 'front', wall_width_ft: 40, wall_height_ft: 18, confidence: 0.95, siding_material: 'vinyl',
      material_regions: [{ material: 'lap_siding', percent: 40, confidence: 0.95 }, { material: 'stucco', percent: 40, confidence: 0.95 }, { material: 'stone', percent: 20, confidence: 0.95 }],
      openings: [] },
    { wall_face: 'back', wall_width_ft: 40, wall_height_ft: 18, confidence: 0.95, siding_material: 'vinyl',
      material_regions: [{ material: 'lap_siding', percent: 100 }], openings: [] },
    { wall_face: 'left_side', wall_width_ft: 30, wall_height_ft: 18, confidence: 0.95, siding_material: 'vinyl',
      material_regions: [{ material: 'lap_siding', percent: 50 }, { material: 'stucco', percent: 50 }], openings: [] },
  ];
  const base = { perPhotoResults: faces, storyCount: 2, wallHeightFt: 18, perimeterFt: 140, buildingWidthFt: 40, buildingLengthFt: 30 };

  const big = buildSidingMeasurementGraph({ ...base, grossWallAreaSqft: 2520 });
  const T0 = big.totals;
  const mappedGross = T0.siding_material_area_sqft + T0.excluded_material_area_sqft;
  ok('incomplete map short of gross is not scaled up', big.material_map?.complete !== true && T0.siding_facade_area_sqft <= mappedGross, T0.siding_facade_area_sqft, `<= ${mappedGross}`);
  ok('stucco is excluded from siding', big.material_map?.faces?.front?.regions?.some(r => r.material === 'stucco' && r.included_in_siding_sq === false));

  // Malec shape: photo widths 10% over the footprint edges, one face flagged
  // uncertain (incomplete map). Photo prism stays on the footprint lengths
  // (2520 sqft) while the raw map holds 2772 sqft of wall.
  const wide = (w, ft) => ({ ...faces.find(f => f.wall_face === ft) || faces[1], wall_face: ft, wall_width_ft: w });
  const over = [wide(44, 'front'), wide(44, 'back'), wide(33, 'left_side'),
    { ...wide(33, 'right_side'), material_regions: [{ material: 'lap_siding', percent: 60 }, { material: 'stucco', percent: 40 }], material_uncertain: true }];
  const small = buildSidingMeasurementGraph({ ...base, perPhotoResults: over, grossWallAreaSqft: 2520, footprint: [[0, 0], [40, 0], [40, 30], [0, 30]] });
  const T = small.totals;
  ok('map is incomplete (one uncertain face)', small.material_map?.complete !== true, small.material_map?.complete, false);
  ok('billed net equals the internal photo/sanity net', near(T.net_siding_area_sqft, T.sanity_net_siding_area_sqft, 2), T.net_siding_area_sqft, T.sanity_net_siding_area_sqft);
  ok('siding + excluded never exceeds the canonical gross', T.siding_material_area_sqft + T.excluded_material_area_sqft <= T.gross_wall_area_sqft + 2,
    T.siding_material_area_sqft + T.excluded_material_area_sqft, `<= ${T.gross_wall_area_sqft}`);
  ok('stucco stays deducted after the fit', T.excluded_material_area_sqft > 0.2 * T.gross_wall_area_sqft, T.excluded_material_area_sqft, '> 20% of gross');

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
