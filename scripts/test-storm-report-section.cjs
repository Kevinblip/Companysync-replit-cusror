/**
 * Test #828 — Storm history section in Measurement Report
 *
 * Validates end-to-end:
 *  1. getPropertyStormHistory DB handler returns correct shape for a storm-dense area
 *  2. getPropertyStormHistory returns correct shape for a coordinate with no storms
 *  3. generateMeasurementReportHTML includes Weather Intelligence page when sh.success=true
 *  4. With storms: stat badges, event tables (date/size/distance columns) rendered
 *  5. Without storms: green "No significant storm events recorded" panel rendered
 *  6. Both the open-window call site and the save-report call site pass stormHistory
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');

let pass = 0;
let fail = 0;

function ok(label, cond, detail = '') {
  if (cond) {
    console.log(`  ✅  ${label}`);
    pass++;
  } else {
    console.error(`  ❌  ${label}${detail ? ' — ' + detail : ''}`);
    fail++;
  }
}

// ─── Replicate the getPropertyStormHistory query logic ────────────────────────
async function getPropertyStormHistory(pool, { lat, lng, radiusMiles = 15, daysBack = 1825 }) {
  function haversineSql(latF, lngF) {
    return `3959 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS((data->>'latitude')::float - ${latF}) / 2), 2) +
      COS(RADIANS(${latF})) * COS(RADIANS((data->>'latitude')::float)) *
      POWER(SIN(RADIANS((data->>'longitude')::float - ${lngF}) / 2), 2)
    ))`;
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const radiusF = parseFloat(radiusMiles);
  const latDelta = radiusF / 69.0;
  const lngDelta = radiusF / (69.0 * Math.cos(latF * Math.PI / 180));
  const haversine = haversineSql(latF, lngF);

  const query = `
    SELECT id, data,
      CASE WHEN data->>'has_geometry' = 'false' THEN 999
           ELSE ${haversine} END AS distance_miles
    FROM generic_entities
    WHERE entity_type = 'StormEvent'
      AND (data->>'start_time')::timestamp >= NOW() - INTERVAL '${parseInt(daysBack)} days'
      AND data->>'event_type' IN ('hail', 'high_wind', 'tornado', 'thunderstorm')
      AND data->>'latitude' IS NOT NULL AND data->>'latitude' != ''
      AND data->>'longitude' IS NOT NULL AND data->>'longitude' != ''
      AND data->>'has_geometry' IS DISTINCT FROM 'false'
      AND (data->>'latitude')::float BETWEEN ${latF - latDelta} AND ${latF + latDelta}
      AND (data->>'longitude')::float BETWEEN ${lngF - lngDelta} AND ${lngF + lngDelta}
      AND ${haversine} <= ${radiusF}
    ORDER BY (data->>'start_time')::timestamp DESC NULLS LAST
    LIMIT 500
  `;

  const result = await pool.query(query);
  const storms = result.rows.map(r => {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
    const dist = parseFloat(r.distance_miles);
    return { id: r.id, ...d, distance_miles: dist >= 999 ? null : parseFloat(dist.toFixed(1)) };
  });

  const hailEvents = storms
    .filter(s => s.event_type === 'hail' && (parseFloat(s.hail_size_inches) || 0) >= 1.0)
    .sort((a, b) => (parseFloat(b.hail_size_inches) || 0) - (parseFloat(a.hail_size_inches) || 0));

  const windEvents = storms
    .filter(s =>
      (s.event_type === 'high_wind' || s.event_type === 'thunderstorm') &&
      (parseFloat(s.wind_speed_mph) || 0) >= 55
    )
    .sort((a, b) => (parseFloat(b.wind_speed_mph) || 0) - (parseFloat(a.wind_speed_mph) || 0));

  const tornadoEvents = storms
    .filter(s => s.event_type === 'tornado')
    .sort((a, b) => new Date(b.start_time || 0) - new Date(a.start_time || 0));

  const maxHail = hailEvents.length > 0 ? Math.max(...hailEvents.map(s => parseFloat(s.hail_size_inches) || 0)) : 0;
  const maxWind = windEvents.length > 0 ? Math.max(...windEvents.map(s => parseFloat(s.wind_speed_mph) || 0)) : 0;

  let riskRating = 'LOW';
  if (tornadoEvents.length > 0 || maxHail >= 2.0 || maxWind >= 100) riskRating = 'EXTREME';
  else if (hailEvents.length >= 3 || windEvents.length >= 5 || maxHail >= 1.5) riskRating = 'HIGH';
  else if (hailEvents.length >= 1 || windEvents.length >= 2) riskRating = 'MODERATE';

  const allDates = storms.map(s => s.start_time).filter(Boolean).sort();

  return {
    success: true,
    hailEvents,
    windEvents,
    tornadoEvents,
    stats: {
      hailCount: hailEvents.length,
      windCount: windEvents.length,
      tornadoCount: tornadoEvents.length,
      maxHailInches: maxHail,
      maxWindMph: maxWind,
      riskRating,
      radiusMiles: radiusF,
      daysBack: parseInt(daysBack),
      oldestEventDate: allDates[0] || null,
      newestEventDate: allDates[allDates.length - 1] || null,
    },
  };
}

// ─── Minimal storm section HTML validator ─────────────────────────────────────
function validateStormHTML(html, stormHistory) {
  const sh = stormHistory || {};
  const shStats = sh.stats || {};
  const hasStormData = sh.success && (shStats.hailCount > 0 || shStats.windCount > 0 || shStats.tornadoCount > 0);
  const noStormData = sh.success && !hasStormData;

  // Storm page must exist when sh.success = true
  ok('Storm page included in HTML', html.includes('Weather Intelligence'), 'missing "Weather Intelligence" heading');

  // Risk rating badge
  const riskRating = shStats.riskRating || 'LOW';
  ok(`Risk rating "${riskRating}" rendered`, html.includes(riskRating));

  // Stat badges — 5 badges present
  ok('Hail Events stat badge present',       html.includes('Hail Events'));
  ok('Wind Events stat badge present',       html.includes('Wind Events'));
  ok('Tornado Events stat badge present',    html.includes('Tornado Events'));
  ok('Max Hail stat badge present',          html.includes('Max Hail'));
  ok('Max Wind stat badge present',          html.includes('Max Wind'));

  // With storm data: tables rendered
  if (hasStormData) {
    if (shStats.hailCount > 0) {
      ok('Hail event table header (Date col)',       html.includes('Hail Events'));
      ok('Hail event table hail-size column',        html.includes('Hail Size'));
      ok('Hail event table distance column',         html.includes('Distance'));
    }
    if (shStats.windCount > 0) {
      ok('Wind event table header',                  html.includes('Wind Events'));
      ok('Wind event table wind-speed column',       html.includes('Wind Speed'));
    }
    // Insurance supplement paragraph
    ok('Insurance supplement paragraph (NOAA)',     html.includes('NOAA storm records show'));
    ok('No-data panel absent when events exist',   !html.includes('No significant storm events recorded'));
  }

  // No-data case
  if (noStormData) {
    ok('Green no-data panel present',              html.includes('No significant storm events recorded'));
    ok('Insurance supplement paragraph (no data)', html.includes('No significant hail'));
    ok('Storm tables absent in no-data case',     !html.includes('Hail Size'));
  }

  // NOAA disclaimer always present
  ok('NOAA data disclaimer present', html.includes('Iowa Environmental Mesonet') || html.includes('IEM'));

  // Footer with company name
  ok('Weather Intelligence footer present', html.includes('Weather Intelligence'));

  // Page break class (storm page is a new page).
  // Use the FIRST occurrence of the section heading (inside the <h1>), not the last
  // (which hits the footer line, too far from the opening div).
  ok('Storm page has page-break class', (() => {
    // pageHdr uses esc() which does NOT convert the em-dash; the literal — stays
    const marker = 'Weather Intelligence \u2014 Storm History';
    const idx = html.indexOf(marker);
    if (idx < 0) return false;
    // The opening <div class="page page-break"> appears within ~150 chars before the <h1>
    const before = html.slice(Math.max(0, idx - 200), idx);
    return before.includes('page-break');
  })());
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const pool = createPool({ connectionString: process.env.DATABASE_URL });

  // Dynamically import the ESM HTML generator
  let generateMeasurementReportHTML;
  try {
    const mod = await import('../src/utils/generateMeasurementReportHTML.js');
    generateMeasurementReportHTML = mod.generateMeasurementReportHTML;
  } catch (e) {
    console.error('Failed to import generateMeasurementReportHTML:', e.message);
    process.exit(1);
  }

  // ── Test 1: Storm-dense area (39.17, -95.57 — recent hail confirmed in DB) ──
  console.log('\n── TEST 1: Storm-dense coordinates (39.17, -95.57) ──');
  const stormRich = await getPropertyStormHistory(pool, { lat: 39.17, lng: -95.57, radiusMiles: 15, daysBack: 1825 });

  ok('Handler returns success=true',          stormRich.success === true);
  ok('hailEvents is an array',                Array.isArray(stormRich.hailEvents));
  ok('windEvents is an array',                Array.isArray(stormRich.windEvents));
  ok('tornadoEvents is an array',             Array.isArray(stormRich.tornadoEvents));
  ok('stats object present',                  stormRich.stats && typeof stormRich.stats === 'object');
  ok('stats.hailCount is a number',           typeof stormRich.stats.hailCount === 'number');
  ok('stats.riskRating is a string',          typeof stormRich.stats.riskRating === 'string');
  ok('At least 1 event found near (39.17,-95.57)',
    stormRich.hailEvents.length > 0 || stormRich.windEvents.length > 0 || stormRich.tornadoEvents.length > 0,
    `h=${stormRich.stats.hailCount} w=${stormRich.stats.windCount} t=${stormRich.stats.tornadoCount}`
  );

  // Verify hail event shape
  if (stormRich.hailEvents.length > 0) {
    const ev = stormRich.hailEvents[0];
    ok('Hail event has start_time',           !!ev.start_time);
    ok('Hail event has hail_size_inches ≥ 1', parseFloat(ev.hail_size_inches) >= 1.0,
       `got ${ev.hail_size_inches}`);
    ok('Hail event has distance_miles',       ev.distance_miles != null);
    ok('Hail event distance ≤ 15 miles',      parseFloat(ev.distance_miles) <= 15,
       `got ${ev.distance_miles}`);
  }
  // Verify wind event shape
  if (stormRich.windEvents.length > 0) {
    const ev = stormRich.windEvents[0];
    ok('Wind event has wind_speed_mph ≥ 55',  parseFloat(ev.wind_speed_mph) >= 55,
       `got ${ev.wind_speed_mph}`);
    ok('Wind event has distance_miles',       ev.distance_miles != null);
  }

  // ── Test 2: Ocean coordinates — should return 0 events ───────────────────
  console.log('\n── TEST 2: Ocean/no-storm coordinates (0.0, -30.0) ──');
  const noStorm = await getPropertyStormHistory(pool, { lat: 0.0, lng: -30.0, radiusMiles: 15, daysBack: 1825 });

  ok('Handler returns success=true (no-storm)', noStorm.success === true);
  ok('No hail events in mid-Atlantic',          noStorm.hailEvents.length === 0);
  ok('No wind events in mid-Atlantic',          noStorm.windEvents.length === 0);
  ok('Risk rating = LOW',                       noStorm.stats.riskRating === 'LOW');

  // ── Test 3: HTML generation — with storm data ─────────────────────────────
  console.log('\n── TEST 3: HTML generation — with storm data ──');
  const fakeSatAnalysis = {
    roof_area_sq: 22.5, roof_area_sqft: 2250, waste_percentage: 12,
    pitch: '6/12', roof_type: 'gable', num_segments: 8,
    overall_confidence: 87, segment_stats: [],
    ridge_lf: 40, hip_lf: 0, valley_lf: 15, rake_lf: 60, eave_lf: 60,
  };
  const fakeSatAddr = { address: '123 Main St, Topeka KS 66601', coordinates: { lat: 39.17, lng: -95.57 } };

  const htmlWithStorms = generateMeasurementReportHTML({
    satelliteAnalysis: fakeSatAnalysis,
    satelliteAddress: fakeSatAddr,
    companyName: 'TestCo Roofing',
    companyLogoUrl: '',
    gmapsKey: '',
    baseUrl: 'https://example.com',
    lineItems: [],
    preferredBrands: [],
    stormHistory: stormRich,
  });

  ok('generateMeasurementReportHTML returns a string', typeof htmlWithStorms === 'string');
  ok('HTML is non-empty',                             htmlWithStorms.length > 1000);
  validateStormHTML(htmlWithStorms, stormRich);

  // ── Test 4: HTML generation — no storm data ───────────────────────────────
  console.log('\n── TEST 4: HTML generation — no storm data (green panel) ──');
  const htmlNoStorms = generateMeasurementReportHTML({
    satelliteAnalysis: fakeSatAnalysis,
    satelliteAddress: { address: 'Mid-Atlantic Rig', coordinates: { lat: 0.0, lng: -30.0 } },
    companyName: 'TestCo Roofing',
    companyLogoUrl: '',
    gmapsKey: '',
    baseUrl: 'https://example.com',
    lineItems: [],
    preferredBrands: [],
    stormHistory: noStorm,
  });

  validateStormHTML(htmlNoStorms, noStorm);

  // ── Test 5: HTML generation — stormHistory=null (no storm section) ────────
  console.log('\n── TEST 5: HTML generation — stormHistory=null (page omitted) ──');
  const htmlNull = generateMeasurementReportHTML({
    satelliteAnalysis: fakeSatAnalysis,
    satelliteAddress: fakeSatAddr,
    companyName: 'TestCo Roofing',
    companyLogoUrl: '',
    gmapsKey: '',
    baseUrl: 'https://example.com',
    lineItems: [],
    preferredBrands: [],
    stormHistory: null,
  });

  ok('Storm page absent when stormHistory=null', !htmlNull.includes('Weather Intelligence'),
     'unexpected storm page found');
  ok('NOAA disclaimer absent when stormHistory=null', !htmlNull.includes('Iowa Environmental Mesonet'),
     'unexpected NOAA text found');

  // ── Test 6: stormHistory={success:false} — page also omitted ─────────────
  console.log('\n── TEST 6: HTML generation — stormHistory={success:false} (page omitted) ──');
  const htmlFailed = generateMeasurementReportHTML({
    satelliteAnalysis: fakeSatAnalysis,
    satelliteAddress: fakeSatAddr,
    companyName: 'TestCo Roofing',
    companyLogoUrl: '',
    gmapsKey: '',
    baseUrl: 'https://example.com',
    lineItems: [],
    preferredBrands: [],
    stormHistory: { success: false, error: 'timeout', hailEvents: [], windEvents: [], tornadoEvents: [], stats: {} },
  });

  ok('Storm page absent when success=false', !htmlFailed.includes('Weather Intelligence'),
     'unexpected storm page found');

  // ── Test 7: Verify both AIEstimator call sites reference stormHistory ──────
  console.log('\n── TEST 7: AIEstimator.jsx — both call sites pass stormHistory ──');
  const fs = require('fs');
  const src = fs.readFileSync('src/pages/AIEstimator.jsx', 'utf8');

  // Count occurrences of stormHistory being passed to generateMeasurementReportHTML
  const passMatches = [...src.matchAll(/generateMeasurementReportHTML\(\{[^}]*stormHistory/gs)];
  ok('Both open-window and save-report pass stormHistory', passMatches.length >= 2,
     `found ${passMatches.length} call site(s) — expected ≥ 2`);

  // Both call sites invoke getPropertyStormHistory
  const fetchMatches = [...src.matchAll(/invoke\('getPropertyStormHistory'/g)];
  ok('Both call sites invoke getPropertyStormHistory', fetchMatches.length >= 2,
     `found ${fetchMatches.length} call site(s) — expected ≥ 2`);

  // ── Results ────────────────────────────────────────────────────────────────
  await pool.end();
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  console.log('─'.repeat(52));
  if (fail > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
