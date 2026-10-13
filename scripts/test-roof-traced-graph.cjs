#!/usr/bin/env node
/**
 * Verifies the traced roof facet graph against roofs whose true measurements
 * can be computed by hand. These are the numbers a tape measure would give.
 *
 * The point of these cases is that ridge/eave lengths are LEVEL (plan length ==
 * true length) while rake/hip/valley lengths CLIMB the slope, so their true
 * length must always exceed their plan length. Reporting plan length for a rake
 * is the single most common way a takeoff under-orders material.
 */

let failures = 0;
let checks = 0;

function check(label, actual, expected, tolerance) {
  checks += 1;
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${Number(actual).toFixed(2)}, expected ${Number(expected).toFixed(2)} (±${tolerance})`);
}

function checkEq(label, actual, expected) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const PITCH_4_12 = Math.atan(4 / 12) * 180 / Math.PI; // 18.435 deg
const SLOPE_4_12 = 1 / Math.cos(PITCH_4_12 * Math.PI / 180); // 1.05409

(async () => {
  const { buildTracedRoofGraph } = await import('../functions/utils/roofTracedFacetGraph.js');

  // ── Case 1: simple gable, 40 ft (E-W) x 30 ft (N-S), ridge running E-W ────
  console.log('\n--- Simple gable 40x30 @ 4/12 ---');
  const gable = buildTracedRoofGraph({
    facets: [
      { id: 'south', azimuth_degrees: 180, pitch_degrees: PITCH_4_12,
        polygon: [{ x: -20, y: -15 }, { x: 20, y: -15 }, { x: 20, y: 0 }, { x: -20, y: 0 }] },
      { id: 'north', azimuth_degrees: 0, pitch_degrees: PITCH_4_12,
        polygon: [{ x: -20, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 15 }, { x: -20, y: 15 }] },
    ],
  });
  checkEq('gable facet count', gable.totals.facet_count, 2);
  check('gable ridge LF (level, = plan)', gable.edge_totals.ridge, 40, 0.1);
  check('gable eave LF (2 x 40)', gable.edge_totals.eave, 80, 0.1);
  // Each rake spans 15 ft in plan but climbs 5 ft => 15.81 ft of real material.
  check('gable rake LF (4 x 15.81, slope-corrected)', gable.edge_totals.rake, 4 * Math.hypot(15, 5), 0.2);
  check('gable hip LF', gable.edge_totals.hip, 0, 0.01);
  check('gable valley LF', gable.edge_totals.valley, 0, 0.01);
  check('gable plan area', gable.totals.plan_area_sqft, 1200, 1);
  check('gable roof area (slope)', gable.totals.roof_area_sqft, 1200 * SLOPE_4_12, 2);

  // ── Case 2: hip roof, same 40x30 footprint, 10 ft ridge ──────────────────
  console.log('\n--- Hip 40x30 @ 4/12 ---');
  const hip = buildTracedRoofGraph({
    facets: [
      { id: 'south', azimuth_degrees: 180, pitch_degrees: PITCH_4_12,
        polygon: [{ x: -20, y: -15 }, { x: 20, y: -15 }, { x: 5, y: 0 }, { x: -5, y: 0 }] },
      { id: 'north', azimuth_degrees: 0, pitch_degrees: PITCH_4_12,
        polygon: [{ x: -20, y: 15 }, { x: -5, y: 0 }, { x: 5, y: 0 }, { x: 20, y: 15 }] },
      { id: 'east', azimuth_degrees: 90, pitch_degrees: PITCH_4_12,
        polygon: [{ x: 20, y: -15 }, { x: 20, y: 15 }, { x: 5, y: 0 }] },
      { id: 'west', azimuth_degrees: 270, pitch_degrees: PITCH_4_12,
        polygon: [{ x: -20, y: -15 }, { x: -5, y: 0 }, { x: -20, y: 15 }] },
    ],
  });
  checkEq('hip facet count', hip.totals.facet_count, 4);
  check('hip ridge LF', hip.edge_totals.ridge, 10, 0.1);
  check('hip eave LF (full perimeter)', hip.edge_totals.eave, 140, 0.2);
  // Each hip runs 21.21 ft in plan, climbs 5 ft => 21.79 ft.
  check('hip LF (4 x 21.79, slope-corrected)', hip.edge_totals.hip, 4 * Math.hypot(Math.hypot(15, 15), 5), 0.3);
  check('hip rake LF (a hip roof has none)', hip.edge_totals.rake, 0, 0.01);
  check('hip valley LF', hip.edge_totals.valley, 0, 0.01);
  check('hip roof area (slope)', hip.totals.roof_area_sqft, 1200 * SLOPE_4_12, 2);

  // ── Case 3: inside corner => valley (both facets LOW at the shared edge) ──
  console.log('\n--- Inside corner (valley) @ 4/12 ---');
  const valley = buildTracedRoofGraph({
    facets: [
      { id: 'a', azimuth_degrees: 90, pitch_degrees: PITCH_4_12,
        polygon: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
      { id: 'b', azimuth_degrees: 0, pitch_degrees: PITCH_4_12,
        polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
    ],
  });
  check('valley LF (14.14 plan -> 14.53 true)', valley.edge_totals.valley, Math.hypot(Math.hypot(10, 10), 10 / 3), 0.2);
  check('valley case has no hip', valley.edge_totals.hip, 0, 0.01);
  // This fixture is deliberately a ROOF FRAGMENT: each facet's high edge backs
  // onto a plane that was never traced. Those edges are real ridges, and the
  // graph must also report them as open boundaries so an incomplete trace can
  // never be mistaken for a finished takeoff.
  check('fragment high edges reported as ridge', valley.edge_totals.ridge, 20, 0.1);
  checkEq('fragment flags both untraced neighbours', valley.totals.open_boundary_count, 2);

  // ── Case 4: welding — a traced shared edge is never pixel-perfect ────────
  console.log('\n--- Weld tolerance (traced corners disagree by ~1 ft) ---');
  const sloppy = buildTracedRoofGraph({
    facets: [
      { id: 'south', azimuth_degrees: 180, pitch_degrees: PITCH_4_12,
        polygon: [{ x: -20, y: -15 }, { x: 20, y: -15 }, { x: 20.4, y: 0.3 }, { x: -19.6, y: -0.4 }] },
      { id: 'north', azimuth_degrees: 0, pitch_degrees: PITCH_4_12,
        polygon: [{ x: -20.3, y: 0.4 }, { x: 19.7, y: -0.3 }, { x: 20, y: 15 }, { x: -20, y: 15 }] },
    ],
  });
  check('welded ridge is ONE shared edge (~40 LF)', sloppy.edge_totals.ridge, 40, 1.5);
  checkEq('welded gable reports no open boundary', sloppy.totals.open_boundary_count, 0);

  // ── Case 5: untraced neighbour is reported, not silently priced ──────────
  console.log('\n--- Incomplete trace (one slope missing) ---');
  const halfRoof = buildTracedRoofGraph({
    facets: [
      { id: 'south', azimuth_degrees: 180, pitch_degrees: PITCH_4_12,
        polygon: [{ x: -20, y: -15 }, { x: 20, y: -15 }, { x: 20, y: 0 }, { x: -20, y: 0 }] },
    ],
  });
  checkEq('missing neighbour flagged as open boundary', halfRoof.totals.open_boundary_count, 1);
  const flagged = halfRoof.warnings.some((w) => w.startsWith('open_high_boundaries'));
  checkEq('open boundary raises a warning', flagged, true);

  // ── Case 6: flat roof must not invent rakes ──────────────────────────────
  console.log('\n--- Flat roof ---');
  const flat = buildTracedRoofGraph({
    facets: [
      { id: 'flat', azimuth_degrees: 180, pitch_degrees: 0,
        polygon: [{ x: -20, y: -15 }, { x: 20, y: -15 }, { x: 20, y: 15 }, { x: -20, y: 15 }] },
    ],
  });
  check('flat roof eave = perimeter', flat.edge_totals.eave, 140, 0.2);
  check('flat roof has no rake', flat.edge_totals.rake, 0, 0.01);
  check('flat roof area == plan area', flat.totals.roof_area_sqft, 1200, 1);

  console.log(`\n${failures === 0 ? 'ALL PASSED' : 'FAILURES PRESENT'}: ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
