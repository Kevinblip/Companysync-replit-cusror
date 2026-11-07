/**
 * Microsoft Global ML Building Footprints, used when OpenStreetMap has no
 * building at the address. The dataset is free (CDLA Permissive 2.0).
 * Tiles are quadkey gzipped GeoJSON lines. Nothing here calls a paid API.
 * Google Open Buildings does not cover the United States, so it is not a
 * second source.
 *
 * A parent tile is tens of megabytes compressed. It is streamed once, and
 * the buildings are stored on disk by smaller quadkey (a couple of
 * kilometres across). The next lookup in that area reads those files and
 * does not download or unzip the tile again. Parsing yields the event
 * loop instead of holding it for the whole inflate.
 */

import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { distanceMeters } from './roofFootprintArea.js';

const INDEX_URL = 'https://bfppub.blob.core.windows.net/%24web/2026-07-24/dataset-links.csv';
export const MICROSOFT_FOOTPRINT_TIMEOUT_MS = 30000;
const DEFAULT_TIMEOUT_MS = MICROSOFT_FOOTPRINT_TIMEOUT_MS;
const PARENT_ZOOM = 9;
export const MICROSOFT_FOOTPRINT_SUB_ZOOM = 14;
/** One extracted parent tile is about 178–275 MB, so 256 MB held a single area. */
export const MICROSOFT_FOOTPRINT_CACHE_MAX_BYTES = 1024 * 1024 * 1024;
const PROJECT_CACHE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.cache',
  'ms-footprints',
);
const RESULT_CACHE_LIMIT = 32;
const YIELD_EVERY = 200;
const FLUSH_EVERY = 2000;

let indexPromise = null;
const resultCache = new Map();
const inflight = new Map();

export function resetMicrosoftFootprintCache() {
  indexPromise = null;
  resultCache.clear();
  inflight.clear();
}

export function microsoftFootprintCacheDir(cacheDir) {
  if (cacheDir) return cacheDir;
  if (process.env.MICROSOFT_FOOTPRINT_CACHE_DIR) return process.env.MICROSOFT_FOOTPRINT_CACHE_DIR;
  return PROJECT_CACHE_DIR;
}

export function quadkeyFor(lat, lng, zoom = 9) {
  const n = 2 ** zoom;
  const x = Math.floor(((Number(lng) + 180) / 360) * n);
  const latRad = (Number(lat) * Math.PI) / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n);
  let key = '';
  for (let i = zoom; i > 0; i -= 1) {
    const mask = 1 << (i - 1);
    let digit = 0;
    if (x & mask) digit += 1;
    if (y & mask) digit += 2;
    key += String(digit);
  }
  return key;
}

/** QuadKey → [download url]. A tile can be split across part files. */
export function parseFootprintIndex(csv) {
  const map = new Map();
  const lines = String(csv || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('Location')) continue;
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const quadkey = parts[1].trim();
    const url = parts[2].trim();
    if (!quadkey || !url.startsWith('http')) continue;
    const list = map.get(quadkey) || [];
    list.push(url);
    map.set(quadkey, list);
  }
  return map;
}

