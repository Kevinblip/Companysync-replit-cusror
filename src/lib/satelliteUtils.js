/**
 * Satellite Imagery & Roof Measurement Utilities
 * Pure functions — no React dependencies.
 */

export const PITCH_MULTIPLIERS = {
  '0/12': 1.000, 'flat': 1.000,
  '1/12': 1.003, '2/12': 1.014, '3/12': 1.031, '4/12': 1.054,
  '5/12': 1.083, '6/12': 1.118, '7/12': 1.158, '8/12': 1.202,
  '9/12': 1.250, '10/12': 1.302, '11/12': 1.357, '12/12': 1.414,
  '13/12': 1.474, '14/12': 1.537, '15/12': 1.601, '16/12': 1.667,
  '17/12': 1.734, '18/12': 1.803
};

/**
 * Returns the pitch-to-area multiplier for a given pitch string (e.g. "6/12").
 * Falls back to 6/12 (1.118) for unknown pitches.
 */
export function getPitchMultiplier(pitchStr) {
  if (!pitchStr || pitchStr === 'Unknown') return 1.118;
  const clean = pitchStr.toString().trim().toLowerCase();
  if (PITCH_MULTIPLIERS[clean] !== undefined) return PITCH_MULTIPLIERS[clean];
  const match = clean.match(/(\d+)\s*[/:]\s*12/);
  if (match) {
    const rise = parseInt(match[1]);
    return Math.sqrt(1 + (rise / 12) ** 2);
  }
  return 1.118;
}

/**
 * Calculates a real confidence score for a satellite roof analysis.
 *
 * @param {Object} analysis  - The satellite analysis result object
 * @param {string} source    - Measurement source key (e.g. 'google_solar', 'eagleview')
 * @returns {Object} Detailed confidence result with overall score, grade, area ranges, warnings
 */
