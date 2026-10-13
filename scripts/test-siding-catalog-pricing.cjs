const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const {
    compatibleQuantity,
    isAmbiguousSideAreaRequest,
    repriceSidingMaterialLines,
  } = await import('../src/lib/sidingCatalogPricing.js');
  const { filterPriceListBySource, getActivePriceList } = await import('../src/lib/priceListUtils.js');

  const catalogs = filterPriceListBySource([
    { source: 'Xactimate', code: 'SID AL', description: 'Aluminum siding', unit: 'SQ', price: 700 },
    { source: 'Symbility', code: 'SI-VNL', description: 'Vinyl siding', unit: 'SQ', price: 500 },
    { source: 'Symbility', code: 'SI-ALU', description: 'Siding, aluminum', unit: 'SF', price: 6.25 },
    { source: 'Symbility', code: 'SI-J-ALU', description: 'J-channel, aluminum', unit: 'LF', price: 5 },
    { source: 'Symbility', code: 'SI-OC-ALU', description: 'Outside corner, aluminum', unit: 'LF', price: 9 },
    { source: 'Symbility', code: 'SI-START-ALU', description: 'Starter strip, aluminum', unit: 'EA', price: 12 },
    { source: 'Custom', code: 'CUSTOM-AL', description: 'Aluminum siding', unit: 'SQ', price: 615 },
  ]);
  const lines = [
    { code: 'SID REM', description: 'Remove siding, vinyl or aluminum', unit: 'SQ', quantity: 20, rate: 45, rcv: 900 },
    { code: 'SID VS', description: 'Vinyl siding, standard grade', unit: 'SQ', quantity: 20, rate: 425, rcv: 8500 },
    { code: 'SID J', description: 'J-channel, vinyl (Top)', unit: 'LF', quantity: 120, rate: 3.5, rcv: 420 },
    { code: 'SID OC', description: 'Outside corner, vinyl', unit: 'LF', quantity: 40, rate: 4.25, rcv: 170 },
    { code: 'SID SS', description: 'Starter strips, vinyl (12 ft ea) — 120 LF ÷ 12', unit: 'EA', quantity: 10, rate: 8.5, rcv: 85 },
    { code: 'WP', description: 'House wrap / weather barrier', unit: 'SQ', quantity: 22, rate: 55, rcv: 1210 },
  ];

  const symbility = getActivePriceList('symbility', catalogs);
  const result = repriceSidingMaterialLines(lines, 'aluminum', symbility);
  assert.equal(result.changed, 4);
  assert.deepEqual(result.missing, []);
  assert.equal(result.items[1].code, 'SI-ALU');
  assert.equal(result.items[1].quantity, 2000);
  assert.equal(result.items[1].unit, 'SF');
  assert.equal(result.items[1].rate, 6.25);
  assert.equal(result.items[1].rcv, 12500);
  assert.equal(result.items[2].code, 'SI-J-ALU');
  assert.match(result.items[2].description, /\(Top\)$/);
  assert.equal(result.items[4].rate, 12);
  assert.deepEqual(result.items[0], lines[0]); // removal scope stays untouched
  assert.deepEqual(result.items[5], lines[5]); // wrap has different scope

  const custom = repriceSidingMaterialLines(lines, 'aluminum', getActivePriceList('custom', catalogs));
  assert.equal(custom.items[1].rate, 615);
  assert.equal(custom.items[1].code, 'CUSTOM-AL');
  assert.equal(custom.items[2].rate, 0);
  assert.match(custom.items[2].description, /aluminum j-channel — price needed/);
  assert(custom.missing.some(m => m.includes('j-channel')));
  assert(!custom.items.some(i => /\bvinyl\b/i.test(i.description) && !/\bremove\b/i.test(i.description)));

  const unknown = repriceSidingMaterialLines(lines, null, symbility);
  assert.equal(unknown.items[1].rate, 0);
  assert.match(unknown.items[1].description, /Unconfirmed material/);
  assert.equal(compatibleQuantity(900, 'SF', 'SQ'), 9);
  assert.equal(compatibleQuantity(9, 'SQ', 'SF'), 900);
  assert.equal(compatibleQuantity(10, 'EA', 'LF'), null);
  assert(isAmbiguousSideAreaRequest('redo the estimate using 900 sq a side'));
  assert(!isAmbiguousSideAreaRequest('change siding to 900 square feet total'));

  const page = fs.readFileSync(path.join(__dirname, '../src/pages/AIEstimator.jsx'), 'utf8');
  assert(page.includes('isAmbiguousSideAreaRequest(userMessage)'));
  assert(page.includes('repriceSidingMaterialLines(lineItems, targetMaterial, priceList)'));
  assert(!page.includes('/(\\d+)\\s+([\\w\\s-]+?)(?:\\s*(?:and|,\\s*add|$))/gi'));
  console.log('Siding catalog pricing and ambiguous area guards passed');
})().catch(err => { console.error(err); process.exitCode = 1; });