/**
 * Address Sanitization, Deduplication & Residential Filtering Pipeline
 *
 * Runs entirely in the browser before any server call, so users see a
 * pre-import summary immediately — no API round-trip needed.
 *
 * Pipeline order:
 *   1. Parse & normalize each row (abbreviation expansion, whitespace)
 *   2. Intra-batch deduplication (exact normalized key + phone + email)
 *   3. Commercial-property detection (keyword-based heuristic)
 *   4. Address completeness validation (street/city/state/zip)
 *   5. Radius filter (haversine) — optional, requires lat/lng on records
 *
 * The server function (importPropertyData) performs a SIXTH pass — cross-DB
 * deduplication against already-stored leads — after receiving the cleaned rows.
 */

// ─── Street-type & directional abbreviation tables ───────────────────────────

const STREET_TYPE_EXPAND = {
  st: 'street',   rd: 'road',       ave: 'avenue',    blvd: 'boulevard',
  dr: 'drive',    ln: 'lane',       ct: 'court',      pl: 'place',
  hwy: 'highway', pkwy: 'parkway',  cir: 'circle',    ter: 'terrace',
  trl: 'trail',   wy: 'way',        fwy: 'freeway',   xing: 'crossing',
  expy: 'expressway', sq: 'square', pt: 'point',      est: 'estates',
};

const DIRECTION_EXPAND = {
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
};

// State abbreviations → full name (used only for normalization keys, not display)
const STATE_ABBR = {
  AL:'alabama',AK:'alaska',AZ:'arizona',AR:'arkansas',CA:'california',
  CO:'colorado',CT:'connecticut',DE:'delaware',FL:'florida',GA:'georgia',
  HI:'hawaii',ID:'idaho',IL:'illinois',IN:'indiana',IA:'iowa',KS:'kansas',
  KY:'kentucky',LA:'louisiana',ME:'maine',MD:'maryland',MA:'massachusetts',
  MI:'michigan',MN:'minnesota',MS:'mississippi',MO:'missouri',MT:'montana',
  NE:'nebraska',NV:'nevada',NH:'new hampshire',NJ:'new jersey',NM:'new mexico',
  NY:'new york',NC:'north carolina',ND:'north dakota',OH:'ohio',OK:'oklahoma',
  OR:'oregon',PA:'pennsylvania',RI:'rhode island',SC:'south carolina',
  SD:'south dakota',TN:'tennessee',TX:'texas',UT:'utah',VT:'vermont',
  VA:'virginia',WA:'washington',WV:'west virginia',WI:'wisconsin',WY:'wyoming',
};

// ─── Address normalization ────────────────────────────────────────────────────

/**
 * Produce a canonical dedup key from a raw address string.
 *
 * - Lowercase
 * - Strip commas, periods, #, dashes (common in auditor exports)
 * - Remove suite/unit/apt designators so multi-tenant entries collapse to one parcel
 * - Expand USPS abbreviations (St → street, Rd → road, N → north, etc.)
 * - Collapse whitespace
 */
