#!/usr/bin/env node
/**
 * AI Platform-Spend Circuit Breaker Smoke Test
 * ─────────────────────────────────────────────
 * Verifies the dollar-based spend gate in checkAIUsage (vite-functions-plugin.js):
 *
 *   A. Paid company below $150 MTD spend → allowed
 *   B. ≥ $150 (warn) but < $200 → still allowed; SpendNotice 'warning' claimed once
 *   C. ≥ $200 (hard cap) → allowed:false with BYOK-pointing message;
 *      SpendNotice 'hard_stop' claimed; super-admin bell Notifications written
 *   D. Idempotency — repeat calls never create duplicate SpendNotice rows
 *   E. BYOK-style usage (ai_byok @ $0 cost) never contributes to spend → allowed
 *   F. Interaction-count cap still enforced independently (backstop intact)
 *
 * Prerequisites: DATABASE_URL set. Imports the plugin module directly (same
 * path prod-integrations.cjs uses), so no running server is required.
 * Fixture IDs use stable "smoke_scb_" prefix; cleans up after itself.
 */
'use strict';

const path = require('path');
const { createPool } = require('./lib/db-pool.cjs');
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const CO = 'smoke_scb_paid_co';
const DELIVERY_CO = 'scb_delivery_probe_co';

let passed = 0, failed = 0;
function ok(name, cond, got) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${got !== undefined ? ` (got: ${JSON.stringify(got)})` : ''}`); failed++; }
}

async function insertUsage(companyId, feature, units, unitCost) {
  const month = new Date().toISOString().slice(0, 7);
  const date = new Date().toISOString().slice(0, 10);
  const id = `smoke_scb_usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
    [id, companyId, JSON.stringify({
      company_id: companyId, feature, units, unit_cost: unitCost,
      total_cost: unitCost * units, usage_month: month, usage_date: date,
      logged_at: new Date().toISOString(),
    })]
  );
}

async function spendNotices(companyId, kind) {
  const { rows } = await pool.query(
    `SELECT id FROM generic_entities WHERE entity_type = 'SpendNotice'
     AND data->>'company_id' = $1 AND data->>'kind' = $2`, [companyId, kind]);
  return rows.length;
}

async function spendNoticeData(companyId, kind) {
  const { rows } = await pool.query(
    `SELECT data FROM generic_entities WHERE entity_type = 'SpendNotice'
     AND data->>'company_id' = $1 AND data->>'kind' = $2 LIMIT 1`,
    [companyId, kind]
  );
  return rows[0]?.data || null;
}

async function cleanup() {
  const companyIds = [CO, DELIVERY_CO];
  await pool.query(`DELETE FROM generic_entities WHERE company_id = ANY($1::text[])`, [companyIds]);
  await pool.query(`DELETE FROM generic_entities WHERE id LIKE 'spendnotice_smoke_scb_%'`);
  await pool.query(
    `DELETE FROM generic_entities
     WHERE entity_type = 'Notification' AND data->>'related_entity_id' = ANY($1::text[])`,
    [companyIds]
  );
  await pool.query(`DELETE FROM companies WHERE id = ANY($1::text[])`, [companyIds]);
}

