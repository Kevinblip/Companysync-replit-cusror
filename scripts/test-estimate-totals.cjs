#!/usr/bin/env node
/**
 * Estimate money integrity:
 *   1. Reopening a saved estimate must show the SAME total that was saved.
 *   2. Sales tax must never be charged twice.
 *
 * Fixtures below are the real line items from production estimates on the live
 * company, so a regression here is a regression against actual customer money.
 *
 * Run: node scripts/test-estimate-totals.cjs
 */

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

function eq(name, actual, expected, tol = 0.005) {
  const ok = typeof expected === 'number'
    ? Math.abs(Number(actual) - expected) <= tol
    : actual === expected;
  check(name, ok, ok ? '' : `expected ${expected}, got ${actual}`);
}

// ── Load the ES module under test without a bundler ──────────────────────────
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'estimateTotals.js'), 'utf8');
const cjs = src.replace(/^export\s+function\s+/gm, 'function ');
const exported = [...src.matchAll(/^export\s+function\s+(\w+)/gm)].map(m => m[1]);
const mod = {};
new Function('module', 'exports', `${cjs}\nmodule.exports = { ${exported.join(', ')} };`)(mod, {});
const { toFiniteNumber, lineQuantity, lineRate, resolveStoredRcv, resolveStoredAcv, normalizeSavedLineItem, sumRcv, sumAcv, sumNetAcv, taxIsBakedIntoLines } = mod.exports;

check('all helpers exported', exported.length === 10, `got ${exported.join(', ')}`);
for (const fn of ['toFiniteNumber', 'lineQuantity', 'lineRate', 'resolveStoredRcv', 'resolveStoredAcv', 'normalizeSavedLineItem', 'sumRcv', 'sumAcv', 'sumNetAcv', 'taxIsBakedIntoLines']) {
  check(`${fn} is a function`, typeof mod.exports[fn] === 'function');
}

// ── 1. toFiniteNumber ────────────────────────────────────────────────────────
console.log('\ntoFiniteNumber');
eq('null stays null', toFiniteNumber(null), null);
eq('undefined stays null', toFiniteNumber(undefined), null);
eq('empty string is null, not 0', toFiniteNumber(''), null);
eq('garbage is null', toFiniteNumber('abc'), null);
eq('NaN is null', toFiniteNumber(NaN), null);
eq('Infinity is null', toFiniteNumber(Infinity), null);
eq('zero is a real value', toFiniteNumber(0), 0);
eq('numeric string parses', toFiniteNumber('17935.80'), 17935.8);
eq('negative parses', toFiniteNumber(-12.5), -12.5);

// ── 2. resolveStoredRcv: the saved value wins ────────────────────────────────
console.log('\nresolveStoredRcv — a saved RCV is the authority');
eq('carrier RCV beats qty x rate',
  resolveStoredRcv({ quantity: 500, rate: 34.87, rcv: 17935.8 }), 17935.8);
eq('a saved $0 line stays $0 (carrier supply line)',
  resolveStoredRcv({ quantity: 12, rate: 0, rcv: 0 }), 0);
eq('falls back to amount when rcv absent',
  resolveStoredRcv({ quantity: 2, rate: 10, amount: 25 }), 25);
eq('computes qty x rate only when nothing was stored',
  resolveStoredRcv({ quantity: 3, rate: 7.5 }), 22.5);
eq('missing everything is 0', resolveStoredRcv({}), 0);
eq('null item does not throw', resolveStoredRcv(null), 0);

// ── 3. normalizeSavedLineItem: reopening must not change the money ───────────
console.log('\nnormalizeSavedLineItem — reopening does not rewrite the estimate');

// Real EST-2018 (Jennifer Park) line items as stored in production.
const jenniferPark = [
  { description: 'R&R Stone veneer - manufactured stone', quantity: 500, rate: 34.87, rcv: 17935.8, acv: 17935.8, depreciation_percent: 0 },
  { description: 'R&R House wrap (air/moisture barrier)', quantity: 500, rate: 0.54, rcv: 278, acv: 278, depreciation_percent: 0 },
  { description: 'Siding labor minimum', quantity: 1, rate: 245.41, rcv: 245.41, acv: 245.41, depreciation_percent: 0 },
  { code: 'TAX', description: 'Sales Tax (materials)', quantity: 1, rate: 508.8, rcv: 508.8, acv: 508.8, depreciation_percent: 0 },
];
const savedTotal = 18968.01;

