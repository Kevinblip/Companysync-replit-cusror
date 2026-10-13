#!/usr/bin/env node
/**
 * Siding EXIF wall-face binding regression test
 * ─────────────────────────────────────────────
 * Verifies that compass headings do not change the result for photos whose
 * labels already identify the correct face, that photos without headings still
 * use the existing label fallback, and that an oblique corner observation does
 * not inflate the canonical siding total.
 *
 * The production handler keeps its Deno request code private, so the small
 * pure decision functions below mirror headingToWallFace and the no-EXIF
 * fallback in the live analyzeHousePhotosForSiding handler. The resulting photo
 * payloads are then run through the production siding measurement graph.
 *
 * Usage: node scripts/test-siding-exif-orientation.cjs
 */

'use strict';

let passed = 0;
let failed = 0;

function ok(label, condition, got, expected) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const detail = got !== undefined
      ? ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`
      : '';
    console.log(`  ✗ ${label}${detail}`);
    failed++;
  }
}

const WALL_AZIMUTHS = {
  front: 0,
  right: 90,
  back: 180,
  left: 270,
};

const OBLIQUE_THRESHOLD_DEG = 35;

function angularDifference(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Mirrors headingToWallFace() in the production handler.
 *
 * GPSImgDirection is the direction the camera points. For a straight shot,
 * that is also the outward normal of the wall being photographed.
 */
function headingToWallFace(cameraHeading, wallAzimuths) {
  const walls = [
    { face: 'front', az: wallAzimuths.front },
    { face: 'right_side', az: wallAzimuths.right },
    { face: 'back', az: wallAzimuths.back },
    { face: 'left_side', az: wallAzimuths.left },
  ];
  walls.sort(
    (a, b) =>
      angularDifference(cameraHeading, a.az) -
      angularDifference(cameraHeading, b.az),
  );

  const primary = walls[0];
  const secondary = walls[1];
  const angularError = angularDifference(cameraHeading, primary.az);
  const isOblique = angularError > OBLIQUE_THRESHOLD_DEG;

  return {
    face: primary.face,
    isOblique,
    secondaryFace: isOblique ? secondary.face : null,
    angularError,
  };
}

/**
 * Mirrors the existing no-EXIF label fallback. It intentionally only fills an
 * unknown face; a non-unknown Gemini classification is left untouched.
 */
function applyFaceBinding(photo, wallAzimuths = null) {
  const result = {
    ...photo,
    wall_face: photo.wall_face || 'unknown',
  };
  const labelLc = String(photo.label || '').toLowerCase();

  if (/corner|angle/.test(labelLc)) result.is_corner_shot = true;

  const exifHeading = photo.exif_heading != null
    ? Number(photo.exif_heading)
    : NaN;
  if (Number.isFinite(exifHeading) && wallAzimuths) {
    const mapping = headingToWallFace(exifHeading, wallAzimuths);
    result.wall_face = mapping.face;
    result.exif_heading_deg = exifHeading;
    result.exif_face_angular_error_deg =
      Math.round(mapping.angularError * 10) / 10;

    if (mapping.isOblique) {
      result.is_corner_shot = true;
      result.corner_faces = [mapping.face, mapping.secondaryFace].filter(Boolean);
    } else if (!/corner|angle/.test(labelLc)) {
      // A straight EXIF shot clears an accidental visual corner flag.
      result.is_corner_shot = false;
    }
    return result;
  }

  // Existing behavior when EXIF is absent: trust a non-unknown visual face,
  // otherwise infer the face from the uploader's label.
  if (!result.wall_face || result.wall_face === 'unknown') {
    if (!result.is_corner_shot) {
      if (labelLc.includes('front')) result.wall_face = 'front';
      else if (labelLc.includes('back') || labelLc.includes('rear')) result.wall_face = 'back';
      else if (labelLc.includes('left')) result.wall_face = 'left_side';
      else if (labelLc.includes('right')) result.wall_face = 'right_side';
    }
  }
  return result;
}

function openingFor(id, position) {
  return {
    observation_id: id,
    type: 'window',
    width_ft: 5,
    height_ft: 4,
    pos_x: position,
    pos_y: 5,
    confidence: 0.95,
  };
}

function labeledPhoto(label, face, id, position) {
  return {
    label,
    view_label: label,
    wall_face: face,
    confidence: 0.95,
    wall_width_ft: 40,
    eave_height_ft: 9,
    openings: [openingFor(id, position)],
  };
}

function graphInput(perPhotoResults) {
  return {
    perPhotoResults,
    storyCount: 1,
    wallHeightFt: 9,
    grossWallAreaSqft: 2000,
    accentDeductionSqft: 0,
    perimeterFt: 180,
    buildingWidthFt: 40,
    buildingLengthFt: 50,
    smallOpeningsInWaste: false,
  };
}

function comparableGraphResult(graph) {
  return {
    net_siding_area_sqft: graph.totals.net_siding_area_sqft,
    opening_deduction_sqft: graph.totals.opening_deduction_sqft,
    opening_area_total_sqft: graph.totals.opening_area_total_sqft,
    counts: graph.counts,
    openingFaces: graph.opening_groups.map(group => group.face).sort(),
  };
}

(async () => {
  const { buildSidingMeasurementGraph } =
    await import('../functions/utils/sidingMeasurementGraph.js');

  ok(
    'production graph exports buildSidingMeasurementGraph',
    typeof buildSidingMeasurementGraph === 'function',
  );

  // ── Scenario 1: EXIF headings agree with correctly labelled photos ──────────
  console.log('\n── EXIF headings preserve correctly labelled wall faces ──');
  const labels = [
    { label: 'Front', face: 'front', heading: 0, id: 'front-window', position: 5 },
    { label: 'Back', face: 'back', heading: 180, id: 'back-window', position: 10 },
    { label: 'Left Side', face: 'left_side', heading: 270, id: 'left-window', position: 15 },
    { label: 'Right Side', face: 'right_side', heading: 90, id: 'right-window', position: 20 },
  ];

  // Legacy output: Gemini returned unknown, so the old label heuristic supplied
  // each correctly labelled face.
  const legacyPhotos = labels.map(({ label, id, position }) =>
    labeledPhoto(label, 'unknown', id, position),
  );
  const legacyBound = legacyPhotos.map(photo => applyFaceBinding(photo));

  // New output: the same photos also carry the matching caller-supplied EXIF
  // heading, which is the frontend path consumed by the production handler.
  const exifPhotos = labels.map(({ label, heading, id, position }) =>
    applyFaceBinding(
      { ...labeledPhoto(label, 'unknown', id, position), exif_heading: heading },
      WALL_AZIMUTHS,
    ),
  );

  ok(
    'EXIF mapping returns the same four faces as label fallback',
    exifPhotos.map(photo => photo.wall_face).join('|') ===
      legacyBound.map(photo => photo.wall_face).join('|'),
    exifPhotos.map(photo => photo.wall_face),
    legacyBound.map(photo => photo.wall_face),
  );
  ok(
    'matching EXIF headings map Front/Back/Left/Right correctly',
    exifPhotos.map(photo => photo.wall_face).join('|') ===
      labels.map(({ face }) => face).join('|'),
    exifPhotos.map(photo => photo.wall_face),
  );
  ok(
    'matching headings are straight shots, not corners',
    exifPhotos.every(photo => photo.is_corner_shot === false) &&
      exifPhotos.every(photo => photo.exif_face_angular_error_deg === 0),
    exifPhotos.map(photo => ({
      face: photo.wall_face,
      corner: photo.is_corner_shot,
      error: photo.exif_face_angular_error_deg,
    })),
  );

  const legacyGraph = buildSidingMeasurementGraph(graphInput(legacyBound));
  const exifGraph = buildSidingMeasurementGraph(graphInput(exifPhotos));
  ok(
    'EXIF-bound photos preserve the complete siding total',
    comparableGraphResult(exifGraph).net_siding_area_sqft ===
      comparableGraphResult(legacyGraph).net_siding_area_sqft,
    comparableGraphResult(exifGraph).net_siding_area_sqft,
    comparableGraphResult(legacyGraph).net_siding_area_sqft,
  );
  ok(
    'EXIF-bound photos preserve opening deductions and face assignments',
    JSON.stringify(comparableGraphResult(exifGraph)) ===
      JSON.stringify(comparableGraphResult(legacyGraph)),
    comparableGraphResult(exifGraph),
    comparableGraphResult(legacyGraph),
  );

  // ── Scenario 2: no EXIF still uses the label heuristic ─────────────────────
  console.log('\n── No EXIF heading preserves the label fallback ──');
  const noExifPhotos = [
    { label: 'Front', wall_face: 'unknown' },
    { label: 'Rear Elevation', wall_face: 'unknown' },
    { label: 'Left Side', wall_face: 'unknown' },
    { label: 'Right Side', wall_face: 'unknown' },
  ].map(photo => applyFaceBinding(photo, WALL_AZIMUTHS));

  ok(
    'no-EXIF labels resolve to canonical faces',
    noExifPhotos.map(photo => photo.wall_face).join('|') ===
      'front|back|left_side|right_side',
    noExifPhotos.map(photo => photo.wall_face),
  );
  ok(
    'no-EXIF fallback does not invent EXIF metadata',
    noExifPhotos.every(photo =>
      photo.exif_heading_deg === undefined &&
      photo.exif_face_angular_error_deg === undefined &&
      photo.corner_faces === undefined,
    ),
  );
  const existingVisualFace = applyFaceBinding({
    label: 'Front',
    wall_face: 'back',
  }, WALL_AZIMUTHS);
  ok(
    'no-EXIF fallback leaves an existing non-unknown visual face untouched',
    existingVisualFace.wall_face === 'back',
    existingVisualFace.wall_face,
    'back',
  );

  // ── Scenario 3: oblique corner shot does not double-count an opening ────────
  console.log('\n── 45° EXIF heading is a corner without area inflation ──');
  const cornerMapping = headingToWallFace(45, WALL_AZIMUTHS);
  ok('45° heading is flagged as oblique', cornerMapping.isOblique === true);
  ok(
    '45° heading selects the front/right corner pair',
    cornerMapping.face === 'front' && cornerMapping.secondaryFace === 'right_side',
    cornerMapping,
    { face: 'front', secondaryFace: 'right_side' },
  );
  ok(
    'corner threshold is strictly greater than 35°',
    headingToWallFace(35, WALL_AZIMUTHS).isOblique === false &&
      headingToWallFace(35.1, WALL_AZIMUTHS).isOblique === true,
  );

  const cornerPhoto = applyFaceBinding({
    ...labeledPhoto('Front-right corner', 'unknown', 'front-window', 5),
    exif_heading: 45,
  }, WALL_AZIMUTHS);
  ok(
    'EXIF corner result records both adjoining faces',
    cornerPhoto.is_corner_shot === true &&
      JSON.stringify(cornerPhoto.corner_faces) ===
        JSON.stringify(['front', 'right_side']),
    cornerPhoto,
  );

  const cornerGraph = buildSidingMeasurementGraph(
    graphInput([...exifPhotos, cornerPhoto]),
  );
  ok(
    'corner duplicate opening is not added to the siding total',
    comparableGraphResult(cornerGraph).net_siding_area_sqft ===
      comparableGraphResult(exifGraph).net_siding_area_sqft,
    comparableGraphResult(cornerGraph).net_siding_area_sqft,
    comparableGraphResult(exifGraph).net_siding_area_sqft,
  );
  ok(
    'corner duplicate remains one opening group',
    cornerGraph.opening_groups.length === exifGraph.opening_groups.length,
    cornerGraph.opening_groups.length,
    exifGraph.opening_groups.length,
  );

  console.log(`\n[test-siding-exif-orientation] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});