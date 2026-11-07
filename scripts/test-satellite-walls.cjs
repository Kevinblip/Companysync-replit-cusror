#!/usr/bin/env node
/**
 * Satellite-only wall helpers. No network, no bench houses.
 *
 *   node scripts/test-satellite-walls.cjs
 */
'use strict';

const {
  eaveFromSolarSegments,
  storiesForEave,
  openingStoryCount,
  defaultOpenings,
  applyMasonryAndOpenings,
  sidingOutsideCorners,
  gutterFromSolarEdges,
  fetchGroundElevationM,
  SAT_EAVE_MIN_FT,
  SAT_EAVE_MAX_FT,
} = require('../db/satellite-walls.cjs');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function ok(label, cond, got, expected) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    const detail = got !== undefined
      ? ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`
      : '';
    console.log(`  ✗ ${label}${detail}`);
    failed++;
  }
}

function plane({ pitch, area, groundArea, center, sw, ne }) {
  return {
    pitchDegrees: pitch,
    planeHeightAtCenterMeters: center,
    stats: { areaMeters2: area, groundAreaMeters2: groundArea },
    boundingBox: { sw, ne },
  };
}

console.log('\n── eave from Solar plane height ──');
{
  // 45° plane, center 6 m above ground, 8 m × 4 m box, 32 m² horizontal.
  // depth = 32 / 8 = 4 m. raw = (6 − 2) × 3.28084 = 13.123 ft → 13.0.
  const dlat = 4 / 111320;
  const dlon = 8 / 111320;
  const eave = eaveFromSolarSegments([
    plane({
      pitch: 45,
      area: 45.25,
      groundArea: 32,
      center: 106,
      sw: { latitude: 0, longitude: 0 },
      ne: { latitude: dlat, longitude: dlon },
    }),
  ], 100);
  ok('eave is 13 ft', eave && eave.eave_ft === 13, eave && eave.eave_ft, 13);
  ok('raw eave is about 13.1 ft', eave && Math.abs(eave.raw_eave_ft - 13.1) < 0.15, eave && eave.raw_eave_ft, 13.1);
  ok('an in-range eave is not clamped', eave && eave.clamped === false, eave && eave.clamped, false);
}

{
  const eave = eaveFromSolarSegments([
    plane({
      pitch: 18,
      area: 20,
      groundArea: 19,
      center: 101,
      sw: { latitude: 40, longitude: -80 },
      ne: { latitude: 40.0002, longitude: -79.9998 },
    }),
  ], 100);
  ok('a short plane clamps to 8.5 ft', eave && eave.eave_ft === SAT_EAVE_MIN_FT && eave.clamped === true, eave, SAT_EAVE_MIN_FT);
}

{
  const eave = eaveFromSolarSegments([
    plane({
      pitch: 30,
      area: 40,
      groundArea: 34,
      center: 140,
      sw: { latitude: 40, longitude: -80 },
      ne: { latitude: 40.0004, longitude: -79.9996 },
    }),
  ], 100);
  ok('a tall plane clamps to 21 ft', eave && eave.eave_ft === SAT_EAVE_MAX_FT && eave.clamped === true, eave && eave.eave_ft, SAT_EAVE_MAX_FT);
}

ok('a flat plane is ignored', eaveFromSolarSegments([
  plane({
    pitch: 4, area: 30, groundArea: 30, center: 110,
    sw: { latitude: 0, longitude: 0 }, ne: { latitude: 0.001, longitude: 0.001 },
  }),
], 100) === null);
ok('missing ground returns null', eaveFromSolarSegments([], null) === null);

console.log('\n── story bands ──');
ok('16 ft is two stories', storiesForEave(16) === 2, storiesForEave(16), 2);
ok('just under 16 is 1.5', storiesForEave(15.9) === 1.5, storiesForEave(15.9), 1.5);
ok('12.5 ft is 1.5', storiesForEave(12.5) === 1.5, storiesForEave(12.5), 1.5);
ok('just under 12.5 is one story', storiesForEave(12.4) === 1, storiesForEave(12.4), 1);
ok('a split tap lifts a one-story eave to 1.5 for openings', openingStoryCount(1, { front: { stories: 'split' } }) === 1.5);
ok('a two-story tap lifts the opening count to 2', openingStoryCount(1, { left_side: { stories: 2 } }) === 2);

console.log('\n── industry opening counts ──');
{
  const one = defaultOpenings({
    perimeterFt: 120,
    stories: 1,
    faceLengths: { front: 20, back: 20, left_side: 40, right_side: 40 },
  });
  // round(120/12) − 1 garage bay = 9 windows. Two 3×6'8" doors. No garage door.
  ok('one story, 120 ft: 9 windows', one.windows === 9, one.windows, 9);
  ok('two entry doors', one.doors === 2, one.doors, 2);
  ok('window area is 15 sqft each', one.window_sqft === 9 * 15, one.window_sqft, 135);
  ok('door area is 20 sqft each', one.door_sqft === 40, one.door_sqft, 40);
  ok('opening area is windows plus doors', one.opening_sqft === 175, one.opening_sqft, 175);
  const windowSum = Object.values(one.by_face).reduce((sum, face) => sum + face.windows, 0);
  ok('per-wall window counts add up', windowSum === 9, windowSum, 9);
  ok('the long walls get more windows than the short walls',
    one.by_face.left_side.windows > one.by_face.front.windows,
    one.by_face, null);
  ok('doors sit on the front and the back', one.by_face.front.doors === 1 && one.by_face.back.doors === 1);
  const two = defaultOpenings({ perimeterFt: 120, stories: 2 });
  // 9 first-floor + round(120/16) = 9 + 8 = 17
  ok('two stories add one window per 16 ft', two.windows === 17, two.windows, 17);
  const half = defaultOpenings({ perimeterFt: 120, stories: 1.5 });
  // 9 + round(0.5 * 120/16) = 9 + 4 = 13
  ok('a half story adds half an upper floor', half.windows === 13, half.windows, 13);
  const empty = defaultOpenings({ perimeterFt: 0, stories: 2 });
  ok('no perimeter means no openings', empty.windows === 0 && empty.doors === 0 && empty.opening_sqft === 0);
  const confirmedOne = defaultOpenings({
    perimeterFt: 120,
    stories: 2,
    faceLengths: { front: 20, back: 20, left_side: 40, right_side: 40 },
    faceStories: {
      front: { stories: 1 },
      back: { stories: 1 },
      left_side: { stories: 1 },
      right_side: { stories: 1 },
    },
  });
  ok('a confirmed one-story house does not keep the two-story window count', confirmedOne.windows === 9, confirmedOne.windows, 9);
  const mixed = defaultOpenings({
    perimeterFt: 120,
    stories: 1,
    faceLengths: { front: 20, back: 20, left_side: 40, right_side: 40 },
    faceStories: {
      front: { stories: 2 },
      back: { stories: 1 },
      left_side: { stories: 1 },
      right_side: { stories: 1 },
    },
  });
  ok('only the two-story wall adds an upper bay', mixed.windows === 10, mixed.windows, 10);
  ok('the two-story wall keeps its story count', mixed.by_face.front.stories === 2, mixed.by_face.front, 2);
  ok('the other walls stay one story', mixed.by_face.back.stories === 1 && mixed.by_face.left_side.stories === 1);
}

console.log('\n── masonry comes out of the siding ──');
{
  const lengths = { front: 20, back: 20, left_side: 40, right_side: 40 };
  const eaves = { front: 10, back: 10, left_side: 10, right_side: 10 };
  const open = applyMasonryAndOpenings({
    grossSqft: 1200,
    bodySqft: 1200,
    faceLengths: lengths,
    eaves,
    gableEnds: [],
    openingSqft: 120,
    masonryFaces: {},
  });
  ok('no masonry: net = gross − openings', open.net === 1080, open.net, 1080);
  ok('no masonry deduction', open.masonrySqft === 0, open.masonrySqft, 0);
  const brickFront = applyMasonryAndOpenings({
    grossSqft: 1200,
    bodySqft: 1200,
    faceLengths: lengths,
    eaves,
    gableEnds: ['front', 'back'],
    openingSqft: 120,
    masonryFaces: { front: true },
  });
  // Front is 20/120 of the body = 200. Openings stay on the other 1000/1200.
  ok('a brick front is 200 sqft', Math.round(brickFront.masonrySqft) === 200, brickFront.masonrySqft, 200);
  ok('openings on the sided walls are 100 sqft', Math.round(brickFront.openingOnSiding) === 100, brickFront.openingOnSiding, 100);
  ok('net = gross − masonry − openings on siding', Math.round(brickFront.net) === 900, brickFront.net, 900);
  const allBrick = applyMasonryAndOpenings({
    grossSqft: 1200,
    bodySqft: 1200,
    faceLengths: lengths,
    eaves,
    openingSqft: 120,
    masonryFaces: ['front', 'back', 'left_side', 'right_side'],
  });
  ok('a fully masonry house bills no siding', allBrick.net === 0, allBrick.net, 0);
  ok('openings on masonry are not deducted from siding', allBrick.openingOnSiding === 0, allBrick.openingOnSiding, 0);
  const halfFront = applyMasonryAndOpenings({
    grossSqft: 1200,
    bodySqft: 1200,
    faceLengths: lengths,
    eaves,
    gableEnds: [],
    openingSqft: 120,
    masonryFaces: { front: 'half' },
  });
  ok('half of the front is 100 sqft of masonry', Math.round(halfFront.masonrySqft) === 100, halfFront.masonrySqft, 100);
  ok('openings scale to the siding that remains', Math.round(halfFront.openingOnSiding) === 110, halfFront.openingOnSiding, 110);
  ok('net removes the half share and the openings on siding', Math.round(halfFront.net) === 990, halfFront.net, 990);
  ok('a half share is not an all-masonry side', halfFront.masonryFaces.length === 0 && halfFront.masonryChoices.front === 'half', halfFront.masonryChoices, 'half');
  const quarter = applyMasonryAndOpenings({
    grossSqft: 1200,
    bodySqft: 1200,
    faceLengths: lengths,
    eaves,
    openingSqft: 0,
    masonryFaces: { left_side: 'quarter', right_side: 0.75 },
  });
  // Left is 40/120 of 1200 = 400, quarter = 100. Right is 400, three quarters = 300.
  ok('quarter and three-quarter shares add', Math.round(quarter.masonrySqft) === 400, quarter.masonrySqft, 400);
}

console.log('\n── corners drop against a masonry side ──');
{
  ok('unmarked walls keep the footprint corners', sidingOutsideCorners({
    masonryFaces: {},
    eaves: { front: 10, back: 10, left_side: 10, right_side: 10 },
    geometricCount: 4,
  }) === null);
  const front = sidingOutsideCorners({
    masonryFaces: { front: true },
    eaves: { front: 10, back: 10, left_side: 10, right_side: 10 },
    geometricCount: 4,
    geometricInsideCount: 0,
    geometricInsideLf: 0,
  });
  ok('one masonry side drops its two corners', front.outside_count === 2, front.outside_count, 2);
  ok('the remaining corner boards are 20 lf', front.outside_lf === 20, front.outside_lf, 20);
  const all = sidingOutsideCorners({
    masonryFaces: { front: true, back: true, left_side: true, right_side: true },
    eaves: { front: 16, back: 16, left_side: 16, right_side: 16 },
    geometricCount: 4,
  });
  ok('masonry on every side drops every corner', all.outside_count === 0 && all.outside_lf === 0, all, 0);
  const wing = sidingOutsideCorners({
    masonryFaces: { front: true },
    eaves: { front: 10, back: 10, left_side: 10, right_side: 10 },
    geometricCount: 8,
  });
  ok('extra footprint corners scale with the sided corners', wing.outside_count === 4, wing.outside_count, 4);
  const quarter = sidingOutsideCorners({
    masonryFaces: { front: 'quarter' },
    eaves: { front: 16, back: 16, left_side: 16, right_side: 16 },
    geometricCount: 4,
  });
  ok('a quarter share keeps every corner', quarter.outside_count === 4, quarter.outside_count, 4);
  ok('a quarter share bills the taller siding height', quarter.outside_lf === 64, quarter.outside_lf, 64);
  const halfHouse = sidingOutsideCorners({
    masonryFaces: { front: 'half', back: 'half', left_side: 'half', right_side: 'half' },
    eaves: { front: 10, back: 10, left_side: 10, right_side: 10 },
    geometricCount: 4,
  });
  ok('half masonry on every side keeps the corner count', halfHouse.outside_count === 4, halfHouse.outside_count, 4);
  ok('those corners are the siding-covered height', halfHouse.outside_lf === 20, halfHouse.outside_lf, 20);
}

console.log('\n── gutters use the level outline when the labeled eave is short ──');
{
  const short = gutterFromSolarEdges({ facetEaveLf: 211.1, levelBoundaryLf: 343, fallbackLf: 176 });
  ok('a labeled eave under 70% of the level outline uses the outline', short.gutter_lf === 343 && short.gutter_source === 'roof_level_outline', short, 343);
  const covered = gutterFromSolarEdges({ facetEaveLf: 92.3, levelBoundaryLf: 112, fallbackLf: 92 });
  ok('a labeled eave that already covers the outline is kept', covered.gutter_lf === 92 && covered.gutter_source === 'roof_facet_eave', covered, 92);
  const unlabeled = gutterFromSolarEdges({ facetEaveLf: 0, levelBoundaryLf: 80, fallbackLf: 40 });
  ok('an unlabeled level outline is the gutter', unlabeled.gutter_lf === 80 && unlabeled.gutter_source === 'roof_level_outline', unlabeled, 80);
  const none = gutterFromSolarEdges({ facetEaveLf: 0, levelBoundaryLf: 0, fallbackLf: 64.2 });
  ok('no solar edges fall back to the footprint eave', none.gutter_lf === 64 && none.gutter_source === 'footprint_fallback', none, 64);
}

console.log('\n── USGS client uses the injected fetch ──');
(async () => {
  const elevation = await fetchGroundElevationM(40, -80, {
    fetchImpl: async (url) => {
      ok('query uses the free USGS point service', String(url).includes('epqs.nationalmap.gov'));
      ok('query does not call Street View', !String(url).includes('streetview'));
      return { ok: true, json: async () => ({ value: 212.5 }) };
    },
  });
  ok('elevation is the USGS value', elevation === 212.5, elevation, 212.5);
  let threw = false;
  try {
    await fetchGroundElevationM(40, -80, {
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
  } catch (err) {
    threw = true;
  }
  ok('a failed USGS response throws', threw);
  threw = false;
  try {
    await fetchGroundElevationM(40, -80, {
      fetchImpl: async () => ({ ok: true, json: async () => ({ value: -999 }) }),
    });
  } catch (err) {
    threw = true;
  }
  ok('an impossible elevation throws', threw);

  console.log('\n── satellite handler wiring ──');
  const plugin = fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
  const start = plugin.indexOf('async analyzeSidingMeasurement(');
  const end = plugin.indexOf('async analyzeHousePhotosForSiding(');
  const body = plugin.slice(start, end);
  ok('handler found', start > 0 && end > start);
  ok('handler loads satellite wall helpers', body.includes("_satWalls"));
  ok('handler accepts confirmed face heights', body.includes('confirmed_face_heights'));
  ok('handler accepts masonry faces', body.includes('masonry_faces'));
  ok('handler falls back to Microsoft footprints', body.includes('fetchMicrosoftBuildingsNear'));
  ok('pitch string is still computed for the roof', body.includes('const pitchStr ='));
  ok('labeled solar eave still feeds fascia', body.includes('const eaveLfRaw = hasFacetEdges ? roofEdgeTotals.eave'));
  ok('gutters use the level outline helper', body.includes('gutterFromSolarEdges'));
  ok('this handler does not rewrite the roof report eave', !body.includes('eaveLf = reconciliation.linears.eave_lf'));
  ok('solar pitch multiplier is unchanged', body.includes('solar_pitch_multiplier: Math.round(pitchMultiplier * 1000) / 1000'));
  ok('photo handler is outside this slice', !body.includes('async analyzeHousePhotosForSiding'));
  const photo = plugin.slice(end, end + 500);
  ok('photo handler is still next', photo.includes('async analyzeHousePhotosForSiding'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
