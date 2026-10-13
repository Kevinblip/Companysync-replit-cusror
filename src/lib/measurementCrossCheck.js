/**
 * Measurement Cross-Check
 * Pure functions — no React, no API calls.
 *
 * Compares roof measurements coming from different sources (Google Solar,
 * Gemini vision, manual drawing, uploaded EagleView/HOVER/Xactimate reports)
 * and flags fields where the sources disagree beyond tolerance.
 */

import { getPitchMultiplier } from './satelliteUtils';

// Most-trusted first. Matches the sourceScores ranking in satelliteUtils.js.
export const SOURCE_TRUST_ORDER = [
  'uploaded_report',
  'manual_drawing',
  'physical_photos',
  'hybrid_photos_satellite',
  'google_solar',
  'gemini_vision',
];

export const SOURCE_LABELS = {
  uploaded_report: 'Uploaded report',
  manual_drawing: 'Manual drawing',
  physical_photos: 'Calibrated physical photos',
  hybrid_photos_satellite: 'Physical photos + mapped footprint',
  google_solar: 'Google Solar',
  gemini_vision: 'AI vision',
};

const FIELD_LABELS = {
  area_sq: 'Roof area',
  ridge_lf: 'Ridge',
  hip_lf: 'Hip',
  valley_lf: 'Valley',
  rake_lf: 'Rake',
  eave_lf: 'Eave',
  pitch: 'Pitch',
};

const FIELD_UNITS = {
  area_sq: 'SQ',
  ridge_lf: 'LF',
  hip_lf: 'LF',
  valley_lf: 'LF',
  rake_lf: 'LF',
  eave_lf: 'LF',
  pitch: '',
};

// { warn, disagree } thresholds as % difference vs the most-trusted source.
const THRESHOLDS = {
  area_sq: { warn: 5, disagree: 10 },
  ridge_lf: { warn: 8, disagree: 15 },
  hip_lf: { warn: 8, disagree: 15 },
  valley_lf: { warn: 8, disagree: 15 },
  rake_lf: { warn: 8, disagree: 15 },
  eave_lf: { warn: 8, disagree: 15 },
  // Pitch is compared via its area multiplier so "6/12 vs 8/12" has a
  // meaningful % impact instead of a naive string diff.
  pitch: { warn: 5, disagree: 10 },
};

// A zero vs non-zero mismatch only counts when the non-zero side is
// significant — tiny valleys/hips missing from one source aren't worth a flag.
const MIN_SIGNIFICANT = {
  area_sq: 3, // squares
  ridge_lf: 10,
  hip_lf: 10,
  valley_lf: 10,
  rake_lf: 10,
  eave_lf: 10,
};

/**
 * Normalizes any of the app's measurement objects (satelliteAnalysis,
 * reportMeasurements, manual drawing result) to one comparable shape.
 * Area prefers the slope-adjusted value (corrected_area_sq) when present.
 */
export function normalizeMeasurement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const areaSq =
    num(raw.corrected_area_sq) ||
    num(raw.roof_area_sq) ||
    num(raw.roof_area_sqft) / 100;
  const pitch = typeof raw.pitch === 'string' && raw.pitch.trim() ? raw.pitch.trim() : null;
  return {
    area_sq: areaSq,
    ridge_lf: num(raw.ridge_lf),
    hip_lf: num(raw.hip_lf),
    valley_lf: num(raw.valley_lf),
    rake_lf: num(raw.rake_lf),
    eave_lf: num(raw.eave_lf),
    pitch,
  };
}

function pickBaselineSource(sourceKeys) {
  for (const s of SOURCE_TRUST_ORDER) {
    if (sourceKeys.includes(s)) return s;
  }
  return sourceKeys[0];
}

function flagFor(field, deltaPct) {
  const t = THRESHOLDS[field];
  if (deltaPct > t.disagree) return 'disagree';
  if (deltaPct > t.warn) return 'check';
  return 'agree';
}

/**
 * Cross-checks measurements from 2+ sources.
 *
 * @param {Object} bySource - map of sourceKey -> raw measurement object
 * @returns {Object|null} null when fewer than 2 usable sources exist, else:
 *   {
 *     sources: [sourceKey, ...],            // usable sources, trust order
 *     recommendedSource, recommendedLabel,
 *     fields: { [field]: { values: {source: number|string}, deltaPct, flag, label, unit } },
 *     overall: 'agree' | 'check' | 'disagree',
 *     plainSummary: string,                 // plain-language, novice-friendly
 *   }
 */
