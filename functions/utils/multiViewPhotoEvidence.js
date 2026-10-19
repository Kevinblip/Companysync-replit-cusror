/**
 * Multi-view siding photo evidence
 * ───────────────────────────────
 * Pure, deterministic normalization for a set of facade-photo observations.
 *
 * This is intentionally evidence handling, not photogrammetry. It makes the
 * strongest available assignment explicit, keeps uncertain/detail images as
 * supporting evidence, and prevents the same source image from voting twice.
 *
 * @module functions/utils/multiViewPhotoEvidence
 */

import { slotFaces } from './photoSlotOrientation.js';

export const MULTI_VIEW_EVIDENCE_VERSION = '1.0.0';
export const MULTI_VIEW_FACES = ['front', 'back', 'left_side', 'right_side'];

const FACE_ALIASES = {
  front: 'front',
  south: 'front',
  rear: 'back',
  back: 'back',
  north: 'back',
  left: 'left_side',
  west: 'left_side',
  left_side: 'left_side',
  right: 'right_side',
  east: 'right_side',
  right_side: 'right_side',
};

const FACE_LABELS = {
  front: ['front', 'south'],
  back: ['back', 'rear', 'north'],
  left_side: ['left', 'west'],
  right_side: ['right', 'east'],
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, num(value)));
}

function round(value, dp = 2) {
  const p = 10 ** dp;
  return Math.round(num(value) * p) / p;
}

function stableHash(value) {
  let h = 0x811c9dc5;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function normalizeFace(value) {
  const text = String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (!text) return null;
  if (FACE_ALIASES[text]) return FACE_ALIASES[text];
  if (text.includes('front') || text.includes('south')) return 'front';
  if (text.includes('back') || text.includes('rear') || text.includes('north')) return 'back';
  if (text.includes('left') || text.includes('west')) return 'left_side';
  if (text.includes('right') || text.includes('east')) return 'right_side';
  return null;
}

function labelFaces(label) {
  const fromSlot = slotFaces(label);
  if (fromSlot.length > 0) return fromSlot;
  const text = String(label || '').toLowerCase().trim();
  const corner = /corner|angle/.test(text)
    || /\b[fb][lr]\b/.test(text)
    || /(?:front|back|rear)[\s_-]*(?:left|right)/.test(text);
  if (!corner) {
    const face = normalizeFace(text);
    return face ? [face] : [];
  }

  const faces = [];
  const add = (face) => { if (face && !faces.includes(face)) faces.push(face); };
  if (/\bfl\b|front[\s_-]*left|left[\s_-]*front/.test(text)) {
    add('front'); add('left_side');
  } else if (/\bfr\b|front[\s_-]*right|right[\s_-]*front/.test(text)) {
    add('front'); add('right_side');
  } else if (/\bbl\b|back[\s_-]*left|rear[\s_-]*left|left[\s_-]*back/.test(text)) {
    add('back'); add('left_side');
  } else if (/\bbr\b|back[\s_-]*right|rear[\s_-]*right|right[\s_-]*back/.test(text)) {
    add('back'); add('right_side');
  } else {
    // A generic angle with no named corner is unresolved rather than guessed.
    const face = normalizeFace(text.replace(/corner|angle/g, ''));
    add(face);
  }
  return faces;
}

function confidenceFor(result) {
  const raw = result?.confidence ?? result?.confidence_score ?? result?.detection_confidence;
  if (raw == null) return 0.5;
  const value = num(raw);
  return clamp01(value > 1 ? value / 100 : value);
}

function isDetailResult(result, label, evidence) {
  const shotType = String(
    result?.classification_shot_type || result?.shot_type || '',
  ).toLowerCase();
  const labelText = String(label || '').toLowerCase();
  return result?.is_detail_shot === true
    || ['detail', 'unknown', 'not_a_building'].includes(shotType)
    || /detail|close.?up|close up|roof.?only|other/.test(labelText)
    || evidence.includes('close_up')
    || evidence.includes('roof_only')
    || evidence.includes('not_building');
}

function isCornerResult(result, label, evidence, faces) {
  const shotType = String(
    result?.classification_shot_type || result?.shot_type || '',
  ).toLowerCase();
  return result?.is_corner_shot === true
    || shotType === 'corner'
    || /corner|angle/.test(String(label || '').toLowerCase())
    || evidence.includes('two_wall_planes')
    || evidence.includes('visible_corner')
    || faces.length > 1;
}

function sourceKeyFor(result, index) {
  const explicit = result?.photo_key
    ?? result?.photo_id
    ?? result?.perceptual_hash
    ?? result?.photo_perceptual_hash
    ?? result?.image_hash
    ?? result?.photo_hash
    ?? result?.source_key;
  if (explicit != null && String(explicit).trim()) return `key:${String(explicit)}`;
  const url = result?.photo_ref ?? result?.image_url ?? result?.url;
  if (url != null && String(url).trim()) return `url:${String(url)}`;
  // No key means this is a distinct observation by construction. Using the
  // index prevents two independently captured same-label frames collapsing.
  return `index:${index}`;
}

function perceptualHashFor(result) {
  const value = result?.perceptual_hash
    ?? result?.photo_perceptual_hash
    ?? result?.image_hash
    ?? result?.photo_hash
    ?? null;
  const normalized = String(value || '').trim().toLowerCase().replace(/^dhash:/, '');
  return /^[0-9a-f]{16}$/.test(normalized) ? normalized : null;
}

function hammingDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < left.length; i++) {
    let bits = parseInt(left[i], 16) ^ parseInt(right[i], 16);
    while (bits) {
      distance += bits & 1;
      bits >>>= 1;
    }
  }
  return distance;
}

