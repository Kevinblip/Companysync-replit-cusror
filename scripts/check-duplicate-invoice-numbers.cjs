#!/usr/bin/env node
'use strict';

/**
 * List duplicate invoice numbers per company.
 *
 * Read-only. By default this prints the SQL and does not connect to anything.
 * It refuses to run against a non-local database so it cannot be pointed at
 * the live YICN / CompanySync production tenant by accident.
 *
 *   node scripts/check-duplicate-invoice-numbers.cjs
 *   node scripts/check-duplicate-invoice-numbers.cjs --execute
 *
 * --execute reads DATABASE_URL and only connects when the host is localhost
 * or 127.0.0.1. The URL is never printed.
 */

const DUPLICATE_INVOICE_NUMBER_SQL = `
SELECT company_id,
       btrim(invoice_number) AS invoice_number,
       COUNT(*)::int AS copies,
       array_agg(id ORDER BY created_at NULLS LAST, id) AS invoice_ids,
       array_agg(customer_name ORDER BY created_at NULLS LAST, id) AS customer_names,
       array_agg(total_amount ORDER BY created_at NULLS LAST, id) AS totals
  FROM invoices
 WHERE invoice_number IS NOT NULL
   AND btrim(invoice_number) <> ''
 GROUP BY company_id, btrim(invoice_number)
HAVING COUNT(*) > 1
 ORDER BY company_id, btrim(invoice_number);
`.trim();

function databaseHost(connectionString) {
  try {
    const url = new URL(connectionString);
    return (url.hostname || '').toLowerCase();
  } catch {
    return '';
  }
}

function localHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function executeRefusal(connectionString) {
  if (!connectionString) return 'DATABASE_URL is not set. Not connecting.';
  const host = databaseHost(connectionString);
  if (!host) return 'DATABASE_URL is not a usable URL. Not connecting.';
  if (!localHost(host)) {
    return `Refusing to connect to host "${host}". This check runs only against localhost. Not connecting.`;
  }
  return null;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const execute = argv.includes('--execute');
  if (!execute) {
    console.log('Duplicate invoice numbers per company (read-only).');
    console.log('No database connection was opened.');
    console.log('');
    console.log(DUPLICATE_INVOICE_NUMBER_SQL);
    console.log('');
    console.log('Pass --execute to run this against a local DATABASE_URL. Production hosts are refused.');
    return 0;
  }

  const refusal = executeRefusal(env.DATABASE_URL || '');
  if (refusal) {
    console.error(refusal);
    return 2;
  }

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const result = await pool.query(DUPLICATE_INVOICE_NUMBER_SQL);
    console.log(JSON.stringify(result.rows, null, 2));
    console.log(`${result.rowCount} duplicate invoice-number group(s).`);
    return result.rowCount > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DUPLICATE_INVOICE_NUMBER_SQL,
  executeRefusal,
  main,
};
