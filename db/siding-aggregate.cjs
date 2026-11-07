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

const {
  eaveFeetFromCalibration,
  eaveFeetFromDoorBox,
} = require('../src/utils/photoRuler.cjs');

const DEFAULT_EAVE_PER_STORY = 9;   // ft — spec: 1s=9, 2s=18, 3s=27
const PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT = 7;
const PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT = 28;
const CALIBRATED_METHODS = new Set(['door_anchor', 'garage_door_anchor', 'course_count', 'door_scale', 'window_scale']);
const DOOR_HEIGHT_METHODS = new Set(['door_anchor', 'garage_door_anchor', 'door_scale', 'manual_calibration']);
// A gap this large is a different eave, not noise around one median.
// The old 15%-from-median cut treated that second cluster as outliers.
const EAVE_CLUSTER_GAP_FT = 4;

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

function sampleHeight(value) {
  return typeof value === 'object' && value ? Number(value.height) : Number(value);
}

function sampleWidth(value) {
  const width = typeof value === 'object' && value ? Number(value.width) : 0;
  return Number.isFinite(width) && width > 0 ? width : 1;
}

/**
 * Width-weighted mean of the eaves. A one- or two-photo spike that sits
 * more than 4 ft away from a larger cluster is a ridge read and is left
 * out. A second cluster of three or more photos is a real eave (a wing,
 * a tall wall) and stays in the average. Cutting everything 15% from the
 * median was rejecting that whole cluster.
 * Missing widths share the average equally.
 */
function robustPhotoHeightAvg(values) {
  if (values.length === 0) return { value: 0, kept: [], rejected: [] };
  const ordered = [...values].sort((a, b) => sampleHeight(a) - sampleHeight(b));
  const clusters = [];
  let current = [ordered[0]];
  for (let i = 1; i < ordered.length; i += 1) {
    const gap = sampleHeight(ordered[i]) - sampleHeight(ordered[i - 1]);
    if (gap > EAVE_CLUSTER_GAP_FT) {
      clusters.push(current);
      current = [];
    }
    current.push(ordered[i]);
  }
  clusters.push(current);
  const crowds = clusters.filter(cluster => cluster.length >= 3);
  const keptClusters = crowds.length > 0
    ? crowds
    : (clusters.some(cluster => cluster.length >= 2)
      ? clusters.filter(cluster => cluster.length >= 2)
      : clusters);
  const kept = keptClusters.flat();
  const keptSet = new Set(kept);
  const rejected = values.filter(sample => !keptSet.has(sample));
  const survivors = kept.length > 0 ? kept : values;
  let weight = 0;
  let weighted = 0;
  for (const sample of survivors) {
    const w = sampleWidth(sample);
    weight += w;
    weighted += sampleHeight(sample) * w;
  }
  return {
    value: weight > 0 ? weighted / weight : median(survivors.map(sampleHeight)),
    kept: survivors.map(sampleHeight),
    rejected: rejected.map(sampleHeight),
  };
}

// ─── 1. Wall height ──────────────────────────────────────────────────────────
/**
 * Derive wall eave height from per-photo AI results.
 *
 * Priority order (mirrors the live Vite handler):
 *   1. manually_calibrated photos  (ruler tool override — most authoritative)
 *   2. Photos with a recognised calibrated height_method AND no height_clamped flag
 *   3. Every other valid eave (corners and one-story wings included),
 *      averaged by wall width
 *   4. Formula fallback: storyCount × DEFAULT_EAVE_PER_STORY
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
    .map(r => ({ height: Number(r.eave_height_ft), width: Number(r.wall_width_ft) || 0 }))
    .filter(s => s.height >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT && s.height <= PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT);

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
    .map(r => ({ height: Number(r.eave_height_ft), width: Number(r.wall_width_ft) || 0 }))
    .filter(s => s.height >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT && s.height <= PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT);

  if (calibratedEaves.length >= 1) {
    // Photo anchors are full grade-to-eave elevations. A thin spike away from
    // the main cluster is left out. A second cluster of real eaves is kept.
    // Never apply a story-count multiplier to the result.
    const { value, kept, rejected } = robustPhotoHeightAvg(calibratedEaves);
    const wallHeightFt = Math.round(value * 2) / 2;
    const heightSource = rejected.length > 0
      ? `photo_calibration_full_elevation (${kept.length} anchor(s), ${rejected.length} outlier(s) rejected)`
      : `photo_calibration_full_elevation (${kept.length} anchor(s))`;
    return { wallHeightFt, heightSource, wallHeightSemantics: 'full_elevation', storiesMultiplier: 1 };
  }

  // Priority 3 — every remaining valid eave, including corner shots and
  // one-story wings. A wing photo is a real wall; dropping it and substituting
  // stories × 9 was the height inflation on this path. Width weights a long
  // elevation over a narrow one. One valid reading is the average of one.
  const estimateEaves = perPhotoResults
    .filter(r => !r.height_clamped
      && r.height_measurement_valid !== false
      && !r.height_anchor_rejected)
    .map(r => ({ height: Number(r.eave_height_ft), width: Number(r.wall_width_ft) || 0 }))
    .filter(s => s.height >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT && s.height <= PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT);

  if (estimateEaves.length >= 1) {
    const { value, kept, rejected } = robustPhotoHeightAvg(estimateEaves);
    if (kept.length >= 1) {
      const wallHeightFt = Math.round(value * 2) / 2;
      const heightSource = rejected.length > 0
        ? `photo_calibration_full_elevation (${kept.length} photo(s), ${rejected.length} outlier(s) rejected)`
        : `photo_calibration_full_elevation (${kept.length} photo(s))`;
      return { wallHeightFt, heightSource, wallHeightSemantics: 'full_elevation', storiesMultiplier: 1 };
    }
  }

  // Priority 4 — formula fallback
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

const ONE_STORY_EAVE_MAX_FT = 12;

function isOneStoryWingPhoto(photo) {
  const rows = Number(photo?.window_rows);
  const garageWing = Number(photo?.garage_doors_count) > 0
    && Number.isFinite(rows) && rows > 0 && rows < 2;
  return photo?.is_one_story_wing === true
    || photo?.height_method === 'garage_door_anchor'
    || garageWing;
}

/**
 * A detached garage or other outbuilding is one story. A reading taller than
 * a one-story eave is the house behind it, not the outbuilding wall.
 */
