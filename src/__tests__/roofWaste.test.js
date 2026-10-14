import { describe, expect, it } from 'vitest';
import { roofWasteRecommendation } from '../utils/roofWaste';

describe('roofWasteRecommendation', () => {
  it('keeps a plain gable at 10%', () => {
    expect(roofWasteRecommendation({ roof_type: 'gable', pitch: '4/12', num_segments: 2 })).toEqual({
      pct: 10,
      reason: '10% — gable, simple',
    });
  });

  it('stays at 10% when nothing has been measured yet', () => {
    expect(roofWasteRecommendation(null)).toEqual({
      pct: 10,
      reason: '10% — gable, simple',
    });
  });

  it('rises for hips and valleys, facets, pitch, dormers, and material', () => {
    const result = roofWasteRecommendation({
      roof_type: 'complex',
      hip_lf: 40,
      valley_lf: 22,
      num_segments: 9,
      pitch: '10/12',
      dormer_count: 2,
      roof_material: 'slate',
    });
    expect(result.pct).toBeGreaterThan(10);
    expect(result.reason).toContain('hips and valleys');
    expect(result.reason).toContain('9 facets');
    expect(result.reason).toContain('10/12 pitch');
    expect(result.reason).toContain('dormers');
    expect(result.reason).toContain('slate');
    expect(result.reason.startsWith(`${result.pct}% — `)).toBe(true);
  });

  it('does not go below the 10% base', () => {
    expect(roofWasteRecommendation({ roof_type: 'gable' }).pct).toBeGreaterThanOrEqual(10);
  });
});
