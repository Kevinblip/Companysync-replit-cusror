#!/usr/bin/env node
/**
 * Repeat the live Malec analyzer K times and print the spread.
 *
 * For Replit, where GOOGLE_GEMINI_API_KEY exists. Each photo inside one run
 * is itself read N times at temperature 0 (handler default N=3, override with
 * --samples). This script then repeats the whole analyzer K times (--runs,
 * default 3) and reports min / median / max / spread for siding, stone,
 * stucco, and siding by face. spread = (max - min) / median.
 *
 * Without a Gemini key this prints the skip reason and exits 0. It does not
 * import the analyzer in that case. A keyed run that fails exits 1.
 *
 *   node scripts/run-siding-malec-stability.cjs
 *   node scripts/run-siding-malec-stability.cjs --runs 5 --samples 3
 *
 * Does not write the customer photos anywhere.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADDRESS = '5405 Brookside Trail, Solon, OH';
const PHOTOS = [
  { file: '01M50FP86JVAJBY57YMGQE6FB1.jpg', label: 'Elevation 1' },
  { file: '01M50FP88VDD2PFMRFFSEK91GN.jpg', label: 'Elevation 2' },
  { file: '01M50FP89NSS6RSH44B02W04Q1.jpg', label: 'Elevation 3' },
  { file: '01M50FP8ATP12ZTCWANJPXD75J.jpg', label: 'Elevation 4' },
  { file: '01M50FP8AV9WNW52JEYG2RAPMC.jpg', label: 'Elevation 5' },
  { file: '01M50FP8KXG23KCGRFS1C4SN73.jpg', label: 'Elevation 6' },
];

function argNumber(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function geminiKey() {
  const name = ['GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY'].find((key) => String(process.env[key] || '').trim());
  return name ? { name, value: String(process.env[name]).trim() } : null;
}

function findPhotoDir() {
  const candidates = [
    process.env.MALEC_PHOTO_DIR,
    path.join(ROOT, 'malec'),
    path.join(ROOT, 'scripts', 'fixtures', 'malec'),
  ].filter(Boolean);
  const cursor = path.join('/cursor/stores/bot');
  if (fs.existsSync(cursor)) {
    const stack = [cursor];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      if (PHOTOS.every((photo) => entries.some((entry) => entry.name === photo.file))) return dir;
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'node_modules') stack.push(path.join(dir, entry.name));
      }
    }
  }
  return candidates.find((dir) => PHOTOS.every((photo) => fs.existsSync(path.join(dir, photo.file)))) || null;
}

function median(values) {
  const sorted = [...values].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function spreadOf(values) {
  const finite = values.filter((n) => Number.isFinite(n));
  if (!finite.length) return { min: null, median: null, max: null, spread: null, n: 0 };
  const mid = median(finite);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const spread = mid > 0 ? (max - min) / mid : (max - min);
  return { min, median: mid, max, spread, n: finite.length };
}

function fmt(stats) {
  if (!stats.n) return '—';
  const pct = stats.spread == null ? '—' : `${(stats.spread * 100).toFixed(1)}%`;
  return `min ${stats.min.toFixed(1)}  median ${stats.median.toFixed(1)}  max ${stats.max.toFixed(1)}  spread ${pct}  (n=${stats.n})`;
}

(async () => {
  const runs = Math.max(1, Math.min(10, argNumber('--runs', 3)));
  const samples = Math.max(1, Math.min(5, argNumber('--samples', 3)));
  const key = geminiKey();
  console.log(`\nMalec stability — ${runs} live analyzer runs, ${samples} material samples per photo`);
  if (!key) {
    console.log('NO GEMINI KEY: GOOGLE_GEMINI_API_KEY and GEMINI_API_KEY are unset. The real analyzer was not called, so no spread was measured. Re-run this script in Replit once a key is in the environment.');
    process.exit(0);
  }

  const photoDir = findPhotoDir();
  if (!photoDir) {
    console.log(`NO PHOTOS: the six Malec JPEGs were not found. Set MALEC_PHOTO_DIR or put them in ${path.join(ROOT, 'malec')}.`);
    process.exit(1);
  }

  let latitude = null;
  let longitude = null;
  try {
    const geo = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(ADDRESS)}`, {
      headers: { 'User-Agent': 'companysync-malec-siding-stability/1.0' },
    });
    if (geo.ok) {
      const rows = await geo.json();
      if (rows[0]) {
        latitude = Number(rows[0].lat);
        longitude = Number(rows[0].lon);
      }
    }
  } catch (error) {
    console.log(`Geocode skipped: ${error.message}`);
  }

  const photos = PHOTOS.map((photo) => {
    const bytes = fs.readFileSync(path.join(photoDir, photo.file));
    return {
      label: photo.label,
      url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    };
  });

  const { functionHandlers } = await import('../vite-functions-plugin.js');
  const rows = [];
  let failed = 0;
  for (let i = 0; i < runs; i += 1) {
    console.log(`\nRun ${i + 1}/${runs}`);
    const result = await functionHandlers.analyzeHousePhotosForSiding({
      photos,
      latitude,
      longitude,
      use_satellite: Boolean(latitude && longitude),
      structure_type: 'house',
      address: ADDRESS,
      material_samples: samples,
    }, key.value);
    if (!result?.success) {
      failed += 1;
      console.log(`RUN FAILED: ${result?.error || 'no success flag'}`);
      console.log((result?.debug_logs || []).slice(-8).join('\n'));
      continue;
    }
    const sections = result.wall_material_sections || {};
    const gross = sections.totals_gross_sqft || {};
    const faces = {};
    for (const face of ['front', 'right', 'left', 'back']) {
      faces[face] = sections.faces?.[face]?.gross_sqft_by_material?.siding ?? null;
    }
    const row = {
      siding: gross.siding ?? null,
      stone: gross.stone ?? null,
      stucco: gross.stucco ?? null,
      faces,
      confidence: sections.confidence || null,
      warnings: sections.warnings || [],
    };
    rows.push(row);
    console.log(`  siding ${row.siding}  stone ${row.stone}  stucco ${row.stucco}  confidence ${row.confidence}`);
    console.log(`  siding by face front ${faces.front ?? '—'} right ${faces.right ?? '—'} left ${faces.left ?? '—'} back ${faces.back ?? '—'}`);
    if (row.warnings.length) console.log(`  warnings: ${row.warnings.join(' | ')}`);
  }

  console.log('\nSpread across successful runs');
  console.log(`  siding ft²   ${fmt(spreadOf(rows.map((row) => row.siding)))}`);
  console.log(`  stone ft²    ${fmt(spreadOf(rows.map((row) => row.stone)))}`);
  console.log(`  stucco ft²   ${fmt(spreadOf(rows.map((row) => row.stucco)))}`);
  for (const face of ['front', 'right', 'left', 'back']) {
    console.log(`  siding ${face.padEnd(5)} ${fmt(spreadOf(rows.map((row) => row.faces[face])))}`);
  }
  if (failed) {
    console.log(`\n${failed} of ${runs} runs failed.`);
    process.exit(1);
  }
  if (!rows.length) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
