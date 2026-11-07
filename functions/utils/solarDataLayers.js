/**
 * Trace roof facets from a Google Solar dataLayers DSM + mask.
 *
 * Rasters stay in memory. The return value is the compact derived measurement
 * (polygons, linears, per-pitch areas) — a few KB — never the GeoTIFF.
 */

import { inflateSync } from 'node:zlib';

const M2FT = 3.280839895;
const SQFT_PER_M2 = 10.76391041671;

function yieldTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function solve3(A, b) {
  const m = [
    [A[0], A[1], A[2], b[0]],
    [A[3], A[4], A[5], b[1]],
    [A[6], A[7], A[8], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) { const tmp = m[col]; m[col] = m[pivot]; m[pivot] = tmp; }
    const div = m[col][col];
    for (let c = col; c < 4; c++) m[col][c] /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

function fitPlane(points, dem, width) {
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sz = 0, szx = 0, szy = 0, n = 0;
  const step = Math.max(1, Math.floor(points.length / 240));
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    const x = (p % width) * 0.1;
    const y = -Math.floor(p / width) * 0.1;
    const z = dem[p];
    sxx += x * x; sxy += x * y; sx += x;
    syy += y * y; sy += y; sz += z;
    szx += z * x; szy += z * y; n++;
  }
  if (n < 6) return null;
  return solve3(
    [sxx, sxy, sx, sxy, syy, sy, sx, sy, n],
    [szx, szy, sz],
  );
}

function azimuthOf(a, b) {
  return (Math.atan2(-a, -b) * 180 / Math.PI + 360) % 360;
}

function angDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function pitchRise(slope) {
  return Math.max(1, Math.min(18, Math.round(slope * 12)));
}

/**
 * Decode a Solar dataLayers GeoTIFF (big-endian, tiled, zlib) into a raster.
 * Supports float32 DSM and uint8 mask, which is what dataLayers returns.
 */
export function decodeSolarGeotiff(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 16 || buf.toString('ascii', 0, 2) !== 'MM' || buf.readUInt16BE(2) !== 42) {
    throw new Error('Solar raster is not a big-endian GeoTIFF');
  }
  const view = buf;
  const ifd = view.readUInt32BE(4);
  const n = view.readUInt16BE(ifd);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const off = ifd + 2 + i * 12;
    tags.set(view.readUInt16BE(off), {
      type: view.readUInt16BE(off + 2),
      count: view.readUInt32BE(off + 4),
      value: view.readUInt32BE(off + 8),
    });
  }
  const sizeOf = { 1: 1, 3: 2, 4: 4, 12: 8 };
  function values(tag) {
    const entry = tags.get(tag);
    if (!entry) return null;
    const sz = sizeOf[entry.type] * entry.count;
    const start = sz <= 4 ? null : entry.value;
    const out = [];
    for (let i = 0; i < entry.count; i++) {
      const at = start == null ? (ifd + 2 + [...tags.keys()].indexOf(tag) * 12 + 8) : start;
      // value bytes live in the 4-byte field when they fit
      const pos = start == null
        ? (ifd + 2 + tagIndex(tag) * 12 + 8 + i * sizeOf[entry.type])
        : start + i * sizeOf[entry.type];
      if (entry.type === 3) out.push(view.readUInt16BE(pos));
      else if (entry.type === 4) out.push(view.readUInt32BE(pos));
      else if (entry.type === 1) out.push(view[pos]);
      else if (entry.type === 12) out.push(view.readDoubleBE(pos));
    }
    return out;
  }
  function tagIndex(tag) {
    let i = 0;
    for (const key of tags.keys()) {
      if (key === tag) return i;
      i++;
    }
    return 0;
  }
  const width = values(256)[0];
  const height = values(257)[0];
  const bps = values(258)[0];
  const compression = values(259)[0];
  if (compression !== 32946 && compression !== 8) {
    throw new Error(`Unsupported Solar TIFF compression ${compression}`);
  }
  const tw = values(322)?.[0];
  const th = values(323)?.[0];
  if (!tw || !th) throw new Error('Solar TIFF is not tiled');
  const offsets = values(324);
  const counts = values(325);
  const sampleFormat = values(339)?.[0] || (bps === 32 ? 3 : 1);
  const transform = values(34264);
  const pixelSize = transform ? Math.abs(transform[0]) || 0.1 : 0.1;
  const tilesX = Math.ceil(width / tw);
  const tilesY = Math.ceil(height / th);
  const data = bps === 32 ? new Float64Array(width * height) : new Uint8Array(width * height);
  let idx = 0;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const raw = inflateSync(buf.subarray(offsets[idx], offsets[idx] + counts[idx]));
      const tileView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const y0 = ty * th;
      const x0 = tx * tw;
      const y1 = Math.min(y0 + th, height);
      const x1 = Math.min(x0 + tw, width);
      for (let row = 0; row < y1 - y0; row++) {
        for (let col = 0; col < x1 - x0; col++) {
          const src = (row * tw + col) * (bps / 8);
          const dest = (y0 + row) * width + (x0 + col);
          if (bps === 32 && sampleFormat === 3) data[dest] = tileView.getFloat32(src, false);
          else data[dest] = raw[src];
        }
      }
      idx++;
    }
  }
  return { width, height, data, pixelSize, sampleFormat };
}

