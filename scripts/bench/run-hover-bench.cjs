#!/usr/bin/env node
/**
 * Hover benchmark runner. Runs the live photo analyzer on each bench house
 * with ONLY photos + address (+ geocoded lat/lng). Hover truth is never read here.
 *
 *   node scripts/bench/run-hover-bench.cjs --set dev --samples 3
 *   node scripts/bench/run-hover-bench.cjs --set holdout
 *   node scripts/bench/run-hover-bench.cjs --set all --only 21235571
 *
 * Inputs: uploads-bench/photos/<jobid>/*.jpg, uploads-bench/split.json,
 *         uploads-bench/addresses.json (address only, no measurements).
 * Output: bench-results/<jobid>.json (raw analyzer output + run meta).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const BENCH = process.env.BENCH_DIR || path.join(ROOT, 'uploads-bench');
const OUT = path.join(ROOT, 'bench-results');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i < 0 ? fallback : process.argv[i + 1];
}
function geminiKey() {
  const name = ['GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY'].find((k) => String(process.env[k] || '').trim());
  return name ? String(process.env[name]).trim() : null;
}
async function geocode(address) {
  const gkey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  try {
    if (gkey) {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${gkey}`);
      const j = await r.json();
      const loc = j.results?.[0]?.geometry?.location;
      if (loc) return { latitude: loc.lat, longitude: loc.lng, source: 'google' };
    }
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
      { headers: { 'User-Agent': 'companysync-hover-bench/1.0' } });
    const rows = r.ok ? await r.json() : [];
    if (rows[0]) return { latitude: Number(rows[0].lat), longitude: Number(rows[0].lon), source: 'nominatim' };
  } catch (e) { console.log(`  geocode error: ${e.message}`); }
  return { latitude: null, longitude: null, source: 'none' };
}

(async () => {
  const { PRODUCTION_MATERIAL_SAMPLE_COUNT } = await import(path.join(ROOT, 'functions/utils/faceMaterialClassification.js'));
  const set = arg('--set', 'dev');
  // Production classifies each face this many times. A live bench that passed
  // --samples 1 measured one read per photo and did not match production.
  const samples = PRODUCTION_MATERIAL_SAMPLE_COUNT;
  const requested = arg('--samples', null);
  if (requested != null && Number(requested) !== samples) {
    console.log(`--samples ${requested} ignored. Production classifies each face ${samples} times; this bench matches production.`);
  }
  const only = arg('--only', null);
  const key = geminiKey();
  if (!key) { console.log('NO GEMINI KEY: set GOOGLE_GEMINI_API_KEY. Nothing run.'); process.exit(0); }
  const split = JSON.parse(fs.readFileSync(path.join(BENCH, 'split.json'), 'utf8'));
  const addresses = JSON.parse(fs.readFileSync(path.join(BENCH, 'addresses.json'), 'utf8'));
  let jobs = set === 'all' ? [...split.dev, ...split.holdout] : split[set];
  if (!jobs) { console.log(`unknown --set ${set}`); process.exit(1); }
  if (only) jobs = jobs.filter((j) => only.split(',').includes(j));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, '.gitignore'), '*\n');
  const { functionHandlers } = await import(path.join(ROOT, 'vite-functions-plugin.js'));
  let failed = 0;
  for (const job of jobs) {
    const dir = path.join(BENCH, 'photos', job);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort() : [];
    if (!files.length) { console.log(`${job}: no photos, skipped`); continue; }
    const address = addresses[job];
    const geo = await geocode(address);
    const photos = files.map((f, i) => ({
      label: `Elevation ${i + 1}`,
      url: `data:image/jpeg;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`,
    }));
    console.log(`${job}: ${files.length} photos, ${address}, geo=${geo.source}`);
    const t0 = Date.now();
    let result;
    try {
      result = await functionHandlers.analyzeHousePhotosForSiding({
        photos, latitude: geo.latitude, longitude: geo.longitude,
        use_satellite: Boolean(geo.latitude && geo.longitude),
        structure_type: 'house', address, material_samples: samples,
      }, key);
    } catch (e) { result = { success: false, error: e.message }; }
    if (!result?.success) failed += 1;
    const meta = { job_id: job, set, samples, address, geo, photo_count: files.length, ms: Date.now() - t0, ran_at: new Date().toISOString() };
    fs.writeFileSync(path.join(OUT, `${job}.json`), JSON.stringify({ meta, result }, null, 1));
    console.log(`  ${result?.success ? 'ok' : 'FAILED ' + (result?.error || '')} in ${Math.round(meta.ms / 1000)}s`);
  }
  console.log(`done, ${failed} failed of ${jobs.length}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
