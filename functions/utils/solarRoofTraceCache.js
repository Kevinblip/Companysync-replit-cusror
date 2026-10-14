/**
 * Per-company cache of a Solar dataLayers roof trace.
 *
 * Only the derived JSON is stored (polygons, linears, per-pitch areas).
 * The DSM and mask are decoded in memory and discarded.
 */

import { createHash } from 'node:crypto';
import { decodeSolarGeotiff, traceRoofFromRasters } from './solarDataLayers.js';

export const SOLAR_DATALAYERS_SETTING = 'solar_datalayers_enabled';
export const SOLAR_TRACE_TIMEOUT_MS = 7000;

export function normalizeSolarAddress(address, latitude, longitude) {
  const text = String(address || '')
    .trim()
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length >= 8) return text;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `geo:${lat.toFixed(5)},${lng.toFixed(5)}`;
  }
  return '';
}

export function solarTraceCacheId(companyId, addressKey) {
  return createHash('sha256').update(`${companyId}|${addressKey}`).digest('hex').slice(0, 32);
}

export function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true });
    }, ms);
    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ timedOut: false, value });
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ timedOut: false, error });
    });
  });
}

function redact(message) {
  return String(message || 'Solar dataLayers failed').replace(/key=[^&\s]+/gi, 'key=REDACTED').slice(0, 180);
}

export async function readCompanySolarDataLayersEnabled(query, companyId) {
  if (!companyId || typeof query !== 'function') return false;
  try {
    const result = await query('SELECT settings FROM companies WHERE id = $1 LIMIT 1', [companyId]);
    const settings = result?.rows?.[0]?.settings;
    const parsed = typeof settings === 'string' ? JSON.parse(settings) : (settings || {});
    return parsed?.[SOLAR_DATALAYERS_SETTING] === true;
  } catch {
    return false;
  }
}

export async function readSolarTraceCache(query, companyId, addressKey) {
  if (!companyId || !addressKey || typeof query !== 'function') return null;
  try {
    const result = await query(
      `SELECT payload, payload_bytes, trace_ms
         FROM solar_roof_trace_cache
        WHERE company_id = $1 AND address_key = $2
        LIMIT 1`,
      [companyId, addressKey],
    );
    const row = result?.rows?.[0];
    if (!row) return null;
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return {
      payload,
      payload_bytes: Number(row.payload_bytes) || Buffer.byteLength(JSON.stringify(payload)),
      trace_ms: Number(row.trace_ms) || Number(payload?.trace_ms) || 0,
    };
  } catch {
    return null;
  }
}

export async function writeSolarTraceCache(query, companyId, addressKey, payload) {
  const body = JSON.stringify(payload);
  const bytes = Buffer.byteLength(body);
  const id = solarTraceCacheId(companyId, addressKey);
  await query(
    `INSERT INTO solar_roof_trace_cache
       (id, company_id, address_key, payload, payload_bytes, trace_ms, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW(), NOW())
     ON CONFLICT (company_id, address_key) DO UPDATE SET
       payload = EXCLUDED.payload,
       payload_bytes = EXCLUDED.payload_bytes,
       trace_ms = EXCLUDED.trace_ms,
       updated_at = NOW()`,
    [id, companyId, addressKey, body, bytes, payload?.trace_ms || null],
  );
  return bytes;
}

async function downloadRaster(url, apiKey) {
  let response = await fetch(url, { headers: { 'X-Goog-Api-Key': apiKey } });
  if (!response.ok) {
    const withKey = new URL(url);
    if (!withKey.searchParams.get('key')) withKey.searchParams.set('key', apiKey);
    response = await fetch(withKey);
  }
  if (!response.ok) throw new Error(`Solar raster HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function fetchSolarDataLayerRasters({ latitude, longitude, apiKey }) {
  const attempts = [
    { requiredQuality: 'HIGH', radiusMeters: '40', pixelSizeMeters: '0.1', view: 'FULL_LAYERS' },
    { requiredQuality: 'MEDIUM', radiusMeters: '40', pixelSizeMeters: '0.1', view: 'FULL_LAYERS' },
  ];
  let lastError = 'Solar dataLayers unavailable';
  for (const attempt of attempts) {
    const url = new URL('https://solar.googleapis.com/v1/dataLayers:get');
    url.searchParams.set('location.latitude', String(latitude));
    url.searchParams.set('location.longitude', String(longitude));
    for (const [key, value] of Object.entries(attempt)) url.searchParams.set(key, value);
    url.searchParams.set('key', apiKey);
    const response = await fetch(url);
    if (!response.ok) {
      lastError = `Solar dataLayers HTTP ${response.status}`;
      continue;
    }
    const json = await response.json();
    if (!json.dsmUrl || !json.maskUrl) {
      lastError = 'Solar dataLayers did not include a DSM and mask';
      continue;
    }
    const [dsmBuf, maskBuf] = await Promise.all([
      downloadRaster(json.dsmUrl, apiKey),
      downloadRaster(json.maskUrl, apiKey),
    ]);
    return {
      dsm: decodeSolarGeotiff(dsmBuf),
      mask: decodeSolarGeotiff(maskBuf),
    };
  }
  throw new Error(lastError);
}

/**
 * Start the trace without blocking the caller. Resolves with a status object.
 * A cache miss downloads the rasters, traces them in memory, and stores only
 * the derived JSON. Failures never include the API key.
 */
export function beginSolarRoofTrace({ latitude, longitude, address, companyId, apiKey, query }) {
  const addressKey = normalizeSolarAddress(address, latitude, longitude);
  const job = (async () => {
    const enabled = await readCompanySolarDataLayersEnabled(query, companyId);
    if (!enabled) return { status: 'disabled', address_key: addressKey };
    if (!addressKey) return { status: 'fallback_error', error: 'Address is required to cache a Solar trace' };
    const cached = await readSolarTraceCache(query, companyId, addressKey);
    if (cached?.payload) {
      return {
        status: 'cache_hit',
        address_key: addressKey,
        payload: cached.payload,
        payload_bytes: cached.payload_bytes,
        trace_ms: cached.trace_ms,
      };
    }
    const started = Date.now();
    const rasters = await fetchSolarDataLayerRasters({ latitude, longitude, apiKey });
    const payload = await traceRoofFromRasters({
      dsm: rasters.dsm.data,
      mask: rasters.mask.data,
      width: rasters.dsm.width,
      height: rasters.dsm.height,
    });
    payload.fetch_ms = Date.now() - started;
    let payloadBytes = Buffer.byteLength(JSON.stringify(payload));
    try {
      payloadBytes = await writeSolarTraceCache(query, companyId, addressKey, payload);
    } catch {
      // The measurement can still use this trace. The next request will try again.
    }
    return {
      status: 'traced',
      address_key: addressKey,
      payload,
      payload_bytes: payloadBytes,
      trace_ms: payload.trace_ms,
    };
  })();
  job.catch(() => {});
  return job;
}

export function describeSolarTraceFailure(error) {
  return redact(error?.message || error);
}
