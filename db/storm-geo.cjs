'use strict';

/**
 * Shared storm geography lookups.
 *
 * County and city names are massively duplicated across states (Carroll, Hamilton,
 * Montgomery, Warren, Clinton, Monroe, Jackson, Lawrence, Marion, Brown, Greene, Knox,
 * Washington ... each exist in a dozen states). Any lookup keyed by a bare name will
 * silently stamp an out-of-state alert with the coordinates of a same-named Ohio county,
 * which then defeats the storm-alert service-radius filter entirely.
 *
 * Therefore every lookup in this module is keyed by (STATE, name) and the caller must
 * resolve the state from the NWS zone / UGC code — never by guessing from area names.
 */

const STATE_NAME_TO_ABBR = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
  'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
  'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
  'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
};

const ALL_STATE_ABBRS = Object.values(STATE_NAME_TO_ABBR);
const VALID_STATE_ABBRS = new Set(ALL_STATE_ABBRS.concat(['DC']));

const STATE_CENTROIDS = {
  AL: { lat: 32.3182, lng: -86.9023 }, AK: { lat: 64.2008, lng: -149.4937 },
  AZ: { lat: 34.0489, lng: -111.0937 }, AR: { lat: 34.7465, lng: -92.2896 },
  CA: { lat: 36.7783, lng: -119.4179 }, CO: { lat: 39.5501, lng: -105.7821 },
  CT: { lat: 41.6032, lng: -73.0877 }, DE: { lat: 38.9108, lng: -75.5277 },
  DC: { lat: 38.9072, lng: -77.0369 }, FL: { lat: 27.9944, lng: -81.7603 },
  GA: { lat: 32.1656, lng: -82.9001 }, HI: { lat: 19.8968, lng: -155.5828 },
  ID: { lat: 44.0682, lng: -114.7420 }, IL: { lat: 40.3495, lng: -88.9861 },
  IN: { lat: 40.2672, lng: -86.1349 }, IA: { lat: 41.8780, lng: -93.0977 },
  KS: { lat: 39.0119, lng: -98.4842 }, KY: { lat: 37.8393, lng: -84.2700 },
  LA: { lat: 30.9843, lng: -91.9623 }, ME: { lat: 45.2538, lng: -69.4455 },
  MD: { lat: 39.0458, lng: -76.6413 }, MA: { lat: 42.4072, lng: -71.3824 },
  MI: { lat: 44.3148, lng: -85.6024 }, MN: { lat: 46.3750, lng: -94.6859 },
  MS: { lat: 32.7673, lng: -89.6812 }, MO: { lat: 38.5767, lng: -92.1735 },
  MT: { lat: 46.8797, lng: -110.3626 }, NE: { lat: 41.4925, lng: -99.9018 },
  NV: { lat: 38.8026, lng: -116.4194 }, NH: { lat: 43.1939, lng: -71.5724 },
  NJ: { lat: 40.0583, lng: -74.4057 }, NM: { lat: 34.5199, lng: -105.8701 },
  NY: { lat: 43.2994, lng: -74.2179 }, NC: { lat: 35.6302, lng: -79.8060 },
  ND: { lat: 47.5515, lng: -101.0020 }, OH: { lat: 40.4173, lng: -82.9071 },
  OK: { lat: 35.4676, lng: -97.5164 }, OR: { lat: 43.8041, lng: -120.5542 },
  PA: { lat: 40.9999, lng: -77.6109 }, RI: { lat: 41.5801, lng: -71.4774 },
  SC: { lat: 33.8361, lng: -81.1637 }, SD: { lat: 43.9695, lng: -99.9018 },
  TN: { lat: 35.8580, lng: -86.3505 }, TX: { lat: 31.9686, lng: -99.9018 },
  UT: { lat: 39.3210, lng: -111.0937 }, VT: { lat: 44.5588, lng: -72.5778 },
  VA: { lat: 37.7693, lng: -78.1700 }, WA: { lat: 47.7511, lng: -120.7401 },
  WV: { lat: 38.4680, lng: -80.9696 }, WI: { lat: 44.2685, lng: -89.6165 },
  WY: { lat: 43.0760, lng: -107.2903 },
};

/**
 * Approximate state bounding boxes, used ONLY to detect gross disagreement between a
 * stored coordinate and the state the NWS zone says the alert is in. Boxes are generous
 * (they overlap at borders), so a "match" is weak evidence but a "miss" is strong:
 * a point hundreds of miles outside the box is definitively not in that state.
 */
