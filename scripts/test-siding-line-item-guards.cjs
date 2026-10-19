#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const { guardSidingLineItems } = await import('../src/utils/sidingLineItemGuards.js');

  const vinylLines = [
    { code: 'ASB', description: 'Remove Tear off asbestos siding (no haul off)', quantity: 9.4, unit: 'SQ' },
    { code: 'CDR', description: 'Cedar shake siding', quantity: 9.4, unit: 'SQ' },
    { code: 'ALU', description: 'Siding - aluminum', quantity: 9.4, unit: 'SQ' },
    { code: 'VTO', description: 'ITEL, Siding, Vinyl, Lap, Tear Out', quantity: 9.4, unit: 'SQ' },
    { code: 'VIN', description: 'Vinyl siding, standard grade', quantity: 9.4, unit: 'SQ' },
    { code: 'GTR', description: 'Gutter, aluminum', quantity: 73, unit: 'LF' },
    { code: 'FSC', description: 'Fascia', quantity: 207, unit: 'LF' },
    { code: 'SFT', description: 'Soffit, vinyl', quantity: 232, unit: 'SF' },
    { code: 'WP', description: 'House wrap / weather barrier', quantity: 10, unit: 'SQ' },
    { code: '', description: 'Brick veneer — excluded from vinyl siding (211 SF)', quantity: 211, unit: 'SF', catalog_exempt: true },
  ];

  const uncertain = guardSidingLineItems(vinylLines, { material: '' });
  assert.equal(uncertain.ask, null);
  assert.equal(uncertain.material, 'vinyl');
  assert.equal(uncertain.items.some(item => item.description === 'Vinyl siding, standard grade'), true);
  assert.equal(uncertain.items.some(item => /Siding - aluminum/i.test(item.description)), false);
  assert.equal(uncertain.held.some(item => /asbestos/i.test(item.description)), true);
  assert.equal(sidingMaterialAskDoesNotBlock(uncertain), true);

  const mixed = guardSidingLineItems(vinylLines, { material: 'vinyl or aluminum' });
  assert.equal(mixed.ask, null);
  assert.equal(mixed.material, 'vinyl');
  assert.equal(mixed.items.some(item => item.description === 'Vinyl siding, standard grade'), true);

  const guarded = guardSidingLineItems(vinylLines, { material: 'vinyl' });
  assert.equal(guarded.ask, null);
  const billed = guarded.items.map(item => item.description);
  assert.equal(billed.some(text => /asbestos/i.test(text)), false);
  assert.equal(billed.some(text => /cedar/i.test(text)), false);
  assert.equal(billed.some(text => /aluminum siding|Siding - aluminum/i.test(text)), false);
  assert.equal(billed.includes('ITEL, Siding, Vinyl, Lap, Tear Out'), true);
  assert.equal(billed.includes('Vinyl siding, standard grade'), true);
  assert.equal(billed.includes('Gutter, aluminum'), true, 'An aluminum gutter stays on a vinyl job');
  assert.equal(billed.includes('Fascia'), true);
  assert.equal(billed.includes('Soffit, vinyl'), true);
  assert.equal(billed.includes('House wrap / weather barrier'), true);
  assert.equal(billed.some(text => /Brick veneer/i.test(text)), true);

  const heldDescriptions = guarded.held.map(item => item.description);
  assert.deepEqual(heldDescriptions, [
    'Remove Tear off asbestos siding (no haul off)',
    'Cedar shake siding',
  ]);
  assert.equal(guarded.held.every(item => item.confirm === true), true);

  const approved = guardSidingLineItems(vinylLines, {
    material: 'vinyl',
    approvedIds: [guarded.held[0].confirm_id],
  });
  assert.equal(approved.items.some(item => /asbestos/i.test(item.description) && item.confirm === true), true);
  assert.equal(approved.held.length, 1);
  assert.equal(/cedar/i.test(approved.held[0].description), true);

  const aluminumJob = guardSidingLineItems([
    { code: 'VIN', description: 'Vinyl siding, standard grade', quantity: 1, unit: 'SQ' },
    { code: 'ALU', description: 'Aluminum siding', quantity: 1, unit: 'SQ' },
  ], { material: 'aluminum' });
  assert.deepEqual(aluminumJob.items.map(item => item.description), ['Aluminum siding']);
  assert.equal(aluminumJob.held.length, 0);

  const estimator = fs.readFileSync(require('node:path').join(__dirname, '../src/pages/AIEstimator.jsx'), 'utf8');
  assert.equal(estimator.includes('guardSidingLineItems'), true);
  assert.equal(estimator.includes('Confirm the siding material (vinyl or aluminum)'), false);
  assert.equal(estimator.includes('Select aluminum or vinyl siding before building the estimate.'), false);
  assert.equal(estimator.includes('aria-label="Confirm siding material"'), false);
  assert.equal(estimator.includes('testId="siding-material-summary"'), true);
  assert.equal(estimator.includes('data-testid="siding-confirm-hold"'), true);

  console.log('siding line-item guards passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

function sidingMaterialAskDoesNotBlock(result) {
  return result.ask == null && result.material === 'vinyl' && result.items.length > 0;
}
