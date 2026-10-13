#!/usr/bin/env node
/**
 * Nationwide Storm Alert Smoke Test
 * ──────────────────────────────────────────────────────────────────────────
 * Verifies the nationwide hail/wind digest path in checkAndSendStormAlerts:
 *
 *  A) NATIONWIDE DIGEST FIRES
 *     With nationwide_hail_wind_alerts:true in StormAlertSettings and a
 *     synthetic hail StormEvent from CA (outside the OH service area), the
 *     function sends a 🌎 Nationwide email and persists notified_nationwide_ids.
 *
 *  B) DEDUP PREVENTS RESEND
 *     A second call with the same data does NOT resend the nationwide digest
 *     to the same recipient.
 *
 *  C) SERVICE-AREA PASS DOES NOT MATCH THE CA STORM
 *     The CA storm is >2000 mi from the Cleveland, OH office so the normal
 *     proximity check must reject it (only nationwide pass picks it up).
 *
 * Prerequisites:
 *   - DATABASE_URL set (dev server does NOT need to be running)
 *
 * Usage:  node scripts/test-nationwide-storm-alerts.cjs
 *
 * Note: the function calls real IEM/NWS APIs (non-fatal); the test will take
 * 30-120 s while those fetches run. All fixture rows are deleted in finally{}.
 */
'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const { checkAndSendStormAlerts } = require('../db/storm-functions.cjs');

const pool = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers ─────────────────────────────────────────────
// "smoke_natl_" prefix so cleanup is safe to run at any time
const COMPANY_ID      = 'smoke_natl_company_001';
const SETTINGS_ID     = 'smoke_natl_settings_001';
const STORM_ID        = 'smoke_natl_storm_ca001';
const STORM_EVENT_ID  = 'TEST_NATIONWIDE_HAIL_CA_SMOKE_001';
const RECIPIENT_EMAIL = 'nationwide-alert-smoke@example.com';

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
      `DELETE FROM generic_entities WHERE id IN ($1,$2,$3)
         OR (entity_type = 'Notification' AND company_id = $4)`,
      [SETTINGS_ID, STORM_ID, STORM_ID + '_extra', COMPANY_ID]
    );
  } catch (e) {
    console.warn('[cleanup] warning:', e.message);
  }
}

