import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyConfirmedFaceHeights, cappedWallGross, confirmedModeC, deriveWallHeight, faceEavesFt, gableAreaFromPitch, houseEaveFt, medianPhotoEaveFt, snapHouseEaveFt, wallHeightForStructure, wingPerimeterRun } from '../../db/siding-aggregate.cjs';
import { resolveGutterQuantity } from '../../functions/utils/elevationAccessories.js';
import { isGeminiTimeout, retryTimedOutPhotoRead } from '../../functions/utils/geminiPhotoRetry.js';
import { shrinkPhotoForRetry } from '../../functions/utils/shrinkPhotoForRetry.js';
import { buildMultiViewPhotoEvidence } from '../../functions/utils/multiViewPhotoEvidence.js';
import { billedRoofArea, completePartialRoof, independentFootprintPlanSqFt } from '../../functions/utils/roofCompletion.js';
import { buildSidingMeasurementGraph, collectFaceMasonryPct, collectLabeledMasonryPct, fitFacesToGross, applyBilledWallIdentity, masonryWallFraction } from '../../functions/utils/sidingMeasurementGraph.js';
import {
  faceLengthsFromFootprint,
  inferUncoveredFaceLengths,
  measureWallMaterialSections,
  normalizeWallMaterial,
  preferAlternateSolar,
  reconcileWallSectionGross,
  solarRoofAreaSqFt,
  solarUndershootsFootprint,
  storyCountFromPhotos,
} from '../../functions/utils/wallMaterialSections.js';
import { chooseOutbuildingFootprint, footprintCandidatesFromBuildings, footprintDisagreesWithPhotos, footprintSmallerThan, roofEdgeAgrees } from '../../functions/utils/photoFootprintAnchor.js';
import { nearestRoadFrontAzimuth } from '../../functions/utils/photoSlotOrientation.js';
import { eaveExcludingGable, eaveFromCourseCount, installedRevealIn, resolveVerticalScale } from './companySyncFormulas.js';
import { chooseCornerTotals, cornersFromElevationPhotos, cornersFromFacetOutline, countFootprintCorners, countSidingOutsideCorners, faceWidthsFromFootprint, maskOutsideCorners } from './footprintCorners.js';

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const plan = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

describe('roof completion', () => {
  it('extends a short slope to its mate and does not count the strip twice', () => {
    const south = rect(-20, -10, 40, 10);
    const north = rect(-20, 0, 40, 20);
    const done = completePartialRoof({
      facets: [
        { id: 'south', polygon: south, azimuth_degrees: 180, pitch_degrees: 26.57 },
        { id: 'north', polygon: north, azimuth_degrees: 0, pitch_degrees: 26.57 },
      ],
    });
    const estimated = done.facets.filter((f) => f.quality === 'estimated');
    expect(estimated.length).toBeGreaterThan(0);
    expect(estimated.every((f) => f.completion === 'ridge_symmetry')).toBe(true);
    expect(done.estimated_plan_sqft).toBeGreaterThan(380);
    expect(done.estimated_plan_sqft).toBeLessThan(430);
    expect(done.observed_plan_sqft + done.estimated_plan_sqft).toBeCloseTo(1600, 0);
    expect(done.roof_area_sqft).toBeCloseTo(done.observed_slope_sqft + done.estimated_slope_sqft, 0);
  });

  it('squares a nibbled rectangle and leaves a hip trapezoid alone', () => {
    const nibbled = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 20 },
      { x: 0, y: 20 },
    ];
    const squared = completePartialRoof({
      facets: [{ id: 'plane', polygon: nibbled, azimuth_degrees: 180, pitch_degrees: 18 }],
      footprint: rect(0, 0, 40, 20),
    });
    expect(squared.methods).toContain('rectilinear_square');
    expect(squared.estimated_plan_sqft).toBeGreaterThan(90);
    expect(squared.estimated_plan_sqft).toBeLessThan(120);

    const hip = [
      { x: -20, y: -15 },
      { x: 20, y: -15 },
      { x: 8, y: 0 },
      { x: -8, y: 0 },
    ];
    const mate = [
      { x: -20, y: 15 },
      { x: 20, y: 15 },
      { x: 8, y: 0 },
      { x: -8, y: 0 },
    ];
    const hips = completePartialRoof({
      facets: [
        { id: 'hip_s', polygon: hip, azimuth_degrees: 180, pitch_degrees: 26.57 },
        { id: 'hip_n', polygon: mate, azimuth_degrees: 0, pitch_degrees: 26.57 },
      ],
    });
    expect(hips.estimated_plan_sqft).toBeLessThan(15);
    expect(hips.methods).not.toContain('ridge_extension');
  });

  it('extends a short ridge-axis run out to the longer mate', () => {
    const done = completePartialRoof({
      facets: [
        { id: 'short', polygon: rect(-10, -15, 20, 15), azimuth_degrees: 180, pitch_degrees: 26.57 },
        { id: 'long', polygon: rect(-20, 0, 40, 15), azimuth_degrees: 0, pitch_degrees: 26.57 },
      ],
    });
    expect(done.methods).toContain('ridge_extension');
    expect(done.estimated_plan_sqft).toBeGreaterThan(280);
    expect(done.estimated_plan_sqft).toBeLessThan(340);
    expect(done.facets.filter((f) => f.quality === 'estimated').every((f) => f.completion === 'ridge_extension')).toBe(true);
  });

  it('covers an attached wing and ignores a detached shed', () => {
    const body = rect(0, 0, 40, 24);
    const ell = [
      [0, 0], [56, 0], [56, 16], [40, 16], [40, 24], [0, 24],
    ];
    const withWing = completePartialRoof({
      facets: [{ id: 'body', polygon: body, azimuth_degrees: 180, pitch_degrees: 26.57 }],
      footprint: ell,
    });
    expect(withWing.methods).toContain('footprint_wing');
    expect(withWing.facets.some((f) => f.quality === 'estimated' && f.completion === 'footprint_wing')).toBe(true);
    expect(withWing.estimated_plan_sqft).toBeGreaterThan(200);

    const shed = completePartialRoof({
      facets: [{ id: 'body', polygon: body, azimuth_degrees: 180, pitch_degrees: 26.57 }],
      footprint: rect(0, 0, 40, 24),
      attachedFootprints: [rect(100, 0, 12, 12)],
    });
    expect(shed.methods).not.toContain('footprint_wing');

    const attached = completePartialRoof({
      facets: [{ id: 'body', polygon: body, azimuth_degrees: 180, pitch_degrees: 26.57 }],
      footprint: rect(0, 0, 40, 24),
      attachedFootprints: [rect(44, 0, 12, 12)],
    });
    expect(attached.methods).toContain('footprint_wing');

    const shifted = completePartialRoof({
      facets: [{ id: 'body', polygon: body, azimuth_degrees: 180, pitch_degrees: 26.57 }],
      footprint: rect(200, 200, 40, 24),
    });
    expect(shifted.methods).not.toContain('footprint_wing');
  });

  it('adds nothing when the detected roof already covers the footprint', () => {
    const done = completePartialRoof({
      facets: [
        { id: 's', polygon: rect(0, 0, 40, 15), azimuth_degrees: 180, pitch_degrees: 26.57 },
        { id: 'n', polygon: rect(0, 15, 40, 15), azimuth_degrees: 0, pitch_degrees: 26.57 },
      ],
      footprint: rect(0, 0, 40, 30),
    });
    expect(done.partial).toBe(false);
    expect(done.estimated_plan_sqft).toBeLessThan(15);
    expect(plan(rect(0, 0, 40, 30))).toBe(1200);
  });
});

describe('solar roof blend', () => {
  it('keeps a near-complete segment set and does not substitute the whole roof', () => {
    const agreeing = solarRoofAreaSqFt({
      wholeRoofStats: { areaMeters2: 400 },
      roofSegmentStats: [{ stats: { areaMeters2: 210 } }, { stats: { areaMeters2: 200 } }],
    });
    expect(agreeing).toBe(Math.round(410 * 10.7639));

    const moderate = solarRoofAreaSqFt({
      wholeRoofStats: { areaMeters2: 400 },
      roofSegmentStats: [{ stats: { areaMeters2: 300 } }],
    });
    expect(moderate).toBe(Math.round(300 * 1.05 * 10.7639));

    const short = solarRoofAreaSqFt({
      wholeRoofStats: { areaMeters2: 400 },
      roofSegmentStats: [{ stats: { areaMeters2: 100 } }],
    });
    expect(short).toBe(Math.round(((100 + 400) / 2) * 10.7639));

    const overlap = solarRoofAreaSqFt({
      wholeRoofStats: { areaMeters2: 400 },
      roofSegmentStats: [{ stats: { areaMeters2: 500 } }],
    });
    expect(overlap).toBe(Math.round(500 * 10.7639));

    const wholeOnly = solarRoofAreaSqFt({ wholeRoofStats: { areaMeters2: 400 }, roofSegmentStats: [] });
    expect(wholeOnly).toBe(Math.round(400 * 10.7639 * 0.92));
  });

  it('re-queries only when the mapped footprint is a larger building that still fits', () => {
    expect(solarUndershootsFootprint(500, 1000)).toBe(true);
    expect(solarUndershootsFootprint(800, 1000)).toBe(false);
    expect(solarUndershootsFootprint(0, 1000)).toBe(false);

    expect(preferAlternateSolar({
      primaryGroundSqFt: 500,
      primarySlopeSqFt: 600,
      alternateGroundSqFt: 900,
      alternateSlopeSqFt: 1100,
      footprintPlanSqFt: 1000,
    })).toBe(true);
    expect(preferAlternateSolar({
      primaryGroundSqFt: 500,
      primarySlopeSqFt: 600,
      alternateGroundSqFt: 2000,
      alternateSlopeSqFt: 2400,
      footprintPlanSqFt: 1000,
    })).toBe(false);
    expect(preferAlternateSolar({
      primaryGroundSqFt: 900,
      primarySlopeSqFt: 1000,
      alternateGroundSqFt: 1100,
      alternateSlopeSqFt: 1200,
      footprintPlanSqFt: 1000,
    })).toBe(false);
  });
});

describe('roof billing gate', () => {
  const completion = {
    partial: true,
    observed_plan_sqft: 1000,
    roof_area_sqft: 1400,
    methods: ['footprint_wing'],
  };

  it('leaves a near-complete roof on the Solar number', () => {
    const near = billedRoofArea(1200, completion, { footprintPlanSqFt: 1050 });
    expect(near.area).toBe(1200);
    expect(near.skip).toBe('outline_complete');
    expect(near.estimated_sqft).toBe(0);

    const missing = billedRoofArea(1200, completion, {});
    expect(missing.area).toBe(1200);
    expect(missing.skip).toBe('no_independent_footprint');
  });

  it('does not add area when Solar already covers the outline', () => {
    // Roesing: Solar was about 7% low. The drawn planes were short of the
    // outline, so the old gate (outline vs planes only) billed the gap and
    // the house went high. The outline is not 25% larger than the Solar area.
    const roesing = billedRoofArea(930, {
      partial: true,
      observed_plan_sqft: 780,
      roof_area_sqft: 1300,
      methods: ['footprint_wing'],
    }, { footprintPlanSqFt: 1000 });
    expect(roesing.area).toBe(930);
    expect(roesing.skip).toBe('outline_complete');
    expect(roesing.estimated_sqft).toBe(0);
  });

  it('bills a missing wing only up to the footprint gap', () => {
    const wing = billedRoofArea(1200, completion, { footprintPlanSqFt: 2000 });
    expect(wing.source).toBe('solar_completed');
    expect(wing.area).toBe(1400);

    const huge = billedRoofArea(1200, {
      partial: true,
      observed_plan_sqft: 1000,
      roof_area_sqft: 5000,
      methods: ['footprint_wing'],
    }, { footprintPlanSqFt: 2000 });
    expect(huge.area).toBe(2400);
  });

  it('counts an attached wing and ignores a detached shed', () => {
    const plan = independentFootprintPlanSqFt(
      [[0, 0], [40, 0], [40, 24], [0, 24]],
      [[[44, 0], [56, 0], [56, 12], [44, 12]], [[200, 0], [212, 0], [212, 12], [200, 12]]],
    );
    expect(plan).toBeCloseTo(960 + 144, 0);
  });
});

describe('story count', () => {
  it('needs two elevations before calling the house multi-story', () => {
    const oneLoudPhoto = storyCountFromPhotos([
      { window_rows: 2, story_count: 2 },
      { window_rows: 1, story_count: 1 },
      { window_rows: 1, story_count: 1 },
    ]);
    expect(oneLoudPhoto.story_count).toBe(1);

    const agreed = storyCountFromPhotos([
      { window_rows: 2, story_count: 2 },
      { window_rows: 2, story_count: 2 },
      { window_rows: 1, story_count: 1, is_one_story_wing: true },
      { window_rows: 1, story_count: 1, height_method: 'garage_door_anchor' },
    ]);
    expect(agreed.story_count).toBe(2);

    const single = storyCountFromPhotos([{ window_rows: 2, story_count: 2 }]);
    expect(single.story_count).toBe(2);

    const plurality = storyCountFromPhotos([
      { window_rows: 3, story_count: 3 },
      { window_rows: 3, story_count: 3 },
      { window_rows: 2, story_count: 2 },
      { window_rows: 2, story_count: 2 },
    ]);
    expect(plurality.story_count).toBe(2);

    const rowsDoNotInventAThird = storyCountFromPhotos([
      { window_rows: 3, story_count: 2 },
      { window_rows: 3, story_count: 2 },
    ]);
    expect(rowsDoNotInventAThird.story_count).toBe(2);

    const agreedThree = storyCountFromPhotos([
      { window_rows: 3, story_count: 3 },
      { window_rows: 3, story_count: 3 },
    ]);
    expect(agreedThree.story_count).toBe(3);

    const rowsOnly = storyCountFromPhotos([
      { window_rows: 3 },
      { window_rows: 3 },
    ]);
    expect(rowsOnly.story_count).toBe(2);
  });
});

describe('wall height', () => {
  it('averages every valid eave by wall width, including corners and wings', () => {
    const weighted = deriveWallHeight([
      { eave_height_ft: 10, wall_width_ft: 40, height_method: 'estimate', height_clamped: false },
      { eave_height_ft: 16, wall_width_ft: 10, height_method: 'estimate', height_clamped: false, is_corner_shot: true },
    ], 2);
    expect(weighted.wallHeightFt).toBe(11);
    expect(weighted.wallHeightSemantics).toBe('full_elevation');

    const fullWall = deriveWallHeight([
      { eave_height_ft: 18, height_method: 'estimate', height_clamped: false },
      { eave_height_ft: 17.6, height_method: 'estimate', height_clamped: false },
    ], 2);
    expect(fullWall.wallHeightFt).toBe(18);
    expect(fullWall.heightSource).toContain('full_elevation');

    const oneStory = deriveWallHeight([
      { eave_height_ft: 9, height_method: 'estimate', height_clamped: false },
      { eave_height_ft: 9.2, height_method: 'estimate', height_clamped: false },
    ], 1);
    expect(oneStory.wallHeightFt).toBe(9);
    expect(oneStory.wallHeightSemantics).toBe('full_elevation');

    const anchored = deriveWallHeight([
      { eave_height_ft: 11, height_method: 'door_anchor', height_clamped: false },
    ], 2);
    expect(anchored.wallHeightFt).toBe(11);
    expect(anchored.wallHeightSemantics).toBe('full_elevation');

    const single = deriveWallHeight([
      { eave_height_ft: 21, height_method: 'estimate', height_clamped: false },
    ], 2);
    expect(single.wallHeightFt).toBe(21);
    expect(single.heightSource).toContain('full_elevation');

    const wings = deriveWallHeight([
      { eave_height_ft: 8, height_method: 'estimate', is_one_story_wing: true },
      { eave_height_ft: 8.2, height_method: 'estimate', is_one_story_wing: true },
    ], 2);
    expect(wings.wallHeightFt).toBe(8);
    expect(wings.wallHeightSemantics).toBe('full_elevation');

    const noEave = deriveWallHeight([
      { eave_height_ft: 4, height_method: 'estimate', height_clamped: true },
    ], 2);
    expect(noEave.wallHeightFt).toBe(18);
    expect(noEave.heightSource).toContain('formula_fallback');

    // Eight short eaves and four tall ones are two real clusters. A 15%
    // cut around the median would reject the eight. Both stay, weighted by width.
    const low = Array.from({ length: 8 }, () => ({
      eave_height_ft: 9, wall_width_ft: 10, height_method: 'estimate', height_clamped: false,
    }));
    const high = Array.from({ length: 4 }, () => ({
      eave_height_ft: 18, wall_width_ft: 40, height_method: 'estimate', height_clamped: false,
    }));
    const both = deriveWallHeight([...low, ...high], 2);
    expect(both.wallHeightFt).toBe(15);
    expect(both.heightSource).not.toContain('outlier');
  });

  it('does not raise a measured full elevation to the 17 ft floor in the live handler', () => {
    const plugin = fs.readFileSync(path.join(process.cwd(), 'vite-functions-plugin.js'), 'utf8');
    expect(plugin).toContain('+raised_to_2story_min');
    expect(plugin).toContain('measuredFullElevation');
    expect(plugin).toContain('&& !measuredFullElevation');
    expect(plugin).toContain('const minEave = 7');
    expect(plugin).toContain('perPhotoResults.filter((r) => !isDetailShot(r))');
    expect(plugin).not.toContain('const heightResults = nonCornerResults');
  });
});