function wallHeightForStructure(measuredFt, { outbuilding = false } = {}) {
  const measured = Number(measuredFt);
  const height = Number.isFinite(measured) && measured > 0 ? measured : DEFAULT_EAVE_PER_STORY;
  if (!outbuilding) return height;
  if (height >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT && height <= ONE_STORY_EAVE_MAX_FT) return height;
  return DEFAULT_EAVE_PER_STORY;
}

/**
 * Feet of perimeter that belong to a one-story wing: the wing face the photo
 * measured, plus footprint length the rectangular box does not already cover.
 */
function wingPerimeterRun(perPhotoResults, { perimeterFt = 0, boxPerimeterFt = 0 } = {}) {
  const wings = (perPhotoResults || []).filter(isOneStoryWingPhoto);
  if (!wings.length) return { runFt: 0, eaveFt: 0 };
  const widths = wings.map((photo) => Number(photo.wall_width_ft)).filter((width) => width > 0);
  const faceFt = widths.length ? Math.max(...widths) : 0;
  const eaves = wings
    .map((photo) => Number(photo.eave_height_ft))
    .filter((height) => height >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT && height <= ONE_STORY_EAVE_MAX_FT);
  const eaveFt = eaves.length
    ? Math.round((eaves.reduce((sum, height) => sum + height, 0) / eaves.length) * 2) / 2
    : DEFAULT_EAVE_PER_STORY;
  const perimeter = Number(perimeterFt) || 0;
  const box = Number(boxPerimeterFt) || 0;
  const jogFt = perimeter > box + 0.5 ? perimeter - box : 0;
  const runFt = Math.min(perimeter || Infinity, faceFt + jogFt);
  return { runFt, eaveFt };
}

/**
 * Wall gross is the footprint prism plus gables, with a one-story wing billed
 * at the wing eave. The total cannot exceed that prism by more than 10%.
 */
function cappedWallGross({
  perimeterFt = 0,
  wallHeightFt = 0,
  gableSqft = 0,
  wingRunFt = 0,
  wingEaveFt = 0,
  bodySqft = 0,
} = {}) {
  const perimeter = Math.max(0, Number(perimeterFt) || 0);
  const height = Math.max(0, Number(wallHeightFt) || 0);
  const gable = Math.max(0, Number(gableSqft) || 0);
  const wingEave = Math.max(0, Number(wingEaveFt) || 0);
  const wingRun = Math.max(0, Math.min(perimeter, Number(wingRunFt) || 0));
  const explicitBody = Math.max(0, Number(bodySqft) || 0);
  const useWing = explicitBody <= 0 && wingRun > 0 && wingEave > 0 && height > wingEave + 0.5;
  const body = explicitBody > 0
    ? explicitBody
    : (useWing
      ? (perimeter - wingRun) * height + wingRun * wingEave
      : perimeter * height);
  const gross = body + gable;
  const cap = body > 0 ? body * 1.1 : 0;
  return cap > 0 ? Math.min(gross, cap) : gross;
}

/**
 * Median eave across the photos that actually measured one. Width weighting
 * and the garage-door cluster were what swung one house from 14.5 ft to 18.5.
 */
function medianPhotoEaveFt(perPhotoResults) {
  const heights = (perPhotoResults || [])
    .filter((photo) => !photo?.height_clamped
      && photo?.height_measurement_valid !== false
      && !photo?.height_anchor_rejected)
    .map((photo) => Number(photo?.eave_height_ft))
    .filter((height) => height >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT
      && height <= PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT);
  return median(heights);
}

// A reading within 2 ft of a story band is that story. Kept for callers that
// still ask for a snap. The billed eave is houseEaveFt, which does not snap.
const STORY_EAVE_BANDS = [[9, 10], [18, 20]];
const EAVE_SNAP_CLOSE_FT = 2;
const BAND_JOIST_FT = 1;

function snapHouseEaveFt(rawFt) {
  const raw = Number(rawFt);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  for (const [lo, hi] of STORY_EAVE_BANDS) {
    const distance = raw < lo ? lo - raw : raw > hi ? raw - hi : 0;
    if (distance > EAVE_SNAP_CLOSE_FT) continue;
    const mid = (lo + hi) / 2;
    return raw <= mid ? lo : hi;
  }
  return Math.round(raw * 2) / 2;
}

function validFullEave(height) {
  return height >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT
    && height <= PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT;
}

function halfFoot(value) {
  return Math.round(Number(value) * 2) / 2;
}

// Door-scaled eaves outside these bands are noise: a one-story wall at
// 13.5 ft, a two-story wall at 8 ft, or a wall at 22–23.5 ft.
const ONE_STORY_BAND = { min: 8.5, max: 12 };
const TWO_STORY_BAND = { min: 16, max: 21 };
const FACE_AGREE_FT = 1.5;

