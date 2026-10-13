#!/usr/bin/env node
/**
 * Company Email Sender Regression Test
 * ─────────────────────────────────────────────────────────────────────────
 * Prevents regression: company-scoped mail must show the subscribing company's
 * name, while subscriber lifecycle mail must use the fixed platform sender.
 * If someone accidentally reverts either contract, this test catches it.
 *
 * Three assertion layers:
 *   1. Dynamic extraction: parse companyFrom() from the ACTUAL source file
 *      so the test always matches production logic.
 *   2. Executable unit tests: run extracted companyFrom() against real inputs
 *   3. Payload trace: for each critical mail path, find its send helper and
 *      assert the `from` argument matches the appropriate sender contract.
 *
 * Usage: node scripts/test-company-email-sender.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function ok(name, cond, got) {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else       { console.log(`  ✗ ${name}${got !== undefined ? ` (got: ${JSON.stringify(got)})` : ''}`); failed++; }
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 0: Dynamically extract companyFrom from the real source file
// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Company Email Sender Regression Test ──\n');
console.log('[ Setup: extracting companyFrom from production source ]');

const pluginPath = path.resolve(__dirname, '..', 'vite-functions-plugin.js');
const pluginSrc = fs.readFileSync(pluginPath, 'utf-8');

// Extract RESEND_FROM definition
const resendFromMatch = pluginSrc.match(
  /const\s+RESEND_FROM\s*=\s*(?:\(\)\s*=>\s*)?(?:process\.env\.EMAIL_FROM\s*\|\|\s*)?'([^']+)'/i
);
const extractedResendFrom = resendFromMatch?.[1] || 'CompanySync <noreply@companysync.io>';
ok('Extracted RESEND_FROM default from source', extractedResendFrom.includes('CompanySync'));

// Extract companyFrom function using brace-counting (handles nested braces in template literals)
const lines = pluginSrc.split('\n');
const cfStartIdx = lines.findIndex(l => /const\s+companyFrom\s*=\s*\(/.test(l));
const companyFromFound = cfStartIdx >= 0;
ok('companyFrom function definition found in source', companyFromFound);

// Brace-count walk to find the closing }; of the arrow function
let companyFromSource = '';
if (companyFromFound) {
  let depth = 0;
  let started = false;
  let endIdx = cfStartIdx;
  for (let i = cfStartIdx; i < Math.min(cfStartIdx + 80, lines.length); i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      if (ch === '}') depth--;
    }
    if (started && depth === 0) { endIdx = i; break; }
  }
  companyFromSource = lines.slice(cfStartIdx, endIdx + 1).join('\n');
}

// Build a dynamic function from the extracted source
let companyFrom;
try {
  if (!companyFromSource) throw new Error('Could not extract function source');
  const resendFromLiteral = extractedResendFrom.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  const wrapper = `
    'use strict';
    const RESEND_FROM = () => process.env.EMAIL_FROM || '${resendFromLiteral}';
    ${companyFromSource}
    return companyFrom(name);
  `;
  companyFrom = new Function('name', wrapper);
  // Smoke-call to validate it's executable
  companyFrom('TestCo');
  ok('companyFrom extracted and executable', true);
} catch (e) {
  ok('companyFrom extracted and executable', false, e.message);
  console.log('\n── FATAL: Cannot proceed without extracted companyFrom ──');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION 1: Executable unit tests against extracted companyFrom()
// ─────────────────────────────────────────────────────────────────────────
console.log('\n[ Unit: executable tests against extracted companyFrom() ]');

const origEmailFrom = process.env.EMAIL_FROM;
process.env.EMAIL_FROM = extractedResendFrom;

const acmeResult = companyFrom('Acme Roofing');
ok('companyFrom("Acme Roofing") contains the company name', acmeResult.includes('Acme Roofing'), acmeResult);
ok('companyFrom("Acme Roofing") does NOT contain "CompanySync"', !acmeResult.includes('CompanySync'), acmeResult);
ok('companyFrom("Acme Roofing") is formatted as "Name <email>"', /^[^<]+ <[^>]+>$/.test(acmeResult), acmeResult);

const blankResult = companyFrom('');
ok('companyFrom("") falls back to default from address', blankResult.includes('CompanySync'), blankResult);
ok('companyFrom("") still contains an email domain', blankResult.includes('@'), blankResult);

const nullResult = companyFrom(null);
ok('companyFrom(null) falls back to default from address', nullResult.includes('CompanySync'), nullResult);

const unicodeResult = companyFrom("José's Roofing");
ok('companyFrom handles unicode company names', unicodeResult.includes("José's Roofing"), unicodeResult);

// With custom EMAIL_FROM
process.env.EMAIL_FROM = 'Platform <noreply@platform.example>';
const customResult = companyFrom('Top Roof LLC');
ok('companyFrom respects custom EMAIL_FROM domain', customResult.includes('Top Roof LLC'), customResult);
ok('companyFrom uses custom domain when EMAIL_FROM is set', customResult.includes('platform.example'), customResult);

// Restore
if (origEmailFrom === undefined) delete process.env.EMAIL_FROM;
else process.env.EMAIL_FROM = origEmailFrom;

// ─────────────────────────────────────────────────────────────────────────
// SECTION 2: Payload trace — verify each mail path's from argument
// ─────────────────────────────────────────────────────────────────────────
console.log('\n[ Payload trace: mail-path from arguments ]');

/**
 * findSendViaResendInScope extracts the `from:` expression inside a
 * sendViaResend or sendEmailWithResend call that occurs within the
 * given scope (e.g. inside the sendTrialDayTouch function body).
 * Returns the raw `from:` expression text or null.
 */
