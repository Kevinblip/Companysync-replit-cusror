#!/usr/bin/env node
/**
 * scripts/cleanup-supplement-chain-links.cjs
 *
 * One-off (idempotent) cleanup for estimates whose downward chain link points
 * at the wrong record.
 *
 * The copy-forward that creates a supplement / change order used to carry the
 * parent's `has_supplement_id` and `has_supplement_number` onto the new child.
 * A child born from a parent that already had a supplement therefore inherited
 * a pointer to its own SIBLING: the chain badge opened the wrong estimate and
 * the Estimates list showed a supplement count on an estimate with no
 * supplements. The creation paths no longer copy those fields; this repairs the
 * rows written before that fix.
 *
 * A link is sound only when the record it points at names the pointer's owner
 * as its parent (`supplement_of`). For every row that fails that test:
 *   - repoint it at its newest real child, if it actually has one;
 *   - otherwise clear the downward link entirely.
 *
 * Rows with a sound link, and rows with no downward link at all, are untouched,
 * so the script is safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=<conn-string> node scripts/cleanup-supplement-chain-links.cjs
 *
 * Dry-run (read-only, no writes):
 *   DRY_RUN=1 DATABASE_URL=... node scripts/cleanup-supplement-chain-links.cjs
 */

'use strict';

const LOG = '[chain-cleanup]';

/**
 * Chain fields are not real columns on `estimates`, they live in the `data`
 * JSONB. Read the JSONB first and fall back to a flattened copy so the planner
 * works on both raw rows and already-merged entity objects.
 */
function chainField(row, key) {
  const fromData = row && row.data && typeof row.data === 'object' ? row.data[key] : undefined;
  const value = fromData !== undefined && fromData !== null && fromData !== '' ? fromData : row?.[key];
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

function createdAtMs(row) {
  const raw = row?.created_at || row?.created_date || chainField(row, 'created_date');
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Decide what to do with every row carrying a downward chain link.
 * Pure — the test drives it directly, main() feeds it real rows.
 */
function planSupplementChainRepairs(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const byId = new Map(all.map((row) => [String(row.id), row]));

  const childrenByParent = new Map();
  for (const row of all) {
    const parentId = chainField(row, 'supplement_of');
    if (!parentId) continue;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(row);
  }

  const repairs = [];
  for (const row of all) {
    const pointer = chainField(row, 'has_supplement_id');
    if (!pointer) continue;

    const target = byId.get(pointer) || null;
    // The one test that matters: does the record this points at agree that
    // this row is its parent?
    if (target && chainField(target, 'supplement_of') === String(row.id)) continue;

    const children = (childrenByParent.get(String(row.id)) || [])
      .slice()
      .sort((a, b) => createdAtMs(b) - createdAtMs(a));

    const reason = target
      ? `points at ${target.estimate_number || target.id}, which names ${chainField(target, 'supplement_of') || 'nobody'} as its parent`
      : `points at missing record ${pointer}`;

    if (children.length > 0) {
      const newest = children[0];
      repairs.push({
        id: String(row.id),
        estimate_number: row.estimate_number || '',
        action: 'repoint',
        reason,
        has_supplement: true,
        has_supplement_id: String(newest.id),
        has_supplement_number: newest.estimate_number || '',
      });
    } else {
      repairs.push({
        id: String(row.id),
        estimate_number: row.estimate_number || '',
        action: 'clear',
        reason,
        has_supplement: false,
        has_supplement_id: '',
        has_supplement_number: '',
      });
    }
  }
  return repairs;
}

async function main() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error(`${LOG} ERROR: DATABASE_URL is not set.`);
    process.exit(1);
  }
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: connStr,
    ssl: connStr.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  try {
    const res = await pool.query(`
      SELECT id, company_id, estimate_number, created_at, data
      FROM estimates
    `);
    console.log(`${LOG} scanned ${res.rows.length} estimates.`);

    const repairs = planSupplementChainRepairs(res.rows);
    if (repairs.length === 0) {
      console.log(`${LOG} every downward chain link is sound — nothing to do.`);
      return;
    }

    console.log(`${LOG} ${repairs.length} row(s) need repair:`);
    for (const r of repairs) {
      const outcome = r.action === 'repoint'
        ? `repoint → ${r.has_supplement_number || r.has_supplement_id}`
        : 'clear (no real child)';
      console.log(`${LOG}   ${r.estimate_number || r.id}: ${r.reason} → ${outcome}`);
    }

    if (dryRun) {
      console.log(`${LOG} DRY_RUN=1 — no writes performed.`);
      return;
    }

    let updated = 0;
    for (const r of repairs) {
      const patch = r.action === 'repoint'
        ? {
            has_supplement: true,
            has_supplement_id: r.has_supplement_id,
            has_supplement_number: r.has_supplement_number,
          }
        : { has_supplement: false };

      const sql = r.action === 'repoint'
        ? `UPDATE estimates
              SET data = COALESCE(data, '{}'::jsonb) || $1::jsonb,
                  updated_at = NOW()
            WHERE id = $2`
        // A cleared link must lose the keys, not just flip the flag: the UI
        // reads has_supplement_id directly in several places.
        : `UPDATE estimates
              SET data = (COALESCE(data, '{}'::jsonb) - 'has_supplement_id' - 'has_supplement_number') || $1::jsonb,
                  updated_at = NOW()
            WHERE id = $2`;

      const out = await pool.query(sql, [JSON.stringify(patch), r.id]);
      if (out.rowCount > 0) {
        updated++;
        console.log(`${LOG} ✓ ${r.estimate_number || r.id} ${r.action}ed`);
      } else {
        console.warn(`${LOG} ! ${r.estimate_number || r.id} not updated (row vanished?)`);
      }
    }
    console.log(`${LOG} done. Updated ${updated}/${repairs.length} rows.`);
  } finally {
    await pool.end();
  }
}

module.exports = { planSupplementChainRepairs, chainField };

if (require.main === module) {
  main().catch((e) => {
    console.error(`${LOG} Fatal:`, e.message);
    process.exit(1);
  });
}