function ringFromCoordinates(ring) {
  if (!Array.isArray(ring)) return [];
  return ring.map((pair) => ({
    lon: Number(pair?.[0]),
    lat: Number(pair?.[1]),
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

function candidatesFromFeature(feature) {
  const geometry = feature?.geometry;
  const polygons = geometry?.type === 'Polygon'
    ? [geometry.coordinates]
    : (geometry?.type === 'MultiPolygon' ? geometry.coordinates : []);
  const matches = [];
  for (const polygon of polygons) {
    const ring = ringFromCoordinates(polygon?.[0]);
    if (ring.length < 3) continue;
    const lat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
    const lon = ring.reduce((s, p) => s + p.lon, 0) / ring.length;
    matches.push({
      lat,
      lon,
      el: {
        geometry: ring,
        tags: { building: 'yes', source: 'microsoft' },
      },
    });
  }
  return matches;
}

function candidateFromFeature(feature, latitude, longitude, radiusM) {
  return candidatesFromFeature(feature)
    .filter((candidate) => distanceMeters(latitude, longitude, candidate.lat, candidate.lon) <= radiusM)
    .map(({ el }) => ({ el }));
}

/**
 * Buildings from one GeoJSONL tile whose centroid is within radiusM.
 * Returns the same candidate shape the OSM selector already uses.
 */
export function buildingsFromGeoJsonl(text, latitude, longitude, radiusM = 80) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    let feature;
    try { feature = JSON.parse(line); } catch { continue; }
    out.push(...candidateFromFeature(feature, latitude, longitude, radiusM));
  }
  return out;
}

function cacheKey(latitude, longitude, radiusM) {
  return `${Number(latitude).toFixed(4)},${Number(longitude).toFixed(4)},${radiusM}`;
}

function rememberResult(key, buildings) {
  if (resultCache.has(key)) resultCache.delete(key);
  resultCache.set(key, buildings);
  while (resultCache.size > RESULT_CACHE_LIMIT) {
    const oldest = resultCache.keys().next().value;
    resultCache.delete(oldest);
  }
}

function timeoutError(timeoutMs, detail) {
  const error = new Error(detail || `Microsoft building footprints timed out after ${timeoutMs} ms`);
  error.name = 'TimeoutError';
  error.timedOut = true;
  return error;
}

function isTimeout(error) {
  return error?.timedOut === true || error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

function withTimeout(work, timeoutMs, onTimeout) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (onTimeout) onTimeout();
      reject(timeoutError(timeoutMs));
    }, timeoutMs);
  });
  return Promise.race([work(), timeoutPromise]).finally(() => clearTimeout(timer));
}

async function loadIndex(fetchImpl, timeoutMs) {
  if (!indexPromise) {
    indexPromise = (async () => {
      const response = await withTimeout(
        () => fetchImpl(INDEX_URL, { signal: AbortSignal.timeout(timeoutMs) }),
        timeoutMs,
      );
      if (!response?.ok) throw new Error(`footprint index HTTP ${response?.status}`);
      const text = await response.text();
      return parseFootprintIndex(text);
    })().catch((error) => {
      indexPromise = null;
      throw error;
    });
  }
  return indexPromise;
}

function withinRadius(candidate, latitude, longitude, radiusM) {
  const lat = Number.isFinite(candidate?.lat) ? candidate.lat : null;
  const lon = Number.isFinite(candidate?.lon) ? candidate.lon : null;
  if (lat == null || lon == null) return false;
  return distanceMeters(latitude, longitude, lat, lon) <= radiusM;
}

function quadkeysNear(lat, lng, radiusM, zoom) {
  const dLat = radiusM / 111320;
  const cos = Math.cos((Number(lat) * Math.PI) / 180) || 1;
  const dLng = radiusM / (111320 * Math.abs(cos));
  const keys = new Set();
  for (const la of [lat - dLat, lat, lat + dLat]) {
    for (const ln of [lng - dLng, lng, lng + dLng]) {
      keys.add(quadkeyFor(la, ln, zoom));
    }
  }
  return [...keys];
}

async function yieldToLoop(pause) {
  if (typeof pause === 'function') {
    await pause();
    return;
  }
  await new Promise((resolve) => setImmediate(resolve));
}

async function flushBuckets(dir, buckets) {
  await mkdir(dir, { recursive: true });
  for (const [key, buildings] of buckets) {
    if (!buildings.length) continue;
    const body = `${buildings.map((building) => JSON.stringify(building)).join('\n')}\n`;
    await appendFile(path.join(dir, `${key}.jsonl`), body);
    buildings.length = 0;
  }
}

async function directoryBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(full);
    else {
      try { total += (await stat(full)).size; } catch { /* gone */ }
    }
  }
  return total;
}

/**
 * Drop the oldest extracted parent tiles until the cache is under maxBytes.
 * The parent being read or just written is kept, even if it alone is large.
 * In-progress `.partial` directories are left alone.
 */
