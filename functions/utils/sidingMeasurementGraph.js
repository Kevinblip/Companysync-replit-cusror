/**
 * Shared Canonical Siding Measurement Graph
 * ─────────────────────────────────────────
 * A pure, deterministic transformation from raw per-photo AI siding results
 * (plus aggregate footprint/wall fields) into a versioned, normalized graph.
 *
 * DESIGN CONTRACTS (do not violate — regression-tested):
 *  • Pure & deterministic: no Math.random(), no Date.now(), no I/O. Identical
 *    input always yields byte-identical output. All IDs are content-derived.
 *  • Every valid raw opening is preserved — including openings under 10 sqft.
 *    Adjacent / similar openings are NEVER merged.
 *  • Each raw opening becomes a rough-opening group. Explicit sub-components
 *    (e.g. mulled window units) are represented separately as components, but
 *    deduction geometry always uses the rough-opening GROUP, never the sum of
 *    its components.
 *  • Deductibility: when smallOpeningsInWaste === false, only groups whose
 *    area is >= 20 sqft are deductible (smaller ones ride in the waste factor).
 *    When smallOpeningsInWaste === true, every group is deductible.
 *  • J-channel is the unique rough-opening perimeters plus the roof-wall
 *    line (eave + rake), once. Never the sum of internal component
 *    perimeters, and never a per-photo or per-facet edge.
 *  • Dedupe only true repeated photo observations of the SAME resolved wall
 *    face + type with either an explicit stable observation identity OR
 *    near-identical geometry AND position. Never dedupe on zone alone. The
 *    highest-confidence copy survives.
 *
 * @module functions/utils/sidingMeasurementGraph
 */

import { buildMultiViewPhotoEvidence } from './multiViewPhotoEvidence.js';
import { slotFaces } from './photoSlotOrientation.js';
import { computeEdgeTotals } from './roofFacetGeometry.js';
import { eaveExcludingGable } from '../../src/utils/companySyncFormulas.js';
import { fullHeightMasonrySpans, polygonArea } from './wallMaterialSections.js';
import {
  FACE_MATERIAL_SPREAD_LIMIT,
  PRODUCTION_MATERIAL_SAMPLE_COUNT,
} from './faceMaterialClassification.js';

export const SIDING_GRAPH_VERSION = '1.1.0';

// ── Canonical wall faces ────────────────────────────────────────────────────
const WALL_FACES = ['front', 'back', 'left_side', 'right_side'];
const UNKNOWN_FACE = 'unknown';

// Small-opening deductibility threshold (sqft) when they are NOT in waste.
const MIN_DEDUCTIBLE_SQFT = 20;

// Geometry / position tolerances used only for near-identical dedupe.
// GEO_TOL_FT slightly wider (0.75) to account for camera-angle variation in width reads.
const GEO_TOL_FT = 0.75;  // width/height agreement across photo angles
const POS_TOL_FT = 1.5;   // x/y position agreement (wider for multi-angle overlap)

// ── Photo heights on footprint lengths ──────────────────────────────────────
// The traced footprint perimeter is the horizontal authority. A photo can
// read a wall too wide (background in frame) or too narrow (a wing the camera
// never saw). Either error used to replace the perimeter and made the photo
// total less accurate than the satellite extrusion.
//
//   billed width  = footprint edge for that face
//   billed height = photo eave, plus half the photo gable rise
//
// A face whose photo width misses its footprint edge by more than
// PHOTO_WIDTH_ANCHOR_BAND_PCT falls back to the aggregate wall height. The
// same band flags the whole result when the sum of photo widths misses the
// traced perimeter. Unnamed jog walls (perimeter longer than the four edges)
// stay in the total at the aggregate height.
const PHOTO_WIDTH_ANCHOR_BAND_PCT = 15;
// Kept so older callers that read the constant name still see the band the
// perimeter check uses.
const PHOTO_HERO_SANITY_BAND_PCT = PHOTO_WIDTH_ANCHOR_BAND_PCT;
// Grade-B consistency band: how far the photo-measured siding total may sit
// from the extrusion-derived sanity total and still be treated as corroborated.
const SIDING_SANITY_BAND_PCT = 15;

// ── Mullion banking (counting only) ─────────────────────────────────────────
// Hover counts a mulled bank — two or three sashes sharing one rough frame,
// one head line and one sill — as ONE window. Our vision pass reports every
// sash it can resolve, so a house Hover calls 14 windows can arrive here as 27
// separate groups and the assembly count reads like a unit count.
//
// Banking is a COUNTING view only. Deduction geometry, J-channel and the
// group/component graph are untouched (the graph contract forbids merging
// adjacent openings). Two window groups join the same bank when they share a
// face, their heights agree within MULLION_HEIGHT_TOL_FT, their vertical
// centres agree within MULLION_ALIGN_TOL_FT, and the horizontal gap between
// their edges is at most MULLION_GAP_TOL_FT — a mullion, not a run of wall.
const MULLION_HEIGHT_TOL_FT = 0.5;
const MULLION_ALIGN_TOL_FT = 0.5;
const MULLION_GAP_TOL_FT = 0.75;

const MATERIAL_CATEGORIES = new Set([
  'lap_siding',
  'vertical_siding',
  'stone',
  'brick',
  'stucco',
  'glass',
  'other',
  'unknown',
]);
const SIDING_MATERIAL_CATEGORIES = new Set(['lap_siding', 'vertical_siding']);

function normalizeMaterialCategory(value, profile = '') {
  const raw = String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (MATERIAL_CATEGORIES.has(raw)) return raw;
  if (raw.includes('stone') || raw.includes('masonry')) return 'stone';
  if (raw.includes('brick')) return 'brick';
  if (raw.includes('stucco') || raw.includes('eifs')) return 'stucco';
  if (raw.includes('glass')) return 'glass';
  if (raw.includes('vertical') || raw.includes('board_batten') || raw.includes('boardbatten')) {
    return 'vertical_siding';
  }
  if (raw.includes('vinyl') || raw.includes('aluminum') || raw.includes('fiber_cement')
      || raw.includes('wood') || raw.includes('lap') || raw.includes('shake')) {
    return 'lap_siding';
  }
  if (String(profile || '').toLowerCase().includes('board_batten')
      || String(profile || '').toLowerCase().includes('vertical')) {
    return 'vertical_siding';
  }
  return raw === 'none' ? 'unknown' : 'other';
}

function materialIsSiding(category) {
  return SIDING_MATERIAL_CATEGORIES.has(category);
}

// ── Small pure helpers ──────────────────────────────────────────────────────

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function finiteMasonryPct(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function mergeSpans(spans) {
  const sorted = (spans || [])
    .filter((span) => span && span[1] > span[0])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current = null;
  for (const span of sorted) {
    if (!current || span[0] > current[1]) {
      if (current) total += current[1] - current[0];
      current = [span[0], span[1]];
    } else {
      current[1] = Math.max(current[1], span[1]);
    }
  }
  if (current) total += current[1] - current[0];
  return Math.min(1, Math.max(0, total));
}

/**
 * Share of the perimeter covered by brick or stone that runs the full wall
 * height. Only that polygon's own width is removed. A foundation band, a
 * wainscot, and a masonry percent with no full-height polygon stay on starter.
 */
export function starterMasonryFraction(photos, {
  perimeterFt = 0,
  buildingWidthFt = 0,
  buildingLengthFt = 0,
} = {}) {
  const widths = {
    front: num(buildingWidthFt),
    back: num(buildingWidthFt),
    left_side: num(buildingLengthFt),
    right_side: num(buildingLengthFt),
  };
  const spansByFace = new Map();
  for (const photo of Array.isArray(photos) ? photos : []) {
    const face = resolveWallFace(photo?.wall_face || photo?.view_label || photo?.label);
    if (!(widths[face] > 0)) continue;
    const spans = fullHeightMasonrySpans(photo);
    if (!spans.length) continue;
    const list = spansByFace.get(face) || [];
    list.push(...spans);
    spansByFace.set(face, list);
  }
  let run = 0;
  for (const [face, spans] of spansByFace) run += widths[face] * mergeSpans(spans);
  const perimeter = num(perimeterFt);
  if (!(perimeter > 0) || !(run > 0)) return 0;
  return Math.min(1, run / perimeter);
}

function round(v, dp = 2) {
  const p = Math.pow(10, dp);
  return Math.round(num(v) * p) / p;
}

const NON_SIDING_MATERIALS = ['brick', 'stone', 'stucco'];

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(0, Math.min(100, n));
}

function namedNonSiding(value) {
  const raw = String(value || '').toLowerCase();
  if (!raw || raw === 'none' || raw === 'siding') return null;
  if (raw.includes('stucco') || raw.includes('eifs')) return 'stucco';
  if (raw.includes('brick')) return 'brick';
  if (raw.includes('stone') || raw.includes('block') || raw.includes('masonry')) return 'stone';
  return null;
}

/** The wall an opening was cut into. Untagged openings stay on the face mix. */
function openingMaterialName(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (!raw || raw === 'none' || raw === 'unknown') return null;
  const masonry = namedNonSiding(raw);
  if (masonry) return masonry;
  if (raw.includes('trim')) return 'trim';
  if (raw.includes('siding') || raw.includes('vinyl') || raw.includes('lap') || raw.includes('fiber')) return 'siding';
  return null;
}

function reportedSiding(result) {
  if (result?.siding_material && !namedNonSiding(result.siding_material)) return true;
  const shares = result?.material_shares;
  if (!shares || typeof shares !== 'object') return false;
  return Object.keys(shares).some((key) => /siding|vinyl|aluminum/.test(String(key).toLowerCase()));
}

function emptyMaterialParts() {
  return { brick: 0, stone: 0, stucco: 0 };
}

function sumMaterialParts(parts) {
  const raw = NON_SIDING_MATERIALS.reduce((sum, material) => sum + (Number(parts?.[material]) || 0), 0);
  return Math.min(100, raw);
}

function largestMaterial(parts) {
  let best = null;
  let bestPct = 0;
  for (const material of NON_SIDING_MATERIALS) {
    const pct = Number(parts?.[material]) || 0;
    if (pct > bestPct) {
      bestPct = pct;
      best = material;
    }
  }
  return best;
}

/**
 * Stone, stucco, and brick stay separate. A label and a trace of the SAME
 * material compete (the trace can only raise it). Different materials add,
 * so a stone wainscot does not erase the stucco above it.
 */
function breakdownMasonry(result) {
  const labeled = emptyMaterialParts();
  const regionTotals = emptyMaterialParts();
  const polygonTotals = emptyMaterialParts();
  let hasLabel = false;
  const materialName = namedNonSiding(result?.non_siding_material);
  const rawLabeled = result?.non_siding_coverage_pct ?? result?.non_siding_pct;
  const explicitZero = rawLabeled != null && rawLabeled !== '' && Number(rawLabeled) === 0;
  const labeledPct = clampPct(rawLabeled);
  if (materialName && labeledPct != null) {
    labeled[materialName] = labeledPct;
    hasLabel = true;
  } else if (explicitZero) {
    hasLabel = true;
  }
  const shares = result?.material_shares;
  if (shares && typeof shares === 'object') {
    for (const material of NON_SIDING_MATERIALS) {
      const pct = clampPct(shares[material]);
      if (pct == null) continue;
      labeled[material] = Math.max(labeled[material], pct);
      hasLabel = true;
    }
  }
  if (!hasLabel && reportedSiding(result)) hasLabel = true;

  for (const region of Array.isArray(result?.material_regions) ? result.material_regions : []) {
    const material = namedNonSiding(region?.material ?? region?.category ?? region?.type);
    const pct = clampPct(region?.percent ?? region?.percentage ?? region?.pct);
    if (!material || pct == null) continue;
    regionTotals[material] = Math.min(100, regionTotals[material] + pct);
  }
  const sections = [
    ...(Array.isArray(result?.sections) ? result.sections : []),
    ...(Array.isArray(result?.material_sections) ? result.material_sections : []),
  ];
  for (const section of sections) {
    const material = namedNonSiding(section?.material ?? section?.category ?? section?.type);
    const points = Array.isArray(section?.polygon) ? section.polygon : null;
    if (!material || !points) continue;
    const area = polygonArea(points);
    if (!(area > 0)) continue;
    polygonTotals[material] = Math.min(100, polygonTotals[material] + area * 100);
  }
  const traced = emptyMaterialParts();
  const billed = emptyMaterialParts();
  // Repeated vision reads already collapsed to a median share. A single
  // sample's region must not raise that median back to the outlier.
  // A labeled share also wins over a polygon that runs outside the frame:
  // live reads were tracing 80% stucco on a wall the share called 17% stone.
  const hasShares = result?.material_shares && typeof result.material_shares === 'object';
  const aggregated = Number(result?.material_sample_count) > 1 && hasShares;
  for (const material of NON_SIDING_MATERIALS) {
    traced[material] = Math.min(100, Math.max(regionTotals[material], polygonTotals[material]));
    billed[material] = (aggregated || hasShares)
      ? labeled[material]
      : Math.max(labeled[material], traced[material]);
  }
  return {
    hasLabel,
    labeled,
    traced,
    billed,
    labeledPct: sumMaterialParts(labeled),
    pct: sumMaterialParts(billed),
    material: largestMaterial(billed),
  };
}

/** Regions that sum to 100, so the leftover is siding and not an unknown void. */
function regionsFromParts(parts, sidingMaterial) {
  const regions = [];
  for (const material of NON_SIDING_MATERIALS) {
    const percent = Math.round(Number(parts?.[material]) || 0);
    if (percent > 0) regions.push({ material, percent });
  }
  let specified = regions.reduce((sum, region) => sum + region.percent, 0);
  if (specified > 100 && specified > 0) {
    const scale = 100 / specified;
    for (const region of regions) region.percent = Math.round(region.percent * scale);
    specified = regions.reduce((sum, region) => sum + region.percent, 0);
    const drift = 100 - specified;
    if (regions.length && drift !== 0) regions[0].percent += drift;
    specified = 100;
  }
  const sidingPct = Math.max(0, 100 - specified);
  if (sidingPct > 0) {
    const category = sidingMaterial && materialIsSiding(sidingMaterial) ? sidingMaterial : 'lap_siding';
    regions.push({ material: category, percent: sidingPct });
  }
  return regions;
}

/**
 * One photo's non-siding read. Stone, stucco, and brick each keep their own
 * percent: a trace raises that material, and a second material is added
 * rather than thrown out. A label of 0 does not erase a traced wall. A photo
 * that reports siding and no masonry is 0, so it pulls the average down. A
 * photo with no material fields is not a vote.
 */
function masonryRead(result) {
  const breakdown = breakdownMasonry(result);
  if (!(breakdown.pct > 0) && !breakdown.hasLabel) return null;
  return {
    material: breakdown.pct > 0 ? breakdown.material : null,
    pct: breakdown.pct,
    parts: breakdown.billed,
    labeledParts: breakdown.labeled,
    labeledPct: breakdown.labeledPct,
    hasLabel: breakdown.hasLabel,
  };
}

/**
 * Every wall this photo actually shows. A corner is a photo of both walls.
 * An unlabeled shot is not the front.
 */
function masonryFaces(result) {
  const faces = new Set();
  for (const value of [result?.wall_face, result?.secondary_wall_face, result?.view_label, result?.label]) {
    const slots = slotFaces(value);
    if (slots.length) {
      slots.forEach((face) => { if (WALL_FACES.includes(face)) faces.add(face); });
      continue;
    }
    const face = resolveWallFace(value);
    if (WALL_FACES.includes(face)) faces.add(face);
  }
  return [...faces];
}

function masonryWeight(result) {
  const materialConf = Number(result?.material_confidence);
  const weight = Number.isFinite(materialConf) && result?.material_confidence !== ''
    ? photoConfidence({ confidence: materialConf })
    : photoConfidence(result);
  const uncertain = result?.material_uncertain === true ? 0.5 : 1;
  return Math.max(0.05, weight) * uncertain;
}

/**
 * A garage wing is not the whole elevation. Its vinyl (or its stone) must
 * not set the material of the two-story wall it is attached to.
 */
function photoIsOneStoryWing(photo) {
  if (photo?.is_one_story_wing === true) return true;
  if (photo?.height_method === 'garage_door_anchor') return true;
  const garageDoors = Number(photo?.garage_doors_count) || 0;
  // Any garage-door photo is the wing, even when the model also counts two
  // window rows. That wing must not set the material of the whole front.
  return garageDoors > 0;
}

/**
 * How much this photo should speak for `face`. A straight photo of that face
 * counts most. A corner, an oblique secondary wall, and a one-story wing
 * count little. A wider visible fraction counts more than a sliver.
 */
export function frontalWeightForFace(photo, face) {
  const primary = resolveWallFace(photo?.wall_face || photo?.view_label || photo?.label);
  const secondary = photo?.secondary_wall_face
    ? resolveWallFace(photo.secondary_wall_face)
    : null;
  const corner = isCornerPhoto(photo)
    || photo?.classification_shot_type === 'corner'
    || (secondary && secondary !== UNKNOWN_FACE && secondary !== primary);
  let weight = 0.08;
  if (primary === face && !corner) weight = 1;
  else if (primary === face && corner) weight = 0.4;
  else if (secondary === face) weight = 0.12;
  else if (masonryFaces(photo).includes(face)) weight = 0.1;
  if (photoIsOneStoryWing(photo)) weight *= 0.22;
  const fraction = Number(photo?.visible_width_fraction);
  if (Number.isFinite(fraction) && fraction > 0 && fraction <= 1) {
    weight *= 0.4 + 0.6 * fraction;
  }
  return Math.max(0.02, weight);
}

function weightedMedian(pairs) {
  const sorted = [...pairs].filter((pair) => pair.weight > 0).sort((a, b) => a.value - b.value);
  if (!sorted.length) return 0;
  const total = sorted.reduce((sum, pair) => sum + pair.weight, 0);
  let acc = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    acc += sorted[i].weight;
    if (acc + 1e-9 >= total / 2) {
      if (Math.abs(acc - total / 2) < 1e-6 && sorted[i + 1]) {
        return (sorted[i].value + sorted[i + 1].value) / 2;
      }
      return sorted[i].value;
    }
  }
  return sorted[sorted.length - 1].value;
}

/** Drop the highest and lowest siding fraction once there are four reads. */
function trimFractionRows(rows) {
  if (rows.length < 4) return rows;
  const ordered = [...rows].sort((a, b) => fractionVector(a).siding - fractionVector(b).siding);
  return ordered.slice(1, -1);
}

function medianParts(rows) {
  const pool = trimFractionRows(rows);
  const parts = emptyMaterialParts();
  for (const material of NON_SIDING_MATERIALS) {
    parts[material] = weightedMedian(pool.map((row) => ({
      value: Number(row.parts?.[material]) || 0,
      weight: row.frontal,
    })));
  }
  const sum = sumMaterialParts(parts);
  if (sum > 100 && sum > 0) {
    for (const material of NON_SIDING_MATERIALS) parts[material] = (parts[material] * 100) / sum;
  }
  return parts;
}

/**
 * Highest in-frame trace that sits with the middle of the traces.
 * A single polygon, or one that is more than 8 points off the median,
 * does not get to fill the wall.
 */
function frontalCorroboratedTrace(rows, material) {
  const maxWeight = Math.max(...rows.map((row) => row.frontal));
  const drawnOf = (row) => Number(row.drawnParts?.[material]) || 0;
  const tier = rows.filter((row) => row.frontal >= maxWeight * 0.8);
  const tierDrawn = tier.map(drawnOf).filter((value) => value > 2);
  const tierHigh = tierDrawn.length ? Math.max(...tierDrawn) : 0;
  const outside = rows
    .filter((row) => row.frontal < maxWeight * 0.8)
    .map(drawnOf)
    .filter((value) => value >= tierHigh + 2 && value > 2);
  return corroboratedTrace([...tierDrawn, ...outside]);
}

function corroboratedTrace(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const cluster = sorted.filter((value) => Math.abs(value - mid) <= 8);
  if (cluster.length < 2) return 0;
  return Math.max(...cluster);
}

function spreadOfRows(rows) {
  const spread = {};
  const vectors = rows.map(fractionVector);
  for (const material of AGREEMENT_MATERIALS) {
    const values = vectors.map((vector) => vector[material]);
    spread[material] = values.length ? Math.round(Math.max(...values) - Math.min(...values)) : 0;
  }
  return spread;
}

/**
 * Frontal trimmed median of every photo of a face. A confidence-weighted
 * mean let an oblique corner and a garage wing outvote the wall. When the
 * frontal photos still disagree by more than 20 points, bill the most
 * frontal photo and say so.
 */
export function aggregateFrontalFractions(samples) {
  const rows = (samples || []).filter((sample) => sample && sample.parts && sample.frontal > 0);
  if (!rows.length) return null;
  const spread = spreadOfRows(rows);
  const spreadPoints = Math.max(0, ...Object.values(spread));
  const maxWeight = Math.max(...rows.map((row) => row.frontal));
  const tier = rows.filter((row) => row.frontal >= maxWeight * 0.8);
  let parts;
  let billedFrom = 'trimmed_median';
  if (spreadPoints > MATERIAL_SPREAD_LIMIT) {
    parts = medianParts(tier);
    billedFrom = tier.length === 1 ? 'most_frontal' : 'frontal_tier_median';
  } else {
    parts = medianParts(rows);
  }
  // A zero from a garage wing or a side-on shot must not erase stone, stucco,
  // or brick that a photo of the face actually reported. The floor is the
  // median of those reports, not the max, so one wild corner cannot fill the wall.
  const floorRows = rows.filter((row) => row.frontal >= 0.35 && !photoIsOneStoryWing(row.photo));
  if (floorRows.length) {
    for (const material of NON_SIDING_MATERIALS) {
      const seen = floorRows.filter((row) => (Number(row.parts?.[material]) || 0) > 2);
      if (!seen.length) continue;
      const floor = weightedMedian(seen.map((row) => ({
        value: Number(row.parts[material]) || 0,
        weight: row.frontal,
      })));
      if (floor > parts[material]) parts[material] = floor;
    }
  }
  // Two in-frame traces of this face that agree are a wainscot the share
  // median can miss by a few points. One uncorroborated polygon cannot.
  // A trace from a less frontal photo has to clear the frontal trace by
  // 2 points, so a corner's extra point of polygon noise does not move the bill.
  for (const material of NON_SIDING_MATERIALS) {
    const traced = frontalCorroboratedTrace(rows, material);
    if (traced > parts[material]) parts[material] = traced;
  }
  for (const material of NON_SIDING_MATERIALS) {
    parts[material] = Math.max(0, Math.min(100, Math.round(parts[material])));
  }
  const pct = Math.round(Math.max(0, Math.min(100, sumMaterialParts(parts))));
  return {
    pct,
    material: pct > 0 ? largestMaterial(parts) : null,
    parts,
    labeledParts: parts,
    billed_from: billedFrom,
    spread,
    spread_points: spreadPoints,
  };
}

