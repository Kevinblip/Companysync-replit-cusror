'use strict';
const assert = require('node:assert/strict');
const { buildMaterialList } = require('../lib/materialList.cjs');

const lines = [
  { description: 'Vinyl siding', quantity: 18, unit: 'SQ', rcv: 3600 },
  { description: 'Vinyl J-channel (top)', quantity: 145, unit: 'LF', rcv: 290 },
  { description: 'Vinyl J-channel (windows)', quantity: 75, unit: 'LF', rcv: 150 },
  { description: 'Vinyl outside corner posts', quantity: 42, unit: 'LF', rcv: 180 },
  { description: 'Starter strips, vinyl', quantity: 150, unit: 'LF', rcv: 300 },
  { description: 'Siding nails (25 lb box)', quantity: 3, unit: 'box', rcv: 135 },
  { description: 'Electrical box extension (light)', quantity: 4, unit: 'EA', rcv: 60 },
  { description: 'Water hose bib mounting block, vinyl', quantity: 2, unit: 'EA', rcv: 40 },
  { description: 'Caulk, exterior grade (tube)', quantity: 6, unit: 'tube', rcv: 48 },
  { description: 'Remove siding, vinyl', quantity: 18, unit: 'SQ', rcv: 900 },
];
const list = buildMaterialList({ lineItems: lines });
const byKind = Object.fromEntries(list.materials.map(item => [item._materialKind, item]));
assert.equal(list.scope, 'siding');
assert.equal(byKind.siding.quantity, 18, 'Vinyl accessories must not inflate siding area');
assert.equal(byKind.j_channel.quantity, 220);
assert.equal(byKind.light_box.order_quantity, 4);
assert.equal(byKind.water_box.order_quantity, 2);
assert.equal(byKind.siding_fasteners.order_quantity, 3);
assert.equal(byKind.siding_fasteners.order_unit, 'BOX');
assert.equal(byKind.siding_starter.order_quantity, 150);
assert.equal(byKind.siding_starter.order_unit, 'LF', 'Do not treat siding starter as roofing bundles');
assert.equal(byKind.exterior_caulk.order_quantity, 6);
assert.equal(list.labor.length, 1);
assert.deepEqual(list.missing_materials, []);
assert.equal(list.totals.grand_total, lines.reduce((sum, item) => sum + item.rcv, 0));
assert.deepEqual(lines[0], { description: 'Vinyl siding', quantity: 18, unit: 'SQ', rcv: 3600 }, 'Purchase builder must not modify estimate inputs');

const partial = buildMaterialList({ lineItems: [lines[0]] });
assert(partial.missing_materials.some(item => item.description.includes('J-Channel')));
assert(partial.missing_materials.some(item => item.description.includes('Water')));
assert(partial.missing_materials.some(item => item.description.includes('Light')));
assert(partial.missing_materials.some(item => item.description.includes('Nails')));
assert(partial.missing_materials.every(item => item.quantity === null), 'No invented accessory counts');

const mixed = buildMaterialList({
  jobType: 'roofing',
  lineItems: [
    ...lines,
    { description: 'Laminated shingles', quantity: 10, unit: 'SQ', rcv: 4000 },
    { description: 'Roofing Nails', quantity: 1, unit: 'box', rcv: 40 },
    { description: 'Roofing starter strip', quantity: 100, unit: 'LF', rcv: 120 },
  ],
});
assert.equal(mixed.scope, 'mixed');
assert(mixed.materials.some(item => item._materialKind === 'laminated_shingles'));
assert(mixed.materials.some(item => item._materialKind === 'nails'));
assert(mixed.materials.some(item => item._materialKind === 'siding_fasteners'));
assert(mixed.materials.some(item => item._materialKind === 'starter'));
assert(mixed.materials.some(item => item._materialKind === 'siding_starter'));

const units = buildMaterialList({ lineItems: [
  lines[0], lines[5], { description: 'Siding nails', quantity: 10, unit: 'LB', rcv: 20 },
] });
assert.equal(units.materials.filter(item => item._materialKind === 'siding_fasteners').length, 2, 'Never sum boxes and pounds');
const metal = buildMaterialList({ lineItems: [
  { description: 'R&R Siding - .019 metal (aluminum/steel)', quantity: 1813.54, unit: 'SF', rcv: 10000 },
] });
assert.equal(metal.materials[0].description, 'Metal / Aluminum Siding');
assert.equal(metal.materials[0].order_unit, 'SF', 'Do not assume vinyl carton coverage for metal siding');
assert.equal(buildMaterialList({ lineItems: [
  { description: 'Vinyl siding', activity: '-', quantity: 18, unit: 'SQ', rcv: 900 },
] }).materials.length, 0);
assert.deepEqual(buildMaterialList({ lineItems: [
  { description: 'Remove vinyl siding', quantity: 18, unit: 'SQ', rcv: 900 },
] }).missing_materials, [], 'Removal-only scope must not suggest buying siding accessories');
const spigot = buildMaterialList({ lineItems: [
  lines[0], { description: 'Exterior water spigot / hose bib', quantity: 1, unit: 'EA', rcv: 75 },
] });
assert.equal(spigot.materials.find(item => item._materialKind === 'water_spigot').quantity, 1);
assert(!spigot.missing_materials.some(item => /Water/.test(item.description)), 'Existing water/hose-bib scope must not trigger a second unmeasured water accessory');
const corners = buildMaterialList({ lineItems: [
  lines[0], lines[3], { description: 'Inside corner, vinyl', quantity: 30, unit: 'LF', rcv: 120 },
] });
assert.equal(corners.materials.filter(item => /corner_post/.test(item._materialKind)).length, 2);
assert(!buildMaterialList({ jobType: 'siding', lineItems: [
  lines[0], { description: 'Hip/ridge/rake/eave nails', quantity: 7, unit: 'EA', rcv: 17.08 },
] }).materials.some(item => /nail/i.test(item.description)));
console.log('PASS: siding accessories, real quantities, missing-scope warnings, mixed trades and billing-unit separation.');
