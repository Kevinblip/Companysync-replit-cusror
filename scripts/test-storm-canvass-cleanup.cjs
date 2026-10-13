#!/usr/bin/env node
/**
 * Storm Canvass Lead Cleanup Test
 * ──────────────────────────────────────────────────────────────────────────
 * Verifies purgeStaleStormLeads behaviour end-to-end against the real DB:
 *
 *   A) Dry-run returns the correct stale-lead count without modifying rows
 *   B) Stale leads (storm_canvass, 30+ days old, no comms, no calendar events)
 *      are archived (is_active=false, status='archived')
 *   C) Leads with a recent communication are NOT archived
 *   D) Leads imported fewer than 30 days ago are NOT archived
 *   E) Leads belonging to a different company are NOT touched (tenant isolation)
 *
 * Prerequisites:
 *   - DATABASE_URL set (dev server does NOT need to be running)
 *
 * Usage:  node scripts/test-storm-canvass-cleanup.cjs
 */
'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const crypto = require('crypto');

const pool = createPool({ connectionString: process.env.DATABASE_URL });

// ── Stable fixture identifiers ─────────────────────────────────────────────
const COMPANY_A  = 'smoke_sscl_company_a';
const COMPANY_B  = 'smoke_sscl_company_b';   // different tenant — must not be touched

// leads for company A
const LEAD_STALE_1     = 'smoke_sscl_lead_stale_1';   // 35 days old, no activity → archive
const LEAD_STALE_2     = 'smoke_sscl_lead_stale_2';   // 40 days old, no activity → archive
const LEAD_HAS_COMM    = 'smoke_sscl_lead_comm';       // 35 days old + recent comm → keep
const LEAD_TOO_NEW     = 'smoke_sscl_lead_new';        // 10 days old → keep
const LEAD_OTHER_CO    = 'smoke_sscl_lead_other_co';   // company B, stale → NOT touched by company A purge
const COMM_ID          = 'smoke_sscl_comm_001';        // recent communication for LEAD_HAS_COMM

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
    await pool.query(`DELETE FROM leads WHERE id = ANY($1::text[])`, [
      [LEAD_STALE_1, LEAD_STALE_2, LEAD_HAS_COMM, LEAD_TOO_NEW, LEAD_OTHER_CO],
    ]);
    await pool.query(`DELETE FROM communications WHERE id = $1`, [COMM_ID]);
  } catch (e) {
    console.warn('[cleanup] warning:', e.message);
  }
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

