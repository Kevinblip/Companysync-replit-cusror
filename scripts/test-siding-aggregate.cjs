#!/usr/bin/env node
/**
 * Siding Aggregate Logic — Regression Test
 * ──────────────────────────────────────────
 * Runs the pure aggregate functions from db/siding-aggregate.cjs directly
 * with mock per-photo AI results (no Gemini, no server required).
 *
 * Catches the three regression classes that were fixed:
 *   1. Wall height must use calibrated photo anchors, not story × formula
 *   2. Building depth must NOT equal width when no side-view photos exist
 *   3. Gable area must use the correct face dimension for each photo's wall_face
 *
 * Usage:  node scripts/test-siding-aggregate.cjs
 */

'use strict';

const { execFileSync } = require('node:child_process');

const {
  deriveWallHeight,
  deriveBuildingDimensions,
  computeGableArea,
  sumDistinctWallPlanes,
  robustAvg,
  DEFAULT_EAVE_PER_STORY,
  PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT,
} = require('../db/siding-aggregate.cjs');

// ── counters ──────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function ok(label, cond, got, expected) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const detail = got !== undefined
      ? ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`
      : '';
    console.log(`  ✗ ${label}${detail}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Wall height
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Wall height: calibrated anchor beats formula ──');
{
  const storyCount   = 2;
  const formulaHt    = storyCount * DEFAULT_EAVE_PER_STORY; // 18 ft

  const perPhotoResults = [
    { view_label: 'Front', eave_height_ft: 16.5, height_method: 'door_anchor',  height_clamped: false },
    { view_label: 'Back',  eave_height_ft: 16.5, height_method: 'course_count', height_clamped: false },
  ];
  const { wallHeightFt, heightSource } = deriveWallHeight(perPhotoResults, storyCount);

  ok('wallHeightFt = avg of calibrated readings (16.5), not formula (18)',
     wallHeightFt === 16.5, wallHeightFt, 16.5);
  ok('heightSource contains "photo_calibration"',
     heightSource.includes('photo_calibration'), heightSource);
  ok('result differs from story×formula',
     wallHeightFt !== formulaHt, wallHeightFt, `!= ${formulaHt}`);
}

console.log('\n── Wall height: formula fires only when no calibrated anchors ──');
{
  const storyCount = 2;
  const formulaHt  = storyCount * DEFAULT_EAVE_PER_STORY; // 18 ft

  const perPhotoResults = [
    { view_label: 'Front', eave_height_ft: 21, height_method: 'estimate', height_clamped: false },
  ];
  const { wallHeightFt, heightSource } = deriveWallHeight(perPhotoResults, storyCount);

  ok('formula fallback fires when only "estimate" method available',
     wallHeightFt === formulaHt, wallHeightFt, formulaHt);
  ok('heightSource contains "formula_fallback"',
     heightSource.includes('formula_fallback'), heightSource);
}

console.log('\n── Wall height: clamped photos excluded from calibrated average ──');
{
  const storyCount = 2;

  const perPhotoResults = [
    { view_label: 'Front', eave_height_ft: 16.5, height_method: 'door_anchor',  height_clamped: false },
    { view_label: 'Right', eave_height_ft: 30.0, height_method: 'door_anchor',  height_clamped: true  }, // forced to ceiling — excluded
  ];
  const { wallHeightFt } = deriveWallHeight(perPhotoResults, storyCount);

  ok('clamped photo (30 ft) excluded; result = 16.5, not (16.5+30)/2=23.25',
     wallHeightFt === 16.5, wallHeightFt, 16.5);
}

