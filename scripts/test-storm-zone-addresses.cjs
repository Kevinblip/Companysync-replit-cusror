#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('src/lib/stormAddressUtils.js', 'utf8')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ');
const helpers = vm.runInNewContext(`(() => { ${source}; return { STORM_RADIUS_METERS, stormAddressCacheKey, buildCityBoundaryQuery, addressIdentity, buildAddressTierAssignments }; })()`);

let passed = 0;
function ok(label, condition) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  PASS  ${label}`);
}

console.log('\nStorm-zone address regression checks\n');
ok('uses exact Overpass meters for every selectable radius',
  JSON.stringify(helpers.STORM_RADIUS_METERS) === JSON.stringify({ 1: 1609, 2: 3218, 3: 4828, 5: 8046, 10: 16093 }));
ok('keeps City and radius results in distinct cache entries',
  helpers.stormAddressCacheKey('storm-1', 'city') !== helpers.stormAddressCacheKey('storm-1', 'radius', 2));
const cityQuery = helpers.buildCityBoundaryQuery('Exampleville', 41.5, -81.7);
ok('City boundary lookup targets only the named municipality, never its county',
  cityQuery.includes('["name"="Exampleville"]') &&
  cityQuery.includes('admin_level"~"^(7|8|9)$"') &&
  !cityQuery.includes('admin_level~"^[6-9]$"') &&
  cityQuery.includes('map_to_area.cityRelation->.cityArea') &&
  cityQuery.includes('["addr:place"]') &&
  cityQuery.includes('["addr:full"]') &&
  cityQuery.includes('out center 301'));

const addresses = Array.from({ length: 10 }, (_, i) => ({
  street: `${100 + i} Main St`, city: 'Testville', state: 'OH', zip: i < 5 ? '11111' : '22222',
  ...(i === 7 ? { square_feet: 4000 } : {}),
}));
const tiers = helpers.buildAddressTierAssignments(addresses, { 11111: 500000, 22222: 200000 });
const tierValues = addresses.map(a => tiers[helpers.addressIdentity(a)].n);
ok('assigns top 20 percent to T1 and middle 50 percent to T2',
  tierValues.filter(n => n === 1).length === 2 && tierValues.filter(n => n === 2).length === 5 && tierValues.filter(n => n === 3).length === 3);

const noValue = helpers.buildAddressTierAssignments(addresses, {});
ok('still tiers missing valuations deterministically',
  Object.keys(noValue).length === 10 && noValue[helpers.addressIdentity(addresses[7])].n === 1);

const server = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const stormUi = fs.readFileSync('src/pages/StormTracking.jsx', 'utf8');
const addressHandlerStart = server.indexOf('async fetchStormZoneAddresses(params');
const addressHandlerEnd = server.indexOf('\n  async updateStormSecondaryAreas', addressHandlerStart);
const addressHandler = server.slice(addressHandlerStart, addressHandlerEnd > addressHandlerStart ? addressHandlerEnd : undefined);
ok('server uses a circular OSM address query and current documented endpoint failover',
  server.includes('nwr(${around})["addr:housenumber"]') &&
  server.includes('["addr:place"]') &&
  server.includes('out center 301') &&
  server.includes('overpass.private.coffee/api/interpreter') &&
  !server.includes('overpass.kumi.systems') &&
  server.includes('STORM_ADDRESS_OVERPASS_CACHE_TTL_MS'));
ok('sparse or unavailable OSM results are never padded with reverse-geocoded sample points',
  !addressHandler.includes('supplementNearbyAddresses') &&
  !addressHandler.includes('maps.googleapis.com/maps/api/geocode/json?latlng=') &&
  addressHandler.includes('not a complete list') &&
  addressHandler.includes('coverageWarning'));
ok('primary affected-area click switches to the matching City cache entry',
  stormUi.includes("const cityCacheKey = stormAddressCacheKey(storm.id, 'city')") &&
  stormUi.includes("setAddressSearchMode('city');"));
ok('radius searches never substitute city-wide results while labeled as a radius',
  !server.includes('cityFallbackQuery') &&
  server.includes("mode: radiusMeters || usedAreaFallback ? 'radius' : 'city'") &&
  server.includes("scope: radiusMeters ? 'radius' : usedAreaFallback ? 'storm-area radius' : 'city boundary'"));
ok('City mode resolves the selected city rather than reusing the storm point',
  server.includes("if (cityName && (!radiusMiles || !lat || !lng))") &&
  server.includes('Could not resolve selected city') &&
  server.includes('buildCityBoundaryQuery(selectedCity, lat, lng)'));
ok('combined NWS area names fall back to a bounded storm-area search when city lookup providers fail',
  addressHandler.includes('usedAreaFallback = true') &&
  addressHandler.includes('/\\s+(?:and|&)\\s+/i.test(selectedCity)') &&
  addressHandler.includes('is a combined storm area') &&
  addressHandler.includes('not an exact city boundary') &&
  addressHandler.includes("areaNotice ? `${areaNotice} ` : ''") &&
  addressHandler.includes("scope: radiusMeters ? 'radius' : usedAreaFallback ? 'storm-area radius' : 'city boundary'"));
ok('address-service outages and OSM coverage limits are disclosed with a retry option',
  stormUi.includes('error: warning || null') &&
  stormUi.includes('coverageWarning') &&
  stormUi.includes('Retry address lookup') &&
  server.includes('Address search is temporarily unavailable'));
ok('City searches invoke the named area even when a storm has no coordinates',
  stormUi.includes('const params = { cityName, radiusMiles: null };') &&
  stormUi.includes('if (storm.latitude != null && storm.longitude != null)') &&
  !stormUi.includes("mode: 'city', error: 'No coordinates available for this storm.'"));

console.log(`\nAll ${passed} storm-zone address checks passed.`);