export async function enforceMicrosoftFootprintCacheCap(cacheDir, {
  maxBytes = MICROSOFT_FOOTPRINT_CACHE_MAX_BYTES,
  keep = null,
} = {}) {
  const limit = Number(maxBytes);
  if (!(limit > 0)) return { removed: [], bytes: 0 };
  let entries;
  try {
    entries = await readdir(cacheDir, { withFileTypes: true });
  } catch {
    return { removed: [], bytes: 0 };
  }
  const parents = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith('.partial')) {
      const partial = path.join(cacheDir, entry.name);
      try {
        const info = await stat(partial);
        if (Date.now() - info.mtimeMs > 60_000) await rm(partial, { recursive: true, force: true });
      } catch { /* already gone */ }
      continue;
    }
    const full = path.join(cacheDir, entry.name);
    const info = await stat(full);
    parents.push({
      name: entry.name,
      full,
      mtimeMs: info.mtimeMs,
      bytes: await directoryBytes(full),
    });
  }
  parents.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let bytes = parents.reduce((sum, parent) => sum + parent.bytes, 0);
  const removed = [];
  for (const parent of parents) {
    if (bytes <= limit) break;
    if (keep && parent.name === keep) continue;
    await rm(parent.full, { recursive: true, force: true });
    bytes -= parent.bytes;
    removed.push(parent.name);
  }
  return { removed, bytes };
}

async function readCachedNear(cacheDir, latitude, longitude, radiusM) {
  const parent = quadkeyFor(latitude, longitude, PARENT_ZOOM);
  const marker = path.join(cacheDir, parent, 'complete.json');
  try {
    await access(marker);
  } catch {
    return null;
  }
  const buildings = [];
  for (const key of quadkeysNear(latitude, longitude, radiusM, MICROSOFT_FOOTPRINT_SUB_ZOOM)) {
    let text = '';
    try {
      text = await readFile(path.join(cacheDir, parent, `${key}.jsonl`), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const candidate = JSON.parse(line);
        if (withinRadius(candidate, latitude, longitude, radiusM)) buildings.push({ el: candidate.el });
      } catch { /* a torn line is not a building */ }
    }
  }
  return buildings;
}

/**
 * Stream one gzipped GeoJSONL tile into per-sub-tile files.
 * Lines are parsed in batches so inflate does not hold the event loop
 * for the whole tile. The returned list is only the buildings near the pin.
 */
async function extractTile(response, latitude, longitude, radiusM, stagingDir, { pause, yieldEvery = YIELD_EVERY } = {}) {
  const input = response?.body
    ? Readable.fromWeb(response.body)
    : Readable.from(Buffer.from(await response.arrayBuffer()));
  const gunzip = createGunzip();
  const source = input.pipe(gunzip);
  const buckets = new Map();
  const near = [];
  let leftover = '';
  let sinceYield = 0;
  let held = 0;

  const takeLine = async (line) => {
    if (!line) return;
    let feature;
    try { feature = JSON.parse(line); } catch { return; }
    for (const candidate of candidatesFromFeature(feature)) {
      const subKey = quadkeyFor(candidate.lat, candidate.lon, MICROSOFT_FOOTPRINT_SUB_ZOOM);
      const list = buckets.get(subKey) || [];
      list.push({ lat: candidate.lat, lon: candidate.lon, el: candidate.el });
      buckets.set(subKey, list);
      held += 1;
      if (withinRadius(candidate, latitude, longitude, radiusM)) near.push({ el: candidate.el });
    }
    sinceYield += 1;
    if (sinceYield >= yieldEvery) {
      sinceYield = 0;
      await yieldToLoop(pause);
    }
    if (held >= FLUSH_EVERY) {
      held = 0;
      await flushBuckets(stagingDir, buckets);
    }
  };

  for await (const chunk of source) {
    leftover += chunk.toString('utf8');
    let nl = leftover.indexOf('\n');
    while (nl >= 0) {
      const line = leftover.slice(0, nl);
      leftover = leftover.slice(nl + 1);
      await takeLine(line);
      nl = leftover.indexOf('\n');
    }
    if (leftover.length > 2_000_000) leftover = '';
    await yieldToLoop(pause);
  }
  if (leftover.trim()) await takeLine(leftover);
  await flushBuckets(stagingDir, buckets);
  return near;
}

