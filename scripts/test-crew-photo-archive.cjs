#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { default: JSZip } = await import('jszip');
  const { createCrewPhotoArchive } = await import('../src/utils/crewPhotoArchive.js');

  const photos = [
    {
      id: 'photo-1',
      file_url: 'https://files.example/roof-front.jpg?signature=one',
      caption: 'Front / roof',
      created_at: '2026-09-26T12:00:00.000Z',
    },
    {
      id: 'photo-2',
      url: 'https://files.example/side.png',
      caption: 'Side elevation',
      created_date: '2026-09-25',
    },
  ];
  const progress = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const archiveBlob = await createCrewPhotoArchive(photos, {
    fetchImpl: async (url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      const isPng = url.includes('.png');
      return {
        ok: true,
        status: 200,
        headers: { get: () => isPng ? 'image/png' : 'image/jpeg' },
        blob: async () => new Blob([isPng ? 'png-bytes' : 'jpg-bytes'], {
          type: isPng ? 'image/png' : 'image/jpeg',
        }),
      };
    },
    onProgress: (value) => progress.push(value),
  });

  const zip = await JSZip.loadAsync(new Uint8Array(await archiveBlob.arrayBuffer()));
  const entries = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  assert.equal(entries.length, 2, 'the archive contains every requested photo');
  assert.ok(entries.some((name) => name.includes('001_2026-09-26_front-roof_photo-1.jpg')));
  assert.ok(entries.some((name) => name.includes('002_2026-09-25_side-elevation_photo-2.png')));
  const jpgName = entries.find((name) => name.endsWith('.jpg'));
  const pngName = entries.find((name) => name.endsWith('.png'));
  assert.equal(await zip.file(jpgName).async('string'), 'jpg-bytes');
  assert.equal(await zip.file(pngName).async('string'), 'png-bytes');
  assert.equal(maxInFlight, 1, 'photo downloads are sequential');
  assert.deepEqual(progress, [
    { completed: 1, total: 2 },
    { completed: 2, total: 2 },
  ]);

  const customerProfile = fs.readFileSync(
    path.join(__dirname, '../src/pages/CustomerProfile.jsx'),
    'utf8',
  );
  assert.ok(
    customerProfile.includes('data-testid="button-download-all-crew-photos"'),
    'the crew photo gallery exposes a bulk-download control',
  );
  assert.ok(
    customerProfile.includes('createCrewPhotoArchive(crewPhotos,'),
    'the archive includes the full photo set rather than only the active filter',
  );
  assert.ok(
    customerProfile.includes('Attach the Certificate of Completion separately.'),
    'the user is told the certificate is a separate attachment',
  );

  await assert.rejects(
    createCrewPhotoArchive(photos, {
      fetchImpl: async (url) => url.includes('.png')
        ? { ok: false, status: 503 }
        : {
            ok: true,
            status: 200,
            headers: { get: () => 'image/jpeg' },
            blob: async () => new Blob(['jpg-bytes'], { type: 'image/jpeg' }),
          },
    }),
    /Could not download 1 of 2 photos, so no ZIP was created/,
  );

  await assert.rejects(
    createCrewPhotoArchive([]),
    /There are no crew photos to download/,
  );

  console.log('Crew photo archive checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});