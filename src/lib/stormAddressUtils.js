export const STORM_RADIUS_METERS = Object.freeze({
  1: 1609,
  2: 3218,
  3: 4828,
  5: 8046,
  10: 16093,
});

export function stormAddressCacheKey(stormId, mode = 'radius', radiusMiles = 2) {
  return `${stormId}::${mode === 'city' ? 'city' : `radius-${radiusMiles}`}`;
}

// A City selection must use one municipality relation, never every enclosing
// administrative area (which would also include its county).
export function buildCityBoundaryQuery(cityName, lat, lng) {
  const name = JSON.stringify(String(cityName || '').trim());
  const point = `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  return `[out:json][timeout:25];rel(around:30000,${point})["boundary"="administrative"]["admin_level"~"^(7|8|9)$"]["name"=${name}]->.cityRelation;map_to_area.cityRelation->.cityArea;(nwr["addr:housenumber"]["addr:street"](area.cityArea);nwr["addr:housenumber"]["addr:place"](area.cityArea);nwr["addr:housenumber"]["addr:road"](area.cityArea);nwr["addr:full"](area.cityArea););out center 301;`;
}

export function addressIdentity(address = {}) {
  return [
    address.street,
    address.city,
    address.state,
    address.zip,
    address.lat,
    address.lon ?? address.lng,
  ].map(value => String(value ?? '').trim().toLowerCase()).join('|');
}

function fallbackRank(address) {
  const propertySize = Number(address.square_feet ?? address.sqft ?? address.lot_size ?? address.lotSize);
  if (Number.isFinite(propertySize) && propertySize > 0) return propertySize;
  return 0;
}

export function buildAddressTierAssignments(addresses = [], zipValues = {}) {
  const ranked = [...addresses].map((address, index) => {
    const value = Number(zipValues[address.zip]);
    return {
      address,
      index,
      value: Number.isFinite(value) && value > 0 ? value : null,
      fallback: fallbackRank(address),
      name: `${address.street || ''} ${address.city || ''}`.trim().toLowerCase(),
    };
  }).sort((a, b) =>
    (b.value ?? -1) - (a.value ?? -1) ||
    b.fallback - a.fallback ||
    a.name.localeCompare(b.name) ||
    a.index - b.index
  );

  const total = ranked.length;
  return ranked.reduce((assignments, item, index) => {
    const n = index < Math.ceil(total * 0.2) ? 1 : index < Math.ceil(total * 0.7) ? 2 : 3;
    assignments[addressIdentity(item.address)] = {
      n,
      label: `T${n}`,
      desc: n === 1 ? 'Top 20%' : n === 2 ? 'Middle 50%' : 'Remaining',
      value: item.value,
      source: item.value != null ? 'median value' : item.fallback > 0 ? 'property size' : 'address order',
    };
    return assignments;
  }, {});
}

let censusZipValuesPromise;

/**
 * Fetch the Census ACS median home value table once per browser session.
 * Census accepts a single ZIP geography or `*`, not a comma-separated list.
 */
export function fetchCensusZipMedianValues(fetchImpl = globalThis.fetch) {
  if (censusZipValuesPromise) return censusZipValuesPromise;
  if (typeof fetchImpl !== 'function') return Promise.reject(new Error('Fetch is unavailable'));

  censusZipValuesPromise = (async () => {
    const url = 'https://api.census.gov/data/2024/acs/acs5?get=B25077_001E&for=zip+code+tabulation+area:*';
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Census API ${response.status}`);

    const rows = await response.json();
    if (!Array.isArray(rows) || !Array.isArray(rows[0])) {
      throw new Error('Census API returned an invalid home-value table');
    }
    const valueIndex = rows[0].indexOf('B25077_001E');
    const zipIndex = rows[0].indexOf('zip code tabulation area');
    if (valueIndex < 0 || zipIndex < 0) {
      throw new Error('Census API response is missing the home-value or ZIP column');
    }

    const zipValues = {};
    for (const row of rows.slice(1)) {
      const zip = String(row[zipIndex] || '');
      const value = Number.parseInt(row[valueIndex], 10);
      if (/^\d{5}$/.test(zip) && Number.isFinite(value) && value > 0) {
        zipValues[zip] = value;
      }
    }
    return zipValues;
  })().catch(error => {
    // Do not cache failures; the user can retry after a transient API outage.
    censusZipValuesPromise = null;
    throw error;
  });

  return censusZipValuesPromise;
}