'use strict';

const crypto = require('crypto');

function generateEntityId(prefix = 'ge') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

const CITY_TO_STATE = {
  'cleveland': 'OH', 'columbus': 'OH', 'cincinnati': 'OH', 'akron': 'OH', 'toledo': 'OH', 'dayton': 'OH',
  'youngstown': 'OH', 'canton': 'OH', 'mansfield': 'OH', 'sandusky': 'OH', 'elyria': 'OH', 'lorain': 'OH',
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

const STATE_CENTROIDS = {
  OH: { lat: 40.4173, lng: -82.9071 }, PA: { lat: 40.9999, lng: -77.6109 },
  WV: { lat: 38.4680, lng: -80.9696 }, KY: { lat: 37.8393, lng: -84.2700 },
  IN: { lat: 40.2672, lng: -86.1349 }, MI: { lat: 44.3148, lng: -85.6024 },
  TX: { lat: 31.9686, lng: -99.9018 }, FL: { lat: 27.9944, lng: -81.7603 },
  GA: { lat: 32.1656, lng: -82.9001 }, NC: { lat: 35.6302, lng: -79.8060 },
  TN: { lat: 35.8580, lng: -86.3505 }, AL: { lat: 32.3182, lng: -86.9023 },
  VA: { lat: 37.7693, lng: -78.1700 }, IL: { lat: 40.3495, lng: -88.9861 },
  MO: { lat: 38.5767, lng: -92.1735 }, NY: { lat: 43.2994, lng: -74.2179 },
  MN: { lat: 46.3750, lng: -94.6859 }, WI: { lat: 44.2685, lng: -89.6165 },
  OK: { lat: 35.4676, lng: -97.5164 }, AR: { lat: 34.7465, lng: -92.2896 },
  LA: { lat: 30.9843, lng: -91.9623 }, MS: { lat: 32.7673, lng: -89.6812 },
  SC: { lat: 33.8361, lng: -81.1637 }, CO: { lat: 39.5501, lng: -105.7821 },
  AZ: { lat: 34.0489, lng: -111.0937 }, CA: { lat: 36.7783, lng: -119.4179 },
};

const COUNTY_CENTROIDS = {
  'cuyahoga': { lat: 41.4993, lng: -81.6944 }, 'summit': { lat: 41.1270, lng: -81.5157 },
  'lake': { lat: 41.7192, lng: -81.2402 }, 'lorain': { lat: 41.4528, lng: -82.1821 },
  'medina': { lat: 41.1387, lng: -81.8646 }, 'geauga': { lat: 41.4993, lng: -81.1784 },
  'portage': { lat: 41.1595, lng: -81.1948 }, 'stark': { lat: 40.8148, lng: -81.3784 },
  'wayne': { lat: 40.8209, lng: -81.9332 }, 'mahoning': { lat: 41.0998, lng: -80.7734 },
  'trumbull': { lat: 41.2995, lng: -80.7670 }, 'ashtabula': { lat: 41.8612, lng: -80.7900 },
  'erie': { lat: 41.4409, lng: -82.5835 }, 'huron': { lat: 41.1484, lng: -82.5535 },
  'ashland': { lat: 40.8581, lng: -82.3046 }, 'richland': { lat: 40.7670, lng: -82.5302 },
  'morrow': { lat: 40.5473, lng: -82.8168 }, 'knox': { lat: 40.3884, lng: -82.4899 },
  'holmes': { lat: 40.5673, lng: -81.9190 }, 'tuscarawas': { lat: 40.4376, lng: -81.4807 },
  'carroll': { lat: 40.5763, lng: -81.0890 }, 'columbiana': { lat: 40.7726, lng: -80.7804 },
  'allegheny': { lat: 40.4406, lng: -79.9959 }, 'butler': { lat: 40.9254, lng: -79.9287 },
  'beaver': { lat: 40.6887, lng: -80.3542 }, 'lawrence': { lat: 40.9982, lng: -80.5313 },
  'mercer': { lat: 41.2980, lng: -80.2398 }, 'venango': { lat: 41.3968, lng: -79.7617 },
  'crawford': { lat: 41.6884, lng: -80.1040 }, 'erie (pa)': { lat: 42.1167, lng: -80.0851 },
  'franklin': { lat: 39.9612, lng: -82.9988 }, 'hamilton': { lat: 39.1031, lng: -84.5120 },
  'montgomery': { lat: 39.7589, lng: -84.1916 }, 'lucas': { lat: 41.6528, lng: -83.5379 },
  'wood': { lat: 41.3684, lng: -83.6210 }, 'licking': { lat: 40.0782, lng: -82.4896 },
  'delaware': { lat: 40.2648, lng: -83.0024 }, 'fairfield': { lat: 39.7523, lng: -82.6296 },
  'hancock': { lat: 41.0034, lng: -83.6654 }, 'seneca': { lat: 41.1237, lng: -83.0657 },
};

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
      // Fallback: use county centroid lookup (same as historical alerts)
      if (!lat) {
        const areaDesc = props.areaDesc || '';
        const counties = areaDesc.split(';').map(s => s.trim().toLowerCase()).filter(Boolean);
        for (const county of counties.slice(0, 5)) {
          const clean = county.replace(/\s*\([^)]*\)/g, '').replace(/county$/i, '').trim();
          if (COUNTY_CENTROIDS[clean]) {
            lat = COUNTY_CENTROIDS[clean].lat;
            lng = COUNTY_CENTROIDS[clean].lng;
            break;
          }
        }
        // Final fallback: state centroid
        const alertState = props.geocode?.UGC?.[0]?.substring(0, 2) || states[0];
        if (!lat && STATE_CENTROIDS[alertState]) {
          lat = STATE_CENTROIDS[alertState].lat;
          lng = STATE_CENTROIDS[alertState].lng;
        }
      }

      const affectedAreas = props.areaDesc ? [props.areaDesc] : [];
      const state = props.geocode?.UGC?.[0]?.substring(0, 2) || states[0];

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
        has_geometry: lat !== null,
        radius_miles: hasGeometry ? 20 : 50,
        source: 'NWS_ACTIVE',
        status: 'active',
        nws_id: props.id,
        nws_event: props.event,
        nws_state: state,
        nws_sender: props.senderName,
        created_date: new Date().toISOString(),
      });
      idsToCheck.add(alertId);
    }

    if (batch.length > 0) {
      const values = [], placeholders = [];
      let idx = 1;
      for (const storm of batch) {
        const id = generateEntityId('storm');
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
          const alertState = ugcCodes.length > 0
            ? ugcCodes[0].substring(0, 2).toUpperCase()
            : (states[0] || 'OH');

          if (!hasGeometry) {
            const areaDesc = props.areaDesc || '';
            const counties = areaDesc.split(';').map(s => s.trim().toLowerCase()).filter(Boolean);
            for (const county of counties.slice(0, 3)) {
              const clean = county.replace(/\s*\([^)]*\)/g, '').replace(/county$/i, '').trim();
              if (COUNTY_CENTROIDS[clean]) {
                lat = COUNTY_CENTROIDS[clean].lat;
                lng = COUNTY_CENTROIDS[clean].lng;
                break;
              }
            }
            if (lat === null && STATE_CENTROIDS[alertState]) {
              lat = STATE_CENTROIDS[alertState].lat;
              lng = STATE_CENTROIDS[alertState].lng;
            }
          }

          const affectedAreas = props.areaDesc
            ? props.areaDesc.split(';').map(s => s.trim()).filter(Boolean)
            : [];

          allBatches.push({
            event_id: alertId,
            alert_type: 'NWS_HIST',
            source: 'NWS_HISTORICAL',
            event_type: mapped.event_type,
            severity: mapped.severity,
            title: `${props.event} — ${affectedAreas[0] || alertState}`,
            description: props.description || props.headline,
            headline: props.headline,
            affected_areas: affectedAreas,
            nws_state: alertState,
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

    return { success: true, imported: totalImported, pages };
  } catch (err) {
    console.error('[NWS-HIST] Error:', err.message);
    return { success: false, imported: 0, error: err.message };
  }
}

async function fetchStormDataV2(pool, params) {
  const { daysBack = 30, nationwide = false } = params || {};
  console.log(`[Storm] Fetching storm data V2 (${daysBack} days back, nationwide: ${nationwide})...`);

  try {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - daysBack);

    let targetStates = new Set();
    if (nationwide) {
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
  const { lat, lng, radiusMiles = 50, daysBack = 30, types, statusFilter, limit = 500, includeStates, stateFilter, officeLocations } = params || {};

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
        LIMIT ${parseInt(limit)}
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
        LIMIT ${parseInt(limit)}
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
        LIMIT ${parseInt(limit)}
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
  'bedford': { lat: 41.3923, lng: -81.5365 }, 'beachwood': { lat: 41.4651, lng: -81.5076 },
  'solon': { lat: 41.3895, lng: -81.4415 }, 'parma': { lat: 41.3845, lng: -81.7229 },
  'strongsville': { lat: 41.3142, lng: -81.8358 }, 'medina': { lat: 41.1384, lng: -81.8638 },
  'lorain': { lat: 41.4523, lng: -82.1824 }, 'mentor': { lat: 41.6661, lng: -81.3393 },
  'euclid': { lat: 41.5931, lng: -81.5268 }, 'lakewood': { lat: 41.4819, lng: -81.7982 },
  'elyria': { lat: 41.3684, lng: -82.1074 }, 'westlake': { lat: 41.4553, lng: -81.9179 },
};

function stormHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
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
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:0;"><div style="background:linear-gradient(135deg,#ea580c,#dc2626);padding:24px;text-align:center;"><h1 style="margin:0;color:white;font-size:22px;font-weight:700;">⚡ Storm Alert</h1><p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">${now} ET</p></div><div style="background:white;padding:24px;"><p style="margin:0 0 20px;color:#374151;font-size:15px;"><strong>${storms.length} new storm event${storms.length > 1 ? 's' : ''}</strong> detected in your service area.</p>${officeBlocks}<div style="margin-top:24px;text-align:center;"><a href="https://getcompanysync.com/StormTracker" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">View Storm Tracker →</a></div></div><div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px;">CompanySync Storm Tracker — manage alerts in Storm Alert Settings.</div></div>`;
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
  lines.push('Log in to generate leads from affected areas.');
  return lines.join('\n');
}

/**
 * Check all StormAlertSettings and send batched email + SMS for new storms.
 * @param {import('pg').Pool} pool
 * @param {{ sendEmailFn?: Function }} opts - sendEmailFn({ to, subject, html, companyId })
 */
async function checkAndSendStormAlerts(pool, opts = {}) {
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
    const statesToFetch = stateSet.size > 0 ? [...stateSet] : DEFAULT_STATES;

    // Step 3: Refresh NWS active alerts for relevant states
    try {
      await fetchNWSActiveAlerts(pool, statesToFetch);
      console.log(`[StormAlerts] NWS refreshed for states: ${statesToFetch.join(',')}`);
    } catch (e) {
      console.warn('[StormAlerts] NWS refresh failed (non-fatal):', e.message);
    }

    // Step 4: Load active/recent storm events.
    // Non-backfill guard: only NWS_ACTIVE alerts qualify for the 6-hour created_date window,
    // preventing historical/backfilled StormEvent rows from triggering notifications.
    const cutoffTime = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const stormsResult = await pool.query(
      `SELECT id, data FROM generic_entities
       WHERE entity_type = 'StormEvent'
       AND (
         data->>'status' = 'active'
         OR (data->>'alert_type' = 'NWS_ACTIVE' AND created_date >= $1)
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

    let totalCompanies = 0, totalStorms = 0, emailsSent = 0, smsSent = 0;

    for (const row of settingsResult.rows) {
      try {
        const settings = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
        const companyId = row.company_id || settings.company_id;
        if (!companyId) continue;

        const enableEmailAlerts = settings.enable_email_alerts !== false;
        const enableSmsAlerts = settings.enable_sms_alerts !== false;
        const recipients = settings.alert_recipients || [];
        if (recipients.length === 0) continue;
        if (!enableEmailAlerts && !enableSmsAlerts) continue;

        // Severity threshold — prefer min_severity, fallback to legacy alert_severity_threshold, default 'severe'
        const severityThreshold = settings.min_severity || settings.alert_severity_threshold || 'severe';
        const minRank = severityThreshold === 'all' ? 0 : (SEVERITY_RANK[severityThreshold] || 3);

        // Storm types to monitor
        const monitoredTypes = settings.storm_types_to_monitor || ['hail', 'tornado', 'high_wind', 'thunderstorm'];

        // Persistent dedup — notified_storm_ids stored in the settings entity
        const notifiedIds = new Set(settings.notified_storm_ids || []);

        // Office list
        const offices = (settings.office_locations && settings.office_locations.length > 0)
          ? settings.office_locations
          : [{ name: 'Service Center', location: settings.service_center_location || '', radius_miles: settings.service_radius_miles || 50, service_areas: settings.service_areas || [] }];

        const officesWithCoords = offices.map(office => {
          const locRaw = (office.location || '').toLowerCase().trim();
          const locCity = locRaw.split(',')[0].trim();
          return { ...office, coords: KNOWN_CITY_COORDS[locCity] || null, locRaw, locParts: locRaw.split(',').map(p => p.trim()) };
        });

        // Find all new matching storms for this company (batched)
        const matchedStorms = [];

        for (const storm of activeStorms) {
          const stormKey = storm.event_id || storm.id;
          if (!stormKey) continue;
          if (notifiedIds.has(stormKey)) continue;

          const stormRank = SEVERITY_RANK[storm.severity] || 2;
          if (stormRank < minRank) continue;
          if (!monitoredTypes.includes(storm.event_type)) continue;

          // Proximity check against each office
          let matchesArea = false, distanceMiles = null, matchedOfficeName = null;

          for (const office of officesWithCoords) {
            const radiusMiles = office.radius_miles || 50;
            let officeMatch = false, officeDist = null;

            if (office.coords && storm.latitude && storm.longitude) {
              officeDist = stormHaversineDistance(office.coords.lat, office.coords.lng, parseFloat(storm.latitude), parseFloat(storm.longitude));
              if (officeDist <= radiusMiles) officeMatch = true;
            }

            // Text fallback: check affected areas vs office location + service_areas
            if (!officeMatch) {
              const stormAreas = storm.affected_areas || [];
              for (const sa of stormAreas) {
                const saLower = sa.toLowerCase();
                if (office.locRaw && office.locParts.some(p => p.length > 1 && saLower.includes(p))) { officeMatch = true; break; }
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
        try {
          const tsRes = await pool.query(
            `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
            [companyId]
          );
          if (tsRes.rows.length > 0) {
            const ts = typeof tsRes.rows[0].data === 'string' ? JSON.parse(tsRes.rows[0].data) : (tsRes.rows[0].data || {});
            if (ts.account_sid) twilioSid = ts.account_sid;
            if (ts.auth_token) twilioToken = ts.auth_token;
            if (ts.main_phone_number || ts.phone_number) twilioFrom = ts.main_phone_number || ts.phone_number;
          }
        } catch (e) {}

        // Build ONE batched email + SMS for this company
        const emailHtml = buildBatchedStormEmailHtml(matchedStorms);
        const emailSubject = matchedStorms.length === 1
          ? `⚡ Storm Alert: ${matchedStorms[0].nws_event || matchedStorms[0].event_type || 'Severe Weather'} near ${matchedStorms[0].matchedOfficeName || 'your area'}`
          : `⚡ ${matchedStorms.length} Storm Alerts in Your Service Area`;
        const smsBody = buildBatchedStormSmsText(matchedStorms);

        // Send to each recipient
        for (const recipient of recipients) {
          if (enableEmailAlerts && recipient.email && recipient.notify_email !== false) {
            try {
              if (sendEmailFn) {
                await sendEmailFn({ to: recipient.email, subject: emailSubject, html: emailHtml, companyId });
                emailsSent++;
                console.log(`[StormAlerts] Email → ${recipient.email}`);
              }
            } catch (e) {
              console.warn(`[StormAlerts] Email failed for ${recipient.email}:`, e.message);
            }
          }

          if (enableSmsAlerts && recipient.phone && recipient.notify_sms === true && twilioSid && twilioToken && twilioFrom) {
            try {
              const rawPhone = recipient.phone.replace(/[^\d+]/g, '');
              const cleanPhone = rawPhone.startsWith('+') ? rawPhone : (rawPhone.length === 10 ? `+1${rawPhone}` : `+${rawPhone}`);
              const authStr = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
              const smsResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
                method: 'POST',
                headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ To: cleanPhone, From: twilioFrom, Body: smsBody }).toString()
              });
              if (smsResp.ok) { smsSent++; console.log(`[StormAlerts] SMS → ${recipient.phone}`); }
              else { const t = await smsResp.text(); console.warn(`[StormAlerts] SMS error (${smsResp.status}) for ${recipient.phone}:`, t.substring(0, 200)); }
            } catch (e) {
              console.warn(`[StormAlerts] SMS failed for ${recipient.phone}:`, e.message);
            }
          }
        }

        // In-app notification (company-wide, shows for all users in the company)
        const notifId = generateEntityId('storm');
        const notifTitle = matchedStorms.length === 1 ? '⚡ Storm Alert' : `⚡ ${matchedStorms.length} Storm Alerts`;
        const notifMsg = matchedStorms.length === 1
          ? `${matchedStorms[0].nws_event || matchedStorms[0].event_type || 'Severe weather'} near ${matchedStorms[0].matchedOfficeName || 'your area'}`
          : `${matchedStorms.length} new storm events in your service area`;
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW())`,
          [notifId, companyId, JSON.stringify({
            type: 'storm_alert', title: notifTitle, message: notifMsg,
            is_read: false, link_url: '/StormTracker', created_at: new Date().toISOString(),
          })]
        );

        // Persist notified storm IDs (trim to last 500 for bounded storage)
        const allNotifiedIds = [...notifiedIds, ...matchedStorms.map(s => s.stormKey)];
        const trimmedIds = allNotifiedIds.slice(-500);
        await pool.query(
          `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{notified_storm_ids}', $1::jsonb), updated_date = NOW() WHERE id = $2`,
          [JSON.stringify(trimmedIds), row.id]
        );

      } catch (companyErr) {
        console.error(`[StormAlerts] Error for company ${row.company_id}:`, companyErr.message);
      }
    }

    console.log(`[StormAlerts] Done — ${totalCompanies} companies, ${totalStorms} storms, ${emailsSent} emails, ${smsSent} SMS`);
    return { success: true, totalCompanies, totalStorms, emailsSent, smsSent };
  } catch (err) {
    console.error('[StormAlerts] checkAndSendStormAlerts error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { fetchStormDataV2, getStormsInArea, fetchNWSActiveAlerts, fetchNWSHistoricalAlerts, checkAndSendStormAlerts };
