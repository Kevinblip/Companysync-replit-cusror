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
 *  • J-channel is counted once per rough-opening group perimeter — never the
 *    sum of internal component perimeters.
 *  • Dedupe only true repeated photo observations of the SAME resolved wall
 *    face + type with either an explicit stable observation identity OR
 *    near-identical geometry AND position. Never dedupe on zone alone. The
 *    highest-confidence copy survives.
 *
 * @module functions/utils/sidingMeasurementGraph
 */

import { buildMultiViewPhotoEvidence } from './multiViewPhotoEvidence.js';

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

// ── Photo-measured wall prism vs. footprint extrusion ───────────────────────
// The footprint extrusion (perimeter × wall height + gables) is a SANITY
// number: it assumes every elevation is a full-height rectangle wrapped around
// the traced outline. When the photos actually measured a face we know that
// face's real width, eave height and gable rise, so the extrusion must not stay
// the hero number that a customer sees.
//
//   photo_face_area = wall_width × eave_height + ½ × wall_width × gable_rise
//
// A face with no usable photo keeps the footprint's own width at the aggregate
// wall height and is reported in `substituted_faces`, so nothing claims to be
// measured that was not.
const MIN_MEASURED_FACES_FOR_PHOTO_HERO = 3;
// A photo prism that disagrees with the extrusion by more than this band is a
// bad scale read, not a better measurement — fall back to the extrusion and say
// so. The band matches the Present gate's photo-vs-extrusion tolerance so the
// hero number and the gate can never disagree about which source to trust.
const PHOTO_HERO_SANITY_BAND_PCT = 25;
// Four photo planes describe a BOX. A footprint whose perimeter is materially
// longer than the four measured widths has geometry the photos never saw — a
// wing, an L, a bump-out — and swapping the traced extrusion for the box would
// silently delete those walls. (Benchmarked against a real address where the
// traced perimeter is 294 LF and the four photo faces only account for 204 LF:
// the box prism under-reports siding by ~30 %.) Photos may refine the walls
// they measured; they may not shrink the building.
// Applies to the MEASURED perimeter only (see buildPhotoWallArea): a face
// substituted from the footprint may fill a gap in the prism's geometry, but it
// can never count toward proving the photos covered the building. In practice
// this means every meaningful face must be photographed before the prism can
// bill; a single unphotographed elevation drops coverage well below the floor.
const PHOTO_HERO_MIN_PERIMETER_COVERAGE = 0.98;
// For the same reason, four measured planes are a LOWER BOUND on the building's
// wall area: any wall the camera never saw only adds to it. So the prism may
// refine the extrusion downward (photos proving a wall is shorter than the
// extrusion assumed) but it may never inflate it. A prism that comes out ABOVE
// the extrusion is telling us the FOOTPRINT perimeter is under-called — that is
// a footprint defect, and correcting it here would paper over it with a box.
const PHOTO_HERO_MAX_INFLATION = 1.02; // 2% headroom for rounding noise only
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

function round(v, dp = 2) {
  const p = Math.pow(10, dp);
  return Math.round(num(v) * p) / p;
}

/**
 * Collapse repeated photo masonry reads into one percentage per wall face.
 * A positive, valid masonry percentage is itself a masonry signal so older
 * responses that omitted has_mixed_materials are not silently discarded.
 */
