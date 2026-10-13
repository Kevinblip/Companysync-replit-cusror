// Material-specific siding lines must be priced from the selected company's
// catalog. Never use a vinyl code or an estimated industry rate for aluminum.
const aluminum = /\balum(?:inum|inium)?\b|\balu\b/i;
const vinyl = /\bvinyl\b|\bvnl\b/i;
const removalOnly = item => ['-', 'remove', 'removal'].includes(String(item.activity || '').trim().toLowerCase());
const combinedActivity = item => ['&', 'r&r', 'remove & replace'].includes(String(item.activity || '').trim().toLowerCase())
  || /^\s*(?:r\s*&\s*r\b|remove\s*(?:&|and)\s*replace\b)/i.test(String(item.description || ''));
const scopeDescription = value => String(value || '').replace(/^\s*(?:r\s*&\s*r\b|remove\s*(?:&|and)\s*replace\b)\s*/i, '').trim();
const jChannel = /\bj[\s-]?(?:channel|trim|mould(?:ing)?|mold(?:ing)?)\b/i;

export function sidingMaterial(value) {
  const text = String(value || '').toLowerCase();
  if (aluminum.test(text) && vinyl.test(text)) return null;
  if (aluminum.test(text)) return 'aluminum';
  if (vinyl.test(text)) return 'vinyl';
  return null;
}

function roleForLine(item) {
  const desc = scopeDescription(item.description).toLowerCase();
  if (/\b(remove|removal|tear.?off|detach|r&r|disposal|haul)\b/.test(desc)) return null;
  if (jChannel.test(desc)) return 'j-channel';
  if (/\binside corner\b/.test(desc)) return 'inside corner';
  if (/\boutside corner\b/.test(desc)) return 'outside corner';
  if (/\bstarter strips?\b/.test(desc) && !/\broof|shingle\b/.test(desc)) return 'starter strip';
  if (/\bsiding\b/.test(desc) && !/\bnail|wrap|paint|caulk|labor\b/.test(desc)) return 'siding';
  if (/\btrim\b/.test(desc) && (vinyl.test(desc) || aluminum.test(desc))) return 'trim';
  return null;
}

export function compatibleQuantity(quantity, oldUnit, newUnit) {
  const old = String(oldUnit || '').toUpperCase();
  const next = String(newUnit || '').toUpperCase();
  if (!old || old === next) return quantity;
  if (old === 'SQ' && next === 'SF') return quantity * 100;
  if (old === 'SF' && next === 'SQ') return quantity / 100;
  return null; // Never silently treat LF as EA (or SQ as EA).
}

function matchesRole(description, role) {
  const d = scopeDescription(description).toLowerCase();
  if (/\b(remove|removal|tear.?off|detach|r&r|disposal|haul)\b/.test(d)) return false;
  if (role === 'siding') return /\bsiding\b/.test(d) && !/\bnail|wrap|paint|caulk|labor|trim|corner|soffit|fascia|starter|channel\b/.test(d);
  if (role === 'j-channel') return jChannel.test(d);
  if (role === 'inside corner') return /\binside corner\b/.test(d);
  if (role === 'outside corner') return /\boutside corner\b/.test(d);
  if (role === 'starter strip') return /\bstarter strips?\b/.test(d) && !/\broof|shingle\b/.test(d);
  if (role === 'trim') return /\btrim\b/.test(d) && !/\broof|shingle\b/.test(d);
  return false;
}