function storyVoteTally(storyReads) {
  const reads = (Array.isArray(storyReads) ? storyReads : [])
    .map((value) => Math.round(Number(value)))
    .filter((value) => value >= 1);
  const tally = new Map();
  for (const value of reads) tally.set(value, (tally.get(value) || 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
  return { reads, ranked };
}

function agreedStoryBand(storyCount, storyReads) {
  const { reads, ranked } = storyVoteTally(storyReads);
  const top = ranked[0];
  const second = ranked[1];
  const votesAgree = Boolean(top)
    && (top[0] === 1 || top[0] === 2)
    && (!second || top[1] > second[1]);
  if (votesAgree) return top[0] === 1 ? ONE_STORY_BAND : TWO_STORY_BAND;
  if (!reads.length) {
    const stories = Math.round(Number(storyCount));
    if (stories === 1) return ONE_STORY_BAND;
    if (stories === 2) return TWO_STORY_BAND;
  }
  return null;
}

function splitLevelVotes(storyReads) {
  const { ranked } = storyVoteTally(storyReads);
  const ones = ranked.find(([value]) => value === 1)?.[1] || 0;
  const twos = ranked.find(([value]) => value === 2)?.[1] || 0;
  if (!(ones > 0 && twos > 0)) return false;
  return Math.min(ones, twos) * 2 >= Math.max(ones, twos);
}

function distanceToBand(value, band) {
  if (value < band.min) return band.min - value;
  if (value > band.max) return value - band.max;
  return 0;
}

function nearestStoryBand(value) {
  const one = distanceToBand(value, ONE_STORY_BAND);
  const two = distanceToBand(value, TWO_STORY_BAND);
  // 14 ft is equidistant. The lower band keeps a split-level near 11–14 ft.
  return one <= two ? ONE_STORY_BAND : TWO_STORY_BAND;
}

function clampToStoryBand(value, band) {
  const chosen = band || nearestStoryBand(value);
  return halfFoot(Math.min(chosen.max, Math.max(chosen.min, value)));
}

function isGarageReference(row) {
  return /garage/.test(String(row?.kind || ''));
}

function isGaragePhoto(photo) {
  return photo?.height_method === 'garage_door_anchor'
    || (Number(photo?.garage_doors_count) || 0) > 0
    || /garage/.test(String(photo?.door_kind || photo?.door_type || ''));
}

function clampReferenceEave(row, band) {
  if (row?.manual || row?.source === 'ruler') return halfFoot(row.eaveFt);
  return clampToStoryBand(row.eaveFt, band);
}

/**
 * Garage doors are not the main wall on a split-level: the garage sits
 * below that floor. A short garage wing is already excluded. A taller
 * garage reading is ignored when the story votes are split, or when it
 * sits more than 1.5 ft under the entry-door median.
 */
function openingSpanFt(opening) {
  const center = Number(opening?.pos_y);
  const height = Number(opening?.height_ft);
  if (!(center > 0) || !(height > 0)) return null;
  return { bottom: center - height / 2, top: center + height / 2 };
}

/**
 * The garage head is at or below the entry threshold. That door is on the
 * lower level of a split-level, so the pixels from it up to the upper eave
 * are not the main-floor wall.
 */
function garageBelowMainFloor(photos) {
  const entries = [];
  const garages = [];
  for (const photo of Array.isArray(photos) ? photos : []) {
    for (const opening of photo?.openings || []) {
      const span = openingSpanFt(opening);
      if (!span) continue;
      const type = String(opening?.type || '');
      if (/garage/.test(type)) garages.push(span);
      else if (/entry/.test(type)) entries.push(span);
    }
  }
  if (!entries.length || !garages.length) return false;
  const sill = median(entries.map((row) => row.bottom));
  const head = median(garages.map((row) => row.top));
  return head <= sill + 1;
}

function selectFullWallReferences(rows, storyReads, { garageBelowMain = false } = {}) {
  const standing = (Array.isArray(rows) ? rows : []).filter((row) => !row.wing);
  const entries = standing.filter((row) => !isGarageReference(row) || row.manual);
  const entryMedian = entries.length ? median(entries.map((row) => row.eaveFt)) : 0;
  const split = splitLevelVotes(storyReads);
  return standing.filter((row) => {
    if (!isGarageReference(row) || row.manual) return true;
    // A garage under the main entry must not become a two-story wall height.
    if (garageBelowMain) return false;
    if (split) return false;
    return !(entryMedian > 0 && row.eaveFt + FACE_AGREE_FT < entryMedian);
  });
}

function fullWallReferences(perPhotoResults, storyReads, options) {
  return selectFullWallReferences(collectHeightReferences(perPhotoResults), storyReads, options);
}

function nonGarageEaveSamples(photos) {
  const samples = [];
  for (const photo of Array.isArray(photos) ? photos : []) {
    if (isGaragePhoto(photo)) continue;
    const eave = Number(photo?.eave_height_ft);
    if (photo?.height_clamped || !validFullEave(eave)) continue;
    samples.push(eave);
  }
  return samples;
}

function nonGarageStoryReads(photos) {
  const reads = [];
  for (const photo of Array.isArray(photos) ? photos : []) {
    if (isGaragePhoto(photo)) continue;
    const story = Math.round(Number(photo?.story_count));
    if (story >= 1) reads.push(story);
  }
  return reads;
}

function agreeingCluster(values, prefer = null) {
  const sorted = values.map(Number).filter((value) => value > 0).sort((a, b) => a - b);
  let best = null;
  for (let start = 0; start < sorted.length; start += 1) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] - sorted[start] <= FACE_AGREE_FT) end += 1;
    if (end - start + 1 < 2) continue;
    const cluster = sorted.slice(start, end + 1);
    if (!best || cluster.length > best.length) {
      best = cluster;
      continue;
    }
    if (cluster.length === best.length && prefer != null) {
      const closer = Math.abs(median(cluster) - prefer) < Math.abs(median(best) - prefer);
      if (closer) best = cluster;
    }
  }
  return best;
}

function doorKindFromPhoto(photo) {
  const explicit = photo?.door_kind || photo?.door_type || photo?.calibration?.presetId;
  if (explicit && explicit !== 'custom') return explicit;
  const openings = Array.isArray(photo?.openings) ? photo.openings : [];
  const garage = openings.find((opening) => /garage/.test(String(opening?.type || '')));
  if (garage || (Number(photo?.garage_doors_count) || 0) > 0 || photo?.height_method === 'garage_door_anchor') {
    const tall = /tall/.test(String(explicit || garage?.door_kind || ''))
      || Number(garage?.height_ft) >= 7.5;
    return tall ? 'tall_garage' : 'garage';
  }
  return 'entry';
}

/**
 * A one-story garage wing. A door-scaled eave above 12.5 ft, or a second
 * row of windows, is the house wall measured from that door — not a wing.
 */
function isShortWingPhoto(photo, eaveFt) {
  const eave = Number(eaveFt) || Number(photo?.eave_height_ft) || 0;
  const rows = Number(photo?.window_rows);
  const garage = photo?.height_method === 'garage_door_anchor'
    || (Number(photo?.garage_doors_count) || 0) > 0
    || /garage/.test(String(photo?.door_kind || photo?.door_type || ''));
  // A two-story wall scaled from a garage door is 16–20 ft. An eave near
  // the 7 ft door is the one-story wing, even if the row count says 2.
  if (garage && eave > 0 && eave <= 12.5) return true;
  if (eave > 12.5) return false;
  if (Number.isFinite(rows) && rows >= 2) return false;
  return photo?.is_one_story_wing === true;
}

/**
 * One photo's grade-to-eave, using the ruler before any story guess.
 * A rep's ruler wins. A detected door box is next (7 ft garage, 8 ft tall
 * garage, 6 ft 8 in entry). A model that already scaled from that door is
 * the same measurement when the box was not returned.
 */
