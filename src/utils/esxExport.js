/**
 * esxExport.js — shared Xactimate ESX and Symbility XML generators
 *
 * Schema matches the target format confirmed by Kevin Stone (2026-07-28):
 *   <XactimateExport version="1.0"> with flat <LineItem itemNumber="N">
 *   each containing a short <Category> trade code and a <Selector> code.
 *
 * ALL three call sites must use generateEsxXml / generateSymbilityXml:
 *   - src/pages/EstimateEditor.jsx  handleExportToXactimate
 *   - src/components/estimates/XactimateEstimateView.jsx  exportToXactimate / exportToSymbility
 *
 * Per-item ACV rule (Symbility):
 *   <ACV> per line item = <RCV> (no per-line depreciation)
 *   Only <Totals><ACV> subtracts total depreciation from total RCV.
 */

// ── Xactimate trade-category short codes ──────────────────────────────────
// Maps our human-readable category names → Xactimate two-to-four-letter codes.
// When a category isn't in this map we pass it through (in case the code was
// already set correctly by the price list).
import { resolveStoredRcv, lineQuantity, lineRate, toFiniteNumber } from './estimateTotals.js';

const CATEGORY_CODES = {
  // Roofing
  'roofing':            'RFG',
  'rfg':                'RFG',
  'roof':               'RFG',
  // Gutters / Downspouts
  'gutters':            'GTR',
  'gutter':             'GTR',
  'downspouts':         'GTR',
  'gtr':                'GTR',
  // Siding / Exterior
  'siding':             'SDG',
  'sdg':                'SDG',
  'exterior':           'EXT',
  'ext':                'EXT',
  // Interior / Drywall
  'interior':           'INT',
  'int':                'INT',
  'drywall':            'DRY',
  'dry':                'DRY',
  // Painting
  'paint':              'PNT',
  'painting':           'PNT',
  'pnt':                'PNT',
  // Windows / Doors
  'windows':            'WIN',
  'window':             'WIN',
  'win':                'WIN',
  'doors':              'DR',
  'door':               'DR',
  'dr':                 'DR',
  // Electrical / Plumbing / HVAC
  'electrical':         'ELE',
  'ele':                'ELE',
  'plumbing':           'PLM',
  'plm':                'PLM',
  'hvac':               'HVC',
  'hvc':                'HVC',
  // Masonry / Concrete
  'masonry':            'MSN',
  'msn':                'MSN',
  'concrete':           'CNR',
  'cnr':                'CNR',
  // Flooring
  'flooring':           'FLR',
  'flr':                'FLR',
  // Cleanup / Demo
  'cleanup':            'CLN',
  'cln':                'CLN',
  'demo':               'DMO',
  'demolition':         'DMO',
  'dmo':                'DMO',
  // General / Miscellaneous
  'general':            'GEN',
  'gen':                'GEN',
  'miscellaneous':      'GEN',
  'misc':               'GEN',
  // Insulation
  'insulation':         'INS',
  'ins':                'INS',
  // Structural
  'structural':         'STR',
  'str':                'STR',
  // Decking / Sheathing
  'decking':            'DCK',
  'dck':                'DCK',
  'sheathing':          'DCK',
  // Overhead & Profit
  'overhead & profit':  'OHP',
  'overhead and profit':'OHP',
  'o&p':                'OHP',
};

function toTradeCode(category) {
  if (!category) return 'GEN';
  const lower = category.trim().toLowerCase();
  return CATEGORY_CODES[lower] || category.trim().toUpperCase().slice(0, 4);
}

