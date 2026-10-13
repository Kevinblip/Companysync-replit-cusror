/**
 * Xactimate Quick Entry Excel Export
 * Generates an .xls (HTML) file formatted for paste into Xactimate's line item grid.
 * Columns: Cat | Sel | Description | Quantity | Unit | Notes (Waste Factor)
 */

// Map common internal/generic codes → canonical Xactimate codes
// Exported so insuranceEstimateTemplates.js can derive its category map
// from the same data rather than maintaining a separate copy.
import { resolveStoredRcv } from './estimateTotals.js';

export const CODE_ALIASES = {
  // Shingles
  'shingles':        'RFG 300',
  'arch shingles':   'RFG 300',
  'architectural':   'RFG 300',
  '3-tab':           'RFG 240',
  '3tab':            'RFG 240',
  'premium shingle': 'RFG 300P',
  // Underlayment
  'felt':            'RFG FLT',
  'felt 15':         'RFG FLT',
  'felt 30':         'RFG FLH',
  'synthetic':       'RFG SYN',
  'synthetic underlayment': 'RFG SYN',
  // Ice & water
  'ice water':       'RFG ICW',
  'ice & water':     'RFG ICW',
  'ice and water':   'RFG ICW',
  // Starter
  'starter':         'RFG STR',
  'starter strip':   'RFG STR',
  // Ridge
  'ridge':           'RFG RDG',
  'ridge cap':       'RFG RDG',
  // Drip edge
  'drip':            'RFG DRP',
  'drip edge':       'RFG DRP',
  // Flashing
  'step flashing':   'RFG FLS',
  'flashing':        'RFG FLS',
  // Vents
  'ridge vent':      'RFG CBV',
  'box vent':        'RFG VBX',
  'pipe boot':       'RFG PPV',
  'pipe flashing':   'RFG PPV',
  'plumbing boot':   'RFG PPV',
  // Decking
  'plywood':         'RFG PLY',
  'osb':             'RFG OSB',
  'decking':         'RFG PLY',
  // Tear off
  'tear off':        'RFG RMV',
  'remove shingles': 'RFG RMV',
  // Gutters
  'gutter':          'GUT ALU',
  'gutters':         'GUT ALU',
  'downspout':       'GUT DWP',
  'downspouts':      'GUT DWP',
  // Siding
  'vinyl siding':    'PNL AS',
  'siding':          'SID 180',
  'starter siding':  'SID SS',
  // House wrap
  'house wrap':      'SID HK',
  'tyvek':          'SID HK',
  'wrap':           'SID HK',
  // Soffit/Fascia
  'soffit':          'SFT 1',
  'fascia':          'FSC 1',
  // Labor
  'labor':           'RFG LAB',
  'installation':    'RFG LAB',
};

/**
 * Normalize a code string to a canonical Xactimate code.
 * If it already looks like "XYZ 123" format, keep it.
 * Otherwise try alias lookup on the description+code.
 */
