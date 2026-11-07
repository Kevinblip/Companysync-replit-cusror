/**
 * Face-level material classification.
 *
 * A single photo's stone/stucco/brick/siding read swings by tens of points
 * between Gemini calls. The measurement is one call per wall face, with every
 * photo of that face in the request, sampled at temperature 0. The billed
 * share is the median of those samples. When a material's share swings by
 * more than 20 points, that face falls back to the materials the other faces
 * confirmed, instead of blending the wild samples.
 *
 * Production samples each face 3 times. The bench uses this same count.
 */

export const PRODUCTION_MATERIAL_SAMPLE_COUNT = 3;
export const FACE_MATERIAL_SPREAD_LIMIT = 20;
/** A stable face confirms a material once it covers at least this much of the wall. */
export const CONFIRMED_MATERIAL_MIN_PERCENT = 5;

export const FACE_MATERIALS = ['stone', 'stucco', 'brick', 'siding'];
export const WALL_FACE_NAMES = ['front', 'back', 'left_side', 'right_side'];

export const FACE_MATERIAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    stone_percent: { type: 'number' },
    stucco_percent: { type: 'number' },
    brick_percent: { type: 'number' },
    siding_percent: { type: 'number' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          material: { type: 'string', enum: ['stone', 'stucco', 'brick', 'siding'] },
          polygon: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
              },
              required: ['x', 'y'],
            },
          },
        },
        required: ['material', 'polygon'],
      },
    },
  },
  required: ['stone_percent', 'stucco_percent', 'brick_percent', 'siding_percent', 'sections'],
};

export function faceMaterialSystemPrompt() {
  return `You classify the cladding on ONE wall face of a house. You are given every available photo of that face, including corner photos that also show a neighboring wall. Reconcile the photos into a single reading of the requested face. Where the photos disagree, decide from the photos that show that face most directly. Do not average a close-up of one material up to the whole wall, and do not let the other wall in a corner photo, or a one-story garage wing, replace the face you were asked about.

Percents are the share of this face from eave to grade. They must sum to 100. Use 0 when a material is not on this face.
- siding: vinyl, aluminum, fiber-cement, wood lap, shake, or board-and-batten
- stone: veneer, cultured stone, ledge stone, or fieldstone
- stucco: cement plaster or EIFS, with no laps and no mortar joints between units
- brick: brick masonry

A wainscot or water table is only that band. Full-height brick or stone is 100 only when that material covers the face.

For every material whose percent is above 0, trace one polygon of that material on this face. x is 0 at the left edge of the face and 1 at the right edge. y is 0 at the eave and 1 at grade. y is negative only for a gable above the eave. Do not trace windows or doors.`;
}

export function faceMaterialUserPrompt(face, photoCount) {
  const label = String(face || 'face').replace(/_/g, ' ');
  const count = Math.max(0, Number(photoCount) || 0);
  return `Classify the ${label} face. ${count} photo${count === 1 ? '' : 's'} of this face follow, in order.
Reconcile them into one reading of the ${label} only.
Return stone_percent, stucco_percent, brick_percent, siding_percent, and one polygon per material that is actually on this face.`;
}

