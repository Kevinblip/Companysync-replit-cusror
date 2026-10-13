#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { buildMaterialList } = require('../lib/materialList.cjs');

const list = buildMaterialList({
  lineItems: [
    { description: 'Remove Laminated - comp. shingle rfg. - w/ felt', quantity: 11.56, unit: 'SQ', rcv: 929.89 },
    { description: 'Laminated - comp. shingle rfg. - w/out felt', quantity: 12.67, unit: 'SQ', rcv: 3595.87 },
    { description: 'Remove 3 tab - 25 yr. - composition shingle roofing - incl. felt', quantity: 5.92, unit: 'SQ', rcv: 459.33 },
    { description: '3 tab - 25 yr. - comp. shingle roofing - w/out felt', quantity: 6.67, unit: 'SQ', rcv: 1759.48 },
    { description: 'Roofing felt - 15 lb.', quantity: 9.54, unit: 'SQ', rcv: 393.43 },
    { description: 'Roofing felt - 15 lb.', quantity: 5.92, unit: 'SQ', rcv: 244.14 },
    { description: 'Ice & water barrier', quantity: 202.75, unit: 'SF', rcv: 411.58 },
    { description: 'R&R Hip / Ridge cap - Standard profile - composition shingles', quantity: 44.89, unit: 'LF', rcv: 474.49 },
    { description: 'R&R Valley metal - (W) profile', quantity: 34.71, unit: 'LF', rcv: 304.75 },
    { description: 'Starter Strip', quantity: 150, unit: 'LF', rcv: 0 },
    { description: 'Roofing Nails', quantity: 1, unit: 'EA', rcv: 0 },
    { description: 'Step Flashing', quantity: 25, unit: 'LF', rcv: 0 },
  ],
});
const byDescription = Object.fromEntries(list.materials.map((item) => [item.description, item]));

assert.equal(list.materials.length, 9, 'pure removal lines must not appear as purchasable material');
assert.equal(byDescription['Laminated Composition Shingles'].order_quantity, 39, '12.67 SQ laminate = 39 bundles');
assert.equal(byDescription['3-tab Composition Shingles'].order_quantity, 21, '6.67 SQ 3-tab = 21 bundles, not laminate quantity');
assert.equal(byDescription['Roofing Felt / Underlayment'].order_quantity, 2, '15.46 SQ felt = 2 rolls');
assert.equal(byDescription['Ice & Water Barrier'].order_quantity, 2, '202.75 SF ice/water = 2 rolls');
assert.equal(byDescription['Hip / Ridge Cap Shingles'].order_quantity, 2, '44.89 LF ridge cap = 2 bundles');
assert.equal(byDescription['Valley Metal'].order_quantity, 4, '34.71 LF valley = 4 ten-foot sections');
assert.equal(byDescription['Starter Strip'].order_quantity, 2, '150 LF starter = 2 bundles');
assert.equal(byDescription['Roofing Nails'].order_quantity, 2, '19.34 field SQ = 2 nail boxes');
assert.equal(byDescription['Step Flashing'].order_quantity, 1, '25 LF step flashing = 1 box');

console.log('✓ Material list keeps each shingle type separate and computes purchase quantities from install lines only.');