export function findSidingCatalogItem(priceList, role, material, existingUnit, options = {}) {
  if (!material || !role) return null;
  const variant = /\bhigh grade|premium|specialty|insulated|seamless|board\s*&\s*batten|independent|per ind\.|mobile home\b/i;
  const requestedVariant = String(options.requestedDescription || '').match(variant)?.[0]?.toLowerCase();
  const candidates = (priceList || []).filter(p => {
    const desc = String(p.description || '');
    const code = String(p.code || '');
    const amount = Number(p.price);
    if (!code.trim() || p.is_active === false || removalOnly(p) || (!options.allowCombined && combinedActivity(p)) || (options.requireCombined && !combinedActivity(p)) || !Number.isFinite(amount) || amount <= 0 || !matchesRole(desc, role)) return false;
    if (compatibleQuantity(1, existingUnit, p.unit || existingUnit) == null) return false;
    const isAluminum = aluminum.test(desc) || /(?:^|[-_ ])(?:ALU|ALUM)(?:$|[-_ ])/i.test(code);
    const isVinyl = vinyl.test(desc) || /(?:^|[-_ ])(?:VNL|VINYL|VS)(?:$|[-_ ])/i.test(code);
    // A base-material request is not evidence for insulated/premium siding.
    if (code !== options.preferredCode) {
      const candidateVariant = desc.match(variant)?.[0]?.toLowerCase();
      if ((requestedVariant || candidateVariant) && requestedVariant !== candidateVariant) return false;
    }
    return material === 'aluminum' ? isAluminum && !isVinyl : isVinyl && !isAluminum;
  });
  // Honor the existing product/grade when valid. Otherwise prefer a separate
  // install scope, then the base product rather than a premium/special variant.
  return candidates.sort((a, b) => {
    const exact = Number(b.code === options.preferredCode) - Number(a.code === options.preferredCode);
    if (exact) return exact;
    const activity = Number(combinedActivity(a)) - Number(combinedActivity(b));
    if (activity) return activity;
    const variantScore = Number(variant.test(a.description || '')) - Number(variant.test(b.description || ''));
    if (variantScore) return variantScore;
    const pattern = material === 'aluminum' ? aluminum : vinyl;
    return Number(pattern.test(b.description || '')) - Number(pattern.test(a.description || ''));
  })[0] || null;
}

// Match the trade AND scope even when a code happens to match. Generic "nail"
// searches must never select hip/ridge fasteners or other roofing products.
const roofingProduct = /\broof(?:ing)?|shingle|hip|ridge|rake|eave|underlayment\b/i;
const removalActivity = /\bremove|removal|tear.?off|detach|disposal|haul\b/i;
const normalizedCode = value => String(value || '').toUpperCase().replace(/[\s_-]+/g, '');

function matchesSidingScope(description, requested) {
  const d = scopeDescription(description).toLowerCase();
  const r = String(requested || '').toLowerCase();
  if (roofingProduct.test(d)) return false;
  if (/\bsiding\b/.test(r) && removalActivity.test(r)) return /\bsiding\b/.test(d) && removalActivity.test(d);
  if (/debris|haul/.test(r)) return /debris|haul|dumpster/.test(d);
  if (removalActivity.test(d) || /\br&r\b/i.test(d)) return false;
  if (/\bnails?\b/.test(r)) return /\b(siding|exterior)\b/.test(d) && /\bnails?|fasteners?\b/.test(d);
  if (/house.?wrap|weather barrier/.test(r)) return /house.?wrap|weather.?resist|weather barrier|\bwrb\b/.test(d);
  if (/caulk/.test(r)) return /\bcaulk|sealant\b/.test(d);
  if (/electrical box/.test(r)) return /\b(electrical|light) box\b/.test(d) && /exten/.test(d);
  if (/water spigot|hose/.test(r)) return /hose.?bib|water.?spigot|water.?bib/.test(d);
  if (/water table/.test(r)) return /water table|utility trim/.test(d);
  const role = roleForLine({ description: requested });
  return role ? matchesRole(d, role) : false;
}

