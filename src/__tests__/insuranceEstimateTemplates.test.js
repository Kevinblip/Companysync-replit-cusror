import { describe, it, expect } from 'vitest';
import {
  generateXactimateHTML,
  generateSymbilityHTML,
  validateInsuranceEstimateData,
  resolveOverheadProfitPercentages,
} from '../utils/insuranceEstimateTemplates.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const COMPANY = {
  company_name: 'Apex Roofing LLC',
  contact_name: 'Jane Smith',
  phone: '555-111-2222',
  address: '100 Main St, Austin TX 78701',
};

const CUSTOMER = {
  name: 'John Doe',
  property_address: '42 Elm Street, Dallas TX 75201',
};

const ESTIMATE = {
  claim_number: 'CLM-9999',
  policy_number: 'POL-12345',
  insurance_company: 'State Farm',
  type_of_loss: 'Wind/Hail',
  deductible: 1000,
};

const SHINGLE_ITEM = {
  description: 'Architectural shingle - remove & replace',
  quantity: 25,
  unit: 'SQ',
  rate: 200,
  tax: 50,
};

const UNDERLAYMENT_ITEM = {
  description: 'Synthetic underlayment',
  quantity: 25,
  unit: 'SQ',
  rate: 30,
};

const GUTTER_ITEM = {
  description: 'Gutter - 5" K-style aluminum',
  quantity: 120,
  unit: 'LF',
  rate: 8,
};

const GENERAL_ITEM = {
  description: 'Miscellaneous repair',
  quantity: 1,
  unit: 'EA',
  rate: 150,
};

const MEASUREMENTS = {
  surface_area_sqft: 2500,
  squares: 25,
  ridge_lf: 40,
  valley_lf: 20,
  perimeter_lf: 180,
};

