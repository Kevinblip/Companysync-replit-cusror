'use strict';

/**
 * photoUsabilityGate.cjs
 *
 * Shared verdict for "can this frame actually be measured?", plus the bounded
 * recapture plan used when an auto-fetched Street View frame is rejected.
 *
 * Why this module exists
 * ----------------------
 * Google's Street View static frames are aimed geometrically (a bearing from a
 * road panorama toward the house centroid). That aim is often blocked by
 * something the geometry cannot know about: a mature street tree, a camera
 * pitch that lands on sky above a short house, or a nearer neighbouring house
 * that occupies the frame instead of the subject.
 *
 * Detecting that and refusing to measure is honest but lossy — a wooded lot can
 * drop from four usable angles to one, which widens the estimate's error range.
 * Google usually holds OTHER panoramas of the same house from a different
 * position, and the same panorama can be re-aimed. So a rejection should
 * trigger a bounded recapture before the wall is reported unmeasured.
 *
 * Both halves live here so the verdict that triggers a retry and the retry plan
 * itself cannot drift apart, and so they can be unit-tested without Google, the
 * AI provider, or a browser.
 */

// ── Frame subject categories the vision model reports ───────────────────────
// 'subject_building' is the only value that permits measurement.
const FRAME_SUBJECTS = [
  'subject_building',
  'foliage',
  'sky',
  'other_building',
  'obstructed',
  'unclear',
];

const REJECTION_REASON_LABELS = {
  foliage: 'Trees or foliage block the wall',
  sky: 'Frame is mostly sky, not the wall',
  other_building: 'Frame shows a different building',
  obstructed: 'The wall is blocked by vehicles, fences, or structures',
  unclear: 'The frame is too unclear to measure',
};

/**
 * A frame must show at least this much of the subject wall to be measured.
 * Below this the width/height scale is guesswork even when the right house is
 * technically in frame.
 */
const MIN_SUBJECT_VISIBLE_PCT = 35;

/**
 * Per-wall attempt ceiling. Each attempt that actually produces a new frame
 * costs one Gemini vision call, so this is the per-wall cost multiplier.
 */
const MAX_RECAPTURE_ATTEMPTS = 2;

/**
 * Whole-request ceiling on recapture vision calls. Without this, an address
 * where every angle is blocked (a house behind mature trees on all four sides)
 * would multiply both AI spend and wall-clock latency by the per-wall ceiling.
 * A hopeless address is allowed to be hopeless.
 */
const MAX_TOTAL_RECAPTURE_ANALYSES = 4;

function normalizeFrameSubject(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (FRAME_SUBJECTS.includes(normalized)) return normalized;
  // Tolerate near-miss spellings from the model rather than silently treating
  // an unrecognised rejection as "measurable".
  if (/^(trees?|foliage|vegetation|bush(es)?|hedge)$/.test(normalized)) return 'foliage';
  if (/^(sky|clouds?|overhead)$/.test(normalized)) return 'sky';
  if (/(neighbou?r|adjacent|wrong_house|different_building|other_house)/.test(normalized)) return 'other_building';
  if (/(blocked|occluded|obstruct|vehicle|fence)/.test(normalized)) return 'obstructed';
  if (/(subject|target|house|building|facade|elevation|wall)/.test(normalized)) return 'subject_building';
  return null;
}

function finitePct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/**
 * Decide whether a single analyzed frame may be used as a wall measurement.
 *
 * Fails CLOSED on an explicit rejection category, and fails OPEN when the model
 * simply did not report a subject at all. The open case matters: contractor
 * uploads predate this field, and refusing to measure a perfectly good uploaded
 * photo because the response lacked one key would be a much worse regression
 * than the problem being fixed.
 *
 * @param {object|null} analysis  per-photo vision result
 * @param {object} [opts]
 * @param {string} [opts.label]       wall label, for the human-readable detail
 * @param {string} [opts.sourceType]  'street_view' | 'uploaded'
 * @returns {{usable: boolean, reason: string|null, detail: string, subject: string|null, subject_visible_pct: number|null}}
 */
