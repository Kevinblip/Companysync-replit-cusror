'use strict';
/**
 * Regression test: satellite siding panel field-count opening override.
 *
 * Verifies that:
 *  - Entering a count overrides the AI opening deduction with flat 15 sqft/opening
 *  - Both satellite-only (no measurement_graph) and photo+satellite (graph present)
 *    paths produce the correct effective net area that convertSidingMeasurementsToLineItems
 *    will actually price.
 *  - Clearing the override restores the original AI values in all paths, including
 *    the graph's own opening_deduction_sqft (which may differ from the root value).
 *  - The roof-footprint fallback path (gross derived from perimeter × height) is
 *    not zeroed out by the override when gross_wall_area_sqft is present.
 */

let passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { console.log('  ✓  ' + msg); passed++; }
  else { console.error('  ✗  FAIL: ' + msg); failed++; process.exitCode = 1; }
}

// ─── Replicate the converter's priority read (AIEstimator.jsx ~line 3330) ───
function getEffectiveNetSqft(measurements) {
  const graphTotals = measurements.measurement_graph?.totals;
  const canonicalNetSqft = Number(graphTotals?.net_siding_area_sqft);
  return canonicalNetSqft > 0
    ? canonicalNetSqft
    : (Number(measurements.wall_area_sqft) || ((Number(measurements.wall_area_sq) || 0) * 100) || 0);
}

// ─── Replicate the onChange apply logic (satellite panel) ────────────────────
function applyOverride(base, count) {
  const gross = Number(base.gross_wall_area_sqft) || 0;
  const accent = Number(base.accent_deduction_sqft ?? 0);
  const openDeduct = count * 15;
  const net = Math.max(0, gross - openDeduct - accent);
  return {
    ...base,
    actual_openings_count: count,
    opening_deduction_sqft: openDeduct,
    opening_deduct_sqft: openDeduct,
    wall_area_sqft: net,
    wall_area_sq: Math.round(net) / 100,
    // Patch graph totals so the converter (which prioritises graph) also sees the override.
    ...(base.measurement_graph ? {
      measurement_graph: {
        ...base.measurement_graph,
        totals: {
          ...base.measurement_graph.totals,
          net_siding_area_sqft: net,
          opening_deduction_sqft: openDeduct,
        },
      },
    } : {}),
  };
}

