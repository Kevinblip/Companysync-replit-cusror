import { resolveStoredRcv, lineQuantity, lineRate } from './estimateTotals.js';

// ---------------------------------------------------------------------------
// Xactimate PDF adapter
// ---------------------------------------------------------------------------
// Maps the AIEstimator's in-memory state (customerInfo, lineItems,
// satelliteAnalysis, myCompany) into the { company, customer, estimate, items,
// measurements } shape that generateXactimateHTML() expects, applying the
// user-selected export toggles (O&P, material tax, depreciation, deductible,
// trade summary).
//
// Money rules:
//   • tax  = rcv * taxPct/100, applied to MATERIAL lines only (a v1
//            approximation of Xactimate, which taxes materials, not pure
//            labor/removal/disposal lines).
//   • depreciation_percent is set per line so the generator computes
//     ACV = RCV − depreciation itself. We NEVER trust the AIEstimator `acv`
//     field (it currently just mirrors RCV with no depreciation applied).
//   • age/life mode → depreciation_percent = min(age/life, 1) * 100.
//
// Pure functions — unit-testable, no DOM / browser dependencies.
// ---------------------------------------------------------------------------

// Keywords that mark a line as pure labor / removal / disposal (not taxed and
// not depreciated). "Remove & replace" is intentionally NOT here because it
// includes material.
const NON_MATERIAL_KEYWORDS = [
  'tear off', 'tear-off', 'tearoff',
  'remove existing',
  'haul', 'dumpster', 'debris', 'disposal', 'dump fee', 'dump run',
  'labor only', 'labor minimum', 'minimum charge',
];

export function isMaterialLine(item) {
  const hay = `${item?.description || item?.name || ''} ${item?.code || ''}`.toLowerCase();
  return !NON_MATERIAL_KEYWORDS.some((k) => hay.includes(k));
}

// Resolve the effective depreciation percentage from the export options.
export function computeDepPct(opt) {
  if (!opt.includeDepreciation) return 0;
  if (opt.depMode === 'agelife') {
    const age = Number(opt.age) || 0;
    const life = Number(opt.life) || 0;
    if (life <= 0) return 0;
    return Math.min(age / life, 1) * 100;
  }
  return Number(opt.depPct) || 0;
}

export const DEFAULT_EXPORT_OPTIONS = {
  // Overhead & Profit
  includeOP: false,
  overheadPct: 10,
  profitPct: 10,
  // Material sales tax (0 = none)
  taxPct: 0,
  // Depreciation
  includeDepreciation: false,
  showDepColumns: false,
  depMode: 'flat', // 'flat' | 'agelife'
  depPct: 0,
  age: 0,
  life: 0,
  condition: '',
  // Deductible
  deductible: 0,
  // Trade summary page
  includeTradeSummary: true,
  // Xactimate claim meta
  claimNumber: '',
  policyNumber: '',
  insuranceCompany: '',
  typeOfLoss: '',
  priceList: '',
  sectionLabel: 'Roof',
  dateOfLoss: '',
  dateInspected: '',
  preparedBy: '',
  estimateNumber: '',
};

// Per-claim fields that belong to ONE specific customer's insurance claim.
// These must never be persisted to localStorage (they'd leak into the next
// customer's export) and must be re-seeded from the current customer each time
// the export dialog opens.
export const XACTIMATE_PER_CLAIM_KEYS = [
  'claimNumber', 'policyNumber', 'insuranceCompany', 'typeOfLoss',
  'dateOfLoss', 'dateInspected', 'deductible',
];

// Return a copy of `opts` with every per-claim key removed. Used before writing
// export options to localStorage so reusable prefs (toggles, percentages,
// section/price list) persist but claim-specific data never does.
export function stripPerClaimKeys(opts) {
  const out = { ...opts };
  XACTIMATE_PER_CLAIM_KEYS.forEach((k) => { delete out[k]; });
  return out;
}

