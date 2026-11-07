'use strict';

/**
 * Satellite-only wall helpers (no photos, no Street View).
 *
 * Eave height comes from Google Solar roof planes: each plane reports the
 * height of its center above sea level. The highest real plane (pitched,
 * at least 8 m²) sits half its own rise above the main eave, so
 *   eave = (center height − ground) − (horizontal depth / 2) × tan(pitch)
 * with depth = horizontal plane area / longest bounding-box side.
 * Ground comes from the free USGS Elevation Point Query Service.
 *
 * Opening counts use standard residential sizes and structural-bay spacing.
 * No constant here is fitted to any bench house.
 */

const M_TO_FT = 3.28084;
const SAT_EAVE_MIN_FT = 8.5;
const SAT_EAVE_MAX_FT = 21;
const WINDOW_SQFT = 15; // 3 ft × 5 ft standard double-hung
const DOOR_SQFT = 20; // 3 ft × 6 ft 8 in entry, rounded
const FIRST_FLOOR_BAY_FT = 12; // one 3×5 centered in a 12 ft bay
const UPPER_FLOOR_BAY_FT = 16; // next common module; upper floors lose openings to stairs and baths
const ENTRY_DOORS = 2;
const SAT_FACES = ['front', 'back', 'left_side', 'right_side'];
const CORNER_ORDER = ['front', 'right_side', 'back', 'left_side'];

function bboxSidesM(bb) {
  if (!bb?.sw || !bb?.ne) return null;
  const lat = (Number(bb.sw.latitude) + Number(bb.ne.latitude)) / 2;
  const dy = (Number(bb.ne.latitude) - Number(bb.sw.latitude)) * 111320;
  const dx = (Number(bb.ne.longitude) - Number(bb.sw.longitude)) * 111320 * Math.cos(lat * Math.PI / 180);
  if (!(dx > 0) || !(dy > 0)) return null;
  return { dx, dy };
}

function eaveFromSolarSegments(segments, groundM) {
  const ground = Number(groundM);
  if (!Number.isFinite(ground)) return null;
  const planes = (Array.isArray(segments) ? segments : []).filter((seg) => {
    const pitch = Number(seg?.pitchDegrees);
    const area = Number(seg?.stats?.areaMeters2);
    return pitch > 10 && area >= 8 && Number.isFinite(Number(seg?.planeHeightAtCenterMeters)) && bboxSidesM(seg?.boundingBox);
  });
  if (!planes.length) return null;
  const top = planes.reduce((best, seg) => (
    Number(seg.planeHeightAtCenterMeters) > Number(best.planeHeightAtCenterMeters) ? seg : best
  ));
  const pitchRad = Number(top.pitchDegrees) * Math.PI / 180;
  const sides = bboxSidesM(top.boundingBox);
  const horizM2 = Number(top.stats.groundAreaMeters2) > 0
    ? Number(top.stats.groundAreaMeters2)
    : Number(top.stats.areaMeters2) * Math.cos(pitchRad);
  const depthM = horizM2 / Math.max(sides.dx, sides.dy);
  const centerRelM = Number(top.planeHeightAtCenterMeters) - ground;
  const rawFt = (centerRelM - (depthM / 2) * Math.tan(pitchRad)) * M_TO_FT;
  if (!Number.isFinite(rawFt) || centerRelM <= 0) return null;
  const eaveFt = Math.round(Math.min(SAT_EAVE_MAX_FT, Math.max(SAT_EAVE_MIN_FT, rawFt)) * 2) / 2;
  return {
    eave_ft: eaveFt,
    raw_eave_ft: Math.round(rawFt * 10) / 10,
    center_height_ft: Math.round(centerRelM * M_TO_FT * 10) / 10,
    depth_ft: Math.round(depthM * M_TO_FT * 10) / 10,
    pitch_deg: Math.round(Number(top.pitchDegrees)),
    clamped: rawFt < SAT_EAVE_MIN_FT || rawFt > SAT_EAVE_MAX_FT,
  };
}