async function run() {
  console.log('\n🌎  Nationwide Storm Alert Smoke Test\n');

  try {
    // ── Setup ─────────────────────────────────────────────────────────────
    await cleanup();

    // StormAlertSettings: nationwide enabled, one explicit recipient, OH office
    // with stored lat/lng to avoid live Nominatim geocoding in the test
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'StormAlertSettings', $2, $3, NOW(), NOW())`,
      [SETTINGS_ID, COMPANY_ID, JSON.stringify({
        company_id: COMPANY_ID,
        nationwide_hail_wind_alerts: true,
        enable_email_alerts: true,
        enable_sms_alerts: false,
        // Explicit recipient so we never hit the admin-fallback DB query
        alert_recipients: [{
          name: 'Smoke Test Admin',
          email: RECIPIENT_EMAIL,
          notify_email: true,
        }],
        // OH office with stored coords — lat/lng used directly, no geocoding needed
        office_locations: [{
          name: 'Test Office',
          location: 'Cleveland, OH',
          lat: 41.4993,
          lng: -81.6944,
          radius_miles: 50,
          service_areas: [],
        }],
        storm_types_to_monitor: ['hail', 'tornado', 'high_wind', 'thunderstorm'],
        min_severity: 'moderate',
        notified_storm_ids: [],
        notified_nationwide_ids: [],
      })]
    );

    // Synthetic hail storm in Los Angeles, CA — ~2100 mi from Cleveland, OH.
    // status:'active' ensures the step-4 SQL filter picks it up unconditionally.
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'StormEvent', 'companysync_master_001', $2, NOW(), NOW())`,
      [STORM_ID, JSON.stringify({
        event_id:        STORM_EVENT_ID,
        event_type:      'hail',
        severity:        'severe',
        title:           'HAIL - Los Angeles, CA',
        affected_areas:  ['Los Angeles, CA'],
        start_time:      new Date().toISOString(),
        latitude:        34.0522,
        longitude:       -118.2437,
        hail_size_inches: 1.5,
        radius_miles:    10,
        source:          'IEM V2',
        status:          'active',
        nws_state:       'CA',
      })]
    );

    console.log('Setup done — StormAlertSettings (nationwide=true, OH office) + CA hail storm inserted\n');

    // ── Test A: Nationwide digest fires ───────────────────────────────────
    console.log('─── Test A: Nationwide digest fires ───');
    const emailCallsA = [];
    const mockEmailA = async ({ to, subject }) => emailCallsA.push({ to, subject });

    console.log('  Calling checkAndSendStormAlerts (real IEM/NWS fetches will run — may take ~60s)…');
    const result1 = await checkAndSendStormAlerts(pool, { sendEmailFn: mockEmailA });

    ok('checkAndSendStormAlerts returned success=true',
       result1.success === true, JSON.stringify(result1));

    const nationwideCallsA = emailCallsA.filter(c => c.subject && c.subject.includes('🌎'));
    ok('At least one 🌎 Nationwide email was sent',
       nationwideCallsA.length > 0,
       `${emailCallsA.length} total email call(s), ${nationwideCallsA.length} with 🌎 subject`);

    ok('🌎 Nationwide email reached the test recipient',
       nationwideCallsA.some(c => c.to === RECIPIENT_EMAIL),
       `Recipients in nationwide calls: ${nationwideCallsA.map(c => c.to).join(', ') || '(none)'}`);

    // Confirm notified_nationwide_ids was persisted back to DB
    const settingsRow1 = await pool.query(
      `SELECT data FROM generic_entities WHERE id = $1`, [SETTINGS_ID]
    );
    const saved1 = settingsRow1.rows[0]?.data || {};
    const savedIds1 = saved1.notified_nationwide_ids || [];
    ok('notified_nationwide_ids persisted in DB after first call',
       savedIds1.includes(STORM_EVENT_ID),
       `Saved IDs (first 5): ${JSON.stringify(savedIds1.slice(0, 5))}`);

    // Also verify the CA storm was NOT matched by the service-area pass
    // (service-area emailsSent for our company would show a non-🌎 subject)
    const serviceAreaCallsA = emailCallsA.filter(
      c => c.to === RECIPIENT_EMAIL && !(c.subject && c.subject.includes('🌎'))
    );
    ok('CA storm was NOT sent via the service-area pass to our OH company',
       serviceAreaCallsA.length === 0,
       `Non-nationwide calls to ${RECIPIENT_EMAIL}: ${serviceAreaCallsA.length}`);

    // ── Test B: Dedup prevents resend ─────────────────────────────────────
    console.log('\n─── Test B: Dedup prevents resend ───');
    const emailCallsB = [];
    const mockEmailB = async ({ to, subject }) => emailCallsB.push({ to, subject });

    console.log('  Calling checkAndSendStormAlerts again (same data, dedup should fire)…');
    const result2 = await checkAndSendStormAlerts(pool, { sendEmailFn: mockEmailB });

    ok('Second checkAndSendStormAlerts call also returned success=true',
       result2.success === true);

    const nationwideCallsB = emailCallsB.filter(
      c => c.subject && c.subject.includes('🌎') && c.to === RECIPIENT_EMAIL
    );
    ok('Dedup: nationwide digest NOT resent to test recipient',
       nationwideCallsB.length === 0,
       `Nationwide calls to ${RECIPIENT_EMAIL} on second run: ${nationwideCallsB.length} (expected 0)`);

    // notified_nationwide_ids should still contain our storm ID
    const settingsRow2 = await pool.query(
      `SELECT data FROM generic_entities WHERE id = $1`, [SETTINGS_ID]
    );
    const saved2 = settingsRow2.rows[0]?.data || {};
    const savedIds2 = saved2.notified_nationwide_ids || [];
    ok('notified_nationwide_ids still contains storm ID after second call',
       savedIds2.includes(STORM_EVENT_ID),
       `Saved IDs (first 5): ${JSON.stringify(savedIds2.slice(0, 5))}`);

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
