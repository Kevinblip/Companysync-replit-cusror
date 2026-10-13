#!/usr/bin/env node
/**
 * Footprint polygon reconstruction — focused geometry regression test
 * ───────────────────────────────────────────────────────────────────
 * Exercises functions/utils/footprintPolygon.js with hand-built roof facets
 * (no AI, no server, no network).
 *
 * The contracts that matter:
 *   1. A simple rectangular roof plan comes back as a rectangle, inset by the
 *      eave overhang — no magic shrink factor.
 *   2. An L-shaped house keeps its wing: its perimeter must clearly exceed the
 *      equal-area rectangle that the old sqrt(area x aspect) math produced.
 *      This is the regression that motivated the whole change.
 *   3. A house rotated off true north does NOT inflate via raster staircasing.
 *   4. Hairline seams between abutting facets do not split the building or
 *      punch interior holes.
 *   5. A detached outbuilding is not welded onto the main house perimeter.
 *   6. Garbage in -> null out (so callers fall back deliberately, never to a
 *      silently wrong polygon).
 *
 * Usage:  node scripts/test-footprint-polygon.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(label, cond, got, expected) {
  if (cond) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.log(`  \u2717 ${label}`);
    if (got !== undefined) console.log(`      got:      ${got}`);
    if (expected !== undefined) console.log(`      expected: ${expected}`);
    failed++;
  }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** Axis-aligned rectangular facet in the shape roofFacetGeometry.js emits. */
function rectFacet(x0, y0, x1, y1, azimuth = 180, rotDeg = 0) {
  const rad = rotDeg * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return {
    azimuth_degrees: (azimuth + rotDeg) % 360,
    area_sqft: Math.abs((x1 - x0) * (y1 - y0)),
    polygon: pts.map(([x, y]) => ({ x: x * c - y * s, y: x * s + y * c, h: 0 })),
  };
}

