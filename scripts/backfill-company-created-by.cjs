#!/usr/bin/env node
/**
 * Backfill scripts/backfill-company-created-by.cjs
 *
 * One-time (idempotent) backfill: sets companies.created_by from the best
 * available evidence for rows where it is NULL or empty.
 *
 * Resolution order per company:
 *   1. Earliest active administrator staff_profiles.user_email
 *   2. Earliest active staff_profiles.user_email (any role)
 *   3. Company email column — if and only if it matches a row in the users table
 *
 * Companies that have no resolvable owner are skipped (logged, not updated).
 * The script is safe to re-run: it only touches rows with NULL/empty created_by.
 *
 * Usage:
 *   DATABASE_URL=<conn-string> node scripts/backfill-company-created-by.cjs
 *
 * For production:
 *   DATABASE_URL=$(heroku config:get DATABASE_URL -a <app>) node scripts/backfill-company-created-by.cjs
 *
 * Dry-run (read-only, no writes):
 *   DRY_RUN=1 DATABASE_URL=... node scripts/backfill-company-created-by.cjs
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

async function main() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('[backfill] ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = createPool({ connectionString: connStr, ssl: connStr.includes('localhost') ? false : { rejectUnauthorized: false } });

  try {
    // ── Read-only analysis ──────────────────────────────────────────────────
    const candidatesRes = await pool.query(`
      WITH candidates AS (
        SELECT
          c.id          AS company_id,
          c.name        AS company_name,
          c.email       AS company_email,
          COALESCE(
            -- 1: earliest active admin staff_profiles row
            (SELECT sp.user_email FROM staff_profiles sp
             WHERE sp.company_id = c.id AND sp.is_active = true AND sp.is_administrator = true
               AND sp.user_email IS NOT NULL AND sp.user_email <> ''
             ORDER BY sp.created_at ASC NULLS LAST LIMIT 1),
            -- 2: any active staff member
            (SELECT sp.user_email FROM staff_profiles sp
             WHERE sp.company_id = c.id AND sp.is_active = true
               AND sp.user_email IS NOT NULL AND sp.user_email <> ''
             ORDER BY sp.created_at ASC NULLS LAST LIMIT 1),
            -- 3: company email if it matches a real user
            (SELECT u.email FROM users u WHERE LOWER(u.email) = LOWER(c.email) LIMIT 1)
          ) AS resolved_owner
        FROM companies c
        WHERE (c.created_by IS NULL OR TRIM(c.created_by) = '')
          AND c.id NOT LIKE 'plan_test_%'
      )
      SELECT * FROM candidates ORDER BY company_id
    `);

    const rows = candidatesRes.rows;
    const toUpdate = rows.filter(r => r.resolved_owner);
    const toSkip   = rows.filter(r => !r.resolved_owner);

    console.log(`[backfill] Found ${rows.length} companies with missing created_by.`);
    console.log(`[backfill]   → ${toUpdate.length} will be updated, ${toSkip.length} skipped (no owner found).`);

    if (toSkip.length > 0) {
      console.warn('[backfill] Skipped (no resolvable owner):');
      toSkip.forEach(r => console.warn(`  ${r.company_id}  "${r.company_name}"  company_email=${r.company_email || '(none)'}`));
    }

    if (toUpdate.length === 0) {
      console.log('[backfill] Nothing to update — all done.');
      return;
    }

    console.log('[backfill] Planned updates:');
    toUpdate.forEach(r =>
      console.log(`  ${r.company_id}  "${r.company_name}"  → created_by = ${r.resolved_owner}`)
    );

    if (DRY_RUN) {
      console.log('[backfill] DRY_RUN=1 — no writes performed.');
      return;
    }

    // ── Write ───────────────────────────────────────────────────────────────
    let updated = 0;
    for (const row of toUpdate) {
      const res = await pool.query(
        `UPDATE companies
            SET created_by = $1, updated_at = NOW()
          WHERE id = $2
            AND (created_by IS NULL OR TRIM(created_by) = '')`,
        [row.resolved_owner, row.company_id]
      );
      if (res.rowCount > 0) {
        console.log(`[backfill] ✓ ${row.company_id} "${row.company_name}" → ${row.resolved_owner}`);
        updated++;
      } else {
        console.log(`[backfill] ~ ${row.company_id} "${row.company_name}" — already set, skipped`);
      }
    }

    console.log(`[backfill] Done. Updated ${updated} / ${toUpdate.length} rows.`);
  } finally {
    await pool.end();
  }
}

main().catch(e => {
  console.error('[backfill] Fatal error:', e.message);
  process.exit(1);
});