function referenceReading(photo) {
  if (!photo || photo.height_anchor_rejected === true || photo.height_measurement_valid === false) return null;
  const imageW = Number(photo.image_width || photo.natural_width) || 0;
  const imageH = Number(photo.image_height || photo.natural_height) || 0;
  const stored = Number(photo.calibrated_eave_height_ft);
  if (photo.manually_calibrated === true && validFullEave(Number(photo.eave_height_ft))) {
    return { eaveFt: Number(photo.eave_height_ft), source: 'ruler', kind: 'ruler', manual: true };
  }
  if (validFullEave(stored)) {
    return { eaveFt: stored, source: 'ruler', kind: 'ruler', manual: true };
  }
  if (photo.calibration?.lines) {
    const fromLines = eaveFeetFromCalibration(photo.calibration, imageW, imageH);
    if (validFullEave(fromLines)) {
      return {
        eaveFt: fromLines,
        source: 'ruler',
        kind: photo.calibration.presetId || 'door',
        manual: true,
      };
    }
  }
  const eaveY = photo.eave_line_y ?? photo.eave_y;
  if (photo.door_box && eaveY != null && eaveY !== '') {
    const kind = doorKindFromPhoto(photo);
    const fromBox = eaveFeetFromDoorBox({
      doorBox: photo.door_box,
      eaveY: Number(eaveY),
      gradeY: photo.grade_line_y,
      doorKind: kind,
      imageWidth: imageW,
      imageHeight: imageH,
    });
    if (validFullEave(fromBox)) {
      return { eaveFt: fromBox, source: 'door_box', kind, manual: false };
    }
  }
  const anchored = Number(photo.door_anchor_eave_ft);
  if (!photo.height_clamped && validFullEave(anchored)) {
    return { eaveFt: anchored, source: 'door_scale', kind: doorKindFromPhoto(photo), manual: false };
  }
  if (DOOR_HEIGHT_METHODS.has(photo.height_method) && !photo.height_clamped) {
    const eave = Number(photo.eave_height_ft);
    if (validFullEave(eave)) {
      return { eaveFt: eave, source: 'door_scale', kind: doorKindFromPhoto(photo), manual: false };
    }
  }
  return null;
}

function collectHeightReferences(perPhotoResults) {
  const references = [];
  for (const photo of Array.isArray(perPhotoResults) ? perPhotoResults : []) {
    const reading = referenceReading(photo);
    if (!reading) continue;
    const face = canonicalWallFace(photo?.wall_face || photo?.view_label || photo?.label || photo?.face);
    references.push({
      ...reading,
      face: face || null,
      wing: isShortWingPhoto(photo, reading.eaveFt),
    });
  }
  return references;
}

/**
 * Apply a ruler or a detected door before the story clamp. A door-scaled
 * model eave is already on the photo; this only replaces it when the rep
 * drew the ruler or a door box can be measured with the same ratio.
 */
function applyPhotoHeightReference(result, photo = null) {
  if (!result) return result;
  const merged = {
    ...result,
    calibrated_eave_height_ft: photo?.calibrated_eave_height_ft ?? result.calibrated_eave_height_ft,
    calibration: photo?.calibration || result.calibration,
    door_box: photo?.door_box || result.door_box,
    door_type: photo?.door_type || result.door_type,
    door_kind: photo?.door_kind || result.door_kind,
    eave_line_y: photo?.eave_line_y ?? result.eave_line_y,
    grade_line_y: photo?.grade_line_y ?? result.grade_line_y,
    manually_calibrated: photo?.manually_calibrated === true || result.manually_calibrated === true,
    image_width: photo?.image_width || result.image_width,
    image_height: photo?.image_height || result.image_height,
  };
  const reading = referenceReading(merged);
  if (!reading) return result;
  result.door_box = merged.door_box || null;
  result.door_kind = reading.kind;
  result.height_reference = reading.source;
  if (reading.manual || reading.source === 'door_box' || reading.source === 'ruler') {
    result.eave_height_ft = Math.round(reading.eaveFt * 10) / 10;
    result.height_method = reading.manual ? 'manual_calibration' : (
      /garage/.test(String(reading.kind)) ? 'garage_door_anchor' : 'door_scale'
    );
    result.manually_calibrated = reading.manual === true;
    result.height_clamped = false;
    result.height_measurement_valid = true;
    result.height_anchor_rejected = false;
  }
  return result;
}

/**
 * Wall height is a measured eave when a door or the ruler is visible.
 * A door-scaled eave is clamped into the story band the votes picked
 * (one story 8.5–12 ft, two stories 16–21 ft). Split votes snap each
 * reading to the nearer band. The story count times 9 ft, plus 1 ft for
 * the band joist, is only the fallback when no reference was visible and
 * the story votes agree. Empty or split votes with no door use the median
 * of the eave samples, and that median is not snapped onto 10 or 19.
 */