const reopened = jenniferPark.map(normalizeSavedLineItem);
eq('EST-2018 reopens at the saved total, not qty x rate', sumRcv(reopened), savedTotal);
eq('stone veneer line keeps the carrier RCV', reopened[0].rcv, 17935.8);
eq('house wrap line keeps the carrier RCV', reopened[1].rcv, 278);
check('the old behaviour really did differ',
  Math.abs(jenniferPark.reduce((s, i) => s + i.quantity * i.rate, 0) - savedTotal) > 500,
  'fixture no longer reproduces the reported bug');

// EST-1947 (Stephanie Marilla): saved total is BELOW qty x rate.
const marillaSaved = 35732.21;
const marilla = [
  { description: 'Roofing', quantity: 100, rate: 347.3421, rcv: 34632.02, acv: 34632.02 },
  { code: 'TAX', description: 'Sales Tax (materials)', quantity: 1, rate: 1100.19, rcv: 1100.19, acv: 1100.19 },
];
eq('EST-1947 reopens at its saved total too', sumRcv(marilla.map(normalizeSavedLineItem)), marillaSaved);

// Depreciation / ACV
const dep = normalizeSavedLineItem({ quantity: 10, rate: 100, rcv: 1000, acv: 750, depreciation_percent: 25 });
eq('saved ACV is preserved, not recomputed', dep.acv, 750);
const noAcv = normalizeSavedLineItem({ quantity: 10, rate: 100, rcv: 1000, depreciation_percent: 25 });
eq('ACV derived from dep% only when absent', noAcv.acv, 750);
const zeroDep = normalizeSavedLineItem({ quantity: 1, rate: 50, rcv: 50 });
eq('no depreciation means ACV equals RCV', zeroDep.acv, 50);
const unreadAcv = normalizeSavedLineItem({
  quantity: 1,
  rate: 100,
  rcv: 100,
  acv: 0,
  depreciation_percent: 0,
});
eq('an unread zero ACV falls back to RCV when no depreciation exists', unreadAcv.acv, 100);
const fullyDepreciated = normalizeSavedLineItem({
  quantity: 1,
  rate: 100,
  rcv: 100,
  acv: 0,
  depreciation_percent: 100,
});
eq('a genuine fully depreciated zero ACV is preserved', fullyDepreciated.acv, 0);

// Import-only rollup lines (O&P, lump sums): no qty/rate breakdown, RCV is real.
const rollup = normalizeSavedLineItem({ description: 'General Contractor O&P', quantity: 0, rate: 0, rcv: 4120.55, import_only: true });
eq('O&P rollup line keeps its RCV', rollup.rcv, 4120.55);
check('import_only flag survives', rollup.import_only === true);

// amount must track rcv so downstream exports agree
eq('amount mirrors rcv', reopened[0].amount, 17935.8);
check('unrelated fields survive normalization',
  normalizeSavedLineItem({ rcv: 5, unit: 'SQ', code: 'RFG 240' }).code === 'RFG 240');
eq('unit is untouched', normalizeSavedLineItem({ rcv: 5, unit: 'SQ' }).unit, 'SQ');

// Idempotency: loading twice must not drift.
const twice = reopened.map(normalizeSavedLineItem);
eq('normalizing twice is stable', sumRcv(twice), savedTotal);

// Blank row added by hand
const blank = normalizeSavedLineItem({ description: '', quantity: 0, rate: 0, rcv: 0 });
eq('a blank row is $0', blank.rcv, 0);
eq('a blank row has 0 qty', blank.quantity, 0);

// A line saved with no rcv at all still prices out
eq('legacy row with only qty/rate still prices',
  normalizeSavedLineItem({ quantity: 4, rate: 12.25 }).rcv, 49);

// Non-numeric junk must not produce NaN money
const junk = normalizeSavedLineItem({ quantity: 'abc', rate: 'xyz', rcv: 'nope' });
eq('junk qty becomes 0', junk.quantity, 0);
eq('junk rate becomes 0', junk.rate, 0);
eq('junk rcv becomes 0, never NaN', junk.rcv, 0);
check('junk never yields NaN', Number.isFinite(junk.rcv) && Number.isFinite(junk.acv));

// ── 4. sumRcv ────────────────────────────────────────────────────────────────
console.log('\nsumRcv');
eq('empty list is 0', sumRcv([]), 0);
eq('non-array is 0', sumRcv(null), 0);
eq('rounds to cents', sumRcv([{ rcv: 0.1 }, { rcv: 0.2 }]), 0.3);
eq('ignores missing rcv', sumRcv([{ rcv: 10 }, {}]), 10);
eq('sumAcv repairs unread zero ACV cells', sumAcv([
  { rcv: 100, acv: 0, depreciation_percent: 0 },
  { rcv: 50, acv: 25, depreciation_percent: 50 },
]), 125);
eq('sumNetAcv subtracts carrier-level paid-when-incurred amount',
  sumNetAcv([{ rcv: 27491.13, acv: 25269.89 }], 376.84), 24893.05);

