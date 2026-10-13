import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseEstimateChatShortcut as parse, resolveEstimateEditIndex as resolve, isRoofSurcharge, createRoofSurchargeLine, getEstimateChatCatalog, findChimneyFlashingItem, searchEstimateCatalog } from '../src/utils/estimateChatEdits.js';
import { loadCompanyPriceCatalog, SHARED_PRICE_CATALOG_COMPANY_ID } from '../src/lib/loadCompanyPriceCatalog.js';

assert.deepEqual(parse('apply high roof'), [{ type: 'high' }]);
assert.deepEqual(parse('why is the price higher?'), []);
assert.deepEqual(parse('change roof vent to 3'), [{ type: 'change_qty', searchTerm: 'roof vent', quantity: 3, unit: null }]);
assert.deepEqual(parse('change line 3 to $200'), [{ type: 'change_rate', searchTerm: 'line 3', rate: 200 }]);
assert.deepEqual(parse('set shingles rate to 200 per SQ'), [{ type: 'change_rate', searchTerm: 'shingles', rate: 200 }]);
assert.deepEqual(parse('set line 2 to 500 SF'), [{ type: 'change_qty', searchTerm: 'line 2', quantity: 500, unit: 'SF' }]);
assert.deepEqual(parse('remove pipe boot'), [{ type: 'remove_item', searchTerm: 'pipe boot' }]);
assert.deepEqual(parse('add 1 roof vent'), [{ type: 'add_item', description: 'roof vent', quantity: 1, unit: 'EA' }]);
assert.deepEqual(parse('add a dumpster and change shingles to 25 SQ'), [
  { type: 'add_item', description: 'dumpster', quantity: 1, unit: 'EA' },
  { type: 'change_qty', searchTerm: 'shingles', quantity: 25, unit: 'SQ' },
]);
assert.deepEqual(parse('add steep charges and chimney flashing'), [
  { type: 'steep' }, { type: 'add_item', description: 'chimney flashing', quantity: 1, unit: 'EA' },
]);
assert.deepEqual(parse('add 2 chimney flashing'), [{ type: 'add_item', description: 'chimney flashing', quantity: 2, unit: 'EA' }]);
assert.deepEqual(parse('what about chimney flashing?'), [], 'a question is not authorization to bill another item');
assert.deepEqual(parse('show the items and change line 2 to 5'), []);
assert.deepEqual(parse('make it $510 per SQ'), [], 'whole-estimate targets are not item-rate edits');
assert.deepEqual(parse('set total to $32000'), []);
assert.equal(resolve([{ description: 'Roof vent' }, { description: 'Roof vent' }], 'roof vent'), -1);
assert.equal(resolve([{ description: 'Roof vent' }, { description: 'Roof vent' }], 'line 2'), 1);
assert.equal(resolve([{ description: 'Roof vent' }], 'line 20'), -1);
const slate = { code: '3273_R', description: 'R&R Slate roofing - High grade', unit: 'SQ', price: 1 };
assert.equal(isRoofSurcharge(slate, 'high'), false, 'the screenshot slate item is NOT a height surcharge');
assert.equal(isRoofSurcharge({ description: 'Additional charge for high roof (2 stories or greater)', unit: 'SQ', price: 32 }, 'high'), true);
assert.equal(isRoofSurcharge({ description: 'Remove Additional charge for steep roof - 10/12', unit: 'SQ', price: 17.71 }, 'steep'), true);
assert.equal(isRoofSurcharge({ description: 'High roof', unit: 'EA', price: 32 }, 'high'), false, 'area must not be billed as each');
assert.equal(isRoofSurcharge({ description: 'High roof', unit: 'SQ', price: 0 }, 'high'), false);
assert.equal(isRoofSurcharge({ description: 'R&R Add charge for sheathing steep roof - 10/12 - 12/12 slope', unit: 'SF', price: 0.5 }, 'steep'), false);
assert.equal(createRoofSurchargeLine({ code: 'HIGH', description: 'High roof', unit: 'SF', price: 0.32 }, 22.71, 2).rcv, 726.72);
const source = readFileSync('src/pages/AIEstimator.jsx', 'utf8');
assert.ok(source.includes('const commands = parseEstimateChatShortcut(userMessage)'));
assert.ok(source.includes("isRoofSurcharge(item, 'high')"));
assert.ok(source.includes('resolveEstimateEditIndex(updatedItems, searchTerm)'));
assert.ok(source.includes('The AI returned no usable edit.'));
const start = source.indexOf('  const processWithAI = async');
const end = source.indexOf('  const _generateAndSetEstimate', start);
const handler = source.slice(start, end).replace('const processWithAI =', 'globalThis.processWithAI =');
const initialItems = [
  { line: 1, code: 'SH', description: 'Laminate - comp. shingle roof', quantity: 26, unit: 'SQ', rate: 273, rcv: 7098, acv: 7098, amount: 7098 },
  { line: 2, code: 'VENT', description: 'Roof vent - box type', quantity: 2, unit: 'EA', rate: 80, rcv: 160, acv: 160, amount: 160 },
];
function harness(catalog = [], llm = async () => { throw new Error('Unexpected AI call'); }, legacyCatalog = [], options = {}) {
  const state = { items: structuredClone(initialItems), messages: [], history: 0, processing: false, generated: false };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    lineItems: state.items, messages: [], currentEstimate: { roof_area_sq: 22.71 },
    satelliteAnalysis: { roof_area_sq: 22.71, pitch: '11/12' },
    pricingSource: 'xactimate_new', xactimatePriceList: legacyCatalog, xactimateNewPriceList: catalog, symbilityPriceList: [], customPriceList: [],
    allPriceListItems: options.allItems, myCompany: options.companyId ? { id: options.companyId } : null,
    parseEstimateChatShortcut: parse, resolveEstimateEditIndex: resolve, isRoofSurcharge, createRoofSurchargeLine,
    getEstimateChatCatalog, findChimneyFlashingItem, searchEstimateCatalog,
    isAmbiguousSideAreaRequest: () => false, sidingMaterial: () => null,
    getActivePriceList: () => catalog,
    smartDescriptionMatch: () => null,
    findSidingCatalogItem: () => null,
    compatibleQuantity: (qty, from, to) => !from || from === to ? qty : from === 'SF' && to === 'SQ' ? qty / 100 : from === 'SQ' && to === 'SF' ? qty * 100 : null,
    setIsProcessing: value => { state.processing = value; }, setMissingSuggestions() {},
    setMessages: update => { state.messages = update(state.messages); },
    setLineItems: value => { state.items = value; },
    setCurrentEstimate() {}, saveToHistory: () => { state.history++; },
    base44: { integrations: { Core: { InvokeLLM: llm } } },
    _generateAndSetEstimate: () => { state.generated = true; },
  };
  vm.runInNewContext(handler, sandbox);
  return { state, run: sandbox.processWithAI };
}
{
  const h = harness([slate, { code: 'HIGH', description: 'Additional charge for high roof', unit: 'SQ', price: 32 }]);
  await h.run('apply high roof');
  assert.equal(h.state.items.length, 3);
  assert.equal(h.state.items[2].code, 'HIGH');
  assert.equal(h.state.items[2].rcv, 726.72);
  assert.equal(h.state.processing, false);
}
{
  const h = harness([slate]);
  await h.run('apply high roof');
  assert.equal(h.state.items.length, 2);
  assert.match(h.state.messages.at(-1).content, /Nothing was added/);
}
{
  const h = harness();
  await h.run('change roof vents to 3');
  assert.equal(h.state.items.length, 2, 'changing a vent quantity must not add another vent');
  assert.equal(h.state.items[1].quantity, 3);
}
{
  const h = harness();
  await h.run('set line 1 rate to $200 per SQ');
  assert.equal(h.state.items[0].rate, 200);
  assert.equal(h.state.items[0].quantity, 26);
  assert.equal(h.state.items[0].rcv, 5200);
  assert.equal(h.state.items[1].rate, 80, 'unrelated lines must not be repriced');
}
{
  const h = harness([], async () => { throw new Error('AI temporarily unavailable'); });
  await h.run('please revise the wording of line 1');
  assert.deepEqual(h.state.items, initialItems);
  assert.equal(h.state.generated, false, 'failed editing must never regenerate the existing estimate');
  assert.equal(h.state.processing, false);
  assert.match(h.state.messages.at(-1).content, /No changes were made/);
}
{
  const h = harness([], async () => ({}));
  await h.run('please revise the wording of line 1');
  assert.deepEqual(h.state.items, initialItems);
  assert.equal(h.state.generated, false);
  assert.match(h.state.messages.at(-1).content, /no usable edit/);
}
{
  const h = harness([], async () => ({ operations: [
    { type: 'remove_item', searchTerm: 'line 2' },
    { type: 'add_item', description: 'unavailable replacement', quantity: 1, unit: 'EA' },
  ] }));
  await h.run('remove line 2 and add an unavailable replacement');
  assert.deepEqual(h.state.items, initialItems, 'failed replacement must not remove the original line');
  assert.equal(h.state.history, 0);
  assert.match(h.state.messages.at(-1).content, /No changes were applied/);
}
console.log('PASS: actual chat handler applies quantity/rate edits, selects correct surcharges, and preserves the estimate on AI failures');
{
  const malformedNew = [{ source: 'Xactimate_New', code: 'NEW_STEEP', description: '3,323. Remove Additional charge for steep roof -', unit: 'EA', price: 17.71 }];
  const legacy = [
    { source: 'Xactimate', code: 'SHEATH', description: 'R&R Add charge for sheathing steep roof - 10/12 - 12/12 slope', unit: 'SF', price: 0.5 },
    { source: 'Xactimate', code: 'STEEP_REMOVE_7', description: 'Remove Additional charge for steep roof - 7/12 to 9/12 slope', unit: 'SQ', price: 17.71 },
    { source: 'Xactimate', code: 'STEEP_REMOVE_10', description: 'Remove Additional charge for steep roof - 10/12 - 12/12 slope', unit: 'SQ', price: 27.83 },
    { source: 'Xactimate', code: 'STEEP_ADD_10', description: 'Additional charge for steep roof - 10/12 - 12/12 slope', unit: 'SQ', price: 84.56 },
    { source: 'Xactimate', code: 'CHIMNEY_COPPER', description: 'R&R Chimney flashing - average (32" x 36") - copper', unit: 'EA', price: 865.33 },
    { source: 'Xactimate', code: 'CHIMNEY_AVG', description: 'R&R Chimney flashing - average (32" x 36")', unit: 'EA', price: 543.17 },
  ];
  const h = harness(malformedNew, undefined, legacy);
  await h.run('add steep charges and chimney flashing');
  assert.deepEqual(Array.from(h.state.items.slice(2), i => i.code), ['STEEP_REMOVE_10', 'STEEP_ADD_10', 'CHIMNEY_AVG']);
  assert.equal(h.state.items[2].quantity, 22.71);
  assert.equal(h.state.items[2].unit, 'SQ');
  assert.equal(h.state.items[4].quantity, 1);
  assert.equal(h.state.items[4].rate, 543.17);
  assert.equal(h.state.history, 1);
  assert.equal(findChimneyFlashingItem(legacy, 'copper chimney flashing').code, 'CHIMNEY_COPPER');
  assert.equal(getEstimateChatCatalog('custom', { xactimatePriceList: legacy, customPriceList: [] }).length, legacy.length);
  assert.equal(getEstimateChatCatalog('symbility', { xactimatePriceList: legacy, symbilityPriceList: [] }).length, legacy.length);
  assert.ok(!h.state.messages.at(-1).content.includes('No changes'));
}
console.log('PASS: mixed Xactimate imports, real steep-rate tiers, and average chimney flashing add together without AI or guessed units/prices');
{
  const allItems = [
    { id: 'shared', company_id: SHARED_PRICE_CATALOG_COMPANY_ID, source: 'Xactimate', code: 'CLEAN', description: 'Roof cleaning', price: 15, unit: 'EA' },
    { id: 'own-xac', company_id: 'company-a', source: 'Xactimate', code: 'CLEAN', description: 'Roof cleaning', price: 18, unit: 'EA' },
    { id: 'own-custom', company_id: 'company-a', source: 'Custom', code: 'DECK-99', description: 'Custom deck staining', price: 125, unit: 'EA' },
    { id: 'own-vendor', company_id: 'company-a', source: 'My uploaded supplier', code: 'DRAIN-9', name: 'Custom drain installation', price: 55, unit: 'EA' },
    { id: 'inactive', company_id: 'company-a', source: 'Custom', code: 'OLD', description: 'Old item', price: 500, unit: 'EA', is_active: false },
    { id: 'other', company_id: 'company-b', source: 'Custom', code: 'PRIVATE', description: 'Private item', price: 999, unit: 'EA' },
    { id: 'free', company_id: 'company-a', source: 'Custom', code: 'FREE-1', description: 'No charge inspection', price: 0, unit: 'EA' },
  ];
  const catalog = getEstimateChatCatalog('xactimate_new', { allPriceListItems: allItems, companyId: 'company-a' });
  assert.equal(catalog[0].id, 'own-xac', 'company pricing wins over shared pricing within the preferred source');
  assert.equal(searchEstimateCatalog(catalog, 'PRIVATE').length, 0);
  assert.equal(searchEstimateCatalog(catalog, 'OLD').length, 0);
  assert.equal(searchEstimateCatalog(catalog, 'DECK-99')[0].price, 125);
  assert.equal(searchEstimateCatalog(catalog, 'drain installation')[0].id, 'own-vendor');
  const h = harness([], undefined, [], { allItems, companyId: 'company-a' });
  await h.run('add 2 DECK-99');
  assert.equal(h.state.items[2].rcv, 250);
  assert.equal(h.state.items[2].catalog_source, 'Custom');
  assert.equal(h.state.items[2].catalog_item_id, 'own-custom');
  const free = harness([], undefined, [], { allItems, companyId: 'company-a' });
  await free.run('add 1 FREE-1');
  assert.equal(free.state.items[2].rate, 0);
  assert.equal(free.state.items[2].rcv, 0);
  const otherCompany = harness([], undefined, [], { allItems, companyId: 'company-b' });
  await otherCompany.run('add 1 DECK-99');
  assert.deepEqual(otherCompany.state.items, initialItems);
}
{
  const rows = Array.from({ length: 50001 }, (_, index) => ({ id: `item-${index}`, description: `Catalog item ${index}`, code: `CODE-${index}`, unit: 'EA', price: 1 }));
  const requests = [];
  const loaded = await loadCompanyPriceCatalog({ filter: async (filters, sort, limit) => {
    assert.deepEqual(filters.company_id.$in, ['company-a', SHARED_PRICE_CATALOG_COMPANY_ID]);
    requests.push(limit);
    return rows.slice(0, limit);
  } }, 'company-a');
  assert.equal(loaded.length, 50001);
  assert.deepEqual(requests, [50000, 100000]);
  assert.equal(searchEstimateCatalog(loaded, 'CODE-50000')[0].id, 'item-50000');
}
console.log('PASS: all uploaded sources, company isolation, shared/own price preference, zero-rate items, and catalogs exceeding 50,000 rows');
{
  const allItems = Array.from({ length: 130 }, (_, index) => ({
    id: `unrelated-${index}`, company_id: 'company-a', source: 'Xactimate',
    code: `UNRELATED-${index}`, description: 'Unrelated roofing material', unit: 'EA', price: 10,
  }));
  allItems.push({ id: 'late-custom', company_id: 'company-a', source: 'My supplier', code: 'BRUSH-LAST', description: 'Odd proprietary brush coat', unit: 'SF', price: 3.75 });
  let calls = 0;
  const h = harness([], async request => {
    calls++;
    assert.ok(request.prompt.includes('BRUSH-LAST|Odd proprietary brush coat|$3.75/SF|source=My supplier'));
    assert.ok(request.prompt.includes('all 131 active line items'));
    return { mode: 'answer', chat_reply: 'Odd proprietary brush coat is available.' };
  }, [], { allItems, companyId: 'company-a' });
  await h.run('is odd proprietary brush coat available?');
  assert.equal(calls, 1);
  assert.deepEqual(h.state.items, initialItems);
}
assert.ok(readFileSync('src/hooks/usePriceList.js', 'utf8').includes("queryKey: ['price-list-items', myCompany?.id]"));
assert.ok(readFileSync('src/pages/Items.jsx', 'utf8').includes('loadCompanyPriceCatalog(base44.entities.PriceListItem, myCompany.id)'));
console.log('PASS: AI reference retrieval finds late uploaded items and shares the Items screen refresh cache');