function storiesForEave(eaveFt) {
  const eave = Number(eaveFt) || 0;
  if (eave >= 16) return 2;
  if (eave >= 12.5) return 1.5;
  return 1;
}

/**
 * Opening story count follows the eave, then any rep tap. A split-level
 * tap is a story and a half. A two-story tap is two. This does not look
 * at a particular house.
 */
function storyCountFromConfirmed(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const stories = entry.stories;
  if (stories === 'split' || stories === 'split-level' || stories === 1.5 || stories === '1.5') return 1.5;
  if (stories === 2 || stories === '2') return 2;
  if (stories === 1 || stories === '1') return 1;
  return null;
}

function openingStoryCount(eaveStories, confirmed) {
  let stories = Math.max(1, Number(eaveStories) || 1);
  const rows = confirmed && typeof confirmed === 'object' ? Object.values(confirmed) : [];
  for (const entry of rows) {
    const tapped = storyCountFromConfirmed(entry);
    if (tapped) stories = Math.max(stories, tapped);
  }
  return stories;
}

function resolveFaceStory(value, fallback) {
  if (value && typeof value === 'object') {
    const tapped = storyCountFromConfirmed(value);
    if (tapped) return tapped;
  }
  const direct = Number(value);
  if (direct === 1 || direct === 1.5 || direct === 2) return direct;
  if (value === 'split') return 1.5;
  return Math.max(1, Number(fallback) || 1);
}

