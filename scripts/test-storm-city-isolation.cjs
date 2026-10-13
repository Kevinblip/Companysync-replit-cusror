#!/usr/bin/env node
/**
 * Storm City Isolation Test
 * ──────────────────────────────────────────────────────────────────────────
 * Regression guard for the cross-state city-name false-positive bug:
 *   "Cleveland, NC" (400 mi away) was alerting a company in Cleveland, OH
 *   because the text fallback matched "Cleveland" without checking the state.
 *
 * Tests:
 *   A) Storm in Cleveland, NC WITH coordinates (~400 mi)  → no alert (coord check rejects)
 *   B) Storm in Cleveland, NC WITHOUT coordinates         → no alert (state guard rejects)
 *   C) 8-hour-old IEM storm near Cleveland, OH WITH coords → alert fires after downtime
 *   D) Storm in "Cleveland, OH" area WITHOUT coordinates  → alert fires (text fallback + state match)
 *   E) 25-hour-old IEM backfill near Cleveland, OH         → no alert (anti-spam window)
 *
 * Strategy to avoid live-storm noise:
 *   Before each call we pre-populate notified_storm_ids with all existing
 *   StormEvent IDs in the DB, so only our freshly-inserted synthetic storms
 *   can trigger alerts — real ingested storms are silently deduplicated.
 *
 * Prerequisites:
 *   - DATABASE_URL set (dev server does NOT need to be running)
 *
 * Usage:  node scripts/test-storm-city-isolation.cjs
 */
'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const { checkAndSendStormAlerts } = require('../db/storm-functions.cjs');

const pool = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers ─────────────────────────────────────────────
const COMPANY_ID     = 'smoke_sci_company_001';
const SETTINGS_ID    = 'smoke_sci_settings_001';
const RECIPIENT      = 'storm-city-isolation-smoke@example.com';

// Storm IDs — one per test scenario
const STORM_NC_COORDS   = 'smoke_sci_storm_nc_coords_001';
const STORM_NC_NOCOORDS = 'smoke_sci_storm_nc_nocoords_001';
const STORM_OH_NEAR     = 'smoke_sci_storm_oh_near_001';
const STORM_OH_TEXTONLY = 'smoke_sci_storm_oh_textonly_001';
const STORM_OH_BACKFILL = 'smoke_sci_storm_oh_backfill_001';

const STORM_EVT_NC_COORDS   = 'TEST_SCI_NC_COORDS_001';
const STORM_EVT_NC_NOCOORDS = 'TEST_SCI_NC_NOCOORDS_001';
const STORM_EVT_OH_NEAR     = 'TEST_SCI_OH_NEAR_001';
const STORM_EVT_OH_TEXTONLY = 'TEST_SCI_OH_TEXTONLY_001';
const STORM_EVT_OH_BACKFILL = 'TEST_SCI_OH_BACKFILL_001';

let passed = 0, failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } else {
    const msg = detail ? `${name} — ${detail}` : name;
    console.error(`  ❌ FAIL  ${msg}`);
    failures.push(msg);
    failed++;
  }
}

async function cleanup() {
  try {
    await pool.query(
      `DELETE FROM generic_entities WHERE id = ANY($1::text[])
         OR (entity_type = 'Notification' AND company_id = $2)`,
      [
        [
          SETTINGS_ID,
          STORM_NC_COORDS,
          STORM_NC_NOCOORDS,
          STORM_OH_NEAR,
          STORM_OH_TEXTONLY,
          STORM_OH_BACKFILL,
        ],
        COMPANY_ID,
      ]
    );
  } catch (e) {
    console.warn('[cleanup] warning:', e.message);
  }
}

/** Insert StormAlertSettings with a pre-populated notified_storm_ids list
 *  that covers all currently existing StormEvent rows in the DB.
 *  This ensures only our freshly-inserted synthetic storms can fire alerts. */
