#!/usr/bin/env node
/**
 * Unit tests for computeDerivedExteriorQuantities (no server needed).
 *
 * Covers the edge-completeness matrix that a code review flagged:
 * a partial edge set (eave-only or rake-only on a gable roof) must NOT be
 * reported as "measured" — it underreports the drip edge.
 */
const assert = require('node:assert');

async function main() {
  const { computeDerivedExteriorQuantities, DEFAULT_OVERHANG_FT, resolveSidingRoofEdges } =
    await import('../src/utils/sidingDerivedQuantities.js');

  let pass = 0, fail = 0;
  const ok = (cond, label, detail = '') => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label} ${detail}`); }
  };

  // 1. Complete gable (eave + rake measured) → measured, exact sum
  const g = computeDerivedExteriorQuantities({
    eaveLf: 184, rakeLf: 78, perimeterLf: 255, wallHeightFt: 17, openings: [],
  });
  ok(g.edgeSource === 'measured', 'complete gable → measured');
  ok(g.roofPerimeterLf === 262, 'complete gable roof perimeter = eave+rake', `got ${g.roofPerimeterLf}`);
  ok(g.fasciaLf === 262, 'fascia = full drip edge');
  ok(g.soffitSqft === Math.round((184 + 78) * DEFAULT_OVERHANG_FT), 'soffit includes level and sloped components', `got ${g.soffitSqft}`);
  ok(g.soffitBreakdown.level_sqft === Math.round(184 * DEFAULT_OVERHANG_FT), 'level soffit uses eave LF');
  ok(g.soffitBreakdown.sloped_sqft === Math.round(78 * DEFAULT_OVERHANG_FT), 'sloped soffit uses rake LF');

  // 2. Hip, eave-only → complete (hip roofs have no rakes), soffit = eave × oh
  const h = computeDerivedExteriorQuantities({
    eaveLf: 240, perimeterLf: 240, wallHeightFt: 9, hipRoof: true, openings: [],
  });
  ok(h.edgeSource === 'measured', 'hip eave-only → measured (hips have no rakes)');
  ok(h.roofPerimeterLf === 240, 'hip roof perimeter = eaves', `got ${h.roofPerimeterLf}`);

  // 3. Gable, eave-only → partial: rake filled from eave, labeled estimated
  const eo = computeDerivedExteriorQuantities({
    eaveLf: 160, perimeterLf: 240, wallHeightFt: 9, openings: [],
  });
  ok(eo.edgeSource === 'estimated', 'eave-only gable → estimated (not measured)');
  ok(eo.roofPerimeterLf > 160, 'eave-only gable fills missing rakes', `got ${eo.roofPerimeterLf}`);
  ok(eo.roofPerimeterLf === 160 + Math.round(160 * 0.45), 'rake estimate = 0.45 × eave', `got ${eo.roofPerimeterLf}`);

  // 4. Gable, rake-only → partial: eave filled from rake, labeled estimated
  const ro = computeDerivedExteriorQuantities({
    rakeLf: 80, perimeterLf: 240, wallHeightFt: 9, openings: [],
  });
  ok(ro.edgeSource === 'estimated', 'rake-only gable → estimated (not measured)');
  ok(ro.roofPerimeterLf > 80, 'rake-only gable fills missing eaves', `got ${ro.roofPerimeterLf}`);

  // 5. No edges at all → perimeter × 1.15 fallback, estimated
  const no = computeDerivedExteriorQuantities({ perimeterLf: 240, wallHeightFt: 9, openings: [] });
  ok(no.edgeSource === 'estimated', 'no edges → estimated');
  ok(no.roofPerimeterLf === Math.round(240 * 1.15), 'no edges → perimeter × 1.15', `got ${no.roofPerimeterLf}`);

  // 6. Overhang is respected + defaulted
  const oh2 = computeDerivedExteriorQuantities({ eaveLf: 100, rakeLf: 50, overhangFt: 2, openings: [] });
  ok(oh2.soffitSqft === 300, 'custom overhang applies to both components by default', `got ${oh2.soffitSqft}`);
  const split = computeDerivedExteriorQuantities({
    eaveLf: 171, rakeLf: 123, levelSoffitDepthFt: 2, slopedSoffitDepthFt: 1.5,
  });
  ok(split.fasciaLf === 294, 'Hover benchmark fascia = 294 LF', `got ${split.fasciaLf}`);
  ok(Math.abs(split.soffitSqft - 538) / 538 < 0.03, 'Hover benchmark soffit is within 3% of 538 sqft', `got ${split.soffitSqft}`);
  const ohDef = computeDerivedExteriorQuantities({ eaveLf: 100, rakeLf: 50, overhangFt: 0, openings: [] });
  ok(ohDef.overhangFt === DEFAULT_OVERHANG_FT, 'overhang defaults when 0/undefined');

  // 7. Trim breakdown sums to total
  const t = computeDerivedExteriorQuantities({
    eaveLf: 100, rakeLf: 50, wallHeightFt: 17, outsideCornersCount: 4,
    openings: [{ type: 'window', width_ft: 3, height_ft: 4 }],
  });
  const parts = t.trimBreakdown.fascia_board_sqft + t.trimBreakdown.corner_boards_sqft + t.trimBreakdown.opening_casing_sqft;
  ok(Math.abs(parts - t.trimSqft) <= 2, 'trim breakdown sums to total', `${parts} vs ${t.trimSqft}`);

  // 8. Classified 3D siding edges must override conflicting heuristic satellite
  // linears in every consumer. This is the normal roof-assisted flow.
  const canonical = resolveSidingRoofEdges(
    { roof_edge_source: 'roof_facets', eave_lf: 171, rake_lf: 123 },
    { eave_lf: 220, rake_lf: 40 },
  );
  ok(canonical.source === 'roof_facets', 'classified siding roof edges are canonical');
  ok(canonical.eaveLf === 171 && canonical.rakeLf === 123,
    'facet edges override conflicting satellite heuristics',
    `got eave=${canonical.eaveLf}, rake=${canonical.rakeLf}`);
  const canonicalDerived = computeDerivedExteriorQuantities({
    eaveLf: canonical.eaveLf,
    rakeLf: canonical.rakeLf,
    levelSoffitDepthFt: 2,
    slopedSoffitDepthFt: 1.5,
  });
  ok(canonicalDerived.fasciaLf === 294,
    'resolved card/report fascia uses the 294 LF facet total',
    `got ${canonicalDerived.fasciaLf}`);
  ok(canonicalDerived.soffitSqft === 527,
    'resolved card/report soffit uses split facet-edge depths',
    `got ${canonicalDerived.soffitSqft}`);
  const explicitFallback = resolveSidingRoofEdges(
    { roof_edge_source: 'footprint_fallback', eave_lf: 118, rake_lf: 0 },
    { eave_lf: 4200, rake_lf: 3182 },
  );
  ok(explicitFallback.source === 'siding_estimate' && explicitFallback.eaveLf === 118 && explicitFallback.rakeLf === 0,
    'a photo footprint fallback is not replaced by a previous aerial roof');
  const explicitDerived = computeDerivedExteriorQuantities({
    eaveLf: explicitFallback.eaveLf,
    rakeLf: explicitFallback.rakeLf,
    perimeterLf: 84,
    edgesMeasured: false,
  });
  ok(explicitDerived.edgeSource === 'estimated' && explicitDerived.fasciaLf < 500,
    'unmeasured photo edges stay estimated and do not inherit the aerial drip edge',
    `fascia ${explicitDerived.fasciaLf} source ${explicitDerived.edgeSource}`);
  const legacy = resolveSidingRoofEdges(
    { eave_lf: 118, rake_lf: 0 },
    { eave_lf: 184, rake_lf: 78 },
  );
  ok(legacy.source === 'satellite_analysis' && legacy.eaveLf === 184 && legacy.rakeLf === 78,
    'satellite edges remain the legacy fallback when the siding record has no edge source');
  const legacyDerived = computeDerivedExteriorQuantities({
    eaveLf: legacy.eaveLf,
    rakeLf: legacy.rakeLf,
    edgesMeasured: false,
  });
  ok(legacyDerived.edgeSource === 'estimated' && legacyDerived.fasciaLf === 262,
    'legacy satellite edges are labeled estimated',
    `fascia ${legacyDerived.fasciaLf}`);

  const fs = require('node:fs');
  const path = require('node:path');
  const cardSource = fs.readFileSync(path.join(__dirname, '../src/pages/AIEstimator.jsx'), 'utf8');
  const reportSource = fs.readFileSync(path.join(__dirname, '../src/utils/generateSidingReportHTML.js'), 'utf8');
  ok(/resolveSidingRoofEdges\(d, satelliteAnalysis\)/.test(cardSource),
    'summary card uses the canonical roof-edge resolver');
  ok(/resolveSidingRoofEdges\(sd, sa\)/.test(reportSource),
    'printable report uses the canonical roof-edge resolver');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