export function calculateRealConfidence(analysis, source = 'google_solar') {
  const factors = [];
  const warnings = [];
  const details = {};

  const sourceScores = {
    'manual_drawing': { base: 92, label: 'Manual Drawing', tolerance: 5 },
    'eagleview':      { base: 92, label: 'EagleView Report', tolerance: 3 },
    'hover':          { base: 90, label: 'HOVER Report', tolerance: 4 },
    'physical_photos':{ base: 82, label: 'Calibrated Physical Photos', tolerance: 12 },
    'hybrid_photos_satellite': { base: 80, label: 'Physical Photos + Mapped Footprint', tolerance: 12 },
    'google_solar':   { base: 78, label: 'Google Solar API', tolerance: 10 },
    'gemini_vision':  { base: 72, label: 'Gemini Vision AI', tolerance: 15 },
    'document_upload':{ base: 85, label: 'Uploaded Report', tolerance: 5 }
  };
  const sourceInfo = sourceScores[source] || sourceScores['gemini_vision'];
  details.source = { score: sourceInfo.base, label: sourceInfo.label };
  factors.push(sourceInfo.base);

  const area       = Number(analysis.roof_area_sq) || 0;
  const ridge      = Number(analysis.ridge_lf) || 0;
  const hip        = Number(analysis.hip_lf) || 0;
  const valley     = Number(analysis.valley_lf) || 0;
  const rake       = Number(analysis.rake_lf) || 0;
  const eave       = Number(analysis.eave_lf) || 0;
  const stepFlash  = Number(analysis.step_flashing_lf) || 0;
  const pitch      = analysis.pitch || 'Unknown';

  // ── Complexity scoring ──────────────────────────────────────────────────
  let complexityScore = 95;
  const totalLinears    = ridge + hip + valley + rake + eave + stepFlash;
  const hipValleyRatio  = area > 0 ? (hip + valley) / (area * 10) : 0;
  const numSegments     = Number(analysis.num_segments) || 0;
  const isComplexRoof     = (hip > 60 || valley > 80 || numSegments > 12 || hipValleyRatio > 0.8);
  const isVeryComplexRoof = ((hip > 100 && valley > 60) || numSegments > 16 || hipValleyRatio > 1.2);

  if (isVeryComplexRoof) {
    complexityScore -= 25;
    warnings.push('Very complex roof with many hips, valleys, or dormers — satellite accuracy is limited for this type of roof');
  } else if (isComplexRoof) {
    complexityScore -= 15;
    warnings.push('Complex roof geometry detected — consider supplementing with an aerial report for best accuracy');
  } else if (hipValleyRatio > 0.4) {
    complexityScore -= 4;
  }
  if (stepFlash > 50) complexityScore -= 5;

  let proTip = null;
  if (isVeryComplexRoof) {
    proTip = 'This roof has complex geometry (multiple hips, valleys, or dormers). For the most accurate bid, we recommend pairing this estimate with an aerial measurement report or physical inspection before ordering materials.';
  } else if (isComplexRoof) {
    proTip = 'This roof has some complexity. Consider verifying key measurements with an aerial report or on-site inspection for material ordering confidence.';
  }

  details.complexity = {
    score: Math.max(complexityScore, 50),
    ratio: hipValleyRatio.toFixed(2),
    isComplex: isComplexRoof,
    isVeryComplex: isVeryComplexRoof,
    numSegments
  };
  factors.push(Math.max(complexityScore, 50));

  // ── Geometry cross-checks ───────────────────────────────────────────────
  let geometryScore = 95;
  const geometryChecks = [];

  if (area > 0 && (eave > 0 || rake > 0)) {
    const expectedPerimeter = Math.sqrt(area * 100) * 4;
    const outlinePerimeter  = (eave + rake) || expectedPerimeter;
    const perimRatio        = outlinePerimeter / expectedPerimeter;
    if (perimRatio < 0.2 || perimRatio > 4.0) {
      geometryScore -= 20;
      geometryChecks.push({ check: 'Outline vs Area', status: 'fail', note: `Eave+Rake ratio ${perimRatio.toFixed(2)} outside expected range` });
    } else if (perimRatio < 0.4 || perimRatio > 3.0) {
      geometryScore -= 6;
      geometryChecks.push({ check: 'Outline vs Area', status: 'warn', note: `Eave+Rake ratio ${perimRatio.toFixed(2)} slightly unusual` });
    } else {
      geometryChecks.push({ check: 'Outline vs Area', status: 'pass', note: `Eave+Rake ratio ${perimRatio.toFixed(2)} within normal range` });
    }
  }
  if (eave > 0 && rake > 0) {
    const eaveRakeRatio = eave / rake;
    if (eaveRakeRatio < 0.2 || eaveRakeRatio > 6.0) {
      geometryScore -= 8;
      geometryChecks.push({ check: 'Eave/Rake ratio', status: 'warn', note: `${eaveRakeRatio.toFixed(1)}:1 - unusual proportion` });
    } else {
      geometryChecks.push({ check: 'Eave/Rake ratio', status: 'pass', note: `${eaveRakeRatio.toFixed(1)}:1` });
    }
  }
  if (ridge > 0 && eave > 0 && ridge > eave * 2.0) {
    geometryScore -= 6;
    geometryChecks.push({ check: 'Ridge vs Eave', status: 'warn', note: 'Ridge significantly exceeds eave length' });
  }
  if (area > 0 && totalLinears === 0) {
    geometryScore -= 20;
    geometryChecks.push({ check: 'Linear measurements', status: 'fail', note: 'No linear measurements detected' });
    warnings.push('No linear measurements detected - only area available');
  }
  details.geometry = { score: Math.max(geometryScore, 50), checks: geometryChecks };
  factors.push(Math.max(geometryScore, 50));

  // ── Pitch scoring ───────────────────────────────────────────────────────
  let pitchScore = 92;
  const mult = getPitchMultiplier(pitch);
  if (pitch === 'Unknown' || !pitch) {
    pitchScore = 70;
    warnings.push('Pitch not detected - using default 6/12 multiplier');
  } else if (mult > 1.6) {
    pitchScore = 75;
    warnings.push(`Very steep pitch (${pitch}) - satellite accuracy reduced`);
  } else if (mult > 1.4) {
    pitchScore = 82;
  } else if (mult > 1.25) {
    pitchScore = 88;
  }
  details.pitch = { score: pitchScore, multiplier: mult, detected: pitch };
  factors.push(pitchScore);

  const apiConfidence = Number(analysis.overall_confidence);
  if (apiConfidence && apiConfidence < 100) {
    details.api_reported = { score: apiConfidence };
    factors.push(apiConfidence);
  }

  // ── Compute overall ─────────────────────────────────────────────────────
  const rawAvg = factors.reduce((s, f) => s + f, 0) / factors.length;
  let overall  = Math.round(Math.min(Math.max(rawAvg, 15), 95));

  if (source === 'gemini_vision' && overall > 85) overall = 85;
  else if (source === 'google_solar' && overall > 88) overall = 88;

  const pitchMult    = getPitchMultiplier(pitch);
  const slopeAdjustedSources = ['google_solar', 'gemini_vision', 'physical_photos', 'hybrid_photos_satellite'];
  const skipPitchCorrection = slopeAdjustedSources.includes(source);
  const effectiveMult       = skipPitchCorrection ? 1.0 : pitchMult;
  const correctedAreaSqFt   = (area * 100) * effectiveMult;
  const correctedAreaSq     = correctedAreaSqFt / 100;

  let tolerancePct = sourceInfo.tolerance;
  if (overall < 60)      tolerancePct = Math.max(tolerancePct, 20);
  else if (overall < 70) tolerancePct = Math.max(tolerancePct, 15);
  else if (overall < 80) tolerancePct = Math.max(tolerancePct, 10);

  const areaLow  = correctedAreaSq * (1 - tolerancePct / 100);
  const areaHigh = correctedAreaSq * (1 + tolerancePct / 100);

  let grade, gradeColor;
  if (overall >= 88)      { grade = 'A'; gradeColor = 'green'; }
  else if (overall >= 78) { grade = 'B'; gradeColor = 'green'; }
  else if (overall >= 65) { grade = 'C'; gradeColor = 'yellow'; }
  else if (overall >= 50) { grade = 'D'; gradeColor = 'orange'; }
  else                    { grade = 'F'; gradeColor = 'red'; }

  // ── Per-measurement confidence ──────────────────────────────────────────
  const perMeasurement = {};
  const calcMeasConf = (name, value, apiConf) => {
    if (!value || value === 0) return null;
    let conf = (apiConf && apiConf < 100) ? apiConf : sourceInfo.base;
    if (pitchScore < 80)    conf -= 5;
    if (complexityScore < 75) conf -= 5;
    return Math.round(Math.min(Math.max(conf, 20), 98));
  };
  perMeasurement.ridge        = calcMeasConf('ridge', ridge, analysis.ridge_confidence);
  perMeasurement.hip          = calcMeasConf('hip', hip, analysis.hip_confidence);
  perMeasurement.valley       = calcMeasConf('valley', valley, analysis.valley_confidence);
  perMeasurement.rake         = calcMeasConf('rake', rake, analysis.rake_confidence);
  perMeasurement.eave         = calcMeasConf('eave', eave, analysis.eave_confidence);
  perMeasurement.step_flashing = calcMeasConf('step_flashing', stepFlash, analysis.step_flashing_confidence);

  return {
    overall,
    grade,
    gradeColor,
    tolerancePct,
    pitchMultiplier: pitchMult,
    correctedAreaSq: Math.round(correctedAreaSq * 100) / 100,
    correctedAreaSqFt: Math.round(correctedAreaSqFt),
    areaRange: { low: Math.round(areaLow * 100) / 100, high: Math.round(areaHigh * 100) / 100 },
    perMeasurement,
    details,
    warnings,
    proTip,
    source: sourceInfo.label
  };
}

