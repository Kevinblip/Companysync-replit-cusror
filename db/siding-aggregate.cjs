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

function spreadRatio(values) {
  if (values.length < 2) return 0;
  const center = median(values);
  if (!(center > 0)) return 0;
  return (Math.max(...values) - Math.min(...values)) / center;
}

/**
 * Length of one building axis when both opposite elevations were measured.
 *
 * Hover adds the two elevations. A robust average of every side photo pooled
 * together does the opposite: three short reads of one wall can reject two
 * agreeing reads of the other wall, and the short length is then mirrored
 * onto both sides. Each face is reduced on its own first. The two surviving
 * face lengths are then averaged so `2 × axis = left + right` (or front + back).
 *
 * The one exception is the single uncorroborated outlier — one photo of a
 * wall that disagrees with two or more agreeing photos of the opposite wall.
 * That is the Hover-garage failure (a back photo that included the background).
 * Repeating it onto both walls would inflate the building; copying the
 * corroborated elevation is the right call there.
 *
 * @returns {number|null} axis length (the mean of the two elevation lengths)
 */
function sumOppositeElevations(aWidths, bWidths) {
  if (aWidths.length === 0 && bWidths.length === 0) return null;
  const a = aWidths.length ? robustAvg(aWidths).value : null;
  const b = bWidths.length ? robustAvg(bWidths).value : null;
  if (a == null) return b;
  if (b == null) return a;

  const aStats = robustAvg(aWidths);
  const bStats = robustAvg(bWidths);
  const aTight = aWidths.length >= 2 && aStats.rejected.length === 0 && spreadRatio(aWidths) <= 0.15;
  const bTight = bWidths.length >= 2 && bStats.rejected.length === 0 && spreadRatio(bWidths) <= 0.15;
  const pooled = robustAvg([...aWidths, ...bWidths]);
  let aVal = a;
  let bVal = b;
  if (aWidths.length === 1 && bTight && pooled.rejected.includes(aWidths[0])) aVal = b;
  else if (bWidths.length === 1 && aTight && pooled.rejected.includes(bWidths[0])) bVal = a;
  return (aVal + bVal) / 2;
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

  const widthsFor = (pred) => dimResults
    .filter(pred)
    .map(r => Number(r.wall_width_ft) || 0)
    .filter(w => w > 5);
  const faceLabel = label;
  const isLeftFace = (r) => /\bleft\b|left_side|\bwest\b/.test(faceLabel(r));
  const isRightFace = (r) => /\bright\b|right_side|\beast\b/.test(faceLabel(r));
  const isFrontFace = (r) => /front|\bsouth\b/.test(faceLabel(r)) && !isLeftFace(r) && !isRightFace(r);
  const isBackFace = (r) => /back|rear|\bnorth\b/.test(faceLabel(r)) && !isLeftFace(r) && !isRightFace(r);
  const frontWidths = widthsFor(isFrontFace);
  const backWidths = widthsFor(isBackFace);
  const leftWidths = widthsFor(isLeftFace);
  const rightWidths = widthsFor(isRightFace);

  let buildingWidthFt, buildingLengthFt, depthMissing = false;

  // Robust means: one photo that mistakes a corner shot for a full facade (or
  // includes a neighboring wall) can inflate a plain average by 20%+.
  const robustWidth = (ws) => Math.round(robustAvg(ws).value);
  // Opposite elevations are added (each face keeps its own length) unless a
  // single photo is an outlier against a corroborated opposite wall.
  const summedFrontBack = (frontWidths.length + backWidths.length) === frontBackWidths.length
    ? sumOppositeElevations(frontWidths, backWidths)
    : null;
  const summedSides = (leftWidths.length + rightWidths.length) === sideWidths.length
    ? sumOppositeElevations(leftWidths, rightWidths)
    : null;

  if (frontBackWidths.length > 0 && sideWidths.length > 0) {
    buildingWidthFt  = summedFrontBack != null ? Math.round(summedFrontBack) : robustWidth(frontBackWidths);
    buildingLengthFt = summedSides != null ? Math.round(summedSides) : robustWidth(sideWidths);
  } else if (frontBackWidths.length > 0) {
    // No side shots — estimate depth, do NOT use width as depth
    buildingWidthFt  = robustWidth(frontBackWidths);
    buildingLengthFt = Math.round(buildingWidthFt * (isGarageJob ? 0.9 : 0.75));
    depthMissing = true;
  } else if (sideWidths.length > 0) {
    buildingLengthFt = summedSides != null ? Math.round(summedSides) : robustWidth(sideWidths);
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

function canonicalPlaneFace(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('left')) return 'left_side';
  if (raw.includes('right')) return 'right_side';
  if (raw.includes('back') || raw.includes('rear') || raw.includes('north')) return 'back';
  if (raw.includes('front') || raw.includes('south')) return 'front';
  return 'unknown';
}

function normalizeReportedPlane(raw, photo) {
  if (!raw || typeof raw !== 'object') return null;
  const width = Number(raw.width_ft ?? raw.wall_width_ft) || 0;
  const eave = Number(raw.eave_height_ft ?? raw.wall_height_ft) || 0;
  const role = String(raw.role || 'wall').toLowerCase().replace(/\s+/g, '_');
  const explicitlyUnsided = raw.sided === false || role === 'chimney' || role === 'masonry';
  const openPorch = role === 'porch' && raw.sided !== true;
  const sided = !explicitlyUnsided && !openPorch;
  if (sided && (width <= 5 || eave <= 0)) return null;
  if (!sided && (width <= 2 || eave <= 0)) return null;
  const rise = Math.max(0, Number(raw.gable_rise_ft) || 0);
  const gableSided = sided && raw.gable_sided !== false && role !== 'porch' && rise > 0;
  const nonSiding = sided
    ? Math.max(0, Math.min(100, Number(raw.non_siding_pct) || 0))
    : 100;
  const occlusion = Math.max(0, Math.min(100, Number(raw.occlusion_pct) || (raw.occluded === true ? 40 : 0)));
  const stories = Number(raw.story_count || raw.stories) || (eave >= 16 ? 2 : 1);
  // A two-story gable measured at a first-floor eave drops the upper wall.
  const eaveFt = stories >= 2 && eave > 0 && eave < 16 ? 17 : Math.max(0, Math.min(28, eave));
  return {
    plane_id: String(raw.plane_id || raw.id || role).toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 40),
    role,
    face: canonicalPlaneFace(raw.face || raw.wall_face || photo?.wall_face),
    width_ft: width,
    eave_height_ft: eaveFt,
    gable_rise_ft: gableSided ? Math.min(rise, 16) : 0,
    reported_gable_rise_ft: rise,
    gable_sided: gableSided,
    sided,
    include_in_takeoff: sided,
    non_siding_pct: nonSiding,
    non_siding_material: raw.non_siding_material && raw.non_siding_material !== 'none'
      ? String(raw.non_siding_material).toLowerCase()
      : (role === 'chimney' ? 'brick' : null),
    occluded: raw.occluded === true || occlusion >= 25,
    occlusion_pct: occlusion,
    outside_corners: Math.max(0, Number(raw.outside_corners ?? raw.outside_corners_visible) || 0),
    inside_corners: Math.max(0, Number(raw.inside_corners ?? raw.inside_corners_visible) || 0),
    stories,
    width_source: 'photo',
  };
}

