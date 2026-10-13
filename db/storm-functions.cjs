'use strict';

const crypto = require('crypto');
const { persistStormMeshSnapshots } = require('./storm-mesh-snapshots.cjs');
const {
  statesFromUgcCodes,
  resolveNwsFallbackCoords,
  zoneStatesForStormEvent,
  stormCoordsTrusted,
} = require('./storm-geo.cjs');

function generateEntityId(prefix = 'ge') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

const CITY_TO_STATE = {
  'cleveland': 'OH', 'columbus': 'OH', 'cincinnati': 'OH', 'akron': 'OH', 'toledo': 'OH', 'dayton': 'OH',
  'youngstown': 'OH', 'canton': 'OH', 'mansfield': 'OH', 'sandusky': 'OH', 'elyria': 'OH', 'lorain': 'OH',
  'bedford heights': 'OH', 'bedford': 'OH', 'garfield heights': 'OH', 'maple heights': 'OH',
  'parma': 'OH', 'strongsville': 'OH', 'independence': 'OH', 'solon': 'OH', 'beachwood': 'OH',
  'euclid': 'OH', 'mentor': 'OH', 'lakewood': 'OH', 'westlake': 'OH', 'north olmsted': 'OH',
  'brunswick': 'OH', 'medina': 'OH', 'warren': 'OH', 'niles': 'OH',
  'houston': 'TX', 'dallas': 'TX', 'san antonio': 'TX', 'austin': 'TX', 'fort worth': 'TX',
  'miami': 'FL', 'orlando': 'FL', 'tampa': 'FL', 'jacksonville': 'FL',
  'chicago': 'IL', 'detroit': 'MI', 'indianapolis': 'IN', 'pittsburgh': 'PA', 'buffalo': 'NY',
  'atlanta': 'GA', 'charlotte': 'NC', 'nashville': 'TN', 'memphis': 'TN', 'louisville': 'KY',
  'denver': 'CO', 'phoenix': 'AZ', 'los angeles': 'CA', 'new york': 'NY', 'seattle': 'WA',
  'portland': 'OR', 'minneapolis': 'MN', 'kansas city': 'MO', 'st. louis': 'MO', 'oklahoma city': 'OK',
  'tulsa': 'OK', 'omaha': 'NE', 'des moines': 'IA', 'milwaukee': 'WI', 'birmingham': 'AL',
  'new orleans': 'LA', 'raleigh': 'NC', 'richmond': 'VA', 'baltimore': 'MD', 'philadelphia': 'PA',
  'boston': 'MA', 'erie': 'PA'
};

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

// In-process geocoding cache so repeated cron ticks don't hammer Nominatim
const _geocodeCache = {};

