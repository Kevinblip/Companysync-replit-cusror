// Faithful HTML reproductions of Xactimate and Symbility printed estimate output.
// Both functions return a complete, print-ready HTML document string.
import { CODE_ALIASES } from './xactimateExport.js';
import { SYMBILITY_CODE_ALIASES } from './symbilityExport.js';
import { resolveStoredRcv } from './estimateTotals.js';
import {
  calculatePerLineOverheadProfit,
  getOpLineType,
  hasPerLineOverheadProfit,
} from './estimateOpLineItems.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve the two percentages consumed by the insurance templates.
 *
 * EstimateFormat stores O&P as one combined rate for the editor (for example,
 * 20 means 10% overhead + 10% profit), while the printed Xactimate template
 * needs the two components separately. Explicit estimate values win so a
 * saved carrier-specific split is never overwritten by a format default.
 */
export function resolveOverheadProfitPercentages(estimate = {}, format = {}) {
  const explicitOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const overhead = explicitOrNull(estimate.overhead_pct);
  const profit = explicitOrNull(estimate.profit_pct);
  const combinedRate = explicitOrNull(format.overhead_profit_rate);
  const formatIncludesOp = format.show_overhead_profit === true || format.show_op_column === true;
  const defaultComponent = formatIncludesOp && combinedRate !== null
    ? combinedRate / 2
    : 0;

  return {
    overhead_pct: overhead ?? defaultComponent,
    profit_pct: profit ?? defaultComponent,
  };
}

