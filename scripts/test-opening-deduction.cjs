'use strict';
/**
 * Unit test: photo-detected opening deduction % derivation in handleAnalyzeSiding.
 *
 * The backend (analyzeHousePhotosForSiding) returns authoritative values:
 *   - gross_wall_area_sqft  — gross wall before any deduction
 *   - opening_deduction_sqft — actual opening area deducted (from measurement graph)
 *   - wall_area_sqft / measurement_graph.totals.net_siding_area_sqft — net (NOT touched)
 *   - windows_count, doors_count, garage_door_count — detected counts
 *
 * The frontend must:
 *   1. Derive deduction % from backend gross + deduction (NOT reconstruct from config %)
 *   2. Snap to nearest 5%, clamp 10–25
 *   3. Set opening_deduction_pct on the data object for chip display
 *   4. NOT modify wall_area_sqft or measurement_graph.totals.net_siding_area_sqft
 *   5. Tag _photo_detected_* fields so the chip shows the count source
 *
 * Run: node scripts/test-opening-deduction.cjs
 * Exit 0 = all pass, exit 1 = failures.
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// ── Mirror of the computation in AIEstimator.jsx handleAnalyzeSiding ─────────
function applyOpeningDeductionFromBackend(data) {
  const detectedW  = data.windows_count ?? data.window_assemblies_count ?? 0;
  const detectedD  = data.doors_count ?? 0;
  const detectedGD = data.garage_door_count ?? 0;
  const backendGross     = Number(data.gross_wall_area_sqft) || 0;
  const backendDeduction = Number(data.opening_deduction_sqft ?? data.opening_deduct_sqft) || 0;

  if (backendGross > 0 && backendDeduction > 0 && (detectedW + detectedD + detectedGD) > 0) {
    const rawPct    = (backendDeduction / backendGross) * 100;
    const snappedPct = Math.max(10, Math.min(25, Math.round(rawPct / 5) * 5));
    data.opening_deduction_pct    = snappedPct;
    data._photo_detected_windows      = detectedW;
    data._photo_detected_doors        = detectedD;
    data._photo_detected_garage_doors = detectedGD;
    data._photo_detected_opening_pct  = Math.round(rawPct * 10) / 10;
    return { rawPct, snappedPct };
  }
  return null;
}

// ── Test 1: 8 windows + 2 doors — backend says 9.7% → snap to 10% ────────────
// gross=1400, deduction=136, net=1264 (already in wall_area_sqft)
console.log('\nTest 1: 8w + 2d — backend gross=1400 deduction=136 → snap 10%');
{
  const originalNet = 1264;
  const originalGraphNet = 1264;
  const data = {
    wall_area_sqft: originalNet,
    wall_area_sq: originalNet / 100,
    gross_wall_area_sqft: 1400,
    opening_deduction_sqft: 136,
    windows_count: 8,
    doors_count: 2,
    garage_door_count: 0,
    measurement_graph: { totals: { net_siding_area_sqft: originalGraphNet } },
  };

  const r = applyOpeningDeductionFromBackend(data);

  assert(r !== null, 'result computed');
  assert(r.snappedPct === 10, `snapped to 10% (got ${r.snappedPct}%)`);
  assert(data.opening_deduction_pct === 10, `opening_deduction_pct set to 10`);
  // Net wall area must NOT be touched
  assert(data.wall_area_sqft === originalNet, `wall_area_sqft unchanged (${data.wall_area_sqft})`);
  assert(data.measurement_graph.totals.net_siding_area_sqft === originalGraphNet,
    `measurement_graph.totals.net_siding_area_sqft unchanged`);
  // Count tags
  assert(data._photo_detected_windows === 8, `_photo_detected_windows = 8`);
  assert(data._photo_detected_doors === 2, `_photo_detected_doors = 2`);
  assert(data._photo_detected_garage_doors === 0, `_photo_detected_garage_doors = 0`);
  assert(data._photo_detected_opening_pct === 9.7, `_photo_detected_opening_pct = 9.7`);
}

// ── Test 2: 20 windows + 6 doors → 18.1% → snap 20% ─────────────────────────
// gross=2000, deduction=362, net=1638
console.log('\nTest 2: 20w + 6d — backend gross=2000 deduction=362 → snap 20%');
{
  const originalNet = 1638;
  const data = {
    wall_area_sqft: originalNet,
    gross_wall_area_sqft: 2000,
    opening_deduction_sqft: 362,
    windows_count: 20,
    doors_count: 6,
    garage_door_count: 0,
    measurement_graph: { totals: { net_siding_area_sqft: originalNet } },
  };

  const r = applyOpeningDeductionFromBackend(data);

  assert(r !== null, 'result computed');
  assert(r.snappedPct === 20, `snapped to 20% (got ${r.snappedPct}%)`);
  assert(data.opening_deduction_pct === 20, `opening_deduction_pct set to 20`);
  assert(data.wall_area_sqft === originalNet, `wall_area_sqft unchanged`);
  assert(data.measurement_graph.totals.net_siding_area_sqft === originalNet,
    `measurement_graph net unchanged`);
}

// ── Test 3: garage door included — 5w + 1d + 1gd → snap 15% ─────────────────
// Detected opening: 5×12 + 1×20.4 + 1×112 = 192.4 sqft
// gross=1400, deduction=192, rawPct=13.7% → snap 15%
console.log('\nTest 3: 5w + 1d + 1gd — snap 15%');
{
  const data = {
    wall_area_sqft: 1208,
    gross_wall_area_sqft: 1400,
    opening_deduction_sqft: 192,
    windows_count: 5,
    doors_count: 1,
    garage_door_count: 1,
    measurement_graph: { totals: { net_siding_area_sqft: 1208 } },
  };

  const r = applyOpeningDeductionFromBackend(data);

  assert(r !== null, 'result computed');
  assert(r.snappedPct === 15, `snapped to 15% (got ${r.snappedPct}%)`);
  assert(data.opening_deduction_pct === 15, `opening_deduction_pct = 15`);
  assert(data._photo_detected_garage_doors === 1, `garage doors tagged`);
}

// ── Test 4: extreme deduction clamped to 25% ─────────────────────────────────
// gross=1000, deduction=564 (30w+10d) → 56.4% → clamp 25%
console.log('\nTest 4: extreme deduction clamped to 25%');
{
  const data = {
    wall_area_sqft: 436,
    gross_wall_area_sqft: 1000,
    opening_deduction_sqft: 564,
    windows_count: 30,
    doors_count: 10,
    garage_door_count: 0,
    measurement_graph: { totals: { net_siding_area_sqft: 436 } },
  };

  const r = applyOpeningDeductionFromBackend(data);

  assert(r !== null, 'result computed');
  assert(r.snappedPct === 25, `clamped to 25% (got ${r.snappedPct}%)`);
  assert(data.wall_area_sqft === 436, `wall_area_sqft unchanged at 436`);
}

// ── Test 5: tiny deduction clamped to 10% minimum ────────────────────────────
// gross=5000, deduction=44 (2w+1d) → 0.88% → clamp 10%
console.log('\nTest 5: tiny deduction clamped to 10% minimum');
{
  const data = {
    wall_area_sqft: 4956,
    gross_wall_area_sqft: 5000,
    opening_deduction_sqft: 44,
    windows_count: 2,
    doors_count: 1,
    garage_door_count: 0,
    measurement_graph: { totals: { net_siding_area_sqft: 4956 } },
  };

  const r = applyOpeningDeductionFromBackend(data);

  assert(r !== null, 'result computed');
  assert(r.snappedPct === 10, `clamped to 10% minimum (got ${r.snappedPct}%)`);
  assert(data.wall_area_sqft === 4956, `wall_area_sqft unchanged at 4956`);
}

// ── Test 6: no counts → no update applied ────────────────────────────────────
console.log('\nTest 6: zero opening counts → skip update');
{
  const data = {
    wall_area_sqft: 1190,
    gross_wall_area_sqft: 1400,
    opening_deduction_sqft: 0,
    windows_count: 0,
    doors_count: 0,
    garage_door_count: 0,
    measurement_graph: { totals: { net_siding_area_sqft: 1190 } },
  };

  const r = applyOpeningDeductionFromBackend(data);

  assert(r === null, 'returns null when no counts detected');
  assert(data.opening_deduction_pct === undefined, 'opening_deduction_pct not set');
  assert(data.wall_area_sqft === 1190, 'wall_area_sqft unchanged');
}

// ── Test 7: use opening_deduct_sqft alias if opening_deduction_sqft absent ───
console.log('\nTest 7: opening_deduct_sqft alias honored');
{
  const data = {
    wall_area_sqft: 1264,
    gross_wall_area_sqft: 1400,
    opening_deduct_sqft: 136,  // alias field name
    // opening_deduction_sqft absent
    windows_count: 8,
    doors_count: 2,
    garage_door_count: 0,
    measurement_graph: { totals: { net_siding_area_sqft: 1264 } },
  };

  const r = applyOpeningDeductionFromBackend(data);

  assert(r !== null, 'alias field recognized');
  assert(r.snappedPct === 10, `snapped 10% from alias (got ${r.snappedPct}%)`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n✅ All tests passed.`);
  process.exit(0);
}