function resolveCode(code, description) {
  if (!code) code = '';
  const trimmed = code.trim();

  // Already looks like a proper Xactimate code (e.g. "RFG 300", "GUT ALU")
  if (/^[A-Z]{2,4}\s+[A-Z0-9]{1,6}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  // Try alias lookup on code first, then description
  const haystack = [code, description].join(' ').toLowerCase().trim();
  for (const [alias, canonical] of Object.entries(CODE_ALIASES)) {
    if (haystack.includes(alias)) return canonical;
  }

  // Return the original code uppercase (manager can fix in Xactimate)
  return trimmed.toUpperCase() || 'RFG ???';
}

/**
 * Split a full Xactimate code like "RFG 300" into { cat: "RFG", sel: "300" }.
 */
function splitCode(fullCode) {
  const parts = fullCode.trim().split(/\s+/);
  if (parts.length >= 2) {
    return { cat: parts[0].toUpperCase(), sel: parts.slice(1).join(' ').toUpperCase() };
  }
  return { cat: fullCode.toUpperCase(), sel: '' };
}

/**
 * Build a note string explaining waste factor math.
 */
function buildWasteNote(item) {
  const notes = [];

  const wastePct = parseFloat(item.waste_factor || item.waste_pct || item.waste || 0);
  if (wastePct > 0) {
    const raw = parseFloat(item.raw_quantity || item.base_quantity || 0);
    if (raw > 0) {
      notes.push(`Qty includes ${wastePct}% waste factor (base: ${raw.toFixed(2)} ${item.unit || ''}, waste: ${(parseFloat(item.quantity || 0) - raw).toFixed(2)} ${item.unit || ''})`);
    } else {
      notes.push(`Qty includes ${wastePct}% waste factor per CompanySync calculation`);
    }
  }

  if (item.notes) notes.push(item.notes);
  if (item.source_label) notes.push(`Source: ${item.source_label}`);

  return notes.join(' | ');
}

/**
 * Generate the HTML content of the Excel file.
 */
function buildHtmlTable(items, estimate = {}) {
  const rows = items.map((item, idx) => {
    const fullCode = resolveCode(item.code, item.description);
    const { cat, sel } = splitCode(fullCode);
    const qty = parseFloat(item.quantity || 0).toFixed(2);
    const unit = (item.unit || 'EA').toUpperCase();
    const desc = (item.description || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const noteText = buildWasteNote(item).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Saved RCV wins, including an intentional $0 carrier line. See resolveStoredRcv.
    const rcv = resolveStoredRcv(item).toFixed(2);
    const bg = idx % 2 === 0 ? '#ffffff' : '#f5f8ff';
    return `
    <tr style="background:${bg}">
      <td style="font-family:Consolas,monospace;font-weight:bold;color:#1a4480;border:1px solid #ccc;padding:4px 8px">${cat}</td>
      <td style="font-family:Consolas,monospace;font-weight:bold;color:#1a4480;border:1px solid #ccc;padding:4px 8px">${sel}</td>
      <td style="border:1px solid #ccc;padding:4px 8px">${desc}</td>
      <td style="text-align:right;border:1px solid #ccc;padding:4px 8px">${qty}</td>
      <td style="text-align:center;border:1px solid #ccc;padding:4px 8px">${unit}</td>
      <td style="font-size:11px;color:#555;border:1px solid #ccc;padding:4px 8px">${noteText}</td>
      <td style="text-align:right;color:#228B22;border:1px solid #ccc;padding:4px 8px">$${rcv}</td>
    </tr>`;
  }).join('');

  const totalRcv = items.reduce((s, i) =>
    s + (parseFloat(i.rcv) || parseFloat(i.amount) || (parseFloat(i.quantity || 0) * parseFloat(i.rate || 0))), 0);

  const headerInfo = [
    estimate.customer_name && `<b>Insured:</b> ${estimate.customer_name}`,
    estimate.property_address && `<b>Address:</b> ${estimate.property_address}`,
    estimate.claim_number && `<b>Claim #:</b> ${estimate.claim_number}`,
    estimate.policy_number && `<b>Policy #:</b> ${estimate.policy_number}`,
    estimate.insurance_company && `<b>Carrier:</b> ${estimate.insurance_company}`,
    estimate.adjuster_name && `<b>Adjuster:</b> ${estimate.adjuster_name}`,
    estimate.estimate_number && `<b>Estimate #:</b> ${estimate.estimate_number}`,
  ].filter(Boolean).join('&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; }
  .header-box { background:#1a4480; color:#fff; padding:10px 16px; margin-bottom:8px; border-radius:4px; }
  .steps { background:#fffbe6; border:1px solid #f0c040; padding:8px 12px; margin-bottom:10px; border-radius:4px; font-size:11px; }
  table { border-collapse:collapse; width:100%; }
  th { background:#1a4480; color:#fff; padding:6px 8px; border:1px solid #ccc; text-align:left; font-size:12px; }
  td { font-size:12px; }
</style>
</head>
<body>
<div class="header-box">
  <b style="font-size:14px">Xactimate Quick Entry Export</b><br>
  <span style="font-size:11px">${headerInfo}</span>
</div>
<div class="steps">
  <b style="font-size:12px;display:block;margin-bottom:6px">&#128203; How to paste these line items into Xactimate — step by step:</b>
  <table style="border-collapse:collapse;width:100%;font-size:11px">
    <tr>
      <td style="width:24px;font-weight:bold;vertical-align:top;padding:2px 6px 2px 0">1.</td>
      <td style="padding:2px 0;vertical-align:top"><b>In this Excel file:</b> Click the row number of the first data row below (e.g. row 4), then Shift-click the last row to select all line items. Press <b>Ctrl+C</b> to copy.</td>
    </tr>
    <tr>
      <td style="width:24px;font-weight:bold;vertical-align:top;padding:2px 6px 2px 0">2.</td>
      <td style="padding:2px 0;vertical-align:top"><b>Switch to Xactimate.</b> In the left sidebar click <b>Local</b> (or <b>Cloud</b>) — NOT Preferences.</td>
    </tr>
    <tr>
      <td style="width:24px;font-weight:bold;vertical-align:top;padding:2px 6px 2px 0">3.</td>
      <td style="padding:2px 0;vertical-align:top"><b>Open your claim/project</b> by double-clicking it in the list. If you haven't created the project yet, click <b>New</b> and fill in the claim info, then open it.</td>
    </tr>
    <tr>
      <td style="width:24px;font-weight:bold;vertical-align:top;padding:2px 6px 2px 0">4.</td>
      <td style="padding:2px 0;vertical-align:top"><b>Click the "Scope" tab</b> at the top of the open project (it may say "Scope of Loss"). You will see a grid with columns labeled Cat, Sel, Description, Qty, Unit.</td>
    </tr>
    <tr>
      <td style="width:24px;font-weight:bold;vertical-align:top;padding:2px 6px 2px 0">5.</td>
      <td style="padding:2px 0;vertical-align:top"><b>Click the very first empty cell in the Cat column</b> (the left-most column in the line item grid).</td>
    </tr>
    <tr>
      <td style="width:24px;font-weight:bold;vertical-align:top;padding:2px 6px 2px 0">6.</td>
      <td style="padding:2px 0;vertical-align:top"><b>Press Ctrl+V to paste.</b> All ${items.length} line items will load at once. Xactimate automatically fills in Unit Price and O&amp;P from its local price list.</td>
    </tr>
    <tr>
      <td style="width:24px;font-weight:bold;vertical-align:top;padding:2px 6px 2px 0">&#9888;</td>
      <td style="padding:2px 0;vertical-align:top;color:#c00"><b>Do NOT paste while on Preferences, Sketch, or Reports tabs</b> — it will not work there. You must be on the Scope tab with a project open.</td>
    </tr>
  </table>
</div>
<table>
  <thead>
    <tr>
      <th width="60">Cat</th>
      <th width="70">Sel</th>
      <th>Description</th>
      <th width="80">Quantity</th>
      <th width="60">Unit</th>
      <th>Notes (Waste Factor &amp; Source)</th>
      <th width="90">RCV Est.</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="5" style="border:1px solid #ccc;padding:4px 8px;text-align:right;font-weight:bold">Total RCV (before O&amp;P):</td>
      <td style="border:1px solid #ccc"></td>
      <td style="border:1px solid #ccc;padding:4px 8px;text-align:right;font-weight:bold;color:#228B22">$${totalRcv.toFixed(2)}</td>
    </tr>
  </tfoot>
</table>
</body>
</html>`;
}

/**
 * Trigger the Excel download.
 * @param {Array} items  - line items array
 * @param {Object} estimate - estimate header object (customer_name, claim_number, etc.)
 * @param {string} filename - base filename (no extension)
 */
export function downloadXactimateExcel(items, estimate = {}, filename = 'estimate') {
  if (!items || items.length === 0) {
    alert('No line items to export');
    return;
  }

  const html = buildHtmlTable(items, estimate);
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_xactimate_quickentry.xls`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
