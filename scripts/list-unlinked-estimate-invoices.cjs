#!/usr/bin/env node
'use strict';

/**
 * List invoices that were created from an estimate but have a blank
 * customer_id, with the customer the estimate resolves to (id/base44_id,
 * then a unique email, then a unique exact name). Nothing is updated.
 *
 * Read-only. Dry-run is the default: it prints the SQL and does not connect.
 * --execute reads DATABASE_URL only when the host is localhost, 127.0.0.1, or
 * ::1. It never prints the connection string and never updates a row.
 * Linking any listed invoice is a separate, approved step.
 *
 *   node scripts/list-unlinked-estimate-invoices.cjs
 *   node scripts/list-unlinked-estimate-invoices.cjs --execute
 */

const {
  ESTIMATE_CUSTOMER_CANDIDATES_SQL,
  UNLINKED_ESTIMATE_INVOICES_SQL,
  candidateQueryParams,
  resolveEstimateInvoiceCustomer,
} = require('../lib/estimateInvoiceCustomer.cjs');
const { executeRefusal } = require('./list-invoice-customer-mismatches.cjs');

const WRITE_WORDS = /\b(update|delete|insert|alter|drop|truncate)\b/i;

function describeResolution(resolved) {
  if (resolved?.customer) {
    const c = resolved.customer;
    return `would link to ${c.name || ''} <${c.id}> via ${resolved.via}; not applied`;
  }
  return `no safe match (${resolved?.reason || 'no-match'}); not applied`;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const execute = argv.includes('--execute');
  if (!execute) {
    console.log('Invoices created from an estimate with a blank customer_id (read-only).');
    console.log('Proposed links are listed only. Nothing is updated.');
    console.log('No database connection was opened.');
    console.log('');
    console.log(UNLINKED_ESTIMATE_INVOICES_SQL);
    console.log('');
    console.log(ESTIMATE_CUSTOMER_CANDIDATES_SQL);
    console.log('');
    console.log('Pass --execute to run this against a local DATABASE_URL. Production hosts are refused.');
    return 0;
  }

  const refusal = executeRefusal(env.DATABASE_URL || '');
  if (refusal) {
    console.error(refusal);
    return 2;
  }
  if (WRITE_WORDS.test(UNLINKED_ESTIMATE_INVOICES_SQL) || WRITE_WORDS.test(ESTIMATE_CUSTOMER_CANDIDATES_SQL)) {
    console.error('Refusing to run: a diagnostic query is not read-only.');
    return 2;
  }

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const result = await pool.query(UNLINKED_ESTIMATE_INVOICES_SQL);
    for (const row of result.rows) {
      const estimate = {
        company_id: row.company_id,
        customer_id: row.estimate_customer_id,
        customer_name: row.estimate_customer_name || row.customer_name,
        customer_email: row.estimate_customer_email || row.customer_email,
      };
      let lead = null;
      if (row.estimate_lead_id) {
        const leadRes = await pool.query(
          'SELECT id, name, email FROM leads WHERE id = $1 AND company_id = $2 LIMIT 1',
          [row.estimate_lead_id, row.company_id]
        );
        lead = leadRes.rows[0] || null;
      }
      const candidates = await pool.query(ESTIMATE_CUSTOMER_CANDIDATES_SQL, candidateQueryParams({ estimate, lead }));
      const resolved = resolveEstimateInvoiceCustomer({ estimate, lead, customers: candidates.rows });
      console.log([
        row.invoice_number || '(no number)',
        row.id,
        `estimate=${row.estimate_number || row.estimate_id}`,
        `name=${row.customer_name || '(blank)'}`,
        describeResolution(resolved),
      ].join(' | '));
    }
    console.log(`${result.rowCount} unlinked invoice(s) created from an estimate. No rows were updated.`);
    return 0;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { describeResolution, main };