function canonicalPhotoId(result, index) {
  const label = result?.view_label ?? result?.label ?? '';
  // The source key is the duplicate identity; the index distinguishes two
  // records carrying the same source so the lower-confidence audit record can
  // point at the winner instead of sharing its ID.
  return `mv_photo_${stableHash(`${sourceKeyFor(result, index)}|${label}|${index}`)}`;
}

function explicitDuplicate(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.duplicate_of != null) return String(result.duplicate_of);
  if (result.near_duplicate_of != null) return String(result.near_duplicate_of);
  if (result.is_duplicate === true || result.near_duplicate === true) return 'explicit';
  return null;
}

function choosePrimaryFace(faces, result, labelFaces) {
  const explicit = normalizeFace(result?.wall_face ?? result?.face);
  if (explicit && faces.includes(explicit)) return explicit;
  if (labelFaces.length > 0) return labelFaces[0];
  return faces[0] || null;
}

function assignmentFor(result, label, faces, labelFaceSet, detail) {
  if (detail) return { faces: [], primaryFace: null, source: 'detail', conflict: false };

  const rawFace = normalizeFace(result?.wall_face ?? result?.face);
  const hasExif = Number.isFinite(Number(result?.exif_heading_deg))
    && Number.isFinite(Number(result?.exif_face_angular_error_deg));
  const exifTrusted = hasExif && Number(result.exif_face_angular_error_deg) <= 40;
  if (exifTrusted && rawFace) {
    if (labelFaceSet.length > 0 && !labelFaceSet.includes(rawFace)) {
      return {
        faces: labelFaceSet,
        primaryFace: labelFaceSet[0],
        source: 'slot_label',
        conflict: false,
        visual_face_disagreed: true,
        conflict_faces: [rawFace, ...labelFaceSet],
      };
    }
    const exifFaces = isCornerResult(result, label, [], faces) && faces.length > 1
      ? faces
      : [rawFace];
    return {
      faces: exifFaces,
      primaryFace: rawFace,
      source: 'exif_footprint',
      conflict: false,
    };
  }

  // A named uploader slot is the street-facing convention and is stronger
  // than a visual wall_face. A model that names the opposite side (left and
  // right swapped, or front called back) must not move the measurement.
  // The disagreement stays on the record; the slot still covers its wall.
  if (labelFaceSet.length > 0 && rawFace && !labelFaceSet.includes(rawFace)) {
    return {
      faces: labelFaceSet,
      primaryFace: labelFaceSet[0],
      source: 'slot_label',
      conflict: false,
      visual_face_disagreed: true,
      conflict_faces: [rawFace, ...labelFaceSet],
    };
  }

  const assigned = labelFaceSet.length > 0 ? labelFaceSet : (rawFace ? [rawFace] : []);
  return {
    faces: assigned,
    primaryFace: choosePrimaryFace(assigned, result, labelFaceSet),
    source: labelFaceSet.length > 0 ? 'slot_label' : (rawFace ? 'explicit_face' : 'unresolved'),
    conflict: false,
  };
}

