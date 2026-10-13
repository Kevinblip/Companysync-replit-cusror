/**
 * scripts/test-lexi-financial-parity.cjs
 *
 * Guards the four copies of Lexi's get_financial_summary handler against silent
 * drift.
 *
 * The tool that answers "how much money came in this month" is duplicated across
 * the dev text path, the dev native voice path, the production server, and the
 * shared prod-integrations module. They had drifted before: two filtered payments
 * on created_at (the day somebody typed the row in) and two on payment_date (the
 * day the money arrived), and none excluded withheld-fee offsets. The assistant
 * returned a different cash figure depending on whether the user typed or spoke,
 * and the typed figure overstated one real month by ~19%. The failure is silent:
 * the number still looks plausible.
 *
 * This test reads the SOURCE of each copy (no database, no network) and asserts
 * every payments aggregate inside get_financial_summary:
 *   - filters on COALESCE(payment_date, created_at) for BOTH bounds
 *   - restricts status to received/paid/completed
 *   - excludes withheld-fee offsets, compared as text (never a ::boolean cast)
 *   - is scoped to one company
 * and that all four copies agree on those clauses, character for character.
 *
 * It also asserts the invoice aggregate deliberately stays on created_at and
 * keeps excluding cancelled/void — "invoices issued" is a different measure from
 * "cash received" and must not be quietly merged into it.
 *
 * See .agents/memory/cash-received-reporting-date.md for the full rule.
 *
 * Run: node scripts/test-lexi-financial-parity.cjs
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

/**
 * The four copies. `start` locates the get_financial_summary branch, `next`
 * locates the beginning of the following tool branch so the slice covers exactly
 * one handler.
 */