function planesAreSameWall(a, b) {
  if (a.sided !== b.sided) return false;
  const wallRoles = new Set(['main', 'wing', 'gable_end', 'garage', 'wall']);
  const bothWalls = wallRoles.has(a.role) && wallRoles.has(b.role);
  if (!bothWalls && a.role !== b.role) return false;
  const widthBase = Math.max(a.width_ft, b.width_ft);
  const eaveBase = Math.max(a.eave_height_ft, b.eave_height_ft);
  if (!(widthBase > 0) || !(eaveBase > 0)) return false;
  const widthRatio = Math.min(a.width_ft, b.width_ft) / widthBase;
  const eaveRatio = Math.min(a.eave_height_ft, b.eave_height_ft) / eaveBase;
  const sameFace = a.face === b.face || a.face === 'unknown' || b.face === 'unknown';
  if (a.plane_id && a.plane_id === b.plane_id && widthRatio >= 0.7 && eaveRatio >= 0.7) return true;
  // A tree-blocked fragment of a wall that another photo already measured.
  const fragment = a.occluded !== b.occluded
    && widthRatio >= 0.45 && widthRatio < 0.85
    && eaveRatio >= 0.45
    && (sameFace || a.role === b.role);
  if (fragment) return true;
  if (a.role !== b.role) return false;
  return sameFace && widthRatio >= 0.78 && eaveRatio >= 0.8;
}

