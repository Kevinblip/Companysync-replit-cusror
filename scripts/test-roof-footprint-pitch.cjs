#!/usr/bin/env node
/**
 * Handler replay: a mocked Solar buildingInsights response that covers only
 * part of an OSM footprint. No live API, and no Hover quantity is fed in.
 */

const LAT = 41.52;
const LNG = -81.55;
const FACTOR_7_12 = Math.sqrt(1 + (7 / 12) ** 2);
const PITCH_DEG = Math.atan(7 / 12) * 180 / Math.PI;

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function rectangle(lat, lng, halfNsFt, halfEwFt) {
  const dLat = halfNsFt / 364567.2;
  const dLng = halfEwFt / (364567.2 * Math.cos(lat * Math.PI / 180));
  return [
    { lat: lat - dLat, lon: lng - dLng },
    { lat: lat - dLat, lon: lng + dLng },
    { lat: lat + dLat, lon: lng + dLng },
    { lat: lat + dLat, lon: lng - dLng },
    { lat: lat - dLat, lon: lng - dLng },
  ];
}

function solarPayload({ groundSqFt, slopeSqFt, segments, pitchDegrees, imageryYear, halfNsFt = 12, halfEwFt = 10 }) {
  const dLat = halfNsFt / 364567.2;
  const dLng = halfEwFt / (364567.2 * Math.cos(LAT * Math.PI / 180));
  const segs = Array.from({ length: segments }, (_, i) => {
    const lat = LAT + (halfNsFt < 20 ? i * 0.000012 : 0);
    return {
      pitchDegrees,
      azimuthDegrees: i % 2 === 0 ? 180 : 0,
      planeHeightAtCenterMeters: 6,
      center: { latitude: lat, longitude: LNG },
      boundingBox: {
        sw: { latitude: lat - dLat, longitude: LNG - dLng },
        ne: { latitude: lat + dLat, longitude: LNG + dLng },
      },
      stats: {
        areaMeters2: (slopeSqFt / segments) / 10.7639,
        groundAreaMeters2: (groundSqFt / segments) / 10.7639,
      },
    };
  });
  return {
    imageryDate: { year: imageryYear, month: 8, day: 1 },
    center: { latitude: LAT, longitude: LNG },
    // A report quantity sitting on the payload must not become the area.
    hoverReportSqFt: 3997,
    solarPotential: {
      wholeRoofStats: {
        areaMeters2: slopeSqFt / 10.7639,
        groundAreaMeters2: groundSqFt / 10.7639,
      },
      roofSegmentStats: segs,
    },
  };
}

function osmPayload(geometry, extra = [], tags = { building: 'yes' }) {
  const buildings = [{ geometry, tags }, ...extra];
  return {
    elements: buildings.map((building, index) => ({
      type: 'way',
      id: index + 1,
      tags: building.tags || { building: 'yes' },
      geometry: building.geometry,
    })),
  };
}

