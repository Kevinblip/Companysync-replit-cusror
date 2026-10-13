'use strict';
const assert = require('node:assert/strict');
const { buildMaterialList, materialListLineItems } = require('../lib/materialList.cjs');

// Exact quantity/description pattern from the user's AI Estimator screenshot.
// Catalog pricing is pending; all material takeoff quantities already exist.
const rows = [
  ['Remove siding, vinyl or aluminum', 36.036, 'SQ'],
  ['vinyl siding — price needed', 36.036, 'SQ'],
  ['vinyl j-channel — price needed (Top)', 371.34, 'LF'],
  ['vinyl j-channel — price needed (Bottom)', 327.17, 'LF'],
  ['vinyl outside corner — price needed', 379.58, 'LF'],
  ['vinyl starter strip — price needed', 327.17, 'LF'],
  ['House wrap / weather barrier — price needed', 36.036, 'SQ'],
  ['Nails, 25-lb box (siding) — price needed', 7, 'EA'],
  ['Caulk, exterior grade (tube) — price needed', 6, 'EA'],
  ['Electrical box extension (light box) — price needed', 1, 'EA'],
  ['Exterior water spigot / hose bib (cut-in & reconnect) — price needed', 1, 'EA'],
  ['debris', 1, 'EA'],
].map(([description, quantity, unit]) => ({
  description, quantity, unit, pricing_scope: 'siding',
  rate: description === 'debris' ? 221.37 : 0,
  rcv: description === 'debris' ? 221.37 : 0,
}));
const original = JSON.stringify(rows);
const list = buildMaterialList({ lineItems: rows, jobType: 'siding' });
const kinds = Object.fromEntries(list.materials.map(item => [item._materialKind, item]));
assert.equal(list.materials.length, 9);
assert.equal(kinds.j_channel.quantity, 698.51);
assert.equal(kinds.corner_post.quantity, 379.58);
assert.equal(kinds.siding_starter.quantity, 327.17);
assert.equal(kinds.siding_fasteners.order_quantity, 7);
assert.equal(kinds.siding_fasteners.order_unit, 'box');
assert.equal(kinds.exterior_caulk.order_quantity, 6);
assert.equal(kinds.exterior_caulk.order_unit, 'tube');
assert.equal(kinds.light_box.order_quantity, 1);
assert.equal(kinds.water_spigot.order_quantity, 1);
assert.deepEqual(list.missing_materials, []);
assert.equal(list.pricing_incomplete, true);
assert.equal(list.labor.length, 2, 'Only removal and debris are labor');
assert.equal(list.totals.grand_total, 221.37, 'Do not invent prices or change the saved money');
assert.equal(JSON.stringify(rows), original);
assert.equal(materialListLineItems({ items: [], line_items: rows }), rows);
assert.equal(materialListLineItems({ items: rows, line_items: [] }), rows);
assert.equal(materialListLineItems({}, rows), rows);
assert.deepEqual(materialListLineItems({items: []}), []);
const genericNails = buildMaterialList({ lineItems: [
  { description: 'Nails, 25-lb box', quantity: 7, unit: 'EA', pricing_scope: 'siding', rcv: 0 },
] });
assert.equal(genericNails.materials[0]._materialKind, 'siding_fasteners');
assert.equal(genericNails.materials[0].order_unit, 'box');
console.log('PASS: all existing screenshot materials survive pending prices; quantities, boxes/tubes, water scope and saved-array fallback are correct.');
