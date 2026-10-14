#!/usr/bin/env node
/**
 * Estimator accuracy scorecard.
 *
 * Photo-free roof: replay the recorded 5688 Gemini Ct Solar/OSM fixture and
 * compare each field to the Hover report using the research tolerances.
 * That comparison is printed. The shipped snapshot
 * (scripts/test-roof-hover-benchmark.cjs) is the regression gate, because
 * Solar imagery cannot be forced onto Hover's survey.
 *
 * Photo path: 5688 and Centuryway have Hover PDFs in the repo and no
 * elevation photos, so those photo-path rows stay unscored. A synthetic
 * four-elevation graph is the photo-path contract: four usable elevations
 * are measured and override the footprint; a missing or poor elevation is
 * estimated and named.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const fixturePath = path.join(__dirname, 'fixtures', 'hover-roof-5688-gemini-ct.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

let gateFailed = 0;
function gate(label, condition, detail = '') {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    gateFailed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function within(actual, expected, { percent = 0, absolute = 0 }) {
  const delta = Math.abs(actual - expected);
  const allowed = Math.max(absolute, Math.abs(expected) * percent / 100);
  return { pass: Number.isFinite(actual) && delta <= allowed, delta, allowed };
}

function row(name, actual, expected, rule) {
  if (expected == null || actual == null) {
    console.log(`  ${name.padEnd(22)} actual ${actual ?? '—'}  hover —  (no reference)`);
    return;
  }
  const result = within(actual, expected, rule);
  const mark = result.pass ? 'PASS' : 'FAIL';
  console.log(
    `  ${mark}  ${name.padEnd(18)} ours ${Number(actual).toFixed(2).padStart(8)}  hover ${Number(expected).toFixed(2).padStart(8)}  Δ ${result.delta.toFixed(2)} (allow ${result.allowed.toFixed(2)})`,
  );
}

(async () => {
  console.log('\n── Photo-free roof: 5688 Gemini Ct vs Hover ──');
  const originalFetch = globalThis.fetch;
  const originalGoogleKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = '__recorded_fixture__';
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('solar.googleapis.com')) {
      return new Response(JSON.stringify(fixture.solar), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.includes('overpass-api.de')) {
      return new Response(JSON.stringify(fixture.osm), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Scorecard attempted an unexpected live request: ${requestUrl}`);
  };

  let roof;
  try {
    const { functionHandlers } = await import('../vite-functions-plugin.js');
    roof = await functionHandlers._aiRoofMeasurementImpl({
      latitude: fixture.coordinates.latitude,
      longitude: fixture.coordinates.longitude,
      address: fixture.recorded_for,
    }, 'unused', null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGoogleKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalGoogleKey;
  }

  gate('photo-free roof handler succeeded', roof?.success === true, roof?.error);
  const hover = fixture.hover_reference;
  const ours = {
    area: Number(roof?.roof_area_sqft),
    pitch: roof?.pitch,
    ridge: Number(roof?.ridge_lf),
    hip: Number(roof?.hip_lf),
    valley: Number(roof?.valley_lf),
    rake: Number(roof?.rake_lf),
    eave: Number(roof?.eave_lf),
  };
  console.log('  Tolerances: area 3%, pitch exact, each linear 10% or 5 ft. Waste is policy, not accuracy.');
  row('roof area sqft', ours.area, hover.roof_area_sqft, { percent: 3 });
  const pitchOk = ours.pitch === hover.pitch;
  console.log(`  ${pitchOk ? 'PASS' : 'FAIL'}  ${'pitch'.padEnd(18)} ours ${String(ours.pitch).padStart(8)}  hover ${String(hover.pitch).padStart(8)}`);
  row('ridge lf', ours.ridge, null, {});
  row('hip lf', ours.hip, null, {});
  row('ridge+hip lf', ours.ridge + ours.hip, hover.ridge_hip_lf, { percent: 10, absolute: 5 });
  row('valley lf', ours.valley, hover.valley_lf, { percent: 10, absolute: 5 });
  row('rake lf', ours.rake, hover.rake_lf, { percent: 10, absolute: 5 });
  row('eave lf', ours.eave, hover.eave_lf, { percent: 10, absolute: 5 });
  row('eave+rake lf', ours.eave + ours.rake, hover.rake_lf + hover.eave_lf, { percent: 8 });
  gate('waste floor stays at 10%', Number(roof?.waste_percentage) >= 10, String(roof?.waste_percentage));
  gate('waste reason is present', typeof roof?.waste_reason === 'string' && roof.waste_reason.length > 0);
  console.log(`  linear source ${roof?.roof_linear_source}  ridge count ${roof?.ridge_count}  hip count ${roof?.hip_count}  rake count ${roof?.rake_count}  eave count ${roof?.eave_count}`);
  console.log(`  PHOTO-FREE OUTPUT ${JSON.stringify({
    roof_area_sqft: ours.area,
    pitch: ours.pitch,
    ridge_lf: ours.ridge,
    hip_lf: ours.hip,
    valley_lf: ours.valley,
    rake_lf: ours.rake,
    eave_lf: ours.eave,
    waste_percentage: roof?.waste_percentage,
    waste_reason: roof?.waste_reason,
  })}`);

  console.log('\n── Photo path: fixtures on disk ──');
  const photoNames = ['5688', 'gemini', 'centuryway', '20638'];
  const photoHits = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (/\.(jpe?g|png|heic|webp)$/i.test(entry.name) && photoNames.some(name => full.toLowerCase().includes(name))) {
        photoHits.push(full);
      }
    }
  };
  walk(ROOT, 0);
  if (photoHits.length === 0) {
    console.log('  5688 Gemini Ct: no elevation photos in the repo. Photo-path accuracy not scored.');
    console.log('  Centuryway (20638 Centuryway Rd): no elevation photos in the repo. Photo-path accuracy not scored.');
    console.log('  Centuryway Hover reference (photo-free counts are a different stage and are not compared):');
    console.log('    facade 1003 sqft including openings, openings 278, window groups 13, units 18, doors 2, vents 2, starter 144 ft 3 in.');
  } else {
    console.log(`  Found candidate photos:\n    ${photoHits.join('\n    ')}`);
  }

  console.log('\n── Photo path: synthetic four-elevation contract ──');
  const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');
  const { cornersFromElevationPhotos } = await import('../src/utils/footprintCorners.js');
  const { resolveRoofWaste } = await import('../src/utils/roofWaste.js');
  const { calculateSidingWaste } = await import('../src/utils/sidingWaste.js');
  const { generateSidingReportHTML } = await import('../src/utils/generateSidingReportHTML.js');

  const HT = 18;
  const face = (wall_face, wall_width_ft, extra = {}) => ({
    wall_face, view_label: wall_face, wall_width_ft, wall_height_ft: HT, eave_height_ft: HT, story_count: 2,
    openings: [{ type: 'window', width_ft: 3, height_ft: 4 }],
    outside_corners_visible: 2,
    inside_corners_visible: wall_face === 'front' ? 2 : 0,
    soffit_depth_ft: 2,
    gutter_run_lf: wall_width_ft,
    gutter_visible: true,
    ...extra,
  });
  const four = buildSidingMeasurementGraph({
    perPhotoResults: [face('front', 30), face('back', 30), face('left_side', 20), face('right_side', 20)],
    storyCount: 2, wallHeightFt: HT, grossWallAreaSqft: 160 * HT, perimeterFt: 160,
    buildingWidthFt: 30, buildingLengthFt: 20, footprintSource: 'solar',
  });
  gate('four elevations measure the wall and override the footprint',
    four.totals.wall_total_quality === 'measured'
      && four.totals.gross_wall_area_source === 'photo_wall_planes'
      && four.totals.photo_overrides_footprint === true);
  const missing = buildSidingMeasurementGraph({
    perPhotoResults: [face('front', 30), face('back', 30), face('left_side', 20)],
    storyCount: 2, wallHeightFt: HT, grossWallAreaSqft: 100 * HT, perimeterFt: 100,
    buildingWidthFt: 30, buildingLengthFt: 20, footprintSource: 'solar',
  });
  gate('a missing elevation stays estimated',
    missing.totals.wall_total_quality === 'estimated'
      && missing.coverage.missing_faces.includes('right_side'));
  const poor = buildSidingMeasurementGraph({
    perPhotoResults: [
      face('front', 30), face('back', 30), face('left_side', 20),
      face('right_side', 20, { elevation_poor: true, occluded: true }),
    ],
    storyCount: 2, wallHeightFt: HT, grossWallAreaSqft: 100 * HT, perimeterFt: 100,
    buildingWidthFt: 30, buildingLengthFt: 20, footprintSource: 'solar',
  });
  gate('a poor elevation is named and is not called measured',
    poor.totals.wall_total_quality === 'estimated'
      && poor.totals.poor_faces.includes('right_side'));

  const photoCorners = cornersFromElevationPhotos([
    face('front', 30), face('back', 30), face('left_side', 20), face('right_side', 20),
  ], HT);
  gate('photo corner counts override a rectangle when all four elevations report them',
    photoCorners?.source === 'photos' && photoCorners.outside_count === 4 && photoCorners.inside_count === 1);

  const roofWaste = resolveRoofWaste({ pitchVal: 5, numSegments: 7, hipLf: 37, valleyLf: 4, overridePct: 12 });
  gate('roof waste floor is 10% and a rep override is kept',
    roofWaste.waste_recommended_pct >= 10 && roofWaste.waste_percentage === 12 && roofWaste.waste_override_pct === 12);
  const sidingWaste = calculateSidingWaste({ openingCount: 14, outsideCorners: 6, insideCorners: 1, gableAreaSqft: 40 });
  gate('siding waste floor is 10% and the reason is shown',
    sidingWaste.applied_pct >= 10 && /10% floor/.test(sidingWaste.reason));

  const pluginSource = fs.readFileSync(path.join(ROOT, 'vite-functions-plugin.js'), 'utf8');
  const v2Source = fs.readFileSync(path.join(ROOT, 'src/utils/v2-estimator-math.js'), 'utf8');
  gate('the 8% v2 waste engine stays unwired',
    !pluginSource.includes('v2-estimator-math') && v2Source.includes('let baseWaste = 0.08'));

  const html = generateSidingReportHTML({
    sidingMeasurements: {
      wall_total_quality: 'measured',
      gross_wall_area_sqft: four.totals.gross_wall_area_sqft,
      siding_waste_percentage: sidingWaste.applied_pct,
      siding_waste_recommended_pct: sidingWaste.recommended_pct,
      siding_waste_reason: sidingWaste.reason,
      siding_waste_override_pct: 12,
      outside_corners_count: photoCorners.outside_count,
      inside_corners_count: photoCorners.inside_count,
      soffit_depth_source: 'measured',
      soffit_level_depth_ft: 2,
      trim_totals: { j_channel_lf: 80, starter_strip_lf: 144, outside_corners_count: 4, inside_corners_count: 1 },
      coverage: { missing_faces: [] },
      poor_faces: [],
    },
    satelliteAnalysis: { waste_percentage: 12, waste_reason: roofWaste.reason, waste_override_pct: 12, pitch: '5/12' },
    satelliteAddress: { address: '5688 Gemini Ct' },
    companyName: 'Test',
  });
  gate('siding PDF shows measured wall, waste reason, J-channel, and starter',
    html.includes('(measured)') && html.includes(sidingWaste.reason) && html.includes('J-Channel') && html.includes('Starter Strip') && html.includes('rep override 12%'));
  const estimatedHtml = generateSidingReportHTML({
    sidingMeasurements: {
      wall_total_quality: 'estimated',
      poor_faces: ['right_side'],
      coverage: { missing_faces: ['back'] },
      soffit_depth_source: 'estimated',
    },
    satelliteAnalysis: {},
    satelliteAddress: {},
    companyName: 'Test',
  });
  gate('siding PDF flags a missing elevation, a poor elevation, and an estimated soffit',
    estimatedHtml.includes('Not photographed') && estimatedHtml.includes('Poor elevation') && estimatedHtml.includes('est.'));

  console.log('\n── Photo path vs photo-free ──');
  console.log('  Photo-free 5688 is the Solar replay above. It does not use elevation photos.');
  console.log(`  Photo path on the same footprint shape: wall ${four.totals.gross_wall_area_sqft} sqft from photos (${four.totals.wall_total_quality}), footprint extrusion ${four.totals.extrusion_wall_area_sqft} sqft overridden.`);
  console.log('  Centuryway photo path: not scored. The Hover PDF is in the repo; the elevation photos are not.');

  console.log(`\nScorecard gate: ${gateFailed === 0 ? 'passed' : `${gateFailed} failed`}`);
  if (gateFailed) process.exit(1);
})().catch((error) => {
  console.error('\nScorecard crashed:', error);
  process.exit(1);
});
