#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { normalizeCategory, parseTemplateCsv } = require('./import-document-templates.cjs');

const csv = [
  'title,category,description,content',
  '"Code Letter","irc_code_letter","IRC justification","Line one',
  'Line two"',
  '"Claim Letter","insurance_claim","Adjuster request","Dear ""Adjuster""..."',
  '"Warranty","warranty","Workmanship warranty","Warranty text"',
].join('\n');
const parsed = parseTemplateCsv(csv, 'fixture.csv');

assert.equal(parsed.templates.length, 3);
assert.deepEqual(
  parsed.templates.map(template => template.category),
  ['irc_code_letter', 'insurance_claim', 'warranty'],
);
assert.equal(parsed.templates[0].content, 'Line one\nLine two');
assert.equal(parsed.templates[1].content, 'Dear "Adjuster"...');
assert.equal(normalizeCategory('Manufacturer Specifications'), 'manufacturer_specs');
assert.equal(normalizeCategory('unknown-category'), 'other');

const documentsPage = fs.readFileSync('src/pages/Documents.jsx', 'utf8');
const picker = fs.readFileSync('src/components/estimates/DocumentPickerDialog.jsx', 'utf8');
for (const category of ['warranty', 'insurance_claim', 'irc_code_letter', 'customer_communication', 'billing', 'manufacturer_specs']) {
  assert.match(documentsPage, new RegExp(`['"]${category}['"]`), `${category} must be a Documents filter`);
  assert.match(picker, new RegExp(`${category}:`), `${category} must be an attachment-picker filter`);
}

console.log('✓ Document-template CSV parsing, category normalization, and UI filter coverage passed.');