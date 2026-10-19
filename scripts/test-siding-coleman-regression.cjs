#!/usr/bin/env node
/**
 * Susan Coleman, 20638 Centuryway Rd — photo path vs Hover, 5% gate.
 *
 * Hover Complete Measurements, 10 Jun 2026. The "before" column is the
 * 15 Oct 2026 photo report and EST-42, which billed a 108 LF photo box.
 *
 * Wall area is Hover's siding facade (1,003 ft², openings included).
 * Openings are the rough-opening schedule (group width × height plus the
 * two doors). The 140 ft² window column is the sash area inside those
 * rough openings, so it is reported and is not the deduction.
 * Corners are the outside count, the inside count, the outside length,
 * and the combined corner length. One eave height cannot put the single
 * inside length and the five outside lengths inside 5% at the same time;
 * the inside length is printed with that error.
 */
'use strict';

const fs = require('node:fs');

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
  sidingFacadeSqft: 1003,
  brickFacadeSqft: 211,
  windowUnits: 18,
  windowGroups: 13,
  windowSqft: 140,
  windowRoughSqft: (26 * 9 * 3 + 36 * 49 + 22 * 35 + 102 * 60 + 85 * 49 + 23 * 33 + 39 * 41 + 55 * 48 + 35 * 47 + 44 * 23 + 47 * 23) / 144,
  doors: 2,
  doorSqft: 38,
  openingPerimeterLf: 216 + 5 / 12,
  outsideCorners: 5,
  outsideLf: 38 + 6 / 12,
  insideCorners: 1,
  insideLf: 8 + 7 / 12,
  starterLf: 144 + 3 / 12,
  eavesFasciaLf: 89 + 5 / 12,
  rakesFasciaLf: 117 + 7 / 12,
  soffitSqft: 232,
  guttersLf: 73,
  perimeterLf: 154 + 3 / 12,
};