function evaluateFrameUsability(analysis, { label = '', sourceType = 'uploaded' } = {}) {
  const wall = label ? `${label}` : 'This wall';

  if (!analysis || typeof analysis !== 'object') {
    return {
      usable: false,
      reason: 'unclear',
      detail: `${wall}: no measurable result came back for this frame.`,
      subject: null,
      subject_visible_pct: null,
    };
  }

  const subject = normalizeFrameSubject(analysis.frame_subject);
  const visiblePct = finitePct(analysis.subject_visible_pct);

  if (subject && subject !== 'subject_building') {
    return {
      usable: false,
      reason: subject,
      detail: `${wall}: ${REJECTION_REASON_LABELS[subject]}.`,
      subject,
      subject_visible_pct: visiblePct,
    };
  }

  // An explicit "not a building" reading is a rejection regardless of subject.
  if (String(analysis.building_type ?? '').toLowerCase() === 'not_a_building') {
    return {
      usable: false,
      reason: 'unclear',
      detail: `${wall}: the frame does not show a building.`,
      subject: subject || 'unclear',
      subject_visible_pct: visiblePct,
    };
  }

  if (subject === 'subject_building' && visiblePct != null && visiblePct < MIN_SUBJECT_VISIBLE_PCT) {
    return {
      usable: false,
      reason: 'obstructed',
      detail: `${wall}: only about ${Math.round(visiblePct)}% of the wall is visible.`,
      subject,
      subject_visible_pct: visiblePct,
    };
  }

  // Street View frames are machine-aimed, so a zeroed wall with no height read
  // is a framing failure rather than a cautious measurement. An uploaded photo
  // with the same shape was a deliberate human choice (a detail/close-up), so
  // it is left alone.
  if (sourceType === 'street_view'
      && !(Number(analysis.wall_width_ft) > 0)
      && !(Number(analysis.eave_height_ft) > 0)) {
    return {
      usable: false,
      reason: 'unclear',
      detail: `${wall}: nothing measurable was visible in this frame.`,
      subject: subject || 'unclear',
      subject_visible_pct: visiblePct,
    };
  }

  return {
    usable: true,
    reason: null,
    detail: `${wall}: frame is measurable.`,
    subject: subject || null,
    subject_visible_pct: visiblePct,
  };
}

/** Only auto-fetched frames can be re-fetched; an uploaded photo is all we have. */
function shouldRecapture({ sourceType, verdict } = {}) {
  return sourceType === 'street_view' && !!verdict && verdict.usable === false;
}

/**
 * Recapture strategies, keyed by WHY the frame failed. Each reason has a
 * physically different remedy — re-aiming a camera that is buried in a tree
 * does nothing, and walking down the street does nothing when the problem is
 * that the camera is tilted at the sky.
 *
 * search_distance_m — how far from the house to look for a road panorama.
 *                     Changing it is what finds an ADJACENT panorama.
 * heading_offset_deg — applied on top of the recomputed pano→house bearing.
 * pitch_deg / fov_deg — reframing of the same viewpoint.
 */
const RECAPTURE_STRATEGIES = {
  // Move to a different vantage point; the obstruction is fixed in space.
  foliage: [
    { strategy: 'adjacent_panorama', search_distance_m: 45, search_radius_m: 40, heading_offset_deg: 0, pitch_deg: 15, fov_deg: 70 },
    { strategy: 'distant_panorama', search_distance_m: 115, search_radius_m: 60, heading_offset_deg: 18, pitch_deg: 8, fov_deg: 80 },
  ],
  obstructed: [
    { strategy: 'adjacent_panorama', search_distance_m: 50, search_radius_m: 40, heading_offset_deg: -15, pitch_deg: 12, fov_deg: 75 },
    { strategy: 'distant_panorama', search_distance_m: 110, search_radius_m: 60, heading_offset_deg: 20, pitch_deg: 6, fov_deg: 85 },
  ],
  // The viewpoint is fine, the aim is above the roof. Tilt down and widen.
  sky: [
    { strategy: 'lowered_pitch', search_distance_m: 80, search_radius_m: 80, heading_offset_deg: 0, pitch_deg: 0, fov_deg: 75 },
    { strategy: 'lowered_pitch_closer', search_distance_m: 45, search_radius_m: 40, heading_offset_deg: 0, pitch_deg: -5, fov_deg: 85 },
  ],
  // A nearer house is filling the frame. Get closer to the subject and narrow
  // the field of view so the subject dominates.
  other_building: [
    { strategy: 'narrowed_closer', search_distance_m: 38, search_radius_m: 30, heading_offset_deg: 0, pitch_deg: 10, fov_deg: 45 },
    { strategy: 'narrowed_reaimed', search_distance_m: 60, search_radius_m: 45, heading_offset_deg: 0, pitch_deg: 10, fov_deg: 40 },
  ],
  unclear: [
    { strategy: 'reaimed', search_distance_m: 55, search_radius_m: 45, heading_offset_deg: 22, pitch_deg: 12, fov_deg: 70 },
    { strategy: 'reaimed_opposite', search_distance_m: 95, search_radius_m: 60, heading_offset_deg: -22, pitch_deg: 8, fov_deg: 80 },
  ],
};