console.log('\n── Wall height: manual calibration beats any anchor method ──');
{
  const storyCount = 2;

  const perPhotoResults = [
    { view_label: 'Front', eave_height_ft: 14.0, height_method: 'door_anchor', height_clamped: false, manually_calibrated: true },
    { view_label: 'Back',  eave_height_ft: 16.5, height_method: 'door_anchor', height_clamped: false, manually_calibrated: false },
  ];
  const { wallHeightFt, heightSource } = deriveWallHeight(perPhotoResults, storyCount);

  ok('only manually-calibrated photo used → 14.0 ft',
     wallHeightFt === 14.0, wallHeightFt, 14.0);
  ok('heightSource contains "manual_calibration"',
     heightSource.includes('manual_calibration'), heightSource);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Building dimensions
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Building dimensions: depth ≠ width when no side photos ──');
{
  const perPhotoResults = [
    { view_label: 'Front', wall_width_ft: 40 },
    { view_label: 'Back',  wall_width_ft: 40 },
  ];
  const { buildingWidthFt, buildingLengthFt, depthMissing } = deriveBuildingDimensions(perPhotoResults);

  ok('buildingWidthFt = 40 (from front/back photos)',
     buildingWidthFt === 40, buildingWidthFt, 40);
  ok('buildingLengthFt ≠ buildingWidthFt (no side photos)',
     buildingLengthFt !== buildingWidthFt, buildingLengthFt, '!= 40');
  ok('buildingLengthFt = 0.75 × 40 = 30',
     buildingLengthFt === 30, buildingLengthFt, 30);
  ok('depthMissing flag = true',
     depthMissing === true, depthMissing, true);
}

console.log('\n── Building dimensions: both axes from photos when side shots available ──');
{
  const perPhotoResults = [
    { view_label: 'Front',     wall_width_ft: 40 },
    { view_label: 'Left Side', wall_width_ft: 32 },
  ];
  const { buildingWidthFt, buildingLengthFt, depthMissing } = deriveBuildingDimensions(perPhotoResults);

  ok('buildingWidthFt = 40 (front photo)', buildingWidthFt === 40, buildingWidthFt, 40);
  ok('buildingLengthFt = 32 (side photo)', buildingLengthFt === 32, buildingLengthFt, 32);
  ok('depthMissing = false', depthMissing === false, depthMissing, false);
}

console.log('\n── Building dimensions: corner shots excluded from width average ──');
{
  const perPhotoResults = [
    { view_label: 'Front',              wall_width_ft: 40 },
    { view_label: 'Front-Left Corner',  wall_width_ft: 60, is_corner_shot: true }, // excluded
  ];
  const { buildingWidthFt } = deriveBuildingDimensions(perPhotoResults);

  ok('corner shot excluded; buildingWidthFt = 40, not avg(40,60)=50',
     buildingWidthFt === 40, buildingWidthFt, 40);
}

console.log('\n── Building dimensions: detail/close-up shots excluded ──');
{
  const perPhotoResults = [
    { view_label: 'Front',              wall_width_ft: 40 },
    { view_label: 'Detail - Corner J',  wall_width_ft: 8  }, // close-up, excluded
  ];
  const { buildingWidthFt } = deriveBuildingDimensions(perPhotoResults);

  ok('detail shot excluded; buildingWidthFt = 40, not avg(40,8)=24',
     buildingWidthFt === 40, buildingWidthFt, 40);
}

console.log('\n── Building dimensions: widths ≤ 5 ft excluded (crop artifacts) ──');
{
  const perPhotoResults = [
    { view_label: 'Front', wall_width_ft: 40 },
    { view_label: 'Right', wall_width_ft: 3  }, // below 5-ft threshold — excluded
  ];
  const { buildingWidthFt, buildingLengthFt, depthMissing } = deriveBuildingDimensions(perPhotoResults);

  ok('sub-5-ft width excluded from sideWidths (depthMissing=true)',
     depthMissing === true, depthMissing, true);
  ok('buildingWidthFt = 40 (sub-5-ft side photo not used as side axis)',
     buildingWidthFt === 40, buildingWidthFt, 40);
}

console.log('\n── Building dimensions: cardinal direction labels recognised ──');
{
  // North/South = front/back axis; East/West = side (depth) axis
  const perPhotoResults = [
    { label: 'North Elevation', wall_width_ft: 38 }, // label field, not view_label
    { label: 'East Elevation',  wall_width_ft: 30 },
  ];
  const { buildingWidthFt, buildingLengthFt, depthMissing } = deriveBuildingDimensions(perPhotoResults);

  ok('North label → front/back axis → buildingWidthFt = 38',
     buildingWidthFt === 38, buildingWidthFt, 38);
  ok('East label → side axis → buildingLengthFt = 30',
     buildingLengthFt === 30, buildingLengthFt, 30);
  ok('depthMissing = false (both axes from photos)',
     depthMissing === false, depthMissing, false);
}

console.log('\n── Building dimensions: label field used when view_label absent ──');
{
  const perPhotoResults = [
    { label: 'Front Exterior', wall_width_ft: 42 }, // uses `label`, not `view_label`
  ];
  const { buildingWidthFt, buildingLengthFt, depthMissing } = deriveBuildingDimensions(perPhotoResults);

  ok('label field recognised for front/back grouping; buildingWidthFt = 42',
     buildingWidthFt === 42, buildingWidthFt, 42);
  ok('depth inferred (only front photo); depthMissing = true',
     depthMissing === true, depthMissing, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Gable area face dimension
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Gable area: left_side photo → base = buildingLengthFt ──');
{
  const buildingWidthFt  = 40;
  const buildingLengthFt = 32;

  const gablePhotos = [
    { wall_face: 'left_side', gable_rise_ft: 8, has_gable_end: true },
  ];
  const { gableAreaSqft, gableBaseFt } = computeGableArea(gablePhotos, buildingWidthFt, buildingLengthFt);

  ok('gableBaseFt = buildingLengthFt (32), not buildingWidthFt (40)',
     gableBaseFt === buildingLengthFt, gableBaseFt, buildingLengthFt);
  ok('gableAreaSqft = 2 × (32 × 8) / 2 = 256',
     gableAreaSqft === 256, gableAreaSqft, 256);
}

console.log('\n── Gable area: right_side photo → base = buildingLengthFt ──');
{
  const buildingWidthFt  = 40;
  const buildingLengthFt = 32;

  const gablePhotos = [
    { wall_face: 'right_side', gable_rise_ft: 8, has_gable_end: true },
  ];
  const { gableBaseFt } = computeGableArea(gablePhotos, buildingWidthFt, buildingLengthFt);

  ok('gableBaseFt = buildingLengthFt (32) for right_side photo',
     gableBaseFt === buildingLengthFt, gableBaseFt, buildingLengthFt);
}

console.log('\n── Gable area: front photo → base = buildingWidthFt ──');
{
  const buildingWidthFt  = 40;
  const buildingLengthFt = 32;

  const gablePhotos = [
    { wall_face: 'front', gable_rise_ft: 8, has_gable_end: true },
  ];
  const { gableAreaSqft, gableBaseFt } = computeGableArea(gablePhotos, buildingWidthFt, buildingLengthFt);

  ok('gableBaseFt = buildingWidthFt (40) for front photo',
     gableBaseFt === buildingWidthFt, gableBaseFt, buildingWidthFt);
  ok('gableAreaSqft = 2 × (40 × 8) / 2 = 320',
     gableAreaSqft === 320, gableAreaSqft, 320);
}

console.log('\n── Gable area: no gable photos → 0 sqft ──');
{
  const { gableAreaSqft, gableBaseFt } = computeGableArea([], 40, 32);
  ok('gableAreaSqft = 0 when no gable photos', gableAreaSqft === 0, gableAreaSqft, 0);
  ok('gableBaseFt = 0 when no gable photos',   gableBaseFt  === 0, gableBaseFt,   0);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Robust aggregation (MAD outlier rejection)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── robustAvg: ≤2 samples → plain mean, no rejection ──');
{
  const two = robustAvg([16.5, 16.5]);
  ok('2 samples → mean 16.5, nothing rejected',
     two.value === 16.5 && two.rejected.length === 0, two);
}

console.log('\n── robustAvg: single wild outlier rejected ──');
{
  const { value, rejected } = robustAvg([8, 8, 8, 8.5, 8.5, 8, 13, 14]);
  ok('13 and 14 rejected as outliers', rejected.length === 2 &&
     rejected.includes(13) && rejected.includes(14), rejected);
  ok('robust value ≈ 8.17 (mean of survivors), not plain mean 9.5',
     Math.abs(value - 49 / 6) < 0.001, value, 49 / 6);
}

console.log('\n── robustAvg: MAD=0 (identical majority) still rejects far value ──');
{
  const { value, rejected } = robustAvg([9, 9, 9, 14]);
  ok('14 rejected when majority identical at 9', rejected.length === 1 && rejected[0] === 14, rejected);
  ok('value = 9', value === 9, value, 9);
}

console.log('\n── Wall height: outlier anchor no longer drags the average up ──');
{
  const perPhotoResults = [
    { view_label: 'Front', eave_height_ft: 8,   height_method: 'course_count', height_clamped: false },
    { view_label: 'Back',  eave_height_ft: 8,   height_method: 'course_count', height_clamped: false },
    { view_label: 'Left',  eave_height_ft: 8.5, height_method: 'course_count', height_clamped: false },
    { view_label: 'Right', eave_height_ft: 13,  height_method: 'course_count', height_clamped: false }, // ridge mistaken for eave
  ];
  const { wallHeightFt, heightSource } = deriveWallHeight(perPhotoResults, 1);
  ok('13-ft outlier rejected → 8.0 ft (plain mean would be 9.4→9.5)',
     wallHeightFt === 8, wallHeightFt, 8);
  ok('heightSource reports rejected outlier count',
     heightSource.includes('outlier(s) rejected'), heightSource);
}

console.log('\n── Wall height: garage_door_anchor is a calibrated method ──');
{
  const perPhotoResults = [
    { view_label: 'Front', eave_height_ft: 8, height_method: 'garage_door_anchor', height_clamped: false },
  ];
  const { wallHeightFt, heightSource } = deriveWallHeight(perPhotoResults, 1);
  ok('garage_door_anchor accepted → 8 ft, not formula 9 ft',
     wallHeightFt === 8, wallHeightFt, 8);
  ok('heightSource is photo_calibration', heightSource.includes('photo_calibration'), heightSource);
}

console.log('\n── Wall height: full-plane bounds are 7–28 ft, not story floors ──');
{
  const below = deriveWallHeight(
    [{ view_label: 'Front', eave_height_ft: 7, height_method: 'course_count', height_clamped: false }], 1);
  ok(`7-ft reading is accepted at full-plane minimum ${PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT}`,
     below.wallHeightFt === PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT, below.wallHeightFt, PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT);
  ok('no story-floor adjustment is added',
     !below.heightSource.includes('raised_to'), below.heightSource);

  const eightFt = deriveWallHeight(
    [{ view_label: 'Front', eave_height_ft: 8, height_method: 'course_count', height_clamped: false }], 1);
  ok('8-ft garage is NOT raised to the old 9-ft spec floor',
     eightFt.wallHeightFt === 8, eightFt.wallHeightFt, 8);
  ok('no adjustment suffix when nothing was raised',
     !eightFt.heightSource.includes('raised_to'), eightFt.heightSource);
}

console.log('\n── Building dimensions: width outlier rejected ──');
{
  const perPhotoResults = [
    { view_label: 'Front', wall_width_ft: 23 },
    { view_label: 'Front', wall_width_ft: 24 },
    { view_label: 'Back',  wall_width_ft: 40 }, // included background/fence — outlier
    { view_label: 'Left Side',  wall_width_ft: 21 },
    { view_label: 'Right Side', wall_width_ft: 23 },
  ];
  const { buildingWidthFt, buildingLengthFt } = deriveBuildingDimensions(perPhotoResults, true);
  ok('front/back width = 24 (40-ft outlier rejected; plain mean would be 29)',
     buildingWidthFt === 24, buildingWidthFt, 24);
  ok('side depth = 22', buildingLengthFt === 22, buildingLengthFt, 22);
}

console.log('\n── Building dimensions: the two side elevations are added ──');
{
  // Two agreeing photos of a long left wall, three of a short right wall.
  // Pooling every side photo and rejecting outliers mirrors the short wall
  // onto both sides (about 31 ft). Hover adds the elevations: (61 + 31) / 2.
  const perPhotoResults = [
    { view_label: 'Front', wall_width_ft: 36 },
    { view_label: 'Back', wall_width_ft: 36 },
    { view_label: 'Left Side', wall_width_ft: 60 },
    { view_label: 'Left Side', wall_width_ft: 62 },
    { view_label: 'Right Side', wall_width_ft: 30 },
    { view_label: 'Right Side', wall_width_ft: 31 },
    { view_label: 'Right Side', wall_width_ft: 32 },
  ];
  const { buildingWidthFt, buildingLengthFt } = deriveBuildingDimensions(perPhotoResults, false);
  ok('gable-end width stays 36 ft', buildingWidthFt === 36, buildingWidthFt, 36);
  ok('side length adds the long wall to the short wall (46 ft, not the short 31 ft)',
     buildingLengthFt === 46, buildingLengthFt, 46);
  ok('both side walls are in the perimeter (2 × 46 = 61 + 31)',
     2 * buildingLengthFt === 92, 2 * buildingLengthFt, 92);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: 5688 Gemini Ct ground-truth benchmark
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5688 Gemini Ct: strict siding, roof, and individual-window totals ──');
{
  const openingsByFace = {
    front: 4,
    back: 4,
    left_side: 3,
    right_side: 3,
  };
  const perPhotoResults = Object.entries(openingsByFace).map(([face, count]) => ({
    view_label: face,
    wall_face: face,
    wall_width_ft: 25,
    eave_height_ft: 10,
    confidence: 95,
    openings: Array.from({ length: count }, (_, index) => ({
      type: 'window',
      observation_id: `${face}_window_${index + 1}`,
      width_ft: 2,
      height_ft: 4,
      pos_x: 2.5 + index * 2.5,
      pos_y: 5,
      zone: 'center',
      confidence: 95,
    })),
    roof_planes: [{
      observation_id: `${face}_roof_plane`,
      face,
      width_ft: 30,
      slope_length_ft: face === 'right_side' ? 20.6 : 20.7,
      area_sqft: 999, // contradictory model field; measured dimensions are authoritative
      pitch: '6/12',
      confidence: 95,
    }],
    source_type: 'uploaded',
    verified_elevation: true,
  }));

  const benchmarkScript = `
    import { buildSidingMeasurementGraph } from './functions/utils/sidingMeasurementGraph.js';
    import { buildRoofMeasurementGraph } from './functions/utils/roofMeasurementGraph.js';
    const perPhotoResults = ${JSON.stringify(perPhotoResults)};
    const siding = buildSidingMeasurementGraph({
      perPhotoResults,
      grossWallAreaSqft: 2130,
      accentDeductionSqft: 0,
      perimeterFt: 100,
      buildingWidthFt: 25,
      buildingLengthFt: 25,
      wallHeightFt: 10,
      smallOpeningsInWaste: true,
    });
    const roof = buildRoofMeasurementGraph({
      perPhotoResults,
      buildingWidthFt: 60,
      buildingLengthFt: 40,
      footprintSource: 'solar',
    });
    console.log(JSON.stringify({
      siding: {
        net: siding.totals.net_siding_area_sqft,
        openingDeduction: siding.totals.opening_deduction_sqft,
        roughOpenings: siding.counts.window_rough_openings,
        windowUnits: siding.counts.window_units,
        publicWindowCount: siding.counts.windows_count,
        windowAssemblies: siding.counts.window_assemblies,
      },
      roof: {
        sqft: roof.totals.observed_roof_area_sqft,
        sq: roof.totals.observed_roof_area_sq,
      },
    }));
  `;
  const benchmark = JSON.parse(execFileSync(
    process.execPath,
    ['--input-type=module', '-e', benchmarkScript],
    { encoding: 'utf8' },
  ).trim());

  ok('siding total is exactly 2,018 ft²',
     benchmark.siding.net === 2018, benchmark.siding.net, 2018);
  ok('siding opening deduction is exactly 112 ft²',
     benchmark.siding.openingDeduction === 112, benchmark.siding.openingDeduction, 112);
  ok('all 14 individual window rough openings are preserved',
     benchmark.siding.roughOpenings === 14, benchmark.siding.roughOpenings, 14);
  ok('all 14 individual window units are counted',
     benchmark.siding.windowUnits === 14, benchmark.siding.windowUnits, 14);
  ok('public windows_count reports individual units, not assemblies',
     benchmark.siding.publicWindowCount === 14
       && benchmark.siding.windowAssemblies < benchmark.siding.publicWindowCount,
     benchmark.siding);
  ok('roof total is exactly 2,481 ft²',
     benchmark.roof.sqft === 2481, benchmark.roof.sqft, 2481);
  ok('roof square total is exactly 24.81 SQ',
     benchmark.roof.sq === 24.81, benchmark.roof.sq, 24.81);
}

// ── Multi-section house: each wing is its own plane ─────────────────────────
console.log('\n── Multi-section house: wings and gables are summed ──');
{
  const photos = [
    {
      label: 'Front corner',
      wall_planes: [
        { plane_id: 'two_story_gable', role: 'gable_end', face: 'front', width_ft: 22, eave_height_ft: 18, gable_rise_ft: 8, gable_sided: true, sided: true, story_count: 2, outside_corners: 2, inside_corners: 0 },
        { plane_id: 'garage_gable', role: 'garage', face: 'front', width_ft: 20, eave_height_ft: 9, gable_rise_ft: 6, gable_sided: true, sided: true, story_count: 1, outside_corners: 2 },
      ],
    },
    {
      label: 'Front corner again',
      wall_planes: [
        { plane_id: 'two_story_gable', role: 'gable_end', face: 'front', width_ft: 21, eave_height_ft: 18, gable_rise_ft: 7.5, gable_sided: true, sided: true, story_count: 2, outside_corners: 2 },
      ],
    },
    {
      label: 'Occluded side',
      wall_planes: [
        { plane_id: 'hip_side', role: 'wing', face: 'left_side', width_ft: 22, eave_height_ft: 9, gable_rise_ft: 0, sided: true, story_count: 1, occluded: true, occlusion_pct: 45, outside_corners: 1 },
      ],
    },
    {
      label: 'Rear porch',
      wall_planes: [
        { plane_id: 'rear_wall', role: 'main', face: 'back', width_ft: 28, eave_height_ft: 9, gable_rise_ft: 0, sided: true, story_count: 1, non_siding_pct: 18, non_siding_material: 'stone', inside_corners: 2 },
        { plane_id: 'porch_open', role: 'porch', face: 'back', width_ft: 28, eave_height_ft: 10, gable_rise_ft: 9, gable_sided: false, sided: false },
        { plane_id: 'chimney', role: 'chimney', face: 'back', width_ft: 4, eave_height_ft: 18, sided: false, non_siding_material: 'brick' },
      ],
    },
  ];
  const takeoff = sumDistinctWallPlanes(photos, {
    satelliteAxes: { front: 42, back: 42, left_side: 36, right_side: 36 },
  });
  const byId = Object.fromEntries(takeoff.planes.map(plane => [plane.plane_id, plane]));
  ok('the two photos of the two-story gable are one plane',
    takeoff.planes.filter(plane => plane.plane_id === 'two_story_gable').length === 1);
  ok('two-story gable keeps its own triangle (22 × 18 + ½ × 22 × 8)',
    byId.two_story_gable.gross_area_sqft === 484, byId.two_story_gable.gross_area_sqft, 484);
  ok('garage gable is added, not averaged away (20 × 9 + ½ × 20 × 6)',
    byId.garage_gable.gross_area_sqft === 240, byId.garage_gable.gross_area_sqft, 240);
  ok('the tree-blocked side uses the satellite length',
    byId.hip_side.width_ft === 36 && byId.hip_side.width_source === 'satellite_footprint',
    byId.hip_side.width_ft, 36);
  ok('open porch gable is not siding',
    byId.porch_open.excluded === true && byId.porch_open.siding_area_sqft === 0);
  ok('chimney is not siding',
    byId.chimney.excluded === true && byId.chimney.siding_area_sqft === 0);
  ok('stone band is excluded from the rear wall',
    byId.rear_wall.masonry_area_sqft === 45, byId.rear_wall.masonry_area_sqft, 45);
  ok('outside corners are the sum of the planes, not a 4-corner box',
    takeoff.outside_corners === 5, takeoff.outside_corners, 5);
  ok('inside corners at the wings are kept',
    takeoff.inside_corners === 2, takeoff.inside_corners, 2);
  ok('the takeoff is the sum of the sided planes',
    takeoff.authoritative === true && takeoff.gross_wall_sqft === 484 + 240 + 324 + 252,
    takeoff.gross_wall_sqft, 484 + 240 + 324 + 252);
}

console.log('\n── An occluded gable is not stretched to the long satellite side ──');
{
  const takeoff = sumDistinctWallPlanes([
    {
      label: 'Trees',
      wall_planes: [
        { plane_id: 'end_gable', role: 'gable_end', face: 'right_side', width_ft: 16, eave_height_ft: 10, gable_rise_ft: 4, gable_sided: true, sided: true, occluded: true, occlusion_pct: 40 },
        { plane_id: 'clear_side', role: 'main', face: 'left_side', width_ft: 40, eave_height_ft: 9, sided: true },
        { plane_id: 'front_wall', role: 'main', face: 'front', width_ft: 30, eave_height_ft: 9, sided: true },
      ],
    },
  ], { satelliteAxes: { front: 40, back: 40, left_side: 105, right_side: 105 } });
  const gable = takeoff.planes.find(plane => plane.plane_id === 'end_gable');
  ok('the hidden gable stays on the short footprint axis',
    gable.width_ft < 40 && gable.width_ft > 16, gable.width_ft);
  ok('the gable triangle keeps the visible end as its base',
    gable.gable_area_sqft === 32, gable.gable_area_sqft, 32);
}

console.log('\n── A traced outline keeps the walls the photos missed ──');
{
  const takeoff = sumDistinctWallPlanes([
    {
      label: 'Partial',
      wall_planes: [
        { plane_id: 'front', role: 'gable_end', face: 'front', width_ft: 24, eave_height_ft: 18, gable_rise_ft: 6, gable_sided: true, sided: true, story_count: 2 },
        { plane_id: 'side', role: 'main', face: 'left_side', width_ft: 30, eave_height_ft: 9, sided: true, story_count: 1 },
        { plane_id: 'porch_open', role: 'porch', face: 'back', width_ft: 20, eave_height_ft: 9, gable_rise_ft: 8, gable_sided: false, sided: false },
      ],
    },
  ], { tracedPerimeterFt: 160 });
  const remainder = takeoff.planes.find(plane => plane.plane_id === 'footprint_remainder');
  ok('the unseen length is the outline minus the porch',
    remainder && remainder.width_ft === 160 - 24 - 30 - 20, remainder && remainder.width_ft);
  ok('the remainder is one-story wall with no gable',
    remainder && remainder.gable_area_sqft === 0 && remainder.eave_height_ft === 9,
    remainder && remainder.eave_height_ft);
  ok('the two-story eave is not dropped to a first-floor reading',
    takeoff.planes.find(plane => plane.plane_id === 'front').eave_height_ft === 18);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n❌ Assertion failures — siding aggregate logic has regressed.');
  process.exit(1);
} else {
  console.log('\n✅ All siding aggregate assertions passed.');
}
