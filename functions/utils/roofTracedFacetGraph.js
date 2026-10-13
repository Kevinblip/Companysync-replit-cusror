/**
 * roofTracedFacetGraph — canonical roof graph for ARBITRARY traced facets.
 *
 * `roofFacetGeometry.js` can only classify Google Solar's rotated rectangles:
 * it assumes every facet has exactly four corners in a fixed order
 * (eaveL, eaveR, ridgeR, ridgeL). Real roofs traced off aerial imagery produce
 * polygons with 3..12+ corners, L-wings, dormers and shared partial edges, so
 * that module cannot represent them.
 *
 * This module takes traced plan-view polygons (feet, x = east, y = north) plus
 * each facet's pitch and downslope azimuth, then:
 *   1. WELDS near-coincident corners into shared nodes,
 *   2. splits T-junctions so a corner landing mid-edge actually connects,
 *   3. classifies every edge from the facet topology and slope geometry,
 *   4. returns true (slope-corrected) lengths and areas.
 *
 * Edge classification is geometric, never a roof-type guess:
 *   shared edge, high on both facets, level     → ridge
 *   shared edge, high on both facets, sloped    → hip
 *   shared edge, low on both facets             → valley
 *   boundary edge, level, low  side of facet    → eave
 *   boundary edge, level, high side of facet    → ridge (untraced neighbour)
 *   boundary edge, sloped                       → rake
 *
 * Eaves and ridges are level, so their plan length IS their true length. Rakes,
 * hips and valleys climb the slope, so their true length is always recovered
 * from the pitch — a plan-only length under-reports every one of them.
 */

const D2R = Math.PI / 180;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v)));
const round = (v, p = 2) => {
  const m = 10 ** p;
  return Math.round(num(v) * m) / m;
};
const norm360 = (a) => ((num(a) % 360) + 360) % 360;

/** Signed shoelace area; positive = counter-clockwise. */
function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Pitch in degrees → "N/12" label, rounded to the nearest half-inch of rise. */
export function degreesToPitchLabel(deg) {
  const rise = Math.round(Math.tan(clamp(deg, 0, 85) * D2R) * 12 * 2) / 2;
  return `${rise}/12`;
}

/** "N/12" → degrees. Returns null when unparseable. */
export function pitchLabelToDegrees(label) {
  const m = String(label || '').match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (!m || Number(m[2]) <= 0) return null;
  return Math.atan(Number(m[1]) / Number(m[2])) / D2R;
}

/**
 * Unit downslope vector for a compass azimuth (the direction the facet drains).
 * x = east, y = north.
 */
function downslopeVector(azimuthDeg) {
  const r = norm360(azimuthDeg) * D2R;
  return { x: Math.sin(r), y: Math.cos(r) };
}

/**
 * Relative height of a point on a facet's plane, in feet. Only DIFFERENCES
 * within one facet are meaningful — there is no shared datum here, and none is
 * needed to tell a facet's high edge from its low edge.
 */
function relativeHeight(facet, x, y) {
  return -Math.tan(facet.pitch_degrees * D2R) * (x * facet._down.x + y * facet._down.y);
}

// ── Welding ──────────────────────────────────────────────────────────────────

