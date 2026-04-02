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
  const solarSources = ['google_solar', 'gemini_vision'];
  const skipPitchCorrection = solarSources.includes(source);
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
