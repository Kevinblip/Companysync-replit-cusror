import { describe, expect, it } from 'vitest';
import {
  addOrReplaceOverheadProfitLineItems,
  applyPerLineOverheadProfit,
  calculatePerLineOverheadProfit,
  getOverheadProfitBase,
  getOpLineType,
} from '@/utils/estimateOpLineItems';

describe('Xactimate-style O&P line items', () => {
  const baseItems = [
    { description: 'Roofing shingles', quantity: 10, unit: 'SQ', rate: 100, rcv: 1000 },
    { description: 'Drip edge', quantity: 100, unit: 'LF', rate: 2, rcv: 200 },
  ];

  it('adds separate Add’l Overhead and Add’l Profit rows from the base subtotal', () => {
    const result = addOrReplaceOverheadProfitLineItems(baseItems, {
      overheadPct: 10,
      profitPct: 10,
    });

    expect(result.base).toBe(1200);
    expect(result.added.map(item => item.description)).toEqual([
      "Add'l Overhead (10% General)",
      "Add'l Profit (10% General)",
    ]);
    expect(result.added.map(item => item.rcv)).toEqual([120, 120]);
    expect(result.added.every(item => item.rate === 0 && item.quantity === 1 && item.unit === 'EA')).toBe(true);
    expect(result.items).toHaveLength(4);
  });

  it('uses the explicit template split and does not double-add existing rows', () => {
    const first = addOrReplaceOverheadProfitLineItems(baseItems, {
      overheadPct: 8,
      profitPct: 12,
    });
    const second = addOrReplaceOverheadProfitLineItems(first.items, {
      overheadPct: 8,
      profitPct: 12,
    });

    expect(first.added.map(item => item.rcv)).toEqual([96, 144]);
    expect(second.added).toEqual([]);
    expect(second.items).toHaveLength(4);
  });

  it('replaces a legacy combined O&P row with two component rows', () => {
    const legacy = [
      ...baseItems,
      { code: 'O&P', description: 'Overhead & Profit (10% + 10%)', quantity: 1, unit: 'LS', rate: 240, rcv: 240 },
    ];
    const result = addOrReplaceOverheadProfitLineItems(legacy, { overheadPct: 10, profitPct: 10 });

    expect(result.items.map(getOpLineType)).toEqual([null, null, 'overhead', 'profit']);
    expect(result.items.slice(-2).map(item => item.rcv)).toEqual([120, 120]);
    expect(getOverheadProfitBase(result.items)).toBe(1200);
  });
});

describe('carrier-style per-line O&P', () => {
  it('matches the attached carrier estimate by rounding overhead and profit separately', () => {
    const first = calculatePerLineOverheadProfit(
      { quantity: 15.33, rate: 76.76, tax: 0 },
      { overheadPct: 10, profitPct: 10 },
    );
    const second = calculatePerLineOverheadProfit(
      { quantity: 458.33, rate: 2.02, tax: 19.80 },
      { overheadPct: 10, profitPct: 10 },
    );
    const third = calculatePerLineOverheadProfit(
      { quantity: 10.75, rate: 41.11, tax: 7.09 },
      { overheadPct: 10, profitPct: 10 },
    );

    expect(first).toMatchObject({ base: 1176.73, op: 235.34, rcv: 1412.07 });
    expect(second).toMatchObject({ base: 925.83, op: 189.12, rcv: 1134.75 });
    expect(third).toMatchObject({ base: 441.93, op: 89.80, rcv: 538.82 });
  });

  it('replaces legacy roll-up rows with saved O&P values on every detail line', () => {
    const result = applyPerLineOverheadProfit([
      { description: 'Roofing', quantity: 1, rate: 1000, rcv: 1000 },
      { code: 'O&P', description: "Add'l Overhead (10% General)", rcv: 100 },
      { code: 'O&P', description: "Add'l Profit (10% General)", rcv: 100 },
    ], { overheadPct: 10, profitPct: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      op_base_rcv: 1000,
      overhead_amount: 100,
      profit_amount: 100,
      op_amount: 200,
      rcv: 1200,
    });
  });
});