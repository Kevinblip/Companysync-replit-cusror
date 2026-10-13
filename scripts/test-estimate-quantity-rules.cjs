#!/usr/bin/env node
/**
 * Line-item SCOPING rules — starter course and house wrap.
 *
 * Benchmark figures come from the Hover measurement report for
 * 5688 Gemini Ct, Solon OH (the house we calibrate against):
 *
 *   Eaves Fascia ............ 171' 1"  (171.08 LF)
 *   Rakes Fascia ............ 123' 1"  (123.08 LF)
 *   Drip Edge/Perimeter ..... 294' 2"  (294.17 LF)  = eaves + rakes
 *   Brick ("Other") facades . 415 ft²
 *   Brick openings .......... 208 ft²  (garage surround)
 *
 * The point of this suite: starter must scope to the EAVES while drip edge
 * scopes to eaves+rakes, and house wrap must NOT be deducted for the brick.
 */

let passed = 0;
let failed = 0;

function check(label, actual, expected, tolerance = 0.01) {
  const ok = typeof expected === 'number'
    ? Math.abs(actual - expected) <= tolerance
    : actual === expected;
  if (ok) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.log(`  \u2717 ${label}\n      expected: ${expected}\n      actual:   ${actual}`);
  }
}

const EAVES = 171.08;
const RAKES = 123.08;
const DRIP = EAVES + RAKES; // 294.16 — Hover reports 294' 2"

(async () => {
  const rules = await import('../src/utils/estimateQuantityRules.js');
  const { starterCourseLF, starterCourseNote, houseWrapBaseSqft } = rules;

  console.log('\n\u2500\u2500 starter course: eaves vs eaves+rakes \u2500\u2500');

  check('default scopes starter to the eaves only',
    starterCourseLF(EAVES, RAKES, false), EAVES);

  check('default starter does NOT equal the drip edge perimeter',
    starterCourseLF(EAVES, RAKES, false) < DRIP, true);

  check('Hover drip edge reproduced by eaves + rakes',
    DRIP, 294.16);

  check('rake starter enabled bills the full perimeter',
    starterCourseLF(EAVES, RAKES, true), DRIP);

  check('enabling rake starter adds exactly the rake length',
    starterCourseLF(EAVES, RAKES, true) - starterCourseLF(EAVES, RAKES, false), RAKES);

  console.log('\n\u2500\u2500 starter course: degenerate inputs \u2500\u2500');

  check('zero eave length falls back to combined edge (line must not vanish)',
    starterCourseLF(0, RAKES, false), RAKES);

  check('zero eave length with rake starter on is still the combined edge',
    starterCourseLF(0, RAKES, true), RAKES);

  check('no roof at all yields zero (line is skipped)',
    starterCourseLF(0, 0, false), 0);

  check('null/undefined inputs coerce to zero rather than NaN',
    starterCourseLF(null, undefined, false), 0);

  check('string inputs coerce numerically',
    starterCourseLF('171.08', '123.08', true), DRIP);

  console.log('\n\u2500\u2500 starter course: audit note \u2500\u2500');

  check('eaves-only note explains the split',
    starterCourseNote(EAVES, false),
    'Eaves only — rakes get drip edge, not starter');

  check('rake-starter note flags that it was a setting',
    starterCourseNote(EAVES, true),
    'Eaves + rakes — rake starter enabled in settings');

  check('fallback note admits the eave length was missing',
    starterCourseNote(0, false),
    'Eave length unavailable — using combined eave + rake edge');

  console.log('\n\u2500\u2500 house wrap: masonry must NOT be deducted \u2500\u2500');

  // Benchmark: net siding after the brick deduction lands near 2193 sqft.
  const NET_SIDING = 2193;
  const graph = { masonry_area_sqft: 415, opening_deduction_masonry_sqft: 208 };

  check('wrap adds masonry back, less the masonry openings',
    houseWrapBaseSqft(NET_SIDING, graph), 2193 + 415 - 208);

  check('wrap basis exceeds the siding basis on a mixed-material house',
    houseWrapBaseSqft(NET_SIDING, graph) > NET_SIDING, true);

  check('all-siding house: wrap equals the siding basis',
    houseWrapBaseSqft(NET_SIDING, { masonry_area_sqft: 0, opening_deduction_masonry_sqft: 0 }),
    NET_SIDING);

  check('missing graph falls back to the siding basis',
    houseWrapBaseSqft(NET_SIDING, null), NET_SIDING);

  check('graph without masonry fields falls back to the siding basis',
    houseWrapBaseSqft(NET_SIDING, {}), NET_SIDING);

  check('malformed graph (openings exceed masonry) can never shrink wrap',
    houseWrapBaseSqft(NET_SIDING, { masonry_area_sqft: 50, opening_deduction_masonry_sqft: 900 }),
    NET_SIDING);

  check('zero siding yields zero wrap',
    houseWrapBaseSqft(0, null), 0);

  console.log('\n\u2500\u2500 house wrap: waste round-trip \u2500\u2500');

  // The array converter recovers net sqft by dividing the waste multiplier back
  // out of wallAreaSQ. Verify that round-trip is lossless before masonry is added.
  const wasteMultiplier = 1.10;
  const wallAreaSQ = (NET_SIDING / 100) * wasteMultiplier;
  const recoveredSqft = (wallAreaSQ / (wasteMultiplier || 1)) * 100;

  check('dividing the waste multiplier back out recovers net sqft',
    recoveredSqft, NET_SIDING);

  check('wrap SQ after re-applying waste includes the masonry',
    (houseWrapBaseSqft(recoveredSqft, graph) / 100) * wasteMultiplier,
    ((2193 + 415 - 208) / 100) * 1.10);

  check('a zero waste multiplier cannot divide by zero',
    Number.isFinite((wallAreaSQ / (0 || 1)) * 100), true);

  console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(`${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\u274c Starter/wrap scoping rules regressed');
    process.exit(1);
  }
  console.log('\u2705 Starter scopes to eaves, drip edge to eaves+rakes, wrap keeps the masonry');
})().catch((err) => {
  console.error('Test harness failed:', err);
  process.exit(1);
});
