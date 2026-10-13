'use strict';
const assert = require('node:assert/strict');
(async () => {
  const { findSidingScopeCatalogItem, finalizeSidingCatalogLines, repriceSidingCatalogDraft } = await import('../src/lib/sidingCatalogPricing.js');
  // Actual description/code/unit/rate patterns observed in the imported catalog.
  const catalog = [
    { code: 'SIDING_VINYL_HIGH_GRADE', description: 'R&R Siding - vinyl - High grade', unit: 'SF', price: 6.94 },
    { code: 'SIDING_VINYL', description: 'R&R Siding - vinyl', unit: 'SF', price: 6.6 },
    { code: 'VINYL_OUTSIDE_CORNER_POST', description: 'R&R Vinyl outside corner post', unit: 'LF', price: 9.77 },
    { code: 'VINYL_J_TRIM', description: 'R&R Vinyl J trim', unit: 'LF', price: 6.26 },
    { code: 'SID-REM', description: 'Remove siding, vinyl or aluminum', unit: 'SF', price: 0.45, activity: '-' },
  ];
  const source = [
    { code: 'SID-REM', description: 'Remove siding, vinyl or aluminum', unit: 'SQ', quantity: 36.036 },
    { code: 'SID VS', description: 'Vinyl siding', unit: 'SQ', quantity: 36.036 },
    { code: '', description: 'vinyl outside corner', unit: 'LF', quantity: 379.58 },
    { code: '', description: 'vinyl j-channel', unit: 'LF', quantity: 698.51 },
  ];
  const original = JSON.stringify(source);
  const match = findSidingScopeCatalogItem(catalog, {}, source[1], 'vinyl');
  assert.equal(match.code, 'SIDING_VINYL', 'Base vinyl rather than an arbitrary premium grade');
  assert.equal(match.price, 660, 'Catalog SF rate converted to the generator SQ rate exactly once');
  assert.equal(findSidingScopeCatalogItem(catalog.slice(0, 1), {}, source[1], 'vinyl').price, 0,
    'Do not substitute high-grade siding for an unqualified base-material request');
  const result = finalizeSidingCatalogLines(source, 'vinyl', catalog);
  const siding = result.items.find(item => item.code === 'SIDING_VINYL');
  assert(Math.abs(siding.quantity - 3603.6) < 1e-8);
  assert.equal(siding.unit, 'SF');
  assert.equal(siding.rate, 6.6);
  assert.equal(siding.rcv, 23783.76);
  assert.equal(siding.activity, '&');
  assert(!result.items.some(item => item.code === 'SID-REM'), 'No duplicate base removal alongside combined R&R');
  assert.equal(result.items.find(item => item.code === 'VINYL_OUTSIDE_CORNER_POST').rcv, 3708.5);
  assert.equal(result.items.find(item => item.code === 'VINYL_J_TRIM').rate, 6.26);
  assert.equal(result.items.find(item => item.code === 'VINYL_J_TRIM').rcv, 4372.67);
  const missingTrim = finalizeSidingCatalogLines(source, 'vinyl', catalog.filter(item => item.code !== 'VINYL_J_TRIM'));
  assert.equal(missingTrim.items.find(item => /j-channel/.test(item.description)).rate, 0, 'Missing accessories cannot borrow unrelated prices');
  assert.equal(JSON.stringify(source), original, 'Never mutate the existing source estimate');
  const separateCatalog = [...catalog, { code: 'VINYL_INSTALL', description: 'Siding - vinyl', unit: 'SF', price: 6, activity: '+' }];
  const separate = finalizeSidingCatalogLines(source, 'vinyl', separateCatalog);
  assert(separate.items.some(item => item.code === 'SID-REM'));
  assert(separate.items.some(item => item.code === 'VINYL_INSTALL'));
  const extraRemoval = finalizeSidingCatalogLines([...source, {
    code: 'SID-EXTRA', description: 'Remove additional siding layer', quantity: 1, unit: 'SF',
  }], 'vinyl', [...catalog, {
    code: 'SID-EXTRA', description: 'Remove additional siding layer', unit: 'SF', price: 1, activity: '-',
  }]);
  assert(extraRemoval.items.some(item => item.code === 'SID-EXTRA'));
  const partial = finalizeSidingCatalogLines([
    { ...source[0], quantity: 40 }, source[1],
  ], 'vinyl', catalog);
  const remainingRemoval = partial.items.find(item => item.code === 'SID-REM');
  assert(Math.abs(remainingRemoval.quantity - 396.4) < 1e-8, 'Only the matching R&R area covers base removal');
  assert.equal(remainingRemoval.rcv, 178.38);
  const roof = { description: 'Roof item', quantity: 10, rate: 99, rcv: 250, unit: 'SQ' };
  const draft = [...source.map(item => ({ ...item, pricing_scope: 'siding' })), roof];
  const before = JSON.stringify(draft);
  const repricedDraft = repriceSidingCatalogDraft(draft, 'vinyl', catalog);
  assert.equal(repricedDraft.items.at(-1), roof, 'Do not reprice unrelated scopes or recompute their saved money');
  assert.equal(repricedDraft.items.filter(item => item.code === 'SID-REM').length, 0);
  assert(!repricedDraft.items.some(item => '_sidingDraftIndex' in item));
  assert.equal(JSON.stringify(draft), before);
  const wrapCatalog = { code: 'RR_HOUSE_WRAP_AIRMOISTURE_BARR', description: 'R&R House wrap (air/moisture barrier)', unit: 'SF', price: 0.53 };
  const wrapDraft = repriceSidingCatalogDraft([
    { code: '', description: 'House wrap / weather barrier — price needed', quantity: 36.036, unit: 'SQ', rate: 0, pricing_scope: 'siding' },
  ], 'vinyl', [wrapCatalog]);
  assert.equal(wrapDraft.items[0].code, wrapCatalog.code);
  assert.equal(wrapDraft.items[0].rate, 0.53);
  assert.equal(wrapDraft.items[0].rcv, 1909.91);
  assert.deepEqual(wrapDraft.missing, []);
  const { buildMaterialList } = require('../lib/materialList.cjs');
  const purchases = buildMaterialList({ lineItems: result.items, jobType: 'siding' });
  assert.equal(purchases.materials.find(item => item._materialKind === 'j_channel').quantity, 698.51,
    'The real catalog J-trim description must remain J-channel in the purchase list');
  assert.equal(buildMaterialList({ jobType: 'siding', lineItems: [
    { description: 'Remove & replace Vinyl J trim', quantity: 10, unit: 'LF', activity: '&' },
  ] }).materials[0]._materialKind, 'j_channel');
  console.log('PASS: imported descriptive R&R rates, base grade selection, SQ/SF conversion, no double removal, separate-install preference and missing-price safety.');
})().catch(error => { console.error(error); process.exitCode = 1; });
