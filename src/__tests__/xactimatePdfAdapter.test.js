import { describe, it, expect } from 'vitest';
import {
  buildXactimateDataFromAIEstimator,
  isMaterialLine,
  computeDepPct,
} from '../utils/xactimatePdfAdapter.js';
import { generateXactimateHTML } from '../utils/insuranceEstimateTemplates.js';

const SHINGLE = { description: 'Architectural shingle - remove & replace', quantity: 10, unit: 'SQ', rate: 100 };
const TEAROFF = { description: 'Remove existing roof covering - composition', quantity: 10, unit: 'SQ', rate: 85, code: 'ARMV' };
const DEBRIS = { description: 'Haul debris to dumpster', quantity: 1, unit: 'EA', rate: 300 };

describe('isMaterialLine', () => {
  it('treats a remove & replace shingle line as material', () => {
    expect(isMaterialLine(SHINGLE)).toBe(true);
  });
  it('treats a pure tear-off/removal line as non-material', () => {
    expect(isMaterialLine(TEAROFF)).toBe(false);
  });
  it('treats debris haul/disposal as non-material', () => {
    expect(isMaterialLine(DEBRIS)).toBe(false);
  });
});

describe('computeDepPct', () => {
  it('returns 0 when depreciation is disabled', () => {
    expect(computeDepPct({ includeDepreciation: false, depPct: 40 })).toBe(0);
  });
  it('returns the flat dep% when in flat mode', () => {
    expect(computeDepPct({ includeDepreciation: true, depMode: 'flat', depPct: 25 })).toBe(25);
  });
  it('computes age/life ratio as a percentage', () => {
    // 15 / 30 = 0.5 → 50%
    expect(computeDepPct({ includeDepreciation: true, depMode: 'agelife', age: 15, life: 30 })).toBe(50);
  });
  it('caps age/life depreciation at 100%', () => {
    expect(computeDepPct({ includeDepreciation: true, depMode: 'agelife', age: 40, life: 30 })).toBe(100);
  });
  it('returns 0 for age/life when life is zero', () => {
    expect(computeDepPct({ includeDepreciation: true, depMode: 'agelife', age: 10, life: 0 })).toBe(0);
  });
});

