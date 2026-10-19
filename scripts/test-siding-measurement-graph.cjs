#!/usr/bin/env node
/**
 * Siding Measurement Graph — Focused Regression Test
 * ───────────────────────────────────────────────────
 * Exercises the pure canonical graph builder in
 *   functions/utils/sidingMeasurementGraph.js
 * with hand-crafted inputs (no AI, no server, no network).
 *
 * Proves the load-bearing contracts:
 *   1. Grouped window components represented separately from their group.
 *   2. Small openings retained but optionally non-deductible.
 *   3. J-channel uses the rough-opening GROUP perimeter, never components.
 *   4. Similar adjacent windows are NOT merged.
 *   5. Exact duplicate observations dedupe (highest confidence wins).
 *   6. Missing elevation coverage produces a warning.
 *   7. Same panorama reused → warning; street_view is reference-only.
 *   8. Reconciliation: net = gross - accent - openings.
 *   9. Garage openings interrupt starter strip at grade.
 *  10. Determinism: identical input → identical output.
 *
 * Usage:  node scripts/test-siding-measurement-graph.cjs
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

function fullCoveragePhotos(extra) {
  // Four verified elevations so coverage is otherwise clean.
  return [
    { view_label: 'Front', confidence: 0.9 },
    { view_label: 'Back', confidence: 0.9 },
    { view_label: 'Left', confidence: 0.9 },
    { view_label: 'Right', confidence: 0.9 },
    ...(extra || []),
  ];
}

(async () => {
  const mod = await import('../functions/utils/sidingMeasurementGraph.js');
  const buildSidingMeasurementGraph = mod.buildSidingMeasurementGraph;

  ok('module exports buildSidingMeasurementGraph',
     typeof buildSidingMeasurementGraph === 'function');

  // ───────────────────────────────────────────────────────────────────────
  // 1. Grouped window components represented separately.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Grouped window components \u2500\u2500');
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        openings: [{
          type: 'window', width_ft: 8, height_ft: 4, pos_x: 10, pos_y: 3,
          components: [
            { type: 'window', width_ft: 4, height_ft: 4 },
            { type: 'window', width_ft: 4, height_ft: 4 },
          ],
        }],
      }],
      grossWallAreaSqft: 1000, accentDeductionSqft: 0, perimeterFt: 120,
      smallOpeningsInWaste: true,
    });
    ok('one rough-opening group created', g.opening_groups.length === 1, g.opening_groups.length, 1);
    ok('two components represented separately', g.opening_components.length === 2, g.opening_components.length, 2);
    ok('group references its component ids', g.opening_groups[0].component_ids.length === 2);
    ok('window_assemblies counts the group (1)', g.counts.window_assemblies === 1, g.counts.window_assemblies, 1);
    ok('window_units counts the components (2)', g.counts.window_units === 2, g.counts.window_units, 2);
    const sash = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        openings: [{
          type: 'window', width_ft: 3, height_ft: 5, pos_x: 8, pos_y: 4,
          components: [
            { type: 'window', width_ft: 1.5, height_ft: 5 },
            { type: 'window', width_ft: 1.5, height_ft: 5 },
          ],
        }],
      }],
      grossWallAreaSqft: 1000, accentDeductionSqft: 0, perimeterFt: 120,
      smallOpeningsInWaste: true,
    });
    ok('a portrait double-hung split into equal sashes stays one unit',
       sash.counts.window_units === 1, sash.counts.window_units, 1);
    ok('that double-hung is still one assembly',
       sash.counts.window_assemblies === 1, sash.counts.window_assemblies, 1);
    ok('public windows_count reports the units (2), not the assembly',
       g.counts.windows_count === g.counts.window_units
         && g.counts.windows_count !== g.counts.window_assemblies,
       g.counts.windows_count, 2);
    // Deduction uses GROUP geometry (8x4=32), not components (2x16=32 here but
    // group perimeter proves it): group perimeter = 2*(8+4)=24.
    ok('group area uses group geometry (32)', g.opening_groups[0].area_sqft === 32, g.opening_groups[0].area_sqft, 32);
    ok('group perimeter = 24 (group, not components 2*16=32)',
       g.trim_edges.j_channel.lf === 24, g.trim_edges.j_channel.lf, 24);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 2. Small openings retained but optionally non-deductible.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Small openings retained + deductibility toggle \u2500\u2500');
  {
    const input = {
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        openings: [
          { type: 'window', width_ft: 2, height_ft: 3, pos_x: 1, pos_y: 1 }, // 6 sqft (<10)
          { type: 'window', width_ft: 6, height_ft: 5, pos_x: 20, pos_y: 3 }, // 30 sqft
        ],
      }],
      grossWallAreaSqft: 1000, accentDeductionSqft: 0, perimeterFt: 120,
    };
    const waste = buildSidingMeasurementGraph({ ...input, smallOpeningsInWaste: false });
    ok('tiny <10 sqft opening still preserved as a group', waste.opening_groups.length === 2, waste.opening_groups.length, 2);
    const tiny = waste.opening_groups.find((o) => o.area_sqft === 6);
    const big = waste.opening_groups.find((o) => o.area_sqft === 30);
    ok('tiny opening NOT deductible when smallOpeningsInWaste=false', tiny.deductible === false, tiny.deductible, false);
    ok('>=20 sqft opening IS deductible', big.deductible === true, big.deductible, true);
    ok('only the big opening deducted (30 sqft)', waste.totals.opening_deduction_sqft === 30, waste.totals.opening_deduction_sqft, 30);

    const all = buildSidingMeasurementGraph({ ...input, smallOpeningsInWaste: true });
    ok('when smallOpeningsInWaste=true all groups deductible', all.totals.opening_deduction_sqft === 36, all.totals.opening_deduction_sqft, 36);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 3. J-channel uses group perimeter, not summed component perimeters.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 J-channel = group perimeter \u2500\u2500');
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        openings: [{
          type: 'window', width_ft: 10, height_ft: 5, pos_x: 5, pos_y: 3,
          components: [
            { type: 'window', width_ft: 5, height_ft: 5 }, // perim 20
            { type: 'window', width_ft: 5, height_ft: 5 }, // perim 20
          ],
        }],
      }],
      grossWallAreaSqft: 1000, perimeterFt: 100, smallOpeningsInWaste: true,
    });
    // group perimeter = 2*(10+5)=30; summed components would be 40.
    ok('j_channel_lf = group perimeter 30 (not 40)', g.totals.j_channel_lf === 30, g.totals.j_channel_lf, 30);
    ok('j_channel basis is rough_opening_group_perimeter',
       g.trim_edges.j_channel.basis === 'rough_opening_group_perimeter');
    ok('starter_strip_lf === perimeter', g.totals.starter_strip_lf === 100, g.totals.starter_strip_lf, 100);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 4. Similar adjacent windows are NOT merged.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Similar adjacent windows not merged \u2500\u2500');
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        openings: [
          { type: 'window', width_ft: 3, height_ft: 4, pos_x: 5, pos_y: 3, zone: 'main' },
          { type: 'window', width_ft: 3, height_ft: 4, pos_x: 9, pos_y: 3, zone: 'main' }, // same size, different position
        ],
      }],
      grossWallAreaSqft: 1000, perimeterFt: 100, smallOpeningsInWaste: true,
    });
    ok('two distinct adjacent windows stay separate', g.opening_groups.length === 2, g.opening_groups.length, 2);
    ok('no duplicates removed for distinct positions', g.diagnostics.duplicates_removed === 0, g.diagnostics.duplicates_removed, 0);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 5. Exact duplicate observations dedupe (highest confidence wins).
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Exact duplicate observations dedupe \u2500\u2500');
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [
        { view_label: 'Front', confidence: 0.6,
          openings: [{ type: 'window', width_ft: 4, height_ft: 4, pos_x: 5, pos_y: 3, confidence: 0.6 }] },
        { view_label: 'Front', confidence: 0.95,
          openings: [{ type: 'window', width_ft: 4, height_ft: 4, pos_x: 5, pos_y: 3, confidence: 0.95 }] },
      ],
      grossWallAreaSqft: 1000, perimeterFt: 100, smallOpeningsInWaste: true,
    });
    ok('duplicate observation collapsed to one group', g.opening_groups.length === 1, g.opening_groups.length, 1);
    ok('exactly one duplicate removed', g.diagnostics.duplicates_removed === 1, g.diagnostics.duplicates_removed, 1);
    ok('highest-confidence copy kept (0.95)', g.opening_groups[0].confidence === 0.95, g.opening_groups[0].confidence, 0.95);

    // Explicit stable observation identity also dedupes.
    const g2 = buildSidingMeasurementGraph({
      perPhotoResults: [
        { view_label: 'Back', confidence: 0.7,
          openings: [{ type: 'entry_door', width_ft: 3, height_ft: 6.8, observation_id: 'door-A', confidence: 0.7 }] },
        { view_label: 'Back', confidence: 0.8,
          openings: [{ type: 'entry_door', width_ft: 3.2, height_ft: 6.9, observation_id: 'door-A', confidence: 0.8 }] },
      ],
      grossWallAreaSqft: 1000, perimeterFt: 100, smallOpeningsInWaste: true,
    });
    ok('same observation_id dedupes across photos', g2.opening_groups.length === 1, g2.opening_groups.length, 1);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 5b. A corner photo re-photographing a flat-wall opening must not double
  //     the deductible siding deduction.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n── Flat + corner duplicate opening ──');
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          view_label: 'Front',
          confidence: 0.9,
          openings: [{
            type: 'door',
            width_ft: 4,
            height_ft: 7,
            pos_x: 12,
            pos_y: 0,
            observation_id: 'front-door-1',
          }],
        },
        {
          view_label: 'FR Corner',
          confidence: 0.85,
          openings: [{
            type: 'entry_door',
            width_ft: 4,
            height_ft: 7,
            pos_x: 12,
            pos_y: 0,
            observation_id: 'front-door-1',
          }],
        },
      ],
      grossWallAreaSqft: 1000,
      accentDeductionSqft: 0,
      perimeterFt: 120,
      smallOpeningsInWaste: false,
    });
    ok('flat + FR Corner duplicate resolves to one opening group',
       g.opening_groups.length === 1, g.opening_groups.length, 1);
    ok('duplicate deductible door contributes its area only once',
       g.totals.opening_deduction_sqft === 28,
       g.totals.opening_deduction_sqft, 28);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 6. Missing elevation coverage → warning.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Missing coverage warning \u2500\u2500');
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [
        { view_label: 'Front', confidence: 0.9 },
        { view_label: 'Back', confidence: 0.9 },
      ],
      grossWallAreaSqft: 1000, perimeterFt: 100,
    });
    const missing = g.coverage.warnings.filter((w) => w.code === 'missing_elevation').map((w) => w.face).sort();
    ok('left_side + right_side flagged missing', JSON.stringify(missing) === JSON.stringify(['left_side', 'right_side']), missing);
    ok('coverage.review_required is true', g.coverage.review_required === true);
    ok('coverage status is incomplete (>=2 missing)', g.coverage.status === 'incomplete', g.coverage.status, 'incomplete');

    const full = buildSidingMeasurementGraph({
      perPhotoResults: fullCoveragePhotos(), grossWallAreaSqft: 1000, perimeterFt: 100,
    });
    ok('all four elevations → status complete', full.coverage.status === 'complete', full.coverage.status, 'complete');
    ok('complete coverage → confidence 1', full.coverage.confidence === 1, full.coverage.confidence, 1);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 7. Same panorama reused → warning; street_view is reference-only.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Duplicate panorama + street_view reference-only \u2500\u2500');
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [
        { view_label: 'Front', confidence: 0.9, panorama_id: 'PANO1' },
        { view_label: 'Back', confidence: 0.9, panorama_id: 'PANO1' }, // reused
        { view_label: 'Left', confidence: 0.9, source_type: 'street_view' }, // reference only
        { view_label: 'Right', confidence: 0.9, source_type: 'street_view', verified_elevation: true }, // counts
      ],
      grossWallAreaSqft: 1000, perimeterFt: 100,
    });
    const dup = g.coverage.warnings.find((w) => w.code === 'duplicate_panorama' && w.panorama_id === 'PANO1');
    ok('duplicate/reused panorama flagged', !!dup && dup.count === 2, dup && dup.count, 2);
    const refOnly = g.coverage.warnings.filter((w) => w.code === 'reference_only_photo');
    ok('unverified street_view flagged reference_only', refOnly.length === 1, refOnly.length, 1);
    ok('reference_only left_side NOT counted as coverage', !g.coverage.covered_faces.includes('left_side'));
    ok('verified street_view right_side IS counted as coverage', g.coverage.covered_faces.includes('right_side'));
  }
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [{ view_label: 'mystery-angle', confidence: 0.9 }],
      grossWallAreaSqft: 1000, perimeterFt: 100,
    });
    ok('unresolved face → unknown_facet_assignment warning',
       g.coverage.warnings.some((w) => w.code === 'unknown_facet_assignment'));
    ok('low-confidence photo flagged',
       buildSidingMeasurementGraph({
         perPhotoResults: [{ view_label: 'Front', confidence: 0.2 }],
         grossWallAreaSqft: 1000, perimeterFt: 100,
       }).coverage.warnings.some((w) => w.code === 'low_confidence_photo'));
  }

  // ───────────────────────────────────────────────────────────────────────
  // 8. Reconciliation: net = (gross - masonry) - siding-allocated openings.
  //    Openings are charged to the material of the wall they are cut into, so a
  //    window in a brick wall reduces the brick column, not the siding column.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Reconciliation \u2500\u2500');
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        openings: [{ type: 'window', width_ft: 6, height_ft: 5, pos_x: 5, pos_y: 3 }], // 30 sqft
      }],
      grossWallAreaSqft: 1000, accentDeductionSqft: 100, perimeterFt: 120,
      smallOpeningsInWaste: false,
    });
    // siding facade = 1000 - 100 = 900 (90 % of the house)
    // the 30 sqft window is 90 % attributable to siding = 27
    ok('siding facade = 1000 - 100 = 900', g.totals.siding_facade_area_sqft === 900, g.totals.siding_facade_area_sqft, 900);
    ok('openings pro-rated to siding share (30 x 0.9 = 27)', g.totals.opening_deduction_sqft === 27, g.totals.opening_deduction_sqft, 27);
    ok('total opening area still reported in full', g.totals.opening_area_total_sqft === 30, g.totals.opening_area_total_sqft, 30);
    ok('net = 900 - 27 = 873', g.totals.net_siding_area_sqft === 873, g.totals.net_siding_area_sqft, 873);
    ok('reconciliation.consistent is true', g.reconciliation.consistent === true);
    ok('reconciliation has no issues', g.reconciliation.issues.length === 0, g.reconciliation.issues.length, 0);
    ok('reconciliation exposes the assertion',
      g.reconciliation.assertion === 'net = (gross - masonry) - siding-allocated openings');
  }

  // ───────────────────────────────────────────────────────────────────────
  // 8b. Masonry-heavy house: openings must NOT be charged to the siding column.
  //     Regression for a 70 %-brick colonial that reported 653 sqft of siding
  //     against a Hover-verified 1,047 sqft, because every window and garage
  //     door on the house was deducted from the 30 % that was actually siding.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Masonry-heavy opening allocation \u2500\u2500');
  {
    const brickColonial = {
      // 4,404 sqft wall prism, 70 % brick → 1,321 sqft of siding facade.
      grossWallAreaSqft: 4404,
      accentDeductionSqft: 3083,
      perimeterFt: 249,
      smallOpeningsInWaste: false,
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        // 915 sqft of openings across the whole house.
        openings: [
          { type: 'garage_door', width_ft: 16, height_ft: 8,  pos_x: 10, pos_y: 0 },  // 128
          { type: 'garage_door', width_ft: 16, height_ft: 8,  pos_x: 40, pos_y: 0 },  // 128
          { type: 'door',        width_ft: 6,  height_ft: 8,  pos_x: 60, pos_y: 0 },  // 48
          { type: 'window',      width_ft: 21, height_ft: 10, pos_x: 80, pos_y: 4 },  // 210
          { type: 'window',      width_ft: 20, height_ft: 10, pos_x: 110, pos_y: 4 }, // 200
          { type: 'window',      width_ft: 20, height_ft: 10, pos_x: 140, pos_y: 4 }, // 200
        ],
      }],
    };
    const g = buildSidingMeasurementGraph(brickColonial);
    ok('siding facade is the 30 % that is not brick',
      g.totals.siding_facade_area_sqft === 1321, g.totals.siding_facade_area_sqft, 1321);
    ok('majority of openings charged to the masonry column',
      g.totals.opening_deduction_masonry_sqft > g.totals.opening_deduction_sqft,
      `masonry=${g.totals.opening_deduction_masonry_sqft} siding=${g.totals.opening_deduction_sqft}`);
    // The 20×10 windows clamp to a 3×5. What is left is two 16×8 garage doors
    // and a standard entry. Old behaviour deducted 25 % of the 4,404 gross
    // from the siding column and produced ~650 sqft.
    ok('implausible windows clamp to the 3×5 class',
      g.opening_groups.filter((group) => group.type === 'window').every((group) => group.area_sqft === 15),
      g.opening_groups.filter((group) => group.type === 'window').map((group) => group.area_sqft));
    ok('net siding is far above the old 653 sqft result',
      g.totals.net_siding_area_sqft > 900, g.totals.net_siding_area_sqft, '> 900');
  }

  // ───────────────────────────────────────────────────────────────────────
  // 8c. Per-face masonry map overrides the house-wide average.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Per-face masonry allocation \u2500\u2500');
  {
    const base = {
      grossWallAreaSqft: 2000, accentDeductionSqft: 1000, perimeterFt: 160,
      smallOpeningsInWaste: false,
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        openings: [{ type: 'window', width_ft: 6, height_ft: 5, pos_x: 5, pos_y: 3 }], // 30 sqft
      }],
    };
    const globalAvg = buildSidingMeasurementGraph(base);
    // House-wide siding share is 50 %, so 15 sqft of the window hits siding.
    ok('without a face map the house average is used',
      globalAvg.totals.opening_deduction_sqft === 15, globalAvg.totals.opening_deduction_sqft, 15);

    // The front elevation is all brick — its window must not touch siding.
    const perFace = buildSidingMeasurementGraph({ ...base, faceMasonryPct: { front: 100 } });
    ok('an all-brick face charges none of its openings to siding',
      perFace.totals.opening_deduction_sqft === 0, perFace.totals.opening_deduction_sqft, 0);
    ok('all-brick face openings land in the masonry column',
      perFace.totals.opening_deduction_masonry_sqft === 30,
      perFace.totals.opening_deduction_masonry_sqft, 30);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 9. Garage openings interrupt starter strip at grade.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n── Garage starter-strip exclusion ──');
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        openings: [
          { type: 'garage_door', width_ft: 16, height_ft: 7, pos_x: 8, pos_y: 0 },
          { type: 'window', width_ft: 4, height_ft: 4, pos_x: 28, pos_y: 3 },
        ],
      }],
      grossWallAreaSqft: 1000, perimeterFt: 120, smallOpeningsInWaste: true,
    });
    ok('starter strip excludes grade-level garage width (120 - 16)',
       g.totals.starter_strip_lf === 104, g.totals.starter_strip_lf, 104);
    ok('starter strip records excluded garage width',
       g.trim_edges.starter_strip.excluded_garage_width_lf === 16,
       g.trim_edges.starter_strip.excluded_garage_width_lf, 16);
    ok('window width does not reduce starter strip',
       g.trim_edges.starter_strip.excluded_garage_opening_count === 1,
       g.trim_edges.starter_strip.excluded_garage_opening_count, 1);
  }

  console.log('\n── Grade-level entry doors interrupt starter ──');
  {
    const g = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        openings: [
          { type: 'entry_door', width_ft: 3, height_ft: 6.67, pos_x: 10, pos_y: 3.4 },
          { type: 'entry_door', width_ft: 3, height_ft: 6.67, pos_x: 20, pos_y: 12, at_grade: false },
        ],
      }],
      grossWallAreaSqft: 1000, perimeterFt: 100, smallOpeningsInWaste: true,
    });
    ok('a door with its sill at grade comes off the starter',
       g.totals.starter_strip_lf === 97, g.totals.starter_strip_lf, 97);
    ok('an elevated door stays on the starter',
       g.trim_edges.starter_strip.excluded_grade_opening_count === 1,
       g.trim_edges.starter_strip.excluded_grade_opening_count, 1);
  }

  // ───────────────────────────────────────────────────────────────────────
  // 10. Determinism + versioning.
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n\u2500\u2500 Determinism + versioning \u2500\u2500');
  {
    const mk = () => buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front', confidence: 0.9,
        openings: [{ type: 'window', width_ft: 4, height_ft: 4, pos_x: 5, pos_y: 3 }],
      }],
      grossWallAreaSqft: 1000, perimeterFt: 100, smallOpeningsInWaste: true,
    });
    const a = JSON.stringify(mk());
    const b = JSON.stringify(mk());
    ok('identical input → byte-identical output', a === b);
    ok('graph is versioned', typeof mk().version === 'string' && mk().version.length > 0);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'\u2500'.repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\n\u274c Assertion failures \u2014 siding measurement graph has regressed.');
    process.exit(1);
  } else {
    console.log('\n\u2705 All siding measurement graph assertions passed.');
  }
})().catch((err) => {
  console.error('\n\u274c Test harness error:', err && err.stack ? err.stack : err);
  process.exit(1);
});
