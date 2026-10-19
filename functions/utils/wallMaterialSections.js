/**
 * Per-material wall sections for the photo path.
 *
 * The vision step returns, for each elevation photo, polygons that tag parts
 * of the measured wall frame as siding, stone, stucco, brick or trim. This
 * module turns those polygons into square feet per material per wall face,
 * counts openings per wall and per material, settles the story count from the
 * window rows seen in the photos, and returns overlay data the rep can tap to
 * correct. It never invents a material: line items are filtered to the
 * materials that were measured or confirmed.
 *
 * Wall frame: polygons use normalized photo-wall coordinates, x 0..1 left to
 * right along the wall, y 0..1 from the eave line (0) down to grade (1).
 * Gable polygons sit above the eave and use y < 0 (the frame extends upward
 * by gable_height_ft / eave_height_ft).
 *
 * When a photo reports material shares (percent of the visible wall, summing
 * to 100), those shares are applied to the whole footprint face: length times
 * that photo's eave, plus its gable. Every straight photo of the face votes,
 * weighted by confidence. Polygons stay the overlay and the fallback when
 * shares are absent, and in that fallback a close-up bills only the fraction
 * in frame. Two polygon photos of the same stretch are measured once.
 * A one-story garage wing keeps the eave the photo measured. Every footprint
 * face with a length gets an area; a face with no photo uses the house's
 * dominant material and is flagged low confidence. An opening tagged
 * stone, stucco, or brick forces that material to have at least the opening's
 * area. Out-of-band wall area is flagged, not rewritten.
 */

export const WALL_MATERIALS = ['siding', 'stone', 'stucco', 'brick', 'trim'];
const FACES = ['front', 'right', 'back', 'left'];

export function normalizeWallMaterial(value) {
  const raw = String(value || '').toLowerCase();
  if (!raw || raw === 'none' || raw === 'unknown') return null;
  if (/brick/.test(raw)) return 'brick';
  if (/stone|masonry|cultured|ledge|veneer_stone/.test(raw)) return 'stone';
  if (/stucco|eifs|dryvit/.test(raw)) return 'stucco';
  if (/trim|frieze|band|corner_board|fascia/.test(raw)) return 'trim';
  if (/vinyl|alum|siding|lap|clapboard|dutch|shake|board|batten|fiber|hardie|wood|cedar/.test(raw)) return 'siding';
  return null;
}

export function normalizeFace(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('front')) return 'front';
  if (raw.includes('back') || raw.includes('rear')) return 'back';
  if (raw.includes('left')) return 'left';
  if (raw.includes('right')) return 'right';
  return null;
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function round(v, dp = 1) {
  const p = 10 ** dp;
  return Math.round(num(v) * p) / p;
}

/** Shoelace area of a normalized polygon, in frame units. */
export function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    s += num(x1) * num(y2) - num(x2) * num(y1);
  }
  return Math.abs(s) / 2;
}

function sectionPolygon(section) {
  if (Array.isArray(section?.polygon)) return section.polygon;
  const b = section?.bbox;
  if (b && [b.x, b.y, b.w, b.h].every((v) => Number.isFinite(Number(v)))) {
    return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  }
  return null;
}

const MASONRY_MATERIALS = new Set(['brick', 'stone']);
// y=0 is the eave and y=1 is grade. Starter is masked only by masonry that
// reaches both, so a foundation band or a wainscot never hides the run.
const EAVE_Y = 0.18;
const GRADE_Y = 0.82;

function pointXY(point) {
  if (Array.isArray(point)) return [num(point[0], NaN), num(point[1], NaN)];
  if (point && typeof point === 'object') return [num(point.x, NaN), num(point.y, NaN)];
  return [NaN, NaN];
}

function masonrySections(photo) {
  const drawn = [
    ...(Array.isArray(photo?.sections) ? photo.sections : []),
    ...(Array.isArray(photo?.material_sections) ? photo.material_sections : []),
  ];
  const drawnMasonry = drawn.filter((section) => MASONRY_MATERIALS.has(normalizeWallMaterial(section?.material)));
  if (drawnMasonry.length) return drawn;
  return Array.isArray(photo?.material_regions) ? photo.material_regions : [];
}

/**
 * X-spans of brick or stone that cover the full wall height.
 * A polygon masks starter only for its own width, and only when it reaches
 * the eave and grade. A foundation band or a wainscot does not, even when
 * it touches grade. A percent with no polygon does not mask the face.
 */
export function fullHeightMasonrySpans(photo) {
  const spans = [];
  for (const section of masonrySections(photo)) {
    const material = normalizeWallMaterial(section?.material);
    if (!material || !MASONRY_MATERIALS.has(material)) continue;
    const poly = sectionPolygon(section);
    if (!poly) continue;
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const point of poly) {
      const [x, y] = pointXY(point);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (minY <= EAVE_Y && maxY >= GRADE_Y && maxX > minX) {
      spans.push([Math.max(0, Math.min(1, minX)), Math.max(0, Math.min(1, maxX))]);
    }
  }
  return spans;
}

