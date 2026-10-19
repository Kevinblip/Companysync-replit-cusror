import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collapseDuplicateLineSequence,
  dedupeImportedLineItems,
  registerImportDocument,
} from '@/utils/estimateDuplicateImport';
import { selectCoverageSettlement } from '../../lib/insuranceSettlement.js';

const sum = (items) => Math.round(items.reduce((total, item) => total + Number(item.rcv || 0), 0) * 100) / 100;

describe('duplicate estimate pages', () => {
  const dwelling = { description: 'Dwelling itemized scope', quantity: 1, unit: 'LS', rcv: 21430.73 };
  const right = { description: 'Totals: Right Elevation', quantity: 1, unit: 'LS', rcv: 4000 };
  const rear = { description: 'Totals: Rear', quantity: 1, unit: 'LS', rcv: 3541.94 };

  it('drops a repeated page so Wanda totals $28,972.67 instead of $36,514.61', () => {
    const doubled = [dwelling, right, rear, right, rear];
    expect(sum(doubled)).toBe(36514.61);

    const collapsed = collapseDuplicateLineSequence(doubled);
    expect(sum(collapsed.lineItems)).toBe(28972.67);
    expect(collapsed.removedCount).toBe(2);
    expect(collapsed.warning).toMatch(/not merged/i);
  });

  it('skips a second upload of the same document', () => {
    const lineItems = [dwelling, right, rear];
    const seenText = new Map();
    const seenItems = new Map();
    const first = registerImportDocument({
      name: 'Wanda-state-farm.pdf',
      lineItems,
      seenText,
      seenItems,
    });
    const second = registerImportDocument({
      name: 'Wanda-state-farm-copy.pdf',
      lineItems,
      seenText,
      seenItems,
    });

    expect(first.duplicate).toBe(false);
    expect(sum(first.lineItems)).toBe(28972.67);
    expect(second.duplicate).toBe(true);
    expect(second.lineItems).toEqual([]);
    expect(second.warning).toContain('Wanda-state-farm-copy.pdf');
    expect(second.warning).toContain('identical line items');
    expect(second.warning).toContain('Wanda-state-farm.pdf');
    expect(second.warning).toMatch(/not merged/i);
  });

  it('skips a page with identical text and keeps a different page', () => {
    const pageText = 'State Farm estimate page for 16413 Glendale Ave Cleveland OH 44128 dwelling elevation scope';
    const result = dedupeImportedLineItems({
      pages: [
        { page_number: 2, text: pageText, line_items: [right, rear] },
        { page_number: 3, text: `${pageText}\n`, line_items: [right, rear] },
        { page_number: 4, text: 'State Farm estimate page for the front elevation with different itemized repair lines', line_items: [dwelling] },
      ],
    });

    expect(result.skipped.map((entry) => entry.name)).toContain('Page 3');
    expect(result.warning).toMatch(/identical text/i);
    expect(sum(result.lineItems)).toBe(28972.67);
  });

  it('keeps two different elevations that share one repeated description', () => {
    const result = collapseDuplicateLineSequence([
      { description: 'R&R Gutter', quantity: 10, unit: 'LF', rcv: 100 },
      { description: 'R&R Gutter', quantity: 12, unit: 'LF', rcv: 120 },
      { description: 'Downspout', quantity: 2, unit: 'EA', rcv: 80 },
    ]);
    expect(result.lineItems).toHaveLength(3);
    expect(result.removedCount).toBe(0);
  });
});

describe('coverage summary selection', () => {
  it('uses the Dwelling summary instead of the first Other Structures summary', () => {
    const result = selectCoverageSettlement({
      coverages: [
        { name: 'Coverage A - Other Structures', rcv: 581.8, settlement: { basis: 'Coverage A - Other Structures', reported_check_amount: 581.8 } },
        { name: 'Coverage A - Dwelling', rcv: 28972.67, settlement: { basis: 'Coverage A - Dwelling', deductible: 1976, reported_check_amount: 12000 } },
      ],
    });

    expect(result.chosen).toEqual({ name: 'Coverage A - Dwelling', rcv: 28972.67 });
    expect(result.settlement.basis).toBe('Coverage A - Dwelling');
    expect(result.settlement.reported_check_amount).toBe(12000);
    expect(result.settlement.reported_check_amount).not.toBe(581.8);
    expect(result.summedRcv).toBeCloseTo(29554.47, 2);
    expect(result.warning).toContain('Dwelling');
    expect(result.warning).toContain('$581.80');
    expect(result.warning).toContain('$28,972.67');
    expect(result.warning).toContain('$29,554.47');
    expect(result.warning).toMatch(/not added to the repair lines/i);
    expect(result.settlement.warnings.join(' ')).toContain(result.warning);
  });

  it('uses the largest coverage when none is labeled Dwelling', () => {
    const result = selectCoverageSettlement({
      coverages: [
        { name: 'Coverage B', rcv: 400 },
        { name: 'Coverage C', rcv: 2500 },
      ],
    });
    expect(result.chosen.name).toBe('Coverage C');
    expect(result.warning).toContain('largest');
  });

  it('prefers Dwelling even when Other Structures has a larger RCV', () => {
    const result = selectCoverageSettlement({
      coverages: [
        { name: 'Coverage A - Other Structures', rcv: 50000 },
        { name: 'Coverage A - Dwelling', rcv: 28972.67 },
      ],
    });
    expect(result.chosen.name).toBe('Coverage A - Dwelling');
  });
});

describe('import wiring', () => {
  it('checks duplicates and coverage choice before the estimate is saved', () => {
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../pages/AIEstimator.jsx'), 'utf8');
    expect(source).toContain('registerImportDocument(');
    expect(source).toContain('dedupeImportedLineItems(');
    expect(source).toContain('selectCoverageSettlement(');
    expect(source).toContain('DUPLICATE_PAGE_PROMPT');
    expect(source).toContain('coverage_summaries');
    expect(source).toContain('alert(duplicateImport.warning)');
    expect(source).toContain('alert(coverageChoice.warning)');
  });
});
