#!/usr/bin/env node
/**
 * Storm Alert Minimum-Severity Test
 * ──────────────────────────────────────────────────────────────────────────
 * Regression guard for the "min_severity is ignored" report: a company whose
 * Storm Alert Settings ask for `severe` and above must never receive minor or
 * moderate events — in EITHER delivery path.
 *
 * Tests:
 *   A) SERVICE-AREA PASS honours min_severity='severe'
 *      Three storms sit inside the service radius (minor / moderate / severe).
 *      Only the severe one may appear in the batched alert email.
 *   B) NATIONWIDE DIGEST honours min_severity='severe'
 *      Two far-away hail storms (minor / severe) are seen only by the
 *      nationwide pass. Only the severe one may appear in the 🌎 digest.
 *
 * Strategy to avoid live-storm noise:
 *   Before each call we pre-populate notified_storm_ids / notified_nationwide_ids
 *   with every StormEvent ID already in the DB, so only our freshly-inserted
 *   synthetic storms can trigger alerts. Assertions key on unique fake city
 *   names so a real storm ingested mid-run can never satisfy or break them.
 *
 * Prerequisites:
 *   - DATABASE_URL set (dev server does NOT need to be running)
 *
 * Usage:  node scripts/test-storm-min-severity.cjs
 *
 * Note: the function calls real IEM/NWS APIs (non-fatal); test B enables
 * nationwide alerts, which expands ingestion to all 50 states — expect the run
 * to take a few minutes. All fixture rows are deleted in finally{}.
 */
'use strict';

const { Pool } = require('pg');
const { checkAndSendStormAlerts } = require('../db/storm-functions.cjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers ─────────────────────────────────────────────
const COMPANY_ID  = 'smoke_sev_company_001';
const SETTINGS_ID = 'smoke_sev_settings_001';
const RECIPIENT   = 'storm-min-severity-smoke@example.com';

// Unique fake place names so assertions cannot collide with real storms
const AREA_MINOR    = 'Minorville, OH';
const AREA_MODERATE = 'Modtown, OH';
const AREA_SEVERE   = 'Sevville, OH';
const AREA_NATL_MINOR  = 'Natlminorburg, CA';
const AREA_NATL_SEVERE = 'Natlsevburg, CA';

const STORM_ROWS = {
  minor:        'smoke_sev_storm_minor_001',
  moderate:     'smoke_sev_storm_moderate_001',
  severe:       'smoke_sev_storm_severe_001',
  natlMinor:    'smoke_sev_storm_natl_minor_001',
  natlSevere:   'smoke_sev_storm_natl_severe_001',
};
const STORM_EVENTS = {
  minor:      'TEST_SEV_MINOR_001',
  moderate:   'TEST_SEV_MODERATE_001',
  severe:     'TEST_SEV_SEVERE_001',
  natlMinor:  'TEST_SEV_NATL_MINOR_001',
  natlSevere: 'TEST_SEV_NATL_SEVERE_001',
};

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
      [[SETTINGS_ID, ...Object.values(STORM_ROWS)], COMPANY_ID]
    );
  } catch (e) {
    console.warn('[cleanup] warning:', e.message);
  }
}

/** Insert StormAlertSettings with min_severity='severe' and a dedup list that
 *  already covers every storm currently eligible for an alert, so only our
 *  synthetic storms fire. Mirrors the candidate window used by the alert cron
 *  (active / recent NWS / last-24h IEM) instead of every StormEvent ever
 *  ingested — the table holds hundreds of thousands of historical rows. */
async function upsertSettings({ nationwide = false, extraNotifiedIds = [], nationwideFloors = null } = {}) {
  const { rows } = await pool.query(
    `SELECT data->>'event_id' AS eid FROM generic_entities
      WHERE entity_type = 'StormEvent'
        AND (
          data->>'status' = 'active'
          OR (data->>'alert_type' = 'NWS_ACTIVE' AND created_date >= NOW() - INTERVAL '12 hours')
          OR (
            data->>'source' IN ('IEM V2', 'IEM')
            AND data->>'start_time' ~ '^\\d{4}-'
            AND (data->>'start_time')::timestamp >= NOW() - INTERVAL '48 hours'
          )
        )
      ORDER BY created_date DESC
      LIMIT 8000`
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
      nationwide_hail_wind_alerts: nationwide,
      ...(nationwideFloors || {}),
      alert_recipients: [{ name: 'Smoke Test', email: RECIPIENT, notify_email: true }],
      office_locations: [{
        name: 'Cleveland HQ',
        location: 'Cleveland, OH',
        lat: 41.4993,
        lng: -81.6944,
        radius_miles: 50,
        service_areas: [],
      }],
      storm_types_to_monitor: ['hail', 'tornado', 'high_wind', 'thunderstorm'],
      // The setting under test
      min_severity: 'severe',
      notified_storm_ids: notifiedIds,
      notified_nationwide_ids: notifiedIds,
    })]
  );
}

