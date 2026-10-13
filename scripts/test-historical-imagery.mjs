import assert from 'node:assert/strict';
import { parseCaptureDate, parseWaybackReleases, optionFromMetadata, listPropertyImagery } from '../src/lib/historicalImagery.js';

assert.equal(parseCaptureDate('20250612'), '2025-06-12');
assert.equal(parseCaptureDate('6/12/2025'), '2025-06-12');
assert.equal(parseCaptureDate('2025-02-30'), null);
assert.equal(parseCaptureDate(''), null);
const config = {
  800: {
    itemTitle: 'World Imagery (Wayback 2026-01-09)',
    metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/test/MapServer',
    itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/test/tile/800/{level}/{row}/{col}',
  },
};
const [release] = parseWaybackReleases(config);
assert.match(release.urlTemplate, /800\/\{z\}\/\{y\}\/\{x\}/);
const summer = optionFromMetadata(release, [{ attributes: { SRC_DATE: '20250612', SRC_RES: .5, NICE_DESC: 'Provider' } }]);
assert.equal(summer.captureDate, '2025-06-12');
assert.equal(summer.releaseDate, '2026-01-09');
assert.equal(summer.leafOffCandidate, false, 'Winter archive publication must NOT imply winter capture');
const winter = optionFromMetadata(release, [{ attributes: { SRC_DATE: '20120203', SRC_RES: .3 } }]);
assert.equal(winter.leafOffCandidate, true);
assert.equal(optionFromMetadata(release, []), null);
assert.equal(optionFromMetadata(release, [{ attributes: { SRC_RES: 1 } }]).captureDate, null);
assert.equal(optionFromMetadata(release, [{ attributes: { SRC_DATE: 'bad', SRC_DATE2: '2/3/2012' } }]).captureDate, '2012-02-03');
assert.equal(parseWaybackReleases({ bad: { ...config[800], metadataLayerUrl: 'https://untrusted.invalid/' } }).length, 0);

const originalFetch = globalThis.fetch;
let metadataRequests = [];
globalThis.fetch = async url => {
  if (String(url).includes('waybackconfig')) return { ok: true, json: async () => ({
    ...config, 900: { ...config[800], itemTitle: 'World Imagery (Wayback 2025-12-05)' },
  }) };
  metadataRequests.push(String(url));
  return { ok: true, json: async () => ({ results: [
    { attributes: { SRC_DATE: '20250612', SRC_RES: .5, NICE_DESC: 'Same provider' } },
  ] }) };
};
try {
  const found = await listPropertyImagery({ lat: 40.12, lng: -81.15 });
  assert.equal(found.options.length, 1, 'Repeated archive releases of the same capture must be deduplicated');
  assert.equal(found.options[0].leafOffCandidate, false);
  assert.match(metadataRequests[0], /geometry=-81.15%2C40.12/, 'Metadata must be queried at the property');
  assert.ok(found.warnings.some(text => /No winter/.test(text)));
  assert.ok(found.warnings.some(text => /Sampled/.test(text)));
  assert.equal(found.partial, false);
  const calls = metadataRequests.length;
  await listPropertyImagery({ lat: 40.12, lng: -81.15 });
  assert.equal(metadataRequests.length, calls, 'Repeated comparisons must reuse recent property results');
  await assert.rejects(listPropertyImagery({ lat: NaN, lng: -81 }), /valid property/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(listPropertyImagery({ lat: 40.12, lng: -81.15, signal: abort.signal }), { name: 'AbortError' });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ error: { message: 'Catalog unavailable' } }) });
  await assert.rejects(listPropertyImagery({ lat: 39, lng: -81 }), /Catalog unavailable/);
} finally {
  globalThis.fetch = originalFetch;
}
console.log('PASS: real acquisition dates, no false winter claims, property scoping, deduplication, cache, cancellation, provider errors');