export function findSidingScopeCatalogItem(priceList, searchTerms, requested, material) {
  const role = roleForLine({ description: requested.description });
  const materialLine = ['siding', 'j-channel', 'inside corner', 'outside corner', 'starter strip', 'trim'].includes(role);
  let match;
  if (materialLine) {
    match = findSidingCatalogItem(priceList, role, material, requested.unit, {
      allowCombined: true, requireCombined: combinedActivity(requested), preferredCode: requested.code, requestedDescription: requested.description,
    });
  } else {
    const candidates = (priceList || []).filter(item =>
      String(item.code || '').trim() && item.is_active !== false &&
      (!combinedActivity(item) || !removalActivity.test(requested.description || '')) &&
      (!removalOnly(item) || /remove.*siding/i.test(requested.description)) &&
      Number.isFinite(Number(item.price)) && Number(item.price) > 0 &&
      compatibleQuantity(1, requested.unit, item.unit) != null &&
      matchesSidingScope(item.description, requested.description) &&
      !(searchTerms.exclude || []).some(word => String(item.description || '').toLowerCase().includes(word.toLowerCase()))
    );
    const separate = candidates.filter(item => !combinedActivity(item));
    const eligible = separate.length ? separate : candidates;
    match = eligible.find(item => (searchTerms.codes || []).some(code => normalizedCode(code) === normalizedCode(item.code))) || eligible[0];
  }
  if (!match) return { ...requested, code: '', price: 0 };
  // Generation initially uses canonical takeoff units. Convert the rate here;
  // finalization below switches the displayed quantity/unit to the catalog's.
  return { ...match, price: Number(match.price) * compatibleQuantity(1, requested.unit, match.unit) };
}

export function finalizeSidingCatalogLines(lines, material, priceList) {
  const repriced = repriceSidingMaterialLines(lines, material, priceList);
  let combinedArea = repriced.items.reduce((area, item) => {
    const combined = roleForLine(item) === 'siding' && Number(item.rate) > 0
      && (priceList || []).some(p => p.code && p.code === item.code && p.is_active !== false
        && Number(p.price) > 0 && combinedActivity(p)
        && String(item.description || '').startsWith(String(p.description || '')));
    return area + (combined ? compatibleQuantity(Number(item.quantity), item.unit, 'SF') || 0 : 0);
  }, 0);
  // A combined siding R&R catalog rate includes the base removal. Retain
  // explicitly scoped extra-layer charges, but never bill base removal twice.
  const pricedLines = repriced.items.flatMap(item => {
    const baseRemoval = /\bsiding\b/i.test(item.description || '')
      && (removalOnly(item) || removalActivity.test(item.description || ''))
      && !combinedActivity(item) && !/\badditional|extra|second|layers?\b/i.test(item.description || '');
    const removalArea = baseRemoval ? compatibleQuantity(Number(item.quantity), item.unit, 'SF') : null;
    if (!combinedArea || removalArea == null || removalArea <= 0) return [item];
    const covered = Math.min(removalArea, combinedArea);
    combinedArea -= covered;
    const remainingArea = removalArea - covered;
    return remainingArea < 1e-8 ? [] : [{
      ...item, quantity: compatibleQuantity(remainingArea, 'SF', item.unit),
    }];
  });
  const missing = [...repriced.missing];
  const items = pricedLines.map(item => {
    const catalog = (priceList || []).find(p =>
      item.code && p.code === item.code && p.is_active !== false &&
      Number(p.price) > 0 && compatibleQuantity(1, item.unit, p.unit) != null &&
      String(item.description || '').startsWith(String(p.description || ''))
    );
    if (!catalog) {
      missing.push(item.description);
      return {
        ...item, code: '', rate: 0, rcv: 0, amount: 0, acv: 0,
        description: item.description.includes('price needed') ? item.description : `${item.description} — price needed`,
        pricing_review_required: true, pricing_scope: 'siding',
      };
    }
    const quantity = compatibleQuantity(Number(item.quantity), item.unit, catalog.unit);
    const rcv = Math.round(quantity * Number(catalog.price) * 100) / 100;
    return {
      ...item, quantity, unit: catalog.unit, rate: Number(catalog.price), rcv, amount: rcv,
      acv: Math.round(rcv * (1 - (Number(item.depreciation_percent) || 0) / 100) * 100) / 100,
      activity: catalog.activity ?? item.activity,
      pricing_review_required: false, pricing_scope: 'siding',
    };
  });
  return { items, missing: [...new Set(missing)] };
}

