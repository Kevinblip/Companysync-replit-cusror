/**
 * footprintPolygon.js — true building outlines, no rectangle approximations.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The siding engine used to collapse every satellite footprint into a single
 * rectangle sized by `sqrt(area × aspect)` and then shrink it by a magic 0.925.
 * On an L-shaped house that understates the wall perimeter by ~20%, because a
 * rectangle of the same plan area has far less wall than a house with a wing.
 *
 * OSM traces a real building outline, so that path was already honest. Google's
 * Solar API does NOT return a building outline — it returns one axis-aligned
 * bounding box for the whole building plus a bounding box per roof segment.
 * The union of those roof-segment boxes *is* the roof plan, and the roof plan
 * inset by the eave overhang is the wall footprint. That is what this module
 * reconstructs.
 *
 * APPROACH
 * ────────
 * Rasterise the facet rectangles onto a grid, close pinhole seams between
 * adjacent facets, fill interior holes, erode by the eave overhang, keep the
 * largest connected mass, trace its boundary, and simplify.
 *
 * The grid is first rotated onto the building's dominant facet azimuth. Without
 * that, a house sitting at 30° to true north traces as a staircase and its
 * perimeter inflates by up to 41%. Rotating the grid onto the walls makes the
 * common case exact and leaves only genuinely diagonal walls approximated.
 *
 * Every coordinate here is [east_ft, north_ft] relative to the building
 * centroid — the same local-feet space `roofFacetGeometry.js` emits and
 * `HouseModel3D` consumes.
 */

const EPS = 1e-9;

/**
 * Eave overhang used to step from the roof plan in to the wall line.
 * LOCKSTEP: must match DEFAULT_OVERHANG_FT in src/utils/sidingDerivedQuantities.js,
 * which drives soffit/fascia quantities off the same assumption. Asserted by
 * scripts/test-footprint-polygon.cjs.
 */
export const DEFAULT_EAVE_OVERHANG_FT = 1.5;

/**
 * Decide whether a traced Solar outline may replace a crude OSM footprint.
 *
 * This override exists to preserve articulated geometry (wings and jogs), not
 * to infer a materially larger wall line from roof edges. Because siding gross
 * area is perimeter × wall height, both independent footprint sources must
 * agree within 10% before the traced outline may change the billed perimeter.
 */
export function isPerimeterSafeOsmGeometryOverride({
  osmPerimeterFt,
  candidatePerimeterFt,
  candidateGeometry,
  maxDifferenceRatio = 0.10,
} = {}) {
  const osm = Number(osmPerimeterFt);
  const candidate = Number(candidatePerimeterFt);
  const tolerance = Number(maxDifferenceRatio);
  if (candidateGeometry !== 'traced_polygon') return false;
  if (!(osm > 0) || !(candidate > 0)) return false;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance >= 1) return false;
  return candidate >= osm * (1 - tolerance)
    && candidate <= osm * (1 + tolerance);
}

// ── Basic polygon measures ───────────────────────────────────────────────────

/** Perimeter of a closed ring [[x,y], …] in feet. */
export function polygonPerimeterFt(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    total += Math.hypot(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1]));
  }
  return total;
}

/** Absolute shoelace area of a closed ring, in square feet. */
export function polygonAreaFt2(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (!a || !b) continue;
    sum += Number(a[0]) * Number(b[1]) - Number(b[0]) * Number(a[1]);
  }
  return Math.abs(sum) / 2;
}