export function crossCheckMeasurements(bySource) {
  const normalized = {};
  for (const [key, raw] of Object.entries(bySource || {})) {
    const n = normalizeMeasurement(raw);
    if (n && (n.area_sq > 0 || n.ridge_lf > 0 || n.eave_lf > 0)) normalized[key] = n;
  }
  const sourceKeys = SOURCE_TRUST_ORDER.filter((s) => normalized[s]).concat(
    Object.keys(normalized).filter((s) => !SOURCE_TRUST_ORDER.includes(s))
  );
  if (sourceKeys.length < 2) return null;

  const baseline = pickBaselineSource(sourceKeys);
  const fields = {};

  for (const field of Object.keys(FIELD_LABELS)) {
    const values = {};
    let present = 0;
    for (const s of sourceKeys) {
      const v = field === 'pitch' ? normalized[s].pitch : normalized[s][field];
      if (field === 'pitch' ? v : v > 0) {
        values[s] = v;
        present += 1;
      }
    }

    let deltaPct = 0;
    let comparable = 0;

    if (field === 'pitch') {
      if (!values[baseline] || present < 2) continue;
      const baseMult = getPitchMultiplier(values[baseline]);
      for (const s of Object.keys(values)) {
        if (s === baseline) continue;
        const d = (Math.abs(getPitchMultiplier(values[s]) - baseMult) / baseMult) * 100;
        deltaPct = Math.max(deltaPct, d);
        comparable += 1;
      }
    } else {
      const baseVal = values[baseline];
      for (const s of sourceKeys) {
        if (s === baseline) continue;
        const v = normalized[s][field];
        if (baseVal > 0 && v > 0) {
          deltaPct = Math.max(deltaPct, (Math.abs(v - baseVal) / baseVal) * 100);
          comparable += 1;
        } else if (baseVal > 0 || v > 0) {
          // zero vs non-zero: only flag when the non-zero side is significant
          const nonZero = Math.max(baseVal, v);
          if (nonZero >= MIN_SIGNIFICANT[field]) {
            deltaPct = Math.max(deltaPct, 100);
            comparable += 1;
            if (!values[baseline] && baseVal === 0) values[baseline] = 0;
            values[s] = v;
          }
        }
      }
      if (baseVal > 0) values[baseline] = baseVal;
    }

    if (comparable === 0) continue;

    fields[field] = {
      values,
      deltaPct: Math.round(deltaPct * 10) / 10,
      flag: flagFor(field, deltaPct),
      label: FIELD_LABELS[field],
      unit: FIELD_UNITS[field],
    };
  }

  if (Object.keys(fields).length === 0) return null;

  const flags = Object.values(fields).map((f) => f.flag);
  const overall = flags.includes('disagree')
    ? 'disagree'
    : flags.includes('check')
      ? 'check'
      : 'agree';

  const recommendedLabel = SOURCE_LABELS[baseline] || baseline;
  const nSources = sourceKeys.length;

  let plainSummary;
  if (overall === 'agree') {
    plainSummary = `Good news — your ${nSources} measurement sources agree within normal tolerance.`;
  } else {
    const worst = Object.values(fields)
      .filter((f) => f.flag !== 'agree')
      .sort((a, b) => b.deltaPct - a.deltaPct);
    const names = worst.slice(0, 3).map((f) => f.label.toLowerCase()).join(', ');
    if (overall === 'disagree') {
      plainSummary = `Your measurement sources disagree on ${names} (up to ${Math.round(worst[0].deltaPct)}% apart). We recommend trusting the ${recommendedLabel.toLowerCase()} numbers — they're usually the most accurate source you have.`;
    } else {
      plainSummary = `Your sources mostly agree, but double-check ${names} (off by up to ${Math.round(worst[0].deltaPct)}%). The ${recommendedLabel.toLowerCase()} numbers are the safest to use.`;
    }
  }

  return {
    sources: sourceKeys,
    recommendedSource: baseline,
    recommendedLabel,
    fields,
    overall,
    plainSummary,
  };
}
