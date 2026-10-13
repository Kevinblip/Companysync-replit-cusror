#!/usr/bin/env node
/**
 * Street View frame exclusion regression test
 * ───────────────────────────────────────────
 * The AI's per-frame usability verdict is good but not perfect. A borderline
 * frame (subject house behind a parked truck, or a similar-looking neighbour)
 * can pass and quietly skew wall width and opening counts. The estimator gets a
 * one-tap veto on each Street View thumbnail.
 *
 * This test imports the PRODUCTION helpers so a refactor breaks it immediately,
 * and asserts the AIEstimator wiring that the helpers cannot cover on their own.
 *
 * Scenarios
 * ─────────
 *  1. streetViewFrameKey normalizes direction/label/string and defaults to front
 *  2. An excluded frame is dropped from svPhotos/allPhotos and reported in excludedSv
 *  3. Exclusion survives alongside uploaded-photo de-duplication
 *  4. Only usable frames can be excluded — auto-skipped frames never count as vetoes
 *  5. Exclusions persist per address and are re-read on a later run
 *  6. Toggling twice restores the frame and leaves no stored residue
 *  7. Exclusions are scoped to one address, not leaked across properties
 *  8. AIEstimator applies the veto in BOTH analysis paths and in saved evidence
 *  9. The thumbnail UI distinguishes user-excluded from auto-skipped frames
 *
 * Usage: node scripts/test-street-view-frame-exclusion.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    const detail = extra !== undefined ? ` — got ${JSON.stringify(extra)}` : '';
    console.log(`  ✗ ${name}${detail}`);
    failed++;
  }
}

// Minimal localStorage so the persistence helper runs outside a browser.
function installLocalStorage() {
  const store = new Map();
  global.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
  };
  return store;
}

async function main() {
  const rawStore = installLocalStorage();

  const {
    buildSidingPhotoList,
    streetViewFrameKey,
  } = await import('../src/utils/sidingPhotoList.js');
  const {
    readStreetViewExclusions,
    writeStreetViewExclusions,
    toggleStreetViewExclusion,
    streetViewAddressKey,
  } = await import('../src/utils/streetViewExclusions.js');

  /* ─── fixtures ─────────────────────────────────────────────────────────── */

  const svFrame = (direction, extra = {}) => ({
    available: true,
    imageUrl: `https://maps.googleapis.com/sv/${direction.replace(/\s+/g, '-').toLowerCase()}.jpg`,
    direction,
    panorama_id: `pano-${direction.replace(/\s+/g, '-').toLowerCase()}`,
    verified_elevation: true,
    ...extra,
  });

  const FRAMES = [
    svFrame('Front'),
    svFrame('Right Side'),
    svFrame('Back'),
    svFrame('Left Side'),
  ];

  const ADDRESS = '812 Maple Grove Ct, Dublin, OH 43017';
  const OTHER_ADDRESS = '99 Elmwood Ave, Columbus, OH 43201';

  /* ─── [1] key normalization ────────────────────────────────────────────── */
  console.log('\n[1] streetViewFrameKey normalization');
  ok('direction is normalized to a snake key', streetViewFrameKey({ direction: 'Right Side' }) === 'right_side',
    streetViewFrameKey({ direction: 'Right Side' }));
  ok('a built photo label resolves to the same key', streetViewFrameKey({ label: 'Right Side' }) === 'right_side',
    streetViewFrameKey({ label: 'Right Side' }));
  ok('a bare string works', streetViewFrameKey('Left Side') === 'left_side', streetViewFrameKey('Left Side'));
  ok('hyphens and casing collapse', streetViewFrameKey('LEFT-side') === 'left_side', streetViewFrameKey('LEFT-side'));
  // buildSidingPhotoList labels a direction-less frame "Front"; the key must agree
  // or the veto would miss the very photo that gets submitted.
  ok('a direction-less frame keys as front', streetViewFrameKey({}) === 'front', streetViewFrameKey({}));

  /* ─── [2] exclusion drops the frame from the submitted list ────────────── */
  console.log('\n[2] An excluded frame never reaches the analyzer');
  const baseline = buildSidingPhotoList({ elevationImages: FRAMES, housePhotos: [] });
  ok('baseline submits all 4 frames', baseline.allPhotos.length === 4, baseline.allPhotos.length);
  ok('baseline reports nothing excluded', baseline.excludedSv.length === 0, baseline.excludedSv.length);

  const vetoed = buildSidingPhotoList({
    elevationImages: FRAMES,
    housePhotos: [],
    excludedStreetViewKeys: ['right_side'],
  });
  ok('vetoed frame is gone from svPhotos',
    !vetoed.svPhotos.some(p => p.label === 'Right Side'), vetoed.svPhotos.map(p => p.label));
  ok('vetoed frame is gone from allPhotos',
    !vetoed.allPhotos.some(p => p.label === 'Right Side'), vetoed.allPhotos.map(p => p.label));
  ok('the other 3 frames survive', vetoed.allPhotos.length === 3, vetoed.allPhotos.length);
  ok('excludedSv reports the vetoed frame',
    vetoed.excludedSv.length === 1 && vetoed.excludedSv[0].direction === 'Right Side',
    vetoed.excludedSv.map(f => f.direction));
  // A raw display label must work as well as a normalized key, so a caller that
  // passes the frame's own direction through does not silently no-op.
  const vetoedRaw = buildSidingPhotoList({
    elevationImages: FRAMES,
    housePhotos: [],
    excludedStreetViewKeys: ['Right Side'],
  });
  ok('an un-normalized key still matches', vetoedRaw.allPhotos.length === 3, vetoedRaw.allPhotos.length);

  /* ─── [3] exclusion composes with uploaded-photo de-duplication ────────── */
  console.log('\n[3] Exclusion composes with uploaded-photo de-duplication');
  const withUpload = buildSidingPhotoList({
    elevationImages: FRAMES,
    housePhotos: [{ url: 'https://cdn/front.jpg', label: 'Front' }],
    excludedStreetViewKeys: ['back'],
  });
  const labels = withUpload.allPhotos.map(p => p.label).sort();
  ok('uploaded Front replaces the SV Front exactly once',
    labels.filter(l => l === 'Front').length === 1, labels);
  ok('vetoed Back is dropped', !labels.includes('Back'), labels);
  ok('remaining faces are Front + Left Side + Right Side',
    labels.join('|') === 'Front|Left Side|Right Side', labels);

  /* ─── [4] auto-skipped frames are not user vetoes ──────────────────────── */
  console.log('\n[4] Auto-skipped frames are separate from estimator vetoes');
  const mixed = buildSidingPhotoList({
    elevationImages: [
      svFrame('Front'),
      { direction: 'Back', available: false },            // no coverage — skipped automatically
      svFrame('Left Side'),
    ],
    housePhotos: [],
    excludedStreetViewKeys: ['back', 'left_side'],
  });
  ok('an unavailable frame is not reported as a user veto',
    mixed.excludedSv.length === 1 && mixed.excludedSv[0].direction === 'Left Side',
    mixed.excludedSv.map(f => f.direction));
  ok('only Front is submitted', mixed.allPhotos.map(p => p.label).join('|') === 'Front',
    mixed.allPhotos.map(p => p.label));

  /* ─── [5] the veto is remembered for the address ───────────────────────── */
  console.log('\n[5] The veto is remembered for that address');
  ok('nothing remembered before the first veto', readStreetViewExclusions(ADDRESS).length === 0);
  const firstToggle = toggleStreetViewExclusion(ADDRESS, [], FRAMES[1]);
  ok('toggle reports the frame as now excluded', firstToggle.excluded === true);
  ok('toggle returns the normalized key list', firstToggle.keys.join('|') === 'right_side', firstToggle.keys);
  ok('a later read still returns the veto (survives a re-run)',
    readStreetViewExclusions(ADDRESS).join('|') === 'right_side', readStreetViewExclusions(ADDRESS));
  // The whole point: re-running with the remembered list must not re-admit it.
  const rerun = buildSidingPhotoList({
    elevationImages: FRAMES,
    housePhotos: [],
    excludedStreetViewKeys: readStreetViewExclusions(ADDRESS),
  });
  ok('the re-run does not silently bring the bad frame back',
    !rerun.allPhotos.some(p => p.label === 'Right Side'), rerun.allPhotos.map(p => p.label));
  ok('address keys are case/whitespace insensitive',
    streetViewAddressKey('  812 MAPLE   Grove Ct, Dublin, OH 43017 ') === streetViewAddressKey(ADDRESS));
  ok('a differently-cased address reads the same veto',
    readStreetViewExclusions('812 MAPLE GROVE CT, DUBLIN, OH 43017').join('|') === 'right_side',
    readStreetViewExclusions('812 MAPLE GROVE CT, DUBLIN, OH 43017'));

  /* ─── [6] un-vetoing restores the frame and clears storage ─────────────── */
  console.log('\n[6] Un-vetoing restores the frame and leaves no residue');
  const secondToggle = toggleStreetViewExclusion(ADDRESS, firstToggle.keys, FRAMES[1]);
  ok('toggle reports the frame as restored', secondToggle.excluded === false);
  ok('the key list is now empty', secondToggle.keys.length === 0, secondToggle.keys);
  ok('storage no longer holds the address', readStreetViewExclusions(ADDRESS).length === 0);
  const restored = buildSidingPhotoList({
    elevationImages: FRAMES,
    housePhotos: [],
    excludedStreetViewKeys: readStreetViewExclusions(ADDRESS),
  });
  ok('all 4 frames are submitted again', restored.allPhotos.length === 4, restored.allPhotos.length);

  /* ─── [7] vetoes do not leak across addresses ──────────────────────────── */
  console.log('\n[7] Vetoes are scoped to one property');
  writeStreetViewExclusions(ADDRESS, ['front']);
  writeStreetViewExclusions(OTHER_ADDRESS, ['back']);
  ok('address A keeps its own veto', readStreetViewExclusions(ADDRESS).join('|') === 'front',
    readStreetViewExclusions(ADDRESS));
  ok('address B keeps its own veto', readStreetViewExclusions(OTHER_ADDRESS).join('|') === 'back',
    readStreetViewExclusions(OTHER_ADDRESS));
  ok('an unknown address has no vetoes', readStreetViewExclusions('nowhere at all').length === 0);
  ok('storage is a single namespaced key',
    rawStore.has('aiEstimatorExcludedStreetViewFrames'), [...rawStore.keys()]);
  // A missing address must never throw or write a blank bucket.
  ok('a blank address returns no vetoes', readStreetViewExclusions('').length === 0);
  writeStreetViewExclusions('', ['front']);
  ok('a blank address writes nothing',
    !JSON.parse(rawStore.get('aiEstimatorExcludedStreetViewFrames')).hasOwnProperty(''),
    rawStore.get('aiEstimatorExcludedStreetViewFrames'));

  /* ─── [8] AIEstimator applies the veto everywhere it matters ───────────── */
  console.log('\n[8] AIEstimator applies the veto in every submission path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'AIEstimator.jsx'), 'utf8');

  ok('buildSidingPhotoList (Photos+Satellite path) receives the exclusion list',
    /buildSidingPhotoList\(\{[\s\S]{0,400}?excludedStreetViewKeys: excludedStreetViewFramesRef\.current/.test(page));
  ok('handleAnalyzePhotos filters Street View frames before submitting',
    /\.filter\(img => !excludedSvKeys\.has\(streetViewFrameKey\(img\)\)\)/.test(page));
  // A stale state closure would re-run with the previous list and show numbers
  // that still include the frame the estimator just rejected.
  ok('the analysis paths read the ref, not the state closure',
    (page.match(/excludedStreetViewFramesRef\.current/g) || []).length >= 3,
    (page.match(/excludedStreetViewFramesRef\.current/g) || []).length);
  ok('a veto re-runs the siding measurement',
    /const rerunSidingMeasurementAfterExclusion = async \(\) => \{/.test(page)
    && /await rerunSidingMeasurementAfterExclusion\(\)/.test(page));
  ok('the re-run covers both the satellite and the photo path',
    /rerunSidingMeasurementAfterExclusion[\s\S]{0,700}?handleAnalyzeSiding\(undefined, \{ autoBuild: false \}\)/.test(page)
    && /rerunSidingMeasurementAfterExclusion[\s\S]{0,900}?await handleAnalyzePhotos\(\)/.test(page));
  ok('vetoed frames are not filed as the estimate evidence',
    /availableStreetViews = elevationImages[\s\S]{0,220}?excludedStreetViewKeys\.has\(streetViewFrameKey\(img\)\)/.test(page));
  ok('the veto is re-hydrated from storage when the address changes',
    /readStreetViewExclusions\(satelliteAddress\?\.address\)/.test(page));

  /* ─── [9] the UI separates who made the call ───────────────────────────── */
  console.log('\n[9] Excluded frames are visually distinct from auto-skipped frames');
  ok('a Street View thumbnail panel exists',
    page.includes('data-testid="panel-street-view-frames"'));
  ok('each thumbnail has an exclude control',
    /data-testid=\{`button-toggle-street-view-frame-\$\{frameKey\}`\}/.test(page));
  ok('the control calls the toggle handler',
    /onClick=\{\(\) => handleToggleStreetViewFrame\(img\)\}/.test(page));
  ok('tiles expose their provenance as three distinct states',
    /data-frame-state=\{!isUsable \? 'auto-skipped' : isExcluded \? 'user-excluded' : 'included'\}/.test(page));
  ok('auto-skipped frames read as skipped automatically',
    page.includes('Skipped automatically'));
  ok('estimator-excluded frames read as excluded by you',
    page.includes('Excluded by you'));
  ok('the two states use different tile styling',
    /border-dashed border-gray-300 bg-gray-100/.test(page) && /border-amber-400 bg-amber-50/.test(page));
  ok('the exclude control is hidden on frames with no coverage',
    /\{isUsable && \(\s*<button/.test(page));

  /* ─── summary ──────────────────────────────────────────────────────────── */
  console.log(`\n[test-street-view-frame-exclusion] ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