const COPIES = [
  {
    label: 'dev native voice path (vite-lexi-native-plugin.js)',
    file: 'vite-lexi-native-plugin.js',
    start: /else if \(name === 'get_financial_summary'\)/,
    next: /else if \(name === '/,
  },
  {
    label: 'dev text path (vite-functions-plugin.js)',
    file: 'vite-functions-plugin.js',
    start: /else if \(fname === 'get_financial_summary'\)/,
    next: /else if \(fname === '/,
  },
  {
    label: 'production native path (prod-server.cjs)',
    file: 'prod-server.cjs',
    start: /case 'get_financial_summary':/,
    next: /case '/,
  },
  {
    label: 'shared prod handler module (db/prod-integrations.cjs)',
    file: 'db/prod-integrations.cjs',
    start: /else if \(fname === 'get_financial_summary'\)/,
    next: /else if \(fname === '/,
  },
];

function readSource(file) {
  const full = path.join(ROOT, file);
  assert.ok(fs.existsSync(full), `${file} is missing — the financial-summary copy moved or was renamed`);
  return fs.readFileSync(full, 'utf8');
}

/** Extract the source text of one get_financial_summary handler. */
function handlerSlice(copy) {
  const source = readSource(copy.file);
  const startMatch = copy.start.exec(source);
  assert.ok(
    startMatch,
    `${copy.file}: could not find the get_financial_summary handler. If it was renamed or moved, update this test — do not delete the guard.`
  );
  const from = startMatch.index + startMatch[0].length;
  const rest = source.slice(from);
  const endMatch = copy.next.exec(rest);
  const slice = endMatch ? rest.slice(0, endMatch.index) : rest;
  assert.ok(slice.length > 200, `${copy.file}: the get_financial_summary handler slice looks truncated`);
  return slice;
}

/** All backtick template literals in a chunk of source that hit a given table. */
function sqlLiteralsFor(slice, table) {
  const out = [];
  const literal = /`([^`]*)`/g;
  let m;
  while ((m = literal.exec(slice)) !== null) {
    if (new RegExp(`FROM\\s+${table}\\b`, 'i').test(m[1])) out.push(m[1]);
  }
  return out;
}

/** Whitespace / cast noise removed so two copies can be compared clause by clause. */
function normalizeSql(sql) {
  return sql
    .replace(/::date\b/g, '')
    .replace(/::timestamptz\b/g, '')
    .replace(/::timestamp\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DATE_EXPR = /COALESCE\(payment_date,\s*created_at\)/g;
const STATUS_CLAUSE = /COALESCE\(status,\s*'received'\)\s*IN\s*\('received',\s*'paid',\s*'completed'\)/;
const WITHHELD_CLAUSE = /COALESCE\(data->>'is_withheld_offset'[^)]*\)\s*NOT IN\s*\([^)]*\)/;
const SUM_EXPR = /COALESCE\(SUM\((\w+)\),\s*0\)/;

/**
 * The single source of truth for "is this payments aggregate correct".
 * Returns a fingerprint of the money-defining clauses so copies can be compared.
 * Throws with a loud, specific message on any violation.
 */
function auditPaymentsAggregate(sql, where) {
  const n = normalizeSql(sql);

  const sum = SUM_EXPR.exec(n);
  assert.ok(sum, `${where}: payments aggregate does not sum with COALESCE(SUM(...),0)\n      ${n}`);
  assert.strictEqual(
    sum[1],
    'amount',
    `${where}: payments aggregate sums ${sum[1]}, expected the payments.amount column`
  );

  const dateHits = n.match(DATE_EXPR) || [];
  assert.strictEqual(
    dateHits.length,
    2,
    `${where}: cash must be bounded on COALESCE(payment_date, created_at) at BOTH ends ` +
      `(found ${dateHits.length}). Filtering on created_at alone reports the month a row was typed in, ` +
      `not the month the money arrived.\n      ${n}`
  );

  // Nothing else may compare a bare date column: a stray `created_at >= $2`
  // alongside the COALESCE bound reintroduces the exact bug this guards.
  const stripped = n.replace(DATE_EXPR, 'CASH_DATE');
  assert.ok(
    !/\b(created_at|payment_date)\s*(>=|<=|>|<|=|BETWEEN)/i.test(stripped),
    `${where}: payments aggregate compares a bare created_at/payment_date outside ` +
      `COALESCE(payment_date, created_at)\n      ${n}`
  );

  assert.ok(
    STATUS_CLAUSE.test(n),
    `${where}: payments aggregate must restrict status to ` +
      `COALESCE(status,'received') IN ('received','paid','completed')\n      ${n}`
  );

  const withheld = WITHHELD_CLAUSE.exec(n);
  assert.ok(
    withheld,
    `${where}: payments aggregate must exclude withheld-fee offsets ` +
      `(COALESCE(data->>'is_withheld_offset', ...) NOT IN ('true','t','1')). ` +
      `A withheld offset is a fee netted out — no cash was received.\n      ${n}`
  );
  assert.ok(
    /data->'data'->>'is_withheld_offset'/.test(withheld[0]),
    `${where}: the withheld-offset exclusion must also cover the nested ` +
      `data->'data'->>'is_withheld_offset' form\n      ${withheld[0]}`
  );
  assert.ok(
    /NOT IN\s*\('true',\s*'t',\s*'1'\)/.test(withheld[0]),
    `${where}: compare the withheld flag as text NOT IN ('true','t','1')\n      ${withheld[0]}`
  );
  assert.ok(
    !/is_withheld_offset'\s*\)?\s*::\s*bool/i.test(n),
    `${where}: never cast is_withheld_offset to boolean — one stray non-boolean value ` +
      `makes the cast throw and kills the whole summary\n      ${n}`
  );

  assert.ok(
    /company_id\s*=\s*\$1/.test(n),
    `${where}: payments aggregate is not scoped to a single company\n      ${n}`
  );

  return [
    `SUM:${sum[1]}`,
    'DATE:COALESCE(payment_date, created_at)',
    `STATUS:${STATUS_CLAUSE.exec(n)[0].replace(/\s+/g, ' ')}`,
    `WITHHELD:${withheld[0].replace(/\s+/g, ' ')}`,
  ].join(' | ');
}

/** "Invoices issued" is intentionally a different measure — keep it that way. */
function auditInvoiceAggregate(sql, where) {
  const n = normalizeSql(sql);

  assert.ok(
    /COALESCE\(SUM\(total_amount\),\s*0\)/.test(n),
    `${where}: invoice aggregate must sum the live total_amount column\n      ${n}`
  );
  assert.ok(
    !/payment_date/.test(n),
    `${where}: the invoice aggregate must NOT move to payment_date — "invoices issued" ` +
      `measures when an invoice was raised, not when cash arrived\n      ${n}`
  );
  assert.ok(
    /created_at\s*(>=|>)/.test(n) && /created_at\s*(<=|<)/.test(n),
    `${where}: invoice aggregate must stay bounded on created_at at both ends\n      ${n}`
  );
  assert.ok(
    /COALESCE\(status,\s*''\)\s*NOT IN\s*\('cancelled',\s*'void'\)/.test(n),
    `${where}: invoice aggregate must keep excluding cancelled/void invoices\n      ${n}`
  );
  assert.ok(
    /company_id\s*=\s*\$1/.test(n),
    `${where}: invoice aggregate is not scoped to a single company\n      ${n}`
  );
}

console.log('\n1. All four financial-summary copies are present and locatable');

const slices = new Map();
for (const copy of COPIES) {
  check(`${copy.label} exposes a get_financial_summary handler`, () => {
    slices.set(copy.file, handlerSlice(copy));
  });
}

console.log('\n2. Every payments aggregate reports cash by the day the money arrived');

const fingerprints = new Map();
for (const copy of COPIES) {
  check(`${copy.label} filters cash on payment_date, received status, no withheld offsets`, () => {
    const slice = slices.get(copy.file);
    assert.ok(slice, `${copy.file}: handler slice unavailable (see section 1)`);
    const literals = sqlLiteralsFor(slice, 'payments');
    assert.ok(
      literals.length >= 1,
      `${copy.file}: get_financial_summary has no payments aggregate at all — cash_received cannot be real`
    );
    const seen = literals.map((sql, i) =>
      auditPaymentsAggregate(sql, `${copy.file} payments query #${i + 1}`)
    );
    // Multiple payments queries inside one handler must agree with each other too.
    for (const fp of seen) {
      assert.strictEqual(fp, seen[0], `${copy.file}: two payments aggregates in one handler disagree`);
    }
    fingerprints.set(copy.file, seen[0]);
  });
}

