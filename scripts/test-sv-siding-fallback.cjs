#!/usr/bin/env node
/**
 * Street View → siding fallback regression test
 * ─────────────────────────────────────────────
 * Imports the PRODUCTION helpers from src/utils/sidingPhotoList.js so a
 * real refactor of those functions immediately breaks this test.
 *
 * Scenarios
 * ─────────
 *  1. SV images available → analyzeHousePhotosForSiding path chosen (not satellite-only)
 *  2. elevationImages = [] → satellite-only path fires cleanly (no crash)
 *  3. Label de-dup: uploaded "Front" + SV "Front" → only 1 "Front" photo passed
 *  4. De-dup only removes matching labels — non-overlapping SV angles survive
 *  5. _staticApiNotEnabled images treated as unavailable → satellite-only path
 *  6. available = false images excluded from svPhotos → satellite-only path
 *  7. All SV images available, no uploaded photos → all SV images passed
 *  8. Zero wall_area_sq response → roof-footprint fallback (grade D, formula verified)
 *  9. Photo path: response.error propagates as thrown Error (no silent blank)
 * 10. De-dup is case-sensitive — "front" ≠ "Front" labels do not collide
 * 11. Garage mode skips uploaded photos entirely
 * 12. svPhotos preserves panorama_id and verified_elevation from source image
 * 13. buildRoofFootprintFallback returns null when primaryAnalysis is null
 * 14. buildRoofFootprintFallback falls back from eave_lf to rake_lf × 1.2
 * 15. buildRoofFootprintFallback falls back from rake_lf to roof area estimate
 *
 * Usage: node scripts/test-sv-siding-fallback.cjs
 */

'use strict';

