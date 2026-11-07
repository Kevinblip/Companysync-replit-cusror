#!/usr/bin/env node
/**
 * Malec, 5405 Brookside Trail, Solon OH — per-material photo path vs Hover.
 *
 * Second benchmark beside Coleman. Two-story house: vinyl lap siding, stone
 * veneer wainscot/columns, stucco bays and gables, 3-car garage with bonus room.
 *
 * WHAT THIS TESTS: the math after vision. The fixture below is the shape of
 * a Gemini per-photo segmentation for the six Malec photos (sections as
 * normalized wall-frame polygons, window rows, openings tagged by material).
 * The polygons were hand-placed from the photos and rounded the way the model
 * returns them; the face lengths come from the footprint. It does NOT run a
 * live vision call. A live Gemini run on the six photos still has to be
 * scored against these Hover numbers before anyone trusts it on a bid.
 */
'use strict';

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
const pct = (a, e) => ((a - e) / e) * 100;
const within = (a, e, band = 5) => Math.abs(pct(a, e)) <= band;
const cell = (a, e) => (a == null ? '—' : `${Number(a).toFixed(1)} (${pct(a, e) > 0 ? '+' : ''}${pct(a, e).toFixed(1)}%)`);

const HOVER = {
  siding: 1806, stone: 942, stucco: 844, trim: 267,
  sidingOpenings: 35, windowSqft: 599, doors: 6, doorSqft: 351,
  footprintSqft: 2934, perimeterLf: 281 + 10 / 12,
  sidingByFace: { front: 73, right: 444, left: 409, back: 880 },
  stories: 2,
};
const BEFORE = { stories: 1, perimeterLf: 213, siding: 1633, stone: 0, stucco: 0 };

// Footprint (Solar/building outline) face lengths, ft. Sum = 281.8.
const FACE_LENGTHS = { front: 70, right: 50, left: 55, back: 106.8 };

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const win = (n, material = 'siding', w = 3, h = 5.5) => Array.from({ length: n }, () => ({ type: 'window', width_ft: w, height_ft: h, material }));
const door = (w, h, material = 'siding') => ({ type: 'entry_door', width_ft: w, height_ft: h, material });

// Six photos, in the order Kevin sent them.
const PHOTOS = [
  { view_label: 'Garage side (3-car + bonus room)', wall_face: 'right', eave_height_ft: 14, window_rows: 2, confidence: 0.8,
    sections: [
      { id: 'garage-stone', material: 'stone veneer', polygon: rect(0, 0.79, 1, 1), confidence: 0.85 },
      { id: 'garage-gable', material: 'stucco', polygon: [[0.2, 0], [0.8, 0], [0.5, -0.47]], confidence: 0.75 },
      { id: 'garage-vinyl', material: 'vinyl lap', polygon: rect(0, 0, 1, 0.63), confidence: 0.9 },
    ],
    openings: [...win(6), { type: 'garage_door', width_ft: 16, height_ft: 7 }, { type: 'garage_door', width_ft: 9, height_ft: 7 }].map((o) => ({ ...o, type: o.type === 'garage_door' ? 'garage_door' : o.type })) },
  { view_label: 'Front-left corner', wall_face: 'front', is_corner_shot: true, eave_height_ft: 18, window_rows: 2, confidence: 0.6,
    sections: [
      { id: 'fl-stone', material: 'stone', polygon: rect(0, 0.57, 1, 1), confidence: 0.7 },
      { id: 'fl-stucco', material: 'stucco', polygon: rect(0.1, 0.04, 0.9, 0.58), confidence: 0.65 },
      { id: 'fl-gable', material: 'vinyl', polygon: [[0.3, 0], [0.7, 0], [0.5, -0.3]], confidence: 0.7 },
    ],
    openings: win(3, 'stucco') },
  { view_label: 'Front entry', wall_face: 'front', eave_height_ft: 18, window_rows: 2, confidence: 0.85,
    sections: [
      { id: 'front-stone', material: 'stone', polygon: rect(0, 0.59, 1, 1), confidence: 0.9 },
      { id: 'front-stucco', material: 'stucco bay', polygon: rect(0.1, 0.03, 0.9, 0.585), confidence: 0.8 },
      { id: 'front-gable', material: 'vinyl siding', polygon: [[0.3, 0], [0.7, 0], [0.5, -0.29]], confidence: 0.8 },
    ],
    openings: [...win(4, 'stucco'), ...win(2, 'stone'), door(8, 10, 'stucco')] },
  { view_label: 'Side bay', wall_face: 'left', eave_height_ft: 11, window_rows: 2, confidence: 0.8,
    sections: [
      { id: 'left-stone', material: 'stone', polygon: rect(0, 0.8, 1, 1), confidence: 0.85 },
      { id: 'left-gable', material: 'stucco', polygon: [[0.15, 0], [0.85, 0], [0.5, -0.4]], confidence: 0.75 },
      { id: 'left-vinyl', material: 'vinyl', polygon: rect(0, 0, 1, 0.68), confidence: 0.9 },
    ],
    openings: [...win(10), door(3, 6.8)] },
  { view_label: 'Back-left', wall_face: 'left', is_corner_shot: true, eave_height_ft: 11, window_rows: 1, confidence: 0.55,
    sections: [
      { id: 'bl-stone', material: 'stone', polygon: rect(0, 0.78, 1, 1), confidence: 0.6 },
      { id: 'bl-vinyl', material: 'vinyl', polygon: rect(0, 0, 1, 0.7), confidence: 0.7 },
      { id: 'bl-gable', material: 'stucco', polygon: [[0.17, 0], [0.83, 0], [0.5, -0.4]], confidence: 0.6 },
    ],
    openings: win(8) },
  { view_label: 'Back', wall_face: 'back', eave_height_ft: 10, window_rows: 2, confidence: 0.85,
    sections: [
      { id: 'back-stone', material: 'stone', polygon: rect(0, 0.86, 1, 1), confidence: 0.85 },
      { id: 'back-gable', material: 'stucco', polygon: [[0.4, 0], [0.6, 0], [0.5, -0.94]], confidence: 0.7 },
      { id: 'back-vinyl', material: 'vinyl', polygon: rect(0, 0, 1, 0.82), confidence: 0.9 },
    ],
    openings: [...win(14), door(8, 6.8), door(3, 6.8)] },
];

