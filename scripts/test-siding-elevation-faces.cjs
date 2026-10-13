#!/usr/bin/env node
/**
 * Elevation face-binding guards (no server needed).
 *
 * Regression cover for the bug where EVERY elevation rendered
 * "NOT PHOTOGRAPHED — ESTIMATED" as a generic box even when the walls were
 * photographed. Two independent faults produced it:
 *
 *  1. Payload drift — the analyzer emits a rich `faces` array, but the local
 *     analysis path only emits the measurement graph's `wall_facets`. The
 *     drawing builder read `sd.faces` exclusively, so on that path it saw no
 *     face records at all: `photographed` was structurally false and every
 *     per-face width/height fell back to the global building box.
 *  2. Face-token vocabularies disagree on the side walls. The analyzer says
 *     `left` / `right`; the measurement graph (wall_facets, missing_faces,
 *     opening.wall_face) says `left_side` / `right_side`. Compared raw, side
 *     walls never matched — so side openings were dropped from the drawings
 *     and missing-face coverage never fired for a side.
 *
 * Also guards that per-face dimensions prefer flat photos over corner shots.
 */
async function main() {
  const { buildElevationModels } = await import('../src/utils/elevationDrawings.js');
  const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');
  const { rebuildSidingMeasurementsFromEdits } = await import('../src/utils/rebuildSidingMeasurements.js');

  let pass = 0, fail = 0;
  const ok = (cond, label, detail = '') => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label} ${detail}`); }
  };
  const byFace = (models) => Object.fromEntries(models.map(m => [m.face, m]));

  // ── 1. Graph-only payload (the local analysis path) ───────────────────────
  // Front / back / right photographed, left never shot.
  console.log('\n[ 1 ] Graph-only payload: wall_facets, no `faces`\n');
  const graphOnly = {
    building_width_ft: 32, building_length_ft: 55, story_height_ft: 17.5, story_count: 2,
    measurement_graph: {
      wall_facets: [
        { face: 'front',      is_unknown: false, photo_count: 2, wall_width_ft: 30, wall_height_ft: 16, story_count: 2 },
        { face: 'back',       is_unknown: false, photo_count: 1, wall_width_ft: 31, wall_height_ft: 16, story_count: 2 },
        { face: 'right_side', is_unknown: false, photo_count: 1, wall_width_ft: 50, wall_height_ft: 15, story_count: 2 },
        { face: 'unknown',    is_unknown: true,  photo_count: 3, wall_width_ft: 12, wall_height_ft: 9,  story_count: 1 },
      ],
      coverage: { missing_faces: ['left_side'] },
    },
    openings_detail: [
      { type: 'window', wall_face: 'right_side', zone: 'center', width_ft: 3, height_ft: 4 },
      { type: 'window', wall_face: 'front',      zone: 'far_left', width_ft: 3, height_ft: 4 },
    ],
  };
  const m1 = byFace(buildElevationModels(graphOnly, {}));

  ok(m1.front.photographed === true,  'front is photographed (was always false)');
  ok(m1.back.photographed === true,   'back is photographed');
  ok(m1.right.photographed === true,  'right_side facet binds to the `right` model');
  ok(m1.left.photographed === false,  'left stays estimated — genuinely never shot');

  ok(m1.front.widthFt === 30, 'front uses its measured width, not the global box', `got ${m1.front.widthFt}`);
  ok(m1.right.widthFt === 50, 'right uses its measured width', `got ${m1.right.widthFt}`);
  ok(m1.left.widthFt === 55,  'unmeasured left falls back to building length', `got ${m1.left.widthFt}`);
  ok(m1.front.wallHeightFt === 16, 'front uses its measured height, not global 17.5', `got ${m1.front.wallHeightFt}`);
  ok(m1.left.wallHeightFt === 17.5, 'unmeasured left falls back to global height', `got ${m1.left.wallHeightFt}`);

  ok(m1.right.openings.length === 1, 'right_side openings are drawn on the right wall', `got ${m1.right.openings.length}`);
  ok(m1.front.openings.length === 1, 'front openings still land on front', `got ${m1.front.openings.length}`);

  // The unknown facet must never become a wall.
  ok(!Object.keys(m1).includes('unknown'), 'unknown facet is not drawn as a face');

  // ── 2. Analyzer payload keeps winning (no prod regression) ────────────────
  console.log('\n[ 2 ] Analyzer `faces` array still takes precedence\n');
  const analyzerPayload = {
    building_width_ft: 32, building_length_ft: 55, story_height_ft: 17.5,
    faces: [
      { face: 'front', wall_width_ft: 28, wall_height_ft: 16 },
      { face: 'right', wall_width_ft: 44, wall_height_ft: 16 },
    ],
    coverage: { missing_faces: ['back', 'left'] },
  };
  const m2 = byFace(buildElevationModels(analyzerPayload, {}));
  ok(m2.front.widthFt === 28, 'analyzer face width wins', `got ${m2.front.widthFt}`);
  ok(m2.right.widthFt === 44, 'analyzer `right` token binds', `got ${m2.right.widthFt}`);
  ok(m2.front.photographed === true, 'front photographed via coverage');
  ok(m2.back.photographed === false && m2.left.photographed === false, 'missing faces stay estimated');

  // ── 3. Side-wall token in missing_faces actually vetoes ───────────────────
  console.log('\n[ 3 ] `right_side` in missing_faces marks the right wall estimated\n');
  const m3 = byFace(buildElevationModels({
    building_width_ft: 32, building_length_ft: 55,
    coverage: { missing_faces: ['right_side'] },
    faces: [{ face: 'right', wall_width_ft: 44, wall_height_ft: 16 }],
  }, {}));
  ok(m3.right.photographed === false, 'right_side veto reaches the `right` model (silently missed before)');

  // ── 4. Coverage vetoes a raw photo count (Street-View-only face) ──────────
  console.log('\n[ 4 ] Coverage vetoes reference-only imagery\n');
  const m4 = byFace(buildElevationModels({
    building_width_ft: 32, building_length_ft: 55,
    wall_facets: [{ face: 'left_side', is_unknown: false, photo_count: 1, wall_width_ft: 50 }],
    coverage: { missing_faces: ['left_side'] },
  }, {}));
  ok(m4.left.photographed === false, 'a face excluded by coverage is not claimed as photographed');

  // ── 5. No evidence at all → nothing is claimed photographed ───────────────
  console.log('\n[ 5 ] Empty payload makes no false claims\n');
  const m5 = byFace(buildElevationModels({}, {}));
  ok(Object.values(m5).every(m => m.photographed === false), 'empty payload: all faces estimated');
  ok(Object.keys(m5).length === 4, 'still produces all four faces');

  // ── 6. Graph prefers flat photos over corner shots for dimensions ─────────
  // A corner shot's wall_width_ft may describe the neighbouring wall, so it
  // must not override a flat photo of the wall itself.
  console.log('\n[ 6 ] Facet dimensions prefer flat photos over corner shots\n');
  const graph = buildSidingMeasurementGraph({
    perPhotoResults: [
      { view_label: 'Front', wall_width_ft: 32, wall_height_ft: 16, story_count: 2, is_corner_shot: false, openings: [] },
      { view_label: 'FR Corner', wall_width_ft: 55, wall_height_ft: 16, story_count: 2, is_corner_shot: true, openings: [] },
      { view_label: 'Right Side', wall_width_ft: 54, wall_height_ft: 15, story_count: 2, is_corner_shot: true, openings: [] },
    ],
    storyCount: 2, wallHeightFt: 16,
  });
  const facets = Object.fromEntries((graph.wall_facets || []).map(f => [f.face, f]));
  ok(facets.front && facets.front.wall_width_ft === 32,
    'front width comes from the flat photo, not the 55ft corner shot', `got ${facets.front?.wall_width_ft}`);
  ok(facets.front && facets.front.dimension_source === 'flat_photo', 'front dimension_source = flat_photo');
  ok(facets.right_side && facets.right_side.wall_width_ft === 54,
    'a face with only a corner shot still gets a width', `got ${facets.right_side?.wall_width_ft}`);
  ok(facets.right_side && facets.right_side.dimension_source === 'corner_photo',
    'corner-only face is labelled corner_photo so callers can discount it');

  // ── 7. End-to-end: graph output feeds the drawings ────────────────────────
  console.log('\n[ 7 ] Graph output drives the elevations end-to-end\n');
  const m7 = byFace(buildElevationModels({
    building_width_ft: 32, building_length_ft: 55, story_height_ft: 16,
    measurement_graph: graph,
    coverage: graph.coverage,
  }, {}));
  ok(m7.front.photographed === true, 'front photographed from real graph output');
  ok(m7.front.widthFt === 32, 'front width flows through from the graph', `got ${m7.front.widthFt}`);
  // Only Front (flat), FR Corner (→front) and Right Side were shot, so back
  // and left must remain honestly estimated.
  ok(m7.right.photographed === true, 'right photographed from the Right Side photo');
  ok(m7.back.photographed === false && m7.left.photographed === false,
    'unshot back/left stay estimated', `back=${m7.back.photographed} left=${m7.left.photographed}`);

  // ── 8. Corner detection must not depend on the AI flag alone ──────────────
  // Count-only Gemini responses, legacy records and rebuilt graph input all
  // routinely omit is_corner_shot. A flag-only check treats "FR Corner" as a
  // flat wall and lets its 55ft reading overwrite the real 32ft front width.
  console.log('\n[ 8 ] Unflagged corner labels are still treated as corners\n');
  const graphUnflagged = buildSidingMeasurementGraph({
    perPhotoResults: [
      { view_label: 'Front',     wall_width_ft: 32, wall_height_ft: 16, story_count: 2, openings: [] },
      { view_label: 'FR Corner', wall_width_ft: 55, wall_height_ft: 16, story_count: 2, openings: [] },
    ],
    storyCount: 2, wallHeightFt: 16,
  });
  const fUn = Object.fromEntries((graphUnflagged.wall_facets || []).map(f => [f.face, f]));
  ok(fUn.front?.wall_width_ft === 32,
    'unflagged "FR Corner" does not overwrite the flat front width', `got ${fUn.front?.wall_width_ft}`);
  ok(fUn.front?.dimension_source === 'flat_photo',
    'front is still sourced from the flat photo', `got ${fUn.front?.dimension_source}`);

  // ── 9. A manual edit must not wipe the per-face dimensions ────────────────
  console.log('\n[ 9 ] Rebuild preserves per-face dimensions and provenance\n');
  const original = {
    perimeter_ft: 174, story_count: 2, story_height_ft: 16,
    building_width_ft: 32, building_length_ft: 55,
    measurement_graph: graph, coverage: graph.coverage,
  };
  const rebuilt = rebuildSidingMeasurementsFromEdits(original, { story_height_ft: 17 });
  const rf = Object.fromEntries(((rebuilt?.measurement_graph?.wall_facets) || []).map(f => [f.face, f]));
  ok(rf.front?.wall_width_ft === 32,
    'front width survives a rebuild', `got ${rf.front?.wall_width_ft}`);
  ok(rf.right_side?.dimension_source === 'corner_photo',
    'corner provenance survives a rebuild', `got ${rf.right_side?.dimension_source}`);
  ok(((rebuilt?.measurement_graph?.wall_facets) || []).filter(f => f.face === 'front').length === 1,
    'no duplicate facet for the same wall after rebuild');
  const m9 = byFace(buildElevationModels(
    { ...rebuilt, building_width_ft: 32, building_length_ft: 55 }, {}));
  ok(m9.front.widthFt === 32,
    'elevations still use measured widths after an edit', `got ${m9.front.widthFt}`);
  ok(m9.front.photographed === true, 'front stays photographed after an edit');

  console.log(`\n── Summary ──\n   Passed: ${pass}   Failed: ${fail}\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
