'use strict';
/**
 * siding-aggregate.cjs
 * ────────────────────
 * Pure aggregate functions for photo-based siding measurement.
 * Extracted so they can be imported directly by test scripts without
 * spinning up Gemini or any HTTP server.
 *
 * Both vite-functions-plugin.js (dev server) and
 * scripts/test-siding-aggregate.cjs import this module.
 *
 * The live analyzeHousePhotosForSiding handler in vite-functions-plugin.js
 * imports these functions directly, so this module is the aggregation source
 * of truth for development and production.
 */

const DEFAULT_EAVE_PER_STORY = 9;   // ft — spec: 1s=9, 2s=18, 3s=27
const PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT = 7;
const PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT = 28;
const PHOTO_CALIBRATION_OUTLIER_PCT = 15;
const CALIBRATED_METHODS = new Set(['door_anchor', 'garage_door_anchor', 'course_count', 'door_scale', 'window_scale']);

// ─── helpers ─────────────────────────────────────────────────────────────────
const avg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

const median = (arr) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Robust average: MAD-based outlier rejection, then mean of survivors.
 *
 * Why: per-photo AI estimates are usually tight, but a single bad photo
 * (odd perspective, mistaken ridge-for-eave) can be wildly high.  A plain
 * arithmetic mean lets that one photo drag the aggregate up — this was the
 * dominant error in the Hover garage benchmark (mean 9.5 ft vs true ~8 ft).
 *
 * With ≤2 samples there is no basis for rejection → plain mean.
 * When MAD = 0 (most samples identical) a value is an outlier if it is more
 * than 15% (or 1 unit) away from the median.
 *
 * @returns {{ value: number, kept: number[], rejected: number[] }}
 */
function robustAvg(values) {
  if (values.length <= 2) return { value: avg(values), kept: [...values], rejected: [] };
  const m = median(values);
  const mad = median(values.map(v => Math.abs(v - m)));
  const within = mad > 0
    ? (v) => Math.abs(v - m) / (1.4826 * mad) <= 2.5
    : (v) => Math.abs(v - m) <= Math.max(0.15 * Math.abs(m), 1);
  const kept = values.filter(within);
  const rejected = values.filter(v => !within(v));
  // Safety: never reject everything (can't happen — median always survives)
  if (kept.length === 0) return { value: avg(values), kept: [...values], rejected: [] };
  return { value: avg(kept), kept, rejected };
}

function robustPhotoHeightAvg(values) {
  if (values.length === 0) return { value: 0, kept: [], rejected: [] };
  const center = median(values);
  const allowed = Math.max(center * (PHOTO_CALIBRATION_OUTLIER_PCT / 100), 0.75);
  const kept = values.filter(v => Math.abs(v - center) <= allowed);
  const rejected = values.filter(v => !kept.includes(v));
  const survivors = kept.length > 0 ? kept : [center];
  return { value: median(survivors), kept: survivors, rejected };
}

// ─── 1. Wall height ──────────────────────────────────────────────────────────
/**
 * Derive wall eave height from per-photo AI results.
 *
 * Priority order (mirrors the live Vite handler):
 *   1. manually_calibrated photos  (ruler tool override — most authoritative)
 *   2. Photos with a recognised calibrated height_method AND no height_clamped flag
 *   3. Formula fallback: storyCount × DEFAULT_EAVE_PER_STORY
 *
 * @param {object[]} perPhotoResults  — all per-photo AI results (corner shots included)
 * @param {number}   storyCount       — resolved story count (override > AI detected)
 * @returns {{ wallHeightFt: number, heightSource: string }}
 */
