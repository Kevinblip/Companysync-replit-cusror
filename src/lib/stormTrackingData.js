export const STORM_EVENTS_PAGE_SIZE = 1000;

const normalizeIdentityText = value => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' ');

function stormIdentityKey(storm) {
  const explicitId = [
    storm.noaa_event_id,
    storm.nws_event_id,
    storm.external_id,
    storm.storm_id,
    storm.event_id,
    storm.id,
  ].find(value => value !== null && value !== undefined && String(value).trim() !== '');
  if (explicitId !== undefined) return `id:${String(explicitId).trim()}`;

  const areas = Array.isArray(storm.affected_areas)
    ? storm.affected_areas.map(normalizeIdentityText).filter(Boolean).sort().join('|')
    : '';
  const rawLat = storm.latitude ?? storm.lat;
  const rawLng = storm.longitude ?? storm.lng;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const hasCoordinates = rawLat !== null && rawLat !== undefined && String(rawLat).trim() !== ''
    && rawLng !== null && rawLng !== undefined && String(rawLng).trim() !== ''
    && Number.isFinite(lat) && Number.isFinite(lng);
  const location = areas || (hasCoordinates
    ? `${lat.toFixed(4)},${lng.toFixed(4)}`
    : normalizeIdentityText(storm.location || storm.city || storm.county || storm.title));

  const rawTime = storm.start_time || storm.event_time || storm.onset || storm.startTime || storm.timestamp;
  const parsedTime = rawTime ? Date.parse(rawTime) : NaN;
  const time = Number.isFinite(parsedTime) ? new Date(parsedTime).toISOString() : normalizeIdentityText(rawTime);
  const type = normalizeIdentityText(storm.event_type || storm.storm_type || storm.type || storm.nws_event);
  if (!location || !time || !type) return null;
  return `fallback:${location}|${time}|${type}`;
}

export function dedupeStormEvents(events) {
  if (!Array.isArray(events)) return [];
  const seen = new Set();
  return events.filter(storm => {
    if (!storm || typeof storm !== 'object') return false;
    const key = stormIdentityKey(storm);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatStormSeverityLabel(value) {
  const words = String(value ?? '').match(/[a-z]+/gi)?.map(word => word.toLowerCase()) || [];
  if (words.length === 0) return 'Moderate';

  // Some responses prepend "severe" to the actual NWS severity. Prefer the
  // remaining severity word so "SEVERE extreme" renders as "Extreme".
  const withoutRedundantSevere = words.filter(word => word !== 'severe');
  const knownSeverities = new Set(['extreme', 'severe', 'moderate', 'minor']);
  const label = [...withoutRedundantSevere].reverse().find(word => knownSeverities.has(word))
    || withoutRedundantSevere.at(-1)
    || 'severe';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Load every page of storm events for the same filter set. The server caps a
 * single request at 1,000 rows so large results do not depend on one oversized
 * response, while the UI still avoids an arbitrary 500-event ceiling.
 */
export async function fetchAllStormEvents(invoke, params, pageSize = STORM_EVENTS_PAGE_SIZE) {
  if (typeof invoke !== 'function') throw new TypeError('A storm-event request function is required');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > STORM_EVENTS_PAGE_SIZE) {
    throw new RangeError(`Storm page size must be between 1 and ${STORM_EVENTS_PAGE_SIZE}`);
  }

  const storms = [];
  let offset = 0;
  const maxPages = 100;

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
    const response = await invoke('getStormsInArea', { ...params, limit: pageSize, offset });
    const result = response?.data || response || {};
    if (response?.error || result?.success === false || result?.error) {
      throw new Error(result?.error || response?.error?.message || 'Could not load storm events');
    }

    const page = result?.storms;
    if (!Array.isArray(page)) throw new Error('Storm-event response did not contain a storm list');
    storms.push(...page);

    if (page.length < pageSize) {
      const uniqueStorms = dedupeStormEvents(storms);
      return { data: { success: true, storms: uniqueStorms, count: uniqueStorms.length } };
    }
    offset += page.length;
  }

  throw new Error(`Storm results exceeded the ${maxPages * pageSize.toLocaleString()}-event safety limit`);
}