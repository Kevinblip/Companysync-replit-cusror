#!/usr/bin/env node
'use strict';

/**
 * List invoices whose customer_id is missing or does not match a customer
 * in the same company, and propose an exact-name match when there is exactly one.
 *
 * Read-only. Dry-run is the default: it prints the SQL and does not connect.
 * --execute reads DATABASE_URL only when the host is localhost, 127.0.0.1, or
 * ::1. It never prints the connection string and never updates a row.
 *
 *   node scripts/list-invoice-customer-mismatches.cjs
 *   node scripts/list-invoice-customer-mismatches.cjs --execute
 */

const { INVOICE_CUSTOMER_MISMATCH_SQL } = require('../lib/invoiceCustomerMatch.cjs');

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

function describeProposal(row) {
  const count = Number(row.proposal_count) || 0;
  if (count === 1 && row.proposal_customer_id) {
    return `exact-name match ${row.proposal_customer_name || ''} <${row.proposal_customer_id}>${row.proposal_customer_email ? ` ${row.proposal_customer_email}` : ''}`;
  }
  if (count > 1) return `ambiguous — ${count} customers share this name; not applied`;
  return 'no exact-name match; not applied';
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const execute = argv.includes('--execute');
  if (!execute) {
    console.log('Invoices with a missing or mismatched customer_id (read-only).');
    console.log('Exact-name proposals are listed only. Nothing is updated.');
    console.log('No database connection was opened.');
    console.log('');
    console.log(INVOICE_CUSTOMER_MISMATCH_SQL);
    console.log('');
    console.log('Pass --execute to run this against a local DATABASE_URL. Production hosts are refused.');
    return 0;
  }

  const refusal = executeRefusal(env.DATABASE_URL || '');
  if (refusal) {
    console.error(refusal);
    return 2;
  }

  if (/\b(update|delete|insert|alter|drop)\b/i.test(INVOICE_CUSTOMER_MISMATCH_SQL)) {
    console.error('Refusing to run: the mismatch query is not read-only.');
    return 2;
  }

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const result = await pool.query(INVOICE_CUSTOMER_MISMATCH_SQL);
    for (const row of result.rows) {
      console.log([
        row.problem,
        row.invoice_number || '(no number)',
        row.id,
        `customer_id=${row.customer_id || '(blank)'}`,
        `name=${row.customer_name || '(blank)'}`,
        describeProposal(row),
      ].join(' | '));
    }
    console.log(`${result.rowCount} invoice(s) with a missing or mismatched customer. No rows were updated.`);
    return 0;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  INVOICE_CUSTOMER_MISMATCH_SQL,
  describeProposal,
  executeRefusal,
  main,
};