function median(values) {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Story count from the photos. A one-story garage wing is not a vote.
 * Two or more elevations have to agree before the house is called multi-story.
 * One elevation that says "2" does not outvote the rest. When several
 * multi-story readings each have two votes, the one with the most votes wins
 * and a tie stays with the lower count. Window rows alone never invent a
 * third story.
 */
export function storyCountFromPhotos(photos = []) {
  const reads = [];
  for (const p of photos) {
    // A one-story garage wing is not a vote. A door-scaled two-story wall is.
    const rows = num(p?.window_rows, NaN);
    const eave = num(p?.eave_height_ft, NaN);
    const shortWing = (p?.height_method === 'garage_door_anchor' || p?.is_one_story_wing === true)
      && !(eave > 12.5);
    if (p?.is_one_story_wing === true || shortWing) continue;
    const sc = num(p?.story_count, NaN);
    const rowsOk = Number.isFinite(rows) && rows > 0;
    const scOk = Number.isFinite(sc) && sc > 0;
    let v = NaN;
    if (rowsOk && scOk) v = Math.min(rows, sc);
    else if (scOk) v = sc;
    else if (rowsOk) v = Math.min(rows, 2);
    if (Number.isFinite(v) && v > 0) reads.push(Math.round(v));
  }
  if (!reads.length) return { story_count: null, source: 'none', reads: [] };
  const counts = new Map();
  for (const v of reads) counts.set(v, (counts.get(v) || 0) + 1);
  const multi = [...counts.entries()].filter(([v, n]) => v > 1 && n >= 2);
  if (multi.length) {
    multi.sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
    return { story_count: multi[0][0], source: 'photos', reads };
  }
  const ones = counts.get(1) || 0;
  if (ones >= 1) return { story_count: 1, source: 'photos', reads };
  return { story_count: reads[0], source: 'photos', reads };
}

/**
 * Apply rep overrides: { [sectionId]: material } (or 'delete').
 */
function applyOverrides(sections, overrides = {}) {
  return sections
    .map((s) => {
      const o = overrides?.[s.id];
      if (o === 'delete') return null;
      const material = o ? normalizeWallMaterial(o) : s.material;
      return { ...s, material, rep_corrected: Boolean(o) };
    })
    .filter(Boolean);
}

function garageDoorCount(photo) {
  const listed = (Array.isArray(photo?.openings) ? photo.openings : [])
    .filter((o) => /garage/.test(String(o?.type || ''))).length;
  return Math.max(num(photo?.garage_doors_count, 0), listed);
}

/** Garage doors opening onto a driveway are the street front, whatever the upload label said. */
function facesDriveway(photo) {
  if (photo?.faces_driveway === true || photo?.driveway_visible === true) return true;
  const text = `${photo?.scene || ''} ${photo?.notes || ''} ${photo?.confidence_reason || ''}`.toLowerCase();
  return /driveway/.test(text);
}

/**
 * A one-story garage wing keeps the eave the photo measured. The house can
 * still be two stories; that must not lift this wing to the 17 ft floor.
 */
export function isOneStoryWing(photo) {
  if (photo?.is_one_story_wing === true) return true;
  if (photo?.height_method === 'garage_door_anchor') return true;
  const rows = num(photo?.window_rows, NaN);
  return garageDoorCount(photo) > 0 && Number.isFinite(rows) && rows > 0 && rows < 2;
}

function measurementEave(photo) {
  const stored = num(photo?.eave_height_ft, 0);
  const raw = num(photo?.eave_before_clamp_ft, 0)
    || num(photo?.model_eave_height_ft, 0)
    || num(photo?.measured_eave_height_ft, 0);
  if (isOneStoryWing(photo) && raw > 0) return raw;
  return stored;
}

function resolveFaces(photo) {
  let primary = normalizeFace(photo?.wall_face) || normalizeFace(photo?.view_label);
  const relabeled = facesDriveway(photo) && garageDoorCount(photo) > 0
    && (primary === 'right' || primary === 'left' || !primary);
  if (relabeled) primary = 'front';
  if (!primary) return { faces: [], relabeled: false, driveway: facesDriveway(photo) };
  if (!photo?.is_corner_shot) return { faces: [primary], relabeled, driveway: facesDriveway(photo) };
  const secondary = normalizeFace(photo?.secondary_wall_face) || normalizeFace(photo?.secondary_face);
  if (secondary && secondary !== primary) return { faces: [primary, secondary], relabeled, driveway: facesDriveway(photo) };
  return { faces: [primary], relabeled, driveway: facesDriveway(photo) };
}

function clampSpan(a, b) {
  const x0 = Math.max(0, Math.min(1, num(a, 0)));
  const x1 = Math.max(0, Math.min(1, num(b, 0)));
  return x1 > x0 ? [x0, x1] : [0, 0];
}

/** Fraction of this footprint face that is actually in the frame. */
function spanFor(photo, face, faces) {
  const perFace = photo?.face_spans?.[face] || photo?.visible_spans?.[face];
  if (Array.isArray(perFace) && perFace.length >= 2) return clampSpan(perFace[0], perFace[1]);
  if (faces.length >= 2) {
    // A corner shows a portion of each wall. Without an explicit span, do not
    // bill either wall as if the photo framed it from corner to corner.
    return [0, 0.5];
  }
  const frac = num(photo?.visible_width_fraction, NaN);
  if (Number.isFinite(frac) && frac > 0 && frac < 0.98) {
    const start = num(photo?.visible_x_start, 0);
    return clampSpan(start, start + frac);
  }
  const faceLen = num(photo?._face_length_ft, 0);
  const observed = num(photo?.observed_wall_width_ft, 0) || num(photo?.visible_width_ft, 0);
  if (faceLen > 0 && observed > 0 && observed < faceLen * 0.92) {
    const start = num(photo?.visible_x_start, 0);
    return clampSpan(start, start + observed / faceLen);
  }
  // A garage wing or a gable end that is narrower than the footprint edge
  // is not the whole facade. Its width bills; the rest of the edge does not
  // inherit that photo's height and rise.
  const photoWidth = num(photo?.wall_width_ft, 0);
  const partial = isOneStoryWing(photo)
    || (photo?.has_gable_end === true && faceLen > 0 && photoWidth > 0 && photoWidth < faceLen * 0.75);
  if (partial && faceLen > 0 && photoWidth > 0 && photoWidth < faceLen * 0.92) {
    return clampSpan(0, photoWidth / faceLen);
  }
  return [0, 1];
}

function centroidX(polygon) {
  if (!polygon?.length) return 0.5;
  return polygon.reduce((s, p) => s + num(p[0]), 0) / polygon.length;
}

function gableRiseFt(photo, eave, polygons) {
  const stated = num(photo?.gable_rise_ft, 0);
  if (stated > 0) return stated;
  if (!(eave > 0)) return 0;
  let minY = 0;
  for (const poly of polygons) {
    for (const p of poly || []) if (num(p[1]) < minY) minY = num(p[1]);
  }
  return Math.max(0, -minY) * eave;
}

function overlapRatio(a, b) {
  const len = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  const denom = Math.min(a[1] - a[0], b[1] - b[0]);
  if (!(len > 0) || !(denom > 0)) return 0;
  return len / denom;
}

function openingKind(type) {
  return /door/.test(String(type || '')) ? 'door' : 'window';
}

function openingSignature(o) {
  const w = Math.round(num(o.width_ft) * 2) / 2;
  const h = Math.round(num(o.height_ft) * 2) / 2;
  return `${openingKind(o.type)}|${o.material}|${w}|${h}`;
}

function openingPosFraction(o, lengthFt) {
  const cx = num(o.center_x, NaN);
  if (Number.isFinite(cx) && cx >= 0 && cx <= 1) return cx;
  const px = num(o.pos_x, NaN);
  if (!Number.isFinite(px)) return null;
  if (px > 1 && lengthFt > 0) return Math.max(0, Math.min(1, px / lengthFt));
  if (px >= 0 && px <= 1) return px;
  return null;
}

/**
 * Same window in two photos counts once. A window that only one photo sees
 * still counts. Position is the identity when we have it; otherwise overlapping
 * views of one span contribute their max count, and disjoint spans add.
 */
function dedupeOpenings(items, faceLength) {
  const kept = [];
  const positioned = [];
  const unpositioned = [];
  for (const item of items) {
    const pos = openingPosFraction(item.opening, faceLength);
    if (pos == null) unpositioned.push(item);
    else positioned.push({ ...item, pos });
  }
  positioned.sort((a, b) => b.confidence - a.confidence);
  for (const item of positioned) {
    const sig = openingSignature(item.opening);
    const dup = kept.find((k) => k.pos != null && openingSignature(k.opening) === sig && Math.abs(k.pos - item.pos) <= 0.03);
    if (!dup) kept.push(item);
  }
  const pools = [];
  for (const item of unpositioned) {
    let pool = pools.find((p) => overlapRatio(p.span, item.span) > 0.5);
    if (!pool) {
      pool = { span: [...item.span], groups: new Map() };
      pools.push(pool);
    } else {
      pool.span = [Math.min(pool.span[0], item.span[0]), Math.max(pool.span[1], item.span[1])];
    }
    const sig = openingSignature(item.opening);
    const list = pool.groups.get(sig) || [];
    list.push(item);
    pool.groups.set(sig, list);
  }
  for (const pool of pools) {
    for (const [sig, list] of pool.groups) {
      const byPhoto = new Map();
      for (const item of list) {
        const arr = byPhoto.get(item.photoIndex) || [];
        arr.push(item);
        byPhoto.set(item.photoIndex, arr);
      }
      let best = [];
      for (const arr of byPhoto.values()) if (arr.length > best.length) best = arr;
      const already = kept.filter((k) => openingSignature(k.opening) === sig).length;
      for (let i = 0; i < Math.max(0, best.length - already); i += 1) kept.push(best[i]);
    }
  }
  return kept.map((k) => k.opening);
}

/** Percent of the visible wall per material, renormalized to 100. Null when the photo did not report shares. */
export function materialSharesFromVision(photo) {
  const buckets = {};
  const absorb = (label, value) => {
    const material = normalizeWallMaterial(label);
    const n = num(value, NaN);
    if (!material || !(n > 0)) return;
    buckets[material] = (buckets[material] || 0) + n;
  };
  const direct = photo?.material_shares;
  if (direct && typeof direct === 'object') {
    for (const [label, value] of Object.entries(direct)) absorb(label, value);
  }
  if (!Object.keys(buckets).length && Array.isArray(photo?.material_regions)) {
    for (const region of photo.material_regions) absorb(region?.material, region?.percent);
  }
  const sum = Object.values(buckets).reduce((s, v) => s + v, 0);
  if (!(sum >= 50) && !(sum > 0.5 && sum <= 1.5)) return null;
  const scale = sum <= 1.5 ? 100 / sum : 100 / sum;
  return Object.fromEntries(Object.entries(buckets).map(([m, v]) => [m, v * scale]));
}

function sharesFromPolygons(photo) {
  const areas = {};
  let total = 0;
  for (const section of photo?.sections || []) {
    const poly = sectionPolygon(section);
    const material = normalizeWallMaterial(section?.material);
    if (!poly || !material) continue;
    const area = polygonArea(poly);
    areas[material] = (areas[material] || 0) + area;
    total += area;
  }
  if (!(total > 0)) return null;
  return Object.fromEntries(Object.entries(areas).map(([m, a]) => [m, (a / total) * 100]));
}

/**
 * Combine N vision reads of one photo. Area fractions are the median per
 * material, so one wild read cannot swing the wall. Discrete fields (openings,
 * polygons) come from the read closest to that median.
 */
export function mergeVisionMaterialSamples(samples) {
  const usable = (Array.isArray(samples) ? samples : []).filter((s) => s && typeof s === 'object');
  if (!usable.length) return null;
  const shareSets = usable.map((s) => materialSharesFromVision(s) || sharesFromPolygons(s) || {});
  const merged = {};
  const spread = {};
  for (const material of WALL_MATERIALS) {
    const values = shareSets.map((set) => num(set[material], 0));
    const mid = median(values);
    if (mid > 0.5) merged[material] = mid;
    if (values.length) spread[material] = round(Math.max(...values) - Math.min(...values), 1);
  }
  const sum = Object.values(merged).reduce((s, v) => s + v, 0);
  if (sum > 0) {
    for (const material of Object.keys(merged)) merged[material] = merged[material] * 100 / sum;
  }
  let best = usable[0];
  let bestDist = Infinity;
  usable.forEach((sample, index) => {
    const set = shareSets[index];
    let dist = 0;
    for (const material of WALL_MATERIALS) dist += Math.abs(num(set[material], 0) - num(merged[material], 0));
    if (dist < bestDist) { bestDist = dist; best = sample; }
  });
  const eaves = usable.map((s) => num(s.eave_height_ft, NaN)).filter((n) => n > 0);
  const gables = usable.map((s) => num(s.gable_rise_ft, NaN)).filter((n) => Number.isFinite(n) && n >= 0);
  const fracs = usable.map((s) => num(s.visible_width_fraction, NaN)).filter((n) => n > 0 && n <= 1);
  const faceVotes = new Map();
  for (const sample of usable) {
    const face = normalizeFace(sample.wall_face);
    if (!face) continue;
    faceVotes.set(face, (faceVotes.get(face) || 0) + 1);
  }
  const voted = [...faceVotes.entries()].sort((a, b) => b[1] - a[1])[0];
  const maxSpread = Math.max(0, ...Object.values(spread));
  const lowConfidence = usable.length < 3 || maxSpread > 20;
  const reviewReason = !lowConfidence ? null
    : usable.length < 3
      ? `only ${usable.length} vision read${usable.length === 1 ? '' : 's'} at temperature 0 (need 3)`
      : `vision reads differ by ${round(maxSpread, 1)} points`;
  // The closest sample still supplies openings and polygons. Its material
  // percents do not: one wild region was outvoting the median (Malec's right
  // side swung 37–65% stone/stucco). Fractions below are the median.
  const medianRegions = regionsFromMedianShares(merged, best?.siding_profile || best?.siding_material);
  let dominant = null;
  let dominantPct = 0;
  for (const material of ['stone', 'stucco', 'brick']) {
    const pct = Number(merged[material]) || 0;
    if (pct > dominantPct) { dominantPct = pct; dominant = material; }
  }
  return {
    ...best,
    ...(eaves.length ? { eave_height_ft: median(eaves) } : {}),
    ...(gables.length ? { gable_rise_ft: median(gables) } : {}),
    ...(fracs.length ? { visible_width_fraction: median(fracs) } : {}),
    ...(voted ? { wall_face: voted[0] } : {}),
    material_shares: merged,
    ...(medianRegions ? { material_regions: medianRegions } : {}),
    non_siding_material: dominant || 'none',
    non_siding_pct: Math.round(dominantPct),
    non_siding_coverage_pct: Math.round(dominantPct),
    material_share_spread: spread,
    material_share_spread_max: round(maxSpread, 1),
    material_sample_count: usable.length,
    material_low_confidence: lowConfidence,
    material_review_reason: reviewReason,
  };
}

/** Median shares rewritten as regions, so one sample's trace cannot raise them. */
function regionsFromMedianShares(merged, profile) {
  const vertical = /vertical|board/.test(String(profile || ''));
  const sidingName = vertical ? 'vertical_siding' : 'lap_siding';
  const buckets = [
    [sidingName, Number(merged?.siding) || 0],
    ['stone', Number(merged?.stone) || 0],
    ['stucco', Number(merged?.stucco) || 0],
    ['brick', Number(merged?.brick) || 0],
  ];
  const sum = buckets.reduce((total, [, value]) => total + value, 0);
  if (!(sum > 0)) return null;
  const regions = [];
  for (const [material, value] of buckets) {
    const percent = Math.round((value * 100) / sum);
    if (percent > 0) regions.push({ material, percent });
  }
  const drift = 100 - regions.reduce((total, region) => total + region.percent, 0);
  if (regions.length && drift !== 0) regions[0].percent += drift;
  return regions;
}

export const FACE_AREA_BAND = { min: 0.6, max: 1.3, storyHeightFt: 9.5 };

/**
 * A full-width drawn brick band, or an explicit brick percent, is a floor.
 * Stone and stucco are not lifted: a close-up or a "masonry" percent was
 * being copied onto the whole wall and counted as stone. The floor only
 * raises brick. It never shrinks traced brick back into siding.
 */
function applyMasonryFloor(areas, totals, faceEntry, primary) {
  const eave = num(primary?.eave);
  const faceLen = num(faceEntry?.length_ft);
  const wallRect = faceLen * eave;
  if (!(wallRect > 0) || !primary) return;
  const fullSpan = num(primary.spanWidth) >= 0.85;
  let floor = fullSpan ? num(primary.areas?.brick) : 0;
  const labeled = normalizeWallMaterial(primary.nonSidingMaterial);
  const pct = num(primary.nonSidingPct, NaN);
  if (labeled === 'brick' && pct > 2 && pct <= 100) {
    floor = Math.max(floor, wallRect * (pct / 100));
  }
  const current = num(areas.brick);
  if (!(floor > current + 1)) return;
  const need = floor - current;
  areas.brick = round(floor, 1);
  totals.brick = num(totals.brick) + need;
  const have = num(areas.siding);
  const take = Math.min(have, need);
  if (!(take > 0)) return;
  const left = have - take;
  totals.siding = num(totals.siding) - take;
  if (left > 0.5) areas.siding = round(left, 1);
  else delete areas.siding;
}

function contributionFractions(contribution) {
  const source = contribution?.usesShares ? contribution.fullFaceAreas : contribution?.areas;
  const gross = contribution?.usesShares ? contribution.fullGross : contribution?.gross;
  const out = {};
  if (!(gross > 0)) return out;
  for (const material of WALL_MATERIALS) {
    out[material] = ((source?.[material] || 0) / gross) * 100;
  }
  return out;
}

/** Confidence-weighted fractions across every share-reading photo of a face. */
function blendMaterialShares(reads) {
  const weights = reads.map((read) => Math.max(0.05, Number(read.confidence) || 0.05));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const percents = {};
  reads.forEach((read, index) => {
    const fractions = contributionFractions(read);
    const weight = weights[index];
    for (const material of WALL_MATERIALS) {
      percents[material] = (percents[material] || 0) + (fractions[material] || 0) * weight;
    }
  });
  if (weightSum > 0) {
    for (const material of Object.keys(percents)) percents[material] /= weightSum;
  }
  return percents;
}

function fractionSpread(reads) {
  const byMaterial = {};
  for (const read of reads) {
    const fractions = contributionFractions(read);
    const sum = Object.values(fractions).reduce((total, value) => total + value, 0);
    if (!(sum > 1)) continue;
    for (const material of WALL_MATERIALS) {
      (byMaterial[material] = byMaterial[material] || []).push(fractions[material] || 0);
    }
  }
  let spread = 0;
  for (const values of Object.values(byMaterial)) {
    if (values.length < 2) continue;
    spread = Math.max(spread, Math.max(...values) - Math.min(...values));
  }
  return spread;
}

function lowestConfidence(values) {
  const rank = { low: 0, medium: 1, high: 2 };
  return values.reduce((worst, value) => (rank[value] < rank[worst] ? value : worst), 'high');
}

const OPPOSITE_FACE = { front: 'back', back: 'front', left: 'right', right: 'left' };
const MIN_FACE_LENGTH_FT = 8;

/**
 * A side with no footprint length is not a 0 sq ft wall. Use the opposite
 * side when the perimeter still has room for it. When the perimeter is
 * already full, the missing side's length was absorbed by its opposite, so
 * split that opposite instead of adding it twice. Otherwise share whatever
 * perimeter is still unassigned.
 */
export function inferUncoveredFaceLengths(lengths = {}, { perimeterFt = 0 } = {}) {
  const next = {
    front: num(lengths.front),
    right: num(lengths.right),
    back: num(lengths.back),
    left: num(lengths.left),
  };
  const inferred = {};
  const perimeter = num(perimeterFt);
  const empty = () => FACES.filter((face) => !(next[face] > 0));
  const assigned = () => FACES.reduce((sum, face) => sum + next[face], 0);
  for (const face of empty()) {
    const opposite = OPPOSITE_FACE[face];
    const oppositeLen = next[opposite];
    if (!(oppositeLen > 0)) continue;
    const sum = assigned();
    const perimeterFull = perimeter > 0 && sum >= perimeter * 0.9;
    if (perimeterFull) {
      const half = oppositeLen / 2;
      next[face] = half;
      next[opposite] = oppositeLen - half;
      inferred[face] = 'opposite_side';
    } else {
      const room = perimeter > 0 ? Math.max(0, perimeter - sum) : oppositeLen;
      const give = Math.min(oppositeLen, room > 0 ? room : oppositeLen);
      if (give > 0) {
        next[face] = give;
        inferred[face] = 'opposite_side';
      }
    }
  }
  const stillEmpty = empty();
  if (stillEmpty.length && perimeter > 0) {
    const remain = Math.max(0, perimeter - assigned());
    const share = remain / stillEmpty.length;
    if (share > 0) {
      for (const face of stillEmpty) {
        next[face] = share;
        inferred[face] = 'perimeter_remainder';
      }
    }
  }
  for (const face of FACES) {
    if (next[face] >= MIN_FACE_LENGTH_FT) continue;
    const opposite = OPPOSITE_FACE[face];
    const oppositeLen = next[opposite];
    if (!(oppositeLen >= MIN_FACE_LENGTH_FT * 2)) continue;
    const half = oppositeLen / 2;
    next[face] = half;
    next[opposite] = oppositeLen - half;
    inferred[face] = 'opposite_side';
  }
  return {
    lengths: Object.fromEntries(FACES.map((face) => [face, round(next[face], 1)])),
    inferred,
  };
}

/**
 * @param {object} input
 * @param {object[]} input.photos  per-photo vision results
 * @param {object} [input.faceLengthsFt]  { front, right, back, left } from the footprint
 * @param {number} [input.footprintPerimeterFt]
 * @param {object} [input.overrides] rep corrections by section id
 * @param {boolean} [input.fillUncoveredFaces] give every known footprint face an area
 */
export function measureWallMaterialSections(input = {}) {
  const photos = Array.isArray(input.photos) ? input.photos : [];
  let faceLengths = { ...(input.faceLengthsFt || {}) };
  let lengthInference = {};
  if (input.fillUncoveredFaces) {
    const inferredLengths = inferUncoveredFaceLengths(faceLengths, {
      perimeterFt: input.footprintPerimeterFt,
    });
    faceLengths = inferredLengths.lengths;
    lengthInference = inferredLengths.inferred;
  }
  const overrides = input.overrides || {};
  const overlay = [];
  const byFace = {};
  const unclassified = [];

  photos.forEach((photo, photoIndex) => {
    const resolved = resolveFaces(photo);
    const eave = measurementEave(photo);
    if (!resolved.faces.length || eave <= 0) {
      unclassified.push({ photoIndex, reason: !resolved.faces.length ? 'no_wall_face' : 'no_eave_height' });
      return;
    }
    const prepared = (photo.sections || []).map((s, i) => ({
      id: s.id || `p${photoIndex}-s${i}`,
      material: normalizeWallMaterial(s.material),
      raw_material: s.material,
      polygon: sectionPolygon(s),
      confidence: num(s.confidence, 0.7),
      wall_face: normalizeFace(s.wall_face),
    })).filter((s) => s.polygon);
    const sections = applyOverrides(prepared, overrides);
    for (const face of resolved.faces) {
      const faceLen = num(faceLengths[face], 0) > 0 ? num(faceLengths[face]) : num(photo.wall_width_ft, 0);
      const span = spanFor({ ...photo, _face_length_ft: faceLen }, face, resolved.faces);
      const spanFrac = span[1] - span[0];
      const lengthFt = faceLen * (spanFrac > 0 ? spanFrac : 0);
      const onThisFace = (s) => {
        if (s.wall_face) return s.wall_face === face;
        if (resolved.faces.length < 2) return true;
        const mid = centroidX(s.polygon);
        return (mid < 0.5 ? resolved.faces[0] : resolved.faces[1]) === face;
      };
      const faceSections = sections.filter(onThisFace);
      const frameSqft = lengthFt * eave;
      const areas = {};
      const polygons = [];
      const modelMaterials = prepared.filter(onThisFace).map((s) => s.material).filter(Boolean);
      for (const s of faceSections) {
        const a = polygonArea(s.polygon) * frameSqft;
        polygons.push(s.polygon);
        if (s.material) areas[s.material] = (areas[s.material] || 0) + a;
        overlay.push({
          id: s.id,
          photo_index: photoIndex,
          view_label: photo.view_label || null,
          wall_face: face,
          material: s.material,
          ai_material: normalizeWallMaterial(s.raw_material),
          polygon: s.polygon,
          area_sqft: round(a, 1),
          confidence: s.confidence,
          rep_corrected: s.rep_corrected,
          needs_review: !s.material || s.confidence < 0.6,
          editable: true,
        });
      }
      const rise = gableRiseFt(photo, eave, polygons);
      const gross = lengthFt * eave + lengthFt * rise * 0.5;
      const rawSum = Object.values(areas).reduce((s, v) => s + v, 0);
      const scale = gross > 0 && rawSum > gross * 1.02 ? gross / rawSum : 1;
      const capped = {};
      for (const [m, v] of Object.entries(areas)) capped[m] = v * scale;
      // Reported shares describe the visible wall. Once this photo is the one
      // kept for the face, those shares apply to the whole footprint face,
      // not to the sliver that happened to be in frame.
      const shares = !photo.is_corner_shot ? materialSharesFromVision(photo) : null;
      const fullRise = num(photo.gable_rise_ft, 0) > 0 ? num(photo.gable_rise_ft) : rise;
      // A garage wing or a narrow gable is not the whole elevation. Its eave
      // and its triangle stay on the photographed width. The rest of the
      // footprint edge keeps the house eave.
      const garageOrNarrowGable = isOneStoryWing(photo)
        || (photo?.has_gable_end === true
          && faceLen > 0
          && num(photo.wall_width_ft, 0) > 0
          && num(photo.wall_width_ft, 0) < faceLen * 0.75);
      const photographedPortion = garageOrNarrowGable && spanFrac > 0 && spanFrac < 0.92;
      const restLen = photographedPortion ? Math.max(0, faceLen - lengthFt) : 0;
      const houseHeight = num(input.wallHeightFt, 0);
      const restHeight = houseHeight > eave ? houseHeight : eave;
      const fullGross = photographedPortion
        ? lengthFt * eave + lengthFt * fullRise * 0.5 + restLen * restHeight
        : faceLen * eave + faceLen * fullRise * 0.5;
      const fullFaceAreas = {};
      if (shares) {
        for (const [m, pct] of Object.entries(shares)) fullFaceAreas[m] = fullGross * pct / 100;
      }
      const entry = byFace[face] || (byFace[face] = { contributions: [], openings: [], length_ft: faceLen });
      entry.length_ft = faceLen;
      entry.contributions.push({
        photoIndex,
        corner: photo.is_corner_shot === true,
        confidence: unitConfidence(photo.confidence, 0.7),
        span,
        spanWidth: spanFrac,
        eave,
        lengthFt,
        areas: capped,
        gross,
        usesShares: Boolean(shares),
        fullFaceAreas,
        fullGross,
        partial: spanFrac > 0 && spanFrac < 0.9,
        nonSidingPct: num(photo.non_siding_pct, num(photo.non_siding_coverage_pct, NaN)),
        nonSidingMaterial: photo.non_siding_material || null,
        shareSpread: num(photo.material_share_spread_max, 0),
        sampleCount: num(photo.material_sample_count, 0),
        modelMaterials,
      });
      for (const o of photo.openings || []) {
        const tagged = normalizeFace(o.wall_face);
        let openingFace = face;
        if (tagged && resolved.faces.includes(tagged)) openingFace = tagged;
        else if (resolved.faces.length >= 2) {
          const x = openingPosFraction(o, faceLen);
          openingFace = x != null && x >= 0.5 ? resolved.faces[1] : resolved.faces[0];
        }
        if (openingFace !== face) continue;
        entry.openings.push({
          photoIndex,
          span,
          confidence: num(o.confidence, num(photo.confidence, 0.7)),
          opening: {
            type: openingKind(o.type),
            width_ft: num(o.width_ft),
            height_ft: num(o.height_ft),
            material: normalizeWallMaterial(o.material) || 'siding',
            pos_x: o.pos_x,
            center_x: o.center_x,
          },
        });
      }
    }
  });

  const faces = {};
  const totals = Object.fromEntries(WALL_MATERIALS.map((m) => [m, 0]));
  const openingTotals = { count: 0, windows: 0, doors: 0, window_sqft: 0, door_sqft: 0, by_material: {} };
  const story = storyCountFromPhotos(photos);
  const storyN = Math.max(1, story.story_count || 1);
  const describeFace = (faceRow, primary, areaSource, gableSqft, inferred) => {
    const wallSqft = Object.values(faceRow.areas).reduce((s, v) => s + v, 0);
    const reference = faceRow.length * storyN * FACE_AREA_BAND.storyHeightFt + gableSqft;
    const ratio = reference > 0 ? wallSqft / reference : null;
    const sanityOk = ratio == null || (ratio >= FACE_AREA_BAND.min && ratio <= FACE_AREA_BAND.max);
    const reasons = [];
    if (inferred) reasons.push('openings use a material that had no wall area');
    if (!sanityOk) reasons.push(`wall area is ${round(ratio, 2)}× a ${storyN}-story wall at ${FACE_AREA_BAND.storyHeightFt} ft`);
    const photosOnFace = Number(primary?.photosOnFace) || 0;
    if (photosOnFace < 3) {
      reasons.push(`only ${photosOnFace} photo${photosOnFace === 1 ? '' : 's'} of this face (need 3)`);
    }
    const faceSpread = Number(primary?.faceSpread) || 0;
    const readSpread = Number(primary?.readSpread) || 0;
    if (faceSpread > 20 || readSpread > 20) {
      const points = Math.round(Math.max(faceSpread, readSpread));
      reasons.push(`material reads differ by ${points} points (more than 20)`);
    }
    if (primary?.shareSpread > 20 && readSpread <= 20 && faceSpread <= 20) {
      reasons.push('repeated photo reads disagreed on materials');
    }
    if (primary?.corner && primary?.photoReads === 1) reasons.push('only a corner photo');
    if (areaSource === 'material_shares' && primary?.partial) reasons.push('a partial photo was applied to the full face');
    let confidence = 'high';
    if (reasons.length) confidence = 'low';
    else if (primary?.corner || primary?.partial || primary?.shareSpread > 10 || (primary?.sampleCount > 0 && primary.sampleCount < 2)) confidence = 'medium';
    return {
      area_source: areaSource,
      confidence,
      confidence_reasons: reasons,
      sanity_ok: sanityOk,
      area_ratio: ratio == null ? null : round(ratio, 2),
      reference_sqft: round(reference, 1),
    };
  };
  for (const face of FACES) {
    const e = byFace[face];
    if (!e) continue;
    const ranked = [...e.contributions].sort((a, b) => {
      const as = (a.corner ? 0 : 1000) + a.spanWidth * 100 + a.confidence * 10;
      const bs = (b.corner ? 0 : 1000) + b.spanWidth * 100 + b.confidence * 10;
      return bs - as;
    });
    const kept = [];
    for (const c of ranked) {
      if (!(c.lengthFt > 0)) continue;
      if (kept.some((k) => overlapRatio(k.span, c.span) > 0.5)) continue;
      kept.push(c);
    }
    if (!kept.length) continue;
    const primary = kept[0];
    const useShares = primary.usesShares === true;
    // Overlapping photos are measured once for polygons. Share percents are
    // already fractions of the whole face, so every straight photo votes.
    const shareReads = e.contributions.filter((contribution) => contribution.usesShares);
    const summed = {};
    let gableSqft = 0;
    const faceSpread = fractionSpread(e.contributions);
    const readSpread = Math.max(0, ...e.contributions.map((contribution) => Number(contribution.shareSpread) || 0));
    if (useShares) {
      const percents = blendMaterialShares(shareReads.length ? shareReads : [primary]);
      const fullGross = primary.fullGross > 0 ? primary.fullGross : 0;
      for (const [material, pct] of Object.entries(percents)) {
        if (pct > 0 && fullGross > 0) summed[material] = fullGross * pct / 100;
      }
      gableSqft = Math.max(0, primary.fullGross - e.length_ft * primary.eave);
    } else {
      for (const c of kept) {
        for (const [m, v] of Object.entries(c.areas)) summed[m] = (summed[m] || 0) + v;
      }
      gableSqft = kept.reduce((s, c) => s + Math.max(0, c.gross - c.lengthFt * c.eave), 0);
      const faceGross = e.length_ft * Math.max(...kept.map((c) => c.eave), 0) + gableSqft;
      const rawSum = Object.values(summed).reduce((s, v) => s + v, 0);
      const faceScale = faceGross > 0 && rawSum > faceGross * 1.02 ? faceGross / rawSum : 1;
      for (const m of Object.keys(summed)) summed[m] *= faceScale;
    }
    const areas = {};
    for (const [m, v] of Object.entries(summed)) {
      if (v > 0) { areas[m] = round(v, 1); totals[m] += v; }
    }
    // A drawn wainscot, or a grade-to-eave masonry percent, is a floor.
    // Shares may raise masonry. They must not shrink it below that floor.
    applyMasonryFloor(areas, totals, e, primary);
    const openings = dedupeOpenings(e.openings, e.length_ft);
    const perMat = {};
    for (const o of openings) {
      const a = o.width_ft * o.height_ft;
      const pm = perMat[o.material] || (perMat[o.material] = { count: 0, sqft: 0 });
      pm.count += 1; pm.sqft += a;
      const om = openingTotals.by_material[o.material] || (openingTotals.by_material[o.material] = { count: 0, sqft: 0 });
      om.count += 1; om.sqft += a;
      openingTotals.count += 1;
      if (o.type === 'door') { openingTotals.doors += 1; openingTotals.door_sqft += a; } else { openingTotals.windows += 1; openingTotals.window_sqft += a; }
    }
    const seenByModel = new Set();
    for (const c of (useShares ? [primary] : kept)) {
      for (const material of c.modelMaterials || []) seenByModel.add(material);
    }
    let inferred = false;
    for (const material of ['stone', 'stucco', 'brick']) {
      const openingSqft = perMat[material]?.sqft || 0;
      // A rep who retagged the model's section away from this material is
      // kept. The floor only covers a material the model never drew.
      if (openingSqft > 0 && !(areas[material] > 0) && !seenByModel.has(material)) {
        areas[material] = round(openingSqft, 1);
        totals[material] += openingSqft;
        inferred = true;
      }
    }
    const net = {};
    for (const [m, a] of Object.entries(areas)) net[m] = round(Math.max(0, a - (perMat[m]?.sqft || 0)), 1);
    const usedEaves = useShares ? [primary.eave] : kept.map((c) => c.eave);
    const photoReads = useShares ? Math.max(1, shareReads.length) : kept.length;
    const quality = describeFace(
      { areas, length: e.length_ft },
      {
        ...primary,
        photoReads,
        photosOnFace: e.contributions.length,
        faceSpread,
        readSpread,
      },
      useShares ? 'material_shares' : 'polygons',
      gableSqft,
      inferred,
    );
    faces[face] = {
      length_ft: round(e.length_ft, 1),
      eave_height_ft: round(median(usedEaves.length ? usedEaves : e.contributions.map((c) => c.eave)), 1),
      photo_reads: photoReads,
      photos_seen: e.contributions.length,
      gross_sqft_by_material: areas,
      net_sqft_by_material: net,
      openings_by_material: Object.fromEntries(Object.entries(perMat).map(([m, v]) => [m, { count: v.count, sqft: round(v.sqft, 1) }])),
      ...quality,
    };
  }
  if (input.fillUncoveredFaces) {
    let dominant = 'siding';
    let bestArea = 0;
    for (const material of WALL_MATERIALS) {
      if (totals[material] > bestArea) { bestArea = totals[material]; dominant = material; }
    }
    const eaves = Object.values(faces).map((f) => f.eave_height_ft).filter((v) => v > 0);
    const wallHeight = num(input.wallHeightFt);
    const height = wallHeight > 0
      ? wallHeight
      : (eaves.length ? median(eaves) : storyN * FACE_AREA_BAND.storyHeightFt);
    for (const face of FACES) {
      if (faces[face]) continue;
      const length = num(faceLengths[face], 0);
      if (!(length > 0)) continue;
      const gross = length * height;
      totals[dominant] += gross;
      const reference = length * storyN * FACE_AREA_BAND.storyHeightFt;
      const ratio = reference > 0 ? gross / reference : null;
      const sanityOk = ratio == null || (ratio >= FACE_AREA_BAND.min && ratio <= FACE_AREA_BAND.max);
      const how = lengthInference[face] === 'opposite_side'
        ? 'inferred from the opposite side'
        : lengthInference[face] === 'perimeter_remainder'
          ? 'inferred from the remaining footprint perimeter'
          : `assumed ${dominant} from the footprint`;
      const reasons = [`no photo of ${face}; ${how}`];
      if (!sanityOk) reasons.push(`wall area is ${round(ratio, 2)}× a ${storyN}-story wall at ${FACE_AREA_BAND.storyHeightFt} ft`);
      const areaSource = lengthInference[face] === 'opposite_side'
        ? 'inferred_opposite'
        : lengthInference[face] === 'perimeter_remainder'
          ? 'inferred_perimeter'
          : 'fallback';
      faces[face] = {
        length_ft: round(length, 1),
        eave_height_ft: round(height, 1),
        photo_reads: 0,
        photos_seen: 0,
        gross_sqft_by_material: { [dominant]: round(gross, 1) },
        net_sqft_by_material: { [dominant]: round(gross, 1) },
        openings_by_material: {},
        area_source: areaSource,
        inferred: areaSource !== 'fallback',
        confidence: 'low',
        confidence_reasons: reasons,
        sanity_ok: sanityOk,
        area_ratio: ratio == null ? null : round(ratio, 2),
        reference_sqft: round(reference, 1),
      };
    }
    const perimeter = num(input.footprintPerimeterFt);
    const prism = perimeter > 0 && height > 0 ? perimeter * height : 0;
    if (prism > 0) {
      const faceGross = (row) => Object.values(row?.gross_sqft_by_material || {}).reduce((s, v) => s + v, 0);
      const inferredNames = FACES.filter((face) => faces[face]?.inferred);
      const photographed = FACES
        .filter((face) => faces[face] && !faces[face].inferred)
        .reduce((sum, face) => sum + faceGross(faces[face]), 0);
      const inferredArea = inferredNames.reduce((sum, face) => sum + faceGross(faces[face]), 0);
      const budget = Math.max(0, prism - photographed);
      const allowance = prism * 1.1;
      let scale = inferredArea > budget + 0.5 && inferredArea > 0 ? budget / inferredArea : 1;
      const projected = photographed + inferredArea * scale;
      if (projected > allowance && projected > 0) scale *= allowance / projected;
      const shrinkFace = (face, factor) => {
        const row = faces[face];
        if (!row || !(factor < 0.999)) return;
        for (const [material, value] of Object.entries(row.gross_sqft_by_material)) {
          const next = value * factor;
          totals[material] += next - value;
          row.gross_sqft_by_material[material] = round(next, 1);
          if (row.net_sqft_by_material[material] != null) {
            row.net_sqft_by_material[material] = round(row.net_sqft_by_material[material] * factor, 1);
          }
        }
      };
      if (scale < 0.999) {
        for (const face of inferredNames) shrinkFace(face, scale);
      }
      const house = FACES.reduce((sum, face) => sum + faceGross(faces[face]), 0);
      if (house > allowance + 0.5) {
        const photoScale = allowance / house;
        for (const face of FACES) {
          if (faces[face] && !faces[face].inferred) shrinkFace(face, photoScale);
        }
      }
    }
  }
  for (const m of WALL_MATERIALS) totals[m] = round(totals[m], 1);
  for (const v of Object.values(openingTotals.by_material)) v.sqft = round(v.sqft, 1);
  openingTotals.window_sqft = round(openingTotals.window_sqft, 1);
  openingTotals.door_sqft = round(openingTotals.door_sqft, 1);

  const footprintPerimeter = num(input.footprintPerimeterFt, 0);
  const measuredPerimeter = Object.values(faces).reduce((s, f) => s + f.length_ft, 0);
  const missingFaces = FACES.filter((f) => !faces[f]);
  const materialsPresent = WALL_MATERIALS.filter((m) => totals[m] > 0);
  const warnings = [];
  for (const face of FACES) {
    const row = faces[face];
    if (row?.confidence === 'low') warnings.push(`${face}: ${(row.confidence_reasons || []).join('; ')}`);
  }
  if (!Object.keys(faces).length) warnings.push('no wall face was measured');
  const confidence = Object.keys(faces).length
    ? lowestConfidence(Object.values(faces).map((row) => row.confidence || 'low'))
    : 'low';

  return {
    version: '1.2.0',
    story,
    perimeter_ft: round(footprintPerimeter > 0 ? footprintPerimeter : measuredPerimeter, 1),
    perimeter_source: footprintPerimeter > 0 ? 'footprint' : 'photos',
    faces,
    totals_gross_sqft: totals,
    totals_net_sqft: Object.fromEntries(WALL_MATERIALS.map((m) => [m, round(Math.max(0, totals[m] - (openingTotals.by_material[m]?.sqft || 0)), 1)])),
    openings: openingTotals,
    materials_present: materialsPresent,
    overlay,
    missing_faces: missingFaces,
    length_inference: lengthInference,
    unclassified_photos: unclassified,
    complete: missingFaces.length === 0,
    warnings,
    confidence,
  };
}

function sectionFaceGross(row) {
  return Object.values(row?.gross_sqft_by_material || {}).reduce((sum, value) => sum + num(value), 0);
}

function scaleSectionFace(row, factor) {
  if (!row || !(factor >= 0) || Math.abs(factor - 1) < 1e-6) return;
  for (const material of Object.keys(row.gross_sqft_by_material || {})) {
    row.gross_sqft_by_material[material] = round(num(row.gross_sqft_by_material[material]) * factor, 1);
  }
  for (const material of Object.keys(row.net_sqft_by_material || {})) {
    row.net_sqft_by_material[material] = round(num(row.net_sqft_by_material[material]) * factor, 1);
  }
}

/**
 * Per-face section areas have to add up to the headline wall total.
 * Inferred faces give up the extra first. A section set that already
 * matches is not rewritten.
 */
export function reconcileWallSectionGross(sections, headlineGross) {
  if (!sections?.faces || typeof sections.faces !== 'object') return sections;
  const target = num(headlineGross);
  if (!(target > 0)) return sections;
  const names = Object.keys(sections.faces);
  const faces = sections.faces;
  let sum = names.reduce((total, name) => total + sectionFaceGross(faces[name]), 0);
  if (Math.abs(sum - target) <= 1) return sections;

  const inferred = names.filter((name) => faces[name]?.inferred);
  const photoSum = names
    .filter((name) => !faces[name]?.inferred)
    .reduce((total, name) => total + sectionFaceGross(faces[name]), 0);
  const inferredSum = inferred.reduce((total, name) => total + sectionFaceGross(faces[name]), 0);
  if (sum > target + 1 && inferredSum > 0) {
    const factor = Math.max(0, target - photoSum) / inferredSum;
    for (const name of inferred) {
      if (sectionFaceGross(faces[name]) * factor >= 56) scaleSectionFace(faces[name], factor);
    }
  }

  sum = names.reduce((total, name) => total + sectionFaceGross(faces[name]), 0);
  if (sum > target + 1 && sum > 0) {
    const factor = target / sum;
    for (const name of names) {
      const next = sectionFaceGross(faces[name]) * factor;
      if (next >= 56) scaleSectionFace(faces[name], factor);
    }
  }

  sum = names.reduce((total, name) => total + sectionFaceGross(faces[name]), 0);
  const residual = round(target - sum, 1);
  if (residual <= -0.05) {
    const hostName = [...names].sort((a, b) => sectionFaceGross(faces[b]) - sectionFaceGross(faces[a]))[0];
    const host = hostName ? faces[hostName] : null;
    const hostGross = sectionFaceGross(host);
    if (host && hostGross + residual >= 56 && hostGross > 0) {
      scaleSectionFace(host, (hostGross + residual) / hostGross);
    }
  }
  const sectionOpposite = { front: 'back', back: 'front', left: 'right', right: 'left', left_side: 'right_side', right_side: 'left_side' };
  for (const name of names) {
    const gross = sectionFaceGross(faces[name]);
    if (gross >= 56) continue;
    const otherName = sectionOpposite[name];
    const other = otherName ? faces[otherName] : null;
    const otherGross = sectionFaceGross(other);
    if (!other || otherGross < 112) continue;
    scaleSectionFace(other, 0.5);
    faces[name].gross_sqft_by_material = { ...(other.gross_sqft_by_material || {}) };
    faces[name].net_sqft_by_material = { ...(other.net_sqft_by_material || {}) };
    faces[name].inferred = true;
  }

  const gross = {};
  const net = {};
  for (const name of names) {
    for (const [material, value] of Object.entries(faces[name].gross_sqft_by_material || {})) {
      gross[material] = (gross[material] || 0) + num(value);
    }
    for (const [material, value] of Object.entries(faces[name].net_sqft_by_material || {})) {
      net[material] = (net[material] || 0) + num(value);
    }
  }
  if (sections.totals_gross_sqft) {
    for (const key of Object.keys(sections.totals_gross_sqft)) {
      sections.totals_gross_sqft[key] = round(gross[key] || 0, 1);
    }
  }
  if (sections.totals_net_sqft) {
    for (const key of Object.keys(sections.totals_net_sqft)) {
      sections.totals_net_sqft[key] = round(net[key] || 0, 1);
    }
  }
  return sections;
}

const LINE_MATERIAL_PATTERNS = {
  stone: /\bstone\b|\bmasonry\b|\bcultured\b/i,
  brick: /\bbrick\b/i,
  stucco: /\bstucco\b|\beifs\b/i,
  siding: /\bsiding\b|\bvinyl\b|\balumin(?:um|ium)\b|\blap\b|\bclapboard\b/i,
};
const ALWAYS_HOLD = /\basbestos\b|\blead[\s-]*(?:paint|abatement)\b/i;

/**
 * Keep only line items whose wall material was measured (or confirmed by the
 * rep). Lines naming a material that is not on the house are dropped; hazard
 * lines are held for explicit rep approval. Accessory lines with no wall
 * material in the description pass through.
 */
function unitConfidence(value, fallback = 0.7) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const unit = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, unit));
}

