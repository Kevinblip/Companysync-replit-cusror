import { describe, it, expect } from 'vitest';
import { getPitchMultiplier } from '@/lib/satelliteUtils';
import {
  calculateRoofAreaFromFootprint,
  OVERHANG_FACTOR,
} from '@/utils/companySyncFormulas';

// Satellite utilities supply a slope multiplier for roof-measurement sources.
// Manual footprints instead use calculateRoofAreaFromFootprint below so the
// standard overhang allowance is included before materials are ordered.
describe('getPitchMultiplier', () => {
  it('returns the exact table value for common pitches', () => {
    expect(getPitchMultiplier('4/12')).toBeCloseTo(1.054, 3);
    expect(getPitchMultiplier('6/12')).toBeCloseTo(1.118, 3);
    expect(getPitchMultiplier('7/12')).toBeCloseTo(1.158, 3);
    expect(getPitchMultiplier('12/12')).toBeCloseTo(1.414, 3);
  });

  it('treats a flat roof as no correction', () => {
    expect(getPitchMultiplier('0/12')).toBe(1.0);
    expect(getPitchMultiplier('flat')).toBe(1.0);
  });

  it('computes the multiplier for pitches missing from the table', () => {
    // 20/12 is not in PITCH_MULTIPLIERS → falls back to sqrt(1 + (rise/12)^2)
    expect(getPitchMultiplier('20/12')).toBeCloseTo(Math.sqrt(1 + (20 / 12) ** 2), 5);
  });

  it('falls back to ~6/12 (never flat) for unknown/blank pitch', () => {
    // A missing pitch must still apply SOME slope, or a footprint would be
    // ordered as if the roof were flat.
    expect(getPitchMultiplier('')).toBe(1.118);
    expect(getPitchMultiplier(null)).toBe(1.118);
    expect(getPitchMultiplier('Unknown')).toBe(1.118);
    expect(getPitchMultiplier('garbage')).toBe(1.118);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(getPitchMultiplier(' 7/12 ')).toBeCloseTo(1.158, 3);
    expect(getPitchMultiplier('FLAT')).toBe(1.0);
  });
});

describe('footprint -> pitched area invariant', () => {
  it('pitched square footage equals footprint x multiplier', () => {
    const footprintSqft = 2000;
    const pitch = '7/12';
    const pitchedSqft = footprintSqft * getPitchMultiplier(pitch);
    expect(pitchedSqft).toBeCloseTo(2000 * 1.158, 2);
    // squares = sqft / 100
    expect(pitchedSqft / 100).toBeCloseTo(23.16, 2);
  });

  it('a steeper roof always orders at least as much material as the footprint', () => {
    const footprintSqft = 1500;
    ['4/12', '6/12', '7/12', '9/12', '12/12'].forEach((pitch) => {
      const pitchedSqft = footprintSqft * getPitchMultiplier(pitch);
      expect(pitchedSqft).toBeGreaterThanOrEqual(footprintSqft);
    });
  });
});

describe('manual footprint roof area', () => {
  it('uses the canonical slope and overhang formula', () => {
    const footprintSqft = 1500;
    const pitchRise = 6;
    const expected = Math.round(
      footprintSqft * Math.sqrt(1 + (pitchRise / 12) ** 2) * OVERHANG_FACTOR
    );

    expect(calculateRoofAreaFromFootprint(footprintSqft, pitchRise)).toBe(expected);
  });

  it('does not silently omit the standard overhang allowance', () => {
    const footprintSqft = 2000;
    const pitchRise = 7;
    const pitchOnlyArea = Math.round(
      footprintSqft * Math.sqrt(1 + (pitchRise / 12) ** 2)
    );

    expect(calculateRoofAreaFromFootprint(footprintSqft, pitchRise))
      .toBeGreaterThan(pitchOnlyArea);
  });
});
