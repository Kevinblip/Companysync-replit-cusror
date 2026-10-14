/**
 * roofFacetGeometry — shared canonical roof-facet geometry builder.
 *
 * Converts Google Solar API `roofSegmentStats` into local-feet facet polygons
 * with per-corner heights and classified edges (eave / ridge / hip / valley /
 * rake), so the 3D renderer, the measurement graph, and reports all share one
 * geometric source of truth.
 *
 * Coordinate system (2D plan): x = feet east, y = feet north, origin at the
 * area-weighted centroid of all segments. Heights (`h`) are feet ABOVE the
 * wall-top plate (eave edge of each facet = 0 unless the segment is elevated).
 *
 * IMPORTANT: this module classifies geometry only. The measurement handler
 * decides when these edge totals are authoritative and never derives roof area
 * from this module.
 */

const D2R = Math.PI / 180;

function norm360(a) { return ((a % 360) + 360) % 360; }

function round(v, p = 2) {
  const m = 10 ** p;
  return Math.round(v * m) / m;
}

function degToPitchStr(deg) {
  const rise = Math.round(Math.tan(deg * D2R) * 12 * 2) / 2;
  return `${rise}/12`;
}

/**
 * Solve a rotated rectangle (slope-depth A along azimuth, ridge-length B
 * perpendicular) from an axis-aligned bounding box. Same math as the
 * measurement handler's detected-lines derivation — keep in lockstep.
 */
function solveRotatedRect(bboxW, bboxH, azimuthDeg) {
  const azR = azimuthDeg * D2R;
  const sAz = Math.abs(Math.sin(azR));
  const cAz = Math.abs(Math.cos(azR));
  const det = sAz * sAz - cAz * cAz;
  let A, B;
  if (Math.abs(det) < 0.12) {
    const diag = (bboxW + bboxH) / 2;
    A = B = diag / (sAz + cAz || 1);
  } else {
    A = (bboxW * sAz - bboxH * cAz) / det;
    B = (bboxH * sAz - bboxW * cAz) / det;
  }
  if (!(A > 0) || !(B > 0) || !isFinite(A) || !isFinite(B)) {
    A = Math.max(bboxW, bboxH) / (sAz + cAz || 1);
    B = Math.min(bboxW, bboxH) / (sAz + cAz || 1);
  }
  return { A, B };
}

/**
 * Build raw facet rectangles (plan coordinates + heights) from Solar segments.
 * Returns [] when segments lack usable geometry.
 */