function asPolygon(section) {
  const raw = section?.polygon || section?.points;
  if (!Array.isArray(raw)) return null;
  const points = raw.map((p) => {
    if (Array.isArray(p) && p.length >= 2) return [Number(p[0]), Number(p[1])];
    if (p && typeof p === 'object') return [Number(p.x), Number(p.y)];
    return null;
  }).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  return points.length >= 3 ? points : null;
}

/** Turn one vision photo into the shape measureWallMaterialSections expects. */
export function visionPhotoToMaterialPhoto(photo = {}) {
  const sections = (Array.isArray(photo.sections) ? photo.sections : []).map((section) => {
    const polygon = asPolygon(section);
    const bbox = section?.bbox;
    return {
      id: section?.id,
      material: section?.material,
      wall_face: section?.wall_face,
      polygon: polygon || undefined,
      bbox,
      confidence: unitConfidence(section?.confidence, 0.7),
    };
  }).filter((section) => section.polygon || section.bbox);
  const frac = Number(photo.visible_width_fraction);
  const xStart = Number(photo.visible_x_start);
  return {
    view_label: photo.view_label || photo.label || null,
    wall_face: photo.wall_face,
    secondary_wall_face: photo.secondary_wall_face || photo.secondary_face || null,
    faces_driveway: photo.faces_driveway === true || photo.driveway_visible === true,
    driveway_visible: photo.driveway_visible === true,
    scene: photo.scene || null,
    notes: photo.notes || null,
    confidence_reason: photo.confidence_reason || null,
    eave_height_ft: photo.eave_height_ft,
    eave_before_clamp_ft: photo.eave_before_clamp_ft,
    model_eave_height_ft: photo.model_eave_height_ft,
    measured_eave_height_ft: photo.measured_eave_height_ft,
    gable_rise_ft: photo.gable_rise_ft,
    height_method: photo.height_method || null,
    height_clamped: photo.height_clamped === true,
    non_siding_pct: Number.isFinite(Number(photo.non_siding_pct)) ? Number(photo.non_siding_pct) : null,
    non_siding_coverage_pct: Number.isFinite(Number(photo.non_siding_coverage_pct)) ? Number(photo.non_siding_coverage_pct) : null,
    non_siding_material: photo.non_siding_material || null,
    is_one_story_wing: photo.is_one_story_wing === true,
    wall_width_ft: photo.wall_width_ft,
    observed_wall_width_ft: photo.observed_wall_width_ft,
    visible_width_ft: photo.visible_width_ft,
    visible_width_fraction: Number.isFinite(frac) ? frac : null,
    visible_x_start: Number.isFinite(xStart) ? xStart : null,
    face_spans: photo.face_spans && typeof photo.face_spans === 'object' ? photo.face_spans : null,
    window_rows: photo.window_rows,
    story_count: photo.story_count,
    garage_doors_count: photo.garage_doors_count,
    confidence: unitConfidence(photo.confidence, 0.7),
    is_corner_shot: photo.is_corner_shot === true,
    material_shares: photo.material_shares && typeof photo.material_shares === 'object' ? photo.material_shares : null,
    material_regions: Array.isArray(photo.material_regions) ? photo.material_regions : null,
    material_share_spread: photo.material_share_spread && typeof photo.material_share_spread === 'object' ? photo.material_share_spread : null,
    material_share_spread_max: Number.isFinite(Number(photo.material_share_spread_max)) ? Number(photo.material_share_spread_max) : null,
    material_sample_count: Number(photo.material_sample_count) || 0,
    sections,
    openings: (Array.isArray(photo.openings) ? photo.openings : []).map((opening) => ({
      type: opening?.type,
      width_ft: opening?.width_ft,
      height_ft: opening?.height_ft,
      material: opening?.material,
      wall_face: opening?.wall_face,
      pos_x: opening?.pos_x,
      center_x: opening?.center_x,
      confidence: opening?.confidence,
    })),
  };
}

