'use strict';

// Face classification is one Gemini call per wall, sampled like production,
// then the median. A material that swings more than 20 points falls back to
// the share confirmed on the other faces. No Gemini and no recorded houses.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let passed = 0;
let failed = 0;
function ok(label, condition, got, expected) {
  if (condition) { console.log(`  ✓ ${label}`); passed += 1; }
  else { console.error(`  ✗ ${label} — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); failed += 1; }
}
const near = (a, b, tol = 1.5) => Math.abs(Number(a) - Number(b)) <= tol;

function sample(stone, stucco, brick, siding, polygonMaterial = null) {
  const body = {
    stone_percent: stone,
    stucco_percent: stucco,
    brick_percent: brick,
    siding_percent: siding,
    sections: [],
  };
  if (polygonMaterial) {
    body.sections.push({
      material: polygonMaterial,
      polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.8 }, { x: 0, y: 0.8 }],
    });
  }
  return body;
}

(async () => {
  const {
    PRODUCTION_MATERIAL_SAMPLE_COUNT,
    medianFaceMaterialSamples,
    applyPropertyMaterialPrior,
    groupPhotosByFace,
    classifyFaceMaterials,
    materialProposalsFromMap,
    FACE_MATERIAL_RESPONSE_SCHEMA,
  } = await import('../functions/utils/faceMaterialClassification.js');
  const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');

  ok('production samples each face 3 times', PRODUCTION_MATERIAL_SAMPLE_COUNT === 3, PRODUCTION_MATERIAL_SAMPLE_COUNT, 3);
  ok('the face schema asks for four percents and a polygon per material',
    FACE_MATERIAL_RESPONSE_SCHEMA.required.includes('siding_percent')
    && FACE_MATERIAL_RESPONSE_SCHEMA.required.includes('sections')
    && FACE_MATERIAL_RESPONSE_SCHEMA.properties.sections.items.required.includes('polygon'));

  const median = medianFaceMaterialSamples([
    sample(0, 0, 20, 80),
    sample(0, 0, 60, 40, 'brick'),
    sample(0, 0, 80, 20),
  ], 'front');
  ok('three face samples bill the median brick, not the 80 outlier', near(median.shares.brick, 60), median.shares.brick, 60);
  ok('the brick spread is the full swing', median.spread.brick === 60, median.spread, 60);
  ok('the polygon comes from a sample near the median', median.sections.length === 1 && median.sections[0].material === 'brick', median.sections, 'brick polygon');

  const groups = groupPhotosByFace([
    { wall_face: 'front', secondary_wall_face: 'right_side', label: 'corner' },
    { wall_face: 'front', label: 'straight' },
    { wall_face: 'back', is_detail_shot: true, label: 'detail' },
    { wall_face: 'left_side', label: 'left' },
  ]);
  ok('a corner is a photo of both faces it shows', groups.front.length === 2 && groups.right_side.length === 1, groups, 'front 2, right 1');
  ok('a detail shot is not a face photo', !groups.back, groups.back, undefined);

  const frontSamples = [sample(0, 0, 20, 80), sample(0, 0, 60, 40, 'brick'), sample(0, 0, 0, 100)];
  const stable = (brick) => ({
    shares: { stone: 0, stucco: 0, brick, siding: 100 - brick },
    spread: { stone: 0, stucco: 0, brick: 2, siding: 2 },
    spread_max: 2,
    sections: [],
    sample_count: 3,
    photo_count: 2,
  });
  const prior = applyPropertyMaterialPrior({
    front: medianFaceMaterialSamples(frontSamples, 'front'),
    back: stable(20),
    left_side: stable(20),
    right_side: stable(0),
  });
  ok('a swinging face takes the brick share the other faces confirm', near(prior.front.shares.brick, 20) && prior.front.billed_from === 'property_prior', prior.front.shares, 20);
  ok('the prior names the material it replaced', prior.front.prior_notes.some((note) => /brick/.test(note) && /property share/.test(note)), prior.front.prior_notes, 'brick property share');

  const stoneSwing = medianFaceMaterialSamples([
    sample(0, 0, 0, 100),
    sample(50, 0, 0, 50),
    sample(90, 0, 0, 10),
  ], 'front');
  const dropped = applyPropertyMaterialPrior({
    front: stoneSwing,
    back: stable(0),
    left_side: stable(0),
    right_side: stable(0),
  });
  ok('a swinging material nobody else confirms is dropped', near(dropped.front.shares.stone, 0) && dropped.front.prior_applied === true, dropped.front.shares, 0);

  const steady = applyPropertyMaterialPrior({
    front: medianFaceMaterialSamples([sample(20, 0, 0, 80), sample(22, 0, 0, 78), sample(18, 0, 0, 82)], 'front'),
    back: stable(0),
  });
  ok('samples that agree keep the median and skip the prior', steady.front.billed_from === 'face_sample_median' && near(steady.front.shares.stone, 20), steady.front, 'median 20');

  const masonrySpread = medianFaceMaterialSamples([
    sample(40, 30, 0, 30),
    sample(24, 46, 0, 30),
    sample(50, 20, 0, 30),
  ], 'front');
  const keptMasonry = applyPropertyMaterialPrior({
    front: masonrySpread,
    back: stable(0),
    left_side: stable(0),
    right_side: stable(0),
  });
  ok('every masonry sample keeps the face median when the spread is wide',
    keptMasonry.front.billed_from === 'face_sample_median'
    && keptMasonry.front.prior_applied === false
    && near(keptMasonry.front.shares.stone, 40)
    && near(keptMasonry.front.shares.stucco, 30)
    && (keptMasonry.front.review_notes || []).some((note) => /masonry/.test(note)),
    keptMasonry.front, 'median stone 40 stucco 30');
  const oneSidingSample = medianFaceMaterialSamples([
    sample(40, 0, 0, 60),
    sample(10, 0, 0, 90),
    sample(0, 0, 0, 100),
  ], 'front');
  const stillPrior = applyPropertyMaterialPrior({
    front: oneSidingSample,
    back: stable(0),
    left_side: stable(0),
    right_side: stable(0),
  });
  ok('a sample with no masonry still takes the property prior',
    stillPrior.front.billed_from === 'property_prior' && stillPrior.front.prior_applied === true,
    stillPrior.front.billed_from, 'property_prior');

  const calls = [];
  const photos = [
    { wall_face: 'front', photo_ref: 'a' },
    { wall_face: 'front', secondary_wall_face: 'right_side', photo_ref: 'b' },
    { wall_face: 'back', photo_ref: 'c' },
  ];
  const images = new Map([
    [photos[0], { data: 'aaa', mimeType: 'image/jpeg' }],
    [photos[1], { data: 'bbb', mimeType: 'image/jpeg' }],
    [photos[2], { data: 'ccc', mimeType: 'image/jpeg' }],
  ]);
  await classifyFaceMaterials({
    results: photos,
    sampleCount: PRODUCTION_MATERIAL_SAMPLE_COUNT,
    imageForResult: (photo) => images.get(photo),
    callModel: async ({ face, images: faceImages, sampleIndex }) => {
      calls.push({ face, count: faceImages.length, sampleIndex });
      return sample(face === 'front' ? 40 : 0, 0, 0, face === 'front' ? 60 : 100);
    },
  });
  const frontCalls = calls.filter((call) => call.face === 'front');
  ok('the front face is sampled 3 times with both of its photos', frontCalls.length === 3 && frontCalls.every((call) => call.count === 2), frontCalls, '3 calls, 2 photos');
  ok('the reconciled median is stored on each photo of the face', near(photos[0].face_materials.front.shares.stone, 40) && photos[0].face_materials.front.sample_count === 3, photos[0].face_materials.front.shares, 40);
  ok('a corner keeps a separate reading for its other face', photos[1].face_materials.right_side && near(photos[1].face_materials.right_side.shares.siding, 100), photos[1].face_materials, 'right siding');

  const rect = (y0, y1) => [[0, y0], [1, y0], [1, y1], [0, y1]];
  const graph = buildSidingMeasurementGraph({
    perPhotoResults: [
      {
        wall_face: 'front',
        wall_width_ft: 40,
        wall_height_ft: 18,
        eave_height_ft: 18,
        confidence: 0.9,
        siding_material: 'vinyl',
        material_shares: { siding: 20, brick: 80 },
        sections: [{ material: 'brick', wall_face: 'front', polygon: rect(0.2, 1) }],
        openings: [],
        face_materials: {
          front: {
            face: 'front',
            shares: { stone: 0, stucco: 0, brick: 20, siding: 80 },
            spread: { stone: 0, stucco: 0, brick: 4, siding: 4 },
            spread_max: 4,
            sample_count: 3,
            photo_count: 1,
            billed_from: 'face_sample_median',
            prior_applied: false,
            prior_notes: [],
            sections: [{ material: 'brick', wall_face: 'front', polygon: rect(0.8, 1) }],
          },
        },
      },
      ...['back', 'left_side', 'right_side'].map((face) => ({
        wall_face: face,
        wall_width_ft: face === 'back' ? 40 : 30,
        wall_height_ft: 18,
        eave_height_ft: 18,
        confidence: 0.9,
        siding_material: 'vinyl',
        material_shares: { siding: 100, brick: 0, stone: 0, stucco: 0 },
        openings: [],
      })),
    ],
    storyCount: 2,
    wallHeightFt: 18,
    grossWallAreaSqft: 2520,
    perimeterFt: 140,
    buildingWidthFt: 40,
    buildingLengthFt: 30,
  });
  const front = graph.material_map.faces.front;
  const brick = (front.regions || []).find((region) => region.material === 'brick');
  ok('the graph bills the face classification, not the per-photo 80% brick polygon', brick && near(brick.percent, 20), brick, 20);
  ok('the face spread is reported on the material map', front.material_agreement.spread_points === 4 && front.material_agreement.sample_count === 3 && front.material_agreement.billed_from === 'face_sample_median', front.material_agreement, 'spread 4');

  const wainscot = buildSidingMeasurementGraph({
    perPhotoResults: [
      {
        wall_face: 'front',
        wall_width_ft: 40,
        eave_height_ft: 10,
        wall_height_ft: 10,
        confidence: 0.9,
        siding_material: 'vinyl',
        material_shares: { siding: 84, brick: 16 },
        non_siding_material: 'brick',
        non_siding_pct: 16,
        openings: [
          { type: 'window', wall_face: 'front', width_ft: 3, height_ft: 4, sqft: 12 },
          { type: 'window', wall_face: 'front', width_ft: 4, height_ft: 4, sqft: 16 },
          { type: 'window', wall_face: 'front', width_ft: 4, height_ft: 4, sqft: 16 },
        ],
        face_materials: {
          front: {
            shares: { stone: 0, stucco: 0, brick: 0, siding: 100 },
            spread: { stone: 0, stucco: 0, brick: 0, siding: 0 },
            spread_max: 0,
            sample_count: 3,
            photo_count: 2,
            billed_from: 'face_sample_median',
          },
          left_side: {
            shares: { stone: 0, stucco: 0, brick: 0, siding: 100 },
            spread: { stone: 0, stucco: 0, brick: 0, siding: 0 },
            spread_max: 0,
            sample_count: 3,
            photo_count: 4,
            billed_from: 'face_sample_median',
          },
        },
      },
    ],
    storyCount: 1,
    wallHeightFt: 10,
    grossWallAreaSqft: 1600,
    perimeterFt: 160,
    buildingWidthFt: 40,
    buildingLengthFt: 40,
  });
  const wainscotBrick = (wainscot.material_map.faces.front.regions || []).find((region) => region.material === 'brick');
  ok('a face call of 100% siding is billed as siding; photos do not restore a brick band', !wainscotBrick, wainscotBrick, 'no brick');
  const packaged = wainscot.opening_groups.filter((group) => group.deduction_basis === 'siding_window_package');
  ok('a row of sub-20 siding windows deducts once the row adds up', packaged.length === 3 && packaged.every((group) => group.deductible), packaged.map((group) => group.area_sqft), '3 windows');
  const left = wainscot.material_map.faces.left_side;
  ok('an inferred face reports the classifier photo count', left?.photo_count === 4 && !/only 0 photos/.test((left?.material_agreement?.reasons || []).join(' ')), left?.photo_count, 4);

  const painted = buildSidingMeasurementGraph({
    perPhotoResults: [{
      wall_face: 'front',
      wall_width_ft: 30,
      eave_height_ft: 18,
      wall_height_ft: 18,
      confidence: 0.9,
      siding_material: 'brick',
      material_shares: { siding: 0, brick: 100, stucco: 0 },
      openings: [],
      face_materials: {
        front: {
          shares: { stone: 0, stucco: 25, brick: 75, siding: 0 },
          spread: { stone: 0, stucco: 5, brick: 5, siding: 0 },
          spread_max: 5,
          sample_count: 3,
          photo_count: 4,
          billed_from: 'face_sample_median',
        },
      },
    }],
    storyCount: 2,
    wallHeightFt: 18,
    grossWallAreaSqft: 2000,
    perimeterFt: 120,
    buildingWidthFt: 30,
    buildingLengthFt: 30,
  });
  const paintedRegions = painted.material_map.faces.front.regions || [];
  ok('stucco of 10% or more stays stucco when the face call already has brick',
    paintedRegions.some((region) => region.material === 'stucco' && region.percent >= 20)
    && paintedRegions.some((region) => region.material === 'brick' && region.percent >= 70 && region.percent < 90),
    paintedRegions, 'stucco kept');
  const sliver = buildSidingMeasurementGraph({
    perPhotoResults: [{
      wall_face: 'front',
      wall_width_ft: 30,
      eave_height_ft: 18,
      wall_height_ft: 18,
      confidence: 0.9,
      siding_material: 'brick',
      openings: [],
      face_materials: {
        front: {
          shares: { stone: 0, stucco: 8, brick: 92, siding: 0 },
          spread: { stone: 0, stucco: 2, brick: 2, siding: 0 },
          spread_max: 2,
          sample_count: 3,
          photo_count: 4,
          billed_from: 'face_sample_median',
        },
      },
    }],
    storyCount: 2,
    wallHeightFt: 18,
    grossWallAreaSqft: 2000,
    perimeterFt: 120,
    buildingWidthFt: 30,
    buildingLengthFt: 30,
  });
  const sliverRegions = sliver.material_map.faces.front.regions || [];
  ok('stucco under 10% on a face the call already called brick moves onto brick',
    sliverRegions.some((region) => region.material === 'brick' && region.percent >= 99)
    && !sliverRegions.some((region) => region.material === 'stucco' && region.percent > 0),
    sliverRegions, 'brick');

  const confirmedCalls = [];
  const confirmedPhotos = [
    { wall_face: 'front', photo_ref: 'front' },
    { wall_face: 'back', photo_ref: 'back' },
  ];
  const confirmedShares = { stone: 40, stucco: 60, brick: 0, siding: 0 };
  await classifyFaceMaterials({
    results: confirmedPhotos,
    sampleCount: PRODUCTION_MATERIAL_SAMPLE_COUNT,
    imageForResult: () => ({ data: 'abc', mimeType: 'image/jpeg' }),
    confirmedByFace: { front: { confirmed: true, shares: confirmedShares } },
    callModel: async ({ face }) => {
      confirmedCalls.push(face);
      return sample(0, 0, 0, 100);
    },
  });
  ok('a confirmed face skips the AI read', !confirmedCalls.includes('front') && confirmedCalls.filter((face) => face === 'back').length === 3, confirmedCalls, 'back only');
  ok('the confirmed percents are stored on the front photo',
    confirmedPhotos[0].face_materials?.front?.billed_from === 'rep_confirmed'
    && near(confirmedPhotos[0].face_materials.front.shares.stone, 40)
    && near(confirmedPhotos[0].face_materials.front.shares.stucco, 60),
    confirmedPhotos[0].face_materials?.front?.shares, confirmedShares);
  const confirmedGraph = buildSidingMeasurementGraph({
    perPhotoResults: [
      {
        wall_face: 'front',
        wall_width_ft: 40,
        eave_height_ft: 10,
        confidence: 0.9,
        siding_material: 'vinyl',
        openings: [],
        face_materials: { front: confirmedPhotos[0].face_materials.front },
      },
      {
        wall_face: 'back',
        wall_width_ft: 40,
        eave_height_ft: 10,
        confidence: 0.9,
        siding_material: 'vinyl',
        openings: [],
        face_materials: { back: confirmedPhotos[1].face_materials.back },
      },
    ],
    storyCount: 1,
    wallHeightFt: 10,
    grossWallAreaSqft: 800,
    perimeterFt: 160,
    buildingWidthFt: 40,
    buildingLengthFt: 40,
  });
  const confirmedFront = confirmedGraph.material_map.faces.front;
  const confirmedStone = (confirmedFront.regions || []).find((region) => region.material === 'stone');
  const confirmedStucco = (confirmedFront.regions || []).find((region) => region.material === 'stucco');
  ok('the graph bills the confirmed stone and stucco',
    near(confirmedStone?.percent, 40) && near(confirmedStucco?.percent, 60) && confirmedFront.material_agreement?.billed_from === 'rep_confirmed',
    confirmedFront.regions, '40 stone / 60 stucco');
  const proposals = materialProposalsFromMap(confirmedGraph.material_map);
  const frontProposal = proposals.find((row) => row.face === 'front');
  ok('the proposal names the confirmed front mix',
    frontProposal?.label === 'Front: 40% stone / 60% stucco' && frontProposal.confirmed === true,
    frontProposal, 'Front: 40% stone / 60% stucco');

  const bench = fs.readFileSync(path.join(__dirname, 'bench/run-hover-bench.cjs'), 'utf8');
  ok('the bench uses the production sample count', bench.includes('PRODUCTION_MATERIAL_SAMPLE_COUNT') && bench.includes('this bench matches production'));
  const dry = spawnSync(process.execPath, [path.join(__dirname, 'bench/run-hover-bench.cjs'), '--samples', '1'], {
    env: { ...process.env, GOOGLE_GEMINI_API_KEY: '', GEMINI_API_KEY: '' },
    encoding: 'utf8',
  });
  ok('a bench asked for 1 sample is kept on the production count', dry.status === 0 && /--samples 1 ignored/.test(dry.stdout || ''), dry.stdout, 'ignored');

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => { console.error(err); process.exit(1); });
