#!/usr/bin/env node
'use strict';
/**
 * Fused satellite-to-photo cross-calibration engine tests.
 *
 * Guards src/lib/satelliteUtils.js: isolateRoofFootprintSqft +
 * applyPhotoPitchToAnalysis. A photo-derived pitch must discard the satellite
 * 3D surface area and re-project the isolated 2D footprint:
 *   True 3D Area = 2D Area / cos(arctan(rise/12)) = 2D Area × pitch multiplier
 *
 * Run: node scripts/test-fused-pitch-calibration.cjs
 */

let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const near = (a, b, tolPct = 0.5) => Math.abs(a - b) <= Math.abs(b) * (tolPct / 100);

(async () => {
  const { applyPhotoPitchToAnalysis, isolateRoofFootprintSqft, getPitchMultiplier, parsePitchRise } =
    await import('../src/lib/satelliteUtils.js');

  // ── 1. Footprint isolation ────────────────────────────────────────────────
  console.log('── isolateRoofFootprintSqft ──');

  // Google Solar wholeRoofStats ground area wins (185.8 m² ≈ 2000 sqft)
  const solarAnalysis = {
    roof_area_sq: 22.36, corrected_area_sq: 22.36, corrected_area_sqft: 2236,
    pitch: '6/12', area_is_slope_adjusted: true,
    ridge_lf: 40, eave_lf: 80, rake_lf: 44, hip_lf: 0, valley_lf: 12,
    area_range: { low: 21.2, high: 23.5 },
    raw_solar_data: { solarPotential: { wholeRoofStats: { groundAreaMeters2: 185.8 },
      roofSegmentStats: [ { stats: { areaMeters2: 110, groundAreaMeters2: 100 } },
                          { stats: { areaMeters2: 95.7, groundAreaMeters2: 85.8 } } ] } },
  };
  ok('prefers wholeRoofStats.groundAreaMeters2',
     near(isolateRoofFootprintSqft(solarAnalysis), 185.8 * 10.7639));

  // Per-segment ground areas summed when wholeRoofStats is missing
  const segOnly = { ...solarAnalysis, raw_solar_data: { solarPotential: {
    roofSegmentStats: solarAnalysis.raw_solar_data.solarPotential.roofSegmentStats } } };
  ok('falls back to Σ segment groundAreaMeters2',
     near(isolateRoofFootprintSqft(segOnly), 185.8 * 10.7639));

  // Slope-adjusted source without ground stats: de-project with basis pitch
  const noGround = { ...solarAnalysis, raw_solar_data: null };
  ok('de-projects sloped area with cos(atan(rise/12)) when no ground stats',
     near(isolateRoofFootprintSqft(noGround), 2236 * Math.cos(Math.atan(6 / 12))));

  // Footprint-based source: divide by multiplier
  const manual = { corrected_area_sq: 22.36, corrected_area_sqft: 2236, pitch: '6/12',
                   area_is_slope_adjusted: false };
  ok('footprint-based source divides by pitch multiplier',
     near(isolateRoofFootprintSqft(manual), 2236 / getPitchMultiplier('6/12')));

  // Unknown basis pitch + slope-adjusted + no ground stats → null (fail honest)
  ok('returns null when slope cannot honestly be de-projected',
     isolateRoofFootprintSqft({ corrected_area_sqft: 2236, pitch: 'Unknown',
                                area_is_slope_adjusted: true }) === null);

  // ── 2. Fused pitch application ────────────────────────────────────────────
  console.log('── applyPhotoPitchToAnalysis ──');
  const fp = 185.8 * 10.7639; // exact 2D footprint from Solar ground stats
  const fused = applyPhotoPitchToAnalysis(solarAnalysis, '9/12', { confidence: 'high' });

  ok('area = footprint × new pitch multiplier (satellite 3D area discarded)',
     near(fused.corrected_area_sqft, fp * getPitchMultiplier('9/12')),
     `got ${fused.corrected_area_sqft}, want ~${Math.round(fp * 1.25)}`);
  ok('corrected_area_sq consistent with sqft', near(fused.corrected_area_sq * 100, fused.corrected_area_sqft));
  ok('flags: photo_pitch_override + recalibrated + slope-adjusted',
     fused.photo_pitch_override === true && fused.area_recalibrated_from_footprint === true
     && fused.area_is_slope_adjusted === true);
  ok('provenance: original satellite pitch & area retained',
     fused.original_satellite_pitch === '6/12' && near(fused.original_satellite_area_sq, 22.36));
  ok('footprint_sqft_2d recorded', near(fused.footprint_sqft_2d, fp, 1));
  ok('pitch + multiplier updated', fused.pitch === '9/12' && fused.pitch_multiplier === getPitchMultiplier('9/12'));

  // Linears: ridge/eave horizontal (unchanged); rake ∝ √(1+s²); hip/valley ∝ √(2+s²)
  const s1 = 6 / 12, s2 = 9 / 12;
  ok('ridge and eave LF unchanged', fused.ridge_lf === 40 && fused.eave_lf === 80);
  ok('rake LF rescaled by √(1+s²) ratio',
     near(fused.rake_lf, 44 * Math.sqrt(1 + s2 * s2) / Math.sqrt(1 + s1 * s1)));
  ok('valley LF rescaled by √(2+s²) ratio',
     near(fused.valley_lf, 12 * Math.sqrt(2 + s2 * s2) / Math.sqrt(2 + s1 * s1)));
  ok('zero hip LF stays zero', (fused.hip_lf || 0) === 0);
  ok('area_range rescaled with the area',
     near(fused.area_range.low / solarAnalysis.area_range.low,
          fused.corrected_area_sq / solarAnalysis.corrected_area_sq, 1));

  // Raw roof_area_* must follow the fused value — exports/reports read the raw
  // fields and would otherwise print the stale satellite area.
  ok('roof_area_sq/sqft follow the fused area (satellite 3D area fully discarded)',
     fused.roof_area_sq === fused.corrected_area_sq && fused.roof_area_sqft === fused.corrected_area_sqft);

  // Idempotence / re-application: second apply must re-derive from the SAME
  // footprint, not compound (memory: consumers must never re-multiply).
  const fusedTwice = applyPhotoPitchToAnalysis(fused, '9/12');
  ok('re-applying the same pitch does not compound the area',
     near(fusedTwice.corrected_area_sqft, fused.corrected_area_sqft, 0.1));
  ok('re-applying the same pitch does not compound linears',
     fusedTwice.rake_lf === fused.rake_lf && fusedTwice.valley_lf === fused.valley_lf,
     `rake ${fused.rake_lf}→${fusedTwice.rake_lf}, valley ${fused.valley_lf}→${fusedTwice.valley_lf}`);
  const fusedBack = applyPhotoPitchToAnalysis(fused, '6/12');
  ok('applying a new pitch after an override re-derives from footprint',
     near(fusedBack.corrected_area_sqft, fp * getPitchMultiplier('6/12')));
  ok('reverting to the original pitch restores baseline linears',
     near(fusedBack.rake_lf, 44, 0.5) && near(fusedBack.valley_lf, 12, 1),
     `rake ${fusedBack.rake_lf} (want 44), valley ${fusedBack.valley_lf} (want 12)`);
  const fusedZig = applyPhotoPitchToAnalysis(applyPhotoPitchToAnalysis(fused, '6/12'), '9/12');
  ok('6→9→6→9 refinement chain stays stable',
     near(fusedZig.corrected_area_sqft, fused.corrected_area_sqft, 0.1)
     && fusedZig.rake_lf === fused.rake_lf);

  // De-projection path (no ground stats): footprint via original satellite pitch
  const fusedNoGround = applyPhotoPitchToAnalysis(noGround, '9/12');
  ok('no-ground-stats path re-projects de-projected footprint',
     near(fusedNoGround.corrected_area_sqft,
          2236 * Math.cos(Math.atan(0.5)) * getPitchMultiplier('9/12')));
  const fusedNoGroundTwice = applyPhotoPitchToAnalysis(fusedNoGround, '9/12');
  ok('no-ground-stats path is stable on re-application (basis = original satellite pitch)',
     near(fusedNoGroundTwice.corrected_area_sqft, fusedNoGround.corrected_area_sqft, 0.1));

  // Fail-honest: unknown satellite pitch, slope-adjusted, no ground stats
  const blind = applyPhotoPitchToAnalysis(
    { corrected_area_sq: 22.36, corrected_area_sqft: 2236, pitch: 'Unknown',
      area_is_slope_adjusted: true }, '9/12');
  ok('label-only update when footprint cannot be isolated',
     blind.pitch === '9/12' && blind.area_recalibrated_from_footprint === false
     && blind.corrected_area_sqft === 2236);

  // Footprint-based source recompute (legacy behavior preserved through new engine)
  const fusedManual = applyPhotoPitchToAnalysis(manual, '9/12');
  ok('footprint-based source recomputes with new multiplier',
     near(fusedManual.corrected_area_sqft,
          (2236 / getPitchMultiplier('6/12')) * getPitchMultiplier('9/12')));

  // ── 3. Provenance: hand-picked pitch vs photo-verified pitch ──────────────
  // The re-projection maths is identical, but a pitch the contractor typed in
  // must never be presented as "photo-verified".
  console.log('\n── manual pitch override provenance ──');

  const photoFused = applyPhotoPitchToAnalysis(solarAnalysis, '9/12', { confidence: 'high' });
  ok('default source stays photo-verified (backward compatible)',
     photoFused.photo_pitch_override === true
     && photoFused.manual_pitch_override === false
     && photoFused.pitch_source === 'onsite_photos');

  const manualFused = applyPhotoPitchToAnalysis(solarAnalysis, '9/12', { source: 'manual_override' });
  ok('manual source is NOT labelled photo-verified',
     manualFused.manual_pitch_override === true
     && manualFused.photo_pitch_override === false
     && manualFused.pitch_source === 'manual_override');
  ok('manual override re-projects the area identically to a photo pitch',
     near(manualFused.corrected_area_sqft, photoFused.corrected_area_sqft, 0.01));

  const cleared = applyPhotoPitchToAnalysis(manualFused, '6/12', { source: 'satellite' });
  ok('clearing a manual override restores the baseline area',
     near(cleared.corrected_area_sqft, fp * getPitchMultiplier('6/12')),
     `got ${cleared.corrected_area_sqft}`);
  ok('clearing a manual override drops both provenance flags',
     cleared.manual_pitch_override === false && cleared.photo_pitch_override === false
     && cleared.pitch_source === 'satellite');
  ok('clearing a manual override restores baseline linears',
     near(cleared.rake_lf, 44, 0.1) && cleared.eave_lf === 80);

  const backToPhoto = applyPhotoPitchToAnalysis(manualFused, '9/12', { confidence: 'high' });
  ok('reverting a manual override to a photo pitch restores photo provenance',
     backToPhoto.photo_pitch_override === true && backToPhoto.manual_pitch_override === false);

  // ── 4. Stored order quantity must follow the re-projected area ────────────
  // Estimate + measurement report HTML prefer the stored field over recomputing.
  console.log('\n── final_order_quantity_sq ──');
  const withOrderQty = { ...solarAnalysis, waste_percentage: 15, final_order_quantity_sq: 25.71 };
  const oqFused = applyPhotoPitchToAnalysis(withOrderQty, '9/12', { source: 'manual_override' });
  ok('order quantity recomputed from the re-projected area + waste',
     near(oqFused.final_order_quantity_sq, oqFused.corrected_area_sq * 1.15, 0.1),
     `got ${oqFused.final_order_quantity_sq}, want ~${(oqFused.corrected_area_sq * 1.15).toFixed(2)}`);
  ok('order quantity left alone when it was never populated',
     applyPhotoPitchToAnalysis(solarAnalysis, '9/12').final_order_quantity_sq === undefined);
  ok('order quantity untouched when the footprint cannot be isolated',
     applyPhotoPitchToAnalysis(
       { corrected_area_sq: 22.36, corrected_area_sqft: 2236, pitch: 'Unknown',
         area_is_slope_adjusted: true, final_order_quantity_sq: 25.71 }, '9/12'
     ).final_order_quantity_sq === 25.71);

  // parsePitchRise sanity
  ok('parsePitchRise handles "8/12", "8:12", "8", junk',
     parsePitchRise('8/12') === 8 && parsePitchRise('8:12') === 8
     && parsePitchRise('8') === 8 && parsePitchRise('steep') === null);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.error('✗ Fused pitch calibration tests FAILED'); process.exit(1); }
  console.log('✅ Fused pitch calibration engine verified.');
})();