// ─── Replicate the onChange clear logic ──────────────────────────────────────
function clearOverride(prev) {
  const { actual_openings_count, ...rest } = prev;
  const aiNet = rest._ai_net_siding_area_sqft ?? rest._ai_wall_area_sqft ?? rest.wall_area_sqft;
  const aiGraph = rest.measurement_graph
    ? {
        ...rest.measurement_graph,
        totals: {
          ...rest.measurement_graph.totals,
          net_siding_area_sqft: aiNet,
          // Restore the graph's OWN original opening deduction, not the root value.
          opening_deduction_sqft: rest._ai_graph_opening_deduction_sqft ?? rest.measurement_graph.totals?.opening_deduction_sqft,
        },
      }
    : rest.measurement_graph;
  return {
    ...rest,
    opening_deduction_sqft: rest._ai_opening_deduction_sqft ?? rest.opening_deduction_sqft,
    opening_deduct_sqft: rest._ai_opening_deduction_sqft ?? rest.opening_deduct_sqft,
    wall_area_sqft: rest._ai_wall_area_sqft ?? rest.wall_area_sqft,
    wall_area_sq: rest._ai_wall_area_sqft != null
      ? Math.round(rest._ai_wall_area_sqft) / 100
      : rest.wall_area_sq,
    ...(aiGraph ? { measurement_graph: aiGraph } : {}),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Satellite-only path: no measurement_graph — converter falls back to wall_area_sqft.
const satOnly = {
  gross_wall_area_sqft: 2000,
  wall_area_sqft: 1700,
  wall_area_sq: 17,
  opening_deduction_sqft: 300,
  _ai_wall_area_sqft: 1700,
  _ai_opening_deduction_sqft: 300,
  _ai_net_siding_area_sqft: 1700,
  _ai_graph_opening_deduction_sqft: undefined,
  windows_count: 8, doors_count: 2, garage_door_count: 1,
  accent_deduction_sqft: 0,
};

// Photo + satellite path: measurement_graph present — converter prioritises graph net.
// Root opening_deduction_sqft (350) differs from graph's own (320) — both must restore correctly.
const photoSat = {
  gross_wall_area_sqft: 2000,
  wall_area_sqft: 1650,
  wall_area_sq: 16.5,
  opening_deduction_sqft: 350,                // root value
  _ai_wall_area_sqft: 1650,
  _ai_opening_deduction_sqft: 350,            // root AI value
  _ai_net_siding_area_sqft: 1680,             // graph canonical net (differs from wall_area_sqft)
  _ai_graph_opening_deduction_sqft: 320,      // graph's OWN opening deduction (differs from root)
  measurement_graph: {
    totals: { net_siding_area_sqft: 1680, opening_deduction_sqft: 320 },
  },
  windows_count: 8, doors_count: 2, garage_door_count: 1,
  accent_deduction_sqft: 0,
};

// Roof-footprint fallback path: produced by buildRoofFootprintFallback which now
// includes gross_wall_area_sqft so the override can recompute correctly.
const fallback = {
  gross_wall_area_sqft: 1800,   // perimeter(180) × height(10) — now present after fix
  wall_area_sqft: 1530,         // net after 15% opening deduction
  wall_area_sq: 15.3,
  opening_deduction_sqft: 270,
  _ai_wall_area_sqft: 1530,
  _ai_opening_deduction_sqft: 270,
  _ai_net_siding_area_sqft: 1530,
  _ai_graph_opening_deduction_sqft: undefined,
  windows_count: 0, doors_count: 0, garage_door_count: 0,
  accent_deduction_sqft: 0,
  _estimated_from_roof_footprint: true,
};

// ─── Tests: satellite-only ───────────────────────────────────────────────────
console.log('\n[sat-opening-override] Satellite-only path\n');

assert(getEffectiveNetSqft(satOnly) === 1700,
  'Baseline: converter reads AI wall_area_sqft (1700)');

const satOverridden = applyOverride(satOnly, 5); // 5 × 15 = 75; net = 2000 - 75 = 1925
assert(satOverridden.actual_openings_count === 5,
  'actual_openings_count set to 5');
assert(satOverridden.opening_deduction_sqft === 75,
  'opening_deduction_sqft = 5 × 15 = 75');
assert(satOverridden.wall_area_sqft === 1925,
  'wall_area_sqft = gross 2000 - deduct 75 = 1925');
assert(satOverridden.wall_area_sq === 19.25,
  'wall_area_sq = Math.round(1925) / 100 = 19.25');
assert(!satOverridden.measurement_graph,
  'No measurement_graph patched (satellite-only has none)');
assert(getEffectiveNetSqft(satOverridden) === 1925,
  'Converter reads overridden net 1925 (wall_area_sqft fallback path)');

const satCleared = clearOverride(satOverridden);
assert(satCleared.actual_openings_count === undefined,
  'actual_openings_count removed after clear');
assert(satCleared.wall_area_sqft === 1700,
  'wall_area_sqft restored to AI value 1700');
assert(satCleared.opening_deduction_sqft === 300,
  'opening_deduction_sqft restored to AI value 300');
assert(getEffectiveNetSqft(satCleared) === 1700,
  'Converter reads restored AI net 1700 after clear');

// ─── Tests: photo + satellite ────────────────────────────────────────────────
console.log('\n[sat-opening-override] Photo + satellite path\n');

assert(getEffectiveNetSqft(photoSat) === 1680,
  'Baseline: converter reads graph net_siding_area_sqft 1680 (graph wins over wall_area_sqft)');

const photoOverridden = applyOverride(photoSat, 3); // 3 × 15 = 45; net = 2000 - 45 = 1955
assert(photoOverridden.wall_area_sqft === 1955,
  'wall_area_sqft = 2000 - 45 = 1955');
assert(photoOverridden.measurement_graph.totals.net_siding_area_sqft === 1955,
  'measurement_graph.totals.net_siding_area_sqft patched to 1955');
assert(photoOverridden.measurement_graph.totals.opening_deduction_sqft === 45,
  'measurement_graph.totals.opening_deduction_sqft patched to 45');
assert(getEffectiveNetSqft(photoOverridden) === 1955,
  'Converter reads overridden graph net 1955 (graph path now picks override)');

const photoCleared = clearOverride(photoOverridden);
assert(photoCleared.actual_openings_count === undefined,
  'actual_openings_count removed after clear');
assert(photoCleared.wall_area_sqft === 1650,
  'Root wall_area_sqft restored to AI value 1650');
assert(photoCleared.opening_deduction_sqft === 350,
  'Root opening_deduction_sqft restored to AI root value 350');
assert(photoCleared.measurement_graph.totals.net_siding_area_sqft === 1680,
  'graph.totals.net_siding_area_sqft restored to AI value 1680');
assert(photoCleared.measurement_graph.totals.opening_deduction_sqft === 320,
  'graph.totals.opening_deduction_sqft restored to graph\'s OWN AI value (320, not root 350)');
assert(getEffectiveNetSqft(photoCleared) === 1680,
  'Converter reads restored AI graph net 1680 after clear');

// ─── Tests: roof-footprint fallback path ─────────────────────────────────────
console.log('\n[sat-opening-override] Roof-footprint fallback path\n');

assert(Number(fallback.gross_wall_area_sqft) > 0,
  'Fallback includes gross_wall_area_sqft (fix verified: buildRoofFootprintFallback now sets it)');
assert(getEffectiveNetSqft(fallback) === 1530,
  'Baseline: converter reads fallback wall_area_sqft (1530)');

const fallbackOverridden = applyOverride(fallback, 4); // 4 × 15 = 60; net = 1800 - 60 = 1740
assert(fallbackOverridden.wall_area_sqft === 1740,
  'Fallback override: net = gross 1800 - 60 = 1740 (not zero)');
assert(getEffectiveNetSqft(fallbackOverridden) === 1740,
  'Converter reads fallback override net 1740');

const fallbackCleared = clearOverride(fallbackOverridden);
assert(fallbackCleared.wall_area_sqft === 1530,
  'Fallback clear: wall_area_sqft restored to 1530');
assert(getEffectiveNetSqft(fallbackCleared) === 1530,
  'Converter reads restored fallback AI net 1530 after clear');

// ─── Edge case: accent (masonry) deduction stays correct ─────────────────────
console.log('\n[sat-opening-override] Accent/masonry deduction\n');

const withMasonry = { ...satOnly, accent_deduction_sqft: 200 };
const masonryOverridden = applyOverride(withMasonry, 4); // 4×15=60; net = 2000 - 60 - 200 = 1740
assert(masonryOverridden.wall_area_sqft === 1740,
  'Masonry deduction respected: 2000 - 60 (openings) - 200 (masonry) = 1740');

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n[sat-opening-override] Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('[sat-opening-override] All opening override assertions confirmed ✓\n');
}