describe('outbuilding footprint follows the photo widths', () => {
  it('picks the smaller ring that matches the photos and the roof edge', () => {
    const house = {
      perimeterFt: 157,
      lengthFt: 50,
      widthFt: 28.5,
      edgeLengths: [50, 28.5, 50, 28.5],
    };
    const outbuilding = {
      perimeterFt: 119,
      lengthFt: 36,
      widthFt: 23.5,
      edgeLengths: [36, 23.5, 36, 23.5],
    };
    const chosen = chooseOutbuildingFootprint([house, outbuilding], {
      photoWidths: [36, 24, 35],
      roofEdgeFt: 119,
    });
    expect(chosen.candidate).toBe(outbuilding);
    expect(chosen.photoError).toBeLessThan(0.1);
    const noMatch = chooseOutbuildingFootprint([house], { photoWidths: [12, 10], roofEdgeFt: 40 });
    expect(noMatch).toBeNull();

    const fromMicrosoft = footprintCandidatesFromBuildings([
      { el: { geometry: [
        { lat: 41.5, lon: -81.694 },
        { lat: 41.5001, lon: -81.694 },
        { lat: 41.5001, lon: -81.69391 },
        { lat: 41.5, lon: -81.69391 },
      ] } },
    ]);
    expect(fromMicrosoft).toHaveLength(1);
    expect(fromMicrosoft[0].perimeterFt).toBeGreaterThan(100);
    expect(fromMicrosoft[0].perimeterFt).toBeLessThan(150);
    const picked = chooseOutbuildingFootprint([house, fromMicrosoft[0]], {
      photoWidths: [fromMicrosoft[0].lengthFt, fromMicrosoft[0].widthFt],
      roofEdgeFt: fromMicrosoft[0].perimeterFt,
    });
    expect(picked.candidate).toBe(fromMicrosoft[0]);

    const plugin = fs.readFileSync(path.join(process.cwd(), 'vite-functions-plugin.js'), 'utf8');
    const picker = plugin.slice(
      plugin.indexOf('An outbuilding at the same pin'),
      plugin.indexOf('A footprint the caller already measured'),
    );
    expect(picker).toContain('fetchMicrosoftBuildingsNear');
    expect(picker).toContain('footprintCandidatesFromBuildings');
    expect(picker).toContain('footprintDisagreesWithPhotos');
    expect(picker).not.toContain('!usedSatellite');
  });

  it('treats a pin footprint that misses the photo widths as an outbuilding', () => {
    const house = {
      perimeterFt: 157,
      lengthFt: 50,
      widthFt: 40,
      edgeLengths: [50, 40, 50, 40],
    };
    const outbuilding = {
      perimeterFt: 119,
      lengthFt: 36,
      widthFt: 24,
      edgeLengths: [36, 24, 36, 24],
    };
    expect(footprintDisagreesWithPhotos(house, [36, 24])).toBe(true);
    expect(footprintDisagreesWithPhotos(house, [36])).toBe(false);
    expect(footprintDisagreesWithPhotos(outbuilding, [36, 24])).toBe(false);
    const chosen = chooseOutbuildingFootprint([house, outbuilding], {
      photoWidths: [36, 24],
      roofEdgeFt: 119,
    });
    expect(chosen.candidate).toBe(outbuilding);

    const ui = fs.readFileSync(path.join(process.cwd(), 'src/pages/AIEstimator.jsx'), 'utf8');
    const photoStart = ui.indexOf('const handleAnalyzePhotos');
    const photoCall = ui.slice(photoStart, ui.indexOf('if (response?.error) throw new Error(response.error);', photoStart));
    expect(photoCall).toContain('structure_type: isGarageMode ? structureType : \'house\'');
    expect(photoCall).toContain('latitude: photoLat');
    expect(photoCall).not.toContain('latitude: !isGarageMode');
    expect(ui).toContain('structure_type: declaredStructure || \'house\'');
  });

  it('keeps an L-shaped house when the long wall matches and refuses a larger ring', () => {
    const ell = {
      perimeterFt: 222,
      lengthFt: 70,
      widthFt: 41,
      // The 70 ft elevation is two colinear edges. Neither edge is 70 or 41.
      edgeLengths: [36, 34, 22, 19, 36, 28, 25, 22],
    };
    const nearestEdgeError = (candidate, widths) => {
      const edges = candidate.edgeLengths;
      const total = widths.reduce((sum, width) => (
        sum + Math.min(...edges.map((edge) => Math.abs(edge - width) / width))
      ), 0);
      return total / widths.length;
    };
    const larger = {
      perimeterFt: 284,
      lengthFt: 83,
      widthFt: 59,
      edgeLengths: [83, 59, 83, 59],
    };
    expect(nearestEdgeError(ell, [70, 41])).toBeGreaterThan(0.25);
    expect(footprintDisagreesWithPhotos(ell, [70, 41])).toBe(false);
    expect(nearestEdgeError(ell, [70, 30])).toBeGreaterThan(0.25);
    expect(footprintDisagreesWithPhotos(ell, [70, 30])).toBe(false);
    expect(footprintSmallerThan(larger, ell)).toBe(false);
    expect(footprintSmallerThan({ perimeterFt: 119 }, ell)).toBe(true);
    const chosen = chooseOutbuildingFootprint([ell, larger], {
      photoWidths: [70, 41],
      roofEdgeFt: 222,
    });
    expect(chosen.candidate).toBe(ell);
    expect(chosen.photoError).toBeLessThan(0.1);
    const corners = countFootprintCorners(
      [[0, 0], [70, 0], [70, 20], [48, 20], [48, 41], [0, 41]],
      18,
    );
    expect(corners.outside_count).toBe(5);
    expect(corners.inside_count).toBe(1);
    expect(corners.source).toBe('footprint_polygon');

    const plugin = fs.readFileSync(path.join(process.cwd(), 'vite-functions-plugin.js'), 'utf8');
    const picker = plugin.slice(
      plugin.indexOf('An outbuilding at the same pin'),
      plugin.indexOf('A footprint the caller already measured'),
    );
    expect(picker).toContain('photosReadOneStory');
    expect(picker).toContain('smallerThanPin');
    expect(picker).toContain('roofEdgeAgrees');
    expect(picker).toContain('if (isGarageJob)');
    expect(picker).toContain('!(detectedStoryCount >= 2)');
    expect(roofEdgeAgrees(200, 0.25)).toBe(true);
    expect(roofEdgeAgrees(200, 0)).toBe(true);
    expect(roofEdgeAgrees(200, 0.35)).toBe(false);
    expect(roofEdgeAgrees(200, 0.49)).toBe(false);
    expect(roofEdgeAgrees(0, 0)).toBe(false);
    expect(roofEdgeAgrees(15, 0)).toBe(false);
    expect(plugin).toContain('countFootprintCorners(buildingFootprintRing');
  });
});

describe('missing photo heading uses the nearest road', () => {
  it('points the front wall at the road and does not assume north', () => {
    const southRoad = nearestRoadFrontAzimuth([
      {
        tags: { highway: 'residential' },
        geometry: [
          { lat: 41.4996, lon: -81.6944 },
          { lat: 41.4996, lon: -81.6936 },
        ],
      },
    ], 41.5, -81.694);
    expect(southRoad).toBeGreaterThan(150);
    expect(southRoad).toBeLessThan(210);
    expect(nearestRoadFrontAzimuth([
      { tags: { highway: 'footway' }, geometry: [{ lat: 41.4996, lon: -81.694 }, { lat: 41.4997, lon: -81.694 }] },
    ], 41.5, -81.694)).toBeNull();
    const unlabeled = faceLengthsFromFootprint([[-35, -25], [35, -25], [35, 25], [-35, 25]], {});
    expect(unlabeled).toBeNull();
  });
});

describe('masonry percent is a confidence-weighted average of the face', () => {
  it('averages every photo of a face, including one photo and a wide split', () => {
    const lone = collectFaceMasonryPct([
      { wall_face: 'front', non_siding_material: 'brick', non_siding_pct: 40, has_mixed_materials: true },
    ]);
    expect(lone.front).toBe(40);
    const averaged = collectFaceMasonryPct([
      { wall_face: 'left_side', non_siding_material: 'brick', non_siding_pct: 40, has_mixed_materials: true },
      { wall_face: 'left_side', non_siding_material: 'brick', non_siding_pct: 48, has_mixed_materials: true },
      { wall_face: 'back', non_siding_material: 'stone', non_siding_pct: 10, has_mixed_materials: true },
      { wall_face: 'back', non_siding_material: 'stone', non_siding_pct: 80, has_mixed_materials: true },
    ]);
    expect(averaged.left_side).toBe(44);
    expect(averaged.back).toBe(45);
    const weighted = collectFaceMasonryPct([
      { wall_face: 'front', non_siding_material: 'stone', non_siding_pct: 80, confidence: 90 },
      { wall_face: 'front', siding_material: 'vinyl', confidence: 10 },
    ]);
    expect(weighted.front).toBe(72);
    const stucco = collectFaceMasonryPct([
      { wall_face: 'back', non_siding_material: 'stucco', non_siding_pct: 80 },
      { wall_face: 'back', view_label: 'Back', material_shares: { stucco: 88, siding: 12 } },
      { wall_face: 'left_side', non_siding_material: 'stone', non_siding_pct: 90 },
      { view_label: 'FR Corner', wall_face: 'front', non_siding_material: 'brick', non_siding_pct: 30 },
    ]);
    expect(stucco.back).toBe(84);
    expect(stucco.left_side).toBe(90);
    expect(stucco.front).toBe(30);
    expect(stucco.right_side).toBe(30);

    const traced = collectFaceMasonryPct([
      {
        wall_face: 'back',
        siding_material: 'vinyl',
        non_siding_material: 'stucco',
        non_siding_pct: 18,
        material_shares: { siding: 82, stucco: 18 },
        material_regions: [
          { material: 'stucco', percent: 75 },
          { material: 'lap_siding', percent: 25 },
        ],
      },
      {
        wall_face: 'front',
        siding_material: 'vinyl',
        non_siding_material: 'none',
        non_siding_pct: 0,
        material_shares: { siding: 90, stone: 10 },
        material_regions: [
          { material: 'stone', percent: 65 },
          { material: 'lap_siding', percent: 35 },
        ],
      },
      {
        wall_face: 'left_side',
        siding_material: 'vinyl',
        non_siding_pct: 0,
        sections: [{
          material: 'stucco',
          polygon: [[0, 0], [1, 0], [1, 0.8], [0, 0.8]],
        }],
      },
    ]);
    expect(traced.back).toBe(75);
    expect(traced.front).toBe(65);
    expect(traced.left_side).toBe(80);

    const mixed = collectFaceMasonryPct([
      {
        wall_face: 'right_side',
        siding_material: 'vinyl',
        non_siding_material: 'stone',
        non_siding_pct: 28,
        material_regions: [{ material: 'stucco', percent: 22 }],
      },
    ]);
    expect(mixed.right_side).toBe(50);
    const labeledOnly = collectLabeledMasonryPct([
      {
        wall_face: 'front',
        siding_material: 'vinyl',
        non_siding_pct: 0,
        material_regions: [{ material: 'stone', percent: 100 }],
      },
    ]);
    expect(labeledOnly.front).toBe(0);
    expect(collectFaceMasonryPct([
      {
        wall_face: 'front',
        siding_material: 'vinyl',
        non_siding_pct: 0,
        material_regions: [{ material: 'stone', percent: 100 }],
      },
    ]).front).toBe(100);
  });

  it('deducts the averaged stucco and gives an unphotographed face the house share', () => {
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        { wall_face: 'front', wall_width_ft: 40, eave_height_ft: 10, siding_material: 'vinyl' },
        { wall_face: 'back', wall_width_ft: 40, eave_height_ft: 10, siding_material: 'vinyl', non_siding_material: 'stucco', non_siding_pct: 80 },
        { wall_face: 'back', wall_width_ft: 38, eave_height_ft: 10, siding_material: 'vinyl', non_siding_material: 'stucco', non_siding_pct: 88 },
        { wall_face: 'left_side', wall_width_ft: 30, eave_height_ft: 10, siding_material: 'vinyl', non_siding_material: 'stone', non_siding_pct: 90 },
        { wall_face: 'right_side', wall_width_ft: 30, eave_height_ft: 10, siding_material: 'vinyl' },
      ],
      storyCount: 1,
      wallHeightFt: 10,
      grossWallAreaSqft: 1400,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    const back = graph.material_map.faces.back;
    const stuccoRegion = back.regions.find((region) => region.material === 'stucco');
    expect(stuccoRegion.percent).toBe(84);
    expect(back.siding_percent).toBeLessThan(20);
    const left = graph.material_map.faces.left_side;
    expect(left.regions.some((region) => region.material === 'stone')).toBe(true);
    expect(left.siding_percent).toBeLessThan(20);
    expect(graph.totals.net_siding_area_sqft).toBeLessThan(1400 - 300);

    const unseen = buildSidingMeasurementGraph({
      perPhotoResults: [
        { wall_face: 'front', wall_width_ft: 40, eave_height_ft: 10, siding_material: 'vinyl', non_siding_material: 'stone', non_siding_pct: 80, confidence: 0.8 },
        { wall_face: 'right_side', wall_width_ft: 30, eave_height_ft: 10, siding_material: 'vinyl', confidence: 0.8 },
      ],
      storyCount: 1,
      wallHeightFt: 10,
      grossWallAreaSqft: 1400,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    const missing = unseen.material_map.faces.left_side;
    expect(missing.inferred).toBe(true);
    const stone = missing.regions.find((region) => region.material === 'stone');
    expect(stone.percent).toBeGreaterThan(30);
    expect(stone.percent).toBeLessThan(60);
    expect(missing.siding_percent).toBeGreaterThan(40);
  });

  it('does not copy one traced masonry region onto every face', () => {
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          wall_face: 'front',
          wall_width_ft: 40,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          non_siding_material: 'none',
          non_siding_pct: 0,
          material_regions: [{ material: 'stone', percent: 100 }],
          confidence: 0.9,
        },
      ],
      storyCount: 2,
      wallHeightFt: 10,
      grossWallAreaSqft: 1400,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    expect(graph.material_map.faces.front.siding_percent).toBe(0);
    expect(graph.material_map.faces.left_side.inferred).toBe(true);
    expect(graph.material_map.faces.left_side.siding_percent).toBeGreaterThan(90);
    expect(graph.material_map.faces.back.siding_percent).toBeGreaterThan(90);
    expect(graph.material_map.faces.right_side.siding_percent).toBeGreaterThan(90);
    expect(graph.totals.net_siding_area_sqft).toBeGreaterThan(500);
  });
});

describe('Malec stucco and the openings in it', () => {
  it('keeps net siding within 15% of Hover 1806', () => {
    const face = (wall, width, stone, stucco, openings) => ({
      wall_face: wall,
      wall_width_ft: width,
      eave_height_ft: 16,
      siding_material: 'vinyl',
      non_siding_material: 'stone',
      non_siding_pct: stone,
      material_regions: [{ material: 'stucco', percent: stucco }],
      confidence: 0.9,
      openings,
    });
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        face('front', 60, 28, 22, [
          { type: 'window', width_ft: 8, height_ft: 6, material: 'stone', pos_x: 8, pos_y: 4 },
          { type: 'window', width_ft: 8, height_ft: 7, material: 'stucco', pos_x: 24, pos_y: 8 },
          { type: 'window', width_ft: 3, height_ft: 4, material: 'siding', pos_x: 40, pos_y: 3 },
        ]),
        face('back', 60, 22, 18, [
          { type: 'entry_door', width_ft: 6, height_ft: 8, material: 'siding', pos_x: 10, pos_y: 4 },
          { type: 'window', width_ft: 8, height_ft: 6, material: 'siding', pos_x: 28, pos_y: 6 },
        ]),
        face('left_side', 40, 24, 20, [
          { type: 'window', width_ft: 6, height_ft: 9, material: 'siding', pos_x: 12, pos_y: 6 },
        ]),
        face('right_side', 40, 26, 16, []),
      ],
      storyCount: 2,
      wallHeightFt: 16,
      grossWallAreaSqft: 3200,
      perimeterFt: 200,
      buildingWidthFt: 60,
      buildingLengthFt: 40,
    });
    const hoverSiding = 1806;
    const net = graph.totals.net_siding_area_sqft;
    expect(net).toBeGreaterThan(hoverSiding * 0.85);
    expect(net).toBeLessThan(hoverSiding * 1.15);
    const stucco = Object.values(graph.material_map.faces).reduce(
      (sum, item) => sum + (item.regions || [])
        .filter((region) => region.material === 'stucco')
        .reduce((inner, region) => inner + region.area_sqft, 0),
      0,
    );
    expect(stucco).toBeGreaterThan(500);
    const front = graph.material_map.faces.front;
    expect(front.regions.some((region) => region.material === 'stone')).toBe(true);
    expect(front.regions.some((region) => region.material === 'stucco')).toBe(true);
    // The 8 ft picture windows and the 6×8 door are not real openings. They
    // clamp to 3×5 and 3×6.8, so the siding deduction is the entry door.
    expect(graph.totals.opening_deduction_sqft).toBeGreaterThan(18);
    expect(graph.totals.opening_deduction_sqft).toBeLessThan(25);
    // The clamped 3×5 masonry windows are under 20 sqft, so they ride in
    // waste instead of the masonry column.
    expect(graph.totals.opening_deduction_masonry_sqft).toBe(0);
  });
});

