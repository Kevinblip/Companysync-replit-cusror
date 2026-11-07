#!/usr/bin/env node
/**
 * Symbility Price List Matching — End-to-End Test
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies that the AI Estimator's line-item matching logic picks correct
 * Symbility items for each roofing category and NEVER picks a wrong-material
 * item (the original bug: "Replace - Wood Shingle, Uncoupled underlayment"
 * being selected as the underlayment line item on fiberglass jobs).
 *
 * Tests exercised:
 *   A) smartDescriptionMatch  — underlayment: wood-shingle item excluded
 *   B) smartDescriptionMatch  — shingle: wood/tile items excluded
 *   C) smartDescriptionMatch  — tear-off: wood/slate/tile items excluded
 *   D) findExactRoofItem      — underlayment keyword path: shingle exclusion
 *   E) findExactRoofItem      — shingle keyword path: wood/tile exclusion
 *   F) findExactRoofItem      — ice & water: correct item selected
 *   G) findExactRoofItem      — ridge cap: correct item selected
 *   H) findExactRoofItem      — tear-off: correct comp-shingle removal
 *   I) No wrong-material item appears across all 8 categories end-to-end
 *
 * Usage: node scripts/test-symbility-price-matching.cjs
 */
'use strict';

let passed = 0, failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } else {
    const msg = detail ? `${name} — ${detail}` : name;
    console.error(`  ❌ FAIL  ${msg}`);
    failures.push(msg);
    failed++;
  }
}

// ── Realistic Symbility price list (traps all known misidentification vectors)
// Each item is purposely named to match Symbility conventions and to expose
// any regression in the exclusion logic.
const SYMBILITY_PRICE_LIST = [
  // ── Shingles ──────────────────────────────────────────────────────────────
  { code: 'SYM-SH-001', description: 'Fiberglass Shingle - 3 Tab, Standard Grade', unit: 'SQ', price: 250 },
  { code: 'SYM-SH-002', description: 'Architectural Laminated Composition Shingle', unit: 'SQ', price: 310 },
  { code: 'RFG SSSQ',   description: 'Asphalt Shingle - Architectural, 30yr', unit: 'SQ', price: 290 },
  // Wrong-material shingles — must never be selected for a fiberglass job
  { code: 'SYM-WD-001', description: 'Replace - Wood Shingle, Resawn', unit: 'SQ', price: 520 },
  { code: 'SYM-WD-002', description: 'Cedar Shake Shingle, Hand-Split', unit: 'SQ', price: 480 },
  { code: 'SYM-TL-001', description: 'Concrete Tile Shingle, Standard', unit: 'SQ', price: 600 },

  // ── Underlayment ──────────────────────────────────────────────────────────
  { code: 'SYM-UL-001', description: 'Felt Underlayment - Synthetic, self-adhered', unit: 'SQ', price: 55 },
  { code: 'RFG UL',     description: 'Roofing Felt - 30 lb organic underlayment', unit: 'SQ', price: 38 },
  // The original bug trigger: wood-shingle underlayment item
  { code: 'SYM-WU-001', description: 'Replace - Wood Shingle, Uncoupled underlayment', unit: 'SQ', price: 410 },
  { code: 'SYM-WU-002', description: 'Cedar Shake underlayment board', unit: 'SQ', price: 190 },

  // ── Ice & Water ───────────────────────────────────────────────────────────
  { code: 'IWS',        description: 'Ice & Water Shield - self-adhered barrier', unit: 'SF', price: 1.85 },
  { code: 'SYM-IW-001', description: 'Ice and Water Barrier, 36" wide roll', unit: 'SF', price: 2.10 },

  // ── Starter ───────────────────────────────────────────────────────────────
  { code: 'SYM-ST-001', description: 'Asphalt Starter Strip, universal', unit: 'LF', price: 2.00 },

  // ── Drip Edge ─────────────────────────────────────────────────────────────
  { code: 'SYM-DE-001', description: 'Drip Edge, galvanized metal, 2" x 4"', unit: 'LF', price: 2.75 },

  // ── Ridge Cap ─────────────────────────────────────────────────────────────
  { code: 'SYM-RC-001', description: 'Ridge Cap Shingle - venting ridge cap', unit: 'LF', price: 11.50 },
  { code: 'RFG RDC',    description: 'R&R Ridge Cap - hip/ridge cap shingles', unit: 'LF', price: 12.00 },
  // Wrong: wood ridge cap — must not be selected
  { code: 'SYM-WRC-001', description: 'Wood Shake Ridge Cap, cedar', unit: 'LF', price: 18.00 },

  // ── Valley ────────────────────────────────────────────────────────────────
  { code: 'SYM-VY-001', description: 'Valley W Flashing, 28 ga galvanized', unit: 'LF', price: 6.50 },

  // ── Tear-off ──────────────────────────────────────────────────────────────
  { code: 'SYM-TO-001', description: 'Remove Comp. Shingle Roofing, 3 Tab', unit: 'SQ', price: 75 },
  { code: 'ARMV',       description: 'Remove Roof Covering - composition shingle', unit: 'SQ', price: 72 },
  // Wrong: slate/tile/wood removals — must not be selected for a comp job
  { code: 'SYM-TS-001', description: 'Remove Slate Shingle Roof covering', unit: 'SQ', price: 120 },
  { code: 'SYM-TT-001', description: 'Remove Tile Roofing, clay or concrete', unit: 'SQ', price: 115 },
  { code: 'SYM-TW-001', description: 'Remove Wood Shake or Shingle roofing', unit: 'SQ', price: 98  },
];

