#!/usr/bin/env node
/**
 * Regression for the Replit Gemini run of the six Malec photos.
 *
 * That run reported stories 2, perimeter 278, siding 2,772 (+53%), stone
 * 1,009, stucco 1,268, siding openings 19 (vs Hover 35), windows 468 ft²,
 * doors 4 / 268 ft², roof missing. Siding by face was front none, right
 * 1,003, left 966, back 803, on footprint lengths front 62.3 / right 77.9 /
 * back 59.7 / left 78.4.
 *
 * We do not have the raw Gemini JSON. BAD_PHOTOS is a reconstructed response
 * of that shape: the garage file labeled Right Side but facing the driveway,
 * two Left Side views plus the front-left corner each claiming the left wall,
 * polygons stretched across the whole footprint face, and the 17 ft floor
 * already written into eave_height_ft. The frozen naiveAverage() below is the
 * old measurement (trust the label, average every photo, ignore visible
 * fraction, use the clamped eave, drop corner openings, concatenate the
 * rest). It must keep reproducing those bad numbers. The live module must not.
 *
 * This does not score a live model. Only a real rerun does.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0;
let failed = 0;
function ok(label, cond, got, expected) {
  if (cond) { passed += 1; console.log(`  ✓ ${label}`); return; }
  failed += 1;
  const detail = got !== undefined ? ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}` : '';
  console.log(`  ✗ ${label}${detail}`);
}
const near = (a, e, band = 0.08) => Math.abs(a - e) <= Math.abs(e) * band;

const FACE_LENGTHS = { front: 62.3, right: 77.9, back: 59.7, left: 78.4 };
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const win = (n, material, w, h, xs) => Array.from({ length: n }, (_, i) => ({
  type: 'window', width_ft: w, height_ft: h, material, center_x: xs[i], pos_x: xs[i] * 78.4,
}));

const LEFT_XS = [0.06, 0.15, 0.24, 0.33, 0.42, 0.51, 0.60, 0.69];
const LEFT_DUPES = LEFT_XS.slice(0, 4);
const CORNER_XS = [0.02, 0.78, 0.84, 0.90, 0.96, 0.995];

// Reconstructed model output. eave_height_ft is the value after the 2-story
// floor had already replaced the garage wing's measured 9.5 ft.
const BAD_PHOTOS = [
  {
    view_label: 'Right Side',
    wall_face: 'right_side',
    faces_driveway: true,
    garage_doors_count: 2,
    window_rows: 1,
    story_count: 2,
    height_method: 'garage_door_anchor',
    height_clamped: true,
    eave_height_ft: 18,
    eave_before_clamp_ft: 9.5,
    gable_rise_ft: 4,
    confidence: 86,
    visible_width_fraction: 0.58,
    visible_x_start: 0,
    wall_width_ft: 77.9,
    sections: [
      { id: 'gar-sid', material: 'siding', polygon: rect(0, 0, 1, 0.7153) },
      { id: 'gar-stn', material: 'stone', polygon: rect(0, 0.78, 1, 0.88) },
      { id: 'gar-stc', material: 'stucco', polygon: [[0.15, 0], [0.85, 0], [0.5, -0.45]] },
    ],
    openings: [
      { type: 'garage_door', width_ft: 16, height_ft: 7, material: 'siding', pos_x: 10 },
      { type: 'garage_door', width_ft: 9, height_ft: 7, material: 'siding', pos_x: 26 },
    ],
  },
  {
    view_label: 'Front',
    wall_face: 'front',
    window_rows: 2,
    story_count: 2,
    eave_height_ft: 18,
    confidence: 84,
    visible_width_fraction: 0.4,
    visible_x_start: 0.6,
    wall_width_ft: 62.3,
    sections: [
      { id: 'ent-stn', material: 'stone', polygon: rect(0, 0.55, 1, 1) },
      { id: 'ent-stc', material: 'stucco', polygon: rect(0, 0.07, 1, 0.55) },
    ],
    openings: [
      { type: 'entry_door', width_ft: 6, height_ft: 8, material: 'stucco', pos_x: 50, wall_face: 'front' },
    ],
  },
  {
    view_label: 'Back',
    wall_face: 'back',
    window_rows: 2,
    story_count: 2,
    eave_height_ft: 18,
    confidence: 82,
    visible_width_fraction: 1,
    wall_width_ft: 59.7,
    sections: [
      { id: 'bk-sid', material: 'siding', polygon: rect(0, 0, 1, 0.7475) },
      { id: 'bk-stn', material: 'stone', polygon: rect(0, 0.88, 1, 1) },
      { id: 'bk-stc', material: 'stucco', polygon: [[0.3, 0], [0.7, 0], [0.5, -0.5]] },
    ],
    openings: [
      ...win(5, 'siding', 4, 7.8, [0.1, 0.28, 0.46, 0.64, 0.82]).map((o) => ({ ...o, pos_x: o.center_x * 59.7 })),
      { type: 'entry_door', width_ft: 5, height_ft: 9, material: 'stucco', pos_x: 30 },
    ],
  },
  {
    view_label: 'Left Side',
    wall_face: 'left_side',
    window_rows: 2,
    story_count: 2,
    eave_height_ft: 18,
    confidence: 88,
    visible_width_fraction: 1,
    wall_width_ft: 78.4,
    sections: [
      { id: 'lwide-sid', material: 'siding', polygon: rect(0, 0, 1, 0.5) },
      { id: 'lwide-stn', material: 'stone', polygon: rect(0, 0.82, 1, 0.96) },
      { id: 'lwide-stc', material: 'stucco', polygon: [[0.2, 0], [0.8, 0], [0.5, -0.35]] },
    ],
    openings: win(8, 'siding', 4, 6.5, LEFT_XS),
  },
  {
    view_label: 'Left Side',
    wall_face: 'left_side',
    window_rows: 2,
    story_count: 2,
    eave_height_ft: 18,
    confidence: 80,
    visible_width_fraction: 0.42,
    visible_x_start: 0.28,
    wall_width_ft: 78.4,
    sections: [
      { id: 'lclose-sid', material: 'siding', polygon: rect(0, 0, 1, 0.9) },
      { id: 'lclose-stn', material: 'stone', polygon: rect(0, 0.8, 1, 1) },
      { id: 'lclose-stc', material: 'stucco', polygon: rect(0, 0.1, 1, 0.55) },
    ],
    openings: win(4, 'siding', 4, 6.5, LEFT_DUPES),
  },
  {
    view_label: 'FL Corner',
    wall_face: 'left_side',
    secondary_wall_face: 'front',
    is_corner_shot: true,
    window_rows: 2,
    story_count: 2,
    eave_height_ft: 18,
    confidence: 64,
    wall_width_ft: 78.4,
    face_spans: { left: [0.05, 0.5], front: [0.0, 0.35] },
    sections: [
      { id: 'fl-left-sid', material: 'siding', wall_face: 'left', polygon: rect(0, 0, 1, 0.652) },
      { id: 'fl-left-stn', material: 'stone', wall_face: 'left', polygon: rect(0, 0.7, 0.5, 1) },
      { id: 'fl-front-stc', material: 'stucco', wall_face: 'front', polygon: rect(0.5, 0.1, 1, 0.7) },
    ],
    openings: win(6, 'siding', 4, 6.5, CORNER_XS).map((o) => ({ ...o, wall_face: 'left' })),
  },
];

function polyArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
function faceOf(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('front')) return 'front';
  if (raw.includes('back') || raw.includes('rear')) return 'back';
  if (raw.includes('left')) return 'left';
  if (raw.includes('right')) return 'right';
  return null;
}

/** The pre-fix measurement. Frozen so this fixture cannot silently stop reproducing the bad run. */
function naiveAverage(photos, faceLengths) {
  const byFace = {};
  for (const photo of photos) {
    const face = faceOf(photo.wall_face);
    const eave = photo.eave_height_ft;
    const length = faceLengths[face];
    const weight = (photo.confidence > 1 ? photo.confidence / 100 : photo.confidence) * (photo.is_corner_shot ? 0.5 : 1);
    const areas = {};
    for (const section of photo.sections) {
      const material = /stone/.test(section.material) ? 'stone' : /stucco/.test(section.material) ? 'stucco' : 'siding';
      areas[material] = (areas[material] || 0) + polyArea(section.polygon) * length * eave;
    }
    const entry = byFace[face] || (byFace[face] = { reads: [], straight: [], corner: [] });
    entry.reads.push({ weight, areas });
    const bucket = photo.is_corner_shot ? 'corner' : 'straight';
    for (const o of photo.openings || []) {
      entry[bucket].push({
        type: /door/.test(o.type) ? 'door' : 'window',
        material: o.material,
        sqft: o.width_ft * o.height_ft,
      });
    }
    byFace[face] = entry;
  }
  const out = { siding: 0, stone: 0, stucco: 0, faces: {}, openings: 0, windows: 0, windowSqft: 0, doors: 0, doorSqft: 0 };
  for (const [face, entry] of Object.entries(byFace)) {
    const wsum = entry.reads.reduce((s, r) => s + r.weight, 0);
    const areas = {};
    for (const m of ['siding', 'stone', 'stucco']) {
      areas[m] = entry.reads.reduce((s, r) => s + (r.areas[m] || 0) * r.weight, 0) / wsum;
      out[m] += areas[m];
    }
    const openings = entry.straight.length ? entry.straight : entry.corner;
    out.faces[face] = areas;
    for (const o of openings) {
      if (o.material === 'siding') out.openings += 1;
      if (o.type === 'door') { out.doors += 1; out.doorSqft += o.sqft; }
      else { out.windows += 1; out.windowSqft += o.sqft; }
    }
  }
  return out;
}

