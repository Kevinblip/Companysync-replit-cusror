/**
 * Interactive report house, computed from the measurement already on the page.
 *
 * buildReportHouseModel is self-contained on purpose: the siding report inlines
 * its source into a standalone HTML document and runs it there. It must not
 * close over imports, module state, or DOM. Nothing here is stored.
 *
 * Walls are the footprint extruded to the eave (stories × wall height). The
 * roof is the straight-skeleton height field of that outline at one pitch:
 * every edge for a hip, only the eave edges for a gable. When measured roof
 * facets already share the footprint's east/north frame and actually cover it,
 * those planes replace the skeleton.
 */

export const WALL_FACE_COLORS = {
  north: '#3b82f6',
  south: '#f97316',
  east: '#22c55e',
  west: '#a855f7',
};

const ROOF_CHARCOAL = [58, 56, 52];

export function ridgeAngleFromSegments(segments) {
  let sin2 = 0;
  let cos2 = 0;
  let weight = 0;
  for (const segment of Array.isArray(segments) ? segments : []) {
    const azimuth = Number(segment?.azimuthDegrees ?? segment?.azimuth_degrees);
    if (!Number.isFinite(azimuth)) continue;
    const ridge = ((azimuth % 180) + 180) % 180 * Math.PI / 180;
    const area = Math.max(1, Number(segment?.area ?? segment?.areaMeters2 ?? segment?.stats?.areaMeters2) || 1);
    sin2 += Math.sin(2 * ridge) * area;
    cos2 += Math.cos(2 * ridge) * area;
    weight += area;
  }
  if (!(weight > 0)) return null;
  return Math.atan2(sin2, cos2) * 90 / Math.PI;
}

export function sanitizeReportFacets(facets) {
  const compact = [];
  for (const facet of Array.isArray(facets) ? facets.slice(0, 40) : []) {
    const raw = facet?.polygon || facet?.outline || null;
    if (!Array.isArray(raw) || raw.length < 3) continue;
    const polygon = [];
    for (const point of raw.slice(0, 16)) {
      const east = Number(Array.isArray(point) ? point[0] : point?.x ?? point?.east);
      const north = Number(Array.isArray(point) ? point[1] : point?.y ?? point?.north);
      const height = Number(Array.isArray(point) ? point[2] : point?.h ?? point?.height ?? 0);
      if (!Number.isFinite(east) || !Number.isFinite(north)) continue;
      polygon.push([east, north, Number.isFinite(height) ? height : 0]);
    }
    if (polygon.length < 3) continue;
    const azimuth = Number(facet?.azimuth_degrees ?? facet?.azimuthDegrees ?? facet?.downslope_azimuth_deg);
    compact.push({
      azimuth: Number.isFinite(azimuth) ? azimuth : null,
      polygon,
    });
  }
  return compact;
}

