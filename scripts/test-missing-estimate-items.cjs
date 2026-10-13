#!/usr/bin/env node
'use strict';

(async () => {
  const { getMissingEstimateItems, inferEstimateTrade } = await import('../src/utils/missingEstimateItems.js');
  let passed = 0;
  let failed = 0;
  const check = (name, condition, detail = '') => {
    if (condition) {
      passed++;
      console.log(`  ✓ ${name}`);
    } else {
      failed++;
      console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  console.log('\nVinyl siding estimates only receive siding checks');
  const siding = getMissingEstimateItems({
    estimate: { job_type: 'siding' },
    lineItems: [
      { description: 'Install vinyl siding', trade: 'Siding & Exterior' },
      { description: 'Soffit and fascia', trade: 'Siding & Exterior' },
    ],
  });
  check('scope is siding', siding.scope === 'siding');
  check('siding accessories are suggested', siding.items.some(item => item.label === 'J-Channel'));
  check('roofing underlayment is never suggested', !siding.items.some(item => item.label === 'Underlayment'));
  check('roofing ice shield is never suggested', !siding.items.some(item => item.label === 'Ice & Water Shield'));
  check('roofing ridge cap is never suggested', !siding.items.some(item => item.label === 'Ridge Cap'));

  console.log('\nRoof estimates retain roofing checks');
  const roofing = getMissingEstimateItems({
    estimate: { job_type: 'roofing' },
    lineItems: [{ description: 'Architectural shingles' }],
  });
  check('scope is roofing', roofing.scope === 'roofing');
  check('underlayment is suggested for roofing', roofing.items.some(item => item.label === 'Underlayment'));
  check('siding j-channel is not suggested for roofing', !roofing.items.some(item => item.label === 'J-Channel'));

  console.log('\nUnclassified estimates do not invent a trade');
  check('unclassified scope is general', inferEstimateTrade({ lineItems: [{ description: 'General labor' }] }) === 'general');
  check('general scope has no roofing suggestions', getMissingEstimateItems({ lineItems: [{ description: 'General labor' }] }).items.length === 0);

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});