describe('brick and siding split', () => {
  const wallPoly = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

  it('classifies brick ahead of the masonry-to-stone rule', () => {
    expect(normalizeWallMaterial('brick masonry')).toBe('brick');
    expect(normalizeWallMaterial('stone veneer')).toBe('stone');
    expect(normalizeWallMaterial('masonry')).toBe('stone');
  });

  it('keeps a drawn brick band when the share is only a sliver', () => {
    const measured = measureWallMaterialSections({
      photos: [{
        wall_face: 'front',
        eave_height_ft: 10,
        confidence: 0.9,
        material_shares: { brick: 6, siding: 94 },
        sections: [
          { material: 'siding', polygon: wallPoly(0, 0, 1, 0.7) },
          { material: 'brick', polygon: wallPoly(0, 0.7, 1, 0.3) },
        ],
      }],
      faceLengthsFt: { front: 40 },
    });
    const face = measured.faces.front.gross_sqft_by_material;
    expect(face.brick).toBeGreaterThan(110);
    expect(face.brick).toBeLessThan(130);
    expect(face.siding).toBeLessThan(300);
  });

  it('lifts brick from a grade-to-eave percent above a tiny share', () => {
    const measured = measureWallMaterialSections({
      photos: [{
        wall_face: 'front',
        eave_height_ft: 10,
        confidence: 0.9,
        non_siding_pct: 40,
        non_siding_material: 'brick',
        material_shares: { brick: 5, siding: 95 },
        sections: [{ material: 'siding', polygon: wallPoly(0, 0, 1, 1) }],
      }],
      faceLengthsFt: { front: 40 },
    });
    const face = measured.faces.front.gross_sqft_by_material;
    expect(face.brick).toBeGreaterThan(150);
    expect(face.brick).toBeLessThan(170);
    expect((face.siding || 0) + face.brick).toBeLessThan(420);
  });

  it('does not let stone or stucco absorb the siding', () => {
    const stonePct = measureWallMaterialSections({
      photos: [{
        wall_face: 'front',
        eave_height_ft: 10,
        confidence: 0.9,
        non_siding_pct: 40,
        non_siding_material: 'stone',
        material_shares: { stone: 5, siding: 95 },
        sections: [{ material: 'siding', polygon: wallPoly(0, 0, 1, 1) }],
      }],
      faceLengthsFt: { front: 40 },
    });
    const stoneFace = stonePct.faces.front.gross_sqft_by_material;
    expect(stoneFace.stone).toBeLessThan(40);
    expect(stoneFace.siding).toBeGreaterThan(350);

    const masonryLabel = measureWallMaterialSections({
      photos: [{
        wall_face: 'front',
        eave_height_ft: 10,
        confidence: 0.9,
        non_siding_pct: 40,
        non_siding_material: 'masonry',
        material_shares: { siding: 100 },
        sections: [{ material: 'siding', polygon: wallPoly(0, 0, 1, 1) }],
      }],
      faceLengthsFt: { front: 40 },
    });
    const masonryFace = masonryLabel.faces.front.gross_sqft_by_material;
    expect(masonryFace.stone || 0).toBe(0);
    expect(masonryFace.siding).toBeGreaterThan(380);

    const stucco = measureWallMaterialSections({
      photos: [{
        wall_face: 'front',
        eave_height_ft: 10,
        confidence: 0.9,
        non_siding_pct: 60,
        non_siding_material: 'stucco',
        material_shares: { stucco: 8, siding: 92 },
        sections: [{ material: 'siding', polygon: wallPoly(0, 0, 1, 1) }],
      }],
      faceLengthsFt: { front: 40 },
    });
    const stuccoFace = stucco.faces.front.gross_sqft_by_material;
    expect(stuccoFace.stucco).toBeLessThan(50);
    expect(stuccoFace.siding).toBeGreaterThan(340);

    const partial = measureWallMaterialSections({
      photos: [{
        wall_face: 'front',
        eave_height_ft: 10,
        confidence: 0.9,
        visible_width_fraction: 0.3,
        material_shares: { siding: 90, stone: 10 },
        sections: [{ material: 'stone', polygon: wallPoly(0, 0, 1, 1) }],
      }],
      faceLengthsFt: { front: 40 },
    });
    const partialFace = partial.faces.front.gross_sqft_by_material;
    expect(partialFace.stone).toBeGreaterThan(30);
    expect(partialFace.stone).toBeLessThan(50);
    expect(partialFace.siding).toBeGreaterThan(340);
  });

  it('leaves a polygon-only wall on the polygon areas', () => {
    const measured = measureWallMaterialSections({
      photos: [{
        wall_face: 'front',
        eave_height_ft: 10,
        confidence: 0.9,
        sections: [
          { material: 'siding', polygon: wallPoly(0, 0, 1, 0.7) },
          { material: 'brick', polygon: wallPoly(0, 0.7, 1, 0.3) },
        ],
      }],
      faceLengthsFt: { front: 40 },
    });
    const face = measured.faces.front.gross_sqft_by_material;
    expect(face.brick).toBeGreaterThan(110);
    expect(face.brick).toBeLessThan(130);
    expect(face.siding).toBeGreaterThan(270);
  });
});

describe('siding facades, corners, gutters, and J-channel', () => {
  const wallPoly = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

  it('infers a missing side from the opposite wall instead of leaving 0', () => {
    const lengths = inferUncoveredFaceLengths(
      { front: 40, back: 40, right: 30, left: 0 },
      { perimeterFt: 140 },
    );
    expect(lengths.lengths.left).toBeGreaterThan(0);
    expect(lengths.inferred.left).toBe('opposite_side');
    const sliver = inferUncoveredFaceLengths(
      { front: 40, back: 40, right: 30, left: 1.5 },
      { perimeterFt: 140 },
    );
    expect(sliver.lengths.left).toBeGreaterThanOrEqual(8);
    expect(sliver.lengths.right).toBeGreaterThanOrEqual(8);

    const measured = measureWallMaterialSections({
      photos: [{
        wall_face: 'front',
        eave_height_ft: 9,
        window_rows: 2,
        story_count: 2,
        confidence: 0.9,
        material_shares: { siding: 100 },
        sections: [{ material: 'siding', polygon: wallPoly(0, 0, 1, 1) }],
      }],
      faceLengthsFt: { front: 40, back: 40, right: 30, left: 0 },
      footprintPerimeterFt: 140,
      wallHeightFt: 18,
      fillUncoveredFaces: true,
    });
    expect(measured.faces.left).toBeTruthy();
    expect(measured.faces.left.gross_sqft_by_material.siding).toBeGreaterThan(400);
    expect(measured.faces.left.area_source).toBe('inferred_opposite');
    expect(measured.faces.left.confidence).toBe('low');
    expect(measured.missing_faces).not.toContain('left');
  });

  it('counts corners from the footprint, not the larger per-photo tally', () => {
    const poly = [[0, 0], [58.2, 0], [58.2, 12], [50, 12], [50, 18.9], [0, 18.9]];
    const footprint = countFootprintCorners(poly, 8);
    const photos = cornersFromElevationPhotos([
      { wall_face: 'front', outside_corners_visible: 8, inside_corners_visible: 6 },
      { wall_face: 'back', outside_corners_visible: 8, inside_corners_visible: 6 },
      { wall_face: 'left_side', outside_corners_visible: 8, inside_corners_visible: 6 },
      { wall_face: 'right_side', outside_corners_visible: 8, inside_corners_visible: 6 },
    ], 8);
    const chosen = chooseCornerTotals(photos, footprint);
    expect(footprint.outside_count).toBe(5);
    expect(footprint.inside_count).toBe(1);
    expect(chosen.outside_count).toBe(5);
    expect(chosen.inside_count).toBe(1);
    expect(chosen.source).toBe('footprint_polygon');
    expect(photos.outside_count).toBeGreaterThan(chosen.outside_count);
  });

  it('fills gutter runs the photos never saw from the roof eave', () => {
    const partial = resolveGutterQuantity({
      perPhotoResults: [
        { wall_face: 'front', gutter_run_lf: 22, gutter_visible: true },
        { wall_face: 'back', gutter_run_lf: 18, gutter_visible: true },
      ],
      eaveLf: 80,
    });
    expect(partial.gutter_source).toBe('photos_plus_eave');
    expect(partial.gutter_lf).toBe(40 + 40);
    const complete = resolveGutterQuantity({
      perPhotoResults: [
        { wall_face: 'front', gutter_run_lf: 22, gutter_visible: true, gutter_observation_complete: true },
        { wall_face: 'back', gutter_run_lf: 18, gutter_visible: true },
        { wall_face: 'left_side', gutter_run_lf: 20, gutter_visible: true },
        { wall_face: 'right_side', gutter_run_lf: 13, gutter_visible: true },
      ],
      eaveLf: 200,
    });
    expect(complete.gutter_source).toBe('photos');
    expect(complete.gutter_lf).toBe(73);
  });

  it('adds the roof-wall line to J-channel once and keeps a declared window unit count', () => {
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front',
        wall_face: 'front',
        wall_width_ft: 40,
        eave_height_ft: 9,
        siding_material: 'vinyl',
        windows_count: 3,
        openings: [{
          type: 'window', width_ft: 6, height_ft: 4, pos_x: 10, pos_y: 5, unit_count: 3,
        }],
      }],
      storyCount: 1,
      wallHeightFt: 9,
      grossWallAreaSqft: 9 * 140,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
      smallOpeningsInWaste: true,
      roofFacets: [{
        id: 'plane',
        edges: [
          { type: 'eave', length_ft: 40 },
          { type: 'rake', length_ft: 16 },
        ],
      }],
    });
    expect(graph.counts.window_units).toBe(3);
    expect(graph.totals.j_channel_openings_lf).toBe(20);
    expect(graph.totals.j_channel_roof_wall_lf).toBe(56);
    expect(graph.totals.j_channel_lf).toBe(76);
    expect(graph.trim_edges.j_channel.basis).toBe('openings_plus_roof_wall');
    const left = graph.material_map?.faces?.left_side;
    expect(left?.inferred).toBe(true);
    expect(left?.gross_wall_area_sqft).toBeGreaterThan(0);
  });

  it('does not drop a second elevation that shares a street-view panorama', () => {
    const evidence = buildMultiViewPhotoEvidence([
      { view_label: 'Front', confidence: 90, panorama_id: 'PANO1', heading_deg: 10, wall_width_ft: 40 },
      { view_label: 'Left Side', confidence: 90, panorama_id: 'PANO1', heading_deg: 100, wall_width_ft: 30 },
    ]);
    expect(evidence.photos.filter((photo) => photo.status === 'accepted')).toHaveLength(2);
    expect(evidence.covered_faces.sort()).toEqual(['front', 'left_side']);
  });

  it('keeps inferred faces inside the footprint prism', () => {
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: ['front', 'back', 'left_side', 'right_side'].map((wall) => ({
        view_label: wall,
        wall_face: wall,
        wall_width_ft: wall.includes('side') ? 30 : 40,
        eave_height_ft: 10,
        gable_rise_ft: wall === 'front' || wall === 'back' ? 20 : 0,
        has_gable_end: wall === 'front' || wall === 'back',
        siding_material: 'vinyl',
      })),
      storyCount: 1,
      wallHeightFt: 10,
      grossWallAreaSqft: 2200,
      perimeterFt: 200,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    const allowance = 200 * 10 * 1.1;
    expect(graph.totals.gross_wall_area_sqft).toBeLessThanOrEqual(allowance + 0.5);
    expect(graph.totals.siding_facade_area_sqft).toBeLessThanOrEqual(allowance + 0.5);
    const faceGross = Object.values(graph.material_map.faces)
      .reduce((sum, face) => sum + face.gross_wall_area_sqft, 0);
    expect(faceGross).toBeLessThanOrEqual(allowance + 0.5);
  });

  it('does not bill a garage wing or a narrow gable as the whole front', () => {
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          view_label: 'Front',
          wall_face: 'front',
          wall_width_ft: 16,
          eave_height_ft: 8,
          wall_height_ft: 8,
          is_one_story_wing: true,
          garage_doors_count: 1,
          window_rows: 1,
          siding_material: 'vinyl',
        },
        { view_label: 'Back', wall_face: 'back', wall_width_ft: 40, eave_height_ft: 18, siding_material: 'vinyl' },
        { view_label: 'Left', wall_face: 'left_side', wall_width_ft: 30, eave_height_ft: 18, siding_material: 'vinyl' },
        { view_label: 'Right', wall_face: 'right_side', wall_width_ft: 30, eave_height_ft: 18, siding_material: 'vinyl' },
      ],
      storyCount: 2,
      wallHeightFt: 18,
      grossWallAreaSqft: 140 * 18,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    const front = graph.material_map.faces.front.gross_wall_area_sqft;
    expect(front).toBeCloseTo(16 * 8 + 24 * 18, 0);
    expect(front).toBeLessThan(40 * 18);
    expect(graph.totals.photo_width_fallback_faces).not.toContain('front');
    expect(graph.totals.gross_wall_area_sqft).toBeLessThanOrEqual(140 * 18 * 1.1 + 0.5);

    const gable = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          view_label: 'Front',
          wall_face: 'front',
          wall_width_ft: 16,
          eave_height_ft: 18,
          has_gable_end: true,
          gable_rise_ft: 10,
          siding_material: 'vinyl',
        },
        { view_label: 'Back', wall_face: 'back', wall_width_ft: 40, eave_height_ft: 18, siding_material: 'vinyl' },
        { view_label: 'Left', wall_face: 'left_side', wall_width_ft: 30, eave_height_ft: 18, siding_material: 'vinyl' },
        { view_label: 'Right', wall_face: 'right_side', wall_width_ft: 30, eave_height_ft: 18, siding_material: 'vinyl' },
      ],
      storyCount: 2,
      wallHeightFt: 18,
      grossWallAreaSqft: 140 * 18,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    const gableFront = gable.material_map.faces.front.gross_wall_area_sqft;
    const fullFrontGable = 40 * 18 + (40 * 10) / 2;
    expect(gableFront).toBeLessThan(fullFrontGable - 1);
    expect(gableFront).toBeCloseTo(40 * 18 + (16 * 10) / 2, 0);
  });

  it('raises a two-story house whose photos all stop at one floor, and keeps a real short wing', () => {
    const short = ['front', 'back', 'left_side', 'right_side'].map((wall) => ({
      view_label: wall,
      wall_face: wall,
      wall_width_ft: wall.includes('side') ? 30 : 40,
      eave_height_ft: 9,
      wall_height_ft: 9,
      siding_material: 'vinyl',
    }));
    const raised = buildSidingMeasurementGraph({
      perPhotoResults: short,
      storyCount: 2,
      wallHeightFt: 18,
      grossWallAreaSqft: 140 * 18,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    expect(raised.totals.gross_wall_area_sqft).toBeCloseTo(140 * 18, 0);
    expect(raised.totals.net_siding_area_sqft).toBeGreaterThan(140 * 12);

    const split = buildSidingMeasurementGraph({
      perPhotoResults: [
        { view_label: 'Front', wall_face: 'front', wall_width_ft: 40, eave_height_ft: 18, siding_material: 'vinyl' },
        { view_label: 'Back', wall_face: 'back', wall_width_ft: 40, eave_height_ft: 18, siding_material: 'vinyl' },
        { view_label: 'Left', wall_face: 'left_side', wall_width_ft: 30, eave_height_ft: 9, siding_material: 'vinyl' },
        { view_label: 'Right', wall_face: 'right_side', wall_width_ft: 30, eave_height_ft: 9, siding_material: 'vinyl' },
      ],
      storyCount: 2,
      wallHeightFt: 18,
      grossWallAreaSqft: 140 * 18,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    expect(split.totals.gross_wall_area_sqft).toBeCloseTo(40 * 18 * 2 + 30 * 9 * 2, 0);
  });

  it('caps photo corner tallies when no traced footprint was passed', () => {
    const photos = cornersFromElevationPhotos([
      { wall_face: 'front', outside_corners_visible: 8, inside_corners_visible: 1 },
      { wall_face: 'back', outside_corners_visible: 8, inside_corners_visible: 1 },
      { wall_face: 'left_side', outside_corners_visible: 8, inside_corners_visible: 1 },
      { wall_face: 'right_side', outside_corners_visible: 8, inside_corners_visible: 1 },
    ], 10);
    const rectangle = countFootprintCorners(null, 10);
    const capped = chooseCornerTotals(photos, rectangle);
    expect(photos.outside_count).toBe(16);
    expect(photos.inside_count).toBe(2);
    expect(capped.outside_count).toBe(8);
    expect(capped.inside_count).toBe(2);
    expect(capped.outside_lf).toBe(80);
    expect(capped.source).toBe('capped_elevation_photos');

    const under = cornersFromElevationPhotos([
      { wall_face: 'front', outside_corners_visible: 2, inside_corners_visible: 1 },
      { wall_face: 'back', outside_corners_visible: 2, inside_corners_visible: 1 },
      { wall_face: 'left_side', outside_corners_visible: 1, inside_corners_visible: 0 },
      { wall_face: 'right_side', outside_corners_visible: 1, inside_corners_visible: 0 },
    ], 9);
    const kept = chooseCornerTotals(under, countFootprintCorners(null, 9));
    expect(under.outside_count).toBe(3);
    expect(kept.outside_count).toBe(4);
    expect(kept.inside_count).toBe(1);

    const traced = countFootprintCorners(
      [[0, 0], [58.2, 0], [58.2, 12], [50, 12], [50, 18.9], [0, 18.9]],
      10,
    );
    const tracedWins = chooseCornerTotals(photos, traced);
    expect(tracedWins.outside_count).toBe(5);
    expect(tracedWins.inside_count).toBe(1);
    expect(tracedWins.source).toBe('footprint_polygon');
  });

  it('counts one door when two photos show the same opening', () => {
    const door = (pos) => ({
      type: 'entry_door', width_ft: 3, height_ft: 6.8, pos_x: pos, pos_y: 3,
    });
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          view_label: 'Front',
          wall_face: 'front',
          wall_width_ft: 40,
          eave_height_ft: 9,
          siding_material: 'vinyl',
          openings: [door(10), { type: 'window', width_ft: 3, height_ft: 4, pos_x: 4, pos_y: 5 }],
        },
        {
          view_label: 'Front again',
          wall_face: 'front',
          wall_width_ft: 40,
          eave_height_ft: 9,
          siding_material: 'vinyl',
          openings: [door(12.5), { type: 'window', width_ft: 3, height_ft: 4, pos_x: 5, pos_y: 5 }],
        },
      ],
      storyCount: 1,
      wallHeightFt: 9,
      grossWallAreaSqft: 1260,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    expect(graph.counts.entry_doors).toBe(1);
    expect(graph.counts.window_units).toBe(1);
    expect(graph.diagnostics.duplicates_removed).toBeGreaterThan(0);

    const apart = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front',
        wall_face: 'front',
        wall_width_ft: 40,
        eave_height_ft: 9,
        siding_material: 'vinyl',
        openings: [
          { type: 'window', width_ft: 3, height_ft: 4, pos_x: 4, pos_y: 5 },
          { type: 'window', width_ft: 3, height_ft: 4, pos_x: 18, pos_y: 5 },
        ],
      }],
      storyCount: 1,
      wallHeightFt: 9,
      grossWallAreaSqft: 1260,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    expect(apart.counts.window_units).toBe(2);
  });

  it('does not count the same window twice when two photos cover one face', () => {
    const windowAt = (pos) => ({ type: 'window', width_ft: 3, height_ft: 5, pos_x: pos, pos_y: 6 });
    const widths = { front: 40, back: 40, left_side: 24, right_side: 24, perimeter_ft: 128 };
    const overlapped = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          wall_face: 'front',
          wall_width_ft: 40,
          visible_width_fraction: 1,
          visible_x_start: 0,
          eave_height_ft: 16,
          siding_material: 'vinyl',
          openings: [windowAt(4), windowAt(12), windowAt(20), windowAt(28)],
        },
        {
          wall_face: 'front',
          wall_width_ft: 40,
          visible_width_fraction: 1,
          visible_x_start: 0,
          eave_height_ft: 16,
          siding_material: 'vinyl',
          openings: [windowAt(30), windowAt(8), windowAt(16), windowAt(24)],
        },
      ],
      storyCount: 2,
      wallHeightFt: 16,
      grossWallAreaSqft: 40 * 16,
      perimeterFt: 128,
      faceWidthsFt: widths,
    });
    expect(overlapped.counts.by_face.front.windows).toBe(4);
    const halves = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          wall_face: 'front',
          wall_width_ft: 18,
          visible_width_fraction: 0.45,
          visible_x_start: 0,
          eave_height_ft: 16,
          siding_material: 'vinyl',
          openings: [windowAt(4), windowAt(10)],
        },
        {
          wall_face: 'front',
          wall_width_ft: 18,
          visible_width_fraction: 0.45,
          visible_x_start: 0.55,
          eave_height_ft: 16,
          siding_material: 'vinyl',
          openings: [windowAt(26), windowAt(34)],
        },
      ],
      storyCount: 2,
      wallHeightFt: 16,
      grossWallAreaSqft: 40 * 16,
      perimeterFt: 128,
      faceWidthsFt: widths,
    });
    expect(halves.counts.by_face.front.windows).toBe(4);
  });

  it('dedupes the same window by its position along the face, not each photo width', () => {
    const widths = { front: 40, back: 40, left_side: 24, right_side: 24, perimeter_ft: 128 };
    const windowAt = (pos) => ({
      type: 'window', width_ft: 3, height_ft: 5, pos_x: pos, pos_y: 6, material: 'siding',
    });
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          wall_face: 'front',
          wall_width_ft: 40,
          eave_height_ft: 16,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
          openings: [windowAt(8), windowAt(24)],
        },
        {
          wall_face: 'front',
          wall_width_ft: 16,
          eave_height_ft: 16,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
          openings: [windowAt(8), windowAt(24)],
        },
      ],
      storyCount: 2,
      wallHeightFt: 16,
      grossWallAreaSqft: 40 * 16,
      perimeterFt: 128,
      faceWidthsFt: widths,
    });
    expect(graph.counts.by_face.front.windows).toBe(2);
  });

  it('caps a face whose openings exceed a plausible share of the wall and flags it', () => {
    const widths = { front: 40, back: 40, left_side: 20, right_side: 20, perimeter_ft: 120 };
    const openings = Array.from({ length: 20 }, (_, index) => ({
      type: 'window',
      width_ft: 4,
      height_ft: 6,
      pos_x: 1 + index * 2,
      pos_y: 5,
      material: 'siding',
    }));
    const wall = (face, extra = {}) => ({
      wall_face: face,
      wall_width_ft: widths[face],
      eave_height_ft: 10,
      siding_material: 'vinyl',
      material_regions: [{ material: 'vinyl', percent: 100 }],
      ...extra,
    });
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        wall('front', { openings }),
        wall('back'),
        wall('left_side'),
        wall('right_side'),
      ],
      storyCount: 1,
      wallHeightFt: 10,
      grossWallAreaSqft: 120 * 10,
      perimeterFt: 120,
      faceWidthsFt: widths,
      faceEaveFt: { front: 10, back: 10, left_side: 10, right_side: 10 },
    });
    const frontGross = graph.material_map.faces.front.gross_wall_area_sqft;
    const flag = graph.totals.opening_review_flags.find((row) => row.face === 'front');
    expect(flag?.code).toBe('opening_area_capped');
    expect(flag.ratio).toBeGreaterThan(0.45);
    expect(graph.totals.opening_area_capped).toBe(true);
    expect(graph.totals.opening_deduction_sqft).toBeLessThanOrEqual(frontGross * 0.45 + 1);
    expect(graph.totals.opening_deduction_sqft).toBeGreaterThan(frontGross * 0.4);
  });

  it('bills the rest of a front that a garage photo only partly covered', () => {
    const measured = measureWallMaterialSections({
      photos: [{
        wall_face: 'front',
        eave_height_ft: 8,
        wall_width_ft: 16,
        is_one_story_wing: true,
        garage_doors_count: 1,
        window_rows: 1,
        story_count: 2,
        confidence: 0.9,
        material_shares: { siding: 100 },
        sections: [{ material: 'siding', polygon: wallPoly(0, 0, 1, 1) }],
      }],
      faceLengthsFt: { front: 40, back: 40, right: 30, left: 30 },
      footprintPerimeterFt: 140,
      wallHeightFt: 18,
      fillUncoveredFaces: true,
    });
    const front = measured.faces.front.gross_sqft_by_material.siding;
    expect(front).toBeGreaterThan(16 * 8);
    expect(front).toBeLessThan(40 * 18);
    const house = ['front', 'back', 'left', 'right'].reduce(
      (sum, face) => sum + Object.values(measured.faces[face].gross_sqft_by_material).reduce((s, v) => s + v, 0),
      0,
    );
    expect(house).toBeLessThanOrEqual(140 * 18 * 1.1 + 1);
  });
});

