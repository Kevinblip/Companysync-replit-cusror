import { describe, expect, it } from 'vitest';
import {
  ROOF_WASTE_RULES,
  applyWasteToLineItems,
  orderQuantity,
  suggestRoofWaste,
  suggestSidingWaste,
  suggestTradeWaste,
} from './wasteFactor.js';

describe('suggestRoofWaste', () => {
  it('keeps a simple gable at the 10% standard', () => {
    const result = suggestRoofWaste({
      roof_type: 'gable',
      num_segments: 2,
      hip_lf: 0,
      valley_lf: 0,
      pitch: '6/12',
      roof_area_sqft: 2200,
    });
    expect(result.percent).toBe(ROOF_WASTE_RULES.basePercent);
    expect(result.percent).toBeGreaterThanOrEqual(10);
    expect(result.reason).toBe('Simple gable -> 10% (standard)');
  });

  it('raises waste for a hip roof with many facets and hip/valley length', () => {
    const result = suggestRoofWaste({
      roof_type: 'hip',
      num_segments: 9,
      hip_lf: 100,
      valley_lf: 40,
      pitch: '6/12',
      roof_area_sqft: 4000,
    });
    expect(result.percent).toBe(14);
    expect(result.reason).toBe('Hip roof, 9 facets, 140 LF hips/valleys -> 14%');
  });

  it('adds waste for steep pitch and high hip/valley density, and never suggests below 10%', () => {
    const steep = suggestRoofWaste({
      roof_type: 'gable',
      num_segments: 2,
      pitch: '12/12',
      roof_area_sqft: 1800,
    });
    expect(steep.percent).toBe(13);
    expect(steep.reason).toContain('12/12 pitch');

    const dense = suggestRoofWaste({
      roof_type: 'hip',
      num_segments: 4,
      hip_lf: 80,
      valley_lf: 80,
      pitch: '5/12',
      roof_area_sqft: 1500,
    });
    expect(dense.percent).toBeGreaterThan(10);
    expect(dense.reason).toContain('Hip roof');
    expect(dense.reason).toContain('LF hips/valleys');

    const flat = suggestRoofWaste({ roof_type: 'gable', pitch: '0/12', num_segments: 1 });
    expect(flat.percent).toBeGreaterThanOrEqual(10);
  });

  it('counts dormers and cut-up sections above the simple-gable base', () => {
    const result = suggestRoofWaste({
      roof_type: 'gable',
      num_segments: 2,
      pitch: '6/12',
      dormer_count: 2,
      cut_up_sections: 1,
      roof_area_sqft: 2400,
    });
    expect(result.percent).toBe(13);
    expect(result.reason).toContain('2 dormers');
    expect(result.reason).toContain('1 cut-up section');
  });
});

describe('suggestSidingWaste', () => {
  it('uses a 10% standard when openings, corners, and gables are simple', () => {
    const result = suggestSidingWaste({
      outside_corners_count: 4,
      opening_deduction_pct: 10,
      gable_area_sqft: 0,
      wall_area_sqft: 1600,
    });
    expect(result.percent).toBe(10);
    expect(result.reason).toBe('Simple walls -> 10% (standard)');
  });

  it('increases for openings, corners, and gables from that base', () => {
    const result = suggestSidingWaste({
      outside_corners_count: 8,
      opening_deduction_pct: 18,
      gable_area_sqft: 180,
      wall_area_sqft: 2000,
    });
    expect(result.percent).toBe(13);
    expect(result.reason).toContain('18% openings');
    expect(result.reason).toContain('8 corners');
    expect(result.reason).toContain('gables');
    expect(result.percent).toBeGreaterThanOrEqual(10);
  });

  it('gives other trades the same factors and their own standard-base reason', () => {
    const result = suggestTradeWaste('gutters', {
      outside_corners_count: 4,
      opening_deduction_pct: 10,
    });
    expect(result.trade).toBe('other');
    expect(result.percent).toBe(10);
    expect(result.reason).toBe('Simple scope -> 10% (standard)');
  });
});

describe('applyWasteToLineItems', () => {
  const shingle = {
    code: 'LAMINATED_COMP_SH',
    description: 'Laminated comp shingles',
    quantity: 22.71,
    unit: 'SQ',
    rate: 100,
    rcv: 2271,
    acv: 2271,
    amount: 2271,
  };
  const felt = {
    code: 'ROOFING_FELT',
    description: 'Roofing felt',
    quantity: 22.71,
    unit: 'SQ',
    rate: 20,
    rcv: 454.2,
    acv: 454.2,
    amount: 454.2,
  };
  const starter = {
    code: 'RFG STR',
    description: 'Starter strip, 3-tab asphalt',
    quantity: 160,
    unit: 'LF',
    rate: 2.5,
    rcv: 400,
    acv: 400,
    amount: 400,
  };
  const ridge = {
    code: 'RFG RDC',
    description: 'Ridge cap, architectural asphalt',
    quantity: 40,
    unit: 'LF',
    rate: 8.5,
    rcv: 340,
    acv: 340,
    amount: 340,
  };
  const pipe = {
    code: 'RFG PB',
    description: 'Pipe boot / jack flashing',
    quantity: 3,
    unit: 'EA',
    rate: 35,
    rcv: 105,
    acv: 105,
    amount: 105,
  };

  it('uses one percent for shingles, felt, starter, and ridge, and does not stack', () => {
    const once = applyWasteToLineItems([shingle, felt, starter, ridge, pipe], 15, { trade: 'roof' });
    expect(once[0].quantity).toBe(orderQuantity(22.71, 15));
    expect(once[1].quantity).toBe(orderQuantity(22.71, 15));
    expect(once[2].quantity).toBe(orderQuantity(160, 15));
    expect(once[3].quantity).toBe(orderQuantity(40, 15));
    expect(once[4].quantity).toBe(3);

    const retargeted = applyWasteToLineItems(once, 10, { trade: 'roof' });
    expect(retargeted[0].quantity).toBe(orderQuantity(22.71, 10));
    expect(retargeted[1].quantity).toBe(orderQuantity(22.71, 10));
    expect(retargeted[0].quantity).not.toBe(orderQuantity(once[0].quantity, 10));
  });

  it('matches card order quantity for the same base and percent', () => {
    const base = 22.71;
    const percent = suggestRoofWaste({
      roof_type: 'gable',
      num_segments: 2,
      pitch: '6/12',
      roof_area_sq: base,
      roof_area_sqft: base * 100,
    }).percent;
    const cardQty = orderQuantity(base, percent);
    const [line] = applyWasteToLineItems([shingle], percent, { trade: 'roof' });
    expect(percent).toBe(10);
    expect(line.quantity).toBe(cardQty);
    expect(cardQty).toBe(24.98);
  });
});
