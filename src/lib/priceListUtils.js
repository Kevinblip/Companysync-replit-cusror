/**
 * Price List Utilities — Xactimate / Symbility / Custom
 * Pure functions — no React dependencies.
 */

/**
 * Normalises a raw price list item from the DB so that
 * `code`, `description`, and `source` are always present.
 */
export function normalizePriceItem(item) {
  if (!item) return item;
  return {
    ...item,
    code:        item.code        || item.sku          || '',
    description: item.description || item.name         || '',
    source:      item.source      || item.category     || '',
  };
}

/**
 * Normalizes human-entered price-list search text and imported codes for
 * separator-insensitive matching. Symbility codes commonly use underscores
 * while people naturally type spaces or hyphens.
 *
 * Keep letters/numbers only so "j channel", "J_CHANNEL", and "j-channel"
 * all compare as "jchannel".
 */
export function normalizePriceListSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Returns whether a price-list item matches a user's search text.
 * Matching remains substring-based, but ignores formatting separators.
 */
export function matchesPriceListSearch(item, searchText) {
  const normalizedSearch = normalizePriceListSearchText(searchText);
  if (!normalizedSearch) return true;

  return [item?.code || item?.sku, item?.description || item?.name]
    .some(value => normalizePriceListSearchText(value).includes(normalizedSearch));
}

/**
 * Splits a flat array of all PriceListItems into the four
 * source-specific arrays expected by the estimator.
 *
 * @param {Array} allItems  Raw items from the DB query
 * @returns {{ xactimatePriceList, xactimateNewPriceList, customPriceList, symbilityPriceList }}
 */
export function filterPriceListBySource(allItems) {
  const items = Array.isArray(allItems) ? allItems : [];
  const active = (item) => item.is_active !== false;
  return {
    xactimatePriceList:    items.filter(i => (i.source === 'Xactimate' || i.source === 'Xactimate_New') && active(i)).map(normalizePriceItem),
    xactimateNewPriceList: items.filter(i => i.source === 'Xactimate_New' && active(i)).map(normalizePriceItem),
    customPriceList:       items.filter(i => i.source === 'Custom'         && active(i)).map(normalizePriceItem),
    symbilityPriceList:    items.filter(i => i.source === 'Symbility'      && active(i)).map(normalizePriceItem),
  };
}

/**
 * Returns the correct price list array for the given pricing source key.
 *
 * @param {string} source   e.g. 'xactimate' | 'xactimate_new' | 'symbility' | 'custom'
 * @param {{ xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList }} priceLists
 */
export function getActivePriceList(source, priceLists) {
  const { xactimatePriceList, xactimateNewPriceList, symbilityPriceList, customPriceList } = priceLists;
  switch (source) {
    case 'xactimate':     return xactimatePriceList;
    case 'xactimate_new': return xactimateNewPriceList?.length ? xactimateNewPriceList : xactimatePriceList;
    case 'symbility':     return symbilityPriceList;
    default:              return customPriceList;
  }
}

/**
 * True when `text` contains an exclusion term.
 * "w/out felt", "without felt", and "w/o felt" do not count as felt.
 * "incl. felt" still does.
 */
export function textIncludesExclusion(text, term) {
  const desc = String(text || '').toLowerCase();
  const needle = String(term || '').toLowerCase().trim();
  if (!needle) return false;
  if (needle === 'felt') {
    const withoutNegatedFelt = desc
      .replace(/\bw\/out\s+felt\b/g, ' ')
      .replace(/\bwithout\s+felt\b/g, ' ')
      .replace(/\bw\/o\s+felt\b/g, ' ');
    return withoutNegatedFelt.includes('felt');
  }
  return desc.includes(needle);
}

/**
 * Fuzzy/smart description matching against a price list.
 * Tries, in order: special tear-off rule → decking rule → exact →
 * code → multi-word → single-word → roofing-category terms.
 *
 * @param {string} description  Human-readable line-item description
 * @param {Array}  priceList    Normalised price list items
 * @returns {Object|null} Matched item or null
 */
