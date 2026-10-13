#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const functions = fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8');
const prodDb = fs.readFileSync(path.join(root, 'db/prod-db.cjs'), 'utf8');
const prodIntegrations = fs.readFileSync(path.join(root, 'db/prod-integrations.cjs'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

console.log('\n── Automation Contact Name Guard ───────────────────────────────\n');

check(
  'all contact-name aliases use the resolved contact name',
  /enriched\.contact_name\s*=\s*contactName/.test(functions) &&
    /enriched\.customer_name\s*=\s*contactName/.test(functions) &&
    /enriched\.lead_name\s*=\s*contactName/.test(functions) &&
    /enriched\.name\s*=\s*contactName/.test(functions) &&
    /enriched\.contact_first_name\s*=\s*contactName/.test(functions),
);

check(
  'source record lookup is entity-type casing safe',
  /normalizedEntityType\s*=\s*String\(entityType \|\| ''\)\.trim\(\)\.toLowerCase\(\)/.test(functions) &&
    /contactSource\[normalizedEntityType\]/.test(functions),
);

check(
  'invoice lookup does not reference a nonexistent customer_phone column',
  /invoice:\s*\{[\s\S]*?phone:\s*`data->>'customer_phone'`/.test(functions),
);

check(
  'unusable names and unresolved contact tokens are rejected',
  /function cleanAutomationContactName/.test(functions) &&
    /unknown\(\?: caller\)\?/.test(functions) &&
    /function hasUnresolvedContactNameToken/.test(functions),
);

check(
  'customer workflow emails fail before the provider call when name is missing',
  /case 'send_email':[\s\S]*?contactIntent && \([\s\S]*?!cleanAutomationContactName\(contactName\)[\s\S]*?return \{ success: false, reason \};[\s\S]*?sendViaResend/.test(functions),
);

check(
  'customer workflow SMS fails before Twilio when name is missing',
  /case 'send_sms':[\s\S]*?contactIntent && \([\s\S]*?!cleanAutomationContactName\(contactName\)[\s\S]*?return \{ success: false, reason \};[\s\S]*?api\.twilio\.com/.test(functions),
);

check(
  'automated reminder calls and texts require a real customer name',
  /async sendCustomerReminder\(params\)[\s\S]*?resolvedCustomerName = cleanAutomationContactName\(customerName\)[\s\S]*?if \(!resolvedCustomerName\)[\s\S]*?missing_contact_name_call[\s\S]*?return \{ success: false, skipped \};[\s\S]*?initiateOutboundCall/.test(functions),
);

check(
  'scheduled campaigns cannot bypass the customer-name guard or fake a name',
  !/d\.name \|\| d\.lead_name \|\| 'there'/.test(functions) &&
    !/d\.name \|\| d\.full_name \|\| 'there'/.test(functions) &&
    /async sendCampaign\(params\)[\s\S]*?recipient: 'customer'[\s\S]*?actionResult\?\.success === false/.test(functions),
);

check(
  'skipped SMS/call outreach is persisted instead of reported as sent',
  /async function recordSkippedAutomationOutreach/.test(functions) &&
    /'outbound'[\s\S]*?'skipped'/.test(functions) &&
    /source: 'automation'/.test(functions),
);

check(
  'delayed workflow execution records a false result from the shared guard',
  /actionResult = await executeWorkflowAction/.test(functions) &&
    /actionResult && actionResult\.success === false/.test(functions) &&
    /logEntry\.success = false/.test(functions),
);

check(
  'production immediate and delayed workflow paths reuse the shared executor',
  /executeProdWorkflowAction\(pool, action, entityData, companyId, sdkName, entityId\)/.test(prodDb) &&
    /_executeWorkflowActionCache = mod\.executeWorkflowAction/.test(prodIntegrations),
);

console.log(`\n── Summary: ${passed} passed, ${failed} failed ─────────────────────`);
process.exitCode = failed === 0 ? 0 : 1;