async function geocodeLocationRuntime(location) {
  if (!location || !location.trim()) return null;
  const key = location.trim().toLowerCase();
  if (_geocodeCache[key]) return _geocodeCache[key];

  const parts = key.split(',').map(p => p.trim());
  const city = parts[0];
  const state = parts[1] || null;
  const query = state ? `${city}, ${state}, USA` : `${city}, USA`;
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3&countrycodes=us`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'CompanySync-StormAlerts/1.0' } }
    );
    const data = await resp.json();
    if (data && data.length > 0) {
      const result = data.find(d => d.type === 'city' || d.type === 'administrative') || data[0];
      const coords = { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
      _geocodeCache[key] = coords;
      console.log(`[StormAlerts] Geocoded runtime "${location}" → ${coords.lat}, ${coords.lng}`);
      return coords;
    }
  } catch (err) {
    console.warn(`[StormAlerts] Runtime geocode failed for "${location}":`, err.message);
  }
  return null;
}

const NEIGHBOR_STATES = {
  'OH': ['PA', 'WV', 'KY', 'IN', 'MI'], 'TX': ['OK', 'AR', 'LA', 'NM'], 'FL': ['GA', 'AL'],
  'PA': ['NY', 'NJ', 'DE', 'MD', 'WV', 'OH'], 'NY': ['PA', 'NJ', 'CT', 'MA', 'VT'],
  'IL': ['WI', 'IN', 'IA', 'MO', 'KY'], 'MI': ['OH', 'IN', 'WI'], 'GA': ['FL', 'AL', 'TN', 'NC', 'SC'],
  'NC': ['SC', 'GA', 'TN', 'VA'], 'IN': ['OH', 'MI', 'IL', 'KY'], 'KY': ['OH', 'IN', 'IL', 'TN', 'VA', 'WV'],
  'TN': ['KY', 'VA', 'NC', 'GA', 'AL', 'MS', 'AR', 'MO'], 'VA': ['WV', 'KY', 'TN', 'NC', 'MD'],
  'WV': ['OH', 'PA', 'MD', 'VA', 'KY'], 'AL': ['FL', 'GA', 'TN', 'MS'], 'MS': ['AL', 'TN', 'AR', 'LA'],
  'AR': ['MO', 'TN', 'MS', 'LA', 'TX', 'OK'], 'MO': ['IA', 'IL', 'KY', 'TN', 'AR', 'OK', 'KS', 'NE'],
  'OK': ['KS', 'MO', 'AR', 'TX', 'NM', 'CO'], 'LA': ['TX', 'AR', 'MS'], 'CO': ['WY', 'NE', 'KS', 'OK', 'NM', 'UT'],
  'KS': ['NE', 'MO', 'OK', 'CO'], 'NE': ['SD', 'IA', 'MO', 'KS', 'CO', 'WY'],
  'IA': ['MN', 'WI', 'IL', 'MO', 'NE', 'SD'], 'MN': ['WI', 'IA', 'SD', 'ND'],
  'WI': ['MN', 'IA', 'IL', 'MI'], 'SC': ['NC', 'GA'], 'MD': ['PA', 'DE', 'WV', 'VA'],
  'NJ': ['NY', 'PA', 'DE'],
};

const NWS_TYPE_MAP = {
  'Tornado Warning': { event_type: 'tornado', severity: 'extreme' },
  'Tornado Watch': { event_type: 'tornado', severity: 'severe' },
  'Severe Thunderstorm Warning': { event_type: 'thunderstorm', severity: 'severe' },
  'Severe Thunderstorm Watch': { event_type: 'thunderstorm', severity: 'moderate' },
  'Flash Flood Warning': { event_type: 'flood', severity: 'severe' },
  'Flash Flood Watch': { event_type: 'flood', severity: 'moderate' },
  'Flood Warning': { event_type: 'flood', severity: 'moderate' },
  'Flood Advisory': { event_type: 'flood', severity: 'minor' },
  'Flood Watch': { event_type: 'flood', severity: 'minor' },
  'High Wind Warning': { event_type: 'high_wind', severity: 'severe' },
  'High Wind Watch': { event_type: 'high_wind', severity: 'moderate' },
  'Wind Advisory': { event_type: 'high_wind', severity: 'moderate' },
  'Winter Storm Warning': { event_type: 'high_wind', severity: 'severe' },
  'Winter Storm Watch': { event_type: 'high_wind', severity: 'moderate' },
  'Winter Weather Advisory': { event_type: 'high_wind', severity: 'moderate' },
  'Blizzard Warning': { event_type: 'high_wind', severity: 'extreme' },
  'Ice Storm Warning': { event_type: 'high_wind', severity: 'severe' },
  'Lake Effect Snow Warning': { event_type: 'high_wind', severity: 'moderate' },
  'Lake Effect Snow Advisory': { event_type: 'high_wind', severity: 'minor' },
  'Special Weather Statement': { event_type: 'high_wind', severity: 'minor' },
  'Hail': { event_type: 'hail', severity: 'moderate' },
};

// STATE_CENTROIDS / COUNTY_CENTROIDS now live in ./storm-geo.cjs and are keyed by
// (STATE, name). A bare county-name key stamps out-of-state alerts with Ohio coordinates.

function extractStateFromText(text) {
  if (!text) return null;
  const parts = text.split(',').map(p => p.trim());
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (upper.length === 2 && ALL_STATE_ABBRS.includes(upper)) return upper;
    const lower = part.toLowerCase();
    if (STATE_NAME_TO_ABBR[lower]) return STATE_NAME_TO_ABBR[lower];
  }
  const cityLower = parts[0]?.toLowerCase();
  if (cityLower && CITY_TO_STATE[cityLower]) return CITY_TO_STATE[cityLower];
  return null;
}

function parseHailSizeFromText(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  // Named sizes (check before numeric to avoid conflicts)
  if (/SOFT\s*BALL/.test(t)) return 4.0;
  if (/BASE\s*BALL/.test(t)) return 2.75;
  if (/GOLF\s*BALL/.test(t)) return 1.75;
  if (/PING[\s-]*PONG/.test(t)) return 1.5;
  if (/TENNIS\s*BALL/.test(t)) return 2.5;
  if (/HALF\s*DOLLAR/.test(t)) return 1.25;
  if (/QUARTER/.test(t) && !/\d+\.?\d*\s*IN/.test(t)) return 1.0;
  if (/NICKEL/.test(t)) return 0.88;
  if (/PENNY|DIME/.test(t)) return 0.75;
  if (/MARBLE/.test(t)) return 0.5;
  if (/PEA/.test(t)) return 0.25;
  // Numeric patterns: "HAIL...1.75 IN", "HAIL UP TO 2 INCHES", "HAIL SIZE...1.00 IN"
  const patterns = [
    /HAIL[^.]{0,40}?(\d+\.?\d*)\s*IN/,
    /(\d+\.?\d*)\s*IN(?:CH)?\s+HAIL/,
    /HAIL\s+OF\s+(\d+\.?\d*)/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const v = parseFloat(m[1]);
      if (v >= 0.25 && v <= 6.0) return v;
    }
  }
  return null;
}

function parseWindSpeedFromText(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  const patterns = [
    /WIND\s+GUSTS?\s+(?:UP\s+TO\s+)?(\d+)\s*MPH/,
    /GUSTS?\s+(?:UP\s+TO\s+)?(\d+)\s*MPH/,
    /WINDS?\s+(?:TO|OF|UP\s+TO)\s+(\d+)\s*MPH/,
    /(\d+)\s*MPH\s+WIND/,
    /WIND\s+SPEEDS?\s+(?:OF\s+)?(\d+)\s*MPH/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const v = parseInt(m[1]);
      if (v >= 25 && v <= 200) return v;
    }
  }
  return null;
}

function classifyEvent(type, magnitude) {
  let eventType = null, severity = 'moderate', hailSize = null, windSpeed = null;
  if (type === 'H') {
    eventType = 'hail';
    hailSize = magnitude ? parseFloat(magnitude) : 0.5;
    if (hailSize >= 2.0) severity = 'extreme';
    else if (hailSize >= 1.0) severity = 'severe';
    else if (hailSize >= 0.75) severity = 'moderate';
    else severity = 'minor';
  } else if (type === 'G' || type === 'D' || type === 'M') {
    eventType = 'high_wind';
    windSpeed = magnitude ? parseFloat(magnitude) : 50;
    if (windSpeed >= 100) severity = 'extreme';
    else if (windSpeed >= 75) severity = 'severe';
    else if (windSpeed >= 58) severity = 'severe';
    else if (windSpeed >= 35) severity = 'moderate';
    else severity = 'minor';
  } else if (type === 'T') {
    eventType = 'tornado'; severity = 'extreme';
  } else if (type === 'W' || type === 'R') {
    eventType = 'thunderstorm';
    windSpeed = magnitude ? parseFloat(magnitude) : null;
    severity = (windSpeed && windSpeed >= 58) ? 'severe' : 'moderate';
  } else if (type === 'F' || type === 'E') {
    eventType = 'flood'; severity = 'moderate';
  }
  return { eventType, severity, hailSize, windSpeed };
}

async function fetchNWSActiveAlerts(pool, states, existingIds) {
  const idsToCheck = existingIds || new Set();
  if (!existingIds) {
    const existing = await pool.query(
      `SELECT data->>'event_id' as eid FROM generic_entities WHERE entity_type='StormEvent' AND data->>'alert_type'='NWS_ACTIVE'`
    );
    existing.rows.forEach(r => { if (r.eid) idsToCheck.add(r.eid); });
  }

  const areaParam = states.join(',');
  let newAlerts = 0;

  try {
    const url = `https://api.weather.gov/alerts/active?area=${areaParam}&status=actual`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CompanySync/1.0 (contact@getcompanysync.com)', 'Accept': 'application/geo+json' }
    });
    if (!resp.ok) {
      console.warn(`[NWS] API returned ${resp.status}`);
      return { newAlerts: 0 };
    }

    const data = await resp.json();
    const features = data.features || [];
    console.log(`[NWS] ${features.length} active alerts for ${areaParam}`);

    await pool.query(
      `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{status}', '"expired"'), updated_date = NOW()
       WHERE entity_type = 'StormEvent' AND data->>'alert_type' = 'NWS_ACTIVE' AND data->>'status' = 'active'
       AND (data->>'expires_at')::timestamp < NOW()`
    );

    await pool.query(
      `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{status}', '"expired"'), updated_date = NOW()
       WHERE entity_type = 'StormEvent' AND data->>'alert_type' = 'NWS_ACTIVE' AND data->>'status' = 'active'
       AND data->>'created_date' < $1`,
      [new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()]
    );

    const batch = [];
    for (const feature of features) {
      const props = feature.properties;
      const alertId = `NWS_${props.id || feature.id}`;
      if (idsToCheck.has(alertId)) continue;

      let mapped = NWS_TYPE_MAP[props.event] || null;
      if (!mapped) {
        const eventLower = (props.event || '').toLowerCase();
        if (eventLower.includes('tornado')) mapped = { event_type: 'tornado', severity: 'extreme' };
        else if (eventLower.includes('hail')) mapped = { event_type: 'hail', severity: 'severe' };
        else if (eventLower.includes('thunderstorm')) mapped = { event_type: 'thunderstorm', severity: 'moderate' };
        else if (eventLower.includes('wind')) mapped = { event_type: 'high_wind', severity: 'moderate' };
        else if (eventLower.includes('flood')) mapped = { event_type: 'flood', severity: 'moderate' };
        else continue;
      }

      let lat = null, lng = null;
      let hasGeometry = false;
      const geom = feature.geometry;
      if (geom) {
        if (geom.type === 'Polygon' && geom.coordinates?.[0]?.length > 0) {
          const coords = geom.coordinates[0];
          lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
          lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
          hasGeometry = true;
        } else if (geom.type === 'MultiPolygon' && geom.coordinates?.[0]?.[0]?.length > 0) {
          const coords = geom.coordinates[0][0];
          lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
          lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
          hasGeometry = true;
        } else if (geom.type === 'Point') {
          [lng, lat] = geom.coordinates;
          hasGeometry = true;
        }
      }
      // Zone states come from the UGC codes (e.g. "INC015" → IN), never from area names —
      // county names collide across states and would stamp Indiana alerts with Ohio coords.
      const ugcCodes = props.geocode?.UGC || [];
      const zoneStates = statesFromUgcCodes(ugcCodes);
      const state = zoneStates[0] || states[0];

      // Fallback: (state, county) centroid lookup, then the zone state's centroid
      if (!lat) {
        const fb = resolveNwsFallbackCoords({
          ugcCodes,
          areaDesc: props.areaDesc || '',
          fallbackState: states[0],
          maxCounties: 5,
        });
        lat = fb.lat;
        lng = fb.lng;
      }

      const affectedAreas = props.areaDesc ? [props.areaDesc] : [];

      const nwsDescText = (props.description || '') + ' ' + (props.headline || '');
      const parsedHail = (mapped.event_type === 'hail' || mapped.event_type === 'thunderstorm')
        ? parseHailSizeFromText(nwsDescText) : null;
      const parsedWind = (mapped.event_type === 'high_wind' || mapped.event_type === 'thunderstorm' || mapped.event_type === 'tornado')
        ? parseWindSpeedFromText(nwsDescText) : null;
      batch.push({
        event_id: alertId,
        alert_type: 'NWS_ACTIVE',
        event_type: mapped.event_type,
        severity: mapped.severity,
        title: `⚡ ACTIVE: ${props.event} — ${props.areaDesc?.split(';')[0] || state}`,
        description: props.description || props.headline,
        headline: props.headline,
        affected_areas: affectedAreas,
        start_time: props.onset || props.effective || new Date().toISOString(),
        expires_at: props.expires,
        latitude: lat || null,
        longitude: lng || null,
        // Reflect whether the coordinate came from the alert POLYGON. A county/state
        // centroid is a name-derived approximation and must not masquerade as geometry,
        // or the radius queries treat a whole-state centroid as a measured storm position.
        has_geometry: hasGeometry,
        coordinate_source: hasGeometry ? 'polygon' : (lat !== null ? 'centroid' : 'none'),
        radius_miles: hasGeometry ? 20 : 50,
        source: 'NWS_ACTIVE',
        data_source: 'NWS_ACTIVE',
        status: 'active',
        nws_id: props.id,
        nws_event: props.event,
        nws_state: state,
        nws_states: zoneStates.length > 0 ? zoneStates : (state ? [state] : []),
        nws_sender: props.senderName,
        created_date: new Date().toISOString(),
        ...(parsedHail !== null ? { hail_size_inches: parsedHail, hail_source: 'nws_parsed' } : {}),
        ...(parsedWind !== null ? { wind_speed_mph: parsedWind, wind_source: 'nws_parsed' } : {}),
      });
      idsToCheck.add(alertId);
    }

    if (batch.length > 0) {
      const values = [], placeholders = [];
      let idx = 1;
      for (const storm of batch) {
        const id = generateEntityId('storm');
        storm.id = id;
        placeholders.push(`($${idx}, 'StormEvent', 'companysync_master_001', $${idx+1}, NOW(), NOW())`);
        values.push(id, JSON.stringify(storm));
        idx += 2;
      }
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ${placeholders.join(', ')}`,
        values
      );
      newAlerts = batch.length;
      console.log(`[NWS] Inserted ${newAlerts} new active alerts`);
      await persistStormMeshSnapshots(pool, batch);
    }

    return { success: true, newAlerts, total: features.length };
  } catch (err) {
    console.error('[NWS] Error:', err.message);
    return { success: false, newAlerts: 0, error: err.message };
  }
}

async function fetchNWSHistoricalAlerts(pool, states, daysBack = 90) {
  if (!states || states.length === 0) {
    console.log('[NWS-HIST] No states provided, skipping');
    return { success: false, imported: 0 };
  }

  try {
    const now = new Date();
    const startDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const startStr = startDate.toISOString();

    const existing = await pool.query(
      `SELECT data->>'event_id' as eid FROM generic_entities WHERE entity_type='StormEvent' AND data->>'source'='NWS_HISTORICAL'`
    );
    const existingIds = new Set(existing.rows.map(r => r.eid).filter(Boolean));

    const areaParam = states.join(',');
    const allBatches = [];
    let nextUrl = `https://api.weather.gov/alerts?area=${areaParam}&start=${startStr}&status=actual&limit=500`;
    let pages = 0;

    console.log(`[NWS-HIST] Fetching historical alerts for ${areaParam} since ${startStr.substring(0, 10)}...`);

    while (nextUrl && pages < 30) {
      try {
        const resp = await fetch(nextUrl, {
          headers: { 'User-Agent': 'CompanySync/1.0 (contact@getcompanysync.com)', 'Accept': 'application/geo+json' }
        });
        if (!resp.ok) {
          console.warn(`[NWS-HIST] API returned ${resp.status} for page ${pages + 1}`);
          break;
        }

        const data = await resp.json();
        const features = data.features || [];
        if (features.length === 0) break;

        for (const feature of features) {
          const props = feature.properties;
          const alertId = `NWS_HIST_${props.id || feature.id}`;
          if (existingIds.has(alertId)) continue;

          let mapped = NWS_TYPE_MAP[props.event];
          if (!mapped) {
            const lower = (props.event || '').toLowerCase();
            if (lower.includes('tornado')) mapped = { event_type: 'tornado', severity: 'extreme' };
            else if (lower.includes('hail')) mapped = { event_type: 'hail', severity: 'severe' };
            else if (lower.includes('thunderstorm')) mapped = { event_type: 'thunderstorm', severity: 'moderate' };
            else if (lower.includes('blizzard') || lower.includes('snow warning')) mapped = { event_type: 'high_wind', severity: 'extreme' };
            else if (lower.includes('winter') || lower.includes('ice storm')) mapped = { event_type: 'high_wind', severity: 'severe' };
            else if (lower.includes('wind') || lower.includes('advisory')) mapped = { event_type: 'high_wind', severity: 'moderate' };
            else if (lower.includes('flood')) mapped = { event_type: 'flood', severity: 'moderate' };
            else continue;
          }

          let lat = null, lng = null, hasGeometry = false;
          const geom = feature.geometry;
          if (geom) {
            if (geom.type === 'Polygon' && geom.coordinates?.[0]?.length > 0) {
              const coords = geom.coordinates[0];
              lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
              lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
              hasGeometry = true;
            } else if (geom.type === 'Point' && geom.coordinates?.length >= 2) {
              [lng, lat] = geom.coordinates;
              hasGeometry = true;
            }
          }

          const ugcCodes = props.geocode?.UGC || [];
          const zoneStates = statesFromUgcCodes(ugcCodes);
          const alertState = zoneStates[0] || states[0] || 'OH';

          if (!hasGeometry) {
            const fb = resolveNwsFallbackCoords({
              ugcCodes,
              areaDesc: props.areaDesc || '',
              fallbackState: alertState,
              maxCounties: 3,
            });
            lat = fb.lat;
            lng = fb.lng;
          }

          const affectedAreas = props.areaDesc
            ? props.areaDesc.split(';').map(s => s.trim()).filter(Boolean)
            : [];

          const histDescText = (props.description || '') + ' ' + (props.headline || '');
          const histParsedHail = (mapped.event_type === 'hail' || mapped.event_type === 'thunderstorm')
            ? parseHailSizeFromText(histDescText) : null;
          const histParsedWind = (mapped.event_type === 'high_wind' || mapped.event_type === 'thunderstorm' || mapped.event_type === 'tornado')
            ? parseWindSpeedFromText(histDescText) : null;
          allBatches.push({
            event_id: alertId,
            alert_type: 'NWS_HIST',
            source: 'NWS_HISTORICAL',
            data_source: 'NWS_HISTORICAL',
            event_type: mapped.event_type,
            severity: mapped.severity,
            title: `${props.event} — ${affectedAreas[0] || alertState}`,
            description: props.description || props.headline,
            headline: props.headline,
            affected_areas: affectedAreas,
            nws_state: alertState,
            nws_states: zoneStates.length > 0 ? zoneStates : [alertState],
            start_time: props.onset || props.effective || props.sent,
            end_time: props.expires,
            latitude: lat,
            longitude: lng,
            radius_miles: hasGeometry ? 20 : 60,
            has_geometry: hasGeometry,
            nws_id: props.id,
            nws_event: props.event,
            nws_sender: props.senderName,
            status: 'ended',
            ...(histParsedHail !== null ? { hail_size_inches: histParsedHail, hail_source: 'nws_parsed' } : {}),
            ...(histParsedWind !== null ? { wind_speed_mph: histParsedWind, wind_source: 'nws_parsed' } : {}),
          });
          existingIds.add(alertId);
        }

        nextUrl = data.pagination?.next || null;
        pages++;
      } catch (pageErr) {
        console.warn(`[NWS-HIST] Page ${pages + 1} failed:`, pageErr.message);
        break;
      }
    }

    let totalImported = 0;
    if (allBatches.length > 0) {
      const BATCH_SIZE = 100;
      for (let i = 0; i < allBatches.length; i += BATCH_SIZE) {
        const batch = allBatches.slice(i, i + BATCH_SIZE);
        const values = [], placeholders = [];
        let idx = 1;
        for (const storm of batch) {
          const id = generateEntityId('storm');
          storm.id = id;
          placeholders.push(`($${idx}, 'StormEvent', 'companysync_master_001', $${idx+1}, NOW(), NOW())`);
          values.push(id, JSON.stringify(storm));
          idx += 2;
        }
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ${placeholders.join(', ')}`,
          values
        );
      }
      totalImported = allBatches.length;
      console.log(`[NWS-HIST] Imported ${totalImported} historical NWS alerts (${pages} pages, ${states.join(',')})`);
    } else {
      console.log(`[NWS-HIST] No new historical alerts found`);
    }
    await persistStormMeshSnapshots(pool, allBatches);

    return { success: true, imported: totalImported, pages };
  } catch (err) {
    console.error('[NWS-HIST] Error:', err.message);
    return { success: false, imported: 0, error: err.message };
  }
}

async function fetchStormDataV2(pool, params) {
  const { daysBack = 30, nationwide = false, states = null } = params || {};
  console.log(`[Storm] Fetching storm data V2 (${daysBack} days back, nationwide: ${nationwide})...`);

  try {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - daysBack);

    let targetStates = new Set();
    if (Array.isArray(states) && states.length > 0) {
      // Explicit state list (used by the storm-alert cron, which derives states
      // from office_locations — a field the settings-scan below doesn't read).
      for (const s of states) {
        const up = String(s).toUpperCase();
        if (ALL_STATE_ABBRS.includes(up)) targetStates.add(up);
      }
    } else if (nationwide) {
      ALL_STATE_ABBRS.forEach(s => targetStates.add(s));
    } else {
      let settingsLoaded = false;
      try {
        const settingsResult = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'StormAlertSettings' ORDER BY updated_date DESC`
        );
        let maxRadius = 0;
        for (const row of settingsResult.rows) {
          const settings = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
          if (settings.service_center_location) {
            const centerState = extractStateFromText(settings.service_center_location);
            if (centerState) { targetStates.add(centerState); }
          }
          const serviceAreas = settings.service_areas || [];
          for (const area of serviceAreas) {
            const areaState = extractStateFromText(area);
            if (areaState) targetStates.add(areaState);
          }
          // Multi-office setups store locations in office_locations (the newer
          // UI) — read them too, or office-only companies fall back to defaults.
          const offices = settings.office_locations || [];
          for (const office of offices) {
            const officeState = extractStateFromText(office.location || '');
            if (officeState) targetStates.add(officeState);
            const or = office.radius_miles || 0;
            if (or > maxRadius) maxRadius = or;
          }
          const r = settings.service_radius_miles || 60;
          if (r > maxRadius) maxRadius = r;
        }
        if (targetStates.size > 0) {
          settingsLoaded = true;
          if (maxRadius >= 75) {
            const current = Array.from(targetStates);
            for (const st of current) {
              (NEIGHBOR_STATES[st] || []).forEach(n => targetStates.add(n));
            }
          }
        }
      } catch (e) {
        console.warn('[Storm] Could not load settings:', e.message);
      }
      if (!settingsLoaded || targetStates.size === 0) {
        ['OH', 'TX', 'FL'].forEach(s => targetStates.add(s));
      }
    }

    const stateList = Array.from(targetStates);
    console.log(`[Storm] Fetching ${stateList.length} states: ${stateList.join(', ')}`);

    const existingIdsResult = await pool.query(
      "SELECT data->>'event_id' as eid FROM generic_entities WHERE entity_type = 'StormEvent'"
    );
    const existingIds = new Set(existingIdsResult.rows.map(r => r.eid));
    let totalNew = 0;
    const stateBreakdown = {};
    const newStormRows = [];

    const daysBackNum = parseInt(daysBack);
    const chunkDays = daysBackNum > 180 ? 30 : (daysBackNum > 60 ? 60 : daysBackNum);
    const timeChunks = [];
    let chunkStart = new Date(startDate);
    while (chunkStart < now) {
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
      if (chunkEnd > now) chunkEnd.setTime(now.getTime());
      timeChunks.push({
        sts: chunkStart.toISOString().substring(0, 16),
        ets: chunkEnd.toISOString().substring(0, 16)
      });
      chunkStart = new Date(chunkEnd);
    }
    console.log(`[Storm] Split into ${timeChunks.length} time chunks of ~${chunkDays} days`);

    for (const state of stateList) {
      let stateNew = 0;
      let stateTotal = 0;

      for (const chunk of timeChunks) {
        try {
          const url = `https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=${chunk.sts}&ets=${chunk.ets}&states=${state}`;
          const response = await fetch(url);
          if (!response.ok) continue;

          const data = await response.json();
          const features = data.features || [];
          stateTotal += features.length;

          const batch = [];
          for (const feature of features) {
            const props = feature.properties;
            const coords = feature.geometry?.coordinates;
            if (!coords) continue;

            const { eventType, severity, hailSize, windSpeed } = classifyEvent(props.type, props.magnitude);
            if (!eventType) continue;

            const eventId = `IEM_${state}_${eventType}_${coords[1]}_${coords[0]}_${props.valid}`;
            if (existingIds.has(eventId)) continue;

            batch.push({
              event_id: eventId,
              event_type: eventType,
              severity,
              title: `${eventType.toUpperCase()} - ${props.city}, ${state}`,
              description: props.remark,
              affected_areas: [`${props.city}, ${state}`],
              start_time: props.valid,
              latitude: coords[1],
              longitude: coords[0],
              radius_miles: 10,
              hail_size_inches: hailSize,
              wind_speed_mph: windSpeed,
              source: 'IEM V2',
              status: 'ended'
            });
            existingIds.add(eventId);
          }

          if (batch.length > 0) {
            const batchSize = 100;
            for (let i = 0; i < batch.length; i += batchSize) {
              const slice = batch.slice(i, i + batchSize);
              const vals = [], placeholders = [];
              let paramIdx = 1;
              for (const storm of slice) {
                const id = generateEntityId('storm');
                placeholders.push(`($${paramIdx}, 'StormEvent', 'companysync_master_001', $${paramIdx+1}, NOW(), NOW())`);
                vals.push(id, JSON.stringify(storm));
                newStormRows.push({ ...storm, id });
                paramIdx += 2;
              }
              await pool.query(
                `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ${placeholders.join(', ')}`,
                vals
              );
            }
            stateNew += batch.length;
          }
        } catch (e) {
          console.error(`[Storm] Error fetching ${state} chunk:`, e.message);
        }
      }

      if (stateTotal > 0) {
        console.log(`[Storm] ${state}: ${stateTotal} reports, ${stateNew} new`);
        stateBreakdown[state] = { total: stateTotal, new: stateNew };
      }
      totalNew += stateNew;
    }

    try {
      const snapshots = await persistStormMeshSnapshots(pool, newStormRows);
      if (snapshots.saved) console.log(`[Storm] Archived ${snapshots.saved} MESH swath snapshot(s)`);
    } catch (e) {
      console.warn('[Storm] MESH snapshot capture failed (non-fatal):', e.message);
    }

    let nwsNew = 0;
    try {
      const nwsResult = await fetchNWSActiveAlerts(pool, stateList, existingIds);
      nwsNew = nwsResult.newAlerts || 0;
      totalNew += nwsNew;
      console.log(`[Storm] NWS Active Alerts: ${nwsNew} new`);
    } catch (e) {
      console.warn('[Storm] NWS active fetch failed (non-fatal):', e.message);
    }

    let nwsHistNew = 0;
    try {
      const nwsHistResult = await fetchNWSHistoricalAlerts(pool, stateList, daysBack);
      nwsHistNew = nwsHistResult.imported || 0;
      totalNew += nwsHistNew;
      console.log(`[Storm] NWS Historical Alerts: ${nwsHistNew} new`);
    } catch (e) {
      console.warn('[Storm] NWS historical fetch failed (non-fatal):', e.message);
    }

    const totalInDb = existingIds.size;
    console.log(`[Storm] Complete: ${totalNew} new events, ${totalInDb} total in DB`);
    return {
      success: true,
      newEvents: totalNew,
      summary: {
        total_in_database: totalInDb,
        historical_events: totalNew - nwsNew,
        active_alerts: nwsNew,
        by_state: stateBreakdown
      }
    };
  } catch (err) {
    console.error('[Storm] Error:', err.message);
    return { success: false, error: err.message };
  }
}

