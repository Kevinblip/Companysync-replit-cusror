import {
  matchesPriceListSearch,
  normalizePriceListSearchText,
} from '@/lib/priceListUtils';

describe('price-list search normalization', () => {
  const symbilityItem = {
    code: '3067_TEAR_OUT_J_CHAN',
    description: 'Tear Out - J-Channel Trim, Vinyl, Non-Insulated',
  };

  it('treats spaces, underscores, and hyphens as equivalent separators', () => {
    expect(normalizePriceListSearchText('J channel')).toBe('jchannel');
    expect(matchesPriceListSearch(symbilityItem, 'j channel')).toBe(true);
    expect(matchesPriceListSearch(symbilityItem, 'J_CHANNEL')).toBe(true);
    expect(matchesPriceListSearch(symbilityItem, 'j-channel')).toBe(true);
    // The price-list page must also support a partial search, such as the
    // "j ch" query used when browsing all J-channel options.
    expect(matchesPriceListSearch(symbilityItem, 'j ch')).toBe(true);
  });

  it('still matches ordinary description searches', () => {
    expect(matchesPriceListSearch(symbilityItem, 'tear out')).toBe(true);
    expect(matchesPriceListSearch(symbilityItem, 'vinyl non insulated')).toBe(true);
  });

  it('does not return unrelated items', () => {
    expect(matchesPriceListSearch(symbilityItem, 'gutter')).toBe(false);
  });

  it('handles blank and legacy sku/name fields', () => {
    expect(matchesPriceListSearch(symbilityItem, '')).toBe(true);
    expect(matchesPriceListSearch({ sku: 'J_CHANNEL', name: 'J channel' }, 'j channel')).toBe(true);
    expect(matchesPriceListSearch(null, 'j channel')).toBe(false);
  });
});