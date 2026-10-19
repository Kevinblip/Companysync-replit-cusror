import { smartDescriptionMatch, textIncludesExclusion } from '@/lib/priceListUtils';
import { buildMeasuredTrimLines, pickLineItem, trackPriceSource } from '@/lib/lineItemPicker';
import { findSidingCatalogItem, findSidingScopeCatalogItem } from '@/lib/sidingCatalogPricing';

const shingleSearch = {
  codes: ['LAMINATED_COMP_SH', 'ARCH_COMP_SH', 'RFG SSSQ', '3_TAB__25_YR'],
  keywords: ['composition shingle roofing', 'comp shingle roofing', 'architectural asphalt', 'laminate'],
  exclude: ['wood', 'tile', 'metal', 'remove', 'per shingle', 'per shgl', 'felt', 'ridge', 'hip', 'starter', 'valley'],
};
const shingleFallback = { price: 273, unit: 'SQ', code: 'LAMINATED_COMP_SH', description: 'Laminate - comp. shingle roofing - per SQ' };

const underlaymentSearch = {
  codes: ['ROOFING_FELT', 'ROOFING_FELT_SYNTH', 'RFG UL'],
  keywords: ['roofing felt', 'synthetic underlayment', 'felt - synthetic', 'felt - 30', 'felt - 15', 'underlayment'],
  exclude: ['vertical', 'units', 'ice', 'water', 'barrier', 'remove'],
};
const underlaymentFallback = {
  price: 45.48, unit: 'SQ', code: 'ROOFING_FELT', description: 'Roofing felt - synthetic underlayment - Standard grade',
};

const feltShingle = {
  code: '3TAB',
  description: '3 tab - 25 yr. - composition shingle roofing - incl. felt',
  unit: 'SQ',
  price: 312.3,
  is_favorite: true,
};
const withoutFelt = {
  code: '2709',
  description: 'Laminated - comp. shingle rfg. - w/out felt',
  unit: 'SQ',
  price: 280,
};
const catalogFelt = {
  code: 'RFG UL',
  description: 'Roofing Felt - 30 lb organic underlayment',
  unit: 'SQ',
  price: 38,
  source: 'Symbility',
};

describe('textIncludesExclusion', () => {
  it('does not treat w/out, without, or w/o felt as felt', () => {
    expect(textIncludesExclusion('Laminated - comp. shingle rfg. - w/out felt', 'felt')).toBe(false);
    expect(textIncludesExclusion('Laminated shingle without felt', 'felt')).toBe(false);
    expect(textIncludesExclusion('Laminated shingle w/o felt', 'felt')).toBe(false);
  });

  it('still treats incl. felt as felt', () => {
    expect(textIncludesExclusion(feltShingle.description, 'felt')).toBe(true);
    expect(textIncludesExclusion('Roofing felt - synthetic underlayment', 'felt')).toBe(true);
  });
});

describe('pickLineItem', () => {
  it('uses favourites, then custom items, then the catalog, then the default', () => {
    const favourite = { ...catalogFelt, code: 'FAV', price: 30, is_favorite: true, source: 'Custom' };
    const custom = { ...catalogFelt, code: 'CUS', price: 20, source: 'Custom' };
    const catalog = { ...catalogFelt, code: 'CAT', price: 10, source: 'Symbility' };
    const picked = pickLineItem([catalog, custom, favourite], underlaymentSearch, underlaymentFallback);
    expect(picked.code).toBe('FAV');
    expect(picked.price_source).toBe('favourite');

    const customFirst = pickLineItem([catalog, custom], underlaymentSearch, underlaymentFallback);
    expect(customFirst.code).toBe('CUS');
    expect(customFirst.price_source).toBe('custom');

    const catalogOnly = pickLineItem([catalog], underlaymentSearch, underlaymentFallback);
    expect(catalogOnly.code).toBe('CAT');
    expect(catalogOnly.price_source).toBe('catalog');

    const fallback = pickLineItem([], underlaymentSearch, underlaymentFallback);
    expect(fallback.code).toBe('ROOFING_FELT');
    expect(fallback.price).toBe(45.48);
    expect(fallback.price_source).toBe('default');
  });

  it('does not bill a favourite shingle as underlayment, even through the loose name match', () => {
    const onlyFavourite = pickLineItem([feltShingle], underlaymentSearch, underlaymentFallback);
    expect(onlyFavourite.code).toBe('ROOFING_FELT');
    expect(onlyFavourite.price).toBe(45.48);
    expect(onlyFavourite.price_source).toBe('default');

    const withCatalog = pickLineItem([feltShingle, catalogFelt], underlaymentSearch, underlaymentFallback);
    expect(withCatalog.code).toBe('RFG UL');
    expect(withCatalog.price).toBe(38);
    expect(withCatalog.price_source).toBe('catalog');
  });

  it('can choose laminated shingles described as w/out felt and still rejects incl. felt', () => {
    const chosen = pickLineItem([feltShingle, withoutFelt], shingleSearch, shingleFallback);
    expect(chosen.code).toBe('2709');
    expect(chosen.price_source).toBe('catalog');

    const blocked = pickLineItem([feltShingle], shingleSearch, shingleFallback);
    expect(blocked.price_source).toBe('default');
    expect(blocked.code).toBe('LAMINATED_COMP_SH');
  });

  it('applies exclusions to the loose fallback and continues to the next tier', () => {
    const realFelt = { ...catalogFelt, description: 'Synthetic underlayment' };
    const picked = pickLineItem([feltShingle, realFelt], {
      codes: [],
      keywords: [],
      exclude: [],
    }, underlaymentFallback);
    expect(picked.code).toBe('RFG UL');
    expect(picked.price).toBe(38);
    expect(picked.price_source).toBe('catalog');
  });

  it('lets a siding labor minimum through the labor-minimum guard', () => {
    const minimum = {
      code: 'SID MIN',
      description: 'Siding labor minimum',
      unit: 'EA',
      price: 150,
      source: 'Custom',
      is_custom: true,
    };
    const roofMinimum = {
      code: 'RFG MIN',
      description: 'Roofing labor minimum',
      unit: 'EA',
      price: 90,
    };
    const picked = pickLineItem([roofMinimum, minimum], {
      codes: ['SID MIN', 'SIDLM', 'LABMIN'],
      keywords: ['siding labor minimum', 'siding minimum charge', 'minimum charge'],
      exclude: ['roof', 'roofing', 'shingle'],
    }, { price: 0, unit: 'EA', code: 'SID MIN', description: 'Siding labor minimum' });
    expect(picked.code).toBe('SID MIN');
    expect(picked.price_source).toBe('custom');
  });
});