console.log('\n3. The four copies agree, so typing and speaking return the same number');

check('every copy uses identical cash-defining clauses', () => {
  assert.strictEqual(
    fingerprints.size,
    COPIES.length,
    'not every copy produced a fingerprint — an earlier check failed'
  );
  const entries = [...fingerprints.entries()];
  const [refFile, reference] = entries[0];
  for (const [file, fp] of entries.slice(1)) {
    assert.strictEqual(
      fp,
      reference,
      `financial-summary copies have DRIFTED — the assistant will return a different cash figure ` +
        `depending on the path taken.\n      ${refFile}: ${reference}\n      ${file}: ${fp}`
    );
  }
});

console.log('\n4. "Invoices issued" stays a separate measure from "cash received"');

for (const copy of COPIES) {
  check(`${copy.label} keeps the invoice total on created_at, excluding cancelled/void`, () => {
    const slice = slices.get(copy.file);
    assert.ok(slice, `${copy.file}: handler slice unavailable (see section 1)`);
    const literals = sqlLiteralsFor(slice, 'invoices');
    assert.ok(
      literals.length >= 1,
      `${copy.file}: get_financial_summary has no invoice aggregate`
    );
    literals.forEach((sql, i) => auditInvoiceAggregate(sql, `${copy.file} invoice query #${i + 1}`));
  });
}

console.log('\n5. The generic CRM invoice total is a real full-table aggregate');

