#!/usr/bin/env node
/**
 * Non-mutating regression check for the first-account Quick Setup → estimator
 * path. It exercises the shared price-list guard with null and verifies both
 * pages normalize nullable entity-list responses before rendering collections.
 */
import fs from 'node:fs';
import { filterPriceListBySource } from '../src/lib/priceListUtils.js';

const read = (file) => fs.readFileSync(file, 'utf8');
const quickSetup = read('src/pages/QuickSetup.jsx');
const estimator = read('src/pages/AIEstimator.jsx');
const priceListHook = read('src/hooks/usePriceList.js');

const nullLists = filterPriceListBySource(null);
const emptyLists = filterPriceListBySource([]);

const checks = [
  ['null price-list response produces empty source lists',
    Object.values(nullLists).every(Array.isArray) && Object.values(nullLists).every((list) => list.length === 0)],
  ['empty price-list response produces empty source lists',
    Object.values(emptyLists).every(Array.isArray) && Object.values(emptyLists).every((list) => list.length === 0)],
  ['price-list hook normalizes its query before filtering',
    priceListHook.includes('select: (data) => Array.isArray(data) ? data : []')],
  ['Quick Setup normalizes nullable company and setup collections',
    (quickSetup.match(/select: asArray/g) || []).length >= 5 &&
      quickSetup.includes("const asArray = (value) => Array.isArray(value) ? value : [];")],
  ['Quick Setup safely completes to the estimator',
    quickSetup.includes("completeSetupAndNavigate('AIEstimator')") &&
      quickSetup.includes('data-testid="button-go-ai-estimator"')],
  ['AI Estimator normalizes nullable first-account collections',
    (estimator.match(/select: \(data\) => Array\.isArray\(data\) \? data : \[\]/g) || []).length >= 10 &&
      estimator.includes('const safeAllPriceListItems = Array.isArray(allPriceListItems) ? allPriceListItems : [];')],
  ['AI Estimator shows an empty photo state for null photo input',
    estimator.includes('const referencePhotos = Array.isArray(photos) ? photos.filter(photo => photo?.url) : [];')],
];

let failed = 0;
for (const [name, passed] of checks) {
  if (passed) console.log(`ok - ${name}`);
  else {
    failed += 1;
    console.error(`not ok - ${name}`);
  }
}

if (failed) {
  console.error(`\n${failed} null-safety regression check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} null-safety regression checks passed.`);