export function buildReportHouseModel({
  poly,
  H,
  slope,
  isHip = false,
  ridgeAngleDeg = null,
  facets = null,
  overhangFt = 1,
} = {}) {
  const WALL_FACE_COLORS = {
    north: '#3b82f6',
    south: '#f97316',
    east: '#22c55e',
    west: '#a855f7',
  };
  const ROOF_CHARCOAL = [58, 56, 52];
  const wallH = Math.max(Number(H) || 0, 7);
  const pitch = Math.max(Number(slope) || 0, 0);
  const points = clean(poly);
  if (!points) {
    return empty(wallH);
  }

  const walls = blankGroups();
  const roof = blankGroups();
  const gables = blankGroups();
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const face = faceOfEdge(a, b, points);
    pushQuad(walls[face].positions, [a[0], 0, -a[1]], [b[0], 0, -b[1]], [b[0], wallH, -b[1]], [a[0], wallH, -a[1]]);
  }

  const soffit = { color: '#e7e5e4', positions: [] };
  const fascia = { color: '#44403c', positions: [] };
  const overhang = Math.max(0, Number(overhangFt) || 0);
  if (overhang > 0) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const outward = outwardNormal(a, b, points);
      const a2 = [a[0] + outward[0] * overhang, a[1] + outward[1] * overhang];
      const b2 = [b[0] + outward[0] * overhang, b[1] + outward[1] * overhang];
      pushQuad(soffit.positions, [a[0], wallH, -a[1]], [b[0], wallH, -b[1]], [b2[0], wallH, -b2[1]], [a2[0], wallH, -a2[1]]);
      pushQuad(fascia.positions, [a2[0], wallH - 0.55, -a2[1]], [b2[0], wallH - 0.55, -b2[1]], [b2[0], wallH, -b2[1]], [a2[0], wallH, -a2[1]]);
    }
  }

  const measured = roofFromFacets(facets, points, wallH);
  let source = isHip ? 'hip_skeleton' : 'gable_skeleton';
  if (measured) {
    source = 'measured_facets';
    for (const [face, positions] of Object.entries(measured)) {
      roof[face].positions.push(...positions);
    }
  } else {
    const ridge = ridgeDirection(points, ridgeAngleDeg);
    const eaveList = isHip ? allEdges(points) : eaveEdges(points, ridge);
    const samples = roofTriangles(points, wallH, pitch, eaveList);
    for (const triangle of samples) {
      const face = governingFace(triangle.centroid, eaveList, points);
      pushTriangle(roof[face].positions, triangle.verts);
    }
    if (!isHip) {
      const eaveIds = new Set(eaveList.map(edge => edge.index));
      const rakeList = allEdges(points).filter(edge => !eaveIds.has(edge.index));
      for (const edge of rakeList) {
        const face = faceOfEdge(edge.a, edge.b, points);
        const steps = Math.max(1, Math.ceil(edge.len / 2));
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = (s + 1) / steps;
          const p0 = lerp(edge.a, edge.b, t0);
          const p1 = lerp(edge.a, edge.b, t1);
          const y0 = wallH + distanceToEdges(p0[0], p0[1], eaveList) * pitch;
          const y1 = wallH + distanceToEdges(p1[0], p1[1], eaveList) * pitch;
          if (y0 <= wallH + 0.15 && y1 <= wallH + 0.15) continue;
          pushQuad(
            gables[face].positions,
            [p0[0], wallH, -p0[1]],
            [p1[0], wallH, -p1[1]],
            [p1[0], y1, -p1[1]],
            [p0[0], y0, -p0[1]],
          );
        }
      }
    }
  }

  paint(walls);
  paint(roof, true);
  paint(gables);

  const xs = points.map(p => p[0]);
  const zs = points.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2;
  const cz = -(minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ, wallH);
  return {
    walls: publicGroups(walls),
    roof: publicGroups(roof),
    gables: publicGroups(gables),
    soffit,
    fascia,
    legend: [
      { face: 'North', color: WALL_FACE_COLORS.north },
      { face: 'South', color: WALL_FACE_COLORS.south },
      { face: 'East', color: WALL_FACE_COLORS.east },
      { face: 'West', color: WALL_FACE_COLORS.west },
    ],
    source,
    center: [cx, wallH * 0.55, cz],
    radius: span * 1.35 + overhang,
    roofHeightAt: (east, north) => {
      if (measured) return null;
      const ridge = ridgeDirection(points, ridgeAngleDeg);
      const eaveList = isHip ? allEdges(points) : eaveEdges(points, ridge);
      if (!inside(east, north, points)) return null;
      return wallH + distanceToEdges(east, north, eaveList) * pitch;
    },
  };

  function empty(height) {
    return {
      walls: [], roof: [], gables: [], soffit: { color: '#e7e5e4', positions: [] },
      fascia: { color: '#44403c', positions: [] }, legend: [], source: 'empty',
      center: [0, height * 0.5, 0], radius: 40, roofHeightAt: () => null,
    };
  }

  function blankGroups() {
    return {
      north: { face: 'north', color: WALL_FACE_COLORS.north, positions: [] },
      south: { face: 'south', color: WALL_FACE_COLORS.south, positions: [] },
      east: { face: 'east', color: WALL_FACE_COLORS.east, positions: [] },
      west: { face: 'west', color: WALL_FACE_COLORS.west, positions: [] },
    };
  }

  function paint(groups, asRoof) {
    for (const group of Object.values(groups)) {
      if (asRoof) group.color = mixRoof(group.color);
    }
  }

  function publicGroups(groups) {
    return Object.values(groups).filter(group => group.positions.length >= 9);
  }

  function mixRoof(hex) {
    const rgb = hexToRgb(hex);
    const mixed = rgb.map((channel, index) => Math.round(ROOF_CHARCOAL[index] * 0.62 + channel * 0.38));
    return '#' + mixed.map(channel => channel.toString(16).padStart(2, '0')).join('');
  }

  function hexToRgb(hex) {
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  }

  function clean(raw) {
    const list = (Array.isArray(raw) ? raw : [])
      .map(point => [Number(point?.[0]), Number(point?.[1])])
      .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
    if (list.length > 1 && Math.hypot(list[0][0] - list[list.length - 1][0], list[0][1] - list[list.length - 1][1]) < 0.05) {
      list.pop();
    }
    if (list.length < 3) return null;
    const deduped = [];
    for (const point of list) {
      const prev = deduped[deduped.length - 1];
      if (!prev || Math.hypot(point[0] - prev[0], point[1] - prev[1]) >= 0.05) deduped.push(point);
    }
    return deduped.length >= 3 ? deduped : null;
  }

  function signedArea(poly) {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    return area / 2;
  }

  function outwardNormal(a, b, poly) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz) || 1;
    const ccw = signedArea(poly) > 0;
    return ccw ? [dz / length, -dx / length] : [-dz / length, dx / length];
  }

  function faceOfEdge(a, b, poly) {
    const [east, north] = outwardNormal(a, b, poly);
    if (Math.abs(north) >= Math.abs(east)) return north >= 0 ? 'north' : 'south';
    return east >= 0 ? 'east' : 'west';
  }

  function pushTriangle(out, verts) {
    for (const vert of verts) out.push(vert[0], vert[1], vert[2]);
  }

  function pushQuad(out, a, b, c, d) {
    pushTriangle(out, [a, b, c]);
    pushTriangle(out, [a, c, d]);
  }

  function lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  function allEdges(poly) {
    return poly.map((a, index) => {
      const b = poly[(index + 1) % poly.length];
      return { index, a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
    });
  }

  function ridgeDirection(poly, angleDeg) {
    if (Number.isFinite(Number(angleDeg))) {
      const angle = Number(angleDeg) * Math.PI / 180;
      return [Math.cos(angle), Math.sin(angle)];
    }
    const xs = poly.map(p => p[0]);
    const zs = poly.map(p => p[1]);
    return (Math.max(...xs) - Math.min(...xs)) >= (Math.max(...zs) - Math.min(...zs)) ? [1, 0] : [0, 1];
  }

  function eaveEdges(poly, ridge) {
    const edges = allEdges(poly).map(edge => {
      const dx = edge.b[0] - edge.a[0];
      const dz = edge.b[1] - edge.a[1];
      const length = Math.hypot(dx, dz) || 1;
      return { ...edge, parallel: Math.abs(dx / length * ridge[0] + dz / length * ridge[1]) };
    });
    const parallel = edges.filter(edge => edge.parallel >= Math.cos(Math.PI / 5));
    if (parallel.length >= 2) return parallel;
    return edges.slice().sort((a, b) => b.parallel - a.parallel).slice(0, Math.min(2, edges.length));
  }

  function distanceToSegment(x, z, a, b) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length2 = dx * dx + dz * dz;
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length2)) : 0;
    return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
  }

  function distanceToEdges(x, z, edges) {
    let distance = Infinity;
    for (const edge of edges) distance = Math.min(distance, distanceToSegment(x, z, edge.a, edge.b));
    return distance;
  }

  function inside(x, z, poly) {
    let contained = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-9) + xi) contained = !contained;
    }
    return contained;
  }

  function governingFace(centroid, edges, poly) {
    let best = Infinity;
    let face = 'south';
    for (const edge of edges) {
      const distance = distanceToSegment(centroid[0], centroid[1], edge.a, edge.b);
      if (distance < best) {
        best = distance;
        face = faceOfEdge(edge.a, edge.b, poly);
      }
    }
    return face;
  }

  function roofTriangles(poly, plate, rise, edges) {
    const xs = poly.map(p => p[0]);
    const zs = poly.map(p => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    let step = Math.max(1, Math.min(2.25, span / 28));
    let nx = Math.ceil((maxX - minX) / step);
    let nz = Math.ceil((maxZ - minZ) / step);
    while (nx * nz > 4200 && step < span) {
      step *= 1.25;
      nx = Math.ceil((maxX - minX) / step);
      nz = Math.ceil((maxZ - minZ) / step);
    }
    const triangles = [];
    const heightAt = (x, z) => [x, plate + distanceToEdges(x, z, edges) * rise, -z];
    for (let iz = 0; iz < nz; iz++) {
      const z0 = minZ + iz * step;
      const z1 = Math.min(maxZ, z0 + step);
      for (let ix = 0; ix < nx; ix++) {
        const x0 = minX + ix * step;
        const x1 = Math.min(maxX, x0 + step);
        const clipped = clipCell(poly, x0, x1, z0, z1);
        for (const triangle of triangulate(clipped)) {
          const centroid = [
            (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3,
            (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3,
          ];
          if (!inside(centroid[0], centroid[1], poly)) continue;
          triangles.push({
            centroid,
            verts: triangle.map(point => heightAt(point[0], point[1])),
          });
        }
      }
    }
    return triangles;
  }

  function clipAgainst(poly, axis, boundary, keepGreater) {
    const result = [];
    const insideSide = point => keepGreater ? point[axis] >= boundary - 1e-7 : point[axis] <= boundary + 1e-7;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const inA = insideSide(a);
      const inB = insideSide(b);
      if (inA) result.push(a);
      if (inA !== inB) {
        const delta = b[axis] - a[axis];
        const t = Math.abs(delta) < 1e-9 ? 0 : (boundary - a[axis]) / delta;
        result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return result;
  }

  function clipCell(poly, x0, x1, z0, z1) {
    let clipped = clipAgainst(poly, 0, x0, true);
    if (clipped.length >= 3) clipped = clipAgainst(clipped, 0, x1, false);
    if (clipped.length >= 3) clipped = clipAgainst(clipped, 1, z0, true);
    if (clipped.length >= 3) clipped = clipAgainst(clipped, 1, z1, false);
    return clipped;
  }

  function triangulate(poly) {
    if (!poly || poly.length < 3) return [];
    if (poly.length === 3) return [[poly[0], poly[1], poly[2]]];
    const ring = signedArea(poly) > 0 ? poly.slice() : poly.slice().reverse();
    const indices = ring.map((_, index) => index);
    const triangles = [];
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const contains = (p, a, b, c) => cross(a, b, p) >= -1e-7 && cross(b, c, p) >= -1e-7 && cross(c, a, p) >= -1e-7;
    let guard = ring.length * ring.length;
    while (indices.length > 3 && guard-- > 0) {
      let clipped = false;
      for (let i = 0; i < indices.length; i++) {
        const ia = indices[(i - 1 + indices.length) % indices.length];
        const ib = indices[i];
        const ic = indices[(i + 1) % indices.length];
        if (cross(ring[ia], ring[ib], ring[ic]) <= 1e-7) continue;
        if (indices.some(index => index !== ia && index !== ib && index !== ic && contains(ring[index], ring[ia], ring[ib], ring[ic]))) continue;
        triangles.push([ring[ia], ring[ib], ring[ic]]);
        indices.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;
    }
    if (indices.length === 3) triangles.push(indices.map(index => ring[index]));
    return triangles;
  }

  function roofFromFacets(rawFacets, footprint, plate) {
    const list = Array.isArray(rawFacets) ? rawFacets : [];
    if (list.length === 0) return null;
    const footprintArea = Math.abs(signedArea(footprint));
    const facetPoints = [];
    let planArea = 0;
    for (const facet of list) {
      const ring = (facet.polygon || []).map(point => [point[0], point[1]]);
      if (ring.length < 3) return null;
      planArea += Math.abs(signedArea(ring));
      facetPoints.push(...ring);
    }
    if (!(footprintArea > 0) || planArea < footprintArea * 0.45 || planArea > footprintArea * 2.2) return null;
    const footprintCenter = centroid(footprint);
    const facetCenter = centroid(facetPoints.map(point => [point[0], point[1]]));
    if (!footprintCenter || !facetCenter) return null;
    const shift = [footprintCenter[0] - facetCenter[0], footprintCenter[1] - facetCenter[1]];
    const xs = footprint.map(p => p[0]);
    const zs = footprint.map(p => p[1]);
    const pad = Math.max(8, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 0.3);
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minZ = Math.min(...zs) - pad;
    const maxZ = Math.max(...zs) + pad;
    const groups = { north: [], south: [], east: [], west: [] };
    for (const facet of list) {
      const shifted = facet.polygon.map(point => [point[0] + shift[0], point[1] + shift[1], point[2] || 0]);
      if (shifted.some(point => point[0] < minX || point[0] > maxX || point[1] < minZ || point[1] > maxZ)) return null;
      const face = cardinalFromAzimuth(facet.azimuth);
      for (const triangle of triangulate(shifted.map(point => [point[0], point[1]]))) {
        const verts = triangle.map(point => {
          const source = shifted.find(candidate => Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) < 1e-6);
          const height = source ? source[2] : 0;
          return [point[0], plate + height, -point[1]];
        });
        pushTriangle(groups[face], verts);
      }
    }
    if (Object.values(groups).every(positions => positions.length < 9)) return null;
    return groups;
  }

  function centroid(poly) {
    let twice = 0;
    let x = 0;
    let z = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const cross = a[0] * b[1] - b[0] * a[1];
      twice += cross;
      x += (a[0] + b[0]) * cross;
      z += (a[1] + b[1]) * cross;
    }
    if (Math.abs(twice) < 1e-6) {
      const avg = poly.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
      return [avg[0] / poly.length, avg[1] / poly.length];
    }
    return [x / (3 * twice), z / (3 * twice)];
  }

  function cardinalFromAzimuth(azimuth) {
    if (!Number.isFinite(azimuth)) return 'south';
    const deg = ((azimuth % 360) + 360) % 360;
    if (deg >= 45 && deg < 135) return 'east';
    if (deg >= 135 && deg < 225) return 'south';
    if (deg >= 225 && deg < 315) return 'west';
    return 'north';
  }
}
