/**
 * One price-list picker for generated estimate lines.
 * Order: company favourites, then company custom items, then the catalog, then the hardcoded default.
 * Exclusion rules apply to the code match, the keyword match, and the loose name fallback.
 */
import { smartDescriptionMatch, textIncludesExclusion } from './priceListUtils.js';

const KEYWORD_GUARDS = ['vent', 'window', 'kit', 'labor minimum'];

function codeMatches(itemCode, searchCode) {
  if (!itemCode || searchCode == null) return false;
  const ic = String(itemCode).toUpperCase();
  const sc = String(searchCode).toUpperCase();
  if (ic === sc) return true;
  if (sc.length >= 4 && (ic.startsWith(`${sc}_`) || ic.startsWith(`${sc}-`))) return true;
  return false;
}

function unitOk(item, fallback) {
  if (!fallback || !fallback.unit) return true;
  if (!item?.unit || !String(item.unit).trim()) return true;
  return String(item.unit).toUpperCase() === String(fallback.unit).toUpperCase();
}

function keywordGuardOk(description, term) {
  const itemDesc = String(description || '').toLowerCase();
  const needle = String(term || '').toLowerCase();
  return !KEYWORD_GUARDS.some((ex) => itemDesc.includes(ex) && !needle.includes(ex));
}

function isUnderlaymentSearch(searchTerms, fallback) {
  const codes = (searchTerms?.codes || []).map((code) => String(code).toUpperCase().replace(/\s+/g, ''));
  const keywords = (searchTerms?.keywords || []).map((keyword) => String(keyword).toLowerCase());
  const fallbackDesc = String(fallback?.description || '').toLowerCase();
  const codeHit = codes.some((code) => code.includes('FELT') || code === 'RFGUL');
  const keywordHit = keywords.some((keyword) =>
    keyword.includes('underlayment') || keyword.includes('roofing felt') || keyword.includes('felt -')
  );
  const fallbackHit = fallbackDesc.includes('underlayment') || fallbackDesc.includes('roofing felt');
  const shingleQuery = keywords.some((keyword) =>
    /\bshingle/.test(keyword) && !keyword.includes('underlayment') && !keyword.includes('felt')
  ) || (/\bshingle/.test(fallbackDesc) && !fallbackHit);
  return (codeHit || keywordHit || fallbackHit) && !shingleQuery;
}

function isShingleProduct(item) {
  const desc = String(item?.description || '').toLowerCase();
  if (/\bshingles?\b/.test(desc)) return true;
  const code = String(item?.code || '').toUpperCase().replace(/\s+/g, '');
  return code === 'RFGSSSQ' || code.startsWith('LAMINATED_COMP') || code.startsWith('ARCH_COMP') || code.startsWith('3_TAB');
}

function passesExclusions(item, searchTerms, fallback) {
  const exclude = searchTerms?.exclude || [];
  if (exclude.some((term) => textIncludesExclusion(item?.description, term))) return false;
  if (isUnderlaymentSearch(searchTerms, fallback) && isShingleProduct(item)) return false;
  return true;
}

function tiersOf(priceList) {
  const items = (Array.isArray(priceList) ? priceList : []).filter((item) => item && item.is_active !== false);
  return [
    { source: 'favourite', items: items.filter((item) => item.is_favorite) },
    { source: 'custom', items: items.filter((item) => !item.is_favorite && (item.source === 'Custom' || item.is_custom)) },
    { source: 'catalog', items: items.filter((item) => !item.is_favorite && item.source !== 'Custom' && !item.is_custom) },
  ];
}

function withSource(item, source) {
  return { ...item, price_source: source };
}

/**
 * @param {Array} priceList
 * @param {{ codes?: string[], keywords?: string[], exclude?: string[] }} searchTerms
 * @param {{ price?: number, unit?: string, code?: string, description?: string }} fallback
 * @returns {object} matched item, or the fallback, with `price_source`
 */
export function pickLineItem(priceList, searchTerms = {}, fallback = {}) {
  const terms = searchTerms || {};
  for (const tier of tiersOf(priceList)) {
    if (!tier.items.length) continue;

    for (const code of terms.codes || []) {
      const match = tier.items.find((item) =>
        codeMatches(item.code, code) && unitOk(item, fallback) && passesExclusions(item, terms, fallback)
      );
      if (match) return withSource(match, tier.source);
    }

    for (const keyword of terms.keywords || []) {
      const needle = String(keyword).toLowerCase();
      const match = tier.items.find((item) => {
        const desc = String(item.description || '');
        if (!desc.toLowerCase().includes(needle)) return false;
        if (!unitOk(item, fallback)) return false;
        if (!keywordGuardOk(desc, needle)) return false;
        return passesExclusions(item, terms, fallback);
      });
      if (match) return withSource(match, tier.source);
    }

    if (fallback?.description) {
      // Drop items that fail the exclusion rules before the loose match, so a
      // rejected favourite is not the answer. Keep other units in the pool:
      // smartDescriptionMatch returns one item, and a unit mismatch must fall
      // through instead of promoting a different line.
      const pool = tier.items.filter((item) => passesExclusions(item, terms, fallback));
      const smart = pool.length ? smartDescriptionMatch(fallback.description, pool) : null;
      if (smart && unitOk(smart, fallback) && keywordGuardOk(smart.description, fallback.description) && passesExclusions(smart, terms, fallback)) {
        return withSource(smart, tier.source);
      }
    }
  }

  return { ...fallback, price_source: 'default' };
}