function cropToCenterBuilding(mask, dsm, width, height) {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  let seed = cy * width + cx;
  if (!mask[seed]) {
    let best = Infinity;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const y = Math.floor(i / width);
      const x = i - y * width;
      const d = (y - cy) ** 2 + (x - cx) ** 2;
      if (d < best) { best = d; seed = i; }
    }
  }
  const seen = new Uint8Array(mask.length);
  const stack = [seed];
  seen[seed] = 1;
  const cells = [seed];
  while (stack.length) {
    const cur = stack.pop();
    const y = Math.floor(cur / width);
    const x = cur - y * width;
    const nbs = [cur - 1, cur + 1, cur - width, cur + width];
    const xs = [x - 1, x + 1, x, x];
    const ys = [y, y, y - 1, y + 1];
    for (let k = 0; k < 4; k++) {
      const nx = xs[k];
      const ny = ys[k];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = nbs[k];
      if (mask[ni] && !seen[ni]) {
        seen[ni] = 1;
        stack.push(ni);
        cells.push(ni);
      }
    }
  }
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (const i of cells) {
    const y = Math.floor(i / width);
    const x = i - y * width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const roof = new Uint8Array(w * h);
  const dem = new Float64Array(w * h);
  for (const i of cells) {
    const y = Math.floor(i / width);
    const x = i - y * width;
    const di = (y - minY) * w + (x - minX);
    roof[di] = 1;
    dem[di] = dsm[i];
  }
  return { roof, dem, width: w, height: h };
}

function smooth(dem, roof, width, height) {
  const out = Float64Array.from(dem);
  const vals = new Float64Array(9);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (!roof[i]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = (y + dy) * width + (x + dx);
          if (roof[j]) vals[n++] = dem[j];
        }
      }
      if (n >= 5) {
        const slice = Array.from(vals.subarray(0, n)).sort((a, b) => a - b);
        out[i] = slice[n >> 1];
      }
    }
  }
  return out;
}

