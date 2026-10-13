/**
 * Trade-aware "Check Missing Items" rules for estimate editing.
 *
 * The checklist is intentionally deterministic and local. It should never
 * suggest roofing scope merely because the estimator is used by a roofing
 * contractor; the estimate's trade and line-item language are the authority.
 */

const SIDING_SCOPE_TERMS = [
  'siding', 'vinyl siding', 'fiber cement', 'fibre cement', 'cladding',
  'lap panel', 'j-channel', 'j channel', 'soffit', 'fascia', 'house wrap',
  'housewrap', 'weather barrier', 'corner post',
];

const ROOFING_SCOPE_TERMS = [
  'roof replacement', 'roofing', 'shingle', 'underlayment', 'ice & water',
  'ice and water', 'drip edge', 'ridge cap', 'tear-off', 'tear off',
  'roof vent', 'roof nail', 'roof labor',
];

const SIDING_CHECKS = [
  { label: 'Siding Material', reason: 'Main exterior cladding for the wall faces', keywords: ['siding', 'vinyl', 'cladding', 'lap panel'] },
  { label: 'House Wrap / Weather Barrier', reason: 'Moisture protection behind the siding', keywords: ['house wrap', 'housewrap', 'weather barrier', 'moisture barrier', 'wrb'] },
  { label: 'Siding Starter Strip / Utility Trim', reason: 'Locks the first siding course at the base and transitions', keywords: ['siding starter', 'starter strip', 'utility trim'] },
  { label: 'J-Channel', reason: 'Receives siding around windows, doors, and inside edges', keywords: ['j-channel', 'j channel', 'jchannel'] },
  { label: 'Outside Corner Posts', reason: 'Finishes and weather-seals exterior corners', keywords: ['outside corner', 'outside corners', 'corner post', 'exterior corner'] },
  { label: 'Inside Corner Posts', reason: 'Finishes inside wall intersections', keywords: ['inside corner', 'inside corners'] },
  { label: 'Soffit', reason: 'Closes the underside of the eaves where siding meets the roofline', keywords: ['soffit'] },
  { label: 'Fascia', reason: 'Finishes the exposed roof-edge board behind the gutters', keywords: ['fascia'] },
  { label: 'Window / Door Trim', reason: 'Finishes openings and creates a weather-tight transition', keywords: ['window trim', 'door trim', 'trim coil', 'window casing', 'door casing'] },
  { label: 'Siding Removal', reason: 'Removal and disposal of the existing siding', keywords: ['siding removal', 'remove siding', 'tear off siding', 'siding tear-off'] },
  { label: 'Flashing / Kickout Flashing', reason: 'Directs water away from wall openings and roof-to-wall transitions', keywords: ['kickout flashing', 'wall flashing', 'siding flashing', 'flashing'] },
  { label: 'Exterior Sealant / Caulk', reason: 'Seals trim, penetrations, and siding transitions', keywords: ['caulk', 'sealant'] },
  { label: 'Siding Installation Labor', reason: 'Labor to install the siding and accessory trim', keywords: ['siding labor', 'siding installation', 'install siding', 'labor'] },
  { label: 'Exterior Remodeling Permit', reason: 'Some jurisdictions require a permit for exterior cladding work', keywords: ['permit'] },
];

const ROOFING_CHECKS = [
  { label: 'Ice & Water Shield', reason: 'Required at eaves, valleys, and penetrations', keywords: ['ice', 'water shield', 'i&w'] },
  { label: 'Underlayment', reason: 'Required under all roofing materials', keywords: ['felt', 'underlayment', 'synthetic'] },
  { label: 'Drip Edge', reason: 'Required at eaves and rakes per code', keywords: ['drip', 'edge metal'] },
  { label: 'Ridge Cap', reason: 'Needed to finish ridge and hip lines', keywords: ['ridge', 'hip cap'] },
  { label: 'Starter Strip', reason: 'Required at eaves and rakes', keywords: ['starter'] },
  { label: 'Roofing Nails', reason: 'Fasteners for shingles and accessories', keywords: ['nail', 'fastener'] },
  { label: 'Ventilation', reason: 'Code-required attic ventilation', keywords: ['vent', 'ventilation', 'ridge vent'] },
  { label: 'Debris Removal / Dumpster', reason: 'Tear-off debris disposal', keywords: ['dumpster', 'debris', 'haul', 'disposal'] },
  { label: 'Permit', reason: 'Most jurisdictions require permits', keywords: ['permit'] },
];

function text(value) {
  return String(value || '').toLowerCase();
}

function lineItemText(lineItems) {
  return (Array.isArray(lineItems) ? lineItems : [])
    .map(item => `${item?.description || ''} ${item?.code || ''} ${item?.trade || ''}`)
    .join(' ');
}

function metadataText({ estimate = /** @type {any} */ ({}), formData = /** @type {any} */ ({}) } = {}) {
  return [
    estimate?.job_type,
    estimate?.trade,
    estimate?.category,
    estimate?.project_type,
    estimate?.work_type,
    formData?.category,
    formData?.trade,
    formData?.project_type,
  ].map(text).join(' ');
}

function includesAny(value, terms) {
  return terms.some(term => value.includes(term));
}

export function inferEstimateTrade({ lineItems = [], estimate = {}, formData = {} } = {}) {
  const itemText = text(lineItemText(lineItems));
  const metaText = metadataText({ estimate, formData });
  const sidingInMeta = includesAny(metaText, SIDING_SCOPE_TERMS);
  const roofingInMeta = includesAny(metaText, ROOFING_SCOPE_TERMS);
  const sidingInItems = includesAny(itemText, SIDING_SCOPE_TERMS);
  const roofingInItems = includesAny(itemText, ROOFING_SCOPE_TERMS);

  // Explicit siding metadata wins unless the same estimate is clearly a
  // mixed/roofing scope. This handles job_type = "siding" even when the first
  // few line items are still being entered.
  if (sidingInMeta && !roofingInMeta) return 'siding';
  if (sidingInItems && !roofingInItems) return 'siding';
  if (roofingInMeta || roofingInItems) return 'roofing';
  return 'general';
}

export function getMissingEstimateItems({ lineItems = [], estimate = {}, formData = {} } = {}) {
  const scope = inferEstimateTrade({ lineItems, estimate, formData });
  const combined = text(lineItemText(lineItems));
  const checks = scope === 'siding' ? SIDING_CHECKS : scope === 'roofing' ? ROOFING_CHECKS : [];
  const items = checks.filter(check => !check.keywords.some(keyword => combined.includes(keyword)));
  return { scope, items };
}

export { SIDING_CHECKS, ROOFING_CHECKS };
