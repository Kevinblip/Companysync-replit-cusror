#!/usr/bin/env node
/**
 * Live Malec run — 5405 Brookside Trail, Solon OH — through the real
 * analyzeHousePhotosForSiding handler (vite-functions-plugin.js).
 *
 * Scores the returned wall_material_sections against Hover:
 *   siding 1,806 ft², stone 942, stucco 844, perimeter 281.8 ft, 2 stories,
 *   35 openings on siding, windows 599 ft², 6 doors 351 ft²,
 *   siding by elevation front 73 / right 444 / left 409 / back 880,
 *   roof 4,414 ft².
 *
 * Without GOOGLE_GEMINI_API_KEY or GEMINI_API_KEY this prints the skip reason
 * and exits 0 so the scorecard can stay green. Pass --require-key to fail
 * closed when a real run was expected.
 *
 * Photos: six JPEGs named 01M50FP86….jpg. Set MALEC_PHOTO_DIR, or place them
 * in ./malec. The script also checks the Cursor attachment folder when present.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const requireKey = process.argv.includes('--require-key');
const HOVER = {
  siding: 1806,
  stone: 942,
  stucco: 844,
  perimeterLf: 281 + 10 / 12,
  stories: 2,
  sidingOpenings: 35,
  windowSqft: 599,
  doors: 6,
  doorSqft: 351,
  sidingByFace: { front: 73, right: 444, left: 409, back: 880 },
  roofSqft: 4414,
};
const ADDRESS = '5405 Brookside Trail, Solon, OH';
// Neutral labels. The Replit run that scored siding 2,772 ft² sent
// "Right Side", "Front", "Back", "FL Corner", "Left Side", "Left Side",
// and the model copied those names into wall_face. 01M50FP86 is the garage
// on the driveway, not the right elevation. The face has to come from the
// photo. These labels also avoid forcing the satellite width anchor onto a
// side the filename does not actually decide.
const PHOTOS = [
  { file: '01M50FP86JVAJBY57YMGQE6FB1.jpg', label: 'Elevation 1' },
  { file: '01M50FP88VDD2PFMRFFSEK91GN.jpg', label: 'Elevation 2' },
  { file: '01M50FP89NSS6RSH44B02W04Q1.jpg', label: 'Elevation 3' },
  { file: '01M50FP8ATP12ZTCWANJPXD75J.jpg', label: 'Elevation 4' },
  { file: '01M50FP8AV9WNW52JEYG2RAPMC.jpg', label: 'Elevation 5' },
  { file: '01M50FP8KXG23KCGRFS1C4SN73.jpg', label: 'Elevation 6' },
];

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

function pct(actual, expected) {
  if (!Number.isFinite(actual) || !expected) return null;
  return ((actual - expected) / expected) * 100;
}

function cell(actual, expected) {
  if (actual == null || !Number.isFinite(Number(actual))) return '—';
  const delta = pct(Number(actual), expected);
  const sign = delta > 0 ? '+' : '';
  return `${Number(actual).toFixed(1)} (${sign}${delta.toFixed(1)}%)`;
}

function finish(code, message) {
  console.log(message);
  if (requireKey && code !== 0) process.exit(code);
  process.exit(requireKey ? code : 0);
}

(async () => {
  const key = geminiKey();
  const photoDir = findPhotoDir();
  console.log('\nMalec live photo run — 5405 Brookside Trail, Solon OH');
  if (!key) {
    const photoNote = photoDir
      ? `The six photos are on disk at ${photoDir}.`
      : 'The six photos were not found. Set MALEC_PHOTO_DIR.';
    finish(2, `NO GEMINI KEY: GOOGLE_GEMINI_API_KEY and GEMINI_API_KEY are unset. The real analyzer was not called. ${photoNote} Re-run this script once a key is in the environment.`);
  }
  if (!photoDir) {
    finish(3, `NO PHOTOS: the six Malec JPEGs were not found. Set MALEC_PHOTO_DIR or put them in ${path.join(ROOT, 'malec')}.`);
  }

  let latitude = null;
  let longitude = null;
  try {
    const geo = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(ADDRESS)}`, {
      headers: { 'User-Agent': 'companysync-malec-siding-check/1.0' },
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
    const filePath = path.join(photoDir, photo.file);
    const bytes = fs.readFileSync(filePath);
    return {
      label: photo.label,
      url: `data:image/jpeg;base64,${bytes.toString('base64')}`,
    };
  });
  console.log(`Calling analyzeHousePhotosForSiding on ${photos.length} photos${latitude ? ` at ${latitude}, ${longitude}` : ' without a footprint coordinate'}.`);

  const { functionHandlers } = await import('../vite-functions-plugin.js');
  const result = await functionHandlers.analyzeHousePhotosForSiding({
    photos,
    latitude,
    longitude,
    use_satellite: Boolean(latitude && longitude),
    structure_type: 'house',
    address: ADDRESS,
  }, key.value);

  if (!result?.success) {
    console.log(`REAL RUN FAILED: ${result?.error || 'no success flag'}`);
    console.log((result?.debug_logs || []).slice(-12).join('\n'));
    process.exit(1);
  }

  const sections = result.wall_material_sections || {};
  const gross = sections.totals_gross_sqft || {};
  const sidingOpen = sections.openings?.by_material?.siding || { count: 0, sqft: 0 };
  console.log('| Item | Hover | Real analyzer |');
  console.log('| --- | ---: | ---: |');
  const rows = [
    ['Stories', HOVER.stories, sections.story?.story_count ?? result.story_count],
    ['Perimeter LF', HOVER.perimeterLf, sections.perimeter_ft ?? result.perimeter_ft],
    ['Siding ft²', HOVER.siding, gross.siding],
    ['Stone ft²', HOVER.stone, gross.stone],
    ['Stucco ft²', HOVER.stucco, gross.stucco],
    ['Siding openings', HOVER.sidingOpenings, sidingOpen.count],
    ['Window ft²', HOVER.windowSqft, sections.openings?.window_sqft],
    ['Doors', HOVER.doors, sections.openings?.doors],
    ['Door ft²', HOVER.doorSqft, sections.openings?.door_sqft],
    ['Roof ft²', HOVER.roofSqft, result.roof_area_sqft],
  ];
  for (const [label, hover, actual] of rows) {
    console.log(`| ${label} | ${Number(hover).toFixed(1)} | ${cell(actual, hover)} |`);
  }
  for (const face of ['front', 'right', 'left', 'back']) {
    const actual = sections.faces?.[face]?.gross_sqft_by_material?.siding;
    console.log(`  siding ${face}: ${cell(actual, HOVER.sidingByFace[face])} vs Hover ${HOVER.sidingByFace[face]}`);
  }
  console.log(`Perimeter source: ${sections.perimeter_source || 'n/a'}. Face lengths: ${sections.face_length_source || 'n/a'} ${JSON.stringify(sections.face_lengths_ft || {})}.`);
  console.log(`Story source: ${result.story_count_source || sections.story?.source}. Materials present: ${(sections.materials_present || []).join(', ') || 'none'}.`);
  console.log(`Sections returned: ${(sections.overlay || []).length}. Unclassified photos: ${(sections.unclassified_photos || []).length}.`);
  const reportPath = path.join(ROOT, 'scripts', 'fixtures', 'malec-live-result.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    address: ADDRESS,
    story_count: result.story_count,
    story_count_source: result.story_count_source,
    perimeter_ft: result.perimeter_ft,
    roof_area_sqft: result.roof_area_sqft,
    wall_material_sections: sections,
    debug_tail: (result.debug_logs || []).slice(-30),
  }, null, 2));
  console.log(`Wrote ${reportPath}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