export function collectFaceMasonryPct(results, resolveFace = resolveWallFace) {
  const samplesByFace = {};
  for (const result of Array.isArray(results) ? results : []) {
    const material = String(result?.non_siding_material || '').toLowerCase();
    const rawPct = Number(result?.non_siding_coverage_pct ?? result?.non_siding_pct);
    const hasValidMasonry = ['brick', 'stone'].includes(material)
      && Number.isFinite(rawPct)
      && rawPct > 0;
    if (!(result?.has_mixed_materials === true || hasValidMasonry)) continue;
    if (!['brick', 'stone'].includes(material) || !Number.isFinite(rawPct)) continue;
    const face = resolveFace(result?.wall_face || result?.view_label || result?.label);
    (samplesByFace[face] = samplesByFace[face] || []).push(
      Math.max(0, Math.min(100, rawPct)),
    );
  }

  const facePct = {};
  for (const [face, samples] of Object.entries(samplesByFace)) {
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
    facePct[face] = Math.round(median);
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
    add(result.windows_count, 'window', 3, 4);
    add(result.doors_count, 'entry_door', 3, 6.8);
    add(result.garage_doors_count, 'garage_door', 16, 7);
    arr = synthetic;
  }
  const photoFace = resultFace(result);
  const photoConf = photoConfidence(result);
  // A corner shot re-photographs a wall that another slot already covers, so its
  // counts overlap rather than add.
  const cornerShot = isCornerPhoto(result);

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
      physical_identity: physicalIdentity,
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

  // (a) explicit stable identity
  if (a.observation_id != null && b.observation_id != null) {
    return a.observation_id === b.observation_id;
  }

  // (b) near-identical geometry AND position
  const geoMatch =
    Math.abs(a.width_ft - b.width_ft) <= GEO_TOL_FT &&
    Math.abs(a.height_ft - b.height_ft) <= GEO_TOL_FT;
  if (!geoMatch) return false;

  const havePos =
    a.pos_x != null && a.pos_y != null && b.pos_x != null && b.pos_y != null;
  if (havePos) {
    // (b1) Rule 4 — full spatial coordinate match (field-of-view overlap check):
    // Two observations with matching geometry AND positions that are within tolerance
    // are the same physical opening seen from two overlapping camera angles.
    return (
      Math.abs(a.pos_x - b.pos_x) <= POS_TOL_FT &&
      Math.abs(a.pos_y - b.pos_y) <= POS_TOL_FT
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
function collapseSyntheticCounts(rawOpenings) {
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
    const flat = [];
    let bestCorner = null;
    let total = 0;
    for (const list of perPhoto.values()) {
      total += list.length;
      if (list[0]._isCorner) {
        if (bestCorner === null || list.length > bestCorner.length) bestCorner = list;
      } else {
        flat.push(...list);
      }
    }
    // The corner only wins when it saw more than every flat photo combined.
    const winner = bestCorner !== null && bestCorner.length > flat.length ? bestCorner : flat;
    kept.push(...winner);
    collapsed += total - winner.length;
  }
  return { openings: [...passthrough, ...kept], collapsed };
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
    if (cand.confidence > kept[existingIdx].confidence) {
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

    const faceEvidence = multiViewEvidence?.faces?.find(summary => summary.face === face);
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
      wall_height_ft: round(Number(best?.wall_height_ft || best?.eave_height_ft) || 0, 2),
      // Eave height and gable rise are kept apart so the photo-measured wall
      // prism can bill a gable as the triangle it is. `wall_height_ft` already
      // folds the rise in, and treating that as a rectangle overstates every
      // gable end by half its area.
      eave_height_ft: round(Number(best?.eave_height_ft || best?.wall_height_ft) || 0, 2),
      gable_rise_ft: round(Math.max(0, Number(best?.gable_rise_ft) || 0), 2),
      has_gable_end: best?.has_gable_end === true,
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
      material_regions:
        Array.isArray(best?.material_regions)
          ? best.material_regions
          : (photos.find((p) => Array.isArray(p.material_regions))?.material_regions || []),
      material_confidence:
        best?.material_confidence ??
        photos.find((p) => p.material_confidence != null)?.material_confidence ??
        avgConf,
      material_uncertain:
        best?.material_uncertain === true
        || photos.some((p) => p.material_uncertain === true),
      non_siding_pct: Number.isFinite(Number(best?.non_siding_pct))
        ? Number(best.non_siding_pct)
        : (Number.isFinite(Number(photos.find((p) => p.non_siding_pct != null)?.non_siding_pct))
          ? Number(photos.find((p) => p.non_siding_pct != null)?.non_siding_pct)
          : null),
      non_siding_material:
        (best?.non_siding_material && best.non_siding_material !== 'none'
          ? best.non_siding_material
          : null) ||
        photos.find((p) => p.non_siding_material && p.non_siding_material !== 'none')
          ?.non_siding_material ||
        null,
      accent_material:
        (best?.non_siding_material && best.non_siding_material !== 'none'
          ? best.non_siding_material
          : null) ||
        photos.find((p) => p.non_siding_material && p.non_siding_material !== 'none')
          ?.non_siding_material ||
        null,
    });
  }
  return facets;
}

