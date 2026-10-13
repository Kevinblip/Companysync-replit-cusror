'use strict';
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildMaterialList } = require('../lib/materialList.cjs');

(async () => {
  const compiled = await esbuild.build({
    entryPoints: ['src/components/estimates/MaterialPurchaseRow.jsx'],
    platform: 'node', bundle: true, format: 'cjs', external: ['react'], write: false,
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports);
  const Row = module.exports.default;
  const list = buildMaterialList({ jobType: 'siding', lineItems: [
    { description: 'Nails, 25-lb box (siding) — price needed', quantity: 7, unit: 'EA', rcv: 0 },
    { description: 'Caulk, exterior grade (tube) — price needed', quantity: 6, unit: 'EA', rcv: 0 },
    { description: 'vinyl j-channel — price needed (Top)', quantity: 371.34, unit: 'LF', rcv: 0 },
    { description: 'vinyl j-channel — price needed (Bottom)', quantity: 327.17, unit: 'LF', rcv: 0 },
  ] });
  const cells = item => renderToStaticMarkup(React.createElement(Row, { item })).match(/<td[^>]*>(.*?)<\/td>/g).map(cell => cell.replace(/<[^>]*>/g, ''));
  const nails = cells(list.materials.find(item => item._materialKind === 'siding_fasteners'));
  assert.deepEqual(nails.slice(1, 5), ['7', 'EA', '7', 'box'], 'Keep estimate units and display authoritative box units separately');
  const caulk = cells(list.materials.find(item => item._materialKind === 'exterior_caulk'));
  assert.deepEqual(caulk.slice(1, 5), ['6', 'EA', '6', 'tube']);
  const channel = cells(list.materials.find(item => item._materialKind === 'j_channel'));
  assert.deepEqual(channel.slice(1, 5), ['698.51', 'LF', '56', '12.5-ft piece']);
  const legacy = cells({ description: 'Legacy nails', quantity: 7, unit: 'EA' });
  assert.deepEqual(legacy.slice(1, 5), ['7', 'EA', '—', '—']);
  assert.match(legacy[5], /Refresh this saved list/);
  console.log('PASS: saved-list order sheet renders real box/tube units, separate measured quantities, and an explicit legacy refresh notice.');
})().catch(error => { console.error(error); process.exitCode = 1; });