function deriveWallHeight(perPhotoResults, storyCount) {
  // Priority 1 — manual calibration (ruler overlay on photo)
  const manualEaves = perPhotoResults
    .filter(r => r.manually_calibrated
      && r.height_measurement_valid !== false
      && !r.height_anchor_rejected)
    .map(r => Number(r.eave_height_ft))
    .filter(h => h >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT && h <= PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT);

  if (manualEaves.length > 0) {
    const { value, kept, rejected } = robustPhotoHeightAvg(manualEaves);
    const wallHeightFt = Math.round(value * 2) / 2; // nearest 0.5 ft
    const heightSource = rejected.length > 0
      ? `manual_calibration (${kept.length} photo(s), ${rejected.length} outlier(s) rejected)`
      : `manual_calibration (${kept.length} photo(s))`;
    return { wallHeightFt, heightSource, wallHeightSemantics: 'full_elevation', storiesMultiplier: 1 };
  }

  // Priority 2 — calibrated photo anchors (door, garage door, siding courses, window scale)
  //   Skip photos where Gemini had to hard-clamp (value was forced to boundary, not measured).
  const calibratedEaves = perPhotoResults
    .filter(r => CALIBRATED_METHODS.has(r.height_method)
      && !r.height_clamped
      && r.height_measurement_valid !== false
      && !r.height_anchor_rejected)
    .map(r => Number(r.eave_height_ft))
    .filter(h => h >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT && h <= PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT);

  if (calibratedEaves.length >= 1) {
    // Photo anchors are full grade-to-eave elevations. Reject >15%-from-median
    // readings and never apply a story-count multiplier to the result.
    const { value, kept, rejected } = robustPhotoHeightAvg(calibratedEaves);
    const wallHeightFt = Math.round(value * 2) / 2;
    const heightSource = rejected.length > 0
      ? `photo_calibration_full_elevation (${kept.length} anchor(s), ${rejected.length} outlier(s) rejected)`
      : `photo_calibration_full_elevation (${kept.length} anchor(s))`;
    return { wallHeightFt, heightSource, wallHeightSemantics: 'full_elevation', storiesMultiplier: 1 };
  }

  // Priority 3 — formula fallback
  const wallHeightFt = storyCount * DEFAULT_EAVE_PER_STORY;
  return {
    wallHeightFt,
    heightSource: `formula_fallback (no anchors found, ${storyCount} × ${DEFAULT_EAVE_PER_STORY}ft)`,
    wallHeightSemantics: 'per_story',
    storiesMultiplier: storyCount,
  };
}

// ─── 2. Building width + depth ───────────────────────────────────────────────
/**
 * Derive building width (front/back dimension) and depth (side dimension) from
 * per-photo wall_width_ft values.
 *
 * Semantics preserved from the original vite-functions-plugin.js handler:
 *   • label fallback: `view_label` OR `label` (Gemini uses either field)
 *   • detail/close-up shots excluded (too cropped for wall-width estimation)
 *   • width minimum: > 5 ft (< 5 ft is a crop artifact, not a wall measurement)
 *   • cardinal directions: north/south ≡ front/back; east/west ≡ left/right side
 *   • corner shots excluded (they show two walls at once — no single-axis width)
 *
 * Key invariant: when NO side-view photos are present depth must NOT equal width.
 * It is estimated at 0.75 × front width (typical US residential aspect ratio).
 * This was the source of a ~33% overestimation bug before the fix.
 *
 * @param {object[]} perPhotoResults  — all per-photo AI results
 * @param {boolean}  [isGarageJob]    — when true, depth defaults to width × 0.9
 * @returns {{ buildingWidthFt: number, buildingLengthFt: number, depthMissing: boolean }}
 */
