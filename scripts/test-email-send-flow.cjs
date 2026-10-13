#!/usr/bin/env node
'use strict';

/**
 * Delivery-path regression contract.
 *
 * This is intentionally a source-level test: it verifies the live Vite handler
 * used in development and production (prod loads functionHandlers from it)
 * without sending an email or requiring provider credentials.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const functions = fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8');
const dialog = fs.readFileSync(path.join(root, 'src/components/communication/EmailDialog.jsx'), 'utf8');
const integrations = fs.readFileSync(path.join(root, 'vite-integrations-plugin.js'), 'utf8');

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

console.log('\n── Email Send Flow Regression Test ──────────────────────────────\n');

check(
  'quick email uses the authenticated unified handler',
  /async sendUnifiedEmail\(params, _apiKey, req\)/.test(functions) &&
    /authorizeCompanyEmailSender\(req, companyId\)/.test(functions),
);
check(
  'quick email checks company membership rather than trusting the request company',
  /FROM companies c[\s\S]*LOWER\(COALESCE\(c\.created_by, ''\)\) = LOWER\(\$1\)/.test(functions) &&
    /FROM staff_profiles sp[\s\S]*sp\.company_id = c\.id/.test(functions),
);
check(
  'quick email validates recipients and returns a provider acceptance identifier',
  /Use valid recipient email addresses/.test(functions) &&
    /providerMessageId: result\.id/.test(functions) &&
    // The unified handler must hand back the record id and an explicitly
    // non-delivered state, so no caller can present acceptance as arrival.
    /return \{ \.\.\.result, success: true, communicationId, deliveryStatus: 'submitted' \}/.test(functions),
);
check(
  'quick email records accepted and failed attempts',
  /source: 'quick_email'[\s\S]*status: 'accepted'/.test(functions) &&
    /source: 'quick_email'[\s\S]*status: 'failed'/.test(functions),
);
check(
  'workflow email uses the monitored shared transport and records outcomes',
  /const result = await sendViaResend\(\{ from: fromAddr, to: toEmail, subject, html: emailHtml \}\)/.test(functions) &&
    /source: 'workflow'[\s\S]*status: 'accepted'/.test(functions) &&
    /source: 'workflow'[\s\S]*status: 'failed'/.test(functions) &&
    /source: 'workflow'[\s\S]*status: 'skipped'/.test(functions),
);
check(
  'workflow errors remain actionable instead of being reported as success',
  /return \{ success: false, reason: `Email send failed/.test(functions) &&
    /recipient token did not resolve to an email/.test(functions),
);
check(
  'quick-email UI treats the local SDK error envelope as a failure',
  /if \(!result\?\.success \|\| !result\?\.id\)/.test(dialog) &&
    /Email was not accepted by the delivery provider/.test(dialog),
);
check(
  'quick-email UI confirms submission without a delivery-warning banner',
  /Email submitted successfully/.test(dialog) &&
    !/Delivery has not been confirmed yet/.test(dialog) &&
    /provider receipt is not confirmation/i.test(dialog) &&
    !/accepted for delivery/i.test(dialog) &&
    !/Base44's built-in email service/i.test(dialog),
);
check(
  'staff compose uses the guarded server route rather than the retired edge relay',
  /base44\.integrations\.Core\.SendEmail/.test(dialog) &&
    /req\.headers\?\.\['x-company-id'\] \|\| caller\.companyId/.test(integrations) &&
    /You do not have access to send email for this company/.test(integrations) &&
    /blocked during an impersonation session/.test(integrations) &&
    /source: 'staff_compose'/.test(integrations) &&
    /Generic email sending is temporarily disabled for security\./.test(integrations) === false,
);

console.log(`\n── Summary: ${passed} passed, ${failed} failed ─────────────────────`);
process.exitCode = failed === 0 ? 0 : 1;