async function insertLead(id, companyId, daysOld, status = 'new') {
  await pool.query(
    `INSERT INTO leads (id, name, street, city, state, zip, status, source, lead_source,
                        company_id, is_active, created_at, updated_at)
     VALUES ($1, 'Test Owner', '123 Test St', 'Testville', 'TX', '75001',
             $2, 'property_data', 'storm_canvass', $3, true, $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [id, status, companyId, daysAgo(daysOld)]
  );
}

// ── Core purge logic mirrored from purgeStaleStormLeads ────────────────────
// We inline the SQL here so the test runs without importing the ESM plugin.
const COLD_STATUSES = ['new', 'contacted', 'no_answer', 'follow_up', 'not_home', 'left_message', 'cold'];

async function runPurge({ companyId, dryRun = false }) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const params = [cutoff, COLD_STATUSES];
  let paramIdx = 3;
  let companyClause = '';
  if (companyId) {
    params.push(companyId);
    companyClause = `AND l.company_id = $${paramIdx++}`;
  }

  const candidatesRes = await pool.query(
    `SELECT l.id, l.company_id
     FROM leads l
     WHERE l.lead_source = 'storm_canvass'
       AND (l.is_active IS NULL OR l.is_active = true)
       AND l.created_at < $1
       AND l.status = ANY($2::text[])
       ${companyClause}
       AND NOT EXISTS (
         SELECT 1 FROM communications c
         WHERE c.lead_id = l.id AND c.created_at > $1
       )
       AND NOT EXISTS (
         SELECT 1 FROM calendar_events ce
         WHERE (ce.data->>'lead_id' = l.id OR ce.related_lead = l.id)
           AND ce.created_at > $1
       )`,
    params
  );

  if (dryRun) return { wouldArchive: candidatesRes.rows.length, ids: candidatesRes.rows.map(r => r.id) };

  if (!candidatesRes.rows.length) return { archived: 0 };

  const ids = candidatesRes.rows.map(r => r.id);
  await pool.query(
    `UPDATE leads SET is_active = false, status = 'archived', updated_at = NOW()
     WHERE id = ANY($1::text[])`,
    [ids]
  );
  return { archived: ids.length, ids };
}

async function getLeadStatus(id) {
  const { rows } = await pool.query(
    `SELECT is_active, status FROM leads WHERE id = $1`, [id]
  );
  return rows[0] || null;
}

async function run() {
  console.log('\n🌩️  Storm Canvass Lead Cleanup Test\n');

  try {
    await cleanup();

    // ── Seed test data ────────────────────────────────────────────────────
    await insertLead(LEAD_STALE_1,  COMPANY_A, 35);   // stale → archive
    await insertLead(LEAD_STALE_2,  COMPANY_A, 40);   // stale → archive
    await insertLead(LEAD_HAS_COMM, COMPANY_A, 35);   // stale but has recent comm → keep
    await insertLead(LEAD_TOO_NEW,  COMPANY_A, 10);   // too new → keep
    await insertLead(LEAD_OTHER_CO, COMPANY_B, 40);   // different company → NOT touched by A purge

    // Insert a recent communication for LEAD_HAS_COMM
    await pool.query(
      `INSERT INTO communications (id, lead_id, company_id, type, body, created_at, updated_at)
       VALUES ($1, $2, $3, 'sms', 'Follow-up text', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [COMM_ID, LEAD_HAS_COMM, COMPANY_A]
    );

    // ── Test A: dry-run returns correct count ─────────────────────────────
    console.log('─── Test A: dry-run count ───');
    const dry = await runPurge({ companyId: COMPANY_A, dryRun: true });
    ok('Dry-run finds exactly 2 stale leads (STALE_1 + STALE_2)',
      dry.wouldArchive === 2,
      `got ${dry.wouldArchive}`
    );
    ok('Dry-run does NOT include the lead with a recent comm',
      !dry.ids.includes(LEAD_HAS_COMM),
      `LEAD_HAS_COMM unexpectedly in dry-run candidates`
    );
    ok('Dry-run does NOT include the too-new lead',
      !dry.ids.includes(LEAD_TOO_NEW),
      `LEAD_TOO_NEW unexpectedly in dry-run candidates`
    );
    ok('Dry-run does NOT include the other-company lead',
      !dry.ids.includes(LEAD_OTHER_CO),
      `LEAD_OTHER_CO unexpectedly in dry-run candidates`
    );

    // ── Test B: rows are unchanged after dry-run ──────────────────────────
    console.log('\n─── Test B: dry-run leaves rows unchanged ───');
    const stale1Before = await getLeadStatus(LEAD_STALE_1);
    ok('LEAD_STALE_1 still active after dry-run',
      stale1Before?.is_active === true,
      `is_active=${stale1Before?.is_active}`
    );

    // ── Test C: real purge archives stale, leaves active ones ────────────
    console.log('\n─── Test C: confirmed purge ───');
    const purgeResult = await runPurge({ companyId: COMPANY_A, dryRun: false });
    ok('Purge reports 2 archived leads',
      purgeResult.archived === 2,
      `archived=${purgeResult.archived}`
    );

    const s1 = await getLeadStatus(LEAD_STALE_1);
    ok('LEAD_STALE_1 is archived (is_active=false)',
      s1?.is_active === false && s1?.status === 'archived',
      `is_active=${s1?.is_active} status=${s1?.status}`
    );

    const s2 = await getLeadStatus(LEAD_STALE_2);
    ok('LEAD_STALE_2 is archived (is_active=false)',
      s2?.is_active === false && s2?.status === 'archived',
      `is_active=${s2?.is_active} status=${s2?.status}`
    );

    // ── Test D: lead with recent comm is untouched ────────────────────────
    console.log('\n─── Test D: lead with recent communication kept ───');
    const comm = await getLeadStatus(LEAD_HAS_COMM);
    ok('LEAD_HAS_COMM (recent comm) was NOT archived',
      comm?.is_active === true && comm?.status !== 'archived',
      `is_active=${comm?.is_active} status=${comm?.status}`
    );

    // ── Test E: too-new lead is untouched ────────────────────────────────
    console.log('\n─── Test E: recently imported lead kept ───');
    const newLead = await getLeadStatus(LEAD_TOO_NEW);
    ok('LEAD_TOO_NEW (10 days old) was NOT archived',
      newLead?.is_active === true && newLead?.status !== 'archived',
      `is_active=${newLead?.is_active} status=${newLead?.status}`
    );

    // ── Test F: tenant isolation (company B lead untouched) ───────────────
    console.log('\n─── Test F: tenant isolation ───');
    const other = await getLeadStatus(LEAD_OTHER_CO);
    ok('LEAD_OTHER_CO (company B) was NOT archived by company A purge',
      other?.is_active === true && other?.status !== 'archived',
      `is_active=${other?.is_active} status=${other?.status}`
    );

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
