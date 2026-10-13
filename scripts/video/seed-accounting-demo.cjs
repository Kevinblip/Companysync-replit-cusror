#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { createPool } = require('../lib/db-pool.cjs');

const COMPANY_ID = 'loc_demo_video_001';
const now = new Date();
const id = (name) => `video-accounting-${name}`;

const chartAccounts = [
  { id: id('coa-cash'), account_number: '1000', account_name: 'Business Checking', account_type: 'asset', account_subtype: 'current_assets', balance: 28450, is_active: true, description: 'Primary operating account' },
  { id: id('coa-ar'), account_number: '1100', account_name: 'Accounts Receivable', account_type: 'asset', account_subtype: 'current_assets', balance: 12750, is_active: true, description: 'Open customer balances' },
  { id: id('coa-ap'), account_number: '2000', account_name: 'Accounts Payable', account_type: 'liability', account_subtype: 'current_liabilities', balance: 4860, is_active: true, description: 'Open vendor and subcontractor bills' },
  { id: id('coa-revenue'), account_number: '4000', account_name: 'Roofing Revenue', account_type: 'revenue', account_subtype: 'sales', balance: 42600, is_active: true, description: 'Completed roofing work' },
  { id: id('coa-materials'), account_number: '5100', account_name: 'Materials & Supplies', account_type: 'expense', account_subtype: 'cost_of_goods_sold', balance: 9340, is_active: true, description: 'Shingles, flashing, and job materials' },
  { id: id('coa-office'), account_number: '6200', account_name: 'Office & Software', account_type: 'expense', account_subtype: 'operating_expenses', balance: 1180, is_active: true, description: 'Recurring office expenses' },
];

const expenses = [
  { id: id('expense-1'), vendor_name: 'Summit Ridge Supply', invoice_number: 'SRS-4821', amount: 2380, expense_date: '2026-09-04', category: 'materials', description: 'Architectural shingles and underlayment', payment_method: 'pending', status: 'unpaid', due_date: '2026-09-19', tags: ['vendor'], tax_deductible: true },
  { id: id('expense-2'), vendor_name: 'Northline Hauling', invoice_number: 'NL-771', amount: 860, expense_date: '2026-09-06', category: 'Subcontractor Payment', description: 'Dumpster and haul-away', payment_method: 'pending', status: 'unpaid', due_date: '2026-09-21', tags: ['subcontract'], tax_deductible: true },
  { id: id('expense-3'), vendor_name: 'FieldFlow Software', invoice_number: 'FF-2026-09', amount: 149, expense_date: '2026-09-08', category: 'software', description: 'Monthly field operations subscription', payment_method: 'card', status: 'paid', tags: [], tax_deductible: true },
  { id: id('expense-4'), vendor_name: 'Evergreen Insurance', invoice_number: 'EI-904', amount: 412, expense_date: '2026-09-10', category: 'insurance', description: 'Commercial auto coverage', payment_method: 'ach', status: 'paid', tags: [], tax_deductible: true },
  { id: id('expense-5'), vendor_name: 'Metro Print & Mail', invoice_number: 'MP-118', amount: 275, expense_date: '2026-09-11', category: 'marketing', description: 'Door hangers and proposal folders', payment_method: 'card', status: 'paid', tags: [], tax_deductible: true },
];

const transactions = [
  { id: id('transaction-1'), transaction_date: '2026-09-04', transaction_type: 'expense', description: 'Summit Ridge Supply — materials', debit_account_id: id('coa-materials'), debit_account_name: 'Materials & Supplies', debit_amount: 2380, credit_account_id: id('coa-cash'), credit_account_name: 'Business Checking', credit_amount: 2380, reconciled: false, reference_number: 'SRS-4821' },
  { id: id('transaction-2'), transaction_date: '2026-09-06', transaction_type: 'expense', description: 'Northline Hauling — dumpster', debit_account_id: id('coa-materials'), debit_account_name: 'Materials & Supplies', debit_amount: 860, credit_account_id: id('coa-ap'), credit_account_name: 'Accounts Payable', credit_amount: 860, reconciled: false, reference_number: 'NL-771' },
  { id: id('transaction-3'), transaction_date: '2026-09-08', transaction_type: 'expense', description: 'FieldFlow Software — September', debit_account_id: id('coa-office'), debit_account_name: 'Office & Software', debit_amount: 149, credit_account_id: id('coa-cash'), credit_account_name: 'Business Checking', credit_amount: 149, reconciled: true, reference_number: 'FF-2026-09' },
  { id: id('transaction-4'), transaction_date: '2026-09-11', transaction_type: 'journal_entry', description: 'Record monthly software expense', debit_account_id: id('coa-office'), debit_account_name: 'Office & Software', debit_amount: 275, credit_account_id: id('coa-ap'), credit_account_name: 'Accounts Payable', credit_amount: 275, reconciled: false, reference_number: 'JE-1007' },
];

const bankAccount = {
  id: id('bank-checking'),
  account_name: 'Business Checking',
  bank_name: 'Pioneer Community Bank',
  account_type: 'checking',
  last4: '4826',
  chart_account_id: id('coa-cash'),
  opening_balance: 30000,
  current_balance: 28450,
  last_reconciled_balance: 30189,
  last_reconciled_date: '2026-08-31',
  is_active: true,
};

async function insertEntity(pool, entityType, entityId, data, createdDate = now) {
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, $2, $3, $4::jsonb, $5, $5)`,
    [entityId, entityType, COMPANY_ID, JSON.stringify({ ...data, company_id: COMPANY_ID, created_by: 'demo@summitpeakroofing.com' }), createdDate],
  );
}

async function main() {
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `DELETE FROM generic_entities
       WHERE company_id = $1
         AND entity_type IN ('ChartOfAccounts', 'BankAccount', 'Transaction', 'Expense')`,
      [COMPANY_ID],
    );

    for (const account of chartAccounts) await insertEntity(pool, 'ChartOfAccounts', account.id, account);
    await insertEntity(pool, 'BankAccount', bankAccount.id, bankAccount);
    for (const expense of expenses) await insertEntity(pool, 'Expense', expense.id, expense);
    for (const transaction of transactions) await insertEntity(pool, 'Transaction', transaction.id, transaction);

    console.log(`Seeded ${chartAccounts.length} accounts, ${expenses.length} expenses, ${transactions.length} transactions for the demo tenant.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Accounting demo seed failed:', error.message);
  process.exit(1);
});