async function upsertSettings(extraNotifiedIds = []) {
  // Collect all existing event IDs so the dedup skips them
  const { rows } = await pool.query(
    `SELECT data->>'event_id' as eid FROM generic_entities WHERE entity_type = 'StormEvent'`
  );
  const existingIds = rows.map(r => r.eid).filter(Boolean);
  const notifiedIds = [...new Set([...existingIds, ...extraNotifiedIds])];

  await pool.query(`DELETE FROM generic_entities WHERE id = $1`, [SETTINGS_ID]);
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'StormAlertSettings', $2, $3, NOW(), NOW())`,
    [SETTINGS_ID, COMPANY_ID, JSON.stringify({
      company_id: COMPANY_ID,
      enable_email_alerts: true,
      enable_sms_alerts: false,
      nationwide_hail_wind_alerts: false,   // keep test local — no nationwide digest path
      alert_recipients: [{ name: 'Smoke Test', email: RECIPIENT, notify_email: true }],
      // Cleveland, OH office with stored coords (no live Nominatim geocoding needed)
      office_locations: [{
        name: 'Cleveland HQ',
        location: 'Cleveland, OH',
        lat: 41.4993,
        lng: -81.6944,
        radius_miles: 50,
        service_areas: [],
      }],
      storm_types_to_monitor: ['hail', 'tornado', 'high_wind', 'thunderstorm'],
      min_severity: 'moderate',
      notified_storm_ids: notifiedIds,
      notified_nationwide_ids: [],
    })]
  );
}

async function insertStorm(rowId, eventId, {
  lat,
  lng,
  areas,
  occurredHoursAgo = 0,
  createdHoursAgo = 0,
  status = 'active',
  source,
}) {
  const startTime = new Date(Date.now() - occurredHoursAgo * 60 * 60 * 1000).toISOString();
  const createdDate = new Date(Date.now() - createdHoursAgo * 60 * 60 * 1000).toISOString();
  await pool.query(`DELETE FROM generic_entities WHERE id = $1`, [rowId]);
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'StormEvent', 'companysync_master_001', $2, $3, NOW())`,
    [rowId, JSON.stringify({
      event_id:       eventId,
      event_type:     'high_wind',
      severity:       'severe',
      title:          `High Wind — ${areas[0]}`,
      affected_areas: areas,
      start_time:     startTime,
      status,
      ...(source ? { source } : {}),
      // Coordinates are optional; omit them to exercise the text fallback
      ...(lat != null ? { latitude: lat, longitude: lng } : {}),
    }), createdDate]
  );
}

