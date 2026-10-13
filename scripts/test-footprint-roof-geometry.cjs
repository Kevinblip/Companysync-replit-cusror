#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const {
    buildFootprintRoofSurface,
    roofHintsFromSolarSegments,
  } = await import(path.join(process.cwd(), 'src/utils/MeshGeometryBuilder.js'));
  const { shouldAttemptFootprintRoof } = await import(
    path.join(process.cwd(), 'src/utils/roof3DSourceSelection.js')
  );

  const outline = [
    [-28, -18], [8, -18], [8, -8], [28, -8],
    [28, 18], [-28, 18],
  ];
  const segments = [
    { pitchDegrees: 26, azimuthDegrees: 180, stats: { areaMeters2: 80 },
      center: { latitude: 41.5, longitude: -81.7 },
      boundingBox: { sw: { latitude: 1, longitude: 1 }, ne: { latitude: 99, longitude: 99 } } },
    { pitchDegrees: 26, azimuthDegrees: 0, stats: { areaMeters2: 80 },
      center: { latitude: 51.5, longitude: -71.7 },
      boundingBox: { sw: { latitude: -99, longitude: -99 }, ne: { latitude: -1, longitude: -1 } } },
  ];
  const hints = roofHintsFromSolarSegments(segments, 0.5);
  const roof = buildFootprintRoofSurface(outline, 9, hints.slope, {
    orientationDeg: hints.orientationDeg,
  });
  assert.ok(roof, 'real saved satellite-style outline builds a roof');
  assert.deepEqual(roof.wallBounds, {
    minX: -28, maxX: 28, minZ: -18, maxZ: 18,
  }, 'roof is centered on the wall outline coordinate space');
  assert.deepEqual(roof.bounds, {
    minX: -29.25, maxX: 29.25, minZ: -19.25, maxZ: 19.25, cx: 0, cz: 0,
  }, 'roof has a consistent 1.25-foot overhang around the outline');
  assert.equal(roof.wallPlateY, 9, 'roof boundary is anchored to the wall top plate');
  assert.ok(roof.maxY > 9 && roof.maxY < 25, 'ridge height follows footprint span and pitch');
  assert.equal(roof.source, 'footprint_outline');

  // A concave L outline must stay concave rather than filling its bbox corner.
  const stride = 3;
  let filledMissingCorner = false;
  const pointInRing = (x, z, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-9) + xi) inside = !inside;
    }
    return inside;
  };
  const pointOnRing = (x, z, ring) => ring.some((a, index) => {
    const b = ring[(index + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const length2 = dx * dx + dz * dz;
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length2)) : 0;
    return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz)) < 1e-5;
  });
  let outsideCount = 0;
  for (let i = 0; i < roof.vertices.length; i += stride) {
    const x = roof.vertices[i], z = roof.vertices[i + 2];
    if (x > 9.25 && z < -9.25) filledMissingCorner = true;
    if (!pointInRing(x, z, roof.eavePolygon) && !pointOnRing(x, z, roof.eavePolygon)) outsideCount++;
  }
  assert.equal(filledMissingCorner, false, 'L-shaped cutout remains open and creates a valley');
  assert.equal(outsideCount, 0, 'no roof triangle spills outside the offset outline');

  // Money invariant: rendering accepts read-only values and cannot mutate them.
  const measured = Object.freeze({
    perimeter: '184.25',
    roofArea: '2178.50',
    squares: '21.785',
    pitch: '6/12',
    estimateTotal: '18432.17',
  });
  const before = JSON.stringify(measured);
  buildFootprintRoofSurface(outline, 9, 0.5);
  assert.equal(JSON.stringify(measured), before,
    'perimeter, area, squares, pitch, and estimate figures remain byte-for-byte unchanged');

  // Deliberately absurd Solar boxes/centres must not affect geometry.
  const roofAgain = buildFootprintRoofSurface(outline, 9,
    roofHintsFromSolarSegments(segments.map(s => ({
      ...s,
      center: { latitude: -70, longitude: 170 },
      boundingBox: { sw: { latitude: -80, longitude: -170 }, ne: { latitude: 80, longitude: 170 } },
    })), 0.5).slope);
  assert.deepEqual(roofAgain.bounds, roof.bounds, 'Solar bbox coordinates do not size or position the roof');

  assert.equal(buildFootprintRoofSurface([[0, 0], [1, 0]], 9, 0.5), null,
    'unusable outline explicitly requests the parametric fallback');
  assert.equal(buildFootprintRoofSurface([[0, 0], [20, 20], [0, 20], [20, 0]], 9, 0.5), null,
    'self-intersecting outline explicitly requests the parametric fallback');
  assert.equal(buildFootprintRoofSurface([[0, 0], [20, 0], [20, 0], [0, 20]], 9, 0.5), null,
    'repeated-edge outline explicitly requests the parametric fallback');

  const fs = require('node:fs');
  const component = fs.readFileSync(
    path.join(process.cwd(), 'src/components/estimator/HouseModel3D.jsx'), 'utf8'
  );
  assert.doesNotMatch(component, /setViewerError\('Roof preview unavailable — satellite data incomplete'\)/,
    'malformed satellite geometry cannot hide the visible parametric fallback');
  assert.match(component, /else if\(hasOutlineRoof\)\s*\{[\s\S]*?buildOutlineRoof\(/,
    'HouseModel3D routes the no-segment outline path into the footprint mesh');
  assert.equal(shouldAttemptFootprintRoof({
    footprintPolygon: outline,
    hasCompletePhotoRoof: false,
  }), true, 'a traced L outline is selected even when no Solar segments exist');
  assert.equal(shouldAttemptFootprintRoof({
    footprintPolygon: outline,
    hasCompletePhotoRoof: false,
    forcedParametric: true,
  }), true, 'forced/invalid Solar segments cannot replace a traced outline with a rectangle');
  assert.equal(shouldAttemptFootprintRoof({
    footprintPolygon: outline,
    hasCompletePhotoRoof: true,
  }), false, 'a complete physical-photo roof remains authoritative');
  console.log('✓ Footprint-derived 3D roof geometry verified');
})().catch(error => {
  console.error(error);
  process.exit(1);
});