function compassAzimuth(east, north) {
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

function angularDifference(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Sum footprint edges (x = east feet, y = north feet) onto front/right/back/left.
 * `frontAzimuthDeg` is the front wall's outward normal, from a photo heading
 * or the nearest road. Without it the edges are not assigned: treating a
 * south wall as the front was the wrong default.
 */
export function faceLengthsFromFootprint(polygon, { frontAzimuthDeg = null } = {}) {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  const pts = polygon
    .map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null))
    .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length >= 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.05) pts.pop();
  }
  if (pts.length < 3) return null;
  let twice = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = twice > 0;
  if (frontAzimuthDeg == null || frontAzimuthDeg === '') return null;
  const frontAz = Number(frontAzimuthDeg);
  if (!Number.isFinite(frontAz)) return null;
  const targets = {
    front: ((frontAz % 360) + 360) % 360,
    left: (((frontAz + 90) % 360) + 360) % 360,
    back: (((frontAz + 180) % 360) + 360) % 360,
    right: (((frontAz + 270) % 360) + 360) % 360,
  };
  const faces = { front: 0, right: 0, back: 0, left: 0 };
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.4) continue;
    const nx = ccw ? dy : -dy;
    const ny = ccw ? -dx : dx;
    const az = compassAzimuth(nx, ny);
    let best = 'front';
    let bestErr = Infinity;
    for (const [face, faceAz] of Object.entries(targets)) {
      const err = angularDifference(az, faceAz);
      if (err < bestErr) { bestErr = err; best = face; }
    }
    faces[best] += len;
  }
  if (Object.values(faces).every((v) => v <= 0)) return null;
  return {
    front: round(faces.front, 1),
    right: round(faces.right, 1),
    back: round(faces.back, 1),
    left: round(faces.left, 1),
  };
}