export function canonicalWallFace(raw) {
  const text = String(raw || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (!text || text === 'unknown' || text === 'null') return null;
  if (text === 'front' || text === 'south') return 'front';
  if (text === 'back' || text === 'rear' || text === 'north') return 'back';
  if (text === 'left' || text === 'left_side' || text === 'west') return 'left_side';
  if (text === 'right' || text === 'right_side' || text === 'east') return 'right_side';
  if (text.includes('front')) return 'front';
  if (text.includes('back') || text.includes('rear')) return 'back';
  if (text.includes('left')) return 'left_side';
  if (text.includes('right')) return 'right_side';
  return null;
}

function photoIsDetail(photo) {
  if (photo?.is_detail_shot === true) return true;
  const shot = String(photo?.classification_shot_type || '');
  return shot === 'detail' || shot === 'unknown' || shot === 'not_a_building';
}

/** Every non-detail photo whose primary or secondary face is this wall. */
export function groupPhotosByFace(results) {
  const groups = {};
  for (const photo of Array.isArray(results) ? results : []) {
    if (!photo || photoIsDetail(photo)) continue;
    const faces = new Set();
    const primary = canonicalWallFace(photo.wall_face);
    const secondary = canonicalWallFace(photo.secondary_wall_face);
    if (primary) faces.add(primary);
    if (secondary) faces.add(secondary);
    for (const face of faces) {
      if (!groups[face]) groups[face] = [];
      groups[face].push(photo);
    }
  }
  return groups;
}

function emptyShares() {
  return { stone: 0, stucco: 0, brick: 0, siding: 0 };
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

export function median(values) {
  const sorted = (values || []).map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function pointOf(raw) {
  if (Array.isArray(raw)) return [Number(raw[0]), Number(raw[1])];
  if (raw && typeof raw === 'object') return [Number(raw.x ?? raw[0]), Number(raw.y ?? raw[1])];
  return [NaN, NaN];
}

function polygonOf(raw) {
  const points = (Array.isArray(raw) ? raw : []).map(pointOf).filter((point) => point.every(Number.isFinite));
  return points.length >= 3 ? points : null;
}

function namedMaterial(raw) {
  const text = String(raw || '').toLowerCase();
  if (text.includes('stucco') || text.includes('eifs') || text.includes('plaster')) return 'stucco';
  if (text.includes('stone')) return 'stone';
  if (text.includes('brick')) return 'brick';
  if (text.includes('siding') || text.includes('vinyl') || text.includes('lap')) return 'siding';
  return null;
}

/** Scale a share vector onto 100. A fraction vector (sums near 1) is converted first. */
export function normalizeShareVector(raw) {
  const shares = emptyShares();
  for (const material of FACE_MATERIALS) {
    const value = Number(raw?.[material]);
    if (Number.isFinite(value) && value > 0) shares[material] = value;
  }
  let sum = FACE_MATERIALS.reduce((total, material) => total + shares[material], 0);
  if (!(sum > 0)) return null;
  if (sum <= 1.5) {
    for (const material of FACE_MATERIALS) shares[material] *= 100;
    sum *= 100;
  }
  for (const material of FACE_MATERIALS) shares[material] = (shares[material] * 100) / sum;
  return shares;
}

function sectionsOf(raw, face) {
  const list = Array.isArray(raw?.sections) ? raw.sections : [];
  const sections = [];
  for (const section of list) {
    const material = namedMaterial(section?.material);
    const polygon = polygonOf(section?.polygon);
    if (!material || !polygon) continue;
    sections.push({
      material,
      polygon,
      ...(face ? { wall_face: face } : {}),
    });
  }
  return sections;
}

export function normalizeFaceMaterialSample(raw, face = null) {
  if (!raw || typeof raw !== 'object') return null;
  const fromFields = {
    stone: raw.stone_percent ?? raw.stone,
    stucco: raw.stucco_percent ?? raw.stucco,
    brick: raw.brick_percent ?? raw.brick,
    siding: raw.siding_percent ?? raw.siding,
  };
  const nested = raw.material_shares && typeof raw.material_shares === 'object' ? raw.material_shares : null;
  const shares = normalizeShareVector(fromFields) || (nested ? normalizeShareVector(nested) : null);
  if (!shares) return null;
  return {
    shares,
    sections: sectionsOf(raw, face),
  };
}

function shareDistance(left, right) {
  return FACE_MATERIALS.reduce((total, material) => total + Math.abs((left?.[material] || 0) - (right?.[material] || 0)), 0);
}

/**
 * Median percent per material across the face samples, plus the max-minus-min
 * spread. Polygons come from the sample closest to that median.
 */
export function medianFaceMaterialSamples(samples, face = null) {
  const usable = (Array.isArray(samples) ? samples : [])
    .map((sample) => (sample?.shares ? sample : normalizeFaceMaterialSample(sample, face)))
    .filter(Boolean);
  if (!usable.length) return null;
  const medians = emptyShares();
  const spread = emptyShares();
  for (const material of FACE_MATERIALS) {
    const values = usable.map((sample) => sample.shares[material] || 0);
    medians[material] = median(values);
    spread[material] = round1(Math.max(...values) - Math.min(...values));
  }
  const shares = normalizeShareVector(medians);
  let closest = usable[0];
  let closestDistance = Infinity;
  for (const sample of usable) {
    const distance = shareDistance(sample.shares, shares);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = sample;
    }
  }
  return {
    shares,
    spread,
    spread_max: round1(Math.max(...FACE_MATERIALS.map((material) => spread[material]))),
    sections: (closest.sections || []).map((section) => ({ ...section, ...(face ? { wall_face: face } : {}) })),
    sample_count: usable.length,
    sample_shares: usable.map((sample) => ({ ...sample.shares })),
  };
}

function stableShare(entry, material) {
  if (!entry?.shares) return null;
  if ((Number(entry.spread?.[material]) || 0) > FACE_MATERIAL_SPREAD_LIMIT) return null;
  return Number(entry.shares[material]) || 0;
}

function sampleShowsMasonry(shares) {
  const masonry = (Number(shares?.stone) || 0) + (Number(shares?.stucco) || 0) + (Number(shares?.brick) || 0);
  return masonry > 0;
}

/** Every sample on this face includes stone, stucco, or brick. */
export function everySampleShowsMasonry(entry) {
  const samples = Array.isArray(entry?.sample_shares) ? entry.sample_shares : [];
  return samples.length > 0 && samples.every(sampleShowsMasonry);
}

/**
 * When this face cannot repeat a material within 20 points, use the share
 * confirmed on the other faces. A material no other face confirms is dropped.
 * Faces whose own samples agree keep their median.
 */
export function applyPropertyMaterialPrior(byFace) {
  const faces = byFace && typeof byFace === 'object' ? byFace : {};
  const out = {};
  for (const [face, entry] of Object.entries(faces)) {
    if (!entry?.shares) continue;
    const swinging = FACE_MATERIALS.filter((material) => (Number(entry.spread?.[material]) || 0) > FACE_MATERIAL_SPREAD_LIMIT);
    if (!swinging.length) {
      out[face] = {
        ...entry,
        face,
        billed_from: 'face_sample_median',
        prior_applied: false,
        prior_notes: [],
        review_notes: [],
      };
      continue;
    }
    // A wide spread must not replace a masonry face with the other walls'
    // siding share. Malec's front samples all showed stone and stucco, and
    // the house share (91–100% siding) dropped both.
    if (everySampleShowsMasonry(entry)) {
      out[face] = {
        ...entry,
        face,
        billed_from: 'face_sample_median',
        prior_applied: false,
        prior_notes: [],
        review_notes: [
          `face samples differ by more than ${FACE_MATERIAL_SPREAD_LIMIT} points and every sample shows masonry; billed the face median`,
        ],
      };
      continue;
    }
    const next = { ...entry.shares };
    const notes = [];
    for (const material of swinging) {
      const confirmed = [];
      for (const [otherFace, other] of Object.entries(faces)) {
        if (otherFace === face) continue;
        const share = stableShare(other, material);
        if (share == null || share < CONFIRMED_MATERIAL_MIN_PERCENT) continue;
        confirmed.push(share);
      }
      if (confirmed.length) {
        next[material] = median(confirmed);
        notes.push(`${material} spread ${entry.spread[material]} replaced with the property share ${Math.round(next[material])}`);
      } else {
        next[material] = 0;
        notes.push(`${material} spread ${entry.spread[material]} is not confirmed on the other faces`);
      }
    }
    const shares = normalizeShareVector(next) || emptyShares();
    if (!FACE_MATERIALS.some((material) => shares[material] > 0)) shares.siding = 100;
    out[face] = {
      ...entry,
      face,
      shares,
      billed_from: 'property_prior',
      prior_applied: true,
      prior_notes: notes,
    };
  }
  return out;
}

export function formatFaceMaterialLog(face, classification) {
  const shares = classification?.shares || {};
  const spread = classification?.spread || {};
  const shareText = FACE_MATERIALS
    .map((material) => `${material} ${Math.round(shares[material] || 0)}`)
    .join(' ');
  const spreadText = FACE_MATERIALS
    .map((material) => `${material} ${spread[material] || 0}`)
    .join(', ');
  const how = classification?.billed_from === 'property_prior'
    ? 'property prior'
    : (classification?.billed_from === 'rep_confirmed' ? 'rep confirmed' : 'median');
  const notes = (classification?.prior_notes || []).join('; ');
  return `${String(face).replace(/_/g, ' ')}: face material ${how} from ${classification?.sample_count || 0} samples (${shareText}; spread ${spreadText}${notes ? `; ${notes}` : ''})`;
}

/**
 * Ask the model for each face `sampleCount` times and attach the median,
 * or the property prior, onto every photo of that face.
 */
const PROPOSAL_FACES = ['front', 'back', 'left_side', 'right_side'];

export function formatMaterialProposal(face, shares) {
  const label = String(face || 'face').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const parts = FACE_MATERIALS
    .filter((material) => Math.round(shares?.[material] || 0) > 0)
    .map((material) => `${Math.round(shares[material])}% ${material}`);
  return `${label}: ${parts.join(' / ') || '0% siding'}`;
}

/**
 * One proposal per wall, prefilled from the billed shares. `confirmed` is
 * true only when a rep locked that face and the bill used those percents.
 */
export function materialProposalsFromMap(materialMap) {
  const faces = materialMap?.faces || {};
  return PROPOSAL_FACES.map((face) => {
    const entry = faces[face];
    const shares = emptyShares();
    for (const region of entry?.regions || []) {
      const material = namedMaterial(region?.material);
      if (!material || material === 'trim') continue;
      shares[material] += Number(region.percent) || 0;
    }
    if (FACE_MATERIALS.every((material) => !(shares[material] > 0)) && entry) {
      shares.siding = Number(entry.siding_percent) || 0;
    }
    const normalized = normalizeShareVector(shares) || { ...emptyShares(), siding: 100 };
    const confirmed = entry?.material_agreement?.billed_from === 'rep_confirmed';
    return {
      face,
      label: formatMaterialProposal(face, normalized),
      confirmed,
      shares: normalized,
    };
  });
}

export function confirmedFaceClassifications(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [face, value] of Object.entries(input)) {
    if (!PROPOSAL_FACES.includes(face) || !value || value.confirmed === false) continue;
    const shares = normalizeShareVector(value.shares || value);
    if (!shares) continue;
    out[face] = {
      face,
      shares,
      spread: emptyShares(),
      spread_max: 0,
      sections: [],
      sample_count: PRODUCTION_MATERIAL_SAMPLE_COUNT,
      sample_shares: [],
      photo_count: 0,
      billed_from: 'rep_confirmed',
      confirmed: true,
      prior_applied: false,
      prior_notes: [],
      review_notes: [],
    };
  }
  return out;
}

export async function classifyFaceMaterials({
  results,
  sampleCount = PRODUCTION_MATERIAL_SAMPLE_COUNT,
  imageForResult,
  callModel,
  confirmedByFace = null,
  log = () => {},
} = {}) {
  const groups = groupPhotosByFace(results);
  const count = Math.max(1, Math.min(5, Number(sampleCount) || PRODUCTION_MATERIAL_SAMPLE_COUNT));
  const confirmed = confirmedFaceClassifications(confirmedByFace);
  const measured = {};
  for (const [face, photos] of Object.entries(groups)) {
    if (confirmed[face]) {
      log(`${String(face).replace(/_/g, ' ')}: rep confirmed materials; face classification skipped`);
      continue;
    }
    const images = [];
    for (const photo of photos) {
      const image = typeof imageForResult === 'function' ? imageForResult(photo) : null;
      if (image?.data && image?.mimeType) images.push(image);
    }
    if (!images.length || typeof callModel !== 'function') {
      log(`${String(face).replace(/_/g, ' ')}: face classification skipped; per-photo material reads kept`);
      continue;
    }
    const prompt = faceMaterialUserPrompt(face, images.length);
    const sampleSlots = await Promise.all(Array.from({ length: count }, (_, sampleIndex) => (async () => {
      try {
        const raw = await callModel({
          face,
          images,
          prompt,
          sampleIndex,
          sampleCount: count,
          responseSchema: FACE_MATERIAL_RESPONSE_SCHEMA,
        });
        const normalized = normalizeFaceMaterialSample(raw, face);
        if (!normalized) log(`${String(face).replace(/_/g, ' ')}: material sample ${sampleIndex + 1}/${count} had no material percents`);
        return normalized;
      } catch (err) {
        log(`${String(face).replace(/_/g, ' ')}: material sample ${sampleIndex + 1}/${count} failed (${err?.message || err})`);
        return null;
      }
    })()));
    const samples = sampleSlots.filter(Boolean);
    const medianReading = medianFaceMaterialSamples(samples, face);
    if (!medianReading) {
      log(`${String(face).replace(/_/g, ' ')}: face classification failed; per-photo material reads kept`);
      continue;
    }
    measured[face] = { ...medianReading, photo_count: photos.length, _photos: photos };
  }
  const priorInput = {};
  for (const [face, entry] of Object.entries(measured)) {
    const { _photos, ...rest } = entry;
    priorInput[face] = rest;
  }
  // A confirmed wall is a stable share for the other faces, and it is stamped
  // back over the prior so the rep's percents are the ones that get billed.
  for (const [face, entry] of Object.entries(confirmed)) {
    if (!priorInput[face]) priorInput[face] = entry;
  }
  const reconciled = { ...applyPropertyMaterialPrior(priorInput), ...confirmed };
  for (const [face, classification] of Object.entries(reconciled)) {
    const publicClassification = { ...classification, face };
    const facePhotos = measured[face]?._photos || groups[face];
    const photos = facePhotos && facePhotos.length ? facePhotos : (results || []);
    for (const photo of photos) {
      photo.face_materials = photo.face_materials || {};
      photo.face_materials[face] = publicClassification;
    }
    log(formatFaceMaterialLog(face, publicClassification));
  }
  return reconciled;
}
