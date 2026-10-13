/**
 * Batch photo → grid slot assignment.
 *
 * Extracted from AIEstimator so the one invariant that matters here can be
 * tested directly: **an uploaded photo is never discarded.** Contractors upload
 * a dozen shots at a time, and earlier versions of this logic dropped any photo
 * the classifier failed to mention, plus everything past the second detail slot
 * — silently, while reporting success.
 */

/** Slots that represent a distinct face of the building. One photo each. */
export const MAIN_SLOTS = [
  'Front',
  'Back',
  'Left Side',
  'Right Side',
  'FL Corner',
  'FR Corner',
  'BL Corner',
  'BR Corner',
  'Garage',
];

export const CLASSIFIER_CONFIDENCE_FLOOR = 70;

const STRAIGHT_FACE_SLOTS = new Set([
  'Front',
  'Back',
  'Left Side',
  'Right Side',
  'Garage',
]);

const CORNER_SLOTS = new Set([
  'FL Corner',
  'FR Corner',
  'BL Corner',
  'BR Corner',
]);

const DETAIL_SHOT_TYPES = new Set(['detail', 'unknown', 'not_a_building']);

/**
 * Normalize the classifier response while keeping compatibility with the
 * original label-only Map used by older callers and tests.
 */
export function normalizePhotoClassification(raw) {
  if (typeof raw === 'string') {
    return {
      label: raw,
      confidence: 100,
      shot_type: null,
      evidence: [],
      reason: '',
      legacy: true,
    };
  }
  if (!raw || typeof raw !== 'object') return null;
  const confidence = Number(raw.confidence);
  return {
    label: typeof raw.label === 'string' ? raw.label.trim() : '',
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
    shot_type: typeof raw.shot_type === 'string' ? raw.shot_type : 'unknown',
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.filter(item => typeof item === 'string').slice(0, 8)
      : [],
    reason: typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 240) : '',
    legacy: false,
  };
}

function isTrustedClassification(classification) {
  return classification?.legacy === true
    || (classification?.confidence >= CLASSIFIER_CONFIDENCE_FLOOR
      && !DETAIL_SHOT_TYPES.has(classification?.shot_type));
}

function acceptedSlotForClassification(classification) {
  if (!classification || !isTrustedClassification(classification)) return 'Detail';
  const { label, shot_type } = classification;
  if (!MAIN_SLOTS.includes(label)) return 'Detail';
  if (CORNER_SLOTS.has(label)) return shot_type === 'corner' || classification.legacy ? label : 'Detail';
  if (STRAIGHT_FACE_SLOTS.has(label)) {
    return shot_type === 'straight_elevation' || classification.legacy ? label : 'Detail';
  }
  return 'Detail';
}

function photoWithClassification(upload, classification, label) {
  return {
    url: upload.url,
    label,
    name: upload.name,
    preview: upload.preview,
    perceptual_hash: upload.perceptual_hash || null,
    classification_confidence: classification?.legacy ? null : classification?.confidence ?? null,
    classification_shot_type: classification?.shot_type || null,
    classification_evidence: classification?.evidence || [],
    classification_reason: classification?.reason || '',
    classification_review_required: label === 'Detail' && !classification?.legacy,
  };
}

/**
 * Split a batch of uploads into face slots + overflow.
 *
 * Iterates the UPLOADS rather than the classifier's response, so a photo the
 * model never returned a label for still gets a home.
 *
 * @param {Array<{url:string,name?:string,preview?:string,index:number}>} uploads
 * @param {Map<number,string|object>} labelByUpload  upload.index → raw classification from the AI
 * @returns {{assigned: Array<object>, overflow: Array<object>}}
 */
export function splitBatchIntoSlots(uploads, labelByUpload) {
  const labels = labelByUpload instanceof Map ? labelByUpload : new Map();
  const bySlot = new Map();
  const overflow = [];

  for (const upload of uploads || []) {
    if (!upload || !upload.url) continue;
    const classification = normalizePhotoClassification(labels.get(upload.index));
    const label = acceptedSlotForClassification(classification);
    const photo = photoWithClassification(upload, classification, label);
    if (label === 'Detail' || bySlot.has(label)) {
      // A second shot of the same wall, a close-up, or an angle the AI could
      // not read. Still a photo the contractor deliberately took.
      overflow.push(photo);
    } else {
      bySlot.set(label, photo);
    }
  }

  return { assigned: [...bySlot.values()], overflow };
}

/**
 * Merge a split batch into the existing photo list.
 *
 * Face slots replace whatever occupied them. Overflow photos each receive their
 * own numbered Detail slot, skipping any number already taken, so the grid grows
 * to fit the batch instead of truncating it.
 *
 * @param {Array<object>} existing  current housePhotos
 * @param {Array<object>} assigned  face-slot photos from splitBatchIntoSlots
 * @param {Array<object>} overflow  everything else
 * @returns {Array<object>} the new housePhotos list
 */
export function mergeIntoPhotos(existing, assigned, overflow) {
  const merged = [...(existing || [])];
  const protectedManual = (photo) =>
    photo?.manually_assigned === true
    || photo?.user_assigned === true
    || photo?.source === 'manual';
  const detailsToAppend = [...(overflow || [])];

  for (const photo of assigned || []) {
    const idx = merged.findIndex(p => p?.label === photo.label);
    if (idx >= 0 && protectedManual(merged[idx]) && !protectedManual(photo)) {
      // A low/AI-confidence batch result must never silently replace a slot
      // the contractor deliberately filled or corrected.
      detailsToAppend.push({ ...photo, label: 'Detail' });
    } else if (idx >= 0) merged[idx] = photo;
    else merged.push(photo);
  }

  // Occupied-label set + a monotonic cursor: scanning `merged` per overflow
  // photo would be O(n²) on a large batch.
  const taken = new Set(merged.map(p => p?.label));
  let n = 1;
  for (const u of detailsToAppend) {
    while (taken.has(`Detail ${n}`)) n++;
    const label = `Detail ${n}`;
    taken.add(label);
    merged.push({ ...u, label });
    n++;
  }

  return merged;
}

/**
 * How many Detail slots the grid must render to show every detail photo present.
 * Always at least 2, so empty slots still invite an upload.
 */
export function detailSlotCount(photos) {
  return Math.max(
    2,
    ...(photos || []).map(p => {
      const m = /^Detail (\d+)$/.exec(p?.label || '');
      return m ? parseInt(m[1], 10) : 0;
    }),
  );
}
