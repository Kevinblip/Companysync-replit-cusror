#!/usr/bin/env node

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('prod-server.cjs', 'utf8');

assert.match(
  source,
  /COALESCE\(NULLIF\(cell_phone, ''\), NULLIF\(phone, ''\)\) AS notification_phone/g,
  'payment alerts must accept either staff cell_phone or legacy phone'
);

const fallbackCount = (source.match(/AS notification_phone/g) || []).length;
assert.ok(fallbackCount >= 3, `expected phone fallback in card, ACH, and recovery paths; found ${fallbackCount}`);

assert.match(
  source,
  /async function sendPaymentAlertSms[\s\S]*handlers\.sendSMS\(\{ to, message, companyId \}\)[\s\S]*result\?\.success !== true/,
  'payment alerts must use the guarded SMS sender and require confirmed success'
);

assert.match(
  source,
  /\[StripeRecovery\] Admin SMS error:/,
  'Stripe recovery must attempt and report admin SMS delivery'
);

const paymentWebhookRegion = source.slice(
  source.indexOf('async function notifyAndEmailAdmins(companyId'),
  source.indexOf('// Idempotently record a paid credit grant')
);
assert.doesNotMatch(
  paymentWebhookRegion,
  /Messages\.json/,
  'card payment alerts must not bypass the guarded SMS sender with a raw Twilio request'
);

console.log('Payment alert SMS regression checks passed.');