export function buildRoofFacetsFromSolarSegments(roofSegments) {
  const segs = (Array.isArray(roofSegments) ? roofSegments : []).filter(s => {
    const bb = s?.boundingBox;
    return bb?.ne?.latitude != null && bb?.sw?.latitude != null
      && bb?.ne?.longitude != null && bb?.sw?.longitude != null;
  });
  if (segs.length === 0) return [];

  // Area-weighted centroid of segment centers → local origin.
  let wSum = 0, latSum = 0, lngSum = 0;
  const centers = segs.map(s => {
    const bb = s.boundingBox;
    const lat = s.center?.latitude ?? (bb.ne.latitude + bb.sw.latitude) / 2;
    const lng = s.center?.longitude ?? (bb.ne.longitude + bb.sw.longitude) / 2;
    const w = Math.max(1, s.stats?.areaMeters2 || 1);
    wSum += w; latSum += lat * w; lngSum += lng * w;
    return { lat, lng };
  });
  const refLat = latSum / wSum, refLng = lngSum / wSum;
  const ftPerLat = 364567.2 / 1.0000; // ~feet per degree latitude
  const ftPerLng = ftPerLat * Math.cos(refLat * D2R);

  // Solar reports the absolute plane elevation at each segment center. Convert
  // that to an eave elevation, then use the area-weighted median eave as the
  // stable local wall-plate datum. The median keeps one unusually low/noisy
  // plane from lifting the whole roof; sub-foot differences remain render noise.
  const elevationSamples = segs.map((seg, i) => {
    const pitchDeg = Math.max(0, Number(seg.pitchDegrees ?? seg.tiltDegrees ?? 20));
    const bb = seg.boundingBox;
    const bboxW = Math.abs(bb.ne.longitude - bb.sw.longitude) * ftPerLng;
    const bboxH = Math.abs(bb.ne.latitude - bb.sw.latitude) * ftPerLat;
    const azimuthDeg = norm360(Number.isFinite(Number(seg.azimuthDegrees)) ? Number(seg.azimuthDegrees) : 180);
    const { A } = solveRotatedRect(bboxW, bboxH, azimuthDeg);
    const centerHeightM = Number(seg.planeHeightAtCenterMeters);
    return {
      index: i,
      eaveHeightFt: Number.isFinite(centerHeightM)
        ? centerHeightM * 3.28084 - (A * Math.tan(pitchDeg * D2R)) / 2
        : null,
      weight: Math.max(1, Number(seg.stats?.areaMeters2) || 1),
    };
  });
  const validElevations = elevationSamples
    .filter(sample => Number.isFinite(sample.eaveHeightFt))
    .sort((a, b) => a.eaveHeightFt - b.eaveHeightFt);
  let elevationDatumFt = null;
  if (validElevations.length > 0) {
    const totalWeight = validElevations.reduce((sum, sample) => sum + sample.weight, 0);
    let cumulativeWeight = 0;
    elevationDatumFt = validElevations.find(sample => {
      cumulativeWeight += sample.weight;
      return cumulativeWeight >= totalWeight / 2;
    })?.eaveHeightFt ?? validElevations[0].eaveHeightFt;
  }

  const facets = segs.map((seg, i) => {
    const bb = seg.boundingBox;
    const { lat: cLat, lng: cLng } = centers[i];
    const cx = (cLng - refLng) * ftPerLng;   // east ft
    const cy = (cLat - refLat) * ftPerLat;   // north ft

    const bboxW = Math.abs(bb.ne.longitude - bb.sw.longitude) * ftPerLng;
    const bboxH = Math.abs(bb.ne.latitude - bb.sw.latitude) * ftPerLat;

    const pitchDeg = Math.max(0, Number(seg.pitchDegrees ?? seg.tiltDegrees ?? 20));
    const azimuthDeg = norm360(Number.isFinite(Number(seg.azimuthDegrees)) ? Number(seg.azimuthDegrees) : 180);
    const { A, B } = solveRotatedRect(bboxW, bboxH, azimuthDeg);

    // Downhill unit vector (azimuth = compass direction the facet faces / drains).
    const azR = azimuthDeg * D2R;
    const dx = Math.sin(azR), dy = Math.cos(azR);       // downhill (east, north)
    const rx = Math.cos(azR), ry = -Math.sin(azR);      // along-ridge (perpendicular)

    const halfA = A / 2, halfB = B / 2;
    const rise = A * Math.tan(pitchDeg * D2R);          // ft of vertical rise over run A
    const rawElevationOffset = elevationDatumFt == null || !Number.isFinite(elevationSamples[i].eaveHeightFt)
      ? 0
      : elevationSamples[i].eaveHeightFt - elevationDatumFt;
    // Preserve meaningful levels in both directions. Tiny differences are
    // normal Solar plane noise and would otherwise create z-fighting seams.
    const elevationOffset = Math.abs(rawElevationOffset) > 0.3 ? rawElevationOffset : 0;

    // Corners: eaveL/eaveR at the local plate, ridgeR/ridgeL above it.
    const eX = cx + dx * halfA, eY = cy + dy * halfA;
    const gX = cx - dx * halfA, gY = cy - dy * halfA;
    const polygon = [
      { x: round(eX - rx * halfB), y: round(eY - ry * halfB), h: round(elevationOffset) },
      { x: round(eX + rx * halfB), y: round(eY + ry * halfB), h: round(elevationOffset) },
      { x: round(gX + rx * halfB), y: round(gY + ry * halfB), h: round(elevationOffset + rise) },
      { x: round(gX - rx * halfB), y: round(gY - ry * halfB), h: round(elevationOffset + rise) },
    ];

    const areaSqft = (seg.stats?.areaMeters2 || 0) * 10.7639;
    return {
      id: `solar_facet_${i}`,
      provenance: 'google_solar',
      pitch_degrees: round(pitchDeg, 1),
      pitch: degToPitchStr(pitchDeg),
      azimuth_degrees: round(azimuthDeg, 1),
      area_sqft: round(areaSqft, 1),
      plan_depth_ft: round(A),   // slope-axis footprint depth
      ridge_len_ft: round(B),    // ridge-axis length
      rise_ft: round(rise),
      elevation_offset_ft: round(elevationOffset),
      polygon,
      // edges filled in by classifyFacetEdges
      edges: [],
      confidence: seg.stats?.areaMeters2 > 5 ? 0.8 : 0.5,
    };
  });

  classifyFacetEdges(facets);
  return facets;
}

// ── Edge classification ───────────────────────────────────────────────────────