const STATE_BOUNDS = {
  AL: { minLat: 30.14, maxLat: 35.01, minLng: -88.48, maxLng: -84.88 },
  AK: { minLat: 51.20, maxLat: 71.45, minLng: -180.0, maxLng: -129.0 },
  AZ: { minLat: 31.33, maxLat: 37.01, minLng: -114.82, maxLng: -109.04 },
  AR: { minLat: 32.99, maxLat: 36.51, minLng: -94.62, maxLng: -89.64 },
  CA: { minLat: 32.53, maxLat: 42.01, minLng: -124.49, maxLng: -114.13 },
  CO: { minLat: 36.99, maxLat: 41.01, minLng: -109.07, maxLng: -102.04 },
  CT: { minLat: 40.95, maxLat: 42.06, minLng: -73.74, maxLng: -71.78 },
  DE: { minLat: 38.44, maxLat: 39.85, minLng: -75.80, maxLng: -74.98 },
  DC: { minLat: 38.79, maxLat: 39.00, minLng: -77.12, maxLng: -76.90 },
  FL: { minLat: 24.39, maxLat: 31.01, minLng: -87.64, maxLng: -79.97 },
  GA: { minLat: 30.35, maxLat: 35.01, minLng: -85.61, maxLng: -80.83 },
  HI: { minLat: 18.90, maxLat: 22.24, minLng: -160.26, maxLng: -154.80 },
  ID: { minLat: 41.98, maxLat: 49.01, minLng: -117.25, maxLng: -111.04 },
  IL: { minLat: 36.96, maxLat: 42.51, minLng: -91.52, maxLng: -87.01 },
  IN: { minLat: 37.76, maxLat: 41.77, minLng: -88.10, maxLng: -84.78 },
  IA: { minLat: 40.37, maxLat: 43.51, minLng: -96.64, maxLng: -90.13 },
  KS: { minLat: 36.98, maxLat: 40.01, minLng: -102.06, maxLng: -94.58 },
  KY: { minLat: 36.49, maxLat: 39.15, minLng: -89.58, maxLng: -81.95 },
  LA: { minLat: 28.92, maxLat: 33.03, minLng: -94.05, maxLng: -88.75 },
  ME: { minLat: 42.96, maxLat: 47.47, minLng: -71.09, maxLng: -66.93 },
  MD: { minLat: 37.88, maxLat: 39.73, minLng: -79.49, maxLng: -74.99 },
  MA: { minLat: 41.18, maxLat: 42.89, minLng: -73.51, maxLng: -69.85 },
  MI: { minLat: 41.69, maxLat: 48.31, minLng: -90.42, maxLng: -82.12 },
  MN: { minLat: 43.49, maxLat: 49.39, minLng: -97.24, maxLng: -89.48 },
  MS: { minLat: 30.17, maxLat: 35.01, minLng: -91.66, maxLng: -88.09 },
  MO: { minLat: 35.99, maxLat: 40.62, minLng: -95.78, maxLng: -89.09 },
  MT: { minLat: 44.35, maxLat: 49.01, minLng: -116.06, maxLng: -104.03 },
  NE: { minLat: 39.99, maxLat: 43.01, minLng: -104.06, maxLng: -95.30 },
  NV: { minLat: 34.99, maxLat: 42.01, minLng: -120.01, maxLng: -114.03 },
  NH: { minLat: 42.69, maxLat: 45.31, minLng: -72.56, maxLng: -70.70 },
  NJ: { minLat: 38.92, maxLat: 41.36, minLng: -75.57, maxLng: -73.88 },
  NM: { minLat: 31.33, maxLat: 37.01, minLng: -109.06, maxLng: -102.99 },
  NY: { minLat: 40.48, maxLat: 45.02, minLng: -79.77, maxLng: -71.84 },
  NC: { minLat: 33.83, maxLat: 36.59, minLng: -84.33, maxLng: -75.45 },
  ND: { minLat: 45.93, maxLat: 49.01, minLng: -104.06, maxLng: -96.55 },
  OH: { minLat: 38.39, maxLat: 42.33, minLng: -84.83, maxLng: -80.51 },
  OK: { minLat: 33.61, maxLat: 37.01, minLng: -103.01, maxLng: -94.42 },
  OR: { minLat: 41.98, maxLat: 46.30, minLng: -124.57, maxLng: -116.45 },
  PA: { minLat: 39.71, maxLat: 42.28, minLng: -80.53, maxLng: -74.68 },
  RI: { minLat: 41.14, maxLat: 42.02, minLng: -71.91, maxLng: -71.11 },
  SC: { minLat: 32.02, maxLat: 35.22, minLng: -83.36, maxLng: -78.53 },
  SD: { minLat: 42.47, maxLat: 45.95, minLng: -104.06, maxLng: -96.43 },
  TN: { minLat: 34.97, maxLat: 36.69, minLng: -90.32, maxLng: -81.64 },
  TX: { minLat: 25.83, maxLat: 36.51, minLng: -106.66, maxLng: -93.50 },
  UT: { minLat: 36.99, maxLat: 42.01, minLng: -114.06, maxLng: -109.04 },
  VT: { minLat: 42.72, maxLat: 45.02, minLng: -73.44, maxLng: -71.46 },
  VA: { minLat: 36.53, maxLat: 39.47, minLng: -83.68, maxLng: -75.23 },
  WA: { minLat: 45.53, maxLat: 49.01, minLng: -124.86, maxLng: -116.91 },
  WV: { minLat: 37.19, maxLat: 40.65, minLng: -82.65, maxLng: -77.71 },
  WI: { minLat: 42.48, maxLat: 47.32, minLng: -92.89, maxLng: -86.75 },
  WY: { minLat: 40.99, maxLat: 45.01, minLng: -111.06, maxLng: -104.04 },
};

