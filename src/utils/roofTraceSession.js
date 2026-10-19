/**
 * Pure helpers for the manual roof trace.
 *
 * Snapping is computed in screen pixels so a finger can land on a shared
 * corner. The capture radius is capped in feet by the caller, and a hit
 * returns the existing corner (or the point on the edge) rather than a
 * nearby guess — welded topology then sees one shared node.
 */

export const SNAP_PIXELS = 28;
export const SNAP_MAX_FEET = 8;

/** Compass azimuths applied to facets in the order they are created. */
export const DEFAULT_FACET_AZIMUTHS = [180, 0, 90, 270];

export function defaultFacetAzimuth(index) {
  const i = Math.max(0, Number(index) || 0);
  return DEFAULT_FACET_AZIMUTHS[i % DEFAULT_FACET_AZIMUTHS.length];
}

export function closestPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return { x: x1, y: y1, t: 0 };
  const t = Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return { x: x1 + dx * t, y: y1 + dy * t, t };
}

/**
 * @param {{x:number,y:number}} cursor
 * @param {Array<{x:number,y:number,latLng?:any}>} vertices
 * @param {Array<{x1:number,y1:number,x2:number,y2:number}>} segments
 * @param {number} tolerancePx
 * @returns {{x:number,y:number,kind:'vertex'|'edge',distance:number,latLng?:any}|null}
 */
export function findSnapTarget(cursor, vertices, segments, tolerancePx = SNAP_PIXELS) {
  if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null;
  const tol = Number(tolerancePx);
  if (!Number.isFinite(tol) || tol <= 0) return null;

  let best = null;
  for (const v of vertices || []) {
    if (!Number.isFinite(v?.x) || !Number.isFinite(v?.y)) continue;
    const distance = Math.hypot(cursor.x - v.x, cursor.y - v.y);
    if (distance <= tol && (!best || distance < best.distance)) {
      best = { x: v.x, y: v.y, kind: 'vertex', distance, latLng: v.latLng };
    }
  }
  // A corner always wins over the edge it belongs to.
  if (best) return best;

  for (const s of segments || []) {
    if (![s?.x1, s?.y1, s?.x2, s?.y2].every(Number.isFinite)) continue;
    const projected = closestPointOnSegment(cursor.x, cursor.y, s.x1, s.y1, s.x2, s.y2);
    const distance = Math.hypot(cursor.x - projected.x, cursor.y - projected.y);
    if (distance <= tol && (!best || distance < best.distance)) {
      best = { x: projected.x, y: projected.y, kind: 'edge', distance };
    }
  }
  return best;
}

/**
 * After a facet is finished, either continue an undrawn facet or create the next one.
 * `sections` is `{ id, hasPolygon }[]` in list order.
 */
export function planNextFacet(sections, completedId) {
  const list = Array.isArray(sections) ? sections : [];
  const undrawn = list.find((s) => s && s.id !== completedId && !s.hasPolygon);
  if (undrawn) return { action: 'select', id: undrawn.id };
  const maxId = list.reduce((m, s) => Math.max(m, Number(s?.id) || 0), 0);
  const id = maxId + 1;
  return {
    action: 'create',
    id,
    name: `Facet ${id}`,
    azimuth_degrees: defaultFacetAzimuth(list.length),
  };
}

export const MANUAL_LINE_TYPES = ['ridge', 'hip', 'valley', 'rake', 'eave', 'step_flashing', 'drip_edge'];

/**
 * Manual lines replace the traced length for that edge type.
 * A type with no drawn line keeps the traced length.
 * Drip edge is not a traced edge; until someone draws it, it is eave + rake.
 */
export function resolveEdgeTotals(graphTotals = {}, manualTotals = {}) {
  const used = {};
  for (const type of ['ridge', 'hip', 'valley', 'rake', 'eave', 'step_flashing']) {
    const manual = Number(manualTotals[type]) || 0;
    const auto = Number(graphTotals[type]) || 0;
    used[type] = manual > 0 ? manual : auto;
  }
  const manualDrip = Number(manualTotals.drip_edge) || 0;
  used.drip_edge = manualDrip > 0 ? manualDrip : (used.eave || 0) + (used.rake || 0);
  used.drip_edge_source = manualDrip > 0 ? 'manual' : 'eave_plus_rake';
  return used;
}

/** Quantity the estimate uses for drip edge. A traced payload already resolved it. */
export function estimateDripEdgeLf(measurements) {
  if (measurements && measurements.drip_edge_lf != null && measurements.drip_edge_lf !== '') {
    const drawn = Number(measurements.drip_edge_lf);
    if (Number.isFinite(drawn)) return Math.round(drawn * 100) / 100;
  }
  const rake = Number(measurements?.rake_lf) || 0;
  const eave = Number(measurements?.eave_lf) || 0;
  return Math.round((rake + eave) * 100) / 100;
}

/** Sum one facet's classified edges. Shared edges are included in full. */
export function sumFacetEdgeLengths(edges) {
  const totals = { ridge: 0, hip: 0, valley: 0, rake: 0, eave: 0, step_flashing: 0 };
  for (const edge of edges || []) {
    const type = edge?.type;
    if (totals[type] == null) continue;
    totals[type] += Number(edge.length_ft) || 0;
  }
  return totals;
}