check('every get_crm_data invoice total sums total_amount over the whole table', () => {
  const pattern = /const invTotalRes = await (?:pool|db)\.query\(`([^`]+)`/g;
  let found = 0;
  for (const copy of COPIES) {
    const source = readSource(copy.file);
    let m;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(source)) !== null) {
      found += 1;
      const n = normalizeSql(m[1]);
      const where = `${copy.file} crm invoice total`;
      assert.ok(
        /COALESCE\(SUM\(total_amount\),\s*0\)/.test(n),
        `${where}: must sum the live total_amount column, not the frozen legacy amount field\n      ${n}`
      );
      assert.ok(
        !/\bLIMIT\b/i.test(n),
        `${where}: a total returned next to a truncated sample must aggregate the FULL table\n      ${n}`
      );
      assert.ok(
        /COALESCE\(status,\s*''\)\s*NOT IN\s*\('cancelled',\s*'void'\)/.test(n),
        `${where}: must keep excluding cancelled/void invoices\n      ${n}`
      );
      assert.ok(
        /company_id\s*=\s*\$1/.test(n),
        `${where}: is not scoped to a single company\n      ${n}`
      );
    }
  }
  assert.ok(found >= 3, `expected the get_crm_data invoice total in at least 3 copies, found ${found}`);
});

console.log('\n6. The guard itself fails loudly on each way a copy can drift');

const GOOD_PAYMENTS_SQL =
  "SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM payments WHERE company_id=$1 " +
  "AND COALESCE(payment_date, created_at) >= $2::date AND COALESCE(payment_date, created_at) < $3::date " +
  "AND COALESCE(status,'received') IN ('received','paid','completed') " +
  "AND COALESCE(data->>'is_withheld_offset', data->'data'->>'is_withheld_offset', 'false') NOT IN ('true','t','1')";

check('the known-good shape passes', () => {
  auditPaymentsAggregate(GOOD_PAYMENTS_SQL, 'fixture');
});

const DRIFTS = [
  {
    name: 'reverting one bound to created_at',
    sql: GOOD_PAYMENTS_SQL.replace('COALESCE(payment_date, created_at) >= $2::date', 'created_at >= $2::date'),
    expect: /BOTH ends/,
  },
  {
    name: 'reverting both bounds to created_at',
    sql: GOOD_PAYMENTS_SQL.replace(/COALESCE\(payment_date, created_at\)/g, 'created_at'),
    expect: /BOTH ends/,
  },
  {
    name: 'dropping the received/paid/completed status filter',
    sql: GOOD_PAYMENTS_SQL.replace(
      "AND COALESCE(status,'received') IN ('received','paid','completed') ",
      ''
    ),
    expect: /restrict status/,
  },
  {
    name: 'widening the status filter to include refunded',
    sql: GOOD_PAYMENTS_SQL.replace("'received','paid','completed'", "'received','paid','completed','refunded'"),
    expect: /restrict status/,
  },
  {
    name: 'dropping the withheld-offset exclusion',
    sql: GOOD_PAYMENTS_SQL.replace(
      " AND COALESCE(data->>'is_withheld_offset', data->'data'->>'is_withheld_offset', 'false') NOT IN ('true','t','1')",
      ''
    ),
    expect: /withheld-fee offsets/,
  },
  {
    name: 'losing the nested withheld-offset form',
    sql: GOOD_PAYMENTS_SQL.replace(", data->'data'->>'is_withheld_offset'", ''),
    expect: /nested/,
  },
  {
    name: 'casting the withheld flag to boolean',
    sql: GOOD_PAYMENTS_SQL.replace(
      "COALESCE(data->>'is_withheld_offset', data->'data'->>'is_withheld_offset', 'false') NOT IN ('true','t','1')",
      "COALESCE((data->>'is_withheld_offset')::boolean, false) IS NOT TRUE"
    ),
    expect: /withheld-fee offsets|boolean/,
  },
  {
    name: 'summing the wrong column',
    sql: GOOD_PAYMENTS_SQL.replace('COALESCE(SUM(amount),0)', 'COALESCE(SUM(total_amount),0)'),
    expect: /payments\.amount/,
  },
  {
    name: 'dropping company scoping',
    sql: GOOD_PAYMENTS_SQL.replace('company_id=$1 AND ', ''),
    expect: /single company/,
  },
];

for (const drift of DRIFTS) {
  check(`rejects: ${drift.name}`, () => {
    assert.throws(
      () => auditPaymentsAggregate(drift.sql, 'fixture'),
      drift.expect,
      `the guard did not catch: ${drift.name}`
    );
  });
}

check('rejects an invoice aggregate quietly switched to payment_date', () => {
  const goodInvoice =
    "SELECT status, COUNT(*) as count, COALESCE(SUM(total_amount),0) as total FROM invoices " +
    "WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date " +
    "AND COALESCE(status,'') NOT IN ('cancelled','void') GROUP BY status ORDER BY total DESC";
  auditInvoiceAggregate(goodInvoice, 'fixture');
  assert.throws(
    () => auditInvoiceAggregate(goodInvoice.replace(/created_at/g, 'payment_date'), 'fixture'),
    /must NOT move to payment_date/
  );
  assert.throws(
    () =>
      auditInvoiceAggregate(
        goodInvoice.replace("AND COALESCE(status,'') NOT IN ('cancelled','void') ", ''),
        'fixture'
      ),
    /cancelled\/void/
  );
});

check('reports a missing copy instead of silently passing', () => {
  assert.throws(
    () => handlerSlice({ file: 'prod-server.cjs', start: /case 'get_totally_missing_tool':/, next: /case '/ }),
    /could not find the get_financial_summary handler/
  );
});

console.log(`\n${passed} checks passed.`);
if (process.exitCode) {
  console.error('FAILED — Lexi\'s money answers can drift apart. See .agents/memory/cash-received-reporting-date.md');
} else {
  console.log('PASSED');
}
