#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { buildMaterialList } = require('../lib/materialList.cjs');

const list = buildMaterialList({
  jobType: 'siding',
  lineItems: [
    { description: 'Vinyl siding - Dutch lap', quantity: 18, unit: 'SQ', rcv: 3600 },
    { description: 'House wrap / weather barrier', quantity: 1800, unit: 'SF', rcv: 450 },
    { description: 'J-channel', quantity: 145, unit: 'LF', rcv: 290 },
    { description: 'Outside corner posts', quantity: 42, unit: 'LF', rcv: 180 },
    { description: 'Soffit and fascia', quantity: 120, unit: 'LF', rcv: 420 },
    { description: 'Starter Strip', quantity: 150, unit: 'LF', rcv: 0 },
    { description: 'Roofing Nails', quantity: 1, unit: 'EA', rcv: 12, trade: 'Roofing' },
  ],
});
const descriptions = list.materials.map(item => item.description);

assert.equal(list.scope, 'siding');
assert.ok(descriptions.includes('Vinyl Siding'), 'vinyl siding should be an order material');
assert.ok(descriptions.includes('House Wrap / Weather Barrier'), 'house wrap should be an order material');
assert.ok(descriptions.includes('J-Channel'), 'j-channel should be an order material');
assert.ok(descriptions.includes('Corner Posts'), 'corner posts should be an order material');
assert.ok(descriptions.includes('Soffit'), 'soffit should be an order material');
assert.ok(!descriptions.includes('Roofing Nails'), 'roofing nails must not be on a siding order sheet');
assert.ok(!descriptions.includes('Starter Strip'), 'roofing-tagged starter strip must not be on a siding order sheet');
assert.equal(list.other.filter(item => item._excluded_from_scope === 'siding').length, 2);
assert.equal(list.materials.find(item => item.description === 'Vinyl Siding').order_quantity, 9);

const inferredScope = buildMaterialList({
  lineItems: [
    { description: 'Vinyl siding - Dutch lap', quantity: 10, unit: 'SQ', rcv: 1000 },
    { description: 'Roofing Nails', quantity: 1, unit: 'EA', rcv: 12 },
  ],
});
assert.equal(inferredScope.scope, 'siding', 'a stray roofing accessory must not override siding evidence');
assert.ok(!inferredScope.materials.some(item => item.description === 'Roofing Nails'));

console.log('✓ Siding material lists include siding scope and exclude unrelated roofing accessories.');