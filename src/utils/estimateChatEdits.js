import { normalizePriceItem } from '../lib/priceListUtils.js';
import { SHARED_PRICE_CATALOG_COMPANY_ID } from '../lib/loadCompanyPriceCatalog.js';

// Shortcuts are deliberately narrow. Compound or ambiguous requests go to the
// structured AI parser rather than applying a partial keyword match.
export function parseEstimateChatShortcut(message) {
  const text = String(message || '').trim().toLowerCase()
    .replace(/^(?:please\s+|(?:can|could|would)\s+you\s+)/, '').replace(/[.!]$/, '');
  const number = '(\\d[\\d,]*(?:\\.\\d+)?)';
  const value = raw => Number(raw.replace(/,/g, ''));
  if (/\b(?:and|also|then)\b/.test(text) && !/^(?:add|apply|include)\s+overhead and profit$/.test(text)) {
    const verb = text.match(/^(add|apply|include)\b/)?.[1];
    const parts = text.split(/\s+(?:and(?:\s+also)?|also|then)\s+/);
    const parsed = parts.map((part, index) => parseEstimateChatShortcut(
      index > 0 && verb && !/^(?:add|apply|include|change|set|update|make|remove|delete|drop|increase|decrease)\b/.test(part)
        ? `${verb} ${part}` : part));
    return parts.length > 1 && parsed.every(commands => commands.length > 0) ? parsed.flat() : [];
  }
  const remove = text.match(/^(?:remove|delete|take off|drop)\s+(?:the\s+)?(.+?)(?:\s+item)?$/);
  if (remove && !/^(?:all|everything|all items|all lines)$/.test(remove[1])) {
    return [{ type: 'remove_item', searchTerm: remove[1] }];
  }
  const edit = text.match(new RegExp(`^(?:change|set|update|make)\\s+(?:the\\s+)?(.+?)\\s+(?:to|=|at)\\s*(\\$?)${number}\\s*(.*?)$`));
  if (edit) {
    const [, target, dollars, amount, suffix] = edit;
    if (/^(?:it|this|total|total price|price|estimate|estimate total|total estimate)$/.test(target)) return [];
    if (dollars || /\b(?:rate|price|cost)\b/.test(target) || /^(?:dollars?|per\b|\/)/.test(suffix)) {
      return [{ type: 'change_rate', searchTerm: target.replace(/\s+(?:rate|price|cost)$/, ''), rate: value(amount) }];
    }
    if (/^(?:sq|squares?|sf|square feet|sq ft|lf|ea|each)?$/.test(suffix)) {
      const unit = /^(?:sf|square feet|sq ft)$/.test(suffix) ? 'SF'
        : /^squares?$/.test(suffix) ? 'SQ' : suffix === 'each' ? 'EA' : suffix.toUpperCase();
      return [{ type: 'change_qty', searchTerm: target.replace(/\s+quantity$/, ''), quantity: value(amount), unit: unit || null }];
    }
  }
  const adjustment = text.match(new RegExp(`^(increase|decrease|subtract)\\s+(?:the\\s+)?(.+?)\\s+by\\s+${number}$`));
  if (adjustment) return [{ type: 'adjust_qty', searchTerm: adjustment[2], amount: value(adjustment[3]), isDecrease: adjustment[1] !== 'increase' }];
  const percentage = text.match(/^(?:(?:add|apply|set)\s+)?(\d+(?:\.\d+)?)%\s*(discount|off|markup|waste|depreciation)$/);
  if (percentage) {
    const percent = Number(percentage[1]);
    if (percent > 0 && percent <= 100) return [{ type: { off: 'discount', depreciation: 'depreciate' }[percentage[2]] || percentage[2], percent }];
  }
  if (/^(?:add|apply|include)\s+(?:a\s+)?(?:high roof|high roof surcharge)$/.test(text)) return [{ type: 'high' }];
  if (/^(?:add|apply|include)\s+(?:a\s+|the\s+)?(?:steep(?: roof)?(?: surcharge| charges?)?)$/.test(text)) return [{ type: 'steep' }];
  if (/^(?:add|apply|include)\s+(?:o&p|overhead and profit)$/.test(text)) return [{ type: 'op' }];
  const add = text.match(/^(?:add|apply|include)\s+(?:(\d+|a|one|the)\s+)?(dumpster|permit|pipe boot|roof vent|box vent|turtle vent|skylight|chimney flashing)$/);
  if (add) return [{ type: 'add_item', description: add[2], quantity: /^\d+$/.test(add[1] || '') ? Number(add[1]) : 1, unit: 'EA' }];
  const catalogAdd = text.match(/^(?:add|include)\s+(\d+(?:\.\d+)?)\s+(?:(sq|sf|lf|ea|ls|hr)\s+)?(.+?)(?:\s+(sq|sf|lf|ea|ls|hr))?$/);
  if (catalogAdd && Number(catalogAdd[1]) > 0) return [{
    type: 'add_item', description: catalogAdd[3], quantity: Number(catalogAdd[1]), unit: (catalogAdd[2] || catalogAdd[4] || '').toUpperCase() || null,
  }];
  return [];
}