/**
 * Live photo-analyzer entry. Face lengths come from the Solar/footprint
 * polygon when one exists; wall height stays on each photo's eave.
 */
/**
 * Choose a Solar roof area from the segment sum and the whole-roof stat.
 * A segment set within 15% of the whole roof is used as-is. A moderate gap
 * keeps the segments plus 5%. A large gap is averaged. The whole-roof stat
 * is not substituted outright: on a near-complete roof it runs high.
 * Returns null when both inputs are empty.
 */
export function resolveSolarRoofArea(segmentSqFt, wholeSqFt) {
  const seg = num(segmentSqFt);
  const whole = num(wholeSqFt);
  if (seg > 0 && whole > 0) {
    const ratio = seg / whole;
    if (ratio >= 0.85) return { area: seg, method: 'segment_sum', ratio };
    if (ratio >= 0.65) return { area: seg * 1.05, method: 'segment_sum_5', ratio };
    return { area: (seg + whole) / 2, method: 'average', ratio };
  }
  if (seg > 0) return { area: seg, method: 'segment_sum', ratio: null };
  if (whole > 0) return { area: whole * 0.92, method: 'wholeRoofStats', ratio: null };
  return null;
}

const SQM_TO_SQFT = 10.7639;

/** Segment, whole-roof, and plan areas from one Solar buildingInsights payload. */
export function solarAreaParts(solarPotential) {
  if (!solarPotential || typeof solarPotential !== 'object') return null;
  const wholeM2 = num(solarPotential.wholeRoofStats?.areaMeters2);
  const groundM2 = num(solarPotential.wholeRoofStats?.groundAreaMeters2);
  const segs = Array.isArray(solarPotential.roofSegmentStats) ? solarPotential.roofSegmentStats : [];
  let segM2 = 0;
  let segGroundM2 = 0;
  for (const seg of segs) {
    segM2 += num(seg?.stats?.areaMeters2);
    segGroundM2 += num(seg?.stats?.groundAreaMeters2);
  }
  const resolved = resolveSolarRoofArea(segM2 * SQM_TO_SQFT, wholeM2 * SQM_TO_SQFT);
  return {
    segment_count: segs.length,
    segment_area_sqft: round(segM2 * SQM_TO_SQFT, 1),
    whole_area_sqft: round(wholeM2 * SQM_TO_SQFT, 1),
    ground_area_sqft: round((groundM2 > 0 ? groundM2 : segGroundM2) * SQM_TO_SQFT, 1),
    segment_to_whole_ratio: wholeM2 > 0 ? round(segM2 / wholeM2, 3) : null,
    area_sqft: resolved ? Math.round(resolved.area) : 0,
    area_method: resolved?.method || null,
  };
}

