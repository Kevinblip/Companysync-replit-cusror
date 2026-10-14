const fs = require('node:fs');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const ui = fs.readFileSync('src/pages/AIEstimator.jsx', 'utf8');
const live = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const prodDispatch = fs.readFileSync('db/prod-integrations.cjs', 'utf8');

assert(
  ui.includes('satellite_wall_width_ft: getSatelliteWallWidthAnchor(p.label)'),
  'uploaded photos receive a satellite wall-width anchor'
);
assert(
  ui.includes("normalized.includes('front') || normalized.includes('back') || normalized.includes('rear')") &&
  ui.includes('return satelliteWidthFt;') &&
  ui.includes("normalized.includes('left') || normalized.includes('right')") &&
  ui.includes('return satelliteLengthFt;'),
  'front/back map to building width and sides map to building length'
);
assert(
  ui.includes("if (/corner|angle|detail|close.?up|other/.test(normalized)) return null;") &&
  live.includes("if (/corner|angle|detail|close.?up|other/.test(normalized)) return 0;"),
  'corner/detail labels cannot receive straight-face width anchors'
);
assert(
  live.includes('SATELLITE WALL-WIDTH SCALE ANCHOR (MANDATORY)'),
  'the live prompt requires the satellite scale anchor'
);
assert(
  live.includes('Do not set wall_width_ft to') &&
  live.includes('result.measured_wall_width_ft = Number(result.wall_width_ft)') &&
  !live.includes('result.wall_width_ft = satelliteWallWidthFt'),
  'the live handler keeps each elevation\'s measured length instead of copying the satellite side onto both walls'
);
assert(
  live.includes('[SidingScaleAnchor]'),
  'the live handler emits verification logs'
);
assert(
  prodDispatch.includes('const mod = await import(pluginPath)') &&
  prodDispatch.includes('_functionHandlersCache = mod.functionHandlers || {}'),
  'production imports the same live handler registry'
);

if (process.exitCode) process.exit(process.exitCode);
console.log('All siding scale-anchor guards passed.');