async function extractParentTile(latitude, longitude, radiusM, {
  fetchImpl,
  timeoutMs,
  cacheDir,
  pause,
  yieldEvery,
  maxCacheBytes,
}) {
  const parent = quadkeyFor(latitude, longitude, PARENT_ZOOM);
  const finalDir = path.join(cacheDir, parent);
  const stagingDir = path.join(cacheDir, `${parent}.partial`);
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const found = [];
  try {
    const index = await loadIndex(fetchImpl, remaining());
    const urls = index.get(parent) || [];
    if (urls.length === 0) return { buildings: [], timedOut: false, error: null };
    await rm(stagingDir, { recursive: true, force: true });
    for (const url of urls) {
      if (Date.now() >= deadline) throw timeoutError(timeoutMs);
      const response = await withTimeout(
        () => fetchImpl(url, { signal: AbortSignal.timeout(remaining()) }),
        remaining(),
      );
      if (!response?.ok) throw new Error(`footprint tile HTTP ${response?.status}`);
      const near = await withTimeout(
        () => extractTile(response, latitude, longitude, radiusM, stagingDir, { pause, yieldEvery }),
        remaining(),
      );
      found.push(...near);
    }
    await mkdir(stagingDir, { recursive: true });
    await writeFile(path.join(stagingDir, 'complete.json'), JSON.stringify({
      parentQuadkey: parent,
      subZoom: MICROSOFT_FOOTPRINT_SUB_ZOOM,
    }));
    await rm(finalDir, { recursive: true, force: true });
    await rename(stagingDir, finalDir);
    await enforceMicrosoftFootprintCacheCap(cacheDir, { maxBytes: maxCacheBytes, keep: parent });
    return { buildings: found, timedOut: false, error: null };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    if (isTimeout(error)) {
      return {
        buildings: found,
        timedOut: true,
        error: `Microsoft building footprints timed out after ${timeoutMs} ms`,
      };
    }
    throw error;
  }
}

/**
 * Buildings near the pin from the Microsoft footprint release.
 * `{ buildings, timedOut, error }`. A timeout is not a silent empty list:
 * timedOut is true and error says the tile read stopped.
 *
 * The first call for a parent tile streams it (about 30 s is allowed,
 * because inflate of the compressed tile takes longer than 12 s). Later
 * calls in that area read the sub-tile files and do not touch the network.
 */
export async function fetchMicrosoftBuildingsNear(latitude, longitude, {
  fetchImpl = globalThis.fetch,
  radiusM = 80,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cacheDir = null,
  pause = null,
  yieldEvery = YIELD_EVERY,
  maxCacheBytes = MICROSOFT_FOOTPRINT_CACHE_MAX_BYTES,
} = {}) {
  const empty = { buildings: [], timedOut: false, error: null };
  if (typeof fetchImpl !== 'function') return empty;
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) return empty;
  const dir = microsoftFootprintCacheDir(cacheDir);
  const parent = quadkeyFor(latitude, longitude, PARENT_ZOOM);
  await enforceMicrosoftFootprintCacheCap(dir, { maxBytes: maxCacheBytes, keep: parent });
  const key = `${dir}|${cacheKey(latitude, longitude, radiusM)}`;
  if (resultCache.has(key)) {
    return { buildings: resultCache.get(key), timedOut: false, error: null };
  }
  const cached = await readCachedNear(dir, latitude, longitude, radiusM);
  if (cached) {
    rememberResult(key, cached);
    return { buildings: cached, timedOut: false, error: null };
  }
  const flightKey = `${dir}|${parent}`;
  if (!inflight.has(flightKey)) {
    const work = extractParentTile(latitude, longitude, radiusM, {
      fetchImpl, timeoutMs, cacheDir: dir, pause, yieldEvery, maxCacheBytes,
    }).finally(() => inflight.delete(flightKey));
    inflight.set(flightKey, work);
  }
  const extracted = await inflight.get(flightKey);
  if (!extracted.timedOut) {
    const fromDisk = await readCachedNear(dir, latitude, longitude, radiusM);
    const buildings = fromDisk || extracted.buildings;
    rememberResult(key, buildings);
    return { buildings, timedOut: false, error: null };
  }
  return extracted;
}