export function normalizeAddress(raw) {
  if (!raw) return '';
  let s = raw.toLowerCase().trim();

  // Remove suite/unit/apt designators and trailing alphanumerics
  s = s.replace(/\b(suite|ste|unit|apt|apartment|floor|fl|room|rm|bldg|building|#)\s*[\w\d-]*/g, '');

  // Strip leftover punctuation
  s = s.replace(/[.,#\-]/g, ' ');

  // Tokenize, expand abbreviations, reassemble
  const tokens = s.split(/\s+/).filter(Boolean);
  const expanded = tokens.map(tok => {
    if (/\d/.test(tok)) return tok; // never expand numeric tokens
    const upper = tok.toUpperCase();
    if (STATE_ABBR[upper]) return STATE_ABBR[upper]; // OH → ohio
    if (STREET_TYPE_EXPAND[tok]) return STREET_TYPE_EXPAND[tok];
    if (DIRECTION_EXPAND[tok]) return DIRECTION_EXPAND[tok];
    return tok;
  });

  return expanded.join(' ').replace(/\s+/g, ' ').trim();
}

// ─── Commercial property detection ───────────────────────────────────────────

const COMMERCIAL_NAME_PATTERNS = [
  /\bllc\b/i, /\binc\b/i, /\bcorp\b/i, /\bltd\b/i, /\bco\.\b/i,
  /\bplaza\b/i, /\bmall\b/i, /\bshopping\b/i, /\bcenter\b/i, /\bcentre\b/i,
  /\bcomplex\b/i, /\bindustrial\b/i, /\bwarehou?se\b/i, /\bcommercial\b/i,
  /\boffices?\b/i, /\benterprises?\b/i, /\bproperties\b/i, /\bholdings?\b/i,
  /\brealty\b/i, /\bmanagement\b/i, /\bchurch\b/i, /\bschool\b/i,
  /\bclub\b/i, /\bassociation\b/i, /\bhotel\b/i, /\bmotel\b/i, /\binn\b/i,
  /\brestaurant\b/i, /\bmedical\b/i, /\bdental\b/i, /\bauto\b/i,
  /\bbank\b/i, /\bcredit union\b/i, /\bpharmacy\b/i, /\bgrocery\b/i,
];

const COMMERCIAL_ADDR_PATTERNS = [
  /\bsuite\s+[a-z\d]/i,       // Suite A, Suite 100
  /\bste\s+[a-z\d]/i,
  /\bunit\s+[a-z]\d/i,        // Unit A2
  /\b#\s*\d+[a-z]/i,          // #1A
  /\bindustrial\s+(park|blvd|dr|rd)\b/i,
  /\bparkway\b.*\b(suite|ste)\b/i,
  /\bcommerce\s+(park|center|dr)\b/i,
  /\bbusiness\s+(park|center|district)\b/i,
];

/**
 * Returns true if the record looks like a commercial property.
 * Inspects both owner name and full address string.
 */
export function isLikelyCommercial(record) {
  const name = String(record.name || record.owner || '');
  const addr = String((record.address || record.street || '') + ' ' + (record.company || ''));

  for (const re of COMMERCIAL_NAME_PATTERNS) {
    if (re.test(name)) return true;
  }
  for (const re of COMMERCIAL_ADDR_PATTERNS) {
    if (re.test(addr)) return true;
  }
  return false;
}

// ─── Address completeness validation ─────────────────────────────────────────

/**
 * Check whether a record has sufficient address fields to geocode reliably.
 * Returns { valid: boolean, missing: string[] }
 */
export function validateCompleteness(record) {
  const missing = [];

  const street = String(record.address || record.street || '').trim();
  if (!street || !/\d/.test(street)) missing.push('street number');

  const city = String(record.city || '').trim();
  if (!city) missing.push('city');

  const state = String(record.state || '').trim();
  if (!state) missing.push('state');

  const zip = String(record.zip || record.postal || '').replace(/\D/g, '');
  if (zip.length < 4) missing.push('zip');

  return { valid: missing.length === 0, missing };
}

// ─── Haversine radius filter ──────────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const MI_TO_KM = 1.60934;

/**
 * Returns true if the record is within radiusMiles of (centerLat, centerLng).
 * Records without lat/lng pass through (cannot be filtered without coords).
 */
export function isWithinRadius(record, centerLat, centerLng, radiusMiles) {
  const lat = Number(record.lat ?? record.latitude);
  const lng = Number(record.lng ?? record.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true; // no coords → cannot filter → keep
  return haversineKm(centerLat, centerLng, lat, lng) <= radiusMiles * MI_TO_KM;
}

// ─── Intra-batch deduplication ────────────────────────────────────────────────

/**
 * Remove duplicate rows within the uploaded batch (not against DB records —
 * the server function handles cross-session dedup separately).
 *
 * Dedup keys:
 *   1. Normalized full address (street + city + state + zip), suite-stripped
 *   2. E.164-cleaned phone number (when present)
 *   3. Normalized email address (when present)
 *
 * Returns { kept: row[], removed: row[] }
 */
export function deduplicateBatch(records) {
  const seenAddr  = new Map();   // addrKey → first record kept
  const seenPhone = new Set();
  const seenEmail = new Set();
  const kept = [], removed = [];

  for (const rec of records) {
    const addrKey = normalizeAddress(
      `${rec.address || rec.street || ''} ${rec.city || ''} ${rec.state || ''} ${rec.zip || ''}`
    );
    const phone = String(rec.phone || '').replace(/\D/g, '');
    const email = String(rec.email || '').toLowerCase().trim();

    let reason = '';
    if (addrKey && seenAddr.has(addrKey)) {
      reason = `Duplicate address: ${rec.address || rec.street}`;
    } else if (phone.length >= 7 && seenPhone.has(phone)) {
      reason = `Duplicate phone: ${rec.phone}`;
    } else if (email && seenEmail.has(email)) {
      reason = `Duplicate email: ${rec.email}`;
    }

    if (reason) {
      removed.push({ ...rec, _removedReason: reason });
    } else {
      kept.push(rec);
      if (addrKey) seenAddr.set(addrKey, rec);
      if (phone.length >= 7) seenPhone.add(phone);
      if (email) seenEmail.add(email);
    }
  }

  return { kept, removed };
}

// ─── CSV row parser (handles quoted fields) ───────────────────────────────────

/**
 * Parse a single CSV line, respecting double-quoted fields that may contain commas.
 */
export function parseCSVLine(line) {
  const cells = [];
  let inQuote = false, cell = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cell += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      cells.push(cell.trim()); cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Parse a full CSV string (with header row) into an array of record objects.
 * Column detection is case-insensitive and checks for common synonyms.
 */
export function parseCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());

  const col = (names) => {
    for (const n of names) {
      const i = headers.findIndex(h => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };

  const ownerIdx  = col(['owner', 'name', 'property owner']);
  const addrIdx   = col(['address', 'property address', 'street addr', 'site addr']);
  const cityIdx   = col(['city', 'municipality', 'town']);
  const stateIdx  = col(['state', 'st']);
  const zipIdx    = col(['zip', 'postal', 'zipcode', 'zip code']);
  const phoneIdx  = col(['phone', 'telephone', 'contact']);
  const emailIdx  = col(['email', 'e-mail', 'e mail']);
  const valueIdx  = col(['value', 'property value', 'assessed value', 'appraised']);
  const latIdx    = col(['lat', 'latitude']);
  const lngIdx    = col(['lng', 'lon', 'longitude']);

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    const get   = (idx) => idx !== -1 ? (cells[idx] || '').trim() : '';

    const name  = get(ownerIdx);
    const addr  = get(addrIdx);
    if (!name && !addr) continue; // empty row

    records.push({
      _rowIndex: i,
      name,
      address:  addr,
      city:     get(cityIdx),
      state:    get(stateIdx),
      zip:      get(zipIdx),
      phone:    get(phoneIdx),
      email:    get(emailIdx),
      value:    get(valueIdx),
      lat:      get(latIdx),
      lng:      get(lngIdx),
    });
  }
  return records;
}

// ─── Full pipeline ────────────────────────────────────────────────────────────

/**
 * Run the complete sanitization pipeline on an array of raw parsed row objects.
 *
 * Options:
 *   excludeCommercial  (bool, default true)    — filter commercial properties
 *   requireComplete    (bool, default true)    — drop records missing address fields
 *   centerLat / centerLng / radiusMiles        — drop records outside radius (optional)
 *
 * Returns:
 *   {
 *     cleaned:  row[],     // rows ready to send to server for import
 *     removed:  {
 *       duplicates:   row[],
 *       commercial:   row[],
 *       incomplete:   row[],
 *       outOfRadius:  row[],
 *     },
 *     summary: {
 *       totalRows,
 *       duplicatesRemoved,
 *       commercialFiltered,
 *       incompleteAddresses,
 *       outOfRadius,
 *       finalCleanCount,
 *       // first 5 examples of each removed category for the UI preview
 *       duplicateExamples, commercialExamples, incompleteExamples,
 *     }
 *   }
 */
export function runSanitizationPipeline(records, options = {}) {
  const {
    excludeCommercial = true,
    requireComplete   = true,
    centerLat, centerLng, radiusMiles,
  } = options;

  const totalRows = records.length;
  let working = [...records];

  // Step 1 — Intra-batch dedup
  const { kept: afterDedup, removed: dupeRemoved } = deduplicateBatch(working);
  working = afterDedup;

  // Step 2 — Commercial filter
  const commercialRemoved = [];
  if (excludeCommercial) {
    const next = [];
    for (const rec of working) {
      if (isLikelyCommercial(rec)) commercialRemoved.push(rec);
      else next.push(rec);
    }
    working = next;
  }

  // Step 3 — Completeness check
  const incompleteRemoved = [];
  {
    const next = [];
    for (const rec of working) {
      const { valid, missing } = validateCompleteness(rec);
      if (!valid) {
        incompleteRemoved.push({ ...rec, _missingFields: missing });
        if (!requireComplete) next.push(rec);
      } else {
        next.push(rec);
      }
    }
    if (requireComplete) working = next;
  }

  // Step 4 — Radius filter (only when coords are available on records)
  const outOfRadiusRemoved = [];
  if (centerLat != null && centerLng != null && radiusMiles > 0) {
    const next = [];
    for (const rec of working) {
      if (isWithinRadius(rec, centerLat, centerLng, radiusMiles)) next.push(rec);
      else outOfRadiusRemoved.push(rec);
    }
    working = next;
  }

  return {
    cleaned: working,
    removed: {
      duplicates:  dupeRemoved,
      commercial:  commercialRemoved,
      incomplete:  incompleteRemoved,
      outOfRadius: outOfRadiusRemoved,
    },
    summary: {
      totalRows,
      duplicatesRemoved:   dupeRemoved.length,
      commercialFiltered:  commercialRemoved.length,
      incompleteAddresses: incompleteRemoved.length,
      outOfRadius:         outOfRadiusRemoved.length,
      finalCleanCount:     working.length,
      duplicateExamples:   dupeRemoved.slice(0, 5),
      commercialExamples:  commercialRemoved.slice(0, 5),
      incompleteExamples:  incompleteRemoved.slice(0, 5),
    },
  };
}
