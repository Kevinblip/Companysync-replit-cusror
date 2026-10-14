#!/usr/bin/env node
/**
 * Unit tests for functions/utils/roofFacetGeometry.js (ESM, loaded via dynamic import).
 * Builds synthetic Solar API roofSegmentStats for known roof shapes and asserts
 * facet polygons + edge classification (eave/ridge/hip/valley/rake).
 */
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`); }
}

// Build a synthetic Solar segment: a facet centered at (latC,lngC) facing `azimuth`,
// with plan depth A ft and ridge length B ft (axis-aligned bbox derived exactly).
const LAT0 = 33.0, LNG0 = -84.0;
const FT_PER_LAT = 364567.2;
function ftPerLng(lat) { return FT_PER_LAT * Math.cos(lat * Math.PI / 180); }
function seg(eastFt, northFt, azimuth, pitchDeg, A, B, areaM2, planeHeightAtCenterMeters) {
  const lat = LAT0 + northFt / FT_PER_LAT;
  const lng = LNG0 + eastFt / ftPerLng(LAT0);
  const azR = azimuth * Math.PI / 180;
  // Exact axis-aligned bbox of the rotated A×B rectangle:
  const bboxW = A * Math.abs(Math.sin(azR)) + B * Math.abs(Math.cos(azR)); // east span ft
  const bboxH = A * Math.abs(Math.cos(azR)) + B * Math.abs(Math.sin(azR)); // north span ft
  const result = {
    pitchDegrees: pitchDeg,
    azimuthDegrees: azimuth,
    center: { latitude: lat, longitude: lng },
    boundingBox: {
      sw: { latitude: lat - (bboxH / 2) / FT_PER_LAT, longitude: lng - (bboxW / 2) / ftPerLng(LAT0) },
      ne: { latitude: lat + (bboxH / 2) / FT_PER_LAT, longitude: lng + (bboxW / 2) / ftPerLng(LAT0) },
    },
    stats: { areaMeters2: areaM2 },
  };
  if (planeHeightAtCenterMeters != null) result.planeHeightAtCenterMeters = planeHeightAtCenterMeters;
  return result;
}

(async () => {
  const mod = await import('../functions/utils/roofFacetGeometry.js');
  const { buildRoofFacetsFromSolarSegments, computeEdgeTotals, facetsBounds, shouldFillGableEdge } = mod;
  const {
    filterMicroFacets,
    enforceUnifiedRidge,
    preprocessSolarSegments,
    snapEavesToWallPlate,
  } = await import('../src/utils/MeshGeometryBuilder.js');

  console.log('\n— simple gable (2 facets, 30ft ridge, 26° pitch) —');
  // Ridge runs east-west. South facet faces 180 (south), north facet faces 0.
  // Each facet: A=12ft run, B=30ft ridge. Centers 6 ft either side of the ridge line.
  {
    const facets = buildRoofFacetsFromSolarSegments([
      seg(0, -6, 180, 26, 12, 30, 40),
      seg(0, +6,   0, 26, 12, 30, 40),
    ]);
    check('two facets built', facets.length === 2);
    const f = facets[0];
    check('polygon has 4 corners', f.polygon.length === 4);
    check('pitch string ~5.5-6/12', /5\.5\/12|6\/12/.test(f.pitch), f.pitch);
    check('rise ≈ 12*tan(26°) ≈ 5.85', Math.abs(f.rise_ft - 12 * Math.tan(26 * Math.PI / 180)) < 0.6, f.rise_ft);
    const ridgeEdges = facets.flatMap(x => x.edges).filter(e => e.type === 'ridge');
    check('both up edges classified ridge & shared', ridgeEdges.length === 2 && ridgeEdges.every(e => e.shared_with), ridgeEdges);
    const rakes = facets.flatMap(x => x.edges).filter(e => e.type === 'rake');
    check('4 rakes (gable ends)', rakes.length === 4, rakes.length);
    const totals = computeEdgeTotals(facets);
    check('ridge LF ≈ 30 (counted once)', Math.abs(totals.ridge - 30) < 2, totals.ridge);
    check('eave LF ≈ 60', Math.abs(totals.eave - 60) < 3, totals.eave);
    check('no hips/valleys', totals.hip === 0 && totals.valley === 0, totals);
    const b = facetsBounds(facets);
    check('bounds span ≈ 30×24', Math.abs(b.spanX - 30) < 2 && Math.abs(b.spanY - 24) < 2, b);
  }

  console.log('\n— pyramid hip (4 facets) —');
  {
    // 30×30 pyramid: each facet A=15 run to center, B=30 at eave (rect approx), azimuths N/E/S/W.
    const facets = buildRoofFacetsFromSolarSegments([
      seg(0, -7.5, 180, 30, 15, 30, 40),
      seg(0, +7.5,   0, 30, 15, 30, 40),
      seg(+7.5, 0,  90, 30, 15, 30, 40),
      seg(-7.5, 0, 270, 30, 15, 30, 40),
    ]);
    check('four facets built', facets.length === 4);
    const totals = computeEdgeTotals(facets);
    check('hips detected (side↔side convex)', totals.hip > 0, totals);
    check('no valleys on pyramid', totals.valley === 0, totals);
  }

  console.log('\n— L-shape cross-gable (valley expected) —');
  {
    // Main gable ridge east-west + wing gable ridge north-south intersecting:
    // wing's west-facing facet meets main's south-facing facet in a concave corner.
    const facets = buildRoofFacetsFromSolarSegments([
      seg(0, -6, 180, 26, 12, 40, 50),   // main south facet
      seg(0, +6,   0, 26, 12, 40, 50),   // main north facet
      seg(14, -16,  90, 26, 12, 20, 30), // wing east facet
      seg(2,  -16, 270, 26, 12, 20, 30), // wing west facet (abuts main south facet)
    ]);
    const totals = computeEdgeTotals(facets);
    check('valley detected at concave junction', totals.valley > 0, totals);
    check('ridges on both wings', totals.ridge > 30, totals.ridge);
  }

  console.log('\n— topology: clipping & symmetric junctions —');
  {
    const { polyPlanArea } = mod;
    // Pyramid: 4 full rectangles would double-cover the 30×30 footprint (1800 sqft
    // of plan area). After hip clipping the facets must tile it (~900 sqft).
    const facets = buildRoofFacetsFromSolarSegments([
      seg(0, -7.5, 180, 30, 15, 30, 40),
      seg(0, +7.5,   0, 30, 15, 30, 40),
      seg(+7.5, 0,  90, 30, 15, 30, 40),
      seg(-7.5, 0, 270, 30, 15, 30, 40),
    ]);
    const planSum = facets.reduce((s, f) => s + polyPlanArea(f.polygon), 0);
    check('clipped facets tile the footprint (~900 sqft, not 1800)', planSum > 700 && planSum < 1050, planSum);
    const junctions = facets.flatMap(f => f.edges.filter(e => e.role === 'junction'));
    check('junction edges present on BOTH facets of each pair', junctions.length >= 8 && junctions.every(e => e.shared_with), junctions.length);
    // Every junction edge appears with identical coordinates on the partner facet
    const symOk = junctions.every(e => {
      const partner = facets.find(f => f.id === e.shared_with);
      return partner && partner.edges.some(pe => pe.role === 'junction'
        && Math.abs(pe.x1 - e.x1) < 0.01 && Math.abs(pe.y1 - e.y1) < 0.01
        && Math.abs(pe.x2 - e.x2) < 0.01 && Math.abs(pe.y2 - e.y2) < 0.01);
    });
    check('junction coordinates identical on both facets', symOk);
    // Each clipped polygon stays on its own side of every junction it owns
    const sideOk = facets.every(f => f.edges.filter(e => e.role === 'junction').every(e => {
      const cx = f.polygon.reduce((s, p) => s + p.x, 0) / f.polygon.length;
      const cy = f.polygon.reduce((s, p) => s + p.y, 0) / f.polygon.length;
      const side = Math.sign((e.x2 - e.x1) * (cy - e.y1) - (e.y2 - e.y1) * (cx - e.x1)) || 1;
      return f.polygon.every(p => ((e.x2 - e.x1) * (p.y - e.y1) - (e.y2 - e.y1) * (p.x - e.x1)) * side >= -1.5);
    }));
    check('no facet polygon crosses its junction boundary', sideOk);
  }

  console.log('\n— false positives: distant perpendicular segments —');
  {
    const facets = buildRoofFacetsFromSolarSegments([
      seg(0, 0, 180, 26, 12, 30, 40),
      seg(60, 60, 90, 26, 12, 30, 40), // far away, perpendicular azimuth
    ]);
    const totals = computeEdgeTotals(facets);
    check('no hip/valley between disconnected segments', totals.hip === 0 && totals.valley === 0, totals);
  }

  console.log('\n— raised secondary roof elevation —');
  {
    const pitch = 26;
    const depth = 12;
    const centerRiseFt = depth * Math.tan(pitch * Math.PI / 180) / 2;
    const mainCenterM = (10 + centerRiseFt) / 3.28084;
    const raisedCenterM = (16 + centerRiseFt) / 3.28084;
    const facets = buildRoofFacetsFromSolarSegments([
      seg(0, -6, 180, pitch, depth, 30, 60, mainCenterM),
      seg(0, +6, 0, pitch, depth, 30, 60, mainCenterM),
      seg(20, -6, 180, pitch, depth, 12, 15, raisedCenterM),
      seg(20, +6, 0, pitch, depth, 12, 15, raisedCenterM),
    ]);
    const main = facets.slice(0, 2);
    const raised = facets.slice(2);
    check('main roof remains on the shared wall plate',
      main.every(f => f.elevation_offset_ft === 0 && Math.min(...f.polygon.map(p => p.h)) === 0), main);
    check('secondary roof preserves its six-foot local elevation',
      raised.every(f => Math.abs(f.elevation_offset_ft - 6) < 0.1
        && Math.abs(Math.min(...f.polygon.map(p => p.h)) - 6) < 0.1), raised);
    const normalized = snapEavesToWallPlate(enforceUnifiedRidge(facets));
    check('3D preprocessing does not flatten the raised roof',
      normalized.slice(2).every(f => Math.abs(Math.min(...f.polygon.map(p => p.h)) - 6) < 0.1), normalized);
    const totals = computeEdgeTotals(facets);
    check('render elevation does not change roof labels',
      Math.abs(totals.ridge - 42) < 2 && Math.abs(totals.eave - 84) < 3, totals);
  }

  console.log('\n— lower secondary roof elevation —');
  {
    const pitch = 26;
    const depth = 12;
    const centerRiseFt = depth * Math.tan(pitch * Math.PI / 180) / 2;
    const mainCenterM = (16 + centerRiseFt) / 3.28084;
    const lowerCenterM = (10 + centerRiseFt) / 3.28084;
    const facets = buildRoofFacetsFromSolarSegments([
      seg(0, -6, 180, pitch, depth, 30, 60, mainCenterM),
      seg(0, +6, 0, pitch, depth, 30, 60, mainCenterM),
      seg(20, -6, 180, pitch, depth, 12, 15, lowerCenterM),
      seg(20, +6, 0, pitch, depth, 12, 15, lowerCenterM),
    ]);
    const lower = facets.slice(2);
    check('secondary roof preserves its negative six-foot local elevation',
      lower.every(f => Math.abs(f.elevation_offset_ft + 6) < 0.1
        && Math.abs(Math.min(...f.polygon.map(p => p.h)) + 6) < 0.1), lower);
    const normalized = snapEavesToWallPlate(enforceUnifiedRidge(facets));
    check('3D preprocessing does not flatten the lower roof',
      normalized.slice(2).every(f => Math.abs(Math.min(...f.polygon.map(p => p.h)) + 6) < 0.1), normalized);
    check('lower roof ridge and rise survive 3D preprocessing',
      normalized.slice(2).every(f => {
        const minH = Math.min(...f.polygon.map(p => p.h));
        const maxH = Math.max(...f.polygon.map(p => p.h));
        return Math.abs(maxH - (-6 + f.rise_ft)) < 0.1
          && Math.abs((maxH - minH) - f.rise_ft) < 0.1;
      }), normalized);
    const lowerRake = lower.flatMap(f => f.edges)
      .find(e => e.type === 'rake' && Math.abs(e.h1 - e.h2) > 0.3);
    check('lower roof gable closure is measured from its local plate',
      !!lowerRake && shouldFillGableEdge(lowerRake, -6), lowerRake);
  }

  console.log('\n— elevated junction label invariance —');
  {
    const pitch = 30;
    const depth = 15;
    const centerRiseFt = depth * Math.tan(pitch * Math.PI / 180) / 2;
    const baseCenterM = (10 + centerRiseFt) / 3.28084;
    const raisedCenterM = (16 + centerRiseFt) / 3.28084;
    const dominant = [
      seg(-60, -6, 180, 26, 12, 30, 500, baseCenterM),
      seg(-60, +6, 0, 26, 12, 30, 500, baseCenterM),
    ];
    const baseHip = buildRoofFacetsFromSolarSegments([
      ...dominant,
      seg(0, -7.5, 180, pitch, depth, 30, 20, baseCenterM),
      seg(0, +7.5, 0, pitch, depth, 30, 20, baseCenterM),
      seg(+7.5, 0, 90, pitch, depth, 30, 20, baseCenterM),
      seg(-7.5, 0, 270, pitch, depth, 30, 20, baseCenterM),
    ]);
    const raisedHip = buildRoofFacetsFromSolarSegments([
      ...dominant,
      seg(0, -7.5, 180, pitch, depth, 30, 20, raisedCenterM),
      seg(0, +7.5, 0, pitch, depth, 30, 20, raisedCenterM),
      seg(+7.5, 0, 90, pitch, depth, 30, 20, raisedCenterM),
      seg(-7.5, 0, 270, pitch, depth, 30, 20, raisedCenterM),
    ]);
    const baseTotals = computeEdgeTotals(baseHip);
    const raisedTotals = computeEdgeTotals(raisedHip);
    check('uniform roof elevation does not inflate hip/valley labels',
      Math.abs(baseTotals.hip - raisedTotals.hip) < 0.1
        && Math.abs(baseTotals.valley - raisedTotals.valley) < 0.1,
      { baseTotals, raisedTotals });
  }

  console.log('\n— real-shaped complex roof: ridges never become gable sheets —');
  {
    // Reduced from a seven-segment real Google Solar response. Several planes
    // have unmatched, level uphill edges because the API bounding boxes do not
    // expose exact shared topology. Those edges may remain ridges, but must not
    // be interpreted as vertical gable-wall boundaries by the 3D renderer.
    const facets = buildRoofFacetsFromSolarSegments([
      seg(-3.1, -27.5, 178.5, 32.5, 14.75, 30.75, 27.1),
      seg(9.3, -14.3, 95.3, 34.3, 16.75, 33.11, 43.3),
      seg(-14.2, -13.9, 263.9, 30.2, 13.05, 32.70, 36.3),
      seg(1.7, 1.9, 9.7, 38.7, 19.12, 38.98, 42.1),
      seg(-9.8, 13.1, 271.9, 34.7, 16.58, 26.45, 27.8),
      seg(3.6, 9.2, 102.4, 25.7, 14.01, 12.75, 14.1),
      seg(6.8, 22.3, 17.8, 31.4, 13.07, 29.57, 52.1),
    ]);
    const unmatchedRidges = facets.flatMap(f => f.edges)
      .filter(e => e.type === 'ridge' && !e.shared_with);
    check('fixture retains unmatched Solar ridges', unmatchedRidges.length > 0, unmatchedRidges.length);
    check('level unmatched ridges do not request gable infill',
      unmatchedRidges.every(e => !shouldFillGableEdge(e)), unmatchedRidges);
    check('ridge-role edges never request gable infill',
      !shouldFillGableEdge({ type: 'ridge', role: 'up', h1: 0, h2: 8 }), null);
    const slopedExterior = facets.flatMap(f => f.edges)
      .find(e => !e.shared_with && e.type === 'rake' && Math.abs(e.h1 - e.h2) > 0.3);
    check('sloped exterior edge still requests gable infill',
      !!slopedExterior && shouldFillGableEdge(slopedExterior), slopedExterior);
    const unmatchedBefore = new Map(facets.flatMap(f => f.edges)
      .filter(e => e.type === 'ridge' && !e.shared_with)
      .map(e => [`${e.x1},${e.y1}|${e.x2},${e.y2}`, [e.h1, e.h2]]));
    const unified = enforceUnifiedRidge(facets);
    const unmatchedAfter = unified.flatMap(f => f.edges)
      .filter(e => e.type === 'ridge' && !e.shared_with);
    check('independent complex-roof ridges keep their own heights',
      unmatchedAfter.every(e => {
        const before = unmatchedBefore.get(`${e.x1},${e.y1}|${e.x2},${e.y2}`);
        return before && before[0] === e.h1 && before[1] === e.h2;
      }), unmatchedAfter);
  }

  console.log('\n— integration: measurement graph pass-through —');
  {
    const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');
    const facets = buildRoofFacetsFromSolarSegments([
      seg(0, -6, 180, 26, 12, 30, 40),
      seg(0, +6,   0, 26, 12, 30, 40),
    ]);
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [{ view_label: 'front', confidence: 0.8, openings: [] }],
      storyCount: 1, wallHeightFt: 9, grossWallAreaSqft: 900, perimeterFt: 108,
      buildingWidthFt: 24, buildingLengthFt: 30, footprintSource: 'solar',
      roofFacets: facets,
    });
    check('graph carries roof_facets', Array.isArray(graph.roof_facets) && graph.roof_facets.length === 2);
    const gf = graph.roof_facets[0];
    check('graph facets keep polygons', Array.isArray(gf.polygon) && gf.polygon.length >= 4);
    check('graph facets keep classified edges', Array.isArray(gf.edges) && gf.edges.some(e => e.type === 'ridge'));
    check('graph facets keep pitch/azimuth', Number.isFinite(gf.pitch_degrees) && Number.isFinite(gf.azimuth_degrees));
  }

  console.log('\n— 5688 Gemini Ct Solar segments —');
  {
    const fs = require('node:fs');
    const path = require('node:path');
    const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hover-roof-5688-gemini-ct.json'), 'utf8'));
    const facets = buildRoofFacetsFromSolarSegments(recorded.solar.solarPotential.roofSegmentStats);
    const totals = computeEdgeTotals(facets);
    const hover = recorded.hover_reference;
    const withinBand = (actual, expected) => Math.abs(actual - expected) <= Math.max(5, Math.abs(expected) * 0.1);
    check('5688 eave within 10% or 5 ft of Hover', withinBand(totals.eave, hover.eave_lf), totals.eave);
    check('5688 rake within 10% or 5 ft of Hover', withinBand(totals.rake, hover.rake_lf), totals.rake);
    check('5688 valley within 5 ft of Hover', Math.abs(totals.valley - hover.valley_lf) <= 5, totals.valley);
    const drip = totals.eave + totals.rake;
    const hoverDrip = hover.eave_lf + hover.rake_lf;
    check('5688 eave+rake within 8% of Hover drip edge', Math.abs(drip - hoverDrip) <= hoverDrip * 0.08, { drip, hoverDrip });
    // Solar publishes 4 segments against Hover's 7 facets. Once each shared
    // ridge is counted a single time, the remainder is short of Hover's
    // ridge+hip and is not filled in with an invented hip.
    check('5688 shared ridges are counted once', totals.counts.ridge === 2 && totals.ridge > 50 && totals.ridge < 70, totals);
    check('5688 does not invent a hip or valley', totals.hip === 0 && totals.valley === 0, totals);
  }

  console.log('\n— degenerate input —');
  {
    check('empty input → []', buildRoofFacetsFromSolarSegments([]).length === 0);
    check('null input → []', buildRoofFacetsFromSolarSegments(null).length === 0);
    check('segment without bbox skipped', buildRoofFacetsFromSolarSegments([{ pitchDegrees: 20 }]).length === 0);
  }

  console.log('\n— incomplete facet edges —');
  {
    const polygon = [
      { x: 0, y: 0, h: 2 },
      { x: 10, y: 0, h: 2 },
      { x: 0, y: 10, h: 0 },
    ];
    const malformed = [
      { id: 'null-edge', polygon, edges: [null] },
      { id: 'object-edges', polygon, edges: {} },
    ];
    // Invalid facet edges are rejected at the shared pipeline boundary. In the
    // viewer that leaves no usable Solar geometry, which activates its graceful
    // “satellite data incomplete” placeholder instead of an ErrorBoundary.
    check('null and non-array edges reject incomplete facets',
      filterMicroFacets(malformed).length === 0);
    let normalizationDidNotThrow = true;
    try {
      snapEavesToWallPlate(enforceUnifiedRidge(malformed));
    } catch (_) {
      normalizationDidNotThrow = false;
    }
    check('normalization tolerates incomplete edge payloads', normalizationDidNotThrow);
  }

  console.log('\n— null and missing geometry coordinates —');
  {
    const invalidFacets = [
      {
        polygon: [{ x: null, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
        edges: [],
      },
      {
        polygon: [{ x: 0, y: 0 }, { x: 8 }, { x: 0, y: 8 }],
        edges: [],
      },
      {
        polygon: [{ x: false, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }],
        edges: [],
      },
    ];
    check('null, missing, and boolean facet coordinates reject facets',
      filterMicroFacets(invalidFacets).length === 0);

    const incompleteSegments = [
      { ...seg(0, 0, 0, 20, 12, 20, 30), center: { latitude: null, longitude: LNG0 } },
      { ...seg(0, 0, 0, 20, 12, 20, 30), boundingBox: { ne: { latitude: LAT0, longitude: LNG0 }, sw: { latitude: LAT0 - 0.01, longitude: null } } },
      { ...seg(0, 0, 0, 20, 12, 20, 30), stats: { areaMeters2: null } },
      { ...seg(0, 0, 0, 20, 12, 20, 30), stats: { areaMeters2: '' } },
    ];
    const result = preprocessSolarSegments(incompleteSegments, { type: 'rectangle', fillRatio: 1 });
    // With external satellite records but zero usable geometry, HouseModel3D
    // selects its incomplete-data placeholder rather than a parametric fallback.
    check('null or missing segment coordinates and area reject segments', result.segments.length === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