async function insertStorm(rowId, eventId, { lat, lng, area, severity, eventType = 'high_wind', hailSizeInches }) {
  await pool.query(`DELETE FROM generic_entities WHERE id = $1`, [rowId]);
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'StormEvent', 'companysync_master_001', $2, NOW(), NOW())`,
    [rowId, JSON.stringify({
      event_id: eventId,
      event_type: eventType,
      severity,
      title: `${eventType} — ${area}`,
      affected_areas: [area],
      start_time: new Date().toISOString(),
      status: 'active',
      source: 'IEM V2',
      latitude: lat,
      longitude: lng,
      ...(hailSizeInches ? { hail_size_inches: hailSizeInches } : {}),
    })]
  );
}

async function run() {
  console.log('\n🌩️  Storm Alert Minimum-Severity Test\n');
  console.log('  Company min_severity = "severe" (Cleveland, OH office, 50 mi radius)');
  console.log('  Expectation: minor and moderate events never reach the subscriber\n');

  try {
    await cleanup();

    // ── Test A: service-area pass ──────────────────────────────────────────
    console.log('─── Test A: service-area alert respects min_severity=severe ───');
    await upsertSettings();
    // All three sit ~2 mi from the office, so proximity is never the reason one is dropped
    await insertStorm(STORM_ROWS.minor, STORM_EVENTS.minor,
      { lat: 41.5100, lng: -81.6800, area: AREA_MINOR, severity: 'minor' });
    await insertStorm(STORM_ROWS.moderate, STORM_EVENTS.moderate,
      { lat: 41.5100, lng: -81.6810, area: AREA_MODERATE, severity: 'moderate' });
    await insertStorm(STORM_ROWS.severe, STORM_EVENTS.severe,
      { lat: 41.5100, lng: -81.6820, area: AREA_SEVERE, severity: 'severe', eventType: 'hail', hailSizeInches: 1.75 });

    console.log('  Calling checkAndSendStormAlerts (real IEM/NWS fetches will run)…');
    const emailsA = [];
    const resultA = await checkAndSendStormAlerts(pool, {
      sendEmailFn: async ({ to, subject, html }) => emailsA.push({ to, subject, html }),
      // Never touch other tenants — their alerts can send REAL SMS through Twilio
      shouldSuppressCompany: async (cid) => cid !== COMPANY_ID,
    });
    ok('checkAndSendStormAlerts returned success=true', resultA.success === true, JSON.stringify(resultA));

    const toUsA = emailsA.filter(e => e.to === RECIPIENT);
    const htmlA = toUsA.map(e => e.html || '').join('\n');

    ok('Severe storm DID alert the company',
      htmlA.includes(AREA_SEVERE),
      `Emails to ${RECIPIENT}: ${toUsA.length}; severe area present: ${htmlA.includes(AREA_SEVERE)}`);

    ok('Minor storm was NOT included in the alert email',
      !htmlA.includes(AREA_MINOR),
      `"${AREA_MINOR}" must not appear in any alert email`);

    ok('Moderate storm was NOT included in the alert email',
      !htmlA.includes(AREA_MODERATE),
      `"${AREA_MODERATE}" must not appear in any alert email`);

    ok('No row in the email is labelled minor or moderate (real storms included)',
      !/>minor<\/td>/.test(htmlA) && !/>moderate<\/td>/.test(htmlA),
      'severity column contained a below-threshold value');

    // Dedup bookkeeping: below-threshold storms must never be recorded as notified
    const settingsAfterA = await pool.query(`SELECT data FROM generic_entities WHERE id = $1`, [SETTINGS_ID]);
    const savedA = settingsAfterA.rows[0]?.data || {};
    const notifiedA = savedA.notified_storm_ids || [];
    ok('Severe storm recorded in notified_storm_ids', notifiedA.includes(STORM_EVENTS.severe));
    ok('Below-threshold storms not recorded as notified',
      !notifiedA.includes(STORM_EVENTS.minor) && !notifiedA.includes(STORM_EVENTS.moderate),
      'a filtered storm was marked notified by the service-area pass');

    // ── Test B: nationwide digest ──────────────────────────────────────────
    console.log('\n─── Test B: nationwide digest respects min_severity=severe ───');
    // Impossible hail/wind floors keep the real storms ingested during this run out
    // of the digest, so the only two candidates left are the synthetic pair below and
    // severity is the sole discriminator. (Without this, hundreds of freshly ingested
    // real events crowd the digest's 12-card cap and the assertion becomes flaky.)
    await upsertSettings({
      nationwide: true,
      nationwideFloors: { nationwide_min_hail_inches: 9, nationwide_min_wind_mph: 200 },
      extraNotifiedIds: [STORM_EVENTS.minor, STORM_EVENTS.moderate, STORM_EVENTS.severe],
    });
    // Far from the Cleveland office — only the nationwide pass can pick these up.
    // Both clear the 9" hail floor, so only min_severity can separate them.
    await insertStorm(STORM_ROWS.natlMinor, STORM_EVENTS.natlMinor,
      { lat: 34.0522, lng: -118.2437, area: AREA_NATL_MINOR, severity: 'minor', eventType: 'hail', hailSizeInches: 10 });
    await insertStorm(STORM_ROWS.natlSevere, STORM_EVENTS.natlSevere,
      { lat: 36.7378, lng: -119.7871, area: AREA_NATL_SEVERE, severity: 'severe', eventType: 'hail', hailSizeInches: 10 });

    console.log('  Calling checkAndSendStormAlerts with nationwide enabled (all-50-state ingest — this is slow)…');
    const emailsB = [];
    const resultB = await checkAndSendStormAlerts(pool, {
      sendEmailFn: async ({ to, subject, html }) => emailsB.push({ to, subject, html }),
      shouldSuppressCompany: async (cid) => cid !== COMPANY_ID,
    });
    ok('checkAndSendStormAlerts (nationwide) returned success=true', resultB.success === true, JSON.stringify(resultB));

    const digestB = emailsB.filter(e => e.to === RECIPIENT && (e.subject || '').includes('🌎'));
    const htmlB = digestB.map(e => e.html || '').join('\n');

    ok('Nationwide digest DID include the severe hail event',
      htmlB.includes(AREA_NATL_SEVERE),
      `Digest emails: ${digestB.length}; severe area present: ${htmlB.includes(AREA_NATL_SEVERE)}`);

    ok('Nationwide digest did NOT include the minor hail event',
      !htmlB.includes(AREA_NATL_MINOR),
      `"${AREA_NATL_MINOR}" must not appear in the nationwide digest`);

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
