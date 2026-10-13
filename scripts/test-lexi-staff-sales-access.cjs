const assert = require('assert');
const fs = require('fs');
const {
  buildLexiAccessPolicy,
  isPermittedRepTool,
  ownRecordCondition,
} = require('../lib/lexiAccessPolicy.cjs');

const company = { created_by: 'owner@example.com' };
const rep = { is_administrator: false, is_super_admin: false };

assert.equal(
  buildLexiAccessPolicy({ company, userProfile: { ...rep, is_administrator: 'false' }, effectiveEmail: 'rep@example.com' }).isAdmin,
  false,
  'a string "false" must not grant Lexi admin access'
);
assert.equal(
  buildLexiAccessPolicy({ company, userProfile: rep, effectiveEmail: 'rep@example.com' }).isAdmin,
  false,
  'a non-admin rep must not have Lexi admin access'
);
assert.equal(
  buildLexiAccessPolicy({ company, userProfile: { ...rep, is_administrator: true }, effectiveEmail: 'rep@example.com' }).isAdmin,
  true,
  'an explicit database boolean true grants admin access'
);
assert.equal(
  buildLexiAccessPolicy({ company, userProfile: rep, effectiveEmail: 'OWNER@example.com' }).isAdmin,
  true,
  'the company creator remains an admin'
);
assert.equal(isPermittedRepTool('get_staff_sales_summary'), true, 'reps may use the self-sales tool');
assert.ok(!ownRecordCondition('customers').includes('created_by'), 'customer ownership scope must not reference a column absent from production');
assert.ok(ownRecordCondition('customers').includes('assigned_to'), 'customer ownership scope must remain assigned-record only');

const viteSource = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const prodSource = fs.readFileSync('prod-server.cjs', 'utf8');
assert.match(
  viteSource,
  /if\s*\(!isAdmin\)\s*\{\s*args\.staff_name\s*=\s*effectiveEmail;/,
  'the development handler must overwrite a rep’s requested staff name with their session identity'
);
assert.match(
  prodSource,
  /if\s*\(!isAdmin\)\s*a\.staff_name\s*=\s*userEmail;/,
  'the production handler must overwrite a rep’s requested staff name with their session identity'
);

console.log('PASS: Lexi staff-sales access — reps are restricted to their own sales');