// ── 5. taxIsBakedIntoLines — the double-charge guard ─────────────────────────
console.log('\ntaxIsBakedIntoLines — never charge sales tax twice');

// The three pre-tax-injection lines of EST-2018. The RC column already carries
// the tax ($500.80 + $8.00 = $508.80), so the summary line must NOT be added.
const est2018PreInjection = jenniferPark.slice(0, 3);
check('EST-2018: tax already in the lines -> do not add a tax line',
  taxIsBakedIntoLines(est2018PreInjection, 508.8) === true);

// The other eight production estimates with a tax line: their RC column equals
// qty x rate, so the tax is genuinely a summary addition and MUST be added.
const genuinelyPreTax = [
  ['EST-2005 Ralana Redmon', 315.71],
  ['EST-2004 Brennen Cline', 411.24],
  ['EST-1961 Tanzalea Daniels', 400.89],
  ['EST-2017 Fabiano Fernandes', 1612.6],
  ['EST-2003 Vickie Meeks', 809.35],
  ['EST-1999 Elizabeth Kleinert', 607.58],
];
for (const [label, tax] of genuinelyPreTax) {
  const lines = [
    { quantity: 100, rate: 120.5, rcv: 12050 },
    { quantity: 40, rate: 33.25, rcv: 1330 },
  ];
  check(`${label}: pre-tax lines -> tax line IS added`,
    taxIsBakedIntoLines(lines, tax) === false);
}

// EST-2000 STEPHEN POTCHATEK: 2 cents of carrier rounding, tax $344.27.
// Rounding noise must not be mistaken for baked-in tax.
check('EST-2000: 2c of rounding is not baked-in tax',
  taxIsBakedIntoLines([{ quantity: 100, rate: 133.6455, rcv: 13364.57 }], 344.27) === false);

// EST-1947 Stephanie Marilla: RC column is BELOW qty x rate (negative spread).
check('EST-1947: negative spread is never read as baked-in tax',
  taxIsBakedIntoLines([{ quantity: 100, rate: 359.378, rcv: 35732.21 }], 1100.19) === false);

// Guard rails
console.log('\ntaxIsBakedIntoLines — guard rails');
check('zero tax is never "baked in"', taxIsBakedIntoLines([{ quantity: 1, rate: 1, rcv: 2 }], 0) === false);
check('negative tax is rejected', taxIsBakedIntoLines([{ quantity: 1, rate: 1, rcv: 2 }], -50) === false);
check('missing tax is rejected', taxIsBakedIntoLines([{ quantity: 1, rate: 1, rcv: 2 }], null) === false);
check('empty item list is rejected', taxIsBakedIntoLines([], 100) === false);
check('non-array is rejected', taxIsBakedIntoLines(null, 100) === false);
check('all-rollup lines are unmeasurable -> add the tax line',
  taxIsBakedIntoLines([{ quantity: 0, rate: 0, rcv: 5000 }, { quantity: 0, rate: 0, rcv: 250 }], 300) === false);
check('a $0 carrier supply line cannot fake a spread',
  taxIsBakedIntoLines([{ quantity: 12, rate: 0, rcv: 0 }], 300) === false);
check('exact match is baked in',
  taxIsBakedIntoLines([{ quantity: 100, rate: 100, rcv: 10300 }], 300) === true);

// Tolerance = max($0.05, one cent per measurable line). The ONLY difference we
// forgive is per-line cent rounding; anything wider is not the same money.
console.log('\ntaxIsBakedIntoLines — tolerance is cent rounding, nothing more');
const oneCentOff = [{ quantity: 100, rate: 100, rcv: 10300.01 }];
check('a cent of rounding is still baked in', taxIsBakedIntoLines(oneCentOff, 300) === true);
const fourLinesRounding = [
  { quantity: 10, rate: 100, rcv: 1075.01 },
  { quantity: 10, rate: 100, rcv: 1075.01 },
  { quantity: 10, rate: 100, rcv: 1075.01 },
  { quantity: 10, rate: 100, rcv: 1074.98 },
];
check('four lines may drift up to four cents',
  taxIsBakedIntoLines(fourLinesRounding, 300.01) === true);
check('$5 off a $300 tax is NOT baked in — that is a price difference, not rounding',
  taxIsBakedIntoLines([{ quantity: 100, rate: 100, rcv: 10305 }], 300) === false);
check('a 2% gap no longer counts as baked in',
  taxIsBakedIntoLines([{ quantity: 100, rate: 100, rcv: 10000 + 306 }], 300) === false);
