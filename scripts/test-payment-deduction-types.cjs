#!/usr/bin/env node
/**
 * Third-party fee deduction types — storage shape and percentage math.
 *
 * These types were originally saved as plain strings and can now carry a rate,
 * so both shapes exist in live company records. A normalizer that chokes on the
 * legacy shape would empty the dropdown on real accounts; one that lets a bad
 * rate through would auto-fill a wrong dollar figure into an expense.
 */

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.log(`  \u2717 ${label}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

(async () => {
  const {
    normalizeDeductionTypes, sanitizePercent, deductionTypeLabel, feeFromPercent,
  } = await import('../src/utils/paymentDeductionTypes.js');

  console.log('\n\u2500\u2500 legacy string types keep working \u2500\u2500');

  check('a saved plain string becomes a rate-less type',
    normalizeDeductionTypes(['Sedgwick Assignment and commission fee']),
    [{ name: 'Sedgwick Assignment and commission fee', percent: null }]);

  check('strings and objects can coexist in one saved list',
    normalizeDeductionTypes(['Processing Fee', { name: 'Assignment Fee', percent: 9 }]),
    [{ name: 'Processing Fee', percent: null }, { name: 'Assignment Fee', percent: 9 }]);

  check('never-configured value yields an empty list, not a crash',
    normalizeDeductionTypes(undefined), []);

  check('a non-array value yields an empty list',
    normalizeDeductionTypes('Processing Fee'), []);

  check('surrounding whitespace is trimmed off names',
    normalizeDeductionTypes(['  Processing Fee  ']),
    [{ name: 'Processing Fee', percent: null }]);

  check('blank and nameless entries are dropped',
    normalizeDeductionTypes(['', '   ', { percent: 9 }, { name: 'Real Fee' }]),
    [{ name: 'Real Fee', percent: null }]);

  console.log('\n\u2500\u2500 a bad rate must never reach the invoice \u2500\u2500');

  check('zero is not a usable rate', sanitizePercent(0), null);
  check('a negative rate is rejected', sanitizePercent(-9), null);
  check('over 100% is rejected', sanitizePercent(101), null);
  check('a non-numeric rate is rejected', sanitizePercent('nine'), null);
  check('an empty rate box is rejected', sanitizePercent(''), null);
  check('null is rejected', sanitizePercent(null), null);
  check('exactly 100% is allowed', sanitizePercent(100), 100);
  check('a numeric string from an input box is accepted', sanitizePercent('9'), 9);
  check('a fractional rate is accepted', sanitizePercent(2.75), 2.75);

  check('a bad rate on a saved type normalizes to no rate',
    normalizeDeductionTypes([{ name: 'Broken', percent: 999 }]),
    [{ name: 'Broken', percent: null }]);

  console.log('\n\u2500\u2500 dropdown label \u2500\u2500');

  check('a rated type shows its rate',
    deductionTypeLabel({ name: 'Assignment Fee', percent: 9 }), 'Assignment Fee (9%)');

  check('a rate-less type shows just the name',
    deductionTypeLabel({ name: 'Processing Fee', percent: null }), 'Processing Fee');

  check('a missing type produces an empty label rather than "undefined"',
    deductionTypeLabel(null), '');

  console.log('\n\u2500\u2500 fee math (real invoice INV-2026-0404) \u2500\u2500');

  // Invoice total 14,224.50; 10,043.38 already collected; 4,181.12 remitted
  // through the third party, who keeps 9%.
  check('9% of the 4,181.12 remitted balance', feeFromPercent(9, 4181.12), 376.30);

  check('the contractor receives the remainder',
    Math.round((4181.12 - feeFromPercent(9, 4181.12)) * 100) / 100, 3804.82);

  check('fee + net add back up to the amount remitted',
    Math.round((feeFromPercent(9, 4181.12) + 3804.82) * 100) / 100, 4181.12);

  check('a half-cent result rounds up, not down (9% of 14,224.50)',
    feeFromPercent(9, 14224.50), 1280.21);

  console.log('\n\u2500\u2500 float rounding must not shave a cent off the fee \u2500\u2500');

  // pct/100*base in binary floating point evaluates to 0.6149999999999999 here,
  // which rounds DOWN to 0.61. The fee is 0.62.
  check('15% of $4.10 is 62 cents, not 61', feeFromPercent(15, 4.10), 0.62);

  check('5% of $0.10 is 1 cent, not 0', feeFromPercent(5, 0.10), 0.01);
  check('70% of $1.15 is 81 cents', feeFromPercent(70, 1.15), 0.81);
  check('3% of $8.15 is 24 cents', feeFromPercent(3, 8.15), 0.24);
  check('9% of $0.05 rounds to nothing', feeFromPercent(9, 0.05), 0);

  console.log('\n\u2500\u2500 fractional rates \u2500\u2500');

  check('2.75% of the remitted balance', feeFromPercent(2.75, 4181.12), 114.98);
  check('7.5% of $1,000 is exactly $75', feeFromPercent(7.5, 1000), 75);
  check('0.5% of $4,181.12', feeFromPercent(0.5, 4181.12), 20.91);
  check('12.25% of $2,000 is exactly $245', feeFromPercent(12.25, 2000), 245);

  // Exhaustive sweep: no rate/base combination may ever differ from an exact
  // integer-cent calculation by more than nothing at all.
  let drift = 0;
  for (let cents = 1; cents <= 20000; cents++) {
    for (const pct of [3, 5, 9, 15, 2.75, 7.5]) {
      const base = cents / 100;
      const expected = Math.round((pct * cents) / 100) / 100;
      if (feeFromPercent(pct, base) !== expected) drift++;
    }
  }
  check('120,000 rate/base combinations all land on the exact cent', drift, 0);

  check('a rate-less type auto-fills nothing rather than $0',
    feeFromPercent(null, 4181.12), null);

  check('a zero balance auto-fills nothing',
    feeFromPercent(9, 0), null);

  check('a negative balance auto-fills nothing',
    feeFromPercent(9, -100), null);

  check('a missing balance auto-fills nothing',
    feeFromPercent(9, undefined), null);

  check('100% of the balance is the whole balance',
    feeFromPercent(100, 4181.12), 4181.12);

  console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(`${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\u274c Deduction type handling regressed');
    process.exit(1);
  }
  console.log('\u2705 Legacy types load, bad rates are rejected, fee math is exact');
})().catch((err) => {
  console.error('Test harness failed:', err);
  process.exit(1);
});