function normalizeObservation(result, index) {
  const label = String(result?.view_label ?? result?.label ?? '').trim();
  const evidence = Array.isArray(result?.classification_evidence)
    ? result.classification_evidence.filter(item => typeof item === 'string').slice(0, 8)
    : [];
  const labelFacesFound = labelFaces(label);
  const detail = isDetailResult(result, label, evidence);
  const corner = isCornerResult(result, label, evidence, labelFacesFound);
  const suppliedCornerFaces = Array.isArray(result?.corner_faces)
    ? result.corner_faces.map(normalizeFace).filter(Boolean)
    : [];
  const candidateFaces = suppliedCornerFaces.length > 0 ? suppliedCornerFaces : labelFacesFound;
  const assignment = assignmentFor(result, label, candidateFaces, labelFacesFound, detail);
  const sourceType = String(result?.source_type ?? result?.sourceType ?? '').toLowerCase() || 'uploaded';
  const confidence = confidenceFor(result);
  const sourceKey = sourceKeyFor(result, index);

  return {
    photo_id: canonicalPhotoId(result, index),
    photo_index: index,
    label: label || `Photo ${index + 1}`,
    source_type: sourceType,
    panorama_id: result?.panorama_id ?? result?.panoramaId ?? result?.pano_id ?? null,
    source_key: sourceKey,
    confidence: round(confidence, 3),
    faces: assignment.faces,
    primary_face: assignment.primaryFace,
    assignment_source: assignment.source,
    assignment_conflict: assignment.conflict,
    visual_face_disagreed: assignment.visual_face_disagreed === true,
    conflict_faces: assignment.conflict_faces || [],
    is_corner: corner,
    is_detail: detail,
    is_street_view: sourceType === 'street_view',
    verified_elevation: result?.verified_elevation === true,
    occluded: result?.occluded === true || evidence.includes('obstructed'),
    evidence,
    reason: String(result?.classification_reason ?? result?.reason ?? '').trim().slice(0, 240),
    duplicate_of: explicitDuplicate(result),
    duplicate_reason: null,
    perceptual_hash: perceptualHashFor(result),
    status: detail ? 'supporting_detail' : assignment.conflict ? 'unresolved' : 'accepted',
    wall_width_ft: num(result?.wall_width_ft, 0) || null,
    wall_height_ft: num(result?.wall_height_ft ?? result?.eave_height_ft, 0) || null,
    heading_deg: Number.isFinite(Number(result?.heading_deg)) ? Number(result.heading_deg) : null,
  };
}

function identityToken(record) {
  // An identical file under two labels is one photo, whatever the panorama
  // id says. A Street View panorama is one 360 capture: different headings
  // and different walls are different elevations and must not collapse.
  if (!record.source_key.startsWith('index:')) return record.source_key;
  if (record.panorama_id != null) {
    const face = record.primary_face || 'unknown';
    const heading = Number(record.heading_deg);
    const bucket = Number.isFinite(heading) ? Math.round(heading / 20) : 'na';
    return `pano:${record.panorama_id}|${face}|${bucket}`;
  }
  return null;
}

function unionFind(size) {
  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  return { find, union };
}

function robustRange(values) {
  const usable = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (usable.length === 0) return {
    reading_count: 0,
    fused: null,
    min: null,
    max: null,
    spread_pct: null,
    contradictory: false,
  };
  const mid = Math.floor(usable.length / 2);
  const median = usable.length % 2
    ? usable[mid]
    : (usable[mid - 1] + usable[mid]) / 2;
  const spreadPct = median > 0 ? (usable[usable.length - 1] - usable[0]) / median * 100 : 0;
  return {
    reading_count: usable.length,
    fused: round(median, 2),
    min: round(usable[0], 2),
    max: round(usable[usable.length - 1], 2),
    spread_pct: round(spreadPct, 1),
    contradictory: usable.length >= 2 && spreadPct > 20 && (usable[usable.length - 1] - usable[0]) > 2,
  };
}