async function segment(roof, dem, width, height) {
  const labels = new Int32Array(roof.length);
  const order = [];
  const cy = height / 2, cx = width / 2;
  for (let i = 0; i < roof.length; i++) if (roof[i]) order.push(i);
  order.sort((a, b) => {
    const ay = Math.floor(a / width), ax = a - ay * width;
    const by = Math.floor(b / width), bx = b - by * width;
    return ((ay - cy) ** 2 + (ax - cx) ** 2) - ((by - cy) ** 2 + (bx - cx) ** 2);
  });
  let lid = 0;
  let steps = 0;
  const zTol = 0.28;
  const minPx = 120;
  for (const seed of order) {
    if (labels[seed]) continue;
    if ((++steps % 2500) === 0) await yieldTick();
    const sy = Math.floor(seed / width);
    const sx = seed - sy * width;
    const pts = [];
    for (let y = Math.max(0, sy - 4); y <= Math.min(height - 1, sy + 4); y++) {
      for (let x = Math.max(0, sx - 4); x <= Math.min(width - 1, sx + 4); x++) {
        const i = y * width + x;
        if (roof[i]) pts.push(i);
      }
    }
    if (pts.length < 15) { labels[seed] = -1; continue; }
    let plane = fitPlane(pts, dem, width);
    if (!plane) { labels[seed] = -1; continue; }
    let [a, b, c] = plane;
    const slope = Math.hypot(a, b);
    if (slope < 0.08 || slope > 1.8) { labels[seed] = -1; continue; }
    lid++;
    const cells = [seed];
    const stack = [seed];
    labels[seed] = lid;
    while (stack.length) {
      const cur = stack.pop();
      const y = Math.floor(cur / width);
      const x = cur - y * width;
      const nbs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of nbs) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (!roof[ni] || labels[ni]) continue;
        const zhat = a * (nx * 0.1) + b * (-ny * 0.1) + c;
        if (Math.abs(dem[ni] - zhat) > zTol) continue;
        labels[ni] = lid;
        stack.push(ni);
        cells.push(ni);
        if (cells.length % 250 === 0 && cells.length >= 80) {
          const refit = fitPlane(cells, dem, width);
          if (refit) [a, b, c] = refit;
        }
      }
    }
    if (cells.length < minPx) {
      for (const p of cells) labels[p] = -1;
      lid--;
    }
  }
  return labels;
}

function mergeCoplanar(labels, dem, width, height) {
  const ids = [];
  for (let i = 1; i <= labels.reduce((m, v) => Math.max(m, v), 0); i++) ids.push(i);
  const present = ids.filter((id) => {
    for (let i = 0; i < labels.length; i++) if (labels[i] === id) return true;
    return false;
  });
  const pointsOf = (id) => {
    const pts = [];
    for (let i = 0; i < labels.length; i++) if (labels[i] === id) pts.push(i);
    return pts;
  };
  const planes = new Map();
  for (const id of present) {
    const pts = pointsOf(id);
    const plane = fitPlane(pts, dem, width);
    if (plane) planes.set(id, { plane, n: pts.length, pts });
  }
  const parent = new Map([...planes.keys()].map((id) => [id, id]));
  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const keys = [...planes.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const A = planes.get(keys[i]);
      const B = planes.get(keys[j]);
      if (angDiff(azimuthOf(A.plane[0], A.plane[1]), azimuthOf(B.plane[0], B.plane[1])) > 16) continue;
      const err = (plane, pts) => {
        let s = 0, n = 0;
        const step = Math.max(1, Math.floor(pts.length / 40));
        for (let k = 0; k < pts.length; k += step) {
          const p = pts[k];
          const x = (p % width) * 0.1;
          const y = -Math.floor(p / width) * 0.1;
          s += Math.abs(dem[p] - (plane[0] * x + plane[1] * y + plane[2]));
          n++;
        }
        return s / (n || 1);
      };
      if (err(A.plane, B.pts) < 0.4 && err(B.plane, A.pts) < 0.4) {
        const ra = find(keys[i]);
        const rb = find(keys[j]);
        if (ra !== rb) parent.set(rb, ra);
      }
    }
  }
  // also merge directly adjacent facets within 18° of azimuth
  const adj = new Set();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = labels[y * width + x];
      if (a <= 0) continue;
      if (x + 1 < width) {
        const b = labels[y * width + x + 1];
        if (b > 0 && b !== a) adj.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
      if (y + 1 < height) {
        const b = labels[(y + 1) * width + x];
        if (b > 0 && b !== a) adj.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
    }
  }
  for (const pair of adj) {
    const [sa, sb] = pair.split('|').map(Number);
    if (!planes.has(sa) || !planes.has(sb)) continue;
    const da = angDiff(
      azimuthOf(planes.get(sa).plane[0], planes.get(sa).plane[1]),
      azimuthOf(planes.get(sb).plane[0], planes.get(sb).plane[1]),
    );
    if (da <= 18) {
      const ra = find(sa);
      const rb = find(sb);
      if (ra !== rb) parent.set(rb, ra);
    }
  }
  const rootTo = new Map();
  let nid = 0;
  const remap = new Map();
  for (const id of planes.keys()) {
    const r = find(id);
    if (!rootTo.has(r)) rootTo.set(r, ++nid);
    remap.set(id, rootTo.get(r));
  }
  const out = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] > 0 && remap.has(labels[i])) out[i] = remap.get(labels[i]);
  }
  const merged = new Map();
  for (let id = 1; id <= nid; id++) {
    const pts = [];
    for (let i = 0; i < out.length; i++) if (out[i] === id) pts.push(i);
    if (pts.length < 80) {
      for (const p of pts) out[p] = 0;
      continue;
    }
    const plane = fitPlane(pts, dem, width);
    if (!plane) continue;
    merged.set(id, { plane, n: pts.length });
  }
  return { labels: out, planes: merged };
}

