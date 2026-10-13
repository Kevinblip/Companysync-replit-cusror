import { describe, it, expect } from 'vitest';
import {
  XACTIMATE_PER_CLAIM_KEYS,
  stripPerClaimKeys,
  reseedXactimateOptsForCustomer,
  DEFAULT_EXPORT_OPTIONS,
} from '../utils/xactimatePdfAdapter.js';

// ---------------------------------------------------------------------------
// These cover the AIEstimator "Xactimate PDF" dialog glue that is NOT part of
// the HTML template / adapter math:
//   • openXactimateDialog() re-seeds per-claim fields from the CURRENT customer
//     each time the dialog opens (no cross-customer leak).
//   • only reusable prefs — never claim-specific data — are persisted to
//     localStorage (via stripPerClaimKeys).
// ---------------------------------------------------------------------------

// A realistic in-memory opts object AFTER a previous customer's export: it has
// leftover per-claim data (claim/policy/insurer/loss/dates/deductible) plus the
// operator's reusable preferences.
const PREV_OPTS = {
  ...DEFAULT_EXPORT_OPTIONS,
  // reusable prefs the operator set for the PREVIOUS export
  includeOP: true,
  overheadPct: 15,
  profitPct: 12,
  taxPct: 8.25,
  includeDepreciation: true,
  depMode: 'agelife',
  age: 5,
  life: 20,
  sectionLabel: 'Roof + Gutters',
  priceList: 'TXDA8X_JAN26',
  // per-claim data belonging to the PREVIOUS customer — must NOT carry over
  claimNumber: 'PREV-CLAIM-111',
  policyNumber: 'PREV-POLICY-222',
  insuranceCompany: 'Old Insurer Co',
  typeOfLoss: 'Hail',
  dateOfLoss: '2025-01-01',
  dateInspected: '2025-02-01',
  deductible: 2500,
};

describe('XACTIMATE_PER_CLAIM_KEYS', () => {
  it('lists exactly the seven per-claim fields', () => {
    expect([...XACTIMATE_PER_CLAIM_KEYS].sort()).toEqual(
      [
        'claimNumber',
        'dateInspected',
        'dateOfLoss',
        'deductible',
        'insuranceCompany',
        'policyNumber',
        'typeOfLoss',
      ].sort()
    );
  });
});

describe('reseedXactimateOptsForCustomer (no cross-customer leak)', () => {
  it('replaces claim/insurer from the current customer and blanks the rest', () => {
    const currentCustomer = {
      claim_number: 'NEW-CLAIM-999',
      insurance_company: 'State Farm',
    };
    const next = reseedXactimateOptsForCustomer(PREV_OPTS, currentCustomer);

    // seeded from the CURRENT customer record
    expect(next.claimNumber).toBe('NEW-CLAIM-999');
    expect(next.insuranceCompany).toBe('State Farm');

    // the remaining per-claim fields are reset to empty defaults for the operator
    expect(next.policyNumber).toBe('');
    expect(next.typeOfLoss).toBe('');
    expect(next.dateOfLoss).toBe('');
    expect(next.dateInspected).toBe('');
    expect(next.deductible).toBe(0);
  });

  it('does NOT leak the previous customer claim/policy/insurer/deductible', () => {
    const currentCustomer = { claim_number: '', insurance_company: '' };
    const next = reseedXactimateOptsForCustomer(PREV_OPTS, currentCustomer);

    expect(next.claimNumber).not.toBe('PREV-CLAIM-111');
    expect(next.policyNumber).not.toBe('PREV-POLICY-222');
    expect(next.insuranceCompany).not.toBe('Old Insurer Co');
    expect(next.typeOfLoss).not.toBe('Hail');
    expect(next.dateOfLoss).not.toBe('2025-01-01');
    expect(next.dateInspected).not.toBe('2025-02-01');
    expect(next.deductible).not.toBe(2500);

    // with an empty customer record every per-claim field is blank/zero
    expect(next.claimNumber).toBe('');
    expect(next.insuranceCompany).toBe('');
    expect(next.deductible).toBe(0);
  });

  it('preserves the operator reusable preferences across the reseed', () => {
    const next = reseedXactimateOptsForCustomer(PREV_OPTS, {
      claim_number: 'C-1',
      insurance_company: 'Allstate',
    });

    expect(next.includeOP).toBe(true);
    expect(next.overheadPct).toBe(15);
    expect(next.profitPct).toBe(12);
    expect(next.taxPct).toBe(8.25);
    expect(next.includeDepreciation).toBe(true);
    expect(next.depMode).toBe('agelife');
    expect(next.age).toBe(5);
    expect(next.life).toBe(20);
    expect(next.sectionLabel).toBe('Roof + Gutters');
    expect(next.priceList).toBe('TXDA8X_JAN26');
  });

  it('tolerates a missing / null customer object', () => {
    expect(() => reseedXactimateOptsForCustomer(PREV_OPTS)).not.toThrow();
    const nullCust = reseedXactimateOptsForCustomer(PREV_OPTS, null);
    expect(nullCust.claimNumber).toBe('');
    expect(nullCust.insuranceCompany).toBe('');
    expect(nullCust.deductible).toBe(0);
  });

  it('does not mutate the input opts object', () => {
    const snapshot = JSON.parse(JSON.stringify(PREV_OPTS));
    reseedXactimateOptsForCustomer(PREV_OPTS, { claim_number: 'X', insurance_company: 'Y' });
    expect(PREV_OPTS).toEqual(snapshot);
  });
});

describe('stripPerClaimKeys (localStorage persistence guard)', () => {
  it('removes exactly the per-claim keys so claim data is never persisted', () => {
    const stripped = stripPerClaimKeys(PREV_OPTS);
    for (const key of XACTIMATE_PER_CLAIM_KEYS) {
      expect(stripped).not.toHaveProperty(key);
    }
  });

  it('keeps reusable preferences that SHOULD persist', () => {
    const stripped = stripPerClaimKeys(PREV_OPTS);
    expect(stripped.includeOP).toBe(true);
    expect(stripped.overheadPct).toBe(15);
    expect(stripped.taxPct).toBe(8.25);
    expect(stripped.depMode).toBe('agelife');
    expect(stripped.sectionLabel).toBe('Roof + Gutters');
    expect(stripped.priceList).toBe('TXDA8X_JAN26');
  });

  it('does not mutate the input opts object', () => {
    const snapshot = JSON.parse(JSON.stringify(PREV_OPTS));
    stripPerClaimKeys(PREV_OPTS);
    expect(PREV_OPTS).toEqual(snapshot);
  });

  it('round-trips: a stripped-then-restored opts object carries no claim data', () => {
    // simulates: persist stripped opts → later reload → merge with defaults
    const persisted = stripPerClaimKeys(PREV_OPTS);
    const restored = { ...DEFAULT_EXPORT_OPTIONS, ...stripPerClaimKeys(JSON.parse(JSON.stringify(persisted))) };
    expect(restored.claimNumber).toBe('');
    expect(restored.policyNumber).toBe('');
    expect(restored.insuranceCompany).toBe('');
    expect(restored.deductible).toBe(0);
    // reusable prefs survived the round-trip
    expect(restored.overheadPct).toBe(15);
    expect(restored.taxPct).toBe(8.25);
  });
});
