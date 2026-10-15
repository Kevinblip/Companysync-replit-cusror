#!/usr/bin/env node
/**
 * Score the live roof measurement against the four Hover benchmark houses.
 *
 * Requires GOOGLE_MAPS_API_KEY. Without it the script skips, so CI that has
 * no Solar key still passes. Pass --require to fail instead of skipping.
 * Pass --update-baseline after an intentional improvement.
 *
 * A later run fails when any scored field moves farther from Hover than the
 * saved baseline by more than 1.5 percentage points.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requireKey = process.argv.includes('--require');
const updateBaseline = process.argv.includes('--update-baseline');
const baselinePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hover-score-baseline.json');

const HOUSES = [
  {
    id: 'eastview',
    label: '17158 Eastview Dr',
    address: '17158 Eastview Dr, Chagrin Falls, OH 44023',
    geocode: true,
    hover: { area: 5430, pitch: '6/12', rh: 220.92, valley: 121.17, rake: 199, eave: 259.67, gutter: 259.67 },
  },
  {
    id: 'gemini',
    label: '5688 Gemini Ct',
    address: '5688 Gemini Ct, Solon, OH 44139',
    latitude: 41.4057912,
    longitude: -81.455736,
    hover: { area: 2481, pitch: '5/12', rh: 68.42, valley: 4.42, rake: 123.08, eave: 171.08, gutter: 171.08 },
  },
  {
    id: 'oak',
    label: '1721 Oak St',
    address: '1721 Oak St, Girard, OH 44420',
    latitude: 41.1781556,
    longitude: -80.7066223,
    hover: { area: 1778, pitch: '4/12', rh: 63.92, valley: 25, rake: 130.83, eave: 105.67, gutter: 105.67 },
  },
  {
    id: 'holmes',
    label: '15402 Holmes Ave',
    address: '15402 Holmes Ave, Cleveland, OH 44110',
    latitude: 41.5600987,
    longitude: -81.5739567,
    hover: { area: 1126, pitch: '11/12', rh: 51.08, valley: 0, rake: 86.42, eave: 94.75, gutter: 94.75 },
  },
];

function percentError(actual, expected) {
  if (expected === 0) return actual === 0 ? 0 : null;
  return Math.round((Math.abs(actual - expected) / Math.abs(expected)) * 1000) / 10;
}

if (!process.env.GOOGLE_MAPS_API_KEY) {
  const message = 'GOOGLE_MAPS_API_KEY is not set; Hover score skipped';
  if (requireKey) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

const { functionHandlers } = await import('../vite-functions-plugin.js');

async function locate(house) {
  if (!house.geocode) return { latitude: house.latitude, longitude: house.longitude };
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(house.address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
  const json = await (await fetch(url)).json();
  const loc = json.results?.[0]?.geometry?.location;
  if (!loc) throw new Error(`Could not locate ${house.label}`);
  return { latitude: loc.lat, longitude: loc.lng };
}

const rows = [];
for (const house of HOUSES) {
  const where = await locate(house);
  const result = await functionHandlers._aiRoofMeasurementImpl({
    ...where,
    address: house.address,
  }, null, null);
  const actual = {
    area: Math.round(Number(result.roof_area_sqft) * 10) / 10,
    pitch: result.pitch,
    rh: Math.round((Number(result.ridge_lf) + Number(result.hip_lf)) * 10) / 10,
    valley: Number(result.valley_lf) || 0,
    rake: Number(result.rake_lf) || 0,
    eave: Number(result.eave_lf) || 0,
    gutter: Number(result.gutter_lf) || 0,
  };
  const error = {
    area: percentError(actual.area, house.hover.area),
    pitch: actual.pitch === house.hover.pitch ? 0 : 100,
    rh: percentError(actual.rh, house.hover.rh),
    valley: house.hover.valley === 0 ? (actual.valley === 0 ? 0 : null) : percentError(actual.valley, house.hover.valley),
    rake: percentError(actual.rake, house.hover.rake),
    eave: percentError(actual.eave, house.hover.eave),
    gutter: percentError(actual.gutter, house.hover.gutter),
  };
  rows.push({
    id: house.id,
    label: house.label,
    actual,
    error,
    area_method: result.area_method,
    linear_source: result.roof_linear_source,
    datalayers: result.datalayers_status,
    wall_perimeter_ft: result.wall_perimeter_ft,
    outside_corners: result.outside_corners,
    inside_corners: result.inside_corners,
    wall_elevations: result.wall_elevations,
    downspout_count: result.downspout_count,
  });
  console.log(`${house.label}: area ${actual.area} (${error.area}% ) pitch ${actual.pitch} rh ${actual.rh} (${error.rh}%) valley ${actual.valley} rake ${actual.rake} (${error.rake}%) eave ${actual.eave} (${error.eave}%) [${result.area_method} / ${result.roof_linear_source}]`);
}

if (updateBaseline || !existsSync(baselinePath)) {
  writeFileSync(baselinePath, JSON.stringify({ scored_at: new Date().toISOString(), rows }, null, 2));
  console.log(`Wrote ${baselinePath}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
let failed = 0;
for (const row of rows) {
  const previous = baseline.rows.find(item => item.id === row.id);
  if (!previous) continue;
  for (const field of Object.keys(row.error)) {
    const next = row.error[field];
    const prev = previous.error[field];
    if (next == null || prev == null) continue;
    if (next > prev + 1.5) {
      failed++;
      console.error(`REGRESSION ${row.label} ${field}: ${prev}% -> ${next}%`);
    }
  }
}
if (failed) process.exit(1);
console.log('Hover score did not regress against the saved baseline.');
