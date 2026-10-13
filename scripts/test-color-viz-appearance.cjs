'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Evaluate the pure prompt builder without loading the server or calling paid AI.
// Both contractor and homeowner generation call this same function.
const source = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const start = source.indexOf('function buildColorVizPrompt(');
const end = source.indexOf('// Persist a generated/source image', start);
assert.ok(start >= 0 && end > start, 'shared prompt builder is present');
const buildColorVizPrompt = vm.runInNewContext(`${source.slice(start, end)}\nbuildColorVizPrompt`);
assert.match(source.slice(end), /const prompt = buildColorVizPrompt\(colorScheme, params\.zones \|\| \[\]\)/);
assert.match(source.slice(end), /const prompt = buildColorVizPrompt\(colorScheme, \[\]\)/);

const angelaScheme = {
  roof: 'Estate Gray',
  roofBrand: 'owens_corning',
  siding: 'Chesapeake Gray',
  sidingMaterial: 'vinyl',
  trim: 'Snow White',
  soffit: 'Snow White',
  shutters: 'Black',
  cornerPosts: 'White',
  cornerPostStyle: 'standard',
};
const prompt = buildColorVizPrompt(angelaScheme, []);
assert.ok(prompt.indexOf('visible ROOF SHINGLES') < prompt.indexOf('Siding and exterior walls'), 'roof gets priority before siding');
assert.match(prompt, /Owens Corning Estate Gray.*#6E6E6E/);
assert.match(prompt, /lower wings, side additions/);
assert.match(prompt, /do not leave an existing brown roof unchanged/);
assert.match(prompt, /recolor only existing visible corner boards/);
assert.match(prompt, /never pure glowing #FFFFFF/);
assert.match(prompt, /preserve.*cast shadows and darker shaded faces/i);
assert.doesNotMatch(prompt, /stark-white|BRIGHT WHITE \(#FFFFFF\)/i);
assert.match(prompt, /preserve brick, stone, and other existing masonry/);

const matching = buildColorVizPrompt({ siding: 'Blue', cornerPosts: 'Match Siding', cornerPostStyle: 'standard' }, []);
assert.match(matching, /same color as the siding \(Blue\)/);
assert.doesNotMatch(matching, /visible ROOF SHINGLES/);

const stone = buildColorVizPrompt({ cornerPosts: 'Clay', cornerPostStyle: 'stone_wrap' }, []);
assert.match(stone, /stacked stone veneer at actual building corners/);
assert.match(stone, /restyle only actual outside building corners/);
assert.doesNotMatch(stone, /do not add new boards, widen them/);

console.log('Color visualizer appearance prompt checks passed');