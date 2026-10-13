#!/usr/bin/env node
/**
 * test-satellite-footprint-polygon.cjs
 *
 * The satellite siding path (`analyzeSidingMeasurement`) used to emit
 * `footprint_polygon_xy: null`. With no polygon, HouseModel3D falls back to
 * buildBoxWalls — four solid slabs with NO openings punched — which is the
 * "generic untextured box" users complained about.
 *
 * This exercises the exact chain that handler now runs:
 *   Solar segments -> buildRoofFacetsFromSolarSegments
 *                  -> buildFootprintFromFacets   (true outline)
 *                  -> scalePolygonToPerimeter    (pin to the BILLED perimeter)
 *
 * The critical invariant: the outline is RENDERING ONLY. Scaling it must never
 * be able to move the perimeter the estimate is billed on.
 */
let failures = 0, passed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failures++; console.log(`  \u2717 ${label}${detail ? ` — ${detail}` : ''}`); }
}

(async () => {
  const { buildRoofFacetsFromSolarSegments } = await import('../functions/utils/roofFacetGeometry.js');
  const {
    buildFootprintFromFacets,
    polygonPerimeterFt,
    polygonAreaFt2,
    scalePolygonToPerimeter,
    rectanglePolygon,
    DEFAULT_EAVE_OVERHANG_FT,
  } = await import('../functions/utils/footprintPolygon.js');

  const M2 = (sqft) => sqft / 10.7639;
  // Google Solar returns a bounding box per roof segment, in lat/lng.
  const seg = (centerLat, centerLng, nsDeg, ewDeg, azimuth, pitch, areaSqFt) => ({
    pitchDegrees: pitch,
    azimuthDegrees: azimuth,
    stats: { areaMeters2: M2(areaSqFt) },
    boundingBox: {
      sw: { latitude: centerLat - nsDeg / 2, longitude: centerLng - ewDeg / 2 },
      ne: { latitude: centerLat + nsDeg / 2, longitude: centerLng + ewDeg / 2 },
    },
    center: { latitude: centerLat, longitude: centerLng },
  });

  const LAT = 41.4993, LNG = -81.6944;
  // ~30ft in latitude degrees, and the matching longitude degrees at this lat.
  const FT_LAT = 1 / 364000;
  const FT_LNG = 1 / (364000 * Math.cos(LAT * Math.PI / 180));

  console.log('\n\u2500\u2500 1. Simple gable: two opposing segments \u2500\u2500');
  {
    const segs = [
      seg(LAT + 10 * FT_LAT, LNG, 20 * FT_LAT, 40 * FT_LNG, 180, 25, 500),
      seg(LAT - 10 * FT_LAT, LNG, 20 * FT_LAT, 40 * FT_LNG, 0, 25, 500),
    ];
    const facets = buildRoofFacetsFromSolarSegments(segs);
    check('segments convert to facets', Array.isArray(facets) && facets.length === 2,
      `got ${facets && facets.length}`);
    check('each facet carries a polygon of >=3 pts',
      facets.every(f => Array.isArray(f.polygon) && f.polygon.length >= 3));
    check('each facet carries azimuth_degrees + area_sqft',
      facets.every(f => Number.isFinite(f.azimuth_degrees) && Number.isFinite(f.area_sqft)));

    const fp = buildFootprintFromFacets(facets, { overhangFt: DEFAULT_EAVE_OVERHANG_FT });
    check('trace returns a footprint', !!fp, 'got null');
    if (fp) {
      check('outline has >=4 vertices', fp.polygon.length >= 4, `got ${fp.polygon.length}`);
      check('outline area is positive', fp.area_sqft > 0);
      // The tracer works off segment BOUNDING BOXES, not the slope-area stat.
      // These two segments tile a 40ft x 40ft roof plan; inset by the 1.5ft eave
      // overhang on every side that is a 37 x 37 = 1369 sqft wall line.
      const expected = (40 - 2 * DEFAULT_EAVE_OVERHANG_FT) ** 2;
      check('outline is the roof plan inset by the eave overhang',
        Math.abs(fp.area_sqft - expected) < expected * 0.06,
        `traced ${fp.area_sqft} vs expected ~${Math.round(expected)}`);
    }
  }

  console.log('\n\u2500\u2500 2. L-shaped roof keeps its wing \u2500\u2500');
  {
    // Main mass plus a wing sticking out to the east.
    const segs = [
      seg(LAT, LNG, 40 * FT_LAT, 30 * FT_LNG, 180, 25, 600),
      seg(LAT, LNG, 40 * FT_LAT, 30 * FT_LNG, 0, 25, 600),
      seg(LAT - 12 * FT_LAT, LNG + 28 * FT_LNG, 16 * FT_LAT, 26 * FT_LNG, 90, 25, 400),
    ];
    const facets = buildRoofFacetsFromSolarSegments(segs);
    const fp = buildFootprintFromFacets(facets, { overhangFt: DEFAULT_EAVE_OVERHANG_FT });
    check('L-shape traces successfully', !!fp);
    if (fp) {
      const bbox = fp.length_ft * fp.width_ft;
      check('traced area is materially less than its bounding box (a real L, not a rectangle)',
        fp.area_sqft < bbox * 0.92, `traced ${fp.area_sqft} vs bbox ${Math.round(bbox)}`);
      check('L-shape keeps more than 4 corners', fp.polygon.length > 4,
        `got ${fp.polygon.length}`);
    }
  }

  console.log('\n\u2500\u2500 3. Scaling to the billed perimeter preserves shape \u2500\u2500');
  {
    const segs = [
      seg(LAT, LNG, 40 * FT_LAT, 30 * FT_LNG, 180, 25, 600),
      seg(LAT, LNG, 40 * FT_LAT, 30 * FT_LNG, 0, 25, 600),
      seg(LAT - 12 * FT_LAT, LNG + 28 * FT_LNG, 16 * FT_LAT, 26 * FT_LNG, 90, 25, 400),
    ];
    const fp = buildFootprintFromFacets(
      buildRoofFacetsFromSolarSegments(segs), { overhangFt: DEFAULT_EAVE_OVERHANG_FT });
    if (fp) {
      const BILLED_PERIMETER = 326; // what the estimate is priced on
      const cornersBefore = fp.polygon.length;
      const scaled = scalePolygonToPerimeter(fp.polygon, BILLED_PERIMETER);
      check('scaling returns a polygon', !!scaled);
      if (scaled) {
        check('scaled outline matches the billed perimeter',
          Math.abs(polygonPerimeterFt(scaled) - BILLED_PERIMETER) < 0.5,
          `got ${polygonPerimeterFt(scaled).toFixed(1)}`);
        check('every corner survives scaling (wing not rectangularised)',
          scaled.length === cornersBefore, `${cornersBefore} -> ${scaled.length}`);
        const bboxS = (() => {
          const xs = scaled.map(p => p[0]), ys = scaled.map(p => p[1]);
          return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        })();
        check('scaled outline is still a real L (not filled to its bbox)',
          polygonAreaFt2(scaled) < bboxS * 0.92);
      }
    } else { check('L-shape traced for scaling test', false); }
  }

  console.log('\n\u2500\u2500 4. Rectangle fallback still yields a punchable polygon \u2500\u2500');
  {
    // No usable facets -> handler falls back to rectanglePolygon(L,W). This is
    // NOT a downgrade: buildPolyWalls punches openings, buildBoxWalls does not.
    check('no facets traces to null', buildFootprintFromFacets([], {}) === null);
    const rect = rectanglePolygon(68, 95);
    check('rectangle fallback is a real 4-corner polygon',
      Array.isArray(rect) && rect.length === 4, `got ${rect && rect.length}`);
    check('rectangle fallback perimeter is correct',
      Math.abs(polygonPerimeterFt(rect) - 2 * (68 + 95)) < 0.5,
      `got ${polygonPerimeterFt(rect)}`);
    check('rectangle fallback area is correct',
      Math.abs(polygonAreaFt2(rect) - 68 * 95) < 1);
  }

  console.log('\n\u2500\u2500 5. Garbage facets fail closed (sanity gate) \u2500\u2500');
  {
    // The handler gates the trace on 0.35..1.15 of the measured bbox. Verify a
    // wildly undersized trace would be caught by that band rather than shipped.
    const segs = [seg(LAT, LNG, 2 * FT_LAT, 2 * FT_LNG, 180, 25, 4)];
    const facets = buildRoofFacetsFromSolarSegments(segs);
    const fp = buildFootprintFromFacets(facets, { overhangFt: DEFAULT_EAVE_OVERHANG_FT });
    const bboxSqFt = 68 * 95; // what the rest of the handler measured
    const wouldAccept = !!fp && fp.area_sqft >= bboxSqFt * 0.35 && fp.area_sqft <= bboxSqFt * 1.15;
    check('a tiny bogus trace is rejected against a large measured bbox', !wouldAccept,
      fp ? `traced ${fp.area_sqft} vs bbox ${bboxSqFt}` : 'trace was null (also fine)');
  }

  console.log('\n\u2500\u2500 6. Live photo-handler wiring: no null polygon, no pricing writes \u2500\u2500');
  {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
    const start = src.indexOf('async analyzeSidingMeasurement(');
    check('analyzeSidingMeasurement handler found', start > 0);
    // Bound the slice to this handler so we do not read the photo handler.
    const body = src.slice(start, start + 20000);
    // Strip comments first — the fix itself documents the old broken behaviour
    // by quoting it, and that prose must not count as an emission.
    const code = body.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    check('handler no longer emits a null footprint polygon',
      !/footprint_polygon_xy:\s*null/.test(code));
    check('handler emits the traced polygon',
      /footprint_polygon_xy:\s*footprintPolygonXY/.test(body));
    check('handler reports footprint_geometry so rectangle vs traced is visible',
      /footprint_geometry:\s*footprintGeometry/.test(body));
    // The money invariant: perimeterFt is a const computed before the trace and
    // must never be reassigned from footprint geometry.
    check('perimeterFt stays a const (cannot be moved by the trace)',
      /const perimeterFt = osmUsed \? osmPerimeterFt : solarPerimeterFt;/.test(body));
    const traceBlock = body.slice(body.indexOf('True footprint outline'), body.indexOf('Detect roof type'));
    check('trace block never assigns perimeterFt',
      traceBlock.length > 0 && !/(^|[^.\w])perimeterFt\s*=[^=]/.test(traceBlock));
    check('trace block never assigns buildingLengthFt/buildingWidthFt',
      !/building(Length|Width)Ft\s*=[^=]/.test(traceBlock));

    const photoStart = src.indexOf('async analyzeHousePhotosForSiding(');
    const photoBody = src.slice(photoStart, photoStart + 150000);
    check('live photo handler found', photoStart > 0);
    check('live photo handler falls back to a rectangle instead of null',
      /if \(!Array\.isArray\(footprintPolygonXY\)[\s\S]*?footprintPolygonXY = rectanglePolygon\(buildingLengthFt, buildingWidthFt\)/.test(photoBody));
    check('live photo handler emits its resolved polygon',
      /footprint_polygon_xy:\s*footprintPolygonXY/.test(photoBody));
    check('live photo handler distinguishes traced Solar geometry from rectangle fallback',
      /candGeometry = 'traced_polygon'/.test(photoBody)
      && /footprint_geometry:\s*footprintGeometry/.test(photoBody));
  }

  console.log('\n\u2500\u2500 7. Live production handler cannot emit a null footprint \u2500\u2500');
  {
    const fs = require('fs');
    const live = fs.readFileSync(
      require('path').join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
    check('live handler builds a rectangle for missing footprints',
      /if \(!Array\.isArray\(footprintPolygonXY\)[\s\S]*?footprintPolygonXY = rectanglePolygon\(buildingLengthFt, buildingWidthFt\)/.test(live));
    check('live handler emits the resolved non-null polygon',
      /footprint_polygon_xy:\s*footprintPolygonXY/.test(live));
  }

  console.log('\n\u2500\u2500 8. 3D viewer routes polygons through punched wall geometry \u2500\u2500');
  {
    const fs = require('fs');
    const viewer = fs.readFileSync(
      require('path').join(__dirname, '..', 'src', 'components', 'estimator', 'HouseModel3D.jsx'), 'utf8');
    check('polygon path assigns openings to real edges',
      /const edgeBuckets=polyXZ[\s\S]*?\? assignOpeningsToEdges\(polyXZ,gableOpeningPartition\.wall\)/.test(viewer));
    check('polygon path uses buildPolyWalls while only missing polygons use buildBoxWalls',
      /if\(polyXZ\)\{\s*buildPolyWalls\([\s\S]*?\}\s*else\s*\{\s*buildBoxWalls\(/.test(viewer));
  }

  console.log(`\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(`${passed + failures} checks — ${passed} passed, ${failures} failed`);
  if (failures > 0) { console.log('\u274c FAILED'); process.exit(1); }
  console.log('\u2705 Satellite footprint polygon verified');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
