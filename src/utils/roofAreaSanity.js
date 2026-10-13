/**
 * Roof Area Sanity Guards — strict geometric reconstruction, zero guesswork.
 *
 * Google Solar cannot isolate a small secondary structure: querying at or near
 * a garage frequently snaps to the nearest building and returns the WHOLE
 * house's roof stats. A "2-car garage" then shows 25+ SQ instead of ~5 SQ.
 *
 * When exact geometry of the queried structure exists (its coordinate-matched
 * traced footprint polygon, or user-entered dimensions), the guard checks the
 * satellite number against what that footprint can physically carry and — only
 * on a clear conflict (snap evidence) — replaces it with the exact
 * reconstruction:
 *
 *   True 3D Area = (True Footprint Area + Overhang Area) / cos(atan(pitch/12))
 *
 * where the overhang is the standard 1.5 ft eave/rake projection applied to
 * that footprint's own perimeter and the pitch is the measured pitch. A
 * legitimate large garage whose satellite area is consistent with its own
 * footprint is NEVER overridden. If no exact geometry exists and the number is
 * physically implausible for a garage, the guard FAILS CLOSED — it zeroes the
 * bogus number and demands manual dimensions instead of inventing a "standard
 * garage".
 *
 * Radian-math note (verified): the slope multiplier everywhere in this
 * codebase is 1 / cos(atan(rise / 12)) === sqrt(1 + (rise/12)^2). Math.atan
 * returns radians and Math.cos consumes radians — no degree/radian mismatch.
 */

/** No standard residential garage roof exceeds 1,000 sqft (10 SQ). */
export const GARAGE_ROOF_SANITY_MAX_SQFT = 1000;

/** Standard eave/rake overhang allowance applied to the footprint perimeter. */
export const EAVE_RAKE_OVERHANG_FT = 1.5;

/**
 * Snap-evidence gate: the satellite area must exceed the footprint-derived
 * reconstruction by this ratio before we conclude Solar measured the wrong
 * building. The slack absorbs trace tolerance and non-standard overhangs so
 * legitimate structures are never overridden.
 */
export const SNAP_CONFLICT_RATIO = 1.35;

const LINEAR_FIELDS = [
  'ridge_lf', 'hip_lf', 'valley_lf', 'rake_lf', 'eave_lf',
  'step_flashing_lf', 'apron_flashing_lf', 'gutter_lf',
];

/** Parse a pitch like "4/12", "4:12", 4, or "4" into its rise. null if unknown. */
export function parsePitchRise(pitch) {
  if (pitch === null || pitch === undefined || pitch === '') return null;
  if (typeof pitch === 'number') return Number.isFinite(pitch) && pitch >= 0 ? pitch : null;
  const m = String(pitch).trim().match(/^(\d+(?:\.\d+)?)\s*[/:]?\s*(?:12)?$/);
  if (!m) return null;
  const rise = Number(m[1]);
  return Number.isFinite(rise) && rise >= 0 ? rise : null;
}

/**
 * Exact roof reconstruction from a structure's real 2D footprint.
 *
 * Plan-view roof area = footprint expanded outward by the overhang along the
 * whole perimeter: A + P·o + 4o² (the 4o² term is the square-corner Minkowski
 * expansion of a rectangular outline — detached garages are rectangular; for
 * a traced polygon it remains within inches of exact).
 * Sloped area = plan area / cos(atan(rise/12)) — strict radian trigonometry.
 *
 * @returns {{ planSqFt:number, slopeMultiplier:number, roofSqFt:number }}
 */
export function reconstructRoofFromFootprint({ footprintSqFt, perimeterFt, pitchRise, overhangFt = EAVE_RAKE_OVERHANG_FT }) {
  const planSqFt = footprintSqFt + perimeterFt * overhangFt + 4 * overhangFt * overhangFt;
  const slopeMultiplier = 1 / Math.cos(Math.atan(pitchRise / 12));
  return { planSqFt, slopeMultiplier, roofSqFt: planSqFt * slopeMultiplier };
}

