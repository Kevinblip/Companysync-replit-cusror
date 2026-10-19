#!/usr/bin/env node
/**
 * test-siding-photo-hero-and-banks.cjs
 *
 * Guards three contracts introduced with the "Grade B siding + PhotoPresent" work:
 *
 *   1. PHOTO WALL PRISM. Photo elevations supply height, gables and openings.
 *      Wall lengths stay on the footprint edges. A photo width more than 15%
 *      off its edge falls back, and a photo-width sum more than 15% off the
 *      traced perimeter is flagged. Four photo widths never replace a longer
 *      footprint.
 *
 *   2. MULLION BANKS ARE COUNTING-ONLY. Banking adjacent windows changes
 *      window_assemblies and nothing else — opening groups, components, the
 *      deduction and the trim geometry must be byte-identical.
 *
 *   3. BANNER / PHOTO-PRESENT HONESTY. The provenance line may only claim photo
 *      calibration when the photos actually drove the wall area, and
 *      PhotoPresent may only show a face-assigned elevation.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failed++; console.log(`  \u2717 ${name}${extra !== undefined ? ' \u2014 ' + JSON.stringify(extra) : ''}`); }
}

(async () => {
  const { buildSidingMeasurementGraph } = await import(
    'file://' + path.join(ROOT, 'functions', 'utils', 'sidingMeasurementGraph.js')
  );

  // A plain 30 x 20 two-storey box: perimeter 100 LF, 18 ft walls => 1800 sqft.
  const HT = 18;
  const face = (wall_face, wall_width_ft, openings = [], extra = {}) => ({
    wall_face, view_label: wall_face, wall_width_ft,
    wall_height_ft: HT, eave_height_ft: HT, story_count: 2, openings, ...extra,
  });
  const win = (n, over = {}) => Array.from({ length: n }, () => ({ type: 'window', width_ft: 3, height_ft: 5, ...over }));

  const run = (perPhotoResults, over = {}) => buildSidingMeasurementGraph({
    perPhotoResults, storyCount: 2, wallHeightFt: HT,
    grossWallAreaSqft: 100 * HT, perimeterFt: 100,
    buildingWidthFt: 30, buildingLengthFt: 20,
    footprintSource: 'solar', smallOpeningsInWaste: false,
    ...over,
  });

  const ALL_FOUR = [
    face('front', 30, win(4)), face('back', 30, win(4)),
    face('left_side', 20, win(3)), face('right_side', 20, win(3)),
  ];

  console.log('\n\u2500\u2500 1. Photo wall prism gating \u2500\u2500');
  {
    const t = run(ALL_FOUR).totals;
    check('four measured faces matching the footprint become the hero',
      t.gross_wall_area_source === 'photo_anchored_footprint'
        && t.photo_overrides_footprint === false
        && t.wall_total_quality === 'measured', t);
    check('the extrusion is still reported for the cross-check',
      t.extrusion_wall_area_sqft === 1800, t);
    check('the hero equals the measured prism, not the extrusion',
      t.gross_wall_area_sqft === t.photo_wall_area_sqft, t);
  }
  {
    const fullPlane = run(
      ALL_FOUR.map(result => ({
        ...result,
        story_count: 2,
        wall_height_ft: 22,
        eave_height_ft: 22,
        height_semantics: 'full_elevation',
      })),
      { wallHeightFt: 22, grossWallAreaSqft: 2200, wallHeightSemantics: 'full_elevation', storiesMultiplier: 1 },
    );
    check('a 22 ft full-plane height is not multiplied by the 2-story chip',
      fullPlane.totals.photo_wall_area_sqft === 2200
        && fullPlane.totals.photo_wall_area_sqft !== 4400,
      fullPlane.totals);
    check('full-plane graph metadata records a ×1 stories multiplier',
      fullPlane.totals.wall_height_semantics === 'full_elevation'
        && fullPlane.totals.stories_multiplier === 1,
      fullPlane.totals);
  }
  {
    // Only two faces photographed — below the three-face floor.
    const t = run([face('front', 30, win(4)), face('back', 30, win(4))]).totals;
    check('two measured faces refine those walls and leave the others on the footprint',
      t.gross_wall_area_source === 'photo_anchored_footprint'
        && t.wall_total_quality === 'estimated'
        && t.photo_substituted_faces.includes('left_side')
        && t.photo_substituted_faces.includes('right_side'), t);
    check('a partial prism is reported and stays estimated',
      t.photo_wall_area_sqft > 0
        && t.photo_wall_area_usable === true
        && t.wall_total_quality === 'estimated', t);
  }
  {
    // Three faces measured, the fourth substituted from the footprint. The
    // substituted width fills the prism but is footprint arithmetic, so it can
    // never certify photo coverage — 80 of 100 measured LF must be rejected.
    const t = run([face('front', 30, win(4)), face('back', 30, win(4)), face('left_side', 20, win(3))]).totals;
    check('a hybrid prism keeps the unphotographed wall on the footprint',
      t.gross_wall_area_source === 'photo_anchored_footprint'
        && t.wall_total_quality === 'estimated', t);
    check('the substituted face is disclosed, not hidden',
      Array.isArray(t.photo_substituted_faces) && t.photo_substituted_faces.includes('right_side'), t);
    check('coverage is measured against photos only, not the hybrid prism',
      Math.abs(t.photo_measured_perimeter_coverage - 0.8) < 0.01,
      t.photo_measured_perimeter_coverage);
  }
  {
    // A negligible unmeasured remainder (1 ft of a 101 LF footprint) still
    // clears the 98% floor — the gate is about coverage, not face count.
    const t = run(ALL_FOUR, { grossWallAreaSqft: 101 * HT, perimeterFt: 101 }).totals;
    check('a negligible unmeasured remainder still clears the coverage floor',
      t.gross_wall_area_source === 'photo_anchored_footprint'
        && t.photo_perimeter_flagged === false
        && t.wall_total_quality === 'measured', t.photo_measured_perimeter_coverage);
  }
  {
    // Wings: four elevations still bill the photo prism and flag the mismatch.
    const t = run(ALL_FOUR, { grossWallAreaSqft: 160 * HT, perimeterFt: 160 }).totals;
    check('four elevations keep a longer footprint and flag the photo-width gap',
      t.gross_wall_area_source === 'photo_anchored_footprint'
        && t.photo_overrides_footprint === false
        && t.photo_perimeter_flagged === true
        && t.gross_wall_area_sqft === 160 * HT
        && t.sanity_review_required === true,
      t);
  }
  {
    // Prism materially larger than the extrusion. Photos still win; the delta is flagged.
    const t = run(ALL_FOUR, { grossWallAreaSqft: 80 * HT, perimeterFt: 80 }).totals;
    check('four elevations cannot outgrow an undersized footprint',
      t.gross_wall_area_source === 'photo_anchored_footprint'
        && t.photo_overrides_footprint === false
        && t.gross_wall_area_sqft === 80 * HT
        && t.photo_perimeter_flagged === true,
      t);
  }
  {
    const t = run(ALL_FOUR, { grossWallAreaSqft: 70 * HT, perimeterFt: 70 }).totals;
    check('a photo-width sum more than 15% off the perimeter requires review',
      t.sanity_review_required === true
        && t.photo_perimeter_flagged === true
        && t.photo_perimeter_deviation_pct > 15
        && t.gross_wall_area_source === 'photo_anchored_footprint'
        && t.photo_overrides_footprint === false,
      t);
  }
  {
    // No footprint perimeter. Four elevations are still the measurement.
    const t = run(ALL_FOUR, { perimeterFt: 0 }).totals;
    check('four elevations anchor to the footprint edges when the perimeter is missing',
      t.gross_wall_area_source === 'photo_anchored_footprint'
        && t.wall_total_quality === 'measured'
        && t.gross_wall_area_sqft === 100 * HT,
      t);
  }
  {
    const t = run([
      face('front', 30, win(4)),
      face('back', 30, win(4)),
      face('left_side', 20, win(3)),
      face('right_side', 20, win(3), { elevation_poor: true, occluded: true }),
    ]).totals;
    check('a poor elevation falls back on that wall and the total stays estimated',
      t.wall_total_quality === 'estimated'
        && Array.isArray(t.poor_faces)
        && t.poor_faces.includes('right_side')
        && t.gross_wall_area_source === 'photo_anchored_footprint'
        && t.photo_substituted_faces.includes('right_side'),
      t);
  }
  {
    const t = run(ALL_FOUR).totals;
    check('sanity delta is reported when the two derivations are independent',
      typeof t.sanity_delta_pct === 'number', t);
    const e = run(ALL_FOUR, { perimeterFt: 0 }).totals;
    check('sanity delta still cross-checks the photo total against the extrusion',
      e.sanity_delta_pct === 0 && e.within_sanity_band === true, e);
  }
  {
    // A gable end bills as a triangle, not as a second rectangle.
    const flat = run([face('front', 30, win(4)), face('back', 30, win(4)),
      face('left_side', 20, win(3)), face('right_side', 20, win(3))]).totals;
    const gabled = run([
      face('front', 30, win(4)), face('back', 30, win(4)),
      face('left_side', 20, win(3), { gable_rise_ft: 6, has_gable_end: true }),
      face('right_side', 20, win(3), { gable_rise_ft: 6, has_gable_end: true }),
    ], { grossWallAreaSqft: 100 * HT + 120, perimeterFt: 100 }).totals;
    // Two 20 ft gables at 6 ft rise = 2 x (0.5 x 20 x 6) = 120 sqft.
    check('a gable adds exactly half its bounding rectangle',
      Math.abs((gabled.photo_wall_area_sqft - flat.photo_wall_area_sqft) - 120) < 0.5,
      { flat: flat.photo_wall_area_sqft, gabled: gabled.photo_wall_area_sqft });
  }
  {
    // Satellite assumed every wall was a full 18 ft. Photos show the sides
    // are one storey. Lengths stay on the 40×30 footprint.
    const partial = run([
      face('front', 40, win(2), { eave_height_ft: 18, wall_height_ft: 18 }),
      face('back', 40, win(2), { eave_height_ft: 18, wall_height_ft: 18 }),
      face('left_side', 30, win(1), { eave_height_ft: 9, wall_height_ft: 9 }),
      face('right_side', 30, win(1), { eave_height_ft: 9, wall_height_ft: 9 }),
    ], { buildingWidthFt: 40, buildingLengthFt: 30, perimeterFt: 140, grossWallAreaSqft: 140 * HT }).totals;
    const satellite = 140 * HT;
    const photoTruth = 40 * 18 * 2 + 30 * 9 * 2;
    check('partial-height photos beat a full-height satellite extrusion',
      partial.gross_wall_area_sqft === photoTruth
        && partial.gross_wall_area_sqft < satellite
        && partial.photo_overrides_footprint === false,
      { photo: partial.gross_wall_area_sqft, satellite, photoTruth });
  }
  {
    // A bad front width (25% over the footprint edge) falls back that wall.
    // The other walls keep their photo heights. The traced perimeter is kept.
    const scaled = run([
      face('front', 70, win(2), { eave_height_ft: 12, wall_height_ft: 12 }),
      face('back', 40, win(2)),
      face('left_side', 30, win(1)),
      face('right_side', 30, win(1)),
    ], { buildingWidthFt: 40, buildingLengthFt: 30, perimeterFt: 140, grossWallAreaSqft: 140 * HT }).totals;
    check('a photo width more than 15% off its edge falls back that wall only',
      scaled.photo_width_fallback_faces.includes('front')
        && !scaled.photo_width_fallback_faces.includes('back')
        && scaled.gross_wall_area_sqft === 140 * HT
        && scaled.photo_perimeter_flagged === true,
      scaled);
  }

  console.log('\n\u2500\u2500 2. Mullion banks are counting-only \u2500\u2500');
  {
    // Three same-height windows 0.5 ft apart on one wall = one mulled bank.
    const banked = run([
      face('front', 30, [
        { type: 'window', width_ft: 3, height_ft: 5, pos_x: 5,   pos_y: 6, position_unit: 'ft' },
        { type: 'window', width_ft: 3, height_ft: 5, pos_x: 8.5, pos_y: 6, position_unit: 'ft' },
        { type: 'window', width_ft: 3, height_ft: 5, pos_x: 12,  pos_y: 6, position_unit: 'ft' },
      ]),
      face('back', 30, win(2)), face('left_side', 20, win(1)), face('right_side', 20, win(1)),
    ]);
    check('a three-wide mull counts as ONE assembly',
      banked.counts.window_assemblies === 1 + 2 + 1 + 1, banked.counts);
    check('the merge is reported, not silent',
      banked.counts.window_mullion_merges === 2, banked.counts);
    check('rough openings are NOT collapsed',
      banked.counts.window_rough_openings === 3 + 2 + 1 + 1, banked.counts);
    check('assemblies can never exceed units',
      banked.counts.window_assemblies <= banked.counts.window_units, banked.counts);

    // Same three windows, but spaced 4 ft apart: three separate assemblies.
    const spaced = run([
      face('front', 30, [
        { type: 'window', width_ft: 3, height_ft: 5, pos_x: 5,  pos_y: 6, position_unit: 'ft' },
        { type: 'window', width_ft: 3, height_ft: 5, pos_x: 12, pos_y: 6, position_unit: 'ft' },
        { type: 'window', width_ft: 3, height_ft: 5, pos_x: 19, pos_y: 6, position_unit: 'ft' },
      ]),
      face('back', 30, win(2)), face('left_side', 20, win(1)), face('right_side', 20, win(1)),
    ]);
    check('separated windows are never merged',
      spaced.counts.window_assemblies === 3 + 2 + 1 + 1, spaced.counts);
    check('banking changes counts only — the deduction is untouched',
      banked.totals.opening_deduction_sqft === spaced.totals.opening_deduction_sqft,
      { banked: banked.totals.opening_deduction_sqft, spaced: spaced.totals.opening_deduction_sqft });
    check('banking changes counts only — net siding is untouched',
      banked.totals.net_siding_area_sqft === spaced.totals.net_siding_area_sqft,
      { banked: banked.totals.net_siding_area_sqft, spaced: spaced.totals.net_siding_area_sqft });
    check('banking changes counts only — J-channel LF is untouched',
      JSON.stringify(banked.trim) === JSON.stringify(spaced.trim));

    // Windows at different heights side by side are different assemblies.
    const mixed = run([
      face('front', 30, [
        { type: 'window', width_ft: 3, height_ft: 5, pos_x: 5,   pos_y: 6, position_unit: 'ft' },
        { type: 'window', width_ft: 3, height_ft: 2, pos_x: 8.5, pos_y: 6, position_unit: 'ft' },
      ]),
      face('back', 30, win(1)), face('left_side', 20, win(1)), face('right_side', 20, win(1)),
    ]);
    check('a transom of a different height is not banked with its neighbour',
      mixed.counts.window_assemblies === 2 + 1 + 1 + 1, mixed.counts);
  }
  {
    // Count-only synthetic openings share identical default geometry and must
    // never be banked — that would silently divide reported window counts.
    const synthetic = run([
      { wall_face: 'front', view_label: 'front', wall_width_ft: 30, wall_height_ft: HT, eave_height_ft: HT, story_count: 2, windows_count: 6 },
      { wall_face: 'back', view_label: 'back', wall_width_ft: 30, wall_height_ft: HT, eave_height_ft: HT, story_count: 2, windows_count: 4 },
      { wall_face: 'left_side', view_label: 'left_side', wall_width_ft: 20, wall_height_ft: HT, eave_height_ft: HT, story_count: 2, windows_count: 2 },
      { wall_face: 'right_side', view_label: 'right_side', wall_width_ft: 20, wall_height_ft: HT, eave_height_ft: HT, story_count: 2, windows_count: 2 },
    ]);
    check('synthetic count-based openings are never banked',
      synthetic.counts.window_assemblies === 14, synthetic.counts);
    check('no phantom merges are reported for count-only evidence',
      synthetic.counts.window_mullion_merges === 0, synthetic.counts);
  }

  console.log('\n\u2500\u2500 3. Banner + PhotoPresent honesty \u2500\u2500');
  {
    // src/ modules use extensionless '@/'-style relative imports, so bundle
    // before importing rather than relying on Node's ESM resolver.
    const fs = require('fs');
    const os = require('os');
    const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
    const out = path.join(os.tmpdir(), `presreadiness-${Date.now()}.mjs`);
    esbuild.buildSync({
      entryPoints: [path.join(ROOT, 'src', 'utils', 'presentationReadiness.js')],
      bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
    });
    const { describeWallAreaProvenance, getPhotoPresentPlan } = await import('file://' + out);
    fs.unlinkSync(out);

    const photoGraph = run(ALL_FOUR);
    const photoJob = { measurement_graph: photoGraph, wall_area_sqft: 1500, confidence_grade: 'B', tolerance_pct: 15 };
    const extrusionJob = {
      measurement_graph: run([
        face('front', 30, win(4), { elevation_poor: true, occluded: true }),
        face('back', 30, win(4), { elevation_poor: true, occluded: true }),
      ]),
      wall_area_sqft: 1500,
    };

    const p1 = describeWallAreaProvenance(photoJob);
    const p2 = describeWallAreaProvenance(extrusionJob);
    check('a photo hero is described as photo-measured', p1.photoCalibrated === true, p1);
    check('an extrusion hero is NOT described as photo-measured', p2.photoCalibrated === false, p2);
    check('the extrusion line says photos only supplied opening counts',
      /opening count/i.test(p2.detail), p2);
    check('no provenance line asserts satellite imagery it cannot verify',
      !/satellite/i.test(p1.detail + p1.headline + p2.detail + p2.headline), { p1, p2 });

    const withElevation = getPhotoPresentPlan({
      measurements: photoJob,
      photos: [{ url: 'x://detail.jpg', label: 'Damage detail' }, { url: 'x://front.jpg', label: 'Front' }],
    });
    check('PhotoPresent picks the face-assigned elevation over a detail shot',
      withElevation.available === true && withElevation.photo.url === 'x://front.jpg', withElevation.photo);
    check('PhotoPresent surfaces the provenance banner',
      typeof withElevation.banner === 'string' && withElevation.banner.length > 0);

    const detailOnly = getPhotoPresentPlan({
      measurements: photoJob,
      photos: [{ url: 'x://detail.jpg', label: 'Damage detail' }, { url: 'x://misc.jpg' }],
    });
    check('PhotoPresent refuses to present an unidentified photo',
      detailOnly.available === false, detailOnly);
    check('no photos at all means no PhotoPresent',
      getPhotoPresentPlan({ measurements: photoJob, photos: [] }).available === false);
  }

  console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(`${passed + failed} checks \u2014 ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('\u274c FAILED'); process.exit(1); }
  console.log('\u2705 Photo prism gated, banks count-only, provenance honest');
})().catch(err => { console.error(err); process.exit(1); });
