#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const imagery = fs.readFileSync('src/lib/mapImagery.js', 'utf8');
const interactive = fs.readFileSync('src/components/satellite/InteractiveRoofMap.jsx', 'utf8');
const preview = fs.readFileSync('src/components/satellite/SatelliteMapPreview.jsx', 'utf8');

assert.match(imagery, /MAX_MEASUREMENT_ZOOM\s*=\s*20/, 'measurement imagery needs a documented zoom ceiling');
assert.match(imagery, /const floor = 18/, 'alternate imagery must not upscale below zoom 18');
assert.match(imagery, /'upscaled'\s*:\s*'native'/, 'alternate imagery must report upscaling');
assert.match(interactive, /zoom: 19/, 'interactive map should open below the overzoom ceiling');
assert.match(interactive, /maxZoom: MAX_MEASUREMENT_ZOOM/, 'interactive map must cap overzoom');
assert.match(interactive, /perspective-view-warning/, 'tilted views need a reference-only warning');
assert.match(interactive, /if \(map && \(map\.getTilt\?\.\(\) \|\| 0\) > 0\)/, 'drawing must return to top-down first');
assert.match(preview, /zoom: 19/, 'address preview should avoid overzoom');
assert.match(preview, /maxZoom: MAX_MEASUREMENT_ZOOM/, 'address preview must cap overzoom');

console.log('PASS: satellite imagery avoids overzoom and labels perspective/quality limits');