/**
 * Guards a garage-classified satellite/AI analysis against the whole-house
 * snap failure mode. Decision flow:
 *
 *  1. Exact geometry available (coordinate-matched traced polygon via
 *     opts.footprintSqFt/perimeterFt, or analysis.garage_dim_l × garage_dim_w)
 *     AND a measured pitch:
 *       - satellite area consistent with that footprint → returned UNTOUCHED
 *         (legitimate large garages are never overridden);
 *       - satellite area > reconstruction × SNAP_CONFLICT_RATIO → replaced
 *         with the exact reconstruction (snap evidence).
 *  2. No exact geometry: a number beyond GARAGE_ROOF_SANITY_MAX_SQFT is
 *     physically implausible for a garage → FAIL CLOSED (areas zeroed,
 *     `requires_manual_dimensions` set). Plausible numbers pass through.
 *
 * @param {Object} analysis - roof analysis ({ roof_area_sq | roof_area_sqft, ... })
 * @param {Object} [opts]
 * @param {number} [opts.footprintSqFt] - exact footprint of THIS structure (coordinate-matched polygon or known dims)
 * @param {number} [opts.perimeterFt]   - exact perimeter of that footprint
 * @param {string|number} [opts.pitch]  - measured pitch (photo-derived preferred), e.g. "4/12"
 * @param {string} [opts.label]         - structure label for the error log
 * @returns {Object} the original analysis, or a reconstructed/fail-closed copy.
 */