(async () => {
  let restoreEmailSender = null;
  try {
    const mod = await import(path.resolve(__dirname, '../vite-functions-plugin.js'));
    const { checkAIUsage, functionHandlers } = mod;
    const emailAttempts = [];
    const originalEmailSender = functionHandlers.sendEmailWithResend;
    functionHandlers.sendEmailWithResend = async (params) => {
      emailAttempts.push(params);
      return { success: true, id: `mock-email-${emailAttempts.length}` };
    };
    restoreEmailSender = () => {
      functionHandlers.sendEmailWithResend = originalEmailSender;
    };

    // This test intentionally crosses the warning and hard-stop thresholds.
    // The transport is mocked, and the server must independently recognize the
    // deleted smoke fixture without relying on a caller-provided suppression flag.
    const checkSmokeUsage = () => checkAIUsage(CO);

    await cleanup();
    await pool.query(
      `INSERT INTO companies (id, company_name, subscription_plan, subscription_status, created_by, is_deleted, data)
       VALUES ($1, 'Smoke SCB Co', 'enterprise', 'active', 'delivered@resend.dev', true, '{}')
       ON CONFLICT (id) DO NOTHING`, [CO]);

    console.log('\n[ A. Below warn threshold — allowed ]');
    await insertUsage(CO, 'lexi', 100, 0.05); // $5
    let r = await checkSmokeUsage();
    ok('A1: $5 MTD → allowed', r.allowed === true, r);
    ok('A2: mtdSpend ≈ $5', Math.abs((r.mtdSpend ?? 0) - 5) < 0.01, r.mtdSpend);
    ok('A3: no warning notice yet', (await spendNotices(CO, 'warning')) === 0);

    console.log('\n[ B. Warn threshold ($150) — allowed + one warning notice ]');
    await insertUsage(CO, 'crew_cam', 1250, 0.12); // +$150 → $155
    r = await checkSmokeUsage();
    ok('B1: $155 MTD → still allowed', r.allowed === true, r);
    await new Promise(res => setTimeout(res, 1500)); // fire-and-forget email settles
    ok('B2: exactly one warning notice', (await spendNotices(CO, 'warning')) === 1);
    ok('B3: deleted smoke fixture made no email attempt', emailAttempts.length === 0, emailAttempts);
    await checkSmokeUsage();
    await new Promise(res => setTimeout(res, 1000));
    ok('B4: repeat call → still one warning notice', (await spendNotices(CO, 'warning')) === 1);
    ok('B5: no hard_stop notice yet', (await spendNotices(CO, 'hard_stop')) === 0);

    console.log('\n[ C. Hard cap ($200) — blocked with BYOK message ]');
    await insertUsage(CO, 'ai_estimator', 625, 0.08); // +$50 → $205
    r = await checkSmokeUsage();
    ok('C1: $205 MTD → allowed = false', r.allowed === false, r);
    ok('C2: message points to Settings → API Keys', /API Keys/i.test(r.error || ''), r.error);
    await new Promise(res => setTimeout(res, 1500));
    ok('C3: exactly one hard_stop notice', (await spendNotices(CO, 'hard_stop')) === 1);
    const { rows: notifs } = await pool.query(
      `SELECT id FROM generic_entities WHERE entity_type = 'Notification' AND data->>'related_entity_id' = $1`, [CO]);
    ok('C4: super-admin bell notification(s) written', notifs.length >= 1, notifs.length);
    ok('C5: hard-stop email explicitly recorded as suppressed',
      Boolean((await spendNoticeData(CO, 'hard_stop'))?.email_suppressed_at));
    ok('C6: hard stop made no smoke email attempt', emailAttempts.length === 0, emailAttempts);

    console.log('\n[ D. Idempotency under repeat blocking ]');
    r = await checkSmokeUsage();
    ok('D1: still blocked', r.allowed === false, r);
    await new Promise(res => setTimeout(res, 1000));
    ok('D2: still one hard_stop notice', (await spendNotices(CO, 'hard_stop')) === 1);

    console.log('\n[ E. BYOK-style ($0) usage never trips the breaker ]');
    await pool.query(`DELETE FROM generic_entities WHERE entity_type = 'SubscriptionUsage' AND company_id = $1`, [CO]);
    await pool.query(`DELETE FROM generic_entities WHERE id LIKE 'spendnotice_smoke_scb_%'`);
    await insertUsage(CO, 'ai_byok', 40000, 0); // huge volume, $0 cost
    r = await checkSmokeUsage();
    ok('E1: 40k $0 events → allowed', r.allowed === true, r);
    ok('E2: mtdSpend = 0', (r.mtdSpend ?? -1) === 0, r.mtdSpend);

    console.log('\n[ G. Non-AI spend (SMS/voice) never trips the AI breaker ]');
    await pool.query(`DELETE FROM generic_entities WHERE entity_type = 'SubscriptionUsage' AND company_id = $1`, [CO]);
    await pool.query(`DELETE FROM generic_entities WHERE id LIKE 'spendnotice_smoke_scb_%'`);
    await insertUsage(CO, 'sms_ai', 20000, 0.02); // $400 of SMS
    await insertUsage(CO, 'sarah', 3000, 0.10);   // $300 of voice
    await insertUsage(CO, 'lexi', 100, 0.05);     // $5 of actual AI
    r = await checkSmokeUsage();
    ok('G1: $700 SMS/voice + $5 AI → AI still allowed', r.allowed === true, r);
    ok('G2: mtdSpend counts AI only (≈$5)', Math.abs((r.mtdSpend ?? 0) - 5) < 0.01, r.mtdSpend);

    console.log('\n[ F. Interaction-count backstop still enforced ]');
    // 50,001 lexi units at $0 unit cost — spend stays $0 but count cap (50k) trips.
    await pool.query(`DELETE FROM generic_entities WHERE entity_type = 'SubscriptionUsage' AND company_id = $1`, [CO]);
    await insertUsage(CO, 'lexi', 50001, 0);
    r = await checkSmokeUsage();
    ok('F1: 50,001 interactions → blocked by count cap', r.allowed === false, r);
    ok('F2: count-cap message mentions interactions', /interactions/i.test(r.error || ''), r.error);

    console.log('\n[ H. Genuine company path — mocked transport receives real alerts ]');
    await pool.query(
      `INSERT INTO companies (id, company_name, subscription_plan, subscription_status, created_by, is_deleted, data)
       VALUES ($1, 'SCB Delivery Probe Co', 'enterprise', 'inactive', 'scb-probe@example.invalid', false, '{}')`,
      [DELIVERY_CO]
    );
    await insertUsage(DELIVERY_CO, 'lexi', 100, 0.05);
    await insertUsage(DELIVERY_CO, 'crew_cam', 1250, 0.12);
    r = await checkAIUsage(DELIVERY_CO);
    ok('H1: real-like company at $155 remains allowed', r.allowed === true, r);
    await new Promise(res => setTimeout(res, 1500));
    ok('H2: warning entered the real email path',
      emailAttempts.some(a => a.to === 'scb-probe@example.invalid' && /heaviest AI users/i.test(a.subject || '')),
      emailAttempts.map(a => a.subject));

    await insertUsage(DELIVERY_CO, 'ai_estimator', 625, 0.08);
    r = await checkAIUsage(DELIVERY_CO);
    ok('H3: real-like company at $205 is blocked', r.allowed === false, r);
    await new Promise(res => setTimeout(res, 1500));
    ok('H4: hard stop entered the real super-admin email path',
      emailAttempts.some(a => /Spend cap tripped: SCB Delivery Probe Co/i.test(a.subject || '')),
      emailAttempts.map(a => a.subject));
    ok('H5: successful hard-stop delivery was durably recorded',
      Boolean((await spendNoticeData(DELIVERY_CO, 'hard_stop'))?.email_sent_at));

    console.log('\n── Summary ──────────────────────────────');
    console.log(`   Passed: ${passed}   Failed: ${failed}`);
    if (failed > 0) process.exit(1);
    console.log('\n✓ All tests passed.');
  } catch (err) {
    console.error('\n✗ Unexpected error:', err.stack || err.message);
    process.exitCode = 1;
  } finally {
    if (restoreEmailSender) restoreEmailSender();
    try { await cleanup(); console.log('Fixtures cleaned up.'); } catch (e) { console.warn('Cleanup error:', e.message); }
    await pool.end();
  }
})();
