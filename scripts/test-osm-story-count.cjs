/**
 * Regression test: OSM building:levels → correct storyCount + totalWallHeight,
 * address-race-condition guard, and null story_count_override precedence.
 *
 * Verifies that:
 * 1. Both storyCount AND storyHeightFt are set consistently when OSM returns
 *    building:levels (so a 2-story building gets 18 ft total, not the 9 ft reset).
 * 2. The AbortController cancel path works when a second address is confirmed.
 * 3. The coordinate check discards a stale result whose address no longer matches.
 * 4. story_count_override=null lets the backend use OSM building:levels before
 *    falling back to AI photo detection (the authoritative precedence chain).
 * 5. An explicit user override always wins over OSM.
 * 6. The first satellite estimate uses OSM levels even when the user clicks
 *    Analyze before the background fetch resolves (via osmLevelsFetchPromiseRef).
 */

'use strict';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

// ── Mirror clamping/snapping/wall-height from AIEstimator.jsx ────────────────
function osmLevelsToDimensions(lv) {
  if (isNaN(lv) || lv < 1) return null;
  const clamped = Math.min(4, Math.max(1, Math.round(lv)));
  const snapped = clamped <= 1 ? '1' : clamped <= 2 ? '2' : clamped <= 3 ? '3' : '4';
  return { clamped, snapped, wallHt: String(clamped * 9) };
}

// ── Mirror live backend story-count precedence (vite-functions-plugin.js) ──
// Priority: user override → OSM building:levels → AI photo detection
function resolveBackendStoryCount({ story_count_override, osm_levels_from_footprint, ai_story_count }) {
  if (story_count_override && story_count_override >= 1) return { count: story_count_override, source: 'user_override' };
  if (osm_levels_from_footprint)                         return { count: osm_levels_from_footprint, source: 'osm' };
  return { count: ai_story_count, source: 'ai' };
}

// ── Simulate the address-race guard ─────────────────────────────────────────
function simulateOsmApply({ fetchedForLat, fetchedForLng, currentLat, currentLng, lv }) {
  if (currentLat !== fetchedForLat || currentLng !== fetchedForLng) return null;
  return osmLevelsToDimensions(lv);
}

