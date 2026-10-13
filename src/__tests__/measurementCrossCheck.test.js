import { describe, it, expect } from 'vitest';
import {
  crossCheckMeasurements,
  normalizeMeasurement,
  SOURCE_TRUST_ORDER,
} from '../lib/measurementCrossCheck';
import { calculateRealConfidence } from '../lib/satelliteUtils';

const solar = (over = {}) => ({
  roof_area_sq: 30,
  corrected_area_sq: 30,
  ridge_lf: 50,
  hip_lf: 0,
  valley_lf: 20,
  rake_lf: 60,
  eave_lf: 80,
  pitch: '6/12',
  ...over,
});

describe('normalizeMeasurement', () => {
  it('prefers corrected_area_sq over roof_area_sq', () => {
    const n = normalizeMeasurement({ corrected_area_sq: 33, roof_area_sq: 30 });
    expect(n.area_sq).toBe(33);
  });

  it('falls back to roof_area_sqft / 100', () => {
    const n = normalizeMeasurement({ roof_area_sqft: 2800 });
    expect(n.area_sq).toBe(28);
  });

  it('returns null for junk input', () => {
    expect(normalizeMeasurement(null)).toBeNull();
    expect(normalizeMeasurement('x')).toBeNull();
  });

  it('coerces negatives and NaN to 0', () => {
    const n = normalizeMeasurement({ ridge_lf: -5, eave_lf: 'abc', roof_area_sq: 30 });
    expect(n.ridge_lf).toBe(0);
    expect(n.eave_lf).toBe(0);
  });
});

describe('photo measurement confidence', () => {
  it('does not apply pitch correction twice to slope-area photo sources', () => {
    for (const source of ['physical_photos', 'hybrid_photos_satellite']) {
      const result = calculateRealConfidence(solar({ roof_area_sq: 30, corrected_area_sq: 30 }), source);
      expect(result.correctedAreaSq).toBe(30);
    }
  });
});

describe('crossCheckMeasurements', () => {
  it('returns null with fewer than 2 usable sources', () => {
    expect(crossCheckMeasurements({})).toBeNull();
    expect(crossCheckMeasurements({ google_solar: solar() })).toBeNull();
    expect(
      crossCheckMeasurements({ google_solar: solar(), gemini_vision: { note: 'no numbers' } })
    ).toBeNull();
  });

  it('reports agreement when sources are within tolerance', () => {
    const res = crossCheckMeasurements({
      google_solar: solar(),
      gemini_vision: solar({ corrected_area_sq: 30.9, ridge_lf: 52 }),
    });
    expect(res.overall).toBe('agree');
    expect(res.plainSummary).toMatch(/agree/i);
  });

  it('flags "check" for moderate area difference (5-10%)', () => {
    const res = crossCheckMeasurements({
      google_solar: solar(),
      gemini_vision: solar({ corrected_area_sq: 32.2 }), // ~7.3% off
    });
    expect(res.fields.area_sq.flag).toBe('check');
    expect(res.overall).toBe('check');
  });

  it('flags "disagree" for large area difference (>10%)', () => {
    const res = crossCheckMeasurements({
      google_solar: solar(),
      gemini_vision: solar({ corrected_area_sq: 36 }), // 20% off
    });
    expect(res.fields.area_sq.flag).toBe('disagree');
    expect(res.overall).toBe('disagree');
    expect(res.plainSummary).toMatch(/disagree/i);
  });

  it('uses trust order — uploaded report is the baseline over solar', () => {
    const res = crossCheckMeasurements({
      google_solar: solar({ corrected_area_sq: 36 }),
      uploaded_report: { roof_area_sqft: 3000, ridge_lf: 50, eave_lf: 80, pitch: '6/12' },
    });
    expect(res.recommendedSource).toBe('uploaded_report');
    // delta measured against report's 30 SQ: (36-30)/30 = 20%
    expect(res.fields.area_sq.deltaPct).toBeCloseTo(20, 0);
  });

  it('compares pitch via multiplier, not string equality', () => {
    const near = crossCheckMeasurements({
      google_solar: solar({ pitch: '6/12' }),
      gemini_vision: solar({ pitch: '7/12' }), // multipliers 1.118 vs 1.158 → ~3.6%
    });
    expect(near.fields.pitch.flag).toBe('agree');

    const far = crossCheckMeasurements({
      google_solar: solar({ pitch: '6/12' }),
      gemini_vision: solar({ pitch: '9/12' }), // 1.118 vs 1.250 → ~11.8%
    });
    expect(far.fields.pitch.flag).toBe('disagree');
  });

  it('flags significant zero vs non-zero mismatches', () => {
    const res = crossCheckMeasurements({
      google_solar: solar({ valley_lf: 30 }),
      gemini_vision: solar({ valley_lf: 0 }),
    });
    expect(res.fields.valley_lf.flag).toBe('disagree');
  });

  it('ignores insignificant zero vs non-zero mismatches', () => {
    const res = crossCheckMeasurements({
      google_solar: solar({ valley_lf: 6, hip_lf: 0 }),
      gemini_vision: solar({ valley_lf: 0, hip_lf: 0 }),
    });
    expect(res.fields.valley_lf).toBeUndefined();
    expect(res.fields.hip_lf).toBeUndefined();
  });

  it('handles 3 sources and reports the worst delta', () => {
    const res = crossCheckMeasurements({
      uploaded_report: { roof_area_sq: 30, ridge_lf: 50, eave_lf: 80, pitch: '6/12' },
      google_solar: solar({ corrected_area_sq: 31 }),
      gemini_vision: solar({ corrected_area_sq: 36 }),
    });
    expect(res.sources).toEqual(['uploaded_report', 'google_solar', 'gemini_vision']);
    expect(res.fields.area_sq.deltaPct).toBeCloseTo(20, 0);
  });

  it('trust order constant is stable', () => {
    expect(SOURCE_TRUST_ORDER).toEqual([
      'uploaded_report',
      'manual_drawing',
      'physical_photos',
      'hybrid_photos_satellite',
      'google_solar',
      'gemini_vision',
    ]);
  });
});