function distributeCount(total, weights) {
  const faces = Object.keys(weights);
  const sum = faces.reduce((acc, face) => acc + Math.max(0, Number(weights[face]) || 0), 0);
  const out = Object.fromEntries(faces.map((face) => [face, 0]));
  const count = Math.max(0, Math.round(Number(total) || 0));
  if (!(count > 0) || !(sum > 0)) return out;
  const rows = faces.map((face) => {
    const exact = count * Math.max(0, Number(weights[face]) || 0) / sum;
    return { face, n: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let left = count - rows.reduce((acc, row) => acc + row.n, 0);
  rows.sort((a, b) => b.frac - a.frac || a.face.localeCompare(b.face));
  for (const row of rows) {
    if (left <= 0) break;
    row.n += 1;
    left -= 1;
  }
  for (const row of rows) out[row.face] = row.n;
  return out;
}

/**
 * Counted openings for a house with no elevations.
 *
 * First floor: one 3×5 window per 12 ft of perimeter, minus one bay.
 * That bay is the overhead-door wall. Satellite cannot see the door, so
 * the door is left out rather than invented as a 9×7 or 16×7.
 * Each full story above the first: one 3×5 per 16 ft of perimeter.
 * A half story (1.5 or split) adds half of that upper band.
 * Two entry doors, 3×6'8" each. No third door and no garage door.
 */
function windowsForStory(lengthFt, stories) {
  const length = Math.max(0, Number(lengthFt) || 0);
  const s = Math.max(1, Number(stories) || 1);
  const fullUpperStories = Math.max(0, Math.floor(s) - 1);
  const halfStory = (s - Math.floor(s)) >= 0.5 ? 0.5 : 0;
  return {
    first: length / FIRST_FLOOR_BAY_FT,
    upper: (fullUpperStories + halfStory) * (length / UPPER_FLOOR_BAY_FT),
  };
}

function packOpenings(windows, doors, lengths) {
  let byFace = null;
  if (lengths) {
    const weights = {};
    for (const face of SAT_FACES) weights[face] = Math.max(0, Number(lengths[face]) || 0);
    const windowsByFace = distributeCount(windows, weights);
    const doorsByFace = { front: 0, back: 0, left_side: 0, right_side: 0 };
    if (doors >= 1) doorsByFace.front = 1;
    if (doors >= 2) doorsByFace.back = 1;
    byFace = {};
    for (const face of SAT_FACES) {
      const w = windowsByFace[face] || 0;
      const d = doorsByFace[face] || 0;
      byFace[face] = {
        windows: w,
        doors: d,
        opening_sqft: w * WINDOW_SQFT + d * DOOR_SQFT,
      };
    }
  }
  return {
    windows,
    doors,
    window_sqft: windows * WINDOW_SQFT,
    door_sqft: doors * DOOR_SQFT,
    opening_sqft: windows * WINDOW_SQFT + doors * DOOR_SQFT,
    by_face: byFace,
    basis: `1 window (3×5) per ${FIRST_FLOOR_BAY_FT} ft bay on the first floor, minus the overhead-door bay; 1 per ${UPPER_FLOOR_BAY_FT} ft on each full upper floor; half of that on a half story; ${ENTRY_DOORS} entry doors (3×6'8"). No garage door is assumed.`,
  };
}

function defaultOpenings({ perimeterFt, stories, faceLengths, faceStories } = {}) {
  const perim = Math.max(0, Number(perimeterFt) || 0);
  const fallback = Math.max(1, Number(stories) || 1);
  const lengths = faceLengths && typeof faceLengths === 'object' ? faceLengths : null;
  const hasFaceStories = faceStories && typeof faceStories === 'object' && Object.keys(faceStories).length > 0;
  if (hasFaceStories && lengths && perim > 0) {
    const perFace = {};
    for (const face of SAT_FACES) perFace[face] = resolveFaceStory(faceStories[face], fallback);
    const unique = new Set(SAT_FACES.map((face) => perFace[face]));
    if (unique.size === 1) {
      return defaultOpenings({ perimeterFt: perim, stories: [...unique][0], faceLengths: lengths });
    }
    let firstExact = 0;
    let upperExact = 0;
    const firstWeights = {};
    const upperWeights = {};
    for (const face of SAT_FACES) {
      const band = windowsForStory(lengths[face], perFace[face]);
      firstWeights[face] = band.first;
      upperWeights[face] = band.upper;
      firstExact += band.first;
      upperExact += band.upper;
    }
    const first = Math.max(0, Math.round(firstExact) - 1);
    const upper = Math.round(upperExact);
    const windowsByFace = {};
    const firstByFace = distributeCount(first, firstWeights);
    const upperByFace = distributeCount(upper, upperWeights);
    const doors = ENTRY_DOORS;
    const doorsByFace = { front: 1, back: 1, left_side: 0, right_side: 0 };
    const byFace = {};
    let windows = 0;
    for (const face of SAT_FACES) {
      const w = (firstByFace[face] || 0) + (upperByFace[face] || 0);
      windows += w;
      const d = doorsByFace[face] || 0;
      byFace[face] = {
        windows: w,
        doors: d,
        opening_sqft: w * WINDOW_SQFT + d * DOOR_SQFT,
        stories: perFace[face],
      };
    }
    return {
      windows,
      doors,
      window_sqft: windows * WINDOW_SQFT,
      door_sqft: doors * DOOR_SQFT,
      opening_sqft: windows * WINDOW_SQFT + doors * DOOR_SQFT,
      by_face: byFace,
      basis: `Each wall uses its own story count: 1 window (3×5) per ${FIRST_FLOOR_BAY_FT} ft bay on the first floor, minus one overhead-door bay; 1 per ${UPPER_FLOOR_BAY_FT} ft on each full upper floor of that wall; half of that on a half story. ${ENTRY_DOORS} entry doors (3×6'8"). No garage door is assumed.`,
    };
  }
  const s = fallback;
  const first = perim > 0 ? Math.max(0, Math.round(perim / FIRST_FLOOR_BAY_FT) - 1) : 0;
  const fullUpperStories = Math.max(0, Math.floor(s) - 1);
  const halfStory = (s - Math.floor(s)) >= 0.5 ? 0.5 : 0;
  const upper = perim > 0
    ? Math.round((fullUpperStories + halfStory) * (perim / UPPER_FLOOR_BAY_FT))
    : 0;
  const doors = perim > 0 ? ENTRY_DOORS : 0;
  return packOpenings(first + upper, doors, lengths);
}

const MASONRY_SHARE_LABELS = {
  none: 0,
  '0': 0,
  quarter: 0.25,
  '1/4': 0.25,
  '¼': 0.25,
  '0.25': 0.25,
  half: 0.5,
  '1/2': 0.5,
  '½': 0.5,
  '0.5': 0.5,
  three_quarter: 0.75,
  'three-quarter': 0.75,
  '3/4': 0.75,
  '¾': 0.75,
  '0.75': 0.75,
  all: 1,
  '1': 1,
  true: 1,
  brick: 1,
  stone: 1,
};

function parseMasonryShare(value) {
  if (value === true) return 1;
  if (value === false || value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0.99) return 1;
    if (value >= 0.74) return 0.75;
    if (value >= 0.49) return 0.5;
    if (value >= 0.24) return 0.25;
    return 0;
  }
  const key = String(value).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MASONRY_SHARE_LABELS, key)) return MASONRY_SHARE_LABELS[key];
  const numeric = Number(key);
  if (Number.isFinite(numeric) && key !== '') return parseMasonryShare(numeric);
  return 0;
}