/**
 * Photo-measured wall prism.
 *
 * Formula (per canonical face):
 *   measured   → wall_width × eave_height + ½ × wall_width × gable_rise
 *   substituted→ footprint face width × aggregate wall height
 *
 * `usable` (i.e. "this may replace the extrusion as the hero number") requires
 * at least MIN_MEASURED_FACES_FOR_PHOTO_HERO real photo planes AND agreement
 * with the extrusion inside PHOTO_HERO_SANITY_BAND_PCT.
 */
function buildPhotoWallArea(wallFacets, agg) {
  const defaultWidths = {
    front: num(agg.buildingWidthFt),
    back: num(agg.buildingWidthFt),
    left_side: num(agg.buildingLengthFt),
    right_side: num(agg.buildingLengthFt),
  };
  const aggHeight = num(agg.wallHeightFt);
  const faces = {};
  const measured = [];
  const substituted = [];
  let area = 0;
  let prismPerimeter = 0;
  let measuredPerimeter = 0;

  for (const face of WALL_FACES) {
    const facet = wallFacets.find((f) => f.face === face && !f.is_unknown);
    const width = num(facet?.wall_width_ft);
    const eave = num(facet?.eave_height_ft) || num(facet?.wall_height_ft);
    if (facet && width > 0 && eave > 0) {
      const gableRise = Math.max(0, num(facet.gable_rise_ft));
      const faceArea = round(width * eave + (width * gableRise) / 2, 2);
      faces[face] = {
        face,
        source: 'photo_plane',
        width_ft: round(width, 2),
        eave_height_ft: round(eave, 2),
        gable_rise_ft: round(gableRise, 2),
        height_semantics: facet.height_semantics || 'full_elevation',
        stories_multiplier: 1,
        area_sqft: faceArea,
      };
      measured.push(face);
      area += faceArea;
      prismPerimeter += width;
      measuredPerimeter += width;
    } else {
      const fallbackWidth = defaultWidths[face] || 0;
      const faceArea = round(fallbackWidth * aggHeight, 2);
      faces[face] = {
        face,
        source: 'footprint_substitute',
        width_ft: round(fallbackWidth, 2),
        eave_height_ft: round(aggHeight, 2),
        gable_rise_ft: 0,
        height_semantics: 'full_elevation',
        stories_multiplier: 1,
        area_sqft: faceArea,
      };
      substituted.push(face);
      area += faceArea;
      prismPerimeter += fallbackWidth;
    }
  }

  const areaSqft = round(area, 2);
  const extrusionSqft = round(num(agg.grossWallAreaSqft), 2);
  const deltaPct = extrusionSqft > 0
    ? round(Math.abs(areaSqft - extrusionSqft) / extrusionSqft * 100, 1)
    : null;
  const withinBand = deltaPct == null || deltaPct <= PHOTO_HERO_SANITY_BAND_PCT;

  const footprintPerimeter = num(agg.perimeterFt);
  // Coverage is MEASURED perimeter over the footprint perimeter. Substituted
  // widths are footprint arithmetic, so counting them here would let the prism
  // certify its own coverage — on any rectangular footprint the hybrid figure
  // is 100% by construction. Requiring the measured widths themselves to reach
  // the footprint is what makes "photo-calibrated" provenance true: whatever
  // bills as the hero wall area was actually seen in a photo.
  //
  // Without a footprint perimeter the question cannot be answered at all, so
  // fail closed rather than assuming the photos saw everything.
  const perimeterCoverage = footprintPerimeter > 0
    ? round(measuredPerimeter / footprintPerimeter, 3)
    : null;
  const coversFootprint = perimeterCoverage != null
    && perimeterCoverage >= PHOTO_HERO_MIN_PERIMETER_COVERAGE;
  // Diagnostic only — how much of the prism came from photos vs the footprint.
  const measuredPerimeterShare = prismPerimeter > 0
    ? round(measuredPerimeter / prismPerimeter, 3)
    : 0;
  const inflatesExtrusion = extrusionSqft > 0
    && areaSqft > extrusionSqft * PHOTO_HERO_MAX_INFLATION;

  return {
    area_sqft: areaSqft,
    faces,
    measured_faces: measured,
    substituted_faces: substituted,
    prism_perimeter_ft: round(prismPerimeter, 2),
    measured_perimeter_ft: round(measuredPerimeter, 2),
    footprint_perimeter_ft: round(footprintPerimeter, 2),
    measured_perimeter_coverage: perimeterCoverage,
    measured_perimeter_share: measuredPerimeterShare,
    covers_footprint: coversFootprint,
    inflates_extrusion: inflatesExtrusion,
    extrusion_wall_area_sqft: extrusionSqft,
    delta_vs_extrusion_pct: deltaPct,
    within_sanity_band: withinBand,
    sanity_band_pct: PHOTO_HERO_SANITY_BAND_PCT,
    usable: areaSqft > 0
      && measured.length >= MIN_MEASURED_FACES_FOR_PHOTO_HERO
      && withinBand
      && coversFootprint
      && !inflatesExtrusion,
  };
}