/** Parses a pitch string ("6/12", "6:12", "6") into its rise-per-12, or null. */
export function parsePitchRise(pitchStr) {
  if (pitchStr == null) return null;
  const clean = pitchStr.toString().trim().toLowerCase();
  const m = clean.match(/(\d+\.?\d*)\s*[/:]\s*12/);
  if (m) return Number(m[1]);
  if (/^\d+\.?\d*$/.test(clean)) return Number(clean);
  return null;
}

/**
 * A high-confidence Solar segment pitch outranks one photo reading that
 * disagrees by a full rise or more. Re-projecting the measured roof with that
 * photo pitch shrinks or inflates an area Solar already slope-adjusted.
 * A hand-picked pitch is not decided here; callers still apply it first.
 */
export function satellitePitchOutranksPhoto(analysis, photoPitch) {
  if (!analysis || !photoPitch) return false;
  const source = String(analysis.pitch_source || '');
  const confidence = String(analysis.pitch_confidence || '');
  if (confidence !== 'high' || !/solar/i.test(source)) return false;
  const solarRise = parsePitchRise(analysis.pitch);
  const photoRise = parsePitchRise(photoPitch);
  if (solarRise == null || photoRise == null) return false;
  return Math.abs(solarRise - photoRise) >= 1;
}