function buildFaceSummaries(records) {
  return MULTI_VIEW_FACES.map(face => {
    const useful = records.filter(record =>
      record.status === 'accepted'
      && !record.is_detail
      && (!record.is_street_view || record.verified_elevation)
      && record.faces.includes(face),
    );
    const straight = useful.filter(record => !record.is_corner);
    const corners = useful.filter(record => record.is_corner);
    const primaryCorners = corners.filter(record => record.primary_face === face);
    const dimensionRecords = straight.length > 0 ? straight : primaryCorners;
    const widths = robustRange(dimensionRecords.map(record => record.wall_width_ft));
    const heights = robustRange((straight.length > 0 ? straight : primaryCorners)
      .map(record => record.wall_height_ft));
    const confidence = useful.length > 0
      ? round(useful.reduce((sum, record) => sum + record.confidence, 0) / useful.length, 3)
      : null;
    return {
      face,
      covered: useful.length > 0,
      straight_elevation_count: straight.length,
      corner_overlap_count: corners.length,
      photo_count: useful.length,
      confidence,
      width_ft: widths.fused,
      width_range_ft: widths.reading_count > 1 ? [widths.min, widths.max] : null,
      height_ft: heights.fused,
      height_range_ft: heights.reading_count > 1 ? [heights.min, heights.max] : null,
      width_spread_pct: widths.spread_pct,
      height_spread_pct: heights.spread_pct,
      contradictory_dimensions: widths.contradictory || heights.contradictory,
    };
  });
}

/**
 * Normalize and fuse photo-level evidence without inspecting image pixels.
 * Callers may provide image hashes or explicit near_duplicate_of values from a
 * classifier; labels alone never make two straight photos duplicates.
 */