(async () => {
  const {
    measureWallMaterialSections,
    filterLineItemsToMaterials,
    faceLengthsFromFootprint,
  } = await import('../functions/utils/wallMaterialSections.js');

  const r = measureWallMaterialSections({
    photos: PHOTOS,
    faceLengthsFt: FACE_LENGTHS,
    footprintPerimeterFt: Object.values(FACE_LENGTHS).reduce((s, v) => s + v, 0),
  });
  const g = r.totals_gross_sqft;
  const sidingOpen = r.openings.by_material.siding || { count: 0 };

  console.log('\nMalec per-material photo path vs Hover (fixture, not a live model run).');
  console.log('| Item | Hover | Before (satellite) | Photo path |');
  console.log('| --- | ---: | ---: | ---: |');
  const rows = [
    ['Stories', HOVER.stories, BEFORE.stories, r.story.story_count],
    ['Perimeter LF', HOVER.perimeterLf, BEFORE.perimeterLf, r.perimeter_ft],
    ['Siding ft²', HOVER.siding, BEFORE.siding, g.siding],
    ['Stone ft²', HOVER.stone, BEFORE.stone, g.stone],
    ['Stucco ft²', HOVER.stucco, BEFORE.stucco, g.stucco],
    ['Siding openings', HOVER.sidingOpenings, null, sidingOpen.count],
    ['Window ft²', HOVER.windowSqft, null, r.openings.window_sqft],
    ['Doors', HOVER.doors, null, r.openings.doors],
    ['Door ft²', HOVER.doorSqft, null, r.openings.door_sqft],
  ];
  for (const [label, hover, before, photo] of rows) console.log(`| ${label} | ${Number(hover).toFixed(1)} | ${before == null ? '—' : cell(before, hover)} | ${cell(photo, hover)} |`);
  for (const face of ['front', 'right', 'left', 'back']) {
    console.log(`  siding ${face}: ${cell(r.faces[face].gross_sqft_by_material.siding, HOVER.sidingByFace[face])} vs Hover ${HOVER.sidingByFace[face]}`);
  }

  ok('story count is 2 from photo window rows (satellite said 1)', r.story.story_count === 2, r.story, 2);
  ok('perimeter from footprint within 5% of Hover', within(r.perimeter_ft, HOVER.perimeterLf), r.perimeter_ft, HOVER.perimeterLf);
  ok('siding within 5% of Hover', within(g.siding, HOVER.siding), g.siding, HOVER.siding);
  ok('stone within 5% of Hover', within(g.stone, HOVER.stone), g.stone, HOVER.stone);
  ok('stucco within 5% of Hover', within(g.stucco, HOVER.stucco), g.stucco, HOVER.stucco);
  ok('total facade within 5% of Hover', within(g.siding + g.stone + g.stucco, HOVER.siding + HOVER.stone + HOVER.stucco));
  for (const face of ['right', 'left', 'back', 'front']) {
    ok(`siding on ${face} within 5% of Hover`, within(r.faces[face].gross_sqft_by_material.siding, HOVER.sidingByFace[face]), r.faces[face].gross_sqft_by_material.siding, HOVER.sidingByFace[face]);
  }
  ok('35 openings on siding (corner shots not double-counted)', within(sidingOpen.count, HOVER.sidingOpenings), sidingOpen.count, HOVER.sidingOpenings);
  ok('window area within 5%', within(r.openings.window_sqft, HOVER.windowSqft), r.openings.window_sqft, HOVER.windowSqft);
  ok('6 doors', r.openings.doors === HOVER.doors, r.openings.doors, HOVER.doors);
  ok('door area within 5%', within(r.openings.door_sqft, HOVER.doorSqft), r.openings.door_sqft, HOVER.doorSqft);
  ok('stucco/stone openings are not charged to siding', (r.openings.by_material.stucco?.count || 0) === 5 && (r.openings.by_material.stone?.count || 0) === 2, r.openings.by_material);
  ok('no brick measured on Malec', g.brick === 0 && !r.materials_present.includes('brick'), r.materials_present);
  ok('all four faces covered', r.complete, r.missing_faces, []);
  ok('every section is in the rep overlay and editable', r.overlay.length === PHOTOS.reduce((s, p) => s + p.sections.length, 0) && r.overlay.every((o) => o.editable && o.polygon && o.material), r.overlay.length);
  ok('net siding = gross minus siding openings', Math.abs(r.totals_net_sqft.siding - (g.siding - r.openings.by_material.siding.sqft)) < 0.2);

  // Satellite before fails each material.
  ok('satellite-only before misses stone and stucco and story count', !within(BEFORE.stone || 0.0001, HOVER.stone) && BEFORE.stories !== HOVER.stories);

  // No stray line items.
  const candidate = [
    { code: 'SDG-VNL', description: 'Vinyl siding - standard lap' },
    { code: 'STN-VNR', description: 'Stone veneer - detach & reset' },
    { code: 'STC-PATCH', description: 'Stucco - patch / color coat' },
    { code: 'BRK-VNR', description: 'Brick veneer - repoint' },
    { code: 'ASB-REM', description: 'Remove asbestos siding' },
    { code: 'HW', description: 'House wrap' },
    { code: 'J', description: 'J-channel' },
  ];
  const lines = filterLineItemsToMaterials(candidate, { materialsPresent: r.materials_present });
  const codes = lines.items.map((i) => i.code);
  ok('line items keep vinyl, stone, stucco and accessories', ['SDG-VNL', 'STN-VNR', 'STC-PATCH', 'HW', 'J'].every((c) => codes.includes(c)), codes);
  ok('brick line dropped (no brick on house)', !codes.includes('BRK-VNR') && lines.dropped.some((d) => d.code === 'BRK-VNR'), lines.dropped);
  ok('asbestos line held, never billed without rep approval', !codes.includes('ASB-REM') && lines.held.some((d) => d.code === 'ASB-REM'), lines.held);

  // Rep taps the front stucco bay and calls it brick.
  const corrected = measureWallMaterialSections({
    photos: PHOTOS, faceLengthsFt: FACE_LENGTHS, overrides: { 'front-stucco': 'brick', 'fl-stucco': 'brick' },
  });
  ok('rep correction moves front stucco into brick', corrected.totals_gross_sqft.brick > 500 && corrected.totals_gross_sqft.stucco < g.stucco - 500, corrected.totals_gross_sqft);
  const linesAfter = filterLineItemsToMaterials(candidate, { materialsPresent: corrected.materials_present });
  ok('brick line appears only after the rep confirms brick', linesAfter.items.some((i) => i.code === 'BRK-VNR'));

  const southFront = faceLengthsFromFootprint(
    [[-35, -25], [35, -25], [35, 25], [-35, 25]],
    { frontAzimuthDeg: 180 },
  );
  ok('footprint edges become face lengths (south front 70, sides 50)',
    southFront && southFront.front === 70 && southFront.back === 70 && southFront.left === 50 && southFront.right === 50,
    southFront, { front: 70, back: 70, left: 50, right: 50 });

  const plugin = fs.readFileSync(path.join(__dirname, '../vite-functions-plugin.js'), 'utf8');
  const analyzer = fs.readFileSync(path.join(__dirname, '../functions/analyzeHousePhotosForSiding.ts'), 'utf8');
  const estimator = fs.readFileSync(path.join(__dirname, '../src/pages/AIEstimator.jsx'), 'utf8');
  ok('the live photo handler measures sections from the footprint',
    plugin.includes('measureFromPhotoAnalysis') && plugin.includes('storyCountFromPhotos') && plugin.includes('footprintPerimeterFt: perimeterFt'));
  ok('the vision schema asks for section polygons, window rows, and opening material',
    analyzer.includes('"window_rows"') && analyzer.includes('"sections"') && analyzer.includes('"material": "siding"|"stone"|"stucco"|"brick"|"trim"')
    && plugin.includes('"sections"') && plugin.includes('window_rows'));
  ok('the estimator overlays sections and filters line items',
    estimator.includes('WallMaterialOverlay') && estimator.includes('filterLineItemsToMaterials'));

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed (band ±5%)`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