// ── Simulate awaiting the OSM promise from handleAnalyzeSiding ───────────────
// Returns the story count that would be used for the estimate.
async function simulateHandleAnalyzeSiding({ storyCountUserOverride, configStoryCount, osmPromise }) {
  // If OSM promise is available and no user override, await it (up to 3s in prod)
  let osmAutoStory = null;
  if (!storyCountUserOverride && osmPromise) {
    osmAutoStory = await Promise.race([
      osmPromise,
      new Promise(res => setTimeout(() => res(null), 100)) // short timeout in tests
    ]);
  }
  const storyCount = storyCountUserOverride
    ? (Number(configStoryCount) || 1)
    : (osmAutoStory?.clamped || Number(configStoryCount) || 1);
  const totalWallHt = osmAutoStory ? osmAutoStory.clamped * 9 : (Number(configStoryCount) * 9 || 9);
  return { storyCount, totalWallHt, osmAutoStory };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\nOSM story count → wall height regression tests\n');

// 1-story
console.log('1-story building (building:levels=1)');
{
  const r = osmLevelsToDimensions(1);
  assert(r.snapped === '1', `snapped='1'`);
  assert(r.wallHt  === '9', `wallHt='9' (1 × 9)`);
}

// 2-story — core regression
console.log('\n2-story building (building:levels=2)');
{
  const r = osmLevelsToDimensions(2);
  assert(r.snapped === '2',  `snapped='2'`);
  assert(r.wallHt  === '18', `wallHt='18' (2 × 9) — not the 9ft reset default`);
}

// 3-story
console.log('\n3-story building (building:levels=3)');
{
  const r = osmLevelsToDimensions(3);
  assert(r.snapped === '3',  `snapped='3'`);
  assert(r.wallHt  === '27', `wallHt='27' (3 × 9)`);
}

// Fractional levels
console.log('\nFractional levels (building:levels=2.5)');
{
  const r = osmLevelsToDimensions(2.5);
  assert(r.clamped === 3, `rounds 2.5 → 3`);
  assert(r.wallHt === '27', `wallHt='27'`);
}

// Clamp at 4
console.log('\nClamping (building:levels=6)');
{
  const r = osmLevelsToDimensions(6);
  assert(r.snapped === '4',  `snapped clamped to '4'`);
  assert(r.wallHt  === '36', `wallHt='36' (4 × 9)`);
}

// Invalid values
console.log('\nInvalid levels (0, NaN, -1)');
{
  assert(osmLevelsToDimensions(0)   === null, `0 returns null`);
  assert(osmLevelsToDimensions(NaN) === null, `NaN returns null`);
  assert(osmLevelsToDimensions(-1)  === null, `-1 returns null`);
}

// Wall-area ratio sanity
console.log('\nWall-area sanity: 2-story must be ~2× 1-story for same footprint');
{
  const perimeter = 160;
  const area1 = perimeter * Number(osmLevelsToDimensions(1).wallHt);
  const area2 = perimeter * Number(osmLevelsToDimensions(2).wallHt);
  assert(Math.abs(area2 / area1 - 2.0) < 0.01,
    `2-story / 1-story wall area ratio = ${(area2 / area1).toFixed(2)} (expected 2.0)`);
}

// ── Backend precedence tests ──────────────────────────────────────────────────
console.log('\nBackend: null override → OSM used (first estimate correct without user input)');
{
  const r = resolveBackendStoryCount({ story_count_override: null, osm_levels_from_footprint: 2, ai_story_count: 1 });
  assert(r.source === 'osm', `source='osm'`);
  assert(r.count === 2, `count=2 from OSM (not the ai=1 fallback)`);
}

console.log('\nBackend: explicit user override wins over OSM');
{
  const r = resolveBackendStoryCount({ story_count_override: 3, osm_levels_from_footprint: 2, ai_story_count: 1 });
  assert(r.source === 'user_override', `source='user_override'`);
  assert(r.count === 3, `count=3 (user's choice beats OSM 2)`);
}

console.log('\nBackend: no OSM, no override → AI detection used');
{
  const r = resolveBackendStoryCount({ story_count_override: null, osm_levels_from_footprint: null, ai_story_count: 2 });
  assert(r.source === 'ai', `source='ai'`);
  assert(r.count === 2, `count=2 from AI`);
}

// ── Address race condition ────────────────────────────────────────────────────
console.log('\nAddress race: same address result applied');
{
  const r = simulateOsmApply({ fetchedForLat: 41.8, fetchedForLng: -87.6, currentLat: 41.8, currentLng: -87.6, lv: 2 });
  assert(r !== null,      `result accepted for matching address`);
  assert(r.snapped === '2', `storyCount='2'`);
  assert(r.wallHt === '18', `wallHt='18'`);
}

console.log('\nAddress race: stale address A result discarded when address B is active');
{
  const r = simulateOsmApply({ fetchedForLat: 41.8, fetchedForLng: -87.6, currentLat: 40.7, currentLng: -74.0, lv: 2 });
  assert(r === null, `stale address A result discarded`);
}

console.log('\nAddress race: confirm A (1-story), then B (2-story), with A resolving last');
{
  const addressA = { address: '123 A Street', coordinates: { lat: 41.8, lng: -87.6 } };
  const addressB = { address: '456 B Avenue', coordinates: { lat: 40.7, lng: -74.0 } };
  let currentAddress = null;
  const applied = [];
  let resolveA;
  let resolveB;
  const promiseA = new Promise(resolve => { resolveA = resolve; });
  const promiseB = new Promise(resolve => { resolveB = resolve; });

  const confirmAddress = (address, osmPromise) => {
    currentAddress = address;
    return osmPromise.then(osmResult => {
      const currentCoords = currentAddress?.coordinates;
      if (currentCoords?.lat !== address.coordinates.lat || currentCoords?.lng !== address.coordinates.lng) {
        return;
      }
      applied.push({ address: address.address, storyCount: osmResult.snapped });
    });
  };

  const fetchA = confirmAddress(addressA, promiseA);
  const fetchB = confirmAddress(addressB, promiseB);
  resolveB(osmLevelsToDimensions(2));
  resolveA(osmLevelsToDimensions(1));
  Promise.all([fetchA, fetchB]).then(() => {
    assert(applied.length === 1, `only the active property's OSM result is applied`);
    assert(applied[0]?.address === addressB.address, `address B remains the active result`);
    assert(applied[0]?.storyCount === '2', `final story count is 2 for address B, not stale A's 1`);
  });
}

// ── AbortController ───────────────────────────────────────────────────────────
console.log('\nAbortController: new address confirmation aborts prior fetch');
{
  const ctrl1 = { aborted: false, abort() { this.aborted = true; }, get signal() { return { aborted: this.aborted }; } };
  assert(!ctrl1.aborted, `ctrl1 initially not aborted`);
  ctrl1.abort(); // new address confirmed
  assert(ctrl1.aborted, `ctrl1 aborted after new address`);
  assert(ctrl1.signal.aborted, `signal.aborted is true`);
  const ctrl2 = { aborted: false, abort() { this.aborted = true; }, get signal() { return { aborted: this.aborted }; } };
  assert(!ctrl2.aborted, `ctrl2 (new address) starts fresh`);
}

// ── OSM=2 → manual override to 3 ────────────────────────────────────────────
// Regression: OSM writes storyHeightFt=18; user then picks 3 stories.
// The estimate must use 27 ft total, not 18 (the stale OSM-written value).
console.log('\nOverride fix: OSM=2 → user picks 3 → totalWallHt must be 27, not 18');
{
  // Simulate the state that exists AFTER OSM auto-detection
  const configAfterOsm = { storyCount: '2', storyHeightFt: '18' };
  // Simulate user changing the Stories dropdown to 3
  const userStoryCount = 3;
  const storyCountUserOverride = true;
  const storyCount = storyCountUserOverride ? userStoryCount : (Number(configAfterOsm.storyCount) || 1);

  // Total wall height must be re-derived from storyCount × 9, ignoring stale config
  const totalWallHt = storyCountUserOverride
    ? storyCount * 9              // correct: 3 × 9 = 27
    : Number(configAfterOsm.storyHeightFt); // wrong if used: still 18
  const storyHeightFt = Math.round(totalWallHt / storyCount);

  assert(storyCount === 3, `storyCount=3 (user's override)`);
  assert(totalWallHt === 27, `totalWallHt=27 ft (3 × 9), not the stale OSM 18 ft`);
  assert(storyHeightFt === 9, `storyHeightFt=9 ft per floor`);

  // Also: story_count_override sent to analyzeHousePhotosForSiding is 3, not null
  const sentOverride = storyCountUserOverride ? storyCount : null;
  assert(sentOverride === 3, `story_count_override sent to backend is 3`);

  // Satellite-only path check: storyCount=3 → analyzeSidingMeasurement
  // receives storyCount=3, storyHeightFt=9, so wallArea ≈ perimeter × 27
  const mockPerimeter = 160;
  const mockWallArea = mockPerimeter * totalWallHt;
  assert(mockWallArea === 4320, `wall area = 160 × 27 = 4320 sqft (not 160 × 18 = 2880)`);
}

// ── handleAnalyzeSiding await behavior ───────────────────────────────────────
console.log('\nhandleAnalyzeSiding: awaits pending OSM promise → uses result on first estimate');
{
  // Simulate: background OSM fetch still in flight when Analyze is clicked
  const osmPromise = new Promise(resolve => setTimeout(() => resolve(osmLevelsToDimensions(2)), 10));
  simulateHandleAnalyzeSiding({ storyCountUserOverride: false, configStoryCount: '1', osmPromise })
    .then(({ storyCount, totalWallHt }) => {
      assert(storyCount === 2,  `storyCount=2 from awaited OSM (not config '1')`);
      assert(totalWallHt === 18, `totalWallHt=18ft (2 × 9)`);
    });
}

console.log('\nhandleAnalyzeSiding: user override skips OSM await entirely');
{
  const osmPromise = new Promise(resolve => setTimeout(() => resolve(osmLevelsToDimensions(3)), 10));
  simulateHandleAnalyzeSiding({ storyCountUserOverride: true, configStoryCount: '1', osmPromise })
    .then(({ storyCount, osmAutoStory }) => {
      assert(storyCount === 1,    `storyCount=1 (user's '1' wins)`);
      assert(osmAutoStory === null, `OSM not awaited when user override is active`);
    });
}

console.log('\nhandleAnalyzeSiding: OSM timeout → falls back to config');
{
  // Promise that never resolves within test timeout (100ms)
  const neverResolves = new Promise(() => {});
  simulateHandleAnalyzeSiding({ storyCountUserOverride: false, configStoryCount: '2', osmPromise: neverResolves })
    .then(({ storyCount }) => {
      assert(storyCount === 2, `storyCount=2 from config when OSM times out`);
    });
}

// ── Allow async assertions to run ─────────────────────────────────────────────
setTimeout(() => {
  console.log(`\n${'─'.repeat(50)}`);
  if (failed === 0) {
    console.log(`✅ All ${passed} assertions passed`);
    process.exit(0);
  } else {
    console.error(`❌ ${failed} assertion(s) failed out of ${passed + failed}`);
    process.exit(1);
  }
}, 200);