export function sidingPricingIssues(lines) {
  return (lines || []).filter(item =>
    /unconfirmed material|price needed/i.test(String(item.description || '')) ||
    (item.pricing_review_required && (!String(item.code || '').trim() || !(Number(item.rate) > 0)))
  );
}

// Explicit draft action only: leave roof items, user-added unrelated scopes,
// and the saved estimate untouched. The temporary index never leaves here.
export function repriceSidingCatalogDraft(lines, material, priceList) {
  const scoped = lines.flatMap((item, index) => {
    if (item.pricing_scope !== 'siding') return [];
    const indexed = { ...item, _sidingDraftIndex: index };
    if (roleForLine(item)) return [indexed];
    const match = findSidingScopeCatalogItem(priceList, { codes: [item.code] }, item, material);
    return [match.code ? {
      ...indexed, code: match.code, description: match.description,
      rate: match.price, activity: match.activity || (combinedActivity(match) ? '&' : item.activity),
    } : indexed];
  });
  if (!scoped.length) return { items: lines, missing: [], changed: false };
  const result = finalizeSidingCatalogLines(scoped, material, priceList);
  const replacements = new Map(result.items.map(item => [item._sidingDraftIndex, item]));
  return {
    missing: result.missing, changed: true,
    items: lines.flatMap((item, index) => {
      if (item.pricing_scope !== 'siding') return [item];
      const replacement = replacements.get(index);
      if (!replacement) return []; // removal covered by combined R&R
      const { _sidingDraftIndex, ...priced } = replacement;
      return [priced];
    }),
  };
}

export function repriceSidingMaterialLines(lines, requestedMaterial, priceList) {
  const material = sidingMaterial(requestedMaterial);
  const missing = material ? [] : ['siding material (specify vinyl or aluminum)'];
  let changed = 0;
  const items = lines.map(item => {
    const role = roleForLine(item);
    if (!role) return item; // removal, wrap, labor, fascia, etc. keep their own scopes/prices
    changed++;
    const found = findSidingCatalogItem(priceList, role, material, item.unit, {
      allowCombined: true, requireCombined: combinedActivity(item), preferredCode: item.code, requestedDescription: item.description,
    });
    const suffix = role === 'j-channel'
      ? (String(item.description).match(/\s*\((?:Top|Bottom|rough openings|windows & doors)\)$/i)?.[0] || '')
      : role === 'starter strip'
        ? (String(item.description).match(/\s*—.*$/)?.[0] || '')
        : '';
    if (!found) {
      if (material) missing.push(`${material} ${role} (${item.unit || 'EA'})`);
      return {
        ...item, code: '', description: `${material || 'Unconfirmed material'} ${role} — price needed${suffix}`,
        rate: 0, rcv: 0, acv: 0, amount: 0,
      };
    }
    const unit = found.unit || item.unit;
    const quantity = compatibleQuantity(Number(item.quantity) || 0, item.unit, unit);
    const rate = Number(found.price);
    const rcv = Math.round(quantity * rate * 100) / 100;
    const dep = Number(item.depreciation_percent) || 0;
    return {
      ...item, code: found.code || '', description: `${found.description}${suffix}`,
      quantity, unit, rate, rcv, amount: rcv,
      activity: found.activity || (combinedActivity(found) ? '&' : item.activity),
      acv: Math.round(rcv * (1 - dep / 100) * 100) / 100,
    };
  });
  return { items, changed, missing: [...new Set(missing)] };
}

export function isAmbiguousSideAreaRequest(text) {
  return /\b\d[\d,]*(?:\.\d+)?\s*(?:sq(?:uare)?(?:\s*(?:ft|feet|foot))?|sf|squares?)\s*(?:a|per|each)\s+(?:side|wall|elevation)\b/i.test(text);
}