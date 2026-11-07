import { describe, expect, it } from 'vitest';
import {
  buildingContainingPoint,
  pitchFactorFromLabel,
  resolveFootprintPitchArea,
  ringFromLatLngGeometry,
  ringPlanSqFt,
} from '../../functions/utils/roofFootprintArea.js';

const SQM_TO_SQFT = 10.7639;
const PITCH_7_12 = Math.atan(7 / 12) * 180 / Math.PI;
const FACTOR_7_12 = Math.sqrt(1 + (7 / 12) ** 2);

function solarResponse({ slopeSqFt, groundSqFt, segments = 7, pitchDegrees = PITCH_7_12, hoverSqFt = null }) {
  const segs = Array.from({ length: segments }, () => ({
    pitchDegrees,
    azimuthDegrees: 180,
    stats: {
      areaMeters2: (slopeSqFt / segments) / SQM_TO_SQFT,
      groundAreaMeters2: (groundSqFt / segments) / SQM_TO_SQFT,
    },
  }));
  return {
    imageryDate: { year: 2024, month: 6, day: 1 },
    hoverReportSqFt: hoverSqFt,
    solarPotential: {
      wholeRoofStats: {
        areaMeters2: slopeSqFt / SQM_TO_SQFT,
        groundAreaMeters2: groundSqFt / SQM_TO_SQFT,
      },
      roofSegmentStats: segs,
    },
  };
}

