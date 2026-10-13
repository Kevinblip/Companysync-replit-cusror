/**
 * test-sarah-row-isolation.cjs
 *
 * Verifies that pickCanonicalSarahRow and identifyDeletableDuplicates from
 * lib/assistantSettingsHelpers.cjs (the shared production module) only operate
 * on Sarah-persona rows ('sarah', '', null) and never touch rows belonging to
 * Lexi, Alex, Marcus, or any other named assistant.
 *
 * Run: node scripts/test-sarah-row-isolation.cjs
 */

'use strict';

const {
  isLexiRow,
  isSarahRow,
  pickCanonicalSarahRow,
  identifyDeletableDuplicates,
  SARAH_PERSONA_NAMES_ARRAY,
} = require('../lib/assistantSettingsHelpers.cjs');

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    failed++;
  }
}

const now = Date.now();

function makeRow(id, assistantName, { edited = false } = {}) {
  const created = now - 60_000;
  const updated = edited ? now - 1_000 : created + 100;
  return {
    id,
    assistant_name: assistantName,
    created_date: new Date(created).toISOString(),
    updated_date: new Date(updated).toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — isSarahRow / isLexiRow
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─── isSarahRow ───');
ok('null assistant_name is Sarah',    isSarahRow({ assistant_name: null }));
ok('empty string is Sarah',           isSarahRow({ assistant_name: '' }));
ok('"sarah" is Sarah',                isSarahRow({ assistant_name: 'sarah' }));
ok('"SARAH" (uppercase) is Sarah',    isSarahRow({ assistant_name: 'SARAH' }));
ok('" sarah " (whitespace) is Sarah', isSarahRow({ assistant_name: ' sarah ' }));
// "alex" is a distinct assistant — must NOT be treated as Sarah
ok('"alex" is NOT Sarah',             !isSarahRow({ assistant_name: 'alex' }));
ok('"Alex" is NOT Sarah',             !isSarahRow({ assistant_name: 'Alex' }));
ok('"ALEX" is NOT Sarah',             !isSarahRow({ assistant_name: 'ALEX' }));
ok('"marcus" is NOT Sarah',           !isSarahRow({ assistant_name: 'marcus' }));
ok('"lexi" is NOT Sarah',             !isSarahRow({ assistant_name: 'lexi' }));
ok('"custom_bot" is NOT Sarah',       !isSarahRow({ assistant_name: 'custom_bot' }));

console.log('\n─── isLexiRow ───');
ok('"lexi" is Lexi',     isLexiRow({ assistant_name: 'lexi' }));
ok('"LEXI" is Lexi',     isLexiRow({ assistant_name: 'LEXI' }));
ok('"sarah" is NOT Lexi',!isLexiRow({ assistant_name: 'sarah' }));
ok('"alex" is NOT Lexi', !isLexiRow({ assistant_name: 'alex' }));
ok('"marcus" is NOT Lexi',!isLexiRow({ assistant_name: 'marcus' }));

console.log('\n─── SARAH_PERSONA_NAMES_ARRAY ───');
ok('includes "sarah"',            SARAH_PERSONA_NAMES_ARRAY.includes('sarah'));
ok('includes ""',                 SARAH_PERSONA_NAMES_ARRAY.includes(''));
ok('does NOT include "alex"',     !SARAH_PERSONA_NAMES_ARRAY.includes('alex'));
ok('does NOT include "marcus"',   !SARAH_PERSONA_NAMES_ARRAY.includes('marcus'));
ok('does NOT include "lexi"',     !SARAH_PERSONA_NAMES_ARRAY.includes('lexi'));

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — pickCanonicalSarahRow with lexi + sarah + alex + marcus
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─── pickCanonicalSarahRow — lexi + sarah + alex + marcus ───');

const lexiRow   = makeRow('lexi-1',   'lexi',   { edited: true });
const sarahRow  = makeRow('sarah-1',  'sarah',  { edited: true });
const alexRow   = makeRow('alex-1',   'alex',   { edited: true }); // custom distinct assistant
const marcusRow = makeRow('marcus-1', 'marcus', { edited: true }); // custom distinct assistant

const canonical = pickCanonicalSarahRow([lexiRow, sarahRow, alexRow, marcusRow]);
ok('picks sarah row (not lexi, not alex, not marcus)', canonical?.id === 'sarah-1');
ok('canonical is not lexi',   canonical?.id !== 'lexi-1');
ok('canonical is not alex',   canonical?.id !== 'alex-1');
ok('canonical is not marcus', canonical?.id !== 'marcus-1');

console.log('\n─── pickCanonicalSarahRow — lexi + alex + marcus (no sarah row) ───');
const canonicalNoSarah = pickCanonicalSarahRow([lexiRow, alexRow, marcusRow]);
ok('returns null when no sarah/empty row exists', canonicalNoSarah === null);

console.log('\n─── pickCanonicalSarahRow — empty-name row is Sarah; alex is NOT ───');
const emptyRow = makeRow('empty-1', '', { edited: true });
const canonicalEmpty = pickCanonicalSarahRow([lexiRow, emptyRow, alexRow, marcusRow]);
ok('empty assistant_name is Sarah', canonicalEmpty?.id === 'empty-1');
ok('alex row NOT selected',         canonicalEmpty?.id !== 'alex-1');

console.log('\n─── pickCanonicalSarahRow — edited sarah beats unedited sarah ───');
const uneditedSarah = makeRow('sarah-unedited', 'sarah', { edited: false });
const editedSarah   = makeRow('sarah-edited',   'sarah', { edited: true  });
const canonicalEdited = pickCanonicalSarahRow([lexiRow, uneditedSarah, editedSarah]);
ok('edited sarah row beats unedited sarah row', canonicalEdited?.id === 'sarah-edited');

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — identifyDeletableDuplicates never flags lexi, alex, or marcus
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n─── identifyDeletableDuplicates — lexi + sarah dup + alex + marcus ───');

(async () => {
  const rows = [
    makeRow('lexi-1',         'lexi',   { edited: true  }),
    makeRow('sarah-edited',   'sarah',  { edited: true  }), // canonical
    makeRow('sarah-unedited', 'sarah',  { edited: false }), // stale dup — deletable
    makeRow('alex-1',         'alex',   { edited: true  }), // custom — must be preserved
    makeRow('alex-unedited',  'alex',   { edited: false }), // custom — must be preserved
    makeRow('marcus-1',       'marcus', { edited: true  }), // custom — must be preserved
    makeRow('marcus-unedited','marcus', { edited: false }), // custom — must be preserved
  ];

  const can = pickCanonicalSarahRow(rows);
  ok('canonical is the edited sarah row', can?.id === 'sarah-edited');

  const toDelete = identifyDeletableDuplicates(rows, can);

  ok('exactly 1 row flagged for deletion',              toDelete.length === 1);
  ok('lexi row NOT flagged',                            !toDelete.find(r => r.id === 'lexi-1'));
  ok('canonical sarah NOT flagged',                     !toDelete.find(r => r.id === 'sarah-edited'));
  ok('unedited sarah dup IS flagged',                    !!toDelete.find(r => r.id === 'sarah-unedited'));
  ok('edited alex NOT flagged',                         !toDelete.find(r => r.id === 'alex-1'));
  ok('unedited alex NOT flagged',                       !toDelete.find(r => r.id === 'alex-unedited'));
  ok('edited marcus NOT flagged',                       !toDelete.find(r => r.id === 'marcus-1'));
  ok('unedited marcus NOT flagged',                     !toDelete.find(r => r.id === 'marcus-unedited'));

  // ─── Simulate atomic DELETE WHERE predicates ────────────────────────────
  console.log('\n─── Atomic DELETE WHERE predicate simulation ───');

  // Mirrors the DELETE WHERE in scripts/dedup-assistant-settings.cjs and
  // the /api/admin/dedup-assistant-settings endpoint:
  //   AND LOWER(BTRIM(COALESCE(data->>'assistant_name', ''))) <> 'lexi'
  //   AND LOWER(BTRIM(COALESCE(data->>'assistant_name', ''))) = ANY(sarahNames)
  //   AND updated_date <= created_date + 5s
  function simulateDeleteWhere(row) {
    const name = (row.assistant_name || '').trim().toLowerCase();
    if (name === 'lexi') return false;
    if (!SARAH_PERSONA_NAMES_ARRAY.includes(name)) return false;
    const created = new Date(row.created_date || 0).getTime();
    const updated = new Date(row.updated_date || 0).getTime();
    return updated <= created + 5000;
  }

  ok('lexi-1 NOT matched by DELETE WHERE',           !simulateDeleteWhere(rows.find(r => r.id === 'lexi-1')));
  ok('sarah-unedited MATCHED by DELETE WHERE',        simulateDeleteWhere(rows.find(r => r.id === 'sarah-unedited')));
  ok('sarah-edited NOT matched (edited)',             !simulateDeleteWhere(rows.find(r => r.id === 'sarah-edited')));
  ok('alex-1 NOT matched by DELETE WHERE',           !simulateDeleteWhere(rows.find(r => r.id === 'alex-1')));
  ok('alex-unedited NOT matched by DELETE WHERE',    !simulateDeleteWhere(rows.find(r => r.id === 'alex-unedited')));
  ok('marcus-1 NOT matched by DELETE WHERE',         !simulateDeleteWhere(rows.find(r => r.id === 'marcus-1')));
  ok('marcus-unedited NOT matched by DELETE WHERE',  !simulateDeleteWhere(rows.find(r => r.id === 'marcus-unedited')));

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 4 — identifyDeletableDuplicates with empty-name row + alex + marcus
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n─── identifyDeletableDuplicates — empty-name + alex + marcus ───');

  const rows2 = [
    makeRow('lexi-1',    'lexi',   { edited: true  }),
    makeRow('empty-edit','',       { edited: true  }), // canonical
    makeRow('empty-dup', '',       { edited: false }), // stale dup — deletable
    makeRow('alex-1',    'alex',   { edited: false }), // custom — must survive
    makeRow('marcus-1',  'marcus', { edited: false }), // custom — must survive
  ];

  const can2 = pickCanonicalSarahRow(rows2);
  ok('canonical is edited empty-name row', can2?.id === 'empty-edit');

  const toDelete2 = identifyDeletableDuplicates(rows2, can2);
  ok('1 row flagged',                      toDelete2.length === 1);
  ok('empty dup IS flagged',               !!toDelete2.find(r => r.id === 'empty-dup'));
  ok('alex NOT flagged',                   !toDelete2.find(r => r.id === 'alex-1'));
  ok('marcus NOT flagged',                 !toDelete2.find(r => r.id === 'marcus-1'));
  ok('alex NOT matched by DELETE WHERE',   !simulateDeleteWhere(rows2.find(r => r.id === 'alex-1')));
  ok('marcus NOT matched by DELETE WHERE', !simulateDeleteWhere(rows2.find(r => r.id === 'marcus-1')));

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 5 — company with only lexi + alex (no sarah row at all)
  //           Alex must be fully preserved; nothing is touched.
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n─── lexi + alex only — alex is entirely untouched ───');

  const rows3 = [
    makeRow('lexi-1', 'lexi', { edited: true  }),
    makeRow('alex-1', 'alex', { edited: true  }),
    makeRow('alex-2', 'alex', { edited: false }),
  ];

  const can3 = pickCanonicalSarahRow(rows3);
  ok('no canonical Sarah row (alex is not Sarah)', can3 === null);

  const toDelete3 = identifyDeletableDuplicates(rows3, can3);
  ok('nothing flagged for deletion', toDelete3.length === 0);

  // ─────────────────────────────────────────────────────────────────────────
  // Suite 6 — SQL predicate parity: LOWER(BTRIM(COALESCE(...))) IN ('sarah','')
  // Verifies that the SQL normalization matches isSarahRow() for all name forms.
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n─── SQL predicate parity (LOWER+BTRIM normalization) ───');

  function sqlSarahPredicate(rawName) {
    const normalized = (rawName ?? '').trim().toLowerCase();
    return SARAH_PERSONA_NAMES_ARRAY.includes(normalized);
  }
  function sqlLexiPredicate(rawName) {
    return (rawName ?? '').trim().toLowerCase() === 'lexi';
  }

  const sqlCases = [
    { raw: 'sarah',   expectSarah: true,  expectLexi: false, label: '"sarah" lowercase' },
    { raw: 'Sarah',   expectSarah: true,  expectLexi: false, label: '"Sarah" capitalized' },
    { raw: 'SARAH',   expectSarah: true,  expectLexi: false, label: '"SARAH" uppercase' },
    { raw: ' Sarah ', expectSarah: true,  expectLexi: false, label: '" Sarah " whitespace' },
    { raw: '',        expectSarah: true,  expectLexi: false, label: '"" empty string' },
    { raw: null,      expectSarah: true,  expectLexi: false, label: 'null' },
    // alex is a DISTINCT assistant — must NOT match the Sarah predicate
    { raw: 'alex',    expectSarah: false, expectLexi: false, label: '"alex" — distinct assistant' },
    { raw: 'Alex',    expectSarah: false, expectLexi: false, label: '"Alex" capitalized — distinct' },
    { raw: 'ALEX',    expectSarah: false, expectLexi: false, label: '"ALEX" uppercase — distinct' },
    { raw: ' alex ',  expectSarah: false, expectLexi: false, label: '" alex " whitespace — distinct' },
    { raw: 'lexi',    expectSarah: false, expectLexi: true,  label: '"lexi" lowercase' },
    { raw: 'Lexi',    expectSarah: false, expectLexi: true,  label: '"Lexi" capitalized' },
    { raw: 'LEXI',    expectSarah: false, expectLexi: true,  label: '"LEXI" uppercase' },
    { raw: 'marcus',  expectSarah: false, expectLexi: false, label: '"marcus"' },
    { raw: 'Marcus',  expectSarah: false, expectLexi: false, label: '"Marcus" capitalized' },
    { raw: 'zara',    expectSarah: false, expectLexi: false, label: '"zara"' },
  ];

  for (const { raw, expectSarah, expectLexi, label } of sqlCases) {
    const sqlResult = sqlSarahPredicate(raw);
    const jsResult  = isSarahRow({ assistant_name: raw });
    ok(`SQL/JS agree isSarahRow(${label})`, sqlResult === jsResult);
    ok(`isSarahRow(${label}) = ${expectSarah}`, sqlResult === expectSarah);

    const sqlLexi = sqlLexiPredicate(raw);
    const jsLexi  = isLexiRow({ assistant_name: raw });
    ok(`SQL/JS agree isLexiRow(${label})`, sqlLexi === jsLexi);
  }

  // ─── Capitalized "Sarah" row still picked over alex/marcus ───────────────
  console.log('\n─── Capitalized "Sarah" row picked over alex+marcus ───');

  const rows4 = [
    makeRow('lexi-cap',   'Lexi',   { edited: true  }),
    makeRow('sarah-cap',  'Sarah',  { edited: true  }), // capitalized — must still be canonical
    makeRow('alex-cap',   'Alex',   { edited: false }), // custom — must survive
    makeRow('marcus-cap', 'Marcus', { edited: false }), // custom — must survive
  ];
  const can4 = pickCanonicalSarahRow(rows4);
  ok('capitalized "Sarah" row is canonical',  can4?.id === 'sarah-cap');
  ok('alex-cap NOT canonical',                can4?.id !== 'alex-cap');
  ok('marcus-cap NOT canonical',              can4?.id !== 'marcus-cap');

  const toDelete4 = identifyDeletableDuplicates(rows4, can4);
  ok('nothing to delete (sarah is only sarah row)', toDelete4.length === 0);
  ok('alex-cap NOT flagged',                        !toDelete4.find(r => r.id === 'alex-cap'));
  ok('marcus-cap NOT flagged',                      !toDelete4.find(r => r.id === 'marcus-cap'));

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED ✅');
  }
})();
