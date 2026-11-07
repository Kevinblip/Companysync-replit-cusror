#!/usr/bin/env node
/**
 * Bench mode C helper.
 *
 * Builds confirmed_face_heights from Hover's per-wall height
 * (wall area / width) and passes confirmed material shares through.
 * The height is stored as a ruler eave, so the analyzer bills that
 * foot-measure instead of the swinging AI height.
 *
 *   node scripts/bench/mode-c-confirmed.cjs path/to/mode-c.json
 *
 * The JSON is { walls: [{ face, area_sqft, width_ft }], materials: { front: { shares } } }.
 * With no file, the module only exports the helper for tests.
 */
'use strict';

const { confirmedModeC } = require('../../db/siding-aggregate.cjs');

function modeCFromHover(input) {
  return confirmedModeC({
    walls: input?.walls || input?.hover_walls || [],
    materials: input?.materials || input?.confirmed_face_materials || {},
  });
}

module.exports = { modeCFromHover, confirmedModeC };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.log('Usage: node scripts/bench/mode-c-confirmed.cjs <mode-c.json>');
    process.exit(0);
  }
  const fs = require('node:fs');
  const payload = modeCFromHover(JSON.parse(fs.readFileSync(file, 'utf8')));
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
