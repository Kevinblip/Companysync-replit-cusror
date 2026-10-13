#!/usr/bin/env node
/**
 * Re-derive StormEvent coordinates that were stamped from a bare county-name table.
 * ──────────────────────────────────────────────────────────────────────────
 * Before county lookups were keyed by (state, name), an out-of-state NWS alert whose
 * first listed county collided with an Ohio county name got that Ohio county's
 * coordinates. Because the alert cron's distance gate trusts the stored lat/lng, those
 * rows report a short drive when the storm is hundreds of miles away.
 *
 * This script finds StormEvent rows whose stored coordinate provably sits outside every
 * state their own NWS zone claims, and re-derives the coordinate from the (state, county)
 * table, falling back to the zone state's centroid. Rows we cannot re-derive have their
 * coordinates cleared, so the cron's state-guarded text matcher handles them instead of
 * trusting a wrong number.
 *
 * Usage:
 *   node scripts/fix-storm-collided-coords.cjs            # dry run (default)
 *   node scripts/fix-storm-collided-coords.cjs --apply    # write the corrections
 */
'use strict';

const { Pool } = require('pg');
const geo = require('../db/storm-geo.cjs');

const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function reDerive(d) {
  const zoneStates = geo.zoneStatesForStormEvent(d);
  const areas = Array.isArray(d.affected_areas) ? d.affected_areas : [d.affected_areas].filter(Boolean);

  for (const state of zoneStates) {
    for (const area of areas) {
      for (const part of String(area).split(';')) {
        const hit = geo.lookupCountyCentroid(state, part);
        if (hit) return { lat: hit.lat, lng: hit.lng, source: 'county_centroid', state };
      }
    }
  }
  const stateHit = geo.lookupStateCentroid(zoneStates[0]);
  if (stateHit) return { lat: stateHit.lat, lng: stateHit.lng, source: 'state_centroid', state: zoneStates[0] };
  return { lat: null, lng: null, source: 'cleared', state: zoneStates[0] || null };
}

(async () => {
  console.log(`\n🌪  Storm coordinate collision repair (${APPLY ? 'APPLY' : 'DRY RUN'})\n`);

  const res = await pool.query(
    `SELECT id, data FROM generic_entities
     WHERE entity_type = 'StormEvent'
       AND data->>'latitude' IS NOT NULL AND data->>'latitude' <> ''
       AND data->>'longitude' IS NOT NULL AND data->>'longitude' <> ''`
  );
  console.log(`Scanned ${res.rows.length} StormEvent row(s) with coordinates.`);

  const bySource = {};
  let collided = 0;

  for (const row of res.rows) {
    const d = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
    // Only NAME-derived coordinates are repaired. A real alert polygon can straddle a
    // state line, so its centroid may fall just outside the first UGC code's state —
    // that coordinate is measured and must be left alone.
    if (!geo.stormCoordsAreCollided(d)) continue;
    const zoneStates = geo.zoneStatesForStormEvent(d);

    collided++;
    const fixed = reDerive(d);
    bySource[fixed.source] = (bySource[fixed.source] || 0) + 1;

    console.log(
      `  ${collided.toString().padStart(4)}. ${(d.event_id || row.id).slice(0, 48)}` +
      ` [${zoneStates.join('/')}] ${d.latitude},${d.longitude} → ${fixed.lat},${fixed.lng} (${fixed.source})`
    );

    if (!APPLY) continue;

    const next = {
      ...d,
      latitude: fixed.lat,
      longitude: fixed.lng,
      // A re-derived centroid is not polygon geometry — flag it so the radius query and
      // the UI treat it as approximate rather than a measured storm footprint.
      has_geometry: false,
      coordinate_source: fixed.source,
      coordinate_repaired_at: new Date().toISOString(),
      coordinate_repaired_from: { latitude: d.latitude, longitude: d.longitude },
      nws_states: zoneStates,
    };
    await pool.query(
      `UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE id = $2`,
      [JSON.stringify(next), row.id]
    );
  }

  console.log(`\n${collided} row(s) carried coordinates outside their own NWS zone state.`);
  for (const [source, n] of Object.entries(bySource)) console.log(`  → ${n} re-derived via ${source}`);
  if (!APPLY && collided > 0) console.log('\nRe-run with --apply to write these corrections.');
  console.log('');

  await pool.end();
})().catch(async (err) => {
  console.error('❌ Repair failed:', err.message);
  try { await pool.end(); } catch (_) { /* ignore */ }
  process.exit(1);
});