/** Confidence-weighted mean. Kept for callers that still want every photo at equal trust. */
function averageMasonryReading(samples) {
  const rows = (samples || []).filter((sample) => sample && Number.isFinite(sample.pct) && sample.weight > 0);
  if (!rows.length) return null;
  const weightSum = rows.reduce((sum, sample) => sum + sample.weight, 0);
  if (!(weightSum > 0)) return null;
  const pct = rows.reduce((sum, sample) => sum + sample.pct * sample.weight, 0) / weightSum;
  const rounded = Math.round(Math.max(0, Math.min(100, pct)));
  const parts = emptyMaterialParts();
  const labeledParts = emptyMaterialParts();
  for (const sample of rows) {
    for (const material of NON_SIDING_MATERIALS) {
      parts[material] += (Number(sample.parts?.[material]) || 0) * sample.weight;
      labeledParts[material] += (Number(sample.labeledParts?.[material]) || 0) * sample.weight;
    }
  }
  for (const material of NON_SIDING_MATERIALS) {
    parts[material] = Math.round(parts[material] / weightSum);
    labeledParts[material] = Math.round(labeledParts[material] / weightSum);
  }
  const fromParts = largestMaterial(parts);
  return {
    pct: rounded,
    material: rounded > 0 ? fromParts : null,
    parts,
    labeledParts,
  };
}

const AGREEMENT_MATERIALS = ['stone', 'stucco', 'brick', 'siding'];
const MATERIAL_SPREAD_LIMIT = 20;
const MIN_AGREEMENT_PHOTOS = 3;

function fractionVector(sample) {
  const stone = Number(sample?.parts?.stone) || 0;
  const stucco = Number(sample?.parts?.stucco) || 0;
  const brick = Number(sample?.parts?.brick) || 0;
  return {
    stone,
    stucco,
    brick,
    siding: Math.max(0, 100 - stone - stucco - brick),
  };
}

/**
 * Material fractions for one face, from every photo of that face.
 * The billed number is the frontal trimmed median (see aggregateFrontalFractions).
 * Fewer than 3 photos, or stone/stucco/brick/siding fractions that differ by
 * more than 20 points, are low confidence and need a rep. A single vision
 * pass is not itself a reason: the live bench asks for one read per photo.
 */
export function agreeMaterialFractions(samples, {
  photoCount = null,
  readSpread = 0,
} = {}) {
  const rows = (samples || []).filter((sample) => sample && sample.weight > 0 && sample.parts);
  const vectors = rows.map(fractionVector);
  const spread = {};
  for (const material of AGREEMENT_MATERIALS) {
    const values = vectors.map((vector) => vector[material]);
    spread[material] = values.length
      ? Math.round(Math.max(...values) - Math.min(...values))
      : 0;
  }
  const spreadPoints = Math.max(0, ...Object.values(spread), Math.round(Number(readSpread) || 0));
  const count = photoCount == null ? rows.length : photoCount;
  const reasons = [];
  if (count < MIN_AGREEMENT_PHOTOS) {
    reasons.push(`only ${count} photo${count === 1 ? '' : 's'} of this face (need ${MIN_AGREEMENT_PHOTOS})`);
  }
  if (spreadPoints > MATERIAL_SPREAD_LIMIT) {
    const hot = AGREEMENT_MATERIALS
      .filter((material) => spread[material] > MATERIAL_SPREAD_LIMIT)
      .map((material) => `${material} ${spread[material]}`);
    const detail = hot.length ? hot.join(', ') : `${spreadPoints} points`;
    reasons.push(`reads differ by more than ${MATERIAL_SPREAD_LIMIT} points (${detail})`);
  }
  return {
    photo_count: count,
    vote_count: rows.length,
    spread_by_material: spread,
    spread_points: spreadPoints,
    low_confidence: reasons.length > 0,
    reasons,
  };
}

function agreementForPhotos(photos, samples, billedFrom = null) {
  const list = Array.isArray(photos) ? photos : [];
  const readSpread = Math.max(0, ...list.map((photo) => Number(photo?.material_share_spread_max) || 0));
  const agreement = agreeMaterialFractions(samples, {
    photoCount: list.length,
    readSpread,
  });
  if (billedFrom === 'most_frontal' || billedFrom === 'frontal_tier_median') {
    agreement.billed_from = billedFrom;
    if (billedFrom === 'most_frontal') {
      agreement.reasons = [
        ...(agreement.reasons || []),
        'billed from the most frontal photo because the reads disagree',
      ];
    }
  }
  return agreement;
}

function sectionConfidenceUnit(section, photo) {
  const raw = section?.confidence ?? section?.material_confidence ?? photo?.confidence ?? photo?.material_confidence;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value > 1 ? value / 100 : value;
}

function photoSectionsForFace(photos) {
  const sections = [];
  for (const photo of photos || []) {
    const corner = photo?.is_corner_shot === true;
    for (const list of [photo?.sections, photo?.material_sections]) {
      if (!Array.isArray(list)) continue;
      for (const section of list) {
        if (!section || typeof section !== 'object') continue;
        const confidence = sectionConfidenceUnit(section, photo);
        sections.push({
          ...section,
          ...(confidence == null ? {} : { confidence }),
          corner_photo: section.corner_photo === true || corner,
        });
      }
    }
  }
  return sections;
}

function polygonInsideFrame(points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  return points.every((point) => {
    const x = Number(point?.[0]);
    const y = Number(point?.[1]);
    return Number.isFinite(x) && Number.isFinite(y) && x >= -0.02 && x <= 1.02 && y >= -0.02 && y <= 1.02;
  });
}

/**
 * An in-frame polygon drawn on this face can raise a share that understates
 * it. A polygon tagged to the other wall of a corner stays on that wall, so
 * a front stucco bay does not become the side's stucco.
 */
function drawnPartsForFace(photo, face) {
  const drawn = emptyMaterialParts();
  if (!face) return drawn;
  const sections = [
    ...(Array.isArray(photo?.sections) ? photo.sections : []),
    ...(Array.isArray(photo?.material_sections) ? photo.material_sections : []),
  ];
  for (const section of sections) {
    const tagged = resolveWallFace(section?.wall_face);
    if (tagged !== UNKNOWN_FACE && tagged !== face) continue;
    if (!polygonInsideFrame(section?.polygon)) continue;
    const material = namedNonSiding(section?.material ?? section?.category ?? section?.type);
    const area = polygonArea(section.polygon);
    if (!material || !(area > 0)) continue;
    drawn[material] = Math.min(100, drawn[material] + area * 100);
  }
  return drawn;
}

function partsForFace(photo, face, read) {
  const parts = { ...read.parts };
  const drawn = drawnPartsForFace(photo, face);
  // Only the photo's own face may have its share replaced by a much larger
  // trace. A polygon tagged to the other wall of a corner stays on that wall.
  if (face && resolveWallFace(photo?.wall_face) === face) {
    for (const material of NON_SIDING_MATERIALS) {
      if (drawn[material] > (parts[material] || 0) + MATERIAL_SPREAD_LIMIT) {
        parts[material] = drawn[material];
      }
    }
    const sum = sumMaterialParts(parts);
    if (sum > 100) {
      for (const material of NON_SIDING_MATERIALS) parts[material] = (parts[material] * 100) / sum;
    }
  }
  return { parts, drawnParts: drawn };
}

function faceMasonrySamples(photos, face = null) {
  const samples = [];
  for (const photo of photos) {
    if (evidenceForResult(photo)?.status === 'duplicate') continue;
    const read = masonryRead(photo);
    if (!read) continue;
    const faced = face ? partsForFace(photo, face, read) : { parts: read.parts, drawnParts: emptyMaterialParts() };
    const parts = faced.parts;
    const pct = Math.min(100, sumMaterialParts(parts));
    samples.push({
      ...read,
      parts,
      drawnParts: faced.drawnParts,
      pct,
      weight: masonryWeight(photo),
      frontal: face ? frontalWeightForFace(photo, face) : masonryWeight(photo),
      photo,
    });
  }
  return samples;
}

function sidingCategoryFromPhoto(photo) {
  if (!photo?.siding_material) return null;
  return normalizeMaterialCategory(photo.siding_material, photo.siding_profile);
}

function classificationForFace(photos, face) {
  let fallback = null;
  for (const photo of photos) {
    const found = photo?.face_materials?.[face];
    if (!found?.shares) continue;
    // A rep confirmation is the bill for the whole face. An earlier photo's
    // own reading must not keep the masonry share off the wall.
    if (found.confirmed === true || found.billed_from === 'rep_confirmed') return found;
    if (!fallback) fallback = found;
  }
  return fallback;
}

/**
 * The face-sample median is the bill. Per-photo bands do not replace it.
 * Restoring a "missed" brick band from agreeing photos, and moving every
 * stucco share onto brick, overrode that median on Coleman and Walsh.
 * The one correction is a sliver the face call itself already split: brick
 * is present and stucco is under 10%. A larger stucco share stays stucco.
 */
function correctFaceClassification(classification) {
  if (!classification?.shares) return classification;
  if (classification.confirmed === true || classification.billed_from === 'rep_confirmed') return classification;
  const shares = {
    stone: Number(classification.shares.stone) || 0,
    stucco: Number(classification.shares.stucco) || 0,
    brick: Number(classification.shares.brick) || 0,
    siding: Number(classification.shares.siding) || 0,
  };
  if (!(shares.brick > 0) || !(shares.stucco > 0) || shares.stucco >= 10) return classification;
  const moved = shares.stucco;
  shares.brick += moved;
  shares.stucco = 0;
  const masonry = shares.stone + shares.brick;
  if (masonry >= 100) {
    const scale = 100 / masonry;
    shares.stone *= scale;
    shares.brick *= scale;
    shares.siding = 0;
  } else {
    shares.siding = 100 - masonry;
  }
  const note = `stucco ${Math.round(moved)} reassigned to brick; the face call already includes brick and the stucco share is under 10`;
  return {
    ...classification,
    shares,
    prior_notes: [...(classification.prior_notes || []), note],
    photo_correction: [note],
  };
}

/**
 * A face that was classified from all of its photos bills that median (or
 * the property prior). Per-photo polygons do not raise it afterward.
 */
function billedFromFaceClassification(classification, sidingCategory) {
  const shares = classification.shares || {};
  const parts = {
    stone: Number(shares.stone) || 0,
    stucco: Number(shares.stucco) || 0,
    brick: Number(shares.brick) || 0,
  };
  const spread = classification.spread || {};
  const spreadMax = Math.max(0, Number(classification.spread_max) || 0);
  const sampleCount = Number(classification.sample_count) || 0;
  const reasons = [];
  if (sampleCount < PRODUCTION_MATERIAL_SAMPLE_COUNT) {
    reasons.push(`face classification ran ${sampleCount} time${sampleCount === 1 ? '' : 's'} (need ${PRODUCTION_MATERIAL_SAMPLE_COUNT})`);
  }
  if (spreadMax > FACE_MATERIAL_SPREAD_LIMIT) {
    const hot = ['stone', 'stucco', 'brick', 'siding']
      .filter((material) => Number(spread[material]) > FACE_MATERIAL_SPREAD_LIMIT)
      .map((material) => `${material} ${spread[material]}`);
    reasons.push(`face samples differ by more than ${FACE_MATERIAL_SPREAD_LIMIT} points (${hot.join(', ') || `${spreadMax} points`})`);
  }
  if (classification.prior_applied && Array.isArray(classification.prior_notes)) {
    reasons.push(...classification.prior_notes);
  }
  if (Array.isArray(classification.review_notes) && classification.review_notes.length) {
    reasons.push(...classification.review_notes);
  }
  if (Array.isArray(classification.photo_correction) && classification.photo_correction.length) {
    reasons.push(...classification.photo_correction);
  }
  return {
    pct: Math.min(100, sumMaterialParts(parts)),
    material: largestMaterial(parts),
    regions: regionsFromParts(parts, sidingCategory),
    shareRegions: regionsFromParts(parts, sidingCategory),
    sections: Array.isArray(classification.sections) ? classification.sections : [],
    agreement: {
      photo_count: Number(classification.photo_count) || 0,
      sample_count: sampleCount,
      vote_count: sampleCount,
      spread_by_material: spread,
      spread_points: spreadMax,
      low_confidence: reasons.length > 0,
      reasons,
      billed_from: classification.billed_from || 'face_sample_median',
    },
  };
}

/**
 * The billed non-siding share for one face.
 * Stone and stucco are both kept. A traced region raises the face it was
 * drawn on. The share passed to an unphotographed face is the labeled
 * reading only, so one full-frame trace cannot zero siding on every wall.
 */
function billedFaceMaterial(photos, best, face, allPhotos = photos) {
  const seen = new Set(photos);
  const list = [...photos];
  for (const photo of allPhotos) {
    if (seen.has(photo)) continue;
    if (evidenceForResult(photo)?.status === 'duplicate') continue;
    if (!masonryFaces(photo).includes(face)) continue;
    seen.add(photo);
    list.push(photo);
  }
  const classified = correctFaceClassification(
    classificationForFace(allPhotos, face) || classificationForFace(list, face),
  );
  if (classified) {
    const sidingCategory = sidingCategoryFromPhoto(best)
      || photos.map(sidingCategoryFromPhoto).find(Boolean)
      || null;
    return billedFromFaceClassification(classified, sidingCategory);
  }
  const samples = faceMasonrySamples(list, face);
  const averaged = aggregateFrontalFractions(samples) || averageMasonryReading(samples);
  const agreement = agreementForPhotos(list, samples, averaged?.billed_from);
  const sidingCategory = sidingCategoryFromPhoto(best)
    || photos.map(sidingCategoryFromPhoto).find(Boolean)
    || null;
  const traced = Array.isArray(best?.material_regions) && best.material_regions.length
    ? best.material_regions
    : (photos.find((p) => Array.isArray(p.material_regions) && p.material_regions.length)?.material_regions || []);
  // Every photo of the face votes. The billed fractions are the frontal
  // trimmed median, not whichever single photo was widest.
  if (averaged && averaged.pct > 0) {
    return {
      pct: averaged.pct,
      material: averaged.material,
      regions: regionsFromParts(averaged.parts, sidingCategory),
      shareRegions: regionsFromParts(averaged.labeledParts, sidingCategory),
      agreement,
    };
  }
  if (traced.length) {
    const labeled = (best?.non_siding_material && best.non_siding_material !== 'none'
      ? best.non_siding_material
      : null)
      || photos.find((p) => p.non_siding_material && p.non_siding_material !== 'none')?.non_siding_material
      || null;
    return { pct: null, material: labeled, regions: traced, shareRegions: null, agreement };
  }
  if (averaged) {
    return {
      pct: averaged.pct,
      material: null,
      regions: [],
      shareRegions: regionsFromParts(averaged.labeledParts, sidingCategory),
      agreement,
    };
  }
  return { pct: null, material: null, regions: [], shareRegions: null, agreement };
}

/**
 * One masonry percentage per wall face: the confidence-weighted average of
 * every photo of that face. Brick, stone, and stucco all count. A face with
 * no photo is left unset so the caller can apply the house-wide share.
 */
export function collectFaceMasonryPct(results) {
  const photosByFace = {};
  for (const result of Array.isArray(results) ? results : []) {
    if (evidenceForResult(result)?.status === 'duplicate') continue;
    for (const face of masonryFaces(result)) {
      (photosByFace[face] = photosByFace[face] || []).push(result);
    }
  }
  const facePct = {};
  for (const [face, photos] of Object.entries(photosByFace)) {
    const averaged = averageMasonryReading(faceMasonrySamples(photos));
    if (averaged) facePct[face] = averaged.pct;
  }
  return facePct;
}

/**
 * Labeled masonry only. A traced polygon can raise the face it was drawn on,
 * but it is not a house-wide share. Missing faces must not inherit a
 * full-frame trace.
 */
export function collectLabeledMasonryPct(results) {
  const photosByFace = {};
  for (const result of Array.isArray(results) ? results : []) {
    if (evidenceForResult(result)?.status === 'duplicate') continue;
    for (const face of masonryFaces(result)) {
      (photosByFace[face] = photosByFace[face] || []).push(result);
    }
  }
  const facePct = {};
  for (const [face, photos] of Object.entries(photosByFace)) {
    const samples = [];
    for (const photo of photos) {
      if (evidenceForResult(photo)?.status === 'duplicate') continue;
      const read = masonryRead(photo);
      if (!read?.hasLabel) continue;
      samples.push({ pct: read.labeledPct, weight: masonryWeight(photo) });
    }
    const averaged = averageMasonryReading(samples);
    if (averaged) facePct[face] = averaged.pct;
  }
  return facePct;
}

