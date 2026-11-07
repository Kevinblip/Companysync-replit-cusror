import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SECTION_ONLY_TOTAL_PROMPT,
  includeSectionOnlyTotals,
  importedRcvGap,
} from '@/utils/estimateSectionTotals';

const WANDA_ITEMIZED = 11341.75;
const RIGHT = 6106.2;
const REAR = 5572.37;
const LEFT = 5952.35;
const WANDA_GRAND = 28972.67;

describe('carrier section-only totals', () => {
  it('imports Wanda elevation totals that have no item lines and matches the grand RCV', () => {
    const merged = includeSectionOnlyTotals({
      lineItems: [
        { description: 'Front elevation siding', quantity: 12, unit: 'SQ', rate: 500, rcv: 6000 },
        { description: 'Front elevation trim', quantity: 1, unit: 'LS', rate: 5341.75, rcv: 5341.75 },
      ],
      sectionTotals: [
        { name: 'Right Elevation', rcv: RIGHT, item_count: 0 },
        { name: 'Rear', rcv: REAR, item_count: 0 },
        { name: 'Left', rcv: LEFT, item_count: 0 },
        { name: 'Front', rcv: WANDA_ITEMIZED, item_count: 2 },
      ],
    });

    expect(merged.addedSectionLines.map((item) => item.description)).toEqual([
      'Totals: Right Elevation',
      'Totals: Rear',
      'Totals: Left',
    ]);
    expect(merged.addedSectionLines.map((item) => item.rcv)).toEqual([RIGHT, REAR, LEFT]);
    expect(merged.addedSectionLines.every((item) => item.quantity === 1 && item.unit === 'LS')).toBe(true);
    expect(merged.lineItems.some((item) => item.description === 'Totals: Front')).toBe(false);

    const check = importedRcvGap({ lineItems: merged.lineItems, documentRcv: WANDA_GRAND });
    expect(check.importedRcv).toBeCloseTo(WANDA_GRAND, 2);
    expect(check.gap).toBeCloseTo(0, 2);
    expect(check.matches).toBe(true);
    expect(check.warning).toBeNull();
  });

  it('builds the same lines from sections that contain only a total', () => {
    const merged = includeSectionOnlyTotals({
      sections: [
        { name: 'Right Elevation', section_rcv: RIGHT, line_items: [] },
        { name: 'Rear', section_rcv: REAR, line_items: [] },
        { name: 'Left', section_rcv: LEFT, line_items: [] },
        {
          name: 'Front',
          section_rcv: WANDA_ITEMIZED,
          line_items: [
            { description: 'Front elevation siding', quantity: 12, unit: 'SQ', rcv: 6000 },
            { description: 'Front elevation trim', quantity: 1, unit: 'LS', rcv: 5341.75 },
            { description: 'Totals: Front', quantity: 1, unit: 'LS', rcv: WANDA_ITEMIZED },
          ],
        },
      ],
    });

    expect(merged.lineItems.map((item) => item.description)).toEqual([
      'Totals: Right Elevation',
      'Totals: Rear',
      'Totals: Left',
      'Front elevation siding',
      'Front elevation trim',
    ]);
    expect(importedRcvGap({ lineItems: merged.lineItems, documentRcv: WANDA_GRAND }).matches).toBe(true);
  });

  it('flags the Wanda gap when section-only totals are dropped', () => {
    const check = importedRcvGap({
      lineItems: [{ description: 'Itemized rows only', quantity: 1, unit: 'LS', rcv: WANDA_ITEMIZED }],
      documentRcv: WANDA_GRAND,
    });

    expect(check.importedRcv).toBeCloseTo(WANDA_ITEMIZED, 2);
    expect(check.documentRcv).toBeCloseTo(WANDA_GRAND, 2);
    expect(check.gap).toBeCloseTo(WANDA_GRAND - WANDA_ITEMIZED, 2);
    expect(check.matches).toBe(false);
    expect(check.warning).toContain('does not match');
    expect(check.warning).toContain('$11,341.75');
    expect(check.warning).toContain('$28,972.67');
    expect(check.warning).toContain('$17,630.92');
  });

  it('does not add a second copy when the section total is already a line', () => {
    const merged = includeSectionOnlyTotals({
      lineItems: [
        { description: 'Totals: Right Elevation', quantity: 1, unit: 'LS', rcv: RIGHT },
      ],
      sectionTotals: [{ name: 'Right Elevation', rcv: RIGHT, item_count: 0 }],
    });

    expect(merged.lineItems).toHaveLength(1);
    expect(merged.addedSectionLines).toHaveLength(0);
  });

  it('drops a grand Replacement Cost Value row and a subtotal that repeats the work lines', () => {
    const merged = includeSectionOnlyTotals({
      lineItems: [
        { description: 'Shingles', quantity: 10, unit: 'SQ', rcv: 1000 },
        { description: 'Roof - Subtotal', quantity: 1, unit: 'LS', rcv: 1000 },
        { description: 'Replacement Cost Value', quantity: 1, unit: 'LS', rcv: 1000 },
      ],
      sectionTotals: [],
    });

    expect(merged.lineItems.map((item) => item.description)).toEqual(['Shingles']);
  });

  it('tells the extractor to keep section-only totals and the grand RCV', () => {
    expect(SECTION_ONLY_TOTAL_PROMPT).toContain('Totals: Right Elevation');
    expect(SECTION_ONLY_TOTAL_PROMPT).toContain('item_count');
    expect(SECTION_ONLY_TOTAL_PROMPT).toContain('document_rcv_total');

    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../pages/AIEstimator.jsx'), 'utf8');
    expect(source).toContain('includeSectionOnlyTotals(');
    expect(source).toContain('importedRcvGap(');
    expect(source).toContain('SECTION_ONLY_TOTAL_PROMPT');
    expect(source).toContain('alert(rcvGap.warning)');
  });
});