function findFromInScope(scopeStart, scopeEnd, expectedContext) {
  const scopeSrc = pluginSrc.slice(scopeStart, scopeEnd);
  // Match either shared send helper (direct or via functionHandlers. prefix).
  const fromMatch = scopeSrc.match(/(?:functionHandlers\.)?(?:send(?:Via|EmailWith)Resend|sendPlatformSubscriberEmail)\(\{[^}]*from:\s*([^,\n}]+)/);
  if (!fromMatch) return null;
  return { expr: fromMatch[1].trim(), context: expectedContext };
}

// 1. sendTrialDayTouch — subscriber lifecycle mail uses the fixed platform
// sender, not a company-scoped identity.
const trialTouchFnMatch = pluginSrc.match(/async function sendTrialDayTouch[\s\S]{0,80}/);
if (trialTouchFnMatch) {
  const start = pluginSrc.indexOf(trialTouchFnMatch[0]);
  const end = start + 2000; // ~first 2000 chars of the function body
  const found = findFromInScope(start, end, 'sendTrialDayTouch');
  ok(
    'sendTrialDayTouch from argument uses the fixed platform sender',
    found?.expr === 'PLATFORM_EMAIL_FROM',
    found
  );
  const trialScope = pluginSrc.slice(start, end);
  ok(
    'sendTrialDayTouch sets the fixed platform Reply-To',
    /replyTo:\s*PLATFORM_EMAIL_REPLY_TO/.test(trialScope),
    trialScope.match(/replyTo:\s*[^,\n}]+/)?.[0],
  );
} else {
  ok('sendTrialDayTouch from argument uses the fixed platform sender', false, 'function not found');
}