/** Bounding box + long/short span of a ring. */
export function polygonBBoxDims(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    const x = Number(p?.[0]), y = Number(p?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  return {
    minX, maxX, minY, maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    lengthFt: Math.max(spanX, spanY),
    widthFt: Math.min(spanX, spanY),
  };
}

/**
 * A centred axis-aligned rectangle as a real polygon.
 * Used so that EVERY footprint source hands downstream code a polygon and a
 * perimeter measured off that polygon — the rectangle case is then simply the
 * degenerate outline, not a separate code path with its own arithmetic.
 */
export function rectanglePolygon(lengthFt, widthFt) {
  const L = Number(lengthFt), W = Number(widthFt);
  if (!(L > 0) || !(W > 0)) return null;
  const hx = L / 2, hy = W / 2;
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
}

/**
 * Resize a polygon about its own centroid so its perimeter equals a measured
 * one, keeping every corner.
 *
 * A measured perimeter (a roof-eave line, or a number the contractor typed) is
 * a better NUMBER than a traced outline, but it is only a number — it says
 * nothing about shape. Scaling preserves the wings and jogs we traced instead
 * of collapsing the house back into a rectangle, and guarantees the polygon's
 * own perimeter agrees with the perimeter reported alongside it.
 */
export function scalePolygonToPerimeter(poly, targetPerimeterFt) {
  const target = Number(targetPerimeterFt);
  if (!Array.isArray(poly) || poly.length < 3 || !(target > 0)) return null;
  const current = polygonPerimeterFt(poly);
  if (!(current > 0)) return null;
  const k = target / current;
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map(([x, y]) => [
    Math.round((cx + (x - cx) * k) * 100) / 100,
    Math.round((cy + (y - cy) * k) * 100) / 100,
  ]);
}

// ── Ring simplification ──────────────────────────────────────────────────────

function perpDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker on an open polyline. */
function dpLine(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let maxD = -1, idx = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistance(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const left = dpLine(pts.slice(0, idx + 1), eps);
  const right = dpLine(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/**
 * Douglas–Peucker for a closed ring. Splitting at the two extreme points first
 * avoids the classic bug where running DP on a ring "opened" at an arbitrary
 * vertex shaves the corner sitting at the seam.
 */
function simplifyRing(ring, eps) {
  if (ring.length < 4) return ring.slice();
  let far = 1, farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const partA = dpLine(ring.slice(0, far + 1), eps);
  const partB = dpLine(ring.slice(far).concat([ring[0]]), eps);
  const merged = partA.slice(0, -1).concat(partB.slice(0, -1));
  return merged.length >= 3 ? merged : ring.slice();
}

/** Drop vertices that sit on (or within `tolFt` of) the line through their neighbours. */
function dropCollinear(ring, tolFt = 0.05) {
  if (ring.length < 4) return ring.slice();
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length];
    const cur = ring[i];
    const next = ring[(i + 1) % ring.length];
    if (perpDistance(cur, prev, next) > tolFt) out.push(cur);
  }
  return out.length >= 3 ? out : ring.slice();
}

// ── Raster helpers ───────────────────────────────────────────────────────────

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > py) !== (yj > py)) {
      const denom = (yj - yi) || EPS;
      if (px < (xj - xi) * (py - yi) / denom + xi) inside = !inside;
    }
  }
  return inside;
}

function dilate(grid, nx, ny, r) {
  let cur = grid;
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(cur.length);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!cur[j * nx + i]) continue;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const y = j + dj, x = i + di;
            if (x >= 0 && x < nx && y >= 0 && y < ny) next[y * nx + x] = 1;
          }
        }
      }
    }
    cur = next;
  }
  return cur;
}

function erode(grid, nx, ny, r) {
  let cur = grid;
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(cur.length);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!cur[j * nx + i]) continue;
        let keep = true;
        for (let dj = -1; dj <= 1 && keep; dj++) {
          for (let di = -1; di <= 1 && keep; di++) {
            const y = j + dj, x = i + di;
            // Cells on the grid border have no neighbour, so treat outside as empty.
            if (x < 0 || x >= nx || y < 0 || y >= ny || !cur[y * nx + x]) keep = false;
          }
        }
        if (keep) next[j * nx + i] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

/** Fill enclosed voids (seams between facets that the close pass didn't bridge). */
function fillHoles(grid, nx, ny) {
  const outside = new Uint8Array(grid.length);
  const stack = [];
  for (let i = 0; i < nx; i++) {
    for (const j of [0, ny - 1]) {
      const k = j * nx + i;
      if (!grid[k] && !outside[k]) { outside[k] = 1; stack.push(k); }
    }
  }
  for (let j = 0; j < ny; j++) {
    for (const i of [0, nx - 1]) {
      const k = j * nx + i;
      if (!grid[k] && !outside[k]) { outside[k] = 1; stack.push(k); }
    }
  }
  while (stack.length) {
    const k = stack.pop();
    const i = k % nx, j = (k - i) / nx;
    const nbrs = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
    for (const [x, y] of nbrs) {
      if (x < 0 || x >= nx || y < 0 || y >= ny) continue;
      const kk = y * nx + x;
      if (!grid[kk] && !outside[kk]) { outside[kk] = 1; stack.push(kk); }
    }
  }
  const out = new Uint8Array(grid);
  for (let k = 0; k < grid.length; k++) if (!grid[k] && !outside[k]) out[k] = 1;
  return out;
}

