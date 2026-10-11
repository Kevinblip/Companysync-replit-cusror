import { describe, it, expect } from 'vitest';
import {
  assembleEstimatorHouse,
  assembleSolarHouse,
  isHouseAssembled,
  buildElevationDrawings,
  toViewerModel,
  solarSegmentsToRoofFaces,
  photosFromLeadDocuments,
  photoForView,
  inferMaterial,
  DEFAULT_ESTIMATED_WIDTH_FT,
  DEFAULT_ESTIMATED_HEIGHT_FT,
} from '../lib/houseGeometry.js';

const SAMPLE_PHOTOS = [
  { label: 'Front', url: 'https://example.com/front.jpg' },
  { label: 'Right Side', url: 'https://example.com/right.jpg' },
  { label: 'Back', url: 'https://example.com/back.jpg' },
  { label: 'Left Side', url: 'https://example.com/left.jpg' },
];

const PHOTO_ANALYSIS = {
  building_length_ft: 42,
  building_width_ft: 36,
  story_count: 2,
  story_height_ft: 18,
  siding_material: 'vinyl',
  roof_type: 'gable',
  per_photo_breakdown: [
    { label: 'Front', siding_material: 'stone', primary_cladding: 'siding', secondary_cladding: 'stone', secondary_cladding_region: 'lower', secondary_height_ft: 8, wall_width_ft: 36 },
    { label: 'Right Side', siding_material: 'vinyl', primary_cladding: 'siding', wall_width_ft: 42 },
    { label: 'Back', siding_material: 'vinyl', primary_cladding: 'siding', wall_width_ft: 36 },
    { label: 'Left Side', siding_material: 'brick', primary_cladding: 'brick', wall_width_ft: 42 },
  ],
};

describe('assembleEstimatorHouse from uploaded photos', () => {
  it('builds one assembled house with roof attached to walls', () => {
    const house = assembleEstimatorHouse({
      photos: SAMPLE_PHOTOS,
      photoAnalysis: PHOTO_ANALYSIS,
      satelliteAnalysis: { pitch: '6/12', roof_type: 'gable' },
    });
    expect(house.assembled).toBe(true);
    expect(isHouseAssembled(house.faces)).toBe(true);

    const roofs = house.faces.filter(f => f.type === 'ROOF');
    const walls = house.faces.filter(f => f.type === 'WALL');
    const wallMaxZ = Math.max(...walls.flatMap(f => f.vertices.map(v => v.z)));
    const roofMinZ = Math.min(...roofs.flatMap(f => f.vertices.map(v => v.z)));
    expect(roofMinZ).toBeCloseTo(18, 5);
    expect(roofMinZ).toBeLessThanOrEqual(wallMaxZ + 0.01);
    expect(house.source).not.toMatch(/hover/i);
  });

  it('maps uploaded facade photos onto the matching walls', () => {
    const house = assembleEstimatorHouse({
      photos: SAMPLE_PHOTOS,
      photoAnalysis: PHOTO_ANALYSIS,
    });
    const front = house.faces.filter(f => f.viewId === 'front');
    expect(front.length).toBeGreaterThan(0);
    expect(front.every(f => f.photoUrl === 'https://example.com/front.jpg')).toBe(true);
    expect(house.faces.find(f => f.viewId === 'left')?.photoUrl).toBe('https://example.com/left.jpg');
    expect(house.photosUsed).toBeGreaterThanOrEqual(4);
  });

  it('uses photo cladding (stone / brick / siding) instead of a single estimated box', () => {
    const house = assembleEstimatorHouse({
      photos: SAMPLE_PHOTOS,
      photoAnalysis: PHOTO_ANALYSIS,
    });
    const mats = new Set(house.faces.filter(f => f.type === 'WALL').map(f => f.material));
    expect(mats.has('stone')).toBe(true);
    expect(mats.has('brick')).toBe(true);
    expect(mats.has('siding')).toBe(true);
  });

  it('never labels a photographed facade NOT PHOTOGRAPHED, and does not use 48×9 placeholders', () => {
    const house = assembleEstimatorHouse({
      photos: SAMPLE_PHOTOS,
      photoAnalysis: PHOTO_ANALYSIS,
    });
    const elevations = buildElevationDrawings(house.faces, {
      photos: SAMPLE_PHOTOS,
      estimated: house.estimated,
      footprint: house.footprint,
    });
    expect(elevations).toHaveLength(4);
    for (const el of elevations) {
      expect(el.photographed).toBe(true);
      expect(el.caption).toBe('From uploaded photo');
      expect(el.caption).not.toMatch(/NOT PHOTOGRAPHED/i);
      expect(el.estimated).toBe(false);
      expect(el.height_ft).toBeGreaterThan(DEFAULT_ESTIMATED_HEIGHT_FT);
      expect(el.photoUrl).toBeTruthy();
    }
    const front = elevations.find(e => e.id === 'front');
    expect(front.width_ft).toBe(36);
    expect(front.width_ft).not.toBe(DEFAULT_ESTIMATED_WIDTH_FT);
  });

  it('still says photographed when a photo exists even before measurements exist', () => {
    const house = assembleEstimatorHouse({ photos: [{ label: 'Front', url: '/front.jpg' }] });
    const elevations = toViewerModel(house, { photos: [{ label: 'Front', url: '/front.jpg' }] }).elevations;
    const front = elevations.find(e => e.id === 'front');
    expect(front.photographed).toBe(true);
    expect(front.caption).toBe('From uploaded photo');
    expect(front.caption).not.toMatch(/NOT PHOTOGRAPHED/i);
    const back = elevations.find(e => e.id === 'back');
    expect(back.photographed).toBe(false);
  });
});

