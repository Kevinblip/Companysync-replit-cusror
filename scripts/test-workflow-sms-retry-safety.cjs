const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  normalizeWorkflowSmsDestination,
  workflowSmsDedupeId,
} = require('../lib/workflowSmsSafety.cjs');

assert.strictEqual(normalizeWorkflowSmsDestination('(216) 555-1234'), '+12165551234');
assert.strictEqual(normalizeWorkflowSmsDestination('+442071838750'), '+442071838750');
assert.strictEqual(normalizeWorkflowSmsDestination('0000000000'), '');
assert.strictEqual(normalizeWorkflowSmsDestination('2160000000'), '');
assert.strictEqual(normalizeWorkflowSmsDestination('1234'), '');

const claim = workflowSmsDedupeId({
  companyId: 'company-a',
  to: '+12165551234',
  message: 'Same message',
});
assert.strictEqual(claim, workflowSmsDedupeId({
  companyId: 'company-a',
  to: '+12165551234',
  message: 'Same message',
}));
assert.notStrictEqual(claim, workflowSmsDedupeId({
  companyId: 'company-a',
  to: '+12165551234',
  message: 'Different message',
}));

const plugin = fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
const prod = fs.readFileSync(path.join(__dirname, '..', 'prod-server.cjs'), 'utf8');

assert.match(plugin, /Duplicate SMS suppressed within 24 hours/);
assert.match(plugin, /ON CONFLICT \(id, entity_type\) DO UPDATE/);
assert.match(plugin, /created_date < NOW\(\) - INTERVAL '24 hours'/);
assert.match(plugin, /SMS provider request failed/);
assert.doesNotMatch(plugin, /DELETE FROM generic_entities WHERE id = \$1 AND entity_type = 'WorkflowDeliveryClaim'/);
assert.match(plugin, /assertSmsRecipientAllowed/);
assert.match(plugin, /'{status}', '"failed"'/);
assert.match(prod, /Previous run still active; skipping overlap/);
assert.match(prod, /actionResult && actionResult\.success === false/);
assert.match(prod, /'{status}', '"failed"'/);

console.log('Workflow SMS retry safety checks passed.');