const SQM_TO_SQFT = 10.7639;

/**
 * Isolates the flat 2D footprint area (sqft) of the roof from an analysis.
 *
 * Preference order:
 *  1. Google Solar ground area (wholeRoofStats.groundAreaMeters2, or the sum
 *     of per-segment groundAreaMeters2) — a true plan-view measurement.
 *  2. Slope-adjusted sources without ground stats: de-project the sloped area
 *     with the ORIGINAL satellite pitch (sloped × cos(atan(rise/12))).
 *  3. Footprint-based sources: divide by the current pitch multiplier.
 * Returns null when no honest footprint can be isolated.
 */
export function isolateRoofFootprintSqft(analysis) {
  if (!analysis) return null;

  // A previously isolated footprint is authoritative — re-deriving it from a
  // recalibrated sloped area with the old basis pitch would compound errors.
  const cached = Number(analysis.footprint_sqft_2d);
  if (cached > 0) return cached;

  const sp = analysis.raw_solar_data?.solarPotential;
  const wholeGround = Number(sp?.wholeRoofStats?.groundAreaMeters2);
  if (wholeGround > 0) return wholeGround * SQM_TO_SQFT;

  const segs = Array.isArray(sp?.roofSegmentStats) ? sp.roofSegmentStats : [];
  const segGround = segs.reduce((s, seg) => s + (Number(seg?.stats?.groundAreaMeters2) || 0), 0);
  if (segGround > 0) return segGround * SQM_TO_SQFT;

  const slopedSqft = Number(analysis.corrected_area_sqft)
    || (Number(analysis.corrected_area_sq) || 0) * 100
    || Number(analysis.roof_area_sqft)
    || (Number(analysis.roof_area_sq) || 0) * 100;
  if (!(slopedSqft > 0)) return null;

  // Basis pitch: the pitch the current area was computed under. For photo
  // overrides that already ran, the pre-override satellite pitch is stored.
  const basisRise = parsePitchRise(analysis.original_satellite_pitch || analysis.pitch);

  if (analysis.area_is_slope_adjusted === true) {
    if (basisRise == null) return null; // can't honestly de-project an unknown slope
    return slopedSqft * Math.cos(Math.atan(basisRise / 12));
  }
  // Footprint-based source: sloped = footprint × multiplier
  const mult = getPitchMultiplier(analysis.original_satellite_pitch || analysis.pitch || 'Unknown');
  return mult > 0 ? slopedSqft / mult : slopedSqft;
}

/**
 * Fused satellite-to-photo cross-calibration engine.
 *
 * Applies a photo-detected pitch to an existing satellite analysis: isolates
 * the flat 2D footprint from the satellite data, re-projects it with the
 * photo-derived pitch (True 3D Area = 2D Area / cos(arctan(rise/12))), and
 * discards the raw satellite 3D surface area. Pitch-dependent linears
 * (rake, hip, valley) are rescaled to the new slope; ridge and eave are
 * horizontal and stay fixed.
 *
 * If no footprint can be isolated (no Solar ground stats and no readable
 * basis pitch), only the pitch label/multiplier update — the area is left
 * untouched and `area_recalibrated_from_footprint` stays false, so the UI
 * never presents a guessed recalculation as measured.
 *
 * @param {Object} analysis     - Existing satellite analysis object
 * @param {string} photoPitch   - Photo-detected pitch string, e.g. "8/12"
 * @param {Object} [opts]       - { confidence?: 'high'|'medium', source?: string }
 * @returns {Object} Updated analysis with photo pitch applied
 */