export function smartDescriptionMatch(description, priceList) {
  if (!description || !priceList || priceList.length === 0) return null;

  const descLower = description.toLowerCase().trim();

  // ── Special case: tear-off / remove roof covering ──────────────────────
  if (descLower.includes('tear off') || descLower.includes('remove roof') || descLower.includes('r&r')) {
    const codeMatch = priceList.find(item => {
      const c = item.code?.toUpperCase() || '';
      return c === 'ARMV' || c === 'ARMVN';
    });
    if (codeMatch) return codeMatch;

    const tabMatch = priceList.find(item => {
      const d = item.description?.toLowerCase() || '';
      return (d.includes('tear off') || d.includes('remove')) &&
             (d.includes('3 tab') || d.includes('3-tab') || d.includes('comp')) &&
             !d.includes('membrane') && !d.includes('slate') &&
             !d.includes('tile')     && !d.includes('metal');
    });
    if (tabMatch) return tabMatch;

    const tearOffMatch = priceList.find(item => {
      const d = item.description?.toLowerCase() || '';
      return (d.includes('remove roof') || d.includes('tear off') || d.includes('r&r')) &&
             (d.includes('composition') || d.includes('shingle')) &&
             !d.includes('slate') && !d.includes('tile')  && !d.includes('metal') &&
             !d.includes('cedar') && !d.includes('shake') && !d.includes('wood')  &&
             !d.includes('membrane') && !d.includes('modified') &&
             !d.includes('built-up') && !d.includes('tar') && !d.includes('gravel');
    });
    if (tearOffMatch) return tearOffMatch;
  }

  // ── Special case: sheathing / decking ──────────────────────────────────
  if (descLower.includes('sheath') || descLower.includes('deck')) {
    const deckingMatch = priceList.find(item => {
      const d = item.description?.toLowerCase() || '';
      return (d.includes('osb') || d.includes('plywood') || d.includes('sheathing')) &&
             (d.includes('roof') || d.includes('deck')) &&
             !d.includes('water') && !d.includes('barrier') && !d.includes('membrane');
    });
    if (deckingMatch) return deckingMatch;
  }

  // ── Exact match ─────────────────────────────────────────────────────────
  const exactMatch = priceList.find(item =>
    item.description?.toLowerCase().trim() === descLower ||
    item.code?.toLowerCase().trim() === descLower
  );
  if (exactMatch) return exactMatch;

  // ── Code substring match ────────────────────────────────────────────────
  const codeMatch = priceList.find(item =>
    descLower.includes(item.code?.toLowerCase()) ||
    item.code?.toLowerCase().includes(descLower)
  );
  if (codeMatch) return codeMatch;

  // ── Multi-word keyword match ────────────────────────────────────────────
  const words            = descLower.split(/\s+/);
  const significantWords = words.filter(w => w.length > 3);

  if (significantWords.length >= 2) {
    const multiWordMatch = priceList.find(item => {
      if (!item.description?.trim()) return false;  // skip blank items
      const itemDesc = item.description.toLowerCase();
      return significantWords.every(word => itemDesc.includes(word));
    });
    if (multiWordMatch) return multiWordMatch;
  }

  // ── Single significant keyword match ────────────────────────────────────
  // Material-type words that disqualify a price list item when the search
  // description does not mention that material (prevents, e.g., "synthetic
  // underlayment" from matching a "Wood Shingle … underlayment" item via the
  // shared word "underlayment").
  const SINGLE_WORD_MATERIAL_EXCLUSIONS = ['wood', 'shake', 'cedar', 'tile', 'metal', 'slate'];
  const searchHasMaterialWord = SINGLE_WORD_MATERIAL_EXCLUSIONS.some(m => descLower.includes(m));

  const singleWordMatch = priceList.find(item => {
    if (!item.description?.trim()) return false;  // skip blank items
    const itemDesc = item.description.toLowerCase();
    // Skip items that specify a material type the search doesn't mention
    if (!searchHasMaterialWord && SINGLE_WORD_MATERIAL_EXCLUSIONS.some(m => itemDesc.includes(m))) return false;
    return significantWords.some(word => word.length >= 5 && itemDesc.includes(word));
  });
  if (singleWordMatch) return singleWordMatch;

  // ── Roofing category term match ─────────────────────────────────────────
  const roofingTerms = {
    'ice':          ['ice', 'water', 'shield', 'iws', 'barrier'],
    'shingle':      ['shingle', 'architectural', 'laminated', 'asphalt', 'composition', 'comp', '3 tab'],
    'ridge':        ['ridge', 'cap', 'venting'],
    'valley':       ['valley'],
    'starter':      ['starter', 'strip', 'starter course'],
    'drip':         ['drip', 'edge'],
    'flashing':     ['flashing', 'step', 'pipe jack'],
    'underlayment': ['underlayment', 'felt', 'synthetic', 'roofing felt'],
    'tear_off':     ['tear off', 'remove comp', 'remove 3 tab', 'remove shingle'],
    'vent':         ['vent', 'turtle', 'box vent'],
    'debris':       ['debris', 'dumpster', 'haul away']
  };

  // Items that describe a specific material type must never be returned as
  // a generic category match — they belong to their own category, not a
  // broader one (e.g. "wood shingle" must not match underlayment just because
  // its full description contains "underlayment").
  const materialExclusions = {
    underlayment: ['wood', 'shake', 'cedar', 'shingle', 'tile', 'metal', 'slate'],
    shingle:      ['wood', 'shake', 'cedar', 'tile', 'metal', 'slate', 'felt', 'remove', 'tear'],
    ridge:        ['wood', 'shake', 'cedar'],
    starter:      ['wood', 'shake', 'cedar'],
  };

  for (const [category, terms] of Object.entries(roofingTerms)) {
    if (terms.some(term => descLower.includes(term))) {
      const exclusions = materialExclusions[category] || [];
      const categoryMatch = priceList.find(item => {
        if (!item.description?.trim()) return false;  // skip blank items
        const itemDesc = item.description.toLowerCase();
        if (exclusions.some(ex => textIncludesExclusion(itemDesc, ex))) return false;
        return terms.some(term => itemDesc.includes(term));
      });
      if (categoryMatch) return categoryMatch;
    }
  }

  return null;
}

