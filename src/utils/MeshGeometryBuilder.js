/**
 * MeshGeometryBuilder — Parametric roof / wall topology engine
 *
 * Replaces raw Solar-API DSM surface draping with:
 *   • Footprint primitive classification (Rectangle / L-Shape / T-Shape)
 *   • Micro-facet stripping (< 15% total area OR < 5 LF ridge segment)
 *   • Pairwise ridge-height enforcement for connected gable planes
 *   • Wall-plate snapping (eave h = 0 so no air gap)
 *   • Watertight parametric gable & hip geometry (vertices shared at ridge/eave)
 *   • Solar-segment pre-filter (drops tiny segments before bbox decomposition)
 *
 * All geometry is described as raw vertex arrays / metadata; the caller
 * (HouseModel3D) owns Three.js object creation and disposal.
 *
 * Coordinate convention (Three.js):
 *   X = east  (+X = right)
 *   Y = up    (Y = 0 is ground, Y = wallH is wall top-plate)
 *   Z = south (+Z = toward viewer)
 */

// ─── Footprint classification ─────────────────────────────────────────────────

/**
 * Classify a polygon footprint into a geometric primitive.
 * polyXZ = [[x, z], …] in Three.js world space.
 *
 * Returns:
 *   { type: 'rectangle'|'l-shape'|'t-shape', L, W, aspectRatio, fillRatio,
 *     isSquare, bboxW, bboxD, area }
 *
 * Logic:
 *   fillRatio = polygon area / bounding-box area
 *     ≥ 0.88 → rectangle
 *     0.60–0.88 → l-shape
 *     < 0.60 → t-shape / complex
 */
export function classifyFootprint(polyXZ) {
  if (!polyXZ || polyXZ.length < 3) {
    return { type: 'rectangle', L: 30, W: 24, aspectRatio: 1.25, fillRatio: 1, isSquare: false, bboxW: 30, bboxD: 24, area: 720 };
  }

  const xs = polyXZ.map(([x]) => x);
  const zs = polyXZ.map(([, z]) => z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const bboxW = maxX - minX;
  const bboxD = maxZ - minZ;
  const L = Math.max(bboxW, bboxD);
  const W = Math.min(bboxW, bboxD);
  const aspectRatio = L / Math.max(W, 1);

  // Shoelace area
  let area = 0;
  const n = polyXZ.length;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = polyXZ[i];
    const [x2, z2] = polyXZ[(i + 1) % n];
    area += x1 * z2 - x2 * z1;
  }
  area = Math.abs(area) / 2;

  const bboxArea = Math.max(bboxW * bboxD, 1);
  const fillRatio = area / bboxArea;
  const isSquare = aspectRatio <= 1.25 && fillRatio >= 0.90;

  let type = 'rectangle';
  if (fillRatio < 0.88) type = fillRatio >= 0.60 ? 'l-shape' : 't-shape';

  return { type, L, W, bboxW, bboxD, aspectRatio, fillRatio, isSquare, area };
}

// ─── Micro-facet filter ───────────────────────────────────────────────────────

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function facetEdges(facet) {
  return Array.isArray(facet?.edges)
    ? facet.edges.filter(edge => edge && typeof edge === 'object')
    : [];
}

function isValidFacet(facet) {
  if (!facet || typeof facet !== 'object' || !Array.isArray(facet.polygon) || facet.polygon.length < 3
    || !Array.isArray(facet.edges) || facetEdges(facet).length !== facet.edges.length) {
    return false;
  }
  return facet.polygon.every(point =>
    point && typeof point === 'object'
    && isFiniteNumber(point.x)
    && isFiniteNumber(point.y)
  );
}

/**
 * Remove facets that are too small to represent real roof planes.
 *
 * Dropping rules (both must be true to drop):
 *   1. facet.area_sqft < totalArea * areaThresholdPct   (default 15%)
 *   2. No ridge edge with length_ft >= ridgeMinLf        (default 5 ft)
 *
 * Dropped facets are projected into the dominant parent plane by simply
 * omitting them; the dominant plane already covers that area.
 */
