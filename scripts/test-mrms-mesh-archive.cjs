'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mesh = require('../db/mrms-mesh.cjs');

function syntheticGrid() {
  const data = new Uint16Array(25);
  data[2 * 5 + 2] = 51; // 51 mm = 2.01 inches at the center
  data[1 * 5 + 1] = 25;
  return {
    data, ni: 5, nj: 5,
    lat0: 40, lon0: -82, di: 0.01, dj: 0.01,
    R: 0, E: 0, D: 0,
    validTime: '2026-08-23T12:00:00.000Z',
  };
}

async function main() {
  const grid = syntheticGrid();
  const snapshot = mesh.createSnapshotFromGrid(grid, {
    minLat: 39.96, maxLat: 40, minLng: -82, maxLng: -81.96,
  });
  assert(snapshot, 'snapshot should be created');
  assert.strictEqual(snapshot.grid.ni, 5);
  assert.strictEqual(snapshot.grid.nj, 5);
  assert.strictEqual(snapshot.maxInches, 2.01);

  // Exercise exactly what PostgreSQL JSONB persistence does to the payload.
  const restored = JSON.parse(JSON.stringify({ ...snapshot, capturedAt: '2026-08-23T12:05:00.000Z' }));
  const sampled = mesh.sampleSnapshotMax(restored, 39.98, -81.98, 0.1);
  assert(Math.abs(sampled - (51 / 25.4)) < 0.001, 'archived sample should retain the raw hail value');

  const overlay = mesh.buildOverlayFromSnapshot(restored, restored.bbox, 100);
  assert.strictEqual(overlay.available, true);
  assert.strictEqual(overlay.archived, true);
  assert(overlay.imageDataUrl.startsWith('data:image/png;base64,'));
  assert.strictEqual(overlay.validTime, grid.validTime);

  // Verify persistence uses the required UUID id and stores the raw sub-grid.
  const originalGetMeshGrid = mesh.getMeshGrid;
  mesh.getMeshGrid = async () => grid;
  delete require.cache[require.resolve('../db/storm-mesh-snapshots.cjs')];
  const snapshots = require('../db/storm-mesh-snapshots.cjs');
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("SELECT 1 FROM generic_entities")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('SELECT id, data FROM generic_entities storm')) return { rows: [] };
      return { rowCount: 1, rows: [] };
    },
    async connect() { return client; },
  };
  const result = await snapshots.persistStormMeshSnapshots(pool, [{
    id: 'storm-test-1',
    event_id: 'event-test-1',
    event_type: 'hail',
    start_time: new Date().toISOString(),
    latitude: 39.98,
    longitude: -81.98,
    radius_miles: 3,
  }]);
  mesh.getMeshGrid = originalGetMeshGrid;
  assert.strictEqual(result.saved, 1);
  const insert = queries.find(q => q.sql.includes("VALUES ($1, 'StormMeshSnapshot'"));
  assert(insert, 'snapshot row should be inserted');
  assert(queries.some(q => q.sql.includes('pg_advisory_xact_lock')), 'concurrent captures must take a per-storm database lock');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(insert.values[0]), 'snapshot id must be crypto.randomUUID()');
  const stored = JSON.parse(insert.values[1]);
  assert.strictEqual(stored.storm_id, 'storm-test-1');
  assert(stored.grid.rawBase64);

  // NWS watches can begin in the future. Never attach today's rolling radar
  // to one before it starts; the periodic sweep will capture it later.
  const futureStorm = {
    id: 'storm-future-1',
    event_type: 'thunderstorm',
    start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    latitude: 39.98,
    longitude: -81.98,
  };
  assert.strictEqual(mesh.isWithinMeshWindow(futureStorm.start_time), false, 'future storms are outside the live MESH capture window');
  assert.strictEqual(mesh.isFutureStormTime(futureStorm.start_time), true, 'future storms are explicitly recognized');
  const queriesBeforeFuture = queries.length;
  const futureResult = await snapshots.persistStormMeshSnapshots(pool, [futureStorm]);
  assert.strictEqual(futureResult.saved, 0, 'future storms must not create archived snapshots');
  assert.strictEqual(queries.slice(queriesBeforeFuture).some(q => q.sql.includes("VALUES ($1, 'StormMeshSnapshot'")), false, 'future storms must not insert archived radar evidence');

  const root = path.join(__dirname, '..');
  for (const ingestionPath of ['db/storm-functions.cjs', 'vite-functions-plugin.js']) {
    const source = fs.readFileSync(path.join(root, ingestionPath), 'utf8');
    const activeInsert = source.indexOf('Inserted ${newAlerts} new active alerts');
    const activeCapture = source.indexOf('persistStormMeshSnapshots(pool, batch)', activeInsert);
    assert(activeInsert >= 0 && activeCapture > activeInsert, `${ingestionPath} must snapshot direct NWS active ingestion`);
    const historicalInsert = source.indexOf('Imported ${totalImported} historical NWS alerts');
    const historicalCapture = source.indexOf('persistStormMeshSnapshots(pool, allBatches)', historicalInsert);
    assert(historicalInsert >= 0 && historicalCapture > historicalInsert, `${ingestionPath} must snapshot direct NWS historical ingestion`);
  }
  const handlerSource = fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8');
  for (const handlerName of ['async getMeshSwathOverlay', 'async sampleMeshPoints']) {
    const handlerStart = handlerSource.indexOf(handlerName);
    const futureGuard = handlerSource.indexOf('isFutureStormTime(stormTime)', handlerStart);
    const archivedLookup = handlerSource.indexOf('getStormMeshSnapshot(getPool(), stormId)', handlerStart);
    assert(handlerStart >= 0 && futureGuard > handlerStart && futureGuard < archivedLookup, `${handlerName} must reject future storms before archived snapshot lookup`);
  }

  console.log('MRMS archived snapshot tests passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});