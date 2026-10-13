/**
 * NOAA MRMS MESH (Maximum Estimated Size of Hail) integration.
 *
 * Downloads the rolling 24-hour MESH_Max_1440min GRIB2 grid from NCEP,
 * decodes it in pure JS (grid template 3.0 + PNG data packing 5.41 via pngjs),
 * and exposes:
 *   - sampleMesh(lat, lng)          -> hail size in inches (or null when no data)
 *   - samplePoints([{lat,lng},...]) -> array of inches|null
 *   - buildOverlay(bbox, maxPx)     -> colored PNG data-URL + bounds for Leaflet ImageOverlay
 *   - classifyConfidence(...)       -> confidence tier used across the Storm Tracker
 *
 * IMPORTANT: MESH_Max_1440min only covers the trailing ~24 hours. Older storms
 * get tier 'unknown' (callers must fall back to spotter-report-only logic).
 *
 * Shared CJS module: required by BOTH vite-functions-plugin.js (dev) and the
 * prod server via the shared function-handler registry. Fix here, not in copies.
 */

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { PNG } = require('pngjs');

const MESH_URL = 'https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/MRMS_MESH_Max_1440min.latest.grib2.gz';
const CACHE_TTL_MS = 20 * 60 * 1000;       // refresh at most every 20 min
const STALE_MAX_MS = 3 * 60 * 60 * 1000;   // serve stale up to 3h if NCEP is down
const TMP_CACHE = process.env.NODE_ENV === 'test' && process.env.MRMS_TEST_CACHE_PATH
  ? process.env.MRMS_TEST_CACHE_PATH
  : '/tmp/mrms_mesh_latest.grib2';
const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_GRID_CELLS = 30_000_000;         // MRMS normally has 7000x3500 cells
const DECODE_TIMEOUT_MS = 30_000;
const MM_PER_INCH = 25.4;

// Hail-size color ramp (inches). Order matters: first match wins (checked high→low).
const COLOR_RAMP = [
  { min: 2.0,  rgba: [190, 75, 219, 185], label: '2.0"+ (softball/baseball)' },
  { min: 1.5,  rgba: [250, 82, 82, 175],  label: '1.5–2.0" (golf ball+)' },
  { min: 1.0,  rgba: [255, 146, 43, 165], label: '1.0–1.5" (quarter+)' },
  { min: 0.75, rgba: [255, 212, 59, 150], label: '0.75–1.0" (penny+)' },
  { min: 0.5,  rgba: [116, 192, 252, 120], label: '0.5–0.75" (small)' },
  { min: 0.25, rgba: [165, 216, 255, 90], label: '0.25–0.5" (trace)' },
];

// ── In-memory grid cache ────────────────────────────────────────────────────
let _grid = null;          // { data: Uint16Array, ni, nj, lat0, lon0, di, dj, R, D, fetchedAt, validTime }
let _inflight = null;      // Promise dedupe
let _lastFailAt = 0;

function _readSection(buf, off) {
  if (off + 5 > buf.length) return null;
  return { len: buf.readUInt32BE(off), num: buf[off + 4] };
}

