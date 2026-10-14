'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  resolveGoogleMapsBrowserKey,
  missingBrowserKeyError,
} = require('../lib/googleMapsKeys.cjs');

let failed = 0;

function ok(name, cond) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

const browserOnly = resolveGoogleMapsBrowserKey({
  GOOGLE_MAPS_BROWSER_KEY: 'browser-key',
  GOOGLE_MAPS_API_KEY: 'server-key',
});
ok('browser key wins when both are set', browserOnly.apiKey === 'browser-key' && browserOnly.fallback === false && browserOnly.source === 'GOOGLE_MAPS_BROWSER_KEY');

const fallback = resolveGoogleMapsBrowserKey({
  GOOGLE_MAPS_BROWSER_KEY: '   ',
  GOOGLE_MAPS_API_KEY: 'server-key',
});
ok('blank browser key falls back to GOOGLE_MAPS_API_KEY', fallback.apiKey === 'server-key' && fallback.fallback === true && fallback.source === 'GOOGLE_MAPS_API_KEY');

const missing = resolveGoogleMapsBrowserKey({});
ok('missing keys name both env vars', missing.apiKey === '' && missing.error === missingBrowserKeyError());
ok('error names GOOGLE_MAPS_BROWSER_KEY', missing.error.includes('GOOGLE_MAPS_BROWSER_KEY'));
ok('error names GOOGLE_MAPS_API_KEY', missing.error.includes('GOOGLE_MAPS_API_KEY'));

const root = path.join(__dirname, '..');
const vite = fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8');
const prod = fs.readFileSync(path.join(root, 'db/prod-integrations.cjs'), 'utf8');
ok('preview handler uses the shared resolver', vite.includes("require('./lib/googleMapsKeys.cjs')") || vite.includes('googleMapsKeys.cjs'));
ok('production handler uses the shared resolver', prod.includes('googleMapsKeys.cjs'));
ok('preview handler no longer reads only the browser key', !/const browserKey = process\.env\.GOOGLE_MAPS_BROWSER_KEY;/.test(vite));
ok('production handler no longer reads only the browser key', !/const browserKey = process\.env\.GOOGLE_MAPS_BROWSER_KEY;/.test(prod));

const estimator = fs.readFileSync(path.join(root, 'src/pages/AIEstimator.jsx'), 'utf8');
ok('estimator shows the server error that names the env var', estimator.includes('response.data?.error'));

assert.strictEqual(failed, 0);
console.log('google maps browser key fallback: ok');