function weldVertices(facets, tolFt) {
  const pts = [];
  facets.forEach((f, fi) => f.polygon.forEach((p, pi) => pts.push({ fi, pi, x: p.x, y: p.y })));

  const parent = pts.map((_, i) => i);
  const find = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) { const n = parent[i]; parent[i] = r; i = n; }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Spatial hash so welding stays linear-ish instead of O(n^2) across facets.
  const cell = Math.max(0.5, tolFt);
  const grid = new Map();
  const key = (cx, cy) => `${cx}|${cy}`;
  pts.forEach((p, i) => {
    const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  pts.forEach((p, i) => {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(key(cx + dx, cy + dy)) || []) {
          if (j <= i) continue;
          if (Math.hypot(p.x - pts[j].x, p.y - pts[j].y) <= tolFt) union(i, j);
        }
      }
    }
  });

  const rootToNode = new Map();
  const nodes = [];
  pts.forEach((p, i) => {
    const r = find(i);
    if (!rootToNode.has(r)) {
      rootToNode.set(r, nodes.length);
      nodes.push({ x: 0, y: 0, n: 0 });
    }
    const node = nodes[rootToNode.get(r)];
    node.x += p.x;
    node.y += p.y;
    node.n += 1;
  });
  nodes.forEach((n) => { n.x = round(n.x / n.n, 3); n.y = round(n.y / n.n, 3); });

  // Rewrite each facet as a ring of node ids, dropping consecutive repeats
  // (two corners of one facet can weld to the same node on a thin sliver).
  // `pts` was built in facet/vertex order, so a single cursor stays in step.
  let cursor = 0;
  facets.forEach((f) => {
    const ring = [];
    f.polygon.forEach(() => {
      const nodeIdx = rootToNode.get(find(cursor));
      cursor += 1;
      if (ring.length === 0 || ring[ring.length - 1] !== nodeIdx) ring.push(nodeIdx);
    });
    while (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
    f.ring = ring;
  });

  return nodes;
}

/**
 * Insert welded nodes that land in the middle of another facet's edge.
 * Without this a dormer corner touching a main-roof edge is invisible to the
 * topology, and the shared edge is misread as two unrelated boundary edges.
 */
function splitTJunctions(facets, nodes, tolFt) {
  for (const f of facets) {
    const out = [];
    for (let i = 0; i < f.ring.length; i++) {
      const aIdx = f.ring[i];
      const bIdx = f.ring[(i + 1) % f.ring.length];
      const a = nodes[aIdx];
      const b = nodes[bIdx];
      out.push(aIdx);

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-6) continue;

      const hits = [];
      for (let n = 0; n < nodes.length; n++) {
        if (n === aIdx || n === bIdx) continue;
        if (f.ring.includes(n)) continue;
        const p = nodes[n];
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
        if (t <= 0.02 || t >= 0.98) continue;
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        if (Math.hypot(p.x - px, p.y - py) > tolFt) continue;
        hits.push({ n, t });
      }
      hits.sort((p, q) => p.t - q.t);
      for (const h of hits) if (out[out.length - 1] !== h.n) out.push(h.n);
    }
    const dedup = [];
    for (const n of out) if (dedup.length === 0 || dedup[dedup.length - 1] !== n) dedup.push(n);
    while (dedup.length > 1 && dedup[0] === dedup[dedup.length - 1]) dedup.pop();
    f.ring = dedup;
  }
}

// ── Classification ───────────────────────────────────────────────────────────

/**
 * An edge is LEVEL for a facet when it runs across the slope (constant height).
 * `|u · d|` is the fraction of the edge that climbs; ridges and eaves sit near
 * 0, rakes near 1.
 */
const LEVEL_MAX_SLOPE_COMPONENT = 0.28;
// Below this pitch the plane has no meaningful up/downhill direction.
const FLAT_PITCH_DEGREES = 1.5;

