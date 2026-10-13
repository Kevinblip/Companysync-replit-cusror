'use strict';

/**
 * Builds a purchase list directly from estimate line items.
 *
 * This deliberately does not ask an LLM to decide what a contractor should
 * order. Estimate line items are the source of truth: the helper preserves the
 * install quantity, groups only like physical products, excludes pure removal
 * and labor charges, and places the computed purchase quantity on that exact
 * product. The client can therefore never apply one generic "Shingles" total
 * to a different shingle type.
 */

const number = (value) => Number(value) || 0;
const lower = (item) => String(item.description || item.name || '').toLowerCase();
const unit = (item) => String(item.unit || '').toUpperCase();

const SIDING_TERMS = [
  'siding', 'vinyl', 'cladding', 'lap panel', 'j-channel', 'j channel',
  'soffit', 'fascia', 'house wrap', 'housewrap', 'weather barrier',
  'corner post', 'trim coil',
];
const ROOFING_TERMS = [
  'roof replacement', 'shingle', 'underlayment', 'ice & water',
  'ice and water', 'drip edge', 'ridge cap', 'tear-off', 'tear off',
  'roof vent',
];

const inferTrade = ({ lineItems = [], jobType = '', trade = '', category = '' } = {}) => {
  const itemText = (Array.isArray(lineItems) ? lineItems : [])
    .map(item => `${lower(item)} ${String(item.trade || '').toLowerCase()} ${String(item.pricing_scope || '').toLowerCase()}`)
    .join(' ');
  const metadata = `${jobType} ${trade} ${category}`.toLowerCase();
  const hasSiding = SIDING_TERMS.some(term => itemText.includes(term));
  const hasStrongRoof = ROOFING_TERMS.some(term => itemText.includes(term));
  if (/\bsiding\b|vinyl|cladding/.test(metadata)) return hasStrongRoof ? 'mixed' : 'siding';
  if (/\broof(?:ing)?\b/.test(metadata)) return hasSiding ? 'mixed' : 'roofing';
  // A stray "Roofing Nails" or generic "Starter Strip" should not turn a
  // siding estimate into a roofing purchase list.
  if (hasSiding && hasStrongRoof) return 'mixed';
  if (hasSiding) return 'siding';
  if (hasStrongRoof) return 'roofing';
  if (/\broof(?:ing)?\b/.test(itemText)) return 'roofing';
  return 'general';
};

const isPureLabor = (item) => {
  const desc = lower(item);
  if (String(item.activity || '').trim() === '&' || /^\s*(?:r\s*&\s*r\b|remove\s*(?:&|and)\s*replace\b)/i.test(desc)) return false;
  return (
    ['-', 'remove', 'removal'].includes(String(item.activity || '').trim().toLowerCase()) ||
    /\bremove\b|\btear[\s-]?off\b|\bdetach\b|\breset\b|\bhaul\b|\bdisposal\b|\bdebris\b/.test(desc) ||
    /\badditional charge\b|\bsteep roof\b|\blabor minimum\b|\bdigital satellite\b/.test(desc)
  );
};