export function filterMicroFacets(roofFacets, { areaThresholdPct = 0.15, ridgeMinLf = 5 } = {}) {
  if (!Array.isArray(roofFacets)) return [];

  // Solar-derived facet data is external input. Filter malformed entries before
  // reading area/edges so one null facet cannot abort the whole viewer.
  const validFacets = roofFacets
    .filter(isValidFacet)
    .map(facet => ({ ...facet, edges: facetEdges(facet) }));
  if (validFacets.length <= 1) return validFacets;

  const totalArea = validFacets.reduce((s, f) => s + (Number(f.area_sqft) || 0), 0);
  if (totalArea === 0) return validFacets;

  const areaThreshold = totalArea * areaThresholdPct;

  const kept = validFacets.filter(f => {
    const area = Number(f.area_sqft) || 0;
    if (area >= areaThreshold) return true;   // large enough → keep

    // Small facet: keep only when it has a meaningful ridge contribution
    const ridgeEdge = facetEdges(f).find(edge => edge.type === 'ridge');
    return ridgeEdge && (Number(ridgeEdge.length_ft) || 0) >= ridgeMinLf;
  });

  // Always keep at least 1 facet
  return kept.length > 0 ? kept : [validFacets[0]];
}

// ─── Unified ridge enforcement ────────────────────────────────────────────────

/**
 * For each connected gable-plane pair, enforce one continuous ridge:
 *   • Ridge vertices shared by that pair are snapped to the pair's max height.
 *   • Independent ridges on wings/dormers keep their own peak heights.
 *
 * This collapses fragmented shared ridges without stretching a complex roof.
 */
