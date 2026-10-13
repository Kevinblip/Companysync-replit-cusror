#!/usr/bin/env node
/**
 * Manual siding math regression test
 * ────────────────────────────────────
 * Imports and exercises the PRODUCTION `computeManualSidingMeasurements`
 * helper from src/utils/manualSidingMath.js — the same module used by
 * handleBuildManualSidingEstimate in AIEstimator.jsx.
 *
 * A wrong coefficient, bad rounding, or formula drift in that module will
 * immediately break this test, before a contractor sees a wrong estimate in
 * the field.
 *
 * Scenarios covered
 * ─────────────────
 *  1. Standard 1-story house (gross, gable, opening deduction, net, trim)
 *  2. Fractional stories (1.5 × eave height)
 *  3. Zero-gable path (gable_rise_ft = 0)
 *  4. gableBase fallback (no buildingWidth → round(perim / 4))
 *  5. Opening-type isolation (window, door, garage door individually)
 *  6. Net wall area floor — deductions exceeding gross yield 0, not negative
 *  7. Corner-count variation — outsideCornerLF scales with corner count
 *  8. wall_area_sq == wall_area_sqft / 100 (unit conversion)
 *  9. Output shape — all measurement keys expected by handleBuildSidingEstimate
 *     are present in the returned object
 *
 * Usage:  node scripts/test-manual-siding-math.cjs
 */

'use strict';

/* ─── load production module via dynamic ESM import ───────────────────── */

let computeManualSidingMeasurements;
let MANUAL_SIDING_OPENING_SQFT;
let MANUAL_SIDING_OPENING_PERIMETER_LF;

(async () => {
  try {
    const mod = await import('../src/utils/manualSidingMath.js');
    computeManualSidingMeasurements = mod.computeManualSidingMeasurements;
    MANUAL_SIDING_OPENING_SQFT = mod.MANUAL_SIDING_OPENING_SQFT;
    MANUAL_SIDING_OPENING_PERIMETER_LF = mod.MANUAL_SIDING_OPENING_PERIMETER_LF;
  } catch (err) {
    console.error('Failed to import manualSidingMath.js:', err.message);
    process.exit(1);
  }

  runTests();
})();

/* ─── test harness ─────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;

function assert(condition, label, extra = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`);
    failed++;
  }
}

function assertEq(actual, expected, label) {
  const ok = actual === expected;
  assert(ok, label, ok ? '' : `expected ${expected}, got ${actual}`);
}

function assertClose(actual, expected, label, tol = 1e-9) {
  const ok = Math.abs(actual - expected) < tol;
  assert(ok, label, ok ? '' : `expected ~${expected}, got ${actual}`);
}

/* ─── test runner ──────────────────────────────────────────────────────── */