async function runCase({ name, solar, geometry, extraBuildings = [], tags, extraParams = {}, latitude = LAT, longitude = LNG }) {
  const { ringFromLatLngGeometry } = await import('../functions/utils/roofFootprintArea.js');
  const { functionHandlers } = await import('../vite-functions-plugin.js');
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  const originalTakeoff = process.env.ROOF_IMAGERY_TAKEOFF;
  process.env.GOOGLE_MAPS_API_KEY = '__fixture__';
  delete process.env.ROOF_IMAGERY_TAKEOFF;
  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('solar.googleapis.com')) {
      return new Response(JSON.stringify(solar), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.includes('overpass-api.de')) {
      return new Response(JSON.stringify(osmPayload(geometry, extraBuildings, tags)), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected request ${requestUrl.slice(0, 120)}`);
  };
  try {
    const result = await functionHandlers._aiRoofMeasurementImpl(
      { latitude, longitude, address: name, ...extraParams },
      null,
      null,
    );
    return { result, ring: ringFromLatLngGeometry(geometry) };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
    if (originalTakeoff === undefined) delete process.env.ROOF_IMAGERY_TAKEOFF;
    else process.env.ROOF_IMAGERY_TAKEOFF = originalTakeoff;
  }
}

(async () => {
  console.log('\n── Partial Solar vs mapped footprint ──────────────────────────');
  const partialGeometry = rectangle(LAT, LNG, 80, 50);
  const partialRingPreview = (await import('../functions/utils/roofFootprintArea.js')).ringFromLatLngGeometry(partialGeometry);
  const partialGround = Math.round(partialRingPreview.areaSqFt * 0.36);
  const partial = await runCase({
    name: '2051 Hanover Rd fixture',
    geometry: partialGeometry,
    solar: solarPayload({
      groundSqFt: partialGround,
      slopeSqFt: 1438,
      segments: 7,
      pitchDegrees: PITCH_DEG,
      imageryYear: 2024,
    }),
  });
  const result = partial.result;
  const expected = Math.round(partial.ring.areaSqFt * FACTOR_7_12);
  if (!result?.success) console.error(result?.error || result?.debug_logs);
  check('handler succeeded', result?.success === true, result?.error);
  check('pitch stays 7/12', result?.pitch === '7/12', String(result?.pitch));
  check('seven Solar facets are still reported', result?.num_segments === 7, String(result?.num_segments));
  check('area is footprint × 7/12, not the 1438 Solar fragment', result?.roof_area_sqft === expected, `got ${result?.roof_area_sqft}, expected ${expected}`);
  check('area is not the planted Hover 3997', result?.roof_area_sqft !== 3997);
  check('area method is footprint_x_pitch', result?.area_method === 'footprint_x_pitch', result?.area_method);
  check('imagery takeoff did not run', result?.imagery_takeoff == null && result?.imagery_cross_check === 'not_run');
  check('not measured from the selected image', result?.measured_from_selected_imagery === false);
  check('measurement is not ready', result?.measurement_ready === false);
  check('manual review is required', result?.requires_manual_review === true);
  check('confidence is low', result?.area_confidence === 'low' && result?.overall_confidence <= 35, `area ${result?.area_confidence} overall ${result?.overall_confidence}`);
  check('slope flag stays set so the UI does not apply pitch again', result?.area_is_slope_adjusted === true);
  check('reason records that no takeoff ran', result?.roof_diagnostics?.footprint_pitch_reason === 'imagery_takeoff_not_run', result?.roof_diagnostics?.footprint_pitch_reason);

  console.log('\n── Solar that already covers the footprint ────────────────────');
  const coveredGeometry = rectangle(LAT, LNG, 40, 28);
  const coveredRing = (await import('../functions/utils/roofFootprintArea.js')).ringFromLatLngGeometry(coveredGeometry);
  const coveredGround = Math.round(coveredRing.areaSqFt * 0.92);
  const coveredSlope = Math.round(coveredGround * Math.sqrt(1 + (5 / 12) ** 2));
  const covered = await runCase({
    name: 'near-complete roof',
    geometry: coveredGeometry,
    solar: solarPayload({
      groundSqFt: coveredGround,
      slopeSqFt: coveredSlope,
      segments: 4,
      pitchDegrees: Math.atan(5 / 12) * 180 / Math.PI,
      imageryYear: 2026,
      halfNsFt: 40,
      halfEwFt: 28,
    }),
  });
  const kept = covered.result;
  check('covering Solar stays a success', kept?.success === true, kept?.error);
  check('covering Solar is not rewritten to footprint × pitch', kept?.area_method !== 'footprint_x_pitch', kept?.area_method);
  check('covering Solar stays measurement-ready', kept?.measurement_ready === true, String(kept?.measurement_ready));
  check('covering Solar is not low-confidence from this rule', kept?.area_confidence === 'standard', String(kept?.area_confidence));
  check('covering Solar area stays on the Solar figure', Math.abs(kept?.roof_area_sqft - coveredSlope) / coveredSlope < 0.08, `got ${kept?.roof_area_sqft}, solar ${coveredSlope}, method ${kept?.area_method}, skip ${kept?.roof_diagnostics?.completion_skip_reason}`);
  if (Math.abs(kept?.roof_area_sqft - coveredSlope) / coveredSlope >= 0.08) {
    for (const line of kept?.debug_logs || []) {
      if (/completion|Footprint|Area:|OSM|CLAMP|Pitch:/.test(line)) console.error('   ', line);
    }
  }

  console.log('\n── Address building, not the larger neighbor ───────────────');
  const addressGeometry = rectangle(LAT, LNG, 40, 25);
  const neighborGeometry = rectangle(LAT + 0.00022, LNG - 0.00018, 70, 55).map((point, index, all) => (
    index === all.length - 1 ? { ...point } : point
  ));
  const addressRing = (await import('../functions/utils/roofFootprintArea.js')).ringFromLatLngGeometry(addressGeometry);
  const neighborRing = (await import('../functions/utils/roofFootprintArea.js')).ringFromLatLngGeometry(neighborGeometry);
  check('neighbor outline is larger than the address', neighborRing.areaSqFt > addressRing.areaSqFt * 1.5, `${neighborRing.areaSqFt} vs ${addressRing.areaSqFt}`);
  const shortBesideNeighbor = await runCase({
    name: '2051 Hanover Rd',
    geometry: addressGeometry,
    tags: { building: 'yes', 'addr:housenumber': '2051', 'addr:street': 'Hanover Drive' },
    extraBuildings: [{
      geometry: neighborGeometry,
      tags: { building: 'yes', 'addr:housenumber': '917', 'addr:street': 'Brunswick Road' },
    }],
    solar: solarPayload({
      groundSqFt: Math.round(addressRing.areaSqFt * 0.36),
      slopeSqFt: 1438,
      segments: 7,
      pitchDegrees: PITCH_DEG,
      imageryYear: 2024,
    }),
  });
  const addressExpected = Math.round(addressRing.areaSqFt * FACTOR_7_12);
  const neighborExpected = Math.round(neighborRing.areaSqFt * FACTOR_7_12);
  const beside = shortBesideNeighbor.result;
  check('short Solar uses the address footprint × pitch', beside?.roof_area_sqft === addressExpected, `got ${beside?.roof_area_sqft}, address ${addressExpected}, neighbor ${neighborExpected}`);
  check('short Solar does not bill the neighbor', beside?.roof_area_sqft !== neighborExpected);
  check('short Solar beside a neighbor is not ready', beside?.measurement_ready === false);
  check('footprint × pitch fills in a review reason', (beside?.rep_review_reasons || []).includes('solar_smaller_than_footprint'), JSON.stringify(beside?.rep_review_reasons));
  check('footprint × pitch fills in the review message', typeof beside?.rep_review_message === 'string' && beside.rep_review_message.includes('Needs rep review'), beside?.rep_review_message);

  const roesingGeometry = rectangle(LAT, LNG, 20, 14);
  const roesingRing = (await import('../functions/utils/roofFootprintArea.js')).ringFromLatLngGeometry(roesingGeometry);
  const roesingSlope = Math.round(roesingRing.areaSqFt * FACTOR_7_12 * 0.93);
  const roesingGround = Math.round(roesingRing.areaSqFt * 0.7);
  const roesing = await runCase({
    name: '8 Roesing Dr',
    geometry: roesingGeometry,
    tags: { building: 'house', 'addr:housenumber': '8', 'addr:street': 'Roesing Drive' },
    extraBuildings: [{
      geometry: neighborGeometry,
      tags: { building: 'yes', 'addr:housenumber': '917', 'addr:street': 'Brunswick Road' },
    }],
    solar: solarPayload({
      groundSqFt: roesingGround,
      slopeSqFt: roesingSlope,
      segments: 6,
      pitchDegrees: PITCH_DEG,
      imageryYear: 2024,
      halfNsFt: 18,
      halfEwFt: 14,
    }),
  });
  const roesingResult = roesing.result;
  check('Roesing stays on the Solar area', Math.abs((roesingResult?.roof_area_sqft || 0) - roesingSlope) <= 15, `got ${roesingResult?.roof_area_sqft}, method ${roesingResult?.area_method}, skip ${roesingResult?.roof_diagnostics?.completion_skip_reason}`);
  check('Roesing is not footprint × pitch', roesingResult?.area_method !== 'footprint_x_pitch', roesingResult?.area_method);
  check('Roesing is not a completed add-on', roesingResult?.roof_diagnostics?.completion_applied !== true, roesingResult?.roof_diagnostics?.completion_skip_reason);
  check('Roesing stays ready', roesingResult?.measurement_ready === true, `ready ${roesingResult?.measurement_ready} reasons ${(roesingResult?.rep_review_reasons || []).join(',')}`);

  console.log('\n── Walls too large for a Solar model the map agrees with ──');
  const agreedGeometry = rectangle(LAT, LNG, 20, 16);
  const agreedRing = (await import('../functions/utils/roofFootprintArea.js')).ringFromLatLngGeometry(agreedGeometry);
  const agreedGround = Math.round(agreedRing.areaSqFt * 0.94);
  const agreedSolar = solarPayload({
    groundSqFt: agreedGround,
    slopeSqFt: 1438,
    segments: 7,
    pitchDegrees: PITCH_DEG,
    imageryYear: 2024,
    halfNsFt: 20,
    halfEwFt: 16,
  });
  const agreed = await runCase({
    name: '2051 Hanover Rd',
    geometry: agreedGeometry,
    tags: { building: 'yes', 'addr:housenumber': '2051', 'addr:street': 'Hanover Drive' },
    solar: agreedSolar,
  });
  const agreedResult = agreed.result;
  check('map-agreeing Solar stays near its own area', Math.abs((agreedResult?.roof_area_sqft || 0) - 1438) < 120, `got ${agreedResult?.roof_area_sqft} method ${agreedResult?.area_method}`);
  check('map-agreeing Solar without walls stays ready', agreedResult?.measurement_ready === true, `ready ${agreedResult?.measurement_ready} reasons ${(agreedResult?.rep_review_reasons || []).join(',')}`);

  const walled = await runCase({
    name: '2051 Hanover Rd',
    geometry: agreedGeometry,
    tags: { building: 'yes', 'addr:housenumber': '2051', 'addr:street': 'Hanover Drive' },
    solar: agreedSolar,
    extraParams: {
      gross_wall_area_sqft: 3600,
      story_count: 2,
      story_height_ft: 9,
    },
  });
  const walledResult = walled.result;
  check('walls flag the short roof for rep review', walledResult?.needs_rep_review === true && (walledResult?.rep_review_reasons || []).includes('roof_short_for_walls'), JSON.stringify(walledResult?.rep_review_reasons));
  check('walls do not rewrite the roof area', Math.abs((walledResult?.roof_area_sqft || 0) - (agreedResult?.roof_area_sqft || 0)) < 1, `walled ${walledResult?.roof_area_sqft} agreed ${agreedResult?.roof_area_sqft}`);
  check('walls do not bill 25 squares or the planted report', walledResult?.roof_area_sqft !== 2500 && walledResult?.roof_area_sqft !== 3997, String(walledResult?.roof_area_sqft));
  check('wall review message asks the rep to confirm or hand-trace', typeof walledResult?.rep_review_message === 'string' && walledResult.rep_review_message.includes('Needs rep review') && walledResult.rep_review_message.includes('hand-trace'), walledResult?.rep_review_message);
  check('wall review is not ready', walledResult?.measurement_ready === false);

  console.log('\n── Outbuilding pin, Solar centroid on the house ──────────');
  const blackHouse = rectangle(LAT, LNG, 40, 30);
  const garageNorthFt = 78.74;
  const garageLat = LAT + (garageNorthFt / 364567.2);
  const blackGarage = rectangle(garageLat, LNG, 14, 9.8);
  const rings = await import('../functions/utils/roofFootprintArea.js');
  const blackHouseRing = rings.ringFromLatLngGeometry(blackHouse);
  const blackGarageRing = rings.ringFromLatLngGeometry(blackGarage);
  check('garage is about 548 sq ft and 24 m from the house', blackGarageRing.areaSqFt > 500 && blackGarageRing.areaSqFt < 600, String(blackGarageRing.areaSqFt));
  const black = await runCase({
    name: '20 Black Ave',
    latitude: garageLat,
    longitude: LNG,
    geometry: blackHouse,
    tags: { building: 'house', 'addr:housenumber': '20', 'addr:street': 'Black Avenue' },
    extraBuildings: [{ geometry: blackGarage, tags: { building: 'yes' } }],
    extraParams: { structure_type: 'garage' },
    solar: solarPayload({
      groundSqFt: 1166,
      slopeSqFt: 1350,
      segments: 6,
      pitchDegrees: PITCH_DEG,
      imageryYear: 2024,
      halfNsFt: 40,
      halfEwFt: 30,
    }),
  });
  const blackResult = black.result;
  const garagePlan = Math.round(blackGarageRing.areaSqFt);
  const garageBilled = Math.round(blackGarageRing.areaSqFt * FACTOR_7_12);
  const houseBilled = Math.round(blackHouseRing.areaSqFt * FACTOR_7_12);
  const flatFactor = Math.sqrt(1 + (1 / 12) ** 2);
  if (!blackResult?.success) console.error(blackResult?.error || blackResult?.debug_logs);
  check('outbuilding does not borrow the house pitch', blackResult?.pitch === 'unknown' && blackResult?.pitch_unknown === true, `pitch ${blackResult?.pitch} source ${blackResult?.pitch_source}`);
  check('outbuilding area is the unpinched outline', blackResult?.roof_area_sqft === garagePlan, `got ${blackResult?.roof_area_sqft}, plan ${garagePlan}, pitched ${garageBilled}`);
  check('outbuilding does not bill the house outline or a flat factor', blackResult?.roof_area_sqft !== houseBilled && blackResult?.roof_area_sqft !== 1350 && blackResult?.roof_area_sqft !== Math.round(garagePlan * flatFactor));
  check('outbuilding is not marked ready', blackResult?.measurement_ready === false);
  check('outbuilding review names the other building', (blackResult?.rep_review_reasons || []).includes('solar_measured_other_building') && !(blackResult?.rep_review_reasons || []).includes('solar_smaller_than_footprint'), JSON.stringify(blackResult?.rep_review_reasons));
  check('outbuilding review asks to confirm pitch and hand-trace once', typeof blackResult?.rep_review_message === 'string' && blackResult.rep_review_message.includes('different building') && blackResult.rep_review_message.includes('Confirm the pitch') && (blackResult.rep_review_message.match(/hand-trace/gi) || []).length === 1 && !/covers \d+% of the building outline/.test(blackResult.rep_review_message) && !blackResult.rep_review_message.includes('Confirm this is the right roof'), blackResult?.rep_review_message);
  check('outbuilding warning does not call Solar smaller than the outline', typeof blackResult?.warning_message === 'string' && !/covers \d+%/.test(blackResult.warning_message) && blackResult.warning_message.includes('Pitch is unknown'), blackResult?.warning_message);

  console.log('\n── Outbuilding with a Solar plane on that building ──────────');
  const flatDeg = Math.atan(1 / 12) * 180 / Math.PI;
  const garageSolar = solarPayload({
    groundSqFt: 1166,
    slopeSqFt: 1350,
    segments: 4,
    pitchDegrees: flatDeg,
    imageryYear: 2024,
    halfNsFt: 20,
    halfEwFt: 16,
  });
  const gLat = garageLat;
  const gDLat = 8 / 364567.2;
  const gDLng = 6 / (364567.2 * Math.cos(gLat * Math.PI / 180));
  garageSolar.solarPotential.roofSegmentStats.push({
    pitchDegrees: PITCH_DEG,
    azimuthDegrees: 180,
    planeHeightAtCenterMeters: 4,
    center: { latitude: gLat, longitude: LNG },
    boundingBox: {
      sw: { latitude: gLat - gDLat, longitude: LNG - gDLng },
      ne: { latitude: gLat + gDLat, longitude: LNG + gDLng },
    },
    stats: { areaMeters2: 40, groundAreaMeters2: 34 },
  });
  const onPin = await runCase({
    name: '20 Black Ave',
    latitude: garageLat,
    longitude: LNG,
    geometry: blackHouse,
    tags: { building: 'house', 'addr:housenumber': '20', 'addr:street': 'Black Avenue' },
    extraBuildings: [{ geometry: blackGarage, tags: { building: 'yes' } }],
    extraParams: { structure_type: 'garage' },
    solar: garageSolar,
  });
  const onPinResult = onPin.result;
  if (!onPinResult?.success) console.error(onPinResult?.error || onPinResult?.debug_logs);
  check('overlapping segment supplies 7/12, not the house 1/12', onPinResult?.pitch === '7/12', String(onPinResult?.pitch));
  check('overlapping segment bills the pin outline times that pitch', onPinResult?.roof_area_sqft === garageBilled, `got ${onPinResult?.roof_area_sqft}, expected ${garageBilled}`);
  check('overlapping segment stays not ready', onPinResult?.measurement_ready === false && (onPinResult?.rep_review_reasons || []).includes('solar_measured_other_building'));
  check('overlapping segment does not say Solar covers the outline', typeof onPinResult?.rep_review_message === 'string' && !/covers \d+% of the building outline/.test(onPinResult.rep_review_message), onPinResult?.rep_review_message);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  console.log('\n✓ Partial Solar coverage bills footprint × pitch at low confidence.');
})().catch((error) => {
  console.error('\nFootprint pitch handler test crashed:', error);
  process.exit(1);
});