async function getStormsInArea(pool, params) {
  const { lat, lng, radiusMiles = 50, daysBack = 30, types, statusFilter, limit = 500, offset = 0, includeStates, stateFilter, officeLocations } = params || {};
  const parsedLimit = Number.parseInt(limit, 10);
  const safeLimit = Math.min(1000, Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 500));
  const parsedOffset = Number.parseInt(offset, 10);
  const safeOffset = Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0);

  function haversineSql(latF, lngF) {
    return `3959 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS((data->>'latitude')::float - ${latF}) / 2), 2) +
      COS(RADIANS(${latF})) * COS(RADIANS((data->>'latitude')::float)) *
      POWER(SIN(RADIANS((data->>'longitude')::float - ${lngF}) / 2), 2)
    ))`;
  }

  function haversineJs(lat1, lng1, lat2, lng2) {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  try {
    const baseConditions = [`entity_type = 'StormEvent'`];
    const values = [];
    let paramIdx = 1;

    if (daysBack > 0) {
      baseConditions.push(`(data->>'start_time')::timestamp >= NOW() - INTERVAL '${parseInt(daysBack)} days'`);
    }

    if (statusFilter === 'active') {
      baseConditions.push(`data->>'status' = 'active'`);
    }

    if (types && types.length > 0) {
      const typePlaceholders = types.map(() => `$${paramIdx++}`);
      baseConditions.push(`data->>'event_type' IN (${typePlaceholders.join(', ')})`);
      values.push(...types);
    }

    if (stateFilter && /^[A-Z]{2}$/.test(stateFilter)) {
      baseConditions.push(`(data->>'nws_state' = '${stateFilter}' OR data->>'affected_areas' ~ '\\b${stateFilter}\\b')`);
    }

    const orderBy = `(data->>'start_time')::timestamp DESC NULLS LAST`;

    if (officeLocations && officeLocations.length > 0) {
      const validOffices = officeLocations.filter(o => o.lat && o.lng);
      if (validOffices.length === 0) {
        return { success: true, storms: [], count: 0 };
      }

      const officeGeoConditions = validOffices.map(o => {
        const latF = parseFloat(o.lat);
        const lngF = parseFloat(o.lng);
        const radiusF = parseFloat(o.radiusMiles || 50);
        const latDelta = radiusF / 69.0;
        const lngDelta = radiusF / (69.0 * Math.cos(latF * Math.PI / 180));
        const hav = haversineSql(latF, lngF);
        const safeStates = (o.includeStates || []).filter(s => /^[A-Z]{2}$/.test(s)).map(s => `'${s}'`).join(',');
        const stateClause = safeStates
          ? `OR ((data->>'source' = 'NWS_HISTORICAL' OR data->>'source' = 'NWS_ACTIVE') AND (data->>'has_geometry' = 'false' OR data->>'latitude' IS NULL OR data->>'latitude' = '') AND data->>'nws_state' IN (${safeStates}))`
          : '';
        return `(
          (data->>'latitude' IS NOT NULL AND data->>'latitude' != ''
          AND data->>'longitude' IS NOT NULL AND data->>'longitude' != ''
          AND data->>'has_geometry' IS DISTINCT FROM 'false'
          AND (data->>'latitude')::float BETWEEN ${latF - latDelta} AND ${latF + latDelta}
          AND (data->>'longitude')::float BETWEEN ${lngF - lngDelta} AND ${lngF + lngDelta}
          AND ${hav} <= ${radiusF})
          ${stateClause}
        )`;
      });

      const query = `
        SELECT id, data
        FROM generic_entities
        WHERE ${baseConditions.join(' AND ')}
        AND (${officeGeoConditions.join(' OR ')})
        ORDER BY (data->>'status' = 'active') DESC, ${orderBy}
         LIMIT ${safeLimit} OFFSET ${safeOffset}
      `;

      const result = await pool.query(query, values);
      const storms = result.rows.map(r => {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
        const stormLat = parseFloat(d.latitude);
        const stormLng = parseFloat(d.longitude);
        let nearestOffice = null;
        let minDist = Infinity;
        if (!isNaN(stormLat) && !isNaN(stormLng)) {
          for (const o of validOffices) {
            const dist = haversineJs(parseFloat(o.lat), parseFloat(o.lng), stormLat, stormLng);
            if (dist < minDist) { minDist = dist; nearestOffice = o.name || null; }
          }
        }
        return { id: r.id, ...d, nearest_office: nearestOffice, distance_miles: minDist < Infinity ? parseFloat(minDist.toFixed(1)) : null };
      });

      return { success: true, storms, count: storms.length };
    }

    if (lat && lng) {
      const latF = parseFloat(lat);
      const lngF = parseFloat(lng);
      const radiusF = parseFloat(radiusMiles);
      const latDelta = radiusF / 69.0;
      const lngDelta = radiusF / (69.0 * Math.cos(latF * Math.PI / 180));
      const haversine = haversineSql(latF, lngF);

      const safeStates = (includeStates || [])
        .filter(s => /^[A-Z]{2}$/.test(s))
        .map(s => `'${s}'`).join(',');

      const stateMatchClause = safeStates
        ? `OR ((data->>'source' = 'NWS_HISTORICAL' OR data->>'source' = 'NWS_ACTIVE') AND (data->>'has_geometry' = 'false' OR data->>'latitude' IS NULL OR data->>'latitude' = '') AND data->>'nws_state' IN (${safeStates}))`
        : '';

      const query = `
        SELECT id, data,
          CASE
            WHEN data->>'has_geometry' = 'false' THEN 999
            ELSE ${haversine}
          END AS distance_miles
        FROM generic_entities
        WHERE ${baseConditions.join(' AND ')}
        AND (
          (
            data->>'latitude' IS NOT NULL AND data->>'latitude' != ''
            AND data->>'longitude' IS NOT NULL AND data->>'longitude' != ''
            AND data->>'has_geometry' IS DISTINCT FROM 'false'
            AND (data->>'latitude')::float BETWEEN ${latF - latDelta} AND ${latF + latDelta}
            AND (data->>'longitude')::float BETWEEN ${lngF - lngDelta} AND ${lngF + lngDelta}
            AND ${haversine} <= ${radiusF}
          )
          ${stateMatchClause}
        )
        ORDER BY (data->>'status' = 'active') DESC, ${orderBy}
         LIMIT ${safeLimit} OFFSET ${safeOffset}
      `;

      const result = await pool.query(query, values);
      const storms = result.rows.map(r => {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
        const dist = parseFloat(r.distance_miles);
        return { id: r.id, ...d, distance_miles: dist >= 999 ? null : parseFloat(dist.toFixed(1)) };
      });

      return { success: true, storms, count: storms.length };
    } else {
      const query = `
        SELECT id, data
        FROM generic_entities
        WHERE ${baseConditions.join(' AND ')}
        ORDER BY (data->>'status' = 'active') DESC, ${orderBy}
         LIMIT ${safeLimit} OFFSET ${safeOffset}
      `;
      const result = await pool.query(query, values);
      const storms = result.rows.map(r => {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
        return { id: r.id, ...d };
      });
      return { success: true, storms, count: storms.length };
    }
  } catch (err) {
    console.error('[getStormsInArea] Error:', err.message);
    return { success: false, error: err.message, storms: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Storm Alert Notification Engine
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_CITY_COORDS = {
  'cleveland': { lat: 41.4993, lng: -81.6944 }, 'columbus': { lat: 39.9612, lng: -82.9988 },
  'cincinnati': { lat: 39.1031, lng: -84.5120 }, 'akron': { lat: 41.0814, lng: -81.5190 },
  'toledo': { lat: 41.6528, lng: -83.5379 }, 'dayton': { lat: 39.7589, lng: -84.1916 },
  'youngstown': { lat: 41.0998, lng: -80.6495 }, 'canton': { lat: 40.7989, lng: -81.3784 },
  'houston': { lat: 29.7604, lng: -95.3698 }, 'dallas': { lat: 32.7767, lng: -96.7970 },
  'miami': { lat: 25.7617, lng: -80.1918 }, 'chicago': { lat: 41.8781, lng: -87.6298 },
  'detroit': { lat: 42.3314, lng: -83.0458 }, 'pittsburgh': { lat: 40.4406, lng: -79.9959 },
  'indianapolis': { lat: 39.7684, lng: -86.1581 }, 'atlanta': { lat: 33.7490, lng: -84.3880 },
  'bedford heights': { lat: 41.3939, lng: -81.5068 }, 'bedford': { lat: 41.3923, lng: -81.5365 }, 'beachwood': { lat: 41.4651, lng: -81.5076 },
  'solon': { lat: 41.3895, lng: -81.4415 }, 'parma': { lat: 41.3845, lng: -81.7229 },
  'strongsville': { lat: 41.3142, lng: -81.8358 }, 'medina': { lat: 41.1384, lng: -81.8638 },
  'lorain': { lat: 41.4523, lng: -82.1824 }, 'mentor': { lat: 41.6661, lng: -81.3393 },
  'euclid': { lat: 41.5931, lng: -81.5268 }, 'lakewood': { lat: 41.4819, lng: -81.7982 },
  'elyria': { lat: 41.3684, lng: -82.1074 }, 'westlake': { lat: 41.4553, lng: -81.9179 },
};

/**
 * Decide whether a stored StormEvent should alert a company, given its offices.
 *
 * `offices` entries are the shape built in checkAndSendStormAlerts:
 *   { name, location, radius_miles, service_areas, coords: {lat,lng}|null, locRaw, locParts }
 *
 * Exported so the state-collision regression check can exercise the real gate.
 */
function matchStormToOffices(storm, offices) {
  // A stored coordinate is only trustworthy if it actually falls inside one of the states
  // the NWS zone claims. Rows ingested before (state, name) keying were stamped from a bare
  // county-name table — an Indiana advisory listing "Carroll" got Carroll County OHIO's
  // coordinates — and a bogus coordinate defeats the radius gate outright. Treat a
  // disagreeing coordinate as MISSING so the state-guarded text matcher gets a say.
  const zoneStates = zoneStatesForStormEvent(storm);
  const coordsTrusted = stormCoordsTrusted(storm);

  let matchesArea = false, distanceMiles = null, matchedOfficeName = null;

  for (const office of (offices || [])) {
    const radiusMiles = office.radius_miles || 50;
    const locRaw = office.locRaw !== undefined ? office.locRaw : (office.location || '').toLowerCase().trim();
    const locParts = office.locParts || locRaw.split(',').map(p => p.trim());
    let officeMatch = false, officeDist = null;

    if (office.coords && coordsTrusted) {
      officeDist = stormHaversineDistance(office.coords.lat, office.coords.lng, parseFloat(storm.latitude), parseFloat(storm.longitude));
      if (officeDist <= radiusMiles) officeMatch = true;
    }

    // Text fallback: check affected areas vs office location + service_areas.
    // ONLY run when at least one side lacks usable coordinates. If both the office and the
    // storm have trusted coordinates and the distance already exceeded the radius above,
    // the storm is definitively out of range — don't let an ambiguous city-name substring
    // match (e.g. "Cleveland" in "Cleveland, NC" matching a company in Cleveland, OH)
    // override that result.
    const canDoCoordCheck = office.coords && coordsTrusted;
    if (!officeMatch && !canDoCoordCheck) {
      const stormAreas = storm.affected_areas || [];
      // Office state abbreviation — use the same robust parser as storm-area detection so
      // free-form inputs like "Cleveland, OH 44120" still resolve to "OH" correctly.
      const officeState = extractStateFromText(office.location || locRaw) || '';
      // Zone-level state guard: NWS area lists carry bare county names with no state
      // ("Carroll; Warren; Tippecanoe"), so the per-area guard below cannot see the state
      // at all. The UGC-derived zone state can, and it is authoritative.
      const zoneStateBlocks = officeState && zoneStates.length > 0 && !zoneStates.includes(officeState);
      for (const sa of (zoneStateBlocks ? [] : stormAreas)) {
        const saLower = String(sa).toLowerCase();
        if (locRaw && locParts.some(p => p.length > 3 && saLower.includes(p))) {
          // State guard: if the area string carries a state abbreviation AND we know the
          // office state, they must match — prevents "Cleveland, NC" alerting a company in
          // Cleveland, OH when the storm has no GPS coordinates.
          const areaState = extractStateFromText(sa); // works on original-case string
          if (!areaState || !officeState || areaState === officeState) {
            officeMatch = true;
            break;
          }
        }
        for (const area of (office.service_areas || [])) {
          if (saLower.includes(area.toLowerCase()) || area.toLowerCase().includes(saLower)) { officeMatch = true; break; }
        }
        if (officeMatch) break;
      }
    }

    if (officeMatch) {
      if (!matchesArea || (officeDist !== null && (distanceMiles === null || officeDist < distanceMiles))) {
        matchesArea = true; distanceMiles = officeDist; matchedOfficeName = office.name || 'Service Center';
      }
    }
  }

  return { matchesArea, distanceMiles, matchedOfficeName, coordsTrusted, zoneStates };
}

function stormHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function buildNationwideStormEmailHtml(storms) {
  const dateLong = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  const dateShort = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

  // Hail size buckets (matching Interactive Hail Maps style)
  const hailEvents = storms.filter(s => s.event_type === 'hail' || s.hail_size_inches);
  const hailSmall  = hailEvents.filter(s => (parseFloat(s.hail_size_inches) || 0) < 1).length;
  const hailMedium = hailEvents.filter(s => { const h = parseFloat(s.hail_size_inches) || 0; return h >= 1 && h < 2; }).length;
  const hailLarge  = hailEvents.filter(s => (parseFloat(s.hail_size_inches) || 0) >= 2).length;

  // Group storms by city/area — first segment of affected_areas[0], paired with state
  const cityMap = {};
  const SORDER = ['minor', 'moderate', 'severe', 'extreme'];
  for (const s of storms) {
    const firstArea = (s.affected_areas || [])[0] || s.title || '';
    const parts = firstArea.split(',').map(p => p.trim());
    const cityState = parts.length >= 2 ? `${parts[0]}, ${parts[1]}` : (parts[0] || s.nws_state || 'Unknown');
    if (!cityMap[cityState]) cityMap[cityState] = [];
    cityMap[cityState].push(s);
  }

  // Build city cards sorted by worst severity then alphabetically (cap at 12 cards)
  const sevRank = s => SORDER.indexOf(s.severity || 'moderate');
  const sortedCities = Object.entries(cityMap)
    .sort((a, b) => Math.max(...b[1].map(sevRank)) - Math.max(...a[1].map(sevRank)) || a[0].localeCompare(b[0]))
    .slice(0, 12);
  const extraCities = Object.keys(cityMap).length - sortedCities.length;

  const SEV_COLOR = { extreme: '#dc2626', severe: '#ea580c', moderate: '#d97706', minor: '#65a30d' };

  function cityCard([cityState, events]) {
    const worstSev = events.reduce((best, e) => SORDER.indexOf(e.severity || 'moderate') > SORDER.indexOf(best) ? (e.severity || 'moderate') : best, 'minor');
    const hailEv = events.find(e => e.hail_size_inches || e.event_type === 'hail');
    const windEv = events.find(e => e.event_type === 'high_wind' || e.wind_speed_mph);
    const icon = hailEv ? '🧊' : windEv ? '💨' : events[0]?.event_type === 'tornado' ? '🌪️' : '⛈️';
    const hailStr = hailEv?.hail_size_inches ? `${hailEv.hail_size_inches}" hail` : '';
    const windStr = windEv?.wind_speed_mph ? `${windEv.wind_speed_mph} mph wind` : '';
    const detail = [hailStr, windStr].filter(Boolean).join(' · ') || (events[0]?.event_type || '').replace(/_/g, ' ');
    const impactColor = SEV_COLOR[worstSev] || '#6b7280';
    const bgGrad = hailEv ? 'linear-gradient(135deg,#fff7ed,#fef3c7)' : 'linear-gradient(135deg,#eff6ff,#f0f9ff)';
    return `<td style="width:50%;padding:5px;vertical-align:top;"><div style="background:${bgGrad};border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;height:100%;"><div style="background:#f3f4f6;padding:14px;text-align:center;font-size:30px;line-height:1;">${icon}</div><div style="padding:12px;"><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#111827;">${cityState}</p><p style="margin:0 0 6px;font-size:12px;font-weight:600;color:${impactColor};">impact: ${events.length}</p>${detail ? `<p style="margin:0 0 10px;font-size:12px;color:#6b7280;">${detail}</p>` : '<p style="margin:0 0 10px;"></p>'}<a href="https://getcompanysync.com/StormTracking" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:600;">View Details →</a></div></div></td>`;
  }

  const cardRows = [];
  for (let i = 0; i < sortedCities.length; i += 2) {
    const left = cityCard(sortedCities[i]);
    const right = sortedCities[i + 1] ? cityCard(sortedCities[i + 1]) : '<td style="width:50%;"></td>';
    cardRows.push(`<tr>${left}${right}</tr>`);
  }

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:0;">
  <div style="background:#1a1a2e;padding:24px;text-align:center;">
    <div style="background:#f97316;display:inline-block;padding:5px 16px;border-radius:20px;margin-bottom:14px;"><span style="color:white;font-weight:700;font-size:12px;letter-spacing:0.06em;">⛈ COMPANYSYNC STORM TRACKER</span></div>
    <h1 style="margin:0;color:white;font-size:22px;font-weight:700;">Hail &amp; Wind Report</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:14px;">${dateLong}</p>
  </div>
  <div style="background:#f3f4f6;padding:16px 20px;border-bottom:2px solid #e5e7eb;text-align:center;">
    <p style="margin:0 0 10px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">POSSIBLE HOUSING IMPACT NATIONWIDE</p>
    <table style="width:100%;border-collapse:collapse;"><tr>
      <td style="text-align:center;padding:8px 4px;border-right:1px solid #d1d5db;"><div style="font-size:26px;font-weight:700;color:#111827;">${hailSmall}</div><div style="font-size:11px;color:#6b7280;margin-top:3px;">Under 1"</div></td>
      <td style="text-align:center;padding:8px 4px;border-right:1px solid #d1d5db;"><div style="font-size:26px;font-weight:700;color:#d97706;">${hailMedium}</div><div style="font-size:11px;color:#6b7280;margin-top:3px;">1.00" – 1.99"</div></td>
      <td style="text-align:center;padding:8px 4px;border-right:1px solid #d1d5db;"><div style="font-size:26px;font-weight:700;color:#dc2626;">${hailLarge}</div><div style="font-size:11px;color:#6b7280;margin-top:3px;">2.00"+ (Golf ball)</div></td>
      <td style="text-align:center;padding:8px 4px;background:#1a1a2e;border-radius:0 4px 4px 0;"><div style="font-size:26px;font-weight:700;color:white;">${storms.length}</div><div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:3px;">Total</div></td>
    </tr></table>
  </div>
  <div style="background:white;padding:20px;">
    <p style="margin:0 0 16px;color:#374151;font-size:14px;">The following regions were impacted by hail or severe wind on ${dateShort}. Click any card to explore details in Storm Tracker.</p>
    <table style="width:100%;border-collapse:collapse;">${cardRows.join('')}</table>
    ${extraCities > 0 ? `<p style="margin:12px 0 0;text-align:center;color:#6b7280;font-size:13px;">+ ${extraCities} more region${extraCities > 1 ? 's' : ''} affected</p>` : ''}
    <div style="margin:24px 0 8px;text-align:center;"><a href="https://getcompanysync.com/StormTracking" style="background:#1a1a2e;color:white;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">See all ${storms.length} events in Storm Tracker →</a></div>
  </div>
  <div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px;">CompanySync Storm Tracker — manage alert preferences in Storm Alert Settings.</div>
</div>`;
}

function buildBatchedStormEmailHtml(storms) {
  const now = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  const typeLabel = { hail: 'Hail', tornado: 'Tornado', high_wind: 'High Wind', thunderstorm: 'Thunderstorm', flood: 'Flooding' };
  const severityEmoji = { extreme: '🚨', severe: '⚠️', moderate: '🔶', minor: '🔹' };
  const byOffice = {};
  for (const s of storms) {
    const key = s.matchedOfficeName || 'Service Area';
    if (!byOffice[key]) byOffice[key] = [];
    byOffice[key].push(s);
  }
  const officeBlocks = Object.entries(byOffice).map(([office, list]) => {
    const rows = list.map(s => {
      const label = typeLabel[s.event_type] || s.event_type || 'Weather Event';
      const emoji = severityEmoji[s.severity] || '⚠️';
      const distStr = s.distanceMiles ? `${s.distanceMiles.toFixed(1)} mi away` : 'in area';
      const areas = (s.affected_areas || []).slice(0, 3).join(', ') || '';
      const sevColor = s.severity === 'extreme' ? '#dc2626' : s.severity === 'severe' ? '#ea580c' : s.severity === 'moderate' ? '#d97706' : '#65a30d';
      return `<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 8px;font-weight:600;">${emoji} ${label}</td><td style="padding:10px 8px;font-weight:600;text-transform:capitalize;color:${sevColor};">${s.severity || ''}</td><td style="padding:10px 8px;color:#6b7280;font-size:13px;">${distStr}</td><td style="padding:10px 8px;color:#6b7280;font-size:12px;">${areas}</td></tr>`;
    }).join('');
    return `<div style="margin-bottom:24px;"><h3 style="margin:0 0 12px;color:#1e40af;font-size:16px;border-bottom:2px solid #bfdbfe;padding-bottom:6px;">📍 Near ${office}</h3><table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr style="background:#f8fafc;"><th style="padding:8px;text-align:left;color:#374151;">Event</th><th style="padding:8px;text-align:left;color:#374151;">Severity</th><th style="padding:8px;text-align:left;color:#374151;">Distance</th><th style="padding:8px;text-align:left;color:#374151;">Areas</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:0;"><div style="background:linear-gradient(135deg,#ea580c,#dc2626);padding:24px;text-align:center;"><h1 style="margin:0;color:white;font-size:22px;font-weight:700;">⚡ Storm Alert</h1><p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">${now} ET</p></div><div style="background:white;padding:24px;"><p style="margin:0 0 20px;color:#374151;font-size:15px;"><strong>${storms.length} new storm event${storms.length > 1 ? 's' : ''}</strong> detected in your service area.</p>${officeBlocks}<div style="margin-top:24px;text-align:center;"><a href="https://getcompanysync.com/StormTracking" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Storm Tracker →</a></div></div><div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px;">CompanySync Storm Tracker — manage alerts in Storm Alert Settings.</div></div>`;
}

function buildBatchedStormSmsText(storms) {
  const typeLabel = { hail: 'Hail', tornado: 'Tornado', high_wind: 'High Wind', thunderstorm: 'Thunderstorm', flood: 'Flooding' };
  const lines = ['⚡ Storm Alert - CompanySync'];
  for (const s of storms.slice(0, 5)) {
    const label = typeLabel[s.event_type] || s.event_type || 'Weather Event';
    const dist = s.distanceMiles ? `${s.distanceMiles.toFixed(0)}mi` : 'in area';
    const office = s.matchedOfficeName || 'service area';
    lines.push(`• ${label} (${s.severity}) — ${dist} from ${office}`);
  }
  if (storms.length > 5) lines.push(`+ ${storms.length - 5} more events`);
  const appUrl = (process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com').replace(/\/$/, '');
  lines.push(`Generate leads from affected areas:\n${appUrl}/StormTracking`);
  return lines.join('\n');
}

// ── SMS delivery helpers ─────────────────────────────────────────────────────
// A 10DLC-registered number that has been added to a Messaging Service must be
// sent through that service (MessagingServiceSid), NOT as a bare From number —
// Twilio rejects the bare form with 30024 ("numeric sender ID not provisioned").
// A number with no campaign at all is rejected with 30034 (A2P not registered).
// Both errors look identical to the operator: alerts simply never arrive.
// So: prefer a stored messaging_service_sid, and on either error, discover the
// service that owns the number, retry through it, and remember it.
const TWILIO_SENDER_ERRORS = new Set([30024, 30034]);

// How many consecutive failed delivery runs before a storm is written off.
// Storms age out of the 24h look-back anyway; this just stops a permanently
// broken sender from re-sending on every 30-minute tick forever.
const STORM_ALERT_MAX_ATTEMPTS = 3;
// A cron tick can be triggered by the interval and a manual/internal invoke at
// nearly the same time. The old runs both read the pre-send notified list and
// then delivered the same batch before either could write its IDs.
let stormAlertCheckInFlight = false;

async function postTwilioSms({ sid, token, from, messagingServiceSid, to, body }) {
  const authStr = Buffer.from(`${sid}:${token}`).toString('base64');
  const params = { To: to, Body: body };
  if (messagingServiceSid) params.MessagingServiceSid = messagingServiceSid;
  else params.From = from;
  const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  let data = {};
  try { data = await resp.json(); } catch (_e) { /* non-JSON error body */ }
  return {
    ok: resp.ok,
    status: resp.status,
    code: data.code || data.error_code || null,
    message: data.message || null,
  };
}

// Find the Messaging Service that contains `phoneNumber`, so a bare-From send
// that Twilio rejected can be retried through the registered campaign.
async function findMessagingServiceForNumber({ sid, token, phoneNumber }) {
  const authStr = Buffer.from(`${sid}:${token}`).toString('base64');
  const headers = { 'Authorization': `Basic ${authStr}` };
  const MAX_PAGES = 5; // bound the scan so a large account can't stall the cron
  let svcUrl = 'https://messaging.twilio.com/v1/Services?PageSize=100';
  for (let page = 0; page < MAX_PAGES && svcUrl; page++) {
    const svcResp = await fetch(svcUrl, { headers });
    if (!svcResp.ok) return null;
    const svcData = await svcResp.json();
    for (const svc of (svcData.services || [])) {
      let numUrl = `https://messaging.twilio.com/v1/Services/${svc.sid}/PhoneNumbers?PageSize=100`;
      for (let np = 0; np < MAX_PAGES && numUrl; np++) {
        const numResp = await fetch(numUrl, { headers });
        if (!numResp.ok) break;
        const numData = await numResp.json();
        if ((numData.phone_numbers || []).some(p => p.phone_number === phoneNumber)) return svc.sid;
        const next = numData.meta && numData.meta.next_page_url;
        numUrl = next || null;
      }
    }
    const nextSvc = svcData.meta && svcData.meta.next_page_url;
    svcUrl = nextSvc || null;
  }
  return null;
}

/**
 * Check all StormAlertSettings and send batched email + SMS for new storms.
 * @param {import('pg').Pool} pool
 * @param {{ sendEmailFn?: Function }} opts - sendEmailFn({ to, subject, html, companyId })
 */
async function checkAndSendStormAlerts(pool, opts = {}) {
  if (stormAlertCheckInFlight) {
    console.warn('[StormAlerts] Skipping overlapping alert check — another run is still delivering');
    return { success: true, skipped: true, reason: 'already_running', totalCompanies: 0, totalStorms: 0, emailsSent: 0, smsSent: 0 };
  }
  stormAlertCheckInFlight = true;
  const { sendEmailFn } = opts;
  const SEVERITY_RANK = { all: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };

  // Default states to monitor when no settings configured yet
  const DEFAULT_STATES = ['OH', 'TX', 'FL', 'IL', 'MI', 'PA', 'IN', 'GA', 'NC', 'TN', 'VA', 'KY'];

  try {
    // Step 1: Load all company StormAlertSettings first (needed to derive target states)
    const settingsResult = await pool.query(
      `SELECT id, company_id, data FROM generic_entities WHERE entity_type = 'StormAlertSettings'`
    );
    if (settingsResult.rows.length === 0) {
      return { success: true, totalCompanies: 0, totalStorms: 0, emailsSent: 0, smsSent: 0 };
    }

    // Step 2: Derive target states from all office locations
    const stateSet = new Set();
    for (const row of settingsResult.rows) {
      const s = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
      const offices = (s.office_locations && s.office_locations.length > 0)
        ? s.office_locations
        : [{ location: s.service_center_location || '' }];
      for (const office of offices) {
        const locRaw = (office.location || '').toLowerCase().trim();
        const city = locRaw.split(',')[0].trim();
        const stateStr = locRaw.split(',')[1] ? locRaw.split(',')[1].trim() : '';
        const abbr = CITY_TO_STATE[city] || STATE_NAME_TO_ABBR[stateStr] || (ALL_STATE_ABBRS.includes(stateStr.toUpperCase()) ? stateStr.toUpperCase() : null);
        if (abbr) stateSet.add(abbr);
        // Also add neighbor states for broader coverage
        const neighbors = NEIGHBOR_STATES[abbr] || [];
        for (const n of neighbors) stateSet.add(n);
      }
    }
    let statesToFetch = stateSet.size > 0 ? [...stateSet] : DEFAULT_STATES;

    // If any company wants nationwide hail/wind alerts, ingest all 50 states so
    // those events are in the DB when the nationwide digest loop runs below.
    const anyNationwideEnabled = settingsResult.rows.some(r => {
      const s = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
      return s.nationwide_hail_wind_alerts === true;
    });
    if (anyNationwideEnabled) {
      const allStatesSet = new Set([...statesToFetch, ...ALL_STATE_ABBRS]);
      statesToFetch = [...allStatesSet];
      console.log(`[StormAlerts] Nationwide alerts enabled — expanding to ${statesToFetch.length} states`);
    }

    // Step 3: Refresh NWS active alerts for relevant states
    try {
      await fetchNWSActiveAlerts(pool, statesToFetch);
      console.log(`[StormAlerts] NWS refreshed for states: ${statesToFetch.join(',')}`);
    } catch (e) {
      console.warn('[StormAlerts] NWS refresh failed (non-fatal):', e.message);
    }

    // Step 3b: Ingest the last 24h of real storm reports (IEM LSR: hail, wind,
    // tornado) for the monitored states. Without this, hail reports only enter
    // the system when a user manually clicks Refresh on the Storm Tracker page —
    // meaning the alert cron below had nothing to alert on for actual hail storms.
    try {
      const ingestResult = await fetchStormDataV2(pool, { daysBack: 1, states: statesToFetch });
      if (ingestResult?.newEvents > 0) {
        console.log(`[StormAlerts] Ingested ${ingestResult.newEvents} new storm report(s) from IEM`);
      }
    } catch (e) {
      console.warn('[StormAlerts] IEM ingest failed (non-fatal):', e.message);
    }

    // Step 4: Load active/recent storm events.
    // NWS_ACTIVE alerts qualify via a 6-hour created_date window (they're
    // real-time push events and expire quickly). IEM storm reports qualify via
    // start_time only — the created_date filter was removed because it caused a
    // silent miss when the cron ingested a storm at 3 am and then checked for
    // alerts at 10 am (7 hours later, past the 6-hour window). The notifiedIds
    // set in each company's settings handles dedup, so there's no risk of
    // re-alerting. The 24-hour start_time window catches alerts missed during
    // downtime without notifying on historical reports inserted by a backfill.
    const cutoffTime = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const stormsResult = await pool.query(
      `SELECT id, data FROM generic_entities
       WHERE entity_type = 'StormEvent'
       AND (
         data->>'status' = 'active'
         OR (data->>'alert_type' = 'NWS_ACTIVE' AND created_date >= $1)
         OR (
           data->>'source' IN ('IEM V2', 'IEM')
           AND data->>'start_time' ~ '^\\d{4}-'
           AND (data->>'start_time')::timestamp >= NOW() - INTERVAL '24 hours'
         )
       )
       ORDER BY (data->>'status' = 'active') DESC, created_date DESC
       LIMIT 1000`,
      [cutoffTime.toISOString()]
    );
    const activeStorms = stormsResult.rows.map(r => {
      const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
      return { id: r.id, ...d };
    });

    if (activeStorms.length === 0) {
      console.log('[StormAlerts] No active/recent storms to check');
      return { success: true, totalCompanies: 0, totalStorms: 0, emailsSent: 0, smsSent: 0 };
    }

    console.log(`[StormAlerts] ${activeStorms.length} candidate storms, ${settingsResult.rows.length} companies`);

    // Keys still eligible for a retry this tick — used to prune stale
    // delivery-attempt counters for storms that have aged out.
    const candidateStormKeys = new Set(activeStorms.map(s => s.event_id || s.id).filter(Boolean));

    let totalCompanies = 0, totalStorms = 0, emailsSent = 0, smsSent = 0;

    for (const row of settingsResult.rows) {
      try {
        const settings = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
        const companyId = row.company_id || settings.company_id;
        if (!companyId) continue;
        if (opts.shouldSuppressCompany && await opts.shouldSuppressCompany(companyId)) {
          console.log(`[StormAlerts] Company ${companyId}: quiet hours active — deferring staff alerts`);
          continue;
        }

        const enableEmailAlerts = settings.enable_email_alerts !== false;
        const enableSmsAlerts = settings.enable_sms_alerts !== false;
        if (!enableEmailAlerts && !enableSmsAlerts) continue;

        let recipients = settings.alert_recipients || [];
        // Fallback: if alerts are enabled but no recipients were configured,
        // notify the company's active admins so storm alerts are never silently
        // dropped just because the recipient list is empty.
        if (recipients.length === 0) {
          try {
            const adminRes = await pool.query(
              `SELECT name, full_name, email, user_email, phone, cell_phone FROM staff_profiles
               WHERE company_id = $1 AND (is_active IS NULL OR is_active = true)
                 AND (is_administrator = true OR is_super_admin = true)`,
              [companyId]
            );
            const excludedEmails = new Set((settings.excluded_staff_emails || []).map(e => e.toLowerCase().trim()));
            const seenEmails = new Set();
            const seenPhones = new Set();
            recipients = adminRes.rows
              .map(r => ({
                name: r.full_name || r.name || r.email || r.user_email || 'Admin',
                email: r.email || r.user_email || '',
                phone: r.cell_phone || r.phone || '',
                notify_email: true,
                notify_sms: !!(r.cell_phone || r.phone),
              }))
              .filter(r => r.email || r.phone)
              .filter(r => {
                // Respect staff exclusion list — these people should never get alerts via fallback
                const e = (r.email || '').trim().toLowerCase();
                if (e && excludedEmails.has(e)) return false;
                // Dedup admins who share an email or phone to avoid double-sends
                const p = (r.phone || '').replace(/[^\d]/g, '');
                if (e && seenEmails.has(e)) return false;
                if (p && seenPhones.has(p)) return false;
                if (e) seenEmails.add(e);
                if (p) seenPhones.add(p);
                return true;
              });
            if (recipients.length > 0) {
              console.log(`[StormAlerts] Company ${companyId}: no recipients configured, falling back to ${recipients.length} active admin(s)`);
            }
          } catch (e) {
            console.warn(`[StormAlerts] Admin fallback query failed for ${companyId}:`, e.message);
          }
        }
        if (recipients.length === 0) continue;

        // Severity threshold — prefer min_severity, fallback to legacy alert_severity_threshold.
        // Default is 'moderate' (NOT 'severe') because the vast majority of roofing-relevant
        // events (high wind, thunderstorm, flood warnings, etc.) are stored with severity
        // 'moderate'. A default of 'severe' would silently drop all of those.
        const severityThreshold = settings.min_severity || settings.alert_severity_threshold || 'moderate';
        const minRank = severityThreshold === 'all' ? 0 : (SEVERITY_RANK[severityThreshold] || 3);

        // Storm types to monitor
        const monitoredTypes = settings.storm_types_to_monitor || ['hail', 'tornado', 'high_wind', 'thunderstorm'];

        // Persistent dedup — notified_storm_ids stored in the settings entity
        const notifiedIds = new Set(settings.notified_storm_ids || []);

        // Office list
        const offices = (settings.office_locations && settings.office_locations.length > 0)
          ? settings.office_locations
          : [{ name: 'Service Center', location: settings.service_center_location || '', radius_miles: settings.service_radius_miles || 50, service_areas: settings.service_areas || [] }];

        const officesWithCoords = await Promise.all(offices.map(async (office) => {
          const locRaw = (office.location || '').toLowerCase().trim();
          const locCity = locRaw.split(',')[0].trim();
          // 1) Prefer geocoded lat/lng saved at settings-save time
          const storedCoords = (office.lat && office.lng) ? { lat: parseFloat(office.lat), lng: parseFloat(office.lng) } : null;
          // 2) Fall back to hardcoded city table
          const knownCoords = KNOWN_CITY_COORDS[locCity] || null;
          // 3) Live geocoding via Nominatim (cached per process)
          let coords = storedCoords || knownCoords;
          if (!coords && office.location) {
            coords = await geocodeLocationRuntime(office.location);
          }
          // 4) Company address fallback — when the office location field is blank (common
          //    on freshly-onboarded accounts), use the company's registered address so
          //    geo-matching is never silently skipped just because setup is incomplete.
          if (!coords && !office.location && companyId) {
            try {
              const coRes = await pool.query('SELECT address FROM companies WHERE id = $1', [companyId]);
              const addr = (coRes.rows[0]?.address || '').trim();
              if (addr) {
                coords = await geocodeLocationRuntime(addr);
                if (coords) {
                  console.log(`[StormAlerts] ${companyId}: office location blank — using company address "${addr}" as geo fallback → ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
                }
              }
            } catch (_e) { /* non-fatal */ }
          }
          return { ...office, coords: coords || null, locRaw, locParts: locRaw.split(',').map(p => p.trim()) };
        }));

        // Find all new matching storms for this company (batched)
        const matchedStorms = [];

        for (const storm of activeStorms) {
          const stormKey = storm.event_id || storm.id;
          if (!stormKey) continue;
          if (notifiedIds.has(stormKey)) continue;

          const stormRank = SEVERITY_RANK[storm.severity] || 2;
          if (stormRank < minRank) continue;
          if (!monitoredTypes.includes(storm.event_type)) continue;

          const { matchesArea, distanceMiles, matchedOfficeName, coordsTrusted, zoneStates } =
            matchStormToOffices(storm, officesWithCoords);

          if (storm.latitude && storm.longitude && !coordsTrusted) {
            console.warn(`[StormAlerts] Ignoring coordinates for ${stormKey}: ${storm.latitude},${storm.longitude} is outside zone state(s) ${zoneStates.join('/') || '?'} — falling back to text matching`);
          }

          if (matchesArea) {
            matchedStorms.push({ ...storm, distanceMiles, matchedOfficeName, stormKey });
          }
        }

        if (matchedStorms.length === 0) continue;

        totalCompanies++;
        totalStorms += matchedStorms.length;
        console.log(`[StormAlerts] Company ${companyId}: ${matchedStorms.length} new storm(s) to notify`);

        // Resolve Twilio credentials (company-specific → global env fallback)
        let twilioSid = process.env.TWILIO_ACCOUNT_SID;
        let twilioToken = process.env.TWILIO_AUTH_TOKEN;
        let twilioFrom = process.env.TWILIO_PHONE_NUMBER;
        let twilioMsid = null;
        let twilioSettingsId = null;
        try {
          const tsRes = await pool.query(
            `SELECT id, data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
            [companyId]
          );
          if (tsRes.rows.length > 0) {
            const ts = typeof tsRes.rows[0].data === 'string' ? JSON.parse(tsRes.rows[0].data) : (tsRes.rows[0].data || {});
            twilioSettingsId = tsRes.rows[0].id;
            if (ts.account_sid) twilioSid = ts.account_sid;
            if (ts.auth_token) twilioToken = ts.auth_token;
            if (ts.main_phone_number || ts.phone_number) twilioFrom = ts.main_phone_number || ts.phone_number;
            if (ts.messaging_service_sid) twilioMsid = ts.messaging_service_sid;
          }
        } catch (e) {}

        // Build ONE batched email + SMS for this company
        const emailHtml = buildBatchedStormEmailHtml(matchedStorms);
        const emailSubject = matchedStorms.length === 1
          ? `⚡ Storm Alert: ${matchedStorms[0].nws_event || matchedStorms[0].event_type || 'Severe Weather'} near ${matchedStorms[0].matchedOfficeName || 'your area'}`
          : `⚡ ${matchedStorms.length} Storm Alerts in Your Service Area`;
        const smsBody = buildBatchedStormSmsText(matchedStorms);

        // Track real delivery so a run where every channel failed is never
        // recorded as "notified" (that permanently suppresses the storm).
        let delivered = 0;
        let attempted = 0;
        const deliveryFailures = [];

        // Dedup recipients — the same person entered twice (or an admin also
        // listed as staff) otherwise gets two identical alerts.
        const sentToEmails = new Set();
        const sentToPhones = new Set();

        // Send to each recipient
        for (const recipient of recipients) {
          const emailKey = (recipient.email || '').trim().toLowerCase();
          if (enableEmailAlerts && emailKey && recipient.notify_email !== false && !sentToEmails.has(emailKey)) {
            sentToEmails.add(emailKey);
            if (sendEmailFn) {
              attempted++;
              try {
                await sendEmailFn({ to: recipient.email, subject: emailSubject, html: emailHtml, companyId });
                emailsSent++;
                delivered++;
                console.log(`[StormAlerts] Email → ${recipient.email}`);
              } catch (e) {
                deliveryFailures.push(`email ${recipient.email}: ${e.message}`);
                console.warn(`[StormAlerts] Email failed for ${recipient.email}:`, e.message);
              }
            }
          }

          const phoneKey = (recipient.phone || '').replace(/[^\d]/g, '');
          if (enableSmsAlerts && recipient.phone && recipient.notify_sms === true && !sentToPhones.has(phoneKey)) {
            sentToPhones.add(phoneKey);
            if (!twilioSid || !twilioToken || (!twilioFrom && !twilioMsid)) {
              // Previously a silent skip — the operator saw no send and no error.
              console.warn(`[StormAlerts] ${companyId}: SMS enabled but Twilio sender is not configured — skipping ${recipient.phone}`);
              deliveryFailures.push('sms: no Twilio sender configured');
            } else {
              attempted++;
              try {
                const rawPhone = recipient.phone.replace(/[^\d+]/g, '');
                const cleanPhone = rawPhone.startsWith('+') ? rawPhone : (rawPhone.length === 10 ? `+1${rawPhone}` : `+${rawPhone}`);
                let result = await postTwilioSms({ sid: twilioSid, token: twilioToken, from: twilioFrom, messagingServiceSid: twilioMsid, to: cleanPhone, body: smsBody });

                // Sender-registration rejection — retry through the Messaging
                // Service that owns this number, then remember it for next time.
                if (!result.ok && !twilioMsid && TWILIO_SENDER_ERRORS.has(result.code) && twilioFrom) {
                  const discovered = await findMessagingServiceForNumber({ sid: twilioSid, token: twilioToken, phoneNumber: twilioFrom });
                  if (discovered) {
                    twilioMsid = discovered;
                    console.log(`[StormAlerts] ${companyId}: Twilio ${result.code} on bare sender — retrying via Messaging Service ${discovered}`);
                    result = await postTwilioSms({ sid: twilioSid, token: twilioToken, messagingServiceSid: discovered, to: cleanPhone, body: smsBody });
                    if (result.ok && twilioSettingsId) {
                      try {
                        await pool.query(
                          `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{messaging_service_sid}', $1::jsonb), updated_date = NOW() WHERE id = $2`,
                          [JSON.stringify(discovered), twilioSettingsId]
                        );
                      } catch (_e) { /* non-fatal — retry path still worked */ }
                    }
                  }
                }

                if (result.ok) {
                  smsSent++;
                  delivered++;
                  console.log(`[StormAlerts] SMS → ${recipient.phone}`);
                } else {
                  const detail = `sms ${recipient.phone}: Twilio ${result.code || result.status}${result.message ? ` — ${result.message}` : ''}`;
                  deliveryFailures.push(detail);
                  console.warn(`[StormAlerts] SMS error for ${recipient.phone}: ${result.code || result.status} ${(result.message || '').substring(0, 160)}`);
                }
              } catch (e) {
                deliveryFailures.push(`sms ${recipient.phone}: ${e.message}`);
                console.warn(`[StormAlerts] SMS failed for ${recipient.phone}:`, e.message);
              }
            }
          }
        }

        // Persist notified storm IDs — ONLY for storms that actually reached a
        // human. Marking on a failed run permanently suppresses the storm: the
        // next tick sees it as already-notified and nobody is ever told.
        const matchedKeys = matchedStorms.map(s => s.stormKey);
        const existingAttempts = settings.alert_delivery_attempts || {};
        const attemptIncrements = {};   // storm key → new failed-attempt count
        let keysToMark = [];            // storms that are done (delivered or written off)
        const keysToClear = [];         // attempt counters safe to drop

        if (delivered > 0) {
          keysToMark = matchedKeys;
          keysToClear.push(...matchedKeys);
        } else {
          // Nothing reached a human — whether the sends errored or no channel
          // was usable at all (a misconfigured sender must not silently bury the
          // storm either). Leave them un-notified so the next tick retries.
          const reason = attempted === 0
            ? `no usable channel — ${deliveryFailures[0] || 'recipients have no email/phone'}`
            : `all sends failed — ${deliveryFailures.slice(0, 3).join('; ')}`;
          const exhausted = [];
          for (const key of matchedKeys) {
            const n = (existingAttempts[key] || 0) + 1;
            attemptIncrements[key] = n;
            if (n >= STORM_ALERT_MAX_ATTEMPTS) exhausted.push(key);
          }
          console.warn(`[StormAlerts] ${companyId}: ${reason} — will retry ${matchedStorms.length} storm(s)`);

          if (exhausted.length > 0) {
            // Write off ONLY the storms that hit the cap (a storm first seen on
            // this run must keep its remaining retries), and tell the company
            // in-app why — otherwise the failure is invisible outside the log.
            keysToMark = exhausted;
            keysToClear.push(...exhausted);
            for (const key of exhausted) delete attemptIncrements[key];
            const failNotifId = generateEntityId('storm');
            await pool.query(
              `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW())`,
              [failNotifId, companyId, JSON.stringify({
                type: 'storm_alert_delivery_failed',
                title: '⚠️ Storm alerts could not be delivered',
                message: `${exhausted.length} storm alert${exhausted.length > 1 ? 's' : ''} could not be emailed or texted after ${STORM_ALERT_MAX_ATTEMPTS} attempts. ${deliveryFailures[0] || ''}`.trim(),
                is_read: false, link_url: '/StormTracking', created_at: new Date().toISOString(),
              })]
            );
            console.error(`[StormAlerts] ${companyId}: giving up on ${exhausted.length} storm(s) after ${STORM_ALERT_MAX_ATTEMPTS} failed attempts`);
          }
        }

        // Prune counters for storms that have aged out of the candidate pool —
        // they can never be retried, so their counters would linger forever.
        for (const key of Object.keys(existingAttempts)) {
          if (!candidateStormKeys.has(key)) keysToClear.push(key);
        }

        // Merge against the row's CURRENT value inside one statement rather than
        // overwriting with the copy read at the top of this run, so an
        // overlapping tick cannot clobber the other's notified IDs.
        await pool.query(
          `WITH cur AS (
             SELECT COALESCE(data::jsonb -> 'notified_storm_ids', '[]'::jsonb) AS ids,
                    COALESCE(data::jsonb -> 'alert_delivery_attempts', '{}'::jsonb) AS att
             FROM generic_entities WHERE id = $4
           )
           UPDATE generic_entities g
           SET data = jsonb_set(
                 jsonb_set(g.data::jsonb, '{notified_storm_ids}',
                   CASE WHEN jsonb_array_length(cur.ids || $1::jsonb) > 500
                        THEN (SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
                              FROM jsonb_array_elements(cur.ids || $1::jsonb) WITH ORDINALITY t(e, ord)
                              WHERE ord > jsonb_array_length(cur.ids || $1::jsonb) - 500)
                        ELSE cur.ids || $1::jsonb END),
                 '{alert_delivery_attempts}', (cur.att - $2::text[]) || $3::jsonb),
               updated_date = NOW()
           FROM cur WHERE g.id = $4`,
          [JSON.stringify(keysToMark), [...new Set(keysToClear)], JSON.stringify(attemptIncrements), row.id]
        );

        // The delivery dedup record is deliberately committed before this
        // optional bell notification. If the notification insert has a
        // transient problem, it must not cause an already-delivered email/SMS
        // batch to be sent again on the next 30-minute check.
        try {
          const notifId = generateEntityId('storm');
          const notifTitle = matchedStorms.length === 1 ? '⚡ Storm Alert' : `⚡ ${matchedStorms.length} Storm Alerts`;
          const notifMsg = matchedStorms.length === 1
            ? `${matchedStorms[0].nws_event || matchedStorms[0].event_type || 'Severe weather'} near ${matchedStorms[0].matchedOfficeName || 'your area'}`
            : `${matchedStorms.length} new storm events in your service area`;
          await pool.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW())`,
            [notifId, companyId, JSON.stringify({
              type: 'storm_alert', title: notifTitle, message: notifMsg,
              is_read: false, link_url: '/StormTracking', created_at: new Date().toISOString(),
            })]
          );
        } catch (notificationErr) {
          console.warn(`[StormAlerts] ${companyId}: delivered storm alert, but could not create in-app notification:`, notificationErr.message);
        }

      } catch (companyErr) {
        console.error(`[StormAlerts] Error for company ${row.company_id}:`, companyErr.message);
      }
    }

    // ── Nationwide hail & wind digest ────────────────────────────────────────
    // Runs as a SEPARATE email pass for companies with nationwide_hail_wind_alerts.
    // Uses its OWN query (not the shared 1000-row service-area pool) so that
    // pool-window shifts between cron ticks never cause dedup misses: a storm
    // ranked just outside the top-1000 in one tick could enter the next tick's
    // pool and appear "new" even though we already covered the period.
    if (anyNationwideEnabled) {
      const NATIONWIDE_TYPES = new Set(['hail', 'high_wind', 'tornado', 'thunderstorm']);
      const nationwidePoolResult = await pool.query(
        `SELECT id, data FROM generic_entities
         WHERE entity_type = 'StormEvent'
           AND data->>'event_type' IN ('hail', 'high_wind', 'tornado', 'thunderstorm')
           AND (
             data->>'status' = 'active'
             OR (data->>'alert_type' = 'NWS_ACTIVE' AND created_date >= $1)
             OR (
               data->>'source' IN ('IEM V2', 'IEM')
               AND data->>'start_time' ~ '^\\d{4}-'
               AND (data->>'start_time')::timestamp >= NOW() - INTERVAL '24 hours'
             )
           )
         ORDER BY created_date DESC
         LIMIT 5000`,
        [cutoffTime.toISOString()]
      );
      const nationwidePool = nationwidePoolResult.rows.map(r => {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
        return { id: r.id, ...d };
      });

      for (const row of settingsResult.rows) {
        try {
          const settings = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
          if (!settings.nationwide_hail_wind_alerts) continue;

          const companyId = row.company_id || settings.company_id;
          if (!companyId) continue;
          if (opts.shouldSuppressCompany && await opts.shouldSuppressCompany(companyId)) continue;
          if (settings.enable_email_alerts === false) continue;

          // Resolve recipients (same fallback logic as service-area alerts)
          let recipients = settings.alert_recipients || [];
          if (recipients.length === 0) {
            try {
              const adminRes = await pool.query(
                `SELECT name, full_name, email, user_email, phone, cell_phone FROM staff_profiles
                 WHERE company_id = $1 AND (is_active IS NULL OR is_active = true)
                   AND (is_administrator = true OR is_super_admin = true)`,
                [companyId]
              );
              const seenEmails = new Set();
              recipients = adminRes.rows
                .map(r => ({ name: r.full_name || r.name || 'Admin', email: r.email || r.user_email || '', notify_email: true }))
                .filter(r => r.email)
                .filter(r => { const e = r.email.toLowerCase(); if (seenEmails.has(e)) return false; seenEmails.add(e); return true; });
            } catch (e) {}
          }
          if (recipients.length === 0) continue;

          // Separate dedup — notified_nationwide_ids is independent of service-area notified_storm_ids
          const notifiedNationwideIds = new Set(settings.notified_nationwide_ids || []);
          const newNationwideStorms = nationwidePool.filter(s => {
            const key = s.event_id || s.id;
            return key && !notifiedNationwideIds.has(key);
          });
          if (newNationwideStorms.length === 0) continue;

          // Apply minimum threshold filters — storms below the floor are marked seen
          // (so they don't re-fire each cron tick) but excluded from the email digest.
          const minHailIn = parseFloat(settings.nationwide_min_hail_inches) || 0;
          const minWindMph = parseFloat(settings.nationwide_min_wind_mph) || 0;
          // Minimum severity applies to the nationwide digest as well. Subscribers see a
          // single "minimum severity" preference in Storm Alert Settings, so a company that
          // asked for severe-and-above must not receive minor events merely because they
          // arrived through the nationwide pass instead of the service-area pass. Resolved
          // exactly like the service-area threshold above (min_severity → legacy
          // alert_severity_threshold → 'moderate').
          const nationwideThreshold = settings.min_severity || settings.alert_severity_threshold || 'moderate';
          const nationwideMinRank = nationwideThreshold === 'all' ? 0 : (SEVERITY_RANK[nationwideThreshold] || 3);
          const thresholdPassingStorms = newNationwideStorms.filter(s => {
            if ((SEVERITY_RANK[s.severity] || 2) < nationwideMinRank) return false;
            if (s.event_type === 'hail' && minHailIn > 0) {
              const size = parseFloat(s.hail_size_inches || s.magnitude || 0);
              if (size < minHailIn) return false;
            }
            if ((s.event_type === 'high_wind' || s.event_type === 'thunderstorm') && minWindMph > 0) {
              const speed = parseFloat(s.wind_speed_mph || s.magnitude || 0);
              if (speed < minWindMph) return false;
            }
            return true;
          });
          if (thresholdPassingStorms.length === 0) {
            // All new storms filtered out — still mark them seen so we don't re-process
            const allIds = [...notifiedNationwideIds, ...newNationwideStorms.map(s => s.event_id || s.id).filter(Boolean)];
            await pool.query(
              `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{notified_nationwide_ids}', $1::jsonb), updated_date = NOW() WHERE id = $2`,
              [JSON.stringify(allIds.slice(-6000)), row.id]
            );
            continue;
          }

          const emailHtml = buildNationwideStormEmailHtml(thresholdPassingStorms);
          const emailSubject = thresholdPassingStorms.length === 1
            ? `🌎 Nationwide Storm Report: ${thresholdPassingStorms[0].nws_event || thresholdPassingStorms[0].event_type || 'Hail/Wind'} — ${(thresholdPassingStorms[0].affected_areas || [])[0] || 'US'}`
            : `🌎 Nationwide Hail & Wind Report — ${thresholdPassingStorms.length} events across the US`;

          for (const recipient of recipients) {
            if (recipient.email && recipient.notify_email !== false) {
              try {
                if (sendEmailFn) {
                  await sendEmailFn({ to: recipient.email, subject: emailSubject, html: emailHtml, companyId });
                  emailsSent++;
                  console.log(`[StormAlerts] Nationwide email → ${recipient.email} (${newNationwideStorms.length} events)`);
                }
              } catch (e) {
                console.warn(`[StormAlerts] Nationwide email failed for ${recipient.email}:`, e.message);
              }
            }
          }

          // Persist nationwide dedup IDs (trimmed to last 6000 — must cover the full
          // 5000-row nationwide query window plus headroom, or IDs still returned by
          // the query get discarded and resend on the next cron tick)
          const allNationwideIds = [...notifiedNationwideIds, ...newNationwideStorms.map(s => s.event_id || s.id).filter(Boolean)];
          await pool.query(
            `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{notified_nationwide_ids}', $1::jsonb), updated_date = NOW() WHERE id = $2`,
            [JSON.stringify(allNationwideIds.slice(-6000)), row.id]
          );

        } catch (e) {
          console.error(`[StormAlerts] Nationwide error for company ${row.company_id}:`, e.message);
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    console.log(`[StormAlerts] Done — ${totalCompanies} companies, ${totalStorms} storms, ${emailsSent} emails, ${smsSent} SMS`);
    return { success: true, totalCompanies, totalStorms, emailsSent, smsSent };
  } catch (err) {
    console.error('[StormAlerts] checkAndSendStormAlerts error:', err.message);
    return { success: false, error: err.message };
  } finally {
    stormAlertCheckInFlight = false;
  }
}

async function updateStormSecondaryAreas(pool, { stormId, secondary_areas }) {
  if (!stormId) throw new Error('stormId required');
  if (!Array.isArray(secondary_areas)) throw new Error('secondary_areas must be an array');
  // Storm events are stored in generic_entities; secondary_areas lives in the data JSONB column
  const result = await pool.query(
    `UPDATE generic_entities
        SET data = data || jsonb_build_object('secondary_areas', $1::jsonb)
      WHERE id = $2
      RETURNING id`,
    [JSON.stringify(secondary_areas), stormId]
  );
  if (result.rowCount === 0) throw new Error('Storm not found');
  return { success: true };
}

module.exports = { fetchStormDataV2, getStormsInArea, fetchNWSActiveAlerts, fetchNWSHistoricalAlerts, checkAndSendStormAlerts, updateStormSecondaryAreas, matchStormToOffices };