function masonryChoiceId(share) {
  if (share >= 1) return 'all';
  if (share >= 0.75) return 'three_quarter';
  if (share >= 0.5) return 'half';
  if (share >= 0.25) return 'quarter';
  return 'none';
}

function masonryShareMap(masonryFaces) {
  const out = Object.fromEntries(SAT_FACES.map((face) => [face, 0]));
  const take = (face, value) => {
    if (!SAT_FACES.includes(face)) return;
    out[face] = parseMasonryShare(value);
  };
  if (Array.isArray(masonryFaces)) {
    for (const face of masonryFaces) take(face, 1);
  } else if (masonryFaces && typeof masonryFaces === 'object') {
    for (const [face, value] of Object.entries(masonryFaces)) take(face, value);
  }
  return out;
}

function masonryFaceSet(masonryFaces) {
  const shares = masonryShareMap(masonryFaces);
  return new Set(SAT_FACES.filter((face) => shares[face] >= 1));
}

/**
 * Split the billed wall across the four sides. Front and back are the
 * short walls; left and right are the long walls. Satellite has no
 * front bearing. A masonry share (none, quarter, half, three quarters,
 * or all) leaves that fraction of the side out of the siding. Openings
 * on the masonry portion are not deducted again from the siding that
 * remains. net = gross − masonry − openings on siding.
 */
function applyMasonryAndOpenings({
  grossSqft,
  bodySqft,
  faceLengths,
  eaves,
  gableEnds,
  openingSqft,
  masonryFaces,
} = {}) {
  const body = Math.max(0, Number(bodySqft) || 0);
  const gross = Math.max(body, Number(grossSqft) || 0);
  const gableIncluded = Math.max(0, gross - body);
  const ends = (Array.isArray(gableEnds) ? gableEnds : []).filter((face) => SAT_FACES.includes(face));
  const gableEach = ends.length ? gableIncluded / ends.length : 0;
  const shares = masonryShareMap(masonryFaces);
  const weights = {};
  let weightSum = 0;
  for (const face of SAT_FACES) {
    const weight = Math.max(0, Number(faceLengths?.[face]) || 0) * Math.max(0, Number(eaves?.[face]) || 0);
    weights[face] = weight;
    weightSum += weight;
  }
  const faceGross = {};
  const faceBody = {};
  let masonrySqft = 0;
  let sidingBody = 0;
  for (const face of SAT_FACES) {
    const share = weightSum > 0 ? (weights[face] / weightSum) * body : 0;
    const gable = ends.includes(face) ? gableEach : 0;
    const fraction = shares[face];
    faceBody[face] = share;
    faceGross[face] = share + gable;
    masonrySqft += (share + gable) * fraction;
    sidingBody += share * (1 - fraction);
  }
  const opening = Math.max(0, Number(openingSqft) || 0);
  const openingOnSiding = body > 0 ? opening * (sidingBody / body) : 0;
  const net = Math.max(0, gross - masonrySqft - openingOnSiding);
  return {
    faceGross,
    faceBody,
    masonrySqft,
    openingOnSiding,
    sidingBody,
    net,
    masonryShares: shares,
    masonryChoices: Object.fromEntries(SAT_FACES.map((face) => [face, masonryChoiceId(shares[face])])),
    masonryFaces: SAT_FACES.filter((face) => shares[face] >= 1),
  };
}

