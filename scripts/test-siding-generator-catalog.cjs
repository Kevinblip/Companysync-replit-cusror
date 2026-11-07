const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const { findSidingScopeCatalogItem, finalizeSidingCatalogLines, sidingPricingIssues, sidingMaterial } =
    await import('../src/lib/sidingCatalogPricing.js');
  const { getActivePriceList } = await import('../src/lib/priceListUtils.js');
  const catalog = [
    { code: 'ROOF-NAIL', description: 'Hip/ridge/rake/eave nails', unit: 'EA', price: 2.44 },
    { code: 'SID-NAIL', description: 'Nails, 25-lb box (siding)', unit: 'EA', price: 45 },
    { code: 'SID-V', description: 'Siding - vinyl', unit: 'SF', price: 5, activity: '+' },
    { code: 'SID-V-R', description: 'Siding - vinyl', unit: 'SF', price: 1, activity: '-' },
    { code: 'SID-V-RR', description: 'Siding - vinyl', unit: 'SF', price: 6, activity: '&' },
    { code: 'SID-J', description: 'J-channel, vinyl', unit: 'LF', price: 4 },
    { code: 'SID-ST', description: 'Starter strip, vinyl', unit: 'LF', price: 2 },
    { code: 'SID-REM', description: 'Remove siding, vinyl or aluminum', unit: 'SF', price: 0.45, activity: '-' },
    { code: 'WRAP', description: 'House wrap / weather barrier', unit: 'SF', price: 0.55 },
  ];
  const search = { codes: ['SID NAIL'], keywords: ['nail'], exclude: ['roofing'] };
  const nails = { code: 'SID NAIL', description: 'Nails, 25-lb box (siding)', unit: 'EA', price: 999 };
  assert.equal(findSidingScopeCatalogItem(catalog, search, nails, 'vinyl').code, 'SID-NAIL');
  const missing = findSidingScopeCatalogItem(catalog.slice(0, 1), search, nails, 'vinyl');
  assert.equal(missing.code, '');
  assert.equal(missing.price, 0, 'Do not fall back to a made-up price or roofing item');
  assert.equal(findSidingScopeCatalogItem([
    { code: 'SID NAIL', description: 'Hip/ridge/rake/eave nails', unit: 'EA', price: 2.44 },
  ], search, nails, 'vinyl').price, 0, 'Exact code does not override trade validation');
  assert.equal(findSidingScopeCatalogItem([
    { code: 'SID NAIL', description: 'Nails, siding', unit: 'LB', price: 5 },
  ], search, nails, 'vinyl').price, 0, 'Do not treat pounds as boxes');

  const lines = [
    { code: 'SID-REM', description: 'Remove siding, vinyl or aluminum', quantity: 36.03, unit: 'SQ', rate: 45 },
    { code: 'SID-V', description: 'Vinyl siding', quantity: 36.03, unit: 'SQ', rate: 0 },
    { code: 'SID-J', description: 'J-channel, vinyl (Top)', quantity: 371.34, unit: 'LF', rate: 0 },
    { code: 'SID-ST', description: 'Starter strip, vinyl', quantity: 327.17, unit: 'LF', rate: 0 },
    { code: 'WRAP', description: 'House wrap / weather barrier', quantity: 36.03, unit: 'SQ', rate: 55 },
  ];
  const result = finalizeSidingCatalogLines(lines, 'vinyl', catalog);
  assert.deepEqual(result.missing, []);
  assert.equal(result.items[0].unit, 'SF');
  assert.equal(result.items[0].quantity, 3603);
  assert.equal(result.items[0].rcv, 1621.35);
  assert.equal(result.items[1].code, 'SID-V', 'Do not select remove-only or R&R activities for separate installation');
  assert.equal(result.items[1].activity, '+');
  assert.equal(result.items[1].quantity, 3603);
  assert.equal(result.items[1].rcv, 18015);
  assert.equal(result.items[2].rcv, 1485.36);
  assert.equal(result.items[3].quantity, 327.17, 'Keep actual LF, not rounded 12ft strips');
  assert.equal(result.items[3].rcv, 654.34);
  assert.equal(result.items[4].rcv, 1981.65);
  assert.equal(sidingPricingIssues(result.items).length, 0);

  const incomplete = finalizeSidingCatalogLines(lines, 'aluminum', catalog);
  assert(incomplete.missing.length > 0);
  assert.equal(incomplete.items[1].rate, 0);
  assert(sidingPricingIssues(incomplete.items).length > 0);
  assert.equal(sidingMaterial('vinyl or aluminum'), null);
  assert(Math.abs(findSidingScopeCatalogItem(catalog, {}, {
    description: 'House wrap / weather barrier', unit: 'SQ',
  }, 'vinyl').price - 55) < 1e-9);
  assert.equal(findSidingScopeCatalogItem([
    { code: 'DEB', description: 'Debris haul away', unit: 'EA', price: 250 },
  ], {}, { description: 'Haul away debris', unit: 'EA' }, 'vinyl').price, 250);
  const vinylRemoval = findSidingScopeCatalogItem([
    { code: 'ASB', description: 'Remove Tear off asbestos siding (no haul off)', unit: 'SF', price: 5.03, activity: '-' },
    { code: 'VTO', description: 'ITEL, Siding, Vinyl, Lap, Tear Out', unit: 'SF', price: 0.58, activity: '-' },
  ], { codes: ['SID REM'], keywords: ['remove siding', 'tear off siding'] }, {
    description: 'Remove siding, vinyl or aluminum', unit: 'SF',
  }, 'vinyl');
  assert.equal(vinylRemoval.code, 'VTO', 'A vinyl tear-out must not fall through to asbestos');
  assert.equal(/asbestos/i.test(vinylRemoval.description), false);
  assert.equal(findSidingScopeCatalogItem([
    { code: 'ASB', description: 'Remove Tear off asbestos siding (no haul off)', unit: 'SF', price: 5.03, activity: '-' },
  ], {}, { description: 'Remove siding, vinyl or aluminum', unit: 'SF' }, 'vinyl').price, 0,
  'Asbestos is not a stand-in when the measured material is vinyl');
  assert.equal(findSidingScopeCatalogItem([
    { code: 'FSC', description: 'Aluminum fascia', unit: 'LF', price: 4.2 },
    { code: 'SFT', description: 'Soffit, vinyl', unit: 'SF', price: 3.1 },
    { code: 'GUT', description: 'Gutter / downspout - aluminum - up to 5"', unit: 'LF', price: 8 },
  ], {}, { description: 'Fascia', unit: 'LF' }, 'vinyl').code, 'FSC');
  assert.equal(getActivePriceList('xactimate_new', {
    xactimateNewPriceList: [], xactimatePriceList: catalog,
  }), catalog, 'An imported Xactimate catalog must not disappear behind the New source alias');

  const page = fs.readFileSync('src/pages/AIEstimator.jsx', 'utf8');
  assert.equal((page.match(/findSidingScopeCatalogItem\(priceList, searchTerms, fallback, material\)/g) || []).length, 2);
  for (const name of ['handleExportToXactimate', 'handleExportXactimateExcel', 'handleExportToSymbility']) {
    assert.match(page, new RegExp(`const ${name} = (?:async )?\\(\\) => \\{\\s*if \\(!ensureCompleteSidingPricing\\(\\)\\) return;`));
  }
  const saveHandler = page.slice(page.indexOf('const handleSaveEstimate ='), page.indexOf('const handleSaveEstimate =') + 600);
  assert(!saveHandler.includes('ensureCompleteSidingPricing'), 'Pricing review must never block starting a save');
  assert(saveHandler.includes('toast.warning'), 'Unresolved pricing is a non-blocking save warning');
  const persistHandler = page.slice(page.indexOf('const completeSaveEstimate ='), page.indexOf('const handleSaveEstimate ='));
  assert(!persistHandler.includes('ensureCompleteSidingPricing'), 'Pricing review must never block persistence for creates or updates');
  assert(persistHandler.includes('const items = lineItems;'), 'Persist the current user-edited rows without repricing');
  assert(!page.includes('Saving and estimate exports are blocked'));
  assert(page.includes('testId="siding-material-summary"'));
  assert(!page.includes('aria-label="Confirm siding material"'));
  assert(page.includes('data-testid="siding-pricing-incomplete"'));
  console.log('Siding catalog matching, unit conversion, non-blocking saves and export guards passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