describe('buildXactimateDataFromAIEstimator', () => {
  it('maps line items with rcv from qty*rate when absent', () => {
    const { data } = buildXactimateDataFromAIEstimator({ lineItems: [SHINGLE] });
    expect(data.items).toHaveLength(1);
    expect(data.items[0].rcv).toBe(1000);
  });

  it('applies material tax only to material lines', () => {
    const { data } = buildXactimateDataFromAIEstimator({
      lineItems: [SHINGLE, TEAROFF],
      exportOptions: { taxPct: 10 },
    });
    // Shingle (material): 1000 * 10% = 100
    expect(data.items[0].tax).toBeCloseTo(100, 5);
    // Tear-off (labor/removal): no tax
    expect(data.items[1].tax).toBe(0);
  });

  it('applies no tax when taxPct is 0', () => {
    const { data } = buildXactimateDataFromAIEstimator({ lineItems: [SHINGLE], exportOptions: { taxPct: 0 } });
    expect(data.items[0].tax).toBe(0);
  });

  it('sets flat depreciation_percent on material lines only', () => {
    const { data } = buildXactimateDataFromAIEstimator({
      lineItems: [SHINGLE, TEAROFF],
      exportOptions: { includeDepreciation: true, depMode: 'flat', depPct: 20 },
    });
    expect(data.items[0].depreciation_percent).toBe(20);
    expect(data.items[1].depreciation_percent).toBe(0);
  });

  it('sets age/life-derived depreciation and per-line age/life/condition', () => {
    const { data } = buildXactimateDataFromAIEstimator({
      lineItems: [SHINGLE],
      exportOptions: { includeDepreciation: true, depMode: 'agelife', age: 15, life: 30, condition: 'Avg' },
    });
    expect(data.items[0].depreciation_percent).toBe(50);
    expect(data.items[0].age).toBe(15);
    expect(data.items[0].life).toBe(30);
    expect(data.items[0].condition).toBe('Avg');
  });

  it('omits depreciation entirely when disabled', () => {
    const { data, options } = buildXactimateDataFromAIEstimator({
      lineItems: [SHINGLE],
      exportOptions: { includeDepreciation: false, showDepColumns: true, depPct: 30 },
    });
    expect(data.items[0].depreciation_percent).toBe(0);
    // showDepColumns must be forced off when depreciation is disabled
    expect(options.showDepColumns).toBe(false);
  });

  it('sets O&P only when includeOP is true', () => {
    const off = buildXactimateDataFromAIEstimator({ lineItems: [SHINGLE], exportOptions: { includeOP: false, overheadPct: 10, profitPct: 10 } });
    expect(off.data.estimate.overhead_pct).toBe(0);
    expect(off.data.estimate.profit_pct).toBe(0);

    const on = buildXactimateDataFromAIEstimator({ lineItems: [SHINGLE], exportOptions: { includeOP: true, overheadPct: 10, profitPct: 5 } });
    expect(on.data.estimate.overhead_pct).toBe(10);
    expect(on.data.estimate.profit_pct).toBe(5);
  });

  it('passes deductible and claim meta through', () => {
    const { data } = buildXactimateDataFromAIEstimator({
      customerInfo: { customer_name: 'John Doe', property_address: '1 Main St', insurance_company: 'State Farm', claim_number: 'CLM-1' },
      exportOptions: { deductible: 1000, policyNumber: 'POL-9', typeOfLoss: 'Hail' },
    });
    expect(data.estimate.deductible).toBe(1000);
    expect(data.estimate.policy_number).toBe('POL-9');
    expect(data.estimate.type_of_loss).toBe('Hail');
    expect(data.estimate.claim_number).toBe('CLM-1');
    expect(data.estimate.insurance_company).toBe('State Farm');
    expect(data.customer.name).toBe('John Doe');
  });

  it('respects the trade summary toggle', () => {
    expect(buildXactimateDataFromAIEstimator({ lineItems: [SHINGLE] }).options.includeTradeSummary).toBe(true);
    expect(buildXactimateDataFromAIEstimator({ lineItems: [SHINGLE], exportOptions: { includeTradeSummary: false } }).options.includeTradeSummary).toBe(false);
  });

  it('maps measurements from satelliteAnalysis', () => {
    const { data } = buildXactimateDataFromAIEstimator({
      satelliteAnalysis: { roof_area_sqft: 2500, roof_area_sq: 25, ridge_lf: 40 },
    });
    expect(data.measurements.surface_area_sqft).toBe(2500);
    expect(data.measurements.squares).toBe(25);
    expect(data.measurements.ridge_lf).toBe(40);
  });

  // Integration: adapter output flows correctly into the real generator.
  it('produces Xactimate HTML with correct tax + depreciation totals end-to-end', () => {
    const { data, options } = buildXactimateDataFromAIEstimator({
      lineItems: [SHINGLE], // rcv 1000
      exportOptions: { taxPct: 10, includeDepreciation: true, depMode: 'flat', depPct: 20, showDepColumns: true },
    });
    const html = generateXactimateHTML(data, options);
    // rcv 1000 + tax 100 (no O&P) = per-line RCV 1,100; dep 200; ACV = 1,100 − 200 = 900
    expect(html).toContain('100.00'); // material sales tax
    expect(html).toContain('1,100.00'); // per-line RCV folds tax in
    expect(html).toContain('(200.00)'); // per-line depreciation
    expect(html).toContain('900.00'); // per-line ACV reconciles to summary ACV
    expect(html).toContain('AGE/LIFE'); // dep columns rendered
  });
});
