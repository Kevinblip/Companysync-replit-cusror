#!/usr/bin/env node
/**
 * Roof area sanity & radian-math regression test (plain node script — all 16
 * workflow slots are full; run with: node scripts/test-roof-area-sanity.cjs)
 *
 * Covers:
 *  1. Radian handling: pitch multiplier must equal 1/cos(atan(rise/12)).
 *  2. Footprint → roof area formula (flat footprint × slope × 1.12 overhang).
 *  3. Garage sanity guard: >10 SQ garage is reconstructed strictly from exact
 *     geometry (traced footprint polygon or entered dims + real overhang +
 *     true pitch trig) — or fails closed. NO hardcoded defaults.
 *  4. Footprint-consistency clamp math (mirrors aiRoofMeasurement.ts).
 */

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name} ${detail}`); }
}
const approx = (a, b, tol = 0.005) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

(async () => {
  const { getPitchMultiplier } = await import('../src/lib/satelliteUtils.js');
  const { calculateRoofAreaFromFootprint } = await import('../src/utils/companySyncFormulas.js');
  const {
    enforceGarageRoofSanity,
    reconstructRoofFromFootprint,
    parsePitchRise,
    GARAGE_ROOF_SANITY_MAX_SQFT,
    EAVE_RAKE_OVERHANG_FT,
    SNAP_CONFLICT_RATIO,
  } = await import('../src/utils/roofAreaSanity.js');

  console.log('\n1) Radian math: multiplier = 1/cos(atan(rise/12))');
  for (const rise of [3, 4, 6, 8, 10, 12]) {
    const expected = 1 / Math.cos(Math.atan(rise / 12)); // radian-native
    const viaSqrt = Math.sqrt(1 + (rise / 12) ** 2);      // algebraic identity
    const actual = getPitchMultiplier(`${rise}/12`);
    check(`getPitchMultiplier(${rise}/12) ≈ ${expected.toFixed(4)}`,
      approx(actual, expected) && approx(viaSqrt, expected),
      `got ${actual}`);
  }
  // Degree-fed cos would give a wildly different number — prove we're not doing that.
  const degMistake = 1 / Math.cos(Math.atan(6 / 12) * (180 / Math.PI));
  check('6/12 multiplier is NOT the degrees-fed value', !approx(getPitchMultiplier('6/12'), degMistake, 0.05));

  console.log('\n2) Footprint → roof area (2-car garage 20×22, 4/12)');
  const area412 = calculateRoofAreaFromFootprint(440, 4);
  const expect412 = 440 * (1 / Math.cos(Math.atan(4 / 12))) * 1.12;
  check(`440 sqft @4/12 → ${expect412.toFixed(0)} sqft (~5.2 SQ, never 25 SQ)`,
    approx(area412, expect412) && area412 < GARAGE_ROOF_SANITY_MAX_SQFT,
    `got ${area412}`);

  console.log('\n3) Garage sanity guard — strict geometric reconstruction');

  // 3a. Pure reconstruction math: (A + P·o + 4o²) / cos(atan(rise/12))
  const rec = reconstructRoofFromFootprint({ footprintSqFt: 440, perimeterFt: 84, pitchRise: 4 });
  const expPlan = 440 + 84 * EAVE_RAKE_OVERHANG_FT + 4 * EAVE_RAKE_OVERHANG_FT ** 2; // 575
  const expRoof = expPlan / Math.cos(Math.atan(4 / 12));
  check('plan area = A + P·1.5 + 4·1.5²', approx(rec.planSqFt, expPlan), `got ${rec.planSqFt}`);
  check('sloped area = plan / cos(atan(4/12))', approx(rec.roofSqFt, expRoof), `got ${rec.roofSqFt}`);

  check('parsePitchRise("6/12") = 6', parsePitchRise('6/12') === 6);
  check('parsePitchRise garbage = null', parsePitchRise('steep') === null);

  // 3b. Snapped garage WITH traced footprint polygon → exact reconstruction.
  const bogus = {
    roof_area_sq: 25.4, roof_area_sqft: 2540, corrected_area_sq: 25.4,
    ridge_lf: 60, hip_lf: 0, valley_lf: 12, rake_lf: 48, eave_lf: 120,
    overall_confidence: 90, analysis_notes: 'orig', pitch: '4/12',
  };
  const capped = enforceGarageRoofSanity(bogus, {
    label: 'Test Garage', footprintSqFt: 484, perimeterFt: 88, pitch: '4/12',
  });
  const expPlanB = 484 + 88 * 1.5 + 9; // 625
  const expRoofB = expPlanB / Math.cos(Math.atan(4 / 12));
  check('reconstructs from traced polygon', approx(capped.roof_area_sqft, Math.round(expRoofB * 10) / 10), `got ${capped.roof_area_sqft}`);
  check('roof_area_sq matches sqft/100', approx(capped.roof_area_sq, expRoofB / 100, 0.01));
  check('corrected_area_sq follows', approx(capped.corrected_area_sq, expRoofB / 100, 0.01));
  check('flags roof_sanity_capped', capped.roof_sanity_capped === true);
  check('keeps original for audit', approx(capped.roof_sanity_original_sq, 25.4));
  check('records reconstruction provenance', capped.roof_reconstruction?.footprint_sqft === 484 && capped.roof_reconstruction?.perimeter_estimated === false);
  const linScale = Math.sqrt(expRoofB / 2540);
  check('linears scaled by √(area ratio)', capped.eave_lf === Math.round(120 * linScale), `got ${capped.eave_lf}`);
  check('input object not mutated', bogus.roof_area_sqft === 2540 && bogus.eave_lf === 120);

  // 3c. Snapped garage with entered dimensions → exact from dims.
  const fromDims = enforceGarageRoofSanity(
    { roof_area_sq: 18, garage_dim_l: 20, garage_dim_w: 22, pitch: '6/12' }, { label: 'Dims Garage' });
  const expDims = (440 + 84 * 1.5 + 9) / Math.cos(Math.atan(6 / 12));
  check('entered dims reconstruct exactly', approx(fromDims.roof_area_sqft, Math.round(expDims * 10) / 10), `got ${fromDims.roof_area_sqft}`);

  // 3d. NO exact geometry → fail closed, never invent a default.
  const failClosed = enforceGarageRoofSanity({ roof_area_sq: 25.4, eave_lf: 120, pitch: '5/12' }, { label: 'No Geometry' });
  check('fails closed: requires_manual_dimensions', failClosed.requires_manual_dimensions === true);
  check('fails closed: area zeroed, not defaulted', failClosed.roof_area_sqft === 0 && failClosed.roof_area_sq === 0);
  check('fails closed: linears zeroed', failClosed.eave_lf === 0);
  check('fails closed: confidence 0', failClosed.overall_confidence === 0);

  // 3e. Missing pitch with footprint → also fail closed (no guessed pitch).
  const noPitch = enforceGarageRoofSanity({ roof_area_sq: 25.4 }, { footprintSqFt: 484, perimeterFt: 88 });
  check('missing pitch fails closed', noPitch.requires_manual_dimensions === true);

  // 3f. Legitimate LARGE garage: satellite area consistent with its OWN traced
  // footprint must be kept, even above the generic 10 SQ ceiling.
  const legitBig = { roof_area_sq: 10.5, roof_area_sqft: 1050, pitch: '4/12' };
  const keptBig = enforceGarageRoofSanity(legitBig, { footprintSqFt: 900, perimeterFt: 120, pitch: '4/12' });
  const bigRecon = (900 + 120 * 1.5 + 9) / Math.cos(Math.atan(4 / 12));
  check('sanity: 1050 sqft is within recon × ratio', 1050 <= bigRecon * SNAP_CONFLICT_RATIO);
  check('legit large garage kept untouched', keptBig === legitBig);

  const sane = { roof_area_sq: 5.2, roof_area_sqft: 520, eave_lf: 40 };
  check('≤10 SQ garage passes through untouched', enforceGarageRoofSanity(sane) === sane);
  check('null-safe', enforceGarageRoofSanity(null) === null);

  console.log('\n4) Footprint-consistency clamp (mirrors aiRoofMeasurement.ts)');
  // 4 facets each wrongly given the whole 1200 sqft footprint @6/12 → 5367 sqft slope.
  const pitchRad = Math.atan(6 / 12);
  let totalAreaSqFt = 4 * 1200 / Math.cos(pitchRad);
  const osmFootprintSqFt = 1200;
  const flat = totalAreaSqFt * Math.cos(pitchRad);
  check('duplication detected (flat > footprint × 1.35)', flat > osmFootprintSqFt * 1.35);
  const scale = (osmFootprintSqFt * 1.35) / flat;
  totalAreaSqFt *= scale;
  check('clamped total ≈ footprint × 1.35 / cos(pitch)',
    approx(totalAreaSqFt, osmFootprintSqFt * 1.35 / Math.cos(pitchRad)), `got ${totalAreaSqFt}`);
  // A legit roof (footprint × 1.12 overhang) must NOT trip the clamp.
  const legitFlat = (1200 * 1.12 / Math.cos(pitchRad)) * Math.cos(pitchRad);
  check('legit roof (12% overhang) not clamped', legitFlat <= osmFootprintSqFt * 1.35);

  console.log(`\n${fail === 0 ? '🎉' : '💥'} ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('Test crashed:', e); process.exit(1); });
