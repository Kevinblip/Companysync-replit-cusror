#!/usr/bin/env node
/**
 * 20638 Centuryway Rd — Susan Coleman — Hover line-item benchmark.
 *
 * Hover Complete Measurements, 10 Jun 2026, property 22005438.
 * The photo report beside it (15 Oct 2026, photos only) is the "before":
 * siding material 1,020 ft² is close, and the opening count, opening size,
 * and corner length are not.
 *
 * The elevation photos are not in the repo. The fixture below reproduces the
 * failure the report showed: straight elevations carry Hover's 13 window
 * groups, 18 units, and 2 doors, and the corner slots photograph them again
 * with zones and sizes that the strict matcher does not treat as the same
 * opening. Three portrait windows are also split into equal sashes.
 */
'use strict';

let passed = 0;
let failed = 0;
function ok(label, cond, got, expected) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    const detail = got !== undefined ? ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}` : '';
    console.log(`  ✗ ${label}${detail}`);
  }
}

const feet = (inches) => inches / 12;
const HOVER = {
  address: '20638 Centuryway Rd, Maple Heights, OH 44137',
  sidingFacadeSqft: 1003,
  sidingTrimUnknownSqft: 1031,
  brickFacadeSqft: 211,
  sidingOpeningCount: 17,
  brickOpeningCount: 3,
  sidingOpeningSqft: 278,
  brickOpeningSqft: 24,
  windowGroups: 13,
  windowUnits: 18,
  windowSqft: 140,
  // Sum of the group Width x Height column. Larger than the 140 ft² unit
  // column because mullion joints sit inside the rough opening.
  windowRoughSqft: (26 * 9 * 3 + 36 * 49 + 22 * 35 + 102 * 60 + 85 * 49 + 23 * 33 + 39 * 41 + 55 * 48 + 35 * 47 + 44 * 23 + 47 * 23) / 144,
  doors: 2,
  doorSqft: 38,
  vents: 2,
  openingTopsLf: 61 + 3 / 12,
  openingSillsLf: 41,
  openingSidesLf: 114 + 2 / 12,
  sidingInsideCorners: 1,
  sidingInsideLf: 8 + 7 / 12,
  sidingOutsideCorners: 5,
  sidingOutsideLf: 38 + 6 / 12,
  otherInsideCorners: 3,
  otherInsideLf: 3 + 6 / 12,
  otherOutsideCorners: 10,
  otherOutsideLf: 15 + 2 / 12,
  starterLf: 144 + 3 / 12,
  eavesFasciaLf: 89 + 5 / 12,
  rakesFasciaLf: 117 + 7 / 12,
  soffitSqft: 232,
  guttersLf: 73,
  downspoutsLf: 48,
  roofSqft: 1421,
  roofPitch: '6/12',
  ridgeHipLf: 46 + 8 / 12,
  valleyLf: 28 + 1 / 12,
  footprintSqft: 1100,
  perimeterLf: 154 + 3 / 12,
};

// Numbers read from the 15 Oct 2026 photo-based measurement summary.
const REPORT = {
  sidingMaterialSqft: 1020,
  sidingNetSqft: 854,
  brickSqft: 171,
  windowAssemblies: 20,
  windowUnits: 28,
  doors: 4,
  roughOpeningsSqft: 199.6,
  sidingOpeningsSqft: 166.23,
  jChannelLf: 355.8,
  starterLf: 108,
  cornersLf: 27,
  fasciaLf: 75,
  soffitSqft: 98,
  trimSqft: 156,
  roofPerimeterLf: 75,
  wallPerimeterLf: 108,
  roofFacets: 2,
  pitch: '4/12',
  gableSqft: 102,
};

const WINDOWS = [
  { w: 26, h: 9, units: 1, face: 'front', portraitSash: false },
  { w: 26, h: 9, units: 1, face: 'front', portraitSash: false },
  { w: 26, h: 9, units: 1, face: 'front', portraitSash: false },
  { w: 36, h: 49, units: 1, face: 'front', portraitSash: true },
  { w: 22, h: 35, units: 1, face: 'front', portraitSash: true },
  { w: 102, h: 60, units: 3, face: 'back', portraitSash: false },
  { w: 85, h: 49, units: 3, face: 'back', portraitSash: false },
  { w: 23, h: 33, units: 1, face: 'back', portraitSash: true },
  { w: 39, h: 41, units: 1, face: 'back', portraitSash: false },
  { w: 55, h: 48, units: 2, face: 'left_side', portraitSash: false },
  { w: 35, h: 47, units: 1, face: 'left_side', portraitSash: false },
  { w: 44, h: 23, units: 1, face: 'right_side', portraitSash: false },
  { w: 47, h: 23, units: 1, face: 'right_side', portraitSash: false },
];

function openingFrom(spec, index, zone, sizeScale) {
  const width = feet(spec.w) * sizeScale;
  const height = feet(spec.h);
  const units = spec.portraitSash ? 2 : spec.units;
  const components = units > 1
    ? Array.from({ length: units }, () => ({
      type: 'window',
      width_ft: Math.round((width / units) * 100) / 100,
      height_ft: Math.round(height * 100) / 100,
    }))
    : undefined;
  return {
    type: 'window',
    width_ft: Math.round(width * 100) / 100,
    height_ft: Math.round(height * 100) / 100,
    zone,
    pos_x: 4 + index * 12,
    pos_y: 4,
    ...(components ? { components } : {}),
  };
}

const ZONES = ['far_left', 'center_left', 'center', 'center_right', 'far_right'];
const frontWindows = WINDOWS.filter((spec) => spec.face === 'front');
const backWindows = WINDOWS.filter((spec) => spec.face === 'back');
const leftWindows = WINDOWS.filter((spec) => spec.face === 'left_side');
const rightWindows = WINDOWS.filter((spec) => spec.face === 'right_side');

function facePhoto(label, face, windows, door, extra = {}) {
  const openings = windows.map((spec, i) => openingFrom(spec, i, ZONES[i % ZONES.length], 1));
  if (door) {
    openings.push({
      type: 'entry_door',
      width_ft: door.w,
      height_ft: door.h,
      zone: 'far_right',
      pos_x: 70,
      pos_y: 3.4,
    });
  }
  return {
    view_label: label,
    wall_face: face,
    wall_width_ft: extra.wall_width_ft,
    eave_height_ft: 9,
    wall_height_ft: 9,
    siding_material: 'vinyl',
    non_siding_material: 'brick',
    non_siding_pct: extra.non_siding_pct || 0,
    openings,
    outside_corners_visible: extra.outside_corners_visible,
    inside_corners_visible: extra.inside_corners_visible,
    ...extra,
  };
}

const frontDoor = { w: feet(36), h: feet(80) };
const backDoor = { w: feet(32), h: feet(80) };

const straight = [
  facePhoto('Front', 'front', frontWindows, frontDoor, {
    wall_width_ft: 16, outside_corners_visible: 2, inside_corners_visible: 1, non_siding_pct: 12,
  }),
  facePhoto('Back', 'back', backWindows, backDoor, {
    wall_width_ft: 16, outside_corners_visible: 2, inside_corners_visible: 1,
  }),
  facePhoto('Left Side', 'left_side', leftWindows, null, {
    wall_width_ft: 38, outside_corners_visible: 1, inside_corners_visible: 0,
    openings: undefined,
  }),
  facePhoto('Right Side', 'right_side', rightWindows, null, {
    wall_width_ft: 38, outside_corners_visible: 1, inside_corners_visible: 0,
  }),
];
// facePhoto spreads extra after openings, so the left photo's openings: undefined
// would wipe them. Rebuild the left and right photos explicitly.
straight[2] = facePhoto('Left Side', 'left_side', leftWindows, null, {
  wall_width_ft: 38, outside_corners_visible: 1, inside_corners_visible: 0,
});
straight[2].openings.push({ type: 'vent', width_ft: 1, height_ft: 1, zone: 'center', pos_x: 20, pos_y: 6 });
straight[3].openings.push({ type: 'vent', width_ft: 1, height_ft: 1, zone: 'center', pos_x: 20, pos_y: 6 });

// Two of the front windows are re-read identically (strict dedupe catches them).
// The other three, and the door, come back with a shifted zone and a size the
// strict matcher rejects. The back corner misses on every opening.
const cornerFront = facePhoto('FR Corner', 'front', frontWindows, frontDoor, {
  wall_width_ft: 16, is_corner_shot: true,
});
cornerFront.openings = cornerFront.openings.map((opening, i) => {
  if (opening.type === 'window' && i < 2) return opening;
  return {
    ...opening,
    zone: 'center_left',
    width_ft: Math.round((opening.width_ft + 1.2) * 100) / 100,
    pos_x: opening.pos_x + 30,
  };
});
const cornerBack = facePhoto('BR Corner', 'back', backWindows, backDoor, {
  wall_width_ft: 16, is_corner_shot: true,
});
cornerBack.openings = cornerBack.openings.map((opening) => ({
  ...opening,
  zone: 'center_left',
  width_ft: Math.round((opening.width_ft + 1.2) * 100) / 100,
  pos_x: opening.pos_x + 30,
}));

const perPhotoResults = [...straight, cornerFront, cornerBack];

(async () => {
const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');
const {
  cornersFromElevationPhotos,
  chooseCornerTotals,
  countFootprintCorners,
} = await import('../src/utils/footprintCorners.js');

const graph = buildSidingMeasurementGraph({
  perPhotoResults,
  storyCount: 1,
  wallHeightFt: 9,
  grossWallAreaSqft: HOVER.perimeterLf * 9,
  perimeterFt: HOVER.perimeterLf,
  buildingWidthFt: 18.9,
  buildingLengthFt: 58.2,
  footprintSource: 'solar',
  smallOpeningsInWaste: true,
});

function pct(actual, expected) {
  if (!expected) return null;
  return ((actual - expected) / expected) * 100;
}
function cell(actual, expected, digits = 1) {
  if (actual == null || expected == null) return '—';
  const error = pct(actual, expected);
  const sign = error > 0 ? '+' : '';
  return `${Number(actual).toFixed(digits)} vs ${Number(expected).toFixed(digits)} (${sign}${error.toFixed(1)}%)`;
}

const groups = graph.opening_groups;
const windows = groups.filter((g) => g.type === 'window');
const doors = groups.filter((g) => g.type === 'entry_door');
const windowSqft = windows.reduce((s, g) => s + g.area_sqft, 0);
const doorSqft = doors.reduce((s, g) => s + g.area_sqft, 0);
const tops = [...windows, ...doors].reduce((s, g) => s + g.width_ft, 0);
const sills = windows.reduce((s, g) => s + g.width_ft, 0);
const sides = [...windows, ...doors].reduce((s, g) => s + 2 * g.height_ft, 0);

const photoCorners = cornersFromElevationPhotos(straight, 9);
const footprintCorners = countFootprintCorners(null, 9);
const corners = chooseCornerTotals(photoCorners, footprintCorners);
const jogged = cornersFromElevationPhotos([
  { wall_face: 'front', outside_corners_visible: 2, inside_corners_visible: 2 },
  { wall_face: 'back', outside_corners_visible: 3, inside_corners_visible: 0 },
  { wall_face: 'left_side', outside_corners_visible: 3, inside_corners_visible: 0 },
  { wall_face: 'right_side', outside_corners_visible: 2, inside_corners_visible: 0 },
], 9);

console.log('\nHover vs the 15 Oct 2026 photo report, then the fixed graph');
console.log('House is mixed vinyl and brick. Hover siding facades include openings.');
const rows = [
  ['Siding facades', HOVER.sidingFacadeSqft, REPORT.sidingMaterialSqft, null],
  ['Siding + trim + unknown', HOVER.sidingTrimUnknownSqft, REPORT.sidingMaterialSqft, null],
  ['Net wall area', null, REPORT.sidingNetSqft, null],
  ['Brick', HOVER.brickFacadeSqft, REPORT.brickSqft, null],
  ['Window groups', HOVER.windowGroups, REPORT.windowAssemblies, graph.counts.window_assemblies],
  ['Window units', HOVER.windowUnits, REPORT.windowUnits, graph.counts.window_units],
  ['Entry doors', HOVER.doors, REPORT.doors, graph.counts.entry_doors],
  ['Window unit area ft²', HOVER.windowSqft, null, null],
  ['Window rough-opening ft²', HOVER.windowRoughSqft, null, windowSqft],
  ['Door area ft²', HOVER.doorSqft, null, doorSqft],
  ['Rough openings ft²', HOVER.windowSqft + HOVER.doorSqft, REPORT.roughOpeningsSqft, windowSqft + doorSqft],
  ['Siding opening deduction ft²', HOVER.sidingOpeningSqft, REPORT.sidingOpeningsSqft, graph.totals.opening_deduction_sqft],
  ['Opening tops LF', HOVER.openingTopsLf, null, tops],
  ['Opening sills LF', HOVER.openingSillsLf, null, sills],
  ['Opening sides LF', HOVER.openingSidesLf, null, sides],
  ['Siding outside corners', HOVER.sidingOutsideCorners, null, corners.outside_count],
  ['Siding outside corner LF', HOVER.sidingOutsideLf, null, corners.outside_lf],
  ['Siding inside corners', HOVER.sidingInsideCorners, null, corners.inside_count],
  ['Siding inside corner LF', HOVER.sidingInsideLf, null, corners.inside_lf],
  ['Corner LF (outside + inside)', HOVER.sidingOutsideLf + HOVER.sidingInsideLf, REPORT.cornersLf, corners.outside_lf + corners.inside_lf],
  ['Other outside / inside corners', `${HOVER.otherOutsideCorners} / ${HOVER.otherInsideCorners}`, null, null],
  ['Starter LF', HOVER.starterLf, REPORT.starterLf, graph.totals.starter_strip_lf],
  ['Wall perimeter LF', HOVER.perimeterLf, REPORT.wallPerimeterLf, graph.building.perimeter_ft],
  ['Footprint ft²', HOVER.footprintSqft, null, null],
  ['Eave fascia LF', HOVER.eavesFasciaLf, REPORT.fasciaLf, null],
  ['Rake fascia LF', HOVER.rakesFasciaLf, null, null],
  ['Soffit ft²', HOVER.soffitSqft, REPORT.soffitSqft, null],
  ['Gutters LF', HOVER.guttersLf, null, null],
  ['Downspouts LF', HOVER.downspoutsLf, null, null],
  ['Roof ft²', HOVER.roofSqft, null, null],
  ['Roof pitch', HOVER.roofPitch, REPORT.pitch, null],
  ['Ridge + hip LF', HOVER.ridgeHipLf, null, null],
  ['Valley LF', HOVER.valleyLf, null, null],
];
console.log('\n| Item | Hover | Photo report | Fixed graph |');
console.log('| --- | ---: | ---: | ---: |');
for (const [label, hover, report, fixed] of rows) {
  const reportCell = report == null ? '—' : (typeof hover === 'number' ? cell(report, hover) : String(report));
  const fixedCell = fixed == null ? '—' : (typeof hover === 'number' ? cell(fixed, hover) : String(fixed));
  const hoverCell = hover == null ? '—' : (typeof hover === 'number' ? Number(hover.toFixed ? hover.toFixed(2) : hover) : hover);
  console.log(`| ${label} | ${hoverCell} | ${reportCell} | ${fixedCell} |`);
}

console.log('\n── Fixed graph vs Hover opening schedule ──');
ok('window groups reconcile to Hover 13', graph.counts.window_assemblies === HOVER.windowGroups, graph.counts.window_assemblies, HOVER.windowGroups);
ok('window units reconcile to Hover 18', graph.counts.window_units === HOVER.windowUnits, graph.counts.window_units, HOVER.windowUnits);
ok('entry doors reconcile to Hover 2', graph.counts.entry_doors === HOVER.doors, graph.counts.entry_doors, HOVER.doors);
ok('vents stay separate from windows', graph.counts.vents === HOVER.vents, graph.counts.vents, HOVER.vents);
ok('corner re-reads were collapsed', (graph.diagnostics.measured_corner_collapsed || 0) > 0, graph.diagnostics.measured_corner_collapsed);
// Hover's 140 ft² is the sum of the unit column. The group WxH column is the
// rough opening and includes the mullion joints, so it is larger.
ok('window rough-opening area matches Hover group WxH',
  Math.abs(pct(windowSqft, HOVER.windowRoughSqft)) <= 1, windowSqft, HOVER.windowRoughSqft);
ok('door area is within 5% of Hover 38', Math.abs(pct(doorSqft, HOVER.doorSqft)) <= 5, doorSqft, HOVER.doorSqft);
ok('photo widths stay off the billed perimeter',
  graph.totals.photo_overrides_footprint === false
  && graph.totals.photo_perimeter_flagged === true
  && Math.abs(graph.building.perimeter_ft - HOVER.perimeterLf) < 0.1,
  graph.building.perimeter_ft, HOVER.perimeterLf);
ok('starter is within 5% of Hover after grade doors come off the run',
  graph.totals.starter_strip_lf > REPORT.starterLf
  && Math.abs(pct(graph.totals.starter_strip_lf, HOVER.starterLf)) <= 5,
  graph.totals.starter_strip_lf, HOVER.starterLf);
ok('rough-opening J-trim is closer to Hover 216 LF than the 355.8 LF over-count',
  Math.abs(graph.totals.j_channel_lf - (216 + 5 / 12))
    < Math.abs(355.8 - (216 + 5 / 12)),
  graph.totals.j_channel_lf, 216 + 5 / 12);

console.log('\n── Corners ──');
ok('a jogged elevation may report more than 2 outside corners',
  jogged.outside_count === 5 && jogged.inside_count === 1, jogged, { outside: 5, inside: 1 });
ok('an under-counted photo does not replace the rectangle',
  corners.outside_count === 4 && corners.inside_count === 1, corners, { outside: 4, inside: 1 });
ok('corner LF is closer to Hover than the report\'s 27 LF',
  Math.abs((corners.outside_lf + corners.inside_lf) - (HOVER.sidingOutsideLf + HOVER.sidingInsideLf))
    < Math.abs(REPORT.cornersLf - (HOVER.sidingOutsideLf + HOVER.sidingInsideLf)),
  corners.outside_lf + corners.inside_lf,
  HOVER.sidingOutsideLf + HOVER.sidingInsideLf);
ok('a corner slot does not steal the straight elevation\'s corner count',
  photoCorners.outside_count === 3, photoCorners, 3);

console.log('\n── Brick opening stays out of the siding column ──');
const brickWall = {
  view_label: 'Front',
  wall_face: 'front',
  wall_width_ft: 40,
  eave_height_ft: 9,
  siding_material: 'vinyl',
  non_siding_material: 'brick',
  non_siding_pct: 100,
};
const brickGraph = buildSidingMeasurementGraph({
  perPhotoResults: [
    { ...brickWall, openings: [{ type: 'window', width_ft: 4, height_ft: 6, zone: 'center', pos_x: 10, pos_y: 4 }] },
    brickWall,
  ],
  storyCount: 1,
  wallHeightFt: 9,
  grossWallAreaSqft: 360,
  perimeterFt: 40,
  buildingWidthFt: 40,
  buildingLengthFt: 0,
  smallOpeningsInWaste: true,
});
ok('a window on a brick wall is not deducted from siding',
  brickGraph.totals.opening_deduction_sqft === 0
  && brickGraph.totals.opening_deduction_masonry_sqft === 24,
  {
    siding: brickGraph.totals.opening_deduction_sqft,
    masonry: brickGraph.totals.opening_deduction_masonry_sqft,
  },
  { siding: 0, masonry: 24 });

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
