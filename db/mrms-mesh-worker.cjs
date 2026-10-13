/**
 * Decode NOAA's large MRMS grid away from the HTTP server's event loop.
 * The shared parser remains the single source of truth for scan direction,
 * packing, and cell values.
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const { parentPort, workerData, threadId } = require('worker_threads');
const { parseGrib2 } = require('./mrms-mesh.cjs');

try {
  if (workerData.cachedPath && fs.statSync(workerData.cachedPath).size > 64 * 1024 * 1024) {
    throw new Error('MRMS cached grid exceeds size limit');
  }
  const raw = workerData.compressed
    ? zlib.gunzipSync(Buffer.from(workerData.compressed), { maxOutputLength: 64 * 1024 * 1024 })
    : fs.readFileSync(workerData.cachedPath);
  const grid = parseGrib2(raw);
  if (workerData.compressed) {
    // Never replace a valid fallback with a partially written or invalid feed.
    const pendingPath = `${workerData.cachePath}.${process.pid}.${threadId}.tmp`;
    try {
      fs.writeFileSync(pendingPath, raw);
      fs.renameSync(pendingPath, workerData.cachePath);
    } catch (_) {
      try { fs.unlinkSync(pendingPath); } catch (_) { /* best-effort cache */ }
    }
  }
  parentPort.postMessage({ grid }, [grid.data.buffer]);
} catch (error) {
  parentPort.postMessage({ error: error.message });
}