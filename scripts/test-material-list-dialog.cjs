#!/usr/bin/env node
'use strict';

/**
 * Regression guard for the Material Purchase List dialog.
 *
 * The add-miscellaneous-item UI is rendered as soon as the dialog opens, so
 * both its item collection and draft item must be React state in the editor's
 * component scope. Without them, React throws before a user can see the list.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'pages', 'EstimateEditor.jsx'),
  'utf8',
);

const state = (name) =>
  new RegExp(
    `const\\s+\\[${name},\\s*set${name[0].toUpperCase()}${name.slice(1)}\\]\\s*=\\s*useState\\(`,
  ).test(source);

assert.equal(
  state('extraMaterialItems'),
  true,
  'Material list must initialize extraMaterialItems state before render',
);
assert.equal(
  state('newExtraItem'),
  true,
  'Material list must initialize newExtraItem state before render',
);
assert.match(
  source,
  /setExtraMaterialItems\(\[\]\).*setNewExtraItem\(\{\s*description:\s*'',\s*quantity:\s*1,\s*unit:\s*'EA',\s*trade:\s*'Roofing'/s,
  'Closing the material list must reset both custom-item states',
);
assert.match(
  source,
  /setExtraMaterialItems\(prev\s*=>\s*\[\.\.\.prev,\s*\{\s*\.\.\.newExtraItem,\s*_extra:\s*true/s,
  'Adding a custom material must append it through state rather than mutate the list',
);

console.log('✓ Material list dialog state is initialized, reset, and used for custom items.');