check('allocated O&P sized near the tax does not masquerade as tax',
  taxIsBakedIntoLines([{ quantity: 100, rate: 100, rcv: 10000 + 1000 }], 980) === false);
check('a wide gap on a small tax is rejected',
  taxIsBakedIntoLines([{ quantity: 10, rate: 10, rcv: 130 }], 10) === false);
// The real EST-2018 case must survive the tighter bound.
check('EST-2018 still detected under the tightened tolerance',
  taxIsBakedIntoLines(est2018PreInjection, 508.8) === true);

// ── 6. End-to-end: the reported bug, start to finish ─────────────────────────
console.log('\nend-to-end — EST-2018 as it actually happened');

// Reproduce the import pipeline's tax step.
function buildItems(extractedLines, summaryTax) {
  const items = extractedLines.map(l => ({ ...l }));
  if (summaryTax > 0 && !taxIsBakedIntoLines(items, summaryTax)) {
    items.push({ code: 'TAX', description: 'Sales Tax (materials)', quantity: 1, unit: 'LS', rate: summaryTax, amount: summaryTax, rcv: summaryTax, acv: summaryTax, depreciation_percent: 0 });
  }
  return items;
}

const extracted = [
  { description: 'R&R Stone veneer - manufactured stone', quantity: 500, rate: 34.87, rcv: 17935.8, acv: 17935.8 },
  { description: 'R&R House wrap (air/moisture barrier)', quantity: 500, rate: 0.54, rcv: 278, acv: 278 },
  { description: 'Siding labor minimum', quantity: 1, rate: 245.41, rcv: 245.41, acv: 245.41 },
];

const built = buildItems(extracted, 508.8);
check('no duplicate tax line is created', built.filter(i => i.code === 'TAX').length === 0);
eq('imported total is the document total', sumRcv(built), 18459.21);
eq('imported total is $508.80 lower than the buggy save', savedTotal - sumRcv(built), 508.8);

const savedThenReopened = sumRcv(built.map(normalizeSavedLineItem));
eq('reopening shows the same total that was saved', savedThenReopened, sumRcv(built));

// A genuinely pre-tax document still gets its tax line.
const preTaxDoc = [
  { description: 'Remove & replace shingles', quantity: 30, rate: 350, rcv: 10500, acv: 10500 },
];
const preTaxBuilt = buildItems(preTaxDoc, 315.71);
check('a pre-tax document still gets its tax line', preTaxBuilt.filter(i => i.code === 'TAX').length === 1);
eq('pre-tax document total includes the tax', sumRcv(preTaxBuilt), 10815.71);
eq('and reopening it is stable', sumRcv(preTaxBuilt.map(normalizeSavedLineItem)), 10815.71);

// A no-tax document is untouched.
const noTax = buildItems(preTaxDoc, 0);
check('a document with no tax gets no tax line', noTax.length === 1);
eq('no-tax total is unchanged', sumRcv(noTax), 10500);

// ── 7. Wiring: the call sites actually use the shared helpers ────────────────
console.log('\nwiring');
const editorSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'EstimateEditor.jsx'), 'utf8');
check('EstimateEditor imports normalizeSavedLineItem',
  /import\s*{[^}]*normalizeSavedLineItem[^}]*}\s*from\s*["']@\/utils\/estimateTotals["']/.test(editorSrc));
check('EstimateEditor loads items through it',
  /items\.map\(normalizeSavedLineItem\)/.test(editorSrc));
check('EstimateEditor no longer prefers qty x rate on load',
  !/const\s+calcRcv\s*=\s*qty\s*\*\s*rate;[\s\S]{0,120}calcRcv\s*>\s*0\s*\?/.test(editorSrc));

const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'AIEstimator.jsx'), 'utf8');
check('AIEstimator imports taxIsBakedIntoLines',
  /import\s*{[^}]*taxIsBakedIntoLines[^}]*}\s*from\s*["']@\/utils\/estimateTotals["']/.test(aiSrc));
check('AIEstimator gates the tax line on it',
  /summaryTax\s*>\s*0\s*&&\s*!taxAlreadyInLines/.test(aiSrc));

// The editor's per-cell edit must still recalculate — otherwise trusting the
// saved value would freeze the line forever.
const lineEditorSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'estimates', 'LineItemEditor.jsx'), 'utf8');
check('editing qty or rate still recalculates the line',
  /field\s*===\s*'quantity'\s*\|\|\s*field\s*===\s*'rate'/.test(lineEditorSrc)
  && /newItems\[index\]\.rcv\s*=\s*qty\s*\*\s*rate/.test(lineEditorSrc));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