function mergePlaneCluster(cluster) {
  const clear = cluster.filter((plane) => !plane.occluded);
  const widthPool = clear.length > 0 ? clear : cluster;
  const width = Math.max(...widthPool.map((plane) => plane.width_ft));
  const eaves = [...cluster.map((plane) => plane.eave_height_ft)].sort((a, b) => a - b);
  const eave = eaves[Math.floor(eaves.length / 2)];
  const face = cluster.find((plane) => plane.face !== 'unknown')?.face || 'unknown';
  const base = cluster[0];
  return {
    ...base,
    face,
    width_ft: width,
    eave_height_ft: eave,
    gable_rise_ft: Math.max(...cluster.map((plane) => plane.gable_rise_ft)),
    gable_sided: cluster.some((plane) => plane.gable_sided),
    non_siding_pct: Math.max(...cluster.map((plane) => plane.non_siding_pct)),
    non_siding_material: cluster.find((plane) => plane.non_siding_material)?.non_siding_material || null,
    occluded: cluster.every((plane) => plane.occluded),
    occlusion_pct: Math.min(...cluster.map((plane) => plane.occlusion_pct)),
    outside_corners: Math.max(...cluster.map((plane) => plane.outside_corners)),
    inside_corners: Math.max(...cluster.map((plane) => plane.inside_corners)),
    stories: Math.max(...cluster.map((plane) => plane.stories)),
    photo_count: cluster.length,
    width_source: 'photo',
  };
}

/**
 * Sum every distinct wall plane instead of folding the house into four sides.
 *
 * A two-story gable, a garage gable, a one-story hip wall, and the wall behind
 * a porch are different surfaces. Photos of the same surface are merged.
 * An open porch and a chimney are reported and then left out of the siding.
 * A sided gable triangle is added; an open porch gable is not. When trees hide
 * a wall and a satellite edge for that side is longer, the short visible
 * fragment is raised to the satellite length.
 *
 * @returns {{ authoritative: boolean, planes: object[], gross_wall_sqft: number, gable_area_sqft: number, excluded_sqft: number, outside_corners: number, inside_corners: number, outside_corners_lf: number, inside_corners_lf: number, stories: number }}
 */
