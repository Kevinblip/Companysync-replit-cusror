/**
 * Export company data from local dev DB to JSON for production migration.
 * Run: node scripts/export-for-prod.cjs
 * Output: scripts/prod-migration-data.json
 */
'use strict';
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const COMPANIES_TO_MIGRATE = [
  'companysync_master_001',   // CompanySync (platform admin)
  'loc_mmdvp1h5_e8i9eb',     // YICN Roofing (real data)
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 30000 });
  const placeholders = COMPANIES_TO_MIGRATE.map((_, i) => `$${i + 1}`).join(',');

  console.log('Exporting data for companies:', COMPANIES_TO_MIGRATE);
  const data = {};

  // companies
  const companiesRes = await pool.query(
    `SELECT * FROM companies WHERE id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.companies = companiesRes.rows;
  console.log(`  companies: ${data.companies.length}`);

  // users (associated by company_id)
  const usersRes = await pool.query(
    `SELECT * FROM users WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.users = usersRes.rows;
  console.log(`  users: ${data.users.length}`);

  // staff_profiles
  const staffRes = await pool.query(
    `SELECT * FROM staff_profiles WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.staff_profiles = staffRes.rows;
  console.log(`  staff_profiles: ${data.staff_profiles.length}`);

  // inspector_profiles
  const inspectorRes = await pool.query(
    `SELECT * FROM inspector_profiles WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.inspector_profiles = inspectorRes.rows;
  console.log(`  inspector_profiles: ${data.inspector_profiles.length}`);

  // customers
  const customersRes = await pool.query(
    `SELECT * FROM customers WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.customers = customersRes.rows;
  console.log(`  customers: ${data.customers.length}`);

  // leads
  const leadsRes = await pool.query(
    `SELECT * FROM leads WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.leads = leadsRes.rows;
  console.log(`  leads: ${data.leads.length}`);

  // projects
  const projectsRes = await pool.query(
    `SELECT * FROM projects WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.projects = projectsRes.rows;
  console.log(`  projects: ${data.projects.length}`);

  // estimates
  const estimatesRes = await pool.query(
    `SELECT * FROM estimates WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.estimates = estimatesRes.rows;
  console.log(`  estimates: ${data.estimates.length}`);

  // invoices
  const invoicesRes = await pool.query(
    `SELECT * FROM invoices WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.invoices = invoicesRes.rows;
  console.log(`  invoices: ${data.invoices.length}`);

  // payments
  const paymentsRes = await pool.query(
    `SELECT * FROM payments WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.payments = paymentsRes.rows;
  console.log(`  payments: ${data.payments.length}`);

  // communications
  const commsRes = await pool.query(
    `SELECT * FROM communications WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.communications = commsRes.rows;
  console.log(`  communications: ${data.communications.length}`);

  // tasks
  const tasksRes = await pool.query(
    `SELECT * FROM tasks WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.tasks = tasksRes.rows;
  console.log(`  tasks: ${data.tasks.length}`);

  // calendar_events
  const calRes = await pool.query(
    `SELECT * FROM calendar_events WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.calendar_events = calRes.rows;
  console.log(`  calendar_events: ${data.calendar_events.length}`);

  // generic_entities (large - fetch all)
  const geRes = await pool.query(
    `SELECT * FROM generic_entities WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.generic_entities = geRes.rows;
  console.log(`  generic_entities: ${data.generic_entities.length}`);

  // signing_sessions
  const sigRes = await pool.query(
    `SELECT * FROM signing_sessions WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.signing_sessions = sigRes.rows;
  console.log(`  signing_sessions: ${data.signing_sessions.length}`);

  // transaction_mapping_rules
  const txRes = await pool.query(
    `SELECT * FROM transaction_mapping_rules WHERE company_id IN (${placeholders})`,
    COMPANIES_TO_MIGRATE
  );
  data.transaction_mapping_rules = txRes.rows;
  console.log(`  transaction_mapping_rules: ${data.transaction_mapping_rules.length}`);

  // file_uploads metadata only (no binary data - files are in object storage)
  const fuRes = await pool.query(
    `SELECT id, original_filename, mime_type, file_size, created_at FROM file_uploads`
  );
  data.file_uploads = fuRes.rows;
  console.log(`  file_uploads (metadata only): ${data.file_uploads.length}`);

  await pool.end();

  const outPath = path.join(__dirname, 'prod-migration-data.json');
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

  const totalRecords = Object.values(data).reduce((s, arr) => s + arr.length, 0);
  const fileSizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`\nExport complete: ${totalRecords} total records → ${outPath} (${fileSizeMB} MB)`);
}

main().catch(e => { console.error('Export failed:', e.message); process.exit(1); });
