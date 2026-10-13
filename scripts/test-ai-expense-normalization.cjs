'use strict';

// Regression coverage for AI-created Expense rows.
//
// The running server exposes one text implementation at a time (dev or prod),
// while the local native-voice tool handler is also directly importable. The
// remaining production/Base44 copies cannot all be booted in the same process,
// so this script also verifies that every one of the six manage_entity handlers
// keeps the canonical Expense mapping and shared normalizer wired into creates.
//
// Usage:
//   node scripts/test-ai-expense-normalization.cjs
//   TEST_BASE_URL=https://... node scripts/test-ai-expense-normalization.cjs

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createPool } = require('./lib/db-pool.cjs');
const {
  isExpenseEntity,
  normalizeGenericEntityData,
} = require('../lib/expenseNormalize.cjs');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
const CONTRACTS_ONLY = process.argv.includes('--contracts-only');
const TEST_DATE = '2026-08-31';
const TEST_AMOUNT = 12.34;

function signSessionId(sid, secret) {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `s:${sid}.${signature}`;
}

function assertHandlerWiring() {
  const handlers = [
    {
      label: 'development text',
      file: 'vite-functions-plugin.js',
      canonical: /['"]expense['"]\s*:\s*['"]Expense['"][\s\S]{0,120}['"]expenses['"]\s*:\s*['"]Expense['"]/,
      create: /normalizeGenericEntityData\(entity_name,\s*\{[\s\S]{0,250}?entity_data[\s\S]{0,250}?\},\s*\{\s*applyDefaults:\s*true\s*\}\)/,
    },
    {
      label: 'development native voice',
      file: 'vite-lexi-native-plugin.js',
      canonical: /['"]expense['"]\s*:\s*['"]Expense['"][\s\S]{0,80}['"]expenses['"]\s*:\s*['"]Expense['"]/,
      create: /normalizeGenericEntityData\(entityName,\s*\{[\s\S]{0,200}?entityData[\s\S]{0,200}?\},\s*\{\s*applyDefaults:\s*true\s*\}\)/,
    },
    {
      label: 'production text',
      file: 'db/prod-integrations.cjs',
      canonical: /['"]expense['"]\s*:\s*['"]Expense['"][\s\S]{0,80}['"]expenses['"]\s*:\s*['"]Expense['"]/,
      create: /normalizeGenericEntityData\(entity_name,\s*\{[\s\S]{0,250}?entity_data[\s\S]{0,250}?\},\s*\{\s*applyDefaults:\s*true\s*\}\)/,
    },
    {
      label: 'production native voice',
      file: 'prod-server.cjs',
      canonical: /isExpenseEntity\(entityType\)\)\s*entityType\s*=\s*['"]Expense['"]/,
      create: /normalizeGenericEntityData\(entityType,\s*\{[\s\S]{0,200}?entity_data[\s\S]{0,200}?\},\s*\{\s*applyDefaults:\s*true\s*\}\)/,
    },
    {
      label: 'Base44 text function',
      file: 'functions/lexiChat.ts',
      canonical: /isExpenseEntity\(normalizedEntity\)\)\s*normalizedEntity\s*=\s*['"]Expense['"]/,
      create: /normalizeGenericEntityData\(normalizedEntity,\s*\{[\s\S]{0,220}?data[\s\S]{0,220}?\},\s*\{\s*applyDefaults:\s*true\s*\}\)/,
    },
    {
      label: 'Base44 voice bridge function',
      file: 'functions/lexiBridgeAPI.ts',
      canonical: /isExpenseEntity\(normalizedEntity\)\)\s*normalizedEntity\s*=\s*['"]Expense['"]/,
      create: /normalizeGenericEntityData\(normalizedEntity,\s*\{[\s\S]{0,220}?entity_data[\s\S]{0,220}?\},\s*\{\s*applyDefaults:\s*true\s*\}\)/,
    },
  ];

  for (const handler of handlers) {
    const source = fs.readFileSync(path.join(ROOT, handler.file), 'utf8');
    assert.match(source, handler.canonical, `${handler.label} must canonicalize expense/expenses to Expense`);
    assert.match(source, handler.create, `${handler.label} creates must apply Expense defaults through the shared normalizer`);
    console.log(`PASS - ${handler.label} keeps Expense create normalization wired`);
  }

  const tsNormalizer = fs.readFileSync(path.join(ROOT, 'functions/utils/expenseNormalize.ts'), 'utf8');
  for (const token of [
    "['vendor_name', ['vendor', 'merchant', 'payee', 'supplier', 'store']]",
    "['expense_date', ['date', 'purchase_date', 'transaction_date']]",
    "out.category = 'other'",
  ]) {
    assert.ok(tsNormalizer.includes(token), `TypeScript normalizer is missing parity token: ${token}`);
  }
}

function assertNormalizedRow(row, expectedVendor, label) {
  assert.ok(row, `${label}: no generic_entities row was stored`);
  assert.equal(row.entity_type, 'Expense', `${label}: lowercase alias must store as entity_type='Expense'`);
  assert.equal(row.data.vendor_name, expectedVendor, `${label}: vendor must become vendor_name`);
  assert.equal(row.data.expense_date, TEST_DATE, `${label}: date must become YYYY-MM-DD expense_date`);
  assert.equal(typeof row.data.amount, 'number', `${label}: amount must be stored as a JSON number`);
  assert.equal(row.data.amount, TEST_AMOUNT, `${label}: amount must equal ${TEST_AMOUNT}`);
  assert.equal(typeof row.data.category, 'string', `${label}: category must be a string`);
  assert.ok(row.data.category.trim(), `${label}: category must not be blank`);
  assert.equal(row.data.vendor, undefined, `${label}: vendor alias must not remain`);
  assert.equal(row.data.date, undefined, `${label}: date alias must not remain`);
}

async function findExpense(pool, companyId, vendor) {
  const result = await pool.query(
    `SELECT id, entity_type, company_id, data
       FROM generic_entities
      WHERE company_id = $1
        AND data->>'vendor_name' = $2
      ORDER BY created_date DESC
      LIMIT 1`,
    [companyId, vendor],
  );
  return result.rows[0] || null;
}

async function invokeTextCreate(cookie, companyId, entityName, vendor) {
  const response = await fetch(`${BASE_URL}/api/functions/invoke`, {
    method: 'POST',
    signal: AbortSignal.timeout(90_000),
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      functionName: 'lexiChat',
      params: {
        companyId,
        userEmail: 'forged-body-identity@example.invalid',
        userName: 'Expense Regression Test',
        conversationHistory: [],
        message:
          `Call manage_entity now with action "create", entity_name "${entityName}", and data exactly ` +
          `{"vendor":"${vendor}","date":"${TEST_DATE}T14:30:00Z","amount":"$12.34"}. ` +
          'Do not ask a question and do not use any other tool.',
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `text ${entityName}: HTTP ${response.status}: ${JSON.stringify(body)}`);
  const actions = body?.data?.actions_executed || body?.actions_executed || [];
  assert.ok(
    actions.some((action) => action?.tool_name === 'manage_entity' || action?.tool_name === 'create_entity'),
    `text ${entityName}: manage_entity was not executed: ${JSON.stringify(body).slice(0, 1000)}`,
  );
}

async function main() {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  assert.ok(process.env.SESSION_SECRET, 'SESSION_SECRET is required');

  assertHandlerWiring();
  assert.equal(isExpenseEntity('expense'), true);
  assert.equal(isExpenseEntity('expenses'), true);
  for (const alias of ['expense', 'expenses']) {
    const normalized = normalizeGenericEntityData(
      alias,
      { vendor: 'Normalizer Contract', date: `${TEST_DATE}T14:30:00Z`, amount: '$12.34' },
      { applyDefaults: true },
    );
    assertNormalizedRow({ entity_type: 'Expense', data: normalized }, 'Normalizer Contract', `shared helper (${alias})`);
  }
  console.log('PASS - CommonJS normalizer handles expense and expenses aliases');
  if (CONTRACTS_ONLY) {
    console.log('ALL AI EXPENSE NORMALIZATION CONTRACT CHECKS PASSED');
    return;
  }

  const pool = createPool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 60_000,
  });
  const runId = crypto.randomBytes(6).toString('hex');
  const markerPrefix = `expense_regression_${runId}_`;
  const sessionId = `expense_test_${crypto.randomBytes(12).toString('hex')}`;
  let sessionInserted = false;

  try {
    let companyId = process.env.TEST_COMPANY_ID;
    let email = process.env.TEST_USER_EMAIL;
    if (!companyId || !email) {
      const identity = await pool.query(
        `SELECT c.id AS company_id, c.created_by AS email
           FROM companies c
          WHERE NULLIF(BTRIM(c.created_by), '') IS NOT NULL
          ORDER BY (c.subscription_status = 'active') DESC, c.created_at ASC NULLS LAST
          LIMIT 1`,
      );
      assert.ok(identity.rows[0], 'No company owner is available for the authenticated regression test');
      companyId ||= identity.rows[0].company_id;
      email ||= identity.rows[0].email;
    }

    const expires = new Date(Date.now() + 60 * 60 * 1000);
    const session = {
      cookie: {
        originalMaxAge: 60 * 60 * 1000,
        expires: expires.toISOString(),
        httpOnly: true,
        path: '/',
      },
      passport: {
        user: {
          claims: { sub: `expense-test-${runId}`, email, full_name: 'Expense Regression Test' },
          expires_at: Math.floor(expires.getTime() / 1000),
        },
      },
    };
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3)`,
      [sessionId, JSON.stringify(session), expires],
    );
    sessionInserted = true;
    const cookie = `connect.sid=${encodeURIComponent(signSessionId(sessionId, process.env.SESSION_SECRET))}`;

    const nativeModule = await import(
      `${pathToFileURL(path.join(ROOT, 'vite-lexi-native-plugin.js')).href}?expense-test=${runId}`,
    );
    assert.equal(typeof nativeModule.handleLocalToolCall, 'function', 'Native voice manage_entity handler is not importable');

    for (const entityName of ['expense', 'expenses']) {
      const vendor = `${markerPrefix}voice_${entityName}`;
      const result = await nativeModule.handleLocalToolCall(
        'manage_entity',
        {
          entity_action: 'create',
          entity_name: entityName,
          entity_data: { vendor, date: `${TEST_DATE}T14:30:00Z`, amount: '$12.34' },
        },
        companyId,
        email,
        'America/New_York',
      );
      assert.equal(result?.success, true, `native voice ${entityName}: ${JSON.stringify(result)}`);
      const row = await findExpense(pool, companyId, vendor);
      assertNormalizedRow(row, vendor, `native voice (${entityName})`);
      console.log(`PASS - native voice stores canonical Expense for "${entityName}"`);
    }

    for (const entityName of ['expense', 'expenses']) {
      const vendor = `${markerPrefix}text_${entityName}`;
      await invokeTextCreate(cookie, companyId, entityName, vendor);
      const row = await findExpense(pool, companyId, vendor);
      assertNormalizedRow(row, vendor, `authenticated text (${entityName})`);
      console.log(`PASS - authenticated text stores canonical Expense for "${entityName}"`);
    }
  } finally {
    await pool.query(
      `DELETE FROM generic_entities WHERE data->>'vendor_name' LIKE $1`,
      [`${markerPrefix}%`],
    ).catch(() => {});
    if (sessionInserted) {
      await pool.query('DELETE FROM sessions WHERE sid = $1', [sessionId]).catch(() => {});
    }
    await pool.end();
  }

  console.log('ALL AI EXPENSE NORMALIZATION TESTS PASSED');
}

main().catch((error) => {
  console.error('AI expense normalization regression failed:', error);
  process.exit(1);
});