(async () => {
  const {
    buildFootprintFromFacets,
    polygonPerimeterFt,
    polygonAreaFt2,
    polygonBBoxDims,
    rectanglePolygon,
    scalePolygonToPerimeter,
    DEFAULT_EAVE_OVERHANG_FT,
  } = await import('../functions/utils/footprintPolygon.js');

  const OVERHANG = 1.5;

  console.log('\n\u2500\u2500 1. Pure polygon measures \u2500\u2500');
  {
    const r = rectanglePolygon(60, 40);
    ok('rectanglePolygon(60,40) has 4 vertices', r.length === 4, r.length, 4);
    ok('its perimeter is 200 LF', near(polygonPerimeterFt(r), 200, 0.01), polygonPerimeterFt(r), 200);
    ok('its area is 2400 sqft', near(polygonAreaFt2(r), 2400, 0.01), polygonAreaFt2(r), 2400);
    const d = polygonBBoxDims(r);
    ok('bbox reports 60 long x 40 wide', d.lengthFt === 60 && d.widthFt === 40, `${d.lengthFt}x${d.widthFt}`);
    ok('rectanglePolygon rejects non-positive dims', rectanglePolygon(0, 40) === null);
    // An L-shape and a rectangle of identical area do NOT have identical
    // perimeter — the entire premise of this change.
    const L = [[-30, -20], [50, -20], [50, 10], [30, 10], [30, 20], [-30, 20]];
    ok('L-shape area is 3000 sqft', near(polygonAreaFt2(L), 3000, 0.01), polygonAreaFt2(L), 3000);
    ok('L-shape perimeter is 240 LF', near(polygonPerimeterFt(L), 240, 0.01), polygonPerimeterFt(L), 240);
    const equalAreaRect = rectanglePolygon(60, 50); // same 3000 sqft
    ok('equal-area rectangle understates perimeter by 20 LF',
       near(polygonPerimeterFt(equalAreaRect), 220, 0.01) &&
       polygonPerimeterFt(L) - polygonPerimeterFt(equalAreaRect) === 20);
  }

  console.log('\n\u2500\u2500 2. Simple rectangular roof plan \u2500\u2500');
  {
    // 60 x 40 roof plan as two gable facets, with a deliberate 0.5 ft seam.
    const facets = [
      rectFacet(-30, -20, 30, -0.25, 180),
      rectFacet(-30, 0.25, 30, 20, 0),
    ];
    const fp = buildFootprintFromFacets(facets, { overhangFt: OVERHANG });
    ok('returns a footprint', !!fp);
    ok('wall footprint is inset by the overhang (57 x 37)',
       near(fp.length_ft, 57, 1.5) && near(fp.width_ft, 37, 1.5), `${fp.length_ft}x${fp.width_ft}`, '57x37');
    ok('perimeter is 188 LF, not the 200 LF roof plan',
       near(fp.perimeter_ft, 188, 4), fp.perimeter_ft, 188);
    ok('perimeter equals the polygon it reports',
       near(fp.perimeter_ft, polygonPerimeterFt(fp.polygon), 1));
    ok('the 0.5 ft seam did not split the house into two masses',
       fp.dropped_components === 0, fp.dropped_components, 0);
    ok('simplification kept it a quadrilateral', fp.vertices === 4, fp.vertices, 4);
    ok('reports its provenance', fp.source === 'solar_facet_union', fp.source);
  }

  console.log('\n\u2500\u2500 3. L-shaped house keeps its wing \u2500\u2500');
  {
    const facets = [
      rectFacet(-30, -20, 30, 0, 180),
      rectFacet(-30, 0, 30, 20, 0),
      rectFacet(30, -20, 50, 10, 90),
    ];
    const fp = buildFootprintFromFacets(facets, { overhangFt: OVERHANG });
    ok('returns a footprint', !!fp);
    // Rectilinear erosion by d drops perimeter by 2*d*(convex - concave) = 8d.
    ok('perimeter is ~228 LF (240 roof plan less the overhang inset)',
       near(fp.perimeter_ft, 228, 8), fp.perimeter_ft, 228);
    ok('the wing produced extra vertices (not a 4-corner box)',
       fp.vertices >= 6, fp.vertices, '>= 6');

    // The regression itself: the old code sized a rectangle from plan area.
    const planArea = fp.area_sqft;
    const aspect = fp.length_ft / Math.max(1, fp.width_ft);
    const legacyLen = Math.sqrt(planArea * aspect);
    const legacyWid = planArea / legacyLen;
    const legacyPerim = 2 * (legacyLen + legacyWid) * 0.925; // incl. the old fudge
    // A modest wing already costs >10% of the wall line; the field case that
    // triggered this work (colonial + 3-car garage) was off by 20%.
    ok('old sqrt(area x aspect) x 0.925 math understates this house by >10%',
       (fp.perimeter_ft - legacyPerim) / fp.perimeter_ft > 0.10,
       `legacy ${Math.round(legacyPerim)} LF vs true ${fp.perimeter_ft} LF`);
  }

  console.log('\n\u2500\u2500 4. House rotated 30\u00b0 off true north \u2500\u2500');
  {
    const straight = buildFootprintFromFacets([
      rectFacet(-30, -20, 30, 0, 180),
      rectFacet(-30, 0, 30, 20, 0),
    ], { overhangFt: OVERHANG });
    const turned = buildFootprintFromFacets([
      rectFacet(-30, -20, 30, 0, 180, 30),
      rectFacet(-30, 0, 30, 20, 0, 30),
    ], { overhangFt: OVERHANG });
    ok('rotated house still resolves', !!turned);
    ok('rotation does not inflate the perimeter (no raster staircase)',
       near(turned.perimeter_ft, straight.perimeter_ft, 6),
       `${turned.perimeter_ft} vs ${straight.perimeter_ft}`);
    ok('rotated house stays a quadrilateral', turned.vertices === 4, turned.vertices, 4);
    ok('detected orientation is reported', Number.isFinite(turned.rotation_deg));
  }

  console.log('\n\u2500\u2500 5. Detached outbuilding is excluded \u2500\u2500');
  {
    const facets = [
      rectFacet(-30, -20, 30, 0, 180),
      rectFacet(-30, 0, 30, 20, 0),
      rectFacet(80, 80, 100, 100, 180), // detached shed, 50 ft away
    ];
    const fp = buildFootprintFromFacets(facets, { overhangFt: OVERHANG });
    ok('returns a footprint', !!fp);
    ok('shed was dropped, not welded on', fp.dropped_components >= 1, fp.dropped_components, '>= 1');
    ok('main house perimeter unaffected by the shed',
       near(fp.perimeter_ft, 188, 4), fp.perimeter_ft, 188);
  }

  console.log('\n\u2500\u2500 6. Degenerate input fails closed \u2500\u2500');
  {
    ok('null facets -> null', buildFootprintFromFacets(null, { overhangFt: OVERHANG }) === null);
    ok('empty facets -> null', buildFootprintFromFacets([], { overhangFt: OVERHANG }) === null);
    ok('facets without polygons -> null',
       buildFootprintFromFacets([{ area_sqft: 100 }], { overhangFt: OVERHANG }) === null);
    ok('degenerate 2-point polygon -> null',
       buildFootprintFromFacets([{ polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], { overhangFt: OVERHANG }) === null);
    ok('a shed smaller than the overhang erodes to nothing -> null',
       buildFootprintFromFacets([rectFacet(-1, -1, 1, 1, 180)], { overhangFt: OVERHANG }) === null);
    ok('NaN coordinates -> null',
       buildFootprintFromFacets([{ polygon: [{ x: NaN, y: 0 }, { x: 1, y: NaN }, { x: 2, y: 2 }] }],
         { overhangFt: OVERHANG }) === null);
    ok('perimeter of a non-polygon is 0', polygonPerimeterFt(null) === 0 && polygonPerimeterFt([[0, 0]]) === 0);
    ok('area of a non-polygon is 0', polygonAreaFt2(undefined) === 0);
  }

  console.log('\n\u2500\u2500 7. Determinism \u2500\u2500');
  {
    const mk = () => [rectFacet(-30, -20, 30, 0, 180), rectFacet(-30, 0, 30, 20, 0)];
    const a = buildFootprintFromFacets(mk(), { overhangFt: OVERHANG });
    const b = buildFootprintFromFacets(mk(), { overhangFt: OVERHANG });
    ok('identical input -> byte-identical output', JSON.stringify(a) === JSON.stringify(b));
  }

  console.log('\n\u2500\u2500 7b. A severed wing fails closed \u2500\u2500');
  {
    // Main mass + a wing joined by a neck narrower than twice the overhang.
    // Eroding to the wall line cuts the neck, and keeping the largest component
    // would silently amputate the wing while still returning a tidy outline.
    // We would rather return nothing and let the caller fall back knowingly.
    const severed = [
      rectFacet(-20, -15, 20, 15, 180),   // main house
      rectFacet(20, -1, 26, 1, 180),      // 2 ft neck — erodes away entirely
      rectFacet(26, -10, 40, 10, 180),    // wing, big enough to matter
    ];
    ok('a wing severed by the overhang inset -> null (not an amputated house)',
       buildFootprintFromFacets(severed, { overhangFt: OVERHANG }) === null);
    // The same geometry must still be traceable when the caller explicitly
    // accepts the loss, so the guard is a policy and not a dead end.
    ok('the guard is tunable, not absolute',
       buildFootprintFromFacets(severed, { overhangFt: OVERHANG, maxDiscardRatio: 0.9 }) !== null);
    // A properly attached wing (wide junction) must survive untouched.
    const attached = [
      rectFacet(-20, -15, 20, 15, 180),
      rectFacet(20, -10, 40, 10, 180),    // 20 ft junction — survives erosion
    ];
    ok('a wing on a wide junction is still traced', buildFootprintFromFacets(attached, { overhangFt: OVERHANG }) !== null);
  }

  console.log('\n\u2500\u2500 8. scalePolygonToPerimeter \u2500\u2500');
  {
    // A measured perimeter is a better NUMBER than a traced outline, but it is
    // only a number. Applying it must resize the shape, never rectangularise it.
    const L = [[0, 0], [40, 0], [40, 20], [20, 20], [20, 35], [0, 35]]; // L-shape
    const before = polygonPerimeterFt(L);
    const scaled = scalePolygonToPerimeter(L, before * 1.25);
    ok('scaled polygon keeps every corner',
       Array.isArray(scaled) && scaled.length === L.length, scaled && scaled.length, L.length);
    ok('scaled polygon hits the target perimeter',
       near(polygonPerimeterFt(scaled), before * 1.25, 0.2),
       polygonPerimeterFt(scaled), before * 1.25);
    ok('area scales with the square of the linear factor',
       near(polygonAreaFt2(scaled) / polygonAreaFt2(L), 1.25 * 1.25, 0.02),
       polygonAreaFt2(scaled) / polygonAreaFt2(L), 1.5625);
    // Shape fidelity: every edge keeps its direction and relative length.
    const edgeAngles = (p) => p.map((pt, i) => {
      const n = p[(i + 1) % p.length];
      return Math.round(Math.atan2(n[1] - pt[1], n[0] - pt[0]) * 1000) / 1000;
    });
    ok('scaling does not rotate or rectangularise the outline',
       JSON.stringify(edgeAngles(scaled)) === JSON.stringify(edgeAngles(L)));
    ok('shrinking works as well as growing',
       near(polygonPerimeterFt(scalePolygonToPerimeter(L, before * 0.5)), before * 0.5, 0.2));
    ok('garbage in -> null out',
       scalePolygonToPerimeter(null, 100) === null
       && scalePolygonToPerimeter(L, 0) === null
       && scalePolygonToPerimeter([[0, 0], [1, 1]], 100) === null);
  }

  console.log('\n\u2500\u2500 9. Overhang constant lockstep \u2500\u2500');
  {
    // The eave overhang used to step the roof plan in to the wall line must be
    // the same number the derived-quantity math assumes, or fascia/soffit
    // totals silently describe a different building than the footprint does.
    const derived = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'utils', 'sidingDerivedQuantities.js'), 'utf8');
    const m = derived.match(/export\s+const\s+DEFAULT_OVERHANG_FT\s*=\s*([\d.]+)/);
    ok('sidingDerivedQuantities.js still declares DEFAULT_OVERHANG_FT', !!m);
    if (m) {
      ok('DEFAULT_EAVE_OVERHANG_FT matches DEFAULT_OVERHANG_FT',
         Number(m[1]) === DEFAULT_EAVE_OVERHANG_FT, m[1], DEFAULT_EAVE_OVERHANG_FT);
    }
    const live = fs.readFileSync(
      path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
    const reconstructionStart = live.indexOf('// ── Preferred: trace the true outline from the roof facets');
    const reconstructionEnd = live.indexOf('// ── Roof eave perimeter cross-reference', reconstructionStart);
    const reconstruction = live.slice(reconstructionStart, reconstructionEnd);
    ok('live analyzer has a reconstructed-footprint block',
       reconstructionStart > 0 && reconstructionEnd > reconstructionStart);
    ok('live reconstructed footprint uses the shared overhang constant',
       /overhangFt:\s*DEFAULT_EAVE_OVERHANG_FT/.test(reconstruction));
    ok('reconstructed-footprint 0.925 / 0.85 fudge factors are gone',
       !/\*\s*0\.925/.test(reconstruction) && !/rawPerimeter\s*\*\s*0\.85/.test(reconstruction));
  }

  console.log(`\n${'\u2500'.repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\n\u274c Footprint polygon reconstruction has regressed.');
    process.exit(1);
  }
  console.log('\n\u2705 All footprint polygon assertions passed.');
})();