/** Keep only the largest 4-connected mass; report how many cells were discarded. */
function largestComponent(grid, nx, ny) {
  const label = new Int32Array(grid.length).fill(-1);
  let best = -1, bestSize = 0, totalKept = 0, id = 0;
  const sizes = [];
  for (let start = 0; start < grid.length; start++) {
    if (!grid[start] || label[start] >= 0) continue;
    const stack = [start];
    label[start] = id;
    let size = 0;
    while (stack.length) {
      const k = stack.pop();
      size++;
      const i = k % nx, j = (k - i) / nx;
      const nbrs = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
      for (const [x, y] of nbrs) {
        if (x < 0 || x >= nx || y < 0 || y >= ny) continue;
        const kk = y * nx + x;
        if (grid[kk] && label[kk] < 0) { label[kk] = id; stack.push(kk); }
      }
    }
    sizes.push(size);
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  if (best < 0) return null;
  const out = new Uint8Array(grid.length);
  for (let k = 0; k < grid.length; k++) {
    if (label[k] === best) { out[k] = 1; totalKept++; }
  }
  const dropped = sizes.reduce((s, v) => s + v, 0) - totalKept;
  return { grid: out, keptCells: totalKept, droppedCells: dropped, components: sizes.length };
}

/**
 * Trace the outer boundary of a filled raster as a closed ring of grid-corner
 * indices. Emits each exposed cell side as a directed edge with the interior on
 * its left, then stitches the edges head-to-tail.
 */
function traceOutline(grid, nx, ny) {
  const key = (i, j) => i + j * (nx + 1);
  const edges = new Map(); // startKey -> array of [startIJ, endIJ]
  const push = (a, b) => {
    const k = key(a[0], a[1]);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([a, b]);
  };
  const filled = (i, j) => i >= 0 && i < nx && j >= 0 && j < ny && grid[j * nx + i];

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!grid[j * nx + i]) continue;
      const A = [i, j], B = [i + 1, j], C = [i + 1, j + 1], D = [i, j + 1];
      if (!filled(i, j - 1)) push(A, B); // bottom
      if (!filled(i + 1, j)) push(B, C); // right
      if (!filled(i, j + 1)) push(C, D); // top
      if (!filled(i - 1, j)) push(D, A); // left
    }
  }
  if (edges.size === 0) return null;

  let bestLoop = null;
  for (const [, list] of edges) {
    while (list.length) {
      const first = list.pop();
      const loop = [first[0]];
      let cur = first[1];
      let guard = 0;
      const limit = nx * ny * 4 + 16;
      while (guard++ < limit) {
        const k = key(cur[0], cur[1]);
        const opts = edges.get(k);
        if (!opts || opts.length === 0) break;
        const nxt = opts.pop();
        loop.push(nxt[0]);
        cur = nxt[1];
        if (cur[0] === first[0][0] && cur[1] === first[0][1]) break;
      }
      if (loop.length >= 4 && (!bestLoop || loop.length > bestLoop.length)) bestLoop = loop;
    }
  }
  return bestLoop;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Reconstruct a building footprint outline from Google Solar roof facets.
 *
 * @param {Array} facets  output of buildRoofFacetsFromSolarSegments — each with
 *                        `polygon: [{x, y, h}, …]` in local feet and
 *                        `azimuth_degrees` / `area_sqft`.
 * @param {object} [opts]
 * @param {number} [opts.overhangFt=1.5]  eave overhang; the roof plan is inset
 *                                        by this to reach the wall line.
 * @param {number} [opts.cellFt=0.5]      raster resolution.
 * @param {number} [opts.simplifyFt=1.0]  Douglas–Peucker tolerance.
 * @param {number} [opts.maxCells=400000] auto-coarsens the grid beyond this.
 * @param {number} [opts.maxDiscardRatio=0.15] fail closed (return null) when
 *                 keeping the largest component would throw away more than this
 *                 share of the eroded mass — see the severed-wing note below.
 * @returns {null|{polygon, perimeter_ft, area_sqft, length_ft, width_ft,
 *                 vertices, rotation_deg, cell_ft, dropped_components, source}}
 */
