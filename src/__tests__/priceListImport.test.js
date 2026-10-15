import { describe, it, expect } from 'vitest';
import {
  guessPriceCategory,
  isEstimateChrome,
  preparePriceListRows,
  uniqueItemCode,
} from '@/lib/priceListImport';

describe('price list import cleanup', () => {
  it('drops estimate page headers and footers', () => {
    const header = 'Highland Heights, Ohio 44143 Claim 123456 Page 60 of 243 07/29/2026 ESTIMATE: Structure (Your Insurance Claims Network, LLC)';
    expect(isEstimateChrome(header)).toBe(true);
    const { items, skipped } = preparePriceListRows([
      { name: header, sku: 'HIGHLAND_HEIGHTS_OHI', price: 1, category: 'Roofing' },
      { description: 'Includes 5% waste on quantity.', price: 1 },
      { description: 'Reset - Cabinet, Drawer Front, Excellent', sku: '2857_RESET_CABINET_D', price: 15.25, unit: 'EA' },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toMatch(/Cabinet, Drawer Front/);
    expect(skipped.map((row) => row.reason)).toContain('Page header or footer');
  });

  it('tags cabinets as interior even when the description mentions a door', () => {
    expect(guessPriceCategory('Reset - Cabinet, Base, Island 48", 2 Door, 2 Sides')).toBe('Interior');
    expect(guessPriceCategory('Remove - End Panel, Full Height Cabinet, Elite')).toBe('Interior');
    expect(guessPriceCategory('Laminated comp shingle')).toBe('Roofing');
    expect(guessPriceCategory('Vinyl siding, double 4')).toBe('Siding');
  });

  it('does not collapse different items onto one 20-character SKU', () => {
    const used = new Set();
    const a = uniqueItemCode({
      code: '2857_RESET_CABINET_D',
      description: 'Reset - Cabinet, Drawer Front, Excellent',
    }, used);
    const b = uniqueItemCode({
      code: '2858_RESET_CABINET_D',
      description: 'Reset - Cabinet, Door Front, Excellent',
    }, used);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
    expect(b.length).toBeGreaterThan(20);
    expect(a.startsWith('2857_')).toBe(true);
    expect(b.startsWith('2858_')).toBe(true);

    const { items } = preparePriceListRows([
      { description: 'Reset - Cabinet, Drawer Front, Excellent', sku: '2857_RESET_CABINET_D', price: 15 },
      { description: 'Reset - Cabinet, Door Front, Excellent', sku: '2858_RESET_CABINET_D', price: 16 },
      { description: 'Reset - Cabinet, Drawer Front, Excellent', sku: '2857_RESET_CABINET_D', price: 15 },
    ]);
    const codes = items.map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(items.every((item) => item.category === 'Interior')).toBe(true);
  });
});