// Seed the per-claim fields from the CURRENT customer, so one customer's
// claim/policy details never carry over to another's export. Only claimNumber
// and insuranceCompany are pulled from the customer record; the remaining
// per-claim fields are reset to their empty defaults for the operator to fill.
export function reseedXactimateOptsForCustomer(prevOpts, customerInfo = {}) {
  return {
    ...prevOpts,
    claimNumber: customerInfo?.claim_number || '',
    policyNumber: '',
    insuranceCompany: customerInfo?.insurance_company || '',
    typeOfLoss: '',
    dateOfLoss: '',
    dateInspected: '',
    deductible: 0,
  };
}

export function buildXactimateDataFromAIEstimator({
  customerInfo = {},
  lineItems = [],
  satelliteAnalysis = {},
  myCompany = {},
  exportOptions = {},
} = {}) {
  const opt = { ...DEFAULT_EXPORT_OPTIONS, ...exportOptions };

  const depPct = computeDepPct(opt);
  const taxPct = Number(opt.taxPct) || 0;

  const items = (Array.isArray(lineItems) ? lineItems : [])
    .filter((i) => i && typeof i === 'object')
    .map((item) => {
      const qty = lineQuantity(item);
      const rate = lineRate(item);
      // Saved RCV wins, including an intentional $0 carrier line. See resolveStoredRcv.
      const rcv = resolveStoredRcv(item);
      const material = isMaterialLine(item);
      const tax = taxPct > 0 && material ? rcv * (taxPct / 100) : 0;
      const applyDep = opt.includeDepreciation && depPct > 0 && material;

      const out = {
        description: item.description || item.name || '',
        code: item.code || '',
        quantity: qty,
        unit: item.unit || item.uom || 'EA',
        rate,
        rcv,
        tax,
        depreciation_percent: applyDep ? depPct : 0,
      };
      if (applyDep && opt.depMode === 'agelife') {
        out.age = opt.age;
        out.life = opt.life;
      }
      if (applyDep && opt.condition) {
        out.condition = opt.condition;
      }
      return out;
    });

  const company = {
    company_name: myCompany.company_name || myCompany.name || '',
    address:
      myCompany.address ||
      [myCompany.city, myCompany.state, myCompany.zip].filter(Boolean).join(', '),
    phone: myCompany.phone || '',
    contact_name: myCompany.contact_name || '',
    logo_url: myCompany.logo_url || '',
  };

  const customer = {
    name: customerInfo.customer_name || customerInfo.name || '',
    property_address: customerInfo.property_address || '',
    phone: customerInfo.customer_phone || customerInfo.phone || '',
  };

  const estimate = {
    estimate_number: opt.estimateNumber || '',
    claim_number: opt.claimNumber || customerInfo.claim_number || '',
    policy_number: opt.policyNumber || '',
    insurance_company: opt.insuranceCompany || customerInfo.insurance_company || '',
    type_of_loss: opt.typeOfLoss || '',
    price_list: opt.priceList || '',
    deductible: Number(opt.deductible) || 0,
    date_of_loss: opt.dateOfLoss || '',
    date_inspected: opt.dateInspected || '',
    prepared_by: opt.preparedBy || myCompany.contact_name || '',
    section_label: opt.sectionLabel || 'Roof',
    overhead_pct: opt.includeOP ? Number(opt.overheadPct) || 0 : 0,
    profit_pct: opt.includeOP ? Number(opt.profitPct) || 0 : 0,
  };

  const sa = satelliteAnalysis || {};
  const measurements = {
    surface_area_sqft: Number(sa.roof_area_sqft) || Number(sa.surface_area_sqft) || 0,
    squares: Number(sa.roof_area_sq) || Number(sa.squares) || 0,
    perimeter_lf: Number(sa.perimeter_lf) || 0,
    ridge_lf: Number(sa.ridge_lf) || 0,
    hip_lf: Number(sa.hip_lf) || 0,
    valley_lf: Number(sa.valley_lf) || 0,
    eave_lf: Number(sa.eave_lf) || 0,
  };

  return {
    data: { company, customer, estimate, items, measurements },
    options: {
      showDepColumns: opt.includeDepreciation && opt.showDepColumns === true,
      includeTradeSummary: opt.includeTradeSummary !== false,
    },
  };
}