export function applyPhotoPitchToAnalysis(analysis, photoPitch, opts = {}) {
  if (!analysis || !photoPitch) return analysis;

  const newMult = getPitchMultiplier(photoPitch);
  const newRise = parsePitchRise(photoPitch);
  const basisPitch = analysis.original_satellite_pitch || analysis.pitch;
  const basisRise = parsePitchRise(basisPitch);

  let newCorrectedSq    = analysis.corrected_area_sq;
  let newCorrectedSqft  = analysis.corrected_area_sqft;
  let footprintSqft     = null;
  let areaRecalibrated  = false;

  if (newRise != null) {
    footprintSqft = isolateRoofFootprintSqft(analysis);
    if (footprintSqft > 0) {
      // True 3D Area = 2D Area / cos(arctan(rise/12)) ≡ 2D Area × pitch multiplier.
      // Use getPitchMultiplier so corrected_area === footprint × pitch_multiplier
      // holds exactly for downstream consumers.
      newCorrectedSqft = Math.round(footprintSqft * newMult);
      newCorrectedSq   = Math.round(newCorrectedSqft) / 100;
      areaRecalibrated = true;
    }
  }

  // ── Rescale pitch-dependent linears ─────────────────────────────────────
  // rake runs up the slope:            length ∝ √(1 + s²)
  // hip/valley run up the plan diagonal: length ∝ √(2 + s²)
  // ridge/eave are horizontal:         unchanged
  // Always scale from immutable BASELINE values (captured on first override)
  // with the original satellite pitch as basis — scaling already-scaled values
  // would compound on re-application and never revert.
  const linears = {};
  if (areaRecalibrated && basisRise != null && newRise != null) {
    const s1 = basisRise / 12, s2 = newRise / 12;
    const rakeRatio = Math.sqrt(1 + s2 * s2) / Math.sqrt(1 + s1 * s1);
    const hipRatio  = Math.sqrt(2 + s2 * s2) / Math.sqrt(2 + s1 * s1);
    for (const [field, ratio] of [['rake_lf', rakeRatio], ['hip_lf', hipRatio], ['valley_lf', hipRatio]]) {
      const baseline = Number(analysis[`original_${field}`] ?? analysis[field]);
      if (baseline > 0) {
        linears[field] = Math.round(baseline * ratio * 10) / 10;
        linears[`original_${field}`] = baseline;
      }
    }
  }

  // Keep the tolerance band centred on the recalibrated area
  let areaRange = analysis.area_range;
  if (areaRecalibrated && areaRange?.low > 0 && analysis.corrected_area_sq > 0) {
    const ratio = newCorrectedSq / analysis.corrected_area_sq;
    areaRange = {
      low:  Math.round(areaRange.low  * ratio * 100) / 100,
      high: Math.round(areaRange.high * ratio * 100) / 100,
    };
  }

  return {
    ...analysis,
    ...linears,
    pitch:                    photoPitch,
    pitch_multiplier:         newMult,
    corrected_area_sq:        newCorrectedSq,
    corrected_area_sqft:      newCorrectedSqft,
    // The satellite 3D surface is discarded entirely: raw roof_area_* must
    // follow the fused value too, or exports/reports that read the raw fields
    // (estimate HTML, measurement report, Xactimate adapter) would print the
    // stale satellite area. The pre-override value stays in original_satellite_area_sq.
    roof_area_sq:             areaRecalibrated ? newCorrectedSq   : analysis.roof_area_sq,
    roof_area_sqft:           areaRecalibrated ? newCorrectedSqft : analysis.roof_area_sqft,
    area_range:               areaRange,
    // The recalibrated area IS a sloped surface area — consumers must not re-multiply.
    area_is_slope_adjusted:   areaRecalibrated ? true : analysis.area_is_slope_adjusted,
    area_recalibrated_from_footprint: areaRecalibrated,
    footprint_sqft_2d:        areaRecalibrated ? Math.round(footprintSqft) : analysis.footprint_sqft_2d,
    // Order quantity is a STORED field that the estimate HTML and measurement
    // report prefer over recomputing from area — it has to follow the
    // re-projected area or exports keep printing the pre-override quantity.
    final_order_quantity_sq: (areaRecalibrated && Number(analysis.final_order_quantity_sq) > 0)
      ? Math.round(newCorrectedSq * (1 + (Number(analysis.waste_percentage) || 12) / 100) * 100) / 100
      : analysis.final_order_quantity_sq,
    // `source` distinguishes how this pitch was arrived at. A hand-picked pitch
    // must NOT wear the "photo-verified" badge — the re-projection maths is the
    // same, but the provenance claim is not.
    pitch_source:             opts.source || 'onsite_photos',
    photo_pitch_override:     (opts.source || 'onsite_photos') === 'onsite_photos',
    manual_pitch_override:    opts.source === 'manual_override',
    photo_pitch_confidence:   opts.confidence || analysis.photo_pitch_confidence,
    original_satellite_pitch: analysis.original_satellite_pitch || analysis.pitch,
    original_satellite_area_sq: analysis.original_satellite_area_sq
      ?? (Number(analysis.corrected_area_sq) || Number(analysis.roof_area_sq) || null),
  };
}
