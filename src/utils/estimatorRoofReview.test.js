import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildingsFromGeoJsonl,
  enforceMicrosoftFootprintCacheCap,
  parseFootprintIndex,
  quadkeyFor,
  resetMicrosoftFootprintCache,
  fetchMicrosoftBuildingsNear,
  microsoftFootprintCacheDir,
  MICROSOFT_FOOTPRINT_CACHE_MAX_BYTES,
  MICROSOFT_FOOTPRINT_TIMEOUT_MS,
} from '../../functions/utils/microsoftBuildingFootprints.js';
import { areaWeightedPitchMode } from '../../functions/utils/roofPitch.js';
import { assessRoofReview, REP_REVIEW_ASK, roofShortForWalls } from '../../functions/utils/roofReview.js';
import { pitchOnBuilding, selectAddressBuilding, selectTargetBuilding } from '../../functions/utils/roofFootprintArea.js';

function rect(lat, lng, halfNsM, halfEwM) {
  const dLat = halfNsM / 111320;
  const dLng = halfEwM / (111320 * Math.cos(lat * Math.PI / 180));
  return [
    { lat: lat - dLat, lon: lng - dLng },
    { lat: lat - dLat, lon: lng + dLng },
    { lat: lat + dLat, lon: lng + dLng },
    { lat: lat + dLat, lon: lng - dLng },
  ];
}

function way(geometry, tags = {}) {
  return { el: { geometry, tags } };
}

const HANOVER = { lat: 41.535238, lng: -81.565396 };
const BRUNSWICK = { lat: 41.535173, lng: -81.565540 };

describe('address building, not the biggest neighbor', () => {
  const hanover = way(rect(HANOVER.lat, HANOVER.lng, 8, 6), {
    building: 'yes',
    'addr:housenumber': '2051',
    'addr:street': 'Hanover Drive',
  });
  const brunswick = way(rect(BRUNSWICK.lat, BRUNSWICK.lng, 10, 8), {
    building: 'yes',
    'addr:housenumber': '917',
    'addr:street': 'Brunswick Road',
  });

  it('keeps 2051 Hanover when 917 Brunswick is the larger building within 80 m', () => {
    const selected = selectAddressBuilding(
      [brunswick, hanover],
      HANOVER.lat,
      HANOVER.lng,
      { address: '2051 Hanover Rd, Cleveland Heights, OH 44112' },
    );
    expect(selected.method).toBe('address_tag');
    expect(selected.building).toBe(hanover);
  });

  it('does not adopt a neighbor when the address itself has no outline', () => {
    const selected = selectAddressBuilding(
      [brunswick],
      HANOVER.lat,
      HANOVER.lng,
      { address: '2051 Hanover Rd' },
    );
    expect(selected.building).toBeNull();
    expect(selected.method).toBe('none');
  });

  it('uses the polygon that contains the pin when the ways are untagged', () => {
    const house = way(rect(41.5, -81.55, 8, 6));
    const school = way(rect(41.504, -81.56, 40, 40));
    const selected = selectAddressBuilding([school, house], 41.50002, -81.55002, { address: '' });
    expect(selected.method).toBe('contains_point');
    expect(selected.building).toBe(house);
  });

  it('uses the building under the pin for an outbuilding, not the Solar centroid', () => {
    const house = way(rect(41.5, -81.55, 12, 10), {
      building: 'house',
      'addr:housenumber': '20',
      'addr:street': 'Black Avenue',
    });
    // 24 m north of the house, about 548 sq ft. The pin sits on it.
    // Solar's centroid stays on the house.
    const garageLat = 41.5 + (24 / 111320);
    const garage = way(rect(garageLat, -81.55, 4.2, 3.05), { building: 'yes' });
    const solarCentroid = { lat: 41.5, lng: -81.55 };
    const outbuilding = selectTargetBuilding([house, garage], garageLat, -81.55, {
      address: '20 Black Ave',
      structureType: 'garage',
      solarCentroid,
    });
    expect(outbuilding.building).toBe(garage);
    expect(outbuilding.solarOnDifferentBuilding).toBe(true);
    const residence = selectTargetBuilding([house, garage], 41.5, -81.55, {
      address: '20 Black Ave',
      structureType: 'house',
      solarCentroid: { lat: garageLat, lng: -81.55 },
    });
    expect(residence.building).toBe(house);
    expect(residence.solarOnDifferentBuilding).toBe(true);
  });

  it('follows the pin when it sits on a different building than the Solar centroid', () => {
    const house = way(rect(41.5, -81.55, 12, 10), {
      building: 'house',
      'addr:housenumber': '20',
      'addr:street': 'Black Avenue',
    });
    const garageLat = 41.5 + (24 / 111320);
    const garage = way(rect(garageLat, -81.55, 4.2, 3.05), { building: 'yes' });
    const selected = selectTargetBuilding([house, garage], garageLat, -81.55, {
      address: '20 Black Ave',
      structureType: 'house',
      solarCentroid: { lat: 41.5, lng: -81.55 },
    });
    expect(selected.building).toBe(garage);
    expect(selected.solarOnDifferentBuilding).toBe(true);
  });
});

