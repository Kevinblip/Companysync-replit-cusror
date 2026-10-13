/**
 * scripts/test-teammate-name-match.cjs
 *
 * Spoken-name resolution for hands-free voice messages.
 *
 * The rule under test: a spoken name resolves to exactly one teammate, to a
 * short ambiguous set, or to nothing. It must NEVER silently pick a best guess,
 * because that delivers a private voice message to the wrong person.
 *
 * Run: node scripts/test-teammate-name-match.cjs
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

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

const ROSTER = [
  { email: 'vicky@roofco.com', name: 'Vicky Alvarez' },
  { email: 'mike.adams@roofco.com', name: 'Mike Adams' },
  { email: 'mchen@roofco.com', name: 'Mike Chen' },
  { email: 'sarah.k@roofco.com', name: 'Sarah Kowalski' },
  { email: 'dbrooks@roofco.com', name: 'Danielle Brooks' },
  { email: 'jose@roofco.com', name: 'José Ramirez' },
];

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'teammateNameMatch.js')).href);
  const {
    resolveTeammateName,
    stripAddressingFiller,
    describeCandidates,
    classifyConfirmation,
    soundex,
  } = mod;

  console.log('\n1. Filler around the name is stripped');

  check('"send a message to vicky" reduces to the name', () => {
    assert.strictEqual(stripAddressingFiller('send a message to vicky'), 'vicky');
  });
  check('"uh, tell Mike Adams" reduces to the full name', () => {
    assert.strictEqual(stripAddressingFiller('uh, tell Mike Adams'), 'mike adams');
  });
  check('an utterance that is only filler falls back to the raw words', () => {
    assert.strictEqual(stripAddressingFiller('send a message to'), 'send a message to');
  });

  console.log('\n2. Confident single matches');

  check('an exact first name matches one teammate', () => {
    const r = resolveTeammateName('Vicky', ROSTER);
    assert.strictEqual(r.status, 'match');
    assert.strictEqual(r.match.email, 'vicky@roofco.com');
  });
  check('a full name matches', () => {
    const r = resolveTeammateName('Sarah Kowalski', ROSTER);
    assert.strictEqual(r.status, 'match');
    assert.strictEqual(r.match.email, 'sarah.k@roofco.com');
  });
  check('a mishearing ("Vicki") still resolves', () => {
    const r = resolveTeammateName('Vicki', ROSTER);
    assert.strictEqual(r.status, 'match');
    assert.strictEqual(r.match.email, 'vicky@roofco.com');
  });
  check('a partial name ("Dani") resolves to Danielle', () => {
    const r = resolveTeammateName('Dani', ROSTER);
    assert.strictEqual(r.status, 'match');
    assert.strictEqual(r.match.email, 'dbrooks@roofco.com');
  });
  check('an accented name matches its unaccented transcript', () => {
    const r = resolveTeammateName('Jose', ROSTER);
    assert.strictEqual(r.status, 'match');
    assert.strictEqual(r.match.email, 'jose@roofco.com');
  });
  check('a full-name utterance disambiguates two Mikes', () => {
    const r = resolveTeammateName('Mike Chen', ROSTER);
    assert.strictEqual(r.status, 'match');
    assert.strictEqual(r.match.email, 'mchen@roofco.com');
  });
  check('a surname-only utterance resolves', () => {
    const r = resolveTeammateName('Kowalski', ROSTER);
    assert.strictEqual(r.status, 'match');
    assert.strictEqual(r.match.email, 'sarah.k@roofco.com');
  });

  console.log('\n3. Ambiguity is reported, never guessed');

  check('"Mike" with two Mikes is ambiguous', () => {
    const r = resolveTeammateName('Mike', ROSTER);
    assert.strictEqual(r.status, 'ambiguous');
    assert.strictEqual(r.candidates.length, 2);
    assert.ok(!r.match, 'an ambiguous result must not carry a single match');
  });
  check('the ambiguous set is capped at three options', () => {
    const crowded = [
      { email: 'j1@x.com', name: 'Jim Alpha' },
      { email: 'j2@x.com', name: 'Jim Beta' },
      { email: 'j3@x.com', name: 'Jim Gamma' },
      { email: 'j4@x.com', name: 'Jim Delta' },
    ];
    const r = resolveTeammateName('Jim', crowded);
    assert.strictEqual(r.status, 'ambiguous');
    assert.strictEqual(r.candidates.length, 3);
  });
  check('two teammates with the identical name stay ambiguous', () => {
    const twins = [
      { email: 'a@x.com', name: 'Chris Doyle' },
      { email: 'b@x.com', name: 'Chris Doyle' },
    ];
    const r = resolveTeammateName('Chris Doyle', twins);
    assert.strictEqual(r.status, 'ambiguous');
  });
  check('an ambiguous set reads back as a spoken choice', () => {
    const r = resolveTeammateName('Mike', ROSTER);
    const spoken = describeCandidates(r.candidates);
    assert.ok(spoken.includes(' or '), `expected a spoken choice, got "${spoken}"`);
    assert.ok(spoken.includes('Mike Adams') && spoken.includes('Mike Chen'));
  });

  console.log('\n4. Unrecognised names are refused outright');

  check('a name nobody on the roster has returns none', () => {
    const r = resolveTeammateName('Bartholomew', ROSTER);
    assert.strictEqual(r.status, 'none');
    assert.strictEqual(r.candidates.length, 0);
  });
  check('an empty utterance returns none', () => {
    assert.strictEqual(resolveTeammateName('', ROSTER).status, 'none');
    assert.strictEqual(resolveTeammateName('   ', ROSTER).status, 'none');
  });
  check('an empty roster can never produce a match', () => {
    assert.strictEqual(resolveTeammateName('Vicky', []).status, 'none');
    assert.strictEqual(resolveTeammateName('Vicky', null).status, 'none');
  });
  check('a short unrelated syllable does not latch onto a teammate', () => {
    const r = resolveTeammateName('zzz', ROSTER);
    assert.strictEqual(r.status, 'none');
  });

  console.log('\n5. Phonetic matching');

  check('soundex collapses Vicky/Vicki', () => {
    assert.strictEqual(soundex('Vicky'), soundex('Vicki'));
  });
  check('soundex keeps clearly different names apart', () => {
    assert.notStrictEqual(soundex('Vicky'), soundex('Danielle'));
  });

  console.log('\n6. Spoken confirm / cancel');

  check('"send it" confirms', () => assert.strictEqual(classifyConfirmation('send it'), 'confirm'));
  check('"yes" confirms', () => assert.strictEqual(classifyConfirmation('yes'), 'confirm'));
  check('"go ahead" confirms', () => assert.strictEqual(classifyConfirmation('go ahead'), 'confirm'));
  check('"cancel" cancels', () => assert.strictEqual(classifyConfirmation('cancel'), 'cancel'));
  check('"never mind" cancels', () => assert.strictEqual(classifyConfirmation('never mind'), 'cancel'));
  check('"no" cancels', () => assert.strictEqual(classifyConfirmation('no'), 'cancel'));
  check('"no, cancel that" is a cancel, not a confirm', () => {
    assert.strictEqual(classifyConfirmation('no cancel that'), 'cancel');
  });
  check('anything else is unclear, so the flow must re-ask', () => {
    assert.strictEqual(classifyConfirmation('the roof needs new flashing'), 'unclear');
    assert.strictEqual(classifyConfirmation(''), 'unclear');
  });

  console.log(`\n${passed} checks passed.`);
  if (process.exitCode) {
    console.error('\nFAILED');
  } else {
    console.log('Teammate name resolution OK.\n');
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
