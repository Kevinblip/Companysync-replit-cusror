#!/usr/bin/env node
/** Regression checks for the shared map-compass to calculated-facade mapping. */
async function main() {
  const { facadeForCompass, normalizeFacade, facadeAzimuth, semanticFacadeForAzimuth } =
    await import('../src/utils/facadeOrientation.js');
  let passed = 0;
  const ok = (condition, label) => {
    if (!condition) throw new Error(`Failed: ${label}`);
    passed++;
    console.log(`  ✓ ${label}`);
  };

  console.log('\n── Facade orientation ──');
  ok(facadeForCompass('N')?.azimuth === 0, 'north selects physical north');
  ok(facadeForCompass('E')?.azimuth === 90, 'east selects physical east');
  ok(facadeForCompass('S')?.azimuth === 180, 'south selects physical south');
  ok(facadeForCompass('W')?.azimuth === 270, 'west selects physical west');
  ok(normalizeFacade('Right Side') === 'right_side', 'photo side label normalizes');
  ok(normalizeFacade('rear') === 'back', 'rear normalizes to back');
  ok(facadeAzimuth('left') === 270, 'legacy semantic facade helper remains available');
  ok(semanticFacadeForAzimuth(90, { front: 90, right_side: 180, back: 270, left_side: 0 }) === 'front', 'trusted orientation maps east to front');
  ok(semanticFacadeForAzimuth(270, { front: 90, right_side: 180, back: 270, left_side: 0 }) === 'back', 'trusted orientation maps west to back');
  ok(semanticFacadeForAzimuth(0, null) === null, 'missing trusted orientation never guesses evidence');
  ok(semanticFacadeForAzimuth(0, [[0, 0], [0, 40], [20, 40]]) === null, 'a footprint cannot masquerade as trusted orientation');
  ok(facadeForCompass('invalid') === null, 'unknown compass is rejected');
  console.log(`\n${passed} passed`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});