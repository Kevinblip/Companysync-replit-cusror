import assert from 'node:assert/strict';
import {
  applyPerLineOverheadProfit,
  calculatePerLineOverheadProfit,
  getOpLineType,
  updateEstimateOverheadProfit,
} from '../src/utils/estimateOpLineItems.js';
import { resolveOverheadProfitPercentages } from '../src/utils/insuranceEstimateTemplates.js';

const base = [{ code: 'ROOF', quantity: 1, rate: 999, rcv: 23974.75, amount: 23974.75, depreciation_percent: 0 }];
const legacy = updateEstimateOverheadProfit(base, { overheadPct: 0, profitPct: 0 });
assert.equal(legacy[0].rcv, 23974.75, 'untouched saved amounts must not be repriced');
assert.equal(Number((legacy[0].rcv * 1.1).toFixed(2)), 26372.23);

const explicit = [...base, { code: 'O&P', description: 'Overhead & profit', rcv: 2397.52 }];
const removed = updateEstimateOverheadProfit(explicit);
assert.equal(removed.length, 1);
assert.equal(removed.some(item => getOpLineType(item)), false);
assert.equal(explicit.length, 2, 'source must not be mutated');

const format = { show_op_column: true, overhead_profit_rate: 20, tax_rate: 7 };
const added = applyPerLineOverheadProfit(base, { overheadPct: 10, profitPct: 10, taxRate: 7 }).items;
const zeroed = updateEstimateOverheadProfit(added, { format });
assert.equal(zeroed[0].op_amount, 0);
assert.equal(zeroed[0].op_base_rcv, 23974.75);
assert.equal(zeroed[0].rcv, 25652.98, 'tax retained; only O&P is removed');
const reopened = JSON.parse(JSON.stringify(zeroed));
const zeroRates = resolveOverheadProfitPercentages({ overhead_pct: 0, profit_pct: 0 }, format);
assert.deepEqual(zeroRates, { overhead_pct: 0, profit_pct: 0 }, 'zero overrides format defaults');
assert.equal(calculatePerLineOverheadProfit(reopened[0], {
  overheadPct: zeroRates.overhead_pct, profitPct: zeroRates.profit_pct, taxRate: 7,
}).op, 0);

const changed = updateEstimateOverheadProfit(reopened, { overheadPct: 5, profitPct: 12, format });
assert.equal(changed[0].overhead_amount, 1282.65);
assert.equal(changed[0].profit_amount, 3078.36);
assert.equal(changed[0].op_base_rcv, 23974.75, 'rate changes must not compound');
assert.equal(updateEstimateOverheadProfit(changed, { format })[0].rcv, 25652.98);
console.log('PASS: estimate O&P edits, explicit-row removal, saved bases, tax preservation and zero-rate reload');