/**
 * County centroids keyed by "<STATE>:<normalized county name>".
 * NEVER add a bare-name key here — see the module header.
 */
const COUNTY_CENTROIDS = {
  // --- Ohio ---
  'OH:cuyahoga': { lat: 41.4993, lng: -81.6944 }, 'OH:summit': { lat: 41.1270, lng: -81.5157 },
  'OH:lake': { lat: 41.7192, lng: -81.2402 }, 'OH:lorain': { lat: 41.4528, lng: -82.1821 },
  'OH:medina': { lat: 41.1387, lng: -81.8646 }, 'OH:geauga': { lat: 41.4993, lng: -81.1784 },
  'OH:portage': { lat: 41.1595, lng: -81.1948 }, 'OH:stark': { lat: 40.8148, lng: -81.3784 },
  'OH:wayne': { lat: 40.8209, lng: -81.9332 }, 'OH:mahoning': { lat: 41.0998, lng: -80.7734 },
  'OH:trumbull': { lat: 41.2995, lng: -80.7670 }, 'OH:ashtabula': { lat: 41.8612, lng: -80.7900 },
  'OH:erie': { lat: 41.4409, lng: -82.5835 }, 'OH:huron': { lat: 41.1484, lng: -82.5535 },
  'OH:ashland': { lat: 40.8581, lng: -82.3046 }, 'OH:richland': { lat: 40.7670, lng: -82.5302 },
  'OH:morrow': { lat: 40.5473, lng: -82.8168 }, 'OH:knox': { lat: 40.3884, lng: -82.4899 },
  'OH:holmes': { lat: 40.5673, lng: -81.9190 }, 'OH:tuscarawas': { lat: 40.4376, lng: -81.4807 },
  'OH:carroll': { lat: 40.5763, lng: -81.0890 }, 'OH:columbiana': { lat: 40.7726, lng: -80.7804 },
  'OH:franklin': { lat: 39.9612, lng: -82.9988 }, 'OH:hamilton': { lat: 39.1031, lng: -84.5120 },
  'OH:montgomery': { lat: 39.7589, lng: -84.1916 }, 'OH:lucas': { lat: 41.6528, lng: -83.5379 },
  'OH:wood': { lat: 41.3684, lng: -83.6210 }, 'OH:licking': { lat: 40.0782, lng: -82.4896 },
  'OH:delaware': { lat: 40.2648, lng: -83.0024 }, 'OH:fairfield': { lat: 39.7523, lng: -82.6296 },
  'OH:hancock': { lat: 41.0034, lng: -83.6654 }, 'OH:seneca': { lat: 41.1237, lng: -83.0657 },
  'OH:belmont': { lat: 40.0165, lng: -80.9929 }, 'OH:harrison': { lat: 40.2976, lng: -81.0765 },
  'OH:jefferson': { lat: 40.3748, lng: -80.7637 }, 'OH:muskingum': { lat: 39.9765, lng: -81.9596 },
  'OH:guernsey': { lat: 40.0565, lng: -81.4876 }, 'OH:noble': { lat: 39.7779, lng: -81.5512 },
  'OH:monroe': { lat: 39.6815, lng: -81.0582 }, 'OH:coshocton': { lat: 40.2726, lng: -81.8929 },
  'OH:morgan': { lat: 39.6165, lng: -81.8262 },

  // --- Pennsylvania ---
  'PA:allegheny': { lat: 40.4406, lng: -79.9959 }, 'PA:butler': { lat: 40.9254, lng: -79.9287 },
  'PA:beaver': { lat: 40.6887, lng: -80.3542 }, 'PA:lawrence': { lat: 40.9982, lng: -80.5313 },
  'PA:mercer': { lat: 41.2980, lng: -80.2398 }, 'PA:venango': { lat: 41.3968, lng: -79.7617 },
  'PA:crawford': { lat: 41.6884, lng: -80.1040 }, 'PA:erie': { lat: 42.1167, lng: -80.0851 },
};