const materialKind = (item, scope = 'general') => {
  const desc = lower(item);
  // Specific accessories must precede broad material words. "Vinyl J-channel"
  // and "siding nails" are not square feet of siding.
  if (scope !== 'roofing') {
    if (/\bj[\s-]?(?:channel|trim|mould(?:ing)?|mold(?:ing)?)\b/.test(desc)) return 'j_channel';
    if (desc.includes('inside corner')) return 'inside_corner_post';
    if (desc.includes('outside corner') || desc.includes('corner post')) return 'corner_post';
    if (desc.includes('soffit')) return 'siding_soffit';
    if (desc.includes('fascia')) return 'siding_fascia';
    if (desc.includes('house wrap') || desc.includes('housewrap') || desc.includes('weather barrier') || desc.includes('tyvek') || desc.includes('fanfold')) return 'house_wrap';
    if (desc.includes('trim coil') || desc.includes('window trim') || desc.includes('door trim')) return 'siding_trim';
    if (desc.includes('starter') && (scope === 'siding' || /siding|vinyl|cladding/.test(desc))) return 'siding_starter';
    if ((desc.includes('nail') || desc.includes('fastener')) && (scope === 'siding' || /siding|cladding/.test(desc))) return 'siding_fasteners';
    if (/\b(light|electrical|fixture)\b/.test(desc) && /\bbox|block\b/.test(desc)) return 'light_box';
    if (/\b(water|hose|bib|spigot)\b/.test(desc) && /\bbox|block\b/.test(desc)) return 'water_box';
    if (/water spigot|hose.?bib/.test(desc)) return 'water_spigot';
    if (/mounting block|mount block|utility block|split block/.test(desc)) return 'mounting_block';
    if (/caulk|sealant/.test(desc)) return 'exterior_caulk';
    if (desc.includes('siding') || desc.includes('cladding') || desc.includes('lap panel')) {
      if (/aluminum|aluminium|metal|steel/.test(desc)) return 'metal_siding';
      if (/fiber.?cement|hardie/.test(desc)) return 'fiber_cement_siding';
      if (/wood|cedar/.test(desc)) return 'wood_siding';
      return 'siding';
    }
  }
  if (/\b3[\s-]?tab\b/.test(desc) && desc.includes('shingle')) return 'three_tab_shingles';
  if ((desc.includes('laminated') || desc.includes('architectural')) && desc.includes('shingle')) return 'laminated_shingles';
  if (desc.includes('shingle') && !desc.includes('cap') && !desc.includes('starter')) return 'field_shingles';
  if (desc.includes('felt') || desc.includes('underlayment') || desc.includes('synthetic')) return 'underlayment';
  if (desc.includes('ice') && (desc.includes('water') || desc.includes('barrier'))) return 'ice_water';
  if ((desc.includes('ridge') || desc.includes('hip')) && desc.includes('cap')) return 'ridge_cap';
  if (desc.includes('valley') && desc.includes('metal')) return 'valley_metal';
  if (desc.includes('pipe jack')) return 'pipe_jack';
  if (desc.includes('gutter') && (desc.includes('guard') || desc.includes('screen'))) return 'gutter_guard';
  if (desc.includes('starter')) return 'starter';
    if (desc.includes('nail') || desc.includes('fastener')) return 'nails';
  if (desc.includes('step') && desc.includes('flashing')) return 'step_flashing';
  if (desc.includes('drip') && desc.includes('edge')) return 'drip_edge';
  if (desc.includes('gutter') || desc.includes('downspout')) return 'gutter_downspout';
  if (desc.includes('wrap') && (desc.includes('window') || desc.includes('door'))) return 'window_door_wrap';
  if (desc.includes('flashing')) return 'flashing';
  return null;
};

const labels = {
  three_tab_shingles: '3-tab Composition Shingles',
  laminated_shingles: 'Laminated Composition Shingles',
  field_shingles: 'Composition Shingles',
  underlayment: 'Roofing Felt / Underlayment',
  ice_water: 'Ice & Water Barrier',
  ridge_cap: 'Hip / Ridge Cap Shingles',
  valley_metal: 'Valley Metal',
  pipe_jack: 'Pipe Jack Flashing',
  gutter_guard: 'Gutter Guard / Screen',
  starter: 'Starter Strip',
  nails: 'Roofing Nails',
  step_flashing: 'Step Flashing',
  drip_edge: 'Drip Edge',
  gutter_downspout: 'Gutter / Downspout',
  window_door_wrap: 'Window & Door Wrap',
  siding: 'Vinyl Siding',
  house_wrap: 'House Wrap / Weather Barrier',
  j_channel: 'J-Channel',
  corner_post: 'Corner Posts',
  siding_soffit: 'Soffit',
  siding_fascia: 'Fascia',
  siding_trim: 'Siding Trim Coil',
  siding_starter: 'Siding Starter Strip',
  siding_fasteners: 'Siding Nails / Fasteners',
  inside_corner_post: 'Inside Corner Posts',
  metal_siding: 'Metal / Aluminum Siding',
  fiber_cement_siding: 'Fiber-Cement Siding',
  wood_siding: 'Wood Siding',
  light_box: 'Light Boxes / Mounting Blocks',
  water_box: 'Water / Hose-Bib Mounting Blocks',
  water_spigot: 'Water Spigot / Hose Bib',
  mounting_block: 'Utility Mounting Blocks',
  exterior_caulk: 'Exterior Caulk / Sealant',
  flashing: 'Flashing',
};