function buildOpeningGroupsAndComponents(dedupedOpenings, smallOpeningsInWaste) {
  const groups = [];
  const components = [];

  dedupedOpenings.forEach((o, idx) => {
    // Deterministic ID derived from stable content (face/type/geometry/index).
    const gid = `og_${o.face}_${o.type}_${stableHash(
      `${o.physical_identity || `${o.face}|${o.type}|${o.width_ft}|${o.height_ft}|${o.pos_x}|${o.pos_y}|${idx}`}`,
    )}`;

    const deductible = smallOpeningsInWaste ? true : o.sqft >= MIN_DEDUCTIBLE_SQFT;

    const group = {
      id: gid,
      kind: 'rough_opening',
      face: o.face,
      type: o.type,
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

function buildTrimEdges(groups, perimeterFt) {
  // J-channel: once per rough-opening GROUP perimeter (never summed components).
  // Garage doors are open at grade, so only the head + two jambs are exposed.
  const jChannelLf = round(
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
  // Starter strip runs only along siding-bearing wall bottoms. A garage door
  // open at grade interrupts that run by its outside rough-opening width.
  const garageOpeningsAtGrade = groups.filter(
    (g) => g.type === 'garage_door' && g.at_grade !== false,
  );
  const excludedGarageWidthLf = round(
    garageOpeningsAtGrade.reduce((sum, g) => sum + num(g.width_ft), 0),
    2,
  );
  return {
    j_channel: {
      lf: jChannelLf,
      basis: 'rough_opening_group_perimeter',
      group_count: groups.length,
    },
    starter_strip: {
      lf: round(Math.max(0, num(perimeterFt) - excludedGarageWidthLf), 2),
      basis: 'building_perimeter_minus_grade_garage_openings',
      excluded_garage_width_lf: excludedGarageWidthLf,
      excluded_garage_opening_count: garageOpeningsAtGrade.length,
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
  const windowUnits = windowGroups.reduce((s, g) => {
    const comps = components.filter((c) => c.group_id === g.id && c.type === 'window');
    return s + (comps.length > 0 ? comps.length : 1);
  }, 0);

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

function buildMaterialMap(wallFacets, agg) {
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
    const width = num(facet.wall_width_ft) || defaultWidths[facet.face] || 0;
    const eaveHeight = num(facet.eave_height_ft)
      || num(facet.wall_height_ft)
      || num(agg.wallHeightFt);
    const gableRise = Math.max(0, num(facet.gable_rise_ft));
    // Match buildPhotoWallArea exactly: a full-height photo plane is one
    // rectangle plus one gable triangle. Never multiply this by story_count;
    // photo height is already grade-to-eave for the visible elevation.
    const gross = round(width * eaveHeight + (width * gableRise) / 2, 2);
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
      const rawNonSidingPct = Number(facet.non_siding_pct);
      const nonSidingPct = Number.isFinite(rawNonSidingPct)
        ? Math.max(0, Math.min(100, rawNonSidingPct)) : null;

      if (sidingCategory && materialIsSiding(sidingCategory)) {
        const sidingPct = nonSidingPct == null ? 100 : 100 - nonSidingPct;
        if (sidingPct > 0) regions.push({ material: sidingCategory, percent: round(sidingPct, 2) });
      } else if (sidingCategory && sidingCategory !== 'unknown') {
        regions.push({
          material: sidingCategory,
          percent: nonSidingPct == null ? 100 : round(nonSidingPct, 2),
        });
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
    faces[facet.face] = {
      face: facet.face,
      gross_wall_area_sqft: gross,
      regions: normalizedRegions,
      siding_percent: sidingPercent,
      siding_area_sqft: round(gross * sidingPercent / 100, 2),
      excluded_area_sqft: round(gross * (100 - sidingPercent) / 100, 2),
      material_confidence: facet.material_confidence ?? facet.confidence ?? null,
      uncertain,
      photo_count: facet.photo_count || 0,
    };
  }

  const faceValues = Object.values(faces);
  return {
    version: 1,
    faces,
    required_faces: WALL_FACES,
    covered_faces: Object.keys(faces).sort(),
    complete: WALL_FACES.every((face) => faces[face])
      && faceValues.every((face) => !face.uncertain),
    review_required: !(
      WALL_FACES.every((face) => faces[face])
      && faceValues.every((face) => !face.uncertain)
    ),
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
  // ── Hero wall area: photo planes beat the footprint extrusion ─────────────
  // `perimeter × wall height + gables` is the SANITY number, not the answer.
  // When the photos measured at least MIN_MEASURED_FACES_FOR_PHOTO_HERO real
  // elevations and the two agree inside PHOTO_HERO_SANITY_BAND_PCT, the photo
  // prism becomes the hero and the extrusion is retained purely for the
  // cross-check below.
  const extrusionGross = round(num(agg.grossWallAreaSqft), 2);
  const photoWallArea = agg.photoWallArea && typeof agg.photoWallArea === 'object'
    ? agg.photoWallArea : null;
  const usePhotoHero = photoWallArea?.usable === true && num(photoWallArea.area_sqft) > 0;
  const gross = usePhotoHero ? round(num(photoWallArea.area_sqft), 2) : extrusionGross;
  const grossSource = usePhotoHero ? 'photo_wall_planes' : 'footprint_extrusion';
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
  const materialScale = materialMap?.complete === true && gross > 0 && materialGross > 0
    ? gross / materialGross : 1;

  // ── Siding vs. masonry columns ────────────────────────────────────────────
  // `gross` is the whole wall prism (every exterior surface). `accent` is the
  // portion clad in brick/stone/other non-siding material. What is left is the
  // siding facade — the only column siding openings may be deducted from.
  const sidingFacade = materialFaces.length > 0
    ? round(Math.max(0, materialSiding * materialScale), 2)
    : round(Math.max(0, gross - accent), 2);
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

  const deductible = groups.filter((g) => g.deductible);
  const openingAreaTotal = round(deductible.reduce((s, g) => s + num(g.area_sqft), 0), 2);
  const rawSidingOpening = round(
    deductible.reduce((s, g) => s + num(g.area_sqft) * sidingFractionForFace(g.face), 0),
    2,
  );
  const openingMasonry = round(Math.max(0, openingAreaTotal - rawSidingOpening), 2);

  // Sanity cap, now dimensionally correct: openings charged to the siding column
  // cannot exceed 25 % of the SIDING facade (previously 25 % of the whole-house
  // gross, which on a mostly-brick home exceeded the entire siding area). The cap
  // still guards against the AI counting the same window in two overlapping
  // shots; when it engages it is surfaced so confidence can be degraded rather
  // than silently absorbing a bad count.
  const MAX_OPENING_DEDUCTION_PCT = 0.25;
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
  const sanityReviewRequired = sanityDeltaPct != null && sanityDeltaPct > 25;

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
    photo_vs_extrusion_delta_pct: photoWallArea?.delta_vs_extrusion_pct ?? null,
    photo_candidate_net_siding_area_sqft: photoCandidateNet,
    sanity_siding_facade_sqft: sanityFacade,
    sanity_net_siding_area_sqft: sanityNet,
    sanity_delta_pct: sanityDeltaPct,
    sanity_band_pct: SIDING_SANITY_BAND_PCT,
    within_sanity_band: sanityDeltaPct == null ? false : sanityDeltaPct <= SIDING_SANITY_BAND_PCT,
    sanity_review_required: sanityReviewRequired,
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
    opening_deduction_masonry_sqft: openingMasonry,
    opening_deduction_sqft: openingDeduction,
    opening_deduction_raw_sqft: rawSidingOpening,
    opening_deduction_capped: openingDeduction < rawSidingOpening,
    net_siding_area_sqft: net,
    j_channel_lf: trim.j_channel.lf,
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
    perimeterFt: input.perimeterFt ?? 0,
    buildingWidthFt: input.buildingWidthFt,
    buildingLengthFt: input.buildingLengthFt,
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
    collapseSyntheticCounts(rawOpenings);

  // 2. Dedupe only true repeated observations (never merge adjacent/similar).
  const { openings: dedupedOpenings, duplicatesRemoved } = dedupeObservations(reconciledOpenings);

  // 3. Nodes.
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

  const wallFacets = buildWallFacets(perPhotoResults, dedupedOpenings, multiViewEvidence);
  const materialMap = buildMaterialMap(wallFacets, agg);
  agg.materialMap = materialMap;
  // Photo-measured prism must exist before totals so the hero wall area can
  // prefer measured elevations over the footprint extrusion.
  const photoWallArea = buildPhotoWallArea(wallFacets, agg);
  agg.photoWallArea = photoWallArea;
  const { groups: openingGroups, components: openingComponents } =
    buildOpeningGroupsAndComponents(dedupedOpenings, smallOpeningsInWaste);
  const roofFacets = buildRoofFacets(input.roofFacets);
  const trimEdges = buildTrimEdges(openingGroups, agg.perimeterFt);
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
      deduped_opening_count: dedupedOpenings.length,
      duplicates_removed: duplicatesRemoved + syntheticCollapsed,
      synthetic_counts_collapsed: syntheticCollapsed,
      small_openings_in_waste: smallOpeningsInWaste,
      multi_view_evidence_version: multiViewEvidence.version,
      unresolved_photo_count: multiViewEvidence.unresolved_photos.length,
      duplicate_photo_count: multiViewEvidence.duplicate_photos.length,
      contradictory_face_count: multiViewEvidence.contradictions.length,
    },
  };
}

export default buildSidingMeasurementGraph;
