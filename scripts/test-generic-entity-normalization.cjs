'use strict';

const assert = require('node:assert/strict');
const {
  canonicalizeGenericEntityType,
  normalizeGenericEntityData,
} = require('../lib/expenseNormalize.cjs');

assert.equal(canonicalizeGenericEntityType('notes'), 'CustomerNote');
assert.equal(canonicalizeGenericEntityType('customer_note'), 'CustomerNote');
assert.equal(canonicalizeGenericEntityType('expenses'), 'Expense');

const expense = normalizeGenericEntityData('expenses', {
  vendor: ' Roof Supply ',
  date: '2026-09-01T14:30:00Z',
  category: { invented: true },
  amount: '$343.91',
}, { applyDefaults: true });
assert.equal(expense.vendor_name, 'Roof Supply');
assert.equal(expense.expense_date, '2026-09-01');
assert.equal(expense.category, 'other');
assert.equal(expense.amount, 343.91);
assert.equal('vendor' in expense, false);
assert.equal('date' in expense, false);

const note = normalizeGenericEntityData('note', {
  note_text: ' Call the homeowner ',
  timestamp: 'not-a-date',
}, { applyDefaults: true });
assert.equal(note.note, 'Call the homeowner');
assert.equal(note.source_type, 'lexi');
assert.ok(!Number.isNaN(new Date(note.created_at).getTime()));
assert.equal('note_text' in note, false);
assert.equal('timestamp' in note, false);

const document = normalizeGenericEntityData('documents', {
  title: ' Inspection report ',
  document_type: 'report',
  file_size: '1,024 bytes',
}, { applyDefaults: true });
assert.equal(document.document_name, 'Inspection report');
assert.equal(document.category, 'report');
assert.equal(document.file_size, 1024);
assert.equal(document.is_customer_visible, false);

const communication = normalizeGenericEntityData('communication', {
  channel: 'sms',
  body: ' On my way ',
  intent: { invented: true },
  timestamp: 'invalid',
}, { applyDefaults: true });
assert.equal(communication.communication_type, 'sms');
assert.equal(communication.message, 'On my way');
assert.equal(communication.intent, undefined);
assert.equal(communication.created_date, undefined);
assert.equal(communication.direction, 'outbound');

const workflow = normalizeGenericEntityData('workflows', {
  name: ' New lead follow-up ',
  trigger: 'lead_created',
  steps: { invented: true },
  last_executed: 'invalid',
}, { applyDefaults: true });
assert.equal(workflow.workflow_name, 'New lead follow-up');
assert.equal(workflow.trigger_type, 'lead_created');
assert.deepEqual(workflow.actions, []);
assert.equal(workflow.last_executed, undefined);
assert.equal(workflow.is_active, true);

const legacyNote = {
  note_text: 'Legacy text',
  source_type: 'manual',
  created_at: '2026-08-31T12:00:00Z',
};
const healedNote = normalizeGenericEntityData('CustomerNote', {
  ...legacyNote,
  source_label: 'Updated',
});
assert.equal(healedNote.note, 'Legacy text');
assert.equal(healedNote.source_label, 'Updated');
assert.equal('note_text' in healedNote, false);

console.log('Generic entity normalization tests passed.');