function edgeOf(f, i, j, role) {
  const a = f.polygon[i], b = f.polygon[j];
  const len3d = Math.hypot(b.x - a.x, b.y - a.y, (b.h || 0) - (a.h || 0));
  return {
    type: role, // provisional; refined by adjacency
    role,       // structural role on this facet: 'eave' | 'up' | 'side'
    x1: a.x, y1: a.y, h1: a.h || 0,
    x2: b.x, y2: b.y, h2: b.h || 0,
    length_ft: round(len3d, 1),
  };
}

function edgeMid(e) { return [(e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2]; }
function edgeDir(e) {
  const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/**
 * Classify each facet's 4 edges structurally, then refine via adjacency:
 *   up ↔ up (parallel, coincident)          → ridge
 *   perpendicular-ish neighbors (corner)    → hip or valley junction diagonal
 *   unmatched side                          → rake
 *   unmatched up                            → ridge (shed/gable top); renderer closes the gable wall
 * Hip vs valley: a hip junction is one where each facet sees the other on its
 * UPHILL side (convex corner); if either facet sees the other downhill, the
 * junction is concave → valley.
 * Mutates `facets` in place (fills `edges`) and returns them.
 */
export function classifyFacetEdges(facets) {
  for (const f of facets) {
    // polygon order: eaveL(0) eaveR(1) ridgeR(2) ridgeL(3)
    f.edges = [
      edgeOf(f, 0, 1, 'eave'),
      edgeOf(f, 1, 2, 'side'),
      edgeOf(f, 2, 3, 'up'),
      edgeOf(f, 3, 0, 'side'),
    ];
    f.edges.forEach(e => { e.type = e.role === 'eave' ? 'eave' : e.role === 'up' ? 'ridge' : 'rake'; });
  }

  const down = facets.map(f => {
    const azR = f.azimuth_degrees * D2R;
    return [Math.sin(azR), Math.cos(azR)];
  });
  const centroid = facets.map(f => [
    f.polygon.reduce((s, p) => s + p.x, 0) / 4,
    f.polygon.reduce((s, p) => s + p.y, 0) / 4,
  ]);

  for (let i = 0; i < facets.length; i++) {
    for (let j = i + 1; j < facets.length; j++) {
      const azd = azimuthDiff(facets[i].azimuth_degrees, facets[j].azimuth_degrees);

      // ── Parallel opposing facets: shared uphill edge → ridge ──────────────
      if (azd > 130) {
        for (const ei of facets[i].edges) {
          if (ei.role !== 'up') continue;
          for (const ej of facets[j].edges) {
            if (ej.role !== 'up') continue;
            if (!edgesAdjacent(ei, ej)) continue;
            ei.type = ej.type = 'ridge';
            ei.shared_with = facets[j].id; ej.shared_with = facets[i].id;
          }
        }
        continue;
      }

      // ── Perpendicular-ish neighbors: hip/valley junction diagonal ─────────
      if (azd < 30 || azd > 150) continue;
      if (rectGapFt(facets[i], facets[j]) > 6) continue;

      // Junction line: low point = closest pair of eave-level corners,
      // high point = closest pair of high corners.
      const minI = Math.min(...facets[i].polygon.map(p => p.h));
      const minJ = Math.min(...facets[j].polygon.map(p => p.h));
      const maxI = Math.max(...facets[i].polygon.map(p => p.h));
      const maxJ = Math.max(...facets[j].polygon.map(p => p.h));
      const lowI = facets[i].polygon.filter(p => Math.abs(p.h - minI) < 0.01);
      const lowJ = facets[j].polygon.filter(p => Math.abs(p.h - minJ) < 0.01);
      const highI = facets[i].polygon.filter(p => Math.abs(p.h - maxI) < 0.01);
      const highJ = facets[j].polygon.filter(p => Math.abs(p.h - maxJ) < 0.01);
      const lowPair = closestPair(lowI, lowJ);
      if (!lowPair || lowPair.dist > 12) continue; // eave corners nowhere near → not a junction
      const lowMid = { x: (lowPair.a.x + lowPair.b.x) / 2, y: (lowPair.a.y + lowPair.b.y) / 2 };
      // Pick the high pair nearest each other AND nearest the low corner —
      // symmetric roofs (pyramids) tie on pair distance alone and can select
      // the diagonal on the wrong side.
      const highPair = closestPair(highI, highJ, lowMid);
      if (!highPair) continue;

      // Hip if BOTH facets see the other on their uphill (or level) side.
      const dIJ = [centroid[j][0] - centroid[i][0], centroid[j][1] - centroid[i][1]];
      const dJI = [-dIJ[0], -dIJ[1]];
      const distC = Math.hypot(dIJ[0], dIJ[1]) || 1;
      const eps = 0.15 * distC;
      const seesUphillI = dIJ[0] * down[i][0] + dIJ[1] * down[i][1] < eps;
      const seesUphillJ = dJI[0] * down[j][0] + dJI[1] * down[j][1] < eps;
      const kind = (seesUphillI && seesUphillJ) ? 'hip' : 'valley';

      const lx = (lowPair.a.x + lowPair.b.x) / 2, ly = (lowPair.a.y + lowPair.b.y) / 2;
      const hx = (highPair.a.x + highPair.b.x) / 2, hy = (highPair.a.y + highPair.b.y) / 2;
      const hLow = (lowPair.a.h + lowPair.b.h) / 2;
      const hHigh = (highPair.a.h + highPair.b.h) / 2;
      const jBase = {
        type: kind, role: 'junction',
        x1: lx, y1: ly, h1: hLow,
        x2: hx, y2: hy, h2: hHigh,
        length_ft: Math.round(Math.hypot(hx - lx, hy - ly, hHigh - hLow) * 10) / 10,
      };
      // Represent the shared junction edge symmetrically on BOTH facets;
      // computeEdgeTotals dedupes by the (pair, type, midpoint) key.
      facets[i].edges.push({ ...jBase, shared_with: facets[j].id });
      facets[j].edges.push({ ...jBase, shared_with: facets[i].id });

      // Record the junction line as a clip plane for both facets so their
      // rectangles are cut back to actually MEET at the hip/valley boundary
      // instead of overlapping through each other.
      const planeA = { x: lx, y: ly }, planeB = { x: hx, y: hy };
      const sideOf = (px, py) => (planeB.x - planeA.x) * (py - planeA.y) - (planeB.y - planeA.y) * (px - planeA.x);
      for (const [f, c] of [[facets[i], centroid[i]], [facets[j], centroid[j]]]) {
        const keep = Math.sign(sideOf(c[0], c[1])) || 1;
        (f._clips = f._clips || []).push({ a: planeA, b: planeB, keep });
      }

      // Suppress the rake highlight on each facet's side edge nearest the junction.
      const jm = [(lx + hx) / 2, (ly + hy) / 2];
      for (const f of [facets[i], facets[j]]) {
        let best = null, bestD = Infinity;
        for (const e of f.edges) {
          if (e.role !== 'side' || e.type !== 'rake') continue;
          const [mx, my] = edgeMid(e);
          const d = Math.hypot(mx - jm[0], my - jm[1]);
          if (d < bestD) { bestD = d; best = e; }
        }
        if (best && bestD < Math.max(10, best.length_ft * 0.75)) best.type = 'none';
      }
    }
  }

  // ── Apply junction clip planes: facets meet at hips/valleys, not overlap ──
  for (const f of facets) {
    if (!f._clips || f._clips.length === 0) continue;
    let poly = f.polygon;
    for (const cl of f._clips) {
      const next = clipPolyHalfPlane(poly, cl.a, cl.b, cl.keep);
      if (next.length >= 3 && polyPlanArea(next) > 0.15 * polyPlanArea(f.polygon)) poly = next;
    }
    f.polygon = poly.map(pt => ({ x: round(pt.x), y: round(pt.y), h: round(pt.h) }));
    // Clip structural edge highlight segments to the same half-planes.
    for (const e of f.edges) {
      if (e.role === 'junction') continue;
      for (const cl of f._clips) {
        const seg = clipSegmentHalfPlane(e, cl.a, cl.b, cl.keep);
        if (!seg) { e.type = 'none'; break; }
        Object.assign(e, seg);
      }
      if (e.type !== 'none') {
        e.length_ft = round(Math.hypot(e.x2 - e.x1, e.y2 - e.y1, e.h2 - e.h1), 1);
        if (e.length_ft < 0.5) e.type = 'none';
      }
    }
    delete f._clips;
  }
  return facets;
}

/**
 * True when an exterior facet edge needs a vertical gable-wall infill below it.
 *
 * Only sloped, unshared exterior edges bound a gable wall. A level elevated
 * edge is a ridge (including an unmatched shed/gable ridge) and filling below
 * it produces a tall vertical sheet through the roof interior.
 */
export function shouldFillGableEdge(edge, localPlateHeight = 0) {
  if (!edge || edge.shared_with || edge.type === 'none') return false;
  if (edge.role && edge.role !== 'side') return false;
  const h1 = Number(edge.h1) || 0;
  const h2 = Number(edge.h2) || 0;
  const plate = Number(localPlateHeight) || 0;
  return Math.max(h1 - plate, h2 - plate) > 0.3 && Math.abs(h1 - h2) > 0.3;
}

// Signed side of point relative to the (a→b) line; >0 = left.
function lineSide(a, b, px, py) {
  return (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
}

// Sutherland–Hodgman clip of a polygon (with heights) against one half-plane.
function clipPolyHalfPlane(poly, a, b, keep) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const sp = lineSide(a, b, p.x, p.y) * keep;
    const sq = lineSide(a, b, q.x, q.y) * keep;
    const inP = sp >= -1e-6, inQ = sq >= -1e-6;
    if (inP) out.push(p);
    if (inP !== inQ) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, h: (p.h || 0) + ((q.h || 0) - (p.h || 0)) * t });
    }
  }
  return out;
}

