#!/usr/bin/env node
/**
 * Smoke tests for the printable siding report (no server needed).
 *
 * Guards the CAD-grade elevation integration:
 *  - the four shared-builder SVG elevations are embedded at generation time
 *  - coverage honesty: amber "NOT PHOTOGRAPHED — ESTIMATED" banner + dashed
 *    elev-est boxes appear exactly for un-photographed faces
 *  - elevation boxes keep a bounded height (one-page landscape layout)
 *  - the old canvas elevation engine stays deleted
 *  - sparse/manual measurement objects still produce a full report
 *    (this path once crashed on an undefined header variable)
 */
const path = require('path');

async function main() {
  const { readFile } = await import('node:fs/promises');
  const { generateSidingReportHTML } = await import('../src/utils/generateSidingReportHTML.js');
  const { calculateFusedRoof, selectConsistentFacadePitchSlopes } = await import('../src/utils/companySyncFormulas.js');

  let pass = 0, fail = 0;
  const ok = (cond, label, detail = '') => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label} ${detail}`); }
  };

  // ── Partial coverage: only the front face photographed ────────────────────
  const sd = {
    building_width_ft: 35, building_length_ft: 92, perimeter_ft: 255,
    story_height_ft: 17, story_count: 2, roof_type: 'gable',
    faces: [{ face: 'front', wall_width_ft: 34, wall_height_ft: 17 }],
    coverage: { missing_faces: ['back', 'left', 'right'] },
    openings_detail: [
      { type: 'window', wall_face: 'front', zone: 'far_left', width_ft: 3, height_ft: 4 },
      { type: 'entry_door', wall_face: 'front', zone: 'center', width_ft: 3, height_ft: 6.8 },
    ],
  };
  const html = generateSidingReportHTML({
    sidingMeasurements: sd,
    satelliteAnalysis: { pitch: '6/12', roof_type: 'gable' },
    satelliteAddress: { address: '123 Test St' },
    companyName: 'Test Co',
    facePhotos: [{ face: 'front', url: 'https://example.com/front-house.jpg', source: 'upload' }],
  });

  console.log('\n[ 1 ] Partial coverage (front only)\n');
  ok((html.match(/<svg /g) || []).length === 4, '4 elevation SVGs embedded');
  ok(html.includes('NOT PHOTOGRAPHED — ESTIMATED'), 'amber banner present for un-photographed faces');
  ok((html.match(/elev-box elev-est/g) || []).length === 3, 'exactly 3 boxes flagged elev-est');
  ok(html.includes('https://example.com/front-house.jpg'), 'matched face photo thumbnail embedded');
  ok((html.match(/class="elev-photo"/g) || []).length === 1, 'only the photographed face gets a thumbnail');
  ok(html.includes('PHOTO ON FILE'), 'photo thumbnail is labeled honestly');
  ok(!/elev-est[^"]*elev-has-photo/.test(html), 'missing faces never receive placeholder photos');
  ok(!html.includes('front-canvas') && !html.includes('renderElevation('), 'canvas elevation engine stays deleted');
  ok(html.includes('iso-canvas') && html.includes('perim-canvas'), 'iso + perimeter canvases retained');
  ok(/\.elev-box\{height:1\d\dpx/.test(html), 'elevation boxes height-bounded (one-page layout)');
  ok(html.includes('Test Co') && html.includes('123 Test St'), 'header renders company + address');

  // ── Full coverage: every face photographed ────────────────────────────────
  console.log('\n[ 2 ] Full coverage\n');
  const sd2 = {
    ...sd,
    faces: ['front', 'back', 'left', 'right'].map(f => ({ face: f, wall_width_ft: 30, wall_height_ft: 17 })),
    coverage: { missing_faces: [] },
  };
  const html2 = generateSidingReportHTML({
    sidingMeasurements: sd2, satelliteAnalysis: {}, satelliteAddress: {}, companyName: 'X',
    facePhotos: ['front', 'back', 'left', 'right'].map(face => ({
      face,
      url: `https://example.com/${face}.jpg`,
      source: 'upload',
    })),
  });
  ok(!html2.includes('NOT PHOTOGRAPHED'), 'no banner when all faces photographed');
  ok((html2.match(/elev-box elev-est/g) || []).length === 0, 'no elev-est boxes when all photographed');
  ok((html2.match(/class="elev-photo"/g) || []).length === 4, 'all four matched photos are embedded');
  ok((html2.match(/elev-has-photo/g) || []).length === 5, 'all four boxes use the bounded photo layout');

  // ── Sparse data: manual-measurement path passes near-empty objects ────────
  console.log('\n[ 3 ] Sparse data resilience\n');
  const html3 = generateSidingReportHTML({
    sidingMeasurements: {}, satelliteAnalysis: {}, satelliteAddress: {}, companyName: 'X',
  });
  ok((html3.match(/<svg /g) || []).length === 4, 'sparse data still renders 4 SVGs');
  ok(html3.includes('</html>'), 'sparse data produces a complete document');

  // ── Crew-cam pitch + masonry handoff ──────────────────────────────────────
  console.log('\n[ 4 ] Crew-cam pitch and masonry handoff\n');
  const solarPitchMultiplier = Math.sqrt(1 + (6 / 12) ** 2);
  const fused = calculateFusedRoof(1120, solarPitchMultiplier, [4, 4]);
  ok(fused.was_recalibrated === true, '4/12 crew pitch triggers relative 3% recalibration from Solar 6/12');
  ok(fused.detected_pitch === '4/12', 'fused formula preserves crew-measured pitch');
  ok(selectConsistentFacadePitchSlopes([4, 12]).length === 0,
    'conflicting two-photo pitches are rejected rather than averaged');
  ok(JSON.stringify(selectConsistentFacadePitchSlopes([4, 4, 12])) === JSON.stringify([4, 4]),
    'an outlying third photo is removed before fusion');
  ok(selectConsistentFacadePitchSlopes([4, 4, 8, 8]).length === 0,
    'evenly split pitch clusters are rejected rather than averaged');
  const viteHandler = await readFile(path.resolve(__dirname, '../vite-functions-plugin.js'), 'utf8');
  ok(
    viteHandler.includes("explicit != null && hasGableRakeEvidence(r) && ['high', 'medium'].includes(explicitConfidence)"),
    'the live photo handler requires visible gable/rake evidence for an explicit pitch',
  );
  const fusedHtml = generateSidingReportHTML({
    sidingMeasurements: {
      ...sd2,
      facade_pitch_slopes: [4, 4],
      masonry_deduction_sqft: 180,
    },
    satelliteAnalysis: {
      pitch: '6/12',
      roof_type: 'gable',
      roof_area_sq: 11.2,
    },
    satelliteAddress: { address: '123 Test St' },
    companyName: 'Test Co',
  });
  ok(fusedHtml.includes('🔄 Fused Roof Area') && fusedHtml.includes('(4/12)'),
    'report labels the crew-pitch recalibrated roof area');
  ok(fusedHtml.includes('Masonry / Non-Siding') && fusedHtml.includes('−180 sqft'),
    'report uses photo masonry_deduction_sqft');
  const nearSolarHtml = generateSidingReportHTML({
    sidingMeasurements: { ...sd2, facade_pitch_slopes: [6.1] },
    satelliteAnalysis: { pitch: '6/12', roof_type: 'gable', roof_area_sq: 11.2 },
    satelliteAddress: {}, companyName: 'Test Co',
  });
  ok(!nearSolarHtml.includes('🔄 Fused Roof Area'),
    'report keeps the normal roof label below the 3% calibration threshold');

  // ── Field-count opening override ─────────────────────────────────────────
  console.log('\n[ 5 ] Field-count opening override\n');
  const overrideHtml = generateSidingReportHTML({
    sidingMeasurements: {
      gross_wall_area_sqft: 2000,
      wall_area_sqft: 1940,
      actual_openings_count: 4,
      opening_deduction_sqft: 60,
      openings_detail: [
        { type: 'window', width_ft: 3, height_ft: 4 },
        { type: 'entry_door', width_ft: 3, height_ft: 6.8 },
      ],
    },
    satelliteAnalysis: {},
    satelliteAddress: {},
    companyName: 'Test Co',
  });
  ok(overrideHtml.includes('Field count'), 'report labels the opening quantity as a field count');
  ok(overrideHtml.includes('4 openings (15 sqft/ea = 60 sqft deducted)'),
    'report shows the field count and flat deduction calculation');
  ok(overrideHtml.includes('MANUAL OVERRIDE'), 'report shows a clear manual-override badge');
  ok(!overrideHtml.includes('Window / Door Deduct'),
    'manual field count replaces the AI window/door deduction row');
  ok(overrideHtml.includes('~19.40 SQ'),
    'report net siding area uses the overridden deduction');

  console.log(`\n── Summary ──\n   Passed: ${pass}   Failed: ${fail}\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
