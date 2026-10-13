#!/usr/bin/env node
/**
 * Live accuracy benchmark for the imagery takeoff.
 *
 * Property: 3554 Atherstone Rd, Cleveland Heights, OH 44121
 * Independent truth (Roofgraf report): 3,996.98 sq ft / 39.97 SQ, 6 facets,
 * predominantly 4/12 with some 3/12.
 *
 * This calls the real measurement handler, so it consumes Google Solar,
 * imagery tile, and Gemini quota. It is a benchmark, not a unit test.
 */

const ADDRESS = process.env.BENCH_ADDRESS || '3554 Atherstone Rd, Cleveland Heights, OH 44121';
const TRUTH_SQFT = Number(process.env.BENCH_TRUTH_SQFT || 3996.98);
const TRUTH_FACETS = Number(process.env.BENCH_TRUTH_FACETS || 6);
const SOURCE = process.env.BENCH_IMAGERY || 'esri_clarity';

(async () => {
  const { functionHandlers } = await import('../vite-functions-plugin.js');

  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!mapsKey) { console.error('GOOGLE_MAPS_API_KEY is required'); process.exit(1); }
  if (!geminiKey) { console.error('GOOGLE_GEMINI_API_KEY is required'); process.exit(1); }

  const geo = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(ADDRESS)}&key=${mapsKey}`
  ).then((r) => r.json());
  const loc = geo?.results?.[0]?.geometry?.location;
  if (!loc) { console.error('Geocode failed:', geo?.status, geo?.error_message); process.exit(1); }
  console.log(`Address : ${ADDRESS}`);
  console.log(`Coords  : ${loc.lat}, ${loc.lng}`);
  console.log(`Imagery : ${SOURCE}\n`);

  const started = Date.now();
  const res = await functionHandlers._aiRoofMeasurementImpl(
    { latitude: loc.lat, longitude: loc.lng, address: ADDRESS, imagery_source: SOURCE },
    geminiKey,
    null,
  );
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log('--- backend log ---');
  for (const l of res.debug_logs || []) console.log('  ' + l);

  const t = res.imagery_takeoff;
  console.log('\n--- imagery takeoff ---');
  if (!t) {
    console.log('  (no takeoff ran)');
  } else {
    console.log(`  used for measurement : ${t.used_for_measurement}`);
    console.log(`  source               : ${t.source_label} @ z${t.zoom} (${t.feet_per_pixel} ft/px)`);
    console.log(`  facets               : ${t.facet_count}`);
    console.log(`  plan area            : ${t.plan_area_sqft} sqft`);
    console.log(`  roof area (slope)    : ${t.roof_area_sqft} sqft`);
    console.log(`  edges                : ${JSON.stringify(t.edge_totals)}`);
    console.log(`  obstruction          : ${t.obstruction_pct}%`);
    console.log(`  open boundaries      : ${t.open_boundary_count}`);
    console.log(`  osm footprint ratio  : ${t.osm_footprint_ratio}`);
    console.log(`  building style       : ${t.building_style}`);
    if (t.reject_reasons?.length) console.log(`  REJECTED because     : ${t.reject_reasons.join(', ')}`);
    if (t.warnings?.length) console.log(`  warnings             : ${t.warnings.join(' | ')}`);
    if (t.occluded_notes) console.log(`  occlusion notes      : ${String(t.occluded_notes).slice(0,300)}`);
  }

  console.log('\n--- reported measurement ---');
  console.log(`  area        : ${res.roof_area_sqft} sqft (${res.roof_area_sq} SQ)`);
  console.log(`  pitch       : ${res.pitch}`);
  console.log(`  facets      : ${res.num_segments ?? 'n/a'}`);
  console.log(`  ridge/hip/valley/rake/eave : ${res.ridge_lf}/${res.hip_lf}/${res.valley_lf}/${res.rake_lf}/${res.eave_lf}`);
  console.log(`  linear src  : ${res.roof_linear_source}`);
  console.log(`  measured from selected imagery : ${res.measured_from_selected_imagery}`);
  console.log(`  measurement_ready : ${res.measurement_ready}`);

  const errPct = ((res.roof_area_sqft - TRUTH_SQFT) / TRUTH_SQFT) * 100;
  console.log('\n--- vs independent report ---');
  console.log(`  truth   : ${TRUTH_SQFT} sqft, ${TRUTH_FACETS} facets`);
  console.log(`  ours    : ${res.roof_area_sqft} sqft, ${res.num_segments ?? '?'} facets`);
  console.log(`  error   : ${errPct >= 0 ? '+' : ''}${errPct.toFixed(1)}%`);
  console.log(`  elapsed : ${elapsed}s`);

  // A takeoff is only useful if it lands inside normal estimating tolerance.
  const withinTolerance = Math.abs(errPct) <= 10;
  console.log(`\n${withinTolerance ? 'WITHIN' : 'OUTSIDE'} ±10% estimating tolerance`);
  process.exit(withinTolerance ? 0 : 1);
})().catch((e) => {
  console.error('Benchmark crashed:', e);
  process.exit(1);
});
