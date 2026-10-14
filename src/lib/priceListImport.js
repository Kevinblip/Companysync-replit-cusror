/**
 * Shared cleanup for price-list extraction and Item CSV import.
 *
 * Page headers from estimate PDFs were being stored as line items, cabinet
 * rows were tagged from the word "door" inside the description, and SKUs were
 * cut at 20 characters so different items collided and got skipped.
 */

const ACTION_PREFIX = /^(?:rem\/reset|remove|replace|reset|install|r&r|tear[\s-]?out|clean(?:,\s*(?:heavy|light))?)\s*[-–:]+\s*/i;

export function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function isEstimateChrome(text) {
  const s = collapseWhitespace(text);
  if (!s) return true;
  if (s.length < 3) return true;
  if (/^\d+["']?$/.test(s)) return true;
  if (/^page\s+\d+\b/i.test(s)) return true;
  if (/page\s+\d+\s+of\s+\d+/i.test(s) && /\b(claim|estimate)\b/i.test(s)) return true;
  if (/your insurance claims network/i.test(s) && /page\s+\d+/i.test(s)) return true;
  if (/^includes\s+\d+(\.\d+)?\s*%/i.test(s)) return true;
  if (/^(subtotal|grand total|total|tax|overhead|o&p|markup|depreciation|rcv|acv)\b/i.test(s)) return true;
  if (/^add\s+[\d.]+%/i.test(s)) return true;
  if (/^(material cost|labor cost)\b/i.test(s)) return true;
  return false;
}

/** Drop a glued-on page header when a real item follows it. */
export function stripLeadingChrome(text) {
  let s = collapseWhitespace(text);
  if (!s) return '';
  if (isEstimateChrome(s)) return '';
  s = s.replace(/^[\s\S]{0,400}?page\s+\d+\s+of\s+\d+\b\s*/i, '').trim();
  s = s.replace(/^(?:estimate\s*:\s*structure\b[^A-Za-z]{0,80})+/i, '').trim();
  return s;
}

const CATEGORY_RULES = [
  [/\bCABINET\w*\b|\bVANITY\b|\bCOUNTERTOPS?\b/, 'Interior'],
  [/\bDRYWALL\b|\bPLASTER\b|\bTEXTURE\b/, 'Interior'],
  [/\bFLOOR(?:ING)?\b|\bCARPET\b|\bHARDWOOD\b|\bLAMINATE\b|\bVINYL PLANK\b/, 'Flooring'],
  [/\bELECTR(?:IC|ICAL|ICITY)?\b|\bOUTLETS?\b|\bBREAKERS?\b|\bWIRING\b/, 'Electrical'],
  [/\bPLUMBING\b|\bFAUCETS?\b|\bTOILETS?\b|\bWATER HEATERS?\b/, 'Plumbing'],
  [/\bHVAC\b|\bFURNACES?\b|\bDUCT(?:WORK)?\b|\bCONDENSERS?\b/, 'HVAC'],
  [/\bGUTTERS?\b|\bDOWNSPOUTS?\b/, 'Gutters'],
  [/\bWINDOWS?\b/, 'Windows'],
  [/\bDOORS?\b/, 'Doors'],
  [/\bSIDING\b|\bSTUCCO\b|\bSOFFITS?\b|\bFASCIA\b/, 'Siding'],
  [/\bSHINGLES?\b|\bROOF(?:ING)?\b|\bUNDERLAYMENT\b|\bRIDGE CAP\b|\bDRIP EDGE\b|\bICE (?:&|AND) WATER\b|\bFLASHING\b/, 'Roofing'],
  [/\bPAINT(?:ING)?\b|\bPRIMER\b|\bSTAIN\b/, 'Interior'],
  [/\bCLEAN(?:ING)?\b/, 'Cleaning'],
  [/\bDEMOLITION\b|\bTEAR[\s-]?OUT\b/, 'Demolition'],
];

export function guessPriceCategory(description) {
  const target = collapseWhitespace(String(description || '').replace(ACTION_PREFIX, '')).toUpperCase();
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(target)) return category;
  }
  return 'Other';
}

function slug(value, max) {
  return collapseWhitespace(value)
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
}

/**
 * A code that stays unique without chopping every item at 20 characters.
 * A line-number prefix from the source code is kept when it is present.
 */
export function uniqueItemCode({ code, description }, used) {
  const descSlug = slug(description, 72);
  const line = String(code || '').match(/^(\d{1,6})_/);
  let base = descSlug || slug(code, 72) || 'ITEM';
  if (line && descSlug) base = `${line[1]}_${descSlug}`;
  base = base.slice(0, 80) || 'ITEM';
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = `_${n++}`;
    candidate = `${base.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

function parsePrice(value) {
  if (typeof value === 'number') return value;
  const n = parseFloat(String(value || '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function field(row, names) {
  const wanted = new Set(names);
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.has(String(key).toLowerCase().trim()) && value != null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

/**
 * Turn extracted or mapped rows into price-list items.
 * Chrome rows are skipped. Categories are recomputed. Codes cannot collide.
 */
export function preparePriceListRows(rows) {
  const used = new Set();
  const items = [];
  const skipped = [];

  (rows || []).forEach((row, index) => {
    const rawDescription = field(row, ['description', 'name', 'item name', 'item description']);
    const description = stripLeadingChrome(rawDescription);
    const rawCode = String(field(row, ['code', 'sku', 'item code']) || '').trim();
    const rowNumber = index + 1;

    if (!description) {
      skipped.push({
        row: rowNumber,
        reason: isEstimateChrome(rawDescription) ? 'Page header or footer' : 'Empty or not a line item',
        data: collapseWhitespace(rawDescription).slice(0, 120),
      });
      return;
    }

    const category = guessPriceCategory(description);
    const code = uniqueItemCode({ code: rawCode, description }, used);
    const unit = String(field(row, ['unit']) || 'EA').trim().toUpperCase() || 'EA';
    const source = String(field(row, ['source']) || row.source || '').trim();

    items.push({
      code,
      sku: code,
      name: description,
      description,
      category,
      unit,
      price: parsePrice(field(row, ['price', 'rate', 'unit price', 'amount'])),
      ...(source ? { source } : {}),
      ...(row.company_id ? { company_id: row.company_id } : {}),
    });
  });

  return { items, skipped };
}

export function parseCsv(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0);
  if (!lines.length) return [];

  const delimiter = (lines[0].match(/\t/g) || []).length > (lines[0].match(/,/g) || []).length ? '\t' : ',';
  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]).map((header) => header.replace(/^["']|["']$/g, ''));
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = (values[idx] || '').replace(/^["']|["']$/g, '');
    });
    return row;
  });
}

export function preparePriceListCsv(text) {
  return preparePriceListRows(parseCsv(text));
}

export const ITEM_IMPORT_BATCH = 200;

export function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