describe('one-story wings and outbuildings', () => {
  it('bills an outbuilding at one-story height and caps the wall prism', () => {
    expect(wallHeightForStructure(18, { outbuilding: true })).toBe(9);
    expect(wallHeightForStructure(10, { outbuilding: true })).toBe(10);
    expect(wallHeightForStructure(18, { outbuilding: false })).toBe(18);
    expect(cappedWallGross({ perimeterFt: 100, wallHeightFt: 9, gableSqft: 200 })).toBeCloseTo(990, 5);
    expect(cappedWallGross({
      perimeterFt: 140, wallHeightFt: 18, wingRunFt: 40, wingEaveFt: 8, gableSqft: 0,
    })).toBe(2120);
  });

  it('bills one wing face once, plus the footprint jog, at the wing eave', () => {
    const one = wingPerimeterRun([
      { is_one_story_wing: true, wall_width_ft: 16, eave_height_ft: 8 },
    ], { perimeterFt: 160, boxPerimeterFt: 140 });
    expect(one.runFt).toBe(36);
    expect(one.eaveFt).toBe(8);
    const twice = wingPerimeterRun([
      { is_one_story_wing: true, wall_width_ft: 16, eave_height_ft: 8 },
      { height_method: 'garage_door_anchor', wall_width_ft: 18, eave_height_ft: 10, window_rows: 1, garage_doors_count: 1 },
    ], { perimeterFt: 160, boxPerimeterFt: 140 });
    expect(twice.runFt).toBe(38);
    expect(twice.eaveFt).toBe(9);
  });

  it('caps a straight outbuilding elevation at one story and leaves a two-story house', () => {
    const faces = ['front', 'back', 'left_side', 'right_side'].map((wall) => ({
      wall_face: wall,
      wall_width_ft: wall.includes('side') ? 20 : 24,
      eave_height_ft: 15,
      siding_material: 'vinyl',
    }));
    const shared = {
      perPhotoResults: faces,
      perimeterFt: 88,
      buildingWidthFt: 24,
      buildingLengthFt: 20,
    };
    const outbuilding = buildSidingMeasurementGraph({
      ...shared,
      storyCount: 1,
      wallHeightFt: 15,
      grossWallAreaSqft: 88 * 15,
      outbuilding: true,
    });
    expect(outbuilding.totals.gross_wall_area_sqft).toBeGreaterThan(88 * 7);
    expect(outbuilding.totals.gross_wall_area_sqft).toBeLessThan(88 * 12);
    const house = buildSidingMeasurementGraph({
      ...shared,
      perPhotoResults: faces.map((face) => ({ ...face, eave_height_ft: 18 })),
      storyCount: 2,
      wallHeightFt: 18,
      grossWallAreaSqft: 88 * 18,
      outbuilding: false,
    });
    expect(house.totals.gross_wall_area_sqft).toBeGreaterThan(88 * 15);
  });
});

describe('brick and stone walls drop outside corners and starter', () => {
  const face = (wall, width, material, nonSidingPct = 0) => ({
    view_label: wall,
    wall_face: wall,
    wall_width_ft: width,
    eave_height_ft: 9,
    siding_material: material === 'brick' ? 'vinyl' : material,
    ...(material === 'brick' || nonSidingPct > 0
      ? { non_siding_material: 'brick', non_siding_pct: material === 'brick' ? 100 : nonSidingPct }
      : {}),
  });

  it('shortens starter by a full-height brick wall and leaves a vinyl house alone', () => {
    const shared = {
      storyCount: 1,
      wallHeightFt: 9,
      grossWallAreaSqft: 140 * 9,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    };
    const brickFront = buildSidingMeasurementGraph({
      ...shared,
      perPhotoResults: [
        {
          ...face('front', 40, 'brick'),
          sections: [{
            material: 'brick',
            polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
          }],
        },
        face('back', 40, 'vinyl'),
        face('left_side', 30, 'vinyl'),
        face('right_side', 30, 'vinyl'),
      ],
    });
    expect(brickFront.totals.starter_strip_lf).toBeCloseTo(100, 0);
    const labeledOnly = buildSidingMeasurementGraph({
      ...shared,
      perPhotoResults: [
        face('front', 40, 'brick'),
        face('back', 40, 'vinyl'),
        face('left_side', 30, 'vinyl'),
        face('right_side', 30, 'vinyl'),
      ],
    });
    expect(labeledOnly.totals.starter_strip_lf).toBeCloseTo(140, 0);
    const vinyl = buildSidingMeasurementGraph({
      ...shared,
      perPhotoResults: ['front', 'back', 'left_side', 'right_side'].map((wall) => (
        face(wall, wall.includes('side') ? 30 : 40, 'vinyl')
      )),
    });
    expect(vinyl.totals.starter_strip_lf).toBeCloseTo(140, 0);
    const wainscot = buildSidingMeasurementGraph({
      ...shared,
      perPhotoResults: [
        face('front', 40, 'vinyl', 12),
        face('back', 40, 'vinyl'),
        face('left_side', 30, 'vinyl'),
        face('right_side', 30, 'vinyl'),
      ],
    });
    expect(wainscot.totals.starter_strip_lf).toBeCloseTo(140, 0);
  });

  it('masks starter only for the width of full-height masonry', () => {
    const shared = {
      storyCount: 1,
      wallHeightFt: 9,
      grossWallAreaSqft: 140 * 9,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    };
    const sides = ['back', 'left_side', 'right_side'].map((wall) => (
      face(wall, wall.includes('side') ? 30 : 40, 'vinyl')
    ));
    const upper = buildSidingMeasurementGraph({
      ...shared,
      perPhotoResults: [face('front', 40, 'vinyl', 60), face('front', 40, 'vinyl', 60), ...sides],
    });
    expect(upper.totals.starter_strip_lf).toBeCloseTo(140, 0);
    // Half the wall or more of brick or stone is a masonry run. 60% brick is over that line.
    expect(masonryWallFraction(upper.material_map, shared)).toBeGreaterThan(0.2);
    const fullBrick = {
      faces: {
        front: { inferred: false, regions: [{ material: 'brick', percent: 100 }] },
        back: { inferred: false, regions: [{ material: 'lap_siding', percent: 100 }] },
        left_side: { inferred: false, regions: [{ material: 'lap_siding', percent: 100 }] },
        right_side: { inferred: false, regions: [{ material: 'lap_siding', percent: 100 }] },
      },
    };
    expect(masonryWallFraction(fullBrick, shared)).toBeCloseTo(40 / 140, 2);
    const walsh = {
      faces: {
        front: { inferred: false, regions: [{ material: 'brick', percent: 85 }, { material: 'stucco', percent: 15 }] },
        back: { inferred: false, regions: [{ material: 'brick', percent: 85 }, { material: 'lap_siding', percent: 15 }] },
        left_side: { inferred: false, regions: [{ material: 'brick', percent: 85 }, { material: 'stucco', percent: 15 }] },
        right_side: { inferred: false, regions: [{ material: 'brick', percent: 85 }, { material: 'lap_siding', percent: 15 }] },
      },
    };
    expect(masonryWallFraction(walsh, shared)).toBeCloseTo(1, 2);

    const band = buildSidingMeasurementGraph({
      ...shared,
      perPhotoResults: [{
        ...face('front', 40, 'vinyl', 90),
        material_regions: [
          { material: 'brick', percent: 90 },
          { material: 'lap_siding', percent: 10 },
        ],
        sections: [{
          material: 'brick',
          polygon: [[0, 0.75], [1, 0.75], [1, 1], [0, 1]],
        }],
      }, ...sides],
    });
    expect(band.totals.starter_strip_lf).toBeCloseTo(140, 0);
    const brick = band.material_map.faces.front.regions.find((region) => region.material === 'brick');
    expect(brick.percent).toBeGreaterThan(80);
    expect(brick.percent).toBeLessThan(100);
    expect(band.material_map.faces.front.siding_percent).toBeLessThan(20);

    const aboveGrade = buildSidingMeasurementGraph({
      ...shared,
      perPhotoResults: [{
        ...face('front', 40, 'vinyl', 100),
        sections: [{
          material: 'brick',
          polygon: [[0, 0.2], [1, 0.2], [1, 0.6], [0, 0.6]],
        }],
      }, ...sides],
    });
    expect(aboveGrade.totals.starter_strip_lf).toBeCloseTo(140, 0);

    const halfWidth = buildSidingMeasurementGraph({
      ...shared,
      perPhotoResults: [{
        ...face('front', 40, 'vinyl', 50),
        sections: [{
          material: 'brick',
          polygon: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]],
        }],
      }, ...sides],
    });
    expect(halfWidth.totals.starter_strip_lf).toBeCloseTo(120, 0);

    const fullFace = buildSidingMeasurementGraph({
      ...shared,
      perPhotoResults: [{
        ...face('front', 40, 'vinyl', 100),
        sections: [{
          material: 'brick',
          polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
        }],
      }, ...sides],
    });
    expect(fullFace.totals.starter_strip_lf).toBeCloseTo(100, 0);
  });

  it('keeps a reported brick percent when the texture is uncertain', () => {
    const graph = buildSidingMeasurementGraph({
      storyCount: 1,
      wallHeightFt: 16,
      grossWallAreaSqft: 40 * 16,
      perimeterFt: 40,
      buildingWidthFt: 40,
      buildingLengthFt: 0,
      perPhotoResults: [{
        wall_face: 'front',
        wall_width_ft: 40,
        eave_height_ft: 16,
        siding_material: 'vinyl',
        non_siding_material: 'brick',
        non_siding_pct: 80,
        material_uncertain: true,
        material_regions: [
          { material: 'brick', percent: 80 },
          { material: 'lap_siding', percent: 20 },
        ],
      }],
    });
    const front = graph.material_map.faces.front;
    const brick = front.regions.find((region) => region.material === 'brick');
    expect(brick.percent).toBeGreaterThan(70);
    expect(brick.percent).toBeLessThan(90);
    expect(front.siding_percent).toBeGreaterThan(10);
    expect(front.siding_percent).toBeLessThan(30);
    expect(graph.totals.starter_strip_lf).toBeCloseTo(40, 0);
  });

  it('scales outside corners after the traced footprint wins', () => {
    const traced = countFootprintCorners(
      [[0, 0], [58.2, 0], [58.2, 12], [50, 12], [50, 18.9], [0, 18.9]],
      10,
    );
    const photos = cornersFromElevationPhotos([
      { wall_face: 'front', outside_corners_visible: 8, inside_corners_visible: 6 },
      { wall_face: 'back', outside_corners_visible: 8, inside_corners_visible: 6 },
    ], 10);
    const chosen = chooseCornerTotals(photos, traced);
    expect(chosen.source).toBe('footprint_polygon');
    expect(chosen.outside_count).toBe(5);
    expect(chosen.inside_count).toBe(1);
    const masked = maskOutsideCorners(chosen, 0.4, 10);
    expect(masked.outside_count).toBe(3);
    expect(masked.outside_lf).toBe(30);
    expect(masked.inside_count).toBe(1);
    expect(masked.inside_lf).toBe(chosen.inside_lf);
    expect(maskOutsideCorners(chosen, 0, 10).outside_count).toBe(5);
  });

  it('counts an outside corner only where siding meets siding', () => {
    const polygon = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const geometric = countFootprintCorners(polygon, 12);
    const allSiding = {
      faces: {
        front: { siding_percent: 100 },
        back: { siding_percent: 100 },
        left_side: { siding_percent: 100 },
        right_side: { siding_percent: 100 },
      },
    };
    expect(countSidingOutsideCorners({
      polygon,
      corners: geometric,
      materialMap: allSiding,
      frontAzimuthDeg: 180,
      wallHeightFt: 12,
    }).outside_count).toBe(geometric.outside_count);
    const walsh = {
      faces: {
        front: { siding_percent: 0 },
        back: { siding_percent: 15 },
        left_side: { siding_percent: 0 },
        right_side: { siding_percent: 15 },
      },
    };
    const counted = countSidingOutsideCorners({
      polygon,
      corners: geometric,
      materialMap: walsh,
      frontAzimuthDeg: 180,
      wallHeightFt: 12,
    });
    expect(counted.outside_count).toBe(1);
    expect(counted.outside_lf).toBe(12);
    expect(counted.inside_count).toBe(geometric.inside_count);
    expect(counted.outside_count).not.toBe(0);
    expect(counted.outside_count).not.toBe(geometric.outside_count);
    const noBearing = countSidingOutsideCorners({
      corners: geometric,
      materialMap: walsh,
      wallHeightFt: 12,
    });
    expect(noBearing.outside_count).toBe(1);
  });
});