async function main() {
  const {
    buildSidingPhotoList,
    chooseSidingAnalysisPath,
    needsRoofFootprintFallback,
    buildRoofFootprintFallback,
    validatePhotoSidingResponse,
  } = await import('../src/utils/sidingPhotoList.js');

  /* ─── helpers ──────────────────────────────────────────────────────────── */

  let passed = 0;
  let failed = 0;

  function ok(name, cond, extra) {
    if (cond) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      const detail = extra !== undefined ? ` — got ${JSON.stringify(extra)}` : '';
      console.log(`  ✗ ${name}${detail}`);
      failed++;
    }
  }

  function throws(name, fn) {
    try {
      fn();
      console.log(`  ✗ ${name} — expected an error but none was thrown`);
      failed++;
    } catch (_) {
      console.log(`  ✓ ${name}`);
      passed++;
    }
  }

  /* ─── fixtures ─────────────────────────────────────────────────────────── */

  const SV_FRONT = {
    available: true,
    imageUrl: 'https://maps.googleapis.com/sv/front.jpg',
    direction: 'Front',
    panorama_id: 'pano-front-001',
    verified_elevation: true,
  };
  const SV_BACK = {
    available: true,
    imageUrl: 'https://maps.googleapis.com/sv/back.jpg',
    direction: 'Back',
    panorama_id: 'pano-back-001',
  };
  const SV_LEFT = {
    available: true,
    imageUrl: 'https://maps.googleapis.com/sv/left.jpg',
    direction: 'Left',
    panorama_id: 'pano-left-001',
  };
  const SV_UNAVAILABLE = {
    available: false,
    imageUrl: 'https://maps.googleapis.com/sv/north.jpg',
    direction: 'Front',
  };
  const SV_STATIC_DISABLED = {
    available: true,
    imageUrl: 'https://maps.googleapis.com/sv/west.jpg',
    direction: 'Right',
    _staticApiNotEnabled: true,
  };

  const UPLOADED_FRONT = { url: 'https://cdn.example.com/upload-front.jpg', label: 'Front' };
  const UPLOADED_SIDE  = { url: 'https://cdn.example.com/upload-side.jpg',  label: 'Left'  };

  /* ─── Scenario 1 ─────────────────────────────────────────────────────────
   * SV images available → analyzeHousePhotosForSiding chosen
   */
  console.log('\n[1] SV images available → analyzeHousePhotosForSiding called');
  {
    const { allPhotos } = buildSidingPhotoList({ elevationImages: [SV_FRONT, SV_BACK] });
    const fn = chooseSidingAnalysisPath(allPhotos);
    ok('analyzeHousePhotosForSiding selected when SV images present', fn === 'analyzeHousePhotosForSiding', fn);
    ok('analyzeSidingMeasurement NOT selected', fn !== 'analyzeSidingMeasurement');
    ok('allPhotos contains 2 SV images', allPhotos.length === 2, allPhotos.length);
    ok('photo source_type is street_view', allPhotos.every(p => p.source_type === 'street_view'));
  }

  /* ─── Scenario 2 ─────────────────────────────────────────────────────────
   * Empty elevationImages → satellite-only path fires cleanly
   */
  console.log('\n[2] elevationImages = [] → satellite-only path fires cleanly');
  {
    const { allPhotos } = buildSidingPhotoList({ elevationImages: [] });
    const fn = chooseSidingAnalysisPath(allPhotos);
    ok('analyzeSidingMeasurement selected when no images', fn === 'analyzeSidingMeasurement', fn);
    ok('analyzeHousePhotosForSiding NOT selected', fn !== 'analyzeHousePhotosForSiding');
    ok('allPhotos is empty', allPhotos.length === 0, allPhotos.length);

    // Simulate a healthy satellite-only response
    const satResponse = { wall_area_sq: 18.5, wall_area_sqft: 1850, success: true };
    ok('satellite-only response has wall area', Number(satResponse.wall_area_sq) > 0);
    ok('needsRoofFootprintFallback returns false for healthy response',
      needsRoofFootprintFallback(satResponse) === false);
  }

  /* ─── Scenario 3 ─────────────────────────────────────────────────────────
   * Label de-dup: uploaded "Front" replaces SV "Front"
   */
  console.log('\n[3] De-dup: uploaded "Front" replaces SV "Front"');
  {
    const { allPhotos, dedupedSv } = buildSidingPhotoList({
      elevationImages: [SV_FRONT],
      housePhotos:     [UPLOADED_FRONT],
    });
    const frontPhotos = allPhotos.filter(p => p.label === 'Front');
    ok('only 1 "Front" photo in allPhotos', frontPhotos.length === 1, frontPhotos.length);
    ok('surviving "Front" is the uploaded one (not SV)', frontPhotos[0].url === UPLOADED_FRONT.url, frontPhotos[0].url);
    ok('SV "Front" excluded from dedupedSv', !dedupedSv.some(p => p.label === 'Front'));
    ok('total allPhotos length is 1', allPhotos.length === 1, allPhotos.length);
    ok('photo path still chosen (1 photo is enough)',
      chooseSidingAnalysisPath(allPhotos) === 'analyzeHousePhotosForSiding');
  }

  /* ─── Scenario 4 ─────────────────────────────────────────────────────────
   * De-dup only removes matching labels — non-overlapping SV angles survive
   */
  console.log('\n[4] De-dup only removes matching labels — non-overlapping SV angles survive');
  {
    const { allPhotos, dedupedSv } = buildSidingPhotoList({
      elevationImages: [SV_FRONT, SV_BACK, SV_LEFT],
      housePhotos:     [UPLOADED_FRONT, UPLOADED_SIDE],
    });
    // uploaded: Front, Left → seenLabels = {Front, Left}
    // svPhotos: Front, Back, Left → dedupedSv = Back only
    ok('dedupedSv contains Back (non-overlapping)', dedupedSv.some(p => p.label === 'Back'));
    ok('dedupedSv does not contain Front (overlap)', !dedupedSv.some(p => p.label === 'Front'));
    ok('dedupedSv does not contain Left (overlap)',  !dedupedSv.some(p => p.label === 'Left'));
    ok('dedupedSv has 1 entry', dedupedSv.length === 1, dedupedSv.length);
    ok('allPhotos has 3 entries (2 uploaded + 1 SV)', allPhotos.length === 3, allPhotos.length);
    // uploaded photos must appear first
    ok('uploaded photos appear first in allPhotos', allPhotos[0].url === UPLOADED_FRONT.url);
  }

  /* ─── Scenario 5 ─────────────────────────────────────────────────────────
   * _staticApiNotEnabled images excluded → satellite-only path
   */
  console.log('\n[5] _staticApiNotEnabled images excluded from svPhotos');
  {
    const { svPhotos, allPhotos } = buildSidingPhotoList({
      elevationImages: [SV_STATIC_DISABLED],
    });
    ok('svPhotos is empty when only _staticApiNotEnabled image', svPhotos.length === 0, svPhotos.length);
    ok('satellite-only path selected',
      chooseSidingAnalysisPath(allPhotos) === 'analyzeSidingMeasurement');
  }

  /* ─── Scenario 6 ─────────────────────────────────────────────────────────
   * available = false images excluded
   */
  console.log('\n[6] available = false images excluded from svPhotos');
  {
    const { svPhotos, allPhotos } = buildSidingPhotoList({
      elevationImages: [SV_UNAVAILABLE],
    });
    ok('svPhotos is empty when SV image is unavailable', svPhotos.length === 0, svPhotos.length);
    ok('satellite-only path selected',
      chooseSidingAnalysisPath(allPhotos) === 'analyzeSidingMeasurement');
  }

  /* ─── Scenario 7 ─────────────────────────────────────────────────────────
   * All SV available, no uploaded photos → all SV images passed
   */
  console.log('\n[7] All SV images available, no uploaded photos → all SV images passed');
  {
    const { allPhotos, uploadedPhotos } = buildSidingPhotoList({
      elevationImages: [SV_FRONT, SV_BACK, SV_LEFT],
      housePhotos: [],
    });
    ok('uploadedPhotos is empty', uploadedPhotos.length === 0, uploadedPhotos.length);
    ok('allPhotos contains all 3 SV angles', allPhotos.length === 3, allPhotos.length);
    ok('all photos have source_type street_view', allPhotos.every(p => p.source_type === 'street_view'));
    ok('photo path selected', chooseSidingAnalysisPath(allPhotos) === 'analyzeHousePhotosForSiding');
  }

  /* ─── Scenario 8 ─────────────────────────────────────────────────────────
   * Zero wall_area_sq → roof-footprint fallback (grade D, formula verified)
   */
  console.log('\n[8] Satellite zero wall_area_sq → roof-footprint fallback (grade D)');
  {
    const zeroResp = { wall_area_sq: 0, wall_area_sqft: 0, success: true };
    ok('needsRoofFootprintFallback is true for zero area', needsRoofFootprintFallback(zeroResp));

    const primary = { eave_lf: 160, corrected_area_sq: 22 };
    const fallback = buildRoofFootprintFallback(primary, 1, 9, 15);
    ok('fallback is not null', fallback !== null);
    ok('fallback wall_area_sq > 0', fallback.wall_area_sq > 0, fallback.wall_area_sq);
    ok('fallback confidence_grade is D', fallback.confidence_grade === 'D', fallback.confidence_grade);
    ok('fallback tolerance_pct is 20', fallback.tolerance_pct === 20, fallback.tolerance_pct);
    ok('fallback _estimated_from_roof_footprint flag set', fallback._estimated_from_roof_footprint === true);
    ok('fallback perimeter_ft equals eave_lf', fallback.perimeter_ft === 160, fallback.perimeter_ft);
    // gross = 160 * 9 = 1440; net = 1440 * 0.85 = 1224
    ok('fallback gross_wall_area_sqft = 1440', fallback.gross_wall_area_sqft === 1440, fallback.gross_wall_area_sqft);
    ok('fallback wall_area_sqft = 1224 (15% opening deduction)', fallback.wall_area_sqft === 1224, fallback.wall_area_sqft);

    ok('needsRoofFootprintFallback true for missing area fields', needsRoofFootprintFallback({}));
  }

  /* ─── Scenario 9 ─────────────────────────────────────────────────────────
   * Photo path: response errors propagate as thrown Error
   */
  console.log('\n[9] Photo path: response.error propagates as thrown Error');
  {
    throws('response.error throws',
      () => validatePhotoSidingResponse({ error: 'analyzeHousePhotosForSiding: timeout' }));

    throws('success=false throws',
      () => validatePhotoSidingResponse({ data: { success: false, error: 'quota exceeded' } }));

    throws('missing wall_area_sqft throws',
      () => validatePhotoSidingResponse({ data: { success: true } }));

    let healthy = null;
    try {
      healthy = validatePhotoSidingResponse({ data: { wall_area_sqft: 1200, wall_area_sq: 12 } });
    } catch (_) {}
    ok('healthy response does not throw', healthy !== null);
    ok('healthy response returns data', healthy?.wall_area_sqft === 1200);
  }

  /* ─── Scenario 10 ────────────────────────────────────────────────────────
   * De-dup is case-sensitive — "front" ≠ "Front"
   */
  console.log('\n[10] De-dup is case-sensitive ("front" does not collide with "Front")');
  {
    const uploadedFrontLower = { url: 'https://cdn.example.com/front.jpg', label: 'front' };
    const { allPhotos, dedupedSv } = buildSidingPhotoList({
      elevationImages: [SV_FRONT],  // direction = 'Front'
      housePhotos:     [uploadedFrontLower], // label = 'front'
    });
    ok('SV "Front" survives when uploaded label is "front" (case differs)',
      dedupedSv.some(p => p.label === 'Front'));
    ok('both photos in allPhotos (2 total)', allPhotos.length === 2, allPhotos.length);
  }

  /* ─── Scenario 11 ────────────────────────────────────────────────────────
   * Garage mode skips uploaded photos entirely
   */
  console.log('\n[11] Garage mode skips uploaded photos');
  {
    const { uploadedPhotos, allPhotos } = buildSidingPhotoList({
      elevationImages:  [SV_FRONT],
      housePhotos:      [UPLOADED_FRONT, UPLOADED_SIDE],
      isGarageStructure: true,
    });
    ok('uploadedPhotos is empty for garage', uploadedPhotos.length === 0, uploadedPhotos.length);
    // SV images are still included
    ok('SV image still included for garage', allPhotos.some(p => p.source_type === 'street_view'));
  }

  /* ─── Scenario 12 ────────────────────────────────────────────────────────
   * svPhotos preserves panorama_id and verified_elevation from source image
   */
  console.log('\n[12] svPhotos preserves panorama_id and verified_elevation');
  {
    const { svPhotos } = buildSidingPhotoList({ elevationImages: [SV_FRONT] });
    ok('panorama_id preserved', svPhotos[0].panorama_id === 'pano-front-001', svPhotos[0].panorama_id);
    ok('verified_elevation preserved as true', svPhotos[0].verified_elevation === true);

    // Image without these fields → sensible defaults
    const { svPhotos: sv2 } = buildSidingPhotoList({
      elevationImages: [{ available: true, imageUrl: 'https://example.com/img.jpg', direction: 'Back' }],
    });
    ok('panorama_id defaults to null', sv2[0].panorama_id === null);
    ok('verified_elevation defaults to false', sv2[0].verified_elevation === false);
  }

  /* ─── Scenario 13 ────────────────────────────────────────────────────────
   * buildRoofFootprintFallback returns null when primaryAnalysis is null
   */
  console.log('\n[13] buildRoofFootprintFallback returns null when no primaryAnalysis');
  {
    ok('returns null for null primaryAnalysis', buildRoofFootprintFallback(null, 1, 9, 15) === null);
    ok('returns null for undefined primaryAnalysis',
      buildRoofFootprintFallback(undefined, 1, 9, 15) === null);
    ok('returns null when eave_lf, rake_lf, and roof_area_sq are all zero',
      buildRoofFootprintFallback({ eave_lf: 0, rake_lf: 0, roof_area_sq: 0 }, 1, 9, 15) === null);
  }

  /* ─── Scenario 14 ────────────────────────────────────────────────────────
   * buildRoofFootprintFallback falls back from eave_lf to rake_lf × 1.2
   */
  console.log('\n[14] buildRoofFootprintFallback: eave_lf missing → rake_lf × 1.2 used');
  {
    const primary = { rake_lf: 100 }; // no eave_lf
    const fallback = buildRoofFootprintFallback(primary, 1, 9, 0);
    ok('fallback is not null (rake_lf used)', fallback !== null);
    ok('perimeter_ft = rake_lf * 1.2 = 120', fallback.perimeter_ft === 120, fallback.perimeter_ft);
    ok('wall_area_sqft = 120 * 9 = 1080 (0% deduction)', fallback.wall_area_sqft === 1080, fallback.wall_area_sqft);
  }

  /* ─── Scenario 15 ────────────────────────────────────────────────────────
   * buildRoofFootprintFallback falls back to roof area estimate
   */
  console.log('\n[15] buildRoofFootprintFallback: no eave/rake → roof area estimate used');
  {
    // roof_area_sq = 25 → perimeter ≈ ceil(sqrt(2500) * 4) = ceil(200) = 200
    const primary = { roof_area_sq: 25 };
    const fallback = buildRoofFootprintFallback(primary, 1, 9, 0);
    ok('fallback is not null (roof area used)', fallback !== null);
    ok('perimeter_ft = ceil(sqrt(2500)*4) = 200', fallback.perimeter_ft === 200, fallback.perimeter_ft);
  }

  /* ─── summary ─────────────────────────────────────────────────────────── */
  console.log(`\n[test-sv-siding-fallback] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
