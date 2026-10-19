#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const { resolveBillableSidingMaterial, describeSidingPricingBlock } = await import('../src/utils/sidingBillableMaterial.js');
  const estimator = fs.readFileSync(path.join(__dirname, '../src/pages/AIEstimator.jsx'), 'utf8');

  const aluminum = resolveBillableSidingMaterial({
    siding_material: 'aluminum',
    siding_material_confidence: 92,
  });
  assert.equal(aluminum.material, 'aluminum');
  assert.equal(aluminum.source, 'detected');
  assert.equal(aluminum.lowConfidence, false);

  const low = resolveBillableSidingMaterial({
    siding_material: 'aluminum',
    material_confidence: 0.4,
  });
  assert.equal(low.material, 'vinyl');
  assert.equal(low.source, 'default_low_confidence');
  assert.equal(low.lowConfidence, true);

  const missing = resolveBillableSidingMaterial({ siding_material: 'unknown' });
  assert.equal(missing.material, 'vinyl');
  assert.equal(missing.source, 'default_missing');

  const selected = resolveBillableSidingMaterial({ siding_material: 'vinyl' }, 'aluminum');
  assert.equal(selected.material, 'aluminum');
  assert.equal(selected.source, 'selected');

  const loading = describeSidingPricingBlock({ priceListLoading: true, measurements: { wall_area_sq: 10 } });
  assert.equal(loading.code, 'price_list_loading');
  assert.match(loading.message, /price list is still loading/i);

  const sanity = describeSidingPricingBlock({
    measurements: { sanity_review_required: true, wall_area_sq: 12 },
    roofSq: 20,
  });
  assert.equal(sanity.code, 'sanity_check');
  assert.equal(sanity.overridable, true);
  assert.match(sanity.message, /Sanity check failed/);

  const graph = describeSidingPricingBlock({
    measurements: { wall_area_sq: 12 },
    graphPresent: true,
    graphSupported: false,
    graphIssues: ['reconciliation_failed'],
  });
  assert.match(graph.message, /reconciliation_failed/);
  assert.equal(graph.overridable, false);

  const ratio = describeSidingPricingBlock({
    measurements: { wall_area_sq: 21 },
    roofSq: 5,
  });
  assert.equal(ratio.code, 'siding_over_roof');
  assert.match(ratio.message, /more than 4× the roof/);

  const cleared = describeSidingPricingBlock({
    measurements: { sanity_review_required: true, wall_area_sq: 21 },
    roofSq: 5,
    ignoreOverridable: true,
  });
  assert.equal(cleared, null);

  const hardStillBlocks = describeSidingPricingBlock({
    priceListLoading: true,
    measurements: { sanity_review_required: true, wall_area_sq: 21 },
    roofSq: 5,
    ignoreOverridable: true,
  });
  assert.equal(hardStillBlocks.code, 'price_list_loading');

  assert.match(estimator, /data-testid="siding-pricing-block-banner"/);
  assert.match(estimator, /testId="siding-material-summary"/);
  assert.doesNotMatch(estimator, /Confirm the siding material \(vinyl or aluminum\)/);
  assert.doesNotMatch(estimator, /aria-label="Confirm siding material"/);
  assert.match(estimator, /handleAnalyzePhotos = async[\s\S]*?autoBuild:\s*true/);
  assert.match(
    estimator,
    /data-testid="button-build-photo-siding-estimate"[\s\S]{0,380}handleBuildSidingEstimate\(hasEdits \? eff : photoSidingAnalysis\)/,
  );

  console.log('siding billable material and pricing banners passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