describe('billed net is wall minus masonry minus openings', () => {
  it('uses the fitted wall, not the larger photo wall the graph billed first', () => {
    const graph = {
      totals: {
        gross_wall_area_sqft: 5163,
        masonry_area_sqft: 1664,
        excluded_material_area_sqft: 1664,
        siding_facade_area_sqft: 3499,
        siding_material_area_sqft: 3499,
        opening_deduction_sqft: 571,
        net_siding_area_sqft: 2928,
      },
      reconciliation: { consistent: true, issues: [] },
      material_map: {
        faces: {
          front: { gross_wall_area_sqft: 1246, siding_area_sqft: 698, excluded_area_sqft: 548 },
          back: { gross_wall_area_sqft: 1243, siding_area_sqft: 1131, excluded_area_sqft: 112 },
          right_side: { gross_wall_area_sqft: 1195, siding_area_sqft: 992, excluded_area_sqft: 203 },
          left_side: { gross_wall_area_sqft: 1121, siding_area_sqft: 760, excluded_area_sqft: 361 },
        },
      },
    };
    applyBilledWallIdentity(graph, 4805);
    const { gross_wall_area_sqft, masonry_area_sqft, opening_deduction_sqft, net_siding_area_sqft } = graph.totals;
    expect(net_siding_area_sqft).toBe(gross_wall_area_sqft - masonry_area_sqft - opening_deduction_sqft);
    expect(gross_wall_area_sqft).toBe(4805);
    expect(masonry_area_sqft).toBe(548 + 112 + 203 + 361);
    expect(net_siding_area_sqft).not.toBe(2928);
    expect(graph.reconciliation.consistent).toBe(true);
    expect(graph.reconciliation.actual_net_siding_area_sqft).toBe(net_siding_area_sqft);
  });
});

describe('face totals match the headline wall area', () => {
  it('shrinks inferred faces first and leaves a matching map alone', () => {
    const over = {
      faces: {
        front: {
          inferred: false,
          gross_wall_area_sqft: 400,
          siding_area_sqft: 400,
          excluded_area_sqft: 0,
          regions: [{ material: 'lap_siding', percent: 100, area_sqft: 400 }],
        },
        left_side: {
          inferred: true,
          gross_wall_area_sqft: 900,
          siding_area_sqft: 900,
          excluded_area_sqft: 0,
          regions: [{ material: 'lap_siding', percent: 100, area_sqft: 900 }],
        },
      },
    };
    fitFacesToGross(over, 500);
    expect(over.faces.front.gross_wall_area_sqft).toBe(400);
    expect(over.faces.left_side.gross_wall_area_sqft).toBeCloseTo(100, 1);
    const crushed = {
      faces: {
        front: {
          inferred: false,
          gross_wall_area_sqft: 720,
          siding_area_sqft: 720,
          excluded_area_sqft: 0,
          regions: [{ material: 'lap_siding', percent: 100, area_sqft: 720 }],
        },
        left_side: {
          inferred: true,
          gross_wall_area_sqft: 720,
          siding_area_sqft: 720,
          excluded_area_sqft: 0,
          regions: [{ material: 'lap_siding', percent: 100, area_sqft: 720 }],
        },
      },
    };
    fitFacesToGross(crushed, 720);
    expect(crushed.faces.left_side.gross_wall_area_sqft).toBeGreaterThan(56);
    expect(crushed.faces.front.gross_wall_area_sqft).toBeGreaterThan(56);
    const sum = over.faces.front.gross_wall_area_sqft + over.faces.left_side.gross_wall_area_sqft;
    expect(sum).toBeCloseTo(500, 1);
    expect(over.siding_area_sqft).toBeCloseTo(500, 1);

    const matched = {
      faces: {
        front: {
          gross_wall_area_sqft: 252,
          siding_area_sqft: 200,
          excluded_area_sqft: 52,
          regions: [{ material: 'lap_siding', percent: 100, area_sqft: 200 }],
        },
        back: {
          gross_wall_area_sqft: 248,
          siding_area_sqft: 248,
          excluded_area_sqft: 0,
          regions: [{ material: 'lap_siding', percent: 100, area_sqft: 248 }],
        },
      },
      siding_area_sqft: 448,
    };
    const before = matched.faces.front.siding_area_sqft;
    fitFacesToGross(matched, 500);
    expect(matched.faces.front.gross_wall_area_sqft).toBe(252);
    expect(matched.faces.front.siding_area_sqft).toBe(before);
  });

  it('reconciles wall sections to the same headline', () => {
    const sections = {
      faces: {
        front: { inferred: false, gross_sqft_by_material: { siding: 400 }, net_sqft_by_material: { siding: 380 } },
        left: { inferred: true, gross_sqft_by_material: { siding: 900 }, net_sqft_by_material: { siding: 900 } },
      },
      totals_gross_sqft: { siding: 1300, stone: 0, stucco: 0, brick: 0, trim: 0 },
      totals_net_sqft: { siding: 1280, stone: 0, stucco: 0, brick: 0, trim: 0 },
    };
    reconcileWallSectionGross(sections, 500);
    const sum = ['front', 'left'].reduce(
      (total, face) => total + sections.faces[face].gross_sqft_by_material.siding,
      0,
    );
    expect(sections.faces.front.gross_sqft_by_material.siding).toBe(400);
    expect(sum).toBeCloseTo(500, 0);
    expect(sections.totals_gross_sqft.siding).toBeCloseTo(500, 0);
  });
});

describe('gutters use the roof eave only for faces with no photo', () => {
  it('keeps a complete photo run and fills only the faces that were not photographed', () => {
    const complete = resolveGutterQuantity({
      perPhotoResults: [
        { wall_face: 'front', gutter_run_lf: 22, gutter_visible: true, gutter_observation_complete: true },
        { wall_face: 'back', gutter_run_lf: 18, gutter_visible: true, gutter_observation_complete: true },
        { wall_face: 'left_side', gutter_run_lf: 20, gutter_visible: true, gutter_observation_complete: true },
        { wall_face: 'right_side', gutter_run_lf: 13, gutter_visible: true, gutter_observation_complete: true },
      ],
      eaveLf: 200,
    });
    expect(complete.gutter_source).toBe('photos');
    expect(complete.gutter_lf).toBe(73);
    const short = resolveGutterQuantity({
      perPhotoResults: [
        { wall_face: 'front', gutter_run_lf: 22, gutter_visible: true },
        { wall_face: 'back', gutter_run_lf: 18, gutter_visible: true },
      ],
      eaveLf: 120,
    });
    expect(short.gutter_source).toBe('photos_plus_eave');
    expect(short.gutter_lf).toBe(100);
    const absent = resolveGutterQuantity({
      perPhotoResults: [
        { wall_face: 'front', gutter_visible: false },
        { wall_face: 'back', gutter_run_lf: 18, gutter_visible: true },
      ],
      eaveLf: 80,
    });
    expect(absent.gutter_source).toBe('photos_plus_eave');
    expect(absent.gutter_lf).toBe(58);
    expect(absent.gutter_filled_faces).not.toContain('front');
    expect(absent.gutter_filled_faces).toEqual(['left', 'right']);
    const closeToEave = resolveGutterQuantity({
      perPhotoResults: [
        { wall_face: 'front', gutter_run_lf: 40, gutter_visible: true },
        { wall_face: 'back', gutter_run_lf: 42, gutter_visible: true },
      ],
      eaveLf: 89,
    });
    expect(closeToEave.gutter_source).toBe('roof_eave');
    expect(closeToEave.gutter_lf).toBe(89);
    const malec = resolveGutterQuantity({
      perPhotoResults: [
        { wall_face: 'front', gutter_run_lf: 44, gutter_visible: true },
        { wall_face: 'back', gutter_run_lf: 44, gutter_visible: true },
        { wall_face: 'left_side', gutter_run_lf: 44, gutter_visible: true },
        { wall_face: 'right_side', gutter_run_lf: 43, gutter_visible: true },
      ],
      eaveLf: 351,
    });
    expect(malec.gutter_lf).toBe(351);
    // Most individual photos miss the width, but the run kept on each face is the wall width.
    const echoedFaces = [];
    for (const [face, width] of [['front', 42], ['back', 52], ['right_side', 27]]) {
      echoedFaces.push({ wall_face: face, gutter_run_lf: width, wall_width_ft: width, gutter_visible: true });
      echoedFaces.push({ wall_face: face, gutter_run_lf: width - 8, wall_width_ft: width + 4, gutter_visible: true });
    }
    const levelOutline = resolveGutterQuantity({ perPhotoResults: echoedFaces, eaveLf: 343 });
    expect(levelOutline.gutter_source).toBe('roof_eave');
    expect(levelOutline.gutter_lf).toBe(343);
    // Photo runs under a level-outline eave bill the eave. A shorter facet
    // eave does not, even when the runs are under a longer outline.
    const underOutline = resolveGutterQuantity({
      perPhotoResults: [
        { wall_face: 'front', gutter_run_lf: 70, gutter_visible: true },
        { wall_face: 'back', gutter_run_lf: 68, gutter_visible: true },
        { wall_face: 'right_side', gutter_run_lf: 70, gutter_visible: true },
      ],
      eaveLf: 343,
      eaveBasisSource: 'roof_level_outline',
    });
    expect(underOutline.gutter_lf).toBe(343);
    expect(underOutline.gutter_source).toBe('roof_eave');
    const facetBasis = resolveGutterQuantity({
      perPhotoResults: [
        { wall_face: 'front', gutter_run_lf: 40, gutter_visible: true },
        { wall_face: 'back', gutter_run_lf: 48, gutter_visible: true },
      ],
      eaveLf: 62,
      eaveBasisSource: 'roof_facet_eave',
    });
    expect(facetBasis.gutter_source).not.toBe('roof_eave');
    expect(facetBasis.gutter_lf).not.toBe(62);
  });
});

