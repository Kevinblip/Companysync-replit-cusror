#!/usr/bin/env node
/**
 * One-time/maintenance uploader: pushes large app videos to public object
 * storage so they no longer ship inside the published app image.
 *
 * Object names mirror the URL paths:
 *   public/videos/<file>.mp4                     -> videos/<file>.mp4
 *   public/generated_marketing_videos/<file>.mp4 -> generated_marketing_videos/<file>.mp4
 *
 * The app serves these via a 302 redirect to a signed GCS URL when the file
 * is not on local disk (see prod-server.cjs + vite-integrations-plugin.js).
 *
 * Idempotent: skips objects that already exist with the same byte size.
 */
const fs = require('fs');
const path = require('path');
const { uploadToObjectStorage, objectExistsInStorage, downloadFromObjectStorage, isObjectStorageAvailable } = require('../db/object-storage.cjs');

const DIRS = [
  { local: path.join(__dirname, '..', 'public', 'videos'), prefix: 'videos' },
  { local: path.join(__dirname, '..', 'public', 'generated_marketing_videos'), prefix: 'generated_marketing_videos' },
];

(async () => {
  if (!(await isObjectStorageAvailable())) {
    console.error('Object storage sidecar not reachable — aborting.');
    process.exit(1);
  }
  let uploaded = 0, skipped = 0, failed = 0;
  for (const { local, prefix } of DIRS) {
    if (!fs.existsSync(local)) { console.log(`(missing dir ${local}, skipping)`); continue; }
    const files = fs.readdirSync(local).filter(f => f.endsWith('.mp4'));
    for (const f of files) {
      const objectName = `${prefix}/${f}`;
      const buf = fs.readFileSync(path.join(local, f));
      try {
        const existing = await downloadFromObjectStorage(objectName).catch(() => null);
        if (existing && existing.length === buf.length) {
          console.log(`SKIP ${objectName} (already uploaded, ${buf.length} bytes)`);
          skipped++;
          continue;
        }
        await uploadToObjectStorage(objectName, buf, 'video/mp4');
        const exists = await objectExistsInStorage(objectName);
        if (!exists) throw new Error('verify-after-upload failed');
        console.log(`OK   ${objectName} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
        uploaded++;
      } catch (e) {
        console.error(`FAIL ${objectName}: ${e.message}`);
        failed++;
      }
    }
  }
  console.log(`\nDone. uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
