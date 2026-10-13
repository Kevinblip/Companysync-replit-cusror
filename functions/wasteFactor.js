/**
 * Material waste suggestions for the AI Estimator.
 *
 * One applied percent per trade drives Order Qty on the summary card and every
 * affected line item. Suggestions never drop below the trade's standard base.
 * A rep can set any percent manually, including below that base.
 *
 * Tune the RULES objects below. Callers should not hardcode percents.
 *
 * Roof (standard base 10% — a simple gable):
 *   suggested = clamp(base + hip + hip/valley density + facets + dormers
 *                     + cut-up + pitch, min, max)
 *   Only those factors add waste. A simple gable with none of them stays at 10%.
 *
 *   Worked example (weights below): hip roof (+2), 9 facets (+2), 140 LF of
 *   hips/valleys on a large enough roof that density does not add → 14%.
 *   Reason: "Hip roof, 9 facets, 140 LF hips/valleys -> 14%".
 *   Simple gable: "Simple gable -> 10% (standard)".
 *
 * Siding and other trades (their own 10% base):
 *   suggested = clamp(base + openings + corners + gables, min, max)
 *   Openings use the higher of the deduction-% tier and the opening-count tier,
 *   not both. Gables and corners stack with that.
 */

export const ROOF_WASTE_RULES = {
  basePercent: 10,
  minSuggestedPercent: 10,
  maxSuggestedPercent: 25,
  hipRoofAdd: 2,
  // (hip LF + valley LF) per 100 sqft of roof. Highest matching tier wins.
  hipValleyDensity: [
    { minLfPer100Sqft: 4, add: 1 },
    { minLfPer100Sqft: 7, add: 2 },
    { minLfPer100Sqft: 10, add: 3 },
  ],
  // Highest matching tier wins. A simple gable is 2 facets and adds nothing.
  facets: [
    { min: 5, add: 1 },
    { min: 8, add: 2 },
    { min: 12, add: 3 },
  ],
  perDormerAdd: 1,
  maxDormerAdd: 2,
  perCutUpAdd: 1,
  maxCutUpAdd: 2,
  // Highest matching pitch tier wins. Under 8/12 adds nothing.
  pitch: [
    { min: 8, add: 1 },
    { min: 10, add: 2 },
    { min: 12, add: 3 },
  ],
};

export const SIDING_WASTE_RULES = {
  basePercent: 10,
  minSuggestedPercent: 10,
  maxSuggestedPercent: 20,
  // Highest matching tier. Compared with openingCount; the larger add is used.
  openings: [
    { minPct: 18, add: 1 },
    { minPct: 25, add: 2 },
  ],
  openingCount: [
    { min: 12, add: 1 },
    { min: 20, add: 2 },
  ],
  corners: [
    { min: 6, add: 1 },
    { min: 10, add: 2 },
  ],
  // Any measured gable area adds anyAdd. A heavy gable-to-wall ratio uses heavyAdd instead.
  gable: { anyAdd: 1, heavyRatio: 0.2, heavyAdd: 2 },
};

export const WASTE_PRESETS = [10, 12, 15, 17, 20];

export const WASTE_DROPDOWN = [0, 5, 8, 10, 12, 14, 15, 17, 18, 20, 25];

const ROOF_WASTE_CODE_KEYS = [
  'LAMINATEDCOMPSH',
  'ROOFINGFELT',
  'RFGSSSQ',
  'RFGUL',
  'RFGSTR',
  'RFGRDC',
  'RFGHP',
];