/**
 * A siding corner is where two sided walls meet. Returns null when every
 * side is "none", so the footprint corner count is left as-is. A side
 * marked "all" drops the corners it touches. A partial side keeps those
 * corners, at the height that is still siding.
 * Extra corners on a non-rectangular footprint scale with that count.
 */
function sidingOutsideCorners({
  masonryFaces,
  eaves,
  geometricCount,
  geometricInsideCount,
  geometricInsideLf,
} = {}) {
  const shares = masonryShareMap(masonryFaces);
  if (!SAT_FACES.some((face) => shares[face] > 0)) return null;
  let count = 0;
  let lf = 0;
  for (let i = 0; i < CORNER_ORDER.length; i++) {
    const a = CORNER_ORDER[i];
    const b = CORNER_ORDER[(i + 1) % CORNER_ORDER.length];
    if (shares[a] >= 1 || shares[b] >= 1) continue;
    count += 1;
    const sidingA = Math.max(0, Number(eaves?.[a]) || 0) * (1 - shares[a]);
    const sidingB = Math.max(0, Number(eaves?.[b]) || 0) * (1 - shares[b]);
    lf += Math.max(sidingA, sidingB);
  }
  const geo = Math.max(0, Number(geometricCount) || 0);
  const scale = geo > 4 ? geo / 4 : 1;
  const outsideCount = Math.round(count * scale);
  const outsideLf = Math.round(lf * scale);
  const insideRatio = geo > 0 ? outsideCount / geo : 0;
  return {
    outside_count: outsideCount,
    outside_lf: outsideLf,
    inside_count: Math.round((Number(geometricInsideCount) || 0) * insideRatio),
    inside_lf: Math.round((Number(geometricInsideLf) || 0) * insideRatio),
  };
}

/**
 * Gutters follow the level outline of the Solar facets when the edges
 * labeled "eave" cover less than 70% of it. A rectangle from Solar often
 * labels only the downhill edge and leaves the other level boundary as a
 * ridge or unlabeled. This does not change the roof report's eave linear.
 * The labeled eave is kept when it already covers the outline.
 */
function gutterFromSolarEdges({ facetEaveLf = 0, levelBoundaryLf = 0, fallbackLf = 0 } = {}) {
  const labeled = Math.max(0, Number(facetEaveLf) || 0);
  const level = Math.max(0, Number(levelBoundaryLf) || 0);
  const fallback = Math.max(0, Number(fallbackLf) || 0);
  if (level > 0 && labeled < level * 0.7) {
    return { gutter_lf: Math.round(level), gutter_source: 'roof_level_outline' };
  }
  if (labeled > 0) {
    return { gutter_lf: Math.round(labeled), gutter_source: 'roof_facet_eave' };
  }
  return { gutter_lf: Math.round(fallback), gutter_source: 'footprint_fallback' };
}

async function fetchGroundElevationM(latitude, longitude, { timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}) {
  const url = `https://epqs.nationalmap.gov/v1/json?x=${longitude}&y=${latitude}&units=Meters&wkid=4326`;
  const resp = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`USGS elevation HTTP ${resp.status}`);
  const body = await resp.json();
  const value = Number(body?.value);
  if (!Number.isFinite(value) || value < -500) throw new Error('USGS elevation unavailable');
  return value;
}

module.exports = {
  eaveFromSolarSegments,
  storiesForEave,
  storyCountFromConfirmed,
  openingStoryCount,
  defaultOpenings,
  masonryShareMap,
  masonryChoiceId,
  masonryFaceSet,
  applyMasonryAndOpenings,
  sidingOutsideCorners,
  gutterFromSolarEdges,
  fetchGroundElevationM,
  SAT_EAVE_MIN_FT,
  SAT_EAVE_MAX_FT,
  SAT_FACES,
  WINDOW_SQFT,
  DOOR_SQFT,
  FIRST_FLOOR_BAY_FT,
  UPPER_FLOOR_BAY_FT,
};