function houseEaveFt({
  storyCount,
  storyReads,
  medianEaveFt,
  referenceEaves,
  perPhotoResults,
  roofEaveCues,
} = {}) {
  const lowerGarage = garageBelowMainFloor(perPhotoResults);
  // A garage below the entry is not evidence that the main wall is two stories.
  const band = lowerGarage ? null : agreedStoryBand(storyCount, storyReads);
  const collected = Array.isArray(referenceEaves)
    ? referenceEaves
      .map(Number)
      .filter((value) => validFullEave(value))
      .map((value) => clampToStoryBand(value, band))
    : fullWallReferences(perPhotoResults, storyReads, { garageBelowMain: lowerGarage })
      .map((row) => clampReferenceEave(row, band))
      .filter((value) => validFullEave(value));
  const refs = collected;
  if (refs.length) {
    const eaveFt = halfFoot(median(refs));
    const spread = Math.max(...refs) - Math.min(...refs);
    return {
      eaveFt,
      uncertain: refs.length >= 2 && spread > 3,
      source: refs.length >= 3
        ? `door_ruler (median of ${refs.length} samples)`
        : `door_ruler (${refs.length} reference${refs.length === 1 ? '' : 's'})`,
      references: refs,
    };
  }
  const stories = Math.round(Number(storyCount));
  const reads = (Array.isArray(storyReads) ? storyReads : [])
    .map((value) => Math.round(Number(value)))
    .filter((value) => value >= 1);
  const fixed = stories >= 1 ? stories * DEFAULT_EAVE_PER_STORY + BAND_JOIST_FT : 0;
  const tally = new Map();
  for (const value of reads) tally.set(value, (tally.get(value) || 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
  const top = ranked[0];
  const second = ranked[1];
  const agreed = Boolean(top) && top[0] === stories && (!second || top[1] > second[1]);
  // A missing vote is not agreement. Garage-anchored photos used to be
  // skipped, the read list came back empty, and the house flipped between
  // 10 ft and 19 ft with the story chip.
  const certain = (stories === 1 || stories === 2) && reads.length > 0 && agreed && !lowerGarage;
  if (lowerGarage) {
    const mainFloor = nonGarageEaveSamples(perPhotoResults);
    if (mainFloor.length) {
      const eaveFt = halfFoot(median(mainFloor));
      return {
        eaveFt,
        uncertain: true,
        source: `main_floor (${eaveFt}ft, garage is below the entry)`,
        references: mainFloor,
      };
    }
    // The garage's own story votes are not the main wall. A one-story
    // agreement on the other photos is 10 ft. Anything else must not
    // become the 19 ft two-story formula.
    const mainBand = agreedStoryBand(null, nonGarageStoryReads(perPhotoResults));
    if (mainBand === ONE_STORY_BAND) {
      const eaveFt = DEFAULT_EAVE_PER_STORY + BAND_JOIST_FT;
      return {
        eaveFt,
        uncertain: true,
        source: `story_height (1 × 9ft + 1ft band joist, garage is below the entry)`,
      };
    }
    const cues = [];
    for (const cue of Array.isArray(roofEaveCues) ? roofEaveCues : []) {
      const height = Number(cue);
      if (validFullEave(height)) cues.push(height);
    }
    if (cues.length) {
      const eaveFt = halfFoot(median(cues));
      return {
        eaveFt,
        uncertain: true,
        source: `raw_median (${eaveFt}ft, garage is below the entry)`,
        references: cues,
      };
    }
    return {
      eaveFt: 0,
      uncertain: true,
      source: 'garage_below_entry',
      suppressTwoStoryFloor: true,
    };
  }
  if (certain && fixed > 0) {
    return {
      eaveFt: fixed,
      uncertain: false,
      source: `story_height (${stories} × 9ft + 1ft band joist)`,
    };
  }
  const samples = [];
  const raw = Number(medianEaveFt);
  if (raw > 0) samples.push(raw);
  for (const cue of Array.isArray(roofEaveCues) ? roofEaveCues : []) {
    const height = Number(cue);
    if (validFullEave(height)) samples.push(height);
  }
  if (samples.length) {
    const eaveFt = halfFoot(median(samples));
    return {
      eaveFt,
      uncertain: true,
      source: `raw_median (${eaveFt}ft, story count uncertain)`,
    };
  }
  if (fixed > 0) {
    return {
      eaveFt: fixed,
      uncertain: stories !== 1 && stories !== 2,
      source: `story_height (${stories} × 9ft + 1ft band joist)`,
    };
  }
  return { eaveFt: 0, uncertain: true, source: 'none' };
}

function parsePitchRisePer12(pitch) {
  if (typeof pitch === 'number' && Number.isFinite(pitch)) return pitch;
  const text = String(pitch || '');
  const labeled = text.match(/(\d+(?:\.\d+)?)\s*\/\s*12/);
  if (labeled) return Number(labeled[1]);
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function azimuthGap(left, right) {
  let delta = Math.abs(left - right) % 360;
  if (delta > 180) delta = 360 - delta;
  return delta;
}

function rakeHorizontalRun(edge) {
  const length = Number(edge?.length_ft);
  const drop = Math.abs(Number(edge?.h2) - Number(edge?.h1));
  if (!(length > drop) || !(drop > 0)) return 0;
  return Math.sqrt((length * length) - (drop * drop));
}

function slopeRecord(facet, housePitch) {
  const edges = Array.isArray(facet?.edges) ? facet.edges : [];
  const azimuth = Number(facet?.azimuth ?? facet?.azimuth_degrees);
  const area = Number(facet?.area_sqft ?? facet?.area) || 0;
  if (!Number.isFinite(azimuth) || !(area > 0)) return null;
  const rakes = edges.filter((edge) => edge.type === 'rake');
  const hips = edges.filter((edge) => edge.type === 'hip').length;
  const ridges = edges.filter((edge) => edge.type === 'ridge').length;
  const runs = rakes.map(rakeHorizontalRun).filter((run) => run > 0).sort((a, b) => a - b);
  return {
    azimuth: ((azimuth % 360) + 360) % 360,
    area,
    hips,
    rakes: rakes.length,
    ridges,
    run: runs.length ? runs[Math.floor(runs.length / 2)] : 0,
    edgesKnown: edges.length > 0,
    gable: edges.length > 0 && hips === 0 && ridges >= 1 && rakes.length >= 2,
    pitch: parsePitchRisePer12(facet?.pitch) || housePitch,
  };
}

// 0.5 × span × (span / 2) × (pitch rise / 12). Pitch rise is the rise per
// foot of run. A 6/12 on a 20 ft gable end is 50 sqft, not zero.
function gableTriangleSqft(span, risePer12) {
  if (!(span > 0) || !(risePer12 > 0)) return 0;
  return (span * (span / 2) * (risePer12 / 12)) / 2;
}

/**
 * Gable triangles from the roof pitch and the gable-end edges.
 * A gable end is the wall perpendicular to a slope that has a ridge and rakes.
 * The span is the eave-to-eave run of that slope pair (the footprint edge when
 * the facets have no edge list). A hip on the opposite slope is one triangle,
 * not a pair, and a hip with no rake is none. The triangle is billed. It is
 * not replaced with 0 for being larger than a fraction of the eave wall.
 */
// Walsh's photos read the lower gambrel at 18/12 over a 5/12 cap on the same
// face. A lone steep slope, a gable end, or one photo of that pair is not.
const GAMBREL_PAIRED_LOWER_RISE = 18;
const GAMBREL_UPPER_MAX_RISE = 8;
const WALL_FACE_NAMES = ['front', 'back', 'left_side', 'right_side'];
const PERPENDICULAR_FACES = {
  front: ['left_side', 'right_side'],
  back: ['left_side', 'right_side'],
  left_side: ['front', 'back'],
  right_side: ['front', 'back'],
};

function canonicalWallFace(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('left')) return 'left_side';
  if (text.includes('right')) return 'right_side';
  if (text.includes('back') || text.includes('rear')) return 'back';
  if (text.includes('front')) return 'front';
  return '';
}

function faceForSlopeAzimuth(azimuth, bearings) {
  if (!bearings) return '';
  let best = '';
  let bestGap = 30;
  for (const face of WALL_FACE_NAMES) {
    const bearing = Number(bearings[face]);
    if (!Number.isFinite(bearing)) continue;
    const gap = azimuthGap(azimuth, bearing);
    if (gap <= bestGap) {
      bestGap = gap;
      best = face;
    }
  }
  return best;
}

const OPPOSITE_FACE = {
  front: 'back',
  back: 'front',
  left_side: 'right_side',
  right_side: 'left_side',
};

/**
 * Faces where at least two photos each show a steep lower plane and a
 * shallow upper cap on the same roof face. Planes labeled with a face stay
 * on that face. Unlabeled planes use the photo's wall. A single pitch, a
 * solar facet, and one photo of the pair do not count.
 */
function gambrelEndFaces(photos) {
  const counts = new Map();
  for (const photo of Array.isArray(photos) ? photos : []) {
    const planes = Array.isArray(photo?.roof_planes) ? photo.roof_planes : [];
    if (planes.length < 2) continue;
    const photoFace = canonicalWallFace(photo?.wall_face || photo?.view_label || photo?.label || photo?.face);
    const byFace = new Map();
    for (const plane of planes) {
      const pitch = parsePitchRisePer12(plane?.pitch ?? plane?.pitch_rise);
      if (!(pitch > 0)) continue;
      const labeled = canonicalWallFace(plane?.face || plane?.wall_face);
      const face = labeled || photoFace;
      if (!face) continue;
      if (!byFace.has(face)) byFace.set(face, []);
      byFace.get(face).push(pitch);
    }
    for (const [face, pitches] of byFace) {
      const steep = pitches.some((pitch) => pitch >= GAMBREL_PAIRED_LOWER_RISE);
      const shallow = pitches.some((pitch) => pitch <= GAMBREL_UPPER_MAX_RISE);
      if (!(steep && shallow)) continue;
      counts.set(face, (counts.get(face) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, count]) => count >= 2).map(([face]) => face);
}

function roofPlateCues(roofFacets) {
  const cues = [];
  for (const facet of Array.isArray(roofFacets) ? roofFacets : []) {
    const grade = Number(facet?.grade_to_eave_ft);
    if (validFullEave(grade)) cues.push(grade);
  }
  return cues;
}

/**
 * Story height per face. A door or ruler on that face is the eave. A
 * full-wall reference fills faces that have none, ahead of the story
 * guess. A short garage wing stays on its own door and does not set the
 * rest of the house. A gambrel side is one story and a gambrel end is the
 * silhouette only when two photos show a steep lower plane and a shallow
 * cap on the same face. A roof a story below that plate can lower a face
 * on that confirmed gambrel. An ordinary gable is left at the house eave.
 */
function faceEavesFt({
  houseEaveFt: houseEave = 0,
  storyCount = 1,
  storyReads = [],
  bearings = null,
  gableFaces = [],
  roofFacets = [],
  perPhotoResults = [],
} = {}) {
  const storyFull = Math.max(0, Number(houseEave) || 0);
  const oneStory = DEFAULT_EAVE_PER_STORY + BAND_JOIST_FT;
  const lowerGarage = garageBelowMainFloor(perPhotoResults);
  const band = lowerGarage ? null : agreedStoryBand(storyCount, storyReads);
  const kept = selectFullWallReferences(
    collectHeightReferences(perPhotoResults),
    storyReads,
    { garageBelowMain: lowerGarage },
  );
  const byFace = Object.fromEntries(WALL_FACE_NAMES.map((face) => [face, []]));
  for (const row of kept) {
    if (row.face && byFace[row.face]) byFace[row.face].push(row);
  }
  const fullWall = kept.map((row) => clampReferenceEave(row, band));
  const cues = roofPlateCues(roofFacets);
  const fill = fullWall.length
    ? halfFoot(median(fullWall))
    : (cues.length && !(storyFull > 0) ? halfFoot(median(cues)) : storyFull);
  const local = new Set();
  const eaves = {};
  for (const face of WALL_FACE_NAMES) {
    const rows = byFace[face];
    const manuals = rows.filter((row) => row.manual || row.source === 'ruler');
    const cluster = agreeingCluster(rows.map((row) => row.eaveFt), fill);
    if (cluster) {
      const manualCluster = cluster.every((value) => manuals.some((row) => row.eaveFt === value));
      const eaveFt = manualCluster
        ? halfFoot(median(cluster))
        : clampToStoryBand(median(cluster), band);
      eaves[face] = eaveFt;
      local.add(face);
    } else if (manuals.length) {
      eaves[face] = halfFoot(median(manuals.map((row) => row.eaveFt)));
      local.add(face);
    } else {
      eaves[face] = fill;
    }
  }
  const stories = Math.round(Number(storyCount) || 0);
  const ends = new Set();
  const profile = fill > 0 ? fill : storyFull;
  const oneStoryFaces = new Set();
  const gambrelEnds = new Set();
  const markSide = (face) => {
    if (!face || ends.has(face) || local.has(face)) return;
    oneStoryFaces.add(face);
  };
  const markEnd = (face) => {
    if (!face || local.has(face)) return;
    ends.add(face);
  };
  // Two photos of a steep lower plane plus a shallow cap on one face. The
  // opposite elevation is the other end of that roof. The walls beside
  // those ends are the one-story sides. gableFaces and a lone steep facet
  // do not start this.
  void gableFaces;
  const confirmedEnds = gambrelEndFaces(perPhotoResults);
  const gambrel = stories >= 2 && profile > oneStory + 0.5 && confirmedEnds.length > 0;
  if (gambrel) {
    for (const face of confirmedEnds) {
      markEnd(face);
      markEnd(OPPOSITE_FACE[face]);
    }
    for (const face of ends) {
      for (const side of PERPENDICULAR_FACES[face] || []) markSide(side);
    }
    for (const face of oneStoryFaces) eaves[face] = oneStory;
    // The end silhouette is the plate plus half the rise to the full eave.
    // The rectangular two-story wall plus the gable triangle bills the
    // sloping upper wall a second time.
    const silhouette = halfFoot((oneStory + profile) / 2);
    for (const face of ends) {
      if (local.has(face)) continue;
      eaves[face] = silhouette;
      gambrelEnds.add(face);
    }
    for (const facet of Array.isArray(roofFacets) ? roofFacets : []) {
      const offset = Number(facet?.elevation_offset_ft);
      const azimuth = Number(facet?.azimuth ?? facet?.azimuth_degrees);
      if (!(offset <= -4) || !Number.isFinite(azimuth)) continue;
      const face = faceForSlopeAzimuth(azimuth, bearings);
      if (!face || local.has(face)) continue;
      const lowered = halfFoot(Math.max(oneStory - 2, profile + offset));
      if (lowered > 0 && lowered + 0.5 < eaves[face]) eaves[face] = lowered;
    }
  }
  let source = 'house_eave';
  if (fullWall.length) source = lowerGarage ? 'main_floor' : 'door_ruler';
  else if (oneStoryFaces.size || gambrelEnds.size) source = 'gambrel_side_eave';
  const references = kept.filter((row) => row.face).map((row) => ({
    face: row.face,
    eaveFt: clampReferenceEave(row, band),
    source: row.source,
    kind: row.kind,
    samples: 1,
    wing: false,
  }));
  // The garage under the entry was not a wall height. The other photos'
  // eaves are what the house used, and the response should list them.
  if (lowerGarage && references.length === 0) {
    for (const photo of Array.isArray(perPhotoResults) ? perPhotoResults : []) {
      if (isGaragePhoto(photo)) continue;
      const eave = Number(photo?.eave_height_ft);
      if (photo?.height_clamped || !validFullEave(eave)) continue;
      const face = canonicalWallFace(photo?.wall_face || photo?.view_label || photo?.label || photo?.face);
      if (!face) continue;
      references.push({
        face,
        eaveFt: halfFoot(eave),
        source: 'main_floor',
        kind: String(photo?.height_method || 'eave'),
        samples: 1,
        wing: false,
      });
    }
  }
  return {
    eaves,
    oneStoryFaces: [...oneStoryFaces],
    gambrelEnds: [...gambrelEnds],
    references,
    source,
  };
}

const CONFIRMED_ONE_STORY_FT = DEFAULT_EAVE_PER_STORY + BAND_JOIST_FT;
const CONFIRMED_TWO_STORY_FT = 2 * DEFAULT_EAVE_PER_STORY + BAND_JOIST_FT;
const CONFIRMED_SPLIT_FT = 11;
const CONFIRMED_SILHOUETTE_FT = halfFoot((CONFIRMED_ONE_STORY_FT + CONFIRMED_TWO_STORY_FT) / 2);
const CONFIRMED_FACES = ['front', 'back', 'left_side', 'right_side'];

function exactEaveFt(value) {
  const eave = Number(value);
  if (!(eave > 0)) return 0;
  return Math.round(eave * 10) / 10;
}

function normalizeConfirmedStories(value) {
  if (value === 1 || value === '1') return 1;
  if (value === 2 || value === '2') return 2;
  if (value === 1.5 || value === '1.5' || value === 'gambrel' || value === 'cape') return 1.5;
  if (value === 'split' || value === 'split-level') return 'split';
  return null;
}

/**
 * Hover's per-wall height is wall area divided by width. The story label
 * is only the chip; a ruler source keeps the measured feet.
 */
function storiesForHoverEave(eaveFt) {
  const eave = Number(eaveFt);
  if (!(eave > 0)) return null;
  if (eave < 10.5) return 1;
  if (eave < 13.25) return 'split';
  if (eave < 16.25) return 1.5;
  return 2;
}

function normalizeConfirmedFaceHeights(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const face of CONFIRMED_FACES) {
    const value = input[face];
    if (!value || value.confirmed === false) continue;
    const stories = normalizeConfirmedStories(value.stories);
    const eave = exactEaveFt(value.eave_ft);
    const source = value.source === 'ruler' ? 'ruler' : 'tap';
    if (stories == null && !(source === 'ruler' && eave > 0)) continue;
    out[face] = {
      stories: stories == null ? storiesForHoverEave(eave) : stories,
      ...(eave > 0 ? { eave_ft: eave } : {}),
      source,
    };
  }
  return out;
}

function eaveForConfirmedFace(entry, face, endFaces) {
  if (!entry) return 0;
  if (entry.source === 'ruler' && entry.eave_ft > 0) return entry.eave_ft;
  if (entry.stories === 1) return CONFIRMED_ONE_STORY_FT;
  if (entry.stories === 2) return CONFIRMED_TWO_STORY_FT;
  if (entry.stories === 'split') return entry.eave_ft > 0 ? entry.eave_ft : CONFIRMED_SPLIT_FT;
  if (entry.stories === 1.5) {
    return endFaces.has(face) ? CONFIRMED_SILHOUETTE_FT : CONFIRMED_ONE_STORY_FT;
  }
  return entry.eave_ft > 0 ? entry.eave_ft : 0;
}

/**
 * A rep-confirmed height replaces the AI eave on that face. One story is
 * 10 ft, two stories 19 ft, and a split-level is 11 ft unless the rep
 * edited it. A 1.5 / gambrel / cape tap sets the side to 10 ft and the
 * gable ends to the silhouette between 10 and 19. A ruler eave is exact
 * and does not rewrite the other walls.
 */
function applyConfirmedFaceHeights(faceEaves, confirmed, {
  gableFaces = [],
  gambrelEnds = [],
} = {}) {
  const aiEaves = { ...(faceEaves?.eaves || {}) };
  const eaves = { ...aiEaves };
  const normalized = normalizeConfirmedFaceHeights(confirmed);
  const endFaces = new Set([
    ...(Array.isArray(gableFaces) ? gableFaces : []),
    ...(Array.isArray(gambrelEnds) ? gambrelEnds : []),
    ...(Array.isArray(faceEaves?.gambrelEnds) ? faceEaves.gambrelEnds : []),
  ]);
  const locked = new Set();
  const sideTaps = [];
  const endTaps = [];
  const applied = {};
  for (const [face, entry] of Object.entries(normalized)) {
    const eave = eaveForConfirmedFace(entry, face, endFaces);
    if (!(eave > 0)) continue;
    eaves[face] = eave;
    locked.add(face);
    applied[face] = { ...entry, eave_ft: eave };
    if (entry.stories === 1.5 && entry.source !== 'ruler') {
      if (endFaces.has(face)) endTaps.push(face);
      else sideTaps.push(face);
    }
  }
  const setUnlocked = (face, eave) => {
    if (!face || locked.has(face) || !(eave > 0)) return;
    eaves[face] = eave;
    locked.add(face);
    applied[face] = {
      stories: eave === CONFIRMED_SILHOUETTE_FT ? 1.5 : 1,
      eave_ft: eave,
      source: 'tap',
    };
  };
  for (const face of sideTaps) {
    setUnlocked(OPPOSITE_FACE[face], CONFIRMED_ONE_STORY_FT);
    for (const end of PERPENDICULAR_FACES[face] || []) setUnlocked(end, CONFIRMED_SILHOUETTE_FT);
  }
  for (const face of endTaps) {
    setUnlocked(OPPOSITE_FACE[face], CONFIRMED_SILHOUETTE_FT);
    for (const side of PERPENDICULAR_FACES[face] || []) setUnlocked(side, CONFIRMED_ONE_STORY_FT);
  }
  return {
    ...(faceEaves || {}),
    eaves,
    aiEaves,
    confirmed: applied,
    source: Object.keys(applied).length ? 'rep_confirmed' : (faceEaves?.source || 'house_eave'),
  };
}

/**
 * Bench mode C. Hover's per-wall height is that wall's area divided by
 * its width, locked as a ruler eave so the AI height cannot swing it.
 * Confirmed material shares ride along in the same payload.
 */
function confirmedHeightsFromHoverWalls(walls) {
  const rows = [];
  for (const wall of Array.isArray(walls) ? walls : []) {
    const face = canonicalWallFace(wall?.face || wall?.wall_face);
    if (!face) continue;
    const width = Number(wall?.width_ft ?? wall?.width);
    const area = Number(wall?.area_sqft ?? wall?.wall_area_sqft ?? wall?.gross_wall_area_sqft);
    const derived = Number(wall?.eave_ft) > 0
      ? Number(wall.eave_ft)
      : (width > 0 && area > 0 ? area / width : 0);
    if (!(derived > 0)) continue;
    const eave = exactEaveFt(derived);
    rows.push([face, {
      stories: storiesForHoverEave(eave),
      eave_ft: eave,
      source: 'ruler',
    }]);
  }
  return Object.fromEntries(rows);
}

function confirmedModeC({ walls, materials } = {}) {
  const confirmedMaterials = {};
  const input = materials && typeof materials === 'object' ? materials : {};
  for (const face of CONFIRMED_FACES) {
    const value = input[face];
    if (!value || value.confirmed === false) continue;
    const shares = value.shares || value;
    if (!shares || typeof shares !== 'object' || Array.isArray(shares)) continue;
    confirmedMaterials[face] = { confirmed: true, shares: { ...shares } };
  }
  return {
    confirmed_face_heights: confirmedHeightsFromHoverWalls(walls),
    confirmed_face_materials: confirmedMaterials,
  };
}

function gableAreaFromPitch({ bearings, widths, pitch, roofFacets } = {}) {
  const none = { gableAreaSqft: 0, byFace: {}, gableFaces: [], reason: 'no_gable_end' };
  const risePer12 = parsePitchRisePer12(pitch);
  if (!(risePer12 > 0) || !bearings || !widths) return { ...none, reason: 'no_pitch' };
  const slopes = (Array.isArray(roofFacets) ? roofFacets : [])
    .map((facet) => slopeRecord(facet, risePer12))
    .filter(Boolean);
  const byFace = {};
  const gableFaces = [];
  let total = 0;
  const add = (face, span, pitchRise) => {
    const area = gableTriangleSqft(span, pitchRise);
    if (!(area > 0)) return;
    byFace[face] = (byFace[face] || 0) + area;
    total += area;
    if (!gableFaces.includes(face)) gableFaces.push(face);
  };
  const endBearings = (azimuth) => [(azimuth + 90) % 360, (azimuth + 270) % 360];
  const matchingFaces = (azimuth) => ['front', 'back', 'left_side', 'right_side'].filter((face) => {
    const bearing = Number(bearings[face]);
    return Number.isFinite(bearing)
      && endBearings(azimuth).some((target) => azimuthGap(bearing, target) <= 30)
      && (Number(widths[face]) || 0) > 0;
  });
  const edgesKnown = slopes.some((slope) => slope.edgesKnown);

  if (edgesKnown) {
    // The main gable is the largest slope that actually has two rakes.
    // Pair it with the opposite gable when there is one. A hip opposite
    // keeps the single rake end. Other facets are wings and valleys; adding
    // every one of them billed the same wall several times over.
    const gables = slopes
      .map((slope, index) => ({ slope, index }))
      .filter((row) => row.slope.gable)
      .sort((a, b) => b.slope.area - a.slope.area);
    const main = gables[0];
    if (main && main.slope.run > 0) {
      const target = (main.slope.azimuth + 180) % 360;
      let opposite = null;
      let oppositeGap = 25;
      slopes.forEach((slope, index) => {
        if (index === main.index) return;
        const gap = azimuthGap(slope.azimuth, target);
        if (gap < oppositeGap) {
          oppositeGap = gap;
          opposite = slope;
        }
      });
      const faces = matchingFaces(main.slope.azimuth);
      const mate = opposite && opposite.gable && opposite.run > 0 ? opposite : null;
      if (mate) {
        const span = main.slope.run + mate.run;
        const pitchRise = (main.slope.pitch + mate.pitch) / 2;
        const ends = Math.min(2, faces.length);
        for (let i = 0; i < ends; i += 1) add(faces[i], span, pitchRise);
      } else if (opposite && opposite.hips > 0 && opposite.run > 0 && faces[0]) {
        add(faces[0], main.slope.run + opposite.run, main.slope.pitch);
      } else {
        const span = main.slope.run * 2;
        const ends = Math.min(2, faces.length);
        for (let i = 0; i < ends; i += 1) add(faces[i], span, main.slope.pitch);
      }
    }
  } else if (slopes.length >= 2) {
    const ordered = [...slopes].sort((a, b) => b.area - a.area);
    const oppositeTarget = (ordered[0].azimuth + 180) % 360;
    const opposite = ordered.slice(1).find((slope) => azimuthGap(slope.azimuth, oppositeTarget) <= 25);
    if (opposite) {
      for (const face of matchingFaces(ordered[0].azimuth)) add(face, Number(widths[face]) || 0, risePer12);
    }
  }

  const roundedByFace = {};
  for (const [face, area] of Object.entries(byFace)) {
    roundedByFace[face] = Math.round(area * 100) / 100;
  }
  return {
    gableAreaSqft: Math.round(total),
    byFace: roundedByFace,
    gableFaces,
    reason: total > 0 ? 'pitch_times_gable_span' : 'no_gable_end',
  };
}

module.exports = {
  deriveWallHeight,
  deriveBuildingDimensions,
  computeGableArea,
  wallHeightForStructure,
  wingPerimeterRun,
  cappedWallGross,
  isOneStoryWingPhoto,
  medianPhotoEaveFt,
  snapHouseEaveFt,
  houseEaveFt,
  faceEavesFt,
  applyConfirmedFaceHeights,
  confirmedModeC,
  confirmedHeightsFromHoverWalls,
  storiesForHoverEave,
  referenceReading,
  collectHeightReferences,
  applyPhotoHeightReference,
  gableAreaFromPitch,
  robustAvg,
  median,
  DEFAULT_EAVE_PER_STORY,
  PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT,
  PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT,
  EAVE_CLUSTER_GAP_FT,
  CALIBRATED_METHODS,
};
