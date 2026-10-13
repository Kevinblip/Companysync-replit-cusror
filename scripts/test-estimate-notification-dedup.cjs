#!/usr/bin/env node

const fs = require('fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const estimator = read('src/pages/AIEstimator.jsx');
const customers = read('src/pages/Customers.jsx');
const dbPlugin = read('vite-db-plugin.js');
const helper = read('vite-notification-helper.js');
const workflowSafety = read('lib/workflowNotificationSafety.cjs');
const prodDb = read('db/prod-db.cjs');
const restoreWorkflows = read('db/restore-workflows.cjs');

const checks = [];
function check(name, condition) {
  checks.push({ name, condition: Boolean(condition) });
  console.log(`${condition ? '✓' : '✗'} ${name}`);
}

check(
  'AI estimator does not dispatch a second create notification',
  !/universalNotificationDispatcher[\s\S]{0,260}action:\s*['"]create['"][\s\S]{0,260}entityType:\s*['"]Estimate['"]/.test(estimator),
);
check(
  'customer page does not dispatch a second create notification',
  !/universalNotificationDispatcher[\s\S]{0,260}action:\s*['"]create['"][\s\S]{0,260}entityType:\s*['"]Customer['"]/.test(customers),
);
check(
  'entity API owns the Estimate create notification',
  /getEntityNotificationConfig\(sdkName, ['"]create['"], created\)/.test(dbPlugin)
    && /case ['"]Estimate['"]/.test(helper),
);
check(
  'entity API owns the Customer create notification',
  /getEntityNotificationConfig\(sdkName, ['"]create['"], created\)/.test(dbPlugin)
    && /case ['"]Customer['"]/.test(helper),
);
check(
  'AI estimator still keeps status-change tracking',
  /trackEvent\(editEstimateIdFromUrl \? ['"]estimate_updated['"] : ['"]estimate_created['"]/.test(estimator),
);
check(
  'redundant platform estimate workflow is identified',
  /name === 'new estimate follow-up'/.test(workflowSafety)
    && /createdBy === 'platform'/.test(workflowSafety),
);
check(
  'production workflow runner skips the redundant platform workflow',
  /isRedundantPlatformEstimateWorkflow\(wf, wfRow\.id\)/.test(prodDb),
);
check(
  'workflow restore does not recreate the redundant immediate workflow',
  !restoreWorkflows.includes('workflow_name: "New Estimate Follow-up"'),
);

const failed = checks.filter((item) => !item.condition);
if (failed.length) {
  console.error(`\n${failed.length} notification deduplication checks failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} estimate notification deduplication checks passed.`);