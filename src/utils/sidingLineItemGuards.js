// Finished siding lines have to match the material being priced. A missing
// or unrecognized material prices as vinyl. Hazardous or unusual cladding
// is held off the estimate until the rep approves that line.

import { sidingMaterial } from '../lib/sidingCatalogPricing.js';

const hazardousOrUnusual = /\basbestos\b|\blead\b|\bcedar\b|fiber[\s-]*cement|\bhardie\b|\bwood\b|\bstucco\b/i;
const accessory = /\bsoffit\b|\bfascia\b|\bgutter\b|\bdownspout\b|\bhouse\s*wrap\b|\bweather\s*barrier\b|\bnails?\b|\bfasteners?\b|\bcaulk\b|\bsealant\b|\bbrick veneer\b|\bhose bib\b|\bwater spigot\b|\belectrical box\b|\bhaul off\b|\bdebris\b|\bdumpster\b|\bwater table\b/i;

export function sidingLineConfirmId(item) {
  return String(item?.confirm_id || `${item?.code || ''}|${item?.description || ''}`).toLowerCase();
}

function conflictsWithConfirmedMaterial(description, material) {
  const text = String(description || '');
  if (hazardousOrUnusual.test(text)) return true;
  const aluminum = /\balum(?:inum|inium)?\b|\balu\b/i.test(text);
  const vinyl = /\bvinyl\b|\bvnl\b/i.test(text);
  if (material === 'vinyl' && aluminum && !vinyl) return true;
  if (material === 'aluminum' && vinyl && !aluminum) return true;
  return false;
}

function renumber(items) {
  return items.map((item, index) => ({ ...item, line: index + 1 }));
}

/**
 * @returns {{ items: object[], held: object[], ask: null, material: 'vinyl'|'aluminum' }}
 * `items` are safe to bill. `held` carry confirm:true and stay off until approved.
 * An unset material bills as vinyl.
 */
export function guardSidingLineItems(items, { material, approvedIds = [] } = {}) {
  const confirmed = sidingMaterial(material) || 'vinyl';
  const approved = new Set((approvedIds || []).map((id) => String(id).toLowerCase()));
  const billed = [];
  const held = [];
  for (const item of items || []) {
    if (item?.catalog_exempt) {
      billed.push(item);
      continue;
    }
    const description = String(item?.description || '');
    if (accessory.test(description) && !hazardousOrUnusual.test(description)) {
      billed.push(item);
      continue;
    }
    if (hazardousOrUnusual.test(description)) {
      const confirmId = sidingLineConfirmId(item);
      const flagged = { ...item, confirm: true, confirm_id: confirmId, held_reason: 'hazardous_or_unusual' };
      if (approved.has(confirmId)) billed.push(flagged);
      else held.push(flagged);
      continue;
    }
    if (conflictsWithConfirmedMaterial(description, confirmed)) continue;
    billed.push(item);
  }
  return { items: renumber(billed), held, ask: null, material: confirmed };
}
