#!/usr/bin/env node
/**
 * scripts/backfill-company-timezone.cjs
 *
 * One-time (idempotent) backfill: sets companies.timezone for rows where the
 * column is NULL or empty so the timezone-configured health check passes and
 * cron jobs (weekly texts, reminders, reports) fire at the correct local time.
 *
 * Resolution order per company:
 *   1. settings->>'time_zone' or settings->>'timezone' (explicit saved value)
 *   2. US state inferred from the address column (regex match on state abbrev/name)
 *   3. Default: America/New_York  (logged as a warning)
 *
 * The script is safe to re-run: it only touches rows with NULL/empty timezone.
 *
 * Usage:
 *   DATABASE_URL=<conn-string> node scripts/backfill-company-timezone.cjs
 *
 * Dry-run (read-only, no writes):
 *   DRY_RUN=1 DATABASE_URL=... node scripts/backfill-company-timezone.cjs
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

// US state → IANA timezone (first/primary zone for each state)
const STATE_TZ_MAP = {
  AK: 'America/Anchorage',  HI: 'Pacific/Honolulu',
  AZ: 'America/Phoenix',
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  CO: 'America/Denver',      MT: 'America/Denver',
  UT: 'America/Denver',      WY: 'America/Denver',
  NM: 'America/Denver',      ID: 'America/Denver',
  IL: 'America/Chicago',     WI: 'America/Chicago',
  MN: 'America/Chicago',     IA: 'America/Chicago',
  MO: 'America/Chicago',     OK: 'America/Chicago',
  KS: 'America/Chicago',     TX: 'America/Chicago',
  LA: 'America/Chicago',     AR: 'America/Chicago',
  MS: 'America/Chicago',     AL: 'America/Chicago',
  ND: 'America/Chicago',     SD: 'America/Chicago',
  NE: 'America/Chicago',
};
const DEFAULT_TZ = 'America/New_York';

function inferTimezone(address, settings) {
  // 1. Explicit settings value
  const settingsTz = settings?.time_zone || settings?.timezone;
  if (settingsTz && typeof settingsTz === 'string' && settingsTz.trim()) {
    return { tz: settingsTz.trim(), source: 'settings' };
  }
  // 2. State abbreviation in address  (e.g. ", CO 80302" or " TX," or "Texas")
  if (address) {
    for (const [abbr, tz] of Object.entries(STATE_TZ_MAP)) {
      const re = new RegExp(`\\b${abbr}\\b`, 'i');
      if (re.test(address)) return { tz, source: `address(${abbr})` };
    }
  }
  return { tz: DEFAULT_TZ, source: 'default' };
}

async function main() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('[backfill-tz] ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = createPool({
    connectionString: connStr,
    ssl: connStr.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  try {
    const candidatesRes = await pool.query(`
      SELECT id, name, address, settings
      FROM companies
      WHERE (timezone IS NULL OR TRIM(timezone) = '')
        AND (is_deleted IS NULL OR is_deleted = false)
        AND id NOT LIKE 'plan_test_%'
      ORDER BY created_at ASC NULLS LAST
    `);

    const rows = candidatesRes.rows;
    console.log(`[backfill-tz] ${rows.length} companies need a timezone.`);
    if (rows.length === 0) { console.log('[backfill-tz] Nothing to do.'); return; }

    const plan = rows.map(r => {
      const { tz, source } = inferTimezone(r.address, r.settings);
      return { id: r.id, name: r.name, tz, source };
    });

    const defaulted = plan.filter(p => p.source === 'default');
    if (defaulted.length > 0) {
      console.warn(`[backfill-tz] WARNING: ${defaulted.length} company(ies) have no state/address info — defaulting to ${DEFAULT_TZ}:`);
      defaulted.forEach(p => console.warn(`  ${p.id}  "${p.name}"`));
    }

    console.log('[backfill-tz] Planned updates:');
    plan.forEach(p => console.log(`  ${p.id}  "${p.name}"  → ${p.tz}  (source: ${p.source})`));

    if (DRY_RUN) { console.log('[backfill-tz] DRY_RUN=1 — no writes performed.'); return; }

    let updated = 0;
    for (const row of plan) {
      const res = await pool.query(
        `UPDATE companies SET timezone = $1, updated_at = NOW()
          WHERE id = $2 AND (timezone IS NULL OR TRIM(timezone) = '')`,
        [row.tz, row.id]
      );
      if (res.rowCount > 0) {
        console.log(`[backfill-tz] ✓ ${row.id} "${row.name}" → ${row.tz}  (${row.source})`);
        updated++;
      } else {
        console.log(`[backfill-tz] ~ ${row.id} — already set, skipped`);
      }
    }
    console.log(`[backfill-tz] Done. Updated ${updated}/${plan.length} rows.`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error('[backfill-tz] Fatal:', e.message); process.exit(1); });
