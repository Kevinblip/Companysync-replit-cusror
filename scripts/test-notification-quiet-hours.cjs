'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isAuthenticatedManualSend } = require('../lib/manualSendPolicy.cjs');
const {
  getQuietHoursWindow,
  getStaffNotificationQuietHours,
  isWithinQuietHours,
  nextQuietHoursEnd,
} = require('../lib/notificationQuietHours.cjs');

const window = getQuietHoursWindow({
  notification_quiet_hours: {
    enabled: true,
    start: '21:00',
    end: '06:00',
  },
}, 'America/New_York');

const at = (iso) => new Date(iso);

assert.equal(isWithinQuietHours(window, at('2026-09-14T07:00:00.000Z')), true, '3 AM ET must be quiet');
assert.equal(isWithinQuietHours(window, at('2026-09-14T09:30:00.000Z')), true, '5:30 AM ET must be quiet');
assert.equal(isWithinQuietHours(window, at('2026-09-14T09:59:00.000Z')), true, '5:59 AM ET must be quiet');
assert.equal(isWithinQuietHours(window, at('2026-09-14T10:00:00.000Z')), false, '6 AM ET must resume notifications');
assert.equal(isWithinQuietHours(window, at('2026-09-14T15:00:00.000Z')), false, '11 AM ET must not be quiet');

assert.equal(
  nextQuietHoursEnd(window, at('2026-09-14T07:00:00.000Z')).toISOString(),
  '2026-09-14T10:00:00.000Z',
  'deferred notification must become available at 6 AM ET',
);

const disabled = getQuietHoursWindow({
  notification_quiet_hours: { enabled: false, start: '21:00', end: '06:00' },
}, 'America/New_York');
assert.equal(isWithinQuietHours(disabled, at('2026-09-14T07:00:00.000Z')), false);

const manual = { manualSend: true, __externalCall: true };
assert.equal(isAuthenticatedManualSend(manual, {}, { email: 'staff@example.com' }), true);
assert.equal(isAuthenticatedManualSend(manual, null, { email: 'staff@example.com' }), false, 'cron cannot bypass');
assert.equal(isAuthenticatedManualSend(manual, {}, null), false, 'unverified user cannot bypass');
assert.equal(isAuthenticatedManualSend({ manualSend: true }, {}, { email: 'staff@example.com' }), false, 'internal flag cannot bypass');
assert.equal(isAuthenticatedManualSend({ __externalCall: true }, {}, { email: 'staff@example.com' }), false, 'ordinary external automation remains gated');

// Direct manual messages must prove browser authentication and company
// membership before bypassing staff quiet hours; background sends still check.
const handlers = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const devIntegrations = fs.readFileSync('vite-integrations-plugin.js', 'utf8');
const prodIntegrations = fs.readFileSync('db/prod-integrations.cjs', 'utf8');
assert.match(handlers, /if \(!req \|\| !params\.__externalCall\) throw new Error\('Authentication required for a manual text\.'\)/);
assert.match(handlers, /await authorizeCompanyEmailSender\(req, params\.companyId, 'SMS'\)/);
assert.match(handlers, /authenticatedManualSend = isAuthenticatedManualSend\(params, req, caller\)/);
assert.match(handlers, /params\.paymentInvoiceId \|\| authenticatedManualSend\s*\?\s*null\s*:\s*await quietHoursStaffDeliverySkip/);
assert.equal((handlers.match(/toArr\.length === 1 && !isAuthenticatedManualSend\(params, req, caller\)/g) || []).length, 2);
assert.match(handlers, /return \{\s*success: false,\s*skipped: true,\s*reason: 'company_notification_quiet_hours'/);
assert.match(devIntegrations, /manualSend: body\.manualSend, __externalCall: true/);
assert.match(devIntegrations, /getStaffNotificationQuietHours\(pool, companyId, \{ email: staffRecipients\[0\] \}\)/);
assert.match(prodIntegrations, /manualSend: body\?\.manualSend, __externalCall: true/);
assert.match(prodIntegrations, /getStaffNotificationQuietHours\(prodDb\.getPool\(\), companyId, \{ email: recipients\[0\] \}\)/);
assert.match(prodIntegrations, /functionName === 'sendTaskEmail' \|\| functionName === 'sendEmailFromCRM'/);
assert.match(prodIntegrations, /getStaffNotificationQuietHours\(require\('\.\/prod-db\.cjs'\)\.getPool\(\), requestedCompanyId, \{ email: toArr\[0\] \}\)/);
assert.match(fs.readFileSync('src/pages/SmsSender.jsx', 'utf8'), /message: messageBody/);

(async () => {
  const staffPool = {
    async query(sql) {
      if (sql.includes('SELECT timezone, settings FROM companies')) {
        return {
          rows: [{
            timezone: 'America/New_York',
            settings: {
              notification_quiet_hours: {
                enabled: true,
                start: '21:00',
                end: '06:00',
              },
            },
          }],
        };
      }
      return { rows: [{ ok: 1 }] };
    },
  };
  const staffQuietHours = await getStaffNotificationQuietHours(
    staffPool,
    'company-1',
    { email: 'staff@example.com' },
    at('2026-09-14T09:30:00.000Z'),
  );
  assert.equal(staffQuietHours.active, true, 'staff recipients must be deferred during quiet hours');

  const customerPool = {
    async query(sql) {
      if (sql.includes('SELECT timezone, settings FROM companies')) {
        return {
          rows: [{
            timezone: 'America/New_York',
            settings: {
              notification_quiet_hours: {
                enabled: true,
                start: '21:00',
                end: '06:00',
              },
            },
          }],
        };
      }
      return { rows: [] };
    },
  };
  const customerQuietHours = await getStaffNotificationQuietHours(
    customerPool,
    'company-1',
    { email: 'homeowner@example.com' },
    at('2026-09-14T09:30:00.000Z'),
  );
  assert.equal(customerQuietHours.active, false, 'customer recipients must not inherit staff quiet hours');

  console.log('notification quiet-hours tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});