function money(v) {
  const n = num(v);
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function plain(v) {
  return num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateFmt(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return esc(String(v));
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

// Saved RCV wins, including an intentional $0 carrier line. See resolveStoredRcv.
function lineRcv(item) {
  return resolveStoredRcv(item);
}

function lineTax(item) {
  return num(item.tax);
}

function lineDepreciation(item) {
  const rcv = lineRcv(item);
  const pct = num(item.depreciation_percent);
  return pct > 0 ? rcv * (pct / 100) : 0;
}

function lineAcv(item) {
  return lineRcv(item) - lineDepreciation(item);
}

function lineUnit(item) {
  return (item.unit || item.uom || 'EA').toUpperCase();
}

function lineDesc(item) {
  return esc(item.description || item.name || '');
}

// ---------------------------------------------------------------------------
// Category detection (Symbility sub-sections and Xactimate sections)
// ---------------------------------------------------------------------------
const CATEGORY_RULES = [
  { name: 'SHINGLES', kw: ['shingle', 'tear off', 'ridge cap', 'hip / ridge', 'hip/ridge', 'ridge / hip', 'starter', 'drip edge', 'valley metal', 'laminated', 'architectural', 'itel', '3-tab', 'dimensional'] },
  { name: 'UNDERLAYMENTS', kw: ['felt', 'underlayment', 'ice & water', 'ice and water', 'synthetic', 'roofing paper', 'self-adhering', 'peel'] },
  { name: 'VENTS AND FLASHINGS', kw: ['vent', 'flashing', 'pipe jack', 'turtle', 'chimney', 'boot', 'turbine', 'ridge vent', 'valley metal', 'step flash', 'counter flash'] },
  { name: 'GUTTER & DOWNSPOUT', kw: ['gutter', 'downspout', 'fascia', 'soffit', 'gutter apron', 'gutter screen', 'gutter guard'] },
  { name: 'SIDING', kw: ['siding', 'j-channel', 'j channel', 'corner trim', 'window/door wrap', 'window wrap', 'door wrap', 'vinyl siding', 'hardie', 'aluminum siding'] },
  { name: 'DEBRIS REMOVAL', kw: ['dumpster', 'debris', 'haul', 'minimum charge', 'disposal', 'dump fee', 'tree removal'] },
];

// ---------------------------------------------------------------------------
// Code-based category resolution
// Derives a CODE_TO_CAT map from the imported CODE_ALIASES (xactimateExport.js)
// and SYMBILITY_CODE_ALIASES (symbilityExport.js) so the mapping stays in sync
// with the export files automatically. Prefix-based rules are the single canonical
// authority on which codes map to which categories — no duplicate tables needed.
// ---------------------------------------------------------------------------

/**
 * Canonical Xactimate-format prefix→category rule.
 * This is the ONLY place that records prefix semantics for Xactimate codes;
 * it is used both to populate CODE_TO_CAT and as a fallback for unlisted codes.
 */
function xactCatByPrefix(prefix, sub) {
  if (prefix === 'RFG') {
    if (/^(RMV|DEM)$/.test(sub)) return 'DEBRIS REMOVAL';
    if (/^(FLT|FLH|SYN|ICW)$/.test(sub)) return 'UNDERLAYMENTS';
    if (/^(FLS|DRP|CBV|VBX|PPV)$/.test(sub)) return 'VENTS AND FLASHINGS';
    return 'SHINGLES'; // default for all other RFG items
  }
  const P = { 'GUT': 'GUTTER & DOWNSPOUT', 'SFT': 'GUTTER & DOWNSPOUT', 'FSC': 'GUTTER & DOWNSPOUT',
              'SID': 'SIDING', 'PNL': 'SIDING', 'DMO': 'DEBRIS REMOVAL' };
  return P[prefix] ?? null;
}

/**
 * Canonical Symbility-format prefix→category rule (same authority, Symbility codes).
 */
function symbCatByPrefix(prefix, sub) {
  if (prefix === 'RF') {
    if (/^(RMV|DEM)$/.test(sub)) return 'DEBRIS REMOVAL';
    if (/^(UND|IWS)$/.test(sub)) return 'UNDERLAYMENTS';
    if (/^(FLS|VNT|DRP)$/.test(sub)) return 'VENTS AND FLASHINGS';
    return 'SHINGLES'; // default for all other RF items
  }
  if (prefix === 'GEN') return /^(DUMP|DR)$/.test(sub) ? 'DEBRIS REMOVAL' : 'GENERAL';
  const P = { 'GU': 'GUTTER & DOWNSPOUT', 'SI': 'SIDING' };
  return P[prefix] ?? null;
}

// Build CODE_TO_CAT from the exported alias tables at module load.
// When CODE_ALIASES or SYMBILITY_CODE_ALIASES grow a new entry, this map
// automatically includes it — no manual update required.
const CODE_TO_CAT = new Map();
(function buildCodeToCat() {
  for (const code of Object.values(CODE_ALIASES)) {
    const uc = code.trim().toUpperCase();
    if (CODE_TO_CAT.has(uc)) continue;
    const xm = uc.match(/^([A-Z]{2,4})\s+([A-Z0-9]+)/);
    if (xm) { const cat = xactCatByPrefix(xm[1], xm[2]); if (cat) CODE_TO_CAT.set(uc, cat); }
  }
  for (const code of Object.values(SYMBILITY_CODE_ALIASES)) {
    const uc = code.trim().toUpperCase();
    if (CODE_TO_CAT.has(uc)) continue;
    const sm = uc.match(/^([A-Z]{2,3})-([A-Z]+)/);
    if (sm) { const cat = symbCatByPrefix(sm[1], sm[2]); if (cat) CODE_TO_CAT.set(uc, cat); }
  }
})();

/**
 * Derive a display category from an item's code field.
 * Returns null when the code is unrecognised so the caller falls back to
 * keyword matching.
 */
function categoryFromCode(rawCode) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) return null;

  // Exact match from the derived alias table (covers all canonical codes)
  if (CODE_TO_CAT.has(code)) return CODE_TO_CAT.get(code);

  // Prefix-based fallback for unlisted codes (new aliases, custom codes)
  const xm = code.match(/^([A-Z]{2,4})\s+([A-Z0-9]+)/);
  if (xm) return xactCatByPrefix(xm[1], xm[2]);

  const sm = code.match(/^([A-Z]{2,3})-([A-Z]+)/);
  if (sm) return symbCatByPrefix(sm[1], sm[2]);

  return null;
}

function detectCategory(item) {
  if (!item || typeof item !== 'object') return 'GENERAL';

  // 1. Honour explicit category / trade field (skip generic values)
  const explicit = (item.category || item.trade || '').trim();
  if (explicit && !/^roofing$/i.test(explicit) && !/^general$/i.test(explicit) && !/^other$/i.test(explicit)) {
    return explicit.toUpperCase();
  }

  // 2. Code-based detection — uses the same mapping data as xactimateExport.js
  //    and symbilityExport.js so items with real carrier codes group correctly
  //    even when the description text is non-standard.
  const fromCode = categoryFromCode(item.code);
  if (fromCode) return fromCode;

  // 3. Keyword fallback for items without codes or unrecognised codes
  const hay = `${item.description || item.name || ''} ${item.code || ''}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.kw.some((k) => hay.includes(k))) return rule.name;
  }
  return 'GENERAL';
}

const CATEGORY_ORDER = ['SHINGLES', 'UNDERLAYMENTS', 'VENTS AND FLASHINGS', 'GUTTER & DOWNSPOUT', 'SIDING', 'DEBRIS REMOVAL', 'GENERAL'];

function groupByCategory(items) {
  const map = new Map();
  (Array.isArray(items) ? items.filter((i) => i && typeof i === 'object') : []).forEach((item) => {
    const cat = detectCategory(item);
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(item);
  });
  const ordered = [];
  CATEGORY_ORDER.forEach((cat) => {
    if (map.has(cat)) { ordered.push([cat, map.get(cat)]); map.delete(cat); }
  });
  for (const [cat, arr] of map.entries()) ordered.push([cat, arr]);
  return ordered;
}

// ---------------------------------------------------------------------------
// Trade-code mapping (Xactimate trade summary page)
// ---------------------------------------------------------------------------
const TRADE_MAP = [
  { code: 'RFG', name: 'ROOFING', cats: ['SHINGLES', 'UNDERLAYMENTS', 'VENTS AND FLASHINGS', 'GENERAL'] },
  { code: 'SFG', name: 'SOFFIT, FASCIA, & GUTTER', cats: ['GUTTER & DOWNSPOUT'] },
  { code: 'SID', name: 'SIDING', cats: ['SIDING'] },
  { code: 'DMO', name: 'GENERAL DEMOLITION', cats: ['DEBRIS REMOVAL'] },
];

const TRADE_CODE_ORDER = ['RFG', 'SFG', 'SID', 'DMO'];

// Xactimate code prefix → trade code + name (used before falling back to
// category-based detection so items with real carrier codes always land in
// the correct trade even when their description text is non-standard).
const XACT_PREFIX_TRADE = {
  'RFG': { code: 'RFG', name: 'ROOFING' },
  'GUT': { code: 'SFG', name: 'SOFFIT, FASCIA, & GUTTER' },
  'SID': { code: 'SID', name: 'SIDING' },
  'PNL': { code: 'SID', name: 'SIDING' },
  'SFT': { code: 'SFG', name: 'SOFFIT, FASCIA, & GUTTER' },
  'FSC': { code: 'SFG', name: 'SOFFIT, FASCIA, & GUTTER' },
  'DMO': { code: 'DMO', name: 'GENERAL DEMOLITION' },
};

// Symbility code prefix → trade (mirrors xactimateExport.js CODE_ALIASES logic)
const SYMB_PREFIX_TRADE = {
  'RF':  { code: 'RFG', name: 'ROOFING' },
  'GU':  { code: 'SFG', name: 'SOFFIT, FASCIA, & GUTTER' },
  'SI':  { code: 'SID', name: 'SIDING' },
  'GEN': { code: 'DMO', name: 'GENERAL DEMOLITION' },
};

function tradeFor(item) {
  // 1. Code-based detection — preferred when carrier codes are set
  const code = (item.code || '').trim().toUpperCase();
  if (code) {
    // Xactimate format: "RFG 300", "GUT ALU", etc.
    const xm = code.match(/^([A-Z]{2,4})\s+/);
    if (xm && XACT_PREFIX_TRADE[xm[1]]) return XACT_PREFIX_TRADE[xm[1]];
    // Symbility format: "RF-SHGL-ARCH", "GU-ALU-5", etc.
    const sm = code.match(/^([A-Z]{2,3})-/);
    if (sm && SYMB_PREFIX_TRADE[sm[1]]) return SYMB_PREFIX_TRADE[sm[1]];
  }

  // 2. Category-based detection (keyword-derived category → trade)
  const cat = detectCategory(item);
  for (const t of TRADE_MAP) {
    if (t.cats.includes(cat)) return { code: t.code, name: t.name };
  }

  // 3. Explicit category field as last resort
  const explicit = (item.category || item.trade || '').toUpperCase().trim();
  if (explicit && explicit.length <= 3) return { code: explicit, name: explicit };
  if (explicit) return { code: explicit.slice(0, 3), name: explicit };
  return { code: 'RFG', name: 'ROOFING' };
}

function groupByTrade(items) {
  const map = new Map();
  const codeToName = new Map();
  items.forEach((item) => {
    const { code, name } = tradeFor(item);
    if (!map.has(code)) { map.set(code, []); codeToName.set(code, name); }
    map.get(code).push(item);
  });
  const ordered = [];
  TRADE_CODE_ORDER.forEach((code) => {
    if (map.has(code)) { ordered.push([code, codeToName.get(code), map.get(code)]); map.delete(code); }
  });
  for (const [code, itms] of map.entries()) ordered.push([code, codeToName.get(code), itms]);
  return ordered;
}

// ---------------------------------------------------------------------------
// Print button (shown on screen, hidden when printing)
// ---------------------------------------------------------------------------
function printButton() {
  return `<div class="no-print" style="position:fixed;top:12px;right:12px;z-index:999">
    <button onclick="window.print()" style="background:#1d4ed8;color:#fff;border:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.2)">Print / Save as PDF</button>
  </div>`;
}

// ===========================================================================
// INPUT VALIDATOR
// ===========================================================================
/**
 * validateInsuranceEstimateData(data)
 *
 * Checks a data object for common inconsistencies before the HTML template is
 * rendered.  Returns an array of human-readable warning strings; an empty
 * array means no problems were found.
 *
 * Checks performed:
 *   • Item has both a direct rcv/amount value AND qty×rate — the two values
 *     diverge by more than 1 %, meaning only one is actually driving the total.
 *   • Item depreciation_percent > 100 or < 0.
 *   • Item quantity is zero or negative.
 *   • Item rate (unit price) is negative.
 *   • Item has no description.
 *   • Estimate overhead_pct or profit_pct is negative or unusually high (> 50 %).
 *   • Estimate deductible is negative.
 *   • Total depreciation exceeds total RCV (ACV would go negative).
 */
export function validateInsuranceEstimateData(data = {}) {
  const warnings = [];
  const {
    items: rawItems = [],
    estimate = {},
  } = data;

  const items = Array.isArray(rawItems)
    ? rawItems.filter((i) => i && typeof i === 'object')
    : [];

  // ---- Per-item checks -------------------------------------------------------
  items.forEach((item, idx) => {
    const label = item.description || item.name
      ? `"${(item.description || item.name).slice(0, 40)}"`
      : `#${idx + 1}`;

    // 1. Conflicting RCV sources
    const qty  = num(item.quantity ?? item.qty);
    const rate = num(item.rate ?? item.price ?? item.unit_price);
    const calcRcv = qty * rate;
    const directRcv = num(item.rcv) || num(item.amount);
    if (directRcv > 0 && calcRcv > 0) {
      const diff = Math.abs(directRcv - calcRcv);
      if (diff / Math.max(directRcv, calcRcv) > 0.01) {
        warnings.push(
          `Item ${label}: RCV is set directly ($${directRcv.toFixed(2)}) but qty × rate also computes $${calcRcv.toFixed(2)}. ` +
          `Only one value should drive the total — remove the direct RCV or clear qty/rate.`
        );
      }
    }

    // 2. Depreciation percent out of range
    const depPct = num(item.depreciation_percent);
    if (item.depreciation_percent != null && item.depreciation_percent !== '') {
      if (depPct > 100) {
        warnings.push(
          `Item ${label}: depreciation is ${depPct.toFixed(1)}%, which exceeds 100% and will produce a negative ACV for this line.`
        );
      } else if (depPct < 0) {
        warnings.push(
          `Item ${label}: depreciation percentage is negative (${depPct.toFixed(1)}%).`
        );
      }
    }

    // 3. Zero or negative quantity
    const qtyField = item.quantity ?? item.qty;
    if (qtyField != null && qtyField !== '' && qty <= 0) {
      warnings.push(
        `Item ${label}: quantity is ${qty} — line will contribute $0 to the estimate.`
      );
    }

    // 4. Negative unit price
    const hasRate = item.rate != null || item.price != null || item.unit_price != null;
    if (hasRate && rate < 0) {
      warnings.push(
        `Item ${label}: unit price is negative ($${rate.toFixed(2)}).`
      );
    }

    // 5. Missing description
    if (!item.description && !item.name) {
      warnings.push(`Item #${idx + 1}: has no description.`);
    }
  });

  // ---- Estimate-level checks -------------------------------------------------

  // 6. Overhead / profit out of range
  const overheadPct = num(estimate.overhead_pct);
  if (estimate.overhead_pct != null && estimate.overhead_pct !== '') {
    if (overheadPct < 0) {
      warnings.push(`Overhead percentage is negative (${overheadPct.toFixed(1)}%).`);
    } else if (overheadPct > 50) {
      warnings.push(
        `Overhead is ${overheadPct.toFixed(1)}%, which is unusually high (typical range: 10–20%).`
      );
    }
  }

  const profitPct = num(estimate.profit_pct);
  if (estimate.profit_pct != null && estimate.profit_pct !== '') {
    if (profitPct < 0) {
      warnings.push(`Profit percentage is negative (${profitPct.toFixed(1)}%).`);
    } else if (profitPct > 50) {
      warnings.push(
        `Profit is ${profitPct.toFixed(1)}%, which is unusually high (typical range: 5–15%).`
      );
    }
  }

  // 7. Negative deductible
  const deductible = num(estimate.deductible);
  if (estimate.deductible != null && estimate.deductible !== '' && deductible < 0) {
    warnings.push(`Deductible is negative ($${deductible.toFixed(2)}).`);
  }

  // 8. Total depreciation exceeds total RCV
  const totalRcv   = items.reduce((s, i) => s + lineRcv(i), 0);
  const totalDeprec = items.reduce((s, i) => s + lineDepreciation(i), 0);
  if (totalDeprec > totalRcv && totalRcv > 0) {
    warnings.push(
      `Total depreciation ($${totalDeprec.toFixed(2)}) exceeds total RCV ($${totalRcv.toFixed(2)}), ` +
      `which produces a negative ACV. Check depreciation percentages.`
    );
  }

  return warnings;
}