describe('rep review', () => {
  const houseFoot = {
    areaSqFt: 2200,
    containsPoint: true,
    method: 'contains_point',
    tags: { building: 'yes' },
  };

  it('flags a missing outline and does not call the estimate ready', () => {
    const review = assessRoofReview({
      latitude: 41.5,
      longitude: -81.5,
      address: '10 Walsh St',
      footprint: null,
      solarGroundSqFt: 900,
      segmentCount: 4,
      solarCentroid: { lat: 41.5, lng: -81.5 },
    });
    expect(review.needs_rep_review).toBe(true);
    expect(review.measurement_ready).toBe(false);
    expect(review.status).toBe('needs_rep_review');
    expect(review.reasons.map((reason) => reason.code)).toContain('no_footprint_at_address');
    expect(review.message).toContain('Needs rep review');
    expect(review.message).toContain(REP_REVIEW_ASK);
  });

  it('flags Solar centered on another building', () => {
    const review = assessRoofReview({
      latitude: 41.5,
      longitude: -81.55,
      address: '20 Black Ave',
      footprint: { areaSqFt: 700, containsPoint: true, method: 'contains_point', tags: { building: 'garage' } },
      solarGroundSqFt: 650,
      segmentCount: 2,
      solarCentroid: { lat: 41.5004, lng: -81.55 },
      largerNeighborRatio: 2.4,
    });
    const codes = review.reasons.map((reason) => reason.code);
    expect(codes).toContain('solar_centroid_far');
    expect(codes).toContain('not_main_residence');
    expect(review.measurement_ready).toBe(false);
  });

  it('flags a short Solar model and a two-plane model on a large outline', () => {
    const short = assessRoofReview({
      latitude: 41.52,
      longitude: -81.55,
      address: '2051 Hanover Rd',
      footprint: { areaSqFt: 3200, containsPoint: true, method: 'address_tag', tags: { building: 'yes', 'addr:housenumber': '2051' } },
      solarGroundSqFt: 1242,
      segmentCount: 7,
      solarCentroid: { lat: 41.52, lng: -81.55 },
    });
    expect(short.reasons.map((reason) => reason.code)).toContain('solar_smaller_than_footprint');

    const sparse = assessRoofReview({
      latitude: 41.52,
      longitude: -81.55,
      footprint: houseFoot,
      solarGroundSqFt: 1000,
      segmentCount: 2,
      solarCentroid: { lat: 41.52, lng: -81.55 },
    });
    expect(sparse.reasons.map((reason) => reason.code)).toContain('low_segment_count');
  });

  it('does not flag a roof whose slope already covers the outline', () => {
    const review = assessRoofReview({
      latitude: 41.5,
      longitude: -81.5,
      address: '8 Roesing Dr',
      footprint: { areaSqFt: 1000, containsPoint: true, method: 'address_tag', tags: { building: 'yes', 'addr:housenumber': '8' } },
      solarGroundSqFt: 700,
      solarSlopeSqFt: 930,
      pitchLabel: '7/12',
      segmentCount: 6,
      solarCentroid: { lat: 41.5, lng: -81.5 },
    });
    expect(review.reasons.map((reason) => reason.code)).not.toContain('solar_smaller_than_footprint');
    expect(review.needs_rep_review).toBe(false);
    expect(review.measurement_ready).toBe(true);
  });

  it('flags 77% coverage and leaves 88% ready', () => {
    const footprint = { areaSqFt: 2000, containsPoint: true, method: 'contains_point', tags: { building: 'yes' } };
    const gerhard = assessRoofReview({
      latitude: 41.5,
      longitude: -81.5,
      address: '12 Gerhard Dr',
      footprint,
      solarGroundSqFt: 1540,
      solarSlopeSqFt: 1100,
      pitchLabel: '6/12',
      segmentCount: 6,
      solarCentroid: { lat: 41.5, lng: -81.5 },
    });
    expect(gerhard.reasons.map((reason) => reason.code)).toContain('solar_smaller_than_footprint');
    expect(gerhard.message).toContain('77%');
    expect(gerhard.message).toContain(REP_REVIEW_ASK);
    expect(gerhard.measurement_ready).toBe(false);

    const accurate = assessRoofReview({
      latitude: 41.5,
      longitude: -81.5,
      address: '14 Accurate Dr',
      footprint,
      solarGroundSqFt: 1760,
      solarSlopeSqFt: 2000,
      pitchLabel: '6/12',
      segmentCount: 6,
      solarCentroid: { lat: 41.5, lng: -81.5 },
    });
    expect(accurate.needs_rep_review).toBe(false);
    expect(accurate.message).toBeNull();
  });

  it('puts a reason and a message on a footprint-times-pitch flag', () => {
    const review = assessRoofReview({
      latitude: 41.5,
      longitude: -81.5,
      address: '8 Roesing Dr',
      footprint: { areaSqFt: 1000, containsPoint: true, method: 'address_tag', tags: { building: 'yes', 'addr:housenumber': '8' } },
      solarGroundSqFt: 700,
      solarSlopeSqFt: 930,
      pitchLabel: '7/12',
      segmentCount: 6,
      solarCentroid: { lat: 41.5, lng: -81.5 },
      footprintPitchApplied: true,
    });
    expect(review.reasons.map((reason) => reason.code)).toContain('solar_smaller_than_footprint');
    expect(review.message).toContain('Needs rep review');
    expect(review.message).toContain(REP_REVIEW_ASK);
    expect(review.measurement_ready).toBe(false);
  });

  it('says the pin is a different building, not that Solar covers 153% of it', () => {
    const review = assessRoofReview({
      latitude: 41.5,
      longitude: -81.55,
      address: '20 Black Ave',
      footprint: { areaSqFt: 548, containsPoint: true, method: 'contains_point', tags: { building: 'yes' } },
      solarGroundSqFt: 838,
      solarSlopeSqFt: 1350,
      pitchLabel: '1/12',
      segmentCount: 6,
      solarCentroid: { lat: 41.50022, lng: -81.55 },
      footprintPitchApplied: true,
      solarOnDifferentBuilding: true,
      structureType: 'garage',
    });
    const codes = review.reasons.map((reason) => reason.code);
    expect(codes).toContain('solar_measured_other_building');
    expect(codes).not.toContain('solar_smaller_than_footprint');
    expect(review.message).toContain('different building');
    expect(review.message).toContain('Confirm the pitch');
    expect(review.message.match(/hand-trace/gi)).toHaveLength(1);
    expect(review.message).not.toContain(REP_REVIEW_ASK);
    expect(review.message).not.toMatch(/covers \d+% of the building outline/);
    expect(review.message).not.toContain('smaller than');
    expect(review.measurement_ready).toBe(false);
  });

  it('leaves an accurate house ready', () => {
    const review = assessRoofReview({
      latitude: 41.41,
      longitude: -81.46,
      address: '5688 Gemini Ct',
      footprint: {
        areaSqFt: 2100,
        containsPoint: true,
        method: 'address_tag',
        tags: { building: 'house', 'addr:housenumber': '5688' },
      },
      solarGroundSqFt: 2000,
      segmentCount: 4,
      solarCentroid: { lat: 41.41005, lng: -81.46 },
      largerNeighborRatio: 1.2,
    });
    expect(review.needs_rep_review).toBe(false);
    expect(review.measurement_ready).toBe(true);
    expect(review.message).toBeNull();
  });

  it('flags a satellite roof that is far too small for the measured walls', () => {
    const review = assessRoofReview({
      latitude: 41.535238,
      longitude: -81.565396,
      address: '2051 Hanover Rd',
      footprint: {
        areaSqFt: 1300,
        containsPoint: true,
        method: 'address_tag',
        tags: { building: 'yes', 'addr:housenumber': '2051' },
      },
      solarGroundSqFt: 1240,
      solarSlopeSqFt: 1438,
      billedRoofSqFt: 1438,
      pitchLabel: '7/12',
      segmentCount: 7,
      solarCentroid: { lat: 41.535238, lng: -81.565396 },
      wallAreaSqFt: 3600,
      storyCount: 2,
      storyHeightFt: 9,
    });
    expect(review.reasons.map((reason) => reason.code)).toContain('roof_short_for_walls');
    expect(review.needs_rep_review).toBe(true);
    expect(review.measurement_ready).toBe(false);
    expect(review.message).toContain('Needs rep review');
    expect(review.message).toContain(REP_REVIEW_ASK);
    expect(review.message).not.toContain('3997');
    expect(review.message).not.toContain('2,500');
    const gap = roofShortForWalls({
      roofSlopeSqFt: 1438,
      wallAreaSqFt: 3600,
      storyCount: 2,
      storyHeightFt: 9,
      pitchLabel: '7/12',
    });
    expect(gap.min_roof_sqft).not.toBe(1438);
    expect(gap.min_roof_sqft).not.toBe(2500);
    expect(gap.min_roof_sqft).not.toBe(3997);
  });

  it('leaves a roof that fits its walls ready, including a long narrow house', () => {
    const matching = assessRoofReview({
      latitude: 41.41,
      longitude: -81.46,
      address: '5688 Gemini Ct',
      footprint: {
        areaSqFt: 2100,
        containsPoint: true,
        method: 'address_tag',
        tags: { building: 'house', 'addr:housenumber': '5688' },
      },
      solarGroundSqFt: 2000,
      solarSlopeSqFt: 2371,
      billedRoofSqFt: 2371,
      pitchLabel: '5/12',
      segmentCount: 4,
      solarCentroid: { lat: 41.41005, lng: -81.46 },
      wallAreaSqFt: 3400,
      wallHeightFt: 18,
    });
    expect(matching.needs_rep_review).toBe(false);

    // 20 ft by 80 ft, two stories at 18 ft: a 4:1 house whose roof matches the plan.
    const longHouse = assessRoofReview({
      latitude: 41.41,
      longitude: -81.46,
      footprint: { areaSqFt: 1600, containsPoint: true, method: 'contains_point', tags: { building: 'yes' } },
      solarGroundSqFt: 1550,
      solarSlopeSqFt: 1789,
      billedRoofSqFt: 1789,
      pitchLabel: '6/12',
      segmentCount: 2,
      solarCentroid: { lat: 41.41, lng: -81.46 },
      wallAreaSqFt: 3600,
      wallHeightFt: 18,
    });
    expect(longHouse.reasons.map((reason) => reason.code)).not.toContain('roof_short_for_walls');
    expect(longHouse.needs_rep_review).toBe(false);
  });

  it('does not treat a full wall height as a per-story height', () => {
    const doubled = roofShortForWalls({
      roofSlopeSqFt: 1438,
      wallAreaSqFt: 3600,
      wallHeightFt: 18,
      storyCount: 2,
      storyHeightFt: 18,
      pitchLabel: '7/12',
    });
    const once = roofShortForWalls({
      roofSlopeSqFt: 1438,
      wallAreaSqFt: 3600,
      storyCount: 2,
      storyHeightFt: 9,
      pitchLabel: '7/12',
    });
    expect(doubled.wall_height_ft).toBe(once.wall_height_ft);
    expect(doubled).not.toBeNull();
  });

  it('does not flag a garage roof against an outbuilding request', () => {
    const review = assessRoofReview({
      footprint: { areaSqFt: 480, containsPoint: true, method: 'contains_point', tags: { building: 'garage' } },
      solarGroundSqFt: 460,
      solarSlopeSqFt: 520,
      billedRoofSqFt: 520,
      pitchLabel: '4/12',
      segmentCount: 2,
      solarCentroid: { lat: 41.5, lng: -81.5 },
      latitude: 41.5,
      longitude: -81.5,
      wallAreaSqFt: 3600,
      storyCount: 2,
      storyHeightFt: 9,
      structureType: 'garage',
    });
    expect(review.reasons.map((reason) => reason.code)).not.toContain('roof_short_for_walls');
  });

  it('does not flag a simple gable that fills its outline', () => {
    const review = assessRoofReview({
      latitude: 41.41,
      longitude: -81.46,
      footprint: { areaSqFt: 1600, containsPoint: true, method: 'contains_point', tags: { building: 'yes' } },
      solarGroundSqFt: 1500,
      segmentCount: 2,
      solarCentroid: { lat: 41.41004, lng: -81.46004 },
    });
    expect(review.needs_rep_review).toBe(false);
  });
});

