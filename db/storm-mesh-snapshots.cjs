'use strict';

// Shared by interactive ingestion and the recurring storm alert cron.  MESH has
// no public archive, so capture a small raw grid while its rolling 24h swath is
// still available.  Keep this independent from request handlers so snapshots
// are never skipped just because nobody has the Storm Tracker open.
const crypto = require('crypto');
const mesh = require('./mrms-mesh.cjs');
const HAIL_RELEVANT_TYPES = new Set(['hail', 'thunderstorm', 'tornado']);

function stormBBox(storm) {
  const lat = Number(storm.latitude ?? storm.lat);
  const lng = Number(storm.longitude ?? storm.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const miles = Math.max(3, Math.min(Number(storm.radius_miles) || 10, 20));
  const latPad = miles / 69;
  const lngPad = miles / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return { minLat: lat - latPad, maxLat: lat + latPad, minLng: lng - lngPad, maxLng: lng + lngPad };
}

async function persistStormMeshSnapshots(pool, storms) {
  // Also sweep recent unsnapshotted rows. This makes every periodic ingestion
  // tick a retry when NOAA or the database was briefly unavailable, and catches
  // active NWS rows inserted later in the same ingestion cycle.
  let recent = [];
  try {
    const result = await pool.query(
      `SELECT id, data FROM generic_entities storm
       WHERE storm.entity_type = 'StormEvent'
         AND storm.created_date >= NOW() - INTERVAL '2 days'
         AND NOT EXISTS (
           SELECT 1 FROM generic_entities snap
           WHERE snap.entity_type = 'StormMeshSnapshot'
             AND snap.data->>'storm_id' = storm.id
         )
       LIMIT 5000`
    );
    recent = result.rows.map(row => ({ ...(row.data || {}), id: row.id }));
  } catch (error) {
    console.warn('[StormMeshSnapshot] recent-storm sweep skipped:', error.message);
  }
  const byId = new Map([...(storms || []), ...recent].filter(s => s?.id).map(s => [String(s.id), s]));
  const fresh = [...byId.values()].filter(s =>
    HAIL_RELEVANT_TYPES.has(s.event_type) &&
    mesh.isWithinMeshWindow(s.start_time) &&
    stormBBox(s)
  );
  if (!fresh.length) return { attempted: 0, saved: 0 };
  const grid = await mesh.getMeshGrid();
  if (!grid) return { attempted: fresh.length, saved: 0, unavailable: true };
  let saved = 0;
  const client = await pool.connect();
  try {
    for (const storm of fresh) {
      try {
        await client.query('BEGIN');
        // Serializes manual refresh and cron capture for this storm without a
        // startup-time expression index over the large generic entity table.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(storm.id)]);
        const exists = await client.query(
        `SELECT 1 FROM generic_entities WHERE entity_type = 'StormMeshSnapshot'
           AND data->>'storm_id' = $1 LIMIT 1`,
        [String(storm.id)]
        );
        if (exists.rowCount) {
          await client.query('COMMIT');
          continue;
        }
        const bbox = stormBBox(storm);
        const snapshot = mesh.createSnapshotFromGrid(grid, bbox);
        if (!snapshot) {
          await client.query('ROLLBACK');
          continue;
        }
        const centerMeshInches = mesh.sampleGridMax(grid, Number(storm.latitude ?? storm.lat), Number(storm.longitude ?? storm.lng), 1);
        const inserted = await client.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'StormMeshSnapshot', 'companysync_master_001', $2::jsonb, NOW(), NOW())`,
        [crypto.randomUUID(), JSON.stringify({
          storm_id: String(storm.id),
          event_id: storm.event_id || null,
          capturedAt: new Date().toISOString(),
          centerMeshInches: centerMeshInches == null ? null : Math.round(centerMeshInches * 100) / 100,
          ...snapshot,
        })]
        );
        await client.query('COMMIT');
        if (inserted.rowCount) saved++;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.warn('[StormMeshSnapshot] capture skipped:', error.message);
      }
    }
  } finally {
    client.release();
  }
  return { attempted: fresh.length, saved };
}

async function getStormMeshSnapshot(pool, stormId) {
  if (!stormId) return null;
  const result = await pool.query(
    `SELECT data FROM generic_entities WHERE entity_type = 'StormMeshSnapshot'
       AND data->>'storm_id' = $1 ORDER BY created_date DESC LIMIT 1`,
    [String(stormId)]
  );
  return result.rows[0]?.data || null;
}

module.exports = { persistStormMeshSnapshots, getStormMeshSnapshot };