// ===========================================================================
// XACTIMATE — replicates the State Farm / Xactimate printed format
// ===========================================================================
export function generateXactimateHTML(data = {}, options = {}) {
  const {
    company = {},
    customer = {},
    estimate = {},
    items: rawItems = [],
    measurements = {},
  } = data;
  const items = Array.isArray(rawItems) ? rawItems.filter((i) => i && typeof i === 'object') : [];
  // Optional detail columns / sections (backward compatible: defaults reproduce
  // the original output exactly).
  const showDepColumns = options.showDepColumns === true;
  const includeTradeSummary = options.includeTradeSummary !== false;
  const detailCols = showDepColumns ? 10 : 5;
  const fmtAgeLife = (item) => {
    const age = item.age ?? item.age_years;
    const life = item.life ?? item.life_expectancy ?? item.useful_life;
    if ((age == null || age === '') && (life == null || life === '')) return '';
    return `${age == null ? '' : age}/${life == null ? '' : life}`;
  };

  const insurer = esc(estimate.insurance_company || 'Insurance Claims');
  const insuredName = esc(customer.name || customer.customer_name || '');
  const claimNo = esc(estimate.claim_number || estimate.estimate_number || '');
  const propAddr = esc(customer.property_address || estimate.property_address || '');
  const policyNo = esc(estimate.policy_number || '');
  const typeOfLoss = esc(estimate.type_of_loss || '');
  const priceList = esc(estimate.price_list || '');
  const preparedBy = esc(estimate.prepared_by || company.contact_name || '');
  const companyName = esc(company.company_name || company.name || '');
  const companyPhone = esc(company.phone || '');
  const companyAddr = esc(company.address || '');
  const companyLogo = esc(company.logo_url || '');
  const now = new Date();
  const stamp = `${now.toLocaleDateString('en-US')} ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  const sectionLabel = esc(estimate.section_label || 'Roof');
  const estNo = claimNo || esc(estimate.estimate_number || 'ESTIMATE');

  // Financials
  const explicitOpItems = items.filter((i) => getOpLineType(i));
  const detailItems = items.filter((i) => !getOpLineType(i));
  const hasExplicitOpLines = explicitOpItems.length > 0;
  const overheadPct = num(estimate.overhead_pct || 0);
  const profitPct = num(estimate.profit_pct || 0);
  const lineFinancials = (item) => calculatePerLineOverheadProfit(item, {
    overheadPct,
    profitPct,
    taxRate: num(estimate.tax_rate),
  });
  const lineBase = (item) => hasPerLineOverheadProfit(item)
    ? lineFinancials(item).base
    : lineRcv(item);
  const lineTaxForExport = (item) => getOpLineType(item)
    ? lineTax(item)
    : hasPerLineOverheadProfit(item)
    ? lineFinancials(item).tax
    : lineTax(item);
  const lineRcvForExport = (item) => getOpLineType(item)
    ? lineRcv(item)
    : hasPerLineOverheadProfit(item) || (!hasExplicitOpLines && (overheadPct > 0 || profitPct > 0))
    ? lineFinancials(item).rcv
    : lineRcv(item) + lineTaxForExport(item);
  const lineDepreciationForExport = (item) => {
    // Xactimate depreciation applies to the replacement line cost, not to
    // sales tax or contractor O&P added afterward.
    const rcv = getOpLineType(item) ? lineRcv(item) : lineBase(item);
    const pct = num(item.depreciation_percent);
    return pct > 0 ? rcv * (pct / 100) : 0;
  };
  const lineAcvForExport = (item) => lineRcvForExport(item) - lineDepreciationForExport(item);
  const lineItemTotal = detailItems.reduce((s, i) => s + lineBase(i), 0);
  const totalTax = detailItems.reduce((s, i) => s + lineTaxForExport(i), 0);
  const subtotal = lineItemTotal + totalTax;
  const overhead = hasExplicitOpLines
    ? explicitOpItems
      .filter((i) => getOpLineType(i) === 'overhead')
      .reduce((s, i) => s + lineRcv(i), 0)
    : detailItems.reduce((s, i) => s + lineFinancials(i).overhead, 0);
  const profit = hasExplicitOpLines
    ? explicitOpItems
      .filter((i) => getOpLineType(i) === 'profit')
      .reduce((s, i) => s + lineRcv(i), 0)
    : detailItems.reduce((s, i) => s + lineFinancials(i).profit, 0);
  const hasOp = overhead > 0 || profit > 0;
  // adjustment_amount: a free-form dollar adjustment the operator can add in
  // EstimateEditor (e.g. material sales tax not captured per-line). It must be
  // included in RCV so the export matches what the estimate page displays.
  const adjustment = num(estimate.adjustment_amount || 0);
  const hasAdjustment = adjustment !== 0;
  const rcvTotal = hasExplicitOpLines
    ? subtotal + overhead + profit + adjustment
    : detailItems.reduce((s, i) => s + lineRcvForExport(i), 0) + adjustment;
  const totalDeprec = items.reduce((s, i) => s + lineDepreciationForExport(i), 0);
  const hasDeprec = totalDeprec > 0;
  const acvTotal = rcvTotal - totalDeprec;
  const deductible = num(estimate.deductible);
  const netPayment = acvTotal - deductible;
  const taxPct = lineItemTotal > 0 ? (totalTax / lineItemTotal * 100) : 0;

  // Fold per-line material tax and each line's share of O&P into the RCV/ACV
  // columns so the detail + trade pages sum EXACTLY (to the cent) to the
  // cover-page summary. Because each cell is displayed rounded to 2 decimals,
  // summing per-line floating values would drift a cent or two from the summary
  // totals (which are rounded once, in aggregate). To prevent that we allocate
  // the summary totals across the lines in whole cents using the largest-
  // remainder method, so the displayed columns tie exactly. With tax and O&P
  // both off the fold is a no-op and we fall back to the raw helpers, so the
  // default output is byte-for-byte unchanged.
  // Explicit Xactimate O&P rows already contain their calculated RCV. Do not
  // fold the format percentage into the detail lines a second time.
  const opPctTotal = hasExplicitOpLines
    ? 0
    : (overheadPct > 0 ? overheadPct : 0) + (profitPct > 0 ? profitPct : 0);
  const foldExtras = !hasExplicitOpLines && (totalTax > 0 || opPctTotal > 0);
  const allocItems = items.filter((i) => i && typeof i === 'object');

  // Largest-remainder allocation of `targetCents` across `list`, weighted by
  // valueFn(item). Returns a Map(item -> integer cents) that sums to exactly
  // targetCents. Weights and the target both derive from the same full-precision
  // figures, so the leftover (target - Σfloor) is a small integer distributed to
  // the lines with the largest fractional remainders.
  const allocateCents = (list, valueFn, targetCents) => {
    const out = new Map();
    if (!list.length) return out;
    const ideal = list.map((it) => Math.max(0, valueFn(it)) * 100);
    let remainder = targetCents;
    list.forEach((it, i) => { const f = Math.floor(ideal[i]); out.set(it, f); remainder -= f; });
    const byFrac = list
      .map((it, i) => ({ it, frac: ideal[i] - Math.floor(ideal[i]) }))
      .sort((a, b) => b.frac - a.frac);
    let k = 0;
    while (remainder > 0) { const it = byFrac[k % byFrac.length].it; out.set(it, out.get(it) + 1); remainder -= 1; k += 1; }
    k = 0;
    while (remainder < 0) { const it = byFrac[byFrac.length - 1 - (k % byFrac.length)].it; out.set(it, out.get(it) - 1); remainder += 1; k += 1; }
    return out;
  };

  const rcvTargetCents = Math.round(rcvTotal * 100);
  const acvTargetCents = Math.round(acvTotal * 100);
  // Depreciation target is forced to (RCV target - ACV target) so that
  // per-line ACV = RCV - DEPREC holds exactly AND the ACV column still ties to
  // the summary ACV. Only depreciated lines share it, so undepreciated lines
  // never show a phantom cent of depreciation.
  const depTargetCents = rcvTargetCents - acvTargetCents;
  const depItems = allocItems.filter((it) => lineDepreciation(it) > 0);
  const rcvCentsMap = foldExtras
    ? allocateCents(allocItems, (it) => lineRcvForExport(it), rcvTargetCents)
    : null;
  const depCentsMap = foldExtras
    ? allocateCents(depItems, (it) => lineDepreciation(it), depTargetCents)
    : null;

  // Display accessors: allocated cents when folding, raw helpers otherwise.
  const lineRcvFull = (it) => foldExtras ? (rcvCentsMap.get(it) || 0) / 100 : lineRcvForExport(it);
  const lineDepFull = (it) => foldExtras ? (depCentsMap.get(it) || 0) / 100 : lineDepreciationForExport(it);
  const lineAcvFull = (it) => foldExtras
    ? ((rcvCentsMap.get(it) || 0) - (depCentsMap.get(it) || 0)) / 100
    : lineAcvForExport(it);

  // Category groups for detail page
  const groups = groupByCategory(items);

  let seq = 0;
  const detailHtml = groups.map(([cat, catItems]) => {
    const catRcv = catItems.reduce((s, i) => s + lineRcvFull(i), 0);
     const catTax = catItems.reduce((s, i) => s + lineTaxForExport(i), 0);
    const catDeprec = catItems.reduce((s, i) => s + lineDepFull(i), 0);
    const catAcv = catItems.reduce((s, i) => s + lineAcvFull(i), 0);
    const rows = catItems.map((item) => {
      seq += 1;
      const qty = num(item.quantity ?? item.qty);
      const unit = lineUnit(item);
      const rate = num(item.rate ?? item.price ?? item.unit_price);
      const rcv = lineRcvFull(item);
       const tax = lineTaxForExport(item);
      const note = esc(item.note || item.component_note || '');
      const isEst = item.estimated === true || String(item.estimated) === 'true';
      const depPct = num(item.depreciation_percent);
      const lineDep = lineDepFull(item);
      const depCells = showDepColumns
        ? `<td class="x-num">${esc(fmtAgeLife(item))}</td>
        <td class="x-num">${esc(item.condition || '')}</td>
        <td class="x-num">${depPct > 0 ? depPct.toFixed(2) + '%' : ''}</td>
        <td class="x-num">${lineDep > 0 ? '(' + plain(lineDep) + ')' : plain(0)}</td>
        <td class="x-num">${plain(lineAcvFull(item))}</td>`
        : '';
      return `<tr class="x-item">
        <td class="x-desc"><span class="x-seq">${seq}.</span> ${isEst ? '<span class="x-est">*</span> ' : ''}${lineDesc(item)}${note ? `<div class="x-note">${note}</div>` : ''}</td>
        <td class="x-num">${qty.toFixed(2)} ${unit}</td>
        <td class="x-num">${plain(rate)}${isEst ? ' <span class="x-est">*E</span>' : ''}</td>
        <td class="x-num">${plain(tax)}</td>
        <td class="x-num">${plain(rcv)}</td>${depCells ? '\n        ' + depCells : ''}
      </tr>`;
    }).join('');
    const subDepCells = showDepColumns
      ? `<td></td><td></td><td></td><td class="x-num">${catDeprec > 0 ? '(' + plain(catDeprec) + ')' : plain(0)}</td><td class="x-num">${plain(catAcv)}</td>`
      : '';
    return `<tr class="x-sect-hdr"><td colspan="${detailCols}">${esc(cat)}</td></tr>
${rows}
<tr class="x-subtot"><td>Totals: ${esc(cat)}</td><td></td><td></td><td class="x-num">${plain(catTax)}</td><td class="x-num">${plain(catRcv)}</td>${subDepCells}</tr>`;
  }).join('');

  // Measurements
  const m = measurements || {};
  const measData = [
    [num(m.surface_area_sqft || m.roof_area_sqft), 'Surface Area'],
    [num(m.squares || m.roof_area_sq), 'Number of Squares'],
    [num(m.perimeter_lf), 'Total Perimeter Length'],
    [num(m.ridge_lf), 'Total Ridge Length'],
    [num(m.hip_lf), 'Total Hip Length'],
    [num(m.valley_lf), 'Total Valley Length'],
    [num(m.eave_lf), 'Total Eave Length'],
  ].filter(([v]) => v > 0);

  const measHtml = measData.length
    ? `<div class="x-grand-areas">
        <div class="x-ga-label">Grand Total Areas:</div>
        <div class="x-ga-grid">${measData.map(([v, l]) => `<span class="x-ga-item"><span class="x-ga-val">${plain(v)}</span> ${esc(l)}</span>`).join('')}</div>
      </div>`
    : '';

  // Trade summary rows — columns: desc, qty, RCV, tax, O&P, ACV
  const tradeGroups = groupByTrade(items);
  const tradeSummaryHtml = tradeGroups.map(([code, tradeName, tItems]) => {
    const tradeRcv = tItems.reduce((s, i) => s + lineRcvFull(i), 0);
     const tradeTax = tItems.reduce((s, i) => s + lineTaxForExport(i), 0);
     const tradeOp  = hasExplicitOpLines
       ? 0
       : tItems.reduce((s, i) => s + lineFinancials(i).op, 0);
    const tradeAcv = tItems.reduce((s, i) => s + lineAcvFull(i), 0);
    const tRows = tItems.map((item) => {
      const qty = num(item.quantity ?? item.qty);
      const unit = lineUnit(item);
       const itemOp = hasExplicitOpLines ? 0 : lineFinancials(item).op;
      return `<tr class="x-tr-item">
        <td class="x-tr-desc">${lineDesc(item)}</td>
        <td class="x-tr-qty">${qty.toFixed(2)} ${unit}</td>
        <td class="x-tr-amt">${money(lineRcvFull(item))}</td>
         <td class="x-tr-amt">${lineTaxForExport(item) > 0 ? money(lineTaxForExport(item)) : '$0.00'}</td>
        <td class="x-tr-amt">${itemOp > 0 ? money(itemOp) : '$0.00'}</td>
        <td class="x-tr-amt">${money(lineAcvFull(item))}</td>
      </tr>`;
    }).join('');
    return `<tr class="x-tr-hdr"><td colspan="6"><span class="x-tr-code">${esc(code)}</span>&nbsp;&nbsp;&nbsp;${esc(tradeName)}</td></tr>
${tRows}
<tr class="x-tr-tot"><td colspan="2">TOTAL ${esc(tradeName)}</td><td class="x-tr-amt">${money(tradeRcv)}</td><td class="x-tr-amt">${money(tradeTax)}</td><td class="x-tr-amt">${money(tradeOp)}</td><td class="x-tr-amt">${money(tradeAcv)}</td></tr>`;
  }).join('');

  const xStyle = `
  @page { size: letter; margin: 0.7in 0.7in 0.75in; }
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; color: #000; font-size: 11px; margin: 0; background: #f3f4f6; }
  .page { width: 8.5in; min-height: 11in; background: #fff; margin: 16px auto; padding: 0.5in 0.65in 0.7in; box-shadow: 0 1px 6px rgba(0,0,0,.15); position: relative; page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  /* Letterhead (cover page only) */
  .x-letterhead { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .x-letterhead img { max-height: 55px; max-width: 240px; object-fit: contain; }
  .x-letterhead-text { font-size: 11px; line-height: 1.3; }
  .x-letterhead-text b { font-size: 13px; }

  /* Header repeated on each page */
  .x-hdr { border-bottom: 1px solid #000; padding-bottom: 5px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end; }
  .x-hdr-center { text-align: center; font-weight: bold; font-size: 14px; flex: 1; }
  .x-hdr-right { text-align: right; font-size: 10px; }
  .x-hdr-insured { font-size: 11px; }
  .x-hdr-claim { font-size: 11px; font-weight: bold; }

  /* Cover / summary page */
  .x-cov-title { text-align: center; font-size: 11px; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 4px 0; margin: 10px 0; font-weight: bold; }
  .x-info { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; }
  .x-info td { padding: 2px 4px; vertical-align: top; }
  .x-info .lbl { font-weight: bold; white-space: nowrap; width: 110px; }
  table.x-sum { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.x-sum td { padding: 2px 6px; }
  table.x-sum .v { text-align: right; border-bottom: 1px dotted #aaa; min-width: 90px; }
  table.x-sum .x-sum-rule td { border-top: 1px solid #000; padding-top: 4px; }
  table.x-sum .x-sum-bold td { font-weight: bold; }
  table.x-sum .x-sum-paren .v::before { content: '('; }
  table.x-sum .x-sum-paren .v::after { content: ')'; }
  .x-cov-disc { margin-top: 20px; font-size: 10px; font-style: italic; }
  .x-cov-rep { margin-top: 24px; font-size: 11px; border-top: 1px solid #ccc; padding-top: 8px; }

  /* Detail page */
  .x-sec-hdr { margin-bottom: 6px; }
  .x-sec-name { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
  .x-meas-block { font-size: 10px; color: #333; margin-bottom: 8px; }
  .x-meas-block span { display: inline-block; min-width: 220px; }
  table.x-items { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.x-items th { text-align: left; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 5px; font-size: 10px; }
  table.x-items th.x-num, table.x-items td.x-num { text-align: right; }
  .x-desc { padding: 2px 5px; vertical-align: top; width: 50%; }
  .x-num { padding: 2px 5px; vertical-align: top; white-space: nowrap; }
  .x-seq { color: #444; margin-right: 3px; }
  .x-est { color: #555; font-size: 9px; }
  .x-note { font-size: 9px; color: #555; font-style: italic; padding: 1px 0 2px 14px; }
  tr.x-item td { border-bottom: 1px dotted #e0e0e0; }
  tr.x-sect-hdr td { font-weight: bold; padding: 8px 5px 3px; font-size: 12px; }
  tr.x-subtot td { border-top: 1px solid #000; font-weight: bold; padding: 4px 5px; }
  /* Detail page with per-line depreciation columns (narrower + smaller) */
  table.x-items-dep { font-size: 9px; }
  table.x-items-dep .x-desc { width: 30%; }
  table.x-items-dep th, table.x-items-dep td.x-num { padding: 2px 3px; }

  /* Area totals */
  .x-lit { border-top: 2px solid #000; margin-top: 10px; padding-top: 6px; display: flex; justify-content: space-between; font-weight: bold; font-size: 11px; }
  .x-lit-vals { display: flex; gap: 20px; }
  .x-grand-areas { margin-top: 12px; border-top: 1px solid #aaa; padding-top: 6px; font-size: 10px; }
  .x-ga-label { font-weight: bold; margin-bottom: 4px; }
  .x-ga-grid { }
  .x-ga-item { display: inline-block; min-width: 240px; margin: 2px 0; }
  .x-ga-val { font-weight: bold; display: inline-block; min-width: 68px; text-align: right; margin-right: 6px; }

  /* Trade summary */
  .x-ts-title { text-align: center; font-weight: bold; font-size: 14px; margin-bottom: 3px; }
  .x-ts-sub { text-align: center; font-size: 10px; margin-bottom: 12px; }
  table.x-trade { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.x-trade th { text-align: left; border-bottom: 1px solid #000; padding: 3px 5px; font-size: 10px; }
  table.x-trade th.x-tr-amt, table.x-trade td.x-tr-amt { text-align: right; }
  .x-tr-desc { padding: 2px 5px; vertical-align: top; width: 42%; }
  .x-tr-qty { padding: 2px 5px; white-space: nowrap; }
  .x-tr-amt { padding: 2px 5px; white-space: nowrap; min-width: 70px; }
  tr.x-tr-hdr td { font-weight: bold; padding: 8px 5px 3px; font-size: 11px; }
  .x-tr-code { font-family: 'Courier New', monospace; }
  tr.x-tr-item td { border-bottom: 1px dotted #e0e0e0; }
  tr.x-tr-tot td { border-top: 1px solid #000; font-weight: bold; padding: 3px 5px; }
  .x-ts-grand td { border-top: 2px solid #000; font-weight: bold; padding: 5px; }

  /* Footer */
  .x-foot { position: absolute; bottom: 0.35in; left: 0.65in; right: 0.65in; display: flex; justify-content: space-between; align-items: flex-end; font-size: 10px; border-top: 1px solid #ccc; padding-top: 4px; }
  @media print { body { background: #fff; } .page { box-shadow: none; margin: 0; width: auto; min-height: auto; padding: 0.5in 0.65in 0.7in; } .no-print { display: none !important; } }`;

  // ---- Cover / Summary page ---------------------------------------------------
  const coverPage = `
<div class="page">
  ${(companyLogo || companyName) ? `<div class="x-letterhead">
    ${companyLogo ? `<img src="${companyLogo}" alt="${companyName || 'Company logo'}">` : ''}
    <div class="x-letterhead-text">${companyName ? `<b>${companyName}</b>` : ''}${companyAddr ? `<br>${companyAddr}` : ''}${companyPhone ? `<br>${companyPhone}` : ''}</div>
  </div>` : ''}
  <div class="x-hdr">
    <div class="x-hdr-insured">${insuredName ? `<b>${insuredName}</b>` : ''}${propAddr ? `<br>${propAddr}` : ''}</div>
    <div class="x-hdr-center">${insurer}</div>
    <div class="x-hdr-right">${claimNo ? `<div class="x-hdr-claim">${estNo}</div>` : ''}</div>
  </div>

  <table class="x-info">
    <tr>
      <td class="lbl">Claim Number:</td><td>${estNo}</td>
      <td width="30"></td>
      <td class="lbl">Insured:</td><td>${insuredName}</td>
    </tr>
    <tr>
      <td class="lbl">Policy Number:</td><td>${policyNo}</td>
      <td></td>
      <td class="lbl">Property:</td><td>${propAddr}</td>
    </tr>
    <tr>
      <td class="lbl">Type of Loss:</td><td>${typeOfLoss}</td>
      <td></td>
      <td class="lbl">Date of Loss:</td><td>${dateFmt(estimate.date_of_loss || estimate.damage_date)}</td>
    </tr>
    <tr>
      <td class="lbl">Date Inspected:</td><td>${dateFmt(estimate.date_inspected)}</td>
      <td></td>
      <td class="lbl">Deductible:</td><td>${money(deductible)}</td>
    </tr>
    ${priceList ? `<tr><td class="lbl">Price List:</td><td>${priceList}</td><td></td><td></td><td></td></tr>` : ''}
    ${preparedBy ? `<tr><td class="lbl">Prepared by:</td><td>${preparedBy}${companyName ? ', ' + companyName : ''}${companyPhone ? ' &bull; ' + companyPhone : ''}</td><td></td><td></td><td></td></tr>` : ''}
  </table>

  <div class="x-cov-title">Summary for ${sectionLabel}</div>

  <table class="x-sum">
    <tr><td>Line Item Total</td><td class="v">${plain(lineItemTotal)}</td></tr>
    <tr><td>Material Sales Tax${taxPct > 0 ? ` @ ${taxPct.toFixed(1)}%` : ''}</td><td class="v">${plain(totalTax)}</td></tr>
    ${hasAdjustment ? `<tr><td>Adjustment</td><td class="v">${plain(adjustment)}</td></tr>` : ''}
    ${hasOp ? `<tr class="x-sum-rule"><td>Subtotal</td><td class="v">${plain(subtotal + adjustment)}</td></tr>
    ${overhead > 0 ? `<tr><td>General Contractor Overhead @ ${overheadPct.toFixed(0)}%</td><td class="v">${plain(overhead)}</td></tr>` : ''}
    ${profit > 0 ? `<tr><td>General Contractor Profit @ ${profitPct.toFixed(0)}%</td><td class="v">${plain(profit)}</td></tr>` : ''}
    <tr class="x-sum-rule x-sum-bold"><td>Replacement Cost Value</td><td class="v">${plain(rcvTotal)}</td></tr>` : `<tr class="x-sum-rule x-sum-bold"><td>Replacement Cost Value</td><td class="v">${plain(rcvTotal)}</td></tr>`}
    ${hasDeprec ? `<tr class="x-sum-paren"><td>Less Depreciation</td><td class="v">${plain(totalDeprec)}</td></tr>
    <tr class="x-sum-bold"><td>Actual Cash Value</td><td class="v">${plain(acvTotal)}</td></tr>` : ''}
    <tr class="x-sum-paren"><td>Less Deductible</td><td class="v">${plain(deductible)}</td></tr>
    <tr class="x-sum-rule x-sum-bold"><td>Net Payment</td><td class="v">${money(netPayment)}</td></tr>
  </table>

  <div class="x-cov-disc">* Items with an asterisk (*) were priced using a time and materials or estimated method.<br>ALL AMOUNTS PAYABLE ARE SUBJECT TO THE TERMS, CONDITIONS AND LIMITS OF YOUR POLICY.</div>

  ${preparedBy || companyName ? `<div class="x-cov-rep">${preparedBy ? preparedBy + '<br>' : ''}${companyName}${companyPhone ? '<br>' + companyPhone : ''}${companyAddr ? '<br>' + companyAddr : ''}</div>` : ''}

  <div class="x-foot"><span>${estNo ? esc(estNo) + ' &nbsp;&bull;&nbsp; ' : ''}Date: ${esc(stamp)}</span><span>Page: 1</span></div>
</div>`;

  // ---- Detail page -----------------------------------------------------------
  const detailPage = `
<div class="page">
  <div class="x-hdr">
    <div class="x-hdr-insured">${insuredName ? `<b>${insuredName}</b>` : ''}${propAddr ? `<br>${propAddr}` : ''}</div>
    <div class="x-hdr-center">${insurer}</div>
    <div class="x-hdr-right">${claimNo ? `<div class="x-hdr-claim">${estNo}</div>` : ''}</div>
  </div>

  <div class="x-sec-hdr">
    <div class="x-sec-name">${sectionLabel}</div>
    ${measData.length ? `<div class="x-meas-block">
      ${measData.map(([v, l]) => `<span><span style="font-weight:bold;display:inline-block;min-width:58px;text-align:right;margin-right:4px">${plain(v)}</span>${esc(l)}</span>`).join(' &nbsp;&nbsp; ')}
    </div>` : ''}
  </div>

  <table class="x-items${showDepColumns ? ' x-items-dep' : ''}">
    <thead><tr>
      <th class="x-desc">DESCRIPTION</th>
      <th class="x-num">QUANTITY</th>
      <th class="x-num">UNIT PRICE</th>
      <th class="x-num">TAX</th>
      <th class="x-num">RCV</th>${showDepColumns ? `
      <th class="x-num">AGE/LIFE</th>
      <th class="x-num">COND.</th>
      <th class="x-num">DEP %</th>
      <th class="x-num">DEPREC.</th>
      <th class="x-num">ACV</th>` : ''}
    </tr></thead>
    <tbody>
      ${detailHtml}
    </tbody>
  </table>

  <div class="x-lit">
    <span>Line Item Totals: ${estNo}</span>
    <div class="x-lit-vals"><span>${plain(totalTax)}</span><span>${plain(rcvTotal)}</span></div>
  </div>

  ${measHtml}

  <div class="x-foot"><span>${estNo ? esc(estNo) + ' &nbsp;&bull;&nbsp; ' : ''}Date: ${esc(stamp)}</span><span>Page: 2</span></div>
</div>`;

  // ---- Trade Summary page ----------------------------------------------------
  const tradePage = (includeTradeSummary && tradeGroups.length > 0) ? `
<div class="page">
  <div class="x-ts-title">Trade Summary</div>
  <div class="x-ts-sub">Includes all applicable Tax, General Contractor O&amp;P, and Labor Minimums</div>

  <table class="x-trade">
    <thead>
      <tr>
        <th class="x-tr-desc" colspan="2">DESCRIPTION</th>
        <th class="x-tr-amt">LINE ITEM<br>REPL. COST</th>
        <th class="x-tr-amt">TAX</th>
        <th class="x-tr-amt">O&amp;P</th>
        <th class="x-tr-amt">ACV</th>
      </tr>
    </thead>
    <tbody>
      ${tradeSummaryHtml}
      <tr class="x-ts-grand">
        <td colspan="2">TOTALS</td>
        <td class="x-tr-amt">${money(rcvTotal)}</td>
        <td class="x-tr-amt">${money(totalTax)}</td>
        <td class="x-tr-amt">${money(overhead + profit)}</td>
        <td class="x-tr-amt">${money(acvTotal)}</td>
      </tr>
    </tbody>
  </table>

  <div class="x-foot"><span>Note: Slight variances may be found within report sections due to rounding</span><span>Date: ${esc(stamp)}</span></div>
</div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${estNo} - Xactimate</title>
<style>${xStyle}</style></head>
<body>
${printButton()}
${coverPage}
${detailPage}
${tradePage}
</body></html>`;
}

// ===========================================================================
// SYMBILITY — replicates the Liberty Mutual / Symbility printed format
// ===========================================================================
export function generateSymbilityHTML(data = {}) {
  const {
    company = {},
    customer = {},
    estimate = {},
    items: rawItems = [],
    measurements = {},
  } = data;
  const items = Array.isArray(rawItems) ? rawItems.filter((i) => i && typeof i === 'object') : [];

  const insurer = esc(estimate.insurance_company || 'Insurance Company');
  const insurerAddr = esc(estimate.insurance_address || '');
  const claimNo = esc(estimate.claim_number || '');
  const policyNo = esc(estimate.policy_number || '');
  const insuredName = esc(customer.name || customer.customer_name || '');
  const propAddr = esc(customer.property_address || estimate.property_address || '');
  const typeOfLoss = esc(estimate.type_of_loss || '');
  const deductible = num(estimate.deductible);
  const companyName = esc(company.company_name || company.name || '');
  const companyPhone = esc(company.phone || '');
  const companyEmail = esc(company.email || company.contact_email || '');
  const companyAddr = esc(company.address || '');
  const companyLicense = esc(company.license_number || company.license || '');
  const companyLogo = esc(company.logo_url || '');
  const preparedBy = esc(estimate.prepared_by || company.contact_name || '');
  const estNo = claimNo || esc(estimate.estimate_number || 'ESTIMATE');
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  // Financials
  const lineItemTotal = items.reduce((s, i) => s + lineRcv(i), 0);
  const totalTax = items.reduce((s, i) => s + lineTax(i), 0);
  const totalOp = 0; // Symbility shows O&P at summary, not per-item
  const totalDeprec = items.reduce((s, i) => s + lineDepreciation(i), 0);
  // Include free-form adjustment (e.g. material sales tax added by operator)
  // in RCV so the exported totals match EstimateEditor's displayed total.
  const adjustment = num(estimate.adjustment_amount || 0);
  const rcvTotal = lineItemTotal + totalTax + adjustment;
  const acvTotal = rcvTotal - totalDeprec;
  const netAcv = acvTotal - deductible;
  const hasMat = items.some((i) => i.material_cost != null);
  const hasLab = items.some((i) => i.labor_cost != null);
  const hasEquip = items.some((i) => i.equipment_cost != null);
  const totMaterials = items.reduce((s, i) => s + num(i.material_cost), 0);
  const totLabor = items.reduce((s, i) => s + num(i.labor_cost), 0);
  const totEquip = items.reduce((s, i) => s + num(i.equipment_cost), 0);

  // Fold per-line material tax into the RCV/ACV columns so the detail sections
  // and their category subtotals sum EXACTLY (to the cent) to the cover/summary
  // RCV/ACV. The summary uses rcvTotal = lineItemTotal + totalTax and
  // acvTotal = rcvTotal - totalDeprec (tax included), but the per-line columns
  // historically excluded per-line tax, so once tax was applied the columns did
  // not tie to the summary. Because each cell is displayed rounded to 2 decimals,
  // summing the per-line floating values would drift a cent or two from the
  // once-rounded summary totals, so we allocate the summary totals across the
  // displayed rows in whole cents using the largest-remainder method. Symbility
  // applies no O&P, so only tax is folded. With no tax the fold is a no-op and we
  // fall back to the raw helpers, so the default output is byte-for-byte
  // unchanged. The shared helpers (lineRcv/lineTax/lineAcv/lineDepreciation) are
  // left untouched so the Xactimate generator is unaffected.
  const foldExtras = totalTax > 0;

  // Largest-remainder allocation of `targetCents` across `list`, weighted by
  // valueFn(entry). Returns a Map(entry -> integer cents) summing to exactly
  // targetCents.
  const allocateCents = (list, valueFn, targetCents) => {
    const out = new Map();
    if (!list.length) return out;
    const ideal = list.map((it) => Math.max(0, valueFn(it)) * 100);
    let remainder = targetCents;
    list.forEach((it, i) => { const f = Math.floor(ideal[i]); out.set(it, f); remainder -= f; });
    const byFrac = list
      .map((it, i) => ({ it, frac: ideal[i] - Math.floor(ideal[i]) }))
      .sort((a, b) => b.frac - a.frac);
    let k = 0;
    while (remainder > 0) { const it = byFrac[k % byFrac.length].it; out.set(it, out.get(it) + 1); remainder -= 1; k += 1; }
    k = 0;
    while (remainder < 0) { const it = byFrac[byFrac.length - 1 - (k % byFrac.length)].it; out.set(it, out.get(it) - 1); remainder += 1; k += 1; }
    return out;
  };

  // Each item renders as a single row, or a Remove + Replace pair, so we allocate
  // across DISPLAY ROWS ("units"), not items. A unit's RCV weight is its share of
  // the item's true line RCV (matching the summary's lineItemTotal) plus the
  // item's tax, which is shown on the single / replace row. Depreciation is split
  // the same way. Remove/replace shares follow remove_cost : replace_cost.
  const units = [];
  if (foldExtras) {
    for (const item of items) {
      const rcv = lineRcv(item);
      const dep = lineDepreciation(item);
      const tax = lineTax(item);
      const rTot = num(item.remove_cost);
      const pTot = num(item.replace_cost);
      if (rTot > 0 && pTot > 0) {
        const denom = rTot + pTot;
        const rs = rTot / denom;
        const ps = pTot / denom;
        units.push({ item, role: 'remove', rcvW: rcv * rs, depW: dep * rs });
        units.push({ item, role: 'replace', rcvW: rcv * ps + tax, depW: dep * ps });
      } else {
        units.push({ item, role: 'single', rcvW: rcv + tax, depW: dep });
      }
    }
  }

  const rcvTargetCents = Math.round(rcvTotal * 100);
  const acvTargetCents = Math.round(acvTotal * 100);
  // Force the depreciation target to (RCV target - ACV target) so per-line
  // ACV = RCV - DEPREC holds exactly AND the ACV column ties to the summary. Only
  // depreciated rows share it, so undepreciated rows never show a phantom cent.
  const depTargetCents = rcvTargetCents - acvTargetCents;
  const depUnits = units.filter((u) => u.depW > 0);
  const rcvCentsMap = foldExtras ? allocateCents(units, (u) => u.rcvW, rcvTargetCents) : null;
  const depCentsMap = foldExtras ? allocateCents(depUnits, (u) => u.depW, depTargetCents) : null;

  // item -> { single|remove|replace: { rcv, dep } } in whole cents.
  const centsByRow = new Map();
  if (foldExtras) {
    for (const u of units) {
      let e = centsByRow.get(u.item);
      if (!e) { e = {}; centsByRow.set(u.item, e); }
      e[u.role] = { rcv: rcvCentsMap.get(u) || 0, dep: depCentsMap.get(u) || 0 };
    }
  }
  const rowCents = (item, role) => {
    const e = centsByRow.get(item);
    return e && e[role] ? e[role] : null;
  };
  // Displayed values: allocated whole cents when folding, else the raw amount.
  const rowRcv = (item, role, raw) => { if (!foldExtras) return raw; const c = rowCents(item, role); return (c ? c.rcv : 0) / 100; };
  const rowDep = (item, role, raw) => { if (!foldExtras) return raw; const c = rowCents(item, role); return (c ? c.dep : 0) / 100; };
  const rowAcv = (item, role, rawRcv, rawDep) => (foldExtras ? (rowRcv(item, role, 0) - rowDep(item, role, 0)) : (rawRcv - rawDep));
  // Per-item displayed RCV/DEPREC totals (sum of the item's rows) for subtotals.
  const itemRcv = (item) => {
    if (!foldExtras) return lineRcv(item);
    const e = centsByRow.get(item);
    if (!e) return 0;
    return ((e.single ? e.single.rcv : 0) + (e.remove ? e.remove.rcv : 0) + (e.replace ? e.replace.rcv : 0)) / 100;
  };
  const itemDep = (item) => {
    if (!foldExtras) return lineDepreciation(item);
    const e = centsByRow.get(item);
    if (!e) return 0;
    return ((e.single ? e.single.dep : 0) + (e.remove ? e.remove.dep : 0) + (e.replace ? e.replace.dep : 0)) / 100;
  };

  // Measurements
  const m = measurements || {};
  const measData = [
    ['Roof area', num(m.surface_area_sqft || m.roof_area_sqft), 'SF'],
    ['Squares', num(m.squares || m.roof_area_sq), 'SQ'],
    ['Total Perimeter', num(m.perimeter_lf), 'LF'],
    ['Ridge', num(m.ridge_lf), 'LF'],
    ['Hip', num(m.hip_lf), 'LF'],
    ['Valley', num(m.valley_lf), 'LF'],
    ['Eave', num(m.eave_lf), 'LF'],
    ['Soffit', num(m.soffit_sqft), 'SF'],
  ].filter(([, v]) => v > 0);

  const roofplanLabel = esc(estimate.section_label || 'House Roof');

  // Group by category for sections
  const groups = groupByCategory(items);

  // Build line item rows — 8 data columns (after #)
  let seq = 0;
  const groupHtml = groups.map(([cat, catItems]) => {
    const catRcv = catItems.reduce((s, i) => s + itemRcv(i), 0);
    const catTax = catItems.reduce((s, i) => s + lineTax(i), 0);
    const catOp = 0;
    const catDeprec = catItems.reduce((s, i) => s + itemDep(i), 0);
    const catAcv = catRcv - catDeprec;

    const rows = catItems.flatMap((item) => {
      const hasRemove = num(item.remove_cost) > 0 && num(item.replace_cost) > 0;
      if (hasRemove) {
        // Show two rows: Remove + Replace
        const removeQty = num(item.remove_qty || (item.quantity ?? item.qty));
        const removeRate = num(item.remove_cost) / (removeQty || 1);
        const removeTot = num(item.remove_cost);
        const removeDep = removeTot * (num(item.depreciation_percent) / 100);
        const removeRc = rowRcv(item, 'remove', removeTot);
        const removeDepD = rowDep(item, 'remove', removeDep);
        const removeAcv = rowAcv(item, 'remove', removeTot, removeDep);
        seq += 1;
        const removeRow = `<tr class="s-item">
          <td class="s-seq">${seq}</td>
          <td class="s-desc">${lineDesc(item)} - Remove</td>
          <td class="s-num">${removeQty.toFixed(2)}</td>
          <td class="s-num">${plain(removeRate)}</td>
          <td class="s-per">${lineUnit(item)}</td>
          <td class="s-num">$0.00</td>
          <td class="s-num">$0.00</td>
          <td class="s-num">${money(removeRc)}</td>
          <td class="s-num">${money(removeDepD)}</td>
          <td class="s-num">${money(removeAcv)}</td>
        </tr>`;

        const replaceQty = num(item.quantity ?? item.qty);
        const replaceRate = num(item.replace_cost) / (replaceQty || 1);
        const replaceTot = num(item.replace_cost);
        const replaceTax = lineTax(item);
        const replaceDep = replaceTot * (num(item.depreciation_percent) / 100);
        const replaceRc = rowRcv(item, 'replace', replaceTot);
        const replaceDepD = rowDep(item, 'replace', replaceDep);
        const replaceAcv = rowAcv(item, 'replace', replaceTot, replaceDep);
        seq += 1;
        const replaceRow = `<tr class="s-item">
          <td class="s-seq">${seq}</td>
          <td class="s-desc">${lineDesc(item)} - Replace</td>
          <td class="s-num">${replaceQty.toFixed(2)}</td>
          <td class="s-num">${plain(replaceRate)}</td>
          <td class="s-per">${lineUnit(item)}</td>
          <td class="s-num">$0.00</td>
          <td class="s-num">${money(replaceTax)}</td>
          <td class="s-num">${money(replaceRc)}</td>
          <td class="s-num">${money(replaceDepD)}</td>
          <td class="s-num">${money(replaceAcv)}</td>
        </tr>`;
        return [removeRow, replaceRow];
      }

      // Single row
      seq += 1;
      const qty = num(item.quantity ?? item.qty);
      const rate = num(item.rate ?? item.price ?? item.unit_price);
      const rcv = lineRcv(item);
      const tax = lineTax(item);
      const dep = lineDepreciation(item);
      const rcvD = rowRcv(item, 'single', rcv);
      const depD = rowDep(item, 'single', dep);
      const acvD = rowAcv(item, 'single', rcv, dep);
      const note = esc(item.note || item.component_note || '');
      return [`<tr class="s-item">
        <td class="s-seq">${seq}</td>
        <td class="s-desc">${lineDesc(item)}${note ? `<div class="s-note">${note}</div>` : ''}</td>
        <td class="s-num">${qty.toFixed(2)}</td>
        <td class="s-num">${plain(rate)}</td>
        <td class="s-per">${lineUnit(item)}</td>
        <td class="s-num">$0.00</td>
        <td class="s-num">${money(tax)}</td>
        <td class="s-num">${money(rcvD)}</td>
        <td class="s-num">${money(depD)}</td>
        <td class="s-num">${money(acvD)}</td>
      </tr>`];
    }).join('');

    const countLabel = catItems.reduce((cnt, i) => cnt + (num(i.remove_cost) > 0 && num(i.replace_cost) > 0 ? 2 : 1), 0);
    const subtotRow = `<tr class="s-subtot">
      <td class="s-seq"></td>
      <td class="s-desc">${esc(cat)} - Subtotal (${countLabel} item${countLabel === 1 ? '' : 's'})</td>
      <td></td><td></td><td></td>
      <td class="s-num">${money(catOp)}</td>
      <td class="s-num">${money(catTax)}</td>
      <td class="s-num">${money(catRcv)}</td>
      <td class="s-num">${money(catDeprec)}</td>
      <td class="s-num">${money(catAcv)}</td>
    </tr>`;

    return `<tr class="s-cat-hdr"><td colspan="10">${esc(cat)}</td></tr>
${rows}
${subtotRow}`;
  }).join('');

  // Column headers HTML (repeated on each page via inline block)
  const colHeaders = `<thead><tr class="s-col-hdr">
    <th class="s-seq">#</th>
    <th class="s-desc">Description</th>
    <th class="s-num">Quantity</th>
    <th class="s-num">Unit Price</th>
    <th class="s-per">Per</th>
    <th class="s-num">Total O&amp;P</th>
    <th class="s-num">Total Taxes</th>
    <th class="s-num">RC</th>
    <th class="s-num">Depreciation</th>
    <th class="s-num">ACV</th>
  </tr></thead>`;

  const sStyle = `
  @page { size: letter; margin: 0.28in 0.25in 0.42in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 9px; margin: 0; background: #f3f4f6; }
  .page { width: 8.5in; min-height: 11in; background: #fff; margin: 16px auto; padding: 0.28in 0.25in 0.42in; box-shadow: 0 1px 6px rgba(0,0,0,.15); position: relative; page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  /* CoreLogic / Symbility worksheet visual language */
  .s-core-claim { display:grid; grid-template-columns: 48% 52%; min-height: 153px; border-bottom: 1px solid #777; }
  .s-core-title { background:#171717; color:#fff; font-size:16px; font-weight:bold; padding:5px 8px; letter-spacing:.1px; }
  .s-core-title span { font-weight:normal; }
  .s-core-subtitle { font-size:12px; padding:9px 16px 2px; line-height:1.42; }
  .s-core-subtitle b { display:inline-block; min-width:93px; text-align:right; padding-right:12px; }
  .s-core-insured { border-left:1px solid #555; }
  .s-core-insured-head { background:#b8b8b8; color:#fff; font-size:16px; font-weight:bold; padding:5px 11px; }
  .s-core-insured-body { padding:10px 14px; font-size:12px; line-height:1.22; }
  .s-core-insured-body .s-core-label { display:block; text-align:center; margin-top:6px; }
  .s-cover-contact { width:100%; margin-top:8px; border-bottom:1px solid #222; font-size:12px; }
  .s-cover-contact td { padding:3px 7px; }
  .s-cover-contact .s-lbl { width:125px; text-align:right; font-weight:bold; }
  .s-core-company { display:grid; grid-template-columns:125px 1fr; margin-top:7px; border:1px solid #555; font-size:10px; line-height:1.25; }
  .s-core-company-label { background:#d0d0d0; padding:5px 7px; font-weight:bold; }
  .s-core-company-body { padding:5px 8px; white-space:pre-line; }
  .s-core-company-body strong { font-size:11px; }
  .s-cover-disclaimer { border:1px solid #555; margin-top:7px; padding:5px 7px; text-align:center; font-size:10px; line-height:1.18; }

  /* Detail bars */
  .s-core-bar { background:#d3daee; border:1px solid #a1a7b5; padding:3px 6px; min-height:20px; }
  .s-core-bar strong { font-size:11px; }
  .s-core-bar a { color:#0000b5; text-decoration:none; font-size:11px; }
  .s-core-bar.s-core-claimbar { display:flex; justify-content:space-between; align-items:center; }
  .s-core-status { color:#333; font-size:9px; }
  .s-core-status::before { content:'▣'; color:#39779c; padding-right:5px; }
  .s-pg-hdr { display:none; }

  /* Section header */
  .s-section-hdr { background:#d3daee; font-weight:bold; font-size:11px; padding:3px 7px; margin:0; border:1px solid #a1a7b5; }
  .s-meas-row { font-size:9px; padding:8px 18px; border:1px solid #ddd; border-top:none; margin:0 0 2px; background:#f5f5f5; }
  .s-meas-item { display:inline-block; margin-right:18px; min-width:100px; }

  /* Item table */
  table.s-items { width:100%; border-collapse:collapse; font-size:9px; }
  table.s-items .s-col-hdr th { background:#efefef; border:1px solid #bcbcbc; padding:4px 4px; text-align:right; font-size:9px; }
  table.s-items .s-col-hdr .s-desc { text-align: left; }
  table.s-items .s-col-hdr .s-seq { text-align: right; }
  .s-seq { width:22px; text-align:right; padding:3px 5px 3px 0; color:#0000bb; vertical-align:top; }
  .s-desc { padding:3px 5px; vertical-align:top; }
  .s-num { padding:3px 4px; text-align:right; vertical-align:top; white-space:nowrap; }
  .s-per { padding: 2px 4px; text-align: center; vertical-align: top; white-space: nowrap; width: 32px; }
  .s-note { font-size:8px; color:#222; padding:2px 0 2px 12px; }
  tr.s-item td { border-bottom:1px solid #eee; }
  tr.s-item td.s-num:nth-child(4), tr.s-item td.s-num:nth-child(8), tr.s-item td.s-num:nth-child(10) { background:#f0f0f0; }
  tr.s-cat-hdr td { font-weight:bold; padding:8px 4px 2px; font-size:10px; border-bottom:1px solid #777; }
  tr.s-subtot td { border-top:1px solid #aaa; font-weight:bold; padding:3px 4px; background:#ddd; }

  /* Summary page tables */
  .s-sum-section { font-weight:bold; font-size:11px; border-bottom:2px solid #222; padding:5px 4px 3px; margin:18px 0 6px; text-transform:uppercase; letter-spacing:.5px; background:#f4f4f4; }
  table.s-sum-table { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.s-sum-table th { border-bottom:1px solid #999; padding:4px 6px; text-align:right; background:#d3daee; font-size:10px; }
  table.s-sum-table th.s-st-lbl { text-align: left; }
  table.s-sum-table td { padding:4px 6px; border-bottom:1px solid #eee; vertical-align:top; }
  table.s-sum-table td.s-st-lbl { font-weight: bold; }
  table.s-sum-table td.s-st-r { text-align: right; }
  table.s-sum-table tr.s-rule td { border-top: 1px solid #000; font-weight: bold; }
  table.s-sum-table tr.s-rule2 td { border-top: 2px solid #000; font-weight: bold; }
  table.s-sum-table tr.s-paren td.s-st-r::before { content: '('; }
  table.s-sum-table tr.s-paren td.s-st-r::after { content: ')'; }

  /* Footer */
  .s-foot { position:absolute; bottom:.18in; left:.25in; right:.25in; display:flex; justify-content:space-between; font-size:9px; padding-top:3px; }
  @media print { body { background:#fff; } .page { box-shadow:none; margin:0; width:auto; min-height:auto; padding:.28in .25in .42in; } .no-print { display:none !important; } }`;

  // ---- Cover page ------------------------------------------------------------
  const coverPage = `
<div class="page">
  <div class="s-core-claim">
    <div>
      <div class="s-core-title">CLAIM NO.: <span>${estNo}</span></div>
      <div class="s-core-subtitle">
        ${policyNo ? `<b>Policy No.:</b> ${policyNo}<br>` : ''}
        <b>Date of Loss:</b> ${dateFmt(estimate.date_of_loss || estimate.damage_date)}<br>
        ${typeOfLoss ? `<b>Type of Loss:</b> ${typeOfLoss}<br>` : ''}
        <b>Carrier:</b> ${insurer}<br>
        <b>Deductible:</b> ${money(deductible)}
      </div>
  </div>
    <div class="s-core-insured">
      <div class="s-core-insured-head">INSURED</div>
      <div class="s-core-insured-body">${insuredName || '&nbsp;'}${propAddr ? `<br>${propAddr.replace(/\n/g, '<br>')}` : ''}<span class="s-core-label"><b>Loss address:</b><br>${propAddr || '&nbsp;'}</span></div>
    </div>
  </div>
  <table class="s-cover-contact">
    <tr><td class="s-lbl">Adjuster:</td><td>${preparedBy}</td></tr>
    ${companyPhone ? `<tr><td class="s-lbl">Phone:</td><td>${companyPhone}</td></tr>` : ''}
    ${estimate.adjuster_email ? `<tr><td class="s-lbl">Email Address:</td><td>${esc(estimate.adjuster_email)}</td></tr>` : ''}
  </table>
  ${(companyName || companyAddr || companyPhone || companyEmail || companyLicense) ? `<div class="s-core-company">
    <div class="s-core-company-label">CONTRACTOR /<br>SUBSCRIBER</div>
    <div class="s-core-company-body">
      ${companyName ? `<strong>${companyName}</strong>` : ''}
      ${companyAddr ? `<br>${companyAddr}` : ''}
      ${companyPhone ? `<br>Phone: ${companyPhone}` : ''}
      ${companyEmail ? `<br>Email: ${companyEmail}` : ''}
      ${companyLicense ? `<br>License: ${companyLicense}` : ''}
    </div>
  </div>` : ''}
  <div class="s-cover-disclaimer">This estimate is subject to review and may be supplemented, modified, or revised by the insurance company or its assigned adjuster based on coverage determinations, policy conditions, and claim evaluation.</div>

  <div class="s-foot">
    <span>${claimNo ? `Claim ${estNo}` : estNo}</span>
    <span>${esc(todayStr)}</span>
    <span>Page: 1</span>
  </div>
</div>`;

  // ---- Detail page -----------------------------------------------------------
  const detailPage = `
<div class="page">
  <table class="s-items">${colHeaders}</table>
  <div class="s-core-bar s-core-claimbar">
    <span><strong>ESTIMATE:</strong> <a>Structure</a></span>
    <a>Claim #${estNo}${insuredName ? `, ${insuredName}` : ''}</a>
  </div>
  <div class="s-core-bar s-core-status">In progress</div>
  <div class="s-section-hdr">▣ ROOFPLAN: ${roofplanLabel}${propAddr ? ` &mdash; ${esc(propAddr)}` : ''}</div>
  ${measData.length ? `<div class="s-meas-row">${measData.map(([lbl, v, unit]) => `<span class="s-meas-item"><b>${esc(lbl)}:</b> ${plain(v)} ${esc(unit)}</span>`).join('')}</div>` : ''}

  <table class="s-items">
    <tbody>
      ${groupHtml}
    </tbody>
  </table>

  <div class="s-foot">
    <span>${claimNo ? `Claim ${estNo}` : estNo}</span>
    <span>${esc(todayStr)}</span>
    <span>Page: 2</span>
  </div>
</div>`;

  // ---- Summary page ----------------------------------------------------------
  const summaryPage = `
<div class="page">
  <div class="s-core-bar s-core-claimbar">
    <span><strong>ESTIMATE:</strong> <a>Structure</a></span>
    <a>Claim #${estNo}${insuredName ? `, ${insuredName}` : ''}</a>
  </div>
  <div class="s-core-bar s-core-status">In progress</div>

  <div class="s-sum-section">Category Summary</div>
  <table class="s-sum-table">
    <thead>
      <tr>
        <th class="s-st-lbl">Category</th>
        <th class="s-st-r">Items</th>
        <th class="s-st-r">RC</th>
        <th class="s-st-r">Depreciation</th>
        <th class="s-st-r">ACV</th>
      </tr>
    </thead>
    <tbody>
      ${groupByCategory(items).map(([cat, catItems]) => {
        const cRcv = catItems.reduce((s, i) => s + itemRcv(i), 0);
        const cDep = catItems.reduce((s, i) => s + itemDep(i), 0);
        const cAcv = cRcv - cDep;
        const cnt = catItems.reduce((n, i) => n + (num(i.remove_cost) > 0 && num(i.replace_cost) > 0 ? 2 : 1), 0);
        return `<tr><td class="s-st-lbl">${esc(cat)}</td><td class="s-st-r">${cnt}</td><td class="s-st-r">${money(cRcv)}</td><td class="s-st-r">${money(cDep)}</td><td class="s-st-r">${money(cAcv)}</td></tr>`;
      }).join('')}
      <tr class="s-rule"><td class="s-st-lbl"><b>Total</b></td><td class="s-st-r"></td><td class="s-st-r">${money(rcvTotal)}</td><td class="s-st-r">${money(totalDeprec)}</td><td class="s-st-r">${money(acvTotal)}</td></tr>
    </tbody>
  </table>

  <div class="s-sum-section">Estimate Summary</div>
  <table class="s-sum-table">
    <thead>
      <tr>
        <th class="s-st-lbl">Estimate Name</th>
        ${hasMat ? '<th class="s-st-r">Materials</th>' : ''}
        ${hasLab ? '<th class="s-st-r">Labor</th>' : ''}
        ${hasEquip ? '<th class="s-st-r">Equipment</th>' : ''}
        <th class="s-st-r">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="s-st-lbl">Structure (${companyName || 'Contractor'})</td>
        ${hasMat ? `<td class="s-st-r">${money(totMaterials)}</td>` : ''}
        ${hasLab ? `<td class="s-st-r">${money(totLabor)}</td>` : ''}
        ${hasEquip ? `<td class="s-st-r">${money(totEquip)}</td>` : ''}
        <td class="s-st-r">${money(lineItemTotal)}</td>
      </tr>
    </tbody>
  </table>

  <div class="s-sum-section">Claim Totals</div>
  <table class="s-sum-table" style="max-width:420px">
    <tbody>
      <tr><td>Total taxes:</td><td class="s-st-r">${money(totalTax)}</td></tr>
      <tr><td>Total RCV:</td><td class="s-st-r">${money(rcvTotal)}</td></tr>
      ${totalDeprec > 0 ? `<tr class="s-paren"><td>Less recoverable depreciation:</td><td class="s-st-r">${money(totalDeprec)}</td></tr>` : ''}
      <tr class="s-rule"><td>Actual Cash Value:</td><td class="s-st-r">${money(acvTotal)}</td></tr>
      <tr class="s-paren"><td>Deductible:</td><td class="s-st-r">${money(deductible)}</td></tr>
      <tr class="s-rule2"><td>Net ACV:</td><td class="s-st-r">${money(netAcv)}</td></tr>
    </tbody>
  </table>

  <div class="s-sum-section">Coverage Summary</div>
  <table class="s-sum-table">
    <thead>
      <tr>
        <th class="s-st-lbl">Coverage</th>
        <th class="s-st-r">RC</th>
        <th class="s-st-r">Depreciation</th>
        <th class="s-st-r">Applied Deductible</th>
        <th class="s-st-r">Net ACV</th>
        <th class="s-st-r">Payable if Recovered</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="s-st-lbl">Building</td>
        <td class="s-st-r">${money(rcvTotal)}</td>
        <td class="s-st-r">${money(totalDeprec)}</td>
        <td class="s-st-r">${money(deductible)}</td>
        <td class="s-st-r">${money(netAcv)}</td>
        <td class="s-st-r">${money(totalDeprec)}</td>
      </tr>
      <tr class="s-rule">
        <td class="s-st-lbl">Totals</td>
        <td class="s-st-r">${money(rcvTotal)}</td>
        <td class="s-st-r">${money(totalDeprec)}</td>
        <td class="s-st-r">${money(deductible)}</td>
        <td class="s-st-r">${money(netAcv)}</td>
        <td class="s-st-r">${money(totalDeprec)}</td>
      </tr>
    </tbody>
  </table>

  <div class="s-foot">
    <span>${claimNo ? `Claim ${estNo}` : estNo}</span>
    <span>${esc(todayStr)}</span>
    <span>Page: 3</span>
  </div>
</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${estNo} - Symbility</title>
<style>${sStyle}</style></head>
<body>
${printButton()}
${coverPage}
${detailPage}
${summaryPage}
</body></html>`;
}