/** Parse a single-message MRMS GRIB2 buffer (template 3.0 grid, 5.41 PNG packing). */
function parseGrib2(buf) {
  if (buf.slice(0, 4).toString() !== 'GRIB') throw new Error('Not a GRIB2 file');
  let off = 16;
  let grid = null, pack = null, dataOff = null, dataLen = null, refTime = null;
  while (off < buf.length - 4) {
    if (buf.slice(off, off + 4).toString() === '7777') break;
    const sec = _readSection(buf, off);
    if (!sec || sec.len < 5) break;
    if (sec.num === 1) {
      // Identification: year(2) month day hour minute second at offset 12
      const y = buf.readUInt16BE(off + 12);
      refTime = new Date(Date.UTC(y, buf[off + 14] - 1, buf[off + 15], buf[off + 16], buf[off + 17], buf[off + 18]));
    } else if (sec.num === 3) {
      const tmpl = buf.readUInt16BE(off + 12);
      if (tmpl !== 0) throw new Error(`Unsupported grid template ${tmpl}`);
      grid = {
        ni: buf.readUInt32BE(off + 30),
        nj: buf.readUInt32BE(off + 34),
        lat0: buf.readInt32BE(off + 46) / 1e6,
        lon0: buf.readUInt32BE(off + 50) / 1e6, // 0..360
        di: buf.readUInt32BE(off + 63) / 1e6,
        dj: buf.readUInt32BE(off + 67) / 1e6,
        scan: buf[off + 71],
      };
    } else if (sec.num === 5) {
      const tmpl = buf.readUInt16BE(off + 9);
      if (tmpl !== 41) throw new Error(`Unsupported data packing template ${tmpl} (expected 41/PNG)`);
      // GRIB2 signed fields are sign-magnitude: high bit = negative
      const sm16 = (v) => (v & 0x8000) ? -(v & 0x7fff) : v;
      pack = {
        R: buf.readFloatBE(off + 11),
        E: sm16(buf.readUInt16BE(off + 15)),
        D: sm16(buf.readUInt16BE(off + 17)),
        depth: buf[off + 19],
      };
    } else if (sec.num === 7) {
      dataOff = off + 5;
      dataLen = sec.len - 5;
    }
    off += sec.len;
  }
  if (!grid || !pack || dataOff == null) throw new Error('GRIB2 missing required sections');
  // Our row/col indexing assumes scan mode 0: west→east, north→south, i-consecutive.
  // A different scan mode would silently flip/transpose everything — fail loudly instead.
  if (grid.scan !== 0) throw new Error(`Unsupported GRIB2 scan mode 0x${grid.scan.toString(16)} (expected 0)`);
  if (!grid.ni || !grid.nj || grid.ni * grid.nj > MAX_GRID_CELLS) {
    throw new Error(`MRMS grid dimensions exceed supported limit: ${grid.ni}x${grid.nj}`);
  }
  const pngBytes = buf.subarray(dataOff, dataOff + dataLen);
  if (pngBytes.length < 24 || pngBytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
      pngBytes.readUInt32BE(16) !== grid.ni || pngBytes.readUInt32BE(20) !== grid.nj) {
    throw new Error('MRMS PNG dimensions do not match the GRIB grid');
  }

  const png = PNG.sync.read(pngBytes, { skipRescale: true });
  if (png.width !== grid.ni || png.height !== grid.nj) {
    throw new Error(`PNG dims ${png.width}x${png.height} != grid ${grid.ni}x${grid.nj}`);
  }
  const npts = grid.ni * grid.nj;
  const data = new Uint16Array(npts);
  // pngjs returns 8-bit RGBA by default after rescale; with 16-bit grayscale input
  // and skipRescale, png.data is a Buffer of 16-bit big-endian samples spread to RGBA16.
  // Handle both 16-bit (depth 16) and 8-bit robustly by reading the gray channel.
  const d = png.data;
  const isU16 = d instanceof Uint16Array || (d.BYTES_PER_ELEMENT === 2 && !Buffer.isBuffer(d));
  if (isU16) {
    // pngjs skipRescale + 16-bit: data is a Uint16Array, one element per sample
    const channels = d.length / (png.width * png.height);
    for (let i = 0; i < npts; i++) data[i] = d[i * channels];
  } else {
    const bytesPerSample = png.depth === 16 ? 2 : 1;
    const channels = d.length / (png.width * png.height * bytesPerSample);
    const stride = channels * bytesPerSample;
    for (let i = 0; i < npts; i++) {
      const p = i * stride;
      data[i] = bytesPerSample === 2 ? d.readUInt16BE(p) : d[p];
    }
  }
  return {
    data,
    ni: grid.ni, nj: grid.nj,
    lat0: grid.lat0, lon0: grid.lon0 > 180 ? grid.lon0 - 360 : grid.lon0,
    di: grid.di, dj: grid.dj,
    R: pack.R, E: pack.E, D: pack.D,
    validTime: refTime ? refTime.toISOString() : null,
  };
}

/** raw grid value -> hail size in mm (negative = no data) */
function rawToMm(grid, raw) {
  return (grid.R + raw * Math.pow(2, grid.E)) / Math.pow(10, grid.D);
}