/** Strip "County"/"Parish"/parentheticals and lowercase, so "Carroll County" → "carroll". */
function normalizeAreaName(name) {
  if (!name) return '';
  return String(name)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/,\s*[A-Za-z .]+$/, '')
    .replace(/\b(county|parish|borough|census area|municipality)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeStateAbbr(state) {
  if (!state) return null;
  const raw = String(state).trim();
  const upper = raw.toUpperCase();
  if (VALID_STATE_ABBRS.has(upper)) return upper;
  const named = STATE_NAME_TO_ABBR[raw.toLowerCase()];
  return named || null;
}

/** (state, name) → centroid. Returns null when either is unknown — never a bare-name guess. */
function lookupCountyCentroid(state, name) {
  const abbr = normalizeStateAbbr(state);
  const clean = normalizeAreaName(name);
  if (!abbr || !clean) return null;
  return COUNTY_CENTROIDS[`${abbr}:${clean}`] || null;
}

function lookupStateCentroid(state) {
  const abbr = normalizeStateAbbr(state);
  return abbr ? (STATE_CENTROIDS[abbr] || null) : null;
}

/**
 * NWS UGC codes look like "INC015" (county) or "OHZ011" (forecast zone): the first two
 * characters are the state. Marine/offshore zones (ANZ, LEZ, GMZ, PZZ...) have no state
 * and are filtered out. Returns unique state abbreviations in the order they appear.
 */
function statesFromUgcCodes(ugcCodes) {
  const out = [];
  for (const code of (ugcCodes || [])) {
    const abbr = normalizeStateAbbr(String(code || '').substring(0, 2));
    if (abbr && !out.includes(abbr)) out.push(abbr);
  }
  return out;
}

/** Per-area state list aligned index-wise with areaDesc entries, falling back to the first zone state. */
function statesForAreaList(ugcCodes, areaCount) {
  const codes = ugcCodes || [];
  const zoneStates = statesFromUgcCodes(codes);
  const fallback = zoneStates[0] || null;
  const out = [];
  for (let i = 0; i < areaCount; i++) {
    const abbr = normalizeStateAbbr(String(codes[i] || '').substring(0, 2));
    out.push(abbr || fallback);
  }
  return out;
}

/** Which states' bounding boxes contain this point (buffered). */
function statesForCoords(lat, lng, bufferDeg = 0.25) {
  const la = parseFloat(lat), ln = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return [];
  const hits = [];
  for (const [abbr, b] of Object.entries(STATE_BOUNDS)) {
    if (la >= b.minLat - bufferDeg && la <= b.maxLat + bufferDeg &&
        ln >= b.minLng - bufferDeg && ln <= b.maxLng + bufferDeg) {
      hits.push(abbr);
    }
  }
  return hits;
}

/**
 * True when the coordinate is plausibly inside at least one of the event's zone states.
 *
 * Returns true (trust the coordinate) whenever we cannot prove otherwise — no coordinate,
 * no resolvable zone state, or a zone state we have no bounding box for. Only a coordinate
 * that provably sits outside every claimed state is rejected.
 */
function coordsAgreeWithStates(lat, lng, states, bufferDeg = 0.25) {
  const la = parseFloat(lat), ln = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return true;
  const abbrs = (states || []).map(normalizeStateAbbr).filter(s => s && STATE_BOUNDS[s]);
  if (abbrs.length === 0) return true;
  for (const abbr of abbrs) {
    const b = STATE_BOUNDS[abbr];
    if (la >= b.minLat - bufferDeg && la <= b.maxLat + bufferDeg &&
        ln >= b.minLng - bufferDeg && ln <= b.maxLng + bufferDeg) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve fallback coordinates for an NWS alert that has no polygon geometry.
 * Walks the areaDesc county list paired with the matching UGC state, then falls back to
 * the zone state's centroid. Never matches a county name against the wrong state.
 */
function resolveNwsFallbackCoords({ ugcCodes, areaDesc, fallbackState, maxCounties = 5 }) {
  const areas = String(areaDesc || '').split(';').map(s => s.trim()).filter(Boolean);
  const areaStates = statesForAreaList(ugcCodes, areas.length);
  const zoneStates = statesFromUgcCodes(ugcCodes);
  const primaryState = zoneStates[0] || normalizeStateAbbr(fallbackState) || null;

  const limit = Math.min(areas.length, maxCounties);
  for (let i = 0; i < limit; i++) {
    const state = areaStates[i] || primaryState;
    const hit = lookupCountyCentroid(state, areas[i]);
    if (hit) return { lat: hit.lat, lng: hit.lng, state, source: 'county_centroid' };
  }

  const stateHit = lookupStateCentroid(primaryState);
  if (stateHit) return { lat: stateHit.lat, lng: stateHit.lng, state: primaryState, source: 'state_centroid' };
  return { lat: null, lng: null, state: primaryState, source: 'none' };
}

/** Every coordinate this module can produce, for spotting name-table-derived values. */
const _LOOKUP_POINTS = []
  .concat(Object.values(COUNTY_CENTROIDS))
  .concat(Object.values(STATE_CENTROIDS));

/**
 * True when a coordinate is (within rounding) one of our lookup-table centroids rather
 * than a measured position. A real NWS polygon centroid or an IEM storm-report GPS fix
 * essentially never lands exactly on a table entry.
 */
function isLookupCentroid(lat, lng, toleranceDeg = 0.0005) {
  const la = parseFloat(lat), ln = parseFloat(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  return _LOOKUP_POINTS.some(p =>
    Math.abs(p.lat - la) <= toleranceDeg && Math.abs(p.lng - ln) <= toleranceDeg);
}

/**
 * Best-effort zone states for a stored StormEvent row: prefer the UGC-derived values we
 * persist at ingestion, then nws_state, then explicit two-letter states in area strings.
 */
function zoneStatesForStormEvent(storm) {
  if (!storm) return [];
  const out = [];
  const push = (v) => { const a = normalizeStateAbbr(v); if (a && !out.includes(a)) out.push(a); };

  for (const s of (Array.isArray(storm.nws_states) ? storm.nws_states : [])) push(s);
  push(storm.nws_state);
  if (out.length > 0) return out;

  const areas = Array.isArray(storm.affected_areas) ? storm.affected_areas : [];
  for (const area of areas.concat([storm.title || ''])) {
    const m = String(area).match(/,\s*([A-Za-z]{2})\b/);
    if (m) push(m[1]);
  }
  return out;
}

/**
 * Is this row's stored coordinate a county-name collision?
 *
 * A coordinate is only rejected when BOTH are true:
 *   1. it provably sits outside every state the event's own NWS zone claims, and
 *   2. it is a lookup-table centroid (or the row is explicitly flagged as having no
 *      polygon geometry) — i.e. it was derived from a NAME, not measured.
 *
 * The second condition matters: a real alert polygon can straddle a state line, so its
 * centroid may fall just outside the first UGC code's state. Those coordinates are
 * measured and must stay trusted.
 */
function stormCoordsAreCollided(storm) {
  if (!storm) return false;
  const la = parseFloat(storm.latitude), ln = parseFloat(storm.longitude);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;

  const zoneStates = zoneStatesForStormEvent(storm);
  if (zoneStates.length === 0) return false;
  if (coordsAgreeWithStates(la, ln, zoneStates)) return false;

  const noPolygon = storm.has_geometry === false || storm.has_geometry === 'false';
  return noPolygon || isLookupCentroid(la, ln);
}

/** Convenience inverse used by the alert gate. */
function stormCoordsTrusted(storm) {
  if (!storm) return false;
  const la = parseFloat(storm.latitude), ln = parseFloat(storm.longitude);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  return !stormCoordsAreCollided(storm);
}

module.exports = {
  STATE_NAME_TO_ABBR,
  ALL_STATE_ABBRS,
  STATE_CENTROIDS,
  STATE_BOUNDS,
  COUNTY_CENTROIDS,
  normalizeAreaName,
  normalizeStateAbbr,
  lookupCountyCentroid,
  lookupStateCentroid,
  statesFromUgcCodes,
  statesForAreaList,
  statesForCoords,
  coordsAgreeWithStates,
  isLookupCentroid,
  resolveNwsFallbackCoords,
  zoneStatesForStormEvent,
  stormCoordsAreCollided,
  stormCoordsTrusted,
};
