'use strict';

// Static regression test for the photo-lab material map. This uses synthetic
// Wizard Test Co-style measurements only; it does not call an AI provider,
// database, CRM, notification sender, or external measurement API.

let passed = 0;
let failed = 0;

function ok(label, condition, got, expected) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.error(`  ✗ ${label} — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    failed += 1;
  }
}

(async () => {
  const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');

  const faces = [
    {
      wall_face: 'front',
      wall_width_ft: 40,
      wall_height_ft: 18,
      confidence: 0.95,
      siding_material: 'vinyl',
      material_regions: [
        { material: 'lap_siding', percent: 55, confidence: 0.95 },
        { material: 'brick', percent: 45, confidence: 0.95 },
      ],
      openings: [{
        type: 'entry_door',
        width_ft: 3,
        height_ft: 6.8,
        pos_x: 20,
        pos_y: 3,
        confidence: 0.95,
      }],
    },
    {
      wall_face: 'back',
      wall_width_ft: 40,
      wall_height_ft: 18,
      confidence: 0.95,
      siding_material: 'vinyl',
      material_regions: [{ material: 'lap_siding', percent: 100 }],
      openings: [],
    },
    {
      wall_face: 'left_side',
      wall_width_ft: 30,
      wall_height_ft: 18,
      confidence: 0.95,
      siding_material: 'board_batten',
      siding_profile: 'board_batten',
      material_regions: [{ material: 'vertical_siding', percent: 100 }],
      openings: [],
    },
    {
      wall_face: 'right_side',
      wall_width_ft: 30,
      wall_height_ft: 18,
      confidence: 0.95,
      siding_material: 'vinyl',
      material_regions: [{ material: 'lap_siding', percent: 100 }],
      openings: [],
    },
  ];

  const graph = buildSidingMeasurementGraph({
    perPhotoResults: faces,
    storyCount: 2,
    wallHeightFt: 18,
    grossWallAreaSqft: 2520,
    perimeterFt: 140,
    buildingWidthFt: 40,
    buildingLengthFt: 30,
  });

  const map = graph.material_map;
  ok('material map is persisted on the canonical graph', Boolean(map));
  ok('all four synthetic faces are classified', map?.complete === true, map?.covered_faces, ['back', 'front', 'left_side', 'right_side']);
  ok('front brick area is excluded from siding',
    map?.faces?.front?.regions?.some(region => region.material === 'brick' && region.included_in_siding_sq === false));
  ok('vertical siding is included as siding',
    map?.faces?.left_side?.regions?.some(region => region.material === 'vertical_siding' && region.included_in_siding_sq === true));
  ok('siding total contains lap + vertical only', graph.totals.siding_material_area_sqft, 2196);
  ok('stone/brick total is separate from siding', graph.totals.excluded_material_area_sqft, 324);
  ok('front opening is allocated only to the siding share',
    Math.abs(graph.totals.opening_deduction_sqft - 11.22) < 0.01,
    graph.totals.opening_deduction_sqft,
    11.22);
  ok('net siding area equals mapped siding less mapped opening deduction',
    Math.abs(graph.totals.net_siding_area_sqft - 2184.78) < 0.01,
    graph.totals.net_siding_area_sqft,
    2184.78);

  const uncertain = buildSidingMeasurementGraph({
    perPhotoResults: [{
      wall_face: 'front',
      wall_width_ft: 40,
      wall_height_ft: 18,
      confidence: 0.4,
      material_uncertain: true,
      material_regions: [{ material: 'other', percent: 100 }],
      openings: [],
    }],
    storyCount: 1,
    wallHeightFt: 9,
    grossWallAreaSqft: 360,
    perimeterFt: 120,
    buildingWidthFt: 40,
    buildingLengthFt: 20,
  });
  ok('ambiguous material coverage requires review', uncertain.material_map.review_required === true);
  ok('ambiguous material is not charged as siding', uncertain.totals.siding_material_area_sqft === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});