/** The Solar building's plan is much smaller than the mapped footprint. */
export function solarUndershootsFootprint(groundSqFt, footprintPlanSqFt) {
  const ground = num(groundSqFt);
  const foot = num(footprintPlanSqFt);
  return foot > 0 && ground > 0 && ground < foot * 0.75;
}

/**
 * A second Solar building is the one to bill only when it is larger than the
 * first and still fits the footprint. A neighbour several times bigger is not.
 */
export function preferAlternateSolar({
  primaryGroundSqFt = 0,
  primarySlopeSqFt = 0,
  alternateGroundSqFt = 0,
  alternateSlopeSqFt = 0,
  footprintPlanSqFt = 0,
} = {}) {
  const foot = num(footprintPlanSqFt);
  const primary = num(primaryGroundSqFt);
  const alt = num(alternateGroundSqFt);
  if (!(foot > 0) || !(alt > primary * 1.1)) return false;
  if (alt > foot * 1.45) return false;
  if (primary >= foot * 0.8) return false;
  return num(alternateSlopeSqFt) > num(primarySlopeSqFt) * 1.05;
}

/**
 * Solar roof area in square feet. Returns null when Solar has no area.
 */
export function solarRoofAreaSqFt(solarPotential) {
  const parts = solarAreaParts(solarPotential);
  if (!parts || !(parts.area_sqft > 0)) return null;
  return parts.area_sqft;
}