// ---------------------------------------------------------------------------
// Helper: parse category section labels out of the HTML string
// ---------------------------------------------------------------------------
function extractCategoryOrder(html) {
  const matches = [];
  // Xactimate: <tr class="x-sect-hdr"><td colspan="5">SHINGLES</td></tr>
  // Symbility:  <tr class="s-cat-hdr"><td colspan="10">SHINGLES</td></tr>
  const re = /<tr class="[xs]-(?:sect|cat)-hdr"><td[^>]*>([^<]+)<\/td>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Xactimate tests
// ---------------------------------------------------------------------------
describe('generateXactimateHTML', () => {
  it('returns a complete HTML document', () => {
    const html = generateXactimateHTML();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('renders claim number in the output', () => {
    const html = generateXactimateHTML({ estimate: ESTIMATE });
    expect(html).toContain('CLM-9999');
  });

  it('renders policy number in the output', () => {
    const html = generateXactimateHTML({ estimate: ESTIMATE });
    expect(html).toContain('POL-12345');
  });

  it('renders insured name and property address', () => {
    const html = generateXactimateHTML({ customer: CUSTOMER });
    expect(html).toContain('John Doe');
    expect(html).toContain('42 Elm Street, Dallas TX 75201');
  });

  it('renders insurer / insurance company name', () => {
    const html = generateXactimateHTML({ estimate: ESTIMATE });
    expect(html).toContain('State Farm');
  });

  it('escapes HTML special chars in customer name', () => {
    const html = generateXactimateHTML({
      customer: { name: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // ----------- Financial math -----------------------------------------------

  it('computes line item total (sum of RCV across items)', () => {
    const items = [
      { description: 'Shingle', quantity: 10, rate: 100 },
      { description: 'Felt', quantity: 5, rate: 20 },
    ];
    // 10*100 + 5*20 = 1100
    const html = generateXactimateHTML({ items });
    // plain(1100) → "1,100.00"
    expect(html).toContain('1,100.00');
  });

  it('RCV = line item total + tax + O&P when overhead/profit are provided', () => {
    // Carrier-style O&P uses base + tax: overhead = 105, profit = 52.50.
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, tax: 50 }];
    const estimate = { overhead_pct: 10, profit_pct: 5 };
    const html = generateXactimateHTML({ items, estimate });
    expect(html).toContain('1,207.50'); // RCV
  });

  it('splits a selected format combined O&P rate into overhead and profit', () => {
    const percentages = resolveOverheadProfitPercentages(
      {},
      { show_op_column: true, overhead_profit_rate: 20 },
    );
    expect(percentages).toEqual({ overhead_pct: 10, profit_pct: 10 });

    const html = generateXactimateHTML({
      items: [{ description: 'Shingle', quantity: 10, rate: 100 }],
      estimate: percentages,
    });
    // 1,000 base + 100 overhead + 100 profit = 1,200 RCV.
    expect(html).toContain('1,200.00');
    expect(html).toContain('$200.00');
  });

  it('preserves explicit saved O&P percentages over a format default', () => {
    expect(resolveOverheadProfitPercentages(
      { overhead_pct: 12, profit_pct: 8 },
      { show_overhead_profit: true, overhead_profit_rate: 20 },
    )).toEqual({ overhead_pct: 12, profit_pct: 8 });
  });

  it('does not add format O&P a second time when Xactimate rows are present', () => {
    const html = generateXactimateHTML({
      items: [
        { description: 'Roofing work', quantity: 1, unit: 'LS', rate: 1000, rcv: 1000 },
        { code: 'O&P', description: "Add'l Overhead (10% General)", quantity: 1, unit: 'EA', rate: 0, rcv: 100 },
        { code: 'O&P', description: "Add'l Profit (10% General)", quantity: 1, unit: 'EA', rate: 0, rcv: 100 },
      ],
      estimate: { overhead_pct: 10, profit_pct: 10 },
    });

    expect(html).toContain("Add&#39;l Overhead");
    expect(html).toContain("Add&#39;l Profit");
    expect(summaryValue(html, 'Replacement Cost Value')).toBe(1200);
    expect(html).not.toContain('1,400.00');
  });

  it('RCV = line item total + tax when no O&P', () => {
    // lineItemTotal = 500, tax = 25 → RCV = 525
    const items = [{ description: 'Shingle', quantity: 5, rate: 100, tax: 25 }];
    const html = generateXactimateHTML({ items });
    expect(html).toContain('525.00');
  });

  it('ACV = RCV − depreciation', () => {
    // lineItemTotal = 1000, tax = 0, RCV = 1000
    // depreciation_percent = 20% → depreciation = 200
    // ACV = 800
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, depreciation_percent: 20 }];
    const html = generateXactimateHTML({ items });
    expect(html).toContain('800.00');
  });

  it('net payment = ACV − deductible', () => {
    // lineItemTotal = 1000, depreciation = 0, ACV = 1000, deductible = 500
    // netPayment = 500
    const items = [{ description: 'Shingle', quantity: 10, rate: 100 }];
    const estimate = { deductible: 500 };
    const html = generateXactimateHTML({ items, estimate });
    // money(500) → "$500.00"
    expect(html).toContain('$500.00');
  });

  it('net payment can be negative when deductible exceeds ACV', () => {
    const items = [{ description: 'Repair', quantity: 1, rate: 200 }];
    const estimate = { deductible: 500 };
    const html = generateXactimateHTML({ items, estimate });
    // netPayment = 200 − 500 = −300 → "-$300.00"
    expect(html).toContain('-$300.00');
  });

  // ----------- Category grouping order --------------------------------------

  it('groups categories in correct order: SHINGLES before GENERAL', () => {
    const items = [
      GENERAL_ITEM,
      SHINGLE_ITEM,
    ];
    const html = generateXactimateHTML({ items });
    const order = extractCategoryOrder(html);
    const shinglesIdx = order.indexOf('SHINGLES');
    const generalIdx = order.indexOf('GENERAL');
    expect(shinglesIdx).toBeGreaterThanOrEqual(0);
    expect(generalIdx).toBeGreaterThanOrEqual(0);
    expect(shinglesIdx).toBeLessThan(generalIdx);
  });

  it('places SHINGLES first and GENERAL last across all known categories', () => {
    const items = [
      GENERAL_ITEM,
      GUTTER_ITEM,
      UNDERLAYMENT_ITEM,
      SHINGLE_ITEM,
    ];
    const html = generateXactimateHTML({ items });
    const order = extractCategoryOrder(html);
    expect(order[0]).toBe('SHINGLES');
    expect(order[order.length - 1]).toBe('GENERAL');
  });

  it('items without a matching keyword fall into GENERAL', () => {
    const items = [{ description: 'Random unclassified work', quantity: 1, rate: 100 }];
    const html = generateXactimateHTML({ items });
    expect(html).toContain('GENERAL');
    expect(extractCategoryOrder(html)).toContain('GENERAL');
  });

  // ----------- Code-based category detection --------------------------------
  // Items that carry real Xactimate or Symbility codes should be grouped by
  // code prefix, not by keyword-scanning the description text.

  it('groups Xactimate RFG 300 code item as SHINGLES even with a non-descriptive name', () => {
    const items = [
      { description: 'Premium material', code: 'RFG 300', quantity: 10, rate: 100 },
    ];
    const html = generateXactimateHTML({ items });
    expect(extractCategoryOrder(html)).toContain('SHINGLES');
  });

  it('groups Xactimate RFG SYN code item as UNDERLAYMENTS', () => {
    const items = [{ description: 'Material', code: 'RFG SYN', quantity: 10, rate: 30 }];
    const html = generateXactimateHTML({ items });
    expect(extractCategoryOrder(html)).toContain('UNDERLAYMENTS');
  });

  it('groups Xactimate GUT ALU code item as GUTTER & DOWNSPOUT', () => {
    const items = [{ description: 'Material', code: 'GUT ALU', quantity: 120, rate: 8 }];
    const html = generateXactimateHTML({ items });
    expect(extractCategoryOrder(html)).toContain('GUTTER &amp; DOWNSPOUT');
  });

  it('groups Xactimate SID 180 code item as SIDING', () => {
    const items = [{ description: 'Material', code: 'SID 180', quantity: 20, rate: 90 }];
    const html = generateXactimateHTML({ items });
    expect(extractCategoryOrder(html)).toContain('SIDING');
  });

  it('groups Xactimate RFG RMV code item as DEBRIS REMOVAL', () => {
    const items = [{ description: 'Remove', code: 'RFG RMV', quantity: 20, rate: 50 }];
    const html = generateXactimateHTML({ items });
    expect(extractCategoryOrder(html)).toContain('DEBRIS REMOVAL');
  });

  it('groups Symbility RF-SHGL-ARCH code item as SHINGLES', () => {
    const items = [{ description: 'Material', code: 'RF-SHGL-ARCH', quantity: 25, rate: 200 }];
    const html = generateXactimateHTML({ items });
    expect(extractCategoryOrder(html)).toContain('SHINGLES');
  });

  it('groups Symbility RF-UND-SYN code item as UNDERLAYMENTS', () => {
    const items = [{ description: 'Material', code: 'RF-UND-SYN', quantity: 25, rate: 30 }];
    const html = generateXactimateHTML({ items });
    expect(extractCategoryOrder(html)).toContain('UNDERLAYMENTS');
  });

  it('groups Symbility RF-VNT-RDG code item as VENTS AND FLASHINGS', () => {
    const items = [{ description: 'Material', code: 'RF-VNT-RDG', quantity: 40, rate: 12 }];
    const html = generateXactimateHTML({ items });
    expect(extractCategoryOrder(html)).toContain('VENTS AND FLASHINGS');
  });

  it('groups Symbility GU-ALU-5 code item as GUTTER & DOWNSPOUT', () => {
    const items = [{ description: 'Material', code: 'GU-ALU-5', quantity: 120, rate: 8 }];
    const html = generateXactimateHTML({ items });
    expect(extractCategoryOrder(html)).toContain('GUTTER &amp; DOWNSPOUT');
  });

  it('groups Symbility SI-VNL code item as SIDING', () => {
    const items = [{ description: 'Material', code: 'SI-VNL', quantity: 15, rate: 90 }];
    const html = generateXactimateHTML({ items });
    expect(extractCategoryOrder(html)).toContain('SIDING');
  });

  it('code-based detection puts coded items in SHINGLES before non-coded GENERAL item', () => {
    const items = [
      { description: 'Uncategorised work', quantity: 1, rate: 100 },
      { description: 'Item with code', code: 'RFG 300', quantity: 10, rate: 100 },
    ];
    const html = generateXactimateHTML({ items });
    const order = extractCategoryOrder(html);
    expect(order.indexOf('SHINGLES')).toBeLessThan(order.indexOf('GENERAL'));
  });

  it('trade summary puts GUT ALU code item under SFG trade', () => {
    const items = [{ description: 'Gutter', code: 'GUT ALU', quantity: 100, rate: 8 }];
    const html = generateXactimateHTML({ items });
    expect(html).toContain('SOFFIT, FASCIA, &amp; GUTTER');
  });

  // ----------- Measurements -------------------------------------------------

  it('includes measurement block when measurements are provided', () => {
    const html = generateXactimateHTML({ measurements: MEASUREMENTS });
    // class="x-grand-areas" only appears on the rendered element, not the CSS rule (.x-grand-areas)
    expect(html).toContain('class="x-grand-areas"');
    expect(html).toContain('Surface Area');
    expect(html).toContain('Number of Squares');
  });

  it('omits measurement block when no measurements are provided', () => {
    const html = generateXactimateHTML({ measurements: {} });
    expect(html).not.toContain('class="x-grand-areas"');
    expect(html).not.toContain('Grand Total Areas');
  });

  it('omits measurement block when all measurement values are zero', () => {
    const html = generateXactimateHTML({
      measurements: { surface_area_sqft: 0, squares: 0 },
    });
    expect(html).not.toContain('class="x-grand-areas"');
  });

  it('renders ridge and valley measurements when provided', () => {
    const html = generateXactimateHTML({ measurements: MEASUREMENTS });
    expect(html).toContain('Total Ridge Length');
    expect(html).toContain('Total Valley Length');
  });

  // ----------- Section label ------------------------------------------------

  it('uses estimate.section_label in summary heading', () => {
    const html = generateXactimateHTML({
      estimate: { section_label: 'Detached Garage' },
    });
    expect(html).toContain('Summary for Detached Garage');
  });

  it('defaults section label to Roof when not provided', () => {
    const html = generateXactimateHTML({});
    expect(html).toContain('Summary for Roof');
  });

  // ----------- Empty / edge cases -------------------------------------------

  it('handles empty items array without throwing', () => {
    expect(() => generateXactimateHTML({ items: [] })).not.toThrow();
  });

  it('handles completely empty data without throwing', () => {
    expect(() => generateXactimateHTML({})).not.toThrow();
  });

  it('uses estimate_number as fallback when no claim_number', () => {
    const html = generateXactimateHTML({
      estimate: { estimate_number: 'EST-0042' },
    });
    expect(html).toContain('EST-0042');
  });

  it('uses rcv field on item when provided directly', () => {
    // rcv overrides qty*rate
    const items = [{ description: 'Shingle', quantity: 1, rate: 1, rcv: 999 }];
    const html = generateXactimateHTML({ items });
    expect(html).toContain('999.00');
  });

  it('renders company name and preparer in cover page', () => {
    const html = generateXactimateHTML({ company: COMPANY, estimate: ESTIMATE });
    expect(html).toContain('Apex Roofing LLC');
    expect(html).toContain('Jane Smith');
  });

  // ----------- Options: per-line depreciation columns -----------------------

  it('does NOT render per-line depreciation columns by default', () => {
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, depreciation_percent: 20 }];
    const html = generateXactimateHTML({ items });
    expect(html).not.toContain('AGE/LIFE');
    expect(html).not.toContain('DEP %');
    expect(html).toContain('<td colspan="5">'); // section header stays 5-wide
  });

  it('renders per-line depreciation columns when showDepColumns is true', () => {
    const items = [{
      description: 'Shingle', quantity: 10, rate: 100,
      depreciation_percent: 20, age: 15, life: 30, condition: 'Avg',
    }];
    const html = generateXactimateHTML({ items }, { showDepColumns: true });
    expect(html).toContain('AGE/LIFE');
    expect(html).toContain('COND.');
    expect(html).toContain('DEP %');
    expect(html).toContain('DEPREC.');
    // Detail table has 10 columns → section header colspan widens
    expect(html).toContain('<td colspan="10">');
    // Per-line values render: age/life "15/30", dep% "20.00%", condition "Avg"
    expect(html).toContain('15/30');
    expect(html).toContain('20.00%');
    expect(html).toContain('Avg');
    // Per-line depreciation shown in parentheses (accounting negative): 10*100*20% = 200
    expect(html).toContain('(200.00)');
    // Per-line ACV = 1000 − 200 = 800
    expect(html).toContain('800.00');
    expect(html).toContain('x-items-dep'); // narrower table class applied
  });

  it('escapes HTML in the item condition field for dep columns', () => {
    const items = [{ description: 'Shingle', quantity: 1, rate: 100, condition: '<b>x</b>' }];
    const html = generateXactimateHTML({ items }, { showDepColumns: true });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  // ----------- Options: trade summary page ----------------------------------

  it('renders the Trade Summary page by default', () => {
    const items = [SHINGLE_ITEM];
    const html = generateXactimateHTML({ items });
    expect(html).toContain('Trade Summary');
  });

  it('omits the Trade Summary page when includeTradeSummary is false', () => {
    const items = [SHINGLE_ITEM];
    const html = generateXactimateHTML({ items }, { includeTradeSummary: false });
    expect(html).not.toContain('Trade Summary');
  });

  // ----------- Reconciliation: detail columns tie to the cover summary -------
  // The per-line RCV/ACV columns on the detail page must sum EXACTLY to the
  // Replacement Cost Value / Actual Cash Value on the cover page once material
  // tax and/or O&P are applied. Tax and each line's share of O&P are folded into
  // the line RCV so the columns reconcile.

  const parseMoney = (s) => parseFloat(String(s).replace(/[,()$]/g, '')) || 0;

  // Sum the per-line RCV (4th x-num cell) and ACV (9th x-num cell, only present
  // when depreciation columns render) across every detail row.
  const sumDetailColumns = (html) => {
    const rows = html.match(/<tr class="x-item">[\s\S]*?<\/tr>/g) || [];
    let rcv = 0;
    let acv = 0;
    let hasAcv = false;
    for (const row of rows) {
      const cells = [...row.matchAll(/<td class="x-num">([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      rcv += parseMoney(cells[3]); // [qty, rate, tax, RCV, ...]
      if (cells.length >= 9) {
        acv += parseMoney(cells[8]); // [..., age/life, cond, dep%, deprec, ACV]
        hasAcv = true;
      }
    }
    return { rcv: Math.round(rcv * 100) / 100, acv: Math.round(acv * 100) / 100, hasAcv };
  };

  const summaryValue = (html, label) => {
    const m = html.match(new RegExp(label + '</td><td class="v">([\\d,]+\\.\\d\\d)'));
    return m ? parseMoney(m[1]) : null;
  };

  // Three lines: material shingle (tax + dep), material underlayment (tax), and
  // a labor tear-off line (no tax). Numbers chosen to divide evenly so there is
  // no penny rounding drift.
  const RECON_ITEMS = [
    { description: 'Architectural shingles - remove & replace', quantity: 20, rate: 100, tax: 200, depreciation_percent: 25 },
    { description: 'Synthetic underlayment', quantity: 10, rate: 100, tax: 100 },
    { description: 'Tear off old roof & haul debris', quantity: 20, rate: 25, tax: 0 },
  ];
  // O&P is calculated per line on base + tax: 440 + 220 + 100 = 760.
  // rcvTotal = 3500 + 300 + 760 = 4560; dep = 2000*25% = 500; acvTotal = 4060

  it('per-line RCV column sums exactly to summary RCV with tax + O&P', () => {
    const html = generateXactimateHTML(
      { items: RECON_ITEMS, estimate: { overhead_pct: 10, profit_pct: 10 } },
    );
    const { rcv } = sumDetailColumns(html);
    const summaryRcv = summaryValue(html, 'Replacement Cost Value');
    expect(summaryRcv).toBe(4560);
    expect(rcv).toBe(summaryRcv);
  });

  it('per-line RCV and ACV columns sum exactly to summary RCV/ACV with tax + O&P + depreciation', () => {
    const html = generateXactimateHTML(
      { items: RECON_ITEMS, estimate: { overhead_pct: 10, profit_pct: 10 } },
      { showDepColumns: true },
    );
    const { rcv, acv, hasAcv } = sumDetailColumns(html);
    const summaryRcv = summaryValue(html, 'Replacement Cost Value');
    const summaryAcv = summaryValue(html, 'Actual Cash Value');
    expect(hasAcv).toBe(true);
    expect(summaryRcv).toBe(4560);
    expect(summaryAcv).toBe(4060);
    expect(rcv).toBe(summaryRcv);
    expect(acv).toBe(summaryAcv);
  });

  it('per-line RCV column sums to summary RCV with tax only (no O&P)', () => {
    const html = generateXactimateHTML({ items: RECON_ITEMS });
    const { rcv } = sumDetailColumns(html);
    const summaryRcv = summaryValue(html, 'Replacement Cost Value');
    // No O&P: RCV = lineItemTotal + tax = 3500 + 300 = 3800
    expect(summaryRcv).toBe(3800);
    expect(rcv).toBe(summaryRcv);
  });

  it('leaves per-line RCV as the base line cost when no tax or O&P (default unchanged)', () => {
    const items = [
      { description: 'Architectural shingles', quantity: 20, rate: 100 },
      { description: 'Synthetic underlayment', quantity: 10, rate: 100 },
    ];
    const html = generateXactimateHTML({ items });
    const { rcv } = sumDetailColumns(html);
    const summaryRcv = summaryValue(html, 'Replacement Cost Value');
    // No tax, no O&P: per-line RCV is unchanged base cost; sum = 3000
    expect(summaryRcv).toBe(3000);
    expect(rcv).toBe(3000);
  });

  // Fractional inputs that would drift a cent under naive per-line rounding.
  // Carrier math rounds O&P independently on every line, so each RCV is 36.66
  // and both the rendered column and summary must be 109.98.
  it('reconciles the RCV column exactly on fractional values (penny-drift guard)', () => {
    const items = [
      { description: 'Fractional line A', quantity: 1, rate: 33.33 },
      { description: 'Fractional line B', quantity: 1, rate: 33.33 },
      { description: 'Fractional line C', quantity: 1, rate: 33.33 },
    ];
    const html = generateXactimateHTML({ items, estimate: { overhead_pct: 10 } });
    const { rcv } = sumDetailColumns(html);
    const summaryRcv = summaryValue(html, 'Replacement Cost Value');
    expect(summaryRcv).toBe(109.98);
    expect(rcv).toBe(109.98);
  });

  it('reconciles RCV and ACV columns exactly on fractional values with depreciation', () => {
    const items = [
      { description: 'Shingle A', quantity: 1, rate: 33.33, depreciation_percent: 33 },
      { description: 'Shingle B', quantity: 1, rate: 33.33, depreciation_percent: 33 },
      { description: 'Shingle C', quantity: 1, rate: 33.33, depreciation_percent: 33 },
    ];
    const html = generateXactimateHTML(
      { items, estimate: { overhead_pct: 10 } },
      { showDepColumns: true },
    );
    const { rcv, acv, hasAcv } = sumDetailColumns(html);
    const summaryRcv = summaryValue(html, 'Replacement Cost Value');
    const summaryAcv = summaryValue(html, 'Actual Cash Value');
    expect(hasAcv).toBe(true);
    expect(rcv).toBe(summaryRcv);
    expect(acv).toBe(summaryAcv);
  });

  // The trade-summary page renders the same per-line RCV/ACV and must tie to the
  // summary too. Uses fractional values to catch rounding drift on that page.
  it('reconciles the trade-summary RCV/ACV columns exactly on fractional values', () => {
    const items = [
      { description: 'Shingle A', quantity: 1, rate: 33.33, depreciation_percent: 33 },
      { description: 'Shingle B', quantity: 1, rate: 33.33, depreciation_percent: 33 },
      { description: 'Shingle C', quantity: 1, rate: 33.33, depreciation_percent: 33 },
    ];
    const html = generateXactimateHTML({ items, estimate: { overhead_pct: 10 } });
    const tradeRows = html.match(/<tr class="x-tr-item">[\s\S]*?<\/tr>/g) || [];
    let rcv = 0;
    let acv = 0;
    for (const row of tradeRows) {
      const cells = [...row.matchAll(/<td class="x-tr-amt">([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      rcv += parseMoney(cells[0]); // [RCV, TAX, O&P, ACV]
      acv += parseMoney(cells[3]);
    }
    rcv = Math.round(rcv * 100) / 100;
    acv = Math.round(acv * 100) / 100;
    const summaryRcv = summaryValue(html, 'Replacement Cost Value');
    const summaryAcv = summaryValue(html, 'Actual Cash Value');
    expect(rcv).toBe(summaryRcv);
    expect(acv).toBe(summaryAcv);
  });
});

// ---------------------------------------------------------------------------
// Symbility tests
// ---------------------------------------------------------------------------
describe('generateSymbilityHTML', () => {
  it('returns a complete HTML document', () => {
    const html = generateSymbilityHTML();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  // ----------- New layout parity tests ----------------------------------------

  it('shows claim number in footer on all three pages', () => {
    const html = generateSymbilityHTML({ estimate: ESTIMATE });
    const footerMatches = [...html.matchAll(/class="s-foot"/g)];
    // Cover (p1), detail (p2), summary (p3) — all three pages must have a footer
    expect(footerMatches.length).toBeGreaterThanOrEqual(3);
    // Claim number must appear in the footer content (not just the header)
    const footerSection = html.split('class="s-foot"').slice(1).join('');
    expect(footerSection).toContain('CLM-9999');
  });

  it('includes property address in the detail page section header', () => {
    const html = generateSymbilityHTML({
      customer: CUSTOMER,
      items: [{ description: 'Shingles', quantity: 20, rate: 100 }],
    });
    // The section-hdr element on the detail page shows ROOFPLAN: … — address
    const sectionHdr = html.match(/class="s-section-hdr">[^<]+<\/div>/);
    expect(sectionHdr).not.toBeNull();
    expect(sectionHdr[0]).toContain('42 Elm Street');
  });

  it('renders a Category Summary table on the summary page', () => {
    const items = [
      { description: 'Architectural shingles', quantity: 20, rate: 100 },
      { description: 'Synthetic underlayment', quantity: 10, rate: 50 },
    ];
    const html = generateSymbilityHTML({ items });
    expect(html).toContain('Category Summary');
    // Table must show at least two category rows (SHINGLES + UNDERLAYMENTS)
    expect(html).toContain('SHINGLES');
    expect(html).toContain('UNDERLAYMENTS');
  });

  it('category summary RC total matches rcvTotal (no tax case)', () => {
    const items = [
      { description: 'Architectural shingles', quantity: 20, rate: 100 },
      { description: 'Synthetic underlayment', quantity: 10, rate: 50 },
    ];
    const html = generateSymbilityHTML({ items });
    // lineItemTotal = 2000 + 500 = 2500, no tax → rcvTotal = 2500
    expect(html).toContain('$2,500.00');
  });

  it('category summary Total RC matches category row RCs even when tax is applied', () => {
    // Repro of review bug: tax causes itemRcv to include tax, but old Total row used lineItemTotal
    const items = [{ description: 'Architectural shingles', quantity: 10, rate: 100, tax: 100 }];
    const html = generateSymbilityHTML({ items });
    // lineItemTotal = 1000, tax = 100 → rcvTotal = 1100
    // Category row RC must equal 1100 (itemRcv includes folded tax)
    // Total row RC must also equal 1100 (not 1000), so RC >= ACV on the same row
    const catSummaryMatch = html.match(/Category Summary[\s\S]*?<\/table>/);
    expect(catSummaryMatch).not.toBeNull();
    const catTable = catSummaryMatch[0];
    // Both the category row and the Total row must show $1,100.00 for RC (not $1,000.00)
    const moneyMatches = [...catTable.matchAll(/\$[\d,]+\.\d{2}/g)].map((m) => m[0]);
    // RC column values should all be 1100, none should be 1000 in the RC column
    expect(catTable).toContain('$1,100.00');
    expect(catTable).not.toContain('$1,000.00');
  });

  it('groups Symbility RF-SHGL-ARCH code item under SHINGLES on summary page', () => {
    const items = [{ description: 'Material', code: 'RF-SHGL-ARCH', quantity: 25, rate: 200 }];
    const html = generateSymbilityHTML({ items });
    expect(html).toContain('SHINGLES');
    expect(html).not.toContain('GENERAL');
  });

  it('renders claim number', () => {
    const html = generateSymbilityHTML({ estimate: ESTIMATE });
    expect(html).toContain('CLM-9999');
  });

  it('renders policy number', () => {
    const html = generateSymbilityHTML({ estimate: ESTIMATE });
    expect(html).toContain('POL-12345');
  });

  it('renders insured name and property address', () => {
    const html = generateSymbilityHTML({ customer: CUSTOMER });
    expect(html).toContain('John Doe');
    expect(html).toContain('42 Elm Street, Dallas TX 75201');
  });

  it('renders insurer name', () => {
    const html = generateSymbilityHTML({ estimate: ESTIMATE });
    expect(html).toContain('State Farm');
  });

  it('uses the CoreLogic worksheet visual hierarchy', () => {
    const html = generateSymbilityHTML({ estimate: ESTIMATE, items: [SHINGLE_ITEM] });
    expect(html).toContain('s-core-claim');
    expect(html).toContain('s-core-insured-head');
    expect(html).toContain('s-core-claimbar');
    expect(html).toContain('s-core-status');
    expect(html).toContain('background:#d3daee');
  });

  it('renders subscriber company identity on the cover', () => {
    const html = generateSymbilityHTML({
      company: { ...COMPANY, email: 'office@apexroofing.example', license_number: 'ROC-123' },
      estimate: ESTIMATE,
    });
    expect(html).toContain('CONTRACTOR /<br>SUBSCRIBER');
    expect(html).toContain('Apex Roofing LLC');
    expect(html).toContain('100 Main St, Austin TX 78701');
    expect(html).toContain('office@apexroofing.example');
    expect(html).toContain('ROC-123');
  });

  it('escapes HTML special chars in address', () => {
    const html = generateSymbilityHTML({
      customer: { property_address: '<b>Bold St</b>' },
    });
    expect(html).not.toContain('<b>Bold St</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  // ----------- Financial math -----------------------------------------------

  it('RCV = line item total + tax (no O&P for Symbility)', () => {
    // lineItemTotal = 1000, tax = 75 → rcvTotal = 1075
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, tax: 75 }];
    const html = generateSymbilityHTML({ items });
    expect(html).toContain('$1,075.00');
  });

  it('ACV = RCV − depreciation', () => {
    // lineItemTotal = 1000, tax = 0, RCV = 1000
    // depreciation_percent = 25% → depreciation = 250, ACV = 750
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, depreciation_percent: 25 }];
    const html = generateSymbilityHTML({ items });
    expect(html).toContain('$750.00');
  });

  it('net ACV = ACV − deductible', () => {
    // lineItemTotal = 2000, depreciation = 0, ACV = 2000, deductible = 750
    // netAcv = 1250
    const items = [{ description: 'Shingle', quantity: 20, rate: 100 }];
    const estimate = { deductible: 750 };
    const html = generateSymbilityHTML({ items, estimate });
    expect(html).toContain('$1,250.00');
  });

  it('net ACV can be negative', () => {
    const items = [{ description: 'Repair', quantity: 1, rate: 300 }];
    const estimate = { deductible: 500 };
    const html = generateSymbilityHTML({ items, estimate });
    // netAcv = 300 − 500 = −200 → "-$200.00"
    expect(html).toContain('-$200.00');
  });

  it('shows depreciation row only when depreciation > 0', () => {
    const itemsWithDeprec = [
      { description: 'Shingle', quantity: 10, rate: 100, depreciation_percent: 10 },
    ];
    const htmlWith = generateSymbilityHTML({ items: itemsWithDeprec });
    expect(htmlWith).toContain('recoverable depreciation');

    const itemsNoDeprec = [{ description: 'Shingle', quantity: 10, rate: 100 }];
    const htmlWithout = generateSymbilityHTML({ items: itemsNoDeprec });
    expect(htmlWithout).not.toContain('recoverable depreciation');
  });

  // ----------- Category grouping order --------------------------------------

  it('places SHINGLES before GENERAL in output', () => {
    const items = [GENERAL_ITEM, SHINGLE_ITEM];
    const html = generateSymbilityHTML({ items });
    const order = extractCategoryOrder(html);
    const shIdx = order.indexOf('SHINGLES');
    const genIdx = order.indexOf('GENERAL');
    expect(shIdx).toBeGreaterThanOrEqual(0);
    expect(genIdx).toBeGreaterThanOrEqual(0);
    expect(shIdx).toBeLessThan(genIdx);
  });

  it('SHINGLES first, GENERAL last across mixed categories', () => {
    const items = [GENERAL_ITEM, GUTTER_ITEM, UNDERLAYMENT_ITEM, SHINGLE_ITEM];
    const html = generateSymbilityHTML({ items });
    const order = extractCategoryOrder(html);
    expect(order[0]).toBe('SHINGLES');
    expect(order[order.length - 1]).toBe('GENERAL');
  });

  // ----------- Remove/Replace dual-row logic --------------------------------

  it('renders two rows (Remove + Replace) when remove_cost and replace_cost are set', () => {
    const items = [
      {
        description: 'Roofing shingle',
        quantity: 20,
        unit: 'SQ',
        remove_cost: 400,
        replace_cost: 3600,
      },
    ];
    const html = generateSymbilityHTML({ items });
    expect(html).toContain('Roofing shingle - Remove');
    expect(html).toContain('Roofing shingle - Replace');
  });

  it('does NOT split into two rows when only replace_cost is set (no remove_cost)', () => {
    const items = [
      {
        description: 'Gutter apron',
        quantity: 50,
        unit: 'LF',
        replace_cost: 300,
      },
    ];
    const html = generateSymbilityHTML({ items });
    expect(html).not.toContain('Gutter apron - Remove');
    expect(html).not.toContain('Gutter apron - Replace');
    expect(html).toContain('Gutter apron');
  });

  it('does NOT split into two rows when only remove_cost is set (no replace_cost)', () => {
    const items = [
      {
        description: 'Old flashing',
        quantity: 10,
        unit: 'LF',
        remove_cost: 100,
      },
    ];
    const html = generateSymbilityHTML({ items });
    expect(html).not.toContain('Old flashing - Remove');
    expect(html).not.toContain('Old flashing - Replace');
    expect(html).toContain('Old flashing');
  });

  it('counts dual-row item as 2 rows in subtotal label', () => {
    const items = [
      {
        description: 'Shingle',
        quantity: 20,
        unit: 'SQ',
        category: 'Shingles',
        remove_cost: 400,
        replace_cost: 3600,
      },
    ];
    const html = generateSymbilityHTML({ items });
    // "2 items" because one source item expands to 2 rows
    expect(html).toContain('2 items');
  });

  it('Remove row amount equals remove_cost value', () => {
    const items = [
      {
        description: 'Ridge cap',
        quantity: 4,
        unit: 'SQ',
        remove_cost: 200,
        replace_cost: 800,
      },
    ];
    const html = generateSymbilityHTML({ items });
    // Remove row should show $200.00 and Replace row $800.00
    expect(html).toContain('$200.00');
    expect(html).toContain('$800.00');
  });

  // ----------- Measurements -------------------------------------------------

  it('includes measurement block when measurements provided', () => {
    const html = generateSymbilityHTML({ measurements: MEASUREMENTS });
    // class="s-meas-row" only appears on the rendered element, not the CSS rule (.s-meas-row)
    expect(html).toContain('class="s-meas-row"');
    expect(html).toContain('Roof area');
    expect(html).toContain('Squares');
  });

  it('omits measurement block when measurements are empty', () => {
    const html = generateSymbilityHTML({ measurements: {} });
    expect(html).not.toContain('class="s-meas-row"');
  });

  it('omits measurement block when all values are zero', () => {
    const html = generateSymbilityHTML({
      measurements: { surface_area_sqft: 0, squares: 0 },
    });
    expect(html).not.toContain('class="s-meas-row"');
  });

  it('renders ridge and valley measurements', () => {
    const html = generateSymbilityHTML({ measurements: MEASUREMENTS });
    expect(html).toContain('Ridge');
    expect(html).toContain('Valley');
  });

  // ----------- Section label ------------------------------------------------

  it('uses estimate.section_label as roofplan label', () => {
    const html = generateSymbilityHTML({
      estimate: { section_label: 'Garage Roof' },
    });
    expect(html).toContain('ROOFPLAN: Garage Roof');
  });

  it('defaults roofplan label to "House Roof"', () => {
    const html = generateSymbilityHTML({});
    expect(html).toContain('ROOFPLAN: House Roof');
  });

  // ----------- Edge cases ---------------------------------------------------

  it('handles empty items array without throwing', () => {
    expect(() => generateSymbilityHTML({ items: [] })).not.toThrow();
  });

  it('handles completely empty data without throwing', () => {
    expect(() => generateSymbilityHTML({})).not.toThrow();
  });

  it('uses estimate_number as fallback when no claim_number', () => {
    const html = generateSymbilityHTML({
      estimate: { estimate_number: 'SYM-0001' },
    });
    expect(html).toContain('SYM-0001');
  });

  it('renders company and preparer info when provided', () => {
    const html = generateSymbilityHTML({ company: COMPANY, estimate: ESTIMATE });
    expect(html).toContain('Apex Roofing LLC');
    expect(html).toContain('Jane Smith');
  });

  it('shows three pages: cover, detail, and summary', () => {
    const html = generateSymbilityHTML({
      company: COMPANY,
      customer: CUSTOMER,
      estimate: ESTIMATE,
      items: [SHINGLE_ITEM],
    });
    // Each page has a footer with "Page: N"
    expect(html).toContain('Page: 1');
    expect(html).toContain('Page: 2');
    expect(html).toContain('Page: 3');
  });

  // ----------- Reconciliation: detail columns tie to the summary -------------
  // Symbility's summary uses rcvTotal = lineItemTotal + totalTax and
  // acvTotal = rcvTotal - totalDeprec (tax included). The per-line RC and ACV
  // columns (and category subtotals) must sum EXACTLY to the summary "Total RCV"
  // and "Actual Cash Value" once material tax is applied. Tax is folded into the
  // line RC so the columns reconcile.

  const symParseMoney = (s) => parseFloat(String(s).replace(/[,()$]/g, '')) || 0;

  // Sum the per-line RC (5th s-num cell) and ACV (7th s-num cell) across every
  // detail row. s-num cell order: [qty, rate, O&P, tax, RC, deprec, ACV].
  const sumSymDetail = (html) => {
    const rows = html.match(/<tr class="s-item">[\s\S]*?<\/tr>/g) || [];
    let rcv = 0;
    let acv = 0;
    for (const row of rows) {
      const cells = [...row.matchAll(/<td class="s-num">([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      rcv += symParseMoney(cells[4]);
      acv += symParseMoney(cells[6]);
    }
    return { rcv: Math.round(rcv * 100) / 100, acv: Math.round(acv * 100) / 100 };
  };

  // Sum the per-category subtotal rows (RC = 8th s-num overall, ACV = 10th).
  // s-subtot cells: [O&P, tax, RC, deprec, ACV].
  const sumSymSubtotals = (html) => {
    const rows = html.match(/<tr class="s-subtot">[\s\S]*?<\/tr>/g) || [];
    let rcv = 0;
    let acv = 0;
    for (const row of rows) {
      const cells = [...row.matchAll(/<td class="s-num">([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      rcv += symParseMoney(cells[2]);
      acv += symParseMoney(cells[4]);
    }
    return { rcv: Math.round(rcv * 100) / 100, acv: Math.round(acv * 100) / 100 };
  };

  // Read a labelled dollar value from a summary table (first $ after the label).
  const symSummaryValue = (html, label) => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = html.match(new RegExp(esc + '[\\s\\S]*?\\$([\\d,]+\\.\\d\\d)'));
    return m ? symParseMoney(m[1]) : null;
  };

  it('per-line RC and ACV columns sum exactly to summary RCV/ACV with tax', () => {
    const items = [
      { description: 'Architectural shingles', quantity: 20, rate: 100, tax: 200, depreciation_percent: 25 },
      { description: 'Synthetic underlayment', quantity: 10, rate: 100, tax: 100 },
      { description: 'Tear off & haul debris', quantity: 20, rate: 25, tax: 0 },
    ];
    const html = generateSymbilityHTML({ items, estimate: { deductible: 100 } });
    const { rcv, acv } = sumSymDetail(html);
    // lineItemTotal = 3500, tax = 300 -> RCV 3800; dep = 2000*25% = 500 -> ACV 3300
    expect(symSummaryValue(html, 'Total RCV:')).toBe(3800);
    expect(symSummaryValue(html, 'Actual Cash Value:')).toBe(3300);
    expect(rcv).toBe(3800);
    expect(acv).toBe(3300);
  });

  it('category subtotals reconcile to the summary RCV/ACV with tax', () => {
    const items = [
      { description: 'Architectural shingles', quantity: 20, rate: 100, tax: 200, depreciation_percent: 25 },
      { description: 'Synthetic underlayment', quantity: 10, rate: 100, tax: 100 },
      { description: 'Tear off & haul debris', quantity: 20, rate: 25, tax: 0 },
    ];
    const html = generateSymbilityHTML({ items });
    const { rcv, acv } = sumSymSubtotals(html);
    expect(rcv).toBe(symSummaryValue(html, 'Total RCV:'));
    expect(acv).toBe(symSummaryValue(html, 'Actual Cash Value:'));
    expect(rcv).toBe(3800);
    expect(acv).toBe(3300);
  });

  it('reconciles the RC column exactly on fractional values with tax (penny-drift guard)', () => {
    const items = [
      { description: 'Frac A', quantity: 1, rate: 33.33, tax: 3.33 },
      { description: 'Frac B', quantity: 1, rate: 33.33, tax: 3.33 },
      { description: 'Frac C', quantity: 1, rate: 33.33, tax: 3.33 },
    ];
    const html = generateSymbilityHTML({ items });
    const { rcv } = sumSymDetail(html);
    const summaryRcv = symSummaryValue(html, 'Total RCV:');
    expect(rcv).toBe(summaryRcv);
  });

  it('reconciles RC and ACV columns exactly for the Remove/Replace two-row case with tax', () => {
    const items = [
      { description: 'Ridge cap shingles', quantity: 20, rate: 10, remove_cost: 40.55, replace_cost: 160.55, tax: 12.34, depreciation_percent: 25 },
      { description: 'Drip edge', quantity: 100, rate: 2.017, tax: 5.55, depreciation_percent: 10 },
    ];
    const html = generateSymbilityHTML({ items, estimate: { deductible: 100 } });
    const detail = sumSymDetail(html);
    const subtot = sumSymSubtotals(html);
    const summaryRcv = symSummaryValue(html, 'Total RCV:');
    const summaryAcv = symSummaryValue(html, 'Actual Cash Value:');
    // The Remove/Replace item renders as two detail rows that must still sum in.
    expect(html).toContain(' - Remove');
    expect(html).toContain(' - Replace');
    expect(detail.rcv).toBe(summaryRcv);
    expect(detail.acv).toBe(summaryAcv);
    expect(subtot.rcv).toBe(summaryRcv);
    expect(subtot.acv).toBe(summaryAcv);
  });

  it('leaves the RC column as the base cost when no tax (default unchanged)', () => {
    const items = [
      { description: 'Architectural shingles', quantity: 20, rate: 100 },
      { description: 'Synthetic underlayment', quantity: 10, rate: 100 },
    ];
    const html = generateSymbilityHTML({ items });
    const { rcv } = sumSymDetail(html);
    expect(symSummaryValue(html, 'Total RCV:')).toBe(3000);
    expect(rcv).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// validateInsuranceEstimateData tests
// ---------------------------------------------------------------------------
describe('validateInsuranceEstimateData', () => {
  it('returns an empty array for clean data', () => {
    const warnings = validateInsuranceEstimateData({
      items: [SHINGLE_ITEM, UNDERLAYMENT_ITEM],
      estimate: ESTIMATE,
    });
    expect(warnings).toEqual([]);
  });

  it('returns empty array when called with no arguments', () => {
    expect(validateInsuranceEstimateData()).toEqual([]);
  });

  it('returns empty array for empty items list', () => {
    expect(validateInsuranceEstimateData({ items: [] })).toEqual([]);
  });

  // --- Conflicting RCV sources -----------------------------------------------

  it('warns when item has both direct rcv and qty×rate that diverge by > 1%', () => {
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, rcv: 500 }];
    // qty*rate = 1000, direct rcv = 500 → diverge > 1%
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0]).toMatch(/RCV is set directly/);
  });

  it('does NOT warn when direct rcv and qty×rate match within 1%', () => {
    // qty*rate = 1000, direct rcv = 1005 → 0.5% difference → no warning
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, rcv: 1005 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('RCV is set directly'))).toBe(false);
  });

  it('does NOT warn when only direct rcv is provided (no qty/rate)', () => {
    const items = [{ description: 'Misc repair', rcv: 750 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('RCV is set directly'))).toBe(false);
  });

  it('does NOT warn when only qty and rate are provided (no direct rcv)', () => {
    const items = [{ description: 'Shingle', quantity: 10, rate: 200 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('RCV is set directly'))).toBe(false);
  });

  // --- Depreciation percent ---------------------------------------------------

  it('warns when depreciation_percent > 100', () => {
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, depreciation_percent: 110 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('exceeds 100%'))).toBe(true);
  });

  it('warns when depreciation_percent is negative', () => {
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, depreciation_percent: -5 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('depreciation percentage is negative'))).toBe(true);
  });

  it('does NOT warn for depreciation_percent = 0', () => {
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, depreciation_percent: 0 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('depreciation'))).toBe(false);
  });

  it('does NOT warn for depreciation_percent = 100 (boundary)', () => {
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, depreciation_percent: 100 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('exceeds 100%'))).toBe(false);
  });

  // --- Zero / negative quantity ----------------------------------------------

  it('warns when item quantity is 0', () => {
    const items = [{ description: 'Shingle', quantity: 0, rate: 100 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('quantity is'))).toBe(true);
  });

  it('warns when item quantity is negative', () => {
    const items = [{ description: 'Shingle', quantity: -5, rate: 100 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('quantity is'))).toBe(true);
  });

  it('does NOT warn when quantity is absent', () => {
    const items = [{ description: 'Misc', rcv: 500 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('quantity is'))).toBe(false);
  });

  it('warns when item uses qty (not quantity) field and it is zero', () => {
    const items = [{ description: 'Shingle', qty: 0, rate: 100 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('quantity is'))).toBe(true);
  });

  it('does NOT warn when item uses qty field and it is positive', () => {
    const items = [{ description: 'Shingle', qty: 5, rate: 100 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('quantity is'))).toBe(false);
  });

  // --- Negative unit price ---------------------------------------------------

  it('warns when item rate is negative', () => {
    const items = [{ description: 'Adjustment', quantity: 5, rate: -20 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('unit price is negative'))).toBe(true);
  });

  it('does NOT warn for rate = 0', () => {
    const items = [{ description: 'Free item', quantity: 1, rate: 0 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('unit price is negative'))).toBe(false);
  });

  // --- Missing description ----------------------------------------------------

  it('warns when item has no description or name', () => {
    const items = [{ quantity: 10, rate: 100 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('has no description'))).toBe(true);
  });

  it('does NOT warn when item has a name but no description', () => {
    const items = [{ name: 'Ridge cap', quantity: 4, rate: 50 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('has no description'))).toBe(false);
  });

  // --- Overhead / profit out of range ----------------------------------------

  it('warns when overhead_pct > 50', () => {
    const warnings = validateInsuranceEstimateData({
      items: [SHINGLE_ITEM],
      estimate: { overhead_pct: 60 },
    });
    expect(warnings.some((w) => w.includes('Overhead is'))).toBe(true);
  });

  it('does NOT warn when overhead_pct = 50 (boundary)', () => {
    const warnings = validateInsuranceEstimateData({
      items: [SHINGLE_ITEM],
      estimate: { overhead_pct: 50 },
    });
    expect(warnings.some((w) => w.includes('Overhead is'))).toBe(false);
  });

  it('warns when overhead_pct is negative', () => {
    const warnings = validateInsuranceEstimateData({
      items: [SHINGLE_ITEM],
      estimate: { overhead_pct: -10 },
    });
    expect(warnings.some((w) => w.includes('Overhead percentage is negative'))).toBe(true);
  });

  it('warns when profit_pct > 50', () => {
    const warnings = validateInsuranceEstimateData({
      items: [SHINGLE_ITEM],
      estimate: { profit_pct: 75 },
    });
    expect(warnings.some((w) => w.includes('Profit is'))).toBe(true);
  });

  it('warns when profit_pct is negative', () => {
    const warnings = validateInsuranceEstimateData({
      items: [SHINGLE_ITEM],
      estimate: { profit_pct: -5 },
    });
    expect(warnings.some((w) => w.includes('Profit percentage is negative'))).toBe(true);
  });

  // --- Negative deductible ---------------------------------------------------

  it('warns when deductible is negative', () => {
    const warnings = validateInsuranceEstimateData({
      items: [SHINGLE_ITEM],
      estimate: { deductible: -500 },
    });
    expect(warnings.some((w) => w.includes('Deductible is negative'))).toBe(true);
  });

  it('does NOT warn for deductible = 0', () => {
    const warnings = validateInsuranceEstimateData({
      items: [SHINGLE_ITEM],
      estimate: { deductible: 0 },
    });
    expect(warnings.some((w) => w.includes('Deductible is negative'))).toBe(false);
  });

  // --- Total depreciation exceeds total RCV ----------------------------------

  it('warns when total depreciation exceeds total RCV', () => {
    // Two items: each has 80% depreciation → total depreciation > total RCV is impossible
    // but we can use depreciation_percent = 150 on one item to make lineDepreciation > lineRcv
    // We need combined depreciation > combined RCV.
    // item: qty=10, rate=100 → rcv=1000, dep_pct=120 → dep=1200 > 1000
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, depreciation_percent: 120 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('Total depreciation'))).toBe(true);
  });

  it('does NOT warn when total depreciation equals total RCV (boundary)', () => {
    // dep_pct = 100 → depreciation = RCV → ACV = 0, not exceeding
    const items = [{ description: 'Shingle', quantity: 10, rate: 100, depreciation_percent: 100 }];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.some((w) => w.includes('Total depreciation'))).toBe(false);
  });

  // --- Multiple warnings can be returned ------------------------------------

  it('can return multiple warnings for multiple problems', () => {
    const items = [
      { quantity: 5, rate: -10, depreciation_percent: 110 }, // no description, negative rate, dep > 100
    ];
    const warnings = validateInsuranceEstimateData({ items });
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });
});