export function buildFootprintFromFacets(facets, opts = {}) {
  const overhangFt = Number(opts.overhangFt) >= 0 ? Number(opts.overhangFt) : 1.5;
  const simplifyFt = Number(opts.simplifyFt) > 0 ? Number(opts.simplifyFt) : 1.0;
  const maxCells = Number(opts.maxCells) > 0 ? Number(opts.maxCells) : 400000;
  const maxDiscardRatio = Number(opts.maxDiscardRatio) >= 0
    ? Number(opts.maxDiscardRatio) : 0.15;
  let cellFt = Number(opts.cellFt) > 0 ? Number(opts.cellFt) : 0.5;

  // 1. Collect facet rings and the area-weighted dominant wall orientation.
  const rings = [];
  let wsum = 0, ax = 0, ay = 0;
  for (const f of Array.isArray(facets) ? facets : []) {
    const pts = Array.isArray(f?.polygon) ? f.polygon : null;
    if (!pts || pts.length < 3) continue;
    const ring = [];
    for (const p of pts) {
      const x = Number(p?.x), y = Number(p?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
    }
    if (ring.length < 3) continue;
    rings.push(ring);
    // Building orientation repeats every 90°, so fold the azimuth into a
    // quarter turn and average it on the 4θ circle.
    const w = Number(f.area_sqft) > 0 ? Number(f.area_sqft) : 1;
    const theta = (((Number(f.azimuth_degrees) || 0) % 90) + 90) % 90 * Math.PI / 180;
    ax += Math.cos(4 * theta) * w;
    ay += Math.sin(4 * theta) * w;
    wsum += w;
  }
  if (rings.length === 0) return null;

  const rot = wsum > 0 ? Math.atan2(ay, ax) / 4 : 0;

  // 2. Rotate onto the dominant orientation so walls land on grid axes.
  const cs = Math.cos(-rot), sn = Math.sin(-rot);
  const rotated = rings.map(r => r.map(([x, y]) => [x * cs - y * sn, x * sn + y * cs]));

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of rotated) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || maxX - minX < 1 || maxY - minY < 1) return null;

  const pad = Math.max(2, overhangFt + 1);
  const x0 = minX - pad, y0 = minY - pad;
  const spanX = (maxX - minX) + pad * 2;
  const spanY = (maxY - minY) + pad * 2;

  // Coarsen rather than blow up memory on an implausibly large building.
  while ((spanX / cellFt) * (spanY / cellFt) > maxCells) cellFt *= 2;
  const nx = Math.ceil(spanX / cellFt);
  const ny = Math.ceil(spanY / cellFt);
  if (nx < 4 || ny < 4) return null;

  // 3. Rasterise the union of the facet rectangles.
  let grid = new Uint8Array(nx * ny);
  for (const ring of rotated) {
    let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMaxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < rMinX) rMinX = x;
      if (x > rMaxX) rMaxX = x;
      if (y < rMinY) rMinY = y;
      if (y > rMaxY) rMaxY = y;
    }
    const i0 = Math.max(0, Math.floor((rMinX - x0) / cellFt) - 1);
    const i1 = Math.min(nx - 1, Math.ceil((rMaxX - x0) / cellFt) + 1);
    const j0 = Math.max(0, Math.floor((rMinY - y0) / cellFt) - 1);
    const j1 = Math.min(ny - 1, Math.ceil((rMaxY - y0) / cellFt) + 1);
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * cellFt;
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (grid[k]) continue;
        if (pointInRing(x0 + (i + 0.5) * cellFt, py, ring)) grid[k] = 1;
      }
    }
  }

  // 4. Close hairline seams between abutting facets, then fill any voids left.
  const closeR = Math.max(1, Math.round(0.75 / cellFt));
  grid = erode(dilate(grid, nx, ny, closeR), nx, ny, closeR);
  grid = fillHoles(grid, nx, ny);

  // 5. Inset the roof plan by the eave overhang to reach the wall line.
  const erodeR = Math.round(overhangFt / cellFt);
  if (erodeR > 0) grid = erode(grid, nx, ny, erodeR);

  const comp = largestComponent(grid, nx, ny);
  if (!comp || comp.keptCells < 16) return null;

  // Eroding by the overhang can SEVER a narrow attached wing (a breezeway, a
  // one-car garage neck). Keeping the largest component then quietly amputates
  // a real part of the house and still hands back a confident-looking outline.
  // From the raster alone we cannot tell "detached shed" from "severed wing",
  // so above a small discard we fail closed and let the caller fall back
  // deliberately rather than measure a building that is missing a wing.
  const totalCells = comp.keptCells + comp.droppedCells;
  const discardedRatio = totalCells > 0 ? comp.droppedCells / totalCells : 0;
  if (discardedRatio > maxDiscardRatio) return null;

  // 6. Trace and simplify.
  const loop = traceOutline(comp.grid, nx, ny);
  if (!loop || loop.length < 4) return null;

  let ring = loop.map(([i, j]) => [x0 + i * cellFt, y0 + j * cellFt]);
  ring = dropCollinear(ring, cellFt * 0.1);
  ring = simplifyRing(ring, simplifyFt);
  ring = dropCollinear(ring, cellFt * 0.5);
  if (ring.length < 4) return null;

  // 7. Rotate back into east/north local feet.
  const bc = Math.cos(rot), bs = Math.sin(rot);
  const polygon = ring.map(([x, y]) => [
    Math.round((x * bc - y * bs) * 100) / 100,
    Math.round((x * bs + y * bc) * 100) / 100,
  ]);

  const area = polygonAreaFt2(polygon);
  const perimeter = polygonPerimeterFt(polygon);
  if (!(area > 100) || !(perimeter > 40)) return null;

  const dims = polygonBBoxDims(polygon);
  return {
    polygon,
    perimeter_ft: Math.round(perimeter),
    area_sqft: Math.round(area),
    length_ft: Math.round(dims.lengthFt),
    width_ft: Math.round(dims.widthFt),
    vertices: polygon.length,
    rotation_deg: Math.round((rot * 180 / Math.PI) * 10) / 10,
    cell_ft: cellFt,
    dropped_components: Math.max(0, (comp.components || 1) - 1),
    source: 'solar_facet_union',
  };
}

export default buildFootprintFromFacets;