function moneyLine(item, quantity, unit) {
  const price = Number(item?.price) || 0;
  const qty = Number(quantity) || 0;
  const amount = price * qty;
  return {
    code: item?.code || '',
    description: item?.description || '',
    quantity: qty,
    unit,
    rate: price,
    rcv: amount,
    acv: amount,
    amount,
    depreciation: 0,
    price_source: item?.price_source || 'default',
    ...(item?.price_source === 'default' ? { catalog_exempt: true } : {}),
  };
}

const SOFFIT_FALLBACK = { price: 3.5, unit: 'SF', code: 'SOFFIT', description: 'Soffit' };
const FASCIA_FALLBACK = { price: 3.75, unit: 'LF', code: 'FASCIA', description: 'Fascia' };
const DOWNSPOUT_EA_FALLBACK = { price: 45, unit: 'EA', code: 'DNSPOUT', description: 'Downspout' };
const DOWNSPOUT_LF_FALLBACK = { price: 8, unit: 'LF', code: 'DNSPOUT', description: 'Downspout' };
const SIDING_MINIMUM_FALLBACK = { price: 0, unit: 'EA', code: 'SID MIN', description: 'Siding labor minimum' };

/**
 * Lines for trim that was already measured, plus a siding minimum only when
 * the catalog actually has that charge. Does not compute quantities.
 *
 * @param {object} measurements
 * @param {Array} priceList
 * @param {{ soffit?: boolean, fascia?: boolean, downspouts?: boolean, sidingMinimum?: boolean }} options
 */
export function buildMeasuredTrimLines(measurements, priceList, options = {}) {
  const measured = measurements || {};
  const lines = [];

  if (options.soffit) {
    const qty = Number(measured.soffit_sqft ?? measured.soffit_sf) || 0;
    if (qty > 0) {
      const item = pickLineItem(priceList, {
        codes: ['SOFFIT', 'SID SFT'],
        keywords: ['soffit'],
        exclude: ['fascia', 'gutter', 'remove', 'removal', 'shingle'],
      }, SOFFIT_FALLBACK);
      lines.push(moneyLine(item, qty, 'SF'));
    }
  }

  if (options.fascia) {
    const qty = Number(measured.fascia_lf) || 0;
    if (qty > 0) {
      const item = pickLineItem(priceList, {
        codes: ['FASCIA', 'SID FSC'],
        keywords: ['fascia'],
        exclude: ['soffit', 'gutter', 'remove', 'removal', 'shingle'],
      }, FASCIA_FALLBACK);
      lines.push(moneyLine(item, qty, 'LF'));
    }
  }

  if (options.downspouts) {
    const each = Number(measured.downspout_count ?? measured.downspout_ea) || 0;
    const lf = Number(measured.downspout_lf) || 0;
    if (each > 0) {
      const item = pickLineItem(priceList, {
        codes: ['DNSPOUT', 'RFG DS'],
        keywords: ['downspout', 'down spout'],
        exclude: ['gutter guard', 'screen', 'shingle'],
      }, DOWNSPOUT_EA_FALLBACK);
      lines.push(moneyLine(item, each, 'EA'));
    } else if (lf > 0) {
      const item = pickLineItem(priceList, {
        codes: ['DNSPOUT', 'RFG DS'],
        keywords: ['downspout', 'down spout'],
        exclude: ['gutter guard', 'screen', 'shingle'],
      }, DOWNSPOUT_LF_FALLBACK);
      lines.push(moneyLine(item, lf, 'LF'));
    }
  }

  if (options.sidingMinimum) {
    const item = pickLineItem(priceList, {
      codes: ['SID MIN', 'SIDLM', 'LABMIN'],
      keywords: ['siding labor minimum', 'siding minimum charge', 'minimum charge'],
      exclude: ['roof', 'roofing', 'shingle'],
    }, SIDING_MINIMUM_FALLBACK);
    if (item.price_source && item.price_source !== 'default') {
      lines.push(moneyLine(item, 1, item.unit || 'EA'));
    }
  }

  return lines;
}

export function appendMeasuredTrimLines(items, measurements, priceList, options, startLine) {
  let line = startLine;
  for (const row of buildMeasuredTrimLines(measurements, priceList, options)) {
    items.push({ ...row, line: line++ });
  }
  return line;
}

/**
 * Stamp the next pushed line with the price source of the picker result.
 * Section headers (empty code, zero quantity, ━━━) are left untagged.
 */
export function trackPriceSource(items) {
  let pending = null;
  const rawPush = items.push.bind(items);
  items.push = (line, ...rest) => {
    if (rest.length || !line || typeof line !== 'object') {
      pending = null;
      return rawPush(line, ...rest);
    }
    const description = String(line.description || '');
    const isHeader = !String(line.code || '').trim() && !(Number(line.quantity) > 0) && description.includes('━');
    if (line.price_source || isHeader) {
      pending = null;
      return rawPush(line);
    }
    const source = pending;
    pending = null;
    return rawPush(source ? { ...line, price_source: source } : line);
  };
  return function notePriceSource(match) {
    pending = match?.price_source || null;
    return match;
  };
}
