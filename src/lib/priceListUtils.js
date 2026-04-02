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
 * Splits a flat array of all PriceListItems into the four
 * source-specific arrays expected by the estimator.
 *
 * @param {Array} allItems  Raw items from the DB query
 * @returns {{ xactimatePriceList, xactimateNewPriceList, customPriceList, symbilityPriceList }}
 */
export function filterPriceListBySource(allItems) {
  const active = (item) => item.is_active !== false;
  return {
    xactimatePriceList:    allItems.filter(i => (i.source === 'Xactimate' || i.source === 'Xactimate_New') && active(i)).map(normalizePriceItem),
    xactimateNewPriceList: allItems.filter(i => i.source === 'Xactimate_New' && active(i)).map(normalizePriceItem),
    customPriceList:       allItems.filter(i => i.source === 'Custom'         && active(i)).map(normalizePriceItem),
    symbilityPriceList:    allItems.filter(i => i.source === 'Symbility'      && active(i)).map(normalizePriceItem),
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
    case 'xactimate_new': return xactimateNewPriceList;
    case 'symbility':     return symbilityPriceList;
    default:              return customPriceList;
  }
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
      const itemDesc = item.description?.toLowerCase() || '';
      return significantWords.every(word => itemDesc.includes(word));
    });
    if (multiWordMatch) return multiWordMatch;
  }

  // ── Single significant keyword match ────────────────────────────────────
  const singleWordMatch = priceList.find(item => {
    const itemDesc = item.description?.toLowerCase() || '';
    return significantWords.some(word => word.length >= 5 && itemDesc.includes(word));
  });
  if (singleWordMatch) return singleWordMatch;

  // ── Roofing category term match ─────────────────────────────────────────
  const roofingTerms = {
    'ice':          ['ice', 'water', 'shield', 'iws'],
    'shingle':      ['shingle', 'architectural', 'laminated', 'asphalt'],
    'ridge':        ['ridge', 'cap'],
    'valley':       ['valley'],
    'starter':      ['starter', 'strip'],
    'drip':         ['drip', 'edge'],
    'flashing':     ['flashing', 'step'],
    'underlayment': ['underlayment', 'felt'],
    'debris':       ['debris', 'removal', 'dumpster']
  };

  for (const [, terms] of Object.entries(roofingTerms)) {
    if (terms.some(term => descLower.includes(term))) {
      const categoryMatch = priceList.find(item => {
        const itemDesc = item.description?.toLowerCase() || '';
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