describe('footprint edges and one house eave', () => {
  const rectangle = [[0, 0], [40, 0], [40, 20], [0, 20]];

  it('bills 9 ft per story plus the band joist, and the raw median only when the votes split', () => {
    const twoStory = houseEaveFt({ storyCount: 2, storyReads: [2, 2, 2, 1], medianEaveFt: 19.25 });
    expect(twoStory.eaveFt).toBe(19);
    expect(twoStory.uncertain).toBe(false);
    const oneStory = houseEaveFt({ storyCount: 1, storyReads: [1, 1, 1], medianEaveFt: 9.5 });
    expect(oneStory.eaveFt).toBe(10);
    const flipped = houseEaveFt({ storyCount: 1, storyReads: [1, 1], medianEaveFt: 9.8 });
    expect(flipped.eaveFt).toBe(10);
    const split = houseEaveFt({ storyCount: 2, storyReads: [1, 2], medianEaveFt: 14.2 });
    expect(split.uncertain).toBe(true);
    expect(split.eaveFt).toBe(14);
    expect(split.source).toMatch(/raw_median/);
    // The old snap is not the bill. 19.25 used to become 20.
    expect(snapHouseEaveFt(19.25)).toBe(20);
    expect(houseEaveFt({ storyCount: 2, storyReads: [2, 2], medianEaveFt: 19.25 }).eaveFt).not.toBe(20);
  });

  it('sums each footprint edge onto the face it fronts, so a trapezoid is not a box', () => {
    const trapezoid = [[0, 0], [40, 0], [30, 20], [10, 20]];
    const widths = faceWidthsFromFootprint(trapezoid, 180);
    expect(widths.front).toBeCloseTo(40, 5);
    expect(widths.back).toBeCloseTo(20, 5);
    expect(widths.front).not.toBeCloseTo(widths.back, 0);
    expect(widths.edges.front).toHaveLength(1);
    expect(widths.edges.left_side.length + widths.edges.right_side.length).toBe(2);
    expect(widths.front + widths.back + widths.left_side + widths.right_side).toBeCloseTo(widths.perimeter_ft, 5);
  });

  it('takes wall widths from the footprint edges and only flags a photo that disagrees', () => {
    const widths = faceWidthsFromFootprint(rectangle, 180);
    expect(widths.front).toBeCloseTo(40, 5);
    expect(widths.back).toBeCloseTo(40, 5);
    expect(widths.left_side).toBeCloseTo(20, 5);
    expect(widths.right_side).toBeCloseTo(20, 5);
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          wall_face: 'front',
          wall_width_ft: 70,
          eave_height_ft: 18,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
        },
        {
          wall_face: 'back',
          wall_width_ft: 40,
          eave_height_ft: 12,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
        },
      ],
      storyCount: 2,
      wallHeightFt: 18,
      grossWallAreaSqft: 120 * 18,
      perimeterFt: 120,
      faceWidthsFt: widths,
    });
    expect(graph.totals.footprint_anchored).toBe(true);
    expect(graph.totals.gross_wall_area_sqft).toBeCloseTo(120 * 18, 0);
    expect(graph.totals.photo_wall_area_sqft).toBeCloseTo(120 * 18, 0);
    const frontFlag = graph.totals.width_review_flags.find((flag) => flag.face === 'front');
    expect(frontFlag).toBeTruthy();
    expect(graph.totals.width_review_flags.some((flag) => flag.face === 'back')).toBe(false);
    expect(graph.material_map.faces.front.gross_wall_area_sqft).toBeCloseTo(40 * 18, 0);
    expect(graph.material_map.faces.left_side.gross_wall_area_sqft).toBeCloseTo(20 * 18, 0);
  });

  it('bills confirmed shares on a face with no photos and does not flag 0 photos', () => {
    const widths = faceWidthsFromFootprint(rectangle, 180);
    const confirmed = {
      confirmed: true,
      billed_from: 'rep_confirmed',
      photo_count: 0,
      sample_count: 3,
      review_notes: [],
      shares: { stone: 0, stucco: 0, brick: 40, siding: 60 },
      spread: {},
      spread_max: 0,
    };
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          wall_face: 'front',
          wall_width_ft: 40,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          face_materials: {
            front: { ...confirmed, shares: { stone: 0, stucco: 0, brick: 0, siding: 100 } },
            back: { ...confirmed, shares: { stone: 0, stucco: 0, brick: 0, siding: 100 } },
            right_side: { ...confirmed, shares: { stone: 0, stucco: 0, brick: 0, siding: 100 } },
            left_side: confirmed,
          },
        },
      ],
      wallHeightFt: 10,
      grossWallAreaSqft: 120 * 10,
      perimeterFt: 120,
      faceWidthsFt: widths,
    });
    const left = graph.material_map.faces.left_side;
    expect(left.inferred).toBe(true);
    expect(left.siding_percent).toBeCloseTo(60, 1);
    const brick = left.regions.find((region) => region.material === 'brick');
    expect(brick.percent).toBeCloseTo(40, 1);
    const reasons = JSON.stringify(graph.material_map.material_review_flags || []);
    expect(reasons).not.toMatch(/only 0 photos/);
    expect(left.material_agreement.billed_from).toBe('rep_confirmed');
  });

  it('unions opening counts per face and uses a standard window when the size is missing', () => {
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        { wall_face: 'front', wall_width_ft: 40, eave_height_ft: 10, windows_count: 4, siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 100 }] },
        { wall_face: 'front', is_corner_shot: true, wall_width_ft: 40, eave_height_ft: 10, windows_count: 2, siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 100 }] },
      ],
      wallHeightFt: 10,
      grossWallAreaSqft: 400,
      perimeterFt: 40,
      buildingWidthFt: 40,
      buildingLengthFt: 10,
      faceWidthsFt: { front: 40, back: 40, left_side: 10, right_side: 10, perimeter_ft: 100 },
    });
    expect(graph.counts.by_face.front.windows).toBe(4);
    const synthetic = graph.opening_groups.filter((group) => group.face === 'front' && group.type === 'window');
    expect(synthetic.length).toBe(4);
    expect(synthetic[0].width_ft).toBe(3);
    expect(synthetic[0].height_ft).toBe(5);
    expect(synthetic.every((group) => group.deductible)).toBe(true);
  });

  it('does not bill a hip roof as a gable and does not merge reused window labels', () => {
    const widths = faceWidthsFromFootprint(rectangle, 180);
    const hip = gableAreaFromPitch({
      bearings: widths.bearings,
      widths,
      pitch: '6/12',
      roofFacets: [
        {
          area_sqft: 200, azimuth: 2, rise_ft: 4.2, pitch: '6/12',
          edges: [
            { type: 'eave', length_ft: 25, h1: 0, h2: 0 },
            { type: 'hip', length_ft: 7, h1: 0, h2: 4 },
            { type: 'ridge', length_ft: 22, h1: 4, h2: 4 },
            { type: 'rake', length_ft: 9, h1: 4, h2: 0 },
          ],
        },
        {
          area_sqft: 160, azimuth: 182, rise_ft: 4.8, pitch: '6/12',
          edges: [
            { type: 'eave', length_ft: 19, h1: 0, h2: 0 },
            { type: 'rake', length_ft: 12, h1: 0, h2: 4.8 },
            { type: 'ridge', length_ft: 19, h1: 4.8, h2: 4.8 },
            { type: 'rake', length_ft: 12, h1: 4.8, h2: 0 },
          ],
        },
      ],
    });
    expect(hip.gableFaces).toHaveLength(1);
    expect(hip.gableAreaSqft).toBeGreaterThan(0);
    expect(hip.gableAreaSqft).toBeLessThan(80);
    const overPrism = gableAreaFromPitch({
      bearings: widths.bearings,
      widths,
      pitch: '6/12',
      wallHeightFt: 10,
      roofFacets: [
        { area_sqft: 800, azimuth: 180 },
        { area_sqft: 780, azimuth: 0 },
      ],
    });
    expect(overPrism.reason).toBe('pitch_times_gable_span');
    // 0.5 × 20 × (20 / 2) × (6 / 12) on each gable end.
    expect(overPrism.gableAreaSqft).toBe(100);
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          wall_face: 'back', wall_width_ft: 40, eave_height_ft: 18,
          siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 100 }],
          openings: [
            { observation_id: 'window_1', type: 'window', width_ft: 12, height_ft: 16, pos_x: 6, pos_y: 8, material: 'siding' },
          ],
        },
        {
          wall_face: 'back', wall_width_ft: 38, eave_height_ft: 18,
          siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 100 }],
          openings: [
            { observation_id: 'window_1', type: 'window', width_ft: 5, height_ft: 7, pos_x: 2.5, pos_y: 13, material: 'siding' },
          ],
        },
      ],
      wallHeightFt: 18,
      grossWallAreaSqft: 40 * 18,
      perimeterFt: 40,
      faceWidthsFt: widths,
    });
    const backWindows = graph.opening_groups.filter((group) => group.face === 'back' && group.type === 'window');
    expect(backWindows).toHaveLength(2);
  });

  it('clamps an implausible opening to the standard class nearest its aspect', () => {
    const face = (openings, extra = {}) => ({
      wall_face: 'front',
      wall_width_ft: 40,
      eave_height_ft: 18,
      siding_material: 'vinyl',
      material_regions: [{ material: 'vinyl', percent: 100 }],
      openings,
      ...extra,
    });
    const areas = (openings, extra = {}) => buildSidingMeasurementGraph({
      perPhotoResults: [face(openings, extra)],
      wallHeightFt: 10,
      grossWallAreaSqft: 400,
      perimeterFt: 40,
      faceWidthsFt: { front: 40 },
      faceEaveFt: { front: 10 },
    }).opening_groups;
    const portrait = areas([
      { type: 'window', width_ft: 12, height_ft: 16, pos_x: 8, pos_y: 6 },
    ]);
    expect(portrait[0].width_ft).toBe(3);
    expect(portrait[0].height_ft).toBe(5);
    expect(portrait[0].area_sqft).toBe(15);
    const kept = areas([
      { type: 'window', width_ft: 3, height_ft: 5, pos_x: 8, pos_y: 6 },
      { type: 'window', width_ft: 2, height_ft: 4, pos_x: 20, pos_y: 6 },
    ]);
    expect(kept.map((group) => group.area_sqft).sort((a, b) => a - b)).toEqual([8, 15]);
    const singleGarage = areas([
      { type: 'garage_door', width_ft: 12, height_ft: 9, pos_x: 10, pos_y: 4 },
    ]);
    expect(singleGarage[0].width_ft).toBe(9);
    expect(singleGarage[0].height_ft).toBe(7);
    const doubleGarage = areas([
      { type: 'garage_door', width_ft: 20, height_ft: 8, pos_x: 12, pos_y: 4 },
    ]);
    expect(doubleGarage[0].width_ft).toBe(16);
    expect(doubleGarage[0].height_ft).toBe(7);
    const entry = areas([
      { type: 'entry_door', width_ft: 6, height_ft: 10, pos_x: 8, pos_y: 4 },
    ]);
    expect(entry[0].width_ft).toBe(3);
    expect(entry[0].height_ft).toBe(6.8);
    const scaled = areas([
      { type: 'entry_door', width_ft: 6, height_ft: 14, pos_x: 6, pos_y: 7 },
      { type: 'window', width_ft: 16, height_ft: 20, pos_x: 18, pos_y: 8 },
      { type: 'window', width_ft: 14, height_ft: 18, pos_x: 30, pos_y: 8 },
    ]);
    const scaledWindows = scaled.filter((group) => group.type === 'window');
    expect(scaledWindows).toHaveLength(2);
    expect(scaledWindows.every((group) => group.area_sqft === 15)).toBe(true);
    expect(scaled.find((group) => group.type === 'entry_door').height_ft).toBeCloseTo(6.8, 1);
    const shuttered = areas([
      {
        observation_id: 'window_a',
        type: 'window',
        width_ft: 7,
        height_ft: 5,
        pos_x: 10,
        pos_y: 5,
      },
    ], {
      shutters_detail: [{ window_observation_id: 'window_a', width_in: 36, height_in: 60 }],
    });
    expect(shuttered[0].width_ft).toBe(3);
    expect(shuttered[0].height_ft).toBe(5);
    const doubled = buildSidingMeasurementGraph({
      perPhotoResults: [face([
        { type: 'garage_door', width_ft: 16, height_ft: 7, pos_x: 12, pos_y: 3.5, material: 'siding' },
        { type: 'window', width_ft: 2, height_ft: 1.5, pos_x: 12, pos_y: 3, material: 'siding' },
      ], { garage_doors_count: 2, windows_count: 1 })],
      wallHeightFt: 10,
      grossWallAreaSqft: 400,
      perimeterFt: 40,
      faceWidthsFt: { front: 40 },
    });
    expect(doubled.opening_groups.filter((group) => group.type === 'garage_door')).toHaveLength(1);
    expect(doubled.opening_groups.filter((group) => group.type === 'window')).toHaveLength(0);
    const counted = buildSidingMeasurementGraph({
      perPhotoResults: [{
        wall_face: 'front',
        wall_width_ft: 30,
        eave_height_ft: 10,
        garage_doors_count: 1,
        siding_material: 'vinyl',
        material_regions: [{ material: 'vinyl', percent: 100 }],
      }],
      wallHeightFt: 10,
      grossWallAreaSqft: 300,
      perimeterFt: 30,
    });
    const syntheticGarage = counted.opening_groups.find((group) => group.type === 'garage_door');
    expect(syntheticGarage.width_ft).toBe(9);
    expect(syntheticGarage.height_ft).toBe(7);
    const vent = areas([
      { type: 'vent', width_ft: 1, height_ft: 0.75, pos_x: 4, pos_y: 8 },
      { type: 'window', width_ft: 3, height_ft: 5, pos_x: 16, pos_y: 6 },
    ]);
    expect(vent.find((group) => group.type === 'vent').area_sqft).toBe(0.75);
  });

  it('gives the same gross every time the same recording is built', () => {
    const widths = faceWidthsFromFootprint(rectangle, 180);
    const photos = [
      { wall_face: 'front', wall_width_ft: 55, eave_height_ft: 18.4, windows_count: 3, siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 100 }] },
      { wall_face: 'back', wall_width_ft: 30, eave_height_ft: 17.2, windows_count: 2, siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 100 }] },
      { wall_face: 'left_side', wall_width_ft: 22, eave_height_ft: 19.1, siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 80 }, { material: 'brick', percent: 20 }] },
    ];
    const input = {
      perPhotoResults: photos,
      wallHeightFt: snapHouseEaveFt(medianPhotoEaveFt(photos)),
      grossWallAreaSqft: widths.perimeter_ft * 18,
      perimeterFt: widths.perimeter_ft,
      faceWidthsFt: widths,
      gableByFace: gableAreaFromPitch({
        bearings: widths.bearings,
        widths,
        pitch: '6/12',
        roofFacets: [
          { area_sqft: 800, azimuth: 180, pitch: '6/12' },
          { area_sqft: 780, azimuth: 0, pitch: '6/12' },
        ],
      }).byFace,
    };
    const grosses = [0, 1, 2].map(() => buildSidingMeasurementGraph(input).totals.gross_wall_area_sqft);
    expect(grosses[0]).toBe(grosses[1]);
    expect(grosses[1]).toBe(grosses[2]);
    expect(grosses[0]).toBeGreaterThan(0);
  });

  it('bills an unphotographed face from the house mix and keeps its corners', () => {
    const widths = faceWidthsFromFootprint(rectangle, 180);
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          wall_face: 'front',
          wall_width_ft: 40,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
          openings: [{ type: 'window', width_ft: 3, height_ft: 5 }],
        },
        {
          wall_face: 'back',
          wall_width_ft: 40,
          eave_height_ft: 10,
          non_siding_material: 'brick',
          non_siding_pct: 100,
          material_regions: [{ material: 'brick', percent: 100 }],
          openings: [{ type: 'window', width_ft: 3, height_ft: 5 }],
        },
      ],
      storyCount: 1,
      wallHeightFt: 10,
      grossWallAreaSqft: widths.perimeter_ft * 10,
      perimeterFt: widths.perimeter_ft,
      faceWidthsFt: widths,
    });
    for (const face of ['left_side', 'right_side']) {
      const wall = graph.material_map.faces[face];
      expect(wall.photo_count).toBe(0);
      expect(wall.inferred).toBe(true);
      expect(wall.siding_percent).toBeGreaterThan(40);
      expect(wall.regions.some((region) => region.material === 'unknown')).toBe(false);
      expect(wall.gross_wall_area_sqft).toBeCloseTo(20 * 10, 0);
    }
    const corners = countSidingOutsideCorners({
      polygon: rectangle,
      corners: countFootprintCorners(rectangle, 10),
      materialMap: graph.material_map,
      frontAzimuthDeg: 180,
      wallHeightFt: 10,
    });
    expect(corners.outside_count).toBe(2);
    expect(corners.outside_lf).toBe(20);
  });

  it('bills each outside corner at the shorter adjoining face eave', () => {
    const polygon = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const corners = countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 19),
      materialMap: {
        faces: {
          front: { siding_percent: 100 },
          back: { siding_percent: 100 },
          left_side: { siding_percent: 100 },
          right_side: { siding_percent: 100 },
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 19,
      faceEaveFt: { front: 19, back: 19, left_side: 10, right_side: 10 },
    });
    expect(corners.outside_count).toBe(4);
    expect(corners.outside_lf).toBe(40);
  });

  it('drops a corner where siding meets masonry and shortens a mixed wall', () => {
    const polygon = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const masonryFront = countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 19),
      materialMap: {
        faces: {
          front: { regions: [{ material: 'stone', percent: 47 }, { material: 'stucco', percent: 42 }, { material: 'lap_siding', percent: 11 }] },
          back: { siding_percent: 100 },
          left_side: { siding_percent: 100 },
          right_side: { siding_percent: 100 },
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 19,
    });
    expect(masonryFront.outside_count).toBe(2);
    expect(masonryFront.outside_lf).toBe(38);
    const mixedFront = countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 10),
      materialMap: {
        faces: {
          front: { regions: [{ material: 'brick', percent: 46 }, { material: 'lap_siding', percent: 54 }] },
          back: { siding_percent: 100 },
          left_side: { siding_percent: 100 },
          right_side: { siding_percent: 100 },
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 10,
    });
    expect(mixedFront.outside_count).toBe(4);
    expect(mixedFront.outside_lf).toBe(40);
    const brickSection = {
      material: 'brick',
      polygon: [[0, 0], [0.1, 0], [0.1, 1], [0, 1]],
    };
    const brickFaces = (section) => ({
      front: {
        regions: [{ material: 'brick', percent: 30 }, { material: 'lap_siding', percent: 70 }],
        sections: [section],
      },
      back: { siding_percent: 100 },
      left_side: { siding_percent: 100 },
      right_side: { siding_percent: 100 },
    });
    const countBrick = (section) => countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 10),
      materialMap: { faces: brickFaces(section) },
      frontAzimuthDeg: 180,
      wallHeightFt: 10,
    });
    const unqualified = countBrick(brickSection);
    expect(unqualified.outside_count).toBe(4);
    expect(unqualified.outside_lf).toBe(40);
    const lowConfidence = countBrick({ ...brickSection, corner_photo: true, confidence: 0.5 });
    expect(lowConfidence.outside_count).toBe(4);
    const straightElevation = countBrick({ ...brickSection, corner_photo: false, confidence: 0.95 });
    expect(straightElevation.outside_count).toBe(4);
    const wainscot = countBrick({
      material: 'brick',
      corner_photo: true,
      confidence: 90,
      polygon: [[0, 0.6], [0.1, 0.6], [0.1, 1], [0, 1]],
    });
    expect(wainscot.outside_count).toBe(4);
    const brickAtTheCorner = countBrick({ ...brickSection, corner_photo: true, confidence: 0.8 });
    expect(brickAtTheCorner.outside_count).toBe(3);
    expect(brickAtTheCorner.outside_lf).toBe(30);
    const widths = faceWidthsFromFootprint(polygon, 180);
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          wall_face: 'front',
          wall_width_ft: 40,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          material_regions: [
            { material: 'lap_siding', percent: 70 },
            { material: 'brick', percent: 30 },
          ],
          confidence: 0.4,
          sections: [{
            material: 'brick',
            wall_face: 'front',
            polygon: [[0, 0], [0.1, 0], [0.1, 1], [0, 1]],
          }],
        },
        {
          wall_face: 'back',
          wall_width_ft: 40,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
        },
        {
          wall_face: 'left_side',
          wall_width_ft: 30,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
        },
        {
          wall_face: 'right_side',
          wall_width_ft: 30,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
        },
      ],
      storyCount: 1,
      wallHeightFt: 10,
      grossWallAreaSqft: widths.perimeter_ft * 10,
      perimeterFt: widths.perimeter_ft,
      faceWidthsFt: widths,
    });
    const fromPhotos = countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 10),
      materialMap: graph.material_map,
      frontAzimuthDeg: 180,
      wallHeightFt: 10,
    });
    expect(graph.material_map.faces.front.sections.length).toBeGreaterThan(0);
    expect(fromPhotos.outside_count).toBe(4);
    const cornerGraph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          wall_face: 'front',
          is_corner_shot: true,
          confidence: 0.9,
          wall_width_ft: 40,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          material_regions: [
            { material: 'lap_siding', percent: 70 },
            { material: 'brick', percent: 30 },
          ],
          sections: [{
            material: 'brick',
            wall_face: 'front',
            polygon: [[0, 0], [0.1, 0], [0.1, 1], [0, 1]],
          }],
        },
        {
          wall_face: 'back',
          wall_width_ft: 40,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
        },
        {
          wall_face: 'left_side',
          wall_width_ft: 30,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
        },
        {
          wall_face: 'right_side',
          wall_width_ft: 30,
          eave_height_ft: 10,
          siding_material: 'vinyl',
          material_regions: [{ material: 'vinyl', percent: 100 }],
        },
      ],
      storyCount: 1,
      wallHeightFt: 10,
      grossWallAreaSqft: widths.perimeter_ft * 10,
      perimeterFt: widths.perimeter_ft,
      faceWidthsFt: widths,
    });
    const fromCorner = countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 10),
      materialMap: cornerGraph.material_map,
      frontAzimuthDeg: 180,
      wallHeightFt: 10,
    });
    expect(cornerGraph.material_map.faces.front.sections[0].corner_photo).toBe(true);
    expect(cornerGraph.material_map.faces.front.sections[0].confidence).toBe(0.9);
    expect(fromCorner.outside_count).toBe(3);
  });

  it('drops a corner when both adjoining ends read masonry on a mixed wall', () => {
    const polygon = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const fullHeight = (x0, x1) => ({
      material: 'brick',
      polygon: [[x0, 0], [x1, 0], [x1, 1], [x0, 1]],
    });
    const mixed = (sections) => ({
      regions: [{ material: 'brick', percent: 30 }, { material: 'lap_siding', percent: 70 }],
      sections,
    });
    const count = (faces) => countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 10),
      materialMap: {
        faces: {
          front: { siding_percent: 100 },
          back: { siding_percent: 100 },
          left_side: { siding_percent: 100 },
          right_side: { siding_percent: 100 },
          ...faces,
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 10,
    });
    const oneEnd = count({
      front: mixed([fullHeight(0, 0.1), fullHeight(0.9, 1)]),
    });
    expect(oneEnd.outside_count).toBe(4);
    const bothEnds = count({
      front: mixed([fullHeight(0, 0.1), fullHeight(0.9, 1)]),
      back: mixed([fullHeight(0, 0.1), fullHeight(0.9, 1)]),
      left_side: mixed([fullHeight(0, 0.1), fullHeight(0.9, 1)]),
      right_side: mixed([fullHeight(0, 0.1), fullHeight(0.9, 1)]),
    });
    expect(bothEnds.outside_count).toBe(0);
    expect(bothEnds.outside_lf).toBe(0);
    const wainscot = count({
      front: mixed([{ material: 'brick', polygon: [[0, 0.6], [0.1, 0.6], [0.1, 1], [0, 1]] }]),
      left_side: mixed([{ material: 'brick', polygon: [[0.9, 0.6], [1, 0.6], [1, 1], [0.9, 1]] }]),
    });
    expect(wainscot.outside_count).toBe(4);
  });

  it('drops a corner when a confirmed face is mostly masonry or the end share is under half', () => {
    const polygon = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const confirmed = (siding, extra = {}) => ({
      siding_percent: siding,
      material_agreement: { billed_from: 'rep_confirmed' },
      regions: [
        { material: 'brick', percent: 100 - siding },
        { material: 'lap_siding', percent: siding },
      ],
      ...extra,
    });
    const count = (faces) => countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 16),
      materialMap: {
        faces: {
          front: confirmed(100),
          back: confirmed(100),
          left_side: confirmed(100),
          right_side: confirmed(100),
          ...faces,
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 16,
    });
    const mostlyBrick = count({ front: confirmed(30) });
    expect(mostlyBrick.outside_count).toBe(2);
    expect(mostlyBrick.outside_lf).toBe(32);
    const mostlySiding = count({ front: confirmed(70) });
    expect(mostlySiding.outside_count).toBe(4);
    expect(mostlySiding.outside_lf).toBe(64);
    const brickEnd = count({
      front: confirmed(70, {
        end_shares: { start: { siding: 20 }, end: { siding: 80 } },
      }),
    });
    expect(brickEnd.outside_count).toBe(3);
    const unconfirmed = count({
      front: {
        siding_percent: 30,
        regions: [
          { material: 'brick', percent: 70 },
          { material: 'lap_siding', percent: 30 },
        ],
      },
    });
    expect(unconfirmed.outside_count).toBe(4);
  });

  it('keeps a corner where two partly sided faces meet and bills a sliver of siding', () => {
    const polygon = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const confirmed = (siding) => ({
      siding_percent: siding,
      material_agreement: { billed_from: 'rep_confirmed' },
      regions: [
        { material: 'brick', percent: 100 - siding },
        { material: 'lap_siding', percent: siding },
      ],
    });
    const partial = countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 16),
      materialMap: {
        faces: {
          front: confirmed(0),
          back: confirmed(42),
          left_side: confirmed(30),
          right_side: confirmed(32),
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 16,
    });
    // The face with no siding drops the two corners it touches. The other
    // two faces are both under half siding and still meet.
    expect(partial.outside_count).toBe(2);
    expect(partial.outside_lf).toBe(32);
    const sliver = (share) => ({
      regions: [
        { material: 'brick', percent: 100 - share },
        { material: 'lap_siding', percent: share },
      ],
    });
    const allSlivers = countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 16),
      materialMap: {
        faces: {
          front: sliver(14),
          back: sliver(14),
          left_side: sliver(14),
          right_side: sliver(14),
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 16,
    });
    expect(allSlivers.outside_count).toBe(4);
    expect(allSlivers.outside_lf).toBeGreaterThan(0);
    expect(allSlivers.outside_lf).toBeLessThan(16);
  });

  it('bills a split-level corner at the full height of the tall section', () => {
    const polygon = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const faces = {
      front: { siding_percent: 100 },
      back: { siding_percent: 100 },
      left_side: { siding_percent: 100 },
      right_side: { siding_percent: 100 },
    };
    const shared = {
      polygon,
      corners: countFootprintCorners(polygon, 11.2),
      materialMap: { faces },
      frontAzimuthDeg: 180,
      wallHeightFt: 11.2,
      faceEaveFt: { front: 11.2, back: 11.2, left_side: 11.2, right_side: 11.2 },
    };
    const averaged = countSidingOutsideCorners(shared);
    expect(averaged.outside_lf).toBe(45);
    const split = countSidingOutsideCorners({
      ...shared,
      faceStories: { front: 'split', back: 'split', left_side: 'split', right_side: 'split' },
    });
    expect(split.outside_count).toBe(4);
    expect(split.outside_lf).toBe(76);
    const frontOnly = countSidingOutsideCorners({
      ...shared,
      faceStories: { front: 'split' },
    });
    expect(frontOnly.outside_lf).toBe(60);
    const twoStory = countSidingOutsideCorners({
      ...shared,
      faceEaveFt: { front: 19, back: 19, left_side: 19, right_side: 19 },
      wallHeightFt: 19,
      faceStories: { front: 2, back: 2, left_side: 2, right_side: 2 },
    });
    expect(twoStory.outside_lf).toBe(76);
  });

  it('adds outline corners on a jogged footprint and not on a four-corner ring', () => {
    const footprint = [[0, 0], [40, 0], [40, 12], [28, 12], [28, 20], [0, 20]];
    const outline = [[0, 0], [40, 0], [40, 8], [52, 8], [52, 16], [40, 16], [40, 24], [28, 24], [28, 20], [0, 20]];
    const wallRing = countFootprintCorners(footprint, 19);
    expect(wallRing.outside_count).toBeGreaterThan(4);
    expect(cornersFromFacetOutline(outline, 19, wallRing, footprint.length)).toBeNull();
    const billed = countSidingOutsideCorners({
      polygon: footprint,
      outlinePolygon: outline,
      corners: wallRing,
      materialMap: {
        faces: {
          front: { siding_percent: 100 },
          back: { siding_percent: 100 },
          left_side: { siding_percent: 100 },
          right_side: { siding_percent: 100 },
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 19,
    });
    expect(billed.bump_out_corners).toBeGreaterThan(0);
    expect(billed.outside_count).toBe(wallRing.outside_count + billed.bump_out_corners);
    expect(billed.outside_lf).toBe((wallRing.outside_count + billed.bump_out_corners) * 19);
    const sameOutline = countSidingOutsideCorners({
      polygon: outline,
      outlinePolygon: outline,
      corners: countFootprintCorners(outline, 19),
      materialMap: {
        faces: {
          front: { siding_percent: 100 },
          back: { siding_percent: 100 },
          left_side: { siding_percent: 100 },
          right_side: { siding_percent: 100 },
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 19,
    });
    expect(sameOutline.bump_out_corners || 0).toBe(0);
    const rectangle = [[0, 0], [40, 0], [40, 20], [0, 20]];
    const noisyOutline = [[0, 0], [40, 0], [40, 4], [36, 4], [36, 8], [32, 8], [32, 20], [0, 20]];
    const plain = countSidingOutsideCorners({
      polygon: rectangle,
      outlinePolygon: noisyOutline,
      corners: countFootprintCorners(rectangle, 10),
      materialMap: {
        faces: {
          front: { siding_percent: 100 },
          back: { siding_percent: 100 },
          left_side: { siding_percent: 100 },
          right_side: { siding_percent: 100 },
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 10,
    });
    expect(plain.bump_out_corners || 0).toBe(0);
    expect(plain.outside_count).toBe(4);
  });

  it('keeps a jogged footprint corner count when the roof trace has more vertices', () => {
    const ring = [[0, 0], [40, 0], [40, 12], [28, 12], [28, 20], [0, 20]];
    const wallRing = countFootprintCorners(ring, 19);
    expect(wallRing.outside_count).toBeGreaterThan(4);
    const outline = cornersFromFacetOutline(
      [[0, 0], [40, 0], [40, 4], [36, 4], [36, 8], [32, 8], [32, 12], [28, 12], [28, 20], [0, 20]],
      19,
      wallRing,
      ring.length,
    );
    expect(outline).toBeNull();
    const rectangleRing = countFootprintCorners([[0, 0], [40, 0], [40, 20], [0, 20]], 19);
    const raised = cornersFromFacetOutline(
      [[0, 0], [40, 0], [40, 12], [28, 12], [28, 4], [16, 4], [16, 12], [8, 12], [8, 24], [0, 24]],
      19,
      rectangleRing,
      4,
    );
    expect(raised).toBeNull();
  });

  it('bills gambrel sides at one story only when two photos show the pair', () => {
    const pair = (face) => ({
      wall_face: face,
      roof_planes: [
        { face, pitch: '5/12' },
        { face, pitch: '18/12' },
      ],
    });
    const eaves = faceEavesFt({
      houseEaveFt: 19,
      storyCount: 2,
      bearings: { front: 270, back: 90, left_side: 0, right_side: 180 },
      gableFaces: ['front', 'back', 'left_side', 'right_side'],
      roofFacets: [
        { area_sqft: 200, azimuth: 90, pitch: '20/12' },
      ],
      perPhotoResults: [pair('back'), pair('back')],
    });
    expect(eaves.eaves.left_side).toBe(10);
    expect(eaves.eaves.right_side).toBe(10);
    expect(eaves.eaves.front).toBe(14.5);
    expect(eaves.eaves.back).toBe(14.5);
    expect(eaves.oneStoryFaces.sort()).toEqual(['left_side', 'right_side']);
    const onePhoto = faceEavesFt({
      houseEaveFt: 19,
      storyCount: 2,
      gableFaces: ['front'],
      bearings: { front: 270, back: 90, left_side: 0, right_side: 180 },
      roofFacets: [
        { area_sqft: 200, azimuth: 0, pitch: '20/12', elevation_offset_ft: -8 },
      ],
      perPhotoResults: [pair('back')],
    });
    expect(onePhoto.oneStoryFaces).toEqual([]);
    expect(onePhoto.gambrelEnds).toEqual([]);
    expect(onePhoto.eaves.front).toBe(19);
    expect(onePhoto.eaves.left_side).toBe(19);
    expect(onePhoto.eaves.right_side).toBe(19);
    expect(onePhoto.eaves.back).toBe(19);
    const lowered = faceEavesFt({
      houseEaveFt: 19,
      storyCount: 2,
      bearings: { front: 270, back: 90, left_side: 0, right_side: 180 },
      roofFacets: [
        { area_sqft: 200, azimuth: 90, pitch: '6/12', elevation_offset_ft: -8 },
      ],
      perPhotoResults: [pair('back'), pair('back')],
    });
    expect(lowered.eaves.back).toBeLessThan(14.5);
    expect(lowered.eaves.back).toBeGreaterThanOrEqual(8);
    expect(faceEavesFt({
      houseEaveFt: 19,
      storyCount: 2,
      perPhotoResults: [{ wall_face: 'left_side', roof_pitch_detected: '12/12' }],
    }).oneStoryFaces).toEqual([]);
    const widths = { front: 32.12, back: 32.12, left_side: 26.15, right_side: 26.14 };
    const gross = (['front', 'back', 'left_side', 'right_side']
      .reduce((sum, face) => sum + widths[face] * eaves.eaves[face], 0)) + 40.73;
    expect(gross).toBeGreaterThan(1400);
    expect(gross).toBeLessThan(1600);
  });

  it('scales each face from a door or the ruler before the story guess', () => {
    const measured = houseEaveFt({
      storyCount: 2,
      storyReads: [2, 2, 2],
      medianEaveFt: 19,
      perPhotoResults: [
        { wall_face: 'front', height_method: 'door_anchor', eave_height_ft: 11.4, window_rows: 2, doors_count: 1 },
        { wall_face: 'back', height_method: 'door_scale', eave_height_ft: 11.6, window_rows: 2, doors_count: 1 },
        { wall_face: 'right_side', height_method: 'door_anchor', eave_height_ft: 11.5, window_rows: 2, doors_count: 1 },
      ],
    });
    expect(measured.eaveFt).toBe(16);
    expect(measured.source).toMatch(/door_ruler/);
    const oneStory = houseEaveFt({
      storyCount: 1,
      storyReads: [1, 1, 1],
      perPhotoResults: [
        { wall_face: 'front', height_method: 'door_anchor', eave_height_ft: 12.8, doors_count: 1 },
        { wall_face: 'back', height_method: 'door_scale', eave_height_ft: 13.5, doors_count: 1 },
      ],
    });
    expect(oneStory.eaveFt).toBe(12);
    const tall = houseEaveFt({
      storyCount: 2,
      storyReads: [2, 2],
      perPhotoResults: [
        { wall_face: 'front', height_method: 'door_anchor', eave_height_ft: 22, doors_count: 1, window_rows: 2 },
        { wall_face: 'back', height_method: 'door_scale', eave_height_ft: 23.5, doors_count: 1, window_rows: 2 },
      ],
    });
    expect(tall.eaveFt).toBe(21);
    const split = houseEaveFt({
      storyCount: 1,
      storyReads: [1, 2, 1, 2],
      perPhotoResults: [
        { wall_face: 'front', height_method: 'door_anchor', eave_height_ft: 11.2, doors_count: 1, window_rows: 2 },
        { wall_face: 'back', height_method: 'door_scale', eave_height_ft: 11.6, doors_count: 1, window_rows: 2 },
        { wall_face: 'left_side', height_method: 'garage_door_anchor', eave_height_ft: 13.2, garage_doors_count: 1, window_rows: 2 },
      ],
    });
    expect(split.eaveFt).toBe(11.5);
    expect(split.references).not.toContain(13);
    const missingVotes = houseEaveFt({ storyCount: 2, storyReads: [], medianEaveFt: 11.1 });
    expect(missingVotes.uncertain).toBe(true);
    expect(missingVotes.eaveFt).toBe(11);
    const eaves = faceEavesFt({
      houseEaveFt: 19,
      storyCount: 2,
      perPhotoResults: [
        { wall_face: 'front', height_method: 'door_anchor', eave_height_ft: 11.4, window_rows: 2, doors_count: 1 },
        {
          wall_face: 'left_side',
          height_method: 'garage_door_anchor',
          eave_height_ft: 8.4,
          window_rows: 1,
          garage_doors_count: 1,
          is_one_story_wing: true,
        },
      ],
    });
    expect(eaves.eaves.front).toBe(16);
    expect(eaves.eaves.back).toBe(16);
    expect(eaves.eaves.right_side).toBe(16);
    expect(eaves.eaves.left_side).toBe(16);
    expect(eaves.references).toEqual([
      expect.objectContaining({ face: 'front', eaveFt: 16, source: 'door_scale', kind: 'entry', wing: false }),
    ]);
    const noisyFace = faceEavesFt({
      houseEaveFt: 18,
      storyCount: 2,
      storyReads: [2, 2, 2],
      perPhotoResults: [
        { wall_face: 'right_side', height_method: 'door_anchor', eave_height_ft: 14, doors_count: 1, window_rows: 2 },
        { wall_face: 'right_side', height_method: 'door_scale', eave_height_ft: 9.5, doors_count: 1, window_rows: 2 },
        { wall_face: 'front', height_method: 'door_anchor', eave_height_ft: 18.2, doors_count: 1, window_rows: 2 },
        { wall_face: 'front', height_method: 'door_scale', eave_height_ft: 17.4, doors_count: 1, window_rows: 2 },
      ],
    });
    expect(noisyFace.eaves.front).toBe(18);
    expect(noisyFace.eaves.right_side).toBe(noisyFace.eaves.back);
    expect(noisyFace.references.map((row) => row.face).sort()).toEqual(['front', 'front', 'right_side', 'right_side']);
    const ruler = faceEavesFt({
      houseEaveFt: 19,
      storyCount: 2,
      perPhotoResults: [{
        wall_face: 'front',
        manually_calibrated: true,
        eave_height_ft: 12.2,
        height_method: 'manual_calibration',
        window_rows: 2,
      }],
    });
    expect(ruler.eaves.front).toBe(12);
    expect(ruler.references[0].source).toBe('ruler');
    // The one-story garage sits on the front and must not pull that wall down.
    const sharedFront = faceEavesFt({
      houseEaveFt: 19,
      storyCount: 2,
      perPhotoResults: [
        { wall_face: 'front', height_method: 'door_anchor', eave_height_ft: 19, window_rows: 2, doors_count: 1 },
        { wall_face: 'front', height_method: 'door_scale', eave_height_ft: 17, window_rows: 2, doors_count: 1 },
        { wall_face: 'front', height_method: 'garage_door_anchor', eave_height_ft: 8, garage_doors_count: 1, window_rows: 2 },
        { wall_face: 'front', height_method: 'garage_door_anchor', eave_height_ft: 9.67, garage_doors_count: 1, window_rows: 2 },
      ],
    });
    expect(sharedFront.eaves.front).toBe(18);
    expect(sharedFront.eaves.back).toBe(18);
    const frontRefs = sharedFront.references.filter((row) => row.face === 'front');
    expect(frontRefs.map((row) => row.eaveFt).sort()).toEqual([17, 19]);
    expect(frontRefs.every((row) => row.kind === 'entry')).toBe(true);
    const lowerGarage = houseEaveFt({
      storyCount: 2,
      storyReads: [2, 2, 2],
      medianEaveFt: 20.5,
      perPhotoResults: [
        {
          wall_face: 'front',
          height_method: 'garage_door_anchor',
          eave_height_ft: 20.5,
          garage_doors_count: 1,
          window_rows: 2,
          story_count: 2,
          openings: [{ type: 'garage_door', pos_y: 3.5, height_ft: 7 }],
        },
        {
          wall_face: 'left_side',
          height_method: 'course_count',
          eave_height_ft: 11.2,
          window_rows: 1,
          story_count: 1,
          openings: [{ type: 'entry_door', pos_y: 11, height_ft: 6.8 }],
        },
        {
          wall_face: 'back',
          height_method: 'estimate',
          eave_height_ft: 11,
          story_count: 1,
        },
      ],
    });
    expect(lowerGarage.eaveFt).toBe(11);
    expect(lowerGarage.eaveFt).toBeLessThan(16);
    expect(lowerGarage.source).toMatch(/main_floor/);
    const lowerFaces = faceEavesFt({
      houseEaveFt: lowerGarage.eaveFt,
      storyCount: 2,
      storyReads: [2, 2, 2],
      perPhotoResults: [
        {
          wall_face: 'front',
          height_method: 'garage_door_anchor',
          eave_height_ft: 20.5,
          garage_doors_count: 1,
          window_rows: 2,
          story_count: 2,
          openings: [{ type: 'garage_door', pos_y: 3.5, height_ft: 7 }],
        },
        {
          wall_face: 'left_side',
          height_method: 'course_count',
          eave_height_ft: 11.2,
          window_rows: 1,
          story_count: 1,
          openings: [{ type: 'entry_door', pos_y: 11, height_ft: 6.8 }],
        },
      ],
    });
    expect(lowerFaces.eaves.front).toBe(11);
    expect(lowerFaces.eaves.back).toBe(11);
    expect(lowerFaces.eaves.left_side).toBe(11);
    expect(lowerFaces.eaves.right_side).toBe(11);
    expect(lowerFaces.references.some((row) => /garage/.test(String(row.kind)))).toBe(false);
    expect(lowerFaces.references).toEqual([
      expect.objectContaining({ face: 'left_side', eaveFt: 11, source: 'main_floor' }),
    ]);
    const sameGrade = houseEaveFt({
      storyCount: 2,
      storyReads: [2, 2],
      perPhotoResults: [{
        wall_face: 'front',
        height_method: 'garage_door_anchor',
        eave_height_ft: 18,
        garage_doors_count: 1,
        window_rows: 2,
        openings: [
          { type: 'garage_door', pos_y: 3.5, height_ft: 7 },
          { type: 'entry_door', pos_y: 3.4, height_ft: 6.8 },
        ],
      }],
    });
    expect(sameGrade.eaveFt).toBe(18);
    const garageOnly = houseEaveFt({
      storyCount: 2,
      storyReads: [2, 2, 2],
      medianEaveFt: 20.5,
      perPhotoResults: [{
        wall_face: 'front',
        height_method: 'garage_door_anchor',
        eave_height_ft: 20.5,
        garage_doors_count: 1,
        window_rows: 2,
        story_count: 2,
        openings: [
          { type: 'garage_door', pos_y: 3.5, height_ft: 7 },
          { type: 'entry_door', pos_y: 11, height_ft: 6.8 },
        ],
      }],
    });
    expect(garageOnly.eaveFt).toBe(0);
    expect(garageOnly.suppressTwoStoryFloor).toBe(true);
    expect(garageOnly.source).not.toMatch(/19ft/);
  });
});

describe('a confirmed face height overrides the AI eave', () => {
  const ai = {
    eaves: { front: 16, back: 16, left_side: 16, right_side: 16 },
    gambrelEnds: [],
    references: [{ face: 'front', eaveFt: 16, source: 'door_scale', kind: 'entry' }],
    source: 'door_ruler',
  };

  it('maps 1, 2, split, and a ruler eave', () => {
    const one = applyConfirmedFaceHeights(ai, {
      front: { stories: 1, source: 'tap' },
    });
    expect(one.eaves.front).toBe(10);
    expect(one.eaves.back).toBe(16);
    expect(one.confirmed.front).toEqual({ stories: 1, eave_ft: 10, source: 'tap' });
    const two = applyConfirmedFaceHeights(ai, {
      left_side: { stories: 2, source: 'tap' },
    });
    expect(two.eaves.left_side).toBe(19);
    const split = applyConfirmedFaceHeights(ai, {
      back: { stories: 'split', source: 'tap' },
    });
    expect(split.eaves.back).toBe(11);
    const edited = applyConfirmedFaceHeights(ai, {
      back: { stories: 'split', eave_ft: 12.4, source: 'tap' },
    });
    expect(edited.eaves.back).toBe(12.4);
    const ruler = applyConfirmedFaceHeights(ai, {
      front: { stories: 2, eave_ft: 20.5, source: 'ruler' },
    });
    expect(ruler.eaves.front).toBe(20.5);
    expect(ruler.eaves.back).toBe(16);
    expect(ruler.aiEaves.front).toBe(16);
  });

  it('sets a 1.5 side to 10 ft and the gable ends to the silhouette', () => {
    const side = applyConfirmedFaceHeights(ai, {
      front: { stories: 1.5, source: 'tap' },
    });
    expect(side.eaves.front).toBe(10);
    expect(side.eaves.back).toBe(10);
    expect(side.eaves.left_side).toBe(14.5);
    expect(side.eaves.right_side).toBe(14.5);
    const end = applyConfirmedFaceHeights(ai, {
      front: { stories: 1.5, source: 'tap' },
    }, { gableFaces: ['front', 'back'] });
    expect(end.eaves.front).toBe(14.5);
    expect(end.eaves.back).toBe(14.5);
    expect(end.eaves.left_side).toBe(10);
    expect(end.eaves.right_side).toBe(10);
    const measured = applyConfirmedFaceHeights(ai, {
      front: { stories: 1.5, eave_ft: 9.2, source: 'ruler' },
    });
    expect(measured.eaves.front).toBe(9.2);
    expect(measured.eaves.left_side).toBe(16);
  });

  it('bills wall gross, corners, and net from the confirmed eaves', () => {
    const locked = applyConfirmedFaceHeights(ai, {
      front: { stories: 1, source: 'tap' },
      back: { stories: 1, source: 'tap' },
      left_side: { stories: 1, source: 'tap' },
      right_side: { stories: 1, source: 'tap' },
    });
    const widths = { front: 40, back: 40, left_side: 30, right_side: 30 };
    const body = ['front', 'back', 'left_side', 'right_side']
      .reduce((sum, face) => sum + widths[face] * locked.eaves[face], 0);
    const gross = cappedWallGross({
      perimeterFt: 140,
      wallHeightFt: 16,
      gableSqft: 40,
      bodySqft: body,
    });
    expect(body).toBe(1400);
    expect(gross).toBe(1440);
    const polygon = [[0, 0], [40, 0], [40, 30], [0, 30]];
    const corners = countSidingOutsideCorners({
      polygon,
      corners: countFootprintCorners(polygon, 16),
      materialMap: {
        faces: {
          front: { siding_percent: 100 },
          back: { siding_percent: 100 },
          left_side: { siding_percent: 100 },
          right_side: { siding_percent: 100 },
        },
      },
      frontAzimuthDeg: 180,
      wallHeightFt: 16,
      faceEaveFt: locked.eaves,
    });
    expect(corners.outside_count).toBe(4);
    expect(corners.outside_lf).toBe(40);
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        { wall_face: 'front', wall_width_ft: 40, eave_height_ft: 16, siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 60 }, { material: 'brick', percent: 40 }] },
        { wall_face: 'back', wall_width_ft: 40, eave_height_ft: 16, siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 100 }] },
        { wall_face: 'left_side', wall_width_ft: 30, eave_height_ft: 16, siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 100 }] },
        { wall_face: 'right_side', wall_width_ft: 30, eave_height_ft: 16, siding_material: 'vinyl', material_regions: [{ material: 'vinyl', percent: 100 }] },
      ],
      storyCount: 2,
      wallHeightFt: 10,
      grossWallAreaSqft: gross,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
      faceWidthsFt: widths,
      faceEaveFt: locked.eaves,
      gableByFace: { front: 40 },
    });
    fitFacesToGross(graph.material_map, gross);
    applyBilledWallIdentity(graph, gross);
    const totals = graph.totals;
    expect(totals.gross_wall_area_sqft).toBe(gross);
    expect(totals.net_siding_area_sqft).toBe(
      totals.gross_wall_area_sqft - totals.masonry_area_sqft - totals.opening_deduction_sqft,
    );
  });

  it('bills confirmed shares on the whole face, including gable that was only on the headline', () => {
    const widths = { front: 40, back: 40, left_side: 20, right_side: 20, perimeter_ft: 120 };
    const eaves = { front: 14, back: 14, left_side: 14, right_side: 14 };
    const body = 120 * 14;
    const gable = 400;
    const headline = body + gable;
    const confirmed = (face, shares) => ({
      wall_face: face,
      wall_width_ft: widths[face],
      eave_height_ft: 14,
      siding_material: 'vinyl',
      face_materials: {
        [face]: {
          confirmed: true,
          billed_from: 'rep_confirmed',
          sample_count: 3,
          shares,
        },
      },
      openings: face === 'front'
        ? [{ type: 'window', width_ft: 3, height_ft: 5, pos_x: 8, pos_y: 6, material: 'siding' }]
        : [],
    });
    const shares = { stone: 0, stucco: 0, brick: 80, siding: 20 };
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        confirmed('front', shares),
        confirmed('back', shares),
        confirmed('left_side', shares),
        confirmed('right_side', shares),
        {
          wall_face: 'front',
          wall_width_ft: 40,
          eave_height_ft: 14,
          siding_material: 'vinyl',
          face_materials: {
            front: {
              billed_from: 'face_sample_median',
              shares: { stone: 0, stucco: 0, brick: 0, siding: 100 },
            },
          },
        },
      ],
      wallHeightFt: 14,
      grossWallAreaSqft: body,
      perimeterFt: 120,
      faceWidthsFt: widths,
      faceEaveFt: eaves,
    });
    expect(graph.material_map.faces.front.siding_percent).toBeCloseTo(20, 0);
    fitFacesToGross(graph.material_map, headline);
    applyBilledWallIdentity(graph, headline);
    const facade = Object.values(graph.material_map.faces)
      .reduce((sum, face) => sum + face.gross_wall_area_sqft * (face.siding_percent / 100), 0);
    const openingsOnSiding = graph.totals.opening_deduction_sqft;
    expect(Math.abs(
      graph.totals.net_siding_area_sqft - (facade - openingsOnSiding),
    )).toBeLessThanOrEqual(1);
    expect(graph.totals.siding_facade_area_sqft).toBeCloseTo(headline * 0.2, 0);
    expect(graph.totals.siding_facade_area_sqft).toBeLessThan(body * 0.2 + gable);
    expect(openingsOnSiding).toBeGreaterThan(0);
    const onTheFace = buildSidingMeasurementGraph({
      perPhotoResults: ['front', 'back', 'left_side', 'right_side'].map((face) => confirmed(face, shares)),
      wallHeightFt: 14,
      grossWallAreaSqft: headline,
      perimeterFt: 120,
      faceWidthsFt: widths,
      faceEaveFt: eaves,
      gableByFace: { front: 200, back: 200 },
    });
    fitFacesToGross(onTheFace.material_map, headline);
    applyBilledWallIdentity(onTheFace, headline);
    const faceFacade = Object.values(onTheFace.material_map.faces)
      .reduce((sum, face) => sum + face.gross_wall_area_sqft * (face.siding_percent / 100), 0);
    expect(Math.abs(
      onTheFace.totals.net_siding_area_sqft - (faceFacade - onTheFace.totals.opening_deduction_sqft),
    )).toBeLessThanOrEqual(1);
    expect(onTheFace.totals.siding_facade_area_sqft).toBeCloseTo(headline * 0.2, 0);
  });

  it('builds mode C from Hover wall area over width plus confirmed materials', () => {
    const modeC = confirmedModeC({
      walls: [
        { face: 'front', area_sqft: 440, width_ft: 40 },
        { face: 'left_side', area_sqft: 570, width_ft: 30 },
      ],
      materials: {
        front: { shares: { siding: 70, brick: 30, stone: 0, stucco: 0 } },
        back: { confirmed: true, shares: { siding: 100, brick: 0, stone: 0, stucco: 0 } },
      },
    });
    expect(modeC.confirmed_face_heights.front).toEqual({
      stories: 'split',
      eave_ft: 11,
      source: 'ruler',
    });
    expect(modeC.confirmed_face_heights.left_side.eave_ft).toBe(19);
    expect(modeC.confirmed_face_heights.left_side.stories).toBe(2);
    expect(modeC.confirmed_face_materials.front.confirmed).toBe(true);
    expect(modeC.confirmed_face_materials.front.shares.brick).toBe(30);
    expect(modeC.confirmed_face_materials.back.shares.siding).toBe(100);
    const billed = applyConfirmedFaceHeights(ai, modeC.confirmed_face_heights);
    expect(billed.eaves.front).toBe(11);
    expect(billed.eaves.left_side).toBe(19);
    expect(billed.eaves.back).toBe(16);
  });
});