async function _download() {
  const res = await fetch(MESH_URL, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`MRMS fetch HTTP ${res.status}`);
  const length = Number(res.headers?.get('content-length'));
  if (length > MAX_COMPRESSED_BYTES) throw new Error('MRMS download exceeds size limit');
  if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_COMPRESSED_BYTES) {
        throw new Error('MRMS download exceeds size limit');
      }
      chunks.push(Buffer.from(chunk));
    }
    const gz = Buffer.concat(chunks, bytes);
    return gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
  }
  const compressed = await res.arrayBuffer();
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw new Error('MRMS download exceeds size limit');
  return compressed;
}

// The 7000x3500 PNG takes several seconds to expand and copy. Keep both
// decompression and decoding off the HTTP server's event loop; transfer the
// decoded cell buffer back without another 49 MB copy.
function _decodeOffThread({ compressed, cachedPath }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'mrms-mesh-worker.cjs'), {
      workerData: { compressed, cachedPath, cachePath: TMP_CACHE },
      transferList: compressed ? [compressed] : [],
    });
    let settled = false;
    const timer = setTimeout(() => {
      worker.terminate().catch(() => {});
      finish(new Error('MRMS decoder timed out'));
    }, DECODE_TIMEOUT_MS);
    const finish = (error, grid) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(grid);
    };
    worker.once('message', ({ grid, error }) =>
      error ? finish(new Error(error)) : finish(null, grid));
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`MRMS decoder exited before returning a grid (code ${code})`));
    });
  });
}

/**
 * Get the decoded MESH grid, refreshing when stale. Never throws when a
 * previously-fetched grid is still usable; returns null when MESH is
 * genuinely unavailable (callers must degrade gracefully).
 */