function sumDistinctWallPlanes(perPhotoResults, options = {}) {
  const reported = [];
  for (const photo of perPhotoResults || []) {
    const planes = Array.isArray(photo?.wall_planes) ? photo.wall_planes : [];
    for (const raw of planes) {
      const plane = normalizeReportedPlane(raw, photo);
      if (plane) reported.push(plane);
    }
  }
  const clusters = [];
  for (const plane of reported) {
    const cluster = clusters.find((group) => planesAreSameWall(group[0], plane));
    if (cluster) cluster.push(plane);
    else clusters.push([plane]);
  }
  const merged = clusters.map(mergePlaneCluster);
  const satelliteAxes = options.satelliteAxes && typeof options.satelliteAxes === 'object'
    ? options.satelliteAxes
    : null;
  if (satelliteAxes) {
    const axisValues = ['front', 'back', 'left_side', 'right_side']
      .map((face) => Number(satelliteAxes[face]) || 0)
      .filter((value) => value > 0);
    const shortAxis = axisValues.length ? Math.min(...axisValues) : 0;
    for (const plane of merged) {
      if (!plane.sided || !plane.occluded) continue;
      const faceTarget = Number(satelliteAxes[plane.face]) || 0;
      // A gable end is the short side of the footprint. The long axis is a
      // side wall, and copying it onto a gable bills the whole house as one end.
      const cap = plane.gable_rise_ft > 0 && shortAxis > 0 ? shortAxis : faceTarget;
      if (!(cap > 0)) continue;
      const hidden = Math.max(0, Math.min(60, Number(plane.occlusion_pct) || 0)) / 100;
      if (hidden < 0.15) continue;
      const inferred = plane.width_ft / (1 - hidden);
      const next = Math.min(cap, inferred);
      if (next <= plane.width_ft + 1) continue;
      plane.measured_width_ft = plane.width_ft;
      // The triangle belongs to the end that was visible. The restored length
      // behind the trees is wall, not a wider gable.
      if (plane.gable_rise_ft > 0 && next > plane.width_ft * 1.25) {
        plane.gable_base_ft = plane.width_ft;
      }
      plane.width_ft = Math.round(next * 10) / 10;
      plane.width_source = 'satellite_footprint';
    }
  }

  const tracedPerimeter = Number(options.tracedPerimeterFt) || 0;
  if (tracedPerimeter > 0) {
    const sidedNow = merged.filter((plane) => plane.sided);
    const porchWidth = merged
      .filter((plane) => !plane.sided && plane.role === 'porch')
      .reduce((sum, plane) => sum + plane.width_ft, 0);
    const sidedWidth = sidedNow.reduce((sum, plane) => sum + plane.width_ft, 0);
    const target = Math.max(0, tracedPerimeter - porchWidth);
    const gap = target - sidedWidth;
    // The photos missed whole walls. The satellite outline still has their length.
    // One-story eave is the right height for that remainder; it is not a gable.
    if (gap > 8 && sidedNow.length > 0) {
      const oneStory = sidedNow.filter((plane) => (plane.stories || 1) < 2);
      const sample = (oneStory.length ? oneStory : sidedNow)
        .map((plane) => plane.eave_height_ft)
        .sort((a, b) => a - b);
      const eave = sample[Math.floor(sample.length / 2)] || 9;
      merged.push({
        plane_id: 'footprint_remainder',
        role: 'wing',
        face: 'unknown',
        width_ft: Math.round(gap * 10) / 10,
        eave_height_ft: eave,
        gable_rise_ft: 0,
        reported_gable_rise_ft: 0,
        gable_sided: false,
        sided: true,
        include_in_takeoff: true,
        non_siding_pct: 0,
        non_siding_material: null,
        occluded: true,
        occlusion_pct: 100,
        outside_corners: 0,
        inside_corners: 0,
        stories: 1,
        photo_count: 0,
        width_source: 'satellite_footprint',
        measured_width_ft: 0,
      });
    }
  }

  const planes = merged.map((plane) => {
    const wall = plane.width_ft * plane.eave_height_ft;
    const gableBase = plane.gable_base_ft || plane.width_ft;
    const gable = plane.gable_sided ? (gableBase * plane.gable_rise_ft) / 2 : 0;
    const gross = plane.sided ? wall + gable : 0;
    const masonry = plane.sided ? gross * (plane.non_siding_pct / 100) : 0;
    const excludedGable = !plane.gable_sided && plane.reported_gable_rise_ft > 0
      ? (plane.width_ft * plane.reported_gable_rise_ft) / 2
      : 0;
    return {
      ...plane,
      wall_area_sqft: Math.round(wall),
      gable_area_sqft: Math.round(gable),
      gross_area_sqft: Math.round(gross),
      masonry_area_sqft: Math.round(masonry),
      siding_area_sqft: Math.round(Math.max(0, gross - masonry)),
      excluded_gable_sqft: Math.round(excludedGable),
      excluded: !plane.sided,
    };
  });
  const included = planes.filter((plane) => plane.sided);
  const gross = included.reduce((sum, plane) => sum + plane.gross_area_sqft, 0);
  const gable = included.reduce((sum, plane) => sum + plane.gable_area_sqft, 0);
  const outside = included.reduce((sum, plane) => sum + plane.outside_corners, 0);
  const inside = included.reduce((sum, plane) => sum + plane.inside_corners, 0);
  const outsideLf = included.reduce((sum, plane) => sum + plane.outside_corners * plane.eave_height_ft, 0);
  const insideLf = included.reduce((sum, plane) => sum + plane.inside_corners * plane.eave_height_ft, 0);
  return {
    authoritative: included.length >= 3,
    planes,
    gross_wall_sqft: gross,
    gable_area_sqft: gable,
    excluded_sqft: planes.filter((plane) => !plane.sided).reduce((sum, plane) => sum + plane.wall_area_sqft + plane.excluded_gable_sqft, 0),
    outside_corners: outside,
    inside_corners: inside,
    outside_corners_lf: Math.round(outsideLf),
    inside_corners_lf: Math.round(insideLf),
    stories: included.reduce((max, plane) => Math.max(max, plane.stories || 1), 1),
  };
}

module.exports = {
  deriveWallHeight,
  deriveBuildingDimensions,
  computeGableArea,
  sumDistinctWallPlanes,
  sumOppositeElevations,
  robustAvg,
  median,
  DEFAULT_EAVE_PER_STORY,
  PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT,
  PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT,
  PHOTO_CALIBRATION_OUTLIER_PCT,
  CALIBRATED_METHODS,
};