export function enforceUnifiedRidge(roofFacets) {
  if (!Array.isArray(roofFacets)) return [];
  const facets = roofFacets
    .filter(facet => facet && typeof facet === 'object')
    .map(facet => ({ ...facet, edges: facetEdges(facet) }));
  if (facets.length < 2) return facets;

  // Unify only ridge edges that are explicitly shared by the same facet pair.
  // A complex roof can have several independent ridges at different heights;
  // snapping all of them to the global maximum turns low wings into spikes.
  const pairMaxHeights = new Map();
  for (const f of facets) {
    for (const e of facetEdges(f)) {
      if (e.type !== 'ridge' || !e.shared_with) continue;
      const key = [f.id, e.shared_with].sort().join('|');
      const heights = [pairMaxHeights.get(key), Number(e.h1), Number(e.h2)]
        .filter(Number.isFinite);
      if (heights.length > 0) pairMaxHeights.set(key, Math.max(...heights));
    }
  }
  if (pairMaxHeights.size === 0) return facets;

  return facets.map(f => {
    const ridgeEdges = facetEdges(f).filter(e => e.type === 'ridge' && e.shared_with);
    if (ridgeEdges.length === 0) return f;

    // A facet may meet more than one roof section. Track the target per vertex
    // instead of applying one height to the whole facet.
    const ridgeVerts = new Map();
    for (const e of ridgeEdges) {
      const key = [f.id, e.shared_with].sort().join('|');
      const target = pairMaxHeights.get(key);
      ridgeVerts.set(`${Math.round(e.x1 * 10)},${Math.round(e.y1 * 10)}`, target);
      ridgeVerts.set(`${Math.round(e.x2 * 10)},${Math.round(e.y2 * 10)}`, target);
    }

    const newPolygon = (Array.isArray(f.polygon) ? f.polygon : []).map(p => {
      if (!p || typeof p !== 'object') return p;
      const key = `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
      return ridgeVerts.has(key) ? { ...p, h: ridgeVerts.get(key) } : p;
    });

    const newEdges = facetEdges(f).map(e => {
      if (e.type !== 'ridge' || !e.shared_with) return e;
      const key = [f.id, e.shared_with].sort().join('|');
      const target = pairMaxHeights.get(key);
      return { ...e, h1: target, h2: target };
    });

    return { ...f, polygon: newPolygon, edges: newEdges };
  });
}

// ─── Wall-plate snapping ──────────────────────────────────────────────────────

/**
 * Snap each facet's eave vertices to its intended local wall plate.
 *
 * In the canonical graph, h is the height above the wall plate (0 = plate,
 * positive = above). If a facet's minimum h is > 0.3 ft, the entire facet
 * has been lifted above the plate (Solar bbox approximation drift). We shift
 * all h-values down so the eave sits exactly on the plate.
 *
 * Threshold: only correct facets whose min-h exceeds 0.3 ft (noise tolerance).
 */
export function snapEavesToWallPlate(roofFacets, { driftTolerance = 0.3 } = {}) {
  if (!Array.isArray(roofFacets)) return [];

  return roofFacets
    .filter(facet => facet && typeof facet === 'object')
    .map(f => {
    const polygon = Array.isArray(f.polygon)
      ? f.polygon.filter(point => point && typeof point === 'object')
      : [];
    const edges = facetEdges(f);
    const hs = polygon.map(p => Number(p.h) || 0);
    if (hs.length === 0) return { ...f, polygon, edges };
    const minH = Math.min(...hs);
    const intendedPlate = Number(f.elevation_offset_ft) || 0;
    if (Math.abs(minH - intendedPlate) <= driftTolerance) {
      const correction = minH - intendedPlate;
      if (Math.abs(correction) < 0.001) return { ...f, polygon, edges };
      return {
        ...f,
        polygon: polygon.map(p => ({ ...p, h: (Number(p.h) || 0) - correction })),
        edges: edges.map(e => ({
          ...e,
          h1: (Number(e.h1) || 0) - correction,
          h2: (Number(e.h2) || 0) - correction,
        })),
      };
    }

    const shift = minH - intendedPlate;
    return {
      ...f,
      polygon: polygon.map(p => ({ ...p, h: (Number(p.h) || 0) - shift })),
      edges: edges.map(e => ({
        ...e,
        h1: (Number(e.h1) || 0) - shift,
        h2: (Number(e.h2) || 0) - shift,
      })),
    };
  });
}

// ─── Parametric gable geometry ────────────────────────────────────────────────

/**
 * Build watertight bilateral gable roof geometry.
 *
 * Returns typed arrays for each face + structural edge data.
 * All vertex positions are in Three.js world space centered at origin.
 *
 * @param {number} L        Building length (longer axis, along X)
 * @param {number} W        Building width  (shorter axis, along Z)
 * @param {number} wallH    Wall plate height (Y)
 * @param {number} slope    Pitch slope (rise/run, e.g. 6/12 → 0.5)
 * @param {number} ov       Eave overhang in feet (default 1.0)
 *
 * @returns {{
 *   southFace:  { verts: Float32Array, uvs: Float32Array },
 *   northFace:  { verts: Float32Array, uvs: Float32Array },
 *   westGable:  { verts: Float32Array },
 *   eastGable:  { verts: Float32Array },
 *   ridge:      { from: [x,y,z], to: [x,y,z] },
 *   eaveEdges:  Array<{ from, to }>,
 *   rakeEdges:  Array<{ from, to }>,
 *   rise:       number,
 *   ridgeY:     number,
 * }}
 */
export function buildParametricGable(L, W, wallH, slope, ov = 1.0) {
  const hw    = W / 2;
  const hl    = L / 2;
  const hwo   = hw + ov;    // half-width + overhang (eave edge Z)
  const hlo   = hl + ov;    // half-length + overhang (rake edge X)
  const rise  = hw * slope;
  const ridgeY = wallH + rise;

  // ── South face ────────────────────────────────────────────────────────────
  // Eave runs along Z = -hwo from X=-hlo to X=hlo (four corners → 2 triangles)
  //  v0 = SW-eave  (-hlo, wallH, -hwo)
  //  v1 = SE-eave  ( hlo, wallH, -hwo)
  //  v2 = E-ridge  ( hlo, ridgeY,   0)
  //  v3 = W-ridge  (-hlo, ridgeY,   0)
  const southVerts = new Float32Array([
    -hlo, wallH,  -hwo,   hlo, wallH,  -hwo,   hlo, ridgeY, 0,
    -hlo, wallH,  -hwo,   hlo, ridgeY,    0,  -hlo, ridgeY, 0,
  ]);
  // UV: u = normalized X, v = normalized slope height
  const sW = hlo * 2, sH = Math.hypot(hwo, rise);
  const southUVs = new Float32Array([
    0, 0,   1, 0,   1, 1,
    0, 0,   1, 1,   0, 1,
  ]);

  // ── North face ────────────────────────────────────────────────────────────
  const northVerts = new Float32Array([
    -hlo, wallH,  hwo,   -hlo, ridgeY,   0,   hlo, ridgeY, 0,
    -hlo, wallH,  hwo,    hlo, ridgeY,   0,   hlo, wallH, hwo,
  ]);
  const northUVs = new Float32Array([
    0, 0,   0, 1,   1, 1,
    0, 0,   1, 1,   1, 0,
  ]);

  // ── West gable triangle (flush with wall at X = -hl) ─────────────────────
  // Structural gable at X=-hl; rake overhang is handled by the roof face edge
  const westGable = new Float32Array([
    -hlo, wallH,  -hwo,   -hlo, wallH,   hwo,   -hlo, ridgeY, 0,
  ]);

  // ── East gable triangle (flush with wall at X = +hl) ─────────────────────
  const eastGable = new Float32Array([
    hlo, wallH,  -hwo,    hlo, ridgeY,    0,    hlo, wallH,  hwo,
  ]);

  // ── Structural edges ──────────────────────────────────────────────────────
  const ridge    = { from: [-hlo, ridgeY, 0], to: [hlo, ridgeY, 0] };
  const eaveEdges = [
    { from: [-hlo, wallH, -hwo], to: [hlo, wallH, -hwo] },  // south eave
    { from: [-hlo, wallH,  hwo], to: [hlo, wallH,  hwo] },  // north eave
  ];
  const rakeEdges = [
    { from: [-hlo, wallH, -hwo], to: [-hlo, ridgeY, 0] },   // west rake SW
    { from: [-hlo, ridgeY, 0],   to: [-hlo, wallH,  hwo] }, // west rake NW
    { from: [hlo, wallH, -hwo],  to: [hlo, ridgeY,  0] },   // east rake SE
    { from: [hlo, ridgeY, 0],    to: [hlo, wallH,  hwo] },  // east rake NE
  ];

  return {
    southFace: { verts: southVerts, uvs: southUVs },
    northFace: { verts: northVerts, uvs: northUVs },
    westGable, eastGable,
    ridge, eaveEdges, rakeEdges,
    rise, ridgeY,
    spanL: hlo * 2,
    spanW: hwo * 2,
  };
}

// ─── Parametric hip geometry ──────────────────────────────────────────────────

/**
 * Build watertight four-hip roof geometry.
 * Ridge runs along X-axis from (-ridgeHL, ridgeY, 0) to (ridgeHL, ridgeY, 0).
 * Degenerates to pyramid when L ≤ W (ridgeHL = 0).
 */
export function buildParametricHip(L, W, wallH, slope, ov = 1.0) {
  const hw      = W / 2;
  const hl      = L / 2;
  const hwo     = hw + ov;
  const hlo     = hl + ov;
  const rise    = hw * slope;
  const ridgeY  = wallH + rise;
  const ridgeHL = Math.max(0.01, hl - hw);   // half ridge length

  // ── South trapezoid ───────────────────────────────────────────────────────
  const southVerts = new Float32Array([
    -hlo, wallH, -hwo,    hlo, wallH, -hwo,   ridgeHL, ridgeY,  0,
    -hlo, wallH, -hwo,  ridgeHL, ridgeY, 0,  -ridgeHL, ridgeY,  0,
  ]);

  // ── North trapezoid ───────────────────────────────────────────────────────
  const northVerts = new Float32Array([
    -hlo, wallH,  hwo,  -ridgeHL, ridgeY,  0,  ridgeHL, ridgeY, 0,
    -hlo, wallH,  hwo,   ridgeHL, ridgeY,  0,      hlo, wallH,  hwo,
  ]);

  // ── West hip triangle ─────────────────────────────────────────────────────
  const westVerts = new Float32Array([
    -hlo, wallH, -hwo,   -ridgeHL, ridgeY,  0,  -hlo, wallH,  hwo,
  ]);

  // ── East hip triangle ─────────────────────────────────────────────────────
  const eastVerts = new Float32Array([
    hlo, wallH, -hwo,    hlo, wallH,  hwo,   ridgeHL, ridgeY, 0,
  ]);

  const ridge = { from: [-ridgeHL, ridgeY, 0], to: [ridgeHL, ridgeY, 0] };
  const hipLines = [
    { from: [-hlo, wallH, -hwo], to: [-ridgeHL, ridgeY, 0] },
    { from: [ hlo, wallH, -hwo], to: [ ridgeHL, ridgeY, 0] },
    { from: [-hlo, wallH,  hwo], to: [-ridgeHL, ridgeY, 0] },
    { from: [ hlo, wallH,  hwo], to: [ ridgeHL, ridgeY, 0] },
  ];
  const eaveEdges = [
    { from: [-hlo, wallH, -hwo], to: [ hlo, wallH, -hwo] },
    { from: [-hlo, wallH,  hwo], to: [ hlo, wallH,  hwo] },
    { from: [-hlo, wallH, -hwo], to: [-hlo, wallH,  hwo] },
    { from: [ hlo, wallH, -hwo], to: [ hlo, wallH,  hwo] },
  ];

  return {
    southVerts, northVerts, westVerts, eastVerts,
    ridge, hipLines, eaveEdges,
    rise, ridgeY, ridgeHL,
    spanL: hlo * 2,
    spanW: hwo * 2,
  };
}

// ─── Footprint-derived roof geometry ─────────────────────────────────────────

function pointInPolygonXZ(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z)
      && x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length2 = dx * dx + dz * dz;
  const t = length2 > 0
    ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length2))
    : 0;
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
}

function distanceToPolygonEdge(x, z, polygon) {
  let distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    distance = Math.min(distance, distanceToSegment(x, z, polygon[i], polygon[(i + 1) % polygon.length]));
  }
  return distance;
}

function signedPolygonArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function lineIntersection(a, av, b, bv) {
  const det = av[0] * bv[1] - av[1] * bv[0];
  if (Math.abs(det) < 1e-8) return null;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = (dx * bv[1] - dz * bv[0]) / det;
  return [a[0] + av[0] * t, a[1] + av[1] * t];
}

function offsetPolygon(poly, distance) {
  if (!(distance > 0)) return poly.map(point => point.slice());
  const ccw = signedPolygonArea(poly) > 0;
  const lines = poly.map((point, index) => {
    const next = poly[(index + 1) % poly.length];
    const dx = next[0] - point[0], dz = next[1] - point[1];
    const length = Math.hypot(dx, dz) || 1;
    const outward = ccw ? [dz / length, -dx / length] : [-dz / length, dx / length];
    return {
      point: [point[0] + outward[0] * distance, point[1] + outward[1] * distance],
      direction: [dx, dz],
    };
  });
  const result = [];
  for (let i = 0; i < poly.length; i++) {
    const previous = lines[(i - 1 + lines.length) % lines.length];
    const current = lines[i];
    const joined = lineIntersection(
      previous.point, previous.direction, current.point, current.direction
    );
    // Cap extreme mitres on noisy acute corners.
    if (!joined || Math.hypot(joined[0] - poly[i][0], joined[1] - poly[i][1]) > distance * 6) {
      result.push(current.point);
    } else {
      result.push(joined);
    }
  }
  return result;
}

function clipAgainst(poly, axis, boundary, keepGreater) {
  const result = [];
  const inside = point => keepGreater ? point[axis] >= boundary - 1e-8 : point[axis] <= boundary + 1e-8;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const inA = inside(a), inB = inside(b);
    if (inA) result.push(a);
    if (inA !== inB) {
      const denominator = b[axis] - a[axis];
      const t = Math.abs(denominator) < 1e-9 ? 0 : (boundary - a[axis]) / denominator;
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}

function clipPolygonToCell(poly, minX, maxX, minZ, maxZ) {
  let clipped = clipAgainst(poly, 0, minX, true);
  if (clipped.length >= 3) clipped = clipAgainst(clipped, 0, maxX, false);
  if (clipped.length >= 3) clipped = clipAgainst(clipped, 1, minZ, true);
  if (clipped.length >= 3) clipped = clipAgainst(clipped, 1, maxZ, false);
  return clipped;
}

function triangulateSimplePolygon(poly) {
  if (poly.length === 3) return [[poly[0], poly[1], poly[2]]];
  const points = signedPolygonArea(poly) > 0 ? poly.slice() : poly.slice().reverse();
  const indices = points.map((_, index) => index);
  const triangles = [];
  const cross = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTriangle = (p, a, b, c) =>
    cross(a, b, p) >= -1e-8 && cross(b, c, p) >= -1e-8 && cross(c, a, p) >= -1e-8;
  let guard = points.length * points.length;
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const ia = indices[(i - 1 + indices.length) % indices.length];
      const ib = indices[i];
      const ic = indices[(i + 1) % indices.length];
      if (cross(points[ia], points[ib], points[ic]) <= 1e-8) continue;
      if (indices.some(index => index !== ia && index !== ib && index !== ic
        && inTriangle(points[index], points[ia], points[ib], points[ic]))) continue;
      triangles.push([points[ia], points[ib], points[ic]]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) triangles.push(indices.map(index => points[index]));
  return triangles;
}

function cleanFootprint(polyXZ) {
  const points = (Array.isArray(polyXZ) ? polyXZ : [])
    .map(point => [Number(point?.[0]), Number(point?.[1])])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
  if (points.length > 1 && Math.hypot(
    points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]
  ) < 0.01) points.pop();
  if (points.length < 3) return null;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) return null;
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(twiceArea) <= 2) return null;
  const orient = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const intersects = (a, b, c, d) => {
    const abC = orient(a, b, c), abD = orient(a, b, d);
    const cdA = orient(c, d, a), cdB = orient(c, d, b);
    return abC * abD < -1e-8 && cdA * cdB < -1e-8;
  };
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j++) {
      if (j === i || j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if (intersects(a, b, c, d)) return null;
    }
  }
  return points;
}

/**
 * Build a coherent hip/valley surface directly over the wall footprint.
 *
 * Height is the shortest plan distance to an exterior edge multiplied by the
 * measured pitch. This is the hip-roof "wavefront" construction: convex
 * corners form hips, concave corners form valleys, and opposing wavefronts form
 * ridges. Unlike Solar segment boxes, every vertex is in the wall coordinate
 * space and the boundary is exactly on the wall plate.
 *
 * Rendering only: this function receives no measured area/perimeter values and
 * returns no replacement quantities.
 */
export function buildFootprintRoofSurface(polyXZ, wallH, slope, {
  cellFt = 1.25,
  orientationDeg = 0,
  overhangFt = 1.25,
} = {}) {
  const wallPolygon = cleanFootprint(polyXZ);
  const pitch = Number(slope);
  const plate = Number(wallH);
  if (!wallPolygon || !(pitch >= 0) || !Number.isFinite(plate)) return null;
  const polygon = cleanFootprint(offsetPolygon(wallPolygon, Number(overhangFt) || 0));
  if (!polygon) return null;

  const xs = polygon.map(p => p[0]), zs = polygon.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  if (maxX - minX < 3 || maxZ - minZ < 3) return null;

  const step = Math.max(0.5, Math.min(2, Number(cellFt) || 1.25));
  const nx = Math.ceil((maxX - minX) / step);
  const nz = Math.ceil((maxZ - minZ) / step);
  if (nx * nz > 250000) return null;

  const vertices = [];
  const vertex = ([x, z]) => {
    const height = distanceToPolygonEdge(x, z, polygon) * pitch;
    return [x, plate + height, z];
  };
  const addTriangle = (a, b, c) => vertices.push(...a, ...b, ...c);

  for (let iz = 0; iz < nz; iz++) {
    const z0 = minZ + iz * step, z1 = Math.min(maxZ, z0 + step);
    for (let ix = 0; ix < nx; ix++) {
      const x0 = minX + ix * step, x1 = Math.min(maxX, x0 + step);
      const clipped = clipPolygonToCell(polygon, x0, x1, z0, z1);
      for (const triangle of triangulateSimplePolygon(clipped)) {
        addTriangle(vertex(triangle[0]), vertex(triangle[1]), vertex(triangle[2]));
      }
    }
  }
  if (vertices.length < 18) return null;

  return {
    vertices: new Float32Array(vertices),
    bounds: { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 },
    wallBounds: {
      minX: Math.min(...wallPolygon.map(p => p[0])),
      maxX: Math.max(...wallPolygon.map(p => p[0])),
      minZ: Math.min(...wallPolygon.map(p => p[1])),
      maxZ: Math.max(...wallPolygon.map(p => p[1])),
    },
    eavePolygon: polygon,
    wallPlateY: plate,
    maxY: vertices.reduce((m, value, index) => index % 3 === 1 ? Math.max(m, value) : m, plate),
    source: 'footprint_outline',
    orientationDeg: Number(orientationDeg) || 0,
  };
}

/** Area-weighted Solar pitch/orientation hints; never reads segment boxes. */
export function roofHintsFromSolarSegments(segments, fallbackSlope = 0.5) {
  let weight = 0, slopeSum = 0, sin2 = 0, cos2 = 0;
  for (const segment of Array.isArray(segments) ? segments : []) {
    const pitchDeg = Number(segment?.pitchDegrees);
    const azimuthDeg = Number(segment?.azimuthDegrees);
    if (!Number.isFinite(pitchDeg)) continue;
    const w = Math.max(1, Number(segment?.stats?.areaMeters2) || 1);
    const ridgeOrientation = (Number.isFinite(azimuthDeg) ? azimuthDeg + 90 : 0) * Math.PI / 180;
    weight += w;
    slopeSum += Math.tan(Math.max(0, pitchDeg) * Math.PI / 180) * w;
    sin2 += Math.sin(2 * ridgeOrientation) * w;
    cos2 += Math.cos(2 * ridgeOrientation) * w;
  }
  return {
    slope: weight > 0 ? slopeSum / weight : fallbackSlope,
    orientationDeg: weight > 0 ? Math.atan2(sin2, cos2) * 90 / Math.PI : 0,
  };
}

// ─── Solar segment pre-filter ─────────────────────────────────────────────────

/**
 * Pre-process Solar API roofSegmentStats before bbox decomposition:
 *   1. Drop segments below areaThresholdPct of total area (default 10%)
 *   2. For simple rectangular footprints, cap segment count at maxForRect
 *      (default 4) — prefer the parametric generic fallback for simple boxes
 *      that return 8+ noisy Solar facets.
 *
 * @returns {{ segments: roofSegments, forcedParametric: boolean }}
 *   forcedParametric = true means the caller should skip Solar segments
 *   entirely and use buildParametricGable / buildParametricHip instead.
 */
export function preprocessSolarSegments(roofSegments, footprintClass, {
  areaThresholdPct = 0.10,
  maxFacetsForRect = 5,
} = {}) {
  if (!Array.isArray(roofSegments) || roofSegments.length === 0) {
    return { segments: [], forcedParametric: false };
  }

  // Validate the complete shape before touching nested fields. Solar can
  // return null entries, partial bounding boxes, or non-numeric coordinates
  // when imagery coverage is incomplete. Missing pitch/azimuth are recoverable
  // (the renderer supplies defaults), but the geometry and area are not.
  const validSegments = roofSegments.filter(seg => {
    if (!seg || typeof seg !== 'object') return false;
    const bb = seg?.boundingBox;
    const hasBox = bb?.ne && bb?.sw
      && isFiniteNumber(bb.ne.latitude)
      && isFiniteNumber(bb.ne.longitude)
      && isFiniteNumber(bb.sw.latitude)
      && isFiniteNumber(bb.sw.longitude)
      && Math.abs(Number(bb.ne.latitude) - Number(bb.sw.latitude)) > 1e-9
      && Math.abs(Number(bb.ne.longitude) - Number(bb.sw.longitude)) > 1e-9;
    const hasCenter = seg?.center
      && isFiniteNumber(seg.center.latitude)
      && isFiniteNumber(seg.center.longitude);
    const hasArea = seg?.stats && isFiniteNumber(seg.stats.areaMeters2);
    const optionalAnglesValid =
      (seg.pitchDegrees == null || isFiniteNumber(seg.pitchDegrees))
      && (seg.azimuthDegrees == null || isFiniteNumber(seg.azimuthDegrees));
    return Boolean(hasBox && hasCenter && hasArea && optionalAnglesValid);
  });
  if (validSegments.length === 0) {
    return { segments: [], forcedParametric: false };
  }

  const totalAreaM2 = validSegments.reduce((s, seg) => s + (Number(seg.stats.areaMeters2) || 0), 0);
  const areaMin = totalAreaM2 * areaThresholdPct;

  // Filter micro-segments
  const filtered = validSegments.filter(seg => (Number(seg.stats.areaMeters2) || 0) >= areaMin);

  // For a simple rectangle with too many remaining segments, prefer parametric
  const isSimpleRect = footprintClass?.type === 'rectangle' && (footprintClass?.fillRatio ?? 1) >= 0.88;
  const forcedParametric = isSimpleRect && filtered.length > maxFacetsForRect;

  return { segments: filtered, forcedParametric };
}

// ─── Roof type suitability for footprint ────────────────────────────────────

/**
 * Given a footprint classification, return the recommended canonical roof type.
 * Used to restrict simple boxes to gable or hip (no fragmented multi-ridge).
 *
 *   rectangle / square → 'gable' or 'hip' (caller decides by isHip flag)
 *   l-shape  → 'gable' (primary span gable; secondary span handled by poly walls)
 *   t-shape  → 'complex' (pass through to segment/facet path)
 */
export function recommendedRoofType(footprintClass, isHip = false) {
  const { type } = footprintClass || {};
  if (type === 'rectangle') return isHip ? 'hip' : 'gable';
  if (type === 'l-shape')   return 'gable';
  return 'complex';
}
