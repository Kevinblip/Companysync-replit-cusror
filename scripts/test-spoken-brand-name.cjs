/**
 * scripts/test-spoken-brand-name.cjs
 *
 * All-caps company initials must be spoken as separate letters.
 * "YICN Roofing" has to come out as "Y. I. C. N. Roofing" (why, eye, see, en),
 * not as a blended word. Hyphens are not the cue — the voice model ignores them.
 *
 * Run: node scripts/test-spoken-brand-name.cjs
 */

'use strict';

const assert = require('assert');
const {
  deriveSpokenBrandName,
  applySpokenCompanyName,
  rewriteVoiceText,
} = require('../lib/spokenBrandName.cjs');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

check('spells YICN Roofing as separate letters', () => {
  assert.strictEqual(deriveSpokenBrandName('', 'YICN Roofing'), 'Y. I. C. N. Roofing');
});

check('spells a spaced initialism the same way', () => {
  assert.strictEqual(deriveSpokenBrandName('', 'Y I C N Roofing'), 'Y. I. C. N. Roofing');
});

check('spells a dotted initialism the same way', () => {
  assert.strictEqual(deriveSpokenBrandName('', 'Y.I.C.N Roofing'), 'Y. I. C. N. Roofing');
});

check('leaves an already-spelled name alone', () => {
  assert.strictEqual(deriveSpokenBrandName('', 'Y. I. C. N. Roofing'), '');
});

check('leaves a real word alone', () => {
  assert.strictEqual(deriveSpokenBrandName('', 'CompanySync'), '');
  assert.strictEqual(deriveSpokenBrandName('', 'Summit Roofing'), '');
});

check('does not spell a single leading capital', () => {
  assert.strictEqual(deriveSpokenBrandName('', 'A Roofing'), '');
});

check('still spells other short all-caps tokens', () => {
  assert.strictEqual(deriveSpokenBrandName('', 'ABC Roofing'), 'A. B. C. Roofing');
  assert.strictEqual(deriveSpokenBrandName('', 'YCN Roofing'), 'Y. C. N. Roofing');
});

check('does not use hyphens', () => {
  const spoken = deriveSpokenBrandName('', 'YICN Roofing');
  assert.ok(!spoken.includes('-'), spoken);
});

check('a spoken_name override wins', () => {
  assert.strictEqual(
    deriveSpokenBrandName('why eye see en Roofing', 'YICN Roofing'),
    'why eye see en Roofing',
  );
});

check('an override equal to the written name is a no-op', () => {
  assert.strictEqual(deriveSpokenBrandName('YICN Roofing', 'YICN Roofing'), '');
});

check('empty name stays empty', () => {
  assert.strictEqual(deriveSpokenBrandName('', ''), '');
  assert.strictEqual(deriveSpokenBrandName(null, null), '');
});

check('voice prompt replaces the written name and names each letter', () => {
  const prompt = applySpokenCompanyName(
    'You are Lexi, a friendly assistant for YICN Roofing. Company: YICN Roofing. You work EXCLUSIVELY for YICN Roofing. Notes mention YICN often.',
    'YICN Roofing',
    deriveSpokenBrandName('', 'YICN Roofing'),
  );
  assert.ok(prompt.includes('Y. I. C. N. Roofing'), prompt);
  assert.ok(prompt.includes('why, eye, see, en'), prompt);
  assert.ok(!prompt.includes('Y-I-C-N'), prompt);
  // The written cluster may appear once, inside the "do not read this" line.
  const mentions = prompt.split('YICN').length - 1;
  assert.strictEqual(mentions, 1, prompt);
  assert.ok(prompt.includes('Never read that spelling as a word'), prompt);
});

check('a custom pronunciation is not coached as letter names', () => {
  const { pronunciationBlock } = require('../lib/spokenBrandName.cjs');
  const block = pronunciationBlock('YICN Roofing', 'Yikken Roofing');
  assert.ok(block.includes('Say it exactly as: "Yikken Roofing"'), block);
  assert.ok(!block.includes('why, eye, see, en'), block);
});

check('rewrite does not restamp a custom pronunciation', () => {
  const rewritten = rewriteVoiceText(
    'Say the company YICN Roofing on the greeting.',
    'YICN Roofing',
    'why eye see en Roofing',
  );
  assert.strictEqual(rewritten, 'Say the company why eye see en Roofing on the greeting.');
});

check('rewrite is idempotent', () => {
  const once = rewriteVoiceText('Call YICN Roofing today.', 'YICN Roofing', 'Y. I. C. N. Roofing');
  const twice = rewriteVoiceText(once, 'YICN Roofing', 'Y. I. C. N. Roofing');
  assert.strictEqual(once, twice);
  assert.strictEqual(once, 'Call Y. I. C. N. Roofing today.');
});

if (process.exitCode) {
  console.error('\nSpoken brand name tests failed.');
} else {
  console.log(`\n${passed} spoken brand name tests passed.`);
}
