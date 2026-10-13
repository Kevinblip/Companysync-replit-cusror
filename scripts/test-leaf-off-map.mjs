import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  chooseWinterCapture, createImageryPickerControl, makeEsriOverzoomOverlay,
  getImageryBaseType,
} from '../src/lib/mapImagery.js';

assert.equal(chooseWinterCapture([
  { captureDate: '2025-06-12', releaseDate: '2026-01-01' },
]), null, 'A winter archive publication must not count as a winter capture');
assert.equal(chooseWinterCapture([
  { captureDate: '2020-11-04' }, { captureDate: '2012-02-03' },
]).captureDate, '2012-02-03', 'Prefer deep winter over early November');

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
globalThis.document = dom.window.document;
globalThis.window = dom.window;
window.google = { maps: {
  Size: class { constructor(width, height) { Object.assign(this, { width, height }); } },
  ImageMapType: class { constructor(options) { Object.assign(this, options); } },
  event: { removeListener() {} },
} };
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => ({
  ok: true,
  json: async () => String(url).includes('waybackconfig') ? {
    1: {
      itemTitle: 'World Imagery (Wayback 2026-01-01)',
      metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/summer/MapServer',
      itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/1/{level}/{row}/{col}',
    },
    2: {
      itemTitle: 'World Imagery (Wayback 2025-12-01)',
      metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/winter/MapServer',
      itemURL: 'https://wayback.maptiles.arcgis.com/arcgis/rest/services/2/{level}/{row}/{col}',
    },
  } : { results: [{ attributes: {
    SRC_DATE: String(url).includes('/winter/') ? '20120203' : '20250612',
    SRC_RES: .5, NICE_DESC: 'Test provider',
  } }] },
});
let type = 'satellite';
let overlays = [];
let base;
const map = {
  getCenter: () => ({ lat: 40, lng: -81 }),
  setMapTypeId(value) { type = value; },
  setTilt(value) { assert.equal(value, 0); },
  mapTypes: { set(id, value) { assert.equal(id, 'cs-imagery-empty'); base = value; } },
  overlayMapTypes: { clear() { overlays = []; }, push(value) { overlays.push(value); } },
  addListener() { return {}; },
};
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setTimeout(resolve, 1)); };
try {
  const panel = createImageryPickerControl({ map });
  document.body.append(panel);
  panel.querySelector('[data-imagery-source="leaf_off"]').click();
  assert.equal(type, 'cs-imagery-empty', 'Do not show the current photo during a winter lookup');
  await flush();
  assert.equal(overlays.length, 1, 'Leaf-off must actually apply the capture without a second selection');
  assert.match(panel.textContent, /Feb 3, 2012/);
  assert.equal(panel.querySelector('select').value, '1');
  assert.equal(panel.querySelector('[data-imagery-source="leaf_off"]').getAttribute('aria-pressed'), 'true');
  assert.equal(base.getTileUrl(), null, 'No Google photograph belongs underneath a historical capture');
  map.setMapTypeId(getImageryBaseType(map));
  assert.equal(type, 'cs-imagery-empty', 'Top/compass controls must preserve the winter base');
  panel.querySelector('[data-imagery-source="google"]').click();
  assert.equal(type, 'satellite');
  assert.equal(getImageryBaseType(map), 'satellite');
  assert.equal(overlays.length, 0);
  panel.querySelector('[data-imagery-source="esri_clarity"]').click();
  assert.equal(type, 'cs-imagery-empty', 'Current Esri must not silently show Google either');

  let quality;
  globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'.repeat(5000)], { type: 'application/json' }) });
  const invalid = makeEsriOverzoomOverlay({
    urlTemplate: 'https://example.test/{z}/{x}/{y}', preferMax: 20, floor: 18, name: 'Invalid image',
    onQuality: result => { quality = result; },
  });
  const tile = invalid.getTile({ x: 143326, y: 195802 }, 19, document);
  await flush();
  assert.equal(quality.status, 'unavailable', 'A large JSON error response is not a photograph');
  assert.equal(tile.querySelector('img'), null);
  invalid.releaseTile(tile);

  quality = undefined;
  globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'.repeat(5000)], { type: 'image/jpeg' }) });
  const valid = makeEsriOverzoomOverlay({
    urlTemplate: 'https://example.test/{z}/{x}/{y}', preferMax: 20, floor: 18, name: 'Winter capture',
    onQuality: result => { quality = result; },
  });
  const imageTile = valid.getTile({ x: 143326, y: 195802 }, 19, document);
  await flush();
  assert.equal(quality, undefined, 'Do not report success before the browser decodes the image');
  imageTile.querySelector('img').onload();
  assert.equal(quality.status, 'native');
  valid.releaseTile(imageTile);
  console.log('PASS: one-click winter selection, winter-vs-release dates, no Google bleed-through, default reset, invalid tile rejection, image-load confirmation');
} finally {
  globalThis.fetch = originalFetch;
  dom.window.close();
}

const manualMapSource = readFileSync(new URL('../src/components/satellite/InteractiveRoofMap.jsx', import.meta.url), 'utf8');
const aiMapSource = readFileSync(new URL('../src/pages/AIEstimator.jsx', import.meta.url), 'utf8');
for (const [name, source] of [['manual roof map', manualMapSource], ['AI estimator map', aiMapSource]]) {
  assert.doesNotMatch(source, /createImageryPickerControl|fetchWaybackIds/,
    `${name} must not show the unreliable alternate imagery selector or fetch archive options`);
}
assert.match(aiMapSource, /imagery_source:\s*'google'/,
  'AI roof measurements must use the standard Google imagery source while alternate controls are hidden');
console.log('PASS: alternate imagery selectors are hidden on both roof maps');
