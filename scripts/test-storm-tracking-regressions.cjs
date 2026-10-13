#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const stormFunctions = require('../db/storm-functions.cjs');

async function main() {
  const { dedupeStormEvents, fetchAllStormEvents, formatStormSeverityLabel } = await import(pathToFileURL(
    path.resolve(__dirname, '../src/lib/stormTrackingData.js')
  ));
  const stormPageSource = fs.readFileSync(path.resolve(__dirname, '../src/pages/StormTracking.jsx'), 'utf8');
  const pluginSource = fs.readFileSync(path.resolve(__dirname, '../vite-functions-plugin.js'), 'utf8');
  const stormsModuleSource = fs.readFileSync(path.resolve(__dirname, '../db/storm-functions.cjs'), 'utf8');
  const addressUtils = await import(pathToFileURL(
    path.resolve(__dirname, '../src/lib/stormAddressUtils.js')
  ));

  const allStorms = Array.from({ length: 2105 }, (_, index) => ({ id: `storm-${index}` }));
  const requests = [];
  const result = await fetchAllStormEvents(async (_name, params) => {
    requests.push(params);
    return {
      data: {
        success: true,
        storms: allStorms.slice(params.offset, params.offset + params.limit),
      },
    };
  });
  assert.equal(result.data.storms.length, 2105, 'load results beyond the first 500 and first 1,000 rows');
  assert.deepEqual(requests.map(request => request.offset), [0, 1000, 2000], 'request consecutive pages');
  assert.equal(requests.every(request => request.limit === 1000), true, 'keep each response bounded');
  assert.match(stormPageSource, /fetchAllStormEvents/, 'Storm Tracking uses the paginated loader');

  const duplicateResults = await fetchAllStormEvents(async () => ({
    data: {
      success: true,
      storms: [
        { id: 'same-id', source: 'NOAA', title: 'Original' },
        { id: 'same-id', source: 'NOAA', title: 'Duplicate' },
        { event_type: 'hail', start_time: '2026-09-20T18:00:00Z', affected_areas: ['Franklin, OH'] },
        { type: 'HAIL', event_time: '2026-09-20T18:00:00Z', affected_areas: [' Franklin,  OH '] },
      ],
    },
  }));
  assert.equal(duplicateResults.data.storms.length, 2, 'deduplicate storms by source/id and location/time/type fallback');
  assert.equal(dedupeStormEvents(null).length, 0, 'handle malformed storm arrays safely');
  assert.equal(formatStormSeverityLabel('SEVERE extreme'), 'Extreme');
  assert.equal(formatStormSeverityLabel('SEVERE severe'), 'Severe');
  assert.equal(formatStormSeverityLabel('moderate'), 'Moderate');
  assert.match(stormPageSource, /formatStormSeverityLabel\(storm\.severity\)/,
    'render normalized severity labels instead of raw API strings');
  assert.doesNotMatch(stormPageSource, />\s*SEVERE\s*</,
    'do not render a second hard-coded severity badge beside the normalized badge');
  assert.doesNotMatch(stormPageSource, /\$\{hasActive \? '⚡' : ''\}\$\{cluster\.points\.length\}/,
    'do not emit lightning-prefixed cluster counts that can leak as raw text');
  assert.match(stormPageSource, /<details className="group rounded-lg[^"]*">[\s\S]*?<summary[^>]*>[\s\S]*?How to Get REAL Property Owner Leads/,
    'property-owner instructions are collapsed in native details by default');
  assert.match(stormPageSource, /base44\.functions\.invoke\('enrichStormAddresses'/,
    'owner enrichment uses the supported function invocation API');
  assert.match(stormPageSource, /base44\.functions\.invoke\('saveCanvassList'/,
    'saving canvass lists uses the supported function invocation API');
  assert.match(stormPageSource, /base44\.functions\.invoke\('saveStormProspectList'/,
    'saving prospect lists uses the supported function invocation API');
  assert.doesNotMatch(stormPageSource, /base44\.functions\.(?:enrichStormAddresses|saveCanvassList|saveStormProspectList)\s*\(/,
    'Storm Tracking does not call nonexistent SDK convenience methods');
  assert.doesNotMatch(stormPageSource, /Fallback tiers use property size or address order/,
    'failed home-value requests do not present fallback ordering as value tiers');

  let capturedSql = '';
  const paged = await stormFunctions.getStormsInArea({
    query: async (sql) => {
      capturedSql = sql;
      return { rows: [{ id: 'storm-page-2', data: { title: 'Second page' } }] };
    },
  }, { daysBack: 0, limit: 2, offset: 4 });
  assert.match(capturedSql, /LIMIT 2 OFFSET 4/, 'shared dev/prod query honors page offset');
  assert.equal(paged.storms[0].id, 'storm-page-2');
  assert.match(pluginSource, /LIMIT \$\{safeLimit\} OFFSET \$\{safeOffset\}/, 'development handler honors page offsets');
  assert.ok((pluginSource.match(/LIMIT \$\{safeLimit\} OFFSET \$\{safeOffset\}/g) || []).length >= 3,
    'all development geography query paths are paginated');
  assert.ok((stormsModuleSource.match(/LIMIT \$\{safeLimit\} OFFSET \$\{safeOffset\}/g) || []).length >= 3,
    'all production geography query paths are paginated');

  let censusUrl = '';
  const zipValues = await addressUtils.fetchCensusZipMedianValues(async (url) => {
    censusUrl = url;
    return {
      ok: true,
      json: async () => [
        ['B25077_001E', 'zip code tabulation area'],
        ['425000', '10001'],
        ['-666666666', '10002'],
      ],
    };
  });
  assert.match(censusUrl, /zip\+code\+tabulation\+area:\*$/, 'Census request uses a valid all-ZIP geography');
  assert.deepEqual(zipValues, { '10001': 425000 }, 'ignore Census no-data sentinel values');
  assert.match(stormPageSource, /tier\.value != null \? `Median home value:/,
    'fallback tier badges do not call number formatting on a missing value');

  console.log('Storm tracking regression checks passed: pagination, deduplication, severity labels, map markers, instructions, and safe Census tiering.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});