function purchaseQuantity(kind, rawQty, rawUnit, totalFieldSquares, packageUnit = '') {
  // EA on an estimate can mean one explicitly described box or tube.
  // Keep the count; do not convert seven boxes into seven individual nails.
  if (packageUnit) return { quantity: rawQty, unit: packageUnit, note: 'Package unit stated in the source line; uses the recorded quantity.' };
  if ((kind === 'siding' || kind === 'house_wrap') && (rawUnit === 'SQ' || rawUnit === 'SF')) {
    const squareFeet = rawUnit === 'SQ' ? rawQty * 100 : rawQty;
    if (kind === 'house_wrap') return { quantity: Math.ceil(squareFeet / 1000), unit: 'roll', note: `${squareFeet.toFixed(2)} SF ÷ 1,000 SF/roll` };
    return { quantity: Math.ceil(squareFeet / 200), unit: 'box', note: `${squareFeet.toFixed(2)} SF ÷ 200 SF/box` };
  }
  if (['j_channel', 'corner_post', 'inside_corner_post', 'siding_soffit', 'siding_fascia', 'siding_trim'].includes(kind) && rawUnit === 'LF') {
    return { quantity: Math.ceil(rawQty / 12.5), unit: '12.5-ft piece', note: `${rawQty.toFixed(2)} LF ÷ 12.5 ft/piece` };
  }
  if (kind === 'siding_starter' && rawUnit === 'LF') return { quantity: rawQty, unit: 'LF', note: 'Confirm siding starter length per piece with supplier; roofing bundle coverage does not apply.' };
  if (kind.endsWith('shingles') && rawUnit === 'SQ') {
    const qty = Math.ceil(rawQty * 3);
    return { quantity: qty, unit: 'bundle', note: `${rawQty.toFixed(2)} SQ × 3 bundles/SQ` };
  }
  if (kind === 'underlayment' && rawUnit === 'SQ') {
    const qty = Math.ceil(rawQty / 10);
    return { quantity: qty, unit: 'roll', note: `${rawQty.toFixed(2)} SQ ÷ 10 SQ/roll` };
  }
  if (kind === 'ice_water' && (rawUnit === 'SF' || rawUnit === 'LF')) {
    const lf = rawUnit === 'SF' ? rawQty / 3 : rawQty;
    return { quantity: Math.ceil(lf / 50), unit: 'roll', note: `${lf.toFixed(2)} LF ÷ 50 LF/roll` };
  }
  if (kind === 'ridge_cap' && rawUnit === 'LF') return { quantity: Math.ceil(rawQty / 33), unit: 'bundle', note: `${rawQty.toFixed(2)} LF ÷ 33 LF/bundle` };
  if ((kind === 'valley_metal' || kind === 'drip_edge' || kind === 'gutter_downspout' || kind === 'gutter_guard') && rawUnit === 'LF') {
    return { quantity: Math.ceil(rawQty / 10), unit: '10-ft section', note: `${rawQty.toFixed(2)} LF ÷ 10 ft/section` };
  }
  if (kind === 'starter' && rawUnit === 'LF') return { quantity: Math.ceil(rawQty / 100), unit: 'bundle', note: `${rawQty.toFixed(2)} LF ÷ 100 LF/bundle` };
  if (kind === 'step_flashing' && rawUnit === 'LF') return { quantity: Math.ceil(rawQty / 50), unit: 'box', note: `${rawQty.toFixed(2)} LF ÷ 50 LF/box` };
  if (kind === 'nails' && totalFieldSquares > 0) return { quantity: Math.ceil(totalFieldSquares / 15), unit: 'box', note: `${totalFieldSquares.toFixed(2)} field SQ ÷ 15 SQ/box` };
  if (kind === 'window_door_wrap' && rawUnit === 'LF') return { quantity: Math.ceil(rawQty / 50), unit: '50-ft coil', note: `${rawQty.toFixed(2)} LF ÷ 50 ft/coil` };
  return { quantity: Math.ceil(rawQty), unit: rawUnit || 'EA', note: 'Uses estimate quantity' };
}