export function buildMultiViewPhotoEvidence(perPhotoResults = []) {
  const records = (Array.isArray(perPhotoResults) ? perPhotoResults : [])
    .map(normalizeObservation);

  // Group exact source identities first, then join hashes that are close
  // enough to represent the same image after resizing/re-encoding. This is
  // intentionally source-level rather than face-level: a copied image under
  // "Front" and "Left" must leave one of those elevations uncovered.
  const identities = unionFind(records.length);
  const tokenOwners = new Map();
  records.forEach((record, index) => {
    const token = identityToken(record);
    if (!token) return;
    const prior = tokenOwners.get(token);
    if (prior != null) identities.union(prior, index);
    else tokenOwners.set(token, index);
  });
  const HASH_DISTANCE_THRESHOLD = 8;
  for (let left = 0; left < records.length; left++) {
    if (!records[left].perceptual_hash) continue;
    for (let right = left + 1; right < records.length; right++) {
      if (!records[right].perceptual_hash) continue;
      if (hammingDistance(records[left].perceptual_hash, records[right].perceptual_hash)
        <= HASH_DISTANCE_THRESHOLD) {
        identities.union(left, right);
      }
    }
  }
  const identityWinners = new Map();
  records.forEach((record, index) => {
    const root = identities.find(index);
    const current = identityWinners.get(root);
    if (!current || record.confidence > current.confidence) identityWinners.set(root, record);
  });

  const byExplicitId = new Map(records.map(record => [record.photo_id, record]));
  const duplicateRecords = [];
  for (const [index, record] of records.entries()) {
    const winner = identityWinners.get(identities.find(index)) || null;
    const explicit = record.duplicate_of;
    const explicitTarget = explicit && byExplicitId.get(explicit);
    if (explicitTarget && explicitTarget.photo_id !== record.photo_id) {
      record.status = 'duplicate';
      record.duplicate_reason = 'explicit_near_duplicate';
      record.duplicate_of = explicitTarget.photo_id;
      record.duplicate_label = explicitTarget.label;
      record.duplicate_photo_index = explicitTarget.photo_index;
    } else if (explicit && !explicitTarget) {
      // A classifier may provide a source-level near-duplicate marker without
      // knowing our generated audit ID. Pair it with the prior accepted
      // observation on the same primary face, never with a different wall.
      const prior = records.find(candidate =>
        candidate !== record
        && candidate.photo_index < record.photo_index
        && candidate.status === 'accepted'
        && candidate.primary_face != null
        && candidate.primary_face === record.primary_face,
      );
      if (prior) {
        record.status = 'duplicate';
        record.duplicate_reason = 'explicit_near_duplicate';
        record.duplicate_of = prior.photo_id;
        record.duplicate_label = prior.label;
        record.duplicate_photo_index = prior.photo_index;
      }
    } else if (winner && winner.photo_id !== record.photo_id) {
      record.status = 'duplicate';
      record.duplicate_reason = record.panorama_id != null
        ? 'same_panorama'
        : (record.perceptual_hash && winner.perceptual_hash
          ? (hammingDistance(record.perceptual_hash, winner.perceptual_hash) === 0
            ? 'same_perceptual_hash'
            : 'near_identical_photo')
          : 'same_source');
      record.duplicate_of = winner.photo_id;
      record.duplicate_label = winner.label;
      record.duplicate_photo_index = winner.photo_index;
    }
    if (record.status === 'duplicate') duplicateRecords.push(record);
  }

  const faceSummaries = buildFaceSummaries(records);
  const coveredFaces = faceSummaries.filter(summary => summary.covered).map(summary => summary.face);
  const missingFaces = MULTI_VIEW_FACES.filter(face => !coveredFaces.includes(face));
  const unresolved = records.filter(record =>
    record.status === 'unresolved' || record.assignment_conflict,
  );
  const details = records.filter(record => record.status === 'supporting_detail');
  const contradictions = faceSummaries
    .filter(summary => summary.contradictory_dimensions)
    .map(summary => ({
      code: 'conflicting_face_dimensions',
      face: summary.face,
      width_range_ft: summary.width_range_ft,
      height_range_ft: summary.height_range_ft,
      message: `${summary.face} photos disagree materially on wall dimensions.`,
    }));

  const warnings = [];
  for (const record of unresolved) {
    warnings.push({
      code: 'unresolved_photo_face',
      photo_index: record.photo_index,
      label: record.label,
      message: `${record.label} has conflicting or insufficient face evidence and was not used as a wall anchor.`,
    });
  }
  for (const record of records) {
    if (record.visual_face_disagreed) {
      warnings.push({
        code: 'slot_overrides_visual_face',
        photo_index: record.photo_index,
        label: record.label,
        message: `${record.label} keeps the street-facing slot (${record.faces.join(', ')}). The visual face ${record.conflict_faces[0] || 'reading'} disagreed and was not used.`,
      });
    }
  }
  for (const record of duplicateRecords) {
    warnings.push({
      code: 'duplicate_photo_observation',
      photo_index: record.photo_index,
      label: record.label,
      duplicate_of: record.duplicate_of,
      duplicate_label: record.duplicate_label || null,
      duplicate_photo_index: record.duplicate_photo_index ?? null,
      message: record.duplicate_label
        ? `${record.label} and ${record.duplicate_label} appear to be the same photo; ${record.label} is not counted as elevation coverage.`
        : `${record.label} is supporting evidence only; the same source view was already represented.`,
    });
  }
  for (const record of details) {
    warnings.push({
      code: 'detail_photo_supporting_only',
      photo_index: record.photo_index,
      label: record.label,
      message: `${record.label} supports material/opening review but is not a whole-wall scale anchor.`,
    });
  }
  for (const contradiction of contradictions) warnings.push(contradiction);

  const nextPhotos = missingFaces.map(face => ({
    face,
    label: face.replace('_side', ' side'),
    reason: `Add a straight-on ${face.replace('_side', ' side')} elevation.`,
  }));
  const hasCornerOverlap = records.some(record =>
    record.status === 'accepted' && record.is_corner && record.faces.length > 1,
  );
  if (!hasCornerOverlap && coveredFaces.length > 0) {
    nextPhotos.push({
      face: 'corner_overlap',
      label: 'nearest useful corner',
      reason: 'Add a corner view showing two wall planes so boundaries can be cross-checked.',
    });
  }

  const qualityPenalty = Math.min(
    0.45,
    0.08 * unresolved.length + 0.04 * duplicateRecords.length + 0.06 * contradictions.length,
  );
  const coverageConfidence = round(
    clamp01((MULTI_VIEW_FACES.length - missingFaces.length) / MULTI_VIEW_FACES.length - qualityPenalty),
    3,
  );

  let status = missingFaces.length === 0 ? 'complete' : 'incomplete';
  if (missingFaces.length === 1 || contradictions.length > 0 || unresolved.length > 0) {
    status = 'review_required';
  }

  return {
    version: MULTI_VIEW_EVIDENCE_VERSION,
    // Do not return source keys or URLs. The stable photo_id is enough for
    // provenance and duplicate links without echoing signed object-storage
    // URLs into the measurement graph.
    photos: records.map(({ source_key, ...record }) => record),
    faces: faceSummaries,
    covered_faces: coveredFaces.sort(),
    missing_faces: missingFaces,
    unresolved_photos: unresolved.map(record => record.photo_id),
    detail_photos: details.map(record => record.photo_id),
    duplicate_photos: duplicateRecords.map(record => record.photo_id),
    rejected_observations: [
      ...unresolved.map(record => record.photo_id),
      ...duplicateRecords.map(record => record.photo_id),
    ],
    duplicates_removed: duplicateRecords.length,
    contradictions,
    next_recommended_photos: nextPhotos,
    confidence: coverageConfidence,
    status,
    review_required: status !== 'complete',
    warnings,
  };
}

export default buildMultiViewPhotoEvidence;