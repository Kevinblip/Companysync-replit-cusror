#!/usr/bin/env node
/**
 * Unit tests for the to-scale elevation drawings (no server needed).
 * Pins the geometry contract: exact zone x-positions, door/window y-positions,
 * multi-story row alternation, gable-area consistency after measured-width
 * override, per-face heights, coverage honesty marker, responsive sizing.
 */
async function main() {
  const { buildElevationModels, elevationSVG, renderElevationSet } =
    await import('../src/utils/elevationDrawings.js');

  let pass = 0, fail = 0;
  const ok = (cond, label, detail = '') => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label} ${detail}`); }
  };

  const sd = {
    building_width_ft: 35, building_length_ft: 92, perimeter_ft: 255,
    story_height_ft: 17, story_count: 2, roof_type: 'gable', gable_area_sqft: 350,
    faces: [
      { face: 'front', wall_width_ft: 34, wall_height_ft: 17, photo_label: 'Front' },
      // back/left/right not photographed
    ],
    coverage: { missing_faces: ['back', 'left', 'right'] },
    openings_detail: [
      { type: 'window', wall_face: 'front', zone: 'far_left', width_ft: 3, height_ft: 4 },
      { type: 'window', wall_face: 'front', zone: 'far_right', width_ft: 3, height_ft: 4 },
      { type: 'entry_door', wall_face: 'front', zone: 'center', width_ft: 3, height_ft: 6.8 },
      { type: 'garage_door', wall_face: 'right', zone: 'center', width_ft: 16, height_ft: 7 },
    ],
  };

  // 1. Always four models in fixed order
  const models = buildElevationModels(sd, {});
  ok(models.length === 4, 'four elevations');
  ok(models.map(m => m.face).join(',') === 'front,right,back,left', 'fixed face order', models.map(m => m.face).join(','));

  // 2. Widths: front/back anchor to WIDTH, left/right to LENGTH; measured wins when plausible
  const front = models.find(m => m.face === 'front');
  const right = models.find(m => m.face === 'right');
  ok(front.widthFt === 34, 'measured front width wins over anchor', `got ${front.widthFt}`);
  ok(right.widthFt === 92, 'right side anchors to building length', `got ${right.widthFt}`);

  // 3. Coverage honesty: only front photographed
  ok(front.photographed === true, 'front is photographed');
  ok(models.filter(m => !m.photographed).length === 3, 'three faces marked not photographed');

  // 4. Openings land on their own face only
  ok(front.openings.length === 3, 'front has its 3 openings', `got ${front.openings.length}`);
  ok(right.openings.length === 1 && right.openings[0].type === 'garage_door', 'garage on right face only');

  // 5. Gable rise from FINAL widths, area-consistent:
  //    rise = min(2·350/(34+35), 0.75·34) = 10.145 → rounded 10
  ok(front.gableRiseFt === 10, 'gable rise derived from final front+back widths', `got ${front.gableRiseFt}`);
  const drawnGableArea = 0.5 * 34 * front.gableRiseFt + 0.5 * 35 * front.gableRiseFt;
  ok(Math.abs(drawnGableArea - 350) / 350 < 0.03, 'drawn gable area within 3% of gable_area_sqft', `got ${drawnGableArea}`);
  ok(right.gableRiseFt === 0, 'no gable rise on length faces');

  // 6. Exact SVG coordinates — front: W=34, H=17, G=10, m=5 → groundY=32, wallTop=15
  const svg = elevationSVG(front);
  ok(svg.includes('<svg') && svg.includes('</svg>'), 'valid svg wrapper');
  // window far_left: zone center 0.1·34=3.4, totalW=3 → x = 5 + 1.9 = 6.90
  ok(svg.includes('x="6.90" y="25.00" width="3" height="4"'), 'far_left window exact x/y (sill 3ft, ground floor)');
  // window far_right (story 2 row): x = 5 + (0.9·34−1.5) = 34.10; bottomY = 32−8.5−3 = 20.5 → y = 16.50
  ok(svg.includes('x="34.10" y="16.50" width="3" height="4"'), 'far_right window on second-story row');
  // door center: x = 5 + (0.5·34−1.5) = 20.50; on ground → y = 32−6.8 = 25.20
  ok(svg.includes('x="20.50" y="25.20" width="3" height="6.8"'), 'door exact x, bottom on ground line');
  ok(svg.includes('<polygon'), 'gable triangle drawn');
  ok(svg.includes('34 ft'), 'width dimension label');
  ok(svg.includes('17 ft'), 'height dimension label');
  ok(!svg.includes('NOT PHOTOGRAPHED'), 'photographed face has no warning');

  // 7. Missing face: dashed + honesty marker + garage panel lines
  const estSvg = elevationSVG(right);
  ok(estSvg.includes('NOT PHOTOGRAPHED'), 'missing face carries the honesty marker');
  ok(estSvg.includes('stroke-dasharray'), 'missing face renders dashed');
  ok(estSvg.includes('G 16×7'), 'garage labeled with dims');

  // 8. All five zones pin exact x positions (50-ft face, m=5, w=3 → x = 5 + zoneCenter·50 − 1.5)
  const five = elevationSVG(buildElevationModels({
    ...sd, building_width_ft: 50, faces: [], coverage: {}, gable_area_sqft: 0, roof_type: 'hip',
    story_count: 1, story_height_ft: 9,
    openings_detail: ['far_left', 'center_left', 'center', 'center_right', 'far_right']
      .map(zone => ({ type: 'window', wall_face: 'front', zone, width_ft: 3, height_ft: 4 })),
  }, {})[0]);
  ['8.50', '18.50', '28.50', '38.50', '48.50'].forEach(x =>
    ok(five.includes(`x="${x}"`), `zone window at x=${x}`));
  // single-story: sill 3 → y = (5+0+9) − 3 − 4 = 7.00
  ok(five.includes('y="7.00" width="3" height="4"'), 'single-story windows sit on 3ft sill');

  // 9. Per-face wall height wins over the global value
  const perFace = buildElevationModels({
    ...sd, openings_detail: [],
    faces: [{ face: 'right', wall_height_ft: 12, wall_width_ft: 90 }],
    coverage: {},
  }, {});
  const rightModel = perFace.find(m => m.face === 'right');
  ok(rightModel.wallHeightFt === 12, 'per-face wall height wins', `got ${rightModel.wallHeightFt}`);
  ok(elevationSVG(rightModel).includes('12 ft'), 'per-face height in dimension label');

  // 9b. Gable-end peak height is normalized to the eave rectangle (no double-count):
  //     analyzer reports wall_height_ft = eave + gable rise for gable faces.
  const peak = buildElevationModels({
    ...sd, openings_detail: [],
    faces: [{ face: 'front', wall_height_ft: 27, wall_width_ft: 34 }], // 17 eave + 10 rise
    coverage: {},
  }, {});
  const peakFront = peak.find(m => m.face === 'front');
  ok(peakFront.wallHeightFt === 17, 'gable-end peak height normalized to eave (27 → 17)', `got ${peakFront.wallHeightFt}`);
  const peakSvg = elevationSVG(peakFront);
  // apex at y=m=5, ground at 5+10+17=32 → drawn total 27 == measured peak
  ok(peakSvg.includes('${m}') === false && peakSvg.includes(`${5 + 34 / 2},5"`), 'gable apex at top margin', '');
  ok(peakSvg.includes('17 ft'), 'eave height labeled, not peak');

  // 9c. Report styling: course lines, eave/fascia band, corner boards, dimension lines, mullions
  // front H=17 → course lines every 0.5ft → 33 interior lines + gable courses
  const courseLines = (svg.match(/stroke-width="0.08"/g) || []).length;
  ok(courseLines >= 33, 'siding course lines drawn at 6" exposure', `got ${courseLines}`);
  // gable course taper: halfW = (cy − m)/G × W/2 — near-eave (cy=14.5): 16.15 → x 5.85–38.15;
  // near-apex (cy=5.5): 0.85 → x 21.15–22.85
  ok(svg.includes('<line x1="5.85" y1="14.50" x2="38.15" y2="14.50"'), 'gable course near eave is nearly full width');
  ok(svg.includes('<line x1="21.15" y1="5.50" x2="22.85" y2="5.50"'), 'gable course near apex is short and centered');
  ok(svg.includes('width="0.5" height="17"'), 'corner boards at both wall corners');
  ok(svg.includes('height="0.75" fill="#d3dcea"'), 'eave/fascia band above the wall');
  ok((svg.match(/#2563eb/g) || []).length >= 8, 'blue ticked dimension lines (width + height)');
  ok(svg.includes('stroke="#475569" stroke-width="0.1"'), 'window mullions drawn');
  ok(svg.includes('x="6.65" y="24.75" width="3.5" height="4.5"'), 'trim casing around window opening');

  // 10. Responsive sizing: no fixed width/height attrs, max-width cap retained
  ok(svg.includes('width="100%"') && svg.includes('max-width:320px'), 'svg is responsive with max-width cap');
  ok(!/width="\d+"/.test(svg.split('><')[0]), 'no fixed pixel width on the svg element');

  // 11. Missing dims fall back to defaults instead of crashing
  const sparse = renderElevationSet({}, {});
  ok(sparse.length === 4 && sparse.every(s => s.svg.includes('<svg')), 'empty input still renders 4 elevations');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
