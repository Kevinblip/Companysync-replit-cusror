#!/usr/bin/env node
/**
 * Street-facing photo slot convention.
 * Left/right are named from the street, looking at the front. Back Right is
 * on the viewer's left when they stand behind the house.
 */
'use strict';

let passed = 0;
let failed = 0;
function ok(label, cond, got, expected) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else {
    console.log(`  ✗ ${label} — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    failed++;
  }
}

(async () => {
  const {
    slotFaces, slotHint, streetFacingWallAzimuths, headingToWallFace, cameraForWall,
  } = await import('../functions/utils/photoSlotOrientation.js');

  ok('BR Corner is the back and the street-right wall',
    JSON.stringify(slotFaces('BR Corner')) === JSON.stringify(['back', 'right_side']),
    slotFaces('BR Corner'));
  ok('BL Corner is the back and the street-left wall',
    JSON.stringify(slotFaces('BL Corner')) === JSON.stringify(['back', 'left_side']),
    slotFaces('BL Corner'));
  ok('Left Side is the street-left wall', slotFaces('Left Side')[0] === 'left_side');
  ok('Right Side is the street-right wall', slotFaces('Right Side')[0] === 'right_side');
  ok('Back Right hint says it is on your left from behind',
    /your left from behind/.test(slotHint('BR Corner')), slotHint('BR Corner'));

  // South-facing front. Viewer stands south, looks north.
  // Their left is west (270°). Their right is east (90°).
  const south = streetFacingWallAzimuths(180);
  ok('left wall of a south-facing front faces west', south.left === 270, south.left, 270);
  ok('right wall of a south-facing front faces east', south.right === 90, south.right, 90);

  const frontShot = headingToWallFace(0, south);
  ok('camera looking north photographs the south-facing front',
    frontShot.face === 'front' && frontShot.isOblique === false, frontShot);
  const leftShot = headingToWallFace(90, south);
  ok('camera looking east photographs the street-left wall',
    leftShot.face === 'left_side' && leftShot.isOblique === false, leftShot);
  const rightShot = headingToWallFace(270, south);
  ok('camera looking west photographs the street-right wall',
    rightShot.face === 'right_side', rightShot);

  // Standing behind the house, looking at the back (heading south = 180).
  // The street-right corner is on this viewer's left, which is the BR slot.
  const behind = headingToWallFace(180, south);
  ok('camera behind the house photographs the back', behind.face === 'back', behind);
  const stand = cameraForWall(south.front);
  ok('the front camera stands on the street side of the front wall',
    stand.searchBearing === 180 && stand.cameraHeading === 0, stand);

  console.log(`\n[test-photo-slot-orientation] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
