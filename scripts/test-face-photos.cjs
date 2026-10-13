#!/usr/bin/env node
/** Unit tests for face photo collection (3D photo-texture mode). */
async function main() {
  const { canonicalFaceLabel, buildFacePhotos } = await import('../src/utils/facePhotos.js');

  let pass = 0, fail = 0;
  const ok = (cond, label, detail = '') => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label} ${detail}`); }
  };

  // Label canonicalization
  ok(canonicalFaceLabel('Front') === 'front', 'Front → front');
  ok(canonicalFaceLabel('Left Side') === 'left', '"Left Side" → left');
  ok(canonicalFaceLabel('right-side') === 'right', '"right-side" → right');
  ok(canonicalFaceLabel('Rear') === 'back', 'Rear → back');
  ok(canonicalFaceLabel('Back') === 'back', 'Back → back');
  ok(canonicalFaceLabel('garage interior') === null, 'unknown label dropped');
  ok(canonicalFaceLabel('') === null && canonicalFaceLabel(null) === null, 'empty label dropped');

  // Uploaded photos win over Street View for the same face
  const photos = buildFacePhotos({
    housePhotos: [{ url: '/api/uploads/front.jpg', label: 'Front' }],
    elevationImages: [
      { available: true, imageUrl: 'https://maps.example/sv-front', direction: 'Front' },
      { available: true, imageUrl: 'https://maps.example/sv-back', direction: 'Back' },
      { available: false, imageUrl: 'https://maps.example/sv-left', direction: 'Left' }, // unavailable
      { available: true, imageUrl: 'https://maps.example/sv-right', direction: 'Right', _staticApiNotEnabled: true }, // API off
    ],
  });
  ok(photos.length === 2, 'one photo per face, unavailable/API-off skipped', JSON.stringify(photos));
  const front = photos.find(p => p.face === 'front');
  ok(front?.url === '/api/uploads/front.jpg' && front.source === 'upload', 'upload beats street view for same face');
  ok(photos.find(p => p.face === 'back')?.source === 'street_view', 'street view fills un-photographed face');

  // Empty input
  ok(buildFacePhotos().length === 0, 'empty input → empty output');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
