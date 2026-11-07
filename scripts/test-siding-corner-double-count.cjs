#!/usr/bin/env node
/**
 * Regression: corner photos must not double-count openings.
 *
 * Real report — 103 Wandle Ave, Bedford OH. Seven photos were analyzed; four of
 * them are corner shots that overlap the flat elevations beside them. Gemini
 * returned COUNTS ONLY (no per-opening geometry), so the graph minted synthetic
 * openings with a distinct `synthetic_<type>_<photoIndex>_<i>` identity each.
 *
 * Two defects compounded:
 *   1. resolveWallFace() did not understand the uploader's corner abbreviations
 *      ("FR Corner"), so those photos resolved to `unknown` — a face where
 *      dedupe is disabled by design.
 *   2. Even on a known face, synthetic per-photo identities make
 *      isDuplicateObservation() return early (two non-null ids that differ), so
 *      counts summed instead of reconciling.
 *
 * Result: 23 windows / 4 doors instead of the ~14 / 2 the photos actually show.
 * Hover ground truth for this house is 3 doors, so 4-going-on-5 was over-count.
 * Over-counting openings over-deducts area and UNDER-bills the siding.
 */
const assert = require('assert');

let passed = 0, failed = 0;
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
};

(async () => {
  const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');

  // The exact photo set and per-photo counts from the 103 Wandle analysis.
  const WANDLE = [
    ['FR Corner', 5, 1], ['Right Side', 2, 0], ['BR Corner', 2, 1], ['Back', 3, 1],
    ['BL Corner', 2, 0], ['Left Side', 4, 0], ['FL Corner', 5, 1],
  ];
  const build = (photos, extra = {}) => buildSidingMeasurementGraph({
    perPhotoResults: photos.map(([view_label, windows_count, doors_count]) => ({
      view_label, windows_count, doors_count, garage_doors_count: 0, confidence: 90,
    })),
    storyCount: 2, wallHeightFt: 19.5, grossWallAreaSqft: 3840,
    perimeterFt: 180, buildingWidthFt: 32, buildingLengthFt: 55, ...extra,
  });

  console.log('\n103 Wandle — corner photos must reconcile, not accumulate');
  const g = build(WANDLE);
  const rawWindows = WANDLE.reduce((s, p) => s + p[1], 0); // 23
  const rawDoors   = WANDLE.reduce((s, p) => s + p[2], 0); // 4

  // Expected reconciliation, face by face (max(sum of flat photos, largest corner)):
  //   front      = corners only        → max(FR 5, FL 5)        =  5w, 1d
  //   back       = flat Back 3 vs corners max 2 → flat wins     =  3w, 1d
  //   right_side = flat Right Side                              =  2w, 0d
  //   left_side  = flat Left Side                               =  4w, 0d
  // Hover ground truth is 3 doors; we land on 2 because Gemini reported no door
  // on the left/right elevations at all. That residual is a DETECTION limit, not
  // a reconciliation bug — the point of this test is that 4 never becomes 5.
  ok('windows are not the raw sum across photos', g.counts.window_assemblies < rawWindows);
  ok('doors are not the raw sum across photos',   g.counts.entry_doors < rawDoors);
  ok('windows reconcile to exactly 14', g.counts.window_assemblies === 14);
  ok('doors reconcile to exactly 2',    g.counts.entry_doors === 2);
  ok('doors never exceed the Hover ground truth of 3', g.counts.entry_doors <= 3);
  ok('the collapse is reported, not silent',
     (g.diagnostics?.synthetic_counts_collapsed || 0) > 0);

  console.log('\nCorner labels resolve to a real face (dedupe is disabled on `unknown`)');
  const faces = new Set(g.opening_groups.map(o => o.face));
  ok('no opening is stranded on the unknown face', !faces.has('unknown'));
  ok('the front face is populated from its corner shots alone', faces.has('front'));
  ok('all four canonical faces are represented',
     ['front', 'back', 'left_side', 'right_side'].every(f => faces.has(f)));

  console.log('\nDistinct walls still add up (max() must not swallow real openings)');
  // Four flat elevations, no overlap: every window is a different wall.
  const flat = build([['Front', 3, 1], ['Back', 3, 1], ['Left Side', 2, 0], ['Right Side', 2, 0]]);
  ok('non-overlapping elevations sum normally', flat.counts.window_assemblies === 10);
  ok('doors on separate walls both survive', flat.counts.entry_doors === 2);

  console.log('\nTwo FLAT photos of one wide wall must ADD, not collapse');
  // A wall captured in two frames covering different halves. Treating these as
  // duplicates would delete real openings, under-deduct, and over-bill.
  const splitWall = build([['Front', 3, 1], ['Front', 3, 0]]);
  ok('split-wall flat photos sum instead of max()', splitWall.counts.window_assemblies === 6);

  console.log('\nA corner may RAISE a face count but never stack on top of it');
  const cornerSeesMore = build([['Back', 2, 0], ['BR Corner', 4, 0]]);
  ok('corner raises the face to what it saw', cornerSeesMore.counts.window_assemblies === 4);
  const cornerSeesFewer = build([['Back', 4, 0], ['BR Corner', 2, 0]]);
  ok('corner never adds on top of the flat photo', cornerSeesFewer.counts.window_assemblies === 4);

  console.log('\nTwo corners of one face reconcile (both are whole-wall obliques)');
  // Policy, pinned deliberately: the uploader offers ONE slot per corner, each a
  // whole-house oblique of the entire adjoining wall, so FL and FR are two angles
  // on the same front wall — not complementary halves to be summed.
  const twoCorners = build([['FL Corner', 5, 1], ['FR Corner', 5, 1]]);
  ok('complementary corner slots do not sum', twoCorners.counts.window_assemblies === 5);
  ok('the shared front door is counted once', twoCorners.counts.entry_doors === 1);

  console.log('\nFree-form Detail slots stay additive (unknown face)');
  const details = build([['Detail 1', 2, 0], ['Detail 2', 1, 0]]);
  ok('detail shots are never collapsed', details.counts.window_assemblies === 3);

  console.log('\nUnidentified photos stay additive (they may be different walls)');
  const unknown = build([['Photo 1', 2, 0], ['Photo 2', 3, 0]]);
  ok('unknown-face counts are not collapsed by max()', unknown.counts.window_assemblies === 5);

  console.log('\nReal per-opening geometry is untouched by the count-only path');
  const withGeometry = buildSidingMeasurementGraph({
    perPhotoResults: [
      { view_label: 'Front', openings: [
        { type: 'window', width_ft: 3, height_ft: 4, zone: 'far_left' },
        { type: 'window', width_ft: 3, height_ft: 4, zone: 'center' },
      ] },
      { view_label: 'FR Corner', openings: [
        // same two windows seen again from the corner → dedupe by zone+geometry
        { type: 'window', width_ft: 3, height_ft: 4, zone: 'far_left' },
        { type: 'window', width_ft: 3, height_ft: 4, zone: 'center' },
      ] },
    ],
    storyCount: 2, wallHeightFt: 19.5, grossWallAreaSqft: 3840, perimeterFt: 180,
  });
  ok('measured openings still dedupe across a corner overlap',
     withGeometry.counts.window_assemblies === 2);

  console.log('\nShifted corner zones must not add a second copy of the wall');
  const shifted = buildSidingMeasurementGraph({
    perPhotoResults: [
      { view_label: 'Front', openings: [
        { type: 'window', width_ft: 3, height_ft: 4, zone: 'far_left', pos_x: 4, pos_y: 5 },
        { type: 'window', width_ft: 3, height_ft: 4, zone: 'center', pos_x: 12, pos_y: 5 },
        { type: 'entry_door', width_ft: 3, height_ft: 6.8, zone: 'far_right', pos_x: 20, pos_y: 3.4 },
      ] },
      { view_label: 'FR Corner', is_corner_shot: true, openings: [
        { type: 'window', width_ft: 4.4, height_ft: 5.2, zone: 'center_right', pos_x: 6, pos_y: 6 },
        { type: 'window', width_ft: 4.2, height_ft: 5.1, zone: 'far_left', pos_x: 14, pos_y: 6 },
        { type: 'entry_door', width_ft: 3.6, height_ft: 7, zone: 'center', pos_x: 18, pos_y: 3.5 },
      ] },
    ],
    storyCount: 1, wallHeightFt: 9, grossWallAreaSqft: 1000, perimeterFt: 100,
  });
  ok('a corner with different zones does not double the windows',
     shifted.counts.window_assemblies === 2);
  ok('a corner with a different zone does not double the door',
     shifted.counts.entry_doors === 1);
  ok('the dropped corner copies are reported',
     (shifted.diagnostics?.measured_corner_collapsed || 0) >= 3);

  const cornerSeesMoreMeasured = buildSidingMeasurementGraph({
    perPhotoResults: [
      { view_label: 'Back', openings: [
        { type: 'window', width_ft: 3, height_ft: 4, zone: 'far_left', pos_x: 4, pos_y: 5 },
      ] },
      { view_label: 'BR Corner', is_corner_shot: true, openings: [
        { type: 'window', width_ft: 3, height_ft: 4, zone: 'far_left', pos_x: 4, pos_y: 5 },
        { type: 'window', width_ft: 6, height_ft: 4, zone: 'far_right', pos_x: 16, pos_y: 5 },
      ] },
    ],
    storyCount: 1, wallHeightFt: 9, grossWallAreaSqft: 1000, perimeterFt: 100,
  });
  ok('a corner that sees an extra window still adds that window',
     cornerSeesMoreMeasured.counts.window_assemblies === 2);

  console.log('\nDistinct openings in one coarse zone must all survive');
  const sameZone = buildSidingMeasurementGraph({
    perPhotoResults: [{
      view_label: 'Front',
      openings: [
        { observation_id: 'front_w1', type: 'window', zone: 'center', pos_x: 12, pos_y: 4, width_ft: 2, height_ft: 3, unit_count: 1 },
        { observation_id: 'front_w2', type: 'window', zone: 'center', pos_x: 15, pos_y: 4, width_ft: 2, height_ft: 3, unit_count: 1 },
        { observation_id: 'front_w3', type: 'window', zone: 'center', pos_x: 18, pos_y: 4, width_ft: 2, height_ft: 3, unit_count: 1 },
        { observation_id: 'front_d1', type: 'entry_door', zone: 'center', pos_x: 20, pos_y: 3.4, width_ft: 3, height_ft: 6.8 },
      ],
    }],
    storyCount: 1, wallHeightFt: 10, grossWallAreaSqft: 1000, perimeterFt: 100,
  });
  ok('three same-zone windows remain three assemblies',
     sameZone.counts.window_assemblies === 3);
  ok('same-zone door is not merged with windows',
     sameZone.counts.entry_doors === 1);

  console.log('\nSummary counts and elevation opening inventory stay in lockstep');
  const { resolveOpeningCounts } = await import('../src/utils/openingCounts.js');
  const responseShape = {
    window_assemblies_count: sameZone.counts.window_assemblies,
    windows_count: sameZone.counts.windows_count,
    window_units_count: sameZone.counts.window_units,
    doors_count: sameZone.counts.entry_doors,
    garage_door_count: sameZone.counts.garage_doors,
    shutter_panel_count: 0,
    measurement_graph: sameZone,
    openings_detail: sameZone.opening_groups,
  };
  const summary = resolveOpeningCounts(responseShape);
  const drawn = sameZone.opening_groups.reduce((counts, opening) => {
    counts[opening.type] = (counts[opening.type] || 0) + 1;
    return counts;
  }, {});
  ok('summary windows equal drawn window openings',
     summary.windows === drawn.window);
  ok('summary entry doors equal drawn entry-door openings',
     summary.doors === drawn.entry_door);
  ok('summary garage doors equal drawn garage-door openings',
     summary.garageDoors === (drawn.garage_door || 0));

  console.log('\nShutters: individual panels count, not just complete pairs');
  const { processShutters } = await import('../src/utils/companySyncFormulas.js');
  const singles = processShutters([
    { id: 'w1', widthInches: 36, heightInches: 48, hasLeftShutter: true,  hasRightShutter: false },
    { id: 'w2', widthInches: 36, heightInches: 48, hasLeftShutter: true,  hasRightShutter: true  },
  ]);
  ok('a lone shutter panel is counted', singles.shutter_panel_count === 3);
  ok('complete pairs are still reported separately', singles.shutter_pair_count === 1);
  ok('a lone shutter contributes square footage', singles.shutter_total_sqft > 0);
  ok('every shuttered window reaches the inventory', singles.shutter_inventory.length === 2);

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