async function run() {
  console.log('\n🌩️  Storm City Isolation Test\n');
  console.log('  Office: Cleveland, OH  (41.4993, -81.6944)  radius=50 mi');
  console.log('  Bug:    "Cleveland, NC" was incorrectly matching the OH office\n');

  try {
    await cleanup();

    // ── Test A: storm in Cleveland, NC WITH coordinates ────────────────────
    console.log('─── Test A: Cleveland, NC storm (with coords, ~400 mi away) ───');
    await upsertSettings();
    await insertStorm(STORM_NC_COORDS, STORM_EVT_NC_COORDS, {
      lat: 35.7479, lng: -81.5638,   // Cleveland, NC — ~400 mi from Cleveland, OH
      areas: ['Cleveland, NC'],
    });

    const emailsA = [];
    await checkAndSendStormAlerts(pool, { sendEmailFn: async ({ to, subject }) => emailsA.push({ to, subject }) });

    const toOhA = emailsA.filter(e => e.to === RECIPIENT);
    ok('Cleveland NC storm (with coords) did NOT alert the Cleveland OH company',
      toOhA.length === 0,
      `Emails to ${RECIPIENT}: ${toOhA.length} (expected 0)`);

    // ── Test B: storm in Cleveland, NC WITHOUT coordinates (text fallback) ──
    console.log('\n─── Test B: Cleveland, NC storm (no coords — text fallback path) ───');
    await upsertSettings([STORM_EVT_NC_COORDS]);   // dedup A's storm too
    await insertStorm(STORM_NC_NOCOORDS, STORM_EVT_NC_NOCOORDS, {
      lat: null, lng: null,           // no GPS — forces text fallback
      areas: ['2 N Cleveland, NC'],   // the exact NWS-style format from the original bug
    });

    const emailsB = [];
    await checkAndSendStormAlerts(pool, { sendEmailFn: async ({ to, subject }) => emailsB.push({ to, subject }) });

    const toOhB = emailsB.filter(e => e.to === RECIPIENT);
    ok('Cleveland NC storm (no coords, text fallback) did NOT alert the Cleveland OH company',
      toOhB.length === 0,
      `Emails to ${RECIPIENT}: ${toOhB.length} (expected 0)`);

    // ── Test C: storm missed during downtime still catches up ────────────────
    console.log('\n─── Test C: 8-hour-old IEM storm near Cleveland, OH (downtime catch-up) ───');
    await upsertSettings([STORM_EVT_NC_COORDS, STORM_EVT_NC_NOCOORDS]);
    await insertStorm(STORM_OH_NEAR, STORM_EVT_OH_NEAR, {
      lat: 41.5100, lng: -81.6800,   // ~2 mi from Cleveland, OH office
      areas: ['Cleveland, OH'],
      occurredHoursAgo: 8,
      createdHoursAgo: 8,
      status: 'ended',
      source: 'IEM V2',
    });

    const emailsC = [];
    await checkAndSendStormAlerts(pool, { sendEmailFn: async ({ to, subject }) => emailsC.push({ to, subject }) });

    const toOhC = emailsC.filter(e => e.to === RECIPIENT);
    ok('8-hour-old ended IEM storm DID alert the Cleveland OH company after downtime',
      toOhC.length >= 1,
      `Emails to ${RECIPIENT}: ${toOhC.length} (expected ≥1)`);

    // ── Test D: storm in "Cleveland, OH" area WITHOUT coordinates ───────────
    console.log('\n─── Test D: Cleveland, OH area storm (no coords — text fallback path) ───');
    await upsertSettings([STORM_EVT_NC_COORDS, STORM_EVT_NC_NOCOORDS, STORM_EVT_OH_NEAR]);
    await insertStorm(STORM_OH_TEXTONLY, STORM_EVT_OH_TEXTONLY, {
      lat: null, lng: null,          // no GPS — forces text fallback
      areas: ['Cleveland, OH'],
    });

    const emailsD = [];
    await checkAndSendStormAlerts(pool, { sendEmailFn: async ({ to, subject }) => emailsD.push({ to, subject }) });

    const toOhD = emailsD.filter(e => e.to === RECIPIENT);
    ok('Cleveland OH area storm (no coords, text fallback) DID alert the Cleveland OH company',
      toOhD.length >= 1,
      `Emails to ${RECIPIENT}: ${toOhD.length} (expected ≥1)`);

    // ── Test E: historical backfills do not trigger alerts ──────────────────
    console.log('\n─── Test E: 25-hour-old IEM backfill near Cleveland, OH (anti-spam) ───');
    await upsertSettings([
      STORM_EVT_NC_COORDS,
      STORM_EVT_NC_NOCOORDS,
      STORM_EVT_OH_NEAR,
      STORM_EVT_OH_TEXTONLY,
    ]);
    await insertStorm(STORM_OH_BACKFILL, STORM_EVT_OH_BACKFILL, {
      lat: 41.5100,
      lng: -81.6800,
      areas: ['Cleveland, OH'],
      occurredHoursAgo: 25,
      status: 'ended',
      source: 'IEM V2',
    });

    const emailsE = [];
    await checkAndSendStormAlerts(pool, { sendEmailFn: async ({ to, subject }) => emailsE.push({ to, subject }) });

    const toOhE = emailsE.filter(e => e.to === RECIPIENT);
    ok('25-hour-old IEM backfill did NOT alert the Cleveland OH company',
      toOhE.length === 0,
      `Emails to ${RECIPIENT}: ${toOhE.length} (expected 0)`);

  } finally {
    await cleanup();
    await pool.end();
  }

  console.log('\n─────────────────────────────────────────');
  if (failed === 0) {
    console.log(`✅  All ${passed} tests passed`);
    process.exit(0);
  } else {
    console.error(`❌  ${failed} test(s) failed, ${passed} passed`);
    failures.forEach(f => console.error(`   • ${f}`));
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error:', err.message, err.stack);
  pool.end().catch(() => {});
  process.exit(1);
});