describe('course counts use the reveal and leave the gable out of the eave', () => {
  it('counts cedar courses by the 7 inch reveal, not the 8 inch board or a 0.9 factor', () => {
    const reveal = resolveVerticalScale('cedar_lap', 30);
    expect(reveal).toBeCloseTo(30 * 7 / 12, 5);
    expect(reveal).not.toBeCloseTo(30 * 8 / 12, 5);
    expect(reveal).not.toBeCloseTo(30 * 8 / 12 * 0.9, 5);
    // An echoed 8" is the old board width, so it does not override the reveal.
    expect(resolveVerticalScale('cedar_lap', 30, false, 8)).toBeCloseTo(reveal, 5);
    expect(resolveVerticalScale('vinyl_4', 24, false, 3.5)).toBeCloseTo(24 * 3.5 / 12, 5);
    expect(resolveVerticalScale('vinyl_4', 24, false, 8)).toBeCloseTo(24 * 4 / 12, 5);
    expect(resolveVerticalScale('vinyl_4', 24, false, 10)).toBeCloseTo(24 * 4 / 12, 5);
    expect(resolveVerticalScale('vinyl_5', 20, false, 8)).toBeCloseTo(20 * 5 / 12, 5);
    expect(resolveVerticalScale('fiber_cement', 20, false, 8.25)).toBeCloseTo(20 * 5 / 12, 5);
    expect(installedRevealIn('cedar_lap', 6)).toBe(6);
    expect(resolveVerticalScale('vinyl_5', 20)).toBeCloseTo(20 * 5 / 12, 5);
    expect(resolveVerticalScale('board_batten', 12, true)).toBeCloseTo(80 / 12, 5);
  });

  it('subtracts a gable rise only when the course count ran up the triangle', () => {
    expect(eaveFromCourseCount({
      courseFt: 20,
      namedEaveFt: 16,
      gableRiseFt: 4,
      hasGable: true,
    })).toBe(16);
    // The named eave already matches the courses, so the triangle is not removed twice.
    expect(eaveFromCourseCount({
      courseFt: 16,
      namedEaveFt: 16,
      gableRiseFt: 4,
      hasGable: true,
    })).toBe(16);
    expect(eaveFromCourseCount({
      courseFt: 18,
      namedEaveFt: 18,
      gableRiseFt: 0,
      hasGable: false,
    })).toBe(18);
  });

  it('keeps wall height that already includes the gable out of the billed eave', () => {
    expect(eaveExcludingGable({ wall_height_ft: 20, gable_rise_ft: 4 })).toBe(16);
    expect(eaveExcludingGable({
      eave_height_ft: 16,
      wall_height_ft: 20,
      gable_rise_ft: 4,
    })).toBe(16);
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [
        {
          view_label: 'Front',
          wall_face: 'front',
          wall_width_ft: 40,
          wall_height_ft: 20,
          gable_rise_ft: 4,
          has_gable_end: true,
          siding_material: 'vinyl',
        },
        { view_label: 'Back', wall_face: 'back', wall_width_ft: 40, eave_height_ft: 16, siding_material: 'vinyl' },
        { view_label: 'Left', wall_face: 'left_side', wall_width_ft: 30, eave_height_ft: 16, siding_material: 'vinyl' },
        { view_label: 'Right', wall_face: 'right_side', wall_width_ft: 30, eave_height_ft: 16, siding_material: 'vinyl' },
      ],
      storyCount: 1,
      wallHeightFt: 16,
      grossWallAreaSqft: 40 * 16 + (40 * 4) / 2 + 40 * 16 + 30 * 16 * 2,
      perimeterFt: 140,
      buildingWidthFt: 40,
      buildingLengthFt: 30,
    });
    const front = graph.wall_facets.find((facet) => facet.face === 'front');
    expect(front.eave_height_ft).toBe(16);
    expect(front.wall_height_ft).toBe(20);
    // Rectangle is the eave. The gable is the triangle, not a second copy of the rise.
    expect(graph.totals.photo_wall_area_sqft).toBeCloseTo(40 * 16 + (40 * 4) / 2 + 40 * 16 + 30 * 16 * 2, 0);
    const plugin = fs.readFileSync(path.join(process.cwd(), 'vite-functions-plugin.js'), 'utf8');
    expect(plugin).toContain('course_count × 7" ÷ 12 = eave ft');
    expect(plugin).toContain('eaveFromCourseCount');
    expect(plugin).not.toContain('courseBasedEave * 0.9');
    expect(plugin).not.toContain('course_count × 8');
  });
});