function buildMaterialList({
  lineItems = [],
  estimateNumber = 'DRAFT',
  customerName = '',
  propertyAddress = '',
  jobType = '',
  trade = '',
  category = '',
} = {}) {
  const items = (Array.isArray(lineItems) ? lineItems : []).filter(Boolean).map((item) => ({
    ...item,
    quantity: number(item.quantity),
    rate: number(item.rate ?? item.price),
    rcv: number(item.rcv ?? item.amount),
    amount: number(item.amount ?? item.rcv),
  }));

  const groups = new Map();
  const labor = [];
  const other = [];
  const scope = inferTrade({ lineItems: items, jobType, trade, category });
  let fieldSquares = 0;

  for (const item of items) {
    const desc = lower(item);
    const taggedRoofing = /\broof(?:ing)?\b/.test(String(item.trade || '').toLowerCase());
    const roofingOnlyInSiding = scope === 'siding' && (
      taggedRoofing
      || /\b(shingle|underlayment|felt|ice\s*(?:&|and)\s*water|ridge cap|roof(?:ing)? nails?|roof vent)\b/.test(desc)
      || /\b(?:hip|ridge|rake|eave)\b.*\bnails?\b/.test(desc)
      || (/\bstarter\b/.test(desc) && !/\b(siding|vinyl|cladding)\b/.test(desc))
    );
    if (roofingOnlyInSiding) {
      // Keep it visible in Full Breakdown as an excluded source line, but
      // never let unrelated roofing scope appear on a siding order sheet.
      other.push({ ...item, _excluded_from_scope: 'siding' });
      continue;
    }
    const lineScope = String(item.pricing_scope || item.trade || '').toLowerCase() === 'siding' ? 'siding' : scope;
    const kind = materialKind(item, lineScope);
    if (isPureLabor(item)) {
      labor.push(item);
      continue;
    }
    if (!kind) {
      other.push(item);
      continue;
    }
    if (kind.endsWith('shingles') && unit(item) === 'SQ') fieldSquares += item.quantity;
    // Unlike units cannot be added (e.g. boxes and pounds of nails).
    const packageUnit = unit(item) === 'EA'
      ? (kind === 'siding_fasteners' && /\bbox\b/.test(desc) ? 'box'
        : kind === 'exterior_caulk' && /\btube\b/.test(desc) ? 'tube' : '')
      : '';
    const packageSize = packageUnit ? (desc.match(/\b\d+(?:\.\d+)?[\s-]*(?:lb|kg|oz|ml)\b/) || [''])[0] : '';
    const groupKey = `${kind}:${unit(item)}:${packageUnit}:${packageSize}`;
    const existing = groups.get(groupKey) || {
      code: item.code || '',
      description: labels[kind] || item.description || item.name || 'Material',
      quantity: 0,
      unit: unit(item),
      rcv: 0,
      amount: 0,
      _materialKind: kind,
      _packageUnit: packageUnit,
      _sources: [],
    };
    existing.quantity += item.quantity;
    existing.rcv += item.rcv;
    existing.amount += item.amount;
    existing._sources.push(item.description || item.name || '');
    groups.set(groupKey, existing);
  }

  const materials = [...groups.values()].map((item) => {
    const order = purchaseQuantity(item._materialKind, item.quantity, item.unit, fieldSquares, item._packageUnit);
    const rate = item.quantity > 0 ? item.rcv / item.quantity : 0;
    return {
      ...item,
      rate,
      order_quantity: order.quantity,
      order_unit: order.unit,
      order_note: order.note,
      notes: item._sources.join(' + '),
    };
  });
  const totals = {
    materials: materials.reduce((sum, item) => sum + item.rcv, 0),
    labor: labor.reduce((sum, item) => sum + item.rcv, 0),
    other: other.reduce((sum, item) => sum + item.rcv, 0),
  };
  totals.grand_total = totals.materials + totals.labor + totals.other;
  const hasSiding = materials.some(item => ['siding', 'metal_siding', 'fiber_cement_siding', 'wood_siding'].includes(item._materialKind))
    || (scope === 'siding' && materials.length > 0);
  const presentKinds = new Set(materials.filter(item => item.quantity > 0).map(item => item._materialKind));
  const missingMaterials = hasSiding
    ? [
        ['j_channel', 'LF'], ['siding_starter', 'LF'], ['corner_post', 'LF'],
        ['light_box', 'EA'], ['water_box', 'EA'], ['siding_fasteners', 'box'],
        ['exterior_caulk', 'tube'],
      ].filter(([kind]) => !presentKinds.has(kind)
        // The existing water/hose-bib scope is already represented. Do not
        // demand a second, unmeasured mounting block in addition to that line.
        && !(kind === 'water_box' && presentKinds.has('water_spigot'))).map(([kind, requiredUnit]) => ({
        description: labels[kind],
        quantity: null,
        unit: requiredUnit,
        notes: 'Not included in the estimate scope. Confirm quantity and whether needed before ordering.',
      }))
    : [];

  return {
    success: true,
    estimate: { estimate_number: estimateNumber, customer_name: customerName, property_address: propertyAddress },
    // Kept for backwards compatibility with the existing dialog/CSV format.
    material_calculations: materials.map((item) => ({
      material: item.description,
      quantity: item.order_quantity,
      unit: item.order_unit,
      purchaseUnit: item.order_unit,
      notes: item.order_note,
    })),
    materials,
    missing_materials: missingMaterials,
    pricing_incomplete: items.some(item => item.pricing_review_required || /price needed/i.test(lower(item))),
    labor,
    other,
    scope,
    totals,
  };
}

function materialListLineItems(estimate = {}, directItems = []) {
  return [estimate.items, estimate.line_items, directItems].find(items => Array.isArray(items) && items.length > 0) || [];
}

module.exports = { buildMaterialList, materialListLineItems };