/**
 * Build the capture parameters for one recapture attempt.
 *
 * @param {object} opts
 * @param {number} opts.attempt  1-based attempt number
 * @param {string} opts.reason   rejection reason from evaluateFrameUsability
 * @returns {object|null} plan, or null when the attempt budget is exhausted
 */
function buildRecapturePlan({ attempt, reason } = {}) {
  const n = Number(attempt);
  if (!Number.isInteger(n) || n < 1 || n > MAX_RECAPTURE_ATTEMPTS) return null;
  const ladder = RECAPTURE_STRATEGIES[reason] || RECAPTURE_STRATEGIES.unclear;
  const step = ladder[n - 1];
  if (!step) return null;
  return { attempt: n, reason: reason || 'unclear', ...step };
}

/**
 * Identity of a capture, used to guarantee each attempt is genuinely different.
 * Keyed on more than the panorama id because re-aiming the SAME panorama (a
 * different heading, pitch, or field of view) is a legitimate alternative — it
 * is exactly the remedy for a sky-filled or neighbour-filled frame.
 */
function captureFingerprint({ panoId, heading, pitch, fov } = {}) {
  const round = (v, step) => Math.round((Number(v) || 0) / step) * step;
  return [
    String(panoId || 'none'),
    round(((Number(heading) || 0) % 360 + 360) % 360, 5),
    round(pitch, 5),
    round(fov, 5),
  ].join('|');
}

/**
 * Why a wall's recapture ladder stopped before it was exhausted. These are
 * OUR limits, not evidence about the house, so they must never be reported as
 * "this house is obscured from the street".
 */
const STOP_REASON_LABELS = {
  budget_exhausted: 'the per-estimate recapture budget was already spent on other walls',
  lookup_unavailable: 'Street View lookup is not configured, so no alternative angle could be requested',
  lookup_failed: 'the Street View lookup itself failed (network, quota, or API key problem), so no alternative angle could be checked',
  analysis_failed: 'the recaptured image could not be retrieved or analyzed, so the alternative angle was never actually judged',
};

/**
 * Street View metadata statuses that are a real answer about coverage: Google
 * looked and there is no outdoor panorama near that point. Anything else —
 * REQUEST_DENIED, OVER_QUERY_LIMIT, INVALID_REQUEST, UNKNOWN_ERROR, a network
 * timeout, or unparseable JSON — tells us nothing about the house and must
 * never be counted as an exhausted rung.
 */
const CONFIRMED_NO_COVERAGE_STATUSES = ['ZERO_RESULTS', 'NOT_FOUND'];

/** True when a metadata status is an outage/config problem rather than an answer. */
function isIndeterminateLookupStatus(status) {
  return !(status === 'OK' || CONFIRMED_NO_COVERAGE_STATUSES.includes(String(status || '')));
}

/**
 * Roll the attempt history for one wall into the record the UI reads.
 *
 * status:
 *   'used'        — the first auto-fetched frame was measurable
 *   'recaptured'  — a later attempt produced a measurable frame; that is the
 *                   frame the panel must display
 *   'skipped'     — the wall's whole ladder was genuinely exhausted: every
 *                   alternative angle we can reach was tried (or does not
 *                   exist) and none showed the wall. Only this status is
 *                   evidence that the house is obscured from the street.
 *   'unmeasured'  — the ladder was cut short by one of OUR limits (the shared
 *                   request budget, or Street View lookup being unavailable).
 *                   The wall is equally unmeasured, but nothing was proven
 *                   about the house, so it must not be reported as obscured.
 *
 * `stoppedReason` is what separates the last two. A caller that stops looping
 * for any reason other than running out of rungs MUST pass it, or a wall we
 * simply never tried gets reported as exhaustively tested.
 */
