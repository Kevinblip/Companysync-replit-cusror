#!/usr/bin/env node
/**
 * Storm County-Name State Collision Test
 * ──────────────────────────────────────────────────────────────────────────
 * Regression guard for the cross-state COUNTY-name collision bug:
 *
 *   An NWS Wind Advisory covering Indiana counties (Carroll, Warren,
 *   Tippecanoe, Clinton, Howard, Fountain, Montgomery, Boone, Tipton,
 *   Hamilton) was stamped with Carroll County OHIO's coordinates, because the
 *   county → coordinate table was keyed by a bare lowercase county name. That
 *   put a ~300-mile-away storm 60.6 mi from a Bedford Heights, OH office and
 *   sailed straight through the service-radius gate.
 *
 * Tests (pure logic — no database, no network, no email):
 *   A) County lookups are keyed by (state, name), never by name alone
 *   B) Ingestion resolves the storm state from the UGC zone code, and an
 *      Indiana advisory never lands on Ohio county coordinates
 *   C) A coordinate that disagrees with the event's zone state is rejected
 *   D) THE GATE: a legacy StormEvent carrying collided coordinates does not
 *      alert the Bedford Heights office (coords treated as missing, then the
 *      state-guarded text matcher also declines)
 *   E) Non-regression: a real in-state storm inside the radius still alerts
 *   F) Non-regression: a real out-of-state storm outside the radius does not
 *   G) Non-regression: a coordinate-less in-state storm still text-matches
 *   H) Marine zones (no state in the UGC code) leave coordinates trusted
 *
 * Usage:  node scripts/test-storm-state-collision.cjs
 */
'use strict';

const geo = require('../db/storm-geo.cjs');
const { matchStormToOffices } = require('../db/storm-functions.cjs');

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Carroll County, OHIO — the coordinates the collision stamped onto Indiana alerts
const CARROLL_OH = { lat: 40.5763, lng: -81.0890 };
// The reporting office in the incident
const BEDFORD_HEIGHTS = { lat: 41.3939, lng: -81.5068 };

const INDIANA_ADVISORY_AREAS =
  'Carroll; Warren; Tippecanoe; Clinton; Howard; Fountain; Montgomery; Boone; Tipton; Hamilton';
const INDIANA_UGC = ['INZ021', 'INZ022', 'INZ023', 'INZ024', 'INZ025'];

function bedfordHeightsOffice(overrides = {}) {
  const location = 'Bedford Heights, OH';
  return {
    name: 'Main Office',
    location,
    radius_miles: 60,
    service_areas: [],
    coords: { ...BEDFORD_HEIGHTS },
    locRaw: location.toLowerCase(),
    locParts: location.toLowerCase().split(',').map(p => p.trim()),
    ...overrides,
  };
}

console.log('\n🌪  Storm county-name state collision regression\n');

// ── A) Lookups keyed by (state, name) ──────────────────────────────────────
console.log('A) County lookups are keyed by (state, name)');
check('Carroll in OHIO resolves to Carroll County OH',
  JSON.stringify(geo.lookupCountyCentroid('OH', 'Carroll')) === JSON.stringify(CARROLL_OH),
  JSON.stringify(geo.lookupCountyCentroid('OH', 'Carroll')));
check('Carroll in INDIANA does NOT resolve to an Ohio centroid',
  geo.lookupCountyCentroid('IN', 'Carroll') === null,
  JSON.stringify(geo.lookupCountyCentroid('IN', 'Carroll')));
check('"Carroll County" normalizes the same as "Carroll"',
  JSON.stringify(geo.lookupCountyCentroid('OH', 'Carroll County')) === JSON.stringify(CARROLL_OH));
check('Lawrence resolves per-state (PA has one, OH is not borrowed)',
  geo.lookupCountyCentroid('PA', 'Lawrence') !== null && geo.lookupCountyCentroid('IN', 'Lawrence') === null);
check('No bare-name keys remain in the county table',
  Object.keys(geo.COUNTY_CENTROIDS).every(k => /^[A-Z]{2}:/.test(k)),
  Object.keys(geo.COUNTY_CENTROIDS).filter(k => !/^[A-Z]{2}:/.test(k)).join(', '));

// ── B) State resolved from the NWS zone / UGC code ─────────────────────────
console.log('\nB) State comes from the NWS zone/UGC code, not the area names');
check('UGC "INZ021" resolves to IN',
  geo.statesFromUgcCodes(INDIANA_UGC).join(',') === 'IN',
  geo.statesFromUgcCodes(INDIANA_UGC).join(','));
const inFallback = geo.resolveNwsFallbackCoords({
  ugcCodes: INDIANA_UGC,
  areaDesc: INDIANA_ADVISORY_AREAS,
  fallbackState: 'OH',
});
check('Indiana advisory never lands on Carroll County OH coordinates',
  !(Math.abs(inFallback.lat - CARROLL_OH.lat) < 0.01 && Math.abs(inFallback.lng - CARROLL_OH.lng) < 0.01),
  `${inFallback.lat},${inFallback.lng}`);
check('Indiana advisory falls back to the Indiana state centroid',
  inFallback.state === 'IN' && inFallback.source === 'state_centroid',
  `${inFallback.state}/${inFallback.source}`);
const ohFallback = geo.resolveNwsFallbackCoords({
  ugcCodes: ['OHZ011', 'OHZ012'],
  areaDesc: 'Carroll; Stark; Tuscarawas',
});
check('An Ohio advisory still uses the Ohio county centroid',
  ohFallback.source === 'county_centroid' && Math.abs(ohFallback.lat - CARROLL_OH.lat) < 0.01,
  `${ohFallback.source} ${ohFallback.lat},${ohFallback.lng}`);