/**
 * Attempts to match a single line item against a new price list when the
 * pricing source is changed.  Tries code → description+unit → smart fallback.
 *
 * @param {Object} item       Current line item
 * @param {Array}  priceList  Target price list to match against
 * @returns {Object} Updated line item (with zeroed pricing if no match found)
 */
export function matchItemToNewPriceList(item, priceList) {
  let matchedItem = null;

  // STEP 1: Exact code match
  if (item.code) {
    matchedItem = priceList.find(p => p.code?.toUpperCase() === item.code?.toUpperCase());
  }

  // STEP 2: Description + unit match
  if (!matchedItem) {
    const itemDesc = item.description?.toLowerCase() || '';
    const keywords = itemDesc.split(/\s+/).filter(word =>
      word.length > 3 && !['the', 'and', 'for', 'with', 'from'].includes(word)
    );
    matchedItem = priceList.find(p => {
      if (p.unit?.toUpperCase() !== item.unit?.toUpperCase()) return false;
      const priceDesc      = p.description?.toLowerCase() || '';
      const matchingKeywords = keywords.filter(kw => priceDesc.includes(kw));
      return matchingKeywords.length >= Math.min(2, keywords.length);
    });
  }

  // STEP 3: Smart description fallback
  if (!matchedItem) {
    matchedItem = smartDescriptionMatch(item.description, priceList);
  }

  if (matchedItem) {
    const newPrice   = Number(matchedItem.price) || 0;
    const qty        = Number(item.quantity) || 0;
    const newRcv     = Math.round(newPrice * qty * 100) / 100;
    const depPercent = Number(item.depreciation_percent) || 0;
    const newAcv     = Math.round(newRcv * (1 - depPercent / 100) * 100) / 100;
    return {
      ...item,
      code:   matchedItem.code,
      unit:   matchedItem.unit || item.unit,
      rate:   Math.round(newPrice * 100) / 100,
      rcv:    newRcv,
      acv:    newAcv,
      amount: newRcv
    };
  }

  // No match — zero out pricing
  return { ...item, rate: 0, rcv: 0, acv: 0, amount: 0 };
}

/**
 * Returns the best matching estimate format for a given pricing source.
 * Falls back to sensible defaults when no DB format is configured.
 *
 * @param {string} source   e.g. 'xactimate' | 'symbility' | 'custom'
 * @param {Array}  formats  Array of EstimateFormat records from the DB
 */
export function getFormatForSource(source, formats) {
  const lowerSource = source.toLowerCase();
  const insuranceFormat = formats.find(f =>
    f.insurance_company?.toLowerCase().includes(lowerSource) ||
    f.insurance_company?.toLowerCase().includes(
      source === 'xactimate' || source === 'xactimate_new' ? 'xactimate'
      : source === 'symbility' ? 'symbility' : ''
    )
  );
  if (insuranceFormat) return insuranceFormat;

  const categoryFormat = formats.find(f =>
    f.category === (source === 'custom' ? 'custom' : 'insurance')
  );
  if (categoryFormat) return categoryFormat;

  if (source === 'xactimate' || source === 'xactimate_new' || source === 'symbility') {
    return {
      format_name:       source.includes('xactimate') ? 'Xactimate Standard' : 'Symbility Standard',
      show_rcv_acv:      true,
      show_depreciation: false,
      rcv_label:         'RCV',
      acv_label:         'ACV'
    };
  }

  return {
    format_name:       'Custom',
    show_rcv_acv:      false,
    show_depreciation: false,
    rcv_label:         'RCV',
    acv_label:         'ACV'
  };
}

/**
 * Maps an EstimateFormat color_scheme to a Tailwind gradient class.
 */
export function getHeaderColorClass(format) {
  const colorScheme = format?.color_scheme || 'blue';
  const colorMap = {
    red:   'bg-gradient-to-r from-red-500 to-red-600',
    green: 'bg-gradient-to-r from-green-500 to-green-600',
    blue:  'bg-gradient-to-r from-blue-500 to-blue-600',
    gray:  'bg-gradient-to-r from-gray-500 to-gray-600'
  };
  return colorMap[colorScheme] || colorMap.blue;
}