describe('solar segments share one frame', () => {
  it('attaches converted Solar bounding boxes to the wall eaves instead of exploding them', () => {
    const origin = { lat: 41.5, lng: -81.5 };
    const segments = [
      {
        pitchDegrees: 26.5,
        azimuthDegrees: 180,
        boundingBox: {
          sw: { latitude: 41.4999, longitude: -81.5002 },
          ne: { latitude: 41.5001, longitude: -81.4998 },
        },
        center: origin,
      },
      {
        pitchDegrees: 26.5,
        azimuthDegrees: 0,
        boundingBox: {
          sw: { latitude: 41.5, longitude: -81.5002 },
          ne: { latitude: 41.5002, longitude: -81.4998 },
        },
        center: origin,
      },
    ];
    const house = assembleEstimatorHouse({
      photos: SAMPLE_PHOTOS,
      photoAnalysis: PHOTO_ANALYSIS,
      roofSegments: segments,
      originLat: origin.lat,
      originLng: origin.lng,
      satelliteAnalysis: { pitch: '6/12', roof_type: 'gable' },
    });
    expect(isHouseAssembled(house.faces)).toBe(true);
    const roofs = house.faces.filter(f => f.type === 'ROOF');
    const walls = house.faces.filter(f => f.type === 'WALL');
    const wallBox = {
      minX: Math.min(...walls.flatMap(f => f.vertices.map(v => v.x))),
      maxX: Math.max(...walls.flatMap(f => f.vertices.map(v => v.x))),
    };
    for (const roof of roofs) {
      const cx = roof.vertices.reduce((s, v) => s + v.x, 0) / roof.vertices.length;
      expect(cx).toBeGreaterThan(wallBox.minX - 8);
      expect(cx).toBeLessThan(wallBox.maxX + 8);
    }
  });

  it('does not treat independent lat/lng boxes as an assembled house', () => {
    const exploded = [
      { type: 'WALL', vertices: [{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }, { x: 40, y: 0, z: 9 }, { x: 0, y: 0, z: 9 }] },
      { type: 'WALL', vertices: [{ x: 0, y: 30, z: 0 }, { x: 40, y: 30, z: 0 }, { x: 40, y: 30, z: 9 }, { x: 0, y: 30, z: 9 }] },
      { type: 'ROOF', vertices: [{ x: 400, y: 0, z: 40 }, { x: 480, y: 0, z: 40 }, { x: 480, y: 30, z: 50 }, { x: 400, y: 30, z: 50 }] },
      { type: 'ROOF', vertices: [{ x: -300, y: 80, z: 55 }, { x: -220, y: 80, z: 55 }, { x: -220, y: 110, z: 62 }, { x: -300, y: 110, z: 62 }] },
    ];
    expect(isHouseAssembled(exploded)).toBe(false);
  });

  it('snaps oversized independent-origin boxes back onto the footprint', () => {
    const faces = solarSegmentsToRoofFaces([
      {
        pitchDegrees: 22,
        azimuthDegrees: 90,
        boundingBox: {
          sw: { latitude: 0, longitude: 0 },
          ne: { latitude: 1, longitude: 1 },
        },
      },
    ], { originLat: 0, originLng: 0, eaveHeightFt: 18, lengthFt: 40, widthFt: 32 });
    expect(faces).toHaveLength(1);
    const xs = faces[0].vertices.map(v => v.x);
    const ys = faces[0].vertices.map(v => v.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(33);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(41);
    expect(Math.min(...faces[0].vertices.map(v => v.z))).toBeCloseTo(18, 5);
  });
});

describe('elevation placeholders', () => {
  it('only uses 48×9 estimated elevation boxes when there are no wall faces and no photos', () => {
    const empty = buildElevationDrawings([]);
    expect(empty.every(e => e.estimated)).toBe(true);
    expect(empty[0].width_ft).toBe(48);
    expect(empty[0].height_ft).toBe(9);
    expect(empty[0].caption).toBe('NOT PHOTOGRAPHED — ESTIMATED');
  });

  it('assembleSolarHouse still attaches a roof (no exploded facets)', () => {
    const house = assembleSolarHouse({
      lengthFt: 48,
      widthFt: 32,
      eaveHeightFt: 9,
      pitch: '6/12',
      roofType: 'gable',
    });
    expect(house.assembled).toBe(true);
  });
});

describe('lead documents → facade photos', () => {
  it('maps Front/Rear/Left/Right elevation files onto estimator photo labels', () => {
    const photos = photosFromLeadDocuments([
      { category: 'front', file_url: '/a.jpg', file_type: 'image/jpeg', document_name: 'front.jpg' },
      { category: 'rear', file_url: '/b.jpg', file_type: 'image/jpeg' },
      { category: 'left_elevation', file_url: '/c.jpg', file_type: 'image/jpeg' },
      { category: 'right_elevation', file_url: '/d.jpg', file_type: 'image/jpeg' },
    ]);
    expect(photoForView(photos, 'front')?.url).toBe('/a.jpg');
    expect(photoForView(photos, 'back')?.url).toBe('/b.jpg');
    expect(photoForView(photos, 'left')?.url).toBe('/c.jpg');
    expect(photoForView(photos, 'right')?.url).toBe('/d.jpg');
  });
});

describe('material inference', () => {
  it('recognizes stone, brick, and lap siding from photo analysis strings', () => {
    expect(inferMaterial('cultured stone veneer')).toBe('stone');
    expect(inferMaterial({ siding_material: 'brick' })).toBe('brick');
    expect(inferMaterial({ siding_material: 'vinyl' })).toBe('siding');
  });
});

describe('viewer model chips', () => {
  it('exposes customer-facing chips (materials + facades) without Hover', () => {
    const model = toViewerModel(assembleEstimatorHouse({
      photos: SAMPLE_PHOTOS,
      photoAnalysis: PHOTO_ANALYSIS,
    }), { photos: SAMPLE_PHOTOS });
    expect(model.materials.some(m => m.id === 'stone')).toBe(true);
    expect(model.facades.some(f => f.id === 'N')).toBe(true);
    expect(model.source).not.toMatch(/hover/i);
    expect(model.hover).toBeUndefined();
  });
});