async function getMeshGrid() {
  const now = Date.now();
  if (_grid && now - _grid.fetchedAt < CACHE_TTL_MS) return _grid;
  if (_inflight) {
    // A refresh is running; serve stale immediately when we have one.
    if (_grid && now - _grid.fetchedAt < STALE_MAX_MS) return _grid;
    return _inflight;
  }
  // Backoff: after a failure, don't hammer NCEP more than once per 2 min
  if (now - _lastFailAt < 2 * 60 * 1000) {
    return _grid && now - _grid.fetchedAt < STALE_MAX_MS ? _grid : null;
  }

  _inflight = (async () => {
    try {
      let compressed = null;
      let cachedPath = null;
      let cachedAt = null;
      try {
        compressed = await _download();
      } catch (e) {
        _lastFailAt = Date.now();
        console.warn('[MRMS] download failed:', e.message);
        // cold start fallback: reuse /tmp copy if fresh enough
        if (!_grid) {
          const st = await fs.promises.stat(TMP_CACHE).catch(() => null);
          if (st && now - st.mtimeMs < STALE_MAX_MS) {
            console.log('[MRMS] using /tmp cached grid');
            cachedPath = TMP_CACHE;
            cachedAt = Math.min(now, st.mtimeMs);
          }
        }
        if (!cachedPath) throw e;
      }
      const parsed = await _decodeOffThread({ compressed, cachedPath });
      parsed.fetchedAt = cachedAt || Date.now();
      _grid = parsed;
      if (compressed) _lastFailAt = 0;
      console.log(`[MRMS] MESH grid loaded: ${parsed.ni}x${parsed.nj}, valid ${parsed.validTime}`);
      return _grid;
    } catch (e) {
      _lastFailAt = Date.now();
      console.error('[MRMS] MESH grid unavailable:', e.message);
      if (_grid && Date.now() - _grid.fetchedAt < STALE_MAX_MS) return _grid; // stale but usable
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Sample MESH at a coordinate. Returns hail size in INCHES, or null (no data / off-grid). */
function sampleGrid(grid, lat, lng) {
  if (!grid) return null;
  const lon = lng < 0 ? lng : lng > 180 ? lng - 360 : lng;
  const col = Math.round((lon - grid.lon0) / grid.di);
  const row = Math.round((grid.lat0 - lat) / grid.dj); // lat decreases with row
  if (col < 0 || col >= grid.ni || row < 0 || row >= grid.nj) return null;
  const mm = rawToMm(grid, grid.data[row * grid.ni + col]);
  if (mm <= 0) return 0; // valid grid cell, no hail
  return mm / MM_PER_INCH;
}

async function sampleMesh(lat, lng) {
  const grid = await getMeshGrid();
  if (!grid) return null;
  return sampleGrid(grid, lat, lng);
}

async function samplePoints(points) {
  const grid = await getMeshGrid();
  return points.map((p) => {
    const lat = Number(p.lat ?? p.latitude), lng = Number(p.lng ?? p.longitude);
    if (!grid || !isFinite(lat) || !isFinite(lng)) return null;
    return sampleGrid(grid, lat, lng);
  });
}

/**
 * MESH in the neighborhood of a point (max over a small window, ~radiusMiles).
 * Storm cores are narrow; a exact-cell sample can just miss the swath.
 */
function sampleGridMax(grid, lat, lng, radiusMiles = 1) {
  if (!grid) return null;
  const cells = Math.max(1, Math.round(radiusMiles / 0.69)); // ~0.69 mi per 0.01°
  let best = null;
  for (let dr = -cells; dr <= cells; dr++) {
    for (let dc = -cells; dc <= cells; dc++) {
      const v = sampleGrid(grid, lat + dr * grid.dj, lng + dc * grid.di);
      if (v != null && (best == null || v > best)) best = v;
    }
  }
  return best;
}

/**
 * Confidence tiers (product spec):
 *  - high_confidence  "Verified Impact"      : inside MESH swath (>=0.5") AND confirmed spotter report nearby
 *  - high_opportunity "Unreported Damage"    : heavy MESH (>=1.0") but NO spotter report nearby
 *  - low_priority     "Unconfirmed"          : spotter report nearby but no MESH core over the coordinate
 *  - unknown          MESH unavailable (storm older than 24h or NCEP down) — spotter logic only
 */
function classifyConfidence({ meshInches, hasSpotterReport }) {
  if (meshInches == null) return 'unknown';
  const inSwath = meshInches >= 0.5;
  const heavy = meshInches >= 1.0;
  if (inSwath && hasSpotterReport) return 'high_confidence';   // radar + confirmed report
  if (heavy && !hasSpotterReport) return 'high_opportunity';   // heavy radar core, nobody reported it
  return 'low_priority';                                        // report w/o radar core, or light/no radar
}

const CONFIDENCE_LABELS = {
  high_confidence: 'High Confidence (Verified Impact)',
  high_opportunity: 'High Opportunity (Unreported Damage)',
  low_priority: 'Low Priority (Unconfirmed)',
  unknown: 'Radar Data Unavailable',
};

function colorFor(inches) {
  for (const c of COLOR_RAMP) if (inches >= c.min) return c.rgba;
  return null;
}

/**
 * Build a colored PNG overlay for a bbox, downsampled to <= maxPx on the long side.
 * Returns { available, imageDataUrl, bounds:[[s,w],[n,e]], maxInches, validTime } .
 */
// Overlay renders iterate up to the full grid — serialize them (one at a time)
// and micro-cache by quantized bbox so a burst of map pans can't stack up work.
const _overlayCache = new Map(); // key -> { at, result }
let _overlayChain = Promise.resolve();
const OVERLAY_CACHE_MS = 60 * 1000;
const OVERLAY_CACHE_MAX = 20;

async function buildOverlay(bbox, maxPx = 900) {
  const q = (v) => Math.round(v * 20) / 20; // 0.05° quantization
  const key = `${q(bbox.minLat)},${q(bbox.maxLat)},${q(bbox.minLng)},${q(bbox.maxLng)},${maxPx}`;
  const hit = _overlayCache.get(key);
  if (hit && Date.now() - hit.at < OVERLAY_CACHE_MS) return hit.result;
  const run = _overlayChain.then(async () => {
    const again = _overlayCache.get(key); // may have been filled while queued
    if (again && Date.now() - again.at < OVERLAY_CACHE_MS) return again.result;
    const result = await _buildOverlayInner(bbox, maxPx);
    _overlayCache.set(key, { at: Date.now(), result });
    if (_overlayCache.size > OVERLAY_CACHE_MAX) {
      const oldest = [..._overlayCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      _overlayCache.delete(oldest[0]);
    }
    return result;
  });
  _overlayChain = run.catch(() => {});
  return run;
}

async function _buildOverlayInner({ minLat, maxLat, minLng, maxLng }, maxPx = 900) {
  const grid = await getMeshGrid();
  if (!grid) return { available: false };
  return _buildOverlayForGrid(grid, { minLat, maxLat, minLng, maxLng }, maxPx);
}

function _buildOverlayForGrid(grid, { minLat, maxLat, minLng, maxLng }, maxPx = 900) {
  // Clamp bbox to grid coverage
  const gN = grid.lat0, gS = grid.lat0 - grid.dj * (grid.nj - 1);
  const gW = grid.lon0, gE = grid.lon0 + grid.di * (grid.ni - 1);
  const n = Math.min(maxLat, gN), s = Math.max(minLat, gS);
  const w = Math.max(minLng, gW), e = Math.min(maxLng, gE);
  if (!(n > s && e > w)) return { available: false };

  const colW = Math.round((e - w) / grid.di), rowH = Math.round((n - s) / grid.dj);
  const step = Math.max(1, Math.ceil(Math.max(colW, rowH) / maxPx));
  const outW = Math.max(1, Math.floor(colW / step)), outH = Math.max(1, Math.floor(rowH / step));
  const png = new PNG({ width: outW, height: outH });
  const row0 = Math.round((grid.lat0 - n) / grid.dj);
  const col0 = Math.round((w - grid.lon0) / grid.di);
  let maxInches = 0;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      // max-pool the step x step block so narrow swaths stay visible when zoomed out
      let bestMm = -1;
      const rBase = row0 + y * step, cBase = col0 + x * step;
      for (let rr = 0; rr < step; rr++) {
        const r = rBase + rr;
        if (r < 0 || r >= grid.nj) continue;
        const rowOff = r * grid.ni;
        for (let cc = 0; cc < step; cc++) {
          const c = cBase + cc;
          if (c < 0 || c >= grid.ni) continue;
          const mm = rawToMm(grid, grid.data[rowOff + c]);
          if (mm > bestMm) bestMm = mm;
        }
      }
      const idx = (y * outW + x) * 4;
      if (bestMm > 0) {
        const inches = bestMm / MM_PER_INCH;
        if (inches > maxInches) maxInches = inches;
        const rgba = colorFor(inches);
        if (rgba) {
          png.data[idx] = rgba[0]; png.data[idx + 1] = rgba[1];
          png.data[idx + 2] = rgba[2]; png.data[idx + 3] = rgba[3];
          continue;
        }
      }
      png.data[idx + 3] = 0; // transparent
    }
  }
  const buf = PNG.sync.write(png);
  return {
    available: true,
    imageDataUrl: `data:image/png;base64,${buf.toString('base64')}`,
    bounds: [[s, w], [n, e]],
    maxInches: Math.round(maxInches * 100) / 100,
    validTime: grid.validTime,
    legend: COLOR_RAMP.map((c) => ({ min: c.min, label: c.label, color: `rgb(${c.rgba[0]},${c.rgba[1]},${c.rgba[2]})` })),
  };
}

/**
 * Persistable crop of the live grid for one storm.  The values are raw MESH
 * values (rather than a lossy colored image), so archived confidence checks
 * retain the same thresholds as the live radar.  A typical 10-mile storm crop
 * is only a few KB after base64 encoding.
 */
function createSnapshotFromGrid(grid, bbox) {
  if (!grid || !bbox) return null;
  const { minLat, maxLat, minLng, maxLng } = bbox;
  const gN = grid.lat0, gS = grid.lat0 - grid.dj * (grid.nj - 1);
  const gW = grid.lon0, gE = grid.lon0 + grid.di * (grid.ni - 1);
  const n = Math.min(Number(maxLat), gN), s = Math.max(Number(minLat), gS);
  const w = Math.max(Number(minLng), gW), e = Math.min(Number(maxLng), gE);
  if (!(n > s && e > w)) return null;
  const rowStart = Math.max(0, Math.floor((grid.lat0 - n) / grid.dj));
  const rowEnd = Math.min(grid.nj - 1, Math.ceil((grid.lat0 - s) / grid.dj));
  const colStart = Math.max(0, Math.floor((w - grid.lon0) / grid.di));
  const colEnd = Math.min(grid.ni - 1, Math.ceil((e - grid.lon0) / grid.di));
  const ni = colEnd - colStart + 1, nj = rowEnd - rowStart + 1;
  if (ni < 1 || nj < 1) return null;
  const data = new Uint16Array(ni * nj);
  for (let row = 0; row < nj; row++) {
    data.set(grid.data.subarray((rowStart + row) * grid.ni + colStart, (rowStart + row) * grid.ni + colStart + ni), row * ni);
  }
  const cropped = {
    data, ni, nj,
    lat0: grid.lat0 - rowStart * grid.dj,
    lon0: grid.lon0 + colStart * grid.di,
    di: grid.di, dj: grid.dj, R: grid.R, E: grid.E, D: grid.D,
    validTime: grid.validTime,
  };
  let maxInches = 0;
  for (const raw of data) maxInches = Math.max(maxInches, Math.max(0, rawToMm(cropped, raw) / MM_PER_INCH));
  return {
    bbox: { minLat: s, maxLat: n, minLng: w, maxLng: e },
    grid: {
      ni, nj, lat0: cropped.lat0, lon0: cropped.lon0, di: cropped.di, dj: cropped.dj,
      R: cropped.R, E: cropped.E, D: cropped.D,
      rawBase64: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
    },
    validTime: grid.validTime,
    maxInches: Math.round(maxInches * 100) / 100,
  };
}

function gridFromSnapshot(snapshot) {
  const stored = snapshot?.grid;
  if (!stored?.rawBase64 || !Number.isInteger(stored.ni) || !Number.isInteger(stored.nj)) return null;
  const bytes = Buffer.from(stored.rawBase64, 'base64');
  if (bytes.length !== stored.ni * stored.nj * 2) return null;
  const data = new Uint16Array(stored.ni * stored.nj);
  for (let i = 0; i < data.length; i++) data[i] = bytes.readUInt16LE(i * 2);
  return { ...stored, data, validTime: snapshot.validTime || null };
}

function sampleSnapshotMax(snapshot, lat, lng, radiusMiles = 1) {
  return sampleGridMax(gridFromSnapshot(snapshot), lat, lng, radiusMiles);
}

function buildOverlayFromSnapshot(snapshot, bbox, maxPx = 900) {
  const grid = gridFromSnapshot(snapshot);
  if (!grid) return { available: false };
  const requested = bbox || snapshot.bbox;
  const result = _buildOverlayForGrid(grid, requested, maxPx);
  return { ...result, archived: true, capturedAt: snapshot.capturedAt || null };
}

function isFutureStormTime(startTime) {
  const t = new Date(startTime).getTime();
  return isFinite(t) && t > Date.now();
}

/** True when a storm has begun and falls inside the trailing-24h MESH window. */
function isWithinMeshWindow(startTime) {
  const t = new Date(startTime).getTime();
  if (!isFinite(t)) return false;
  const ageMs = Date.now() - t;
  return ageMs >= 0 && ageMs < 26 * 60 * 60 * 1000; // small buffer over 24h
}

function isOlderThanMeshWindow(startTime) {
  const t = new Date(startTime).getTime();
  return isFinite(t) && Date.now() - t >= 26 * 60 * 60 * 1000;
}

module.exports = {
  getMeshGrid, sampleMesh, samplePoints, sampleGrid, sampleGridMax,
  buildOverlay, buildOverlayFromSnapshot, createSnapshotFromGrid, sampleSnapshotMax,
  classifyConfidence, CONFIDENCE_LABELS, isWithinMeshWindow, isOlderThanMeshWindow, isFutureStormTime,
  // Exported for the radar regression smoke test. Callers should use getMeshGrid
  // rather than parsing network data themselves.
  parseGrib2,
};