export function enforceGarageRoofSanity(analysis, { footprintSqFt, perimeterFt, pitch, label = 'Garage' } = {}) {
  if (!analysis || typeof analysis !== 'object') return analysis;

  const roofSqFt = Number(analysis.roof_area_sqft) > 0
    ? Number(analysis.roof_area_sqft)
    : (Number(analysis.roof_area_sq) || 0) * 100;
  if (!(roofSqFt > 0)) return analysis;

  // ── Resolve EXACT geometry only — no standard-garage defaults ────────────
  let fpSqFt = 0, fpPerimFt = 0, fpSource = null, perimeterEstimated = false;
  if (Number(footprintSqFt) > 0) {
    fpSqFt = Number(footprintSqFt);
    if (Number(perimeterFt) > 0) {
      fpPerimFt = Number(perimeterFt);
    } else {
      // Geometric lower bound (square minimizes perimeter for a given area) —
      // derived from the actual footprint, flagged, never a "standard" figure.
      fpPerimFt = 4 * Math.sqrt(fpSqFt);
      perimeterEstimated = true;
    }
    fpSource = 'traced footprint polygon';
  } else {
    const dimL = Number(analysis.garage_dim_l) || 0;
    const dimW = Number(analysis.garage_dim_w) || 0;
    if (dimL > 0 && dimW > 0) {
      fpSqFt = dimL * dimW;
      fpPerimFt = 2 * (dimL + dimW);
      fpSource = `entered dimensions ${dimL}×${dimW} ft`;
    }
  }

  const pitchRise = parsePitchRise(pitch ?? analysis.pitch);

  // ── 1. Exact geometry: evidence-gated reconstruction ─────────────────────
  if (fpSqFt > 0 && pitchRise !== null) {
    const { planSqFt, slopeMultiplier, roofSqFt: trueRoofSqFt } = reconstructRoofFromFootprint({
      footprintSqFt: fpSqFt,
      perimeterFt: fpPerimFt,
      pitchRise,
    });

    // Consistent with this structure's own footprint → NOT a snap. Keep the
    // real satellite measurement, even above the generic garage ceiling.
    if (roofSqFt <= trueRoofSqFt * SNAP_CONFLICT_RATIO) return analysis;

    const exactSqFt = Math.round(trueRoofSqFt * 10) / 10;
    const exactSq = Math.round(trueRoofSqFt) / 100;

    console.error(
      `ROOF AREA SANITY [${label}]: satellite returned ${(roofSqFt / 100).toFixed(2)} SQ but this ` +
      `structure's own footprint supports at most ~${(trueRoofSqFt / 100).toFixed(2)} SQ — Google Solar ` +
      `likely snapped to the main building. Reconstructed from ${fpSource}: ` +
      `(${Math.round(fpSqFt)} sqft footprint + ${EAVE_RAKE_OVERHANG_FT} ft overhang on ` +
      `${Math.round(fpPerimFt)} ft perimeter = ${Math.round(planSqFt)} sqft plan) ÷ ` +
      `cos(atan(${pitchRise}/12)) = ${Math.round(trueRoofSqFt)} sqft.`
    );

    const capped = { ...analysis };
    capped.roof_sanity_capped = true;
    capped.roof_sanity_original_sq = Math.round(roofSqFt) / 100;

    // Linear dimensions of similar shapes scale with the square root of area.
    const linearScale = Math.sqrt(trueRoofSqFt / roofSqFt);
    for (const f of LINEAR_FIELDS) {
      if (Number(capped[f]) > 0) capped[f] = Math.round(Number(capped[f]) * linearScale);
    }

    capped.roof_area_sqft = exactSqFt;
    capped.roof_area_sq = exactSq;
    if (capped.corrected_area_sq !== undefined) capped.corrected_area_sq = exactSq;
    if (capped.corrected_area_sqft !== undefined) capped.corrected_area_sqft = exactSqFt;
    if (Number(capped.final_order_quantity_sq) > 0) {
      const waste = Number(capped.waste_percentage) > 0 ? Number(capped.waste_percentage) : 10;
      capped.final_order_quantity_sq = Math.round(exactSq * (1 + waste / 100) * 100) / 100;
    }
    capped.overall_confidence = Math.min(Number(capped.overall_confidence) || 100, perimeterEstimated ? 40 : 60);
    capped.confidence_grade = perimeterEstimated ? 'D' : 'C';
    capped.tolerance_pct = Math.max(Number(capped.tolerance_pct) || 0, perimeterEstimated ? 25 : 15);
    capped.roof_reconstruction = {
      source: fpSource,
      footprint_sqft: Math.round(fpSqFt * 10) / 10,
      perimeter_ft: Math.round(fpPerimFt * 10) / 10,
      perimeter_estimated: perimeterEstimated,
      overhang_ft: EAVE_RAKE_OVERHANG_FT,
      plan_sqft: Math.round(planSqFt * 10) / 10,
      pitch_rise: pitchRise,
      slope_multiplier: Math.round(slopeMultiplier * 10000) / 10000,
    };
    capped.analysis_notes = [
      analysis.analysis_notes,
      `⚠️ Sanity correction: satellite measured ${(roofSqFt / 100).toFixed(1)} SQ — it picked up the ` +
      `main house. Reconstructed from this structure's ${fpSource}: ${Math.round(fpSqFt)} sqft ` +
      `footprint + ${EAVE_RAKE_OVERHANG_FT} ft eave/rake overhang allowance (${Math.round(planSqFt)} sqft plan) ` +
      `at ${pitchRise}/12 pitch → ${exactSq.toFixed(2)} SQ.`,
    ].filter(Boolean).join(' ');

    return capped;
  }

  // ── 2. No exact geometry: fail closed on implausible numbers only ────────
  if (!(roofSqFt > GARAGE_ROOF_SANITY_MAX_SQFT)) return analysis;

  const missing = !(fpSqFt > 0) ? 'no traced footprint or entered dimensions' : 'no measured pitch';
  console.error(
    `ROOF AREA SANITY [${label}]: satellite returned ${(roofSqFt / 100).toFixed(2)} SQ for a ` +
    `garage-classified structure (max ${GARAGE_ROOF_SANITY_MAX_SQFT / 100} SQ) — Google Solar ` +
    `likely snapped to the main building. ${missing}, so NO area is being invented. ` +
    `Manual dimensions required.`
  );

  const capped = { ...analysis };
  capped.roof_sanity_capped = true;
  capped.roof_sanity_original_sq = Math.round(roofSqFt) / 100;
  for (const f of LINEAR_FIELDS) if (capped[f] !== undefined) capped[f] = 0;
  capped.roof_area_sqft = 0;
  capped.roof_area_sq = 0;
  if (capped.corrected_area_sq !== undefined) capped.corrected_area_sq = 0;
  if (capped.corrected_area_sqft !== undefined) capped.corrected_area_sqft = 0;
  if (capped.final_order_quantity_sq !== undefined) capped.final_order_quantity_sq = 0;
  capped.overall_confidence = 0;
  capped.confidence_grade = 'D';
  capped.requires_manual_dimensions = true;
  capped.analysis_notes = [
    analysis.analysis_notes,
    `⚠️ Satellite measured ${(roofSqFt / 100).toFixed(1)} SQ — it picked up the main house, and ` +
    `no exact footprint of this structure was available (${missing}). No fallback number was ` +
    `invented: enter the structure's real length × width to get an exact measurement.`,
  ].filter(Boolean).join(' ');
  return capped;
}