describe('gemini photo timeout retry', () => {
  it('retries a timed-out photo read once and does not retry other errors', async () => {
    expect(isGeminiTimeout(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))).toBe(true);
    expect(isGeminiTimeout(new Error('bad json'))).toBe(false);
    const waits = [];
    let calls = 0;
    const recovered = await retryTimedOutPhotoRead(() => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('timed out');
        err.name = 'TimeoutError';
        throw err;
      }
      return { wall_width_ft: 40 };
    }, { wait: async (ms) => { waits.push(ms); } });
    expect(recovered.retried).toBe(true);
    expect(recovered.value.wall_width_ft).toBe(40);
    expect(waits).toEqual([2000]);

    const attempts = [];
    await retryTimedOutPhotoRead((attempt) => {
      attempts.push(attempt?.retry === true);
      if (!attempt?.retry) {
        const err = new Error('timed out');
        err.name = 'TimeoutError';
        throw err;
      }
      return { ok: true };
    }, { wait: async () => {} });
    expect(attempts).toEqual([false, true]);

    const { PNG } = await import('pngjs');
    const png = new PNG({ width: 80, height: 40 });
    png.data.fill(255);
    const original = PNG.sync.write(png);
    const shrunk = shrinkPhotoForRetry(original.toString('base64'), 'image/png');
    expect(shrunk.shrunk).toBe(true);
    expect(shrunk.bytes).toBeLessThan(original.length);
    expect(shrunk.width).toBeLessThan(80);
    expect(shrunk.mimeType).toBe('image/png');
    await expect(retryTimedOutPhotoRead(() => {
      throw new Error('bad json');
    }, { wait: async () => { throw new Error('should not wait'); } })).rejects.toThrow('bad json');
  });
});