function sharedBoundaries(labels, width, height) {
  const buckets = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = labels[y * width + x];
      if (a <= 0) continue;
      if (x + 1 < width) {
        const b = labels[y * width + x + 1];
        if (b > 0 && b !== a) pushPair(buckets, a, b, x * 0.1, -y * 0.1);
      }
      if (y + 1 < height) {
        const b = labels[(y + 1) * width + x];
        if (b > 0 && b !== a) pushPair(buckets, a, b, x * 0.1, -y * 0.1);
      }
    }
  }
  return buckets;
}

function pushPair(buckets, a, b, x, y) {
  const i = Math.min(a, b);
  const j = Math.max(a, b);
  const key = `${i}|${j}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push([x, y]);
}

function svd2(points) {
  let mx = 0, my = 0;
  for (const p of points) { mx += p[0]; my += p[1]; }
  mx /= points.length; my /= points.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, tr * tr / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  let vx = sxy;
  let vy = l1 - sxx;
  if (Math.abs(vx) + Math.abs(vy) < 1e-9) { vx = l1 - syy; vy = sxy; }
  const n = Math.hypot(vx, vy) || 1;
  return { mx, my, dx: vx / n, dy: vy / n };
}

function classifyShared(diff) {
  if (diff < 28) return 'valley';
  if (diff > 150) return 'ridge';
  return 'hip';
}

function measureShared(labels, planes, width, height) {
  const buckets = sharedBoundaries(labels, width, height);
  const totals = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 };
  const counts = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 };
  const edges = [];
  for (const [key, pts] of buckets) {
    const [si, sj] = key.split('|').map(Number);
    const A = planes.get(si);
    const B = planes.get(sj);
    if (!A || !B) continue;
    const [a1, b1, c1] = A.plane;
    const [a2, b2, c2] = B.plane;
    const kept = pts.filter(([x, y]) => Math.abs((a1 * x + b1 * y + c1) - (a2 * x + b2 * y + c2)) <= 0.55);
    if (kept.length < 12) continue;
    const line = svd2(kept);
    const nx = -line.dy, ny = line.dx;
    const inliers = kept.filter(([x, y]) => Math.abs((x - line.mx) * nx + (y - line.my) * ny) <= 0.30);
    if (inliers.length < 12) continue;
    const ts = inliers.map(([x, y]) => (x - line.mx) * line.dx + (y - line.my) * line.dy).sort((p, q) => p - q);
    const lo = ts[Math.floor(ts.length * 0.05)];
    const hi = ts[Math.min(ts.length - 1, Math.ceil(ts.length * 0.95) - 1)];
    const plan = hi - lo;
    if (!(plan >= 1)) continue;
    const slopeAlong = a1 * line.dx + b1 * line.dy;
    const lengthFt = plan * Math.sqrt(1 + slopeAlong * slopeAlong) * M2FT;
    const diff = angDiff(azimuthOf(a1, b1), azimuthOf(a2, b2));
    const kind = classifyShared(diff);
    totals[kind] += lengthFt;
    counts[kind] += 1;
    const z1 = a1 * line.mx + b1 * line.my + c1;
    const z2 = z1 + slopeAlong * plan;
    edges.push({
      type: kind,
      length_ft: round1(lengthFt),
      facet_a: si,
      facet_b: sj,
      x1: round1((line.mx + line.dx * lo) * M2FT),
      y1: round1((line.my + line.dy * lo) * M2FT),
      z1: round1(z1 * M2FT),
      x2: round1((line.mx + line.dx * hi) * M2FT),
      y2: round1((line.my + line.dy * hi) * M2FT),
      z2: round1(z2 * M2FT),
    });
  }
  return { totals, counts, edges };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function simplify(points, tol) {
  if (points.length < 3) return points;
  function dp(pts) {
    if (pts.length < 3) return pts;
    const [ax, ay] = pts[0];
    const [bx, by] = pts[pts.length - 1];
    const dx = bx - ax, dy = by - ay;
    const den = Math.hypot(dx, dy) || 1;
    let best = 0, bi = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / den;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol && bi > 0) return dp(pts.slice(0, bi + 1)).slice(0, -1).concat(dp(pts.slice(bi)));
    return [pts[0], pts[pts.length - 1]];
  }
  return dp(points);
}

function simplifyClosed(points, tol) {
  let core = points;
  if (points.length > 2
    && points[0][0] === points[points.length - 1][0]
    && points[0][1] === points[points.length - 1][1]) {
    core = points.slice(0, -1);
  }
  if (core.length < 4) return core;
  const open = simplify(core, tol);
  if (open.length && (open[0][0] !== open[open.length - 1][0] || open[0][1] !== open[open.length - 1][1])) {
    open.push(open[0]);
  }
  return open;
}

function fillNearFacets(labels, roof, width, height, maxDist) {
  const dist = new Int16Array(labels.length);
  dist.fill(99);
  const q = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] > 0) { dist[i] = 0; q.push(i); }
  }
  let qi = 0;
  while (qi < q.length) {
    const cur = q[qi++];
    if (dist[cur] >= maxDist) continue;
    const y = Math.floor(cur / width);
    const x = cur - y * width;
    const nbs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of nbs) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (!roof[ni] || labels[ni] > 0) continue;
      if (dist[ni] > dist[cur] + 1) {
        dist[ni] = dist[cur] + 1;
        labels[ni] = labels[cur];
        q.push(ni);
      }
    }
  }
}

function refitPlanes(planes, labels, dem, width) {
  for (const [id, info] of planes) {
    const pts = [];
    for (let i = 0; i < labels.length; i++) if (labels[i] === id) pts.push(i);
    const plane = fitPlane(pts, dem, width);
    if (plane) {
      info.plane = plane;
      info.n = pts.length;
    }
  }
}

function facetRings(labels, width, height) {
  const next = new Map();
  function add(x1, y1, x2, y2, left) {
    const k = `${x1},${y1},${left}`;
    if (!next.has(k)) next.set(k, []);
    next.get(k).push([x2, y2]);
  }
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const lab = labels[r * width + c];
      if (lab <= 0) continue;
      const up = r ? labels[(r - 1) * width + c] : 0;
      const dn = r + 1 < height ? labels[(r + 1) * width + c] : 0;
      const lf = c ? labels[r * width + c - 1] : 0;
      const rt = c + 1 < width ? labels[r * width + c + 1] : 0;
      if (up !== lab) add(c + 1, r, c, r, lab);
      if (rt !== lab) add(c + 1, r + 1, c + 1, r, lab);
      if (dn !== lab) add(c, r + 1, c + 1, r + 1, lab);
      if (lf !== lab) add(c, r, c, r + 1, lab);
    }
  }
  const rings = new Map();
  const used = new Set();
  for (const [k, ends] of next) {
    for (const end of ends) {
      const startKey = k;
      const edgeKey = `${k}>${end[0]},${end[1]}`;
      if (used.has(edgeKey)) continue;
      const [, , leftStr] = k.split(',');
      const left = Number(leftStr);
      const [sx, sy] = k.split(',').map(Number);
      const ring = [[sx, sy], end];
      used.add(edgeKey);
      let cx = end[0], cy = end[1];
      for (let guard = 0; guard < width * height * 4; guard++) {
        const nk = `${cx},${cy},${left}`;
        const options = next.get(nk) || [];
        let adv = null;
        for (const opt of options) {
          const ek = `${nk}>${opt[0]},${opt[1]}`;
          if (!used.has(ek)) { adv = opt; used.add(ek); break; }
        }
        if (!adv) break;
        if (adv[0] === sx && adv[1] === sy) { ring.push([sx, sy]); break; }
        ring.push(adv);
        cx = adv[0]; cy = adv[1];
      }
      if (ring.length >= 4) {
        if (!rings.has(left)) rings.set(left, []);
        rings.get(left).push(ring);
      }
    }
  }
  return rings;
}

function shoelace(poly) {
  let a = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    a += poly[i][0] * poly[i + 1][1] - poly[i + 1][0] * poly[i][1];
  }
  return Math.abs(a) / 2;
}

function exteriorLinears(labels, planes, width, height) {
  const rings = facetRings(labels, width, height);
  const totals = { eave: 0, rake: 0 };
  const counts = { eave: 0, rake: 0 };
  for (const [lid, loops] of rings) {
    const plane = planes.get(lid);
    if (!plane) continue;
    const [a, b] = plane.plane;
    const dhx = -a, dhy = -b;
    const dn = Math.hypot(dhx, dhy) || 1;
    const ux = dhx / dn, uy = dhy / dn;
    for (const ring of loops) {
      const simp = simplifyClosed(ring, 3.2);
      for (let i = 0; i < simp.length - 1; i++) {
        const x1 = simp[i][0] * 0.1, y1 = -simp[i][1] * 0.1;
        const x2 = simp[i + 1][0] * 0.1, y2 = -simp[i + 1][1] * 0.1;
        const dx = x2 - x1, dy = y2 - y1;
        const plan = Math.hypot(dx, dy);
        if (plan < 0.45) continue;
        // Only the outside of the facet: the ring walker includes shared edges.
        // Shared edges are billed separately. An exterior edge has no roof on
        // the right-hand side of this directed step, which we approximate by
        // requiring the segment midpoint's outward neighbor to be off-roof.
        const mx = (simp[i][0] + simp[i + 1][0]) / 2;
        const my = (simp[i][1] + simp[i + 1][1]) / 2;
        const elen = Math.hypot(simp[i + 1][0] - simp[i][0], simp[i + 1][1] - simp[i][1]) || 1;
        const ox = -(simp[i + 1][1] - simp[i][1]) / elen;
        const oy = (simp[i + 1][0] - simp[i][0]) / elen;
        const px = Math.round(mx + ox * 0.6);
        const py = Math.round(my + oy * 0.6);
        if (py >= 0 && px >= 0 && py < height && px < width && labels[py * width + px] > 0) continue;
        const dz = a * dx + b * dy;
        const lengthFt = Math.sqrt(plan * plan + dz * dz) * M2FT;
        const along = Math.abs(ux * (dx / plan) + uy * (dy / plan));
        const kind = along >= 0.5 ? 'rake' : 'eave';
        totals[kind] += lengthFt;
        counts[kind] += 1;
      }
    }
  }
  return { totals, counts };
}

/**
 * Trace one in-memory DSM/mask pair. `dsm` and `mask` are rasters from
 * decodeSolarGeotiff; nothing is written to disk.
 */
export async function traceRoofFromRasters({ dsm, mask, width, height }) {
  const started = Date.now();
  const cropped = cropToCenterBuilding(mask.data || mask, dsm.data || dsm, width, height);
  const dem = smooth(cropped.dem, cropped.roof, cropped.width, cropped.height);
  await yieldTick();
  const rawLabels = await segment(cropped.roof, dem, cropped.width, cropped.height);
  const { labels, planes } = mergeCoplanar(rawLabels, dem, cropped.width, cropped.height);
  fillNearFacets(labels, cropped.roof, cropped.width, cropped.height, 999);
  refitPlanes(planes, labels, dem, cropped.width);
  const shared = measureShared(labels, planes, cropped.width, cropped.height);
  const exterior = exteriorLinears(labels, planes, cropped.width, cropped.height);
  const rings = facetRings(labels, cropped.width, cropped.height);

  const facets = [];
  const pitchAreas = new Map();
  let areaSqft = 0;
  for (const [id, info] of planes) {
    const [a, b, c] = info.plane;
    const slope = Math.hypot(a, b);
    const rise = pitchRise(slope);
    const pitch = `${rise}/12`;
    const cos = Math.max(Math.cos(Math.atan(slope)), 0.35);
    const loops = rings.get(id) || [];
    let best = null;
    let ringPlan = 0;
    for (const ring of loops) {
      const raw = ring.map(([col, row]) => [col * 0.1, -row * 0.1]);
      if (raw.length > 3 && (raw[0][0] !== raw[raw.length - 1][0] || raw[0][1] !== raw[raw.length - 1][1])) raw.push(raw[0]);
      const rawPlan = shoelace(raw);
      if (rawPlan > ringPlan) ringPlan = rawPlan;
      const simp = simplifyClosed(ring, 2.4);
      if (simp.length < 4) continue;
      const polyM = simp.map(([col, row]) => [col * 0.1, -row * 0.1]);
      if (polyM[0][0] !== polyM[polyM.length - 1][0] || polyM[0][1] !== polyM[polyM.length - 1][1]) {
        polyM.push(polyM[0]);
      }
      const plan = shoelace(polyM);
      if (!best || plan > best.plan) best = { polyM, plan };
    }
    const pixelPlan = info.n * 0.01;
    // The traced ring is the polygon. A simplified ring drops bays, so bill the
    // larger of the raw ring and the pixel interior when they agree, and the
    // pixel interior when the ring failed to close.
    const planM2 = ringPlan > pixelPlan * 0.8 && ringPlan < pixelPlan * 1.25
      ? ringPlan
      : pixelPlan;
    const slopeSqft = (planM2 / cos) * SQFT_PER_M2;
    areaSqft += slopeSqft;
    pitchAreas.set(pitch, (pitchAreas.get(pitch) || 0) + slopeSqft);
    const polygon = (best ? best.polyM : []).slice(0, -1).map(([x, y]) => {
      const z = a * x + b * y + c;
      return { x: round1(x * M2FT), y: round1(y * M2FT), h: round1(z * M2FT) };
    });
    facets.push({
      id: `datalayer_facet_${id}`,
      provenance: 'google_solar_datalayers',
      pitch,
      pitch_degrees: Math.round(Math.atan(slope) * 180 / Math.PI * 10) / 10,
      azimuth_degrees: Math.round(azimuthOf(a, b) * 10) / 10,
      area_sqft: Math.round(slopeSqft * 10) / 10,
      polygon,
      edges: [],
    });
  }

  const linears = {
    ridge: round1(shared.totals.ridge),
    hip: round1(shared.totals.hip),
    valley: round1(shared.totals.valley),
    rake: round1(exterior.totals.rake),
    eave: round1(exterior.totals.eave),
  };
  const counts = {
    ridge: shared.counts.ridge,
    hip: shared.counts.hip,
    valley: shared.counts.valley,
    rake: exterior.counts.rake,
    eave: exterior.counts.eave,
  };
  const pitch_areas = [...pitchAreas.entries()]
    .map(([pitch, area]) => ({ pitch, area_sqft: Math.round(area) }))
    .sort((p, q) => q.area_sqft - p.area_sqft);

  const payload = {
    v: 1,
    area_sqft: Math.round(areaSqft * 10) / 10,
    pitch_areas,
    linears,
    counts,
    facets: facets.map((f) => ({
      id: f.id,
      pitch: f.pitch,
      pitch_degrees: f.pitch_degrees,
      azimuth_degrees: f.azimuth_degrees,
      area_sqft: f.area_sqft,
      polygon: f.polygon.map((p) => [p.x, p.y, p.h]),
    })),
    edges: shared.edges,
    trace_ms: Date.now() - started,
  };
  return payload;
}

export const SOLAR_AREA_GATE = 0.08;

/**
 * Building Insights area is the baseline. A trace farther than 8% is discarded.
 */
export function solarTraceAreaDelta(traceAreaSqft, solarAreaSqft) {
  if (!(solarAreaSqft > 0) || !(traceAreaSqft > 0)) return Infinity;
  return Math.abs(traceAreaSqft - solarAreaSqft) / solarAreaSqft;
}

export function solarTraceAccepted(trace, solarAreaSqft) {
  return solarTraceAreaDelta(trace?.area_sqft, solarAreaSqft) <= SOLAR_AREA_GATE;
}
