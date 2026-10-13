#!/usr/bin/env node
/**
 * Back-fill customer_id and lead_id on existing ContractSigningSession records.
 *
 * Matching strategy (per company, in order):
 *   1. customer_email  →  customers.email     (exact, case-insensitive)
 *   2. customer_email  →  leads.email         (exact, case-insensitive)
 *   3. customer_name   →  customers.name      (trimmed ILIKE)
 *   4. customer_name   →  leads.name          (trimmed ILIKE)
 *
 * Run:
 *   node scripts/backfill-contract-sessions.cjs
 *
 * Pass --dry-run to preview matches without writing.
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const pool = createPool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') || process.env.DATABASE_URL?.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
  });

  console.log(`[backfill-contract-sessions] Starting${DRY_RUN ? ' (DRY RUN — no writes)' : ''}`);

  // Ensure columns exist (idempotent — safe to run multiple times)
  try {
    await pool.query(`
      ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS customer_id TEXT;
      ALTER TABLE signing_sessions ADD COLUMN IF NOT EXISTS lead_id TEXT;
    `);
    console.log('[backfill-contract-sessions] Columns customer_id / lead_id ensured on signing_sessions');
  } catch (err) {
    console.error('[backfill-contract-sessions] Could not add columns:', err.message);
    await pool.end();
    process.exit(1);
  }

  // Fetch all sessions that are missing both customer_id and lead_id
  const { rows: sessions } = await pool.query(`
    SELECT id, company_id, customer_name, customer_email
    FROM signing_sessions
    WHERE (customer_id IS NULL OR customer_id = '')
      AND (lead_id IS NULL OR lead_id = '')
    ORDER BY created_at ASC
  `);

  console.log(`[backfill-contract-sessions] Found ${sessions.length} session(s) to process`);

  let matchedCustomer = 0;
  let matchedLead = 0;
  let unresolved = 0;
  const unresolvedList = [];

  for (const session of sessions) {
    const { id, company_id, customer_name, customer_email } = session;
    const emailLower = (customer_email || '').trim().toLowerCase();
    const nameTrimmed = (customer_name || '').trim();

    let customerId = null;
    let leadId = null;
    let matchReason = null;

    // --- 1. Email → Customer ---
    if (!customerId && !leadId && emailLower) {
      const { rows } = await pool.query(
        `SELECT id FROM customers WHERE company_id = $1 AND LOWER(COALESCE(email,'')) = $2 LIMIT 1`,
        [company_id, emailLower]
      );
      if (rows.length > 0) {
        customerId = rows[0].id;
        matchReason = `email→customer (${emailLower})`;
      }
    }

    // --- 2. Email → Lead ---
    if (!customerId && !leadId && emailLower) {
      const { rows } = await pool.query(
        `SELECT id FROM leads WHERE company_id = $1 AND LOWER(COALESCE(email,'')) = $2 LIMIT 1`,
        [company_id, emailLower]
      );
      if (rows.length > 0) {
        leadId = rows[0].id;
        matchReason = `email→lead (${emailLower})`;
      }
    }

    // --- 3. Name → Customer ---
    if (!customerId && !leadId && nameTrimmed) {
      const { rows } = await pool.query(
        `SELECT id FROM customers WHERE company_id = $1 AND TRIM(COALESCE(name,'')) ILIKE $2 LIMIT 1`,
        [company_id, nameTrimmed]
      );
      if (rows.length > 0) {
        customerId = rows[0].id;
        matchReason = `name→customer (${nameTrimmed})`;
      }
    }

    // --- 4. Name → Lead ---
    if (!customerId && !leadId && nameTrimmed) {
      const { rows } = await pool.query(
        `SELECT id FROM leads WHERE company_id = $1 AND TRIM(COALESCE(name,'')) ILIKE $2 LIMIT 1`,
        [company_id, nameTrimmed]
      );
      if (rows.length > 0) {
        leadId = rows[0].id;
        matchReason = `name→lead (${nameTrimmed})`;
      }
    }

    if (customerId || leadId) {
      if (!DRY_RUN) {
        const updates = [];
        const vals = [];
        let idx = 1;
        if (customerId) { updates.push(`customer_id = $${idx++}`); vals.push(customerId); }
        if (leadId)     { updates.push(`lead_id = $${idx++}`);     vals.push(leadId); }
        vals.push(id);
        await pool.query(
          `UPDATE signing_sessions SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
          vals
        );
      }
      if (customerId) {
        matchedCustomer++;
        console.log(`  ✅ session ${id} → customer_id ${customerId}  [${matchReason}]${DRY_RUN ? ' (dry)' : ''}`);
      } else {
        matchedLead++;
        console.log(`  ✅ session ${id} → lead_id ${leadId}  [${matchReason}]${DRY_RUN ? ' (dry)' : ''}`);
      }
    } else {
      unresolved++;
      unresolvedList.push({ id, company_id, customer_name, customer_email });
      console.log(`  ⚠️  session ${id} — no match  (name="${nameTrimmed}", email="${emailLower}")`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`  Total sessions processed : ${sessions.length}`);
  console.log(`  Matched → customer_id   : ${matchedCustomer}`);
  console.log(`  Matched → lead_id        : ${matchedLead}`);
  console.log(`  Unresolved               : ${unresolved}`);
  if (DRY_RUN) {
    console.log('\n  ⚠️  Dry-run mode — no rows were updated. Remove --dry-run to apply.');
  }
  if (unresolvedList.length > 0) {
    console.log('\n  Unresolved sessions (no matching customer or lead found):');
    unresolvedList.forEach(s => {
      console.log(`    id=${s.id}  company=${s.company_id}  name="${s.customer_name}"  email="${s.customer_email}"`);
    });
  }

  await pool.end();
  console.log('\n[backfill-contract-sessions] Done');
}

main().catch(err => {
  console.error('[backfill-contract-sessions] Fatal error:', err);
  process.exit(1);
});