function classifyGraph(facets, nodes, edges) {
  for (const edge of edges.values()) {
    const a = nodes[edge.a];
    const b = nodes[edge.b];
    const planLen = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = planLen > 0 ? (b.x - a.x) / planLen : 0;
    const uy = planLen > 0 ? (b.y - a.y) / planLen : 0;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    edge.plan_length_ft = planLen;

    const views = edge.facets.map((fi) => {
      const f = facets[fi];
      const flat = f.pitch_degrees < FLAT_PITCH_DEGREES;
      const slopeComponent = Math.abs(ux * f._down.x + uy * f._down.y);
      const rise = Math.tan(f.pitch_degrees * D2R) * planLen * slopeComponent;
      return {
        fi,
        flat,
        level: flat || slopeComponent < LEVEL_MAX_SLOPE_COMPONENT,
        // Positive = this edge sits ABOVE the facet's centroid, i.e. it is the
        // facet's high side.
        high: relativeHeight(f, midX, midY) - relativeHeight(f, f._cx, f._cy) > 0,
        trueLen: Math.hypot(planLen, rise),
      };
    });

    // True length is the same physical line for both facets; a disagreement
    // means the two pitches differ, and the longer run is the real one.
    edge.length_ft = round(Math.max(...views.map((v) => v.trueLen)), 2);

    if (views.length >= 2) {
      const [p, q] = views;
      const bothLevel = p.level && q.level;
      if (p.flat && q.flat) edge.type = 'ridge';
      else if (p.high && q.high) edge.type = bothLevel ? 'ridge' : 'hip';
      else if (!p.high && !q.high) edge.type = 'valley';
      else edge.type = bothLevel ? 'ridge' : 'hip'; // shoulder / gambrel break
      edge.shared = true;
    } else {
      const v = views[0];
      edge.shared = false;
      if (v.flat) edge.type = 'eave';
      else if (v.level) edge.type = v.high ? 'ridge' : 'eave';
      else edge.type = 'rake';
      // An unshared HIGH level edge means the facet on the far side was never
      // traced. It is still a ridge, but the roof is incompletely covered.
      edge.open_boundary = v.level && v.high;
    }
  }
}

/**
 * Build the canonical graph.
 *
 * @param {object}  opts
 * @param {Array}   opts.facets            [{ id?, polygon:[{x,y}], pitch_degrees, azimuth_degrees }]
 * @param {number} [opts.weldToleranceFt]  corner-merge distance (feet)
 * @returns {{facets, edges, edge_totals, totals, warnings}}
 */
