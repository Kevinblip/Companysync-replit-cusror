#!/usr/bin/env node
'use strict';

// The provider is deliberately mocked: this test must never send real email.
const assert = require('node:assert/strict');
const Module = require('node:module');

process.env.EMAIL_PROVIDER = 'smtp';
process.env.POSTMARK_SERVER_TOKEN = 'unused-postmark-token';
process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_USER = 'relay@test.invalid';
process.env.SMTP_PASS = 'unused-password';
process.env.EMAIL_ALLOW_RESERVED_RECIPIENTS = '1';

const health = require('../lib/emailProviderHealth.cjs');
const safety = require('../lib/emailSafety.cjs');
health.ensureHydrated = async () => {};
health.assertDeliveryAllowed = () => {};
health.reportResult = () => {};
safety.assertContentWithinLimits = () => {};
safety.assertCanSend = async () => {};
safety.recordDeliveryAttempt = async () => {};

let sentMessage;
const originalLoad = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'nodemailer') return {
    createTransport: () => ({
      sendMail: async (message) => {
        sentMessage = message;
        return { accepted: ['user@example.com'], rejected: [], messageId: 'mock-smtp-id' };
      },
    }),
  };
  return originalLoad.call(this, id, parent, isMain);
};
global.fetch = async () => { throw new Error('Postmark must not be called'); };

const { activeProvider, sendPlatformSubscriberEmail } = require('../lib/emailTransport.cjs');
(async () => {
  assert.equal(activeProvider(), 'smtp');
  const result = await sendPlatformSubscriberEmail({
    to: 'user@example.com',
    from: 'CompanySync <noreply@companysync.io>',
    subject: 'Account recovery',
    text: 'Recovery link',
  });
  assert.equal(result.provider, 'smtp');
  assert.equal(result.success, true);
  assert.match(sentMessage.from, /relay@test\.invalid/);
  assert.equal(sentMessage.subject, 'Account recovery');
  process.env.EMAIL_PROVIDER = 'postmark';
  process.env.EMAIL_POSTMARK_DISABLED = '1';
  assert.equal(activeProvider(), 'smtp', 'emergency block overrides a stale Postmark secret');
  const emergencyResult = await sendPlatformSubscriberEmail({
    to: 'user@example.com',
    subject: 'Recovery under stale Postmark secret',
    text: 'Recovery link',
  });
  assert.equal(emergencyResult.provider, 'smtp');
  delete process.env.SMTP_PASS;
  assert.equal(activeProvider(), 'none', 'missing SMTP credentials must not fall back to dead Postmark');
  console.log('Subscriber SMTP override checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
});