function runTests() {

  /* ── Scenario 1: standard 1-story house with all opening types ────────── */
  console.log('\n[1] Standard 1-story house: 180 LF × 9 ft eave, 4 ft gable rise, 30 ft width');
  console.log('    8 windows, 2 doors, 1 garage door, 4 outside corners');
  {
    const r = computeManualSidingMeasurements({
      perimeter_ft:          180,
      stories:               1,
      eave_height_ft:        9,
      gable_rise_ft:         4,
      windows_count:         8,
      doors_count:           2,
      garage_door_count:     1,
      outside_corners_count: 4,
      building_width_ft:     30,
    });

    // Wall geometry
    assertEq(r.grossWallSqft,   1620, 'grossWallSqft = 180 × 9');
    assertEq(r.totalWallHeight,    9, 'totalWallHeight = 1 × 9');

    // Gable: 2 triangles, base=30 ft, rise=4 ft → 0.5×30×4×2 = 120 sqft
    assertEq(r.gableBase,         30, 'gableBase uses buildingWidth when provided');
    assertEq(r.gableAreaSqft,    120, 'gableAreaSqft = 30 × 4 = 120');
    assertEq(r.gable_area_sqft,  120, 'gable_area_sqft output key matches');

    // Openings: 8 windows×15 + 2 doors×20 + 1 garage×63 = 120+40+63 = 223
    assertEq(r.openingDeductSqft,          223, 'openingDeductSqft = 120+40+63');
    assertEq(r.opening_deduct_sqft,        223, 'opening_deduct_sqft output key matches');
    assertEq(MANUAL_SIDING_OPENING_SQFT.window,     15, 'window opening constant = 15 sqft');
    assertEq(MANUAL_SIDING_OPENING_SQFT.door,       20, 'door opening constant = 20 sqft');
    assertEq(MANUAL_SIDING_OPENING_SQFT.garageDoor, 63, 'garageDoor opening constant = 63 sqft');

    // Net: 1620 + 120 − 223 = 1517
    assertEq(r.netWallSqft,   1517, 'netWallSqft = 1620 + 120 − 223');
    assertEq(r.wall_area_sqft, 1517, 'wall_area_sqft = round(netWallSqft)');
    assertClose(r.wall_area_sq, 15.17, 'wall_area_sq = netWallSqft / 100');

    // Trim
    assertEq(r.starterStripLF,    180, 'starterStripLF = perim');
    assertEq(r.starter_strip_lf,  180, 'starter_strip_lf output key matches');
    assertEq(r.outsideCornerLF,    36, 'outsideCornerLF = 4 corners × 9 ft');
    assertEq(r.outside_corners_lf, 36, 'outside_corners_lf output key matches');

    // J-channel: 8×16 + 2×19 = 128+38 = 166
    assertEq(MANUAL_SIDING_OPENING_PERIMETER_LF.window, 16, 'window perimeter constant = 16 LF');
    assertEq(MANUAL_SIDING_OPENING_PERIMETER_LF.door,   19, 'door perimeter constant = 19 LF');
    assertEq(r.jChannelLF,             166, 'jChannelLF = 8×16 + 2×19');
    assertEq(r.j_channel_openings_lf,  166, 'j_channel_openings_lf output key matches');

    // Pass-through fields
    assertEq(r.perimeter_ft,   180, 'perimeter_ft pass-through');
    assertEq(r.story_count,      1, 'story_count pass-through');
    assertEq(r.story_height_ft,  9, 'story_height_ft pass-through');
    assertEq(r.windows_count,    8, 'windows_count pass-through');
    assertEq(r.doors_count,      2, 'doors_count pass-through');
    assertEq(r.garage_door_count, 1, 'garage_door_count pass-through');
    assertEq(r.gable_rise_ft,    4, 'gable_rise_ft pass-through');
    assertEq(r.outside_corners_count, 4, 'outside_corners_count pass-through');
    assertEq(r.building_width_ft, 30, 'building_width_ft pass-through');
    assertEq(r.inside_corners_lf,  0, 'inside_corners_lf = 0 (manual has none)');
  }

  /* ── Scenario 2: fractional stories ──────────────────────────────────── */
  console.log('\n[2] Fractional stories: 180 LF × 1.5 stories × 9 ft eave');
  {
    const r = computeManualSidingMeasurements({
      perimeter_ft: 180, stories: 1.5, eave_height_ft: 9,
      gable_rise_ft: 4, windows_count: 8, doors_count: 2, garage_door_count: 1,
      outside_corners_count: 4, building_width_ft: 30,
    });

    assertEq(r.totalWallHeight, 13.5, 'totalWallHeight = 1.5 × 9');
    assertEq(r.grossWallSqft,   2430, 'grossWallSqft = 180 × 13.5');
    assertEq(r.gableAreaSqft,    120, 'gableAreaSqft unchanged at 120');
    assertEq(r.openingDeductSqft, 223, 'openingDeductSqft unchanged at 223');
    assertEq(r.netWallSqft,      2327, 'netWallSqft = 2430 + 120 − 223');
    assertEq(r.outsideCornerLF,    54, 'outsideCornerLF = 4 × 13.5 = 54');
    assertEq(r.starterStripLF,    180, 'starterStripLF = perim (unchanged)');
  }

  /* ── Scenario 3: zero-gable path ─────────────────────────────────────── */
  console.log('\n[3] Zero-gable path: gable_rise_ft = 0');
  {
    const r = computeManualSidingMeasurements({
      perimeter_ft: 180, stories: 1, eave_height_ft: 9, gable_rise_ft: 0,
      windows_count: 8, doors_count: 2, garage_door_count: 1,
      outside_corners_count: 4, building_width_ft: 30,
    });

    assertEq(r.gableAreaSqft,    0, 'gableAreaSqft = 0 when rise = 0');
    assertEq(r.gable_area_sqft,  0, 'gable_area_sqft output key = 0');
    assertEq(r.grossWallSqft, 1620, 'grossWallSqft still 1620');
    assertEq(r.netWallSqft,   1397, 'netWallSqft = 1620 − 223 (no gable)');
    assertEq(r.starterStripLF, 180, 'starterStripLF = 180');
    assertEq(r.outsideCornerLF, 36, 'outsideCornerLF = 36');
  }

  /* ── Scenario 4: gableBase fallback (no buildingWidth) ──────────────── */
  console.log('\n[4] gableBase fallback: no buildingWidth → round(perim / 4)');
  {
    // perim = 160 → gableBase = round(160/4) = 40
    const r = computeManualSidingMeasurements({
      perimeter_ft: 160, stories: 1, eave_height_ft: 9, gable_rise_ft: 4,
      windows_count: 0, doors_count: 0, garage_door_count: 0,
      outside_corners_count: 4, building_width_ft: 0,
    });

    assertEq(r.gableBase,      40, 'gableBase = round(160 / 4) = 40 when no width given');
    // gableAreaSqft = round(0.5 × 40 × 4 × 2) = 160
    assertEq(r.gableAreaSqft, 160, 'gableAreaSqft = 40 × 4 = 160');
    assertEq(r.grossWallSqft, 1440, 'grossWallSqft = 160 × 9 = 1440');
    assertEq(r.openingDeductSqft, 0, 'openingDeductSqft = 0 (no openings)');
    assertEq(r.netWallSqft,   1600, 'netWallSqft = 1440 + 160 = 1600');
    assertEq(r.building_width_ft, null, 'building_width_ft = null when input is 0');
  }

  /* ── Scenario 5: opening-type isolation ─────────────────────────────── */
  console.log('\n[5] Opening-type isolation: each type individually');
  {
    const base = { perimeter_ft: 180, stories: 1, eave_height_ft: 9,
      gable_rise_ft: 0, outside_corners_count: 4, building_width_ft: 30 };

    const w = computeManualSidingMeasurements({ ...base, windows_count: 1, doors_count: 0, garage_door_count: 0 });
    assertEq(w.openingDeductSqft, 15, 'window deduction = 15 sqft each');

    const d = computeManualSidingMeasurements({ ...base, windows_count: 0, doors_count: 1, garage_door_count: 0 });
    assertEq(d.openingDeductSqft, 20, 'entry door deduction = 20 sqft each');

    const g = computeManualSidingMeasurements({ ...base, windows_count: 0, doors_count: 0, garage_door_count: 1 });
    assertEq(g.openingDeductSqft, 63, 'garage door deduction = 63 sqft each');
  }

  /* ── Scenario 6: net never goes negative ─────────────────────────────── */
  console.log('\n[6] Net wall area floor: enormous opening count never yields negative sqft');
  {
    const r = computeManualSidingMeasurements({
      perimeter_ft: 40, stories: 1, eave_height_ft: 9, gable_rise_ft: 0,
      windows_count: 100, doors_count: 50, garage_door_count: 10,
      outside_corners_count: 4, building_width_ft: 10,
    });

    assert(r.netWallSqft >= 0, 'netWallSqft is never negative (max(0, …) floor)');
    assertEq(r.netWallSqft,    0, 'netWallSqft = 0 when deductions exceed gross');
    assertEq(r.wall_area_sqft, 0, 'wall_area_sqft = 0 when deductions exceed gross');
  }

  /* ── Scenario 7: corner-count variation ──────────────────────────────── */
  console.log('\n[7] outsideCornerLF scales with corner count, not a fixed 4');
  {
    const base = { perimeter_ft: 180, stories: 1, eave_height_ft: 9,
      gable_rise_ft: 0, windows_count: 0, doors_count: 0, garage_door_count: 0,
      building_width_ft: 30 };

    const r6 = computeManualSidingMeasurements({ ...base, outside_corners_count: 6 });
    assertEq(r6.outsideCornerLF, 54, 'outsideCornerLF = 6 × 9 = 54');

    const r8 = computeManualSidingMeasurements({ ...base, outside_corners_count: 8 });
    assertEq(r8.outsideCornerLF, 72, 'outsideCornerLF = 8 × 9 = 72');
  }

  /* ── Scenario 8: unit conversion ─────────────────────────────────────── */
  console.log('\n[8] wall_area_sq = wall_area_sqft / 100 (unit conversion)');
  {
    const r = computeManualSidingMeasurements({
      perimeter_ft: 200, stories: 2, eave_height_ft: 9, gable_rise_ft: 0,
      windows_count: 4, doors_count: 1, garage_door_count: 0,
      outside_corners_count: 4, building_width_ft: 50,
    });
    // 200 × 18 = 3600; deduct = 4×15 + 1×20 = 80; net = 3520
    assertEq(r.wall_area_sqft, 3520, 'wall_area_sqft = 3520');
    assertClose(r.wall_area_sq, r.wall_area_sqft / 100, 'wall_area_sq = wall_area_sqft / 100 exactly');
  }

  /* ── Scenario 9: gable message contract ─────────────────────────────── */
  console.log('\n[9] Gable message contract — gable_rise_ft is present and numeric (catches "undefinedft rise" regression)');
  {
    // AIEstimator.jsx builds the summary message using gable_rise_ft aliased
    // as `gableRise`.  If the utility returns only `gable_rise_ft` but the
    // consumer tries to destructure `gableRise` directly, the string renders
    // "undefinedft rise".  This scenario locks in the contract.
    const r = computeManualSidingMeasurements({
      perimeter_ft: 180, stories: 1, eave_height_ft: 9, gable_rise_ft: 4,
      windows_count: 0, doors_count: 0, garage_door_count: 0,
      outside_corners_count: 4, building_width_ft: 30,
    });

    // The consumer renames via: const { gable_rise_ft: gableRise } = calc;
    // So gable_rise_ft must be a number, not undefined.
    assert(typeof r.gable_rise_ft === 'number', 'gable_rise_ft is a number (not undefined)');
    assertEq(r.gable_rise_ft, 4, 'gable_rise_ft = 4 (matches input)');

    // Simulated message fragment — if gableRise were undefined the string
    // would contain "undefinedft rise" instead of "4ft rise".
    const gableRise = r.gable_rise_ft; // alias as the consumer does
    const fragment = r.gable_area_sqft > 0
      ? `Gable area: ${r.gable_area_sqft} sqft (${gableRise}ft rise)` : '';
    assert(!fragment.includes('undefined'), 'message fragment contains no "undefined"');
    assert(fragment.includes('4ft rise'), 'message fragment shows correct rise value');
  }

  /* ── Scenario 10: required output keys present ───────────────────────── */
  console.log('\n[10] Output shape — all keys used by handleBuildSidingEstimate are present');
  {
    const r = computeManualSidingMeasurements({
      perimeter_ft: 180, stories: 1, eave_height_ft: 9, gable_rise_ft: 4,
      windows_count: 4, doors_count: 1, garage_door_count: 1,
      outside_corners_count: 4, building_width_ft: 30,
    });
    const required = [
      'wall_area_sqft', 'wall_area_sq', 'perimeter_ft', 'story_count', 'story_height_ft',
      'windows_count', 'doors_count', 'garage_door_count', 'gable_rise_ft', 'gable_area_sqft',
      'outside_corners_count', 'building_width_ft', 'building_length_ft', 'opening_deduct_sqft',
      'j_channel_openings_lf', 'starter_strip_lf', 'outside_corners_lf', 'inside_corners_lf',
    ];
    for (const key of required) {
      assert(key in r, `output has key: ${key}`);
    }
  }

  /* ── summary ──────────────────────────────────────────────────────────── */
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\n❌ Manual siding math test FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ All manual siding math tests passed');
  }
}