// ── C) Coordinate vs zone-state disagreement ───────────────────────────────
console.log('\nC) A coordinate disagreeing with the zone state is rejected');
check('Carroll OH coords do NOT agree with an IN zone',
  geo.coordsAgreeWithStates(CARROLL_OH.lat, CARROLL_OH.lng, ['IN']) === false);
check('Carroll OH coords DO agree with an OH zone',
  geo.coordsAgreeWithStates(CARROLL_OH.lat, CARROLL_OH.lng, ['OH']) === true);
check('A multi-state zone accepts a coordinate in any of its states',
  geo.coordsAgreeWithStates(CARROLL_OH.lat, CARROLL_OH.lng, ['IN', 'OH']) === true);
check('Unknown zone state leaves the coordinate trusted (no false rejection)',
  geo.coordsAgreeWithStates(CARROLL_OH.lat, CARROLL_OH.lng, []) === true);

// ── D) The alert gate itself ───────────────────────────────────────────────
console.log('\nD) THE GATE: collided legacy row must not alert Bedford Heights, OH');
const collidedStorm = {
  event_id: 'NWS_collision_fixture',
  event_type: 'high_wind',
  severity: 'moderate',
  title: '⚡ ACTIVE: Wind Advisory — Carroll',
  affected_areas: [INDIANA_ADVISORY_AREAS],
  nws_state: 'IN',
  nws_states: ['IN'],
  latitude: CARROLL_OH.lat,
  longitude: CARROLL_OH.lng,
};
const collidedResult = matchStormToOffices(collidedStorm, [bedfordHeightsOffice()]);
check('collided coordinates are NOT trusted',
  collidedResult.coordsTrusted === false);
check('storm does NOT match the Ohio office',
  collidedResult.matchesArea === false,
  `matched at ${collidedResult.distanceMiles} mi`);
check('no bogus "60.6 mi away" distance is produced',
  collidedResult.distanceMiles === null,
  String(collidedResult.distanceMiles));

// Same row without the persisted nws_states array (older rows) — nws_state alone suffices
const legacyNoArray = { ...collidedStorm, nws_states: undefined };
check('legacy rows lacking nws_states still resolve the zone state from nws_state',
  matchStormToOffices(legacyNoArray, [bedfordHeightsOffice()]).matchesArea === false);

// ── E/F/G/H) Non-regression ────────────────────────────────────────────────
console.log('\nE-H) Non-regression');
const nearbyOhioStorm = {
  event_id: 'NWS_ohio_nearby',
  event_type: 'hail',
  severity: 'severe',
  affected_areas: ['Cuyahoga; Summit'],
  nws_state: 'OH',
  nws_states: ['OH'],
  latitude: 41.4993,
  longitude: -81.6944,
};
const nearby = matchStormToOffices(nearbyOhioStorm, [bedfordHeightsOffice()]);
check('E) real Ohio storm inside the radius still alerts, with a distance',
  nearby.matchesArea === true && nearby.coordsTrusted === true && nearby.distanceMiles !== null && nearby.distanceMiles < 60,
  `${nearby.matchesArea} @ ${nearby.distanceMiles}`);

const realIndianaStorm = {
  event_id: 'NWS_indiana_real',
  event_type: 'high_wind',
  severity: 'moderate',
  affected_areas: [INDIANA_ADVISORY_AREAS],
  nws_state: 'IN',
  nws_states: ['IN'],
  latitude: 40.2672,
  longitude: -86.1349,
};
const realIn = matchStormToOffices(realIndianaStorm, [bedfordHeightsOffice()]);
check('F) real Indiana storm (correct coords, ~270 mi) does not alert',
  realIn.matchesArea === false && realIn.coordsTrusted === true,
  `${realIn.matchesArea} @ ${realIn.distanceMiles}`);

const coordlessOhioStorm = {
  event_id: 'NWS_ohio_nocoords',
  event_type: 'high_wind',
  severity: 'moderate',
  affected_areas: ['Bedford Heights, OH'],
  nws_state: 'OH',
  nws_states: ['OH'],
  latitude: null,
  longitude: null,
};
check('G) coordinate-less Ohio storm still matches by text',
  matchStormToOffices(coordlessOhioStorm, [bedfordHeightsOffice()]).matchesArea === true);

const coordlessNcStorm = {
  event_id: 'NWS_nc_nocoords',
  event_type: 'high_wind',
  severity: 'moderate',
  affected_areas: ['Cleveland, NC'],
  nws_state: 'NC',
  nws_states: ['NC'],
  latitude: null,
  longitude: null,
};
const clevelandOffice = (() => {
  const location = 'Cleveland, OH';
  return {
    name: 'Cleveland Office', location, radius_miles: 60, service_areas: [],
    coords: { lat: 41.4993, lng: -81.6944 },
    locRaw: location.toLowerCase(), locParts: location.toLowerCase().split(',').map(p => p.trim()),
  };
})();
check('G2) "Cleveland, NC" still does not alert Cleveland, OH',
  matchStormToOffices(coordlessNcStorm, [clevelandOffice]).matchesArea === false);

const marineStorm = {
  event_id: 'NWS_marine',
  event_type: 'high_wind',
  severity: 'moderate',
  affected_areas: ['Lake Erie from Avon Point to Willowick OH'],
  nws_state: null,
  nws_states: [],
  latitude: 41.6,
  longitude: -81.6,
};
const marine = matchStormToOffices(marineStorm, [bedfordHeightsOffice()]);
check('H) marine zone with no state leaves coordinates trusted and matching',
  marine.coordsTrusted === true && marine.matchesArea === true,
  `${marine.coordsTrusted}/${marine.matchesArea}`);

console.log(`\n${failures === 0 ? '✅ All storm state-collision checks passed' : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
