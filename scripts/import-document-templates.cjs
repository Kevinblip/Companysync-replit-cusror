#!/usr/bin/env node
'use strict';

/**
 * Import title/category/description/content CSV rows into the document library.
 *
 * Usage:
 *   node scripts/import-document-templates.cjs \
 *     --input attached_assets/company_sync_templates.csv \
 *     --company-id <company-id> \
 *     --dry-run
 *
 * The import is idempotent for the same company and source file. Each row gets
 * a deterministic import_key, so a rerun inserts only missing records.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPool } = require('./lib/db-pool.cjs');

const DOCUMENT_CATEGORIES = new Set([
  'contract',
  'estimate',
  'invoice',
  'photo',
  'insurance',
  'warranty',
  'proposal',
  'report',
  'supplier_letters',
  'rebuttal_docs',
  'irc_code_letter',
  'insurance_claim',
  'customer_communication',
  'billing',
  'manufacturer_specs',
  'other',
]);

const CATEGORY_ALIASES = new Map([
  ['contracts', 'contract'],
  ['estimates', 'estimate'],
  ['invoices', 'invoice'],
  ['photos', 'photo'],
  ['insurances', 'insurance'],
  ['warranties', 'warranty'],
  ['proposals', 'proposal'],
  ['reports', 'report'],
  ['supplier letter', 'supplier_letters'],
  ['supplier letters', 'supplier_letters'],
  ['rebuttal', 'rebuttal_docs'],
  ['rebuttals', 'rebuttal_docs'],
  ['rebuttal document', 'rebuttal_docs'],
  ['rebuttal documents', 'rebuttal_docs'],
  ['irc code letters', 'irc_code_letter'],
  ['insurance claims', 'insurance_claim'],
  ['insurance claim letter', 'insurance_claim'],
  ['customer communications', 'customer_communication'],
  ['customer communication', 'customer_communication'],
  ['manufacturer specs', 'manufacturer_specs'],
  ['manufacturer specifications', 'manufacturer_specs'],
]);

function parseArgs(argv) {
  const args = { input: 'attached_assets/company_sync_templates.csv', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--dry-run') args.dryRun = true;
    else if (value === '--input') args.input = argv[++i];
    else if (value === '--company-id') args.companyId = argv[++i];
    else if (value === '--help' || value === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function printUsage() {
  console.log([
    'Import document templates into the company document library.',
    '',
    'Options:',
    '  --input <path>       CSV path (default: attached_assets/company_sync_templates.csv)',
    '  --company-id <id>    Target company id (required unless --dry-run)',
    '  --dry-run            Parse and validate without writing to the database',
    '  --help               Show this help',
  ].join('\n'));
}

// Small RFC 4180 parser so multiline quoted content and escaped quotes work
// without adding a package solely for this one-off import path.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter(candidate => candidate.some(value => String(value).trim() !== ''));
}

function normalizeCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'other';
  const slug = raw
    .replace(/&/g, ' and ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const candidate = CATEGORY_ALIASES.get(slug) || slug.replace(/\s+/g, '_');
  return DOCUMENT_CATEGORIES.has(candidate) ? candidate : 'other';
}

function importKey({ title, category, content }) {
  return crypto
    .createHash('sha256')
    .update(`${title}\u0000${category}\u0000${content}`)
    .digest('hex');
}

function parseTemplateCsv(csvText, sourceName = 'company_sync_templates.csv') {
  const rows = parseCsv(String(csvText || '').replace(/^\uFEFF/, ''));
  if (rows.length === 0) throw new Error('CSV is empty');

  const headers = rows[0].map(header => String(header).trim().toLowerCase());
  const required = ['title', 'category', 'description', 'content'];
  const missing = required.filter(header => !headers.includes(header));
  if (missing.length > 0) throw new Error(`CSV is missing required column(s): ${missing.join(', ')}`);

  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const templates = [];
  const warnings = [];
  const seenKeys = new Set();

  rows.slice(1).forEach((values, offset) => {
    const rowNumber = offset + 2;
    const title = String(values[index.title] || '').trim();
    const description = String(values[index.description] || '').trim();
    const content = String(values[index.content] || '').trim();
    const rawCategory = String(values[index.category] || '').trim();
    if (!title && !description && !content && !rawCategory) return;
    if (!title) throw new Error(`Row ${rowNumber} is missing title`);
    if (!content) throw new Error(`Row ${rowNumber} is missing content`);

    const category = normalizeCategory(rawCategory);
    if (rawCategory && category === 'other' && rawCategory.toLowerCase() !== 'other') {
      warnings.push(`Row ${rowNumber}: unknown category "${rawCategory}" mapped to "other"`);
    }

    const key = importKey({ title, category, content });
    if (seenKeys.has(key)) {
      warnings.push(`Row ${rowNumber}: duplicate title/category/content skipped`);
      return;
    }
    seenKeys.add(key);

    templates.push({
      document_name: title,
      template_name: title,
      category,
      description,
      content,
      file_size: Buffer.byteLength(content, 'utf8'),
      file_type: 'text/plain',
      is_template: true,
      source_file: sourceName,
      import_key: key,
      tags: ['template', 'imported'],
      is_customer_visible: false,
    });
  });

  return { templates, warnings };
}

async function importTemplates({ templates, companyId, sourceName }) {
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keys = templates.map(template => template.import_key);
    const existing = keys.length === 0
      ? { rows: [] }
      : await client.query(
        `SELECT data->>'import_key' AS import_key
           FROM generic_entities
          WHERE entity_type = 'Document'
            AND company_id = $1
            AND data->>'import_key' = ANY($2::text[])`,
        [companyId, keys],
      );
    const existingKeys = new Set(existing.rows.map(row => row.import_key));
    const inserted = [];
    const skipped = [];

    for (const template of templates) {
      if (existingKeys.has(template.import_key)) {
        skipped.push(template);
        continue;
      }
      const id = crypto.randomUUID();
      const data = { ...template, company_id: companyId };
      await client.query(
        `INSERT INTO generic_entities
          (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'Document', $2, $3::jsonb, NOW(), NOW())`,
        [id, companyId, JSON.stringify(data)],
      );
      inserted.push({ id, ...template });
    }
    await client.query('COMMIT');
    return { inserted, skipped };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input CSV not found: ${args.input}`);
  }
  if (!args.dryRun && !args.companyId) {
    throw new Error('--company-id is required for a database import; use --dry-run to validate only');
  }

  const { templates, warnings } = parseTemplateCsv(fs.readFileSync(inputPath, 'utf8'), path.basename(inputPath));
  const categoryCounts = templates.reduce((counts, template) => {
    counts[template.category] = (counts[template.category] || 0) + 1;
    return counts;
  }, {});
  console.log(`Parsed ${templates.length} template row(s) from ${args.input}`);
  console.log(`Categories: ${JSON.stringify(categoryCounts)}`);
  warnings.forEach(warning => console.warn(`WARNING: ${warning}`));

  if (args.dryRun) {
    console.log('Dry run complete — no database rows written.');
    return;
  }

  const result = await importTemplates({
    templates,
    companyId: args.companyId,
    sourceName: path.basename(inputPath),
  });
  console.log(`Imported ${result.inserted.length} document template(s); skipped ${result.skipped.length} existing row(s).`);
  console.log(`Verify in Documents with company_id=${args.companyId}, then filter by each imported category.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DOCUMENT_CATEGORIES,
  normalizeCategory,
  parseCsv,
  parseTemplateCsv,
};