(async () => {
  const {
    measureWallMaterialSections,
    measureFromPhotoAnalysis,
    mergeVisionMaterialSamples,
    solarRoofAreaSqFt,
    isOneStoryWing,
  } = await import('../functions/utils/wallMaterialSections.js');

  const naive = naiveAverage(BAD_PHOTOS, FACE_LENGTHS);
  console.log('\nMalec recorded-response regression (fixture, not a live model run).');
  console.log(`naive siding ${naive.siding.toFixed(1)} stone ${naive.stone.toFixed(1)} stucco ${naive.stucco.toFixed(1)}`);
  console.log(`naive faces siding front ${naive.faces.front?.siding || 0} right ${naive.faces.right?.siding || 0} left ${naive.faces.left?.siding || 0} back ${naive.faces.back?.siding || 0}`);
  console.log(`naive openings ${naive.openings} windows ${naive.windowSqft.toFixed(1)} doors ${naive.doors} door ft² ${naive.doorSqft.toFixed(1)}`);

  ok('frozen old average reproduces siding 2772', near(naive.siding, 2772), Math.round(naive.siding), 2772);
  ok('frozen old average reproduces stone 1009', near(naive.stone, 1009.4), Math.round(naive.stone), 1009);
  ok('frozen old average reproduces stucco 1268', near(naive.stucco, 1268.1), Math.round(naive.stucco), 1268);
  ok('frozen old average puts ~1003 siding on the right', near(naive.faces.right.siding, 1003), Math.round(naive.faces.right.siding), 1003);
  ok('frozen old average puts ~966 siding on the left', near(naive.faces.left.siding, 966), Math.round(naive.faces.left.siding), 966);
  ok('frozen old average puts ~803 siding on the back', near(naive.faces.back.siding, 803), Math.round(naive.faces.back.siding), 803);
  ok('frozen old average leaves the front without siding', !(naive.faces.front?.siding > 1), naive.faces.front?.siding, 0);
  ok('frozen old average keeps 19 siding openings', naive.openings === 19, naive.openings, 19);
  ok('frozen old average keeps window area 468', near(naive.windowSqft, 468, 0.02), Math.round(naive.windowSqft), 468);
  ok('frozen old average keeps 4 doors and 268 ft²', naive.doors === 4 && near(naive.doorSqft, 268, 0.02), [naive.doors, Math.round(naive.doorSqft)], [4, 268]);

  const measured = measureWallMaterialSections({
    photos: BAD_PHOTOS,
    faceLengthsFt: FACE_LENGTHS,
    footprintPerimeterFt: 278,
  });
  const g = measured.totals_gross_sqft;
  console.log(`measured siding ${g.siding} stone ${g.stone} stucco ${g.stucco}`);
  for (const face of ['front', 'right', 'left', 'back']) {
    const row = measured.faces[face];
    console.log(`  ${face}: reads ${row?.photo_reads ?? 0} seen ${row?.photos_seen ?? 0} eave ${row?.eave_height_ft ?? '—'} siding ${row?.gross_sqft_by_material?.siding ?? '—'}`);
  }
  console.log(`measured openings ${measured.openings.by_material.siding?.count} windows ${measured.openings.window_sqft} doors ${measured.openings.doors} door ft² ${measured.openings.door_sqft}`);

  ok('siding is not the inflated 2772', g.siding < 2200 && !near(g.siding, naive.siding, 0.12), g.siding, '<2200');
  ok('stone is not the inflated blend', g.stone < naive.stone * 0.85, g.stone, naive.stone);
  ok('stucco is not the inflated blend', g.stucco < naive.stucco * 0.85, g.stucco, naive.stucco);
  ok('driveway garage is not billed as the right face', !(measured.faces.right?.gross_sqft_by_material?.siding > 200), measured.faces.right, null);
  ok('driveway garage siding lands on the front', (measured.faces.front?.gross_sqft_by_material?.siding || 0) > 50, measured.faces.front?.gross_sqft_by_material, 'front siding');
  ok('left face is measured once', measured.faces.left?.photo_reads === 1 && measured.faces.left?.photos_seen >= 2, measured.faces.left, 'reads 1');
  ok('left siding is the wide photo, not the 966 blend', measured.faces.left.gross_sqft_by_material.siding < 800, measured.faces.left.gross_sqft_by_material.siding, '<800');
  ok('garage wing keeps the measured eave, not the 17 ft floor', isOneStoryWing(BAD_PHOTOS[0]) && measured.faces.front.eave_height_ft < 17, measured.faces.front.eave_height_ft, '<17');

  for (const face of Object.keys(measured.faces)) {
    const row = measured.faces[face];
    const sum = Object.values(row.gross_sqft_by_material).reduce((s, v) => s + v, 0);
    const gross = row.length_ft * Math.max(row.eave_height_ft, 1) * 1.15;
    ok(`${face} materials stay within the face gross area`, sum <= gross + 1, Math.round(sum), Math.round(gross));
  }

  const rawOpenings = BAD_PHOTOS.reduce((s, p) => s + (p.openings || []).filter((o) => o.material === 'siding').length, 0);
  const sidingOpen = measured.openings.by_material.siding?.count || 0;
  ok('openings keep the corner windows the old path dropped', sidingOpen > 19, sidingOpen, '>19');
  ok('openings do not add the close-up duplicates', sidingOpen < rawOpenings, sidingOpen, rawOpenings);
  ok('door count stays 4 after dedupe', measured.openings.doors === 4, measured.openings.doors, 4);
  ok('door area stays 268 after dedupe', near(measured.openings.door_sqft, 268, 0.02), measured.openings.door_sqft, 268);

  const capped = measureWallMaterialSections({
    photos: [{
      view_label: 'Back',
      wall_face: 'back',
      eave_height_ft: 10,
      confidence: 0.9,
      sections: [
        { id: 'over-sid', material: 'siding', polygon: rect(0, 0, 1, 1) },
        { id: 'over-stn', material: 'stone', polygon: rect(0, 0, 1, 1) },
        { id: 'over-stc', material: 'stucco', polygon: rect(0, 0, 1, 0.5) },
      ],
    }],
    faceLengthsFt: { back: 59.7 },
  });
  const cappedSum = Object.values(capped.faces.back.gross_sqft_by_material).reduce((s, v) => s + v, 0);
  ok('overlapping full-wall sections are capped at the face gross', cappedSum <= 59.7 * 10 + 1, Math.round(cappedSum), Math.round(59.7 * 10));

  const withRoof = measureFromPhotoAnalysis({
    photos: BAD_PHOTOS,
    footprintPerimeterFt: 278,
    buildingWidthFt: 62.3,
    buildingLengthFt: 78.4,
    roofAreaSqFt: 4414,
  });
  ok('Solar roof area is returned with the section result', withRoof.roof_area_sqft === 4414 && withRoof.roof_area_source === 'solar', withRoof.roof_area_sqft, 4414);

  const solar = solarRoofAreaSqFt({
    wholeRoofStats: { areaMeters2: 400 },
    roofSegmentStats: [{ stats: { areaMeters2: 210 } }, { stats: { areaMeters2: 200 } }],
  });
  ok('Solar segment area converts to square feet', solar === Math.round(410 * 10.7639), solar, Math.round(410 * 10.7639));

  const plugin = fs.readFileSync(path.join(__dirname, '../vite-functions-plugin.js'), 'utf8');
  const analyzer = fs.readFileSync(path.join(__dirname, '../functions/analyzeHousePhotosForSiding.ts'), 'utf8');
  ok('the live handler returns Solar roof area', plugin.includes('roof_area_sqft: solarRoofAreaSqFtValue') && plugin.includes('solarRoofAreaSqFt('));
  ok('a one-story garage wing is not raised to the 17 ft floor', plugin.includes('oneStoryWing') && plugin.includes('eave_before_clamp_ft'));
  ok('the 2-story aggregate floor is unchanged', plugin.includes('+raised_to_2story_min'));
  ok('the satellite width anchor is still applied', plugin.includes('result.wall_width_ft = satelliteWallWidthFt'));
  ok('the model is asked for visible fraction and driveway front', plugin.includes('visible_width_fraction') && plugin.includes('faces_driveway') && analyzer.includes('faces_driveway'));
  ok('the run script no longer labels the garage photo Right Side', !fs.readFileSync(path.join(__dirname, 'run-siding-malec-photos.cjs'), 'utf8').includes("label: 'Right Side'"));

  const fullLeft = 78.4 * 18;
  const shared = measureWallMaterialSections({
    photos: [{
      view_label: 'Left close-up',
      wall_face: 'left_side',
      eave_height_ft: 18,
      window_rows: 2,
      story_count: 2,
      confidence: 0.9,
      visible_width_fraction: 0.3,
      visible_x_start: 0.2,
      material_shares: { siding: 60, stone: 25, stucco: 15 },
      material_sample_count: 3,
      sections: [{ id: 'sliver', material: 'siding', polygon: rect(0, 0, 1, 1) }],
    }],
    faceLengthsFt: { left: 78.4 },
  });
  const sharedSiding = shared.faces.left?.gross_sqft_by_material?.siding;
  ok('material shares bill the full face, not the 30% sliver', near(sharedSiding, fullLeft * 0.6, 0.01), sharedSiding, fullLeft * 0.6);
  ok('a stucco share becomes stucco area', (shared.faces.left?.gross_sqft_by_material?.stucco || 0) > 100, shared.faces.left?.gross_sqft_by_material, 'stucco > 100');
  ok('applying a partial photo to the full face is low confidence', shared.faces.left?.confidence === 'low' && shared.faces.left?.area_source === 'material_shares', shared.faces.left?.confidence, 'low');

  const filled = measureWallMaterialSections({
    photos: [{
      wall_face: 'front',
      eave_height_ft: 18,
      window_rows: 2,
      story_count: 2,
      confidence: 90,
      material_shares: { siding: 100 },
      sections: [{ id: 'front-sid', material: 'siding', polygon: rect(0, 0, 1, 1) }],
    }],
    faceLengthsFt: FACE_LENGTHS,
    fillUncoveredFaces: true,
  });
  ok('every footprint face gets an area when fill is on', filled.missing_faces.length === 0, filled.missing_faces, []);
  for (const face of ['right', 'back', 'left']) {
    const row = filled.faces[face];
    ok(`${face} falls back to dominant siding at low confidence`, row?.area_source === 'fallback' && row?.confidence === 'low' && (row?.gross_sqft_by_material?.siding || 0) > 0, row, 'fallback siding');
  }
  ok('fill stays off for the recorded response unless asked', !measured.faces.right, measured.missing_faces, ['right']);

  const fromLive = measureFromPhotoAnalysis({
    photos: [{
      wall_face: 'front',
      eave_height_ft: 18,
      window_rows: 2,
      story_count: 2,
      sections: [{ material: 'siding', polygon: rect(0, 0, 1, 1) }],
    }],
    buildingWidthFt: 40,
    buildingLengthFt: 30,
  });
  ok('the live entry fills uncovered faces and remembers the flag', fromLive.missing_faces.length === 0 && fromLive.inputs.fillUncoveredFaces === true && fromLive.faces.left?.area_source === 'fallback', fromLive.missing_faces, []);
  ok('a filled face makes the house low confidence', fromLive.confidence === 'low' && (fromLive.warnings || []).length > 0, fromLive.confidence, 'low');

  const inferred = measureWallMaterialSections({
    photos: [{
      wall_face: 'back',
      eave_height_ft: 18,
      window_rows: 2,
      story_count: 2,
      confidence: 0.9,
      sections: [{ id: 'back-sid', material: 'siding', polygon: rect(0, 0, 1, 1) }],
      openings: [
        { type: 'window', width_ft: 4, height_ft: 5, material: 'stucco', pos_x: 10 },
        { type: 'door', width_ft: 3, height_ft: 7, material: 'stone', pos_x: 20 },
      ],
    }],
    faceLengthsFt: { back: 59.7 },
  });
  ok('a stucco opening forces stucco area', inferred.totals_gross_sqft.stucco >= 20 && inferred.materials_present.includes('stucco'), inferred.totals_gross_sqft, 'stucco >= 20');
  ok('a stone opening forces stone area', inferred.totals_gross_sqft.stone >= 21 && inferred.materials_present.includes('stone'), inferred.totals_gross_sqft.stone, '>= 21');
  ok('inferred material is low confidence and does not invent a full wall', inferred.faces.back.confidence === 'low' && inferred.totals_gross_sqft.stucco < 100, inferred.totals_gross_sqft.stucco, '< 100');

  const tiny = measureWallMaterialSections({
    photos: [{
      wall_face: 'right',
      eave_height_ft: 8,
      window_rows: 2,
      story_count: 2,
      confidence: 0.9,
      sections: [{ id: 'tiny', material: 'siding', polygon: rect(0, 0, 1, 1) }],
    }],
    faceLengthsFt: { right: 50 },
  });
  ok('a short wall on a 2-story house is flagged, not rewritten', tiny.faces.right.sanity_ok === false && tiny.faces.right.confidence === 'low' && near(tiny.faces.right.gross_sqft_by_material.siding, 400, 0.02), tiny.faces.right, 'flagged 400');
  const sane = measureWallMaterialSections({
    photos: [{
      wall_face: 'right',
      eave_height_ft: 19,
      window_rows: 2,
      story_count: 2,
      confidence: 0.9,
      sections: [{ id: 'sane', material: 'siding', polygon: rect(0, 0, 1, 1) }],
    }],
    faceLengthsFt: { right: 50 },
  });
  ok('a two-story eave is inside the area band', sane.faces.right.sanity_ok === true, sane.faces.right.area_ratio, 1);

  const merged = mergeVisionMaterialSamples([
    { material_shares: { siding: 10, stone: 90 }, eave_height_ft: 16, wall_face: 'left_side', openings: [{ type: 'window', width_ft: 3, height_ft: 4 }] },
    { material_shares: { siding: 80, stone: 20 }, eave_height_ft: 18, wall_face: 'left_side' },
    { material_shares: { siding: 70, stone: 30 }, eave_height_ft: 20, wall_face: 'right_side', openings: [{ type: 'window', width_ft: 9, height_ft: 9 }] },
  ]);
  ok('the median siding share stays 70, not the 10% outlier', Math.abs(merged.material_shares.siding - 70) < 0.1, merged.material_shares, 70);
  ok('discrete fields come from the read closest to the median', merged.openings?.[0]?.width_ft === 9 && merged.eave_height_ft === 18 && merged.wall_face === 'left', [merged.openings?.[0]?.width_ft, merged.eave_height_ft, merged.wall_face], [9, 18, 'left']);
  const derived = mergeVisionMaterialSamples([{
    wall_face: 'front',
    sections: [
      { material: 'siding', polygon: rect(0, 0, 1, 0.5) },
      { material: 'stucco', polygon: rect(0, 0.5, 1, 1) },
    ],
  }]);
  ok('omitted shares are derived from the polygons', derived.material_shares.siding > 40 && derived.material_shares.stucco > 40, derived.material_shares, 'about 50/50');

  ok('each live photo is sampled at temperature 0 and merged', plugin.includes('temperature: 0,') && plugin.includes('materialSampleCount') && plugin.includes('mergeVisionMaterialSamples('));
  ok('the rep warning is in the estimator', fs.readFileSync(path.join(__dirname, '../src/pages/AIEstimator.jsx'), 'utf8').includes('wall-material-confidence-warning'));
  ok('the compatibility copy asks for material shares', analyzer.includes('material_shares') && analyzer.includes('cementitious plaster') && analyzer.includes('mergeVisionMaterialSamples'));

  const stabilityEnv = { ...process.env };
  delete stabilityEnv.GOOGLE_GEMINI_API_KEY;
  delete stabilityEnv.GEMINI_API_KEY;
  const stability = spawnSync(process.execPath, [path.join(__dirname, 'run-siding-malec-stability.cjs')], {
    env: stabilityEnv,
    encoding: 'utf8',
  });
  ok('the stability script exits 0 without a Gemini key', stability.status === 0 && /NO GEMINI KEY/.test(stability.stdout || ''), stability.status, 0);

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
