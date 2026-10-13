#!/usr/bin/env node
'use strict';

/**
 * Color Visualizer customer-share regression contract.
 *
 * This is intentionally source-level: the live handler is shared by the Vite
 * development server and production through functionHandlers, while actually
 * sending email/SMS during a test would require provider credentials and would
 * contact a real recipient.
 *
 * The fixture cases represented here are legacy customer/lead rows whose
 * contact fields exist only in the JSONB `data` column.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const functions = fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'db/schema.js'), 'utf8');

let passed = 0;
let failed = 0;

function check(name, condition, details) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${details ? ` (${details})` : ''}`);
  }
}

const handlerStart = functions.indexOf('functionHandlers.shareColorVizWithCustomer =');
const handlerEnd = functions.indexOf('// ── Color Visualizer shared helpers', handlerStart);
const handler = handlerStart >= 0 && handlerEnd > handlerStart
  ? functions.slice(handlerStart, handlerEnd)
  : '';

console.log('\n── Color Visualizer Share Contact Regression Test ───────────────\n');

check(
  'the live share handler was found',
  handler.length > 0,
);

check(
  'customers have dedicated and JSONB contact storage',
  /CREATE TABLE IF NOT EXISTS customers[\s\S]*?email TEXT[\s\S]*?phone TEXT[\s\S]*?data JSONB/.test(schema),
);
check(
  'leads have dedicated and JSONB contact storage',
  /CREATE TABLE IF NOT EXISTS leads[\s\S]*?email TEXT[\s\S]*?phone TEXT[\s\S]*?data JSONB/.test(schema),
);
check(
  'the handler selects JSONB data from the owning entity',
  /SELECT name, email, phone, data FROM \$\{table\}/.test(handler),
);

// Legacy imported rows can have null top-level columns while data.email/data.phone
// are populated. Verify both fallback expressions are present in the live path.
check(
  'email falls back to data.email',
  /const emailAddr\s*=\s*ent\.email\s*\|\|\s*ent\.data\?\.email\s*\|\|\s*null/.test(handler),
);
check(
  'SMS falls back to data.phone',
  /const phoneNum\s*=\s*ent\.phone\s*\|\|\s*ent\.data\?\.phone\s*\|\|\s*null/.test(handler),
);
check(
  'email sends the resolved fallback address',
  /if \(channel === 'email'\)[\s\S]*?if \(!emailAddr\)[\s\S]*?sendViaResend\(\{[\s\S]*?to: emailAddr/.test(handler),
);
check(
  'SMS sends the resolved fallback number',
  /if \(!phoneNum\)[\s\S]*?functionHandlers\.sendSMS\(\{[\s\S]*?to: phoneNum/.test(handler),
);

const emailGuard = handler.indexOf('if (!emailAddr)');
const emailSend = handler.indexOf('sendViaResend({', emailGuard);
const smsGuard = handler.indexOf('if (!phoneNum)');
const smsSend = handler.indexOf('functionHandlers.sendSMS({', smsGuard);
check(
  'missing email is rejected before the provider call',
  emailGuard >= 0 && emailSend > emailGuard &&
    /No email (?:address )?on file for this customer/.test(handler.slice(emailGuard, emailSend)),
);
check(
  'missing phone is rejected before the provider call',
  smsGuard >= 0 && smsSend > smsGuard &&
    /No phone (?:number )?on file for this customer/.test(handler.slice(smsGuard, smsSend)),
);
check(
  'no provider call uses a raw entity contact field',
  !/sendViaResend\(\{[\s\S]*?to:\s*ent\.(?:email|phone)/.test(handler) &&
    !/functionHandlers\.sendSMS\(\{[\s\S]*?to:\s*ent\.(?:email|phone)/.test(handler),
);

console.log(`\n── Summary: ${passed} passed, ${failed} failed ─────────────────────`);
process.exitCode = failed === 0 ? 0 : 1;