// ── Bad-material detector ─────────────────────────────────────────────────
const WRONG_MATERIAL_TERMS = ['wood', 'shake', 'cedar', 'slate', 'tile', 'clay', 'concrete tile'];
function isWrongMaterial(item) {
  if (!item || !item.description) return false;
  const d = item.description.toLowerCase();
  return WRONG_MATERIAL_TERMS.some(t => d.includes(t));
}

async function runTests() {
  // Dynamic-import the ESM priceListUtils
  const { smartDescriptionMatch } = await import('../src/lib/priceListUtils.js');
  const { pickLineItem } = await import('../src/lib/lineItemPicker.js');
  const findExactRoofItem = (searchTerms, fallback) =>
    pickLineItem(SYMBILITY_PRICE_LIST, searchTerms, fallback);

  console.log('\n── A) smartDescriptionMatch: underlayment ─────────────────────────────────');
  {
    const result = smartDescriptionMatch('roofing felt synthetic underlayment', SYMBILITY_PRICE_LIST);
    ok('Returns a result', !!result, result ? '' : 'no match found');
    ok('Not a wood/shake/cedar/shingle item',
      !isWrongMaterial(result),
      result?.description);
    ok('Contains "felt" or "underlayment" or "roofing"',
      !!result && (result.description.toLowerCase().includes('felt') ||
                   result.description.toLowerCase().includes('underlayment') ||
                   result.description.toLowerCase().includes('roofing')),
      result?.description);
    ok('"Replace - Wood Shingle, Uncoupled underlayment" is NOT returned',
      result?.code !== 'SYM-WU-001',
      result?.description);
    ok('"Cedar Shake underlayment board" is NOT returned',
      result?.code !== 'SYM-WU-002',
      result?.description);
  }

  console.log('\n── B) smartDescriptionMatch: shingle / composition ────────────────────────');
  {
    const result = smartDescriptionMatch('laminate composition shingle roofing', SYMBILITY_PRICE_LIST);
    ok('Returns a result', !!result);
    ok('Not a wood/tile/slate item', !isWrongMaterial(result), result?.description);
    ok('Wood Shingle item NOT returned', result?.code !== 'SYM-WD-001', result?.description);
    ok('Cedar Shake item NOT returned', result?.code !== 'SYM-WD-002', result?.description);
    ok('Tile Shingle item NOT returned', result?.code !== 'SYM-TL-001', result?.description);
  }

  console.log('\n── C) smartDescriptionMatch: tear-off ─────────────────────────────────────');
  {
    const result = smartDescriptionMatch('remove roof covering composition shingle', SYMBILITY_PRICE_LIST);
    ok('Returns a result', !!result);
    ok('Not a wood/shake/slate/tile removal', !isWrongMaterial(result), result?.description);
    ok('Slate removal NOT returned', result?.code !== 'SYM-TS-001', result?.description);
    ok('Tile removal NOT returned', result?.code !== 'SYM-TT-001', result?.description);
    ok('Wood removal NOT returned', result?.code !== 'SYM-TW-001', result?.description);
  }

  console.log('\n── D) findExactRoofItem: underlayment via keyword path ────────────────────');
  {
    const item = findExactRoofItem({
      codes: ['ROOFING_FELT', 'ROOFING_FELT_SYNTH', 'RFG UL'],
      keywords: ['roofing felt', 'synthetic underlayment', 'underlayment'],
      exclude: ['ice', 'water', 'barrier', 'remove', 'wood', 'shake', 'cedar', 'shingle', 'tile', 'metal'],
    }, { price: 45.48, unit: 'SQ', code: 'ROOFING_FELT', description: 'Roofing felt - synthetic underlayment' });

    ok('Returns a result', !!item);
    ok('Not a wrong-material item', !isWrongMaterial(item), item?.description);
    ok('"Replace - Wood Shingle, Uncoupled underlayment" excluded',
      item?.code !== 'SYM-WU-001', item?.description);
    ok('"Cedar Shake underlayment board" excluded',
      item?.code !== 'SYM-WU-002', item?.description);
    // RFG UL code match should resolve before keywords
    ok('Resolves to RFG UL or a felt/synthetic item',
      item?.code === 'RFG UL' || item?.description?.toLowerCase().includes('felt') ||
      item?.description?.toLowerCase().includes('synthetic'),
      item?.description);
  }

  console.log('\n── E) findExactRoofItem: shingle via keyword path ─────────────────────────');
  {
    const item = findExactRoofItem({
      codes: ['LAMINATED_COMP_SH', 'ARCH_COMP_SH', 'RFG SSSQ', '3_TAB__25_YR'],
      keywords: ['composition shingle roofing', 'comp shingle roofing', 'architectural asphalt', 'laminate'],
      exclude: ['wood', 'tile', 'metal', 'remove', 'per shingle', 'per shgl', 'felt', 'ridge', 'hip', 'starter', 'valley'],
    }, { price: 273, unit: 'SQ', code: 'LAMINATED_COMP_SH', description: 'Laminate - comp. shingle roofing - per SQ' });

    ok('Returns a result', !!item);
    ok('Not a wrong-material item', !isWrongMaterial(item), item?.description);
    ok('Wood shingle NOT selected', item?.code !== 'SYM-WD-001', item?.description);
    ok('Cedar shake NOT selected', item?.code !== 'SYM-WD-002', item?.description);
    ok('Tile shingle NOT selected', item?.code !== 'SYM-TL-001', item?.description);
    // RFG SSSQ code match should win
    ok('Resolves to RFG SSSQ or an asphalt/fiberglass item',
      item?.code === 'RFG SSSQ' ||
      item?.description?.toLowerCase().includes('fiberglass') ||
      item?.description?.toLowerCase().includes('architectural') ||
      item?.description?.toLowerCase().includes('asphalt') ||
      item?.description?.toLowerCase().includes('laminated'),
      item?.description);
  }

  console.log('\n── F) findExactRoofItem: ice & water ──────────────────────────────────────');
  {
    const item = findExactRoofItem({
      codes: ['ICE__WATER_B', 'ICE_WATER_B', 'IWS', 'RFG IWS'],
      keywords: ['ice & water barrier', 'ice and water barrier', 'ice and water'],
      exclude: [],
    }, { price: 2.02, unit: 'SF', code: 'ICE__WATER_B', description: 'Ice & water barrier' });

    ok('Returns a result', !!item);
    // IWS code match should fire first
    ok('Resolves to IWS code or ice & water description',
      item?.code === 'IWS' || item?.code === 'SYM-IW-001' ||
      item?.description?.toLowerCase().includes('ice'),
      item?.description);
  }

  console.log('\n── G) findExactRoofItem: ridge cap ────────────────────────────────────────');
  {
    const item = findExactRoofItem({
      codes: ['RR_RIDGE_CAP', 'RFG RDC', 'RIDGE_CAP'],
      keywords: ['ridge cap - venting', 'r&r ridge cap', 'venting ridge cap'],
      exclude: [],
    }, { price: 12.59, unit: 'LF', code: 'RR_RIDGE_CAP', description: 'R&R Ridge cap - venting ridge cap shingles' });

    ok('Returns a result', !!item);
    ok('Resolves to RFG RDC or a ridge cap description',
      item?.code === 'RFG RDC' || item?.code === 'SYM-RC-001' ||
      item?.description?.toLowerCase().includes('ridge'),
      item?.description);
  }

  console.log('\n── H) findExactRoofItem: tear-off ─────────────────────────────────────────');
  {
    const item = findExactRoofItem({
      codes: ['REMOVE_3_TAB', 'TEAR_OFF_HAU', 'RFG R&R', 'ARMV'],
      keywords: ['remove 3 tab', 'remove composition shingle', 'remove comp. shingle', 'tear off', 'remove roof covering'],
      exclude: ['per shingle', 'per shgl'],
    }, { price: 76.31, unit: 'SQ', code: 'REMOVE_3_TAB', description: 'Remove 3 tab - 25 yr. - comp. shingle roofing' });

    ok('Returns a result', !!item);
    ok('Not a wrong-material removal', !isWrongMaterial(item), item?.description);
    ok('ARMV code match or comp removal description',
      item?.code === 'ARMV' || item?.code === 'SYM-TO-001' ||
      item?.description?.toLowerCase().includes('comp') ||
      item?.description?.toLowerCase().includes('remove'),
      item?.description);
    ok('Slate removal NOT selected', item?.code !== 'SYM-TS-001', item?.description);
    ok('Tile removal NOT selected', item?.code !== 'SYM-TT-001', item?.description);
    ok('Wood removal NOT selected', item?.code !== 'SYM-TW-001', item?.description);
  }

  console.log('\n── I) End-to-end: all 8 categories — no wrong-material item ───────────────');
  {
    // Simulate the full convertMeasurementsToLineItemsArray call with fake measurements
    const measurements = {
      corrected_area_sq: 25,
      roof_area_sq: 25,
      eave_lf: 120,
      rake_lf: 80,
      valley_lf: 40,
      ridge_lf: 60,
      hip_lf: 30,
    };

    const items = [];
    const helperCorrectedSq = measurements.corrected_area_sq;
    const eavesLF = measurements.eave_lf;
    const valleysLF = measurements.valley_lf;
    const rakeLF = measurements.rake_lf;
    const ridgeLF = measurements.ridge_lf;
    const hipLF = measurements.hip_lf;
    const totalEdge = rakeLF + eavesLF;
    const helperIceWaterSF = Math.max(Math.ceil((eavesLF * 3 + valleysLF * 2) * 1.10), 50);

    const shingle   = findExactRoofItem({ codes: ['LAMINATED_COMP_SH', 'ARCH_COMP_SH', 'RFG SSSQ', '3_TAB__25_YR'], keywords: ['composition shingle roofing', 'comp shingle roofing', 'architectural asphalt', 'laminate'], exclude: ['wood', 'tile', 'metal', 'remove', 'per shingle', 'per shgl', 'felt', 'ridge', 'hip', 'starter', 'valley'] }, { price: 273, unit: 'SQ', code: 'LAMINATED_COMP_SH', description: 'Laminate - comp. shingle roofing - per SQ' });
    const underlay  = findExactRoofItem({ codes: ['ROOFING_FELT', 'ROOFING_FELT_SYNTH', 'RFG UL'], keywords: ['roofing felt', 'synthetic underlayment', 'underlayment'], exclude: ['ice', 'water', 'barrier', 'remove', 'wood', 'shake', 'cedar', 'shingle', 'tile', 'metal'] }, { price: 45.48, unit: 'SQ', code: 'ROOFING_FELT', description: 'Roofing felt - synthetic underlayment' });
    const iws       = findExactRoofItem({ codes: ['ICE__WATER_B', 'ICE_WATER_B', 'IWS', 'RFG IWS'], keywords: ['ice & water barrier', 'ice and water barrier', 'ice and water'], exclude: [] }, { price: 2.02, unit: 'SF', code: 'ICE__WATER_B', description: 'Ice & water barrier' });
    const starter   = findExactRoofItem({ codes: ['ASPHALT_STAR', 'RFG STR', 'STARTER'], keywords: ['asphalt starter', 'starter course', 'starter strip'], exclude: [] }, { price: 2.18, unit: 'LF', code: 'ASPHALT_STAR', description: 'Asphalt starter' });
    const drip      = findExactRoofItem({ codes: ['RR_DRIP_EDGE', 'RFG DE', 'DRIP_EDGE'], keywords: ['drip edge', 'r&r drip edge', 'drip metal'], exclude: [] }, { price: 3.16, unit: 'LF', code: 'RR_DRIP_EDGE', description: 'R&R Drip edge' });
    const ridge     = findExactRoofItem({ codes: ['RR_RIDGE_CAP', 'RFG RDC', 'RIDGE_CAP'], keywords: ['ridge cap - venting', 'r&r ridge cap', 'venting ridge cap'], exclude: [] }, { price: 12.59, unit: 'LF', code: 'RR_RIDGE_CAP', description: 'R&R Ridge cap - venting ridge cap shingles' });
    const valley    = findExactRoofItem({ codes: ['RR_VALLEY_W', 'VMTLWP', 'RFG VLY'], keywords: ['valley "w" flashing', 'valley w flashing', 'valley metal', 'valley flashing'], exclude: ['metal roofing', 'for metal', 'standing seam', 'galv', 'copper'] }, { price: 7.12, unit: 'LF', code: 'RR_VALLEY_W', description: 'R&R Valley "W" flashing' });
    const tearOff   = findExactRoofItem({ codes: ['REMOVE_3_TAB', 'TEAR_OFF_HAU', 'RFG R&R', 'ARMV'], keywords: ['remove 3 tab', 'remove composition shingle', 'remove comp. shingle', 'tear off', 'remove roof covering'], exclude: ['per shingle', 'per shgl'] }, { price: 76.31, unit: 'SQ', code: 'REMOVE_3_TAB', description: 'Remove 3 tab - 25 yr. - comp. shingle roofing' });

    items.push(
      { category: 'Shingle',       item: shingle,  qty: helperCorrectedSq },
      { category: 'Underlayment',  item: underlay, qty: helperCorrectedSq },
      { category: 'Ice & Water',   item: iws,      qty: helperIceWaterSF },
      { category: 'Starter',       item: starter,  qty: totalEdge },
      { category: 'Drip Edge',     item: drip,     qty: totalEdge },
      { category: 'Ridge Cap',     item: ridge,    qty: ridgeLF },
      { category: 'Valley',        item: valley,   qty: valleysLF },
      { category: 'Tear-off',      item: tearOff,  qty: helperCorrectedSq },
    );

    let anyWrongMaterial = false;
    for (const { category, item } of items) {
      const wrong = isWrongMaterial(item);
      ok(`${category}: not a wrong-material item`, !wrong, item?.description);
      if (wrong) anyWrongMaterial = true;
      console.log(`       → ${category}: "${item?.description}" (code=${item?.code}, price=${item?.price})`);
    }
    ok('No wrong-material item in any category', !anyWrongMaterial);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────');
  if (failed === 0) {
    console.log(`✅  All ${passed} tests passed`);
  } else {
    console.log(`❌  ${failed} test(s) failed, ${passed} passed`);
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  • ${f}`));
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