function deriveBuildingDimensions(perPhotoResults, isGarageJob = false) {
  const label = (r) => (r.view_label || r.label || '').toLowerCase();

  const isCorner  = (r) => r.is_corner_shot === true || /corner|angle/i.test(label(r));
  const isDetail  = (r) => /detail|close.?up|close up/i.test(label(r));

  // Exclude corner shots AND close-up / detail shots from dimension estimation
  const dimResults = perPhotoResults.filter(r => !isCorner(r) && !isDetail(r));

  // Front/back: explicit labels + cardinal north/south
  const frontBackWidths = dimResults
    .filter(r => /front|back|north|south/i.test(label(r)))
    .map(r => Number(r.wall_width_ft) || 0)
    .filter(w => w > 5);

  // Side: explicit labels + cardinal east/west
  const sideWidths = dimResults
    .filter(r => /side|left|right|east|west/i.test(label(r)))
    .map(r => Number(r.wall_width_ft) || 0)
    .filter(w => w > 5);

  // All usable widths (no label filter) — used as final fallback
  const allWidths = dimResults
    .map(r => Number(r.wall_width_ft) || 0)
    .filter(w => w > 5);

  let buildingWidthFt, buildingLengthFt, depthMissing = false;

  // Robust means: one photo that mistakes a corner shot for a full facade (or
  // includes a neighboring wall) can inflate a plain average by 20%+.
  const robustWidth = (ws) => Math.round(robustAvg(ws).value);

  if (frontBackWidths.length > 0 && sideWidths.length > 0) {
    buildingWidthFt  = robustWidth(frontBackWidths);
    buildingLengthFt = robustWidth(sideWidths);
  } else if (frontBackWidths.length > 0) {
    // No side shots — estimate depth, do NOT use width as depth
    buildingWidthFt  = robustWidth(frontBackWidths);
    buildingLengthFt = Math.round(buildingWidthFt * (isGarageJob ? 0.9 : 0.75));
    depthMissing = true;
  } else if (sideWidths.length > 0) {
    buildingLengthFt = robustWidth(sideWidths);
    buildingWidthFt  = buildingLengthFt;
  } else if (allWidths.length > 0) {
    buildingWidthFt  = robustWidth(allWidths);
    buildingLengthFt = Math.round(buildingWidthFt * (isGarageJob ? 0.9 : 0.75));
    depthMissing = true;
  } else {
    buildingWidthFt  = isGarageJob ? 20 : 24;
    buildingLengthFt = isGarageJob ? 18 : Math.round(24 * 0.75);
    depthMissing = true;
  }

  return { buildingWidthFt, buildingLengthFt, depthMissing };
}

// ─── 3. Gable area ───────────────────────────────────────────────────────────
/**
 * Compute triangular gable area from gable-end photos.
 *
 * Critical: the gable BASE dimension depends on WHICH WALL FACE the photo shows:
 *   • left_side / right_side photo → gable triangle sits at the END of the building
 *     → base = building DEPTH (buildingLengthFt)
 *   • front / back photo           → gable triangle is ABOVE the front/rear wall
 *     → base = building WIDTH  (buildingWidthFt)
 *
 * Using the wrong dimension was a prior bug that inflated gable area when only
 * a side-face photo showed the gable.
 *
 * @param {object[]} gablePhotos      — per-photo results where has_gable_end=true and gable_rise_ft>0
 * @param {number}   buildingWidthFt
 * @param {number}   buildingLengthFt
 * @returns {{ gableAreaSqft: number, gableBaseFt: number }}
 */
function computeGableArea(gablePhotos, buildingWidthFt, buildingLengthFt) {
  if (gablePhotos.length === 0) return { gableAreaSqft: 0, gableBaseFt: 0 };

  const avgRise     = avg(gablePhotos.map(r => Number(r.gable_rise_ft) || 0));
  const gableCount  = 2; // standard gable roof has 2 triangular ends

  const faces = gablePhotos.map(r => (r.wall_face || r.view_label || '').toLowerCase());
  const hasFrontBack = faces.some(f => f.includes('front') || f.includes('back'));
  const hasSide      = faces.some(f => f.includes('left') || f.includes('right') || f.includes('side'));

  let gableBaseFt;
  if (hasSide && !hasFrontBack) {
    gableBaseFt = buildingLengthFt; // side photo → gable base = building depth
  } else if (hasFrontBack && !hasSide) {
    gableBaseFt = buildingWidthFt;  // front/back photo → gable base = building width
  } else {
    gableBaseFt = Math.round((buildingWidthFt + buildingLengthFt) / 2); // mixed/unknown → average
  }

  const gableAreaSqft = Math.round(gableCount * (gableBaseFt * avgRise) / 2);
  return { gableAreaSqft, gableBaseFt };
}

module.exports = {
  deriveWallHeight,
  deriveBuildingDimensions,
  computeGableArea,
  robustAvg,
  median,
  DEFAULT_EAVE_PER_STORY,
  PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT,
  PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT,
  PHOTO_CALIBRATION_OUTLIER_PCT,
  CALIBRATED_METHODS,
};