describe('pitch mode', () => {
  it('uses the area-weighted mode instead of the mean', () => {
    const mode = areaWeightedPitchMode([
      { pitchDegrees: Math.atan(7 / 12) * 180 / Math.PI, stats: { areaMeters2: 70 } },
      { pitchDegrees: Math.atan(4 / 12) * 180 / Math.PI, stats: { areaMeters2: 30 } },
    ]);
    expect(mode.label).toBe('7/12');
    expect(mode.source).toBe('solar_segments_area_mode');
  });

  it('uses only segments on the pinned building, not the house pitch', () => {
    const houseLat = 41.5;
    const garageLat = 41.5 + (24 / 111320);
    const garage = rect(garageLat, -81.55, 4.2, 3.05);
    const flat = Math.atan(1 / 12) * 180 / Math.PI;
    const seven = Math.atan(7 / 12) * 180 / Math.PI;
    const houseOnly = pitchOnBuilding([
      {
        pitchDegrees: flat,
        center: { latitude: houseLat, longitude: -81.55 },
        stats: { areaMeters2: 100 },
      },
    ], garage);
    expect(houseOnly.known).toBe(false);
    expect(houseOnly.label).toBeNull();

    const onGarage = pitchOnBuilding([
      {
        pitchDegrees: flat,
        center: { latitude: houseLat, longitude: -81.55 },
        boundingBox: {
          sw: { latitude: houseLat - 0.0001, longitude: -81.5502 },
          ne: { latitude: houseLat + 0.0001, longitude: -81.5498 },
        },
        stats: { areaMeters2: 120 },
      },
      {
        pitchDegrees: seven,
        center: { latitude: garageLat, longitude: -81.55 },
        boundingBox: {
          sw: { latitude: garageLat - 0.00003, longitude: -81.55004 },
          ne: { latitude: garageLat + 0.00003, longitude: -81.54996 },
        },
        stats: { areaMeters2: 30 },
      },
    ], garage);
    expect(onGarage.known).toBe(true);
    expect(onGarage.label).toBe('7/12');
    expect(onGarage.segmentCount).toBe(1);
    expect(onGarage.source).toBe('solar_segments_on_building');
  });
});

