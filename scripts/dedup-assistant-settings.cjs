#!/usr/bin/env node
/**
 * scripts/dedup-assistant-settings.cjs
 *
 * One-time (idempotent) cleanup: removes stale duplicate AssistantSettings rows
 * that were created by a race between a blank default-create and the real save.
 *
 * Background
 * ----------
 * A settings page that saved before its load resolved could create a defaults-only
 * row that silently shadows the real tuned config.  On 2025-07-24 this caused
 * YICN's outbound calls to introduce the company as "Companysync" instead of
 * "YICN Roofing".  The SQL ordering rule (prefer edited rows, then newest) was
 * deployed to fix the live call path, but the stale rows are still present and
 * will be picked again if the canonical row is ever deleted or its updated_date
 * is reset.
 *
 * Safety rules (mirrors assistantSettingsRecord.js healDuplicateSettings)
 * -----------------------------------------------------------------------
 *   - LEXI rows are NEVER touched (separate assistant, by design).
 *   - Only SARAH-PERSONA rows (assistant_name 'sarah', empty/null) are
 *     candidates.  Rows for other named assistants (marcus, custom names, etc.)
 *     are NEVER deleted here — they are distinct third assistants.
 *   - Among Sarah-persona rows, only those that were NEVER edited after creation
 *     (updated_date ≤ created_date + 5 s) are candidates for deletion.  Any row
 *     a human ever maintained is kept, even if it lost the canonical race.
 *   - The canonical row for each company is ALWAYS kept.
 *   - A dry-run mode (DRY_RUN=1) prints the plan without writing.
 *   - The script is safe to re-run.
 *
 * Affected companies (known at time of writing; script also sweeps all others):
 *   yicn_roofing_001, companysync_master_001, loc_mrirljz7_be1zkl
 *
 * Usage
 * -----
 *   # Dry-run (no writes):
 *   DRY_RUN=1 DATABASE_URL=<conn-string> node scripts/dedup-assistant-settings.cjs
 *
 *   # Live run:
 *   DATABASE_URL=<conn-string> node scripts/dedup-assistant-settings.cjs
 *
 *   # Specific companies only:
 *   COMPANY_IDS=yicn_roofing_001,companysync_master_001 DATABASE_URL=<conn-string> node scripts/dedup-assistant-settings.cjs
 *
 *   # Enforce exactly one canonical Sarah row and the correct company brand:
 *   VERIFY_COMPANY_IDS=companysync_master_001,loc_example DATABASE_URL=<conn-string> node scripts/dedup-assistant-settings.cjs
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const {
  isLexiRow,
  isSarahRow,
  wasEditedAfterCreation,
  pickCanonicalSarahRow,
  identifyDeletableDuplicates,
  SARAH_PERSONA_NAMES_ARRAY,
} = require('../lib/assistantSettingsHelpers.cjs');

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
// If set, restrict to these comma-separated company ids.
const COMPANY_FILTER = process.env.COMPANY_IDS
  ? process.env.COMPANY_IDS.split(',').map(s => s.trim()).filter(Boolean)
  : null;
// Optional explicit post-cleanup invariant check. Unlike the duplicate scan,
// this detects zero rows as well as multiple rows and validates brand_name
// against the authoritative companies row.
const VERIFY_COMPANY_IDS = process.env.VERIFY_COMPANY_IDS
  ? process.env.VERIFY_COMPANY_IDS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

async function main() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('[dedup-assistant-settings] ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = createPool({
    connectionString: connStr,
    ssl: connStr.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  try {
    // ── 1. Fetch all companies with >1 Sarah-persona AssistantSettings row ──────
    let companyFilter = '';
    const filterParams = [SARAH_PERSONA_NAMES_ARRAY];
    if (COMPANY_FILTER && COMPANY_FILTER.length > 0) {
      companyFilter = `AND company_id = ANY($2)`;
      filterParams.push(COMPANY_FILTER);
    }

    // LOWER(BTRIM(...)) mirrors isSarahRow() which does .trim().toLowerCase(),
    // so capitalized names like 'Alex' or ' Sarah ' are matched correctly.
    const dupRes = await pool.query(
      `SELECT company_id, COUNT(*) AS cnt
         FROM generic_entities
        WHERE entity_type = 'AssistantSettings'
          AND LOWER(BTRIM(COALESCE(data->>'assistant_name', ''))) = ANY($1)
          ${companyFilter}
        GROUP BY company_id
        HAVING COUNT(*) > 1
        ORDER BY company_id`,
      filterParams
    );

    const dupCompanies = dupRes.rows.map(r => r.company_id);

    if (dupCompanies.length === 0) {
      console.log('[dedup-assistant-settings] No companies with duplicate Sarah-persona AssistantSettings rows found.');
    } else {
      console.log(`[dedup-assistant-settings] Found ${dupCompanies.length} company/companies with duplicate Sarah-persona rows: ${dupCompanies.join(', ')}`);
    }

    // ── 2. For each company, plan which rows to delete ─────────────────────────
    let totalToDelete = 0;
    const plan = []; // { companyId, canonical, toDelete[] }

    for (const companyId of dupCompanies) {
      const rowsRes = await pool.query(
        `SELECT id,
                company_id,
                data->>'assistant_name' AS assistant_name,
                data->>'brand_name'     AS brand_name,
                created_date,
                updated_date
           FROM generic_entities
          WHERE entity_type = 'AssistantSettings'
            AND company_id = $1
          ORDER BY updated_date DESC NULLS LAST`,
        [companyId]
      );

      const rows = rowsRes.rows;
      const canonical = pickCanonicalSarahRow(rows);

      if (!canonical) {
        console.warn(`[dedup-assistant-settings] ${companyId}: could not determine canonical Sarah row — skipping.`);
        continue;
      }

      const toDelete = identifyDeletableDuplicates(rows, canonical);

      plan.push({ companyId, canonical, rows, toDelete });
      totalToDelete += toDelete.length;
    }

    // ── 3. Print plan ──────────────────────────────────────────────────────────
    for (const { companyId, canonical, rows, toDelete } of plan) {
      const lexiRows = rows.filter(r => isLexiRow(r));
      const sarahRows = rows.filter(r => isSarahRow(r));
      const otherRows = rows.filter(r => !isLexiRow(r) && !isSarahRow(r));
      console.log(`\n  Company: ${companyId}`);
      console.log(`    Total AssistantSettings rows : ${rows.length} (${lexiRows.length} lexi, ${sarahRows.length} sarah-persona, ${otherRows.length} other-named)`);
      if (otherRows.length > 0) {
        console.log(`    Other-named rows (UNTOUCHED) : ${otherRows.map(r => `${r.id}[${r.assistant_name || 'unnamed'}]`).join(', ')}`);
      }
      console.log(`    Canonical row                : ${canonical.id}  name="${canonical.assistant_name || ''}"  brand="${canonical.brand_name || '(none)'}"  edited=${wasEditedAfterCreation(canonical)}  updated=${canonical.updated_date || '(null)'}`);
      if (toDelete.length === 0) {
        console.log(`    Stale rows to delete         : none (already clean)`);
      } else {
        for (const r of toDelete) {
          console.log(`    Stale row to DELETE          : ${r.id}  name="${r.assistant_name || ''}"  brand="${r.brand_name || '(none)'}"  created=${r.created_date || '(null)'}  updated=${r.updated_date || '(null)'}`);
        }
      }
    }

    let deleted = 0;
    if (totalToDelete === 0) {
      console.log('\n[dedup-assistant-settings] Nothing to delete.');
    } else {
      console.log(`\n[dedup-assistant-settings] Total rows planned for deletion: ${totalToDelete}`);
    }

    if (DRY_RUN) {
      console.log('[dedup-assistant-settings] DRY_RUN=1 — no writes performed.');
    } else {
      // ── 4. Delete ────────────────────────────────────────────────────────────
      for (const { companyId, canonical, toDelete } of plan) {
        for (const row of toDelete) {
        // Atomic: the WHERE clause re-checks the stale signature so a row that
        // gets edited between our SELECT and this DELETE is NOT removed.
        // Also re-checks the Sarah-persona constraint so non-Sarah rows are
        // never accidentally deleted even if identifyDeletableDuplicates logic
        // changes in the future.
          const res = await pool.query(
            `DELETE FROM generic_entities
              WHERE id = $1
                AND entity_type = 'AssistantSettings'
                AND company_id = $2
                AND LOWER(BTRIM(COALESCE(data->>'assistant_name', ''))) <> 'lexi'
                AND LOWER(BTRIM(COALESCE(data->>'assistant_name', ''))) = ANY($3)
                AND (
                  created_date IS NULL
                  OR updated_date IS NULL
                  OR updated_date <= created_date + interval '5 seconds'
                )`,
            [row.id, companyId, SARAH_PERSONA_NAMES_ARRAY]
          );
          if (res.rowCount > 0) {
            console.log(`[dedup-assistant-settings] ✓ Deleted stale row ${row.id} from company ${companyId} (kept ${canonical.id})`);
            deleted++;
          } else {
            console.warn(`[dedup-assistant-settings] ~ Row ${row.id} skipped — already gone or edited concurrently (kept)`);
          }
        }
      }
      console.log(`\n[dedup-assistant-settings] Done. Deleted ${deleted} stale row(s).`);
    }

    // ── 5. Verification ────────────────────────────────────────────────────────
    const verificationIds = [...new Set([
      ...plan.map(({ companyId }) => companyId),
      ...VERIFY_COMPANY_IDS,
    ])];
    if (verificationIds.length === 0) {
      console.log('\n[dedup-assistant-settings] Verification skipped (set VERIFY_COMPANY_IDS to enforce zero/one/many invariants for named companies).');
      return;
    }

    console.log('\n[dedup-assistant-settings] Verification:');
    let verificationFailed = false;
    for (const companyId of verificationIds) {
      const companyRes = await pool.query(
        `SELECT COALESCE(NULLIF(company_name, ''), NULLIF(name, '')) AS company_name
           FROM companies
          WHERE id = $1
            AND COALESCE(is_deleted, false) = false
          LIMIT 1`,
        [companyId]
      );
      const expectedBrand = companyRes.rows[0]?.company_name?.trim() || null;
      const verRes = await pool.query(
        `SELECT id, data->>'assistant_name' AS assistant_name, data->>'brand_name' AS brand_name, updated_date
           FROM generic_entities
          WHERE entity_type = 'AssistantSettings'
            AND company_id = $1
          ORDER BY updated_date DESC NULLS LAST`,
        [companyId]
      );
      const sarahRemaining = verRes.rows.filter(r => isSarahRow(r));
      const otherRemaining = verRes.rows.filter(r => !isLexiRow(r) && !isSarahRow(r));
      const canonicalBrand = sarahRemaining[0]?.brand_name?.trim() || null;
      const brandMatches = !!expectedBrand && canonicalBrand?.toLowerCase() === expectedBrand.toLowerCase();
      const passed = sarahRemaining.length === 1 && brandMatches;
      if (!passed) verificationFailed = true;
      const status = passed ? '✓' : '✗';
      console.log(`  ${status} ${companyId}: ${sarahRemaining.length} sarah-persona row(s), expected brand="${expectedBrand || '(company missing)'}", actual brand="${canonicalBrand || '(none)'}", ${otherRemaining.length} other-named row(s) preserved`);
      for (const r of verRes.rows) {
        const tag = isLexiRow(r) ? '[lexi]' : isSarahRow(r) ? '[sarah]' : '[other]';
        console.log(`      ${tag} id=${r.id}  name="${r.assistant_name || ''}"  brand="${r.brand_name || '(none)'}"  updated=${r.updated_date || '(null)'}`);
      }
    }
    if (verificationFailed) {
      throw new Error('Verification failed: every requested active company must have exactly one Sarah-persona row with brand_name matching the company name');
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => {
  console.error('[dedup-assistant-settings] Fatal error:', e.message);
  process.exit(1);
});