export function measureFromPhotoAnalysis({
  photos = [],
  footprintPolygon = null,
  footprintPerimeterFt = 0,
  frontAzimuthDeg = null,
  buildingWidthFt = 0,
  buildingLengthFt = 0,
  wallHeightFt = 0,
  overrides = {},
  roofAreaSqFt = 0,
} = {}) {
  const prepared = (Array.isArray(photos) ? photos : []).map(visionPhotoToMaterialPhoto);
  const fromPoly = faceLengthsFromFootprint(footprintPolygon, { frontAzimuthDeg });
  const width = num(buildingWidthFt);
  const depth = num(buildingLengthFt);
  const faceLengthsFt = fromPoly || {
    front: width,
    back: width,
    left: depth,
    right: depth,
  };
  const measured = measureWallMaterialSections({
    photos: prepared,
    faceLengthsFt,
    footprintPerimeterFt,
    wallHeightFt,
    overrides,
    fillUncoveredFaces: true,
  });
  const roof = num(roofAreaSqFt, 0);
  return {
    ...measured,
    face_lengths_ft: faceLengthsFt,
    face_length_source: fromPoly
      ? (Number.isFinite(Number(frontAzimuthDeg)) ? 'footprint_azimuth' : 'footprint_compass')
      : 'bbox',
    roof_area_sqft: roof > 0 ? Math.round(roof) : null,
    roof_area_source: roof > 0 ? 'solar' : null,
    inputs: {
      photos: prepared,
      faceLengthsFt,
      footprintPerimeterFt: num(footprintPerimeterFt),
      fillUncoveredFaces: true,
    },
  };
}