// Clip an edge segment {x1,y1,h1,x2,y2,h2} to a half-plane; null if fully outside.
function clipSegmentHalfPlane(e, a, b, keep) {
  const s1 = lineSide(a, b, e.x1, e.y1) * keep;
  const s2 = lineSide(a, b, e.x2, e.y2) * keep;
  const in1 = s1 >= -1e-6, in2 = s2 >= -1e-6;
  if (in1 && in2) return { x1: e.x1, y1: e.y1, h1: e.h1, x2: e.x2, y2: e.y2, h2: e.h2 };
  if (!in1 && !in2) return null;
  const t = s1 / (s1 - s2);
  const ix = e.x1 + (e.x2 - e.x1) * t, iy = e.y1 + (e.y2 - e.y1) * t, ih = e.h1 + (e.h2 - e.h1) * t;
  return in1
    ? { x1: e.x1, y1: e.y1, h1: e.h1, x2: ix, y2: iy, h2: ih }
    : { x1: ix, y1: iy, h1: ih, x2: e.x2, y2: e.y2, h2: e.h2 };
}

/** Plan-view (footprint) area of a facet polygon in sqft. */
export function polyPlanArea(poly) {
  let a = 0;
  const n = (poly || []).length;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

function azimuthDiff(a, b) {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
}

function closestPair(cornersA, cornersB, anchor = null) {
  let best = null;
  for (const a of cornersA) for (const b of cornersB) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const bias = anchor
      ? 0.5 * (Math.hypot(a.x - anchor.x, a.y - anchor.y) + Math.hypot(b.x - anchor.x, b.y - anchor.y))
      : 0;
    const score = d + bias;
    if (!best || score < best.score) best = { a, b, dist: d, score };
  }
  return best;
}

