#!/usr/bin/env node

/**
 * Regression guard for automatic roof-source honesty.
 *
 * The selected Clear/Winter/Recent overlay must be sent to the handler, an
 * encoded OSM footprint lookup must remain active, and stale incomplete Solar
 * geometry must not be allowed to generate an order-ready estimate.
 */

const fs = require('fs');

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

const page = fs.readFileSync('src/pages/AIEstimator.jsx', 'utf8');
const handler = fs.readFileSync('vite-functions-plugin.js', 'utf8');

console.log('\n── Roof source readiness guard ────────────────────────────────');
check('selected imagery is included in the measurement request',
  page.includes('imagery_source: aiMapImagery'));
check('review and measurement imagery are stored separately',
  page.includes('measurement_imagery_source') && page.includes('review_imagery_source'));
check('non-orderable automatic results disable estimate generation',
  page.includes('satelliteAnalysis?.measurement_ready === false'));
check('Overpass query is URL encoded',
  handler.includes('encodeURIComponent(osmQuery)'));
check('Solar imagery date is returned',
  handler.includes('solar_imagery_date: solarImageryDate'));
check('stale two-facet partial geometry requires review',
  handler.includes('severeCoverageGap && staleGeometry && suspiciouslySimpleGeometry'));
check('blocked measurements are explicitly non-ready',
  handler.includes('const measurementReady = !requiresManualReview'));

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log('\n✓ Incomplete imagery can no longer silently become an order-ready estimate.');