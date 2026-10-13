'use strict';

const assert = require('node:assert/strict');
const {
  isUsableDamageSection,
  materialAllowsDetection,
  qualifyDamageCandidates,
  filterSpatiallySuspiciousHailDetections,
  qualifyChalkDamageObservations,
  normalizePhotoType,
  parseInspectorCorrection,
} = require('../lib/photoSyncDamageRules.cjs');

assert.equal(isUsableDamageSection('Left Elevation'), true);
assert.equal(isUsableDamageSection('North Slope'), true);
assert.equal(isUsableDamageSection('Other'), false);
assert.equal(isUsableDamageSection('All Photos'), false);

assert.equal(normalizePhotoType('test_square'), 'Test Square');
assert.equal(normalizePhotoType('close up'), 'Close-up');
assert.equal(normalizePhotoType('roof_closeup'), 'Close-up');
assert.equal(normalizePhotoType('wide shot'), 'Overview');

const box = [10, 10, 20, 20];
const candidate = (type, damage_kind, confidence = 85, evidence = []) => ({
  type, damage_kind, confidence, evidence, box_2d: box,
});
assert.equal(materialAllowsDetection('siding_vinyl', candidate('hail', 'crack')), true);
assert.equal(materialAllowsDetection('siding_vinyl', candidate('hail', 'round_dent')), false);
assert.equal(materialAllowsDetection('siding_aluminum', candidate('hail', 'round_dent')), true);
assert.equal(materialAllowsDetection('roof_shingle', candidate('hail', 'round_impact', 90, ['granule_loss'])), true);
assert.equal(materialAllowsDetection('roof_shingle', candidate('hail', 'round_impact', 90, [])), false);
assert.equal(materialAllowsDetection('roof_shingle', candidate('wind', 'missing_tab')), true);
assert.equal(materialAllowsDetection('gutter_downspout', candidate('wind', 'missing_tab')), false);

const scored = qualifyDamageCandidates([
  candidate('hail', 'crack', 74),
  candidate('hail', 'round_dent', 92),
  candidate('hail', 'crack', 65),
], 'siding_vinyl');
assert.equal(scored.qualified.length, 1);
assert.equal(scored.qualified[0].damage_kind, 'crack');
assert.equal(scored.possible.length, 2);
assert.equal(qualifyDamageCandidates([candidate('hail', 'crack')], 'unknown').qualified.length, 0);

const positionedHit = (x, y) => ({
  ...candidate('hail', 'round_impact', 90, ['granule_loss']),
  box_2d: [y - 2, x - 2, y + 2, x + 2],
});
const horizontal = Array.from({ length: 20 }, (_, i) => positionedHit(80 + i * 35, 420));
const horizontalResult = filterSpatiallySuspiciousHailDetections(horizontal);
assert.equal(horizontalResult.suppressed.length, 20);
assert.equal(horizontalResult.accepted.length, 0);

const diagonal = Array.from({ length: 22 }, (_, i) => positionedHit(70 + i * 30, 80 + i * 30));
const diagonalResult = filterSpatiallySuspiciousHailDetections(diagonal);
assert.equal(diagonalResult.suppressed.length, 22);

const dispersed = [];
for (let y = 0; y < 5; y += 1) {
  for (let x = 0; x < 5; x += 1) {
    dispersed.push(positionedHit(80 + x * 180, 90 + y * 180));
  }
}
const dispersedResult = filterSpatiallySuspiciousHailDetections(dispersed);
assert.equal(dispersedResult.suppressed.length, 0);
assert.equal(dispersedResult.accepted.length, 25);

const chalkReview = qualifyChalkDamageObservations([
  { underlying_damage_visible: true, damage_kind: 'hail_hit', evidence: ['human_chalk_circle'] },
  { underlying_damage_visible: true, damage_kind: 'hail_hit', evidence: ['bruising'] },
  { underlying_damage_visible: true, damage_kind: 'crease', evidence: ['visible crease'] },
  { underlying_damage_visible: false, damage_kind: 'hail_hit', evidence: ['granule_loss'] },
]);
assert.deepEqual(chalkReview, { hail: 1, wind: 1, rejected: 2 });

const parsed = parseInspectorCorrection('Aluminum siding, not vinyl; 3-tab shingles with 5-inch exposure and 2 layers');
assert.equal(parsed.material_category, 'siding_aluminum');
assert.equal(parsed.shingle_type, '3-tab');
assert.equal(parsed.shingle_exposure_inches, 5);
assert.equal(parsed.roof_layers, 2);
assert.equal(parseInspectorCorrection('No material confirmation needed').material_category, undefined);

console.log('PhotoSync damage rules: material gates, confidence thresholds, section requirements, photo types, and correction parsing passed.');