// 2. processTrialLifecycle expiration email
const trialLifecycleMatch = pluginSrc.indexOf('async processTrialLifecycle');
if (trialLifecycleMatch >= 0) {
  const start = trialLifecycleMatch;
  const end = start + 15000; // Expiration email is ~1800 chars into the function
  const scopeSrc = pluginSrc.slice(start, end);
  const fromMatch = scopeSrc.match(/sendPlatformSubscriberEmail\(\{[^}]*from:\s*([^,\n}]+)/);
  ok(
    'processTrialLifecycle expiration from uses the fixed platform sender',
    fromMatch?.[1].trim() === 'PLATFORM_EMAIL_FROM',
    fromMatch?.[1]?.trim()
  );
  ok(
    'processTrialLifecycle expiration sets the fixed platform Reply-To',
    /sendPlatformSubscriberEmail\(\{[\s\S]*?replyTo:\s*PLATFORM_EMAIL_REPLY_TO/.test(scopeSrc),
    scopeSrc.match(/replyTo:\s*[^,\n}]+/)?.[0],
  );
} else {
  ok('processTrialLifecycle expiration from uses the fixed platform sender', false, 'function not found');
}

// 3. sendMorningDigest
const morningDigestMatch = pluginSrc.indexOf('async sendMorningDigest');
if (morningDigestMatch >= 0) {
  const start = morningDigestMatch;
  const end = start + 16000;
  const found = findFromInScope(start, end, 'sendMorningDigest');
  ok(
    'sendMorningDigest from argument uses companyFrom(staff.company_name)',
    found?.expr === 'companyFrom(staff.company_name)',
    found
  );
} else {
  ok('sendMorningDigest from argument uses companyFrom(staff.company_name)', false, 'function not found');
}

// 4. Backup expiry warning (cronCleanupBackups)
const cronCleanupMatch = pluginSrc.indexOf('async cronCleanupBackups');
if (cronCleanupMatch >= 0) {
  const start = cronCleanupMatch;
  const end = start + 5000;
  // There may be multiple sendViaResend calls; find the one with data.company_name
  const scopeSrc = pluginSrc.slice(start, end);
  const fromMatch = scopeSrc.match(/from:\s*companyFrom\(data\.company_name\)/);
  ok(
    'backup expiry warning from uses companyFrom(data.company_name)',
    fromMatch !== null,
    fromMatch?.[0]
  );
} else {
  ok('backup expiry warning from uses companyFrom(data.company_name)', false, 'function not found');
}

// 5. Backup complete notification (createDailyBackup)
const createBackupMatch = pluginSrc.indexOf('async createDailyBackup');
if (createBackupMatch >= 0) {
  const start = createBackupMatch;
  const end = start + 7000;
  const found = findFromInScope(start, end, 'createDailyBackup');
  ok(
    'backup complete notification from uses companyFrom(company.company_name)',
    found?.expr === 'companyFrom(company.company_name)',
    found
  );
} else {
  ok('backup complete notification from uses companyFrom(company.company_name)', false, 'function not found');
}

// 6. Action-item escalation (processActionItemEscalation)
const actionEscalationMatch = pluginSrc.indexOf('async processActionItemEscalation');
if (actionEscalationMatch >= 0) {
  const start = actionEscalationMatch;
  const end = start + 6000;
  const scopeSrc = pluginSrc.slice(start, end);
  // Action-item escalation calls sendEmailWithResend({ companyId: item.company_id, ... })
  // The companyId triggers auto-resolve via companyFrom in sendEmailWithResend
  const hasCompanyId = scopeSrc.includes('companyId: item.company_id');
  ok(
    'processActionItemEscalation passes companyId to sendEmailWithResend (auto-resolves company name)',
    hasCompanyId,
    hasCompanyId ? 'companyId found' : 'companyId NOT found in escalation email call'
  );
  ok(
    'processActionItemEscalation skips recipients that are not email addresses',
    scopeSrc.includes('!isValidEmailAddress(recipientEmail)') && scopeSrc.includes('Skipping email'),
    scopeSrc.includes('!isValidEmailAddress(recipientEmail)')
  );
  // Also verify sendEmailWithResend auto-resolve logic exists in the file
  const autoResolveMatch = pluginSrc.match(/if\s*\(\s*!fromAddr\s*&&\s*companyId\s*\)/);
  ok(
    'sendEmailWithResend auto-resolve guard exists',
    autoResolveMatch !== null
  );
} else {
  ok('processActionItemEscalation passes companyId to sendEmailWithResend', false, 'function not found');
}

// 7. General guard: no hardcoded "CompanySync" in from field of sendViaResend calls
const sendViaResendCalls = pluginSrc.match(/sendViaResend\(\{[\s\S]{0,300}?\}\)/g) || [];
const hardcodedCompanySync = sendViaResendCalls.filter(call =>
  call.includes('from:') && call.includes('CompanySync') && !call.includes('companyFrom')
);
ok(
  'No sendViaResend call hardcodes "CompanySync" as from (must use companyFrom)',
  hardcodedCompanySync.length === 0,
  hardcodedCompanySync.map(c => c.slice(0, 120))
);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Summary ──');
console.log(`   Passed: ${passed}   Failed: ${failed}`);
if (failed > 0) {
  console.log('\n✗ Some tests failed — see details above.');
  process.exit(1);
} else {
  console.log('\n✓ All tests passed.');
}