describe('smartDescriptionMatch felt exclusion', () => {
  it('can return code 2709 and does not return an incl. felt shingle for a 3 tab search', () => {
    expect(smartDescriptionMatch('3 tab', [withoutFelt])?.code).toBe('2709');
    expect(smartDescriptionMatch('3 tab', [feltShingle])).toBeNull();
  });
});

describe('siding matcher favourites', () => {
  const plain = { code: 'SID-V', description: 'Vinyl siding, standard', unit: 'SQ', price: 400 };
  const favourite = { code: 'SID-FAV', description: 'Vinyl siding, standard grade', unit: 'SQ', price: 510, is_favorite: true };

  it('prefers a favourite after an exact existing code', () => {
    expect(findSidingCatalogItem([plain, favourite], 'siding', 'vinyl', 'SQ').code).toBe('SID-FAV');
    expect(findSidingCatalogItem([plain, favourite], 'siding', 'vinyl', 'SQ', { preferredCode: 'SID-V' }).code).toBe('SID-V');
  });

  it('prefers a favourite soffit and tags the price source', () => {
    const match = findSidingScopeCatalogItem([
      { code: 'S1', description: 'Vinyl soffit, vented', unit: 'SF', price: 3 },
      { code: 'S2', description: 'Vinyl soffit, solid', unit: 'SF', price: 4, is_favorite: true },
    ], { codes: ['S1'] }, { description: 'Soffit', unit: 'SF', code: '', price: 0 }, 'vinyl');
    expect(match.code).toBe('S2');
    expect(match.price_source).toBe('favourite');
  });

  it('tags a miss as the default rate', () => {
    const miss = findSidingScopeCatalogItem([], { codes: ['SID NAIL'] }, {
      description: 'Nails, 25-lb box (siding)', unit: 'EA', code: 'SID NAIL', price: 45,
    }, 'vinyl');
    expect(miss.code).toBe('');
    expect(miss.price).toBe(0);
    expect(miss.price_source).toBe('default');
  });
});

describe('measured trim lines', () => {
  it('adds soffit, fascia, and downspouts only when those quantities were measured', () => {
    const none = buildMeasuredTrimLines({}, [], { soffit: true, fascia: true, downspouts: true, sidingMinimum: true });
    expect(none).toEqual([]);

    const lines = buildMeasuredTrimLines({
      soffit_sqft: 120,
      fascia_lf: 80,
      downspout_count: 4,
    }, [], { soffit: true, fascia: true, downspouts: true });
    expect(lines.map(line => [line.description, line.quantity, line.unit, line.rate, line.price_source])).toEqual([
      ['Soffit', 120, 'SF', 3.5, 'default'],
      ['Fascia', 80, 'LF', 3.75, 'default'],
      ['Downspout', 4, 'EA', 45, 'default'],
    ]);
    expect(lines.every(line => line.catalog_exempt)).toBe(true);
  });

  it('bills downspout length when no each-count was measured', () => {
    const [line] = buildMeasuredTrimLines({ downspout_lf: 36 }, [], { downspouts: true });
    expect(line.quantity).toBe(36);
    expect(line.unit).toBe('LF');
    expect(line.rate).toBe(8);
    expect(line.price_source).toBe('default');
  });

  it('adds a siding minimum only when a priced catalog item exists', () => {
    const missing = buildMeasuredTrimLines({}, [], { sidingMinimum: true });
    expect(missing).toEqual([]);

    const priced = buildMeasuredTrimLines({}, [{
      code: 'LABMIN', description: 'Siding labor minimum', unit: 'EA', price: 175, is_favorite: true,
    }], { sidingMinimum: true });
    expect(priced).toHaveLength(1);
    expect(priced[0].code).toBe('LABMIN');
    expect(priced[0].quantity).toBe(1);
    expect(priced[0].rate).toBe(175);
    expect(priced[0].price_source).toBe('favourite');
    expect(priced[0].catalog_exempt).toBeUndefined();
  });
});

describe('trackPriceSource', () => {
  it('tags the next line and leaves section headers alone', () => {
    const items = [];
    const note = trackPriceSource(items);
    note({ price_source: 'catalog' });
    items.push({ code: 'RFG UL', description: 'Roofing felt', quantity: 10, unit: 'SQ' });
    items.push({ code: '', description: '━━━ HOUSE ━━━', quantity: 0, unit: '' });
    note({ price_source: 'default' });
    items.push({ code: 'SOFFIT', description: 'Soffit', quantity: 12, unit: 'SF', price_source: 'favourite' });
    expect(items.map(item => item.price_source)).toEqual(['catalog', undefined, 'favourite']);
  });
});
