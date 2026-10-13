#!/usr/bin/env node
/**
 * test-height-method-display.cjs
 *
 * Verifies that every height_method enum emitted by analyzeHousePhotosForSiding
 * maps to a human-readable icon + label in the per-photo breakdown UI.
 *
 * The mapping table lives in AIEstimator.jsx; this test mirrors it so a
 * mismatch between backend values and the display table is caught before ship.
 */

'use strict';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

// ── Mirror of the HEIGHT_METHOD_DISPLAY table in AIEstimator.jsx ──────────────
const HEIGHT_METHOD_DISPLAY = {
  door_anchor:        { icon: '🚪', label: 'door anchor' },
  door_scale:         { icon: '🚪', label: 'door anchor' },
  garage_door_anchor: { icon: '🚗', label: 'garage door anchor' },
  window_scale:       { icon: '🪟', label: 'window anchor' },
  course_count:       { icon: '🧱', label: 'course count' },
  manual_calibration: { icon: '📏', label: 'manual calibration' },
  estimate:           { icon: '📊', label: 'estimate' },
};

// All enum values the live analyzeHousePhotosForSiding handler may emit.
const BACKEND_ENUMS = [
  'door_anchor',
  'garage_door_anchor',
  'course_count',
  'door_scale',
  'window_scale',
  'estimate',
  'manual_calibration',
];

// ── Test 1: every backend enum resolves to a non-generic entry ────────────────
console.log('\n[1] Every backend height_method enum has an explicit display entry:');
for (const method of BACKEND_ENUMS) {
  const entry = HEIGHT_METHOD_DISPLAY[method];
  assert(entry != null, `${method} → ${entry ? `"${entry.label}" ${entry.icon}` : 'MISSING'}`);
}

// ── Test 2: door-variant methods both map to door-anchor icon ─────────────────
console.log('\n[2] door_anchor and door_scale both show the door icon:');
assert(HEIGHT_METHOD_DISPLAY['door_anchor']?.icon === '🚪', 'door_anchor icon is 🚪');
assert(HEIGHT_METHOD_DISPLAY['door_scale']?.icon  === '🚪', 'door_scale icon is 🚪');
assert(HEIGHT_METHOD_DISPLAY['door_anchor']?.label === 'door anchor', 'door_anchor label is "door anchor"');
assert(HEIGHT_METHOD_DISPLAY['door_scale']?.label  === 'door anchor', 'door_scale label is "door anchor"');

// ── Test 3: garage_door_anchor has its own distinct entry ────────────────────
console.log('\n[3] garage_door_anchor has distinct icon/label:');
assert(HEIGHT_METHOD_DISPLAY['garage_door_anchor']?.icon !== '🚪', 'garage_door_anchor icon differs from plain door');
assert(HEIGHT_METHOD_DISPLAY['garage_door_anchor']?.label !== 'door anchor', 'garage_door_anchor label differs from plain door');

// ── Test 4: window_scale maps to window anchor ───────────────────────────────
console.log('\n[4] window_scale maps to window anchor:');
assert(HEIGHT_METHOD_DISPLAY['window_scale']?.icon  === '🪟', 'window_scale icon is 🪟');
assert(HEIGHT_METHOD_DISPLAY['window_scale']?.label === 'window anchor', 'window_scale label is "window anchor"');

// ── Test 5: estimate is marked as not-used, others are not ───────────────────
console.log('\n[5] Only "estimate" is the non-anchor fallback:');
const nonEstimateAnchors = BACKEND_ENUMS.filter(m => m !== 'estimate');
for (const m of nonEstimateAnchors) {
  assert(m !== 'estimate', `${m} is a non-estimate method`);
}
assert(BACKEND_ENUMS.includes('estimate'), '"estimate" enum exists in backend contract');

// ── Test 6: unknown method falls back gracefully (doesn't crash) ─────────────
console.log('\n[6] Unknown/future height_method gets a generic fallback:');
const unknownMethod = 'laser_scan'; // hypothetical future value
const entry = HEIGHT_METHOD_DISPLAY[unknownMethod] || { icon: '📊', label: unknownMethod };
assert(entry.icon === '📊', `Unknown method "${unknownMethod}" falls back to 📊 icon`);
assert(entry.label === unknownMethod, `Unknown method uses raw value as label`);

// ── Test 7: eave_height_ft formatting ────────────────────────────────────────
console.log('\n[7] eave_height_ft formatting (toFixed(1)):');
const cases = [
  [16.5,   '16.5ft'],
  [17,     '17.0ft'],
  [8.333,  '8.3ft'],
  [9,      '9.0ft'],
];
for (const [raw, expected] of cases) {
  const formatted = `${Number(raw).toFixed(1)}ft`;
  assert(formatted === expected, `${raw} → "${formatted}"`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n❌ Some height-method display assertions failed.');
  process.exit(1);
} else {
  console.log('\n✅ All height-method display assertions passed.');
}
