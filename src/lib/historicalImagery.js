// Public imagery only. Archive publication dates are NOT acquisition dates.
const CONFIG_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const COUNTY_ROOT = 'https://gis.cuyahogacounty.us/server/rest/services/IMAGERY';
const cache = new Map();

async function jsonRequest(url, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException('Lookup cancelled', 'AbortError');
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Imagery provider returned HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Imagery provider unavailable');
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function parseCaptureDate(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  let year, month, day;
  let match = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/.exec(text);
  if (match) [, year, month, day] = match;
  else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (match) [, month, day, year] = match;
    else if (typeof value === 'number' && value > 100000000000) {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
    } else return null;
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number(year) < 1900 || date.getUTCFullYear() !== Number(year) ||
      date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return null;
  return date.toISOString().slice(0, 10);
}

export function parseWaybackReleases(config) {
  const raw = Array.isArray(config) ? config
    : Array.isArray(config?.versionsInfo) ? config.versionsInfo
      : Object.entries(config || {}).map(([id, entry]) => ({ ...entry, releaseNum: entry?.releaseNum ?? id }));
  return raw.map(entry => {
    const date = /(\d{4}-\d{2}-\d{2})/.exec(entry.itemTitle || entry.releaseDatetime || '')?.[1];
    const releaseDate = parseCaptureDate(date);
    if (!releaseDate || !entry.metadataLayerUrl || !entry.itemURL) return null;
    // Never accept arbitrary origins from remote catalog entries.
    if (!entry.metadataLayerUrl.startsWith('https://metadata.maptiles.arcgis.com/arcgis/rest/services/') ||
        !entry.itemURL.startsWith('https://wayback.maptiles.arcgis.com/arcgis/rest/services/')) return null;
    return {
      id: String(entry.releaseNum ?? entry.itemID),
      releaseDate,
      metadataUrl: entry.metadataLayerUrl,
      urlTemplate: entry.itemURL.replace('{level}', '{z}').replace('{row}', '{y}').replace('{col}', '{x}'),
    };
  }).filter(Boolean).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
}

// Bound bandwidth and latency: quarterly snapshots of recent years plus yearly
// older snapshots. The UI explicitly describes this as a sampled search.
export function sampleReleases(releases) {
  const latestYear = Number(releases[0]?.releaseDate.slice(0, 4));
  const groups = new Set();
  return releases.filter((release, index) => {
    const year = Number(release.releaseDate.slice(0, 4));
    const quarter = Math.floor((Number(release.releaseDate.slice(5, 7)) - 1) / 3);
    const key = year >= latestYear - 5 ? `${year}-${quarter}` : `${year}`;
    if (index < 2) { groups.add(key); return true; }
    if (groups.has(key)) return false;
    groups.add(key);
    return true;
  }).slice(0, 40);
}

export function optionFromMetadata(release, results) {
  // Identify returns the same source at several scales. Prefer the finest
  // available source at the point rather than a coarse global background.
  const features = (results || []).map(result => result.attributes).filter(Boolean)
    .sort((a, b) => (Number(a.SAMP_RES || a.SRC_RES) || Infinity) -
      (Number(b.SAMP_RES || b.SRC_RES) || Infinity));
  const attributes = features[0];
  if (!attributes) return null;
  const captureDate = parseCaptureDate(attributes.SRC_DATE) || parseCaptureDate(attributes.SRC_DATE2);
  const month = captureDate ? Number(captureDate.slice(5, 7)) : null;
  const resolution = Number(attributes.SRC_RES);
  return {
    id: `wayback-${release.id}`,
    source: 'esri_wayback_history',
    label: 'Esri Wayback',
    captureDate,
    releaseDate: release.releaseDate,
    // Northern US candidate only; never a promise that a roof is tree/snow-free.
    leafOffCandidate: month != null && (month >= 11 || month <= 3),
    resolution: resolution > 0 ? `${resolution} m / pixel` : null,
    urlTemplate: release.urlTemplate,
    attribution: `Esri World Imagery Wayback · ${attributes.NICE_DESC || attributes.NICE_NAME || 'GIS imagery contributors'}`,
  };
}

async function lookupRelease(release, lat, lng, signal) {
  const query = new URLSearchParams({
    f: 'json', geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint',
    sr: '4326', mapExtent: `${lng - .004},${lat - .004},${lng + .004},${lat + .004}`,
    imageDisplay: '800,800,96', tolerance: '0', layers: 'all', returnGeometry: 'false',
  });
  const data = await jsonRequest(`${release.metadataUrl}/identify?${query}`, signal);
  return optionFromMetadata(release, data.results);
}

async function countyOptions(lat, lng, signal) {
  if (lat < 41.27 || lat > 41.64 || lng < -81.98 || lng > -81.36) return { options: [], warnings: [] };
  const surveys = ['2022_Fall_Aerial', '2017_Spring_Aerial_WGS84'];
  const options = [];
  let unavailable = 0;
  await Promise.all(surveys.map(async survey => {
    const url = `${COUNTY_ROOT}/${survey}/MapServer`;
    try {
      const metadata = await jsonRequest(`${url}?f=json`, signal);
      if (!metadata.supportedImageFormatTypes) throw new Error('County imagery unavailable');
      // Export requests in Web Mercator work even with the county's native
      // state-plane cache. Never overlay state-plane tile coordinates on Google.
      options.push({
        id: `cuyahoga-${survey}`, source: 'county_aerial_history',
        label: `Cuyahoga ${survey.replaceAll('_', ' ').replace(' WGS84', '')}`,
        captureDate: null, releaseDate: null,
        leafOffCandidate: false, resolution: null,
        urlTemplate: `${url}/export?bbox={bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image`,
        attribution: metadata.copyrightText || 'Cuyahoga County GIS · OGRIP',
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      unavailable++;
    }
  }));
  return { options, warnings: unavailable ? ['Some Cuyahoga County aerial services are currently unavailable.'] : [] };
}

export async function listPropertyImagery({ lat, lng, signal }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) {
    throw new Error('A valid property location is required.');
  }
  if (signal?.aborted) throw new DOMException('Lookup cancelled', 'AbortError');
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < cached.ttl) return cached.result;
  const config = await jsonRequest(CONFIG_URL, signal);
  const releases = sampleReleases(parseWaybackReleases(config));
  if (!releases.length) throw new Error('The public imagery archive catalog could not be read.');
  const options = [];
  let index = 0;
  let failures = 0;
  // Bounded concurrent metadata requests, only after the user asks for history.
  const [county] = await Promise.all([
    countyOptions(lat, lng, signal),
    Promise.all(Array.from({ length: 6 }, async () => {
    while (index < releases.length) {
      const release = releases[index++];
      try {
        const option = await lookupRelease(release, lat, lng, signal);
        if (option) options.push(option);
      } catch (error) {
        if (signal?.aborted) throw error;
        failures++;
      }
    }
    })),
  ]);
  if (signal?.aborted) throw new DOMException('Lookup cancelled', 'AbortError');
  const seen = new Set();
  // Most archive releases reuse the same photo. Keep only distinct known
  // capture/provider/resolution combinations; unknown dates remain explicit.
  const distinct = options.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)).filter(option => {
    const signature = option.captureDate
      ? `${option.captureDate}|${option.attribution}|${option.resolution}` : option.id;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  }).sort((a, b) => (b.captureDate || '').localeCompare(a.captureDate || ''));
  const warnings = ['Sampled public archive history; not every historical release is searched.', ...county.warnings];
  if (failures) warnings.push('Some archive metadata could not be loaded; results may be incomplete.');
  if (!distinct.some(option => option.leafOffCandidate)) {
    warnings.push('No winter/late-fall capture dates were found in the checked archives. You can still compare the other images.');
  }
  const result = { options: [...distinct, ...county.options], partial: failures > 0 || county.warnings.length > 0, warnings };
  // Briefly cache partial results to avoid repeatedly waiting on unavailable
  // archives, but permit recovery soon. Never retain an unbounded property roster.
  if (cache.size >= 20) cache.delete(cache.keys().next().value);
  cache.set(key, { result, time: Date.now(), ttl: result.partial ? 30000 : 300000 });
  return result;
}
