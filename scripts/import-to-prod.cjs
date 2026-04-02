/**
 * Import dev data into production via the temporary migration endpoint.
 * Run: PROD_URL=https://your-prod-url.replit.app node scripts/import-to-prod.cjs
 * Or:  node scripts/import-to-prod.cjs https://your-prod-url.replit.app
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const MIGRATE_TOKEN = '4fe92ed70163264db2e7aa1b7a6d43461338a116d3713b0e128d96ed616f1406';
const CHUNK_SIZE = 2000; // rows per request for large tables

const PROD_URL = process.argv[2] || process.env.PROD_URL;
if (!PROD_URL) {
  console.error('Usage: node scripts/import-to-prod.cjs <PROD_URL>');
  console.error('Example: node scripts/import-to-prod.cjs https://myapp.replit.app');
  process.exit(1);
}

const dataPath = path.join(__dirname, 'prod-migration-data.json');
console.log(`Loading ${dataPath}...`);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
console.log(`Loaded. Tables: ${Object.keys(data).join(', ')}\n`);

function post(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const jsonBody = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonBody),
        'x-migrate-token': MIGRATE_TOKEN,
      },
      timeout: 120000,
    };
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(jsonBody);
    req.end();
  });
}

async function sendChunk(label, payload) {
  const endpoint = `${PROD_URL.replace(/\/$/, '')}/api/admin/migrate-from-dev`;
  const res = await post(endpoint, payload);
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.counts || {};
}

async function migrateTable(table, rows) {
  if (!rows || rows.length === 0) {
    console.log(`  ${table}: 0 rows — skipped`);
    return 0;
  }

  if (rows.length <= CHUNK_SIZE) {
    const counts = await sendChunk(table, { [table]: rows });
    console.log(`  ${table}: ${counts[table] ?? '?'} / ${rows.length} inserted`);
    return counts[table] || 0;
  }

  // Large table — chunk it
  let totalInserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const end = Math.min(i + CHUNK_SIZE, rows.length);
    process.stdout.write(`  ${table}: rows ${i + 1}–${end} / ${rows.length}...`);
    const counts = await sendChunk(`${table}_chunk`, { [table]: chunk });
    const n = counts[table] || 0;
    totalInserted += n;
    process.stdout.write(` ${n} inserted\n`);
  }
  console.log(`  ${table}: TOTAL ${totalInserted} / ${rows.length} inserted`);
  return totalInserted;
}

async function main() {
  console.log(`Migrating to: ${PROD_URL}\n`);

  // Insert in FK dependency order
  const tables = [
    'companies',
    'users',
    'staff_profiles',
    'inspector_profiles',
    'customers',
    'leads',
    'projects',
    'estimates',
    'invoices',
    'payments',
    'communications',
    'tasks',
    'calendar_events',
    'generic_entities',
    'signing_sessions',
    'transaction_mapping_rules',
    'file_uploads',
  ];

  let grandTotal = 0;
  for (const table of tables) {
    try {
      const n = await migrateTable(table, data[table]);
      grandTotal += n;
    } catch (e) {
      console.error(`  ${table}: FAILED — ${e.message}`);
    }
  }

  console.log(`\nDone. Total records inserted: ${grandTotal}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