// ── XML helpers ────────────────────────────────────────────────────────────
function esc(str) {
  return (str == null ? '' : String(str))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmt(num) {
  return parseFloat(num || 0).toFixed(2);
}

// ── generateEsxXml ─────────────────────────────────────────────────────────
/**
 * Build a Xactimate-compatible XML string.
 *
 * @param {Object} estimate   - Estimate record (claim_number, policy_number,
 *                              date_of_loss, type_of_loss, customer_name,
 *                              property_address, customer_phone,
 *                              insurance_company, adjuster_name,
 *                              estimate_number, overhead_pct, profit_pct)
 * @param {Array}  lineItems  - Array of line-item objects (description, code,
 *                              category, quantity, unit, rate/price, amount,
 *                              rcv, notes)
 * @param {Object} company    - Company record (company_name, contact_name/owner)
 * @returns {string}          XML string
 */
export function generateEsxXml(estimate = {}, lineItems = [], company = {}) {
  const today = new Date().toISOString().split('T')[0];

  const dateOfLoss = estimate.date_of_loss
    ? new Date(estimate.date_of_loss).toISOString().split('T')[0]
    : (estimate.created_date
        ? new Date(estimate.created_date).toISOString().split('T')[0]
        : today);

  // ── Line items ─────────────────────────────────────────────────────────
  const items = (lineItems || []).filter(i => i && (i.description || i.name));
  let subtotal = 0;
  let totalDepreciation = 0;

  const lineItemsXml = items.map((item, idx) => {
    const qty      = lineQuantity(item);
    const rate     = lineRate(item);
    // Saved RCV wins, including an intentional $0 carrier line. See resolveStoredRcv.
    const total    = resolveStoredRcv(item);
    const dep      = parseFloat(item.depreciation || 0);
    const selector = item.code || item.sku || item.selector || '';
    const cat      = toTradeCode(item.category || item.trade || '');
    const notes    = item.notes || item.note || '';

    subtotal           += total;
    totalDepreciation  += dep;

    return `    <LineItem itemNumber="${idx + 1}">
      <Category>${esc(cat)}</Category>
      <Selector>${esc(selector)}</Selector>
      <Description>${esc(item.description || item.name || '')}</Description>
      <Quantity>${fmt(qty)}</Quantity>
      <Unit>${esc(item.unit || 'EA')}</Unit>
      <UnitPrice>${fmt(rate)}</UnitPrice>
      <Total>${fmt(total)}</Total>${notes ? `\n      <Notes>${esc(notes)}</Notes>` : ''}
    </LineItem>`;
  }).join('\n');

  // ── O&P ────────────────────────────────────────────────────────────────
  // Use estimate-level O&P if set; default to Xactimate standard 10/10.
  const opPct  = parseFloat(estimate.overhead_pct  ?? estimate.overhead_percentage  ?? 10);
  const pftPct = parseFloat(estimate.profit_pct    ?? estimate.profit_percentage    ?? 10);
  const opAmount   = subtotal * (opPct  / 100);
  const pftAmount  = subtotal * (pftPct / 100);
  const opTotal    = opAmount + pftAmount;
  const grandTotal = subtotal + opTotal;

  // ── Assemble ───────────────────────────────────────────────────────────
  return `<?xml version="1.0" encoding="UTF-8"?>
<XactimateExport version="1.0">
  <Header>
    <ExportDate>${today}</ExportDate>
    <SourceSystem>CompanySync</SourceSystem>
    <Carrier>${esc(estimate.insurance_company || '')}</Carrier>
  </Header>
  <ClaimInformation>
    <ClaimNumber>${esc(estimate.claim_number || '')}</ClaimNumber>
    <PolicyNumber>${esc(estimate.policy_number || '')}</PolicyNumber>
    <DateOfLoss>${dateOfLoss}</DateOfLoss>
    <TypeOfLoss>${esc(estimate.type_of_loss || estimate.loss_type || 'Wind / Hail')}</TypeOfLoss>
    <Insured>
      <Name>${esc(estimate.customer_name || '')}</Name>
      <PropertyAddress>${esc(estimate.property_address || '')}</PropertyAddress>
      <Phone>${esc(estimate.customer_phone || estimate.insured_phone || '')}</Phone>
    </Insured>
    <Contractor>
      <CompanyName>${esc(company.company_name || company.name || '')}</CompanyName>
      <ContactName>${esc(company.contact_name || company.owner_name || '')}</ContactName>
    </Contractor>
  </ClaimInformation>
  <LineItems>
${lineItemsXml}
  </LineItems>
  <Totals>
    <Subtotal>${fmt(subtotal)}</Subtotal>
    <OverheadPercentage>${fmt(opPct)}</OverheadPercentage>
    <ProfitPercentage>${fmt(pftPct)}</ProfitPercentage>
    <OverheadAndProfit>${fmt(opTotal)}</OverheadAndProfit>
    <GrandTotal>${fmt(grandTotal)}</GrandTotal>
  </Totals>
</XactimateExport>`;
}

// ── generateSymbilityXml ───────────────────────────────────────────────────
/**
 * Build a Symbility-compatible XML string.
 *
 * ACV rule (critical — carrier systems parse this programmatically):
 *   Per-item <ACV> MUST equal <RCV> (no per-line depreciation).
 *   Only <Totals><ACV> subtracts total depreciation from total RCV.
 *
 * @param {Object} estimate   - same shape as generateEsxXml
 * @param {Array}  lineItems  - same shape as generateEsxXml
 * @param {Object} company    - same shape as generateEsxXml
 * @returns {string}          XML string
 */
export function generateSymbilityXml(estimate = {}, lineItems = [], company = {}) {
  const today = new Date().toISOString().split('T')[0];

  const dateOfLoss = estimate.date_of_loss
    ? new Date(estimate.date_of_loss).toISOString().split('T')[0]
    : (estimate.created_date
        ? new Date(estimate.created_date).toISOString().split('T')[0]
        : today);

  // Keep code-only rows too — dropping them silently under-reports scope.
  const items = (lineItems || []).filter(i => i && (i.description || i.name || i.code || i.sku));
  let totalRcv = 0;
  let totalDepreciation = 0;

  const scopeXml = items.map((item, idx) => {
    const qty   = lineQuantity(item);
    const rate  = lineRate(item);
    // Saved RCV wins, including an intentional $0 carrier line. See resolveStoredRcv.
    const rcv   = resolveStoredRcv(item);
    const dep   = parseFloat(item.depreciation || 0);
    // Per-item ACV = RCV (Symbility rule — depreciation applied at totals only)
    const acv   = rcv;

    totalRcv          += rcv;
    totalDepreciation += dep;

    return `    <Item sequence="${idx + 1}">
      <ItemCode>${esc(item.code || item.sku || '')}</ItemCode>
      <Trade>${esc(toTradeCode(item.category || item.trade || ''))}</Trade>
      <Description>${esc(item.description || item.name || '')}</Description>
      <Quantity>${fmt(qty)}</Quantity>
      <UOM>${esc(item.unit || 'EA')}</UOM>
      <UnitCost>${fmt(rate)}</UnitCost>
      <RCV>${fmt(rcv)}</RCV>
      <ACV>${fmt(acv)}</ACV>
    </Item>`;
  }).join('\n');

  // Totals ACV = totalRcv − totalDepreciation (Symbility rule)
  const totalAcv = totalRcv - totalDepreciation;

  return `<?xml version="1.0" encoding="UTF-8"?>
<SymbilityEstimate version="1.0">
  <Header>
    <ExportDate>${today}</ExportDate>
    <SourceSystem>CompanySync</SourceSystem>
    <EstimateNumber>${esc(estimate.estimate_number || '')}</EstimateNumber>
    <ClaimNumber>${esc(estimate.claim_number || '')}</ClaimNumber>
    <PolicyNumber>${esc(estimate.policy_number || '')}</PolicyNumber>
    <DateOfLoss>${dateOfLoss}</DateOfLoss>
    <LossType>${esc(estimate.type_of_loss || estimate.loss_type || 'Wind / Hail')}</LossType>
    <Carrier>${esc(estimate.insurance_company || '')}</Carrier>
  </Header>
  <Insured>
    <Name>${esc(estimate.customer_name || '')}</Name>
    <PropertyAddress>${esc(estimate.property_address || '')}</PropertyAddress>
    <Phone>${esc(estimate.customer_phone || estimate.insured_phone || '')}</Phone>
  </Insured>
  <Contractor>
    <CompanyName>${esc(company.company_name || company.name || '')}</CompanyName>
    <ContactName>${esc(company.contact_name || company.owner_name || '')}</ContactName>
  </Contractor>
  <Scope>
${scopeXml}
  </Scope>
  <Totals>
    <RCV>${fmt(totalRcv)}</RCV>
    <Depreciation>${fmt(totalDepreciation)}</Depreciation>
    <ACV>${fmt(totalAcv)}</ACV>
  </Totals>
</SymbilityEstimate>`;
}

// ── Native ESX (ZIP container) — BEST-EFFORT / BETA ───────────────────────
/**
 * A real Xactimate .esx is a ZIP archive (PK magic bytes). Verified from a
 * real sample (attached_assets/0_ESTHUB-EST10_...ESX): it contains attachment
 * files plus one XACTDOC.ZIPXML encoded with Verisk's proprietary
 * encryption/compression that third parties cannot reproduce (HOVER/EagleView
 * generate ESX only as official Verisk partners).
 *
 * This builder therefore produces the closest legal approximation:
 *   - a real ZIP container (so the file at least passes the PK magic check)
 *   - a plaintext XACTDOC.XML using the XACTDOC schema observed in real ESX
 *     fixtures (PROJECT_INFO / CLAIM_INFO / CONTACTS / GROUP/ITEMS/ITEM +
 *     EMBEDDED_PL/SUMITEMS/SUMITEM with SUMMARY_REF integrity / TOTALS)
 *
 * STATUS: UNVERIFIED for native Xactimate import — must be tested in a real
 * Xactimate and iterated. Until confirmed, UI messaging must present this as
 * beta and point users to the working Quick Entry copy/paste export.
 */
export function buildXactdocXml(estimate = {}, lineItems = [], company = {}) {
  const today = new Date().toISOString().split('T')[0];
  const dateOfLoss = estimate.date_of_loss
    ? new Date(estimate.date_of_loss).toISOString().split('T')[0]
    : (estimate.created_date
        ? new Date(estimate.created_date).toISOString().split('T')[0]
        : today);

  // Keep code-only items too (old AIEstimator inline exporter included them).
  const items = (lineItems || []).filter(i => i && (i.description || i.name || i.code || i.sku));
  let totalRcv = 0;
  let totalDep = 0;
  let totalTax = 0;

  const groupItemsXml = [];
  const sumItemsXml = [];

  items.forEach((item, idx) => {
    const id     = idx + 1;
    const qty    = lineQuantity(item);
    const rate   = lineRate(item);
    // Saved RCV wins, including an intentional $0 carrier line. See resolveStoredRcv.
    const rcv    = resolveStoredRcv(item);
    const dep    = parseFloat(item.depreciation || 0);
    const acv    = toFiniteNumber(item.acv) ?? (rcv - dep);
    const tax    = parseFloat(item.tax || 0);
    const cat    = toTradeCode(item.category || item.trade || '');
    const sel    = item.code || item.sku || item.selector || '';
    const desc   = item.description || item.name || '';
    const notes  = item.notes || item.note || '';

    totalRcv += rcv;
    totalDep += dep;
    totalTax += tax;

    groupItemsXml.push(
      `      <ITEM id="${id}">\n` +
      `        <ITEM_NUMBER>${id}</ITEM_NUMBER>\n` +
      `        <DESCRIPTION>${esc(desc)}</DESCRIPTION>\n` +
      `        <SUMMARY_REF ref="${id}"/>` +
      (notes ? `\n        <NOTE>${esc(notes)}</NOTE>` : '') +
      `\n      </ITEM>`
    );

    sumItemsXml.push(
      `      <SUMITEM id="${id}" seq="${id}" cat="${esc(cat)}" sel="${esc(sel)}"` +
      ` desc="${esc(desc)}" unit="${esc(item.unit || 'EA')}" qty="${fmt(qty)}"` +
      ` price="${fmt(rate)}" tax="${fmt(tax)}" rcv="${fmt(rcv)}" dep="${fmt(dep)}" acv="${fmt(acv)}"/>`
    );
  });

  const totalAcv = totalRcv - totalDep;

  return `<?xml version="1.0" encoding="UTF-8"?>
<XACTDOC generatedBy="CompanySync" schemaVersion="0.1" createdAt="${today}">
  <PROJECT_INFO>
    <PROJECT_NAME>${esc(estimate.customer_name ? `${estimate.customer_name} Estimate` : 'Insurance Estimate Export')}</PROJECT_NAME>
    <ESTIMATE_NUMBER>${esc(estimate.estimate_number || '')}</ESTIMATE_NUMBER>
    <ESTIMATE_DATE>${today}</ESTIMATE_DATE>
  </PROJECT_INFO>
  <CLAIM_INFO>
    <CARRIER>${esc(estimate.insurance_company || '')}</CARRIER>
    <CLAIM_NUMBER>${esc(estimate.claim_number || '')}</CLAIM_NUMBER>
    <POLICY_NUMBER>${esc(estimate.policy_number || '')}</POLICY_NUMBER>
    <DATE_OF_LOSS>${dateOfLoss}</DATE_OF_LOSS>
    <TYPE_OF_LOSS>${esc(estimate.type_of_loss || estimate.loss_type || 'Wind / Hail')}</TYPE_OF_LOSS>
    <PROPERTY_ADDRESS>${esc(estimate.property_address || '')}</PROPERTY_ADDRESS>
  </CLAIM_INFO>
  <CONTACTS>
    <CONTACT role="insured">
      <NAME>${esc(estimate.customer_name || '')}</NAME>
      <ADDRESS>${esc(estimate.property_address || '')}</ADDRESS>
      <PHONE>${esc(estimate.customer_phone || estimate.insured_phone || '')}</PHONE>
    </CONTACT>
    <CONTACT role="estimator">
      <NAME>${esc(company.contact_name || company.owner_name || company.company_name || company.name || '')}</NAME>
      <COMPANY>${esc(company.company_name || company.name || '')}</COMPANY>
    </CONTACT>
  </CONTACTS>
  <GROUP name="Estimate">
    <ITEMS>
${groupItemsXml.join('\n')}
    </ITEMS>
  </GROUP>
  <EMBEDDED_PL>
    <SUMITEMS>
${sumItemsXml.join('\n')}
    </SUMITEMS>
  </EMBEDDED_PL>
  <TOTALS>
    <REPLACEMENT_COST_VALUE>${fmt(totalRcv)}</REPLACEMENT_COST_VALUE>
    <DEPRECIATION>${fmt(totalDep)}</DEPRECIATION>
    <ACTUAL_CASH_VALUE>${fmt(totalAcv)}</ACTUAL_CASH_VALUE>
    <TAX>${fmt(totalTax)}</TAX>
  </TOTALS>
</XACTDOC>`;
}

/**
 * Build the .esx ZIP container as a Blob (beta — see buildXactdocXml notes).
 */
export async function generateEsxZipBlob(estimate = {}, lineItems = [], company = {}) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('XACTDOC.XML', buildXactdocXml(estimate, lineItems, company));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * One-call helper for the 3 export call sites: builds the ZIP and downloads it.
 */
export async function downloadEsxFile(estimate = {}, lineItems = [], company = {}, filename) {
  const blob = await generateEsxZipBlob(estimate, lineItems, company);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename || `${estimate.estimate_number || 'estimate'}.esx`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

// User-facing beta note shared by all call sites so messaging can't drift.
export const ESX_BETA_NOTE =
  'Beta .esx downloaded (real ZIP container). Please test importing it into Xactimate — if the import fails, use the Xactimate Quick Entry (copy/paste) export and let us know the exact error message so we can refine the format.';

// ── triggerDownload ────────────────────────────────────────────────────────
export function triggerXmlDownload(xmlString, filename) {
  const blob = new Blob([xmlString], { type: 'application/xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