export function resolveEstimateEditIndex(items, reference) {
  const normalize = text => String(text || '').toLowerCase().replace(/\b(shingle|vent|boot|gutter|item|nail)s\b/g, '$1').trim();
  const term = normalize(reference);
  const line = term.match(/^(?:line|row|item)(?:\s+(?:number|#))?\s*(\d+)$/);
  if (line) {
    const index = Number(line[1]) - 1;
    return index >= 0 && index < items.length ? index : -1;
  }
  const matches = items.map((item, index) => ({ item, index })).filter(({ item }) =>
    normalize(item.description).includes(term) ||
    String(item.code || '').toLowerCase() === term
  );
  return term && matches.length === 1 ? matches[0].index : -1;
}

export function isRoofSurcharge(item, type) {
  const description = String(item.description || '').toLowerCase();
  const code = String(item.code || '').toUpperCase().replace(/[\s_-]/g, '');
  const unit = String(item.unit || '').toUpperCase();
  if (!['SQ', 'SF'].includes(unit) || !(Number(item.price) > 0) || item.active === false || item.is_active === false) return false;
  if (/\b(?:sheath(?:ing)?|deck(?:ing)?|steeple)\b/.test(description)) return false;
  const charge = /\b(?:additional charge|surcharge)\b/.test(description);
  if (type === 'high') {
    return /\bhigh[ -](?:roof|slope)\b/.test(description) ||
      (charge && /\b(?:two|2|stories or greater)\b/.test(description)) ||
      /^(?:RFG)?(?:HIGHSRG|HIGHRF)$/.test(code);
  }
  return /\bsteep[ -](?:roof|slope)\b/.test(description) ||
    (charge && /\bsteep\b/.test(description));
}

// The UI labels both imports "Xactimate". New imports can have truncated
// descriptions or broken units, while the original imported row is intact.
// Every active item visible to this company is searchable. The selected source
// is a preference, not an access boundary.
export function getEstimateChatCatalog(source, lists) {
  const all = lists.allPriceListItems || [
    ...(lists.xactimatePriceList || []), ...(lists.xactimateNewPriceList || []),
    ...(lists.symbilityPriceList || []), ...(lists.customPriceList || []),
  ];
  const allowedCompanies = lists.companyId ? new Set([lists.companyId, SHARED_PRICE_CATALOG_COMPANY_ID]) : null;
  const family = String(source || '').startsWith('xactimate') ? ['Xactimate', 'Xactimate_New']
    : source === 'symbility' ? ['Symbility'] : ['Custom'];
  const items = all.map(normalizePriceItem)
    .filter(item => item && (!allowedCompanies || allowedCompanies.has(item.company_id)));
  const priority = item => {
    const index = family.indexOf(item.source);
    return index < 0 ? family.length : index;
  };
  items.sort((a, b) => priority(a) - priority(b) ||
    Number(b.company_id === lists.companyId) - Number(a.company_id === lists.companyId));
  const seen = new Set();
  return items.filter(item => {
    const key = item.id || JSON.stringify([item.source, item.code, item.description, item.unit, item.price]);
    if (seen.has(key) || item.is_active === false || item.active === false) return false;
    seen.add(key);
    return true;
  }).map(item => ({ ...item, unit: String(item.unit || '').trim().toUpperCase() }));
}

const SEARCH_STOP_WORDS = new Set(['add', 'apply', 'include', 'please', 'the', 'and', 'for', 'with', 'from', 'item', 'items', 'line', 'lines', 'charge', 'charges', 'can', 'you', 'estimate', 'to', 'of', 'a', 'an']);
function searchText(value) {
  return String(value || '').toLowerCase()
    .replace(/\b(?:chimeny|chimmney)\b/g, 'chimney')
    .replace(/\bj[ -]?(?:channel|trim)\b/g, 'jtrim')
    .replace(/\b(slope|pitch)\b/g, 'steep')
    .replace(/\b(shingle|vent|boot|gutter|nail|channel)s\b/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function compatibleSearchUnit(requested, actual) {
  if (!requested) return true;
  const normalize = unit => String(unit || '').trim().toUpperCase().replace(/^EACH$/, 'EA');
  const from = normalize(requested), to = normalize(actual);
  return from === to || (['SQ', 'SF'].includes(from) && ['SQ', 'SF'].includes(to));
}

// Rank against the FULL catalog before selecting a model-sized reference.
// Generic execution requires all requested terms, not a one-word fuzzy hit.
export function searchEstimateCatalog(catalog, query, { unit = null, partial = false } = {}) {
  const normalized = searchText(query);
  const compact = normalized.replace(/\s/g, '');
  const terms = [...new Set(normalized.split(/\s+/).filter(word => !SEARCH_STOP_WORDS.has(word)))];
  if (!terms.length) return [];
  return catalog.map((item, index) => {
    if (item.is_active === false || item.active === false || !compatibleSearchUnit(unit, item.unit)) return null;
    const code = searchText(item.code);
    const description = searchText(item.description);
    const text = `${code} ${description} ${searchText(item.long_description)} ${searchText(item.source)}`;
    const hits = terms.filter(term => text.includes(term)).length;
    const exactCode = code.replace(/\s/g, '') === compact;
    const exactDescription = description === normalized;
    if (!exactCode && !exactDescription && (partial ? !hits : hits !== terms.length)) return null;
    const score = exactCode ? 10000 : exactDescription ? 9000 : hits * 100 + (hits === terms.length ? 1000 : 0);
    return { item, score, index };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.index - b.index).map(result => result.item);
}

export function findChimneyFlashingItem(catalog, request) {
  const text = String(request).toLowerCase();
  const size = text.match(/\b(small|large|average)\b/)?.[1];
  const copper = /\bcopper\b/.test(text);
  const candidates = catalog.filter(item => {
    const description = `${item.description || ''} ${item.long_description || ''}`.toLowerCase();
    return /\bchimney\b/.test(description) && /\bflashing\b/.test(description) &&
      String(item.unit).trim().toUpperCase() === 'EA' && Number(item.price) > 0 &&
      item.is_active !== false && item.active !== false &&
      /\bcopper\b/.test(description) === copper &&
      !/\b(?:cap|liner|cricket)\b/.test(description) &&
      (!size || description.includes(size));
  });
  if (size) return candidates[0] || null;
  const preferredCandidates = candidates.filter(item => item.source === candidates[0]?.source);
  // Prefer the ordinary average scope, not the first small/large/copper row.
  return preferredCandidates.find(item => /\baverage\b/i.test(item.description) && !/\d/.test(item.description))
    || preferredCandidates.find(item => /\baverage\b/i.test(item.description))
    || preferredCandidates.find(item => !/\b(?:small|large)\b/i.test(item.description))
    || candidates.find(item => /\baverage\b/i.test(item.description))
    || candidates.find(item => !/\b(?:small|large)\b/i.test(item.description))
    || null;
}

export function createRoofSurchargeLine(catalogItem, roofSquares, line) {
  const unit = String(catalogItem.unit).toUpperCase();
  const quantity = Math.round(Number(roofSquares) * (unit === 'SF' ? 100 : 1) * 100) / 100;
  const rate = Number(catalogItem.price);
  const amount = Math.round(quantity * rate * 100) / 100;
  return { line, code: catalogItem.code, description: catalogItem.description, quantity, unit, rate, rcv: amount, acv: amount, amount, depreciation: 0, catalog_source: catalogItem.source, catalog_item_id: catalogItem.id };
}