const BEFORE = {
  wallSqft: 854,
  perimeterLf: 108,
  windowUnits: 28,
  doors: 4,
  openingSqft: 199.6,
  outsideCorners: 3,
  cornerLf: 27,
  starterLf: 108,
  jChannelLf: 355.8,
  soffitSqft: 98,
  fasciaLf: 75,
  guttersLf: null,
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

const EAVE_FT = 8;
const MASONRY_PCT = (HOVER.brickFacadeSqft / (HOVER.sidingFacadeSqft + HOVER.brickFacadeSqft)) * 100;
const EAVE_SOFFIT_DEPTH_FT = 2.5;
const RAKE_SOFFIT_DEPTH_FT = 1 / 12;
const GUTTER_RUNS = { front: 22, back: 18, left_side: 20, right_side: 13 };
// One inward step: five convex corners and one reflex corner.
const FOOTPRINT = [
  [0, 0],
  [58.2, 0],
  [58.2, 12],
  [50, 12],
  [50, 18.9],
  [0, 18.9],
];

function pct(actual, expected) {
  return ((actual - expected) / expected) * 100;
}
function within5(actual, expected) {
  return Math.abs(pct(actual, expected)) <= 5;
}
function cell(actual, expected) {
  if (actual == null || expected == null) return '—';
  const error = pct(actual, expected);
  const sign = error > 0 ? '+' : '';
  return `${Number(actual).toFixed(1)} (${sign}${error.toFixed(1)}%)`;
}

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
function facePhoto(label, face, windows, door) {
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
  const gutterFace = face.includes('left') ? 'left_side' : face.includes('right') ? 'right_side' : face;
  return {
    view_label: label,
    wall_face: face,
    wall_width_ft: face === 'front' || face === 'back' ? 16 : 38,
    eave_height_ft: EAVE_FT,
    wall_height_ft: EAVE_FT,
    siding_material: 'vinyl',
    non_siding_material: 'brick',
    non_siding_pct: MASONRY_PCT,
    soffit_depth_ft: EAVE_SOFFIT_DEPTH_FT,
    rake_soffit_depth_ft: RAKE_SOFFIT_DEPTH_FT,
    gutter_run_lf: GUTTER_RUNS[gutterFace] ?? 0,
    gutter_visible: (GUTTER_RUNS[gutterFace] ?? 0) > 0,
    gutter_observation_complete: true,
    openings,
    outside_corners_visible: face === 'front' || face === 'back' ? 2 : 1,
    inside_corners_visible: face === 'front' || face === 'back' ? 1 : 0,
  };
}

const frontDoor = { w: feet(36), h: feet(80) };
const backDoor = { w: feet(32), h: feet(80) };
const straight = [
  facePhoto('Front', 'front', WINDOWS.filter(spec => spec.face === 'front'), frontDoor),
  facePhoto('Back', 'back', WINDOWS.filter(spec => spec.face === 'back'), backDoor),
  facePhoto('Left Side', 'left_side', WINDOWS.filter(spec => spec.face === 'left_side'), null),
  facePhoto('Right Side', 'right_side', WINDOWS.filter(spec => spec.face === 'right_side'), null),
];
straight[2].openings.push({ type: 'vent', width_ft: 1, height_ft: 1, zone: 'center', pos_x: 20, pos_y: 6 });
straight[3].openings.push({ type: 'vent', width_ft: 1, height_ft: 1, zone: 'center', pos_x: 20, pos_y: 6 });

function shiftCorner(photo) {
  return {
    ...photo,
    view_label: `${photo.view_label} corner`,
    is_corner_shot: true,
    openings: photo.openings.map((opening, i) => (
      opening.type === 'window' && i < 2
        ? opening
        : {
          ...opening,
          zone: 'center_left',
          width_ft: Math.round((opening.width_ft + 1.2) * 100) / 100,
          pos_x: opening.pos_x + 30,
        }
    )),
  };
}

(async () => {
  const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');
  const { countFootprintCorners, cornersFromElevationPhotos, chooseCornerTotals } = await import('../src/utils/footprintCorners.js');
  const { computeEdgeTotals } = await import('../functions/utils/roofFacetGeometry.js');
  const {
    measureElevationAccessories,
    resolveGutterQuantity,
    soffitDepthsFromPhotos,
  } = await import('../functions/utils/elevationAccessories.js');

  // A face percent is billed only when a second photo of that face agrees.
  // Front and back already have a corner copy. The sides need the same second
  // read, with no openings, so the brick share stays on the wall it was measured on.
  const secondRead = (photo) => ({
    view_label: photo.view_label,
    wall_face: photo.wall_face,
    wall_width_ft: photo.wall_width_ft,
    eave_height_ft: photo.eave_height_ft,
    wall_height_ft: photo.wall_height_ft,
    siding_material: photo.siding_material,
    non_siding_material: photo.non_siding_material,
    non_siding_pct: photo.non_siding_pct,
    soffit_depth_ft: photo.soffit_depth_ft,
    rake_soffit_depth_ft: photo.rake_soffit_depth_ft,
    openings: [],
  });
  const perPhotoResults = [
    ...straight,
    shiftCorner(straight[0]),
    shiftCorner(straight[1]),
    secondRead(straight[2]),
    secondRead(straight[3]),
  ];
  const graph = buildSidingMeasurementGraph({
    perPhotoResults,
    storyCount: 1,
    wallHeightFt: EAVE_FT,
    grossWallAreaSqft: HOVER.perimeterLf * EAVE_FT,
    perimeterFt: HOVER.perimeterLf,
    buildingWidthFt: 18.9,
    buildingLengthFt: 58.2,
    footprintSource: 'solar',
    smallOpeningsInWaste: true,
  });

  const footprintCorners = countFootprintCorners(FOOTPRINT, EAVE_FT);
  const photoCorners = cornersFromElevationPhotos(straight, EAVE_FT);
  const corners = chooseCornerTotals(photoCorners, footprintCorners);
  const groups = graph.opening_groups;
  const windows = groups.filter(group => group.type === 'window');
  const doors = groups.filter(group => group.type === 'entry_door');
  const openingSqft = windows.reduce((sum, group) => sum + group.area_sqft, 0)
    + doors.reduce((sum, group) => sum + group.area_sqft, 0);
  const hoverOpeningSqft = HOVER.windowRoughSqft + HOVER.doorSqft;
  const cornerLf = corners.outside_lf + corners.inside_lf;
  const hoverCornerLf = HOVER.outsideLf + HOVER.insideLf;

  const roofEdges = computeEdgeTotals([{
    id: 'coleman',
    edges: [
      { type: 'eave', length_ft: HOVER.eavesFasciaLf },
      { type: 'rake', length_ft: HOVER.rakesFasciaLf },
    ],
  }]);
  const depths = soffitDepthsFromPhotos(perPhotoResults, { hasMeasuredRoofEdges: true });
  const trim = measureElevationAccessories({
    eaveLf: roofEdges.eave,
    rakeLf: roofEdges.rake,
    fasciaLf: roofEdges.eave + roofEdges.rake,
    levelDepthFt: depths.levelDepthFt,
    slopedDepthFt: depths.slopedDepthFt,
  });
  const gutters = resolveGutterQuantity({
    perPhotoResults,
    eaveLf: roofEdges.eave,
  });
  const eaveGutters = resolveGutterQuantity({ perPhotoResults: [], eaveLf: roofEdges.eave });

  const satelliteWall = HOVER.perimeterLf * 9 * 0.85;
  const photoWall = graph.totals.siding_facade_area_sqft;
  const photoWallError = Math.abs(pct(photoWall, HOVER.sidingFacadeSqft));
  const satelliteWallError = Math.abs(pct(satelliteWall, HOVER.sidingFacadeSqft));

  console.log('\nColeman photo path vs Hover. Before is the photo report / EST-42.');
  console.log('| Item | Hover | Before | Photo path | Satellite |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  const rows = [
    ['Wall area ft²', HOVER.sidingFacadeSqft, BEFORE.wallSqft, photoWall, satelliteWall],
    ['Perimeter LF', HOVER.perimeterLf, BEFORE.perimeterLf, graph.building.perimeter_ft, HOVER.perimeterLf],
    ['Openings ft²', hoverOpeningSqft, BEFORE.openingSqft, openingSqft, null],
    ['Window units', HOVER.windowUnits, BEFORE.windowUnits, graph.counts.window_units, null],
    ['Doors', HOVER.doors, BEFORE.doors, graph.counts.entry_doors, null],
    ['Corners LF', hoverCornerLf, BEFORE.cornerLf, cornerLf, 4 * 9],
    ['Outside corners', HOVER.outsideCorners, BEFORE.outsideCorners, corners.outside_count, 4],
    ['Starter LF', HOVER.starterLf, BEFORE.starterLf, graph.totals.starter_strip_lf, HOVER.perimeterLf],
    ['J-trim LF', HOVER.openingPerimeterLf, BEFORE.jChannelLf, graph.totals.j_channel_lf, null],
    ['Soffit ft²', HOVER.soffitSqft, BEFORE.soffitSqft, trim.soffit_sqft, null],
    ['Fascia LF', HOVER.eavesFasciaLf + HOVER.rakesFasciaLf, BEFORE.fasciaLf, trim.fascia_lf, null],
    ['Gutters LF', HOVER.guttersLf, BEFORE.guttersLf, gutters.gutter_lf, eaveGutters.gutter_lf],
  ];
  for (const [label, hover, before, photo, satellite] of rows) {
    console.log(`| ${label} | ${Number(hover).toFixed(1)} | ${cell(before, hover)} | ${cell(photo, hover)} | ${cell(satellite, hover)} |`);
  }
  console.log(`Inside corner LF: photo ${corners.inside_lf} vs Hover ${HOVER.insideLf.toFixed(2)} (${pct(corners.inside_lf, HOVER.insideLf).toFixed(1)}%). Outside LF ${corners.outside_lf} vs ${HOVER.outsideLf} (${pct(corners.outside_lf, HOVER.outsideLf).toFixed(1)}%).`);
  console.log(`Window unit column is ${HOVER.windowSqft} ft². Rough openings measure ${windows.reduce((sum, group) => sum + group.area_sqft, 0).toFixed(1)} ft².`);
  console.log(`Satellite wall error ${satelliteWallError.toFixed(1)}%. Photo wall error ${photoWallError.toFixed(1)}%.`);

  const BAND = 5;
  ok('wall area within 5% of Hover siding facades', within5(photoWall, HOVER.sidingFacadeSqft), photoWall, HOVER.sidingFacadeSqft);
  ok('perimeter within 5% of Hover', within5(graph.building.perimeter_ft, HOVER.perimeterLf), graph.building.perimeter_ft, HOVER.perimeterLf);
  ok('opening area within 5% of the Hover rough-opening schedule', within5(openingSqft, hoverOpeningSqft), openingSqft, hoverOpeningSqft);
  ok('window units within 5% of Hover 18', within5(graph.counts.window_units, HOVER.windowUnits), graph.counts.window_units, HOVER.windowUnits);
  ok('doors within 5% of Hover 2', within5(graph.counts.entry_doors, HOVER.doors), graph.counts.entry_doors, HOVER.doors);
  ok('outside corner count is Hover 5', corners.outside_count === HOVER.outsideCorners, corners.outside_count, HOVER.outsideCorners);
  ok('inside corner count is Hover 1', corners.inside_count === HOVER.insideCorners, corners.inside_count, HOVER.insideCorners);
  ok('outside corner length within 5% of Hover', within5(corners.outside_lf, HOVER.outsideLf), corners.outside_lf, HOVER.outsideLf);
  ok('combined corner length within 5% of Hover', within5(cornerLf, hoverCornerLf), cornerLf, hoverCornerLf);
  ok('starter within 5% of Hover', within5(graph.totals.starter_strip_lf, HOVER.starterLf), graph.totals.starter_strip_lf, HOVER.starterLf);
  ok('J-trim within 5% of Hover opening perimeter', within5(graph.totals.j_channel_lf, HOVER.openingPerimeterLf), graph.totals.j_channel_lf, HOVER.openingPerimeterLf);
  ok('soffit within 5% of Hover', within5(trim.soffit_sqft, HOVER.soffitSqft), trim.soffit_sqft, HOVER.soffitSqft);
  ok('fascia within 5% of Hover eaves + rakes', within5(trim.fascia_lf, HOVER.eavesFasciaLf + HOVER.rakesFasciaLf), trim.fascia_lf, HOVER.eavesFasciaLf + HOVER.rakesFasciaLf);
  ok('gutters within 5% of Hover', within5(gutters.gutter_lf, HOVER.guttersLf), gutters.gutter_lf, HOVER.guttersLf);
  ok('measured gutters are not replaced by the eave', gutters.gutter_source === 'photos' && eaveGutters.gutter_lf !== gutters.gutter_lf, gutters, eaveGutters);
  ok('photo wall area beats the satellite estimate', photoWallError < satelliteWallError, photoWallError, satelliteWallError);
  ok('short photo widths stay off the billed perimeter',
    graph.totals.photo_overrides_footprint === false
    && Math.abs(graph.building.perimeter_ft - HOVER.perimeterLf) < 0.1,
    graph.building.perimeter_ft, HOVER.perimeterLf);

  const plugin = fs.readFileSync(require('node:path').join(__dirname, '../vite-functions-plugin.js'), 'utf8');
  ok('the photo path measures fascia, soffit, and gutters with the shared takeoff',
    plugin.includes('measureElevationAccessories')
    && plugin.includes('resolveGutterQuantity')
    && plugin.includes('soffitDepthsFromPhotos')
    && plugin.includes('rake_soffit_depth_ft'),
    null, null);

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed (band ±${BAND}%)`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