describe('footprint × pitch when Solar covers only part of the building', () => {
  const footprint = [[0, 0], [40, 0], [40, 80], [0, 80]];

  it('bills the footprint times the 7/12 factor and refuses a Hover quantity', () => {
    expect(ringPlanSqFt(footprint)).toBe(3200);
    expect(pitchFactorFromLabel('7/12')).toBeCloseTo(FACTOR_7_12, 6);

    const solar = solarResponse({
      slopeSqFt: 1438,
      groundSqFt: 1242,
      hoverSqFt: 3997,
    });
    const decision = resolveFootprintPitchArea({
      solar,
      footprintPolygon: footprint,
      pitchLabel: '7/12',
      imageryTakeoffRan: false,
    });

    expect(decision.use_footprint_pitch).toBe(true);
    expect(decision.area_method).toBe('footprint_x_pitch');
    expect(decision.area_sqft).toBe(Math.round(3200 * FACTOR_7_12));
    expect(decision.area_sqft).not.toBe(1438);
    expect(decision.area_sqft).not.toBe(3997);
    expect(decision.solar_coverage_ratio).toBeLessThan(0.75);
    expect(decision.measurement_ready).toBe(false);
    expect(decision.confidence).toBe('low');
    expect(decision.reason).toBe('imagery_takeoff_not_run');
    expect(decision.imagery_takeoff_ran).toBe(false);
  });

  it('still uses the footprint when a takeoff ran but Solar is far short of it', () => {
    const decision = resolveFootprintPitchArea({
      solar: solarResponse({ slopeSqFt: 1438, groundSqFt: 1242 }),
      footprintPlanSqFt: 3200,
      pitchLabel: '7/12',
      imageryTakeoffRan: true,
    });
    expect(decision.use_footprint_pitch).toBe(true);
    expect(decision.area_sqft).toBe(Math.round(3200 * FACTOR_7_12));
    expect(decision.reason).toBe('solar_far_under_footprint');
    expect(decision.measurement_ready).toBe(false);
    expect(decision.confidence).toBe('low');
  });

  it('keeps Solar when the slope already covers the outline even if the ground plan looks short', () => {
    // Roesing: Solar slope was about 7% under a roof the outline already describes.
    // Ground from the drawn planes is short, which used to bill the outline again.
    const decision = resolveFootprintPitchArea({
      solar: solarResponse({ slopeSqFt: 930, groundSqFt: 700, segments: 6, pitchDegrees: PITCH_7_12 }),
      footprintPlanSqFt: 1000,
      pitchLabel: '7/12',
      imageryTakeoffRan: false,
    });
    expect(decision.use_footprint_pitch).toBe(false);
    expect(decision.area_sqft).toBe(930);
    expect(decision.area_method).toBe('solar');
    expect(decision.reason).toBe('solar_covers_footprint');
    expect(decision.area_sqft).not.toBe(Math.round(1000 * FACTOR_7_12));
  });

  it('keeps a Solar model that already covers the footprint when no takeoff ran', () => {
    const decision = resolveFootprintPitchArea({
      solar: solarResponse({ slopeSqFt: 2500, groundSqFt: 3000, segments: 4, pitchDegrees: 22.62 }),
      footprintPlanSqFt: 3200,
      pitchLabel: '5/12',
      imageryTakeoffRan: false,
    });
    expect(decision.solar_coverage_ratio).toBeGreaterThan(0.9);
    expect(decision.use_footprint_pitch).toBe(false);
    expect(decision.area_method).toBe('solar');
    expect(decision.reason).toBe('solar_covers_footprint');
    expect(decision.confidence).toBe('standard');
    expect(decision.measurement_ready).toBeNull();
  });

  it('bills the outline under the pin when Solar measured a different building', () => {
    const houseSolar = solarResponse({ slopeSqFt: 1350, groundSqFt: 1166 });
    const kept = resolveFootprintPitchArea({
      solar: houseSolar,
      footprintPlanSqFt: 548,
      pitchLabel: '7/12',
    });
    expect(kept.use_footprint_pitch).toBe(false);
    expect(kept.area_sqft).toBe(1350);

    const decision = resolveFootprintPitchArea({
      solar: houseSolar,
      footprintPlanSqFt: 548,
      pitchLabel: '7/12',
      solarOnDifferentBuilding: true,
    });
    expect(decision.use_footprint_pitch).toBe(true);
    expect(decision.reason).toBe('solar_measured_other_building');
    expect(decision.area_sqft).toBe(Math.round(548 * FACTOR_7_12));
    expect(decision.area_sqft).not.toBe(1350);
    expect(decision.area_sqft).not.toBe(860);
    expect(decision.measurement_ready).toBe(false);

    const flatHouse = resolveFootprintPitchArea({
      solar: houseSolar,
      footprintPlanSqFt: 548,
      pitchLabel: '1/12',
      solarOnDifferentBuilding: true,
      pitchKnown: false,
    });
    expect(flatHouse.pitch_unknown).toBe(true);
    expect(flatHouse.pitch_factor).toBeNull();
    expect(flatHouse.area_sqft).toBe(548);
    expect(flatHouse.area_sqft).not.toBe(Math.round(548 * Math.sqrt(1 + (1 / 12) ** 2)));
    expect(flatHouse.area_sqft).not.toBe(1350);
    expect(flatHouse.reason).toBe('solar_measured_other_building');
    expect(flatHouse.measurement_ready).toBe(false);
  });

  it('does not invent a footprint when Solar is the only source', () => {
    const decision = resolveFootprintPitchArea({
      solar: solarResponse({ slopeSqFt: 1438, groundSqFt: 1242 }),
      pitchLabel: '7/12',
      imageryTakeoffRan: false,
    });
    expect(decision.use_footprint_pitch).toBe(false);
    expect(decision.reason).toBe('no_footprint');
    expect(decision.area_sqft).not.toBe(3997);
  });
});

describe('the footprint under the pin, not the largest nearby way', () => {
  const house = [
    { lat: 41.5000, lon: -81.5500 },
    { lat: 41.5000, lon: -81.5496 },
    { lat: 41.5004, lon: -81.5496 },
    { lat: 41.5004, lon: -81.5500 },
  ];
  const school = [
    { lat: 41.5040, lon: -81.5600 },
    { lat: 41.5040, lon: -81.5560 },
    { lat: 41.5080, lon: -81.5560 },
    { lat: 41.5080, lon: -81.5600 },
  ];

  it('selects the building that contains the coordinate', () => {
    const chosen = buildingContainingPoint(
      [{ el: { geometry: school } }, { el: { geometry: house } }],
      41.5002,
      -81.5498,
    );
    expect(chosen.el.geometry).toBe(house);
    const houseRing = ringFromLatLngGeometry(house);
    const schoolRing = ringFromLatLngGeometry(school);
    expect(houseRing.areaSqFt).toBeGreaterThan(500);
    expect(houseRing.areaSqFt).toBeLessThan(schoolRing.areaSqFt);
    expect(ringPlanSqFt(houseRing.xy)).toBeCloseTo(houseRing.areaSqFt, 4);
  });
});