// Approximate plan-view gap between two facet rectangles: min corner-to-corner
// distance minus nothing fancy — 0 when polygons overlap or touch closely.
function rectGapFt(f1, f2) {
  let min = Infinity;
  for (const p of f1.polygon) for (const q of f2.polygon) {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < min) min = d;
  }
  // Also treat containment/overlap of centers as adjacency.
  return min;
}

function edgesAdjacent(e1, e2) {
  const [m1x, m1y] = edgeMid(e1), [m2x, m2y] = edgeMid(e2);
  const minLen = Math.min(e1.length_ft, e2.length_ft);
  const tol = Math.max(4, minLen * 0.35);
  if (Math.hypot(m1x - m2x, m1y - m2y) > tol) return false;
  const [d1x, d1y] = edgeDir(e1), [d2x, d2y] = edgeDir(e2);
  const parallel = Math.abs(d1x * d2x + d1y * d2y);
  if (parallel < 0.75) return false;
  const ratio = minLen / (Math.max(e1.length_ft, e2.length_ft) || 1);
  return ratio > 0.35;
}

// ── Aggregates / helpers for consumers ────────────────────────────────────────

/** Linear-feet totals by classified edge type (shared edges counted once). */
export function computeEdgeTotals(facets) {
  const totals = { eave: 0, ridge: 0, hip: 0, valley: 0, rake: 0 };
  const counts = { eave: 0, ridge: 0, hip: 0, valley: 0, rake: 0 };
  const seen = new Set();
  for (const f of facets || []) {
    for (const e of f.edges || []) {
      if (e.shared_with) {
        const key = [f.id, e.shared_with].sort().join('|') + '|' + e.type + '|' + Math.round((e.x1 + e.x2) / 2) + ',' + Math.round((e.y1 + e.y2) / 2);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      if (totals[e.type] != null) {
        totals[e.type] += e.length_ft;
        counts[e.type] += 1;
      }
    }
  }
  for (const k of Object.keys(totals)) totals[k] = round(totals[k], 1);
  totals.counts = counts;
  return totals;
}

/** Plan-view bounding box of all facet polygons. */
export function facetsBounds(facets) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of facets || []) {
    for (const p of f.polygon || []) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) return null;
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, spanX: maxX - minX, spanY: maxY - minY };
}

export default buildRoofFacetsFromSolarSegments;
