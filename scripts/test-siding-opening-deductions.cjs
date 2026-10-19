#!/usr/bin/env node
/**
 * Siding Opening-Deduction Rules — End-to-End Smoke Test
 * ────────────────────────────────────────────────────────
 * Verifies the three-rule opening filter implemented in
 *   functions/utils/sidingMeasurementGraph.js  (MIN_DEDUCTIBLE_SQFT = 20)
 * with a synthetic payload covering every edge of the decision boundary.
 *
 * Rules under test (smallOpeningsInWaste === false, the production default):
 *   RULE A — Small openings (< 20 sqft) ride in the waste factor; they are
 *             preserved in opening_groups but carry deductible: false.
 *   RULE B — Large openings (≥ 20 sqft) are individually deducted from
 *             the siding facade; they carry deductible: true.
 *   RULE C — Geometrically distinct openings on the same face are kept as
 *             separate groups even when they share a height band (< 12 in
 *             apart vertically) — the graph never merges adjacent openings.
 *   RULE D — opening_deduction_sqft equals exactly the sum of deductible
 *             groups (subject to the 25%-of-facade sanity cap).
 *
 * Test scenario (all on the front face of a single-photo input):
 *   (a) Window  2.00 × 4.00 ft =  8.0 sqft  → < 20 sqft → RULE A (non-deductible)
 *   (b) Window  2.75 × 4.00 ft = 11.0 sqft  → < 20 sqft → RULE A (non-deductible)
 *   (c) Window  2.75 × 4.00 ft = 11.0 sqft  within 1 ft vertically of (b)
 *                                             → different pos_x → kept SEPARATE
 *                                             → RULE C + RULE A (non-deductible)
 *   (d) Door    3.00 × 6.80 ft = 20.4 sqft  → ≥ 20 sqft → RULE B (deductible)
 *   (e) Transom 3.50 × 4.00 ft = 14.0 sqft  → < 20 sqft → RULE A (non-deductible)
 *
 * Additionally, a dedicated exact-boundary section (Section 6) tests the
 * >= 20 predicate at its precise limits:
 *   (f) Opening 5.00 × 4.00 ft = 20.0 sqft  → EXACTLY at threshold → deductible
 *   (g) Opening 5.00 × 3.99 ft = 19.95 sqft → 0.05 sqft below threshold → non-deductible
 *
 * Expected opening_deduction_sqft: 20.40 sqft (door only).
 * Expected non-deductible groups: 4 (windows a/b/c + transom e).
 *
 * Usage:  node scripts/test-siding-opening-deductions.cjs
 */

'use strict';

let passed = 0, failed = 0;
function ok(label, cond, got, expected) {
  if (cond) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    const detail = got !== undefined
      ? ` \u2014 got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`
      : '';
    console.log(`  \u2717 ${label}${detail}`);
    failed++;
  }
}