function num(value) {
  if (value == null || value === '') return 0;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function firstPositive(...values) {
  for (const value of values) {
    const n = num(value);
    if (n > 0) return n;
  }
  return 0;
}

function highestTierAdd(tiers, value) {
  let add = 0;
  for (const tier of tiers) {
    const min = tier.minLfPer100Sqft ?? tier.minPct ?? tier.min ?? 0;
    if (value >= min) add = tier.add;
  }
  return add;
}

function clampPercent(value, rules) {
  const rounded = Math.round(value);
  return Math.min(rules.maxSuggestedPercent, Math.max(rules.minSuggestedPercent, rounded));
}

export function parsePitchRise(pitch) {
  if (pitch == null || pitch === '') return 0;
  const text = String(pitch).toLowerCase();
  if (text.includes('flat')) return 0;
  if (text.includes('steep')) return 12;
  const slash = text.match(/(\d+(?:\.\d+)?)\s*\/\s*12/);
  if (slash) return Number(slash[1]);
  const bare = Number(text);
  return Number.isFinite(bare) ? bare : 0;
}

export function orderQuantity(base, wastePercent) {
  const amount = num(base);
  const percent = num(wastePercent);
  return Math.round(amount * (1 + percent / 100) * 100) / 100;
}

function roofAreaSqFt(measurements) {
  const direct = num(measurements.roof_area_sqft) || num(measurements.corrected_area_sqft);
  if (direct > 0) return direct;
  const squares = num(measurements.corrected_area_sq) || num(measurements.roof_area_sq);
  return squares > 0 ? squares * 100 : 0;
}

function facetCount(measurements) {
  const listed = firstPositive(
    measurements.num_segments,
    measurements.facet_count,
    measurements.facets,
    measurements.segment_count,
    measurements.roof_segment_count,
  );
  if (listed > 0) return listed;
  if (Array.isArray(measurements.roof_segments) && measurements.roof_segments.length > 0) {
    return measurements.roof_segments.length;
  }
  return 0;
}

function formatList(parts, percent) {
  return `${parts.join(', ')} -> ${percent}%`;
}

/**
 * Suggested roofing waste from measurement fields.
 * Returns { percent, reason, factors }. percent is never below the roof base.
 */
export function suggestRoofWaste(measurements = {}) {
  const rules = ROOF_WASTE_RULES;
  const type = String(measurements.roof_type || measurements.roofType || '').toLowerCase();
  const hipLf = num(measurements.hip_lf);
  const valleyLf = num(measurements.valley_lf);
  const hipValleyLf = hipLf + valleyLf;
  const isHip = type.includes('hip') || hipLf > 0;
  const facets = facetCount(measurements);
  const dormers = firstPositive(measurements.dormer_count, measurements.dormers, measurements.num_dormers);
  const cutUp = firstPositive(measurements.cut_up_sections, measurements.cutup_count, measurements.cut_up_count);
  const pitchRise = parsePitchRise(measurements.pitch || measurements.predominant_pitch);
  const sqft = roofAreaSqFt(measurements);

  const factors = [];
  let add = 0;

  if (isHip && rules.hipRoofAdd) {
    add += rules.hipRoofAdd;
    factors.push({ key: 'hip', label: 'Hip roof', add: rules.hipRoofAdd });
  }

  let densityAdd = 0;
  if (sqft > 0 && hipValleyLf > 0) {
    const per100 = (hipValleyLf / sqft) * 100;
    densityAdd = highestTierAdd(rules.hipValleyDensity, per100);
    if (densityAdd) {
      add += densityAdd;
      factors.push({
        key: 'hipValleyDensity',
        label: `${Math.round(hipValleyLf)} LF hips/valleys`,
        add: densityAdd,
        lfPer100Sqft: Math.round(per100 * 10) / 10,
      });
    }
  }

  const facetAdd = facets > 0 ? highestTierAdd(rules.facets, facets) : 0;
  if (facetAdd) {
    add += facetAdd;
    factors.push({ key: 'facets', label: `${Math.round(facets)} facets`, add: facetAdd });
  }

  const dormerAdd = Math.min(rules.maxDormerAdd, Math.round(dormers) * rules.perDormerAdd);
  if (dormerAdd) {
    add += dormerAdd;
    const count = Math.round(dormers);
    factors.push({ key: 'dormers', label: `${count} dormer${count === 1 ? '' : 's'}`, add: dormerAdd });
  }

  const cutUpAdd = Math.min(rules.maxCutUpAdd, Math.round(cutUp) * rules.perCutUpAdd);
  if (cutUpAdd) {
    add += cutUpAdd;
    const count = Math.round(cutUp);
    factors.push({ key: 'cutUp', label: `${count} cut-up section${count === 1 ? '' : 's'}`, add: cutUpAdd });
  }

  const pitchAdd = highestTierAdd(rules.pitch, pitchRise);
  if (pitchAdd) {
    add += pitchAdd;
    const label = Number.isInteger(pitchRise) ? `${pitchRise}/12 pitch` : `${pitchRise}/12 pitch`;
    factors.push({ key: 'pitch', label, add: pitchAdd });
  }

  const percent = clampPercent(rules.basePercent + add, rules);
  let reason;
  if (add <= 0) {
    reason = `Simple gable -> ${rules.basePercent}% (standard)`;
  } else {
    const parts = [];
    if (isHip) parts.push('Hip roof');
    if (facetAdd && facets) parts.push(`${Math.round(facets)} facets`);
    if (dormerAdd) parts.push(factors.find((f) => f.key === 'dormers').label);
    if (cutUpAdd) parts.push(factors.find((f) => f.key === 'cutUp').label);
    if (hipValleyLf > 0 && (isHip || densityAdd)) parts.push(`${Math.round(hipValleyLf)} LF hips/valleys`);
    if (pitchAdd) parts.push(factors.find((f) => f.key === 'pitch').label);
    reason = formatList(parts, percent);
  }

  return { percent, reason, factors, trade: 'roof' };
}

function openingCount(measurements) {
  const windows = measurements.windows_count != null
    ? num(measurements.windows_count)
    : num(measurements.estimated_windows);
  const doors = measurements.doors_count != null
    ? num(measurements.doors_count)
    : num(measurements.estimated_doors);
  return windows + doors + num(measurements.garage_door_count);
}

/**
 * Suggested siding (or other-trade) waste from openings, corners, and gables.
 * `options.trade === 'other'` uses the same factors and the same standard base.
 */
export function suggestSidingWaste(measurements = {}, options = {}) {
  const rules = SIDING_WASTE_RULES;
  const trade = options.trade === 'other' ? 'other' : 'siding';
  const openPct = num(measurements.opening_deduction_pct ?? measurements.openingDeductionPct);
  const openings = openingCount(measurements);
  const corners = firstPositive(measurements.outside_corners_count, measurements.outsideCornersCount);
  const gableSqFt = num(measurements.gable_area_sqft);
  const wallSqFt = num(measurements.wall_area_sqft) || num(measurements.gross_wall_area_sqft);

  const factors = [];
  let add = 0;

  const openingPctAdd = highestTierAdd(rules.openings, openPct);
  const openingCountAdd = highestTierAdd(rules.openingCount, openings);
  const openingAdd = Math.max(openingPctAdd, openingCountAdd);
  if (openingAdd) {
    add += openingAdd;
    const label = openingPctAdd >= openingCountAdd && openPct > 0
      ? `${Math.round(openPct)}% openings`
      : `${Math.round(openings)} openings`;
    factors.push({ key: 'openings', label, add: openingAdd });
  }

  const cornerAdd = highestTierAdd(rules.corners, corners);
  if (cornerAdd) {
    add += cornerAdd;
    factors.push({ key: 'corners', label: `${Math.round(corners)} corners`, add: cornerAdd });
  }

  let gableAdd = 0;
  if (gableSqFt > 0) {
    const ratio = wallSqFt > 0 ? gableSqFt / wallSqFt : 0;
    gableAdd = ratio >= rules.gable.heavyRatio ? rules.gable.heavyAdd : rules.gable.anyAdd;
    add += gableAdd;
    factors.push({ key: 'gables', label: 'gables', add: gableAdd });
  }

  const percent = clampPercent(rules.basePercent + add, rules);
  const standardLabel = trade === 'other' ? 'Simple scope' : 'Simple walls';
  const reason = add <= 0
    ? `${standardLabel} -> ${rules.basePercent}% (standard)`
    : formatList(factors.map((factor) => factor.label), percent);

  return { percent, reason, factors, trade };
}

export function suggestTradeWaste(trade, measurements = {}) {
  const key = String(trade || 'roof').toLowerCase();
  if (key === 'roof' || key === 'roofing') return suggestRoofWaste(measurements);
  if (key === 'siding') return suggestSidingWaste(measurements, { trade: 'siding' });
  return suggestSidingWaste(measurements, { trade: 'other' });
}

/**
 * The record stored on an estimate for one trade.
 * `manual.isManual` keeps the rep's percent (any number >= 0) and labels it
 * "Manual override". Otherwise the suggestion is applied.
 */
export function buildWasteRecord(suggestion, manual) {
  const isManual = !!(manual && manual.isManual);
  const applied = isManual ? num(manual.appliedPercent) : suggestion.percent;
  return {
    trade: suggestion.trade,
    suggestedPercent: suggestion.percent,
    suggestedReason: suggestion.reason,
    appliedPercent: applied,
    isManual,
    reason: isManual ? 'Manual override' : suggestion.reason,
    factors: suggestion.factors,
  };
}

export function roofWasteRecord(measurements, manual) {
  return buildWasteRecord(suggestRoofWaste(measurements), manual);
}

export function sidingWasteRecord(measurements, manual) {
  return buildWasteRecord(suggestSidingWaste(measurements), manual);
}

function codeKey(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function descriptionHas(description, needles) {
  return needles.some((needle) => description.includes(needle));
}

/**
 * Roof materials that take the roof waste percent. Each-counted accessories
 * (pipe boots, vents, detach/reset) do not. Siding items marked
 * receives_waste: false stay on their measured quantity.
 */
export function itemReceivesWaste(item, trade) {
  if (!item) return false;
  if (item.receives_waste === false) return false;
  const itemTrade = item.waste_trade || null;
  if (trade && itemTrade && itemTrade !== trade) return false;
  if (item.receives_waste === true) return !trade || !itemTrade || itemTrade === trade;

  const description = String(item.description || '').toLowerCase();
  const unit = String(item.unit || '').toUpperCase();
  const perEach = unit === 'EA'
    || descriptionHas(description, ['chimney', 'pipe boot', 'pipe jack', 'box vent', 'roof vent', 'satellite', 'detach']);
  if (perEach) return false;

  const isSidingDesc = descriptionHas(description, ['vinyl', 'siding', 'j-channel', 'j channel', 'soffit', 'fascia', 'house wrap', 'housewrap', 'weather barrier']);
  const isRoofDesc = descriptionHas(description, [
    'shingle', 'underlayment', 'felt', 'ice & water', 'ice and water', 'starter', 'drip', 'cap', 'valley', 'flashing',
  ]) || ROOF_WASTE_CODE_KEYS.some((key) => codeKey(item.code).includes(key));

  if (trade === 'siding') return isSidingDesc && !descriptionHas(description, ['shingle', 'asphalt', 'roof']);
  if (trade === 'roof') return isRoofDesc && !isSidingDesc;
  return isRoofDesc || isSidingDesc;
}

/**
 * Set quantity from base_quantity × (1 + waste%). The first call stores the
 * current quantity as the base so a later percent replaces waste instead of
 * stacking on top of it.
 */
export function applyWasteToLineItems(items, wastePercent, options = {}) {
  const trade = options.trade || null;
  const percent = num(wastePercent);
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (!itemReceivesWaste(item, trade)) return item;
    const base = item.base_quantity != null && item.base_quantity !== ''
      ? num(item.base_quantity)
      : num(item.quantity);
    const quantity = orderQuantity(base, percent);
    const rate = num(item.rate);
    const rcv = Math.round(quantity * rate * 100) / 100;
    const depreciation = num(item.depreciation_percent);
    const acv = depreciation > 0 ? Math.round(rcv * (1 - depreciation / 100) * 100) / 100 : rcv;
    return {
      ...item,
      base_quantity: Math.round(base * 100) / 100,
      quantity,
      waste_percent: percent,
      waste_trade: item.waste_trade || trade || (itemReceivesWaste(item, 'siding') && !itemReceivesWaste(item, 'roof') ? 'siding' : 'roof'),
      receives_waste: true,
      rcv,
      acv,
      amount: rcv,
    };
  });
}

/**
 * Mark siding wall-area squares with a pre-waste base so a later percent
 * change updates them without compounding. Other siding lines keep measured LF.
 */
export function stampSidingWasteItems(items, measurements, wastePercent) {
  const baseSq = num(measurements.wall_area_sq) || (num(measurements.wall_area_sqft) / 100) || 0;
  const percent = num(wastePercent);
  return (items || []).map((item) => {
    const description = String(item.description || '').toLowerCase();
    const wallMaterial = String(item.unit || '').toUpperCase() === 'SQ'
      && descriptionHas(description, ['siding', 'house wrap', 'housewrap', 'weather barrier', 'building wrap']);
    if (!wallMaterial) {
      return { ...item, waste_trade: 'siding', receives_waste: false };
    }
    return {
      ...item,
      waste_trade: 'siding',
      receives_waste: true,
      base_quantity: Math.round(baseSq * 100) / 100,
      waste_percent: percent,
    };
  });
}