export function filterLineItemsToMaterials(items = [], { materialsPresent = [], approvedIds = [] } = {}) {
  const present = new Set(materialsPresent);
  const approved = new Set(approvedIds.map((s) => String(s).toLowerCase()));
  const kept = [];
  const dropped = [];
  const held = [];
  for (const item of items) {
    const text = `${item?.description || ''} ${item?.code || ''}`;
    const id = String(item?.confirm_id || item?.code || item?.description || '').toLowerCase();
    if (ALWAYS_HOLD.test(text)) {
      if (approved.has(id)) kept.push(item); else held.push({ ...item, held_reason: 'hazard_requires_rep_approval' });
      continue;
    }
    const named = Object.entries(LINE_MATERIAL_PATTERNS).filter(([, re]) => re.test(text)).map(([m]) => m);
    // "brick veneer" style lines name one material; vinyl/siding lines name siding.
    const masonryNamed = named.filter((m) => m !== 'siding');
    const relevant = masonryNamed.length ? masonryNamed : named;
    if (!relevant.length || relevant.some((m) => present.has(m)) || approved.has(id)) kept.push(item);
    else dropped.push({ ...item, dropped_reason: `no ${relevant.join('/')} measured on this house` });
  }
  return { items: kept.map((it, i) => ({ ...it, line: i + 1 })), dropped, held };
}

export default measureWallMaterialSections;