(async () => {
  // ── Load the pure measurement-graph module ────────────────────────────────
  const mod = await import('../functions/utils/sidingMeasurementGraph.js');
  const { buildSidingMeasurementGraph } = mod;

  ok('module exports buildSidingMeasurementGraph',
     typeof buildSidingMeasurementGraph === 'function');

  // ── Synthetic input ───────────────────────────────────────────────────────
  // One photo covering the front wall with five explicitly-measured openings.
  // grossWallAreaSqft = 1500 keeps the 25%-cap (375 sqft) far above the
  // 20.4 sqft door deduction so the sanity cap never fires.
  const GROSS_SQFT = 1500;

  const syntheticPhoto = {
    view_label: 'Front',
    wall_face:  'front',
    confidence: 0.9,
    wall_width_ft: 40,
    eave_height_ft: 9,
    openings: [
      // (a) 8 sqft window — below threshold
      {
        type: 'window',
        width_ft: 2.00, height_ft: 4.00,   // sqft = 8.0
        pos_x: 5,  pos_y: 5,
        zone: 'upper_left',
        confidence: 0.90,
      },
      // (b) 11 sqft window — below threshold, left cluster
      {
        type: 'window',
        width_ft: 2.75, height_ft: 4.00,   // sqft = 11.0
        pos_x: 12, pos_y: 5.0,
        zone: 'upper_center_left',
        confidence: 0.88,
      },
      // (c) 11 sqft window — below threshold, within 1 ft height of (b),
      //     but pos_x differs by 8 ft → NOT a duplicate → kept as own group
      {
        type: 'window',
        width_ft: 2.75, height_ft: 4.00,   // sqft = 11.0
        pos_x: 20, pos_y: 5.7,             // Δy = 0.7 ft (< 1 ft)  Δx = 8 ft
        zone: 'upper_center_right',
        confidence: 0.88,
      },
      // (d) 20.4 sqft door — AT threshold, must be deducted
      {
        type: 'entry_door',
        width_ft: 3.00, height_ft: 6.80,   // sqft = 20.4
        pos_x: 30, pos_y: 3,
        zone: 'lower_right',
        confidence: 0.95,
      },
      // (e) 14 sqft transom — below threshold
      {
        type: 'window',
        width_ft: 3.50, height_ft: 4.00,   // sqft = 14.0
        pos_x: 35, pos_y: 9,
        zone: 'upper_far_right',
        confidence: 0.82,
      },
    ],
  };

  const graph = buildSidingMeasurementGraph({
    perPhotoResults:    [syntheticPhoto],
    grossWallAreaSqft:  GROSS_SQFT,
    accentDeductionSqft: 0,
    perimeterFt:         120,
    buildingWidthFt:      40,
    buildingLengthFt:     30,
    storyCount:            1,
    wallHeightFt:          9,
    smallOpeningsInWaste: false,   // production default — only ≥20 sqft deduct
  });

  // ── Section 1: Group count ────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Group count \u2500\u2500');
  ok('all 5 openings become separate groups',
     graph.opening_groups.length === 5,
     graph.opening_groups.length, 5);

  // ── Section 2: Deductibility flags ───────────────────────────────────────
  console.log('\n\u2500\u2500 Deductibility per opening \u2500\u2500');

  // Find groups by rounded area so we don't depend on stable ordering.
  const byArea = (sqft) =>
    graph.opening_groups.filter(g => Math.abs(g.area_sqft - sqft) < 0.05);

  const win8   = byArea(8.0);
  const win11  = byArea(11.0);
  const door   = byArea(20.4);
  const trans  = byArea(14.0);

  ok('8.0 sqft window group exists',
     win8.length === 1, win8.length, 1);
  ok('8.0 sqft window is NOT deductible (< 20 sqft — RULE A)',
     win8.length > 0 && win8[0].deductible === false,
     win8[0]?.deductible, false);

  ok('two 11.0 sqft window groups exist (distinct pos_x — RULE C)',
     win11.length === 2, win11.length, 2);
  ok('first 11.0 sqft window is NOT deductible (< 20 sqft — RULE A)',
     win11.length > 0 && win11[0].deductible === false,
     win11[0]?.deductible, false);
  ok('second 11.0 sqft window is NOT deductible (< 20 sqft — RULE A)',
     win11.length > 1 && win11[1].deductible === false,
     win11[1]?.deductible, false);

  ok('20.4 sqft door group exists',
     door.length === 1, door.length, 1);
  ok('20.4 sqft door IS deductible (≥ 20 sqft — RULE B)',
     door.length > 0 && door[0].deductible === true,
     door[0]?.deductible, true);

  ok('14.0 sqft transom group exists',
     trans.length === 1, trans.length, 1);
  ok('14.0 sqft transom is NOT deductible (< 20 sqft — RULE A)',
     trans.length > 0 && trans[0].deductible === false,
     trans[0]?.deductible, false);

  // 4 of 5 groups must be non-deductible
  const nonDeductCount = graph.opening_groups.filter(g => !g.deductible).length;
  ok('exactly 4 non-deductible groups (a, b, c, e)',
     nonDeductCount === 4, nonDeductCount, 4);
  const deductCount = graph.opening_groups.filter(g => g.deductible).length;
  ok('exactly 1 deductible group (door only)',
     deductCount === 1, deductCount, 1);

  // ── Section 3: Aggregate deduction total ─────────────────────────────────
  console.log('\n\u2500\u2500 Aggregate deduction (RULE D) \u2500\u2500');

  // sidingShare = (1500 - 0) / 1500 = 1.0; cap = 1500 × 0.25 = 375 sqft
  // opening_deduction_sqft = min(20.4 × 1.0, 375) = 20.4
  const EXPECTED_DEDUCTION = 20.4;
  const EXPECTED_DEDUCTION_AREA_TOTAL = 20.4; // only the door

  ok('opening_area_total_sqft counts only deductible groups',
     Math.abs(graph.totals.opening_area_total_sqft - EXPECTED_DEDUCTION_AREA_TOTAL) < 0.01,
     graph.totals.opening_area_total_sqft, EXPECTED_DEDUCTION_AREA_TOTAL);

  ok('opening_deduction_sqft equals exactly the door area (no sanity cap needed)',
     Math.abs(graph.totals.opening_deduction_sqft - EXPECTED_DEDUCTION) < 0.01,
     graph.totals.opening_deduction_sqft, EXPECTED_DEDUCTION);

  ok('opening_deduction_capped is false (20.4 well below 25%-of-facade cap)',
     graph.totals.opening_deduction_capped === false,
     graph.totals.opening_deduction_capped, false);

  // The front photo confirms the 9 ft eave. Lengths stay on the 120 ft
  // perimeter, so the billed wall is 120 × 9 rather than the dummy 1,500
  // extrusion used to keep the opening cap from firing.
  const billedGross = graph.totals.gross_wall_area_sqft;
  ok('billed wall area is the footprint perimeter at the confirmed eave',
     Math.abs(billedGross - 120 * 9) < 0.5,
     billedGross, 1080);
  const expectedNet = Math.round((billedGross - EXPECTED_DEDUCTION) * 100) / 100;
  ok(`net_siding_area_sqft = ${billedGross} - ${EXPECTED_DEDUCTION} = ${expectedNet}`,
     Math.abs(graph.totals.net_siding_area_sqft - expectedNet) < 0.1,
     graph.totals.net_siding_area_sqft, expectedNet);

  // ── Section 4: openings_detail shape ────────────────────────────────────
  // The HTTP handler converts opening_groups → openings_detail. Verify the
  // canonical fields a caller would read are correctly shaped here.
  console.log('\n\u2500\u2500 opening_groups schema \u2500\u2500');
  const allGroups = graph.opening_groups;
  const hasId        = allGroups.every(g => typeof g.id === 'string' && g.id.length > 0);
  const hasType      = allGroups.every(g => typeof g.type === 'string');
  const hasFace      = allGroups.every(g => typeof g.face === 'string');
  const hasAreaSqft  = allGroups.every(g => typeof g.area_sqft === 'number' && g.area_sqft > 0);
  const hasDeductible = allGroups.every(g => typeof g.deductible === 'boolean');

  ok('every group has a stable string id',         hasId);
  ok('every group has a type field',               hasType);
  ok('every group has a face field',               hasFace);
  ok('every group has a positive area_sqft',       hasAreaSqft);
  ok('every group has a boolean deductible field', hasDeductible);

  // Reconciliation must be consistent
  ok('reconciliation reports no issues',
     graph.reconciliation.consistent === true,
     graph.reconciliation.consistent, true);

  // ── Section 6: Exact boundary — >= 20 sqft predicate ────────────────────
  // The reviewer-identified regression: changing `>= 20` to `> 20` must break
  // this section. One opening at exactly 20.00 sqft must be deductible; one at
  // 19.95 sqft (just below) must not be.
  console.log('\n\u2500\u2500 Exact >= 20 sqft boundary \u2500\u2500');
  {
    // (f) 5.00 × 4.00 = 20.00 sqft — exactly at the threshold
    const gExact = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front', wall_face: 'front', confidence: 0.9,
        openings: [{ type: 'entry_door', width_ft: 5.0, height_ft: 4.0, pos_x: 10, pos_y: 3, confidence: 0.9 }],
      }],
      grossWallAreaSqft: 1500, accentDeductionSqft: 0, perimeterFt: 120,
      smallOpeningsInWaste: false,
    });
    const exact = gExact.opening_groups[0];
    ok('5.00 × 4.00 ft = 20.00 sqft opening exists',
       exact && Math.abs(exact.area_sqft - 20.0) < 0.01,
       exact?.area_sqft, 20.0);
    ok('20.00 sqft opening IS deductible (exactly at >= 20 threshold)',
       exact?.deductible === true,
       exact?.deductible, true);
    ok('opening_deduction_sqft = 20.00 (boundary case)',
       Math.abs(gExact.totals.opening_deduction_sqft - 20.0) < 0.01,
       gExact.totals.opening_deduction_sqft, 20.0);
  }
  {
    // (g) 5.00 × 3.99 = 19.95 sqft — 0.05 sqft below the threshold
    const gJustUnder = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front', wall_face: 'front', confidence: 0.9,
        openings: [{ type: 'window', width_ft: 5.0, height_ft: 3.99, pos_x: 10, pos_y: 3, confidence: 0.9 }],
      }],
      grossWallAreaSqft: 1500, accentDeductionSqft: 0, perimeterFt: 120,
      smallOpeningsInWaste: false,
    });
    const justUnder = gJustUnder.opening_groups[0];
    const justUnderSqft = Math.round(5.0 * 3.99 * 100) / 100; // 19.95
    ok('5.00 × 3.99 ft = 19.95 sqft opening exists',
       justUnder && Math.abs(justUnder.area_sqft - justUnderSqft) < 0.05,
       justUnder?.area_sqft, justUnderSqft);
    ok('19.95 sqft opening is NOT deductible (just below threshold)',
       justUnder?.deductible === false,
       justUnder?.deductible, false);
    ok('opening_deduction_sqft = 0 for sub-threshold only input',
       gJustUnder.totals.opening_deduction_sqft === 0,
       gJustUnder.totals.opening_deduction_sqft, 0);
  }

  // ── Section 5: smallOpeningsInWaste=true override ─────────────────────────
  console.log('\n\u2500\u2500 smallOpeningsInWaste override \u2500\u2500');
  {
    const gAll = buildSidingMeasurementGraph({
      perPhotoResults:    [syntheticPhoto],
      grossWallAreaSqft:  GROSS_SQFT,
      accentDeductionSqft: 0,
      perimeterFt:         120,
      smallOpeningsInWaste: true,   // all openings deductible
    });
    const allDeductible = gAll.opening_groups.every(g => g.deductible);
    ok('when smallOpeningsInWaste=true every group becomes deductible',
       allDeductible, allDeductible, true);

    // Total = 8 + 11 + 11 + 20.4 + 14 = 64.4 sqft
    const TOTAL_ALL = 8 + 11 + 11 + 20.4 + 14;  // 64.4
    ok('opening_area_total_sqft = sum of all five openings (64.4)',
       Math.abs(gAll.totals.opening_area_total_sqft - TOTAL_ALL) < 0.05,
       gAll.totals.opening_area_total_sqft, TOTAL_ALL);
  }

  console.log('\n25%-of-facade sanity cap');
  {
    const CAP_GROSS_SQFT = 100;
    const repeatedOpening = {
      type: 'window',
      width_ft: 10,
      height_ft: 4,
      confidence: 0.9,
    };
    const inflatedGraph = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front',
        wall_face: 'front',
        confidence: 0.9,
        openings: Array.from({ length: 8 }, () => ({ ...repeatedOpening })),
      }],
      grossWallAreaSqft: CAP_GROSS_SQFT,
      accentDeductionSqft: 0,
      perimeterFt: 40,
      buildingWidthFt: 10,
      buildingLengthFt: 10,
      storyCount: 1,
      wallHeightFt: 10,
      smallOpeningsInWaste: true,
    });

    const expectedCap = CAP_GROSS_SQFT * 0.25;
    ok('raw opening deduction exceeds the 25%-of-facade cap',
       inflatedGraph.totals.opening_deduction_raw_sqft > expectedCap,
       inflatedGraph.totals.opening_deduction_raw_sqft, `>${expectedCap}`);
    ok('opening_deduction_capped is true for inflated duplicate observations',
       inflatedGraph.totals.opening_deduction_capped === true,
       inflatedGraph.totals.opening_deduction_capped, true);
    ok('opening_deduction_sqft equals exactly 25% of gross wall area',
       inflatedGraph.totals.opening_deduction_sqft === expectedCap,
       inflatedGraph.totals.opening_deduction_sqft, expectedCap);
    ok('net siding area is never negative after the cap',
       inflatedGraph.totals.net_siding_area_sqft >= 0,
       inflatedGraph.totals.net_siding_area_sqft, '>=0');
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\u2757 Opening-deduction smoke test FAILED');
    process.exit(1);
  } else {
    console.log('\u2705 All opening-deduction rules verified');
  }
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
