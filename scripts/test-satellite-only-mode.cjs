#!/usr/bin/env node
'use strict';

/**
 * Static regression guard for the UI contract:
 * Satellite mode must work without house photos or Street View.
 *
 * Photo-collection + de-duplication logic now lives in
 * src/utils/sidingPhotoList.js (extracted from AIEstimator.jsx).
 * Assertions that check the implementation detail of *how* photos are
 * excluded now target the utility file; call-site and UI assertions
 * remain against AIEstimator.jsx.
 */
const fs   = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('src/pages/AIEstimator.jsx', 'utf8');
const helper = fs.readFileSync('src/utils/sidingPhotoList.js', 'utf8');

// ── AIEstimator.jsx call-site assertions ─────────────────────────────────────

assert.match(
  source,
  /const handleAnalyzeSiding = async \(structureOverride, \{ satelliteOnly = false, autoBuild = true \} = \{\}\)/,
  'siding handler accepts an explicit satellite-only request'
);

// The handler now delegates to buildSidingPhotoList and passes satelliteOnly through
assert.match(
  source,
  /buildSidingPhotoList\(\{/,
  'handler delegates photo collection to buildSidingPhotoList'
);
assert.match(
  source,
  /satelliteOnly,/,
  'call site forwards the satelliteOnly flag to buildSidingPhotoList'
);

assert.match(
  source,
  /data-testid="button-analyze-satellite-siding"/,
  'Satellite mode exposes its own measure button'
);
assert.match(
  source,
  /handleAnalyzeSiding\(undefined, \{ satelliteOnly: true, autoBuild: false \}\)/,
  'Satellite button explicitly requests the no-photo measurement path'
);
assert.match(
  source,
  /data-testid=\{useSatelliteMode \? "button-analyze-photos-satellite" : "button-analyze-photos"\}/,
  'Satellite mode keeps the photo-and-satellite measurement action available'
);
assert.match(
  source,
  /onClick=\{useSatelliteMode \? \(\) => handleAnalyzeSiding\(undefined, \{ autoBuild: false \}\) : handleAnalyzePhotos\}/,
  'combined action invokes the existing photo plus satellite siding path'
);
assert.doesNotMatch(
  source,
  /!useSatelliteMode && \(\s*<>\s*\{\/\*\s*Named photo slots/,
  'photo uploader remains available while Satellite mode is active'
);
assert.doesNotMatch(
  source,
  /Satellite mode: Google Maps footprint is combined with your photos/,
  'Satellite mode no longer claims that photos are required'
);

// ── sidingPhotoList.js implementation assertions ─────────────────────────────
// These moved out of AIEstimator.jsx into the pure utility so they can be
// tested independently (see test:sv-siding-fallback).

assert.match(
  helper,
  /const usableSv = satelliteOnly \? \[\] : \(elevationImages \|\| \[\]\)/,
  'satellite-only requests exclude Street View photos'
);
assert.match(
  helper,
  /const uploadedPhotos = !satelliteOnly && !isGarageStructure/,
  'satellite-only requests exclude uploaded house photos'
);
// The estimator's per-frame veto must be applied where the submitted photo list
// is built, not only in the UI, or a re-run silently re-admits the bad frame.
assert.match(
  helper,
  /excludedKeys\.has\(streetViewFrameKey\(img\)\)/,
  'buildSidingPhotoList drops estimator-excluded Street View frames'
);

console.log('✓ Satellite siding mode is explicit, photo-free, and has a direct measurement action.');