function summarizeRecapture({ label, attempts = [], initial = null, stoppedReason = null } = {}) {
  const successful = attempts.find((a) => a && a.usable === true);
  const initialUsable = !!(initial && initial.usable === true);

  if (initialUsable) {
    return {
      label,
      status: 'used',
      reason: null,
      stopped_reason: null,
      attempt_count: 0,
      attempts: [],
      final_image_url: initial.image_url || null,
      final_pano_id: initial.pano_id || null,
      final_heading: initial.heading ?? null,
      message: `${label}: measured from the first Street View angle.`,
    };
  }

  if (successful) {
    return {
      label,
      status: 'recaptured',
      reason: initial?.reason || null,
      stopped_reason: null,
      attempt_count: attempts.length,
      attempts,
      final_image_url: successful.image_url || null,
      final_pano_id: successful.pano_id || null,
      final_heading: successful.heading ?? null,
      message: `${label}: first angle was rejected (${REJECTION_REASON_LABELS[initial?.reason] || 'unusable frame'}) — measured from a recaptured ${successful.strategy || 'alternative'} angle instead.`,
    };
  }

  const rejectionLabel = REJECTION_REASON_LABELS[initial?.reason] || 'unusable frame';

  // Cut short by one of our own limits. The wall is unmeasured, but we have NOT
  // established that a usable angle is unavailable — say so plainly rather than
  // borrowing the "genuinely obscured" wording.
  if (stoppedReason) {
    const triedNote = attempts.length > 0
      ? `${attempts.length} alternative angle${attempts.length === 1 ? '' : 's'} tried without success, then stopped because `
      : 'No alternative angle was tried because ';
    return {
      label,
      status: 'unmeasured',
      reason: initial?.reason || 'unclear',
      stopped_reason: stoppedReason,
      attempt_count: attempts.length,
      attempts,
      final_image_url: null,
      final_pano_id: null,
      final_heading: null,
      message: `${label}: ${rejectionLabel} — ${triedNote}${STOP_REASON_LABELS[stoppedReason] || 'the recapture could not run'}. Wall left unmeasured; a usable angle may still exist.`,
    };
  }

  const exhausted = attempts.length > 0;
  return {
    label,
    status: 'skipped',
    reason: initial?.reason || 'unclear',
    stopped_reason: null,
    attempt_count: attempts.length,
    attempts,
    final_image_url: null,
    final_pano_id: null,
    final_heading: null,
    message: exhausted
      ? `${label}: ${rejectionLabel} — ${attempts.length} alternative angle${attempts.length === 1 ? '' : 's'} tried, none usable. Wall left unmeasured.`
      : `${label}: ${rejectionLabel} — no alternative Street View angle exists. Wall left unmeasured.`,
  };
}

/**
 * Prompt fragment appended to the per-photo vision prompt. Kept here so the
 * dev handler, the production mirror, and the gate can never describe the
 * categories differently.
 */
const FRAME_SUBJECT_PROMPT = `FRAME SUBJECT CHECK (MANDATORY — answer before measuring):
Auto-fetched street-level frames are aimed by map geometry, so they regularly
land on something other than the house being measured. Report what this frame
actually shows in "frame_subject":
- "subject_building": the building being measured fills a usable part of the frame
- "foliage": trees, hedges, or vegetation block the wall
- "sky": the frame is mostly sky or roofline air, not a wall
- "other_building": a different/neighbouring building fills the frame
- "obstructed": a vehicle, fence, wall, or structure blocks the wall
- "unclear": too dark, blurred, or ambiguous to judge
Also report "subject_visible_pct": roughly what percentage of the measured
building's wall face is actually visible and unobstructed (0-100).
Never guess dimensions from scenery. When frame_subject is not
"subject_building", set wall_width_ft to 0 and eave_height_ft to 0.`;

/** JSON schema fragment matching FRAME_SUBJECT_PROMPT. */
const FRAME_SUBJECT_SCHEMA_FRAGMENT = `  "frame_subject": "subject_building" | "foliage" | "sky" | "other_building" | "obstructed" | "unclear",
  "subject_visible_pct": <0-100, share of the measured building's wall face that is visible and unobstructed>,`;

module.exports = {
  FRAME_SUBJECTS,
  REJECTION_REASON_LABELS,
  MIN_SUBJECT_VISIBLE_PCT,
  MAX_RECAPTURE_ATTEMPTS,
  MAX_TOTAL_RECAPTURE_ANALYSES,
  RECAPTURE_STRATEGIES,
  STOP_REASON_LABELS,
  CONFIRMED_NO_COVERAGE_STATUSES,
  isIndeterminateLookupStatus,
  FRAME_SUBJECT_PROMPT,
  FRAME_SUBJECT_SCHEMA_FRAGMENT,
  normalizeFrameSubject,
  evaluateFrameUsability,
  shouldRecapture,
  buildRecapturePlan,
  captureFingerprint,
  summarizeRecapture,
};