export function buildTracedRoofGraph({ facets: input = [], weldToleranceFt = 2 } = {}) {
  const warnings = [];
  const facets = [];

  (Array.isArray(input) ? input : []).forEach((f, idx) => {
    let poly = (Array.isArray(f?.polygon) ? f.polygon : [])
      .map((p) => ({ x: num(p?.x, NaN), y: num(p?.y, NaN) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    poly = poly.filter((p, i) => {
      const prev = poly[(i - 1 + poly.length) % poly.length];
      return Math.hypot(p.x - prev.x, p.y - prev.y) > 0.25;
    });
    if (poly.length < 3) { warnings.push(`facet_${idx + 1}_discarded_too_few_corners`); return; }
    if (signedArea(poly) < 0) poly.reverse();
    const planArea = Math.abs(signedArea(poly));
    if (planArea < 20) { warnings.push(`facet_${idx + 1}_discarded_area_under_20sqft`); return; }

    const pitchDeg = clamp(f?.pitch_degrees ?? pitchLabelToDegrees(f?.pitch) ?? 0, 0, 85);
    const azimuth = norm360(f?.azimuth_degrees ?? 180);
    facets.push({
      id: String(f?.id || `facet_${idx + 1}`),
      label: f?.label || null,
      polygon: poly,
      pitch_degrees: round(pitchDeg, 1),
      pitch: degreesToPitchLabel(pitchDeg),
      azimuth_degrees: round(azimuth, 1),
      confidence: clamp(f?.confidence ?? 0.6, 0, 1),
      _down: downslopeVector(azimuth),
    });
  });

  if (facets.length === 0) {
    return {
      facets: [],
      edges: [],
      edge_totals: { eave: 0, ridge: 0, hip: 0, valley: 0, rake: 0 },
      totals: { plan_area_sqft: 0, roof_area_sqft: 0, facet_count: 0, perimeter_ft: 0 },
      warnings: warnings.concat('no_usable_facets'),
    };
  }

  const nodes = weldVertices(facets, weldToleranceFt);
  splitTJunctions(facets, nodes, weldToleranceFt);

  // Recompute geometry from the WELDED ring — welding moves corners slightly,
  // and area must describe the polygon the edges actually bound.
  for (const f of facets) {
    const ring = f.ring.map((n) => ({ x: nodes[n].x, y: nodes[n].y }));
    if (ring.length < 3 || Math.abs(signedArea(ring)) < 20) {
      f._degenerate = true;
      warnings.push(`facet_${f.id}_degenerate_after_weld`);
      continue;
    }
    if (signedArea(ring) < 0) { ring.reverse(); f.ring.reverse(); }
    f.polygon = ring;
    f.plan_area_sqft = round(Math.abs(signedArea(ring)), 1);
    f._cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    f._cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    const cos = Math.cos(f.pitch_degrees * D2R);
    f.slope_multiplier = round(cos > 0.05 ? 1 / cos : 1, 4);
    f.area_sqft = round(f.plan_area_sqft * f.slope_multiplier, 1);
  }
  const live = facets.filter((f) => !f._degenerate);

  // Edge registry keyed by the welded node pair, so a shared boundary is one
  // physical edge no matter how many facets reference it.
  const edges = new Map();
  live.forEach((f, liveIdx) => {
    for (let i = 0; i < f.ring.length; i++) {
      const a = f.ring[i];
      const b = f.ring[(i + 1) % f.ring.length];
      if (a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edges.has(key)) edges.set(key, { key, a: Math.min(a, b), b: Math.max(a, b), facets: [] });
      const rec = edges.get(key);
      if (!rec.facets.includes(liveIdx)) rec.facets.push(liveIdx);
    }
  });

  classifyGraph(live, nodes, edges);

  const edgeList = [...edges.values()].map((e) => ({
    id: e.key,
    type: e.type,
    shared: e.shared,
    open_boundary: e.open_boundary === true,
    length_ft: e.length_ft,
    plan_length_ft: round(e.plan_length_ft, 2),
    facet_ids: e.facets.map((fi) => live[fi].id),
    x1: nodes[e.a].x, y1: nodes[e.a].y,
    x2: nodes[e.b].x, y2: nodes[e.b].y,
  }));

  const edgeTotals = { eave: 0, ridge: 0, hip: 0, valley: 0, rake: 0 };
  for (const e of edgeList) if (edgeTotals[e.type] != null) edgeTotals[e.type] += e.length_ft;
  for (const k of Object.keys(edgeTotals)) edgeTotals[k] = round(edgeTotals[k], 1);

  // Attach each facet's own edges for rendering and per-facet reporting.
  for (const f of live) f.edges = edgeList.filter((e) => e.facet_ids.includes(f.id));

  const planArea = round(live.reduce((s, f) => s + f.plan_area_sqft, 0), 1);
  const roofArea = round(live.reduce((s, f) => s + f.area_sqft, 0), 1);
  const perimeter = round(
    edgeList.filter((e) => !e.shared).reduce((s, e) => s + e.plan_length_ft, 0),
    1,
  );

  const openBoundaries = edgeList.filter((e) => e.open_boundary);
  if (openBoundaries.length > 0) {
    warnings.push(`open_high_boundaries:${openBoundaries.length}`);
  }
  const orphans = live.filter((f) => !(f.edges || []).some((e) => e.shared));
  if (orphans.length > 0 && live.length > 1) {
    warnings.push(`disconnected_facets:${orphans.map((f) => f.id).join(',')}`);
  }

  for (const f of live) { delete f._down; delete f._cx; delete f._cy; delete f.ring; }

  return {
    facets: live,
    edges: edgeList,
    edge_totals: edgeTotals,
    totals: {
      facet_count: live.length,
      plan_area_sqft: planArea,
      roof_area_sqft: roofArea,
      perimeter_ft: perimeter,
      open_boundary_count: openBoundaries.length,
    },
    warnings,
  };
}

export default buildTracedRoofGraph;