describe('Microsoft building footprints', () => {
  it('reads a quadkey tile and keeps the building under the pin', async () => {
    const ring = [
      [-81.5655, 41.5351],
      [-81.5653, 41.5351],
      [-81.5653, 41.5353],
      [-81.5655, 41.5353],
      [-81.5655, 41.5351],
    ];
    const line = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { height: 6 },
    });
    const far = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[
        [-81.5655, 41.5451], [-81.5653, 41.5451], [-81.5653, 41.5453], [-81.5655, 41.5453], [-81.5655, 41.5451],
      ]] },
    });
    const near = buildingsFromGeoJsonl(`${line}\n${far}\n`, HANOVER.lat, HANOVER.lng, 80);
    expect(near).toHaveLength(1);
    expect(near[0].el.tags.source).toBe('microsoft');

    const quadkey = quadkeyFor(HANOVER.lat, HANOVER.lng);
    const index = `Location,QuadKey,Url,Size,UploadDate\nUnitedStates,${quadkey},https://example.test/tile.csv.gz,1,2026-07-24\n`;
    expect(parseFootprintIndex(index).get(quadkey)).toEqual(['https://example.test/tile.csv.gz']);

    resetMicrosoftFootprintCache();
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-footprints-'));
    const gzip = gzipSync(Buffer.from(`${line}\n${far}\n`));
    let tileFetches = 0;
    const fetchImpl = async (url) => {
      if (String(url).includes('dataset-links.csv')) {
        return new Response(index, { status: 200 });
      }
      tileFetches += 1;
      return new Response(gzip, { status: 200 });
    };
    let pauses = 0;
    const fetched = await fetchMicrosoftBuildingsNear(HANOVER.lat, HANOVER.lng, {
      cacheDir,
      fetchImpl,
      yieldEvery: 1,
      pause: () => { pauses += 1; },
    });
    expect(MICROSOFT_FOOTPRINT_TIMEOUT_MS).toBeGreaterThanOrEqual(30000);
    expect(pauses).toBeGreaterThan(0);
    expect(fetched.timedOut).toBe(false);
    expect(fetched.buildings).toHaveLength(1);
    const selected = selectAddressBuilding(fetched.buildings, HANOVER.lat, HANOVER.lng, { maxDistanceM: 12 });
    expect(selected.method).toBe('contains_point');

    const again = await fetchMicrosoftBuildingsNear(HANOVER.lat, HANOVER.lng, {
      cacheDir,
      fetchImpl: async () => { throw new Error('cached sub-tile should not download the parent tile'); },
    });
    expect(again.buildings).toHaveLength(1);
    expect(tileFetches).toBe(1);

    const farLat = 41.5452;
    const farLng = -81.5654;
    const farHit = await fetchMicrosoftBuildingsNear(farLat, farLng, {
      cacheDir,
      radiusM: 200,
      fetchImpl: async () => { throw new Error('a second sub-tile should come from disk'); },
    });
    expect(farHit.buildings.length).toBeGreaterThan(0);
    resetMicrosoftFootprintCache();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('stores extracts in the project cache and drops the oldest tile past the cap', async () => {
    const previous = process.env.MICROSOFT_FOOTPRINT_CACHE_DIR;
    delete process.env.MICROSOFT_FOOTPRINT_CACHE_DIR;
    expect(microsoftFootprintCacheDir()).toMatch(/[/\\]\.cache[/\\]ms-footprints$/);
    expect(MICROSOFT_FOOTPRINT_CACHE_MAX_BYTES).toBe(1024 * 1024 * 1024);
    if (previous === undefined) delete process.env.MICROSOFT_FOOTPRINT_CACHE_DIR;
    else process.env.MICROSOFT_FOOTPRINT_CACHE_DIR = previous;

    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-footprints-cap-'));
    const oldDir = path.join(cacheDir, 'oldparent');
    const keepDir = path.join(cacheDir, 'keepparent');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(keepDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'a.jsonl'), 'x'.repeat(300));
    fs.writeFileSync(path.join(keepDir, 'b.jsonl'), 'y'.repeat(300));
    const older = new Date('2020-01-01T00:00:00Z');
    const newer = new Date('2024-01-01T00:00:00Z');
    fs.utimesSync(oldDir, older, older);
    fs.utimesSync(keepDir, newer, newer);
    const capped = await enforceMicrosoftFootprintCacheCap(cacheDir, { maxBytes: 400, keep: 'keepparent' });
    expect(capped.removed).toContain('oldparent');
    expect(fs.existsSync(oldDir)).toBe(false);
    expect(fs.existsSync(keepDir)).toBe(true);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('flags a timed-out tile instead of keeping it', async () => {
    resetMicrosoftFootprintCache();
    const quadkey = quadkeyFor(41.5, -81.5);
    const index = `Location,QuadKey,Url,Size,UploadDate\nUnitedStates,${quadkey},https://example.test/slow.csv.gz,1,2026-07-24\n`;
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-footprints-timeout-'));
    const result = await fetchMicrosoftBuildingsNear(41.5, -81.5, {
      cacheDir,
      timeoutMs: 40,
      fetchImpl: (url, { signal } = {}) => new Promise((resolve, reject) => {
        if (String(url).includes('dataset-links.csv')) {
          resolve(new Response(index, { status: 200 }));
          return;
        }
        const fail = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail, { once: true });
      }),
    });
    expect(result.timedOut).toBe(true);
    expect(result.error).toMatch(/timed out/i);
    expect(result.buildings).toEqual([]);
    const review = assessRoofReview({
      latitude: 41.5,
      longitude: -81.5,
      footprint: null,
      footprintLookupTimedOut: true,
    });
    expect(review.reasons.map((reason) => reason.code)).toContain('footprint_lookup_timeout');
    expect(review.message).toContain('timed out');
    expect(fs.existsSync(path.join(cacheDir, quadkey, 'complete.json'))).toBe(false);
    resetMicrosoftFootprintCache();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });
});

describe('rep review is on the estimator screen', () => {
  it('asks the rep to confirm or hand-trace and blocks ready until then', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'src/pages/AIEstimator.jsx'), 'utf8');
    expect(page).toContain('Needs rep review');
    expect(page).toContain('button-confirm-roof-review');
    expect(page).toContain('Confirm this roof');
    expect(page).toContain('rep_review_confirmed: true');
    expect(page).toContain('measurement_ready: true');
    expect(page).toContain('hand-trace it');
    expect(page).toContain('pitch unknown — enter the pitch for this building');
    expect(page).toContain('roof_needs_rep_review');
    expect(page).toContain('mergeRoofWallReview');
  });
});
