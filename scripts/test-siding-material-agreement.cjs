'use strict';

// Multi-photo material fractions. Synthetic reads only — no Gemini, no
// database, no paid API. A face is the confidence-weighted blend of every
// photo, and a thin or disagreeing face is flagged for a rep.

const fs = require('node:fs');
const path = require('node:path');

let passed = 0;
let failed = 0;
function ok(label, condition, got, expected) {
  if (condition) { console.log(`  ✓ ${label}`); passed += 1; }
  else { console.error(`  ✗ ${label} — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); failed += 1; }
}
const near = (a, b, tol = 2) => Math.abs(Number(a) - Number(b)) <= tol;

function photo(face, stone, stucco, confidence = 0.9, extra = {}) {
  const masonry = stone + stucco;
  return {
    wall_face: face,
    wall_width_ft: face === 'front' || face === 'back' ? 40 : 30,
    wall_height_ft: 18,
    confidence,
    material_confidence: confidence,
    siding_material: 'vinyl',
    material_regions: [
      { material: 'lap_siding', percent: 100 - masonry },
      { material: 'stone', percent: stone },
      { material: 'stucco', percent: stucco },
    ].filter((region) => region.percent > 0),
    openings: [],
    ...extra,
  };
}

(async () => {
  const { buildSidingMeasurementGraph, agreeMaterialFractions } = await import('../functions/utils/sidingMeasurementGraph.js');
  const { mergeVisionMaterialSamples, measureWallMaterialSections } = await import('../functions/utils/wallMaterialSections.js');
  const { selectGutterEaveLf } = await import('../functions/utils/elevationAccessories.js');

  const right = [
    photo('right_side', 20, 17, 0.9),
    photo('right_side', 40, 25, 0.9),
  ];
  // Pad the other faces to 3 agreeing photos so only the right side is thin.
  const stableOthers = ['front', 'back', 'left_side'].flatMap((face) => [0, 1, 2].map(() => photo(face, 0, 0, 0.95, {
    material_regions: [{ material: 'lap_siding', percent: 100 }],
  })));
  const graph = buildSidingMeasurementGraph({
    perPhotoResults: [...right, ...stableOthers],
    storyCount: 2,
    wallHeightFt: 18,
    grossWallAreaSqft: 2520,
    perimeterFt: 140,
    buildingWidthFt: 40,
    buildingLengthFt: 30,
  });
  const rightFace = graph.material_map.faces.right_side;
  const masonryPct = 100 - rightFace.siding_percent;
  ok('two right-side reads blend instead of keeping 37% or 65%', near(masonryPct, 51, 4) && masonryPct > 42 && masonryPct < 60, masonryPct, 51);
  ok('right side is low confidence', rightFace.material_agreement.low_confidence === true, rightFace.material_agreement, true);
  ok('fewer than 3 photos is named', /only 2 photos/.test(rightFace.material_agreement.reasons.join(' ')), rightFace.material_agreement.reasons);
  ok('a spread over 20 points is named', /more than 20 points/.test(rightFace.material_agreement.reasons.join(' ')), rightFace.material_agreement.reasons);
  const flag = graph.material_map.material_review_flags.find((item) => item.face === 'right_side');
  ok('the rep flag names the right side', flag && /right side/.test(flag.message) && flag.low_confidence === true, flag, 'right side');
  ok('agreement review is on the material map', graph.material_map.agreement_review_required === true && graph.material_map.review_required === true);
  ok('a fully classified blend is still a complete map', graph.material_map.complete === true, graph.material_map.complete, true);

  const agreed = [10, 12, 11].flatMap((stone) => ['front', 'back', 'left_side', 'right_side'].map((face) => photo(face, stone, 0, 0.9)));
  const steady = buildSidingMeasurementGraph({
    perPhotoResults: agreed,
    storyCount: 2,
    wallHeightFt: 18,
    grossWallAreaSqft: 2520,
    perimeterFt: 140,
    buildingWidthFt: 40,
    buildingLengthFt: 30,
  });
  ok('three agreeing photos are not flagged', steady.material_map.material_review_flags.length === 0, steady.material_map.material_review_flags, []);
  ok('three agreeing photos keep the map complete', steady.material_map.complete === true && steady.material_map.review_required === false);

  const wild = mergeVisionMaterialSamples([
    { material_shares: { siding: 63, stone: 20, stucco: 17 }, material_regions: [{ material: 'stone', percent: 37 }], wall_face: 'right_side', eave_height_ft: 18 },
    { material_shares: { siding: 50, stone: 30, stucco: 20 }, material_regions: [{ material: 'stone', percent: 65 }], wall_face: 'right_side', eave_height_ft: 18 },
    { material_shares: { siding: 35, stone: 40, stucco: 25 }, material_regions: [{ material: 'stone', percent: 65 }], wall_face: 'right_side', eave_height_ft: 18 },
  ]);
  const wildStone = (wild.material_regions || []).find((region) => region.material === 'stone');
  ok('three temperature-0 reads keep the median stone, not the 65% region', wildStone && near(wildStone.percent, 30, 1), wildStone, 30);
  ok('the merged non-siding percent is the median, not the outlier', near(wild.non_siding_pct, 30, 1), wild.non_siding_pct, 30);
  ok('a 28 point sample spread is low confidence', wild.material_low_confidence === true && wild.material_share_spread_max > 20, wild.material_share_spread_max, '> 20');

  const billed = buildSidingMeasurementGraph({
    perPhotoResults: [0, 1, 2].map(() => ({
      ...wild,
      wall_face: 'right_side',
      wall_width_ft: 30,
      wall_height_ft: 18,
      confidence: 0.9,
      openings: [],
    })),
    storyCount: 2,
    wallHeightFt: 18,
    grossWallAreaSqft: 2520,
    perimeterFt: 140,
    buildingWidthFt: 40,
    buildingLengthFt: 30,
  });
  const billedMasonry = (billed.material_map.faces.right_side.regions || [])
    .filter((region) => region.material === 'stone' || region.material === 'stucco')
    .reduce((sum, region) => sum + region.percent, 0);
  ok('the graph bills the median masonry, not the 65% sample', near(billedMasonry, 50, 3), billedMasonry, 50);

  const direct = agreeMaterialFractions([
    { parts: { stone: 20, stucco: 17, brick: 0 }, weight: 1 },
    { parts: { stone: 40, stucco: 25, brick: 0 }, weight: 1 },
  ], { photoCount: 2 });
  ok('the helper flags a 2-photo 28-point face', direct.low_confidence === true && direct.spread_points > 20, direct, 'low');

  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const sections = measureWallMaterialSections({
    photos: [
      { wall_face: 'left', eave_height_ft: 18, confidence: 0.8, material_shares: { siding: 70, stone: 30 }, sections: [{ id: 'a', material: 'siding', polygon: rect(0, 0, 1, 1) }] },
      { wall_face: 'left', eave_height_ft: 18, confidence: 0.8, material_shares: { siding: 30, stone: 70 }, sections: [{ id: 'b', material: 'siding', polygon: rect(0, 0, 1, 1) }] },
    ],
    faceLengthsFt: { left: 50 },
  });
  const leftGross = 50 * 18;
  ok('two share photos blend to the middle, not the first read', near(sections.faces.left.gross_sqft_by_material.stone, leftGross * 0.5, 1), sections.faces.left.gross_sqft_by_material, leftGross * 0.5);
  ok('the blended face is low confidence in the section output', sections.faces.left.confidence === 'low' && sections.warnings.some((warning) => /left/.test(warning) && /20/.test(warning)), sections.warnings, 'left … 20');

  const facet = selectGutterEaveLf({ facetEaveLf: 351, facetTraceUsable: true, roofEaveLf: 351, footprintFallbackLf: 176 });
  ok('a usable roof trace supplies the gutter eave', facet.eave_lf === 351 && facet.source === 'roof_facet_eave', facet, 351);
  const halfBox = selectGutterEaveLf({ facetEaveLf: 0, facetTraceUsable: false, roofEaveLf: 351, footprintFallbackLf: 176 });
  ok('gutters use the roof eave instead of the 8-corner box', halfBox.eave_lf === 351 && halfBox.source === 'roof_eave', halfBox, 351);
  const partial = selectGutterEaveLf({ facetEaveLf: 176, facetTraceUsable: false, roofEaveLf: 351, footprintFallbackLf: 176 });
  ok('an unusable short facet does not halve the roof eave', partial.eave_lf === 351 && partial.source === 'roof_eave', partial, 351);
  const lastResort = selectGutterEaveLf({ facetEaveLf: 0, roofEaveLf: 0, footprintFallbackLf: 176 });
  ok('the footprint box is only the last resort', lastResort.eave_lf === 176 && lastResort.source === 'footprint_fallback', lastResort, 176);

  const plugin = fs.readFileSync(path.join(__dirname, '../vite-functions-plugin.js'), 'utf8');
  const estimator = fs.readFileSync(path.join(__dirname, '../src/pages/AIEstimator.jsx'), 'utf8');
  ok('each photo is still read at temperature 0', plugin.includes('temperature: 0,') && plugin.includes('materialSampleCount') && plugin.includes('mergeVisionMaterialSamples('));
  ok('each face is classified from all of its photos with structured output', plugin.includes('classifyFaceMaterials') && plugin.includes('FACE_MATERIAL_RESPONSE_SCHEMA') && plugin.includes('faceMaterialSystemPrompt'));
  ok('the handler asks for the roof eave and reports the rep flag', plugin.includes('selectGutterEaveLf') && plugin.includes('roof_eave_lf') && plugin.includes('material_rep_review_message'));
  ok('the estimator shows the rep flag and passes the roof eave', estimator.includes('material-fraction-review') && estimator.includes('roof_eave_lf: roofEaveLf'));

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
