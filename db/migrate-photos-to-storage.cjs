/**
 * One-time migration: move existing file_uploads binary data from PostgreSQL
 * into Replit App Storage (GCS), then NULL out the file_data column.
 *
 * Run: node db/migrate-photos-to-storage.cjs [--dry-run] [--batch=10] [--limit=50]
 * Idempotent: files already in object storage are skipped.
 */
'use strict';

const { uploadToObjectStorage, downloadFromObjectStorage, isObjectStorageAvailable } = require('./object-storage.cjs');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const BATCH_SIZE = parseInt((args.find(a => a.startsWith('--batch=')) || '--batch=10').split('=')[1], 10);
const LIMIT      = parseInt((args.find(a => a.startsWith('--limit=')) || '--limit=9999').split('=')[1], 10);

const MIME_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv', '.txt': 'text/plain',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.tif': 'image/tiff',
};

async function main() {
  console.log('=== Photo Storage Migration ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Batch size: ${BATCH_SIZE}, Limit: ${LIMIT}`);

  const available = await isObjectStorageAvailable();
  if (!available) {
    console.error('ERROR: Object storage sidecar not reachable. Must run on Replit.');
    process.exit(1);
  }
  console.log('Object storage sidecar: OK');
  console.log('Bucket:', process.env.PUBLIC_OBJECT_SEARCH_PATHS);

  const prodDb = require('./prod-db.cjs');
  const pool = prodDb.getPool();

  const countRes = await pool.query(`SELECT COUNT(*) FROM file_uploads WHERE file_data IS NOT NULL`);
  const totalToMigrate = parseInt(countRes.rows[0].count, 10);
  console.log(`\nFiles with binary data in DB: ${totalToMigrate}`);

  if (totalToMigrate === 0) {
    console.log('Nothing to migrate. Done.');
    await pool.end();
    return;
  }

  const toProcess = Math.min(totalToMigrate, LIMIT);
  console.log(`Will process: ${toProcess} files in batches of ${BATCH_SIZE}\n`);

  let offset = 0, migrated = 0, skipped = 0, failed = 0;

  while (migrated + skipped < toProcess) {
    const batchLimit = Math.min(BATCH_SIZE, toProcess - migrated - skipped);
    const batchRes = await pool.query(
      `SELECT id, mime_type, file_size, file_data FROM file_uploads WHERE file_data IS NOT NULL ORDER BY id LIMIT $1 OFFSET $2`,
      [batchLimit, offset]
    );
    if (batchRes.rows.length === 0) break;

    for (const row of batchRes.rows) {
      const { id, mime_type, file_size, file_data } = row;
      const ext = path.extname(id).toLowerCase();
      const resolvedMime = mime_type || MIME_TYPES[ext] || 'application/octet-stream';

      try {
        const existing = await downloadFromObjectStorage(id);
        if (existing && existing.length > 0) {
          console.log(`  SKIP  ${id} (already in object storage)`);
          skipped++;
          if (!DRY_RUN) await pool.query(`UPDATE file_uploads SET file_data = NULL WHERE id = $1`, [id]);
          continue;
        }

        if (!DRY_RUN) {
          await uploadToObjectStorage(id, file_data, resolvedMime);
          const verify = await downloadFromObjectStorage(id);
          if (!verify || verify.length === 0) throw new Error(`Verification failed`);
          await pool.query(`UPDATE file_uploads SET file_data = NULL WHERE id = $1`, [id]);
          console.log(`  OK    ${id} (${Math.round((file_size || file_data.length) / 1024)} KB → object storage)`);
        } else {
          console.log(`  DRY   ${id} (${Math.round((file_size || file_data.length) / 1024)} KB) — would migrate`);
        }
        migrated++;
      } catch (err) {
        console.error(`  FAIL  ${id}: ${err.message}`);
        failed++;
        offset++;
      }
    }

    if (DRY_RUN) offset += batchRes.rows.length;
  }

  console.log(`\n=== Done === Migrated: ${migrated}, Skipped: ${skipped}, Failed: ${failed}`);

  const after = await pool.query(
    `SELECT COUNT(*), pg_size_pretty(COALESCE(SUM(octet_length(file_data)), 0)) as size FROM file_uploads WHERE file_data IS NOT NULL`
  );
  console.log(`Remaining binary rows: ${after.rows[0].count} (${after.rows[0].size || '0 bytes'})`);

  await pool.end();
}

main().catch(err => { console.error('Migration error:', err); process.exit(1); });