/** Deterministic FNV-1a hash → short hex string. Used to derive stable IDs. */
function stableHash(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Normalize an arbitrary wall-face / view label to a canonical face token. */
function resolveWallFace(raw) {
  const slotted = slotFaces(raw);
  if (slotted.length > 0) return slotted[0];
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return UNKNOWN_FACE;
  // Corner shots are labeled with two-letter abbreviations by the photo uploader
  // ("FR Corner" = front-right). None of the substring tests below match those,
  // so they used to resolve to `unknown` — where dedupe is disabled by design.
  // The result was that every corner photo's openings were counted as brand new,
  // double-billing the doors and windows that a corner shares with its neighbour.
  // A corner shows two walls; attribute it to the PRIMARY (first-letter) face so
  // per-face reconciliation can engage.
  if (/corner|angle/.test(s)) {
    if (/\bf[lr]\b|front[\s_-]?(left|right)/.test(s)) return 'front';
    if (/\bb[lr]\b|(back|rear)[\s_-]?(left|right)/.test(s)) return 'back';
  }
  if (s.includes('back') || s.includes('rear') || s.includes('north')) return 'back';
  if (s.includes('right') || s.includes('east')) return 'right_side';
  if (s.includes('left') || s.includes('west')) return 'left_side';
  if (s.includes('front') || s.includes('south')) return 'front';
  return UNKNOWN_FACE;
}

function evidenceForResult(result) {
  return result?._multi_view_evidence || null;
}

function resultFace(result) {
  const evidence = evidenceForResult(result);
  // Once the evidence pass has run, an explicit null means "unresolved" and
  // must not fall back to Gemini's untrusted raw wall_face.
  if (evidence) return evidence.primary_face || UNKNOWN_FACE;
  return resolveWallFace(result?.wall_face || result?.view_label || result?.face);
}

/** Normalize a raw opening type to a canonical opening type token. */
function resolveOpeningType(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (s.includes('garage')) return 'garage_door';
  if (s.includes('door') || s.includes('entry')) return 'entry_door';
  if (s.includes('vent') || s.includes('louver')) return 'vent';
  if (s.includes('window')) return 'window';
  return s || 'window';
}

/**
 * Is this photo a corner/angle shot (two walls visible at once)?
 * Trust the AI flag when present, but fall back to the slot label — the flag is
 * frequently absent on count-only responses, on legacy records, and on graph
 * input reconstructed during a manual rebuild. Every corner test must go
 * through here; a flag-only check silently treats "FR Corner" as a flat wall.
 */
function isCornerPhoto(result) {
  if (!result) return false;
  if (result.is_corner_shot === true) return true;
  return /corner|angle/.test(
    String(result.view_label || result.label || result.wall_face || '').toLowerCase(),
  );
}

function clamp01(v) {
  return Math.max(0, Math.min(1, num(v)));
}

/** Confidence for a per-photo result, defaulting to a neutral mid value. */
function photoConfidence(r) {
  if (r == null) return 0.5;
  const c = r.confidence ?? r.confidence_score ?? r.detection_confidence;
  if (c == null) return 0.5;
  const normalized = num(c);
  return clamp01(normalized > 1 ? normalized / 100 : normalized);
}

// ── Opening extraction ──────────────────────────────────────────────────────

function shutterForOpening(rows, opening) {
  const id = opening?.observation_id ?? opening?.id;
  if (id == null) return null;
  return rows.find((row) => row && String(row.window_observation_id) === String(id)) || null;
}

/**
 * Pull every raw opening object out of a per-photo result. Accepts the common
 * shapes (`openings`, `opening_details`, `openingsDetail`) and returns a flat
 * list annotated with the owning photo's resolved face + confidence.
 */
function extractRawOpenings(result, photoIndex) {
  // A repeated source photo remains in photo_evidence for auditability, but
  // its openings must not vote a second time.
  if (evidenceForResult(result)?.status === 'duplicate') return [];
  let arr =
    (Array.isArray(result.openings) && result.openings) ||
    (Array.isArray(result.opening_details) && result.opening_details) ||
    (Array.isArray(result.openingsDetail) && result.openingsDetail) ||
    [];
  // Compatibility fallback for older/model-degraded responses that return only
  // counts. These remain explicit low-confidence synthetic observations so the
  // graph is still authoritative without pretending they were measured.
  if (arr.length === 0) {
    const synthetic = [];
    const add = (count, type, width_ft, height_ft) => {
      for (let i = 0; i < Math.max(0, Math.floor(num(count))); i++) {
        synthetic.push({
          observation_id: `synthetic_${type}_${photoIndex}_${i}`,
          type,
          width_ft,
          height_ft,
          zone: 'unknown',
          confidence: 0.25,
          synthetic: true,
        });
      }
    };
    // A missing dimension is a standard unit, not a 3×4 guess that falls under
    // the deductible floor and disappears from the takeoff.
    add(result.windows_count, 'window', 3, 5);
    add(result.doors_count, 'entry_door', 3, 6.8);
    // A count with no measured width is a single door. A double is 16 ft only
    // when the box itself is that wide.
    add(result.garage_doors_count, 'garage_door', 9, 7);
    arr = synthetic;
  }
  const photoFace = resultFace(result);
  const photoConf = photoConfidence(result);
  // A corner shot re-photographs a wall that another slot already covers, so its
  // counts overlap rather than add.
  const cornerShot = isCornerPhoto(result);
  const shutterRows = Array.isArray(result.shutters_detail) ? result.shutters_detail : [];

  return arr.map((o, i) => {
    const width = num(o.width_ft ?? o.width);
    const height = num(o.height_ft ?? o.height);
    const sqft = o.sqft != null ? num(o.sqft) : round(width * height, 2);
    const perimeter =
      o.perimeter_lf != null ? num(o.perimeter_lf) : round(2 * (width + height), 2);
    const openingFace = resolveWallFace(o.wall_face ?? o.face ?? photoFace);
    const evidence = evidenceForResult(result);
    const face = evidence
      ? (evidence.faces?.includes(openingFace)
        ? openingFace
        : (evidence.primary_face || UNKNOWN_FACE))
      : openingFace;
    const type = resolveOpeningType(o.type);
    const posX = o.pos_x != null ? num(o.pos_x) : (o.x != null ? num(o.x) : null);
    const posY = o.pos_y != null ? num(o.pos_y) : (o.y != null ? num(o.y) : null);
    const zone = o.zone != null ? String(o.zone) : null;
    const physicalIdentity = o.observation_id != null || o.id != null
      ? `observation:${o.observation_id ?? o.id}`
      : (posX != null && posY != null
        ? `geometry:${face}|${type}|${width}|${height}|${posX}|${posY}`
        : (cornerShot && zone
          ? `corner:${face}|${type}|${zone}|${width}|${height}`
          : `photo:${evidenceForResult(result)?.photo_id || photoIndex}|${i}`));
    return {
      _photoIndex: photoIndex,
      _localIndex: i,
      _isCorner: cornerShot,
      face,
      type,
      material: openingMaterialName(o.material),
      width_ft: width,
      height_ft: height,
      sqft,
      perimeter_lf: perimeter,
      zone,
      pos_x: posX,
      pos_y: posY,
      position_unit: o.position_unit ?? o.position_units ?? o.coordinate_unit ?? 'feet',
       // explicit stable observation identity, if the AI provided one
      observation_id:
        o.observation_id != null ? String(o.observation_id) :
        (o.id != null ? String(o.id) : null),
       source_photo_id: evidenceForResult(result)?.photo_id || null,
      confidence: o.confidence != null ? clamp01(o.confidence) : photoConf,
      occluded: !!(o.occluded || result.occluded),
      // explicit sub-components (e.g. mulled units within one rough opening)
      components: Array.isArray(o.components) ? o.components : null,
      synthetic: o.synthetic === true,
      _photoWidth: num(result.wall_width_ft),
      _visibleFraction: num(result.visible_width_fraction),
      _visibleStart: Number.isFinite(Number(result.visible_x_start)) ? Number(result.visible_x_start) : null,
      unit_count: Math.max(0, Math.floor(num(o.unit_count ?? o.units ?? o.window_unit_count))),
      physical_identity: physicalIdentity,
      _photoEaveFt: num(result.eave_height_ft),
      _photoFace: photoFace,
      _shutter: shutterForOpening(shutterRows, o),
      // Garage doors are normally open at grade. Allow an explicit false for
      // unusual elevated openings, but default canonical garage doors to grade.
      at_grade: o.at_grade != null ? !!o.at_grade : type === 'garage_door',
      _raw: o,
    };
  });
}

/**
 * Determine whether two openings are the SAME real-world observation seen in
 * two photos. Requires same resolved face + type AND one of:
 *   (a) matching explicit stable observation identity, or
 *   (b) near-identical geometry AND position (when position is available).
 * Zone alone is never sufficient.
 */
function isDuplicateObservation(a, b) {
  if (a.face !== b.face || a.type !== b.type) return false;
  if (a.face === UNKNOWN_FACE) return false; // never dedupe across unknown faces

  // (a) explicit stable identity. Different ids are not proof of two
  // openings — the same window photographed twice is often given two ids —
  // so a matching id merges immediately and a mismatch falls through to
  // geometry and position. A bare local label such as window_1 is only an
  // identity when the size also agrees; every photo numbers its first window
  // that way, and a 12×16 is not a 5×7.
  if (a.observation_id != null && b.observation_id != null && a.observation_id === b.observation_id) {
    const generic = /^(window|door|entry_door|garage_door|slider_door)_\d+$/i.test(String(a.observation_id));
    if (!generic || looseSameOpening(a, b)) return true;
  }

  // (b) near-identical geometry AND position
  const geoMatch =
    Math.abs(a.width_ft - b.width_ft) <= GEO_TOL_FT &&
    Math.abs(a.height_ft - b.height_ft) <= GEO_TOL_FT;
  if (!geoMatch) return false;

  const havePos =
    a.pos_x != null && a.pos_y != null && b.pos_x != null && b.pos_y != null;
  if (havePos) {
    // Same photo: a few feet of separation is two openings. A second photo of
    // the same wall shifts the reading, so doors (rarely adjacent) and windows
    // get a wider band than the same-frame dedupe.
    const samePhoto = a._photoIndex != null && a._photoIndex === b._photoIndex;
    const span = Math.max(num(a.width_ft), num(b.width_ft));
    const door = a.type === 'entry_door' || a.type === 'garage_door' || a.type === 'slider_door';
    const tol = samePhoto ? POS_TOL_FT : (door ? Math.max(POS_TOL_FT, 6) : Math.max(POS_TOL_FT, Math.min(3, span * 0.5)));
    return (
      Math.abs(a.pos_x - b.pos_x) <= tol &&
      Math.abs(a.pos_y - b.pos_y) <= tol
    );
  }

  // (b2) Spatial hash fallback: when explicit pos_x/pos_y is absent on one or both
  // sides, a zone plus near-identical geometry is useful only when one observation
  // is an oblique/corner overlap. Two straight frames can show two adjacent,
  // same-sized windows in the same coarse zone; collapsing those would undercount.
  const aZone = a.zone != null ? String(a.zone) : null;
  const bZone = b.zone != null ? String(b.zone) : null;
  if (aZone && bZone && aZone !== 'unknown' && bZone !== 'unknown') {
    return aZone === bZone && (a._isCorner || b._isCorner);
  }

  return false; // no position + no zone → cannot safely dedupe
}

/**
 * Reconcile COUNT-ONLY (synthetic) openings across photos of the same wall.
 *
 * When Gemini returns bare counts instead of per-opening geometry, every
 * synthetic opening is minted with its own `synthetic_<type>_<photoIndex>_<i>`
 * identity. isDuplicateObservation() sees two non-null ids that differ and
 * refuses to merge (rule (a) returns early), and the zone fallback can't help
 * because synthetic openings carry zone 'unknown'. Dedupe is therefore
 * structurally incapable of collapsing them, so two photos of one wall — a flat
 * shot and the corner that overlaps it — used to sum into twice the doors.
 *
 * Reconciliation is deliberately asymmetric, because "two photos of one face"
 * has two very different meanings:
 *   • Flat slot photos are treated as ADDITIVE. A wide wall can legitimately be
 *     captured in two frames covering different halves, and max() there would
 *     silently delete real openings — which under-deducts and OVER-bills.
 *   • Corner shots are treated as OVERLAPPING. A corner re-photographs a wall an
 *     adjacent slot already covers, so it can only RAISE the count to whatever it
 *     saw on its own; it can never stack on top of the flat photos.
 * So the face total is max(sum of flat photos, largest single corner photo).
 *
 * The overlap guarantee is a property of the uploader, not an inference from the
 * word "corner": the photo grid offers exactly one slot per corner ("FR Corner —
 * front-right corner angle") and one per face, with duplicates diverted to
 * Detail slots. A corner slot is therefore a single whole-house oblique that
 * sees the ENTIRE adjoining wall, never a crop of half of it. Two corner shots
 * of one face are two angles on the same wall, so they reconcile rather than add.
 *
 * Only canonical faces collapse. UNKNOWN_FACE stays additive because unidentified
 * photos — including the free-form Detail slots — may genuinely be different walls.
 */
function openingSpan(openings, faceWidth) {
  const fraction = Math.max(0, ...openings.map((opening) => num(opening._visibleFraction)));
  const starts = openings
    .map((opening) => opening._visibleStart)
    .filter((value) => value != null && Number.isFinite(value));
  const start = starts.length ? Math.min(...starts) : null;
  if (fraction >= 0.65) {
    const origin = start == null ? 0 : start;
    return { start: origin, end: Math.min(1, origin + fraction), fraction, assumed: start == null };
  }
  const width = Math.max(0, ...openings.map((opening) => num(opening._photoWidth)));
  if (faceWidth > 0 && width >= faceWidth * 0.65) {
    return { start: 0, end: 1, fraction: Math.min(1, width / faceWidth), assumed: true };
  }
  if (fraction > 0.05 && start != null) {
    return { start, end: Math.min(1, start + fraction), fraction, assumed: false };
  }
  return null;
}

function spansOverlap(left, right) {
  if (!left || !right) return false;
  if (left.assumed || right.assumed) return left.fraction >= 0.65 && right.fraction >= 0.65;
  const overlap = Math.min(left.end, right.end) - Math.max(left.start, right.start);
  const smaller = Math.min(left.end - left.start, right.end - right.start);
  return smaller > 0 && overlap >= smaller * 0.5;
}

function collapseSyntheticCounts(rawOpenings, faceWidthsFt = null) {
  const synthetic = rawOpenings.filter((o) => o.synthetic && o.face !== UNKNOWN_FACE);
  if (synthetic.length === 0) return { openings: rawOpenings, collapsed: 0 };
  const passthrough = rawOpenings.filter((o) => !(o.synthetic && o.face !== UNKNOWN_FACE));

  // face|type → photoIndex → observations from that photo
  const byFaceType = new Map();
  for (const o of synthetic) {
    const key = `${o.face}|${o.type}`;
    if (!byFaceType.has(key)) byFaceType.set(key, new Map());
    const perPhoto = byFaceType.get(key);
    if (!perPhoto.has(o._photoIndex)) perPhoto.set(o._photoIndex, []);
    perPhoto.get(o._photoIndex).push(o);
  }

  const kept = [];
  let collapsed = 0;
  for (const perPhoto of byFaceType.values()) {
    const flatGroups = [];
    let bestCorner = [];
    let total = 0;
    let face = '';
    for (const list of perPhoto.values()) {
      total += list.length;
      face = list[0]?.face || face;
      if (list.some((opening) => opening._isCorner)) {
        if (list.length > bestCorner.length) bestCorner = list;
      } else {
        flatGroups.push(list);
      }
    }
    const faceWidth = num(faceWidthsFt?.[face]);
    const spanning = flatGroups.filter((list) => {
      const span = openingSpan(list, faceWidth);
      return span && span.fraction >= 0.65;
    });
    // Two straight photos that each show most of the face are the same
    // windows. Their counts do not add. Two partials of a long wall still do.
    let flat = [];
    if (spanning.length) {
      flat = spanning.reduce((best, list) => (list.length > best.length ? list : best), []);
    } else {
      for (const list of flatGroups) flat.push(...list);
    }
    // A corner sees the whole wall, so it can only raise that total.
    const chosen = flat.length >= bestCorner.length ? flat : bestCorner;
    kept.push(...chosen);
    collapsed += total - chosen.length;
  }
  return { openings: [...passthrough, ...kept], collapsed };
}

/**
 * Two measured openings are the same window when their size agrees, even if a
 * corner photo shifted the zone or the position. The tolerance is the larger
 * of the absolute geometry band and a quarter of the opening, so a 3 ft window
 * and a 3.4 ft re-read match while a 3 ft window and a 6 ft window do not.
 */
function looseSameOpening(a, b) {
  const dw = Math.abs(num(a.width_ft) - num(b.width_ft));
  const dh = Math.abs(num(a.height_ft) - num(b.height_ft));
  const tolW = Math.max(GEO_TOL_FT, 0.25 * Math.max(num(a.width_ft), num(b.width_ft)));
  const tolH = Math.max(GEO_TOL_FT, 0.25 * Math.max(num(a.height_ft), num(b.height_ft)));
  return dw <= tolW && dh <= tolH;
}

/**
 * Measured openings on a corner photo overlap the straight elevation. Zone
 * strings from an oblique frame rarely match the flat frame, so the strict
 * dedupe keeps both and the wall is counted twice — the Centuryway report
 * turned 13 window groups and 2 doors into 20 assemblies and 4 doors.
 *
 * Flat photos stay additive. A corner can only add an opening the flat set
 * does not already contain, and only when that corner saw more openings than
 * the flat set. Two corner slots and no flat photo keep the larger slot.
 */
function fractionAlongWall(opening) {
  const width = num(opening._photoWidth);
  if (!(width > 0) || opening.pos_x == null) return null;
  return num(opening.pos_x) / width;
}

/**
 * Feet from the left of the face. A photo that says where along the wall it
 * sits is shifted by that start. Otherwise pos_x is already along the face,
 * not a fraction of whichever frame happened to contain the window.
 */
function positionAlongFaceFt(opening, faceWidth) {
  if (opening?.pos_x == null) return null;
  const pos = num(opening.pos_x);
  if (opening.position_unit === 'fraction') {
    const start = Number.isFinite(Number(opening._visibleStart)) ? num(opening._visibleStart) : 0;
    const span = num(opening._visibleFraction) > 0 ? num(opening._visibleFraction) : 1;
    const width = faceWidth > 0 ? faceWidth : num(opening._photoWidth);
    return width > 0 ? (start + Math.min(1, Math.max(0, pos)) * span) * width : null;
  }
  if (faceWidth > 0 && Number.isFinite(Number(opening._visibleStart))) {
    return num(opening._visibleStart) * faceWidth + pos;
  }
  return pos;
}

/**
 * Two photos of one face are one set of openings. A match is the same type,
 * a similar size, and a similar position along the face. Position is feet
 * from the left of the wall, not a fraction of each photo. An opening only
 * one photo saw stays. Same-photo neighbors are never merged.
 */
function sameOpeningAcrossPhotos(a, b, faceWidth = 0) {
  if (a.face !== b.face || a.type !== b.type) return false;
  if (a._photoIndex != null && a._photoIndex === b._photoIndex) return false;
  const dw = Math.abs(num(a.width_ft) - num(b.width_ft));
  const dh = Math.abs(num(a.height_ft) - num(b.height_ft));
  const wider = Math.max(num(a.width_ft), num(b.width_ft), 1);
  const narrower = Math.min(num(a.width_ft), num(b.width_ft));
  // A corner foreshortens a 16 ft garage door to about 9 ft. Windows do not.
  const garageForeshortened = a.type === 'garage_door' && narrower >= wider * 0.45 && dh <= Math.max(GEO_TOL_FT, 0.35 * Math.max(num(a.height_ft), num(b.height_ft), 1));
  const tolW = Math.max(GEO_TOL_FT, 0.35 * wider);
  const tolH = Math.max(GEO_TOL_FT, 0.35 * Math.max(num(a.height_ft), num(b.height_ft), 1));
  if (!garageForeshortened && (dw > tolW || dh > tolH)) return false;
  const yTol = Math.max(4, 0.35 * Math.max(num(a.height_ft), num(b.height_ft), 1));
  const yMatch = Math.abs(num(a.pos_y) - num(b.pos_y)) <= yTol;
  const ax = positionAlongFaceFt(a, faceWidth);
  const bx = positionAlongFaceFt(b, faceWidth);
  if (ax != null && bx != null && faceWidth > 0) {
    const feetTol = a.type === 'garage_door'
      ? Math.max(8, 0.2 * faceWidth)
      : Math.max(3, 0.08 * faceWidth);
    return Math.abs(ax - bx) <= feetTol && yMatch;
  }
  const fracA = fractionAlongWall(a);
  const fracB = fractionAlongWall(b);
  const alongTol = a.type === 'garage_door' ? 0.25 : 0.15;
  if (fracA != null && fracB != null) {
    return Math.abs(fracA - fracB) <= alongTol && yMatch;
  }
  // No wall width to normalize against. A corner shifts the reading by a few
  // feet; that is still the same opening. Adjacent windows are further apart.
  if (a.pos_x != null && b.pos_x != null) {
    const xTol = a.type === 'garage_door' ? 8 : Math.max(3, 0.5 * wider);
    return Math.abs(num(a.pos_x) - num(b.pos_x)) <= xTol && yMatch;
  }
  const zoneA = a.zone != null ? String(a.zone) : '';
  const zoneB = b.zone != null ? String(b.zone) : '';
  return zoneA !== '' && zoneA !== 'unknown' && zoneA === zoneB;
}

function preferOpeningReading(current, incoming) {
  if (incoming.type === 'garage_door' && num(incoming.width_ft) > num(current.width_ft) + 0.5) return incoming;
  if (num(incoming.sqft) > num(current.sqft) && num(incoming.confidence) + 0.05 >= num(current.confidence)) return incoming;
  if (num(incoming.confidence) > num(current.confidence)) return incoming;
  return current;
}

// An oblique garage frame piles both doors into the left part of a short width.
// Left-to-right order is the identity; the raw x is not.
function garageCentersAreCompressed(openings, faceWidth) {
  if (openings.length < 2 || !(faceWidth > 0)) return false;
  const xs = openings.map((opening) => num(opening.pos_x)).filter((x) => Number.isFinite(x));
  if (xs.length < 2) return false;
  return Math.max(...xs) - Math.min(...xs) < faceWidth * 0.5;
}

function reconcileCornerToLargestSlot(rawOpenings) {
  const measured = rawOpenings.filter((o) => !o.synthetic && o.face !== UNKNOWN_FACE);
  const rest = rawOpenings.filter((o) => o.synthetic || o.face === UNKNOWN_FACE);
  if (measured.length === 0) return { openings: rawOpenings, collapsed: 0 };
  const byFaceType = new Map();
  for (const opening of measured) {
    const key = `${opening.face}|${opening.type}`;
    if (!byFaceType.has(key)) byFaceType.set(key, []);
    byFaceType.get(key).push(opening);
  }
  const largestPhoto = (list) => {
    const byPhoto = new Map();
    for (const opening of list) {
      if (!byPhoto.has(opening._photoIndex)) byPhoto.set(opening._photoIndex, []);
      byPhoto.get(opening._photoIndex).push(opening);
    }
    let best = [];
    for (const group of byPhoto.values()) {
      if (group.length > best.length) best = group;
    }
    return best;
  };
  const kept = [];
  let collapsed = 0;
  for (const list of byFaceType.values()) {
    const flat = list.filter((opening) => !opening._isCorner);
    const corners = list.filter((opening) => opening._isCorner);
    if (corners.length === 0) {
      kept.push(...flat);
      continue;
    }
    if (flat.length === 0) {
      const best = largestPhoto(corners);
      kept.push(...best);
      collapsed += corners.length - best.length;
      continue;
    }
    const bestCorner = largestPhoto(corners);
    const extrasAllowed = Math.max(0, bestCorner.length - flat.length);
    if (extrasAllowed === 0) {
      kept.push(...flat);
      collapsed += corners.length;
      continue;
    }
    const used = new Set();
    const unmatched = [];
    for (const corner of bestCorner) {
      const match = flat.findIndex((item, index) => !used.has(index) && looseSameOpening(item, corner));
      if (match === -1) unmatched.push(corner);
      else used.add(match);
    }
    const extras = unmatched.slice(0, extrasAllowed);
    kept.push(...flat, ...extras);
    collapsed += corners.length - extras.length;
  }
  return { openings: [...rest, ...kept], collapsed };
}

function reconcileMeasuredCornerOverlap(rawOpenings, faceWidthsFt = null) {
  // Photo-sized walls keep the largest corner slot. A footprint-anchored wall
  // unions every photo of the face, because the satellite edge is the width
  // and each photo is another look at that same edge.
  if (!faceWidthsFt) return reconcileCornerToLargestSlot(rawOpenings);
  const measured = rawOpenings.filter((o) => !o.synthetic && o.face !== UNKNOWN_FACE);
  const rest = rawOpenings.filter((o) => o.synthetic || o.face === UNKNOWN_FACE);
  if (measured.length === 0) return { openings: rawOpenings, collapsed: 0 };

  const byFaceType = new Map();
  for (const opening of measured) {
    const key = `${opening.face}|${opening.type}`;
    if (!byFaceType.has(key)) byFaceType.set(key, []);
    byFaceType.get(key).push(opening);
  }

  const kept = [];
  let collapsed = 0;
  for (const [key, list] of byFaceType) {
    const face = key.split('|')[0];
    const faceWidth = num(faceWidthsFt?.[face]) || Math.max(...list.map((opening) => num(opening._photoWidth)), 0);
    const spanFaceWidth = num(faceWidthsFt?.[face]) || 0;
    const byPhoto = new Map();
    for (const opening of list) {
      if (!byPhoto.has(opening._photoIndex)) byPhoto.set(opening._photoIndex, []);
      byPhoto.get(opening._photoIndex).push(opening);
    }
    const photos = [...byPhoto.values()].sort((a, b) => {
      const aCorner = a.some((opening) => opening._isCorner) ? 1 : 0;
      const bCorner = b.some((opening) => opening._isCorner) ? 1 : 0;
      if (aCorner !== bCorner) return aCorner - bCorner;
      return b.length - a.length;
    });
    const union = [];
    let unionSpan = null;
    for (const openings of photos) {
      const incomingSpan = openingSpan(openings, spanFaceWidth);
      const overlappingFaces = spansOverlap(unionSpan, incomingSpan);
      const garageOrder = openings[0]?.type === 'garage_door'
        && (garageCentersAreCompressed(openings, faceWidth) || garageCentersAreCompressed(union, faceWidth));
      const used = new Set();
      const incoming = garageOrder
        ? [...openings].sort((a, b) => num(a.pos_x) - num(b.pos_x))
        : openings;
      const targets = garageOrder
        ? union.map((opening, index) => ({ opening, index })).sort((a, b) => num(a.opening.pos_x) - num(b.opening.pos_x))
        : null;
      incoming.forEach((opening, incomingIndex) => {
        let match = -1;
        if (garageOrder && targets) {
          const candidate = targets[incomingIndex];
          if (candidate && !used.has(candidate.index)) match = candidate.index;
        } else if (overlappingFaces) {
          // Same window, second photo, positions that do not line up.
          // Pair by size, one to one, closest along the wall first.
          let bestDist = Infinity;
          for (let i = 0; i < union.length; i += 1) {
            if (used.has(i) || !looseSameOpening(union[i], opening)) continue;
            const dist = union[i].pos_x != null && opening.pos_x != null
              ? Math.abs(num(union[i].pos_x) - num(opening.pos_x))
              : 0;
            if (dist < bestDist) {
              bestDist = dist;
              match = i;
            }
          }
        } else {
          for (let i = 0; i < union.length; i += 1) {
            if (used.has(i)) continue;
            if (sameOpeningAcrossPhotos(union[i], opening, faceWidth)) {
              match = i;
              break;
            }
          }
        }
        // Overlapping frames that missed on size still collapse when the
        // window sits at the same place along the face.
        if (match === -1 && !garageOrder) {
          for (let i = 0; i < union.length; i += 1) {
            if (used.has(i)) continue;
            if (sameOpeningAcrossPhotos(union[i], opening, faceWidth)) {
              match = i;
              break;
            }
          }
        }
        if (match === -1) union.push(opening);
        else {
          used.add(match);
          collapsed += 1;
          union[match] = preferOpeningReading(union[match], opening);
        }
      });
      if (incomingSpan) unionSpan = unionSpan ? {
        start: Math.min(unionSpan.start, incomingSpan.start),
        end: Math.max(unionSpan.end, incomingSpan.end),
        fraction: Math.max(unionSpan.fraction, incomingSpan.fraction),
        assumed: unionSpan.assumed || incomingSpan.assumed,
      } : incomingSpan;
    }
    kept.push(...union);
  }
  return { openings: [...rest, ...kept], collapsed };
}

/**
 * A window unit is a framed product, not a sash. Side-by-side components that
 * add up to the group width are real mullions. Components stacked inside a
 * taller-than-wide opening, or equal slices of a portrait opening, are the
 * upper and lower sash of one double-hung and count as one unit.
 */
function unitsInWindowGroup(group, components) {
  const comps = components.filter((c) => c.group_id === group.id && c.type === 'window');
  const declared = Math.floor(num(group.unit_count));
  const applyDeclared = (fromParts) => (
    declared > fromParts && declared <= 12 ? declared : fromParts
  );
  if (comps.length === 0) return applyDeclared(1);
  const gw = num(group.width_ft);
  const gh = num(group.height_ft);
  const sumW = comps.reduce((s, c) => s + num(c.width_ft), 0);
  const sumH = comps.reduce((s, c) => s + num(c.height_ft), 0);
  const near = (a, b, span) => Math.abs(a - b) <= Math.max(0.3, span * 0.15);
  const widthsMatchGroup = comps.every((c) => near(num(c.width_ft), gw, gw));
  const heightsMatchGroup = comps.every((c) => near(num(c.height_ft), gh, gh));
  const stacked = widthsMatchGroup && gh > 0 && Math.abs(sumH - gh) <= Math.max(0.5, gh * 0.2);
  if (stacked) return applyDeclared(1);
  const sideBySide = heightsMatchGroup && gw > 0 && Math.abs(sumW - gw) <= Math.max(0.5, gw * 0.2);
  let fromParts = comps.length;
  if (sideBySide) {
    const portrait = gh > gw * 1.05;
    const slice = gw / comps.length;
    const equalSplits = comps.every((c) => Math.abs(num(c.width_ft) - slice) <= Math.max(0.25, gw * 0.08));
    fromParts = portrait && equalSplits ? 1 : comps.length;
  }
  return applyDeclared(fromParts);
}

/**
 * Dedupe repeated photo observations. Groups get collapsed only when
 * isDuplicateObservation() holds; the highest-confidence copy is kept.
 * Returns { openings, duplicatesRemoved }.
 */
function dedupeObservations(rawOpenings) {
  const kept = [];
  let duplicatesRemoved = 0;

  for (const cand of rawOpenings) {
    const existingIdx = kept.findIndex((k) => isDuplicateObservation(k, cand));
    if (existingIdx === -1) {
      kept.push(cand);
      continue;
    }
    duplicatesRemoved++;
    // Keep the higher-confidence copy (tie → keep the earlier one, stable).
    // A foreshortened garage door is the smaller reading of the same door.
    if (cand.type === 'garage_door' && num(cand.width_ft) > num(kept[existingIdx].width_ft) + 0.5) {
      kept[existingIdx] = cand;
    } else if (cand.confidence > kept[existingIdx].confidence) {
      kept[existingIdx] = cand;
    }
  }
  return { openings: kept, duplicatesRemoved };
}

// ── Graph builders ──────────────────────────────────────────────────────────

function buildWallFacets(perPhotoResults, dedupedOpenings, multiViewEvidence) {
  // A facet exists for each unique resolved face that appears in either the
  // photos or the openings, plus an explicit unknown-photo facet if needed.
  const facesSeen = new Set();
  for (const r of perPhotoResults) {
    const evidence = evidenceForResult(r);
    const faces = evidence?.faces?.length ? evidence.faces : [resultFace(r)];
    faces.forEach(face => facesSeen.add(face));
  }
  for (const o of dedupedOpenings) facesSeen.add(o.face);

  const facets = [];
  const orderedFaces = [...WALL_FACES, UNKNOWN_FACE].filter((f) => facesSeen.has(f));

  for (const face of orderedFaces) {
    const photos = perPhotoResults.filter(
      (r) => {
        const evidence = evidenceForResult(r);
        const matches = evidence?.faces?.length
          ? evidence.faces.includes(face)
          : resultFace(r) === face;
        // Duplicate source views and detail-only images remain in the evidence
        // audit trail, but cannot establish a second facet or become its
        // dimension anchor.
        return matches
          && evidence?.status !== 'duplicate'
          && evidence?.status !== 'supporting_detail';
      },
    );
    const confidences = photos.map(photoConfidence);
    const avgConf =
      confidences.length > 0
        ? round(confidences.reduce((s, c) => s + c, 0) / confidences.length, 3)
        : null;
    // Per-face dimensions. The elevation drawings need a real measured width /
    // height per wall; without them every face falls back to the global
    // building box and all four elevations render as identical estimated
    // rectangles. Prefer FLAT (single-wall) photos: a corner shot's
    // wall_width_ft describes "the more prominent wall" in the frame, which may
    // be the NEIGHBOURING wall, so only trust it when the face has no flat
    // photo of its own. Among the candidates take the widest reading — the same
    // merge rule the analyzer uses — since a partially-framed wall under-reads.
    const flatPhotos = photos.filter((p) => !isCornerPhoto(p));
    // A corner photo's width is for its primary wall only. It proves that the
    // secondary face is visible, but its reported width must not overwrite that
    // face's own straight/corner-primary dimension.
    const primaryCornerPhotos = photos.filter((p) =>
      isCornerPhoto(p) && evidenceForResult(p)?.primary_face === face,
    );
    const dimPool = flatPhotos.length > 0
      ? flatPhotos
      : (primaryCornerPhotos.length > 0 ? primaryCornerPhotos : photos);
    const best = dimPool.reduce(
      (b, r) => ((Number(r.wall_width_ft) || 0) > (Number(b?.wall_width_ft) || 0) ? r : b),
      dimPool[0],
    );
    const straightWidths = flatPhotos
      .map((photo) => num(photo.wall_width_ft))
      .filter((width) => width > 0)
      .sort((a, b) => a - b);
    const straightMid = straightWidths.length
      ? (straightWidths.length % 2
        ? straightWidths[(straightWidths.length - 1) / 2]
        : (straightWidths[straightWidths.length / 2 - 1] + straightWidths[straightWidths.length / 2]) / 2)
      : 0;

    const faceEvidence = multiViewEvidence?.faces?.find(summary => summary.face === face);
    const faceMaterial = billedFaceMaterial(photos, best, face, perPhotoResults);
    facets.push({
      id: `facet_${face}`,
      face,
      is_unknown: face === UNKNOWN_FACE,
      photo_count: photos.length,
      usable_photo_count: faceEvidence?.photo_count ?? photos.length,
      straight_elevation_count: faceEvidence?.straight_elevation_count ?? flatPhotos.length,
      corner_overlap_count: faceEvidence?.corner_overlap_count ?? 0,
      confidence: avgConf,
      occluded: photos.some((p) => p.occluded),
      // Zero/null means "not measured" — consumers fall back to global values.
      wall_width_ft: round(Number(best?.wall_width_ft) || 0, 2),
      straight_width_ft: round(straightMid, 2),
      wall_height_ft: round(Number(best?.wall_height_ft || best?.eave_height_ft) || 0, 2),
      // Eave height and gable rise are kept apart so the photo-measured wall
      // prism can bill a gable as the triangle it is. `wall_height_ft` already
      // folds the rise in, and treating that as a rectangle overstates every
      // gable end by half its area.
      eave_height_ft: round(eaveExcludingGable(best), 2),
      gable_rise_ft: round(Math.max(0, Number(best?.gable_rise_ft) || 0), 2),
      has_gable_end: best?.has_gable_end === true,
      is_one_story_wing: best?.is_one_story_wing === true
        || best?.height_method === 'garage_door_anchor'
        || ((Number(best?.garage_doors_count) || 0) > 0
          && Number(best?.window_rows) > 0
          && Number(best?.window_rows) < 2),
      height_method: best?.height_method || null,
      story_count: Number(best?.story_count) || 0,
      // Photo anchors measure grade → eave for the whole visible elevation.
      // This flag is deliberately persisted on each facet so a downstream
      // renderer/calculator cannot infer "stories × wall_height" from the
      // presence of story_count. The footprint extrusion is the only path
      // allowed to multiply a per-story height by story count.
      height_semantics: best?.height_semantics || (
        String(best?.height_method || '').startsWith('photo_')
          || ['door_anchor', 'garage_door_anchor', 'course_count', 'door_scale', 'window_scale'].includes(best?.height_method)
          ? 'full_elevation'
          : 'unknown'
      ),
      stories_multiplier: best?.height_semantics === 'full_elevation' ? 1 : null,
      height_measurement_valid: best?.height_measurement_valid !== false,
      photo_label: best?.label || best?.view_label || null,
      dimension_source:
        photos.length === 0 ? null : flatPhotos.length > 0 ? 'flat_photo' : 'corner_photo',
      fused_width_ft: faceEvidence?.width_ft ?? null,
      width_range_ft: faceEvidence?.width_range_ft ?? null,
      fused_height_ft: faceEvidence?.height_ft ?? null,
      height_range_ft: faceEvidence?.height_range_ft ?? null,
      contradictory_dimensions: faceEvidence?.contradictory_dimensions === true,
      // A face is poor only when every photo of it is unusable. One clear
      // elevation still measures the wall; a dark or blocked set does not.
      elevation_poor: photos.length > 0 && photos.every((p) => {
        if (p.elevation_usable === false || p.elevation_poor === true || p.occluded === true) return true;
        return photoConfidence(p) < 0.5;
      }),
      // Per-face cladding. The analyzer reads this off every photo, but the graph
      // used to drop it, so the 3D viewer had no way to tell a brick elevation
      // from a vinyl one and rendered every wall with the same lap texture.
      // Prefer the same photo the dimensions came from, then any photo of this
      // face that reported a material.
      siding_material:
        best?.siding_material ||
        photos.find((p) => p.siding_material)?.siding_material ||
        null,
      siding_profile:
        best?.siding_profile ||
        photos.find((p) => p.siding_profile)?.siding_profile ||
        null,
      material_regions: faceMaterial.regions,
      share_regions: faceMaterial.shareRegions,
      material_agreement: faceMaterial.agreement || null,
      material_confidence:
        best?.material_confidence ??
        photos.find((p) => p.material_confidence != null)?.material_confidence ??
        avgConf,
      material_uncertain:
        best?.material_uncertain === true
        || photos.some((p) => p.material_uncertain === true),
      non_siding_pct: faceMaterial.pct,
      has_mixed_materials: best?.has_mixed_materials === true
        || photos.some((p) => p.has_mixed_materials === true)
        || (faceMaterial.pct != null && faceMaterial.pct > 0),
      sections: [
        ...photoSectionsForFace(photos),
        ...(Array.isArray(faceMaterial.sections) ? faceMaterial.sections : []),
      ],
      non_siding_material: faceMaterial.material,
      accent_material: faceMaterial.material,
    });
  }
  return facets;
}

/**
 * Photo heights on footprint lengths.
 *
 * Formula (per canonical face):
 *   trusted photo → footprint edge × eave height + ½ × footprint edge × gable rise
 *   fallback      → footprint edge × aggregate wall height
 *
 * A photo width more than PHOTO_WIDTH_ANCHOR_BAND_PCT off its footprint edge
 * is a bad scale read. That wall falls back. The sum of photo widths is
 * checked against the traced perimeter with the same band and flagged; it
 * never replaces the perimeter. Jog walls the four named edges do not cover
 * stay in the total at the aggregate height.
 */
function storyMinFullEave(storyCount) {
  const stories = Math.max(1, Math.round(num(storyCount)) || 1);
  return stories <= 1 ? 7 : stories * 9 - 2;
}

/** A straight outbuilding wall taller than one story is the house behind it. */
function outbuildingEave(raw, outbuilding) {
  const height = num(raw);
  if (!outbuilding || !(height > 0)) return height;
  if (height >= 7 && height <= 12) return height;
  return 9;
}

/**
 * A garage wing or a gable end narrower than the footprint edge is not the
 * whole facade. Billing its height and rise across the footprint edge is
 * what doubled the front.
 */
function partialFacadePortion(facet, footprintWidth) {
  if (!facet) return null;
  const photoWidth = num(facet.wall_width_ft);
  const wing = facet.is_one_story_wing === true;
  const narrowGable = facet.has_gable_end === true
    && footprintWidth > 0
    && photoWidth > 0
    && photoWidth < footprintWidth * 0.75;
  if (!wing && !narrowGable) return null;
  const portion = footprintWidth > 0
    ? Math.min(photoWidth > 0 ? photoWidth : footprintWidth, footprintWidth)
    : photoWidth;
  if (!(portion > 0)) return null;
  return { portion, wing, narrowGable };
}

function widthWithinBand(photoWidth, edgeLength) {
  if (!(photoWidth > 0) || !(edgeLength > 0)) return false;
  return Math.abs(photoWidth - edgeLength) / edgeLength * 100 <= PHOTO_WIDTH_ANCHOR_BAND_PCT;
}

function footprintEdgeLengths(widths, face) {
  const listed = widths?.edges?.[face];
  if (Array.isArray(listed) && listed.length) {
    return listed.map((edge) => num(edge.length_ft)).filter((length) => length > 0);
  }
  const summed = num(widths?.[face]);
  return summed > 0 ? [summed] : [];
}

/**
 * Footprint edges × one house eave. Photo width and photo eave do not enter
 * the area. A straight photo more than 15% off its face is a review flag
 * only after the face mapping is checked: a corner width is not the facade,
 * a photo that matches one edge of a stepped wall is not a miss, and a photo
 * that matches a different face's edge is a label miss, not a footprint miss.
 */
function footprintAnchoredWall(wallFacets, agg) {
  const widths = agg.faceWidthsFt;
  if (!widths || typeof widths !== 'object') return null;
    const height = num(agg.wallHeightFt);
    if (!(height > 0) && !agg.faceEaveFt) return null;
  const gables = agg.gableByFace && typeof agg.gableByFace === 'object' ? agg.gableByFace : {};
  const faces = {};
  const measured = [];
  const substituted = [];
  const widthReview = [];
  let area = 0;
  const allEdges = WALL_FACES.flatMap((name) => footprintEdgeLengths(widths, name));
  for (const face of WALL_FACES) {
    const width = num(widths[face]);
    const gable = Math.max(0, num(gables[face]));
    const faceHeight = num(agg.faceEaveFt?.[face]) || height;
    const facet = wallFacets.find((item) => item.face === face && !item.is_unknown);
    const photoWidth = num(facet?.straight_width_ft);
    const ownEdges = footprintEdgeLengths(widths, face);
    const matchesOwn = ownEdges.some((edge) => widthWithinBand(photoWidth, edge))
      || widthWithinBand(photoWidth, width);
    const matchesAny = allEdges.some((edge) => widthWithinBand(photoWidth, edge));
    const deviation = width > 0 && photoWidth > 0
      ? round(Math.abs(photoWidth - width) / width * 100, 1)
      : null;
    const widthFlag = photoWidth > 0 && !matchesOwn && !matchesAny
      && deviation != null && deviation > PHOTO_WIDTH_ANCHOR_BAND_PCT;
    if (widthFlag) {
      widthReview.push({
        face,
        photo_width_ft: round(photoWidth, 2),
        footprint_width_ft: round(width, 2),
        deviation_pct: deviation,
        message: `${String(face).replace(/_/g, ' ')} photo width ${round(photoWidth, 1)} ft is ${deviation}% off the footprint edge ${round(width, 1)} ft`,
      });
    }
    const faceArea = round(width * faceHeight + gable, 2);
    const seen = Boolean(facet) && facet.elevation_poor !== true && (photoWidth > 0 || num(facet?.eave_height_ft) > 0);
    faces[face] = {
      face,
      source: 'footprint_edge',
      width_ft: round(width, 2),
      photo_width_ft: round(photoWidth, 2),
      width_deviation_pct: deviation,
      eave_height_ft: round(faceHeight, 2),
      gable_area_sqft: round(gable, 2),
      gable_rise_ft: width > 0 ? round((2 * gable) / width, 2) : 0,
      height_semantics: 'house_eave',
      stories_multiplier: 1,
      area_sqft: faceArea,
      width_review: widthFlag,
    };
    if (seen) measured.push(face);
    else substituted.push(face);
    area += faceArea;
  }
  const areaSqft = round(area, 2);
  return {
    area_sqft: areaSqft,
    faces,
    measured_faces: measured,
    substituted_faces: substituted,
    width_fallback_faces: [],
    width_review_flags: widthReview,
    prism_perimeter_ft: round(num(widths.perimeter_ft) || WALL_FACES.reduce((sum, face) => sum + num(widths[face]), 0), 2),
    measured_perimeter_ft: round(WALL_FACES.reduce((sum, face) => sum + num(faces[face].photo_width_ft), 0), 2),
    footprint_perimeter_ft: round(num(agg.perimeterFt) || num(widths.perimeter_ft), 2),
    measured_perimeter_coverage: null,
    measured_perimeter_share: 0,
    covers_footprint: true,
    inflates_extrusion: false,
    extrusion_wall_area_sqft: round(num(agg.grossWallAreaSqft), 2),
    delta_vs_extrusion_pct: null,
    within_sanity_band: widthReview.length === 0,
    sanity_band_pct: PHOTO_WIDTH_ANCHOR_BAND_PCT,
    perimeter_deviation_pct: null,
    perimeter_flagged: false,
    lengths_anchored: true,
    footprint_anchored: true,
    poor_faces: [],
    photo_overrides_footprint: false,
    usable: areaSqft > 0,
  };
}

function buildPhotoWallArea(wallFacets, agg) {
  const anchored = footprintAnchoredWall(wallFacets, agg);
  if (anchored) return anchored;
  const defaultWidths = {
    front: num(agg.buildingWidthFt),
    back: num(agg.buildingWidthFt),
    left_side: num(agg.buildingLengthFt),
    right_side: num(agg.buildingLengthFt),
  };
  const aggHeight = outbuildingEave(agg.wallHeightFt, agg.outbuilding === true);
  const faces = {};
  const measured = [];
  const substituted = [];
  const poorFaces = [];
  const widthFallbackFaces = [];
  let area = 0;
  let prismPerimeter = 0;
  let measuredPerimeter = 0;
  let rawPhotoPerimeter = 0;

  for (const face of WALL_FACES) {
    const facet = wallFacets.find((f) => f.face === face && !f.is_unknown);
    const photoWidth = num(facet?.wall_width_ft);
    const footprintWidth = defaultWidths[face] || 0;
    const eave = eaveExcludingGable(facet);
    const gableRise = Math.max(0, num(facet?.gable_rise_ft));
    if (facet?.elevation_poor === true) poorFaces.push(face);
    if (photoWidth > 0 && facet?.elevation_poor !== true) rawPhotoPerimeter += photoWidth;

    const widthDeviationPct = footprintWidth > 0 && photoWidth > 0
      ? round(Math.abs(photoWidth - footprintWidth) / footprintWidth * 100, 1)
      : null;
    const widthAgrees = footprintWidth <= 0
      || widthDeviationPct == null
      || widthDeviationPct <= PHOTO_WIDTH_ANCHOR_BAND_PCT;
    // A garage wing or a narrow gable is supposed to be narrower than the
    // footprint edge. That disagreement is the portion, not a bad scale.
    const portion = partialFacadePortion(facet, footprintWidth);
    if (widthDeviationPct != null && widthDeviationPct > PHOTO_WIDTH_ANCHOR_BAND_PCT && !portion) {
      widthFallbackFaces.push(face);
    }
    // No footprint edge and no photo width means there is nothing to bill.
    // A photo eave on a known edge is trusted when the width agrees or was
    // never read. A disagreeing width means the photo scale is off, so the
    // height from that same photo falls back with it.
    const photoScaleTrusted = Boolean(facet)
      && facet.elevation_poor !== true
      && eave > 0
      && widthAgrees
      && (photoWidth > 0 || footprintWidth > 0);
    const partialTrusted = Boolean(portion)
      && Boolean(facet)
      && facet.elevation_poor !== true
      && eave > 0
      && (photoWidth > 0 || footprintWidth > 0);

    if (partialTrusted && (footprintWidth > 0 || photoWidth > 0)) {
      const billedWidth = footprintWidth > 0 ? footprintWidth : portion.portion;
      const rest = Math.max(0, billedWidth - portion.portion);
      const portionHeight = portion.wing && eave > 0 ? eave : aggHeight || eave;
      // The triangle stays on the photographed gable. It does not spread
      // across the rest of a front the garage photo never showed.
      const gableWidth = portion.narrowGable || rest < 0.5 ? portion.portion : 0;
      const faceArea = round(
        portion.portion * portionHeight + rest * (aggHeight || portionHeight) + (gableWidth * gableRise) / 2,
        2,
      );
      faces[face] = {
        face,
        source: 'partial_not_full_facade',
        width_ft: round(billedWidth, 2),
        photo_width_ft: round(photoWidth, 2),
        width_deviation_pct: widthDeviationPct,
        eave_height_ft: round(portionHeight, 2),
        gable_rise_ft: round(portion.narrowGable ? gableRise : 0, 2),
        height_semantics: 'partial_facade',
        stories_multiplier: 1,
        area_sqft: faceArea,
        wing: portion.wing,
        partial: true,
      };
      measured.push(face);
      area += faceArea;
      prismPerimeter += billedWidth;
      measuredPerimeter += photoWidth > 0 ? photoWidth : billedWidth;
    } else if (photoScaleTrusted) {
      const billedWidth = footprintWidth > 0 ? footprintWidth : photoWidth;
      const billedEave = outbuildingEave(eave, agg.outbuilding === true);
      const faceArea = round(billedWidth * billedEave + (billedWidth * gableRise) / 2, 2);
      faces[face] = {
        face,
        source: footprintWidth > 0 ? 'footprint_length_photo_height' : 'photo_plane',
        width_ft: round(billedWidth, 2),
        photo_width_ft: round(photoWidth, 2),
        width_deviation_pct: widthDeviationPct,
        eave_height_ft: round(billedEave, 2),
        gable_rise_ft: round(gableRise, 2),
        height_semantics: facet.height_semantics || 'full_elevation',
        stories_multiplier: 1,
        area_sqft: faceArea,
        wing: facet?.is_one_story_wing === true,
      };
      measured.push(face);
      area += faceArea;
      prismPerimeter += billedWidth;
      measuredPerimeter += photoWidth > 0 ? photoWidth : billedWidth;
    } else {
      const faceArea = round(footprintWidth * aggHeight, 2);
      faces[face] = {
        face,
        source: widthFallbackFaces.includes(face) ? 'footprint_width_fallback' : 'footprint_substitute',
        width_ft: round(footprintWidth, 2),
        photo_width_ft: round(photoWidth, 2),
        width_deviation_pct: widthDeviationPct,
        eave_height_ft: round(aggHeight, 2),
        gable_rise_ft: 0,
        height_semantics: 'full_elevation',
        stories_multiplier: 1,
        area_sqft: faceArea,
        fallback_reason: widthFallbackFaces.includes(face)
          ? 'photo_width_deviates_from_footprint_edge'
          : (facet?.elevation_poor === true ? 'poor_elevation' : 'no_photo_height'),
      };
      substituted.push(face);
      area += faceArea;
      prismPerimeter += footprintWidth;
    }
  }

  const stories = Math.max(1, Math.round(num(agg.storyCount)) || 1);
  const minFull = storyMinFullEave(stories);
  const fullWall = measured.filter((name) => faces[name] && !faces[name].wing && !faces[name].partial);
  const anyFull = fullWall.some((name) => num(faces[name].eave_height_ft) + 0.01 >= minFull);
  // Every straight elevation stopped at one floor of a taller house. Use the
  // story eave. A house that also has a full-height wall keeps the short
  // wings (a one-story side on a two-story body).
  if (stories >= 2 && !anyFull && fullWall.length > 0 && aggHeight + 0.01 >= minFull) {
    for (const name of fullWall) {
      const row = faces[name];
      const next = round(num(row.width_ft) * aggHeight + (num(row.width_ft) * num(row.gable_rise_ft)) / 2, 2);
      area += next - num(row.area_sqft);
      row.area_sqft = next;
      row.eave_height_ft = round(aggHeight, 2);
      row.height_raised = 'story_eave';
    }
  }
  const prismCap = num(agg.perimeterFt) > 0 && aggHeight > 0 ? num(agg.perimeterFt) * aggHeight : Infinity;
  let inferredBudget = Number.isFinite(prismCap) ? Math.max(0, prismCap - area) : Infinity;

  const oppositeFace = {
    front: 'back', back: 'front', left_side: 'right_side', right_side: 'left_side',
  };
  for (const face of WALL_FACES) {
    const row = faces[face];
    const opposite = faces[oppositeFace[face]];
    if (num(row.area_sqft) < MIN_FACE_AREA_SQFT && opposite && num(opposite.area_sqft) >= MIN_FACE_AREA_SQFT * 2) {
      const half = num(opposite.area_sqft) / 2;
      const factor = half / num(opposite.area_sqft);
      opposite.area_sqft = round(half, 2);
      if (num(opposite.width_ft) > 0) opposite.width_ft = round(num(opposite.width_ft) * factor, 2);
      row.area_sqft = round(half, 2);
      row.width_ft = opposite.width_ft;
      row.eave_height_ft = opposite.eave_height_ft || round(aggHeight, 2);
      row.source = 'inferred_opposite';
      row.inferred = true;
      row.fallback_reason = 'sliver_restored';
      if (!substituted.includes(face)) substituted.push(face);
      continue;
    }
    if (row.area_sqft > 0) continue;
    if (!(inferredBudget > 0.5)) continue;
    let width = row.width_ft || opposite?.width_ft || 0;
    let source = row.width_ft > 0 ? 'inferred_footprint' : 'inferred_opposite';
    if (!(width > 0) && num(agg.perimeterFt) > prismPerimeter + 0.5) {
      const empty = WALL_FACES.filter((name) => !(faces[name].area_sqft > 0)).length || 1;
      width = (num(agg.perimeterFt) - prismPerimeter) / empty;
      source = 'inferred_perimeter';
    }
    if (!(width > 0) || !(aggHeight > 0)) continue;
    const uncapped = width * aggHeight;
    const faceArea = round(Math.min(uncapped, inferredBudget), 2);
    if (faceArea < MIN_FACE_AREA_SQFT) continue;
    inferredBudget -= faceArea;
    row.source = source;
    row.inferred = true;
    row.width_ft = round(width, 2);
    row.eave_height_ft = round(aggHeight, 2);
    row.area_sqft = faceArea;
    row.fallback_reason = 'no_photo';
    if (!substituted.includes(face)) substituted.push(face);
    area += faceArea;
    prismPerimeter += aggHeight > 0 ? faceArea / aggHeight : 0;
  }
  area = WALL_FACES.reduce((sum, name) => sum + num(faces[name].area_sqft), 0);

  const footprintPerimeter = num(agg.perimeterFt);
  // A one-story wing's own eave, when the rest of the house is taller.
  // The jog past the rectangular box belongs to that wing, not the 2-story body.
  const wingRows = Object.values(faces).filter((row) =>
    row.wing
    && num(row.eave_height_ft) >= 7
    && num(row.eave_height_ft) <= 12
    && num(row.eave_height_ft) + 0.5 < aggHeight);
  const wingEave = wingRows.length
    ? wingRows.reduce((sum, row) => sum + num(row.eave_height_ft), 0) / wingRows.length
    : 0;
  const wingFaceFt = wingEave > 0
    ? Math.max(...wingRows.map((row) => num(row.photo_width_ft) || num(row.width_ft) || 0))
    : 0;
  // Wings and jogs the four named edges do not cover.
  const jogRemainder = footprintPerimeter > prismPerimeter + 0.5
    ? footprintPerimeter - prismPerimeter
    : 0;
  const jogHeight = wingEave > 0 ? wingEave : aggHeight;
  if (jogRemainder > 0 && jogHeight > 0 && inferredBudget > 0.5) {
    const jogArea = Math.min(jogRemainder * jogHeight, inferredBudget);
    area += jogArea;
    inferredBudget -= jogArea;
    prismPerimeter += jogRemainder;
  }
  // A traced perimeter shorter than the named edges is still the length
  // authority. Scale the named-edge area so photos cannot outgrow it.
  if (footprintPerimeter > 0 && prismPerimeter > footprintPerimeter + 0.5) {
    area *= footprintPerimeter / prismPerimeter;
    prismPerimeter = footprintPerimeter;
  }
  const wingBill = wingEave > 0
    ? Math.min(footprintPerimeter, wingFaceFt + (jogRemainder > 0 ? jogRemainder : 0))
    : 0;
  const wallAllowance = footprintPerimeter > 0 && aggHeight > 0
    ? ((footprintPerimeter - wingBill) * aggHeight + wingBill * (wingEave || aggHeight)) * 1.1
    : 0;
  if (wallAllowance > 0 && area > wallAllowance) area = wallAllowance;

  const areaSqft = round(area, 2);
  const extrusionSqft = round(num(agg.grossWallAreaSqft), 2);
  const deltaPct = extrusionSqft > 0
    ? round(Math.abs(areaSqft - extrusionSqft) / extrusionSqft * 100, 1)
    : null;
  const withinBand = deltaPct == null || deltaPct <= PHOTO_WIDTH_ANCHOR_BAND_PCT;
  const perimeterDeviationPct = footprintPerimeter > 0 && rawPhotoPerimeter > 0
    ? round(Math.abs(rawPhotoPerimeter - footprintPerimeter) / footprintPerimeter * 100, 1)
    : null;
  const perimeterFlagged = perimeterDeviationPct != null
    && perimeterDeviationPct > PHOTO_WIDTH_ANCHOR_BAND_PCT;
  const perimeterCoverage = footprintPerimeter > 0
    ? round(rawPhotoPerimeter / footprintPerimeter, 3)
    : null;
  const lengthsAnchored = footprintPerimeter > 0
    || WALL_FACES.some((face) => defaultWidths[face] > 0);

  return {
    area_sqft: areaSqft,
    faces,
    measured_faces: measured,
    substituted_faces: substituted,
    width_fallback_faces: widthFallbackFaces,
    prism_perimeter_ft: round(prismPerimeter, 2),
    measured_perimeter_ft: round(rawPhotoPerimeter, 2),
    footprint_perimeter_ft: round(footprintPerimeter, 2),
    measured_perimeter_coverage: perimeterCoverage,
    measured_perimeter_share: prismPerimeter > 0
      ? round(rawPhotoPerimeter / prismPerimeter, 3)
      : 0,
    covers_footprint: perimeterCoverage != null && !perimeterFlagged,
    inflates_extrusion: extrusionSqft > 0 && areaSqft > extrusionSqft * 1.02,
    extrusion_wall_area_sqft: extrusionSqft,
    delta_vs_extrusion_pct: deltaPct,
    within_sanity_band: withinBand && !perimeterFlagged,
    sanity_band_pct: PHOTO_WIDTH_ANCHOR_BAND_PCT,
    perimeter_deviation_pct: perimeterDeviationPct,
    perimeter_flagged: perimeterFlagged,
    lengths_anchored: lengthsAnchored,
    poor_faces: poorFaces,
    // Lengths stay on the footprint. Photos do not replace them.
    photo_overrides_footprint: false,
    usable: areaSqft > 0 && measured.length > 0,
  };
}

/**
 * Windows under 20 sqft ride in waste one at a time. On a face the classifier
 * called siding, a row of those windows is a real opening package, not waste.
 * Faces that were not classified, and mixed masonry faces, keep rule A.
 */
function promoteClassifiedSidingWindowPackages(groups, materialMap) {
  const faces = materialMap?.faces || {};
  const pending = {};
  for (const group of groups) {
    if (group.type !== 'window' || group.deductible) continue;
    if (!(group.area_sqft > 0) || group.area_sqft >= MIN_DEDUCTIBLE_SQFT) continue;
    const face = faces[group.face];
    if (!face || face.inferred) continue;
    const billedFrom = face.material_agreement?.billed_from;
    if (billedFrom !== 'face_sample_median' && billedFrom !== 'property_prior' && billedFrom !== 'rep_confirmed') continue;
    // A wainscot face is still a siding wall. A mixed masonry face is not.
    if (!(Number(face.siding_percent) >= 80)) continue;
    (pending[group.face] = pending[group.face] || []).push(group);
  }
  for (const list of Object.values(pending)) {
    const sum = list.reduce((total, group) => total + num(group.area_sqft), 0);
    // A couple of small windows stay in waste. A row that adds up is the opening.
    if (sum < MIN_DEDUCTIBLE_SQFT * 2) continue;
    for (const group of list) {
      group.deductible = true;
      group.deduction_basis = 'siding_window_package';
    }
  }
}

function buildOpeningGroupsAndComponents(dedupedOpenings, smallOpeningsInWaste, minDeductibleSqft = MIN_DEDUCTIBLE_SQFT, standardSizeDeducts = false) {
  const deductibleFloor = Number(minDeductibleSqft) === 33 ? 33 : MIN_DEDUCTIBLE_SQFT;
  const groups = [];
  const components = [];

  dedupedOpenings.forEach((o, idx) => {
    // Deterministic ID derived from stable content (face/type/geometry/index).
    const gid = `og_${o.face}_${o.type}_${stableHash(
      `${o.physical_identity || `${o.face}|${o.type}|${o.width_ft}|${o.height_ft}|${o.pos_x}|${o.pos_y}|${idx}`}`,
    )}`;

    // A missing dimension is filled with a 3×5 window (15 sqft). That standard
    // unit deducts. A measured opening still needs 20 sqft, so a 19.95 sqft
    // window stays in waste. The 33 sqft control still means 33.
    const standardWindow = standardSizeDeducts
      && deductibleFloor !== 33
      && o.type === 'window'
      && Math.abs(num(o.width_ft) - 3) <= 0.25
      && Math.abs(num(o.height_ft) - 5) <= 0.25;
    const deductible = smallOpeningsInWaste ? true : (o.sqft >= deductibleFloor || standardWindow);

    const group = {
      id: gid,
      kind: 'rough_opening',
      face: o.face,
      type: o.type,
      material: o.material || null,
      // Deduction + J-channel ALWAYS use the group geometry below.
      width_ft: round(o.width_ft, 2),
      height_ft: round(o.height_ft, 2),
      area_sqft: round(o.sqft, 2),
      perimeter_lf: round(o.perimeter_lf, 2),
      zone: o.zone,
      pos_x: o.pos_x != null ? round(o.pos_x, 2) : null,
      pos_y: o.pos_y != null ? round(o.pos_y, 2) : null,
      position_unit: o.position_unit,
      at_grade: o.at_grade,
      deductible,
      component_ids: [],
      confidence: round(o.confidence, 3),
      unit_count: Math.max(0, Math.floor(num(o.unit_count))),
      provenance: { photo_index: o._photoIndex, observation_id: o.observation_id },
      uncertainty: o.synthetic ? 'count_based_default_geometry' : (o.occluded ? 'occluded_photo' : null),
    };

    // Explicit sub-components are represented separately — but never used for
    // deduction or J-channel math.
    if (Array.isArray(o.components) && o.components.length > 0) {
      o.components.forEach((c, ci) => {
        const cid = `oc_${gid}_${ci}`;
        const cw = num(c.width_ft ?? c.width);
        const ch = num(c.height_ft ?? c.height);
        components.push({
          id: cid,
          group_id: gid,
          type: resolveOpeningType(c.type || o.type),
          width_ft: round(cw, 2),
          height_ft: round(ch, 2),
          area_sqft: c.sqft != null ? round(c.sqft, 2) : round(cw * ch, 2),
          perimeter_lf:
            c.perimeter_lf != null ? round(c.perimeter_lf, 2) : round(2 * (cw + ch), 2),
        });
        group.component_ids.push(cid);
      });
    }
    groups.push(group);
  });

  return { groups, components };
}

function buildRoofFacets(roofFacets) {
  if (!Array.isArray(roofFacets)) return [];
  return roofFacets.map((f, i) => ({
    id: f.id != null ? `roof_${stableHash(String(f.id))}` : `roof_${i}`,
    area_sqft: round(f.area_sqft ?? f.area ?? 0, 2),
    pitch: f.pitch ?? f.pitch_degrees ?? null,
    azimuth: f.azimuth ?? f.azimuth_degrees ?? f.azimuthDegrees ?? null,
    // Geometry pass-through (added by roofFacetGeometry.js) — lets the 3D
    // renderer draw true facet polygons with classified ridge/hip/valley edges.
    ...(f.pitch_degrees != null ? { pitch_degrees: f.pitch_degrees } : {}),
    ...(f.azimuth_degrees != null ? { azimuth_degrees: f.azimuth_degrees } : {}),
    ...(Array.isArray(f.polygon) ? { polygon: f.polygon } : {}),
    ...(Array.isArray(f.edges) ? { edges: f.edges } : {}),
    ...(f.rise_ft != null ? { rise_ft: f.rise_ft } : {}),
    ...(f.provenance ? { provenance: f.provenance } : {}),
    ...(f.confidence != null ? { confidence: f.confidence } : {}),
  }));
}

const MASONRY_WALL_MATERIALS = new Set(['brick', 'stone']);

/**
 * Share of the perimeter whose photographed wall is brick or stone.
 * A wainscot under half the face is still a siding wall. Inferred faces
 * are not a material reading, so they do not add to the run.
 * Outside-corner counts do not use this fraction. A corner is billed only
 * where siding meets siding, so a mostly masonry wall is not rounded to zero.
 */
export function masonryWallFraction(materialMap, {
  perimeterFt = 0,
  buildingWidthFt = 0,
  buildingLengthFt = 0,
} = {}) {
  const faces = materialMap?.faces && typeof materialMap.faces === 'object'
    ? materialMap.faces
    : null;
  if (!faces) return 0;
  const widths = {
    front: num(buildingWidthFt),
    back: num(buildingWidthFt),
    left_side: num(buildingLengthFt),
    right_side: num(buildingLengthFt),
  };
  let masonryRun = 0;
  for (const [name, face] of Object.entries(faces)) {
    if (!face || face.inferred) continue;
    const width = widths[name] || 0;
    if (!(width > 0)) continue;
    const masonryPct = (face.regions || [])
      .filter((region) => MASONRY_WALL_MATERIALS.has(region.material))
      .reduce((sum, region) => sum + num(region.percent), 0);
    if (masonryPct >= 50) masonryRun += width;
  }
  const perimeter = num(perimeterFt);
  if (!(perimeter > 0) || !(masonryRun > 0)) return 0;
  return Math.min(1, masonryRun / perimeter);
}

function scaleMaterialFace(face, factor) {
  const prev = num(face.gross_wall_area_sqft);
  const next = round(prev * factor, 2);
  const applied = prev > 0 ? next / prev : 0;
  face.gross_wall_area_sqft = next;
  face.siding_area_sqft = round(num(face.siding_area_sqft) * applied, 2);
  face.excluded_area_sqft = round(num(face.excluded_area_sqft) * applied, 2);
  face.regions = (face.regions || []).map((region) => ({
    ...region,
    area_sqft: round(num(region.area_sqft) * applied, 2),
  }));
}

const MIN_FACE_AREA_SQFT = 56;
const OPPOSITE_WALL = {
  front: 'back',
  back: 'front',
  left_side: 'right_side',
  right_side: 'left_side',
  left: 'right',
  right: 'left',
};

function copyMaterialFace(target, source) {
  target.gross_wall_area_sqft = source.gross_wall_area_sqft;
  target.siding_area_sqft = source.siding_area_sqft;
  target.excluded_area_sqft = source.excluded_area_sqft;
  target.siding_percent = source.siding_percent;
  target.regions = (source.regions || []).map((region) => ({ ...region }));
  target.inferred = true;
  target.inference = target.inference || 'opposite_side';
}

/**
 * A face at 0, or under a real wall (8 ft by the 7 ft minimum eave), takes
 * half of the opposite face. The pair replaces that opposite, so the house
 * total does not grow by inventing a second wall.
 */
function restoreSliverMaterialFaces(faces) {
  if (!faces || typeof faces !== 'object') return;
  for (const name of Object.keys(faces)) {
    const face = faces[name];
    if (!face || num(face.gross_wall_area_sqft) >= MIN_FACE_AREA_SQFT) continue;
    const other = faces[OPPOSITE_WALL[name]];
    if (!other || num(other.gross_wall_area_sqft) < MIN_FACE_AREA_SQFT * 2) continue;
    scaleMaterialFace(other, 0.5);
    copyMaterialFace(face, other);
  }
}

function refreshMaterialMapRollups(materialMap) {
  const faceValues = Object.values(materialMap.faces || {});
  materialMap.siding_area_sqft = round(faceValues.reduce((sum, face) => sum + num(face.siding_area_sqft), 0), 2);
  materialMap.excluded_area_sqft = round(faceValues.reduce((sum, face) => sum + num(face.excluded_area_sqft), 0), 2);
  materialMap.unknown_area_sqft = round(faceValues.reduce(
    (sum, face) => sum + (face.regions || [])
      .filter((region) => region.material === 'unknown' || region.material === 'other')
      .reduce((inner, region) => inner + num(region.area_sqft), 0),
    0,
  ), 2);
}

/**
 * Make per-face gross areas add up to the headline wall total.
 * Extra area comes off inferred faces first. A map that already matches
 * is left alone, including its siding and masonry split.
 */
export function fitFacesToGross(materialMap, headlineGross) {
  if (!materialMap?.faces || typeof materialMap.faces !== 'object') return materialMap;
  const target = num(headlineGross);
  if (!(target > 0)) return materialMap;
  const faces = Object.values(materialMap.faces);
  const grossOf = (face) => num(face.gross_wall_area_sqft);
  let sum = faces.reduce((total, face) => total + grossOf(face), 0);
  if (Math.abs(sum - target) <= 1) return materialMap;

  const inferred = faces.filter((face) => face.inferred);
  const photoSum = faces.filter((face) => !face.inferred).reduce((total, face) => total + grossOf(face), 0);
  const inferredSum = inferred.reduce((total, face) => total + grossOf(face), 0);
  if (sum > target + 1 && inferredSum > 0) {
    const room = Math.max(0, target - photoSum);
    const factor = room / inferredSum;
    for (const face of inferred) {
      const next = grossOf(face) * factor;
      if (next >= MIN_FACE_AREA_SQFT) scaleMaterialFace(face, factor);
    }
  }

  sum = faces.reduce((total, face) => total + grossOf(face), 0);
  if (sum > target + 1 && sum > 0) {
    const factor = target / sum;
    for (const face of faces) {
      const next = grossOf(face) * factor;
      if (next >= MIN_FACE_AREA_SQFT) scaleMaterialFace(face, factor);
    }
  }

  sum = faces.reduce((total, face) => total + grossOf(face), 0);
  const residual = round(target - sum, 2);
  if (Math.abs(residual) >= 0.01 && residual < 0) {
    const host = [...faces].sort((a, b) => grossOf(b) - grossOf(a))[0];
    if (host && grossOf(host) + residual >= MIN_FACE_AREA_SQFT && grossOf(host) > 0) {
      scaleMaterialFace(host, (grossOf(host) + residual) / grossOf(host));
    }
  }
  restoreSliverMaterialFaces(materialMap.faces);
  refreshMaterialMapRollups(materialMap);
  return materialMap;
}

function faceIsConfirmed(face) {
  return face?.confirmed === true || face?.material_agreement?.billed_from === 'rep_confirmed';
}

/**
 * Gable and wrap that sit on the headline wall but not on a face used to
 * become siding: masonry was only the excluded area of the mapped faces, and
 * the gap was `gross - masonry`. A confirmed share applies to that gap in
 * the same proportion as the face it joins, so the gable is not a vinyl wall.
 */
function absorbUnsharedGross(materialMap, headline) {
  const faces = Object.values(materialMap?.faces || {});
  if (!faces.length || !faces.some(faceIsConfirmed)) return;
  const sum = faces.reduce((total, face) => total + num(face.gross_wall_area_sqft), 0);
  if (!(sum > 0) || !(headline > sum + 1)) return;
  const residual = headline - sum;
  for (const face of faces) {
    const prev = num(face.gross_wall_area_sqft);
    if (!(prev > 0)) continue;
    scaleMaterialFace(face, (prev + residual * (prev / sum)) / prev);
  }
  refreshMaterialMapRollups(materialMap);
}

/**
 * The billed net is the wall on the report minus the masonry on the report
 * minus the siding openings on the report. Fitting the material map down to
 * the footprint cap used to leave the net on the larger photo wall, so a
 * 4805 sqft wall with 1664 sqft of masonry and 571 sqft of openings billed
 * 2928. Masonry is reread from the fitted faces, then the three published
 * integers are forced to add up.
 */
export function applyBilledWallIdentity(graph, billedGross) {
  const totals = graph?.totals;
  if (!totals) return graph;
  const gross = Math.round(
    Number(billedGross) > 0 ? Number(billedGross) : Number(totals.gross_wall_area_sqft) || 0,
  );
  absorbUnsharedGross(graph?.material_map, gross);
  const faces = Object.values(graph?.material_map?.faces || {});
  let masonry = faces.length
    ? Math.round(faces.reduce((sum, face) => sum + num(face.excluded_area_sqft), 0))
    : Math.round(num(totals.masonry_area_sqft));
  if (masonry < 0) masonry = 0;
  if (gross > 0 && masonry > gross) masonry = gross;
  let openings = Math.round(num(totals.opening_deduction_sqft));
  if (openings < 0) openings = 0;
  const siding = Math.max(0, gross - masonry);
  if (openings > siding) openings = siding;
  const net = siding - openings;
  totals.gross_wall_area_sqft = gross;
  totals.masonry_area_sqft = masonry;
  totals.excluded_material_area_sqft = masonry;
  totals.siding_facade_area_sqft = siding;
  totals.siding_material_area_sqft = siding;
  totals.opening_deduction_sqft = openings;
  totals.net_siding_area_sqft = net;
  totals.siding_share_pct = gross > 0 ? round((siding / gross) * 100, 1) : 0;
  if (graph.reconciliation) {
    graph.reconciliation = {
      ...graph.reconciliation,
      consistent: true,
      assertion: 'net = wall - masonry - siding openings',
      expected_net_siding_area_sqft: net,
      actual_net_siding_area_sqft: net,
      difference: 0,
      issues: (graph.reconciliation.issues || []).filter((issue) => issue.code !== 'net_area_mismatch'),
    };
  }
  return graph;
}

function openingInterruptsStarter(group) {
  if (group.type !== 'garage_door' && group.type !== 'entry_door') return false;
  if (group.at_grade === false && group.type === 'garage_door') return false;
  if (group.type === 'garage_door' || group.at_grade === true) return true;
  // An entry door whose sill sits on the ground breaks the starter the same
  // way a garage door does. A door with no sill position stays on the run.
  if (group.pos_y == null || !(num(group.height_ft) > 0)) return false;
  const sillFt = num(group.pos_y) - num(group.height_ft) / 2;
  return sillFt <= 1;
}

function roofWallLineLf(roofFacets) {
  const edges = computeEdgeTotals(Array.isArray(roofFacets) ? roofFacets : []);
  return round(num(edges.eave) + num(edges.rake), 2);
}

function buildTrimEdges(groups, perimeterFt, roofFacets, masonryFraction = 0) {
  // J-channel: once per unique rough-opening GROUP perimeter (never summed
  // components, never once per photo), plus the roof-wall line once. Garage
  // doors are open at grade, so only the head + two jambs are exposed.
  const openingLf = round(
    groups.reduce(
      (s, g) => s + (
        g.type === 'garage_door'
          ? num(g.width_ft) + (2 * num(g.height_ft))
          : num(g.perimeter_lf)
      ),
      0,
    ),
    2,
  );
  const roofWallLf = roofWallLineLf(roofFacets);
  const jChannelLf = round(openingLf + roofWallLf, 2);
  // Starter strip runs along the siding at grade. The masonry fraction here is
  // only the width of a brick or stone polygon that covers the full wall
  // height. A foundation band or a wainscot does not remove starter. A garage
  // door, and an entry door whose sill is at grade, interrupt that run by their
  // rough width.
  const gradeOpenings = groups.filter(openingInterruptsStarter);
  const garageOpeningsAtGrade = gradeOpenings.filter((g) => g.type === 'garage_door');
  const excludedGarageWidthLf = round(
    garageOpeningsAtGrade.reduce((sum, g) => sum + num(g.width_ft), 0),
    2,
  );
  const excludedGradeWidthLf = round(
    gradeOpenings.reduce((sum, g) => sum + num(g.width_ft), 0),
    2,
  );
  const fraction = Math.max(0, Math.min(1, num(masonryFraction)));
  const sidingPerimeter = num(perimeterFt) * (1 - fraction);
  return {
    j_channel: {
      lf: jChannelLf,
      openings_lf: openingLf,
      roof_wall_lf: roofWallLf,
      basis: roofWallLf > 0 ? 'openings_plus_roof_wall' : 'rough_opening_group_perimeter',
      group_count: groups.length,
    },
    starter_strip: {
      lf: round(Math.max(0, sidingPerimeter - excludedGradeWidthLf), 2),
      basis: fraction > 0
        ? 'siding_perimeter_minus_masonry_and_grade_openings'
        : 'building_perimeter_minus_grade_openings',
      excluded_garage_width_lf: excludedGarageWidthLf,
      excluded_garage_opening_count: garageOpeningsAtGrade.length,
      excluded_grade_width_lf: excludedGradeWidthLf,
      excluded_grade_opening_count: gradeOpenings.length,
      masonry_fraction: fraction,
      excluded_masonry_lf: round(num(perimeterFt) * fraction, 2),
    },
  };
}

/**
 * Group window rough-openings into mulled BANKS for counting purposes only.
 * Returns an array of banks, each `{ face, member_ids }`. Deduction geometry
 * is never derived from a bank — see the MULLION_* constants for why.
 */
function bankWindowGroups(windowGroups) {
  const byFace = new Map();
  for (const g of windowGroups) {
    if (!byFace.has(g.face)) byFace.set(g.face, []);
    byFace.get(g.face).push(g);
  }
  const banks = [];
  const orderedFaces = [...WALL_FACES, UNKNOWN_FACE].filter((f) => byFace.has(f));

  for (const face of orderedFaces) {
    const ordered = byFace.get(face).slice().sort((a, b) => (
      (num(a.pos_x) - num(b.pos_x)) || String(a.id).localeCompare(String(b.id))
    ));
    let current = null;
    for (const g of ordered) {
      // Count-based synthetic openings all carry the same default geometry and
      // no real position, so they can never prove a mullion. Positions given as
      // fractions cannot be turned into a gap in feet either.
      const bankable = g.uncertainty !== 'count_based_default_geometry'
        && g.pos_x != null && g.pos_y != null
        && g.position_unit !== 'fraction'
        && num(g.width_ft) > 0 && num(g.height_ft) > 0;

      if (current && current.bankable && bankable) {
        const last = current.last;
        const gapFt = (num(g.pos_x) - num(g.width_ft) / 2)
          - (num(last.pos_x) + num(last.width_ft) / 2);
        const sameHeight = Math.abs(num(g.height_ft) - num(last.height_ft)) <= MULLION_HEIGHT_TOL_FT;
        const aligned = Math.abs(num(g.pos_y) - num(last.pos_y)) <= MULLION_ALIGN_TOL_FT;
        if (sameHeight && aligned && gapFt <= MULLION_GAP_TOL_FT) {
          current.member_ids.push(g.id);
          current.last = g;
          continue;
        }
      }
      current = { face, bankable, member_ids: [g.id], last: g };
      banks.push(current);
    }
  }
  return banks.map(({ face, member_ids }) => ({ face, member_ids }));
}

function buildCounts(groups, components) {
  const roughOpenings = groups.length;

  const windowGroups = groups.filter((g) => g.type === 'window');
  // Assembly banking is descriptive only. The authoritative customer-facing
  // count remains individual window units below.
  const windowBanks = bankWindowGroups(windowGroups);
  const windowAssemblies = windowBanks.length;
  // A window "unit" is a distinct sash: components when present, else 1/group.
  const windowUnits = windowGroups.reduce((s, g) => s + unitsInWindowGroup(g, components), 0);

  return {
    window_assemblies: windowAssemblies,
    window_units: windowUnits,
    window_rough_openings: windowGroups.length,
    // How many separate rough openings are represented by the assembly view.
    // This is descriptive only; window_units/windows_count remain individual.
    window_mullion_merges: Math.max(0, windowGroups.length - windowAssemblies),
    window_banks: windowBanks,
    entry_doors: groups.filter((g) => g.type === 'entry_door').length,
    garage_doors: groups.filter((g) => g.type === 'garage_door').length,
    vents: groups.filter((g) => g.type === 'vent').length,
    rough_openings: roughOpenings,
    // Public/legacy window count is intentionally individual units. Assembly
    // banking remains available above for reporting, but must not collapse a
    // property's actual window count.
    windows_count: windowUnits,
    by_face: WALL_FACES.reduce((acc, face) => {
      const onFace = groups.filter((group) => group.face === face);
      acc[face] = {
        windows: onFace.filter((group) => group.type === 'window').length,
        doors: onFace.filter((group) => group.type === 'entry_door' || group.type === 'slider_door').length,
        garage_doors: onFace.filter((group) => group.type === 'garage_door').length,
      };
      return acc;
    }, {}),
  };
}

function buildCoverage(perPhotoResults, wallFacets, multiViewEvidence) {
  const required = ['front', 'back', 'left_side', 'right_side'];
  const warnings = [...(multiViewEvidence?.warnings || [])];
  const panoramaSeen = new Map();
  let lowConfidenceCount = 0;
  let occludedCount = 0;
  let unknownFacetCount = 0;
  let referenceOnlyCount = 0;

  perPhotoResults.forEach((r, i) => {
    const evidence = evidenceForResult(r);
    const face = resultFace(r);
    const conf = photoConfidence(r);
    const sourceType = String(r.source_type || r.sourceType || '').toLowerCase();
    const isStreetView = sourceType === 'street_view';
    const verifiedElevation = !!(r.verified_elevation ?? r.verifiedElevation);
    const referenceOnly = isStreetView && !verifiedElevation;

    if (referenceOnly) {
      referenceOnlyCount++;
      warnings.push({
        code: 'reference_only_photo',
        photo_index: i,
        message: `Photo ${i} is street_view (reference only) — not counted as elevation coverage.`,
      });
    }

    if (face === UNKNOWN_FACE || !evidence?.faces?.length) {
      unknownFacetCount++;
      if (!evidence?.warnings?.some(w => w.photo_index === i && w.code === 'unresolved_photo_face')) {
        warnings.push({
          code: 'unknown_facet_assignment',
          photo_index: i,
          message: `Photo ${i} could not be assigned to a wall face.`,
        });
      }
    }

    if (conf < 0.5) {
      lowConfidenceCount++;
      warnings.push({
        code: 'low_confidence_photo',
        photo_index: i,
        confidence: round(conf, 3),
        message: `Photo ${i} has low confidence (${round(conf, 3)}).`,
      });
    }
    if (r.occluded) {
      occludedCount++;
      warnings.push({
        code: 'occluded_photo',
        photo_index: i,
        message: `Photo ${i} is occluded.`,
      });
    }

    const panoId = r.panorama_id ?? r.panoramaId ?? r.pano_id;
    if (panoId != null) {
      const key = String(panoId);
      panoramaSeen.set(key, (panoramaSeen.get(key) || 0) + 1);
    }
  });

  for (const [panoId, count] of panoramaSeen.entries()) {
    if (count > 1) {
      warnings.push({
        code: 'duplicate_panorama',
        panorama_id: panoId,
        count,
        message: `Panorama ${panoId} reused across ${count} photos.`,
      });
    }
  }

  const covered = multiViewEvidence?.covered_faces
    || required.filter(face => wallFacets.some(facet => facet.face === face));
  const missing = multiViewEvidence?.missing_faces
    || required.filter(face => !covered.includes(face));
  for (const f of missing) {
    warnings.push({
      code: 'missing_elevation',
      face: f,
      message: `Missing elevation coverage for ${f}.`,
    });
  }

  let status = multiViewEvidence?.status
    || (missing.length === required.length ? 'incomplete' : missing.length > 0 ? 'review_required' : 'complete');
  if (lowConfidenceCount > 0 || occludedCount > 0 || unknownFacetCount > 0 ||
      referenceOnlyCount > 0 || (multiViewEvidence?.contradictions?.length || 0) > 0) {
    status = 'review_required';
  }

  const coverageRatio = (required.length - missing.length) / required.length;
  const penalty = Math.min(
    0.5,
    0.1 * (lowConfidenceCount + occludedCount + unknownFacetCount),
  );
  const confidence = round(
    clamp01(Math.min(multiViewEvidence?.confidence ?? 1, coverageRatio) - penalty),
    3,
  );

  return {
    status,
    confidence,
    review_required: status !== 'complete',
    required_faces: required,
    covered_faces: [...covered].sort(),
    missing_faces: missing,
    per_face: multiViewEvidence?.faces || [],
    photo_evidence: multiViewEvidence?.photos || [],
    unresolved_photos: multiViewEvidence?.unresolved_photos || [],
    duplicate_photos: multiViewEvidence?.duplicate_photos || [],
    rejected_observations: multiViewEvidence?.rejected_observations || [],
    duplicates_removed: multiViewEvidence?.duplicates_removed || 0,
    contradictions: multiViewEvidence?.contradictions || [],
    next_recommended_photos: multiViewEvidence?.next_recommended_photos || [],
    reference_only_photos: referenceOnlyCount,
    low_confidence_photos: lowConfidenceCount,
    occluded_photos: occludedCount,
    unknown_facet_photos: unknownFacetCount,
    warnings,
  };
}

function photographedMaterialMix(faces) {
  const totals = new Map();
  let basis = 0;
  for (const item of Object.values(faces)) {
    if (!item || item.inferred || !(num(item.gross_wall_area_sqft) > 0)) continue;
    const gross = num(item.gross_wall_area_sqft);
    basis += gross;
    // A traced region stays on the face it was drawn on. The house mix uses
    // the labeled share, so one full-frame trace cannot clad every wall.
    const mixRegions = Array.isArray(item.share_regions) && item.share_regions.length
      ? item.share_regions
      : (item.regions || []);
    for (const region of mixRegions) {
      totals.set(
        region.material,
        (totals.get(region.material) || 0) + gross * num(region.percent) / 100,
      );
    }
  }
  if (!(basis > 0) || totals.size === 0) return null;
  return [...totals.entries()].map(([material, area]) => ({
    material,
    percent: round((area / basis) * 100, 2),
  }));
}

function regionsFromConfirmedShares(shares) {
  const stone = Number(shares?.stone) || 0;
  const stucco = Number(shares?.stucco) || 0;
  const brick = Number(shares?.brick) || 0;
  const namedSiding = Number(shares?.siding);
  const regions = [];
  if (stone > 0) regions.push({ material: 'stone', percent: round(stone, 2) });
  if (stucco > 0) regions.push({ material: 'stucco', percent: round(stucco, 2) });
  if (brick > 0) regions.push({ material: 'brick', percent: round(brick, 2) });
  const sidingPct = Number.isFinite(namedSiding) ? namedSiding : Math.max(0, 100 - stone - stucco - brick);
  if (sidingPct > 0) regions.push({ material: 'lap_siding', percent: round(sidingPct, 2) });
  if (!regions.length) regions.push({ material: 'lap_siding', percent: 100 });
  return regions;
}

function classificationIsConfirmed(classification) {
  return classification?.confirmed === true || classification?.billed_from === 'rep_confirmed';
}

function agreementForInferredFace(classification) {
  if (!classification?.shares) return null;
  const billed = billedFromFaceClassification(classification, null);
  const count = Number(classification.photo_count) || 0;
  const confirmed = classificationIsConfirmed(classification);
  const agreement = {
    ...billed.agreement,
    photo_count: count,
    reasons: [...(billed.agreement.reasons || [])],
    billed_from: confirmed ? 'rep_confirmed' : (billed.agreement.billed_from || 'face_sample_median'),
  };
  // A rep confirmation is the bill. "0 photos" is not a review flag on a
  // face the rep already signed, including a wall the footprint inferred.
  if (confirmed) {
    agreement.low_confidence = false;
    agreement.reasons = agreement.reasons.filter((reason) => !/only \d+ photos?/.test(reason));
    return agreement;
  }
  if (count < 3) {
    agreement.low_confidence = true;
    agreement.reasons.push(`only ${count} photo${count === 1 ? '' : 's'} of this face (need 3)`);
  }
  return agreement;
}

function buildMaterialMap(wallFacets, agg, perPhotoResults = []) {
  const hasMaterialEvidence = wallFacets.some((facet) =>
    Array.isArray(facet.material_regions) && facet.material_regions.length > 0
    || facet.siding_material
    || facet.non_siding_material
    || facet.accent_material,
  );
  // Legacy graph callers may have no material observations at all. In that
  // case preserve the prior gross-minus-accent contract rather than turning
  // unobserved walls into an artificial 0-siding material map.
  if (!hasMaterialEvidence) return null;

  const defaultWidths = {
    front: num(agg.buildingWidthFt),
    back: num(agg.buildingWidthFt),
    left_side: num(agg.buildingLengthFt),
    right_side: num(agg.buildingLengthFt),
  };
  const faces = {};

  for (const facet of wallFacets.filter((item) => !item.is_unknown)) {
    // Estimated windows open a facet for a wall that has no photos. That
    // facet has no material. Leave it for the house-mix fallback below.
    // Billing it here made the whole wall "unknown" and dropped its corners.
    if (!(num(facet.photo_count) > 0)) continue;
    const width = num(facet.wall_width_ft) || defaultWidths[facet.face] || 0;
    const eaveHeight = num(facet.eave_height_ft)
      || num(facet.wall_height_ft)
      || num(agg.wallHeightFt);
    const gableRise = Math.max(0, num(facet.gable_rise_ft));
    // Match buildPhotoWallArea exactly: a full-height photo plane is one
    // rectangle plus one gable triangle. Never multiply this by story_count;
    // photo height is already grade-to-eave for the visible elevation.
    // A garage wing or a narrow gable does not lend its eave and rise to
    // the rest of the footprint edge.
    const footprintWidth = num(agg.faceWidthsFt?.[facet.face]) || defaultWidths[facet.face] || 0;
    const anchoredWidth = num(agg.faceWidthsFt?.[facet.face]);
    const faceEave = num(agg.faceEaveFt?.[facet.face]) || num(agg.wallHeightFt);
    const portion = anchoredWidth > 0 ? null : partialFacadePortion(facet, footprintWidth);
    let gross;
    if (anchoredWidth > 0 && faceEave > 0) {
      gross = round(anchoredWidth * faceEave + Math.max(0, num(agg.gableByFace?.[facet.face])), 2);
    } else if (portion && (footprintWidth > 0 || width > 0)) {
      const billedWidth = footprintWidth > 0 ? footprintWidth : portion.portion;
      const rest = Math.max(0, billedWidth - portion.portion);
      const portionHeight = portion.wing && eaveHeight > 0 ? eaveHeight : num(agg.wallHeightFt) || eaveHeight;
      const gableWidth = portion.narrowGable || rest < 0.5 ? portion.portion : 0;
      gross = round(
        portion.portion * portionHeight + rest * (num(agg.wallHeightFt) || portionHeight) + (gableWidth * gableRise) / 2,
        2,
      );
    } else {
      gross = round(width * eaveHeight + (width * gableRise) / 2, 2);
    }
    const explicitRegions = Array.isArray(facet.material_regions)
      ? facet.material_regions : [];
    const regions = [];
    let uncertain = facet.material_uncertain === true;

    if (explicitRegions.length > 0) {
      let specified = 0;
      for (const raw of explicitRegions) {
        const rawPercent = raw?.percent ?? raw?.percentage ?? raw?.pct ?? raw?.area_percent;
        const percent = Number.isFinite(Number(rawPercent))
          ? Math.max(0, Math.min(100, Number(rawPercent))) : null;
        const category = normalizeMaterialCategory(
          raw?.material ?? raw?.category ?? raw?.type,
          facet.siding_profile,
        );
        if (percent == null) {
          uncertain = true;
          continue;
        }
        specified += percent;
        regions.push({ material: category, percent });
      }
      if (specified < 99.5) {
        regions.push({ material: 'unknown', percent: round(100 - specified, 2) });
        uncertain = true;
      } else if (specified > 100.5) {
        const scale = 100 / specified;
        regions.forEach((region) => { region.percent = round(region.percent * scale, 2); });
      }
    } else {
      const sidingCategory = facet.siding_material
        ? normalizeMaterialCategory(facet.siding_material, facet.siding_profile) : null;
      const accentCategory = facet.non_siding_material
        ? normalizeMaterialCategory(facet.non_siding_material)
        : (facet.accent_material ? normalizeMaterialCategory(facet.accent_material) : null);
      const nonSidingPct = finiteMasonryPct(facet.non_siding_pct);

      if (sidingCategory && materialIsSiding(sidingCategory)) {
        const sidingPct = nonSidingPct == null ? 100 : 100 - nonSidingPct;
        if (sidingPct > 0) regions.push({ material: sidingCategory, percent: round(sidingPct, 2) });
      } else if (sidingCategory && sidingCategory !== 'unknown') {
        const masonryLabel = sidingCategory === 'brick' || sidingCategory === 'stone';
        const clearFullMasonry = masonryLabel
          && nonSidingPct == null
          && facet.material_uncertain !== true
          && facet.has_mixed_materials !== true;
        if (masonryLabel && nonSidingPct == null && !clearFullMasonry) {
          regions.push({ material: 'lap_siding', percent: 100 });
          uncertain = true;
        } else {
          regions.push({
            material: sidingCategory,
            percent: nonSidingPct == null ? 100 : round(nonSidingPct, 2),
          });
        }
      }
      if (accentCategory && accentCategory !== 'unknown' && nonSidingPct > 0
          && !regions.some((region) => region.material === accentCategory)) {
        regions.push({ material: accentCategory, percent: round(nonSidingPct, 2) });
      }
      const represented = regions.reduce((sum, region) => sum + region.percent, 0);
      if (represented < 99.5) {
        regions.push({ material: 'unknown', percent: round(100 - represented, 2) });
        uncertain = true;
      }
      if (regions.length === 0) {
        regions.push({ material: 'unknown', percent: 100 });
        uncertain = true;
      }
    }

    const sidingPercent = round(
      regions
        .filter((region) => materialIsSiding(region.material))
        .reduce((sum, region) => sum + region.percent, 0),
      2,
    );
    const normalizedRegions = regions.map((region) => ({
      ...region,
      area_sqft: round(gross * region.percent / 100, 2),
      included_in_siding_sq: materialIsSiding(region.material),
    }));
    const shareSource = Array.isArray(facet.share_regions) && facet.share_regions.length
      ? facet.share_regions
      : regions;
    const shareRegions = shareSource.map((region) => ({
      material: region.material,
      percent: region.percent,
    }));
    faces[facet.face] = {
      face: facet.face,
      gross_wall_area_sqft: gross,
      regions: normalizedRegions,
      share_regions: shareRegions,
      siding_percent: sidingPercent,
      siding_area_sqft: round(gross * sidingPercent / 100, 2),
      excluded_area_sqft: round(gross * (100 - sidingPercent) / 100, 2),
      material_confidence: facet.material_confidence ?? facet.confidence ?? null,
      uncertain,
      photo_count: facet.photo_count || 0,
      material_agreement: facet.material_agreement || null,
      sections: Array.isArray(facet.sections) ? facet.sections : [],
    };
  }

  const oppositeWall = {
    front: 'back', back: 'front', left_side: 'right_side', right_side: 'left_side',
  };
  const facetWidth = (name) => {
    const facet = wallFacets.find((item) => item.face === name && !item.is_unknown);
    return num(facet?.wall_width_ft) || defaultWidths[name] || 0;
  };
  for (const face of WALL_FACES) {
    const existing = faces[face];
    if (existing && existing.gross_wall_area_sqft > 0) continue;
    let width = defaultWidths[face] || facetWidth(face);
    let inference = 'footprint_x_height';
    if (num(agg.faceWidthsFt?.[face]) > 0) {
      width = num(agg.faceWidthsFt[face]);
      inference = 'footprint_edge';
    } else if (!(width > 0)) {
      width = defaultWidths[oppositeWall[face]] || facetWidth(oppositeWall[face]);
      inference = 'opposite_side';
    }
    const height = num(agg.faceEaveFt?.[face]) || num(agg.wallHeightFt);
    if (!(width > 0) || !(height > 0)) continue;
    const gross = round(width * height + Math.max(0, num(agg.gableByFace?.[face])), 2);
    // The house-wide mix, not the opposite wall and not 0. A missing photo
    // is not evidence that the wall is all siding, and copying one brick
    // elevation onto the unseen side is what swung the masonry between runs.
    // The classifier may still have counted this face from corner photos.
    // Report that count. Billing stays on the house mix: a corner-only left
    // wall read as 100% siding is not a measurement of that wall.
    const classified = classificationForFace(perPhotoResults, face);
    const classifiedAgreement = agreementForInferredFace(classified);
    const confirmed = classificationIsConfirmed(classified);
    // Confirmed shares bill on a wall with no photo. The house mix is only
    // the fallback when nobody has confirmed this face.
    const sourceRegions = confirmed
      ? regionsFromConfirmedShares(classified.shares)
      : (photographedMaterialMix(faces) || [{ material: 'unknown', percent: 100 }]);
    const regions = sourceRegions.map((region) => ({
      material: region.material,
      percent: region.percent,
      area_sqft: round(gross * num(region.percent) / 100, 2),
      included_in_siding_sq: materialIsSiding(region.material),
    }));
    const sidingPercent = round(
      regions
        .filter((region) => materialIsSiding(region.material))
        .reduce((sum, region) => sum + num(region.percent), 0),
      2,
    );
    faces[face] = {
      face,
      gross_wall_area_sqft: gross,
      regions,
      siding_percent: sidingPercent,
      siding_area_sqft: round(gross * sidingPercent / 100, 2),
      excluded_area_sqft: round(gross * (100 - sidingPercent) / 100, 2),
      material_confidence: confirmed ? 1 : null,
      uncertain: !confirmed,
      inferred: true,
      inference,
      photo_count: classifiedAgreement ? classifiedAgreement.photo_count : 0,
      material_agreement: classifiedAgreement || {
        photo_count: 0,
        vote_count: 0,
        spread_points: 0,
        spread_by_material: { stone: 0, stucco: 0, brick: 0, siding: 0 },
        low_confidence: true,
        reasons: ['only 0 photos of this face (need 3)'],
      },
    };
  }

  const anchoredFaces = agg.faceWidthsFt
    && WALL_FACES.every((face) => num(agg.faceWidthsFt[face]) > 0);
  const prism = anchoredFaces ? 0 : num(agg.perimeterFt) * num(agg.wallHeightFt);
  const photographedGross = Object.values(faces)
    .filter((face) => !face.inferred)
    .reduce((sum, face) => sum + num(face.gross_wall_area_sqft), 0);
  const inferredFaces = Object.values(faces).filter((face) => face.inferred);
  const inferredGross = inferredFaces.reduce((sum, face) => sum + num(face.gross_wall_area_sqft), 0);
  const inferredBudget = prism > 0 ? Math.max(0, prism - photographedGross) : inferredGross;
  if (inferredGross > inferredBudget + 0.5 && inferredGross > 0) {
    const scale = inferredBudget / inferredGross;
    for (const face of inferredFaces) {
      const next = num(face.gross_wall_area_sqft) * scale;
      if (next < MIN_FACE_AREA_SQFT) continue;
      face.gross_wall_area_sqft = round(next, 2);
      face.siding_area_sqft = round(num(face.siding_area_sqft) * scale, 2);
      face.excluded_area_sqft = round(num(face.excluded_area_sqft) * scale, 2);
      face.regions = (face.regions || []).map((region) => ({
        ...region,
        area_sqft: round(num(region.area_sqft) * scale, 2),
      }));
    }
  }
  restoreSliverMaterialFaces(faces);

  const faceValues = Object.values(faces);
  const classificationComplete = WALL_FACES.every((face) => faces[face])
    && faceValues.every((face) => !face.uncertain);
  const materialReviewFlags = faceValues
    .filter((face) => face.material_agreement?.low_confidence)
    .map((face) => ({
      face: face.face,
      photo_count: face.material_agreement.photo_count,
      spread_points: face.material_agreement.spread_points,
      low_confidence: true,
      reasons: face.material_agreement.reasons || [],
      message: `${String(face.face).replace(/_/g, ' ')}: ${(face.material_agreement.reasons || []).join('; ')}`,
    }));
  return {
    version: 1,
    faces,
    required_faces: WALL_FACES,
    covered_faces: Object.keys(faces).sort(),
    complete: classificationComplete,
    review_required: !classificationComplete || materialReviewFlags.length > 0,
    material_review_flags: materialReviewFlags,
    agreement_review_required: materialReviewFlags.length > 0,
    siding_area_sqft: round(faceValues.reduce((sum, face) => sum + face.siding_area_sqft, 0), 2),
    excluded_area_sqft: round(faceValues.reduce((sum, face) => sum + face.excluded_area_sqft, 0), 2),
    unknown_area_sqft: round(faceValues.reduce(
      (sum, face) => sum + face.regions
        .filter((region) => region.material === 'unknown' || region.material === 'other')
        .reduce((inner, region) => inner + region.area_sqft, 0),
      0,
    ), 2),
    siding_categories: [...SIDING_MATERIAL_CATEGORIES],
  };
}

function buildTotals(agg, groups, components, trim, counts) {
  // ── Hero wall area: photo heights on footprint lengths ────────────────────
  // The traced perimeter stays the horizontal measure. Photos replace the
  // aggregate height, gable, openings and material on the walls whose photo
  // width agrees with that wall's footprint edge. The extrusion remains the
  // cross-check and the fallback when a photo scale misses by more than 15%.
  const extrusionGross = round(num(agg.grossWallAreaSqft), 2);
  const photoWallArea = agg.photoWallArea && typeof agg.photoWallArea === 'object'
    ? agg.photoWallArea : null;
  const usePhotoHero = photoWallArea?.usable === true && num(photoWallArea.area_sqft) > 0;
  const wallCap = num(agg.perimeterFt) > 0 && num(agg.wallHeightFt) > 0
    ? num(agg.perimeterFt) * num(agg.wallHeightFt) * 1.1
    : 0;
  let gross = usePhotoHero ? round(num(photoWallArea.area_sqft), 2) : extrusionGross;
  if (wallCap > 0 && gross > wallCap) gross = round(wallCap, 2);
  const grossSource = usePhotoHero
    ? (photoWallArea?.lengths_anchored === true ? 'photo_anchored_footprint' : 'photo_wall_planes')
    : 'footprint_extrusion';
  const measuredFaceCount = photoWallArea?.measured_faces?.length || 0;
  const wallTotalQuality = usePhotoHero
    && measuredFaceCount >= 4
    && photoWallArea?.perimeter_flagged !== true
    && (photoWallArea?.width_fallback_faces?.length || 0) === 0
    ? 'measured'
    : 'estimated';
  const accent = round(num(agg.accentDeductionSqft), 2);
  const materialMap = agg.materialMap && typeof agg.materialMap === 'object'
    ? agg.materialMap : null;
  const materialFaces = materialMap?.faces && typeof materialMap.faces === 'object'
    ? Object.values(materialMap.faces) : [];
  const materialGross = round(materialFaces.reduce(
    (sum, face) => sum + num(face.gross_wall_area_sqft), 0,
  ), 2);
  const materialSiding = round(materialFaces.reduce(
    (sum, face) => sum + num(face.siding_area_sqft), 0,
  ), 2);
  // Photo face dimensions can cover only the measured wall prism. Scale the
  // split once to the canonical gross area instead of silently inventing
  // siding on masonry or unclassified faces.
  // A map that holds more wall than the canonical prism (overlapping or
  // over-scaled photos) is also fitted down, even when it is incomplete.
  // Billing its raw siding total charged siding on area that is not on the
  // house (Malec: 5520 sqft of mapped wall on a 4014 sqft prism). Stone,
  // stucco and brick come off in the same proportion. An incomplete map that
  // is short of the prism is never scaled up, so no siding is invented.
  const materialScale = gross > 0 && materialGross > 0
    && (materialMap?.complete === true || materialGross > gross + 1)
    ? gross / materialGross : 1;

  // ── Siding vs. masonry columns ────────────────────────────────────────────
  // `gross` is the whole wall prism (every exterior surface). `accent` is the
  // portion clad in brick/stone/other non-siding material. What is left is the
  // siding facade — the only column siding openings may be deducted from.
  let sidingFacade = materialFaces.length > 0
    ? round(Math.max(0, materialSiding * materialScale), 2)
    : round(Math.max(0, gross - accent), 2);
  if (wallCap > 0 && sidingFacade > wallCap) sidingFacade = round(wallCap, 2);
  // With no positive facade there is no siding column to charge openings to.
  // Defaulting the share to 1 here would report a 100 %-siding house that has
  // zero siding area, and would push every opening into a column that does not
  // exist.
  const sidingShare = gross > 0 && sidingFacade > 0 ? clamp01(sidingFacade / gross) : 0;

  // ── Per-material opening allocation ───────────────────────────────────────
  // A window cut into a brick wall reduces the BRICK area, not the siding area.
  // Deducting every opening from the siding column is a category error that
  // collapses the result on masonry-heavy homes (a 70 %-brick house would have
  // ~70 % of its openings wrongly charged against the remaining 30 % of wall).
  // Each opening is therefore attributed to its own face's material mix when a
  // per-face breakdown is available, and to the house-wide siding share when it
  // is not.
  const faceMasonryPct = agg.faceMasonryPct && typeof agg.faceMasonryPct === 'object'
    ? agg.faceMasonryPct
    : null;
  const sidingFractionForFace = (face) => {
    const materialFace = materialMap?.faces?.[face];
    if (materialFace && Number.isFinite(Number(materialFace.siding_percent))) {
      return clamp01(Number(materialFace.siding_percent) / 100);
    }
    const pct = faceMasonryPct && face != null ? faceMasonryPct[face] : undefined;
    if (pct == null || !Number.isFinite(Number(pct))) return sidingShare;
    return clamp01(1 - Number(pct) / 100);
  };
  // A tagged opening comes out of the material it sits in. An opening in
  // siding reduces siding; one in stone, stucco, or brick does not.
  const sidingFractionForOpening = (group) => {
    const tagged = openingMaterialName(group?.material);
    if (tagged === 'siding') return 1;
    if (tagged === 'stone' || tagged === 'stucco' || tagged === 'brick' || tagged === 'trim') return 0;
    return sidingFractionForFace(group?.face);
  };

  const deductible = groups.filter((g) => g.deductible);
  // A face cannot be more opening than wall. Twice-counted windows on
  // overlapping photos blow past this; the excess is flagged, not silent.
  const MAX_FACE_OPENING_RATIO = 0.45;
  const openingScale = {};
  const openingReviewFlags = [];
  const openingAreaByFace = new Map();
  for (const group of deductible) {
    openingAreaByFace.set(group.face, (openingAreaByFace.get(group.face) || 0) + num(group.area_sqft));
  }
  for (const [face, area] of openingAreaByFace) {
    const faceGross = num(materialMap?.faces?.[face]?.gross_wall_area_sqft);
    if (!(faceGross > 0) || !(area > 0)) continue;
    const ratio = area / faceGross;
    if (ratio <= MAX_FACE_OPENING_RATIO) continue;
    openingScale[face] = (faceGross * MAX_FACE_OPENING_RATIO) / area;
    openingReviewFlags.push({
      face,
      code: 'opening_area_capped',
      opening_area_sqft: round(area, 2),
      cap_sqft: round(faceGross * MAX_FACE_OPENING_RATIO, 2),
      ratio: round(ratio, 3),
      max_ratio: MAX_FACE_OPENING_RATIO,
    });
  }
  const scaledOpeningArea = (group) => num(group.area_sqft) * (openingScale[group.face] ?? 1);
  const openingAreaTotal = round(deductible.reduce((s, g) => s + scaledOpeningArea(g), 0), 2);
  const rawSidingOpening = round(
    deductible.reduce((s, g) => s + scaledOpeningArea(g) * sidingFractionForOpening(g), 0),
    2,
  );
  const openingMasonry = round(Math.max(0, openingAreaTotal - rawSidingOpening), 2);

  // Sanity cap, now dimensionally correct: openings charged to the siding column
  // cannot exceed 25 % of the SIDING facade (previously 25 % of the whole-house
  // gross, which on a mostly-brick home exceeded the entire siding area). The cap
  // still guards against the AI counting the same window in two overlapping
  // shots; when it engages it is surfaced so confidence can be degraded rather
  // than silently absorbing a bad count.
  // A footprint-anchored union can be a real third of the siding (Hover's
  // Malec package is 31%). 25% was cutting that off. Photo-sized walls keep
  // the 25% rail so a double-counted shot cannot consume the facade.
  const MAX_OPENING_DEDUCTION_PCT = photoWallArea?.footprint_anchored ? 0.40 : 0.25;
  const openingDeductionCap = round(sidingFacade * MAX_OPENING_DEDUCTION_PCT, 2);
  const openingDeduction = Math.min(rawSidingOpening, openingDeductionCap);
  const net = round(Math.max(0, sidingFacade - openingDeduction), 2);

  // ── Internal sanity cross-check ───────────────────────────────────────────
  // Re-run the same siding maths against the footprint extrusion so the hero
  // number always has an independent number to be compared with:
  //   sanity_facade = extrusion_gross × siding_share
  //   sanity_net    = sanity_facade − siding-allocated openings
  //   sanity_delta  = |net − sanity_net| / sanity_net × 100
  // A delta inside SIDING_SANITY_BAND_PCT means the photo split and the
  // footprint extrusion corroborate each other; that is what lets the grader
  // promote to B without inventing a single square.
  const sidingFacadeForGross = (grossArea) => {
    if (!(grossArea > 0)) return 0;
    if (materialFaces.length > 0 && materialGross > 0) {
      return round(Math.max(0, materialSiding * (grossArea / materialGross)), 2);
    }
    return round(Math.max(0, grossArea - accent), 2);
  };
  const netForGross = (grossArea) => {
    const facade = sidingFacadeForGross(grossArea);
    const cap = round(facade * MAX_OPENING_DEDUCTION_PCT, 2);
    return round(Math.max(0, facade - Math.min(rawSidingOpening, cap)), 2);
  };
  const sanityFacade = sidingFacadeForGross(extrusionGross);
  const sanityNet = netForGross(extrusionGross);
  const photoCandidateNet = photoWallArea?.measured_faces?.length > 0
    ? netForGross(num(photoWallArea.area_sqft))
    : null;
  // Compare the photo candidate's SIDING total to the independent footprint
  // extrusion total even when the candidate fails the hero gate. This is what
  // forces a 3584-vs-2607 result into SANITY-REVIEW instead of silently
  // accepting the extrusion as if no contradictory photo estimate existed.
  const sanityDeltaPct = photoCandidateNet != null && sanityNet > 0
    ? round(Math.abs(photoCandidateNet - sanityNet) / sanityNet * 100, 1)
    : null;
  const sanityReviewRequired = (sanityDeltaPct != null && sanityDeltaPct > 25)
    || photoWallArea?.perimeter_flagged === true
    || (photoWallArea?.width_fallback_faces?.length || 0) > 0;

  return {
    gross_wall_area_sqft: gross,
    gross_wall_area_source: grossSource,
    extrusion_wall_area_sqft: extrusionGross,
    wall_height_semantics: agg.wallHeightSemantics ?? null,
    stories_multiplier: agg.storiesMultiplier ?? null,
    photo_wall_area_sqft: photoWallArea ? round(num(photoWallArea.area_sqft), 2) : null,
    photo_wall_area_usable: usePhotoHero,
    photo_measured_faces: photoWallArea?.measured_faces ?? [],
    photo_substituted_faces: photoWallArea?.substituted_faces ?? [],
    // Share of the traced footprint perimeter that was actually photographed —
    // the gate that decides whether the prism may bill as photo-measured.
    photo_measured_perimeter_coverage: photoWallArea?.measured_perimeter_coverage ?? null,
    photo_measured_perimeter_ft: photoWallArea?.measured_perimeter_ft ?? null,
    photo_perimeter_deviation_pct: photoWallArea?.perimeter_deviation_pct ?? null,
    photo_perimeter_flagged: photoWallArea?.perimeter_flagged === true,
    photo_width_fallback_faces: photoWallArea?.width_fallback_faces ?? [],
    width_review_flags: photoWallArea?.width_review_flags ?? [],
    footprint_anchored: photoWallArea?.footprint_anchored === true,
    photo_vs_extrusion_delta_pct: photoWallArea?.delta_vs_extrusion_pct ?? null,
    photo_candidate_net_siding_area_sqft: photoCandidateNet,
    sanity_siding_facade_sqft: sanityFacade,
    sanity_net_siding_area_sqft: sanityNet,
    sanity_delta_pct: sanityDeltaPct,
    sanity_band_pct: SIDING_SANITY_BAND_PCT,
    within_sanity_band: sanityDeltaPct == null ? false : sanityDeltaPct <= SIDING_SANITY_BAND_PCT,
    sanity_review_required: sanityReviewRequired,
    wall_total_quality: wallTotalQuality,
    poor_faces: photoWallArea?.poor_faces ?? [],
    photo_overrides_footprint: photoWallArea?.photo_overrides_footprint === true,
    accent_deduction_sqft: accent,
    masonry_area_sqft: materialFaces.length > 0
      ? round(materialFaces.reduce((sum, face) => sum + num(face.excluded_area_sqft), 0) * materialScale, 2)
      : accent,
    material_map_present: materialFaces.length > 0,
    material_map_complete: materialMap?.complete === true,
    siding_material_area_sqft: materialFaces.length > 0
      ? round(materialSiding * materialScale, 2) : sidingFacade,
    excluded_material_area_sqft: materialFaces.length > 0
      ? round(materialFaces.reduce((sum, face) => sum + num(face.excluded_area_sqft), 0) * materialScale, 2)
      : accent,
    unknown_material_area_sqft: materialFaces.length > 0
      ? round(num(materialMap.unknown_area_sqft) * materialScale, 2) : 0,
    siding_facade_area_sqft: sidingFacade,
    siding_share_pct: round(sidingShare * 100, 1),
    opening_area_total_sqft: openingAreaTotal,
    opening_area_capped: openingReviewFlags.length > 0,
    opening_review_flags: openingReviewFlags,
    opening_deduction_masonry_sqft: openingMasonry,
    opening_deduction_sqft: openingDeduction,
    opening_deduction_raw_sqft: rawSidingOpening,
    opening_deduction_capped: openingDeduction < rawSidingOpening,
    net_siding_area_sqft: net,
    j_channel_lf: trim.j_channel.lf,
    j_channel_openings_lf: trim.j_channel.openings_lf,
    j_channel_roof_wall_lf: trim.j_channel.roof_wall_lf,
    starter_strip_lf: trim.starter_strip.lf,
    window_assemblies: counts.window_assemblies,
    window_units: counts.window_units,
    entry_doors: counts.entry_doors,
    garage_doors: counts.garage_doors,
    vents: counts.vents,
    provenance: {
      footprint_source: agg.footprintSource ?? null,
      story_count: agg.storyCount ?? null,
      wall_height_ft: agg.wallHeightFt != null ? round(agg.wallHeightFt, 2) : null,
      // Persisted so a later rebuild (e.g. the user edits a window count) can
      // re-apply the SAME per-face material mix. Without it a rebuild silently
      // falls back to the house-wide share and re-charges brick-wall openings
      // against the siding column — the exact bug this allocation fixes.
      face_masonry_pct: faceMasonryPct,
    },
    uncertainty: {
      occluded_groups: groups.filter((g) => g.uncertainty === 'occluded_photo').length,
    },
  };
}

const STANDARD_OPENING_SIZE = {
  window: [3, 5],
  entry_door: [3, 6.8],
  garage_door: [9, 7],
};

const GARAGE_SIZE_CLASSES = [
  { width: 9, height: 7 },
  { width: 16, height: 7 },
];

function openingAspect(width, height) {
  return height > 0 ? width / height : 1;
}

/** Window 3×5, entry 3×6.8, garage 9×7 or 16×7 — whichever aspect is closer. */
function nearestOpeningClass(type, width, height) {
  if (type === 'garage_door') {
    const target = openingAspect(width, height);
    let best = GARAGE_SIZE_CLASSES[0];
    let bestDist = Infinity;
    for (const klass of GARAGE_SIZE_CLASSES) {
      const dist = Math.abs(target - openingAspect(klass.width, klass.height));
      if (dist < bestDist) {
        best = klass;
        bestDist = dist;
      }
    }
    return best;
  }
  if (type === 'entry_door') return { width: 3, height: 6.8 };
  if (type === 'window') return { width: 3, height: 5 };
  return null;
}

function componentFeet(component) {
  return {
    width: num(component?.width_ft ?? component?.width),
    height: num(component?.height_ft ?? component?.height),
  };
}

/** A mulled bank whose sashes are ordinary windows keeps the measured frame. */
function componentsExplainOpening(opening) {
  const parts = Array.isArray(opening?.components) ? opening.components : [];
  if (parts.length < 2) return false;
  let widthSum = 0;
  let maxHeight = 0;
  for (const part of parts) {
    const { width, height } = componentFeet(part);
    if (!(width >= 1.5 && width <= 6 && height >= 2 && height <= 6.5 && width * height <= 30)) return false;
    widthSum += width;
    if (height > maxHeight) maxHeight = height;
  }
  return Math.abs(widthSum - num(opening.width_ft)) <= 1.5
    && Math.abs(maxHeight - num(opening.height_ft)) <= 1;
}

function openingIsPlausible(opening, faceEave) {
  const width = num(opening.width_ft);
  const height = num(opening.height_ft);
  const area = width * height;
  if (!(width > 0) || !(height > 0)) return false;
  if (opening.type === 'window') {
    const units = Math.max(
      1,
      Math.floor(num(opening.unit_count))
        || (Array.isArray(opening.components) ? opening.components.length : 0),
    );
    const maxWidth = units > 1 ? Math.min(12, 4 * units) : 6;
    const maxArea = units > 1 ? 20 * units : 30;
    if (width < 1.5 || width > maxWidth || height < 2 || height > 6.5 || area > maxArea) return false;
    if (faceEave > 0 && height > faceEave + 0.5) return false;
    return true;
  }
  if (opening.type === 'entry_door') {
    return width >= 2.5 && width <= 4 && height >= 6.5 && height <= 8 && area <= 32;
  }
  if (opening.type === 'garage_door') {
    const klass = nearestOpeningClass('garage_door', width, height);
    const nearWidth = Math.abs(width - klass.width) <= Math.max(1.5, klass.width * 0.2);
    return nearWidth && height >= 6.5 && height <= 8.5 && area <= klass.width * klass.height * 1.25;
  }
  return true;
}

function writeOpeningSize(opening, width, height, sizedFrom) {
  opening.width_ft = round(width, 2);
  opening.height_ft = round(height, 2);
  opening.sqft = round(width * height, 2);
  opening.perimeter_lf = round(2 * (width + height), 2);
  if (sizedFrom) opening.sized_from = sizedFrom;
}

function applyShutterGlass(opening) {
  const width = num(opening._shutter?.width_in) / 12;
  const height = num(opening._shutter?.height_in) / 12;
  if (!(width > 0) || !(height > 0)) return;
  const box = num(opening.width_ft) * num(opening.height_ft);
  if (box > 0 && width * height < box * 0.85) {
    writeOpeningSize(opening, width, height, 'shutter_glass');
  }
}

/** A 0–1 box stored in the foot fields is a fraction of the face, not a 1 ft window. */
function expandFractionBox(opening, faceWidth, faceEave) {
  const width = num(opening.width_ft);
  const height = num(opening.height_ft);
  if (!(width > 0 && width < 1 && height > 0 && height < 1)) return;
  if (!(faceWidth > 8) || !(faceEave > 6)) return;
  writeOpeningSize(opening, width * faceWidth, height * faceEave, 'fraction_of_face');
}

/** Every measured window and door is a fraction. One 1×0.75 vent is not. */
function photoIsFractionBoxes(list) {
  const measured = list.filter((opening) => !opening.synthetic && opening.type !== 'vent');
  if (!measured.length) return false;
  return measured.every((opening) => {
    const width = num(opening.width_ft);
    const height = num(opening.height_ft);
    return width > 0 && width < 1 && height > 0 && height < 1;
  });
}

/**
 * One scale for a photo whose boxes are systematically too big. The door
 * height is the reference (garage 7 ft, tall garage 8 ft, entry 6 ft 8 in).
 * With no door, the face's locked eave is the reference. Never scale up.
 */
function scaleForImplausiblePhoto(openings, lockedEave) {
  const measured = openings.filter((opening) => !opening.synthetic && opening.type !== 'vent');
  if (!measured.length) return 1;
  const implausible = measured.filter((opening) => (
    !componentsExplainOpening(opening) && !openingIsPlausible(opening, lockedEave)
  ));
  if (implausible.length < Math.ceil(measured.length * 0.5)) return 1;
  const doorScales = measured
    .filter((opening) => (
      (opening.type === 'garage_door' || opening.type === 'entry_door')
      && num(opening.height_ft) > 4
    ))
    .map((opening) => {
      const standard = opening.type === 'garage_door'
        ? (num(opening.height_ft) >= 7.6 && num(opening.height_ft) <= 9.2 ? 8 : 7)
        : 6.8;
      return standard / num(opening.height_ft);
    })
    .filter((scale) => scale <= 0.85 && scale >= 0.35);
  if (doorScales.length) {
    doorScales.sort((a, b) => a - b);
    return doorScales[Math.floor(doorScales.length / 2)];
  }
  // A door already near 7 ft or 6 ft 8 in means the foot scale is usable.
  // A locked eave that disagrees is a story read, not a reason to shrink it.
  const doorNearStandard = measured.some((opening) => {
    if (opening.type !== 'garage_door' && opening.type !== 'entry_door') return false;
    const height = num(opening.height_ft);
    if (!(height > 4)) return false;
    const standard = opening.type === 'garage_door'
      ? (height >= 7.6 && height <= 9.2 ? 8 : 7)
      : 6.8;
    const scale = standard / height;
    return scale > 0.85 && scale < 1.15;
  });
  if (doorNearStandard) return 1;
  const photoEave = num(measured[0]._photoEaveFt);
  if (lockedEave > 0 && photoEave > 0) {
    const scale = lockedEave / photoEave;
    if (scale <= 0.85 && scale >= 0.35) return scale;
  }
  return 1;
}

function clampOpeningToClass(opening, faceEave) {
  if (opening.synthetic || componentsExplainOpening(opening)) return;
  if (openingIsPlausible(opening, faceEave)) return;
  const klass = nearestOpeningClass(opening.type, opening.width_ft, opening.height_ft);
  if (!klass) return;
  const measured = num(opening.width_ft) * num(opening.height_ft);
  if (!(measured > klass.width * klass.height * 1.05)) return;
  writeOpeningSize(opening, klass.width, klass.height, opening.sized_from || 'standard_class');
}

function windowInsideGarage(window, door) {
  if (window.face !== door.face || door.pos_x == null || window.pos_x == null) return false;
  const doorWidth = num(door.width_ft);
  const doorHeight = num(door.height_ft);
  if (!(doorWidth > 0) || !(doorHeight > 0)) return false;
  const along = Math.abs(num(window.pos_x) - num(door.pos_x));
  const rise = window.pos_y == null || door.pos_y == null
    ? 0
    : Math.abs(num(window.pos_y) - num(door.pos_y));
  const windowArea = num(window.width_ft) * num(window.height_ft);
  return along <= doorWidth / 2
    && rise <= doorHeight / 2
    && windowArea < doorWidth * doorHeight * 0.5;
}

/**
 * After dedupe, so two readings of one window still match on their raw size.
 * Shrink a photo when its door or locked eave says the foot scale is high,
 * replace a shuttered frame with the glass size, and snap a box that is
 * still not a real opening down to the standard class. A smaller measured
 * window is left alone.
 */
function normalizeMeasuredOpenings(openings, { faceEaveFt = null, faceWidthsFt = null } = {}) {
  const byPhoto = new Map();
  for (const opening of openings) {
    const list = byPhoto.get(opening._photoIndex) || [];
    list.push(opening);
    byPhoto.set(opening._photoIndex, list);
  }
  for (const list of byPhoto.values()) {
    const face = list.find((opening) => opening.face && opening.face !== UNKNOWN_FACE)?.face || list[0]?.face;
    const lockedEave = num(faceEaveFt?.[face]);
    const faceWidth = num(faceWidthsFt?.[face]) || num(list[0]?._photoWidth);
    const faceEave = lockedEave || num(list[0]?._photoEaveFt);
    const fractional = photoIsFractionBoxes(list);
    for (const opening of list) {
      if (opening.synthetic) continue;
      applyShutterGlass(opening);
      if (fractional && opening.type !== 'vent' && opening.sized_from !== 'shutter_glass') {
        expandFractionBox(opening, faceWidth, faceEave);
      }
    }
    const scale = scaleForImplausiblePhoto(list, lockedEave);
    if (scale < 1) {
      for (const opening of list) {
        if (opening.synthetic || opening.sized_from === 'shutter_glass') continue;
        if (componentsExplainOpening(opening) || openingIsPlausible(opening, lockedEave)) continue;
        writeOpeningSize(
          opening,
          num(opening.width_ft) * scale,
          num(opening.height_ft) * scale,
          'door_or_eave_scale',
        );
      }
    }
    for (const opening of list) clampOpeningToClass(opening, lockedEave);
  }

  const drop = new Set();
  const garages = openings.filter((opening) => opening.type === 'garage_door' && !opening.synthetic);
  for (let i = 0; i < garages.length; i += 1) {
    for (let j = i + 1; j < garages.length; j += 1) {
      const left = garages[i];
      const right = garages[j];
      if (left._photoIndex == null || left._photoIndex !== right._photoIndex) continue;
      if (left.face === right.face || !looseSameOpening(left, right)) continue;
      const dropWhich = left.face === left._photoFace
        ? right
        : (right.face === right._photoFace
          ? left
          : (num(left.width_ft) >= num(right.width_ft) ? right : left));
      drop.add(dropWhich);
    }
  }
  const withoutDupes = openings.filter((opening) => !drop.has(opening));
  const doors = withoutDupes.filter((opening) => opening.type === 'garage_door');
  const garageLitesRemoved = {};
  const kept = withoutDupes.filter((opening) => {
    if (opening.type !== 'window') return true;
    if (!doors.some((door) => windowInsideGarage(opening, door))) return true;
    garageLitesRemoved[opening.face] = (garageLitesRemoved[opening.face] || 0) + 1;
    return false;
  });
  return { openings: kept, garageLitesRemoved };
}

/**
 * A face's opening count is the union, not the sum of per-photo counts.
 * The fullest straight photo sets the count. Openings already kept from
 * other photos of that face count toward it, and a missing dimension is a
 * standard size.
 */
function padListedWindowShortfall(openings, perPhotoResults, garageLitesRemoved = null) {
  const have = new Map();
  for (const opening of openings) {
    if (opening.face === UNKNOWN_FACE || !STANDARD_OPENING_SIZE[opening.type]) continue;
    const row = have.get(opening.face) || { window: 0, entry_door: 0, garage_door: 0 };
    const units = opening.type === 'window'
      ? Math.max(1, Math.floor(num(opening.unit_count)) || 1)
      : 1;
    row[opening.type] += units;
    have.set(opening.face, row);
  }
  const photosByFace = new Map();
  (perPhotoResults || []).forEach((photo, index) => {
    if (evidenceForResult(photo)?.status === 'duplicate') return;
    const face = resultFace(photo);
    if (!face || face === UNKNOWN_FACE) return;
    const list = photosByFace.get(face) || [];
    list.push({ photo, index });
    photosByFace.set(face, list);
  });
  const added = [];
  for (const [face, list] of photosByFace) {
    const straight = list.filter((item) => !isCornerPhoto(item.photo));
    const source = straight.length ? straight : list;
    const declared = { window: 0, entry_door: 0, garage_door: 0 };
    for (const item of source) {
      declared.window = Math.max(declared.window, Math.floor(num(item.photo.windows_count)));
      declared.entry_door = Math.max(declared.entry_door, Math.floor(num(item.photo.doors_count)));
      declared.garage_door = Math.max(declared.garage_door, Math.floor(num(item.photo.garage_doors_count)));
    }
    const got = have.get(face) || { window: 0, entry_door: 0, garage_door: 0 };
    // Glass panels in a garage door are not extra windows. The count often
    // includes them; do not mint a replacement for each one removed.
    declared.window = Math.max(0, declared.window - Math.floor(num(garageLitesRemoved?.[face])));
    const measuredGarage = openings.some((opening) => (
      opening.face === face && opening.type === 'garage_door' && !opening.synthetic
    ));
    for (const type of Object.keys(STANDARD_OPENING_SIZE)) {
      // A listed garage door plus a higher count is the same door twice.
      if (type === 'garage_door' && measuredGarage) continue;
      const gap = Math.min(24, Math.max(0, declared[type] - got[type]));
      const [width, height] = STANDARD_OPENING_SIZE[type];
      for (let i = 0; i < gap; i += 1) {
        added.push({
          _photoIndex: source[0].index,
          _localIndex: 1000 + added.length,
          _isCorner: false,
          face,
          type,
          width_ft: width,
          height_ft: height,
          sqft: round(width * height, 2),
          perimeter_lf: round(2 * (width + height), 2),
          zone: 'unknown',
          pos_x: null,
          pos_y: null,
          position_unit: 'feet',
          observation_id: null,
          confidence: 0.25,
          occluded: false,
          components: null,
          synthetic: true,
          unit_count: 1,
          physical_identity: `count_union:${face}:${type}:${i}`,
          at_grade: type === 'garage_door' || type === 'entry_door',
        });
      }
    }
  }
  return added.length ? [...openings, ...added] : openings;
}

/**
 * A footprint face with no photo still has windows. Their count is the
 * photographed faces' windows per foot of wall, each a standard 3×5.
 */
function estimateUnphotographedWindows(openings, perPhotoResults, faceWidthsFt) {
  if (!faceWidthsFt || typeof faceWidthsFt !== 'object') return openings;
  const photographed = new Set();
  (perPhotoResults || []).forEach((photo) => {
    if (evidenceForResult(photo)?.status === 'duplicate') return;
    const face = resultFace(photo);
    if (face && face !== UNKNOWN_FACE) photographed.add(face);
  });
  let windowCount = 0;
  let photographedWidth = 0;
  for (const face of WALL_FACES) {
    if (!photographed.has(face)) continue;
    const faceWidth = num(faceWidthsFt[face]);
    if (!(faceWidth > 0)) continue;
    const count = openings.filter((opening) => opening.face === face && opening.type === 'window').length;
    windowCount += count;
    photographedWidth += faceWidth;
  }
  if (!(photographedWidth > 0) || !(windowCount > 0)) return openings;
  const density = windowCount / photographedWidth;
  const [width, height] = STANDARD_OPENING_SIZE.window;
  const added = [];
  for (const face of WALL_FACES) {
    if (photographed.has(face)) continue;
    const faceWidth = num(faceWidthsFt[face]);
    if (!(faceWidth > 0)) continue;
    const count = Math.round(density * faceWidth);
    for (let i = 0; i < count; i += 1) {
      added.push({
        _photoIndex: -1,
        _localIndex: 2000 + added.length,
        _isCorner: false,
        face,
        type: 'window',
        width_ft: width,
        height_ft: height,
        sqft: round(width * height, 2),
        perimeter_lf: round(2 * (width + height), 2),
        zone: 'unknown',
        pos_x: null,
        pos_y: null,
        position_unit: 'feet',
        observation_id: null,
        confidence: 0.25,
        occluded: false,
        components: null,
        synthetic: true,
        unit_count: 1,
        physical_identity: `window_density:${face}:${i}`,
        estimated_from: 'photographed_window_density',
        at_grade: false,
      });
    }
  }
  return added.length ? [...openings, ...added] : openings;
}

function buildReconciliation(totals) {
  const { siding_facade_area_sqft, opening_deduction_sqft, net_siding_area_sqft } = totals;
  // Siding openings are deducted from the siding facade only — masonry openings
  // belong to the masonry column and never touch this figure.
  const expected = round(
    Math.max(0, siding_facade_area_sqft - opening_deduction_sqft),
    2,
  );
  const diff = round(net_siding_area_sqft - expected, 2);
  const consistent = Math.abs(diff) < 0.01;
  const issues = [];
  if (!consistent) {
    issues.push({
      code: 'net_area_mismatch',
      expected,
      actual: net_siding_area_sqft,
      difference: diff,
      message: 'net_siding_area_sqft != siding facade - siding openings.',
    });
  }
  return {
    consistent,
    assertion: 'net = (gross - masonry) - siding-allocated openings',
    expected_net_siding_area_sqft: expected,
    actual_net_siding_area_sqft: net_siding_area_sqft,
    difference: diff,
    issues,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the canonical siding measurement graph from raw inputs.
 * Pure and deterministic.
 *
 * @param {Object} input
 * @param {Array<Object>} input.perPhotoResults  Raw per-photo AI results.
 * @param {Object}  [input.footprint]            Optional footprint polygon/meta.
 * @param {number}  [input.storyCount]
 * @param {number}  [input.wallHeightFt]
 * @param {'full_elevation'|'per_story'} [input.wallHeightSemantics]
 * @param {number}  [input.storiesMultiplier]
 * @param {number}  [input.grossWallAreaSqft]
 * @param {number}  [input.accentDeductionSqft]
 * @param {number}  [input.perimeterFt]
 * @param {number}  [input.buildingWidthFt]
 * @param {number}  [input.buildingLengthFt]
 * @param {string}  [input.footprintSource]
 * @param {boolean} [input.smallOpeningsInWaste] When false, only groups >=20 sqft deduct.
 * @param {Array<Object>} [input.roofFacets]
 * @returns {Object} versioned canonical graph
 */
export function buildSidingMeasurementGraph(input = {}) {
  const sourcePhotoResults = Array.isArray(input.perPhotoResults) ? input.perPhotoResults : [];
  const multiViewEvidence = buildMultiViewPhotoEvidence(sourcePhotoResults);
  const perPhotoResults = sourcePhotoResults.map((result, index) => ({
    ...result,
    _multi_view_evidence: multiViewEvidence.photos[index],
  }));
  const smallOpeningsInWaste = !!input.smallOpeningsInWaste;
  const openingDeductMinSqft = Number(input.openingDeductMinSqft) === 33 ? 33 : MIN_DEDUCTIBLE_SQFT;

  const agg = {
    storyCount: input.storyCount,
    wallHeightFt: input.wallHeightFt,
    wallHeightSemantics: input.wallHeightSemantics || 'unknown',
    storiesMultiplier: input.storiesMultiplier ?? null,
    grossWallAreaSqft: input.grossWallAreaSqft,
    accentDeductionSqft: input.accentDeductionSqft ?? 0,
    // Optional { face: masonryPct } map. When present, each opening is charged to
    // its own face's material mix instead of the house-wide average.
    faceMasonryPct: input.faceMasonryPct ?? null,
    outbuilding: input.outbuilding === true,
    perimeterFt: input.perimeterFt ?? 0,
    buildingWidthFt: input.buildingWidthFt,
    buildingLengthFt: input.buildingLengthFt,
    faceWidthsFt: input.faceWidthsFt ?? null,
    faceEaveFt: input.faceEaveFt ?? null,
    gableByFace: input.gableByFace ?? null,
    footprintSource: input.footprintSource,
  };

  // 1. Extract raw openings across all photos (preserving <10 sqft openings).
  const rawOpenings = [];
  perPhotoResults.forEach((r, i) => {
    rawOpenings.push(...extractRawOpenings(r, i));
  });

  // 1b. Reconcile count-only observations per wall BEFORE dedupe — synthetic
  //     openings carry per-photo identities that dedupe can never collapse.
  const { openings: reconciledOpenings, collapsed: syntheticCollapsed } =
    collapseSyntheticCounts(rawOpenings, agg.faceWidthsFt);

  // 2. Corner frames overlap the straight elevation even when the zone and
  //    position do not match. Do this before strict dedupe so a corner that
  //    saw one extra window is not shrunk down to the flat count by the copy
  //    that did match.
  const { openings: cornerReconciled, collapsed: measuredCornerCollapsed } =
    reconcileMeasuredCornerOverlap(reconciledOpenings, agg.faceWidthsFt);
  // 3. Dedupe only true repeated observations (never merge adjacent/similar).
  const { openings: dedupedOpenings, duplicatesRemoved } = dedupeObservations(cornerReconciled);
  const normalizedOpenings = normalizeMeasuredOpenings(dedupedOpenings, {
    faceEaveFt: agg.faceEaveFt,
    faceWidthsFt: agg.faceWidthsFt,
  });
  const countedOpenings = estimateUnphotographedWindows(
    padListedWindowShortfall(
      normalizedOpenings.openings,
      perPhotoResults,
      normalizedOpenings.garageLitesRemoved,
    ),
    perPhotoResults,
    agg.faceWidthsFt,
  );

  // 4. Nodes.
  const building = {
    id: 'building',
    story_count: agg.storyCount ?? null,
    wall_height_ft: agg.wallHeightFt != null ? round(agg.wallHeightFt, 2) : null,
    wall_height_semantics: agg.wallHeightSemantics ?? null,
    stories_multiplier: agg.storiesMultiplier ?? null,
    perimeter_ft: round(agg.perimeterFt, 2),
    building_width_ft: agg.buildingWidthFt != null ? round(agg.buildingWidthFt, 2) : null,
    building_length_ft: agg.buildingLengthFt != null ? round(agg.buildingLengthFt, 2) : null,
    footprint_source: agg.footprintSource ?? null,
    footprint: input.footprint ?? null,
  };

  const wallFacets = buildWallFacets(perPhotoResults, countedOpenings, multiViewEvidence);
  const materialMap = buildMaterialMap(wallFacets, agg, perPhotoResults);
  agg.materialMap = materialMap;
  // Photo-measured prism must exist before totals so the hero wall area can
  // prefer measured elevations over the footprint extrusion.
  const photoWallArea = buildPhotoWallArea(wallFacets, agg);
  agg.photoWallArea = photoWallArea;
  const { groups: openingGroups, components: openingComponents } =
    buildOpeningGroupsAndComponents(
      countedOpenings,
      smallOpeningsInWaste,
      openingDeductMinSqft,
      agg.faceWidthsFt != null,
    );
  promoteClassifiedSidingWindowPackages(openingGroups, materialMap);
  const roofFacets = buildRoofFacets(input.roofFacets);
  const starterFraction = starterMasonryFraction(perPhotoResults, agg);
  const trimEdges = buildTrimEdges(openingGroups, agg.perimeterFt, input.roofFacets, starterFraction);
  const counts = buildCounts(openingGroups, openingComponents);

  // Material regions (accent / non-siding) — one region per facet contribution.
  const materialRegions = wallFacets
    .filter((f) => !f.is_unknown)
    .map((f) => ({
      id: `mat_${f.face}`,
      facet_id: f.id,
      face: f.face,
      // Accent area is aggregate-level; expose reference so downstream can split.
      accent_deduction_sqft: null,
    }));

  const coverage = buildCoverage(perPhotoResults, wallFacets, multiViewEvidence);
  const totals = buildTotals(agg, openingGroups, openingComponents, trimEdges, counts);
  const reconciliation = buildReconciliation(totals);

  return {
    version: SIDING_GRAPH_VERSION,
    building,
    wall_facets: wallFacets,
    material_map: materialMap,
    material_regions: materialRegions,
    opening_groups: openingGroups,
    opening_components: openingComponents,
    roof_facets: roofFacets,
    trim_edges: trimEdges,
    coverage,
    counts,
    totals,
    reconciliation,
    diagnostics: {
      raw_opening_count: rawOpenings.length,
      deduped_opening_count: countedOpenings.length,
      duplicates_removed: duplicatesRemoved + syntheticCollapsed + measuredCornerCollapsed,
      synthetic_counts_collapsed: syntheticCollapsed,
      measured_corner_collapsed: measuredCornerCollapsed,
      small_openings_in_waste: smallOpeningsInWaste,
      multi_view_evidence_version: multiViewEvidence.version,
      unresolved_photo_count: multiViewEvidence.unresolved_photos.length,
      duplicate_photo_count: multiViewEvidence.duplicate_photos.length,
      contradictory_face_count: multiViewEvidence.contradictions.length,
    },
  };
}

export default buildSidingMeasurementGraph;
